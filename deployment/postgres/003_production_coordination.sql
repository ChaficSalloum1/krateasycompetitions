-- TournamentOS authoritative event store v1.3.0.
-- Forward-only: adds distributed rate-limit buckets and webhook replay claims.
-- All externally-derived keys are stored only as keyed hashes by the adapter.

BEGIN;

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

COMMIT;
