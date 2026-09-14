import { OutboxProviderError, type OutboxDeliveryProvider, type ProviderDeliveryRequest, type ProviderDeliveryResult } from "./outbox-delivery-worker.js";

export interface ManagedWebhookDeliveryProviderOptions {
  readonly id: string;
  readonly topics: readonly string[];
  readonly endpoint: string;
  readonly allowedHosts: readonly string[];
  /** Deployment-owned KMS/HSM callback. The returned value is never logged or persisted by this adapter. */
  readonly sign: (input: { readonly body: string; readonly timestamp: string; readonly idempotencyKey: string }) => Promise<string>;
  readonly fetch?: typeof globalThis.fetch;
  readonly now?: () => string;
  readonly timeoutMs?: number;
  readonly maxBodyBytes?: number;
}

const identifierPattern = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{1,199}$/;

function assertIdentifier(value: string, label: string): void {
  if (!identifierPattern.test(value)) throw new Error(`${label} is invalid`);
}

function receipt(response: Response): string {
  const providerMessageId = response.headers.get("x-provider-message-id") ?? "";
  if (!identifierPattern.test(providerMessageId)) throw new OutboxProviderError("WEBHOOK_RECEIPT_INVALID");
  return providerMessageId;
}

/**
 * HTTPS delivery adapter for providers that make idempotency keys authoritative.
 * Destination allowlisting prevents configuration-derived SSRF, while the KMS
 * signing seam keeps raw signing keys outside the worker process.
 */
export function createManagedWebhookDeliveryProvider(options: ManagedWebhookDeliveryProviderOptions): OutboxDeliveryProvider {
  assertIdentifier(options.id, "provider id");
  if (!options.topics.length || new Set(options.topics).size !== options.topics.length) throw new Error("provider topics are invalid");
  for (const topic of options.topics) assertIdentifier(topic, "provider topic");
  const endpoint = new URL(options.endpoint);
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password) throw new Error("Webhook endpoint must be credential-free HTTPS");
  const allowedHosts = new Set(options.allowedHosts.map((host) => host.toLowerCase()));
  if (!allowedHosts.has(endpoint.hostname.toLowerCase())) throw new Error("Webhook endpoint host is not allowlisted");
  const timeoutMs = options.timeoutMs ?? 10_000;
  const maxBodyBytes = options.maxBodyBytes ?? 262_144;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 60_000) throw new Error("Webhook timeout is invalid");
  if (!Number.isSafeInteger(maxBodyBytes) || maxBodyBytes < 1_024 || maxBodyBytes > 2_097_152) throw new Error("Webhook body limit is invalid");
  const requestFetch = options.fetch ?? globalThis.fetch;
  const now = options.now ?? (() => new Date().toISOString());

  return Object.freeze({
    id: options.id,
    topics: Object.freeze([...options.topics]),
    idempotencyGuarantee: "REPLAY_SAFE" as const,
    deliver: async (request: ProviderDeliveryRequest): Promise<ProviderDeliveryResult> => {
      if (!options.topics.includes(request.topic)) throw new OutboxProviderError("WEBHOOK_TOPIC_REJECTED", false);
      assertIdentifier(request.idempotencyKey, "idempotency key");
      const observedAt = now();
      const observedAtMs = Date.parse(observedAt);
      if (!Number.isFinite(observedAtMs) || new Date(observedAtMs).toISOString() !== observedAt) {
        throw new OutboxProviderError("WEBHOOK_CLOCK_INVALID", false);
      }
      let body: string;
      try {
        body = JSON.stringify({ apiVersion: "1.0", tenantId: request.tenantId, topic: request.topic,
          publicationKey: request.publicationKey, payload: request.payload });
      } catch {
        throw new OutboxProviderError("WEBHOOK_PAYLOAD_INVALID", false);
      }
      if (Buffer.byteLength(body, "utf8") > maxBodyBytes) throw new OutboxProviderError("WEBHOOK_PAYLOAD_TOO_LARGE", false);
      const timestamp = String(Math.floor(observedAtMs / 1_000));
      const signature = await options.sign({ body, timestamp, idempotencyKey: request.idempotencyKey });
      if (!signature.trim() || signature.length > 4_096 || /[\r\n]/.test(signature)) {
        throw new OutboxProviderError("WEBHOOK_SIGNATURE_INVALID", false);
      }
      let response: Response;
      try {
        response = await requestFetch(endpoint, { method: "POST", redirect: "error", signal: AbortSignal.timeout(timeoutMs),
          headers: { "content-type": "application/json", "idempotency-key": request.idempotencyKey,
            "x-webhook-timestamp": timestamp, "x-webhook-signature": `v1=${signature}` }, body });
      } catch (error) {
        if (error instanceof OutboxProviderError) throw error;
        throw new OutboxProviderError("WEBHOOK_PROVIDER_UNAVAILABLE");
      }
      if (response.status === 409) return { status: "DUPLICATE", providerMessageId: receipt(response) };
      if (response.ok) return { status: "ACCEPTED", providerMessageId: receipt(response) };
      if (response.status === 408 || response.status === 429 || response.status >= 500) {
        throw new OutboxProviderError("WEBHOOK_PROVIDER_UNAVAILABLE");
      }
      throw new OutboxProviderError("WEBHOOK_PROVIDER_REJECTED", false);
    },
  });
}
