# TournamentOS universality program — delivery and truth report

Date: 2026-09-06

## Executive outcome

This milestone closes the enum-only format gap. All 16 stage primitives declared
by the canonical TournamentSpec schema are now executable, deterministic,
independently verified, and connected to a primary certified path inside explicit
evidence envelopes. The capability ledger therefore reports:

| Truth level | Count |
|---|---:|
| Native | 16 |
| Composable | 0 |
| Extension required | 0 |
| Unsupported declared primitives | 0 |

Capability-ledger proof:
`c687fe54a661d8a410400b03e444f7f24d26880100335d5cb37dfc5af88b03d6`

This is a strong compiler milestone, not an “any sport, any format, any
complexity” claim. Native means that the registered primitive works through its
published path and tested bounds. It does not mean that every governing-body
rulebook, prose variation, field size, infrastructure topology, or computationally
unbounded constraint problem has been solved.

## Native format surface

| Family | Native primitives | Important evidence boundary |
|---|---|---|
| League and pool | groups, single round robin, double round robin, league table | Configured registered standings policies; common fields tested through 64 entrants |
| Knockout | single elimination, consolation, double elimination, repechage, play-in, placement | Explicit loser ports, byes, reset policy, classification provenance, and cardinality checks |
| Dynamic | Swiss, ladder, qualifying heat, time trial, ranking stage | Transactional SQLite operations, production scheduler seam, replay, and certification |
| Extensible topology | custom graph | Versioned MATCH/BYE DAG, structural validation, namespace isolation, and a primary certified fixture |

The exact per-primitive envelopes remain machine-readable in
`format-capabilities.ts`; capability truth is derived from registered execution
evidence rather than from schema declarations.

## What this milestone delivered

### 1. Primary static-format completion

Double elimination and repechage now execute through the primary graph,
scheduler, simulation, and certification path. Grand-final reset behavior is an
explicit `NEVER` or `IF_NECESSARY` rule rather than a hidden convention.

Play-ins now perform an exact, explicit single-round reduction into a main draw.
Placement stages use versioned source-contest/outcome/place definitions. Custom
graphs compile a versioned MATCH/BYE DAG and reject dangling ports, cycles,
fan-out, loser-from-bye paths, malformed seed identity, and namespace collisions.

### 2. Primary dynamic-format completion

Swiss, ladder, qualifying heat, time trial, and generic ranking stages now have
canonical TournamentSpec configuration and a primary orchestration layer. It:

- accepts only transactional persistence;
- previews every contest through the production schedule solver and independent
  schedule validator before appending it;
- uses optimistic concurrency and content-bound idempotency;
- rebuilds authoritative state from ordered events rather than trusting snapshots;
- emits deterministic, hash-bound dynamic-stage certification.

The SQLite adapter uses normalized tables, WAL mode, a busy timeout, database
constraints, and `BEGIN IMMEDIATE` arbitration. Tests exercise two connections
and a literal child process racing the same expected version. Snapshots remain a
disposable cache; event corruption fails closed. This is embedded transactional
persistence, not yet a distributed cloud database claim. Encryption and fsync
guarantees are deliberately not fabricated.

### 3. Advanced Swiss correctness

Swiss final ranking now supports registered, versioned policies for Buchholz,
median Buchholz, Sonneborn-Berger, cumulative/progressive score, and a head-to-head
mini-league only when every tied entrant has played every other member. Incomplete
results and unresolved final ties use explicit reject, provisional, or shared-rank
policies. Corrections and voids trigger a deterministic re-rank without rewriting
history.

The dedicated exhaustive corpus covers all 729 outcome combinations of a
four-player, three-round chess-like schedule, plus ordering metamorphisms and
proof-tamper checks.

### 4. Pool construction and allocation

A proof-bounded pool constructor now supports:

- exact target pool sizes, including unequal declared sizes;
- fixed placement, separation, together, and per-attribute limits;
- lexicographic balancing of pool size, seed strength, and same-attribute spread;
- `OPTIMAL`, `FEASIBLE`, `INFEASIBLE`, `UNKNOWN`, and `REJECTED` as distinct truth;
- independent reconstruction and proof-hash verification.

Its published envelope is 64 entrants, 16 pools, and at most 10,000,000 search
nodes. A deterministic seed-balanced incumbent remains usable as `FEASIBLE` when
exact optimization reaches its bound; a cutoff is never mislabeled infeasible.

Primary pool stages now execute their declared snake, pinned-random, manual, or
optimized allocation and record a versioned stage proof. The primary optimized
adapter currently balances size and seed. The richer constructor constraints are
available as a verified engine and remain to be exposed in the full
TournamentSpec/organiser workflow.

### 5. Registered deterministic randomness

Random and optimized draws no longer use a generic pseudo-random placeholder.
They require an explicit algorithm and seed, and execute versioned xoshiro128** or
PCG32 with SHA-256 little-endian seeding and unbiased bounded integers. Stable
hard-coded vectors prove replay identity and the draw proof binds the chosen
algorithm, version, seed, and placement.

### 6. Primary declarative qualification

The proof-carrying qualification engine now supports ranking points,
elapsed time, score thresholds, generic comparisons, percentages, weighted
SUM/AVERAGE aggregates, best-N with runner-up restriction, approved wildcard and
host selections, and remainder selection. Selectors execute sequentially with
global uniqueness and exact provenance. Cutoff ties must explicitly reject,
include all, or use candidate-id order.

The engine is bounded to 4,096 candidates, 128 selectors, and 32 aggregate terms.
Its exhaustive and metamorphic test corpus executes 1,926 cases. Its complete
selector vocabulary is now part of canonical TournamentSpec, type-checked, and
routed through the primary `qualify` path with independent verification and proof
propagation. Multiple policies can safely append into one destination, cross-stage
global exclusions are intersected with the active candidate universe, and any
later policy failure transactionally removes partial entrants, evidence, and
proofs for the affected destination. Declarative and legacy selector families
cannot mix except for a sequential remainder; unknown or non-numeric standing
metrics reject.

### 7. Cross-sport semantic breadth

The registered policy seam now covers:

- football-like score and points policies;
- tennis/padel and volleyball-like completed best-of series, including win by two;
- chess registered score domains;
- athletics/swimming distance and lower-is-better time results;
- combat decisions, disqualification, no-contest, and explicit repechage outcome;
- motorsport ordered finish with DNS/DNF/DQ/DSQ;
- judged panels with declared high/low drops and SUM/BEST aggregation;
- relay and team roster validation;
- scoreless walkovers and explicit non-result truth.

The implementation branches on registered result and policy shapes, not on sport
names. Unknown policies, domains, shapes, or tie semantics reject.

### 8. Governed sport rule packs

A versioned, hash-bound registry now sits above the semantic adapters. Each rule
pack declares an owner, approval authority, jurisdiction, semantic version,
effective/expiry dates, exact adapter/policy reference, and engine/API
compatibility. Content, approval evidence, lookup, and governed evaluation are
independently hashed. Unknown, expired, premature, unapproved, unauthorized,
tampered, incompatible, malformed, duplicate, and wrong-jurisdiction packs reject.

Illustrative approved fixtures cover football, racket competition, chess,
athletics, swimming, combat, motorsport, and judged team competition. They are
explicitly marked software-conformance examples—not official federation rules or
certification. The registry envelope is 10,000 packs and 100 versions per pack ID.

### 9. Executable capability conformance

The capability ledger is now audited by a canonical executable fixture for every
declared primitive: 11 static fixtures use the real primary scenario pipeline and
five dynamic fixtures use fresh transactional SQLite stores. The audit proves
ledger-to-fixture closure, deterministic replay, immutable evidence, explicit
scale statements, safe entrant-order metamorphisms where semantics permit them,
and rejection when any fixture is omitted.

- Status: CERTIFIED
- Fixtures: 16/16
- Ledger entries: 16/16
- Findings: 0
- Audit hash: `31b4ff96c91da6a573f99235aaefb2c442e6f2610713371aeb45b75c79d6df50`

This closes the mapping at canonical fixture sizes; the larger dedicated corpora
remain the authoritative scale evidence.

### 10. Existing solver, verification, and safety foundation

The pinned OR-Tools CP-SAT adapter remains independently revalidated by
TypeScript and differentially checked against exact small solutions. Its executed
reference envelope is 128 tasks, 8 resources, a 1,440-minute horizon, and 127
precedence edges. Missing OR-Tools, timeout, version drift, malformed worker
output, and partial search remain `UNKNOWN`; only an exhausted proof may report
`INFEASIBLE`.

The compiler continues to maintain separate Definition, Plan, Operational, and
Actual truth; immutable event and adjudication lineage; requirement provenance;
tenant authorization; signed integration envelopes; safe registered-language
interpretation; shadow schedule validation; and proof-bearing export.

## Reproducible evidence

### Full workspace gate

- TypeScript composite build: PASS
- TypeScript tests: 337/337 PASS
- Apple Swift/XCTest and Swift Testing: 17/17 PASS
- Primary declarative-qualification integration: 11/11 PASS
- Capability-conformance audit tests: 4/4 PASS
- Governed rule-pack tests: 5/5 PASS
- Failed, skipped, and cancelled tests: 0

### One-million-trial static campaign

- Status: CERTIFIED
- Seeded trials: 1,000,000
- Unique registered catalogue cases: 142/142
- Deterministic replay checks: 142
- Invariant checks: 3,000,000
- Violations: 0
- Envelope: round robin 2–64; power-of-two double elimination 2–64 with
  both reset policies; quarterfinal repechage 8–64
- Proof: `944bf8a73e9d6a3da4dba831d5389bc451c5fd3bd24632a0213cfd04af8c30e4`

The million figure is trial volume, not a false claim of one million unique
structures.

### Whole-spec bounded grammar

- Status: CERTIFIED
- Cases: 420/420
- Metamorphic relations: 1,222
- Counterexamples: 0
- Participants: 2–8
- Structures: single elimination, single round robin, groups to elimination, and
  groups to two destinations
- Resources: one or two
- Scheduling: open, hard lock, split-availability closure
- Result truth: completed, walkover, withdrawal, eligible partial withdrawal
- Grammar hash: `21cb3236c259ea92a9824b78605a909ac031be581c515423beaaa58cca8526f3`
- Proof: `104f20441f61c9ef808ce4cbec5b38e9694861c6d3bacc61099966ed449ab0e0`

This grammar is exhaustive only for the finite dimensions listed above. Other
native primitives have dedicated bounded corpora; they have not all been folded
into one combinatorial whole-spec generator.

## Product, Jobs-to-be-Done, and Apple lens

The core organiser job is now clearer: describe the competition, see exactly
which semantics are understood, obtain a viable plan with counterexamples and
why-not evidence, operate it without overwriting history, and publish only
certified truth. Complexity is surfaced as explicit policies, scale envelopes,
and rejected ambiguity rather than buried behind format labels.

The monorepo remains the right architecture. TypeScript owns competition truth,
proofs, and versioned DTOs. Web and the shared native SwiftUI iPhone/iPad/Mac
client consume those DTOs; clients do not reimplement tournament logic.

The Apple client remains a native SwiftUI application with durable offline
commands, explicit loading/empty/failure states, textual status, reduced-motion
handling, 44-point iOS targets, a privacy manifest, and a sandboxed macOS
entitlement set limited to outbound networking. The latest 17-test Apple gate is
green. Store submission still requires real service URLs, signing, metadata,
screenshots, reviewer access, physical-device and assistive-technology evidence,
privacy/support URLs, and account-deletion/Sign in with Apple compliance where
applicable.

## Remaining roadmap, in order

1. **Expose rich pool construction.** Add hard constraints and objective priorities
   to the schema and organiser Studio, preserve approval/provenance, and compile
   them through the primary optimized allocation path.
2. **Expand dynamic operations.** Support walkovers, protests/appeals, correction
   of earlier Swiss rounds with explicit downstream invalidation/recompilation,
   and safe rescheduling of affected contests.
3. **Broaden the universal evidence generator.** Extend the canonical conformance
   audit into successive bounded Cartesian grammars spanning every native static
   and dynamic primitive, qualification selector, pool constraint, correction
   state, and conditional branch, with shrinking counterexamples and deliberate
   mutation testing.
4. **Commission official rule packs.** Replace illustrative packs with versioned,
   owner-approved federation fixtures for chosen sports and formats. Generic
   semantics do not substitute for each sport’s complete current rulebook.
5. **Prove production scale.** Run measured load, chaos, recovery, and larger solver
   campaigns on target infrastructure; add a distributed transactional adapter
   when multi-node operation is required.
6. **Complete environment-owned beta work.** Provision production database,
   identity, keys, backups, ingress, observability, privacy operations, and hosting;
   obtain the real Krateasy contract and credentials; execute contract/security/
   accessibility tests; sign and submit Apple builds.

No additional prompt series is required to continue the internal roadmap. The
requirements and next milestones are now explicit in code and evidence. External
deployment, provider integration, legal/privacy choices, and App Store submission
will require the corresponding accounts, contracts, credentials, and approvals.
