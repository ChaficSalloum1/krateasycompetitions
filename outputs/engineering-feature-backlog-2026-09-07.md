# TournamentOS engineering and feature backlog

Date: 2026-09-07

This is the reconciled engineering backlog derived from the original Universal
Tournament Compiler specification, the compiler-safeguards addendum, the
universality delivery, the Play & Konnect benchmark, and the production-readiness
roadmap. It supersedes older unchecked queue wording; in particular, CP-SAT,
SQLite transactional replay, reference authorization, and integration boundaries
now exist, but their production-grade successors remain below.

## Current engineering truth

- The deterministic compiler kernel is real and its current gate passes: 387/387
  TypeScript/web tests and 19/19 Swift tests.
- All 16 declared stage primitives have executable primary evidence within their
  published bounds. That is bounded native support, not proof of every sport,
  rulebook, scale, or composition.
- The Play & Konnect fixture is represented as configuration: 47 pairs, 98
  contests, 3,080 court-minutes. The CP-SAT candidate finishes in 450 minutes,
  against an independently verified 440-minute lower bound.
- The service now exposes versioned portfolio, blueprint, schedule, live
  operations, findings, and certification read DTOs from one server truth model.
  Production still fails closed until a real identity adapter is supplied.
- SQLite remains the local durable adapter. A real PostgreSQL event-store adapter
  and forced-RLS migration passed an isolated PostgreSQL 16.14 verification for
  tenant isolation, idempotency, concurrency, atomic rollback, replay, and
  snapshots. Managed provisioning, outbox, PITR, and restore drills remain.
- Registered natural language is safe and fail-closed, but its grammar is narrow.
  A general model-backed interpreter has not been connected to the deterministic
  proposal/critic/approval boundary.
- Sport rule packs are governed and versioned, but the supplied packs are
  illustrative rather than federation-approved.
- The organisation product plane now has event-sourced clubs, scoped memberships,
  invitations and roles; six persistent directories; multi-tournament CRUD and
  immutable revisions; approved versioned formats and club defaults; guided
  creation; operator writes; portfolio alerts; privacy export/logical deletion;
  hashed recovery; notification intent; and verified logical backup/restore.
- The production composition root now requires forced-RLS PostgreSQL and a
  tenant-bound verified principal. Managed identity, email/SMS/push delivery,
  field-level PII crypto-shredding, PITR drills, and deployed infrastructure are
  still environment-owned launch work.

## Seven-step autonomous delivery: completed vertical slices

The seven-step sequence has now been exercised as production-shaped vertical
slices, not declared complete as seven entire production programmes:

1. Import -> compile -> compare -> approve -> publish -> correct -> audit now has
   strict all-or-nothing entrant CSV import, the existing proof-carrying compile/
   compare/publication path, immutable correction, deterministic calendar export,
   and versioned read DTOs.
2. Live disruption now has audited check-in/incidents/resource outages, derived
   control-room queues, exact minimal-change repair, freeze horizons, pins,
   before/after impact, objective reconstruction, and deterministic replay.
3. The managed-data seam now has an actual PostgreSQL adapter, forced tenant RLS,
   migration, transaction/OCC/idempotency/hash-chain/snapshot semantics, and a
   real-database verification harness. Identity and managed operations need an
   external environment.
4. The schedule-quality seam now has exact lexicographic repair objectives,
   independent reconstruction, honest UNKNOWN/INFEASIBLE behavior, and adversarial
   tests. The full large-scale CP-SAT lexicographic model remains.
5. The Studio now presents overview, control room, compiler, competition,
   schedule, participant public view, and proofs in a responsive operational UI;
   browser QA passed at desktop and mobile widths with no console errors.
6. Conformance remains evidence-led: one million seeded static trials, 16 primary
   capability fixtures, whole-spec exhaustive grammar, cross-sport rule packs,
   and 375 passing TypeScript/web tests. Federation approval remains external.
7. The shared Apple client now consumes the live-operations DTO, provides native
   organiser queues and accessible status text, and passes 19 Swift tests. Signing,
   physical-device/assistive-technology evidence, production auth, and App Store
   submission require the release environment and account owner.

## Original acceptance criteria: status

| Original criterion | Status | Remaining engineering work |
|---|---|---|
| Understand most of an unseen organiser request | Partial | Expand the structured interpreter, evaluation corpus, citations, and ambiguity UX without granting model authority. |
| Express every supported rule formally | Strong within registered primitives | Expose the full pool, qualification, schedule, and format DSL in schema and Studio; add migrations. |
| Identify ambiguity and missing primitives | Implemented in the kernel | Productize blocking questions, requirement coverage, capability levels, and rule-pack review. |
| Never silently invent policy | Implemented and tested | Preserve the invariant across every future API, import, model, and integration. |
| Generate contests and progression correctly | Implemented within bounded envelopes | Extend the whole-spec generator across every primitive composition and dynamic correction state. |
| Solve resources and prove hard constraints | Implemented; scale adapter is makespan-led | Add the complete lexicographic quality model, warm-start repair, larger measured envelopes, and objective re-verification. |
| Simulate to completion | Implemented for registered scenarios | Add richer day-of incidents, correlated duration models, cancellations, and operational repair/replay. |
| Explain every consequential decision | Core evidence exists | Complete plain-language why/why-not, semantic impact, and affected-person UI for every action. |
| Reproduce later and handle revisions | Strong in the kernel | Add production migrations, key/version retention, distributed concurrency, and rollback tooling. |
| Produce an organiser blueprint and run it live without reinterpretation | Reference path only | Build the end-to-end operator workflow, production persistence, real-time delivery, score entry, repair approval, and participant publication. |

## Prioritized top five

Scoring uses product impact, risk retired, strategic alignment, and implementation
effort. These are initiatives, not single tickets; each should be delivered as
thin vertical slices with its own deterministic gate.

| Rank | Initiative | Impact | Effort | Risk retired | Why it is next |
|---:|---|---|---|---|---|
| 1 | Live control room and minimal-change disruption repair | Very high | XL | Very high | This converts a compiler into the system an organiser can trust on event day and is the strongest defensible feature edge. |
| 2 | Production service, data, identity, and recovery plane | Very high | XL | Critical | Nothing can be honestly launched or piloted as authoritative truth until this exists. |
| 3 | Lexicographic schedule-quality and repair solver | Very high | L | High | Feasibility is not enough; elite scheduling must explicitly optimize finish, promises, rest, change cost, unlocks, flow, and presentation. |
| 4 | Full organiser Studio and participant live experience | High | XL | High | The engine's power currently exceeds the product surface. Complexity must become understandable and operable under pressure. |
| 5 | Universal conformance, official rule packs, and scale evidence | High | L/ongoing | Very high | This is what makes breadth claims defensible and turns tournament edge cases into a compounding engineering asset. |

## 1. Live control room and disruption repair

Build one operational command model across Definition, Plan, Operational, and
Actual truth for:

- check-in, late arrival, no-show, withdrawal, retirement, walkover, protest,
  appeal, score correction, court closure, official absence, equipment failure,
  and actual start/end/duration;
- a live now/next/late/blocked/unreported court board;
- freeze horizons, started/announced immutability, and explicit "do not move"
  pins;
- incremental warm-start repair that minimizes changed matches, affected people,
  notification churn, and quality degradation after preserving hard safety;
- a before/after impact plan showing what moves, who is affected, why each move
  is necessary, quality delta, and why-not evidence;
- approve, reject, revise, supersede, rollback-by-new-revision, and printable
  emergency sheets;
- idempotent offline commands, conflict resolution, and real-time client updates.

Gate: at the published 128-task envelope, court closure, 20-minute overrun,
withdrawal, and no-show each yield an independently validated repair in under five
seconds; fewer than 10% of untouched future matches move in the standard
single-court failure fixture unless an impossibility proof explains why.

## 2. Production service, data, identity, and recovery plane

- Implement a managed Postgres event-store adapter with transactional outbox,
  worker leases, optimistic concurrency, content-bound idempotency, schema
  migrations, tenant isolation/RLS where appropriate, and read projections.
- Add a real identity provider, organisations, memberships, sessions, account
  recovery, and least-privilege RBAC with separation of compile/certify/publish/
  override powers.
- Move signing and encryption material to managed keys with rotation and audit.
- Add versioned public DTOs, compatibility tests, migration tooling, and retained
  replay support for old compiler/rule/solver versions.
- Deploy ingress TLS, rate/request/time limits, egress policy, structured logs,
  traces, SLO dashboards, alerts, dead-letter inspection, audit search/export,
  and safe replay tools.
- Implement backup automation, point-in-time recovery, isolated restore, measured
  RPO/RTO, load/soak/concurrency/chaos tests, threat modeling, dependency/container
  scanning, privacy export/deletion/retention, and incident drills.

Gate: a production-shaped environment demonstrates no lost or duplicated
acknowledged command, no cross-tenant path, 99.9% measured beta availability, and
a witnessed restore that reconstructs authoritative state and proof hashes.

## 3. Lexicographic schedule-quality and repair solver

The current CP-SAT adapter is independently validated and can prove makespan
optimality. The next solver must implement the declared quality hierarchy rather
than treating every feasible schedule with the same finish as equivalent.

Use sequential/lexicographic objectives with independently reconstructed values:

1. feasibility and hard safety;
2. hard deadline and pinned commitments;
3. makespan;
4. minimum participation and other hard promises;
5. preferred rest and thermal/load risk;
6. change cost from the active published schedule;
7. critical-path unlock and resilience slack;
8. participant/referee/venue flow and long-wait reduction;
9. climax, presentation, and explainable occupancy quality.

Add deterministic tie-breaking, warm starts, time budgets, optimality gaps,
Pareto/scenario comparison, rolling-horizon repair, multi-venue travel time,
resource skills/certifications, shared equipment, setup/teardown, curfews, and
explainable idle classification.

Gate: every reported objective is recomputed outside the solver; exact small cases
match exhaustive search; seeded large cases replay; and published performance
envelopes include latency, solution quality, gap, memory, and failure behavior.

## 4. Full organiser Studio and participant live experience

Organiser product:

- guided participants -> format -> rules -> resources -> priorities -> review;
- spreadsheet/import mapping with validation and a visible requirement ledger;
- plain-language "understood / choices needed / assumed / impossible" summary;
- editable formal rules at simple, detailed, and technical levels;
- visual competition graph, path debugger, why and why-not, and proof drill-down;
- side-by-side scenarios with formal diffs and operational consequences;
- drag/pin actions that create proposals and show downstream effects before apply;
- live desk, score entry, incident handling, bulk actions, keyboard workflows,
  stale-state warnings, audit history, exports, and print fallback.

Participant product, initially install-free web/PWA:

- personal schedule, opponent, court/map, check-in, live status, results, and
  accessible change notifications;
- public brackets/standings/results with stable share links, embeddable views, and
  privacy-aware participant identity;
- resilient low-connectivity behavior and localization/time-zone handling.

Gate: observed organisers can compile and publish a standard event without help;
an unfamiliar assistant can recover the four canonical incidents; the web path
has WCAG 2.2 AA evidence.

## 5. Universal conformance, official rule packs, and scale evidence

- Expose rich pool construction in the canonical schema and Studio: fixed/together/
  separate constraints, club/team/region limits, seed bands, balance objectives,
  manual locks, provenance, approval, and infeasibility explanations.
- Extend the whole-spec grammar across all static and dynamic primitives,
  selectors, pool constraints, corrections, withdrawals, conditional branches,
  multi-destination qualification, resources, and revisions.
- Add counterexample shrinking, deliberate mutation testing, solver differential
  checks, model-based lifecycle tests, and deterministic CI sharding.
- Convert real historical failures into named permanent fixtures; publish evidence
  envelopes rather than unbounded claims.
- Commission versioned, owner-approved packs and golden fixtures for initial
  racket sports, then chess/Swiss, football league/cup, combat repechage, and
  athletics/swimming ranked/heats. Include effective dates, jurisdiction,
  compatibility, migrations, deprecation, and signature/authority governance.
- Add incomplete-event semantics that remain explicitly policy-bound: abandoned
  stages, partial pools, retroactive withdrawal, correction of earlier Swiss
  rounds with downstream invalidation/recompilation, appeals, sanctions, and
  shared/disputed ranking outcomes.

Gate: every advertised native capability is backed by primary end-to-end fixtures,
independent proof, mutation survival thresholds, and an explicit tested scale and
composition envelope.

## Remaining platform and feature work after the top five

### Interoperability and migration

- CSV/XLSX import/export, calendar feeds, printable packs, public read API,
  operator write API, webhooks, and generated client SDKs.
- Real registration, payment, booking, scoreboard, live-stream, and results
  provider adapters. The existing signed gateway is the safe boundary, not a
  completed provider integration.
- Obtain and implement the real Krateasy contract, identity mapping, sandbox
  fixtures, retry/reconciliation, contract tests, and production credentials.
- Challonge/Tournify/Tournamentsoftware-compatible import paths where legally and
  technically available, to reduce switching friction.

### Native Apple clients

- Connect production API/auth, push/deep-link/background-refresh behavior, and a
  persistent production queue rather than demo/in-memory-only construction.
- Finish Mac/iPad live-desk workflows and keep iPhone focused on check-in, score,
  alerts, participant schedule, and fast explanations; do not duplicate engine
  logic in Swift.
- Run VoiceOver, Voice Control, Full Keyboard Access, Dynamic Type, reduced-motion,
  multitasking, physical-device network/offline, performance, and leak evidence.
- Complete signing, metadata, privacy/support URLs, screenshots, review account,
  account deletion, and Sign in with Apple applicability before submission.

### Safe interpretation intelligence

- Add a model-backed interpreter only behind structured outputs, the registered
  primitive registry, exact source citations, schema validation, deterministic
  requirement coverage, a read-only Tournament Critic, semantic diff, simulation,
  and human approval.
- Build adversarial and multilingual paraphrase evaluations, prompt-injection and
  rulebook-poisoning cases, confidence calibration, cost/latency controls, and
  complete audit/replay of model/version/prompt inputs.
- Keep the deterministic manual/advanced editor fully usable when the model is
  unavailable.

### Organisation and competition platform features

- Delivered: reusable organisations and clubs, memberships and staff roles,
  invitations, venues/courts/equipment/officials, persistent players and teams,
  versioned format templates, seasons, multi-event portfolio, operational alerts,
  and guarded lifecycle history.
- Remaining: circuits and ranking-series aggregation, federation delegation and
  sanctioning, cross-organisation transfers, billing/entitlements, bulk merge and
  deduplication tooling, and production projections/search for very large tenants.
- Registration capacity/waitlists, payments/refunds through a provider, document
  and eligibility checks, seeding imports, communications, branded public pages,
  and result syndication.
- Add these only through versioned contracts around the one compiler/event truth
  model; never create a second competition engine in a client or integration.

## Recommended execution sequence

1. Production-shaped thin slice: import -> compile -> compare -> approve ->
   publish -> score -> correct -> audit export.
2. Live disruption slice: overrun and court closure with freeze horizon,
   minimal-change repair, approval, notification impact, and replay.
3. Managed data/identity slice with concurrency, tenant, backup, and restore gates.
4. Complete lexicographic solver and measured repair envelope.
5. Productize the Studio/control room and participant live web around those real
   workflows.
6. Expand conformance grammar and commission official rule packs from pilot
   evidence.
7. Add provider integrations and finish Apple release evidence after the API and
   operational workflows stabilize.

No new prompt series is required to start this sequence. External provider
contracts, production accounts, rule-authority approval, legal/privacy decisions,
and App Store submission credentials are the remaining inputs that cannot be
derived from the original specification.

## Explicit non-goals

- Do not claim unbounded "any sport, any format, any complexity."
- Do not add format labels without executable primary evidence.
- Do not let an LLM choose rules, seeds, winners, or live truth.
- Do not duplicate the competition engine in iOS, macOS, or provider adapters.
- Do not prioritize a broad social network, booking marketplace, or cosmetic
  parity ahead of event-day reliability and production trust.
