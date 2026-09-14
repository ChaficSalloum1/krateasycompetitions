-- TournamentOS authoritative event store v1.1.0.
-- The application sets app.tenant_id locally in every transaction. FORCE RLS
-- prevents the table owner from accidentally bypassing tenant isolation.

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
