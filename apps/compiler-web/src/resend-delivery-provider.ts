import {
  OutboxProviderError,
  type OutboxDeliveryProvider,
  type ProviderDeliveryRequest,
  type ProviderDeliveryResult,
} from "@tournament-os/competition-engine";

export interface RenderedEmail {
  readonly subject: string;
  readonly text: string;
  readonly html?: string;
}

export interface ResendSendInput {
  readonly to: string;
  readonly from: string;
  readonly subject: string;
  readonly text: string;
  readonly html?: string;
  /** Passed as Resend's `Idempotency-Key` header so a retried delivery is one send. */
  readonly idempotencyKey: string;
}

export interface ResendDeliveryProviderOptions {
  readonly apiKey: string;
  readonly fromAddress: string;
  readonly topics: readonly string[];
  /**
   * This platform's outbox payloads carry a stable entrant/participant id,
   * never a contact address (see the master specification's privacy-minimal
   * projection rule) -- resolving that id to a real email belongs to a
   * participant contact directory the caller owns, not this provider.
   */
  readonly resolveRecipientEmail: (request: ProviderDeliveryRequest) => Promise<string | null>;
  readonly renderEmail: (request: ProviderDeliveryRequest) => RenderedEmail;
  /** Injection seam for tests; defaults to a real call to the Resend API. */
  readonly send?: (message: ResendSendInput) => Promise<{ readonly id: string }>;
}

const retryableStatus = (status: number): boolean => status === 429 || status >= 500;

function defaultSend(apiKey: string): (message: ResendSendInput) => Promise<{ readonly id: string }> {
  return async (message) => {
    let response: Response;
    try {
      response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json",
          "idempotency-key": message.idempotencyKey },
        body: JSON.stringify({ from: message.from, to: [message.to], subject: message.subject,
          text: message.text, ...(message.html ? { html: message.html } : {}) }),
      });
    } catch {
      throw new OutboxProviderError("RESEND_NETWORK_UNAVAILABLE");
    }
    if (!response.ok) {
      throw new OutboxProviderError(`RESEND_HTTP_${response.status}`, retryableStatus(response.status));
    }
    const body = await response.json().catch(() => null) as { id?: unknown } | null;
    if (!body || typeof body.id !== "string" || !body.id) throw new OutboxProviderError("RESEND_INVALID_RESPONSE");
    return { id: body.id };
  };
}

export function createResendDeliveryProvider(options: ResendDeliveryProviderOptions): OutboxDeliveryProvider {
  if (!options.apiKey.trim()) throw new Error("resend_api_key_required");
  if (options.topics.length === 0) throw new Error("resend_delivery_provider_requires_at_least_one_topic");
  const send = options.send ?? defaultSend(options.apiKey);
  return {
    id: "resend.email",
    topics: options.topics,
    idempotencyGuarantee: "REPLAY_SAFE",
    async deliver(request: ProviderDeliveryRequest): Promise<ProviderDeliveryResult> {
      const recipient = await options.resolveRecipientEmail(request);
      if (!recipient) throw new OutboxProviderError("RECIPIENT_EMAIL_UNAVAILABLE", false);
      const rendered = options.renderEmail(request);
      const result = await send({ to: recipient, from: options.fromAddress, subject: rendered.subject,
        text: rendered.text, idempotencyKey: request.idempotencyKey,
        ...(rendered.html !== undefined ? { html: rendered.html } : {}) });
      if (!result || typeof result.id !== "string" || !result.id) throw new OutboxProviderError("RESEND_INVALID_RESPONSE");
      return { status: "ACCEPTED", providerMessageId: result.id };
    },
  };
}
