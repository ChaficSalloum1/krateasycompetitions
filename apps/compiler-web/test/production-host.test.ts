import assert from "node:assert/strict";
import test from "node:test";
import { assessProductionReadiness, createInMemoryEventStore, type PostgresEventStore } from "@tournament-os/competition-engine";
import { loadProductionHost, parseProductionHostConfiguration } from "../src/production-host.js";

function store(): PostgresEventStore {
  const memory = createInMemoryEventStore();
  return { ...memory,
    capabilities: { durability: "TRANSACTIONAL_POSTGRES", tenantIsolation: "FORCED_RLS", multiProcessAtomicity: true, schemaVersion: "1.3.0" },
    migrate: async () => undefined,
    close: async () => undefined };
}

const pilotApi = {
  now: () => new Date("2026-09-12T12:00:00.000Z"),
  rateLimitStore: { capabilities: { scope: "DISTRIBUTED", atomic: true, durable: true } as const,
    consume: async () => ({ allowed: true, retryAfterSeconds: 1 }) },
  webhookReplayStore: { capabilities: { scope: "DISTRIBUTED", atomic: true, durable: true } as const,
    claim: async () => true, complete: async () => undefined, release: async () => undefined },
  resolveWebhookSecret: async () => null,
  receiveWebhook: async () => undefined,
};
const publicationArtifacts = { load: async () => undefined };
const readiness = () => assessProductionReadiness([
  "cp-sat-solver", "database", "event-ledger", "identity-provider", "kms-provider", "outbox-worker", "secret-provider",
].map((name) => ({ name, required: true, status: "HEALTHY" as const, observedAt: "2026-09-12T12:00:00.000Z" })), {
  checkedAt: "2026-09-12T12:00:00.000Z", maximumEvidenceAgeMs: 5_000,
});

test("production host configuration is fail-closed and contains no credential values", () => {
  assert.throws(() => parseProductionHostConfiguration({ NODE_ENV: "development" }), /NODE_ENV/);
  assert.throws(() => parseProductionHostConfiguration({ NODE_ENV: "production", KREATEASY_TENANT_ID: "org.one" }), /ADAPTER_MODULE/);
  assert.throws(() => parseProductionHostConfiguration({ NODE_ENV: "production", KREATEASY_TENANT_ID: "bad tenant",
    KREATEASY_ADAPTER_MODULE: "@krateasy/deployment-adapter" }), /TENANT_ID/);
  assert.deepEqual(parseProductionHostConfiguration({ NODE_ENV: "production", KREATEASY_TENANT_ID: "org.one",
    KREATEASY_ADAPTER_MODULE: "@krateasy/deployment-adapter", PORT: "8080", HOST: "::" }), {
    tenantId: "org.one", adapterModule: "@krateasy/deployment-adapter", port: 8080, host: "::",
  });
});

test("production host loads deployment adapters without applying migrations and closes every dependency once", async () => {
  let factoryCalls = 0; let adapterCloses = 0; let migrationCalls = 0; let storeCloses = 0;
  const database = store();
  database.migrate = async () => { migrationCalls += 1; };
  database.close = async () => { storeCloses += 1; };
  const host = await loadProductionHost({
    env: { NODE_ENV: "production", KREATEASY_TENANT_ID: "org.one", KREATEASY_ADAPTER_MODULE: "adapter:test" },
    importAdapter: async (specifier) => {
      assert.equal(specifier, "adapter:test");
      return { createProductionAdapters: async ({ tenantId }) => {
        factoryCalls += 1;
        assert.equal(tenantId, "org.one");
        return { store: database, authenticate: async () => null, publicationArtifacts, pilotApi, readiness,
          close: async () => { adapterCloses += 1; } };
      } };
    },
  });
  assert.equal(factoryCalls, 1);
  assert.equal(migrationCalls, 0);
  await host.close();
  await host.close();
  assert.equal(storeCloses, 1);
  assert.equal(adapterCloses, 1);
});

test("production host rejects an adapter without explicit durable persistence", async () => {
  await assert.rejects(() => loadProductionHost({
    env: { NODE_ENV: "production", KREATEASY_TENANT_ID: "org.one", KREATEASY_ADAPTER_MODULE: "adapter:test" },
    importAdapter: async () => ({ createProductionAdapters: async () => ({ authenticate: async () => null, publicationArtifacts, pilotApi, readiness }) }),
  }), /PostgreSQL store or connection string/);
  await assert.rejects(() => loadProductionHost({
    env: { NODE_ENV: "production", KREATEASY_TENANT_ID: "org.one", KREATEASY_ADAPTER_MODULE: "adapter:test" },
    importAdapter: async () => ({ createProductionAdapters: async () => ({ store: store(), publicationArtifacts, pilotApi, readiness }) }),
  }), /authenticate/);
});

test("production host fails closed without the authoritative publication artifact resolver", async () => {
  await assert.rejects(() => loadProductionHost({
    env: { NODE_ENV: "production", KREATEASY_TENANT_ID: "org.one", KREATEASY_ADAPTER_MODULE: "adapter:test" },
    importAdapter: async () => ({ createProductionAdapters: async () => ({ store: store(), authenticate: async () => null,
      pilotApi, readiness }) }),
  }), /authoritative publication artifact resolver/);
});
