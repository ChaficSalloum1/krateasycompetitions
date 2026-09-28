# Krateasy Competitions — architecture authority

Status: ACTIVE. Read [DOMAIN.md](DOMAIN.md) for semantics and [BUILD_PLAN.md](BUILD_PLAN.md) for sequencing.

## One kernel; independent verification

The existing `packages/tournament-schema` owns executable representation/versioning contracts; `packages/competition-engine` implements domain producers, assurance, Guard and execution. Logical independence of validation is required even when producer and validator reside in the same package. A validator must re-derive critical facts rather than call the producer to endorse itself. No folder reorganisation is required by this contract.

`apps/compiler-web` composes source intake, organiser commands and projections against that core. The browser presents source facts, explicit decisions and revision-bound artefacts and submits commands; it does not become an alternate kernel, evidence authority or persistent competition truth.

## Domain integration boundary

P&K source → P&K format configuration → canonical Competition Definition → Krateasy compiler → independent Guard → approved schedule and domain projections → P&K application.

The bridge is a versioned domain contract, never shared database tables. P&K-specific adapters normalise source/configuration. General engine code must not special-case P&K qualification. Future P&K clients ask the core for qualification, draw, schedule and progression. Existing live P&K ownership changes only through H, I and J.

## Pipeline ownership

| Boundary | Owner | Evidence |
|---|---|---|
| Source → facts | Source intake | Exact source version, extracted location, conflicts/failures |
| Facts → proposed Definition | Interpretation | Claim provenance, explicit decisions, assumptions, interpreter version |
| Approved Definition → graph | Compiler | Definition/rule versions, graph/dependency identities, failure scope |
| Results → classification | Standings | Valid-result set, policy versions, unresolved ties |
| Classification → qualifiers | Qualification | Population, comparison policy, selected identities and reasons |
| Qualifiers → seed/tier | Seed assignment | Separate governed order; selection unchanged |
| Count/policy → empty bracket | Topology | Slots, byes/play-ins and resolvable progression |
| Qualifiers + seeds + topology → draw | Placement | Constraints, conflicts and bounded search/proof status |
| Graph + commitments → schedule | Scheduler | Candidate, solver status/evidence, tradeoffs |
| Exact artefacts → findings | Run Assurance | Independently derived counterexamples and exact hashes |
| Protected command → decision | Guard | Fresh evidence, actor/revision checks and atomic outcome |

The Phase A inspector exposes SOURCE, FACTS, DEFINITION, GRAPH, QUALIFICATION, DRAW, SCHEDULE, GUARD. Detailed classification/seeding/topology/approval/lock sub-boundaries remain distinguishable; a short inspector label is not permission to merge owners.

## State and command boundary

Definition, Plan and Reality are distinct. OperationalRevision adjusts future execution against preserved published/actual history. Immutable revisions and versioned rule packs support replay. Protected writes load authoritative artefacts on the server, verify actor and expected revision, validate/simulate, independently assure, then commit state/history/outbox atomically. Return domain failures without partial changes. A client hash or assurance report cannot authorise a write.

ResourceCommitment is the sole bridge from facility availability to competition scheduling. Public projections have no command authority. Provider imports are facts awaiting validation.

## Existing implementation to reuse, not completeness claims

| Concern | Existing locations to inspect in its slice |
|---|---|
| Canonical types/hash/revision | `packages/tournament-schema/src/` |
| Compiler/graph | `packages/competition-engine/src/compiler.ts`, `graph.ts` |
| Standings/qualification | `standings.ts`, `qualification.ts`, `declarative-qualification.ts` under engine src |
| Topology/draw | `topology-compiler.ts`, `draw-constraints.ts`, `draw.ts` under engine src |
| Scheduler/solver | `schedule-model.ts`, `schedule-solver.ts`, `cp-sat-solver.ts` under engine src |
| Independent verification | `competition-guard.ts`, `guard-path-reconstruction.ts`, `independent-entrants.ts` under engine src |
| Revision/runtime/recovery | `event-store.ts`, `live-operations.ts`, `adjudication.ts`, `schedule-repair.ts`, `live-change.ts` under engine src |
| Intake/journey | `apps/compiler-web/src/creation-source-ingestion.ts`, `competition-workbench.ts`, `competition-journey.ts` |

These are navigation pointers, not verified acceptance evidence. Reconcile implementation discrepancies in the responsible slice and record them. Never treat an existing API name (for example `PUBLISH_TOURNAMENT`) as a second domain concept: any adapter to canonical `PUBLISH_COMPETITION` must preserve the same protected semantics and be tested when in scope.

## Scope control

Current changes belong to Phase D, scoped by docs/D_COURT_LOCK_SLICE.md and docs/D_REVIEW_GATE.md. Draft controls reuse core producers and independent validators. They do not confer publication authority or close the E/F/G gates. A1 documentation-only restrictions describe that completed ticket. Technical operating instructions remain reference material to consult when needed; this reset never authorises removal of existing security or correctness protections.
