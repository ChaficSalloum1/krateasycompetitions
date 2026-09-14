import assert from "node:assert/strict";
import test from "node:test";
import { createManagedWebhookDeliveryProvider, OutboxProviderError } from "../src/index.js";

const request = {
  tenantId: "org.secure", topic: "tournament.published", publicationKey: "tournament.one:v2",
  payload: { tournamentId: "tournament.one" }, idempotencyKey: "outbox.v1.abc",
};

test("managed webhook provider signs an exact bounded request and preserves idempotency", async () => {
  const seen: Array<{ input: string; init?: RequestInit }> = [];
  const provider = createManagedWebhookDeliveryProvider({
    id: "partner-webhook", topics: ["tournament.published"], endpoint: "https://hooks.partner.example/events",
    allowedHosts: ["hooks.partner.example"], now: () => "2026-09-12T12:00:00.000Z",
    sign: async ({ body, timestamp }) => `kms-signature:${timestamp}:${body.length}`,
    fetch: async (input, init) => {
      seen.push({ input: String(input), ...(init ? { init } : {}) });
      return new Response(null, { status: 202, headers: { "x-provider-message-id": "delivery.123" } });
    },
  });

  assert.equal(provider.idempotencyGuarantee, "REPLAY_SAFE");
  assert.deepEqual(await provider.deliver(request), { status: "ACCEPTED", providerMessageId: "delivery.123" });
  assert.equal(seen[0]?.input, "https://hooks.partner.example/events");
  assert.equal(seen[0]?.init?.redirect, "error");
  assert.equal((seen[0]?.init?.headers as Record<string, string>)["idempotency-key"], "outbox.v1.abc");
  assert.match((seen[0]?.init?.headers as Record<string, string>)["x-webhook-signature"]!, /^v1=kms-signature:/);
  assert.doesNotMatch(JSON.stringify(seen[0]?.init?.headers), /tournament\.one/);
});

test("managed webhook provider recognizes replay and classifies retryable and permanent failures", async () => {
  const make = (status: number) => createManagedWebhookDeliveryProvider({
    id: "partner-webhook", topics: ["tournament.published"], endpoint: "https://hooks.partner.example/events",
    allowedHosts: ["hooks.partner.example"], sign: async () => "signed", fetch: async () =>
      new Response(null, { status, headers: { "x-provider-message-id": "delivery.123" } }),
  });
  assert.deepEqual(await make(409).deliver(request), { status: "DUPLICATE", providerMessageId: "delivery.123" });
  await assert.rejects(() => make(503).deliver(request), (error: unknown) =>
    error instanceof OutboxProviderError && error.code === "WEBHOOK_PROVIDER_UNAVAILABLE" && error.retryable);
  await assert.rejects(() => make(422).deliver(request), (error: unknown) =>
    error instanceof OutboxProviderError && error.code === "WEBHOOK_PROVIDER_REJECTED" && !error.retryable);
});

test("managed webhook provider rejects unsafe destinations and incomplete receipts", async () => {
  const common = { id: "partner-webhook", topics: ["tournament.published"], allowedHosts: ["hooks.partner.example"],
    sign: async () => "signed", fetch: async () => new Response(null, { status: 202 }) };
  assert.throws(() => createManagedWebhookDeliveryProvider({ ...common, endpoint: "http://hooks.partner.example/events" }), /HTTPS/);
  assert.throws(() => createManagedWebhookDeliveryProvider({ ...common, endpoint: "https://localhost/events" }), /allowlisted/);
  const provider = createManagedWebhookDeliveryProvider({ ...common, endpoint: "https://hooks.partner.example/events" });
  await assert.rejects(() => provider.deliver(request), (error: unknown) =>
    error instanceof OutboxProviderError && error.code === "WEBHOOK_RECEIPT_INVALID");
});
