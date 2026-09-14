import assert from "node:assert/strict";
import test from "node:test";
import {
  createOutboxDeliveryWorker,
  InMemoryTransactionalOutbox,
  type OutboxDeliveryProvider,
} from "../src/index.js";

const event = {
  id: "event-001",
  streamId: "tournament-42",
  streamVersion: 7,
  type: "SchedulePublished",
  occurredAt: "2026-09-05T09:00:00.000Z",
  committedAt: "2026-09-05T09:00:01.000Z",
  payload: { tournamentId: "tournament-42", recipients: ["player-1"] },
};

test("a delivery uses a stable tenant-scoped provider idempotency key and persists its receipt", async () => {
  const outbox = new InMemoryTransactionalOutbox("org-01");
  outbox.enqueueFromCommittedEvent(event, { topic: "competition.schedule.v1", key: "release-7" });
  const requests: unknown[] = [];
  const provider: OutboxDeliveryProvider = {
    id: "push-primary",
    topics: ["competition.schedule.v1"],
    idempotencyGuarantee: "REPLAY_SAFE",
    deliver: async (request) => {
      requests.push(request);
      return { status: "ACCEPTED", providerMessageId: "push-991" };
    },
  };
  const worker = createOutboxDeliveryWorker({
    tenantId: "org-01",
    workerId: "worker-a",
    outbox,
    providers: [provider],
    now: () => "2026-09-05T09:00:02.000Z",
  });

  const result = await worker.runOnce();

  assert.deepEqual(result, {
    claimed: 1,
    delivered: 1,
    retried: 0,
    deadLettered: 0,
    recovered: 0,
  });
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0], {
    tenantId: "org-01",
    topic: "competition.schedule.v1",
    publicationKey: "release-7",
    payload: event.payload,
    idempotencyKey: "outbox.v1.5fa5c97ba4c48cc21635c13ffd3ef2db5fcbd45cfdb2c3d0c165e34549fce7c6",
  });
  const delivered = outbox.list()[0]!;
  assert.equal(delivered.status, "DELIVERED");
  assert.equal(delivered.providerId, "push-primary");
  assert.equal(delivered.providerMessageId, "push-991");
  assert.equal(delivered.providerIdempotencyKey, (requests[0] as { idempotencyKey: string }).idempotencyKey);
});

test("a crash after provider acceptance replays one external effect with the same idempotency key", async () => {
  const outbox = new InMemoryTransactionalOutbox("org-01");
  outbox.enqueueFromCommittedEvent(event, { topic: "competition.schedule.v1", key: "release-7" });
  const accepted = new Map<string, string>();
  const attemptedKeys: string[] = [];
  const provider: OutboxDeliveryProvider = {
    id: "push-primary",
    topics: ["competition.schedule.v1"],
    idempotencyGuarantee: "REPLAY_SAFE",
    deliver: async ({ idempotencyKey }) => {
      attemptedKeys.push(idempotencyKey);
      const existing = accepted.get(idempotencyKey);
      if (existing) return { status: "DUPLICATE", providerMessageId: existing };
      accepted.set(idempotencyKey, "push-991");
      return { status: "ACCEPTED", providerMessageId: "push-991" };
    },
  };
  const crashed = createOutboxDeliveryWorker({
    tenantId: "org-01", workerId: "worker-crashed", outbox, providers: [provider],
    now: () => "2026-09-05T09:00:02.000Z", leaseMs: 5_000,
    afterProviderAccepted: () => { throw new Error("simulated process loss"); },
  });
  await assert.rejects(crashed.runOnce(), /simulated process loss/);
  assert.equal(outbox.list()[0]!.status, "LEASED");

  const recovered = createOutboxDeliveryWorker({
    tenantId: "org-01", workerId: "worker-recovery", outbox, providers: [provider],
    now: () => "2026-09-05T09:00:07.000Z", leaseMs: 5_000,
  });
  const result = await recovered.runOnce();

  assert.equal(result.recovered, 1);
  assert.equal(result.delivered, 1);
  assert.equal(accepted.size, 1);
  assert.deepEqual(attemptedKeys, [attemptedKeys[0], attemptedKeys[0]]);
  assert.equal(outbox.list()[0]!.providerMessageId, "push-991");
});

test("provider failures retry then dead-letter with bounded safe diagnostics and no secret telemetry", async () => {
  const outbox = new InMemoryTransactionalOutbox("org-01");
  outbox.enqueueFromCommittedEvent(event, {
    topic: "competition.schedule.v1",
    key: "release-7",
    payload: { email: "private@example.com", accessToken: "top-secret", tournamentId: "tournament-42" },
  });
  const telemetry: unknown[] = [];
  const provider: OutboxDeliveryProvider = {
    id: "email-primary", topics: ["competition.schedule.v1"], idempotencyGuarantee: "REPLAY_SAFE",
    deliver: async () => { throw new Error("HTTP 503 bearer top-secret private@example.com"); },
  };
  let currentTime = "2026-09-05T09:00:02.000Z";
  const worker = createOutboxDeliveryWorker({
    tenantId: "org-01", workerId: "worker-a", outbox, providers: [provider], maxAttempts: 2,
    baseDelayMs: 1_000, maxDelayMs: 1_000, now: () => currentTime,
    telemetry: { emit: (entry) => telemetry.push(entry) },
  });

  const first = await worker.runOnce();
  assert.equal(first.retried, 1);
  assert.equal(outbox.list()[0]!.lastError, "PROVIDER_DELIVERY_FAILED");
  currentTime = "2026-09-05T09:00:03.000Z";
  const second = await worker.runOnce();

  assert.equal(second.deadLettered, 1);
  assert.equal(outbox.list()[0]!.status, "DEAD_LETTER");
  const serializedTelemetry = JSON.stringify(telemetry);
  assert.doesNotMatch(serializedTelemetry, /top-secret|private@example\.com|accessToken|payload/i);
  assert.doesNotMatch(serializedTelemetry, /worker-a|org-01/);
  assert.match(serializedTelemetry, /PROVIDER_DELIVERY_FAILED/);
});

test("tenant-confused and oversized payloads are dead-lettered before any provider side effect", async () => {
  const outbox = new InMemoryTransactionalOutbox("org-01");
  outbox.enqueueFromCommittedEvent(event, {
    topic: "competition.schedule.v1", key: "wrong-tenant", payload: { organizationId: "org-02" },
  });
  outbox.enqueueFromCommittedEvent({ ...event, id: "event-002", streamVersion: 8 }, {
    topic: "competition.schedule.v1", key: "oversized", payload: { content: "x".repeat(100) },
  });
  let calls = 0;
  const provider: OutboxDeliveryProvider = {
    id: "push-primary", topics: ["competition.schedule.v1"], idempotencyGuarantee: "REPLAY_SAFE",
    deliver: async () => { calls += 1; return { status: "ACCEPTED", providerMessageId: "must-not-send" }; },
  };
  const worker = createOutboxDeliveryWorker({
    tenantId: "org-01", workerId: "worker-a", outbox, providers: [provider], maxPayloadBytes: 64,
    now: () => "2026-09-05T09:00:02.000Z",
  });

  const result = await worker.runOnce();

  assert.equal(result.deadLettered, 2);
  assert.equal(calls, 0);
  const rejected = outbox.list();
  assert.ok(rejected.every(({ status }) => status === "DEAD_LETTER"));
  assert.deepEqual(new Set(rejected.map(({ lastError }) => lastError)), new Set(["PAYLOAD_TENANT_MISMATCH", "PAYLOAD_TOO_LARGE"]));
});
