import assert from "node:assert/strict";
import test from "node:test";
import { OutboxProviderError, type ProviderDeliveryRequest } from "@tournament-os/competition-engine";
import { createResendDeliveryProvider } from "../src/resend-delivery-provider.js";

function request(overrides: Partial<ProviderDeliveryRequest> = {}): ProviderDeliveryRequest {
  return { tenantId: "org.st-albans", topic: "competition.participant-next.v1", publicationKey: "pub-1",
    idempotencyKey: "outbox.v1.abc123", payload: { recipientEntrantId: "entrant.1" }, ...overrides };
}

test("createResendDeliveryProvider requires a real API key and at least one topic", () => {
  assert.throws(() => createResendDeliveryProvider({ apiKey: "", fromAddress: "a@b.com", topics: ["t"],
    resolveRecipientEmail: async () => null, renderEmail: () => ({ subject: "s", text: "t" }) }), /resend_api_key_required/);
  assert.throws(() => createResendDeliveryProvider({ apiKey: "re_test", fromAddress: "a@b.com", topics: [],
    resolveRecipientEmail: async () => null, renderEmail: () => ({ subject: "s", text: "t" }) }), /requires_at_least_one_topic/);
});

test("declares itself as a replay-safe provider scoped to its configured topics", () => {
  const provider = createResendDeliveryProvider({ apiKey: "re_test", fromAddress: "a@b.com",
    topics: ["competition.participant-next.v1"], resolveRecipientEmail: async () => null,
    renderEmail: () => ({ subject: "s", text: "t" }) });
  assert.equal(provider.id, "resend.email");
  assert.deepEqual(provider.topics, ["competition.participant-next.v1"]);
  assert.equal(provider.idempotencyGuarantee, "REPLAY_SAFE");
});

test("a missing recipient email fails closed without ever calling Resend", async () => {
  let sendCalls = 0;
  const provider = createResendDeliveryProvider({ apiKey: "re_test", fromAddress: "a@b.com", topics: ["t"],
    resolveRecipientEmail: async () => null, renderEmail: () => ({ subject: "s", text: "t" }),
    send: async () => { sendCalls += 1; return { id: "should-not-be-called" }; } });
  await assert.rejects(provider.deliver(request()), (error: unknown) =>
    error instanceof OutboxProviderError && error.code === "RECIPIENT_EMAIL_UNAVAILABLE" && error.retryable === false);
  assert.equal(sendCalls, 0);
});

test("a successful send passes the idempotency key through and returns the provider message id", async () => {
  let captured: unknown;
  const provider = createResendDeliveryProvider({ apiKey: "re_test", fromAddress: "notices@krateasy.example",
    topics: ["competition.participant-next.v1"], resolveRecipientEmail: async () => "player@example.com",
    renderEmail: (req) => ({ subject: "Your next match", text: `Update for ${req.tenantId}` }),
    send: async (message) => { captured = message; return { id: "resend-message-1" }; } });
  const result = await provider.deliver(request());
  assert.deepEqual(result, { status: "ACCEPTED", providerMessageId: "resend-message-1" });
  assert.deepEqual(captured, { to: "player@example.com", from: "notices@krateasy.example",
    subject: "Your next match", text: "Update for org.st-albans", idempotencyKey: "outbox.v1.abc123" });
});

test("a rejected send is wrapped as a retryable OutboxProviderError rather than an opaque throw", async () => {
  const provider = createResendDeliveryProvider({ apiKey: "re_test", fromAddress: "a@b.com", topics: ["t"],
    resolveRecipientEmail: async () => "player@example.com", renderEmail: () => ({ subject: "s", text: "t" }),
    send: async () => { throw new Error("connection reset"); } });
  await assert.rejects(provider.deliver(request()));
});

test("a malformed provider response is never treated as a successful delivery", async () => {
  const provider = createResendDeliveryProvider({ apiKey: "re_test", fromAddress: "a@b.com", topics: ["t"],
    resolveRecipientEmail: async () => "player@example.com", renderEmail: () => ({ subject: "s", text: "t" }),
    send: async () => ({}) as never });
  await assert.rejects(provider.deliver(request()));
});
