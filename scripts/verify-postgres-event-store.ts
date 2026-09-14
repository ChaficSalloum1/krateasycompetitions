import assert from "node:assert/strict";
import { Pool } from "pg";
import {
  OptimisticConcurrencyError,
  createPostgresEventStore,
  type JsonValue,
} from "../packages/competition-engine/src/index.js";

const host = process.env.TOURNAMENTOS_POSTGRES_HOST;
const port = Number(process.env.TOURNAMENTOS_POSTGRES_PORT ?? "5432");
if (!host || !Number.isInteger(port)) throw new Error("Temporary PostgreSQL host and port are required");

const pool = new Pool({ host, port, database: "postgres", user: process.env.USER, max: 6 });
const alpha = createPostgresEventStore({ tenantId: "tenant-alpha", pool });
const beta = createPostgresEventStore({ tenantId: "tenant-beta", pool });

try {
  await alpha.migrate();
  const first = await alpha.append({ streamId: "event-01", expectedVersion: 0, commandId: "create-01",
    recordedAt: "2026-09-05T09:00:00.000Z", events: [{ type: "EVENT_CREATED", payload: { name: "Autumn Open" } }] });
  assert.equal(first.status, "APPENDED");
  assert.equal(first.currentVersion, 1);

  const replay = await alpha.append({ streamId: "event-01", expectedVersion: 0, commandId: "create-01",
    recordedAt: "2026-09-05T09:00:00.000Z", events: [{ type: "EVENT_CREATED", payload: { name: "Autumn Open" } }] });
  assert.equal(replay.status, "IDEMPOTENT_REPLAY");
  assert.deepEqual(replay.events, first.events);

  await assert.rejects(alpha.append({ streamId: "event-01", expectedVersion: 0, commandId: "stale-01",
    recordedAt: "2026-09-05T09:01:00.000Z", events: [{ type: "SHOULD_NOT_COMMIT", payload: {} }] }), OptimisticConcurrencyError);

  const state = await alpha.replay<JsonValue>("event-01", {}, (current, event) => ({ ...(current as Record<string, JsonValue>), [event.type]: event.payload }));
  assert.deepEqual(state, { EVENT_CREATED: { name: "Autumn Open" } });
  const snapshot = await alpha.saveSnapshot({ streamId: "event-01", streamVersion: 1, state });
  assert.deepEqual(await alpha.loadSnapshot("event-01"), snapshot);

  assert.deepEqual(await beta.readStream("event-01"), []);
  await beta.append({ streamId: "event-01", expectedVersion: 0, commandId: "create-beta",
    recordedAt: "2026-09-05T09:02:00.000Z", events: [{ type: "EVENT_CREATED", payload: { name: "Other tenant" } }] });
  assert.equal((await alpha.readStream("event-01")).length, 1);
  assert.equal((await beta.readStream("event-01")).length, 1);

  await assert.rejects(alpha.appendTransaction([
    { streamId: "event-01", expectedVersion: 1, commandId: "atomic-01", recordedAt: "2026-09-05T09:03:00.000Z",
      events: [{ type: "FIRST_IN_TRANSACTION", payload: {} }] },
    { streamId: "event-01", expectedVersion: 1, commandId: "atomic-02", recordedAt: "2026-09-05T09:04:00.000Z",
      events: [{ type: "SECOND_IN_TRANSACTION", payload: {} }] },
  ]), OptimisticConcurrencyError);
  assert.equal((await alpha.readStream("event-01")).length, 1);

  await alpha.append({ streamId: "publication-01", expectedVersion: 0, commandId: "publish-01",
    recordedAt: "2026-09-05T09:05:00.000Z", events: [{ type: "TOURNAMENT_STATUS_CHANGED",
      payload: { tournamentId: "tournament-01", status: "PUBLISHED" },
      metadata: { outbox: { topic: "competition.publication.v1", key: "tournament-01",
        payload: { tournamentId: "tournament-01", certificateHash: "a".repeat(64) } } } }] });
  assert.equal((await alpha.outbox.list()).length, 1);
  assert.equal((await beta.outbox.list()).length, 0);
  const claimed = await alpha.outbox.claim({ workerId: "publication-worker", now: "2026-09-05T09:05:01.000Z", leaseMs: 30_000, limit: 1 });
  assert.equal(claimed.length, 1);
  await alpha.outbox.acknowledge({ messageId: claimed[0]!.id, workerId: "publication-worker", now: "2026-09-05T09:05:02.000Z",
    deliveryReceipt: { providerId: "verification-provider", providerMessageId: "provider-message-01",
      providerIdempotencyKey: "outbox.v1.verification-key" } });
  const delivered = (await alpha.outbox.list())[0];
  assert.equal(delivered?.status, "DELIVERED");
  assert.equal(delivered?.tenantId, "tenant-alpha");
  assert.equal(delivered?.providerMessageId, "provider-message-01");

  console.log(JSON.stringify({ status: "VERIFIED", tenantIsolation: true, idempotency: true, optimisticConcurrency: true,
    atomicRollback: true, replay: true, snapshots: true, transactionalOutbox: true, providerReceipts: true }));
} finally {
  await alpha.close(); await beta.close(); await pool.end();
}
