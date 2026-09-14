import assert from "node:assert/strict";
import test from "node:test";
import { createPostgresProductionCoordination } from "../src/postgres-production-coordination.js";

test("PostgreSQL coordination atomically consumes hashed tenant rate-limit buckets", async () => {
  const queries: { sql: string; values?: readonly unknown[] }[] = [];
  const client = {
    query: async (sql: string, values?: readonly unknown[]) => {
      queries.push({ sql, ...(values ? { values } : {}) });
      if (/RETURNING request_count/.test(sql)) return { rows: [{ request_count: 3, expires_at: "2026-09-12T12:01:00.000Z" }], rowCount: 1 };
      return { rows: [], rowCount: null };
    },
    release: () => undefined,
  };
  const pool = { connect: async () => client, end: async () => undefined };
  const coordination = createPostgresProductionCoordination({ tenantId: "org.secure",
    keyHashSecret: "0123456789abcdef0123456789abcdef", pool });

  assert.deepEqual(coordination.rateLimitStore.capabilities, { scope: "DISTRIBUTED", atomic: true, durable: true });
  const result = await coordination.rateLimitStore.consume({ key: "org.secure:user.owner", limit: 2, windowMs: 60_000,
    nowMs: Date.parse("2026-09-12T12:00:00.000Z") });
  assert.deepEqual(result, { allowed: false, retryAfterSeconds: 60 });
  const statement = queries.find(({ sql }) => /RETURNING request_count/.test(sql));
  assert.match(statement!.sql, /ON CONFLICT[\s\S]+DO UPDATE/);
  assert.equal(statement!.values?.[0], "org.secure");
  assert.match(String(statement!.values?.[1]), /^[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(queries), /user\.owner/);
  await coordination.close();
});

test("PostgreSQL webhook replay claims are atomic and fenced by their hashed claim expiry", async () => {
  const queries: { sql: string; values?: readonly unknown[] }[] = [];
  let claimCount = 0;
  const client = {
    query: async (sql: string, values?: readonly unknown[]) => {
      queries.push({ sql, ...(values ? { values } : {}) });
      if (/INSERT INTO tournament_webhook_replays/.test(sql)) {
        claimCount += 1; return { rows: claimCount === 1 ? [{ replay_key_hash: "x" }] : [], rowCount: claimCount === 1 ? 1 : 0 };
      }
      if (/UPDATE tournament_webhook_replays/.test(sql) || /DELETE FROM tournament_webhook_replays/.test(sql)) return { rows: [], rowCount: 1 };
      return { rows: [], rowCount: null };
    },
    release: () => undefined,
  };
  const pool = { connect: async () => client, end: async () => undefined };
  const coordination = createPostgresProductionCoordination({ tenantId: "org.secure",
    keyHashSecret: "0123456789abcdef0123456789abcdef", pool });
  const request = { key: "org.secure:provider.one:event.secret", nowMs: Date.parse("2026-09-12T12:00:00.000Z"),
    expiresAtMs: Date.parse("2026-09-13T12:00:00.000Z") };

  assert.deepEqual(coordination.webhookReplayStore.capabilities, { scope: "DISTRIBUTED", atomic: true, durable: true });
  assert.equal(await coordination.webhookReplayStore.claim(request), true);
  assert.equal(await coordination.webhookReplayStore.claim(request), false);
  await coordination.webhookReplayStore.complete({ key: request.key, expiresAtMs: request.expiresAtMs });
  await coordination.webhookReplayStore.release({ key: request.key, expiresAtMs: request.expiresAtMs });
  assert.match(queries.find(({ sql }) => /INSERT INTO tournament_webhook_replays/.test(sql))!.sql,
    /ON CONFLICT[\s\S]+WHERE tournament_webhook_replays\.expires_at <= EXCLUDED\.claimed_at/);
  assert.ok(queries.filter(({ sql }) => /(?:UPDATE|DELETE).*tournament_webhook_replays/.test(sql)).every(({ values }) => values?.[2] instanceof Date));
  assert.doesNotMatch(JSON.stringify(queries), /event\.secret|provider\.one/);
});

test("PostgreSQL coordination rejects weak key hashing and invalid tenants", () => {
  const pool = { connect: async () => { throw new Error("unused"); }, end: async () => undefined };
  assert.throws(() => createPostgresProductionCoordination({ tenantId: "bad tenant", keyHashSecret: "x".repeat(32), pool }), /tenantId/);
  assert.throws(() => createPostgresProductionCoordination({ tenantId: "org.secure", keyHashSecret: "short", pool }), /keyHashSecret/);
});
