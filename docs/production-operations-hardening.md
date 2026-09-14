# Production operations hardening

This layer turns operational assertions into explicit, content-addressed evidence.
It is intentionally provider-neutral: deployment code supplies the actual secret
manager, managed key service, database probes, notification provider, and backup
artifacts.

## Secrets and managed keys

`production-security.ts` accepts only opaque `secret://` and `kms://` references.
Rejected configuration never echoes the rejected value. Production requires
separate audit and webhook keys, and readiness checks provider metadata without
retrieving secret bytes. Secret material may only be accessed through the narrow
`SecretProvider.withSecret` callback.

The `KeyManagementProvider` signs canonical payload digests. A managed proof
signature binds the key reference, exact key version, payload digest, and provider
signature. Verification fails when payload, key version, key status, or verify
purpose differs.

Production adapters still need to be written for the chosen secret/KMS service.
They must avoid logging callback material, zero buffers where the platform allows,
use workload identity instead of static cloud credentials, and expose rotation
metadata through `describe`/`describeKey`.

## Health and observability

`assessProductionReadiness` requires fresh evidence for database, event ledger,
identity provider, KMS provider, outbox worker, and secret provider. Missing, stale,
future-dated, unknown, or unhealthy critical evidence prevents routing. Liveness is
separate and proves only that the process can answer.

All structured events pass through `createStructuredTelemetryEmitter`, which uses
the existing recursive privacy/credential redaction boundary and rejects malformed
events. Runtime code should export only the returned validated event.

## Restore evidence

`runAuthoritativeRestoreDrill` evaluates an isolated restore against:

- canonical backup-manifest integrity;
- artifact presence, uniqueness, size, SHA-256, and schema version;
- measured recovery time and data-loss window against approved RTO/RPO targets;
- exact event-head, aggregate-state, schedule, publication-certificate, and other
  named proof hashes for every supplied organisation stream.

The module evaluates supplied evidence; it does not run `pg_dump`, create storage
snapshots, or perform a managed database point-in-time restore. Deployment
automation must restore to an isolated target, replay from events rather than trust
snapshots alone, collect both source and restored truth proofs independently, and
then call this evaluator. A verified drill is evidence for that drill only, not a
continuous recovery guarantee.

## Worker crash drill

`runOutboxCrashRecoveryDrill` deliberately delivers a leased message and omits the
acknowledgement, waits until lease expiry, recovers it with a different worker, and
delivers again with the same outbox dedupe key. The drill passes only if the
provider reports the second attempt as a duplicate with the same provider delivery
identity, and the recovered worker then acknowledges the original outbox message.

This proves the application/provider idempotency protocol in a controlled run. It
does not establish provider availability or cover a real process kill. Deployment
chaos must additionally terminate an actual worker after provider acceptance,
duplicate signed webhooks at the HTTP boundary, and probe tenant isolation through
the deployed runtime and a non-owner database identity.

## Go-live integration requirements

1. Bind the production runtime to concrete secret-manager and KMS adapters.
2. Populate the six required health probes with bounded timeouts and timestamps;
   route `/health/ready` only when `routeTraffic` is true.
3. Send every log/trace event through the structured telemetry emitter and enforce
   retention/access controls at the collector.
4. Add an isolated restore job that produces real manifest, RTO/RPO, and replay
   proof evidence.
5. Run the crash drill against the durable PostgreSQL outbox and the sandbox for
   each notification provider.
6. Execute duplicate-webhook and cross-tenant red-team suites through deployed
   ingress; in-memory protocol tests are not substitutes for those boundaries.

The repository includes a production PostgreSQL coordination implementation at
`apps/compiler-web/src/postgres-production-coordination.ts` and a concrete
managed-signature HTTPS delivery adapter in
`packages/competition-engine/src/webhook-delivery-provider.ts`. Provider-specific
identity, KMS, email, SMS and APNs SDK bindings remain deployment adapters because
their credentials and tenant configuration cannot be safely invented here.
