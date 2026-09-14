# TournamentOS production runbook

This runbook protects the compiler's central rule: an AI interpretation is a
proposal; only the deterministic engine, independent validators, and an
authorised human workflow may certify or publish tournament truth.

## Go-live gate

Do not expose the production API until every item below has evidence attached to
the release record.

1. `npm run check` and `npm run check:apple` pass from a clean checkout.
2. Apply every ordered file in `deployment/postgres/` with a migration identity and
   run `scripts/verify-postgres-event-store.ts` with a non-owner runtime identity.
   The checked-in adapter has passed isolated PostgreSQL concurrency, replay,
   snapshots, atomic rollback, idempotency, and tenant-isolation verification.
   The verification script now also exercises transaction-bound outbox insertion,
   tenant isolation, lease claim and delivery acknowledgement;
   also run `scripts/verify-postgres-production-coordination.ts` to prove concurrent
   rate-limit and webhook-replay arbitration. Attach fresh environment evidence
   plus point-in-time restore results.
3. The identity provider supplies verified tenant-scoped principals. The web
   service must start through `production-host.ts` with a deployment adapter;
   missing identity, persistence, distributed coordination, or readiness contracts
   prevent startup or traffic routing.
4. Compile, certify, publish, and override permissions are mapped to the
   least-privilege role policy. Distinct people perform consecutive privileged
   workflow steps.
5. Transport signing and verification keys live in a managed key service, have
   named owners, expiry/rotation dates, and no source-controlled secret values.
6. TLS, rate limits, request-size limits, timeouts, and an allowlisted egress
   policy are enforced at ingress/runtime.
7. A restore drill proves the latest backup manifest, artifact checksums, schema
   compatibility, and replayed state hashes in an isolated environment.
8. Alerts, dashboards, on-call ownership, privacy policy, retention periods,
   support contacts, and incident communication paths are approved.

## Health and service levels

- `/health/live` says only that the process can answer.
- `/health/ready` returns the deterministic readiness report. `UNKNOWN` and
  `UNREADY` map to HTTP 503; do not route production traffic to either state.
- Evaluate availability from explicit good/bad event counts. No observations is
  `UNKNOWN`, never success. Suggested initial objectives are product decisions,
  not embedded truths; record the approved SLO, window, and warning threshold.
- Emit structured events only through telemetry validation. Credential- and
  personal-data-shaped attributes are redacted recursively before export.

## Backup and recovery

Back up the append-only event log, idempotency records, outbox/dead-letter state,
snapshots, schemas, extension registry, and release/version manifest. Create a
canonical backup manifest with a byte count and SHA-256 for every artifact.

Restore into an isolated target. Reject missing, additional, duplicate,
size-mismatched, checksum-mismatched, tampered-manifest, or schema-incompatible
artifacts. Rebuild state from events, then compare aggregate versions and state,
proof, schedule, and certification hashes. Snapshots are caches and cannot be the
sole recovery source.

The business must approve RPO/RTO. A sensible starting exercise is RPO 15 minutes
and RTO 60 minutes, but neither becomes a promise until measured in a restore drill.

## Privacy and account lifecycle

- The platform implements authenticated subject export, account recovery with
  hashed single-use secrets, membership suspension, and logical account
  anonymisation. The latest aggregate and its logical backup no longer expose the
  deleted account email or linked player identity.
- Append-only history may still contain personal data from earlier events. Do not
  claim hard erasure from the reference event store. Before processing real
  personal data, add a managed field-level PII vault with per-subject envelope
  keys, retention classification, access audit, and crypto-shredding; keep only
  opaque references in long-lived domain events.
- Recovery and invitation delivery must be performed by an approved transactional
  provider. Raw tokens must never enter events, logs, analytics, URLs, or support
  tooling. The current domain stores only SHA-256 token digests.
- An account-deletion request must revoke sessions and notification endpoints,
  block login, complete legal-retention review, shred the subject key when lawful,
  and produce an audit receipt without retaining the erased fields.
- Test export, deletion, restore, retention expiry, legal hold, and notification
  suppression in a production-shaped environment before launch.

## Incident playbooks

### Certification or replay hash mismatch

1. Stop publication for the affected tenant/tournament; preserve read access.
2. Capture release, schema, ruleset, compiler, solver, registry, event-chain, and
   correlation identifiers without copying credentials.
3. Replay from the last verified event boundary with the pinned versions.
4. Never overwrite the original event. Correct through a new authorised command
   and require independent re-certification.

### Inbound replay, signature, or identity conflict

1. Reject the message and do not partially write domain state.
2. Quarantine the exact content hash, provider, key ID, message ID, and
   idempotency key; redact payload fields that are not required for investigation.
3. Confirm key status and the bijective identity map with the integration owner.
4. Resume only after a verified new message or an audited mapping correction.

### Outbox backlog or dead letter

1. Stop claiming new work if the dependency is unhealthy.
2. Inspect lease owner, attempt count, next-attempt time, and last redacted error.
3. Repair the dependency; retry with the existing idempotency key.
4. Requeue dead letters only through an audited operator command. Never mint a
   second publication identity for the same certified content.

Publication and approved live-change events include a server-authored outbox
intent. PostgreSQL inserts the delivery row inside the same transaction as the
authoritative event. Workers must use the store's lease API; direct status updates
or a second application-side enqueue are unsupported because they weaken
exactly-once effects.

Every provider adapter must explicitly guarantee replay-safe idempotency. The
worker supplies the same tenant-scoped key after lease expiry, including when a
process dies after the provider accepts a send but before PostgreSQL records its
receipt. Providers that cannot map the same key to one external effect are not
valid production adapters. Telemetry contains only hashed tenant identity,
bounded operational identifiers and stable error codes—never message payloads,
recipient addresses, provider response bodies or credentials.

`createManagedWebhookDeliveryProvider` is the reference outbound HTTPS adapter.
It requires an allowlisted HTTPS destination, a deployment-owned KMS signing
callback, a bounded timeout/body, an upstream idempotency receipt, and classifies
retryable versus permanent responses without persisting signing material.

### Suspected credential or personal-data exposure

1. Revoke/rotate the relevant credentials immediately.
2. Restrict affected logs and exports, record access, and follow the approved
   privacy incident process.
3. Patch the validation/redaction rule with a regression test before restoring
   telemetry flow.

## Rollback

Roll back application binaries, never the event ledger. A binary rollback is safe
only when the earlier release reads the active schema and event versions. If not,
keep traffic stopped and restore forward into a compatible release. Record the
decision, actor, reason, versions, and verification hashes.
