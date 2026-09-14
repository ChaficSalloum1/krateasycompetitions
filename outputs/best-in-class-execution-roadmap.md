# TournamentOS best-in-class execution roadmap

Date: 2026-09-05

## Chained milestones

1. Competition truth hardening
2. Topology and draw completeness
3. Production constraint scheduler
4. Operational truth, persistence, and replay
5. Safe natural-language compiler
6. Best-in-class web organiser product
7. Apple multiplatform client
8. Integrations, security, deployment, and operations

Each milestone is gated by deterministic tests, adversarial fixtures, JTBD outcome
criteria, and relevant accessibility/product checks. A later milestone cannot
replace the competition engine or weaken an earlier invariant.

## Work completed in this pass

- Created eight measurable Jobs-to-be-Done stories covering compilation,
  scenario decisions, draws, live recovery, explainability, cross-device work,
  replay, and safe extensibility.
- Defined the Apple product architecture and HIG release checklist.
- Defined milestone gates and the production-hardening sequence.
- Replaced silent entrant-ID fallback for multi-team ties with a deterministic
  mini-table calculation and blocking unresolved-tie evidence.
- Added the canonical circular three-way-tie regression fixture.
- Added participant-path proof objects with minimum/maximum match counts and a
  losing-path counterexample.
- Added schedule analytics for makespan, lower bound, critical path, and
  per-resource utilisation.
- Added immutable topology compilation across entrant counts 2–64, including
  explicit play-ins, protected byes, winner/loser ports, and classification matches.
- Added hard-first lexicographic draw placement with explicit `INFEASIBLE`
  results, alternatives, unavoidable-conflict evidence, and proof hashes.
- Added an immutable typed scheduling model for venues, officials, equipment,
  calendars, closures, locks, precedence, participant conflicts, and objectives.
- Added a replaceable solver contract and exact proof-bounded backend that never
  confuses feasible, optimal, infeasible, or unknown outcomes.
- Added independently derived resource-specific/dependency/workload bounds and
  a mutation-tested shadow validator, including hard-lock verification.
- Added explicit Definition/Plan/Operational/Actual event-sourced truth, with
  legal transition guards, result correction/void lineage, and deterministic replay.
- Added optimistic concurrency, command idempotency, atomic append rollback,
  tamper-evident event chains, snapshots-as-cache, and transactional outbox recovery.
- Added a closed, cited, registered-grammar intent compiler with pinned defaults,
  paraphrase equivalence, unresolved capture, and whole-prompt injection rejection.
- Added a read-only compiler critic for requirement coverage and quantifier drift,
  plus a quarantined, cited, review-only rulebook import boundary.
- Rebuilt the web console as a responsive organiser Studio with compiler, graph,
  schedule, findings, dry-run, and proof views backed by the certified engine.
- Added accessible organiser read models, immutable scenario comparison, and
  independently re-certified Markdown/JSON audit exports.
- Added a shared SwiftUI iOS/iPadOS/macOS client with adaptive navigation,
  versioned API DTOs, durable offline command reconciliation, a privacy manifest,
  sandboxed macOS entitlements, and an original AppIcon asset catalog.
- Added signed, idempotent integration envelopes, strict inbound verification,
  bijective provider identity maps, and replay/conflict rejection.
- Added tenant-scoped least privilege, separation of duties, mandatory audit,
  readiness, redacted telemetry, SLO budgets, backup/restore proofs, fail-closed
  production startup, container packaging, and incident/recovery runbooks.

## Current verification

- TypeScript composite build: PASS
- TypeScript automated tests: 178/178 PASS
- Swift automated tests: 17/17 PASS
- iOS Simulator build: PASS
- macOS app build: PASS
- Reference certification: CERTIFIED
- Generated/scheduled contests: 120/120
- Solver claim: FEASIBLE (global optimum is not claimed)

Milestone 1 passes its reference gate with append-only adjudication,
withdrawal/walkover/void policy, correction lineage, eligibility validation,
participant path counterexamples, and named nasty fixtures. Milestone 2 topology
and draw completeness also passes its reference gate. Milestone 3 production
scheduling passes its reference gate: the large reference scheduler conservatively
claims `FEASIBLE`, while the exact small-instance adapter claims `OPTIMAL` only
with a proof. Milestone 4 operational truth and persistence also passes its
reference gate. Milestone 5 safe natural-language compilation also passes; the
best-in-class organiser web product passes its reference gate. The Apple
multiplatform client and production-boundary milestone now pass their reference
gates inside the same monorepo. Live cloud/provider configuration remains an
explicit release operation because no deployment identity, database, secrets,
legal URLs, or App Store account were supplied.

## Product conclusions

The Apple client now lives in the monorepo behind the API contract and durable
command model. It uses one shared SwiftUI package and multiplatform app target:

- macOS and regular-width iPadOS: dense organiser split workspace
- iPhone and compact-width iPadOS: task-oriented tab/navigation flows
- all platforms: the same versioned server-side tournament truth and certification objects

The client must not reimplement standings, qualification, bracket progression,
scheduling, or certification in Swift.

## Source documents

Detailed engineering gates are in `docs/execution-chain.md`. JTBD stories are in
`docs/jobs-to-be-done.md`. Apple product decisions are in
`docs/apple-product-lens.md`.
