# Production operations hardening delivery — 2026-09-12

## Delivered

- Reference-only production security configuration. Inline database credentials,
  missing session references, invalid KMS references, shared signing keys, and
  non-production runtime modes fail closed without echoing rejected values.
- Secret-manager and managed-key provider interfaces, metadata-only dependency
  readiness, canonical digest signing, version-bound verification, and rotation-
  compatible historic key lookup.
- Freshness-bounded production readiness for database, event ledger, identity,
  KMS, outbox worker, and secret manager; a separate process-only liveness proof.
- One structured telemetry boundary that rejects invalid events and recursively
  redacts credential- and personal-data-shaped attributes before export.
- Restore-drill evaluation binding artifact integrity and schema compatibility to
  RTO/RPO measurements and exact replayed authoritative proof identity.
- An executable outbox crash drill covering provider acceptance, worker death
  before acknowledgement, lease recovery, replay with the same dedupe identity,
  provider-side suppression, and final acknowledgement.
- A measured nine-point scale campaign at 128, 512, and 2,048 tasks across three
  resource ratios, with the evidence boundary recorded explicitly.

## Verification

The new package build and 13 public-behaviour tests pass. The scale campaign
returned independently validated schedules for all nine regular fixtures with no
hard-constraint findings. Its campaign status remains `UNKNOWN`, intentionally,
because disruption repair was not exercised.

## Deliberate evidence limits

No cloud secret manager, KMS, notification provider, hosted database restore, or
production telemetry collector was available in this local workspace. The new
interfaces and drills are the verifiable seam for those systems, not evidence that
an external provider is configured.

The scale fixtures are regular fixed-resource chains. Their 2,048-task results do
not establish a universal capacity claim. Parent-process RSS is not peak solver
subprocess memory. Representative mixed constraints, adversarial infeasibility,
repair workloads, concurrent tenants, repeated percentiles, and production-shaped
hardware remain required.

The in-process crash drill proves protocol behaviour but does not kill an operating
system process. A staging gate must kill a real worker after provider acceptance.
Duplicate signed-webhook and cross-tenant probes belong at deployed HTTP and
non-owner PostgreSQL boundaries; unit-level substitutes would overstate coverage.

