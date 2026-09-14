import assert from "node:assert/strict";
import test from "node:test";
import { createInMemoryTransactionalOutboxEventStore } from "../src/event-store.js";
import { runOutboxCrashRecoveryDrill, type IdempotentDeliveryProvider } from "../src/operational-chaos.js";

async function seededOutbox() {
  const store = createInMemoryTransactionalOutboxEventStore();
  await store.append({
    streamId: "organization:org.1",
    expectedVersion: 0,
    commandId: "publish.1",
    recordedAt: "2026-09-12T12:00:00.000Z",
    events: [{ type: "PUBLICATION_CERTIFIED", payload: { tournamentId: "t.1" }, metadata: {
      outbox: { topic: "competition.published", key: "t.1:v1", payload: { tournamentId: "t.1" } },
    } }],
  });
  return store;
}

test("crash drill proves provider deduplication before acknowledging the recovered lease", async () => {
  const store = await seededOutbox();
  const deliveries = new Map<string, string>();
  const provider: IdempotentDeliveryProvider = { deliver: async ({ idempotencyKey }) => {
    const existing = deliveries.get(idempotencyKey);
    if (existing) return { status: "DUPLICATE", providerDeliveryId: existing };
    const providerDeliveryId = "provider.delivery.1";
    deliveries.set(idempotencyKey, providerDeliveryId);
    return { status: "ACCEPTED", providerDeliveryId };
  } };

  const report = await runOutboxCrashRecoveryDrill({
    store: store.outbox,
    provider,
    firstWorkerId: "worker.crashed",
    recoveryWorkerId: "worker.recovered",
    claimedAt: "2026-09-12T12:00:00.000Z",
    recoveredAt: "2026-09-12T12:00:31.000Z",
    leaseMs: 30_000,
  });

  assert.equal(report.status, "VERIFIED");
  assert.equal(report.providerEffects, 1);
  assert.equal(report.attempts, 2);
  assert.equal(report.finalOutboxStatus, "DELIVERED");
  assert.match(report.proofHash, /^[a-f0-9]{64}$/);
});

test("crash drill rejects providers that create a second externally visible effect", async () => {
  const store = await seededOutbox();
  let deliveries = 0;
  const provider: IdempotentDeliveryProvider = { deliver: async () => ({
    status: "ACCEPTED",
    providerDeliveryId: `provider.delivery.${++deliveries}`,
  }) };
  const report = await runOutboxCrashRecoveryDrill({
    store: store.outbox,
    provider,
    firstWorkerId: "worker.crashed",
    recoveryWorkerId: "worker.recovered",
    claimedAt: "2026-09-12T12:00:00.000Z",
    recoveredAt: "2026-09-12T12:00:31.000Z",
    leaseMs: 30_000,
  });

  assert.equal(report.status, "FAILED");
  assert.equal(report.providerEffects, 2);
  assert.match(report.issues.join("\n"), /idempotently suppress/);
});
