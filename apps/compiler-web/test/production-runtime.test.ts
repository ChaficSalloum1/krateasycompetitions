import assert from "node:assert/strict";
import test from "node:test";
import { assessProductionReadiness, createInMemoryEventStore, type PlatformApiPrincipal, type PostgresEventStore } from "@tournament-os/competition-engine";
import { createInMemoryRateLimitStore, createInMemoryWebhookReplayStore } from "../src/production-pilot-api.js";
import { createProductionRuntime } from "../src/production-runtime.js";

function postgresShapedStore(): PostgresEventStore {
  const memory = createInMemoryEventStore();
  return {
    ...memory,
    capabilities: { durability: "TRANSACTIONAL_POSTGRES", tenantIsolation: "FORCED_RLS", multiProcessAtomicity: true, schemaVersion: "1.3.0" },
    migrate: async () => undefined,
    close: async () => undefined,
  };
}

function distributedPilotSecurity() {
  return {
    now: () => new Date("2026-09-12T12:00:00.000Z"),
    rateLimitStore: {
      capabilities: { scope: "DISTRIBUTED", atomic: true, durable: true } as const,
      consume: async () => ({ allowed: true, retryAfterSeconds: 1 }),
    },
    webhookReplayStore: {
      capabilities: { scope: "DISTRIBUTED", atomic: true, durable: true } as const,
      claim: async () => true,
      complete: async () => undefined,
      release: async () => undefined,
    },
    resolveWebhookSecret: async () => "test-only-secret-with-at-least-32-bytes",
    receiveWebhook: async () => undefined,
  };
}

const publicationArtifacts = { load: async () => undefined };

const productionReadiness = () => assessProductionReadiness([
  "cp-sat-solver", "database", "event-ledger", "identity-provider", "kms-provider", "outbox-worker", "secret-provider",
].map((name) => ({ name, required: true, status: "HEALTHY" as const, observedAt: "2026-09-12T12:00:00.000Z" })), {
  checkedAt: "2026-09-12T12:00:00.000Z", maximumEvidenceAgeMs: 5_000,
});

test("production runtime binds PostgreSQL persistence and a verified principal to one organisation", async () => {
  const expected = { organizationId: "org.production", userId: "user.owner" } as const;
  const runtime = createProductionRuntime({
    tenantId: "org.production",
    store: postgresShapedStore(),
    authenticate: async (request) => request.headers.authorization === "Bearer verified" ? expected : null,
    publicationArtifacts,
    pilotApi: distributedPilotSecurity(),
    readiness: productionReadiness,
  });
  assert.equal(typeof runtime.server.listen, "function");
  assert.deepEqual(await runtime.authenticate({ headers: { authorization: "Bearer verified" } } as never), expected);
  assert.equal(await runtime.authenticate({ headers: { authorization: "Bearer rejected" } } as never), null);

  const wrongTenant = createProductionRuntime({ tenantId: "org.production", store: postgresShapedStore(),
    authenticate: async () => ({ organizationId: "org.other", userId: "user.owner" } satisfies PlatformApiPrincipal),
    publicationArtifacts, pilotApi: distributedPilotSecurity(), readiness: productionReadiness });
  assert.equal(await wrongTenant.authenticate({ headers: {} } as never), null);
  await runtime.close();
  await wrongTenant.close();
});

test("production runtime refuses an in-memory store and an invalid tenant", () => {
  assert.throws(() => createProductionRuntime({ tenantId: "org.production", authenticate: async () => null,
    publicationArtifacts, pilotApi: distributedPilotSecurity(), readiness: productionReadiness }), /explicit PostgreSQL/);
  assert.throws(() => createProductionRuntime({ tenantId: "org.production", store: createInMemoryEventStore() as never,
    authenticate: async () => null, publicationArtifacts, pilotApi: distributedPilotSecurity(), readiness: productionReadiness }), /transactional PostgreSQL/);
  assert.throws(() => createProductionRuntime({ tenantId: "bad tenant", store: postgresShapedStore(),
    authenticate: async () => null, publicationArtifacts, pilotApi: distributedPilotSecurity(), readiness: productionReadiness }), /tenantId/);
  const staleSchema = postgresShapedStore();
  (staleSchema.capabilities as { schemaVersion: string }).schemaVersion = "1.2.0";
  assert.throws(() => createProductionRuntime({ tenantId: "org.production", store: staleSchema,
    authenticate: async () => null, publicationArtifacts, pilotApi: distributedPilotSecurity(), readiness: productionReadiness }), /schema 1\.3\.0/);
});

test("production runtime refuses process-local rate-limit and webhook replay stores", () => {
  assert.throws(() => createProductionRuntime({
    tenantId: "org.production",
    store: postgresShapedStore(),
    authenticate: async () => null,
    publicationArtifacts,
    readiness: productionReadiness,
    pilotApi: {
      now: () => new Date("2026-09-12T12:00:00.000Z"),
      rateLimitStore: createInMemoryRateLimitStore(),
      webhookReplayStore: createInMemoryWebhookReplayStore(),
      resolveWebhookSecret: async () => null,
      receiveWebhook: async () => undefined,
    },
  }), /distributed/);
});

test("production runtime applies bounded HTTP defaults and closes persistence exactly once", async () => {
  const lifecycle: string[] = [];
  const store = postgresShapedStore();
  store.close = async () => { lifecycle.push("store"); };
  const runtime = createProductionRuntime({
    tenantId: "org.production",
    store,
    authenticate: async () => null,
    publicationArtifacts,
    pilotApi: distributedPilotSecurity(),
    readiness: productionReadiness,
  });

  assert.equal(runtime.server.requestTimeout, 30_000);
  assert.equal(runtime.server.headersTimeout, 15_000);
  assert.equal(runtime.server.keepAliveTimeout, 5_000);
  assert.equal(runtime.server.maxRequestsPerSocket, 1_000);

  await runtime.close();
  assert.deepEqual(lifecycle, ["store"]);
  await runtime.close();
  assert.deepEqual(lifecycle, ["store"]);
});

test("production runtime validates and applies explicit HTTP limits", async () => {
  const runtime = createProductionRuntime({
    tenantId: "org.production",
    store: postgresShapedStore(),
    authenticate: async () => null,
    publicationArtifacts,
    pilotApi: distributedPilotSecurity(),
    readiness: productionReadiness,
    http: { requestTimeoutMs: 20_000, headersTimeoutMs: 8_000, keepAliveTimeoutMs: 2_000, maxRequestsPerSocket: 250 },
  });
  assert.equal(runtime.server.requestTimeout, 20_000);
  assert.equal(runtime.server.headersTimeout, 8_000);
  assert.equal(runtime.server.keepAliveTimeout, 2_000);
  assert.equal(runtime.server.maxRequestsPerSocket, 250);
  await runtime.close();

  assert.throws(() => createProductionRuntime({
    tenantId: "org.production",
    store: postgresShapedStore(),
    authenticate: async () => null,
    publicationArtifacts,
    pilotApi: distributedPilotSecurity(),
    readiness: productionReadiness,
    http: { requestTimeoutMs: 0 },
  }), /requestTimeoutMs/);
});
