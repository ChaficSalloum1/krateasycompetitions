import { createHmac } from "node:crypto";
import { Pool } from "pg";
import type { RateLimitStore, WebhookReplayStore } from "./production-pilot-api.js";

interface QueryResult<Row extends Record<string, unknown> = Record<string, unknown>> {
  readonly rows: readonly Row[];
  readonly rowCount: number | null;
}

interface CoordinationClient {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(sql: string, values?: readonly unknown[]): Promise<QueryResult<Row>>;
  release(): void;
}

export interface CoordinationPool {
  connect(): Promise<CoordinationClient>;
  end(): Promise<void>;
}

export interface PostgresProductionCoordinationOptions {
  readonly tenantId: string;
  /** Dedicated HMAC secret resolved from managed key storage; never persist it in PostgreSQL. */
  readonly keyHashSecret: string;
  readonly connectionString?: string;
  readonly applicationName?: string;
  readonly pool?: CoordinationPool;
}

export interface PostgresProductionCoordination {
  readonly rateLimitStore: RateLimitStore;
  readonly webhookReplayStore: WebhookReplayStore;
  close(): Promise<void>;
}

const tenantPattern = /^[a-z0-9][a-z0-9._-]{1,99}$/;
const distributedCapabilities = Object.freeze({ scope: "DISTRIBUTED", atomic: true, durable: true } as const);

function assertSafeTime(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0 || !Number.isFinite(new Date(value).getTime())) throw new Error(`${name} is invalid`);
}

/**
 * Distributed coordination for a single tenant. RLS is set locally inside every
 * transaction; externally-derived bucket/replay keys are converted to a
 * tenant-bound keyed digest before they cross the PostgreSQL boundary.
 */
export function createPostgresProductionCoordination(options: PostgresProductionCoordinationOptions): PostgresProductionCoordination {
  if (!tenantPattern.test(options.tenantId)) throw new Error("tenantId is invalid");
  if (Buffer.byteLength(options.keyHashSecret, "utf8") < 32) throw new Error("keyHashSecret must contain at least 32 bytes");
  const ownsPool = !options.pool;
  const pool: CoordinationPool = options.pool ?? new Pool({ connectionString: options.connectionString,
    application_name: options.applicationName ?? "tournament-os-coordination", max: 10 }) as unknown as CoordinationPool;
  const hashKey = (namespace: string, key: string): string => {
    if (!key || Buffer.byteLength(key, "utf8") > 1_024 || /[\u0000-\u001f]/.test(key)) throw new Error("coordination key is invalid");
    return createHmac("sha256", options.keyHashSecret).update(`${namespace}\0${options.tenantId}\0${key}`).digest("hex");
  };
  const transaction = async <T>(operation: (client: CoordinationClient) => Promise<T>): Promise<T> => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [options.tenantId]);
      const result = await operation(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch { /* preserve the authoritative operation error */ }
      throw error;
    } finally { client.release(); }
  };

  const rateLimitStore: RateLimitStore = {
    capabilities: distributedCapabilities,
    consume: async ({ key, limit, windowMs, nowMs }) => {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000_000) throw new Error("rate limit is invalid");
      if (!Number.isSafeInteger(windowMs) || windowMs < 1_000 || windowMs > 86_400_000) throw new Error("rate window is invalid");
      assertSafeTime(nowMs, "rate-limit time");
      const now = new Date(nowMs);
      const expiresAt = new Date(nowMs + windowMs);
      const result = await transaction((client) => client.query<{ request_count: number; expires_at: Date | string }>(`
INSERT INTO tournament_rate_limits(tenant_id, bucket_key_hash, window_started_at, expires_at, request_count)
VALUES ($1, $2, $3, $4, 1)
ON CONFLICT (tenant_id, bucket_key_hash) DO UPDATE SET
  window_started_at = CASE WHEN tournament_rate_limits.expires_at <= EXCLUDED.window_started_at THEN EXCLUDED.window_started_at ELSE tournament_rate_limits.window_started_at END,
  expires_at = CASE WHEN tournament_rate_limits.expires_at <= EXCLUDED.window_started_at THEN EXCLUDED.expires_at ELSE tournament_rate_limits.expires_at END,
  request_count = CASE WHEN tournament_rate_limits.expires_at <= EXCLUDED.window_started_at THEN 1 ELSE tournament_rate_limits.request_count + 1 END
RETURNING request_count, expires_at`, [options.tenantId, hashKey("rate-limit:v1", key), now, expiresAt]));
      const row = result.rows[0];
      if (!row) throw new Error("PostgreSQL did not return the rate-limit bucket");
      const storedExpiry = row.expires_at instanceof Date ? row.expires_at.getTime() : Date.parse(row.expires_at);
      if (!Number.isFinite(storedExpiry)) throw new Error("PostgreSQL returned an invalid rate-limit expiry");
      return { allowed: Number(row.request_count) <= limit, retryAfterSeconds: Math.max(1, Math.ceil((storedExpiry - nowMs) / 1000)) };
    },
  };

  const webhookReplayStore: WebhookReplayStore = {
    capabilities: distributedCapabilities,
    claim: async ({ key, nowMs, expiresAtMs }) => {
      assertSafeTime(nowMs, "webhook claim time"); assertSafeTime(expiresAtMs, "webhook claim expiry");
      if (expiresAtMs <= nowMs) throw new Error("webhook claim expiry must follow claim time");
      const result = await transaction((client) => client.query<{ replay_key_hash: string }>(`
INSERT INTO tournament_webhook_replays(tenant_id, replay_key_hash, status, claimed_at, expires_at, completed_at)
VALUES ($1, $2, 'PENDING', $3, $4, NULL)
ON CONFLICT (tenant_id, replay_key_hash) DO UPDATE SET
  status = 'PENDING', claimed_at = EXCLUDED.claimed_at, expires_at = EXCLUDED.expires_at, completed_at = NULL
WHERE tournament_webhook_replays.expires_at <= EXCLUDED.claimed_at
RETURNING replay_key_hash`, [options.tenantId, hashKey("webhook-replay:v1", key), new Date(nowMs), new Date(expiresAtMs)]));
      return result.rowCount === 1 && result.rows.length === 1;
    },
    complete: async ({ key, expiresAtMs }) => {
      assertSafeTime(expiresAtMs, "webhook claim expiry");
      const result = await transaction((client) => client.query(`
UPDATE tournament_webhook_replays SET status = 'COMPLETED', completed_at = clock_timestamp()
WHERE tenant_id = $1 AND replay_key_hash = $2 AND status = 'PENDING' AND expires_at = $3`,
      [options.tenantId, hashKey("webhook-replay:v1", key), new Date(expiresAtMs)]));
      if (result.rowCount !== 1) throw new Error("Webhook replay claim was lost before completion");
    },
    release: async ({ key, expiresAtMs }) => {
      assertSafeTime(expiresAtMs, "webhook claim expiry");
      await transaction((client) => client.query(`
DELETE FROM tournament_webhook_replays
WHERE tenant_id = $1 AND replay_key_hash = $2 AND status = 'PENDING' AND expires_at = $3`,
      [options.tenantId, hashKey("webhook-replay:v1", key), new Date(expiresAtMs)]));
    },
  };

  return { rateLimitStore, webhookReplayStore, close: async () => { if (ownsPool) await pool.end(); } };
}
