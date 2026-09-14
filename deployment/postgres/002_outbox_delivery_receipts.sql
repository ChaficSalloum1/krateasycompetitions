-- TournamentOS authoritative event store v1.2.0.
-- Forward-only: records replay-safe provider delivery receipts without rewriting 001.

BEGIN;

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

COMMIT;
