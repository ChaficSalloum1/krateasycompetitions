# TournamentOS milestone-chain delivery

Date: 2026-09-05

## Outcome

The full eight-milestone reference chain is implemented in one monorepo. The
result is a deterministic, proof-carrying tournament compiler with a web Studio,
a shared iPhone/iPad/Mac client, and fail-closed external/production boundaries.
The AI is never the final authority: language interpretation proposes closed,
cited intent; deterministic compilation, independent validation, certification,
authorisation, and audited human workflow control consequential truth.

## Milestone status

| Milestone | Gate | Delivered evidence |
|---|---|---|
| M1 Competition truth | Passed | Recursive mini-tables, adjudication lineage, eligibility/types, participant paths, nasty/property fixtures |
| M2 Topology and draw | Passed | Entrants 2–64, play-ins/byes, winner/loser ports, classification, hard-first draw proofs and explicit infeasibility |
| M3 Scheduling | Passed | Typed resources/calendars/locks, honest solver states, lower bounds, exact small-instance proof, independent mutation-tested validator |
| M4 Operational truth | Passed | Definition → Plan → Operational → Actual, OCC, idempotency, tamper-evident replay, transactional outbox/dead letter |
| M5 Language compiler | Passed | Closed cited grammar, pinned defaults, requirement critic, quantifier checks, injection rejection, quarantined rulebooks |
| M6 Web product | Passed | Responsive organiser Studio, graph/schedule/findings/proof views, scenarios, dry run, certified exports |
| M7 Apple client | Passed | Shared SwiftUI iOS/iPadOS/macOS client, adaptive HIG navigation, fail-closed DTOs, offline reconciliation, privacy/sandbox/icon assets |
| M8 Production boundary | Passed | Signed provider gateway, replay protection, tenant RBAC, separation of duties, audit, health/SLO/telemetry, backup/restore, container/runbook |

## Verification

- TypeScript composite build: PASS
- TypeScript tests: 178/178 PASS
- Swift tests: 17/17 PASS
- iOS Simulator app build: PASS
- macOS app build: PASS
- Privacy manifest and entitlements: PASS
- Reference certification: CERTIFIED
- Reference contests generated/scheduled: 120/120
- Large-reference solver claim: FEASIBLE; global optimality is not falsely claimed

## Product and Jobs lens

The implementation is organised around eight user jobs: prove a format is
runnable, compare options, defend a draw, recover live operations, explain
decisions, move between devices without changing truth, replay an event, and add
formats without weakening safety. The organiser always sees assumptions,
findings, solver status, provenance, certification, and conflicts next to the
object they qualify. Compact Apple layouts focus on live action; regular-width
layouts support dense planning; neither client reimplements competition truth.

## What is intentionally still external

No further prompt series is needed to continue the core implementation. A real
launch now requires environment-owned facts and accounts rather than more product
specification:

1. Choose and provision the production database, object/backup store, identity
   provider, KMS/signing keys, TLS ingress, telemetry/alert destinations, and host.
2. Obtain the real Krateasy/provider contract, credentials, webhook keys, rate
   limits, sandbox fixtures, and data-processing terms; run contract tests there.
3. Approve organisation roles, retention, SLO/RPO/RTO, incident ownership, privacy
   policy, support URL, and data/account deletion behavior.
4. Connect the Apple client to the production API/auth flow, sign it, record
   device/accessibility passes, prepare metadata/screenshots/reviewer access, and
   submit through App Store Connect.
5. For high-scale optimal scheduling, select and benchmark a pinned native
   CP-SAT/MIP backend behind the existing adapter while preserving the independent
   validator and honest solver-status contract.

Until items 1–4 exist, production mode deliberately reports `UNKNOWN` readiness
and rejects API access instead of guessing credentials or weakening controls.

## Key handoff documents

- Detailed gates: `docs/execution-chain.md`
- Jobs-to-be-Done: `docs/jobs-to-be-done.md`
- Apple/HIG design: `docs/apple-product-lens.md`
- App Store preflight: `docs/app-store-preflight.md`
- Production runbook: `docs/production-runbook.md`
- Reference deployment boundary: `deployment/README.md`
