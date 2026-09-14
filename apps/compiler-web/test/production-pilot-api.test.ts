import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { createInMemoryEventStore, createOrganizationPlatform, createOrganizationPlatformApi } from "@tournament-os/competition-engine";
import { createInMemoryRateLimitStore, createInMemoryWebhookReplayStore, createProductionPilotApi } from "../src/production-pilot-api.js";

const at = "2026-09-12T12:00:00.000Z";

async function fixture() {
  const platform = createOrganizationPlatform(createInMemoryEventStore());
  await platform.execute({ kind: "CREATE_ORGANIZATION", organizationId: "org.secure", commandId: "setup.1", occurredAt: at,
    ownerUserId: "user.owner", name: "Secure Org", slug: "secure-org" });
  const api = createProductionPilotApi({
    tenantId: "org.secure",
    delegate: createOrganizationPlatformApi({ platform, now: () => at }),
    now: () => new Date(at),
    rateLimitStore: createInMemoryRateLimitStore(),
    webhookReplayStore: createInMemoryWebhookReplayStore(),
    resolveWebhookSecret: async () => "0123456789abcdef0123456789abcdef",
    receiveWebhook: async () => undefined,
  });
  return { api, platform };
}

test("operator commands require a trusted principal and inject server-owned authority", async () => {
  const { api, platform } = await fixture();
  const noPrincipal = await api.handle({ method: "POST", path: "/v1/organizations/org.secure/commands", headers: {
    "content-type": "application/json", "idempotency-key": "pilot.status.1",
  }, body: JSON.stringify({ kind: "CHANGE_TOURNAMENT_STATUS", tournamentId: "tournament.one", status: "UNDER_REVIEW" }), principal: null });
  assert.equal(noPrincipal.status, 401);

  const injected = await api.handle({ method: "POST", path: "/v1/organizations/org.secure/commands", headers: {
    "content-type": "application/json", "idempotency-key": "pilot.status.2",
  }, body: JSON.stringify({ kind: "CHANGE_TOURNAMENT_STATUS", tournamentId: "tournament.one", status: "UNDER_REVIEW",
    actorUserId: "user.attacker" }), principal: { organizationId: "org.secure", userId: "user.owner" } });
  assert.equal(injected.status, 400);
  assert.equal((await platform.read("org.secure")).version, 1);
});

test("command requests enforce media type, byte limits, idempotency, and an exact discriminated schema", async () => {
  const { api } = await fixture();
  const principal = { organizationId: "org.secure", userId: "user.owner" };
  const request = (body: unknown, headers: Record<string, string> = { "content-type": "application/json", "idempotency-key": "pilot.status.3" }) =>
    api.handle({ method: "POST", path: "/v1/organizations/org.secure/commands", headers, body: JSON.stringify(body), principal });

  assert.equal((await request({ kind: "CHANGE_TOURNAMENT_STATUS", tournamentId: "t.one", status: "UNDER_REVIEW" },
    { "content-type": "text/plain", "idempotency-key": "pilot.status.3" })).status, 415);
  assert.equal((await request({ kind: "CHANGE_TOURNAMENT_STATUS", tournamentId: "t.one", status: "UNDER_REVIEW" },
    { "content-type": "application/json" })).status, 400);
  assert.equal((await request({ kind: "CHANGE_TOURNAMENT_STATUS", tournamentId: "t.one", status: "UNDER_REVIEW", surprise: true })).status, 400);
  assert.equal((await request({ kind: "DELETE_ACCOUNT", userId: "user.owner", reason: "no" })).status, 400);
  assert.equal((await request({ kind: "APPLY_LIVE_OPERATION", tournamentId: "t.one",
    liveCommand: { kind: "CLOSE_COURT", expectedVersion: 1, courtId: "court.one", reason: "rain", surprise: true } })).status, 400);

  const smallApi = createProductionPilotApi({ ...(await productionOptions()), maxBodyBytes: 32 });
  assert.equal((await smallApi.handle({ method: "POST", path: "/v1/organizations/org.secure/commands", headers: {
    "content-type": "application/json", "idempotency-key": "pilot.status.4",
  }, body: JSON.stringify({ kind: "CHANGE_TOURNAMENT_STATUS", tournamentId: "t.one", status: "UNDER_REVIEW" }), principal })).status, 413);
});

test("JSON field budgets reject pathological nesting, arrays, keys, and strings", async () => {
  const principal = { organizationId: "org.secure", userId: "user.owner" };
  const api = createProductionPilotApi({ ...(await productionOptions()), maxJsonDepth: 3, maxArrayItems: 2, maxObjectFields: 4, maxStringBytes: 20 });
  const request = (body: unknown) => api.handle({ method: "POST", path: "/v1/organizations/org.secure/commands", headers: {
    "content-type": "application/json", "idempotency-key": "pilot.publish.1",
  }, body: JSON.stringify(body), principal });
  const base = { kind: "PUBLISH_TOURNAMENT", tournamentId: "t.one", guardInput: { spec: {}, graph: {}, schedule: {} }, acknowledgedFindingCodes: [] };
  assert.equal((await request({ ...base, guardInput: { spec: { a: { b: { c: {} } } }, graph: {}, schedule: {} } })).status, 400);
  assert.equal((await request({ ...base, acknowledgedFindingCodes: ["A", "B", "C"] })).status, 400);
  assert.equal((await request({ ...base, guardInput: { spec: { a: 1, b: 2, c: 3, d: 4, e: 5 }, graph: {}, schedule: {} } })).status, 400);
  assert.equal((await request({ ...base, acknowledgedFindingCodes: ["X".repeat(21)] })).status, 400);
});

test("all authenticated operator traffic is rate limited per tenant and principal", async () => {
  const api = createProductionPilotApi({ ...(await productionOptions()), principalLimit: 2, principalWindowMs: 60_000 });
  const request = (userId: string) => api.handle({ method: "GET", path: "/v1/organizations/org.secure/dashboard", headers: {},
    principal: { organizationId: "org.secure", userId } });
  assert.equal((await request("user.owner")).status, 200);
  assert.equal((await request("user.owner")).status, 200);
  const limited = await request("user.owner");
  assert.equal(limited.status, 429);
  assert.equal(limited.headers?.["retry-after"], "60");
  assert.equal((await request("user.other")).status, 403);
});

test("webhooks require a fresh valid signature, reject replay, and inject the configured tenant", async () => {
  const received: unknown[] = [];
  const options = await productionOptions();
  const api = createProductionPilotApi({ ...options, receiveWebhook: async (event) => { received.push(event); } });
  const body = JSON.stringify({ eventType: "delivery.updated", payload: { notificationId: "notice.one", status: "DELIVERED" } });
  const timestamp = String(new Date(at).getTime() / 1000);
  const signature = `v1=${createHmac("sha256", "0123456789abcdef0123456789abcdef").update(`${timestamp}.${body}`).digest("hex")}`;
  const request = (overrides: Record<string, string> = {}, requestBody = body) => api.handle({ method: "POST", path: "/v1/webhooks/message-provider",
    headers: { "content-type": "application/json", "x-webhook-id": "event.123", "x-webhook-timestamp": timestamp,
      "x-webhook-signature": signature, ...overrides }, body: requestBody, principal: null });

  const accepted = await request();
  assert.equal(accepted.status, 202);
  assert.deepEqual(received, [{ tenantId: "org.secure", provider: "message-provider", eventId: "event.123",
    eventType: "delivery.updated", payload: { notificationId: "notice.one", status: "DELIVERED" }, receivedAt: at }]);
  assert.equal((await request()).status, 409);
  assert.equal((await request({ "x-webhook-id": "event.bad", "x-webhook-signature": "v1=00" })).status, 401);
  assert.equal((await request({ "x-webhook-id": "event.stale", "x-webhook-timestamp": "1" })).status, 401);

  const injectedBody = JSON.stringify({ eventType: "delivery.updated", payload: {}, tenantId: "org.other" });
  const injectedSignature = `v1=${createHmac("sha256", "0123456789abcdef0123456789abcdef").update(`${timestamp}.${injectedBody}`).digest("hex")}`;
  assert.equal((await request({ "x-webhook-id": "event.inject", "x-webhook-signature": injectedSignature }, injectedBody)).status, 400);
});

test("webhook claims are atomic while processing and released when the receiver fails", async () => {
  let releaseReceiver!: () => void;
  const gate = new Promise<void>((resolve) => { releaseReceiver = resolve; });
  const options = await productionOptions();
  const body = JSON.stringify({ eventType: "delivery.updated", payload: {} });
  const timestamp = String(new Date(at).getTime() / 1000);
  const signature = `v1=${createHmac("sha256", "0123456789abcdef0123456789abcdef").update(`${timestamp}.${body}`).digest("hex")}`;
  const request = (api: ReturnType<typeof createProductionPilotApi>, id: string) => api.handle({ method: "POST", path: "/v1/webhooks/provider.one",
    headers: { "content-type": "application/json", "x-webhook-id": id, "x-webhook-timestamp": timestamp,
      "x-webhook-signature": signature }, body, principal: null });
  const concurrentApi = createProductionPilotApi({ ...options, receiveWebhook: async () => gate });
  const first = request(concurrentApi, "event.concurrent");
  await Promise.resolve();
  assert.equal((await request(concurrentApi, "event.concurrent")).status, 409);
  releaseReceiver();
  assert.equal((await first).status, 202);

  let attempts = 0;
  const retryApi = createProductionPilotApi({ ...await productionOptions(), receiveWebhook: async () => {
    attempts += 1; if (attempts === 1) throw new Error("temporary outage");
  } });
  assert.equal((await request(retryApi, "event.retry")).status, 503);
  assert.equal((await request(retryApi, "event.retry")).status, 202);
});

test("production composition refuses process-local coordination stores", async () => {
  const options = await productionOptions();
  assert.deepEqual(options.rateLimitStore.capabilities, { scope: "PROCESS_LOCAL", atomic: true, durable: false });
  assert.deepEqual(options.webhookReplayStore.capabilities, { scope: "PROCESS_LOCAL", atomic: true, durable: false });
  assert.throws(() => createProductionPilotApi({ ...options, requireDistributedStores: true }), /distributed, atomic, durable/i);
});

async function productionOptions() {
  const platform = createOrganizationPlatform(createInMemoryEventStore());
  await platform.execute({ kind: "CREATE_ORGANIZATION", organizationId: "org.secure", commandId: "setup.1", occurredAt: at,
    ownerUserId: "user.owner", name: "Secure Org", slug: "secure-org" });
  return {
    tenantId: "org.secure", delegate: createOrganizationPlatformApi({ platform, now: () => at }), now: () => new Date(at),
    rateLimitStore: createInMemoryRateLimitStore(), webhookReplayStore: createInMemoryWebhookReplayStore(),
    resolveWebhookSecret: async () => "0123456789abcdef0123456789abcdef", receiveWebhook: async () => undefined,
  } as const;
}
