import { canonicalHash, deepFreeze } from "@tournament-os/tournament-schema";

export interface CommittedDomainEvent {
  id: string;
  streamId: string;
  streamVersion: number;
  type: string;
  occurredAt: string;
  committedAt: string;
  payload: unknown;
}

export interface OutboxPublication {
  topic: string;
  key: string;
  payload?: unknown;
}

export type OutboxStatus = "PENDING" | "LEASED" | "DELIVERED" | "DEAD_LETTER";

export interface OutboxMessage {
  tenantId: string;
  id: string;
  dedupeKey: string;
  eventId: string;
  streamId: string;
  streamVersion: number;
  eventType: string;
  topic: string;
  publicationKey: string;
  payload: unknown;
  status: OutboxStatus;
  attempts: number;
  createdAt: string;
  availableAt: string;
  leaseOwner?: string;
  leaseExpiresAt?: string;
  deliveredAt?: string;
  deadLetteredAt?: string;
  lastError?: string;
  providerId?: string;
  providerMessageId?: string;
  providerIdempotencyKey?: string;
}

export interface ClaimOutboxOptions {
  workerId: string;
  now: string;
  leaseMs: number;
  limit: number;
}

export interface LeaseMutationOptions {
  messageId: string;
  workerId: string;
  now: string;
}

export interface AcknowledgeOutboxOptions extends LeaseMutationOptions {
  deliveryReceipt?: {
    providerId: string;
    providerMessageId: string;
    providerIdempotencyKey: string;
  };
}

export interface RetryOutboxOptions extends LeaseMutationOptions {
  error: string;
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export interface TransactionalOutboxStore {
  enqueueFromCommittedEvent(event: CommittedDomainEvent, publication: OutboxPublication): Readonly<OutboxMessage>;
  claim(options: ClaimOutboxOptions): ReadonlyArray<Readonly<OutboxMessage>>;
  acknowledge(options: AcknowledgeOutboxOptions): Readonly<OutboxMessage>;
  retry(options: RetryOutboxOptions): Readonly<OutboxMessage>;
  recoverExpiredLeases(now: string): number;
  list(): ReadonlyArray<Readonly<OutboxMessage>>;
}

/** Durable implementation contract used when the outbox shares the event-store database transaction. */
export interface AsyncTransactionalOutboxStore {
  claim(options: ClaimOutboxOptions): Promise<ReadonlyArray<Readonly<OutboxMessage>>>;
  acknowledge(options: AcknowledgeOutboxOptions): Promise<Readonly<OutboxMessage>>;
  retry(options: RetryOutboxOptions): Promise<Readonly<OutboxMessage>>;
  recoverExpiredLeases(now: string): Promise<number>;
  list(): Promise<ReadonlyArray<Readonly<OutboxMessage>>>;
}

const snapshot = (message: OutboxMessage): Readonly<OutboxMessage> => deepFreeze(structuredClone(message));

export class InMemoryTransactionalOutbox implements TransactionalOutboxStore {
  readonly #messages = new Map<string, OutboxMessage>();

  constructor(readonly tenantId = "local") {
    if (!tenantId.trim() || tenantId.length > 200 || /[\u0000-\u001f]/.test(tenantId)) {
      throw new Error("tenantId must be a non-empty bounded identifier");
    }
  }

  #leasedMessage(options: LeaseMutationOptions): { message: OutboxMessage; now: number } {
    const message = [...this.#messages.values()].find(({ id }) => id === options.messageId);
    const now = Date.parse(options.now);
    if (!message) throw new Error(`Unknown outbox message: ${options.messageId}`);
    if (!Number.isFinite(now)) throw new Error("Lease mutation requires a valid timestamp");
    if (message.status !== "LEASED" || message.leaseOwner !== options.workerId) throw new Error("Only the current lease owner may mutate delivery state");
    if (Date.parse(message.leaseExpiresAt!) <= now) throw new Error("The outbox lease has expired");
    return { message, now };
  }

  enqueueFromCommittedEvent(event: CommittedDomainEvent, publication: OutboxPublication): Readonly<OutboxMessage> {
    const dedupeKey = canonicalHash({ eventId: event.id, topic: publication.topic, publicationKey: publication.key });
    const existing = this.#messages.get(dedupeKey);
    if (existing) return snapshot(existing);
    const message: OutboxMessage = {
      tenantId: this.tenantId,
      id: `outbox.${dedupeKey}`,
      dedupeKey,
      eventId: event.id,
      streamId: event.streamId,
      streamVersion: event.streamVersion,
      eventType: event.type,
      topic: publication.topic,
      publicationKey: publication.key,
      payload: structuredClone(publication.payload ?? event.payload),
      status: "PENDING",
      attempts: 0,
      createdAt: event.committedAt,
      availableAt: event.committedAt,
    };
    this.#messages.set(dedupeKey, message);
    return snapshot(message);
  }

  claim(options: ClaimOutboxOptions): ReadonlyArray<Readonly<OutboxMessage>> {
    const now = Date.parse(options.now);
    if (!options.workerId || !Number.isFinite(now) || !Number.isInteger(options.leaseMs) || options.leaseMs <= 0 || !Number.isInteger(options.limit) || options.limit <= 0) {
      throw new Error("Claim requires a worker, valid timestamp, positive lease, and positive limit");
    }
    const eligible = [...this.#messages.values()]
      .filter(({ status, availableAt }) => status === "PENDING" && Date.parse(availableAt) <= now)
      .sort((left, right) => left.availableAt.localeCompare(right.availableAt) || left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))
      .slice(0, options.limit);
    for (const message of eligible) {
      message.status = "LEASED";
      message.attempts += 1;
      message.leaseOwner = options.workerId;
      message.leaseExpiresAt = new Date(now + options.leaseMs).toISOString();
    }
    return eligible.map(snapshot);
  }

  acknowledge(options: AcknowledgeOutboxOptions): Readonly<OutboxMessage> {
    const { message, now } = this.#leasedMessage(options);
    if (options.deliveryReceipt) {
      const { providerId, providerMessageId, providerIdempotencyKey } = options.deliveryReceipt;
      if (![providerId, providerMessageId, providerIdempotencyKey].every((value) => value.trim() && value.length <= 500 && !/[\u0000-\u001f]/.test(value))) {
        throw new Error("Delivery receipt requires bounded provider identifiers");
      }
      message.providerId = providerId;
      message.providerMessageId = providerMessageId;
      message.providerIdempotencyKey = providerIdempotencyKey;
    }
    message.status = "DELIVERED";
    message.deliveredAt = new Date(now).toISOString();
    delete message.leaseOwner;
    delete message.leaseExpiresAt;
    return snapshot(message);
  }

  retry(options: RetryOutboxOptions): Readonly<OutboxMessage> {
    const { message, now } = this.#leasedMessage(options);
    if (!options.error || !Number.isInteger(options.maxAttempts) || options.maxAttempts <= 0
      || !Number.isInteger(options.baseDelayMs) || options.baseDelayMs <= 0
      || !Number.isInteger(options.maxDelayMs) || options.maxDelayMs < options.baseDelayMs) {
      throw new Error("Retry requires an error and valid positive retry policy");
    }
    if (message.attempts >= options.maxAttempts) {
      message.status = "DEAD_LETTER";
      message.deadLetteredAt = new Date(now).toISOString();
      message.lastError = options.error;
      delete message.leaseOwner;
      delete message.leaseExpiresAt;
      return snapshot(message);
    }
    const delay = Math.min(options.maxDelayMs, options.baseDelayMs * (2 ** Math.max(0, message.attempts - 1)));
    message.status = "PENDING";
    message.availableAt = new Date(now + delay).toISOString();
    message.lastError = options.error;
    delete message.leaseOwner;
    delete message.leaseExpiresAt;
    return snapshot(message);
  }

  recoverExpiredLeases(nowValue: string): number {
    const now = Date.parse(nowValue);
    if (!Number.isFinite(now)) throw new Error("Lease recovery requires a valid timestamp");
    const expired = [...this.#messages.values()].filter(({ status, leaseExpiresAt }) =>
      status === "LEASED" && leaseExpiresAt !== undefined && Date.parse(leaseExpiresAt) <= now);
    for (const message of expired) {
      message.status = "PENDING";
      message.availableAt = new Date(now).toISOString();
      delete message.leaseOwner;
      delete message.leaseExpiresAt;
    }
    return expired.length;
  }

  list(): ReadonlyArray<Readonly<OutboxMessage>> {
    return [...this.#messages.values()]
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))
      .map(snapshot);
  }
}
