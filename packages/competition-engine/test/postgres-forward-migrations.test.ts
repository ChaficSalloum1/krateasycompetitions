import assert from "node:assert/strict";
import test from "node:test";
import {
  POSTGRES_EVENT_STORE_FORWARD_MIGRATIONS,
  POSTGRES_EVENT_STORE_SCHEMA_VERSION,
  createPostgresEventStore,
} from "../src/index.js";

test("PostgreSQL migration applies the immutable baseline then ordered additive production migrations", async () => {
  const queries: string[] = [];
  const pool = {
    query: async (sql: string) => { queries.push(sql); return { rows: [], rowCount: 0 }; },
    connect: async () => { throw new Error("migrate must not need a leased client"); },
    end: async () => undefined,
  };
  const store = createPostgresEventStore({ tenantId: "org-01", pool });

  await store.migrate();

  assert.equal(POSTGRES_EVENT_STORE_SCHEMA_VERSION, "1.3.0");
  assert.deepEqual(POSTGRES_EVENT_STORE_FORWARD_MIGRATIONS.map(({ id }) => id), ["002_outbox_delivery_receipts", "003_production_coordination"]);
  assert.equal(queries.length, 3);
  assert.match(queries[0]!, /CREATE TABLE IF NOT EXISTS tournament_streams/);
  assert.match(queries[1]!, /ADD COLUMN IF NOT EXISTS provider_id/);
  assert.match(queries[1]!, /tournament_schema_migrations/);
  assert.doesNotMatch(queries[1]!, /\b(?:DROP|TRUNCATE|DELETE)\b/i);
  assert.match(queries[2]!, /CREATE TABLE IF NOT EXISTS tournament_rate_limits/);
  assert.match(queries[2]!, /CREATE TABLE IF NOT EXISTS tournament_webhook_replays/);
  assert.match(queries[2]!, /FORCE ROW LEVEL SECURITY/);
  assert.match(queries[2]!, /003_production_coordination/);
  assert.doesNotMatch(queries[2]!, /principal_id|replay_key text/i);
  assert.doesNotMatch(queries[2]!, /\b(?:DROP TABLE|TRUNCATE|DELETE)\b/i);
});
