# Best-in-class execution chain

Each milestone is complete only when its deterministic gate, JTBD acceptance
criteria, adversarial fixtures, and relevant product-accessibility checks pass.

## M1 — Competition truth hardening (reference gate passed)

- Multi-team tiebreak mini-tables and unresolved-tie evidence
- Withdrawals, walkovers, voided results, and eligibility
- Rich participant-shape and stage-port type checking
- Participant path enumeration and counterexamples
- Named nasty fixtures and property fuzzing

Gate: every supported structural outcome has a proof or concrete counterexample.

Delivered: mini-table ties, fail-closed circular ties, immutable adjudication and
correction lineage, walkover/withdrawal/void policies, eligibility and stage-port
checks, participant path proofs, and named nasty/property fixtures.

## M2 — Topology and draw completeness (reference gate passed)

- Play-ins, protected byes, loser paths, classification and multi-cup graphs
- Constraint-based draw placement with lexicographic policy priorities
- Independent topology and match-count derivation

Gate: entrant counts 2–64 and named bye/rematch traps certify deterministically.

Delivered: immutable proof-bearing topology compilation for 2–64 entrants,
explicit play-in/bye and winner/loser ports, third-place and caller-defined
classification matches, hard-first constraint draws with explicit infeasibility,
alternatives, unavoidable-conflict evidence, and deterministic adversarial replay.

## M3 — Production scheduler (reference gate passed)

- CP-SAT adapter, resource calendars, officials/equipment, locks, and closures
- Lower bounds, optimality gap, critical path, utilisation, and repair comparison
- Independent shadow verifier and solver mutation tests

Gate: `OPTIMAL` is emitted only with a solver proof; all feasible output revalidates.

Delivered: normalized immutable models for typed venue/official/equipment units,
calendars, closures, precedence, rest, and hard locks; exact/proof-bounded search
for small instances; honest solver outcomes; decomposed lower bounds; and a
mutation-tested independent validator. The scale adapter is pinned OR-Tools
CP-SAT with deterministic parameters, independent response validation,
differential tests against the exact solver, and an executed 128-task/8-resource
reference envelope. That envelope is evidence, not an arbitrary capacity claim.

## M4 — Operational truth and persistence (reference gate passed)

- Command/event model for Definition, Plan, Operational, and Actual states
- Append-only revisions, replay, idempotency, optimistic concurrency, corrections
- Durable database and outbox workers

Gate: concurrency and crash-recovery tests reconstruct identical state hashes.

Delivered: explicit immutable Definition/Plan/Operational/Actual aggregate state,
registered command/event transitions, result correction/void lineage, optimistic
concurrency, content-bound idempotency, tamper-evident event chains, atomic
transaction rollback, deterministic replay, and a leased retry/dead-letter outbox.
The live command layer additionally covers check-in, late/no-show/withdrawal,
walkover/retirement, actual timing, result receipt, resource outages, protests,
appeals, linked correction, and derived now/next/late/blocked/unreported queues.
A real PostgreSQL adapter and migration now provide transactional appends,
snapshots, forced tenant RLS, replay, optimistic concurrency, and content-bound
idempotency. It passed an isolated PostgreSQL 16.14 verification run; provisioning,
backup/PITR, identity, and production operations remain deployment work.

## M5 — Safe natural-language compiler (reference gate passed)

- Structured interpreter, ambiguity/default resolution, source citations
- Requirement completeness, adversarial critic, imported rulebook candidates
- Semantic plan/validate/simulate/apply workflow

Gate: paraphrase corpus compiles equivalently and injected prose cannot gain authority.

Delivered: a closed registered-grammar intent AST with exact citations,
paraphrase-stable semantic hashes, pinned default provenance, whole-prompt
injection rejection, a read-only requirement/quantifier critic, and quarantined
rulebook candidates that require review and still have no direct activation path.

## M6 — Best-in-class web product (reference gate passed)

- Rule inspector, visual graph, scenario lab, timeline, dry run, debugger, exports
- JTBD usability passes and accessible responsive states

Gate: directors complete core jobs from unfamiliar formats without hidden policy.

Delivered: an engine-backed responsive Studio with compiler, overview, graph,
schedule, visible-findings, and proof workspaces; deterministic organiser read
models; a live control room; a participant-facing schedule/revision view; immutable
scenario comparison; and independently re-certified human and machine export
bundles. Real-browser desktop/mobile checks cover navigation, semantic structure,
console health, and the operational API request. Public hosting remains gated with
production operations.

## M7 — Apple multiplatform client (reference gate passed)

- Shared SwiftUI target with platform-adaptive navigation and API-generated client
- Mac/iPad organiser workspace and focused iPhone operational flows
- Offline queue, conflict feedback, accessibility, App Store preflight

Gate: HIG checklist, accessibility audit, simulator/device tests, and parity contracts pass.

Delivered: a shared SwiftUI package and multiplatform Xcode app for iPhone, iPad,
and Mac; adaptive split/tab navigation; versioned fail-closed DTO/API boundaries;
deterministic demo mode; a server-authored live-operations experience; durable
offline commands with explicit conflict handling; native status, accessibility,
keyboard, privacy-manifest, sandbox, and app-icon support. Swift tests and iOS/macOS
builds pass. Physical-device and assistive-
technology evidence remains a release-environment gate, not a compiler gate.

## M8 — Integrations and production operations (reference gate passed)

- Krateasy/identity gateway, deployment, observability, security, backups, runbooks

Gate: certified truth crosses external boundaries idempotently and is recoverable.

Delivered: bijective provider identity maps; signed, versioned, deterministic
publication; strict inbound verification and replay/conflict rejection;
tenant-scoped deny-by-default authorization; separation of duties; mandatory
audit records; readiness, redacted telemetry, SLO/error-budget evaluation,
content-addressed backup manifests, restore verification, fail-closed production
API startup, a reference container, and incident/recovery runbooks. Live provider,
database, KMS, identity, backup, and hosting credentials remain deployment inputs.

## M9 — Guarded publication invariant (reference gate passed)

- One Competition Guard entry point over independent certification and validation
- Exact definition, specification, graph, schedule, simulation, rule and coverage bindings
- Normalised severities, operational acknowledgements and bottom-up capacity accounting
- Atomic certificate issuance and publication under one idempotent platform command
- Visible publication readiness in tenant-scoped organiser read models

Gate: a tournament cannot become published unless the exact approved revision has
a current, intact Guard report and hash-bound certificate. Invalid evidence,
stale definitions, incomplete acknowledgements and certificate tampering fail
closed without a partial event-store append.

Delivered: `PUBLISH_TOURNAMENT` accepts only identity, expected revision and
acknowledgements, loads tenant-bound authoritative artefacts, independently runs
Guard, enforces approval separation/freshness, and appends certificate, lifecycle
publication and outbox intent atomically. The legacy status and standalone
certification transitions fail closed. Tests exercise forged artefacts, missing
contests, stale revisions, mismatched hashes, cross-organisation IDs,
self-approval, exact acknowledgements, duplicate commands, restart/replay,
API-controlled identity and rollback on blocked publication.

## M10 — Calm recovery and critical-protocol assurance (reference gate passed)

- PostgreSQL outbox insertion inside the authoritative event transaction
- One outage/withdrawal proposal-to-impact-to-repair-to-approval interface
- Targeted communication drafts emitted only after independent approval
- Resilience ranking for resource loss, overruns, blast radius and critical slack
- Executable bounded model checking and portable TLA+ protocol specifications

Gate: invalid or unproven repairs never mutate operational truth; stale and
self-approved proposals cannot apply; hard-invalid schedules cannot win a
resilience comparison; and bounded publication, idempotency and approval models
contain no invariant counterexample.

Delivered: `PROPOSE_LIVE_CHANGE` and `DECIDE_LIVE_CHANGE` compose append-only live
truth, proof-bounded repair, impact calculation and approved outbox delivery. The
resilience ranker evaluates deterministic scenario evidence without modifying
the scheduler's hard-constraint authority. The executable model checker explores
49 unique states and 133 enabled transitions across the three registered models,
while a deliberately unsafe model proves shortest-counterexample reporting.
