import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryTransactionalOutbox, type TransactionalOutboxStore } from "../src/outbox.js";

const committedEvent = {
  id: "event-001",
  streamId: "tournament-42",
  streamVersion: 7,
  type: "ScheduleCertified",
  occurredAt: "2026-09-05T09:00:00.000Z",
  committedAt: "2026-09-05T09:00:01.000Z",
  payload: { certificationHash: "cert-abc" },
};

test("a committed event enqueues one stable publication even when transaction replay repeats it", () => {
  const outbox = new InMemoryTransactionalOutbox();
  const first = outbox.enqueueFromCommittedEvent(committedEvent, {
    topic: "tournament.schedule-certified",
    key: "primary-publication",
  });
  const replay = outbox.enqueueFromCommittedEvent(structuredClone(committedEvent), {
    topic: "tournament.schedule-certified",
    key: "primary-publication",
  });

  assert.deepEqual(replay, first);
  assert.equal(outbox.list().length, 1);
  assert.match(first.id, /^outbox\.[a-f0-9]{64}$/);
  assert.match(first.dedupeKey, /^[a-f0-9]{64}$/);
  assert.equal(first.status, "PENDING");
  assert.equal(first.availableAt, committedEvent.committedAt);
  assert.deepEqual(first.payload, committedEvent.payload);
});

test("workers atomically claim eligible messages in deterministic order under a bounded lease", () => {
  const outbox = new InMemoryTransactionalOutbox();
  outbox.enqueueFromCommittedEvent(committedEvent, { topic: "delivery", key: "primary" });
  outbox.enqueueFromCommittedEvent({
    ...committedEvent,
    id: "event-002",
    streamVersion: 8,
    committedAt: "2026-09-05T09:00:02.000Z",
  }, { topic: "delivery", key: "primary" });

  const firstClaim = outbox.claim({
    workerId: "worker-a",
    now: "2026-09-05T09:00:02.000Z",
    leaseMs: 30_000,
    limit: 1,
  });
  assert.equal(firstClaim.length, 1);
  assert.equal(firstClaim[0]!.eventId, "event-001");
  assert.equal(firstClaim[0]!.status, "LEASED");
  assert.equal(firstClaim[0]!.attempts, 1);
  assert.equal(firstClaim[0]!.leaseOwner, "worker-a");
  assert.equal(firstClaim[0]!.leaseExpiresAt, "2026-09-05T09:00:32.000Z");

  const secondClaim = outbox.claim({
    workerId: "worker-b",
    now: "2026-09-05T09:00:02.000Z",
    leaseMs: 30_000,
    limit: 2,
  });
  assert.deepEqual(secondClaim.map(({ eventId }) => eventId), ["event-002"]);
});

test("only the lease owner can acknowledge delivery and delivered messages never reappear", () => {
  const outbox = new InMemoryTransactionalOutbox();
  const queued = outbox.enqueueFromCommittedEvent(committedEvent, { topic: "delivery", key: "primary" });
  outbox.claim({ workerId: "worker-a", now: "2026-09-05T09:00:02.000Z", leaseMs: 30_000, limit: 1 });

  assert.throws(() => outbox.acknowledge({
    messageId: queued.id,
    workerId: "worker-b",
    now: "2026-09-05T09:00:03.000Z",
  }), /lease owner/);
  const delivered = outbox.acknowledge({
    messageId: queued.id,
    workerId: "worker-a",
    now: "2026-09-05T09:00:03.000Z",
  });
  assert.equal(delivered.status, "DELIVERED");
  assert.equal(delivered.deliveredAt, "2026-09-05T09:00:03.000Z");
  assert.equal(delivered.leaseOwner, undefined);
  assert.equal(delivered.leaseExpiresAt, undefined);
  assert.deepEqual(outbox.claim({
    workerId: "worker-b", now: "2026-09-05T10:00:00.000Z", leaseMs: 30_000, limit: 1,
  }), []);
});

test("failed delivery retries with bounded deterministic exponential backoff", () => {
  const outbox = new InMemoryTransactionalOutbox();
  const queued = outbox.enqueueFromCommittedEvent(committedEvent, { topic: "delivery", key: "primary" });
  outbox.claim({ workerId: "worker-a", now: "2026-09-05T09:00:02.000Z", leaseMs: 30_000, limit: 1 });

  const firstRetry = outbox.retry({
    messageId: queued.id,
    workerId: "worker-a",
    now: "2026-09-05T09:00:03.000Z",
    error: "HTTP 503",
    maxAttempts: 5,
    baseDelayMs: 1_000,
    maxDelayMs: 2_500,
  });
  assert.equal(firstRetry.status, "PENDING");
  assert.equal(firstRetry.availableAt, "2026-09-05T09:00:04.000Z");
  assert.equal(firstRetry.lastError, "HTTP 503");
  assert.equal(firstRetry.leaseOwner, undefined);
  assert.deepEqual(outbox.claim({
    workerId: "worker-b", now: "2026-09-05T09:00:03.999Z", leaseMs: 30_000, limit: 1,
  }), []);

  const secondClaim = outbox.claim({
    workerId: "worker-b", now: "2026-09-05T09:00:04.000Z", leaseMs: 30_000, limit: 1,
  });
  assert.equal(secondClaim[0]!.attempts, 2);
  const secondRetry = outbox.retry({
    messageId: queued.id,
    workerId: "worker-b",
    now: "2026-09-05T09:00:05.000Z",
    error: "timeout",
    maxAttempts: 5,
    baseDelayMs: 1_000,
    maxDelayMs: 2_500,
  });
  assert.equal(secondRetry.availableAt, "2026-09-05T09:00:07.000Z");

  outbox.claim({ workerId: "worker-c", now: secondRetry.availableAt, leaseMs: 30_000, limit: 1 });
  const boundedRetry = outbox.retry({
    messageId: queued.id,
    workerId: "worker-c",
    now: "2026-09-05T09:00:08.000Z",
    error: "still unavailable",
    maxAttempts: 5,
    baseDelayMs: 1_000,
    maxDelayMs: 2_500,
  });
  assert.equal(boundedRetry.availableAt, "2026-09-05T09:00:10.500Z");
});

test("the final failed attempt moves a message to dead letter and makes it unclaimable", () => {
  const outbox = new InMemoryTransactionalOutbox();
  const queued = outbox.enqueueFromCommittedEvent(committedEvent, { topic: "delivery", key: "primary" });
  outbox.claim({ workerId: "worker-a", now: "2026-09-05T09:00:02.000Z", leaseMs: 30_000, limit: 1 });
  const retry = outbox.retry({
    messageId: queued.id, workerId: "worker-a", now: "2026-09-05T09:00:03.000Z", error: "first failure",
    maxAttempts: 2, baseDelayMs: 1_000, maxDelayMs: 10_000,
  });
  outbox.claim({ workerId: "worker-b", now: retry.availableAt, leaseMs: 30_000, limit: 1 });
  const dead = outbox.retry({
    messageId: queued.id, workerId: "worker-b", now: "2026-09-05T09:00:05.000Z", error: "terminal failure",
    maxAttempts: 2, baseDelayMs: 1_000, maxDelayMs: 10_000,
  });

  assert.equal(dead.status, "DEAD_LETTER");
  assert.equal(dead.attempts, 2);
  assert.equal(dead.deadLetteredAt, "2026-09-05T09:00:05.000Z");
  assert.equal(dead.lastError, "terminal failure");
  assert.equal(dead.leaseOwner, undefined);
  assert.deepEqual(outbox.claim({
    workerId: "worker-c", now: "2026-09-06T09:00:00.000Z", leaseMs: 30_000, limit: 1,
  }), []);
});

test("expired leases are recovered deterministically and can be claimed by another worker", () => {
  const outbox = new InMemoryTransactionalOutbox();
  const queued = outbox.enqueueFromCommittedEvent(committedEvent, { topic: "delivery", key: "primary" });
  outbox.claim({ workerId: "crashed-worker", now: "2026-09-05T09:00:02.000Z", leaseMs: 5_000, limit: 1 });

  assert.equal(outbox.recoverExpiredLeases("2026-09-05T09:00:06.999Z"), 0);
  assert.throws(() => outbox.acknowledge({
    messageId: queued.id, workerId: "crashed-worker", now: "2026-09-05T09:00:07.000Z",
  }), /expired/);
  assert.equal(outbox.recoverExpiredLeases("2026-09-05T09:00:07.000Z"), 1);
  const recovered = outbox.list()[0]!;
  assert.equal(recovered.status, "PENDING");
  assert.equal(recovered.availableAt, "2026-09-05T09:00:07.000Z");
  assert.equal(recovered.leaseOwner, undefined);
  assert.throws(() => outbox.acknowledge({
    messageId: queued.id, workerId: "crashed-worker", now: "2026-09-05T09:00:07.000Z",
  }), /lease owner/);

  const reclaimed = outbox.claim({
    workerId: "recovery-worker", now: "2026-09-05T09:00:07.000Z", leaseMs: 5_000, limit: 1,
  });
  assert.equal(reclaimed[0]!.attempts, 2);
  assert.equal(reclaimed[0]!.leaseOwner, "recovery-worker");
});

test("event-log replay after acknowledgement preserves one delivered publication without redelivery", () => {
  const outbox: TransactionalOutboxStore = new InMemoryTransactionalOutbox();
  const queued = outbox.enqueueFromCommittedEvent(committedEvent, { topic: "delivery", key: "primary" });
  outbox.claim({ workerId: "worker-a", now: "2026-09-05T09:00:02.000Z", leaseMs: 30_000, limit: 1 });
  const delivered = outbox.acknowledge({
    messageId: queued.id, workerId: "worker-a", now: "2026-09-05T09:00:03.000Z",
  });

  const replay = outbox.enqueueFromCommittedEvent({
    ...committedEvent,
    payload: { certificationHash: "tampered-replay-must-not-replace-original" },
  }, { topic: "delivery", key: "primary" });
  assert.deepEqual(replay, delivered);
  assert.deepEqual(replay.payload, committedEvent.payload);
  assert.equal(outbox.list().length, 1);
  assert.deepEqual(outbox.claim({
    workerId: "worker-b", now: "2026-09-06T09:00:00.000Z", leaseMs: 30_000, limit: 10,
  }), []);

  const separatePublication = outbox.enqueueFromCommittedEvent(committedEvent, {
    topic: "delivery", key: "secondary-audit-sink",
  });
  assert.notEqual(separatePublication.dedupeKey, delivered.dedupeKey);
  assert.equal(outbox.list().length, 2);
});
