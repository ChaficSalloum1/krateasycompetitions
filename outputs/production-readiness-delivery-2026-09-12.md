# Krateasy Competitions production-readiness delivery — 2026-09-12

## Outcome

The repository now contains a fail-closed, provider-neutral production boundary
rather than a demo server presented as production. It will not start without an
explicit tenant and deployment adapter, will not accept process-local rate/replay
coordination, will not auto-migrate, and will not route readiness traffic without
fresh evidence for every critical dependency.

## Delivered against the production-hardening scope

| Scope | Delivered evidence |
|---|---|
| Production pilot APIs | Strict allowlisted operator commands and signed inbound webhook contract, wired through the production runtime |
| Forward-only migrations | Immutable baseline plus ordered `002` delivery receipts and `003` distributed coordination, with a migration ledger and schema `1.3.0` gate |
| Durable notifications | Transactional outbox worker, lease recovery, retry/dead-letter behavior, provider receipts, crash replay, and a managed-signature HTTPS provider |
| Request defenses | Streaming byte limit, JSON depth/collection/string budgets, exact command schemas, mandatory idempotency, distributed rate limiting, and replay fencing |
| Auth boundaries | Trusted middleware principal injection, tenant binding, server-owned audit fields, domain role checks, and fail-closed dynamic adapter loading |
| Secrets and keys | Opaque secret/KMS references, metadata-only readiness, version-bound managed signatures, and no secret material in reports |
| Runtime hardening | Non-root multi-stage image, production-only entry point, bounded HTTP timeouts, request-per-socket cap, graceful idempotent shutdown, liveness/readiness separation |
| Backup and restore | Artifact/checksum/schema/RPO/RTO validation plus exact event, state, schedule and certification proof comparison |
| Chaos and isolation | Worker accept-before-ack crash/recovery drill, webhook concurrency/replay tests, forced-RLS stores, real non-owner PostgreSQL concurrency/tenant checks |
| Scale and documentation | Measured 128/512/2,048-task matrix, protocol model check, deployment guide, operations guide and production runbook |

## Verification completed locally

- `npm run check`: TypeScript build and 457/457 tests passed after final integration.
- Apple client: 19/19 tests passed.
- Protocol model check: `VERIFIED`, 49 states and 133 transitions; proof
  `bcba8729f0ee2669c1c628bf14e07b2164e64ff82bdc1db66b4f1f312dfcf94f`.
- Latest scale run: all nine regular fixtures independently validated with zero
  constraint findings; campaign proof
  `23f249fc94cc1b421882a5e18f94beb271bb41ae77acd87e8e55f205eb21f589`.
- Real isolated PostgreSQL checks exercised event/outbox persistence and 24-way
  concurrency: exactly 7/24 rate-limit admissions and 1/24 webhook claim winners
  under a `NOSUPERUSER NOBYPASSRLS` identity; raw coordination keys were absent.
- Production executable failed closed with the stable
  `PRODUCTION_CONFIGURATION_INVALID` code when its adapter was absent.

## Evidence intentionally not claimed

The scale campaign remains `UNKNOWN` as a general capacity claim. It measures
regular feasibility fixtures, not repair quality, adversarial infeasibility,
concurrent tenants, peak solver-child memory, or production tail latency.

No repository can prove a managed cloud failover, provider delivery, KMS rotation,
or identity integration without the chosen accounts and credentials. Before public
launch, deployment owners must therefore:

1. Choose the identity, secret/KMS, email/SMS/APNs, database, backup and telemetry
   providers and implement the typed deployment adapter with workload identity.
2. Build the image with that adapter installed, configure TLS/egress/ingress, and
   execute the runbook in staging.
3. Kill a real worker after provider acceptance, duplicate signed webhooks through
   deployed ingress, fail over the managed database, and restore a real backup into
   an isolated target.
4. Run mixed-constraint, repair-heavy, adversarial and concurrent-tenant load tests
   on deployment-shaped hardware and publish percentiles and resource ceilings.
5. Complete privacy/legal review and historical/shadow/live tournament validation
   with human fallback before removing the pilot flag.

Docker itself was not available on this workstation, so the image definition was
type/build reviewed but must still be built and scanned in CI or a Docker-enabled
staging environment.
