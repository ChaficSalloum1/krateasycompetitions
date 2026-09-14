# Deployment boundary

The reference container is deliberately fail-closed. Its production entry point
will not start without an explicit tenant and a deployment adapter module. That
adapter must supply verified identity, durable PostgreSQL persistence, distributed
rate-limit and webhook-replay stores, signed-webhook secret resolution, webhook
delivery, and fresh readiness evidence. No development identity or in-memory
fallback is available in production.

Build locally with:

```sh
docker build -f deployment/Dockerfile -t tournament-os:reference .
```

Extend the image with the provider-specific adapter package, then set
`KREATEASY_TENANT_ID` and `KREATEASY_ADAPTER_MODULE` to its installed module name.
The module must export `createProductionAdapters({ tenantId })`; see
`apps/compiler-web/src/production-host.ts` for the typed contract. Do not expose
the service publicly until the controls in
`docs/production-runbook.md` are supplied and exercised. In particular, a real
database, key-management service, identity provider, TLS ingress, backup target,
and alert receiver are deployment-owned inputs and are not embedded here.

## PostgreSQL event store

The production-shaped adapter is in
`packages/competition-engine/src/postgres-event-store.ts`; its migrations are the
ordered, forward-only files in `deployment/postgres/`. Apply every unapplied file
with a dedicated migration identity, then run the verification harness against a disposable or
non-production database:

```sh
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f deployment/postgres/001_event_store.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f deployment/postgres/002_outbox_delivery_receipts.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f deployment/postgres/003_production_coordination.sql
DATABASE_URL="$DATABASE_URL" node --import tsx scripts/verify-postgres-event-store.ts
DATABASE_URL="$DATABASE_URL" COORDINATION_KEY_HASH_SECRET="$COORDINATION_KEY_HASH_SECRET" \
  node --import tsx scripts/verify-postgres-production-coordination.ts
```

Never edit an already deployed migration. Add the next zero-padded migration and
deploy it forward. Migration `002` records replay-safe provider receipts;
migration `003` adds distributed rate-limit buckets and fenced webhook replay
claims. Each records its identifier in `tournament_schema_migrations` and is safe
to reapply.

The harness verifies tenant isolation, content-bound idempotency, optimistic
concurrency, atomic rollback, replay, and snapshots. The application identity must
not own the tables and must not have `BYPASSRLS`; the migration intentionally uses
`ENABLE ROW LEVEL SECURITY` and `FORCE ROW LEVEL SECURITY`. Keep schema migration
credentials separate from runtime credentials.

## Production composition

`apps/compiler-web/src/production-host.ts` is the fail-closed executable boundary;
`production-runtime.ts` is its provider-neutral composition root. The deployment
adapter injects a verified identity-provider adapter, an explicit PostgreSQL
connection/store, durable coordination stores, webhook providers, and a fresh
six-dependency readiness report. The runtime:

- rejects development/in-memory persistence;
- binds accepted principals to exactly the configured organisation tenant;
- exposes the versioned operator API through the same event-sourced platform;
- requires strict request schemas, bounded transport reads, per-principal rate
  limiting, and atomic signed-webhook replay claims;
- reports liveness separately from dependency readiness and routes traffic only
  when the supplied readiness evidence permits it;
- leaves migrations explicit instead of applying them on process startup; and
- keeps credentials, provider SDKs, and managed-key policy deployment-owned.

The default `server.js` entry is a local Studio/demo entry and is not the container
command. The production host refuses the `KREATEASY_AUTO_MIGRATE` escape hatch;
apply migrations from a separately authorised release job. `SIGTERM` and `SIGINT`
drain the HTTP listener before closing persistence and provider adapters.

The adapter module is deployment code because the concrete identity, secret/KMS,
email/SMS/APNs and managed-database SDKs depend on the selected providers. Its
secrets must be obtained via workload identity and secret-manager references,
never embedded in this image or returned by readiness/logging APIs.
