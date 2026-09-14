import { canonicalHash, deepFreeze } from "@tournament-os/tournament-schema";
import { Pool, type PoolClient, type QueryResultRow } from "pg";
import {
  IdempotencyConflictError,
  OptimisticConcurrencyError,
  verifyEventChain,
  type AppendRequest,
  type AppendResult,
  type EventEnvelope,
  type EventStoreAdapter,
  type JsonValue,
  type Snapshot,
} from "./event-store.js";
import type {
  AsyncTransactionalOutboxStore,
  AcknowledgeOutboxOptions,
  ClaimOutboxOptions,
  LeaseMutationOptions,
  OutboxMessage,
  RetryOutboxOptions,
} from "./outbox.js";

export const POSTGRES_EVENT_STORE_SCHEMA_VERSION = "1.3.0";

export const POSTGRES_EVENT_STORE_MIGRATION = `
CREATE TABLE IF NOT EXISTS tournament_streams (
  tenant_id text NOT NULL,
  stream_id text NOT NULL,
  current_version integer NOT NULL DEFAULT 0 CHECK (current_version >= 0),
  head_hash char(64),
  PRIMARY KEY (tenant_id, stream_id)
);

CREATE TABLE IF NOT EXISTS tournament_commands (
  tenant_id text NOT NULL,
  stream_id text NOT NULL,
  command_id text NOT NULL,
  fingerprint char(64) NOT NULL,
  resulting_version integer NOT NULL CHECK (resulting_version > 0),
  PRIMARY KEY (tenant_id, stream_id, command_id),
  FOREIGN KEY (tenant_id, stream_id) REFERENCES tournament_streams(tenant_id, stream_id)
);

CREATE TABLE IF NOT EXISTS tournament_events (
  global_position bigserial PRIMARY KEY,
  tenant_id text NOT NULL,
  event_id text NOT NULL,
  stream_id text NOT NULL,
  stream_version integer NOT NULL CHECK (stream_version > 0),
  command_id text NOT NULL,
  recorded_at timestamptz NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  metadata jsonb NOT NULL,
  previous_hash char(64),
  event_hash char(64) NOT NULL,
  UNIQUE (tenant_id, event_id),
  UNIQUE (tenant_id, stream_id, stream_version),
  FOREIGN KEY (tenant_id, stream_id) REFERENCES tournament_streams(tenant_id, stream_id)
);

CREATE INDEX IF NOT EXISTS tournament_events_stream_command
  ON tournament_events(tenant_id, stream_id, command_id, stream_version);

CREATE TABLE IF NOT EXISTS tournament_snapshots (
  tenant_id text NOT NULL,
  stream_id text NOT NULL,
  stream_version integer NOT NULL CHECK (stream_version > 0),
  stream_hash char(64) NOT NULL,
  state jsonb NOT NULL,
  snapshot_hash char(64) NOT NULL,
  PRIMARY KEY (tenant_id, stream_id),
  FOREIGN KEY (tenant_id, stream_id) REFERENCES tournament_streams(tenant_id, stream_id)
);

CREATE TABLE IF NOT EXISTS tournament_outbox (
  tenant_id text NOT NULL,
  id text NOT NULL,
  dedupe_key char(64) NOT NULL,
  event_id text NOT NULL,
  stream_id text NOT NULL,
  stream_version integer NOT NULL CHECK (stream_version > 0),
  event_type text NOT NULL,
  topic text NOT NULL,
  publication_key text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('PENDING', 'LEASED', 'DELIVERED', 'DEAD_LETTER')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  created_at timestamptz NOT NULL,
  available_at timestamptz NOT NULL,
  lease_owner text,
  lease_expires_at timestamptz,
  delivered_at timestamptz,
  dead_lettered_at timestamptz,
  last_error text,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, dedupe_key),
  FOREIGN KEY (tenant_id, event_id) REFERENCES tournament_events(tenant_id, event_id)
);

CREATE INDEX IF NOT EXISTS tournament_outbox_claim
  ON tournament_outbox(tenant_id, status, available_at, created_at, id);

ALTER TABLE tournament_streams ENABLE ROW LEVEL SECURITY;
ALTER TABLE tournament_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE tournament_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE tournament_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE tournament_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE tournament_streams FORCE ROW LEVEL SECURITY;
ALTER TABLE tournament_commands FORCE ROW LEVEL SECURITY;
ALTER TABLE tournament_events FORCE ROW LEVEL SECURITY;
ALTER TABLE tournament_snapshots FORCE ROW LEVEL SECURITY;
ALTER TABLE tournament_outbox FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tournament_streams_tenant ON tournament_streams;
CREATE POLICY tournament_streams_tenant ON tournament_streams
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
DROP POLICY IF EXISTS tournament_commands_tenant ON tournament_commands;
CREATE POLICY tournament_commands_tenant ON tournament_commands
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
DROP POLICY IF EXISTS tournament_events_tenant ON tournament_events;
CREATE POLICY tournament_events_tenant ON tournament_events
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
DROP POLICY IF EXISTS tournament_snapshots_tenant ON tournament_snapshots;
CREATE POLICY tournament_snapshots_tenant ON tournament_snapshots
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
DROP POLICY IF EXISTS tournament_outbox_tenant ON tournament_outbox;
CREATE POLICY tournament_outbox_tenant ON tournament_outbox
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
`;

export interface PostgresForwardMigration {
  readonly id: string;
  readonly sql: string;
}

/** Ordered, append-only migrations applied after the immutable v1.1 baseline. */
export const POSTGRES_EVENT_STORE_FORWARD_MIGRATIONS: readonly PostgresForwardMigration[] = deepFreeze([{
  id: "002_outbox_delivery_receipts",
  sql: `
CREATE TABLE IF NOT EXISTS tournament_schema_migrations (
  migration_id text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE tournament_outbox ADD COLUMN IF NOT EXISTS provider_id text;
ALTER TABLE tournament_outbox ADD COLUMN IF NOT EXISTS provider_message_id text;
ALTER TABLE tournament_outbox ADD COLUMN IF NOT EXISTS provider_idempotency_key text;

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tournament_outbox_delivery_receipt_complete'
  ) THEN
    ALTER TABLE tournament_outbox ADD CONSTRAINT tournament_outbox_delivery_receipt_complete CHECK (
      (provider_id IS NULL AND provider_message_id IS NULL AND provider_idempotency_key IS NULL)
      OR
      (provider_id IS NOT NULL AND provider_message_id IS NOT NULL AND provider_idempotency_key IS NOT NULL)
    ) NOT VALID;
  END IF;
END
$migration$;
ALTER TABLE tournament_outbox VALIDATE CONSTRAINT tournament_outbox_delivery_receipt_complete;

CREATE UNIQUE INDEX IF NOT EXISTS tournament_outbox_provider_idempotency
  ON tournament_outbox(tenant_id, provider_id, provider_idempotency_key)
  WHERE provider_idempotency_key IS NOT NULL;

INSERT INTO tournament_schema_migrations(migration_id)
VALUES ('002_outbox_delivery_receipts')
ON CONFLICT (migration_id) DO NOTHING;
`,
}, {
  id: "003_production_coordination",
  sql: `
CREATE TABLE IF NOT EXISTS tournament_rate_limits (
  tenant_id text NOT NULL,
  bucket_key_hash char(64) NOT NULL,
  window_started_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  request_count integer NOT NULL CHECK (request_count > 0),
  PRIMARY KEY (tenant_id, bucket_key_hash),
  CHECK (expires_at > window_started_at)
);

CREATE INDEX IF NOT EXISTS tournament_rate_limits_expiry
  ON tournament_rate_limits(tenant_id, expires_at);

CREATE TABLE IF NOT EXISTS tournament_webhook_replays (
  tenant_id text NOT NULL,
  replay_key_hash char(64) NOT NULL,
  status text NOT NULL CHECK (status IN ('PENDING', 'COMPLETED')),
  claimed_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  completed_at timestamptz,
  PRIMARY KEY (tenant_id, replay_key_hash),
  CHECK (expires_at > claimed_at),
  CHECK ((status = 'PENDING' AND completed_at IS NULL) OR (status = 'COMPLETED' AND completed_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS tournament_webhook_replays_expiry
  ON tournament_webhook_replays(tenant_id, expires_at);

ALTER TABLE tournament_rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE tournament_webhook_replays ENABLE ROW LEVEL SECURITY;
ALTER TABLE tournament_rate_limits FORCE ROW LEVEL SECURITY;
ALTER TABLE tournament_webhook_replays FORCE ROW LEVEL SECURITY;

DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = current_schema()
    AND tablename = 'tournament_rate_limits' AND policyname = 'tournament_rate_limits_tenant') THEN
    CREATE POLICY tournament_rate_limits_tenant ON tournament_rate_limits
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = current_schema()
    AND tablename = 'tournament_webhook_replays' AND policyname = 'tournament_webhook_replays_tenant') THEN
    CREATE POLICY tournament_webhook_replays_tenant ON tournament_webhook_replays
      USING (tenant_id = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
  END IF;
END
$migration$;

INSERT INTO tournament_schema_migrations(migration_id)
VALUES ('003_production_coordination')
ON CONFLICT (migration_id) DO NOTHING;
`,
}]);

interface Queryable {
  query<Row extends QueryResultRow = QueryResultRow>(text: string, values?: readonly unknown[]): Promise<{ rows: Row[]; rowCount: number | null }>;
}

interface PoolLike extends Queryable {
  connect(): Promise<PoolClient>;
  end(): Promise<void>;
}

export interface PostgresEventStoreOptions {
  readonly tenantId: string;
  readonly connectionString?: string;
  readonly pool?: PoolLike;
  readonly applicationName?: string;
}

export interface PostgresEventStore extends EventStoreAdapter {
  readonly capabilities: Readonly<{
    durability: "TRANSACTIONAL_POSTGRES";
    tenantIsolation: "FORCED_RLS";
    multiProcessAtomicity: true;
    schemaVersion: typeof POSTGRES_EVENT_STORE_SCHEMA_VERSION;
  }>;
  readonly outbox: AsyncTransactionalOutboxStore;
  migrate(): Promise<void>;
  close(): Promise<void>;
}

function validateIdentifier(value: string, name: string): void {
  if (!value.trim() || value.length > 200 || /[\u0000-\u001f]/.test(value)) throw new Error(`${name} must be a non-empty bounded identifier`);
}

function assertJson(value: unknown, path: string): void {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (Array.isArray(value)) { value.forEach((entry, index) => assertJson(entry, `${path}/${index}`)); return; }
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    for (const [key, entry] of Object.entries(value)) assertJson(entry, `${path}/${key}`);
    return;
  }
  throw new Error(`Non-JSON value at ${path}`);
}

function validateRequest(request: AppendRequest): void {
  validateIdentifier(request.streamId, "streamId"); validateIdentifier(request.commandId, "commandId");
  if (!Number.isInteger(request.expectedVersion) || request.expectedVersion < 0 || request.events.length === 0 ||
    !Number.isFinite(Date.parse(request.recordedAt)) || new Date(Date.parse(request.recordedAt)).toISOString() !== request.recordedAt) {
    throw new Error("Append request requires a non-negative version, canonical timestamp, and at least one event");
  }
  request.events.forEach((event, index) => {
    validateIdentifier(event.type, `events[${index}].type`); assertJson(event.payload, `/events/${index}/payload`); assertJson(event.metadata ?? {}, `/events/${index}/metadata`);
  });
}

function eventFromRow(row: {
  event_id: string; stream_id: string; stream_version: number; global_position: string | number; command_id: string;
  recorded_at: Date | string; event_type: string; payload: JsonValue; metadata: { readonly [key: string]: JsonValue };
  previous_hash: string | null; event_hash: string;
}): EventEnvelope {
  return deepFreeze({ eventId: row.event_id, streamId: row.stream_id, streamVersion: Number(row.stream_version),
    globalPosition: Number(row.global_position), commandId: row.command_id,
    recordedAt: row.recorded_at instanceof Date ? row.recorded_at.toISOString() : new Date(row.recorded_at).toISOString(),
    type: row.event_type, payload: row.payload, metadata: row.metadata, previousHash: row.previous_hash, eventHash: row.event_hash });
}

const EVENT_COLUMNS = `event_id, stream_id, stream_version, global_position, command_id, recorded_at,
  event_type, payload, metadata, previous_hash, event_hash`;

const OUTBOX_COLUMNS = `tenant_id, id, dedupe_key, event_id, stream_id, stream_version, event_type, topic, publication_key,
  payload, status, attempts, created_at, available_at, lease_owner, lease_expires_at, delivered_at, dead_lettered_at, last_error,
  provider_id, provider_message_id, provider_idempotency_key`;

interface OutboxRow {
  tenant_id: string; id: string; dedupe_key: string; event_id: string; stream_id: string; stream_version: number; event_type: string;
  topic: string; publication_key: string; payload: unknown; status: OutboxMessage["status"]; attempts: number;
  created_at: Date | string; available_at: Date | string; lease_owner: string | null; lease_expires_at: Date | string | null;
  delivered_at: Date | string | null; dead_lettered_at: Date | string | null; last_error: string | null;
  provider_id: string | null; provider_message_id: string | null; provider_idempotency_key: string | null;
}

function timestamp(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function outboxFromRow(row: OutboxRow): Readonly<OutboxMessage> {
  return deepFreeze({ tenantId: row.tenant_id, id: row.id, dedupeKey: row.dedupe_key, eventId: row.event_id, streamId: row.stream_id,
    streamVersion: Number(row.stream_version), eventType: row.event_type, topic: row.topic, publicationKey: row.publication_key,
    payload: row.payload, status: row.status, attempts: Number(row.attempts), createdAt: timestamp(row.created_at),
    availableAt: timestamp(row.available_at), ...(row.lease_owner ? { leaseOwner: row.lease_owner } : {}),
    ...(row.lease_expires_at ? { leaseExpiresAt: timestamp(row.lease_expires_at) } : {}),
    ...(row.delivered_at ? { deliveredAt: timestamp(row.delivered_at) } : {}),
    ...(row.dead_lettered_at ? { deadLetteredAt: timestamp(row.dead_lettered_at) } : {}),
    ...(row.last_error ? { lastError: row.last_error } : {}),
    ...(row.provider_id ? { providerId: row.provider_id } : {}),
    ...(row.provider_message_id ? { providerMessageId: row.provider_message_id } : {}),
    ...(row.provider_idempotency_key ? { providerIdempotencyKey: row.provider_idempotency_key } : {}) });
}

function validateDeliveryReceipt(receipt: AcknowledgeOutboxOptions["deliveryReceipt"]): void {
  if (!receipt) return;
  for (const [name, value] of Object.entries(receipt)) {
    if (!value.trim() || value.length > 500 || /[\u0000-\u001f]/.test(value)) throw new Error(`${name} must be a non-empty bounded identifier`);
  }
}

function outboxIntent(metadata: { readonly [key: string]: JsonValue }): { topic: string; key: string; payload: JsonValue } | undefined {
  const candidate = metadata.outbox;
  if (candidate === undefined) return undefined;
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) throw new Error("Outbox intent must be an object");
  const record = candidate as { readonly [key: string]: JsonValue };
  if (typeof record.topic !== "string" || !record.topic.trim() || typeof record.key !== "string" || !record.key.trim()) {
    throw new Error("Outbox intent requires a topic and publication key");
  }
  return { topic: record.topic, key: record.key, payload: record.payload ?? {} };
}

function validateClaim(options: ClaimOutboxOptions): number {
  const now = Date.parse(options.now);
  if (!options.workerId.trim() || !Number.isFinite(now) || !Number.isInteger(options.leaseMs) || options.leaseMs <= 0
    || !Number.isInteger(options.limit) || options.limit <= 0) throw new Error("Claim requires a worker, valid timestamp, positive lease, and positive limit");
  return now;
}

export function createPostgresEventStore(options: PostgresEventStoreOptions): PostgresEventStore {
  validateIdentifier(options.tenantId, "tenantId");
  if (!options.pool && !options.connectionString) throw new Error("PostgreSQL connectionString or injected pool is required");
  const ownsPool = !options.pool;
  const pool: PoolLike = options.pool ?? new Pool({ connectionString: options.connectionString,
    application_name: options.applicationName ?? "tournamentos-event-store", max: 10 });

  const transaction = async <T>(operation: (client: PoolClient) => Promise<T>): Promise<T> => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [options.tenantId]);
      const result = await operation(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch { /* preserve the original error */ }
      throw error;
    } finally { client.release(); }
  };

  const read = async <T>(operation: (client: PoolClient) => Promise<T>): Promise<T> => transaction(operation);

  const readCommandEvents = async (client: Queryable, streamId: string, commandId: string): Promise<readonly EventEnvelope[]> => {
    const result = await client.query(`${`SELECT ${EVENT_COLUMNS} FROM tournament_events
      WHERE tenant_id = $1 AND stream_id = $2 AND command_id = $3 ORDER BY stream_version ASC`}`, [options.tenantId, streamId, commandId]);
    return deepFreeze(result.rows.map((row) => eventFromRow(row as Parameters<typeof eventFromRow>[0])));
  };

  const appendCore = async (client: Queryable, request: AppendRequest): Promise<AppendResult> => {
    validateRequest(request);
    const fingerprint = canonicalHash(request);
    const prior = await client.query<{ fingerprint: string; resulting_version: number }>(
      "SELECT fingerprint, resulting_version FROM tournament_commands WHERE tenant_id = $1 AND stream_id = $2 AND command_id = $3",
      [options.tenantId, request.streamId, request.commandId]);
    if (prior.rows[0]) {
      if (prior.rows[0].fingerprint !== fingerprint) throw new IdempotencyConflictError(request.streamId, request.commandId);
      const events = await readCommandEvents(client, request.streamId, request.commandId);
      return deepFreeze({ status: "IDEMPOTENT_REPLAY", currentVersion: prior.rows[0].resulting_version, events });
    }
    await client.query(`INSERT INTO tournament_streams(tenant_id, stream_id, current_version)
      VALUES ($1, $2, 0) ON CONFLICT (tenant_id, stream_id) DO NOTHING`, [options.tenantId, request.streamId]);
    const locked = await client.query<{ current_version: number; head_hash: string | null }>(
      "SELECT current_version, head_hash FROM tournament_streams WHERE tenant_id = $1 AND stream_id = $2 FOR UPDATE",
      [options.tenantId, request.streamId]);
    const currentVersion = locked.rows[0]?.current_version ?? 0;
    if (currentVersion !== request.expectedVersion) throw new OptimisticConcurrencyError(request.streamId, request.expectedVersion, currentVersion);
    let previousHash = locked.rows[0]?.head_hash ?? null;
    const events: EventEnvelope[] = [];
    for (const proposed of request.events) {
      const positionResult = await client.query<{ global_position: string }>(
        "SELECT nextval(pg_get_serial_sequence('tournament_events', 'global_position'))::text AS global_position");
      const globalPosition = Number(positionResult.rows[0]!.global_position);
      const base = { streamId: request.streamId, streamVersion: currentVersion + events.length + 1, globalPosition,
        commandId: request.commandId, recordedAt: request.recordedAt, type: proposed.type,
        payload: structuredClone(proposed.payload), metadata: structuredClone(proposed.metadata ?? {}), previousHash };
      const eventId = `evt_${canonicalHash(base).slice(0, 24)}`;
      const event = deepFreeze({ ...base, eventId, eventHash: canonicalHash({ ...base, eventId }) });
      await client.query(`INSERT INTO tournament_events(global_position, tenant_id, event_id, stream_id, stream_version, command_id,
        recorded_at, event_type, payload, metadata, previous_hash, event_hash)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11,$12)`,
      [event.globalPosition, options.tenantId, event.eventId, event.streamId, event.streamVersion, event.commandId, event.recordedAt,
        event.type, JSON.stringify(event.payload), JSON.stringify(event.metadata), event.previousHash, event.eventHash]);
      const publication = outboxIntent(event.metadata);
      if (publication) {
        const dedupeKey = canonicalHash({ eventId: event.eventId, topic: publication.topic, publicationKey: publication.key });
        await client.query(`INSERT INTO tournament_outbox(tenant_id, id, dedupe_key, event_id, stream_id, stream_version,
          event_type, topic, publication_key, payload, status, attempts, created_at, available_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,'PENDING',0,$11,$11)
          ON CONFLICT (tenant_id, dedupe_key) DO NOTHING`,
        [options.tenantId, `outbox.${dedupeKey}`, dedupeKey, event.eventId, event.streamId, event.streamVersion,
          event.type, publication.topic, publication.key, JSON.stringify(publication.payload), event.recordedAt]);
      }
      events.push(event); previousHash = event.eventHash;
    }
    const resultingVersion = currentVersion + events.length;
    await client.query("UPDATE tournament_streams SET current_version = $3, head_hash = $4 WHERE tenant_id = $1 AND stream_id = $2",
      [options.tenantId, request.streamId, resultingVersion, previousHash]);
    await client.query(`INSERT INTO tournament_commands(tenant_id, stream_id, command_id, fingerprint, resulting_version)
      VALUES ($1,$2,$3,$4,$5)`, [options.tenantId, request.streamId, request.commandId, fingerprint, resultingVersion]);
    return deepFreeze({ status: "APPENDED", currentVersion: resultingVersion, events });
  };

  const outbox: AsyncTransactionalOutboxStore = {
    claim: async (claimOptions) => {
      const now = validateClaim(claimOptions);
      const leaseExpiresAt = new Date(now + claimOptions.leaseMs).toISOString();
      return transaction(async (client) => {
        const result = await client.query<OutboxRow>(`WITH candidates AS (
          SELECT id FROM tournament_outbox
          WHERE tenant_id = $1 AND status = 'PENDING' AND available_at <= $2
          ORDER BY available_at ASC, created_at ASC, id ASC
          FOR UPDATE SKIP LOCKED LIMIT $3
        )
        UPDATE tournament_outbox AS message SET status = 'LEASED', attempts = message.attempts + 1,
          lease_owner = $4, lease_expires_at = $5
        FROM candidates WHERE message.tenant_id = $1 AND message.id = candidates.id
        RETURNING message.*`,
        [options.tenantId, claimOptions.now, claimOptions.limit, claimOptions.workerId, leaseExpiresAt]);
        return deepFreeze(result.rows.map(outboxFromRow)
          .sort((left, right) => left.availableAt.localeCompare(right.availableAt) || left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)));
      });
    },
    acknowledge: async (mutation) => {
      const now = Date.parse(mutation.now);
      if (!mutation.workerId.trim() || !Number.isFinite(now)) throw new Error("Lease mutation requires a worker and valid timestamp");
      validateDeliveryReceipt(mutation.deliveryReceipt);
      return transaction(async (client) => {
        const result = await client.query<OutboxRow>(`UPDATE tournament_outbox SET status = 'DELIVERED', delivered_at = $4,
          lease_owner = NULL, lease_expires_at = NULL, provider_id = $5, provider_message_id = $6, provider_idempotency_key = $7
          WHERE tenant_id = $1 AND id = $2 AND status = 'LEASED' AND lease_owner = $3 AND lease_expires_at > $4
          RETURNING ${OUTBOX_COLUMNS}`,
        [options.tenantId, mutation.messageId, mutation.workerId, mutation.now, mutation.deliveryReceipt?.providerId ?? null,
          mutation.deliveryReceipt?.providerMessageId ?? null, mutation.deliveryReceipt?.providerIdempotencyKey ?? null]);
        if (!result.rows[0]) throw new Error("Only the current unexpired lease owner may acknowledge delivery");
        return outboxFromRow(result.rows[0]);
      });
    },
    retry: async (retryOptions) => {
      const now = Date.parse(retryOptions.now);
      if (!retryOptions.workerId.trim() || !Number.isFinite(now) || !retryOptions.error.trim()
        || !Number.isInteger(retryOptions.maxAttempts) || retryOptions.maxAttempts <= 0
        || !Number.isInteger(retryOptions.baseDelayMs) || retryOptions.baseDelayMs <= 0
        || !Number.isInteger(retryOptions.maxDelayMs) || retryOptions.maxDelayMs < retryOptions.baseDelayMs) {
        throw new Error("Retry requires a current lease, error, and valid positive retry policy");
      }
      return transaction(async (client) => {
        const leased = await client.query<OutboxRow>(`SELECT ${OUTBOX_COLUMNS} FROM tournament_outbox
          WHERE tenant_id = $1 AND id = $2 AND status = 'LEASED' AND lease_owner = $3 AND lease_expires_at > $4 FOR UPDATE`,
        [options.tenantId, retryOptions.messageId, retryOptions.workerId, retryOptions.now]);
        const message = leased.rows[0];
        if (!message) throw new Error("Only the current unexpired lease owner may retry delivery");
        const dead = Number(message.attempts) >= retryOptions.maxAttempts;
        const delay = Math.min(retryOptions.maxDelayMs, retryOptions.baseDelayMs * (2 ** Math.max(0, Number(message.attempts) - 1)));
        const result = await client.query<OutboxRow>(`UPDATE tournament_outbox SET status = $3,
          available_at = $4, dead_lettered_at = $5, last_error = $6, lease_owner = NULL, lease_expires_at = NULL
          WHERE tenant_id = $1 AND id = $2 RETURNING ${OUTBOX_COLUMNS}`,
        [options.tenantId, retryOptions.messageId, dead ? "DEAD_LETTER" : "PENDING",
          dead ? timestamp(message.available_at) : new Date(now + delay).toISOString(), dead ? retryOptions.now : null, retryOptions.error]);
        return outboxFromRow(result.rows[0]!);
      });
    },
    recoverExpiredLeases: async (nowValue) => {
      if (!Number.isFinite(Date.parse(nowValue))) throw new Error("Lease recovery requires a valid timestamp");
      return transaction(async (client) => {
        const result = await client.query(`UPDATE tournament_outbox SET status = 'PENDING', available_at = $2,
          lease_owner = NULL, lease_expires_at = NULL
          WHERE tenant_id = $1 AND status = 'LEASED' AND lease_expires_at <= $2`, [options.tenantId, nowValue]);
        return result.rowCount ?? 0;
      });
    },
    list: async () => read(async (client) => {
      const result = await client.query<OutboxRow>(`SELECT ${OUTBOX_COLUMNS} FROM tournament_outbox
        WHERE tenant_id = $1 ORDER BY created_at ASC, id ASC`, [options.tenantId]);
      return deepFreeze(result.rows.map(outboxFromRow));
    }),
  };

  return {
    capabilities: deepFreeze({ durability: "TRANSACTIONAL_POSTGRES", tenantIsolation: "FORCED_RLS",
      multiProcessAtomicity: true, schemaVersion: POSTGRES_EVENT_STORE_SCHEMA_VERSION }),
    outbox,
    migrate: async () => {
      await pool.query(POSTGRES_EVENT_STORE_MIGRATION);
      for (const migration of POSTGRES_EVENT_STORE_FORWARD_MIGRATIONS) await pool.query(migration.sql);
    },
    close: async () => { if (ownsPool) await pool.end(); },
    append: (request) => transaction((client) => appendCore(client, request)),
    appendTransaction: (requests) => transaction(async (client) => {
      const results: AppendResult[] = [];
      for (const request of requests) results.push(await appendCore(client, request));
      return deepFreeze(results);
    }),
    readStream: (streamId, fromVersion = 1) => read(async (client) => {
      validateIdentifier(streamId, "streamId");
      if (!Number.isInteger(fromVersion) || fromVersion < 1) throw new Error("fromVersion must be a positive integer");
      const result = await client.query(`SELECT ${EVENT_COLUMNS} FROM tournament_events
        WHERE tenant_id = $1 AND stream_id = $2 AND stream_version >= $3 ORDER BY stream_version ASC`,
      [options.tenantId, streamId, fromVersion]);
      return deepFreeze(result.rows.map((row) => eventFromRow(row as Parameters<typeof eventFromRow>[0])));
    }),
    replay: async <T>(streamId: string, initialState: T, reducer: (state: T, event: Readonly<EventEnvelope>) => T): Promise<T> => {
      const events = await read(async (client) => {
        const result = await client.query(`SELECT ${EVENT_COLUMNS} FROM tournament_events
          WHERE tenant_id = $1 AND stream_id = $2 ORDER BY stream_version ASC`, [options.tenantId, streamId]);
        return result.rows.map((row) => eventFromRow(row as Parameters<typeof eventFromRow>[0]));
      });
      if (!verifyEventChain(events).valid) throw new Error(`Cannot replay invalid event chain ${streamId}`);
      return events.reduce(reducer, initialState);
    },
    saveSnapshot: async <T extends JsonValue>(snapshot: Omit<Snapshot<T>, "streamHash" | "snapshotHash">): Promise<Snapshot<T>> => {
      validateIdentifier(snapshot.streamId, "streamId"); assertJson(snapshot.state, "/snapshot/state");
      return transaction(async (client) => {
        const event = await client.query<{ event_hash: string }>(`SELECT event_hash FROM tournament_events
          WHERE tenant_id = $1 AND stream_id = $2 AND stream_version = $3`, [options.tenantId, snapshot.streamId, snapshot.streamVersion]);
        if (!event.rows[0]) throw new Error("Snapshot version must reference an existing stream event");
        const base = { ...structuredClone(snapshot), streamHash: event.rows[0].event_hash };
        const saved = deepFreeze({ ...base, snapshotHash: canonicalHash(base) });
        await client.query(`INSERT INTO tournament_snapshots(tenant_id, stream_id, stream_version, stream_hash, state, snapshot_hash)
          VALUES ($1,$2,$3,$4,$5::jsonb,$6)
          ON CONFLICT (tenant_id, stream_id) DO UPDATE SET stream_version = EXCLUDED.stream_version,
          stream_hash = EXCLUDED.stream_hash, state = EXCLUDED.state, snapshot_hash = EXCLUDED.snapshot_hash`,
        [options.tenantId, saved.streamId, saved.streamVersion, saved.streamHash, JSON.stringify(saved.state), saved.snapshotHash]);
        return saved;
      });
    },
    loadSnapshot: async <T extends JsonValue>(streamId: string): Promise<Snapshot<T> | undefined> => read(async (client) => {
      validateIdentifier(streamId, "streamId");
      const result = await client.query<{ stream_id: string; stream_version: number; stream_hash: string; state: T; snapshot_hash: string }>(
        "SELECT stream_id, stream_version, stream_hash, state, snapshot_hash FROM tournament_snapshots WHERE tenant_id = $1 AND stream_id = $2",
        [options.tenantId, streamId]);
      const row = result.rows[0];
      if (!row) return undefined;
      const snapshot = deepFreeze({ streamId: row.stream_id, streamVersion: row.stream_version, streamHash: row.stream_hash,
        state: row.state, snapshotHash: row.snapshot_hash });
      const { snapshotHash, ...base } = snapshot;
      if (canonicalHash(base) !== snapshotHash) throw new Error(`Snapshot hash mismatch for ${streamId}`);
      return snapshot;
    }),
  };
}
