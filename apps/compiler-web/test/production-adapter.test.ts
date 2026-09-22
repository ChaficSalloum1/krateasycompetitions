import assert from "node:assert/strict";
import test from "node:test";
import { createProductionAdapters } from "../src/production-adapter.js";

const validEnv = {
  DATABASE_URL: "postgresql://user@localhost:5432/db",
  COORDINATION_KEY_HASH_SECRET: "coordination-key-hash-secret-at-least-32-bytes-long",
  CLERK_SECRET_KEY: "sk_test_" + "a".repeat(40),
  R2_ACCOUNT_ID: "account-1",
  R2_ACCESS_KEY_ID: "access-key-1",
  R2_SECRET_ACCESS_KEY: "secret-key-1",
  R2_PUBLICATION_ARTIFACTS_BUCKET: "publication-artifacts",
};

function fakePool(query: (text: string) => Promise<unknown>) {
  let ended = 0;
  const pool = {
    async query(text: string) { return query(text); },
    async connect() { throw new Error("connect() must not be called by these tests"); },
    async end() { ended += 1; },
  };
  return { pool, endedCount: () => ended };
}

for (const [missing, remaining] of Object.entries(validEnv).map(([key]) => [key,
  Object.fromEntries(Object.entries(validEnv).filter(([candidate]) => candidate !== key))] as const)) {
  test(`createProductionAdapters fails closed when ${missing} is missing`, async () => {
    const { pool } = fakePool(async () => ({ rows: [], rowCount: 0 }));
    await assert.rejects(createProductionAdapters({ tenantId: "org.one" }, { env: remaining, pool }),
      new RegExp(missing));
  });
}

test("with full configuration it returns real adapters wired to the injected dependencies", async () => {
  const { pool } = fakePool(async () => ({ rows: [{ "?column?": 1 }], rowCount: 1 }));
  const adapters = await createProductionAdapters({ tenantId: "org.one" }, { env: validEnv, pool });
  assert.equal(typeof adapters.authenticate, "function");
  assert.equal(typeof adapters.publicationArtifacts.load, "function");
  assert.equal(adapters.pilotApi.requireDistributedStores, true);
  assert.equal(adapters.pilotApi.rateLimitStore.capabilities.scope, "DISTRIBUTED");
  assert.equal(adapters.pilotApi.webhookReplayStore.capabilities.scope, "DISTRIBUTED");
  assert.equal(await adapters.pilotApi.resolveWebhookSecret("any-provider"), null);
  await assert.rejects(adapters.pilotApi.receiveWebhook({ tenantId: "org.one", provider: "p", eventId: "e",
    eventType: "t", payload: {}, receivedAt: "2026-09-22T00:00:00.000Z" }));
});

test("readiness honestly reports UNREADY while kms/secret/outbox-worker probes have no real backing", async () => {
  const { pool } = fakePool(async () => ({ rows: [{ "?column?": 1 }], rowCount: 1 }));
  const adapters = await createProductionAdapters({ tenantId: "org.one" }, { env: validEnv, pool,
    now: () => new Date("2026-09-22T12:00:00.000Z") });
  const report = await adapters.readiness();
  assert.equal(report.status, "UNREADY");
  assert.equal(report.httpStatus, 503);
  const byName = Object.fromEntries(report.checks.map((check) => [check.name, check.status]));
  assert.equal(byName["database"], "HEALTHY");
  assert.equal(byName["event-ledger"], "HEALTHY");
  assert.equal(byName["identity-provider"], "HEALTHY");
  assert.equal(byName["kms-provider"], "UNHEALTHY");
  assert.equal(byName["secret-provider"], "UNHEALTHY");
  assert.equal(byName["outbox-worker"], "UNHEALTHY");
});

test("readiness reports the database itself as unhealthy when it cannot be reached", async () => {
  const { pool } = fakePool(async () => { throw new Error("connection refused"); });
  const adapters = await createProductionAdapters({ tenantId: "org.one" }, { env: validEnv, pool });
  const report = await adapters.readiness();
  const byName = Object.fromEntries(report.checks.map((check) => [check.name, check.status]));
  assert.equal(byName["database"], "UNHEALTHY");
  assert.equal(byName["event-ledger"], "UNHEALTHY");
});

test("close ends the shared pool exactly once", async () => {
  const { pool, endedCount } = fakePool(async () => ({ rows: [], rowCount: 0 }));
  const adapters = await createProductionAdapters({ tenantId: "org.one" }, { env: validEnv, pool });
  await adapters.close?.();
  assert.equal(endedCount(), 1);
});
