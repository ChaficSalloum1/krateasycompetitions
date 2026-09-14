# TournamentOS Universal Tournament Compiler

This repository is an end-to-end reference implementation of a sport-agnostic,
proof-carrying tournament compiler. The same deterministic competition engine is
used by compilation, Scenario Lab, simulation, certification, and the web console.

## Implemented

- Strict versioned JSON Schema and matching TypeScript IR
- Canonical serialization and SHA-256 replay hashes
- Immutable compiled specifications and linked revisions
- Plan -> Validate -> Apply with semantic JSON-pointer diffs
- Deterministic tournament type checker
- Explicit critical-rule provenance and requirement coverage
- Versioned xoshiro128** and PCG32 random sources with pinned seeds, stable vectors, and proof-bound draws
- Play & Konnect reference definition as configuration
- Regression tests for subtle compiler inconsistencies
- Competition DAG and independent contest-cardinality derivation
- Standings, normalized cross-pool qualification, bracket topology, and draws
- Recursive mini-table tiebreaks with fail-closed unresolved-tie evidence
- Append-only adjudication for results, walkovers, withdrawals, voids, and corrections
- Eligibility/type validation and participant-path counterexamples
- Proof-bearing topology compilation for 2–64 entrants and hard-first constraint draws
- Typed scheduling models for venues, officials, equipment, closures, and locks
- Deterministic feasible scheduler plus an independently implemented validator
- Replaceable solver adapter with exact proof-bounded search for small instances
- Pinned OR-Tools CP-SAT scale adapter with independent validation and explicit tested envelope
- Resource/dependency/participant lower-bound proofs and solver audit evidence
- Dry-run simulation, certification, counterfactual explanations, and repairs
- Safe natural-language intent/modification boundary and compiler web console
- Americano dynamic-format state machine and Monte Carlo operational risk
- Versioned extension registry, invariant firewall, and publication gateway
- Signed replay-safe provider integration and bijective external identity mapping
- Tenant-scoped least-privilege authorization with separation of duties and audit
- Readiness, redacted telemetry, error budgets, backup manifests, and restore proofs
- Responsive organiser Studio plus shared iOS/iPadOS/macOS SwiftUI client
- Evidence-derived format capability ledger; all 16 declared stage primitives are native within published evidence envelopes, while schema enums alone never imply support
- Certified primary static engines for round robin, double elimination, repechage, play-ins, placement/classification, and versioned custom graphs
- Primary Swiss, ladder, qualifying-heat, time-trial, and ranking-stage orchestration through production scheduling and transactional SQLite replay
- Approval-bound canonical static-stage compiler with conditional reset semantics and independent graph closure proofs
- Audited, replayable dynamic-stage lifecycle with partial results, corrections, void lineage, optimistic concurrency, and content-bound idempotency
- Proof-bounded pool construction plus snake, pinned-random, manual, and optimised primary pool allocation
- Canonical, primary declarative qualification for ranking, thresholds, percentages, aggregates, best-N, authority-approved wildcard/host places, and remainder selection
- Advanced Swiss ranking with Buchholz, median Buchholz, Sonneborn-Berger, progressive, and valid head-to-head mini-leagues
- Registered cross-sport result semantics for head-to-head, best-of series, combat, motorsport, timed/distance, judged, relay, and team competition
- Governed, versioned, hash-bound sport rule-pack registry with explicit authority, jurisdiction, compatibility, and effective dates
- Executable 16-primitive conformance audit: 11 static scenario fixtures and 5 transactional dynamic fixtures
- Bounded exhaustive verification plus a reproducible one-million-trial format campaign
- A complete 420-case whole-spec grammar with 1,222 metamorphic checks over pools, multi-destination qualification, byes, resources, locks, closures, and adjudication states
- Event-sourced organisation workspaces with clubs, scoped memberships, expiring invitations, revocation, role changes, and last-owner protection
- Persistent player, team, venue, court, official, and equipment directories with referential integrity
- Multi-tournament lifecycle management with immutable revisions, guided creation, duplication, approval separation, publication, and archive history
- Deterministic Competition Guard with bottom-up accounting, exact artefact hashes, tamper-evident reports, and atomic certificate-gated publication
- Transactional PostgreSQL publication outbox with forced-RLS tenant isolation, leased delivery, bounded retry and dead-letter state
- Governed live-change proposals combining operational facts, minimal repair, impact preview, targeted communication drafts and separate approval
- Deterministic schedule-resilience ranking across resource-loss and 10/20/30-minute overrun scenarios without relaxing hard constraints
- Executable bounded model checking plus portable TLA+ specifications for publication, idempotency and live-change approval protocols
- Versioned reusable format templates with semantic versions, independent approval, and club defaults
- Tenant-scoped operator write API for live actions, scoring corrections, alerts, notification intent, and independently approved minimal-change repairs
- Privacy export, logical account anonymisation, recovery-token hashing, canonical backup/restore, and a production runtime that requires forced-RLS PostgreSQL and verified tenant identity

## Commands

```bash
npm install
npm run check
npm run check:apple
npm run check:all
npm run demo
npm start
```

## Package boundary

`@tournament-os/tournament-schema` is pure domain code. It has no UI, database,
wall-clock, network, or implicit random source. Creation time, prompt text,
versions, and any random seed are injected explicitly.

The large reference list scheduler proves feasibility of its returned plan but
does not claim global optimality. Its audit therefore reports `FEASIBLE`, never
`OPTIMAL`. The small-instance exact adapter reports `OPTIMAL` only after exhaustive
search or equality with a valid mathematical lower bound.
Natural-language support is deliberately limited to registered interpretation and
edit primitives; unsupported language returns unresolved rather than executable
free-form policy.

Publication is a guarded operation, not an unverified status flag: the atomic
`PUBLISH_TOURNAMENT` command independently evaluates the exact approved revision,
records its Guard report and certificate, and changes lifecycle state in the same
event-store append. Failed validation or acknowledgement leaves no partial commit.

Production mode is deliberately fail-closed until a verified authorization
adapter is injected. The production composition root refuses an in-memory store
and cross-tenant principals. See `docs/production-runbook.md` and
`docs/app-store-preflight.md` before deployment or App Store submission.
