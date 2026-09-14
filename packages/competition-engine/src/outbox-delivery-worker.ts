import { canonicalHash, deepFreeze } from "@tournament-os/tournament-schema";
import type {
  AcknowledgeOutboxOptions,
  ClaimOutboxOptions,
  OutboxMessage,
  RetryOutboxOptions,
} from "./outbox.js";

type Awaitable<T> = T | Promise<T>;

export interface OutboxDeliveryStore {
  claim(options: ClaimOutboxOptions): Awaitable<ReadonlyArray<Readonly<OutboxMessage>>>;
  acknowledge(options: AcknowledgeOutboxOptions): Awaitable<Readonly<OutboxMessage>>;
  retry(options: RetryOutboxOptions): Awaitable<Readonly<OutboxMessage>>;
  recoverExpiredLeases(now: string): Awaitable<number>;
}

export interface ProviderDeliveryRequest {
  readonly tenantId: string;
  readonly topic: string;
  readonly publicationKey: string;
  readonly payload: unknown;
  readonly idempotencyKey: string;
}

export interface ProviderDeliveryResult {
  readonly status: "ACCEPTED" | "DUPLICATE";
  readonly providerMessageId: string;
}

export interface OutboxDeliveryProvider {
  readonly id: string;
  readonly topics: readonly string[];
  /** Provider must map equal idempotency keys to one external side effect. */
  readonly idempotencyGuarantee: "REPLAY_SAFE";
  deliver(request: ProviderDeliveryRequest): Promise<ProviderDeliveryResult>;
}

export interface DeliveryTelemetryEvent {
  readonly type: "CLAIMED" | "DELIVERED" | "RETRIED" | "DEAD_LETTERED" | "RECOVERED";
  readonly tenantHash: string;
  readonly workerHash: string;
  readonly messageId?: string;
  readonly topic?: string;
  readonly providerId?: string;
  readonly attempt?: number;
  readonly errorCode?: string;
}

export class OutboxProviderError extends Error {
  constructor(readonly code: string, readonly retryable = true) {
    super(code);
    this.name = "OutboxProviderError";
  }
}

export interface OutboxDeliveryWorkerOptions {
  readonly tenantId: string;
  readonly workerId: string;
  readonly outbox: OutboxDeliveryStore;
  readonly providers: readonly OutboxDeliveryProvider[];
  readonly now?: () => string;
  readonly leaseMs?: number;
  readonly batchSize?: number;
  readonly maxAttempts?: number;
  readonly baseDelayMs?: number;
  readonly maxDelayMs?: number;
  readonly maxPayloadBytes?: number;
  readonly telemetry?: { emit(event: DeliveryTelemetryEvent): void };
  /** Test/process integration seam. Throw here to model process loss before acknowledgement. */
  readonly afterProviderAccepted?: (message: Readonly<OutboxMessage>, result: Readonly<ProviderDeliveryResult>) => Awaitable<void>;
}

export interface DeliveryRunSummary {
  readonly claimed: number;
  readonly delivered: number;
  readonly retried: number;
  readonly deadLettered: number;
  readonly recovered: number;
}

function assertIdentifier(value: string, name: string, max = 200): void {
  if (!value.trim() || value.length > max || /[\u0000-\u001f]/.test(value)) throw new Error(`${name} must be a non-empty bounded identifier`);
}

function assertJson(value: unknown, path: string): void {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (Array.isArray(value)) { value.forEach((entry, index) => assertJson(entry, `${path}/${index}`)); return; }
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    for (const [key, entry] of Object.entries(value)) assertJson(entry, `${path}/${key}`);
    return;
  }
  throw new OutboxProviderError("PAYLOAD_NOT_JSON", false);
}

function providerKey(tenantId: string, providerId: string, message: Readonly<OutboxMessage>): string {
  return `outbox.v1.${canonicalHash({ tenantId, providerId, dedupeKey: message.dedupeKey })}`;
}

function validateMessage(message: Readonly<OutboxMessage>, tenantId: string, maxPayloadBytes: number): void {
  if (message.tenantId !== tenantId) throw new OutboxProviderError("TENANT_MISMATCH", false);
  assertIdentifier(message.topic, "topic");
  assertIdentifier(message.publicationKey, "publicationKey", 500);
  assertJson(message.payload, "/payload");
  const payload = message.payload as Record<string, unknown>;
  if (payload && !Array.isArray(payload) && typeof payload === "object") {
    for (const key of ["tenantId", "organizationId"] as const) {
      if (payload[key] !== undefined && payload[key] !== tenantId) throw new OutboxProviderError("PAYLOAD_TENANT_MISMATCH", false);
    }
  }
  if (Buffer.byteLength(JSON.stringify(message.payload), "utf8") > maxPayloadBytes) {
    throw new OutboxProviderError("PAYLOAD_TOO_LARGE", false);
  }
}

function validateResult(result: ProviderDeliveryResult): void {
  if (!(result.status === "ACCEPTED" || result.status === "DUPLICATE")) throw new OutboxProviderError("INVALID_PROVIDER_RESPONSE");
  assertIdentifier(result.providerMessageId, "providerMessageId", 500);
}

export function createOutboxDeliveryWorker(options: OutboxDeliveryWorkerOptions): Readonly<{ runOnce(): Promise<Readonly<DeliveryRunSummary>> }> {
  assertIdentifier(options.tenantId, "tenantId");
  assertIdentifier(options.workerId, "workerId");
  const leaseMs = options.leaseMs ?? 30_000;
  const batchSize = options.batchSize ?? 25;
  const maxAttempts = options.maxAttempts ?? 5;
  const baseDelayMs = options.baseDelayMs ?? 1_000;
  const maxDelayMs = options.maxDelayMs ?? 60_000;
  const maxPayloadBytes = options.maxPayloadBytes ?? 262_144;
  if (![leaseMs, batchSize, maxAttempts, baseDelayMs, maxDelayMs, maxPayloadBytes].every(Number.isInteger)
    || leaseMs <= 0 || batchSize <= 0 || maxAttempts <= 0 || baseDelayMs <= 0 || maxDelayMs < baseDelayMs || maxPayloadBytes <= 0) {
    throw new Error("Worker limits must be positive integers with a valid retry range");
  }
  const providerByTopic = new Map<string, OutboxDeliveryProvider>();
  for (const provider of options.providers) {
    assertIdentifier(provider.id, "provider.id");
    if (provider.idempotencyGuarantee !== "REPLAY_SAFE" || provider.topics.length === 0) throw new Error("Every provider must guarantee replay-safe idempotency and declare a topic");
    for (const topic of provider.topics) {
      assertIdentifier(topic, "provider.topic");
      if (providerByTopic.has(topic)) throw new Error(`Multiple providers configured for topic ${topic}`);
      providerByTopic.set(topic, provider);
    }
  }
  const tenantHash = canonicalHash({ tenantId: options.tenantId }).slice(0, 16);
  const workerHash = canonicalHash({ workerId: options.workerId }).slice(0, 16);
  const emit = (event: Omit<DeliveryTelemetryEvent, "tenantHash" | "workerHash">): void => {
    options.telemetry?.emit(deepFreeze({ ...event, tenantHash, workerHash }));
  };
  const now = options.now ?? (() => new Date().toISOString());

  const runOnce = async (): Promise<Readonly<DeliveryRunSummary>> => {
    const runAt = now();
    if (!Number.isFinite(Date.parse(runAt)) || new Date(Date.parse(runAt)).toISOString() !== runAt) throw new Error("Worker clock must return a canonical timestamp");
    const recovered = await options.outbox.recoverExpiredLeases(runAt);
    if (recovered) emit({ type: "RECOVERED" });
    const messages = await options.outbox.claim({ workerId: options.workerId, now: runAt, leaseMs, limit: batchSize });
    let delivered = 0; let retried = 0; let deadLettered = 0;
    for (const message of messages) {
      emit({ type: "CLAIMED", messageId: message.id, topic: message.topic, attempt: message.attempts });
      let provider: OutboxDeliveryProvider | undefined;
      let result: ProviderDeliveryResult;
      let idempotencyKey = "";
      try {
        validateMessage(message, options.tenantId, maxPayloadBytes);
        provider = providerByTopic.get(message.topic);
        if (!provider) throw new OutboxProviderError("PROVIDER_NOT_CONFIGURED");
        idempotencyKey = providerKey(options.tenantId, provider.id, message);
        result = await provider.deliver({ tenantId: options.tenantId, topic: message.topic,
          publicationKey: message.publicationKey, payload: structuredClone(message.payload), idempotencyKey });
        validateResult(result);
      } catch (error) {
        const known = error instanceof OutboxProviderError ? error : new OutboxProviderError("PROVIDER_DELIVERY_FAILED");
        const mutation = await options.outbox.retry({ messageId: message.id, workerId: options.workerId, now: runAt,
          error: known.code, maxAttempts: known.retryable ? maxAttempts : message.attempts,
          baseDelayMs, maxDelayMs });
        if (mutation.status === "DEAD_LETTER") {
          deadLettered += 1;
          emit({ type: "DEAD_LETTERED", messageId: message.id, topic: message.topic,
            ...(provider ? { providerId: provider.id } : {}), attempt: message.attempts, errorCode: known.code });
        } else {
          retried += 1;
          emit({ type: "RETRIED", messageId: message.id, topic: message.topic,
            ...(provider ? { providerId: provider.id } : {}), attempt: message.attempts, errorCode: known.code });
        }
        continue;
      }
      await options.afterProviderAccepted?.(message, result);
      await options.outbox.acknowledge({ messageId: message.id, workerId: options.workerId, now: runAt,
        deliveryReceipt: { providerId: provider.id, providerMessageId: result.providerMessageId, providerIdempotencyKey: idempotencyKey } });
      delivered += 1;
      emit({ type: "DELIVERED", messageId: message.id, topic: message.topic, providerId: provider.id, attempt: message.attempts });
    }
    return deepFreeze({ claimed: messages.length, delivered, retried, deadLettered, recovered });
  };
  return deepFreeze({ runOnce });
}
