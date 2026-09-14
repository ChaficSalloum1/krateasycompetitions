import assert from "node:assert/strict";
import { Pool } from "pg";
import { createPostgresEventStore } from "@tournament-os/competition-engine";
import { createPostgresProductionCoordination } from "../apps/compiler-web/src/postgres-production-coordination.js";

const connectionString = process.env.DATABASE_URL;
const keyHashSecret = process.env.COORDINATION_KEY_HASH_SECRET;
if (!connectionString) throw new Error("DATABASE_URL is required");
if (!keyHashSecret) throw new Error("COORDINATION_KEY_HASH_SECRET is required");

const tenantId = `verification-${process.pid}`;
const migrationStore = createPostgresEventStore({ tenantId, connectionString, applicationName: "coordination-verification-migrate" });
await migrationStore.migrate();
await migrationStore.close();

const coordination = createPostgresProductionCoordination({ tenantId, connectionString, keyHashSecret,
  applicationName: "coordination-verification" });
const nowMs = Date.now();
const rateKey = "principal:user.must-never-be-stored";
const decisions = await Promise.all(Array.from({ length: 24 }, () => coordination.rateLimitStore.consume({
  key: rateKey, limit: 7, windowMs: 60_000, nowMs,
})));
assert.equal(decisions.filter(({ allowed }) => allowed).length, 7);

const replayKey = "provider:event.must-never-be-stored";
const expiresAtMs = nowMs + 86_400_000;
const claims = await Promise.all(Array.from({ length: 24 }, () => coordination.webhookReplayStore.claim({ key: replayKey, nowMs, expiresAtMs })));
assert.equal(claims.filter(Boolean).length, 1);
await coordination.webhookReplayStore.complete({ key: replayKey, expiresAtMs });
assert.equal(await coordination.webhookReplayStore.claim({ key: replayKey, nowMs: nowMs + 1, expiresAtMs: expiresAtMs + 1 }), false);

const inspection = new Pool({ connectionString, application_name: "coordination-verification-inspect" });
const client = await inspection.connect();
try {
  await client.query("BEGIN");
  await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
  const rows = await client.query<{ bucket_key_hash: string; replay_key_hash: string | null }>(`
SELECT bucket_key_hash::text, NULL::text AS replay_key_hash FROM tournament_rate_limits
UNION ALL
SELECT NULL::text AS bucket_key_hash, replay_key_hash::text FROM tournament_webhook_replays`);
  assert.equal(rows.rows.length, 2);
  const stored = JSON.stringify(rows.rows);
  assert.doesNotMatch(stored, /user\.must-never-be-stored|event\.must-never-be-stored/);
  assert.match(stored, /[a-f0-9]{64}/);
  await client.query("ROLLBACK");
} finally { client.release(); await inspection.end(); await coordination.close(); }

process.stdout.write(`${JSON.stringify({ status: "VERIFIED", concurrentRateLimitAllowed: 7, concurrentWebhookClaims: 1,
  tenantScoped: true, rawCoordinationKeysStored: false })}\n`);
