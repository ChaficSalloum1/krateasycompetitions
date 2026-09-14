# Krateasy Competitions requirements traceability

Audit date: 14 September 2026
Baseline commit: `38d92ec`
Authorities: A1–A9 in `PRD-Krateasy-Competitions-Execution-Control.md`

## Audit method and status rules

This is an executable-path audit, not a filename inventory. A requirement is **Implemented and connected** only when the authoritative create/operate journey exercises it. Passing unit or reference-fixture evidence without that path is **Implemented but disconnected** or **Reference/demo only**. No requirement is deprecated without a decision record; none currently has one.

Verification evidence:

- `npm run check`: TypeScript build passed; 480 tests passed, 0 failed after the server-owned publication migration.
- `swift test --package-path apps/apple-client`: Mac package built; 23 tests passed, 0 failed after the connected API contract was added. The first sandboxed invocation was blocked by nested SwiftPM sandboxing; the unchanged escalated run passed.
- `xcodebuild -project apps/apple-client/TournamentOSClient.xcodeproj -scheme TournamentOSClient -configuration Debug -destination 'platform=macOS' -derivedDataPath /private/tmp/krateasy-publication-mac-derived build`: `BUILD SUCCEEDED`.
- The pre-implementation source was preserved without dependencies, generated output, build caches, local Xcode state, or secrets in baseline commit `38d92ec`.

Connected-slice evidence: `authoritative-publication.test.ts` exercises the public API and direct platform boundary against forged artefacts, coordinated missing contests, stale revisions, corrupted hashes, cross-organisation artefact IDs, compiler/approver and approver/publisher identity collisions, incorrect acknowledgements, duplicate commands, and restart/replay. `competition-journey.test.ts` creates a fresh draft, compiles 98 contests, independently reruns Guard, atomically seals approval/publication/outbox evidence, and reopens the identical published revision through a fresh repository instance. `APIClientTests.swift` proves the Mac sends source facts and then only competition identity, expected revision and acknowledgements; it never sends a specification, graph, schedule, simulation or Guard report. A live built-macOS rehearsal created `publication-boundary-rehearsal.1570667365`, published exact revision `1`, and opened `/competitions/publication-boundary-rehearsal.1570667365`. The Mac read back 47 entrants/98 matches and Certified evidence; the browser showed the identical ID/revision as `PUBLISHED`, Guard `PASSED`, 98 required/scheduled contests, Guard hash `c5b8c48a1852d002f155fe623deca14716169aea1641320e23c2dc88083c1b9e`, definition hash `64e3eb6a1330059f632324fd04db13058816c50f3dfbbf107a6dec405269ac7d`, publication certificate hash `8654272d46ad46e0a24ec35baea305d91314a7aaabe4f7c3837be532aefef972`, and outbox key `publication-boundary-rehearsal.1570667365:v1`.

## Runtime truth and duplicated-state inventory

| Runtime path | Owning files | Audit status | Evidence and consequence |
|---|---|---|---|
| Canonical schema → graph → schedule → simulation → certification | `packages/tournament-schema/src/*`; `packages/competition-engine/src/scenario.ts`; `apps/compiler-web/src/competition-journey.ts` | Implemented and connected | The declared P&K milestone now takes a fresh language/quick proposal through the existing compiler, scenario and Guard. Other formats remain outside this slice. |
| Production-style `/v1/tournaments` reads | `apps/compiler-web/src/server.ts` | Partial | Persisted journey revisions now project through the same versioned Mac read contract; the legacy reference fallback still rebuilds `runReferenceDemo()` and must be retired. |
| Web creation proposal | `apps/compiler-web/src/{creation-proposal,competition-journey}.ts` | Partial | Language/quick/JSON normalize to `CompetitionBlueprint`; language and quick now reach the declared P&K compiler envelope. YAML/XLSX/duplicate are absent. |
| Web guided creator | `apps/compiler-web/src/ui.ts:17,35-39`; `packages/competition-engine/src/platform.ts:674-728` | Reference/demo only | Writes an ad-hoc guided `JsonValue` into the in-memory demo aggregate, not the canonical compiler input. |
| Registered language grammar | `packages/competition-engine/src/intent-compiler.ts:67`; `apps/compiler-web/src/server.ts:218-250` | Implemented but disconnected | Proposal-only and separate from `creation-proposal.ts` and legacy `compiler.ts`. |
| Legacy English interpreter | `packages/competition-engine/src/compiler.ts:31-90` | Implemented but disconnected | Third overlapping interpreter; used by engine tests, not the customer journey. |
| Seeded platform pilot | `apps/compiler-web/src/platform-demo.ts:78-254` | Reference/demo only | Preloads Play & Konnect, separately authors two live contests, then rehearses publish/repair. |
| Participant `/next` and delivery | `apps/compiler-web/src/participant-attention.ts`; `server.ts:79-94` | Reference/demo only | Mutable singleton is not rebuilt from the platform publication/live head. |
| Mac creation | `apps/apple-client/.../{AppShell,FeatureViews}.swift` | Partial | The local compiler workspace now supports Describe/Quick, server interpretation review, editable required facts, visible assumptions, compile, Guard review, exact server publication and web opening. Demo workspaces intentionally retain honest revision-zero local drafts. Import/duplicate/offline writes remain. |
| Mac network client | `apps/apple-client/.../TournamentAPIClient.swift`; `APIClientTests.swift` | Implemented and connected | Staged write/read DTOs preserve one server identity and revision; the contract test proves no proposer-owned Guard artefacts cross the boundary. |
| Mac offline journal | `apps/apple-client/.../OfflineCommandQueue.swift` | Implemented but disconnected | Queue semantics are tested, but only in-memory persistence exists and nothing wires it into the app/API. |
| Organisation platform/event store | `packages/competition-engine/src/platform.ts`; `event-store.ts`; `postgres-event-store.ts` | Partial | `PUBLISH_TOURNAMENT` accepts identity/revision/acknowledgements only, loads tenant-bound authoritative artefacts, independently reruns Guard, enforces compiler/approver/publisher separation and approval freshness, and atomically appends publication plus its outbox intent. Broader platform compilation ownership remains incomplete. |
| Dynamic competitions | `dynamic-stage-*`; `dynamic-format.ts` | Implemented but disconnected | Swiss/ladder/heat/Americano engines are tested outside the normal organisation competition lifecycle. |

Five historical creation truths still overlap: `CompetitionBlueprint`, registered intent AST, legacy `IntentAst`, guided platform `JsonValue`, and Swift `LocalTournamentDraft`. The new journey deliberately persists `CompetitionBlueprint` rather than adding another competition definition; Swift uses transport DTOs only. The remaining four divergent authoring paths still need migration or retirement decisions.

## Evidence key

| Key | Owning module and executable evidence |
|---|---|
| SCHEMA | `packages/tournament-schema/src/{types,compile,validate,type-checker,revisions,semantic-diff}.ts`; `packages/tournament-schema/test/schema.test.ts` |
| NL | `packages/competition-engine/src/{intent-compiler,compiler,compiler-critic}.ts`; corresponding tests; `apps/compiler-web/test/creation-proposal.test.ts` |
| GRAPH | `packages/competition-engine/src/{graph,pool-construction,pool-allocation,qualification,topology-compiler,draw-constraints}.ts`; engine/topology/pool/draw tests |
| SCHEDULE | `packages/competition-engine/src/{schedule-model,scheduler,schedule-solver,cp-sat-solver,lower-bounds,scheduling-quality}.ts`; scheduler/CP-SAT/adversarial tests |
| GUARD | `packages/competition-engine/src/{competition-guard,certification,platform}.ts`; `competition-guard.test.ts`; `authoritative-publication.test.ts` |
| SIM | `packages/competition-engine/src/{simulation,monte-carlo,operational-chaos}.ts`; simulation/chaos tests |
| LIVE | `packages/competition-engine/src/{live-operations,live-change,schedule-repair,tournament-state,adjudication}.ts`; matching tests |
| PLATFORM | `packages/competition-engine/src/{event-store,platform,platform-api,postgres-event-store}.ts`; platform/API/event/concurrency/authoritative-publication tests |
| CAPS | `packages/competition-engine/src/{capability-ledger,capability-conformance,format-capabilities,sport-semantics,sport-rule-packs,static-formats,dynamic-format}.ts`; conformance tests |
| ASSURANCE | `packages/competition-engine/src/{bounded-verification,generative-campaign,lifecycle-fuzz,whole-spec-verification,restore-drill}.ts`; matching tests |
| WEB | `apps/compiler-web/src/*`; `apps/compiler-web/test/*` |
| MAC | `apps/apple-client/Sources/TournamentOSClientCore/*`; `apps/apple-client/Tests/TournamentOSClientCoreTests/*` |

## A1 master specification: M00–M60

| ID | Source section | Plain-language requirement | Job / owner / surface | Status | Evidence, gap, phase |
|---|---|---|---|---|---|
| M00 | A1 §0 | English must traverse intent, ambiguity, canonical spec, validation, graph, schedule, simulation and certification. | J2–J6; journey/core; Mac+web | Partial | Connected for the explicit P&K milestone in `competition-journey.ts`; the general grammar and other formats are not yet connected. Stage 1–2. |
| M01 | A1 §1 | Produce the complete organiser blueprint and support non-destructive English change. | J3–J6; blueprint; Studio | Partial | `blueprint-view.ts`, semantic revisions; no complete fresh-input blueprint or connected modify flow. Stage 1–2. |
| M02 | A1 §2 | One engine for scenario, live, API and clients. | All; core; all | Partial | Mac and web creation now call the existing schema/scenario/Guard core; legacy guided/demo/public/live worlds remain separate. Stage 1–2. |
| M03 | A1 §3 | Keep qualification, seeding, topology, placement and scheduling separate; mark HARD/SOFT. | J4–J5; core; evidence | Implemented but disconnected | SCHEMA/GRAPH/SCHEDULE tests. Stage 1. |
| M04 | A1 §4 | Immutable, versioned canonical IR with hashes and provenance. | J3/J6; schema; all | Implemented and connected | The journey persists a sealed proposal and immutable compiled revision with spec/graph/schedule/simulation/Guard/approval/publication hashes and an exact-revision outbox intent; production storage adapter remains Stage 2. |
| M05 | A1 §5 | Sport is data; head-to-head and ranked performance are supported. | J12; sport packs; rules | Implemented but disconnected | CAPS conformance across named sports; creator does not resolve submitted sport to packs. Stage 4 gate: domain review. |
| M06 | A1 §6 | Composable participation, stage, qualification, bracket and resource primitives. | J4/J5/J12; core | Implemented but disconnected | CAPS and 16 primary primitive conformance fixtures. Stage 4 evidence gate. |
| M07 | A1 §7 | Static formats compose as DAGs without one assumed shape. | J4/J12; graph | Implemented but disconnected | GRAPH custom/static tests. Stage 1. |
| M08 | A1 §8 | Registered dynamic interface including result-dependent Americano. | J12; dynamic core | Implemented but disconnected | `dynamic-stage-*`, Americano tests; no platform binding. Deferred: after connected static slice and dynamic historical fixture gate. |
| M09 | A1 §9 | Staged extraction/interpretation and explicit ambiguity classes. | J2/J3; interpreter; creation | Partial | NL narrow grammar; web proposal re-parses separately and does not create spec. Stage 1. |
| M10 | A1 §10 | Every inference has inspectable origin and uncertainty class. | J3; ledger; review | Partial | Schema/intent evidence exists; web/Mac creation omit formal rule mapping. Stage 1. |
| M11 | A1 §11 | Compile safely as far as possible, ask only material decisions, recompile. | J3; journey; creation | Partial | Exact questions, versioned draft revision and re-review are connected on Mac; field-level decision commands and general partial compilation remain. Stage 1–2. |
| M12 | A1 §12 | Validated declarative DSL; never arbitrary executable policy. | J3/J12; schema/packs | Partial | Typed JSON/registries fail closed; YAML/editor equivalence is missing. Stage 1/4. |
| M13 | A1 §13 | Explicit rule priority and conflict evidence. | J4; draw | Implemented but disconnected | GRAPH draw-constraint tests. Stage 1. |
| M14 | A1 §14 | Pool optimiser returns chosen/alternative structures and proof. | J4; pool core | Implemented but disconnected | Pool construction/allocation tests; no fresh journey call. Stage 1. |
| M15 | A1 §15 | Composable deterministic standings metrics. | J4/J12; standings | Partial | Core, Swiss and sport metrics exist but are not one connected registry in creation. Stage 1/4. |
| M16 | A1 §16 | Unequal pools require explicit normalisation; never raw totals. | J4; standings/Guard | Partial | Missing normalisation blocks; runtime implements `per_match`/`percentage` while schema advertises additional unsupported strategies. Stage 1; fail closed. |
| M17 | A1 §17 | Identity-free topology with arbitrary counts, byes/play-ins/conditionals. | J4; topology | Implemented but disconnected | Exhaustive 2–64 topology/nasty tests. Stage 1. |
| M18 | A1 §18 | Draw returns placement, alternatives, violations and replay proof. | J4; draw | Partial | Strong constraints/proofs; manual placement and consistent journey use incomplete. Stage 1–2. |
| M19 | A1 §19 | All possible participant dependencies constrain earliest starts. | J4/J5; graph/scheduler | Implemented but disconnected | GRAPH/SCHEDULE path tests. Stage 1. |
| M20 | A1 §20 | Scheduling is explicit hard/soft optimisation behind an abstraction. | J5; scheduler | Partial | Typed exact/CP-SAT exist; default `runScenario` uses the simpler scheduler. Stage 1, then envelope validation. |
| M21 | A1 §21 | Explain resource, dependency, participant and restricted-resource lower bounds. | J5/J6; evidence | Implemented but disconnected | `lower-bounds.ts` tests; fresh journey does not surface it. Stage 2. |
| M22 | A1 §22 | Model rest/thermal/wait quality, not collision only. | J5; quality | Partial | Wait/back-to-back metrics exist; warm-up/court-change/max-consecutive and unified score incomplete. Stage 2. |
| M23 | A1 §23 | Classify/explain every resource interval and avoid mysterious idle. | J5; quality | Partial | Several states audited; held/rest-blocked distinctions and Guard integration missing. Stage 2. |
| M24 | A1 §24 | Structural, deterministic, random, adversarial and Monte Carlo dry runs use production logic. | J6/J9; simulation | Implemented but disconnected | SIM/ASSURANCE fixtures. Stage 2. |
| M25 | A1 §25 | Dry run executes/replays the real event state machine. | J6/J11; state | Partial | Graph simulator, live state and platform event model are separate. Stage 2–3. |
| M26 | A1 §26 | Universal invariants plus additive format/sport invariants. | All; Guard/core | Partial | Distributed strong checks; no single registry invoked by every write. Stage 1–3. |
| M27 | A1 §27 | Large generated property space proves conservation/termination/replay. | J12; assurance | Implemented but disconnected | ASSURANCE/campaign/property tests. Permanent release gate. |
| M28 | A1 §28 | Differential/metamorphic properties for resources/rest/IDs/seeds. | J12; assurance | Implemented but disconnected | Bounded and whole-spec metamorphic tests. Permanent release gate. |
| M29 | A1 §29 | Permanent P&K, Americano and generic historical regression corpus. | J12; fixtures | Implemented but disconnected | Both benchmark families and generic fixtures pass; product exposes only seeded P&K. Permanent gate. |
| M30 | A1 §30 | Staged certification state and structured report. | J6; Guard; review | Partial | Guard and solver states exist, not the full staged certification lifecycle. Stage 2. |
| M31 | A1 §31 | Deterministic `why()` for every consequential output. | J4–J6/J9; evidence | Partial | Proofs/debug IDs are widespread; comprehensive connected query is absent. Stage 2. |
| M32 | A1 §32 | Counterfactuals clone revisions and show diffs. | J6; scenarios | Implemented but disconnected | `scenario-comparison.ts`; UI uses fixed demo options. Stage 2. |
| M33 | A1 §33 | Human blueprint and machine spec/graph/schedule/certificate export. | J6/J11; export | Partial | `blueprint-view.ts`, `export-bundle.ts`; not from a fresh journey. Stage 2–3. |
| M34 | A1 §34 | Interactive understood/decision/choice/feasibility UI with progressive evidence. | J2–J6; Studio | Reference/demo only | `/lab` always shows reference P&K. Stage 1–2. |
| M35 | A1 §35 | English, visual graph and advanced editor round-trip one IR. | J3/J4; Studio | Partial | Graph display exists; editing/round-trip does not. Deferred entry gate: connected canonical draft plus observed expert need. |
| M36 | A1 §36 | Stable machine-readable compiler errors/warnings. | J3/J5; core | Implemented but disconnected | TSC/TSV/TSW evidence; creation has another question model. Stage 1. |
| M37 | A1 §37 | Infeasible requests receive nearest viable alternatives requiring approval. | J5/J9; repair | Partial | Schedule repair strong; general spec repair narrow. Stage 2–3. |
| M38 | A1 §38 | Versioned sport-adapter registry without product forks. | J12; packs | Implemented but disconnected | CAPS. Stage 4 conformance gate. |
| M39 | A1 §39 | Immutable versioned format packages bind defaults, validators, engines, tests and hints. | J12; packs/templates | Partial | Registries/platform templates exist; full package/migration binding incomplete. Stage 4 authority gate. |
| M40 | A1 §40 | Unsupported primitives fail explicitly; extensions are registered and deterministic. | J12; registries | Implemented but disconnected | CAPS/rulebook/dynamic/static fail-closed tests. Permanent gate. |
| M41 | A1 §41 | Persist compiler/runtime entities while keeping artefacts distinct. | J6/J11; platform | Partial | Many values exist, but compilation/simulation/proof records are not all authoritative persisted entities. Stage 1–3. |
| M42 | A1 §42 | Preserve Definition, Plan, Operational and Actual truth. | J8–J11; state | Implemented but disconnected | `tournament-state.ts` tests; platform lifecycle does not use it end to end. Stage 3. |
| M43 | A1 §43 | Competition truth is independent; integrations use explicit identity mapping. | J12; gateway | Implemented but disconnected | Signed integration gateway tested; production provider absent. Deferred to measured integration need. |
| M44 | A1 §44 | Command-oriented interpret→compile→validate→publish APIs. | J2–J6; journey/API | Partial | `/v1/competition-journey` exposes strict create/revise/compile/publish/read commands; legacy platform, pilot and web publication use the same identity/revision/acknowledgement-only contract and project only published truth through `/v1/tournaments`. Authenticated production composition is still required. Stage 2. |
| M45 | A1 §45 | Pure domain packages without UI/database/current-time/random leakage. | J12; architecture | Partial | UI separated, but one large engine package also owns persistence/integration. No split until stable journey seam. |
| M46 | A1 §46 | Same pinned inputs/versions/seed produce same outputs/proofs. | J11/J12; core | Implemented but disconnected | Canonical hash/replay/metamorphic tests. Permanent gate. |
| M47 | A1 §47 | AI interprets/explains/proposes only; deterministic code owns truth. | J3; AI boundary | Partial | Proposal is non-executable but disconnected; no cloud/on-device AI configured. Stage 1. |
| M48 | A1 §48 | Treat prompt/rulebooks as hostile; block code/authority/policy attacks. | J3/J12; security | Implemented but disconnected | Injection/quarantine/tenant tests. Permanent gate. |
| M49 | A1 §49 | Imported rulebooks retain citations, map to IR and require approval. | J2/J12; import | Partial | Cited candidate quarantine/review exists; PDF/site ingestion→pack absent. Deferred authority and corpus gate. |
| M50 | A1 §50 | Unit/integration/golden/property/regression/concurrency/replay/solver/compiler/mutation gates. | All; assurance | Broad 480-test TypeScript suite plus 23 Swift tests; no mutation runner/config found. Permanent gate; add mutation evidence. |
| M51 | A1 §51 | Solver cannot certify itself; shadow validation is independent. | J5/J6; Guard | Implemented and connected | Fresh journey uses scheduler shadow validation and a separate Guard pass; KCG003/KCG004 independently derive contest cardinality from spec. Deeper independent graph reconstruction remains under G01. |
| M52 | A1 §52 | Store honest solver identity/status/objective/bound/gap/hashes. | J5/J6; scheduler | Partial | Rich exact/CP-SAT proof; default scheduler audit omits some detail and is FEASIBLE. Stage 2. |
| M53 | A1 §53 | Dry-run dashboard shows integrity/path/schedule/risk evidence. | J6; Studio | Reference/demo only | `/lab` reference only. Stage 2. |
| M54 | A1 §54 | Per-entrant min/max matches/rest/overlap proof. | J4/J5; analytics | Implemented but disconnected | `analytics.ts`; full per-path rest proof incomplete. Stage 2. |
| M55 | A1 §55 | Navigable tournament truth debugger links every derivation. | J6/J11; evidence | Partial | IDs/hashes exist; full chain UI missing. Deferred gate: support disputes require it. |
| M56 | A1 §56 | Follow gated archaeology→schema→graph→schedule→simulation→UI sequence. | Programme | Partial | Core gates exist; connected vertical order is explicitly superseded by A4/PRD, capability gates remain. No deprecation. |
| M57 | A1 §57 | P&K is the permanent difficult static benchmark without generic-core brand branches. | J12; fixtures | Implemented and connected | A fresh source creates a new identity and runs the existing generic core to a 98-contest guarded published revision; the declared envelope remains intentionally narrow. Permanent gate. |
| M58 | A1 §58 | Modified Americano is the permanent dynamic benchmark. | J12; dynamic | Implemented but disconnected | Dynamic tests. Deferred entry gate: platform dynamic-stage binding. |
| M59 | A1 §59 | Evidence-derived Native/Composable/Extension-required/Unsupported catalogue. | J12; catalogue | Reference/demo only | Capability ledger derives evidence; displayed only in lab/demo. Stage 4. |
| M60 | A1 §60 | An unseen format reaches approved live creation without reinterpretation or lost rules. | Product acceptance | Partial | Fresh P&K competition creation now completes create→compile→independent Guard→approval→atomic publication→shared retrieval. It is not an unseen format and does not yet enter live operations. Stage 2–3. |

## A2 safeguard requirements: S01–S21

| ID | Requirement | Owner / surface | Status | Evidence, gap, phase |
|---|---|---|---|---|
| S01 | Separate interpretation from deterministic spec validation. | Journey/schema | Implemented and connected | Creation proposal remains non-executable; a separate journey command invokes deterministic schema/scenario validation. |
| S02 | Exact semantic diff before commit. | Revisions/review | Implemented but disconnected | SCHEMA semantic diff. Stage 1–2. |
| S03 | Critical policy requires approved provenance. | Type checker/Guard | Implemented but disconnected | `type-checker.ts:293-318`. Stage 1. |
| S04 | Prove path/advancement/resource completeness before solve. | Type checker/Guard | Partial | Strong separate checks; creation ledger incomplete. Stage 1. |
| S05 | Independently rederive qualifier/bracket/match counts. | Type checker/Guard | Implemented and connected | Guard KCG003/KCG004 recomputes contest count from the canonical spec and blocks coordinated graph/schedule omissions; broader path reconstruction remains G01. |
| S06 | Shadow-validate every solver output. | Scheduler/Guard | Implemented and connected | Fresh journey schedules through the existing solver/shadow-validation path, then runs Guard; mutation regression remains green. |
| S07 | Consequential output carries structured proof. | Core/evidence | Partial | Widespread hashes/evidence, not one full schema. Stage 1–3. |
| S08 | Unsupported/unproved becomes unresolved/blocked. | All core | Implemented but disconnected | Strong fail-closed tests. Permanent gate. |
| S09 | Pin packs/compiler/defaults/solver for replay. | Schema/platform | Partial | Spec pins versions; web/Mac drafts do not. Stage 1. |
| S10 | Store random seed, algorithm, inputs and outputs. | Draw/random | Implemented but disconnected | Random/draw tests. Permanent gate. |
| S11 | No executable generated policy. | Interpreter/registry | Implemented but disconnected | No eval path; registries/quarantine. Permanent gate. |
| S12 | Invariant firewall rejects impossible runtime mutation. | Live/core | Partial | Strong state/live checks; not every platform write shares one firewall. Stage 3. |
| S13 | Type-check shapes/cardinality/results/dependencies before solve. | Schema | Implemented but disconnected | Type checker and schema tests. Stage 1. |
| S14 | Universal proposal→validate→apply immutable revision flow. | Journey/platform | Partial | Journey and legacy platform publication now seal an exact validated immutable revision through a server-owned boundary; live repair remains a separate seam. Stage 1–3. |
| S15 | Tournament Critic is read-only. | Critic/review | Implemented but disconnected | `compiler-critic.ts` tests. Stage 2. |
| S16 | Every source requirement has coverage/relaxation/unresolved/failed+counterexample. | Ledger/Guard | Implemented but disconnected | Critic/path proof; creator ledger missing. Stage 1. |
| S17 | Fuzz ugly cases and retain regressions. | Assurance | Implemented but disconnected | ASSURANCE/nasty fixtures. Permanent gate. |
| S18 | Show KNOWN/DERIVED/DEFAULTED/OPTIMISED/RANDOMISED/UNRESOLVED. | Review UX | Partial | Enum/evidence exists; polished creator inconsistent. Stage 1. |
| S19 | State factual validation, never blanket certainty. | Guard/UX | Implemented but disconnected | Certification/solver statuses; no blanket claim found. Stage 1–2. |
| S20 | Why-not identifies exact blockers and smallest/earliest correction. | Evidence/repair | Partial | Scheduling/repair scope only; no connected UI. Stage 2. |
| S21 | Simple/detailed/technical views project the same rule. | Review UX | Missing | Disclosure exists, explicit three-level rule projection does not. Stage 2. |

## A3 Guard requirements: G01–G14

Ledger identity check: `G01`–`G14` are unique and `G09` appears exactly once.

| ID | Requirement | Owner / surface | Status | Evidence, gap, phase |
|---|---|---|---|---|
| G01 | Independently validate roster/pools/counts/qualification/cups/byes/ties/normalisation/rematches. | Guard/core | Partial | KCG003/KCG004 now independently derive total contest cardinality and close the reproduced 97-of-98 omission; full independent graph/draw/path reconstruction remains. Stage 2. |
| G02 | Validate schedule collisions, calendars, duration, rest, window and quality. | Guard/schedule | Partial | Hard checks strong; quality/resilience not consumed by Guard. Stage 1–2. |
| G03 | Bottom-up contest/minute/capacity ledger; zero missing/duplicate. | Guard/evidence | Partial | Aggregate accounting exists; division/pool/type/changeover derivation absent. Stage 1–2. |
| G04 | Validate every possible advancement path and correction invalidation. | Guard/live | Partial | Possible-entrant scheduling and lineage exist; Guard does not reconstruct all paths. Stage 2–3. |
| G05 | Govern live-change authority, preservation, impact, notification and recovery. | Live Guard | Partial | Proposal/repair/approval strong; full policy incomplete. Stage 3. |
| G06 | Short pre-flight with expandable evidence and correction. | Review UX | Reference/demo only | P&K card only. Stage 2. |
| G07 | Deterministic six-level severity/override policy. | Guard | Partial | Type declares six; classifier emits only Critical/Integrity/Operational. Stage 2. |
| G08 | Same Guard for creation/import/manual/AI/repair/every client. | Journey/Guard | Partial | Mac Describe/Quick, web journey and legacy platform/pilot publication run the server-owned Guard; imports and live repair still need migration. Stage 2–3. |
| G09 | Stable rule/entity/message/evidence/suggested correction. | Guard | Partial | No suggested-fix field; entity extraction heuristic. Stage 2. |
| G10 | Integrity grade is separate from operational quality. | Guard/quality | Partial | Separate implementations exist, no unified projection. Stage 2. |
| G11 | Publication covers accounting/collisions/availability/dependencies/diff atomically. | Platform/Guard | Partial | Journey and platform publication load exact authoritative artefacts, independently rerun Guard, verify fresh approval hashes and atomically append the published revision with its outbox intent. Semantic diff remains absent. Stage 2. |
| G12 | Structure Guard covers pools/qualification/normalisation/cups/seeds/byes/play-ins/rematches. | Guard | Partial | Component evidence exists; independent Guard reconstruction absent. Stage 1–2. |
| G13 | Live Guard covers correction/delay/withdrawal/no-show/repair/notification/invalidation. | Live/platform | Partial | Strong kernel; provider/public/operator journey is rehearsal. Stage 3. |
| G14 | Every generated blueprint must pass Guard before use/publication. | Journey/Guard | Partial | Connected journey and platform revisions cannot publish unless a fresh server-run Guard passes over the authoritative artefact set; disconnected creation paths remain. Stage 2. |

### Critical Guard counterexample

The audit reproduced a coordinated omission against the baseline: removing one real P&K contest, its edges and schedule assignment, changing both graph counts to 97, clearing findings and omitting optional simulation previously returned `PASSED`. KCG003/KCG004 now independently rederive 98 required contests from the compiled spec, and the exact reproducer remains a blocking regression test. Every publication client now sends only competition identity, expected revision and acknowledgements. The server loads the tenant-bound authoritative specification/graph/schedule/simulation, recomputes all hashes, reruns Guard, verifies a fresh exact-revision approval by a separate actor, and writes publication plus outbox atomically. `guardInput`, direct client artefacts and the retired standalone certification command fail closed at both API and in-process boundaries. Remaining Guard risk is full independent path/draw reconstruction rather than client authority over publication.

## A4–A8 later research and product requirements

| ID | Source | Requirement | Job / owner / surface | Status | Evidence, entry gate or decision |
|---|---|---|---|---|---|
| J01 | A4 Job 1 | Isolated organisation home, roles, directories, defaults and portfolio. | Platform; portfolio | Partial | PLATFORM backend/tests; demo UI and production composition disconnected. Stage 1; tenant deployment gate. |
| J02 | A4 Job 2 | Describe/Quick/Import/Duplicate converge on one resumable draft and requirement ledger. | Journey; creation | Partial | Describe and Quick now converge on one sealed, versioned journey draft and Mac review; import/YAML/XLSX/duplicate remain. Stage 2. |
| J03 | A4 Job 3 | Explicit rules, assumptions, ambiguity, type checking and zero lost requirements. | Journey/Guard; review | Partial | Core evidence disconnected. Stage 1. |
| J04 | A4 Job 4 | Fair deterministic structure, unequal pools, qualification, draw and path proof. | Core; review | Implemented but disconnected | GRAPH. Stage 1. |
| J05 | A4 Job 5 | Physical resource schedule, lower bounds, quality and independent validation. | Scheduler/Guard; schedule | Partial | SCHEDULE disconnected; rich solver is not default scenario path. Stage 1–2. |
| J06 | A4 Job 6 | Compare, prove, separately approve and atomically publish one exact revision. | Journey/platform; review | Partial | Fresh Mac/web and platform paths independently prove, separately approve and atomically publish an exact authoritative revision with one outbox intent; connected comparison/semantic diff remains. Stage 2. |
| J07 | A4 Job 7 | Install-free signed personal next action under one published revision. | Public projection | Reference/demo only | `/next` singleton; opaque production token and publication projection missing. Stage 2. |
| J08 | A4 Job 8 | Action-first control room with exact idempotent/offline/stale commands. | Operator/live | Partial | LIVE APIs/read model; UI writes/offline integration incomplete. Stage 3. |
| J09 | A4 Job 9 | Typed disruption, scoped freeze, minimum-change repair, approval and targeted notify. | Live/repair | Partial | Strong core and seeded rehearsal. Stage 3. |
| J10 | A4 Job 10 | Separate safety authority, degraded/offline operation, emergency pack and restore. | Operations/platform/Mac | Partial | Restore/queue kernels; app durability, emergency workflow/pack missing. Stage 3. |
| J11 | A4 Job 11 | Close, replay, export, restore and duplicate with provenance. | Platform/evidence | Partial | Core exports/replay/restore/duplicate tested separately. Stage 3. |
| J12 | A4 Job 12 | Governed deterministic sport/format extension with honest envelopes. | Packs/assurance | Implemented but disconnected | CAPS/ASSURANCE; product catalogue reference only. Stage 4 authority/pilot gate. |
| A5-J01..J15 | A5 journeys | Workspace creation/invite/switch, create/publish, reuse, participant, operations, repair, correction, sharing, domains, privacy, support and exit. | Platform/all surfaces | Partial | Platform covers many backend actions; public/domain/support/connected clients remain partial. Stages 1–4; no silent deprecation. |
| ISO01 | A5 isolation 1 | Immutable organisation ID; aliases never authority. | Platform/security | Partial | IDs/tenant tests; host resolver not production connected. Stage 1. |
| ISO02 | A5 isolation 2 | Resolve host/path to tenant before business query and match membership. | API/security | Missing | No custom-host tenant resolution runtime. Deferred entry gate: production public domain work. |
| ISO03 | A5 isolation 3 | Every row/stream/command/snapshot/outbox is tenant scoped; forced RLS. | Database | Partial | Postgres seams/migrations/tests; managed deployment/RLS drill outstanding. Production gate. |
| ISO04 | A5 isolation 4 | Repositories require organisation context; cross-references fail closed. | Platform | Implemented but disconnected | PLATFORM tenant tests; v1 reference API bypasses platform state. Stage 1. |
| ISO05 | A5 isolation 5 | Tenant-scope caches/files/CDN/exports/temp paths. | Platform/infra | Partial | Some exports/integration scope; full cache/object-store surface absent. Production gate. |
| ISO06 | A5 isolation 6 | Tenant-bind queues, webhooks, idempotency and signing keys. | Infra | Partial | Production boundary tested; provider deployment missing. Production gate. |
| ISO07 | A5 isolation 7 | Tenant-scope search/analytics/support views. | Platform | Partial | Analytics exists; full production search/support paths absent. Deferred measured need. |
| ISO08 | A5 isolation 8 | Tenant-bind secrets/payments; client cannot choose credentials. | Integrations | Partial | Secret-reference/security contracts; real integrations absent. Deferred integration gate. |
| ISO09 | A5 isolation 9 | Public pages use minimal publication-derived projections, never organiser aggregate. | Public web | Partial | `/competitions/:id` now fails closed unless the persisted journey revision is published and renders its minimal immutable schedule projection; `/next` remains a separate demo singleton. Stage 2. |
| ISO10 | A5 isolation 10 | Every happy path has cross-tenant host/token/cache/webhook adversarial pair. | Assurance | Partial | API/database/webhook tests; host/cache/file/public token coverage incomplete. Production gate. |
| A6-01 | A6 §1–5 | Organisation hierarchy and multi-sport dimensions compose around one truth. | Platform/packs | Partial | PLATFORM/CAPS disconnected. Stage 1/4. |
| A6-02 | A6 §6 | Sponsor/public aliases never mutate stable resources or proof. | Presentation | Adjacent/parked | Explicit A8 decision; entry gate: reliable public next-action plus sponsor need. |
| A6-03 | A6 §7 | Certified deterministic social graphics use certified public DTOs. | Presentation | Adjacent/parked | Research only; entry gate: accurate public delivery and rights/AX policy. |
| OPS01 | A7 §1 | Routine disruption and life safety are distinct authority systems with one history. | Operations | Partial | Routine live core exists; safety state/authority UI missing. Stage 3. |
| OPS02 | A7 §2 | Named incident/referee/safety/comms/scribe functions and explicit command transfer. | Operations | Missing | Role model lacks full incident-command projection. Stage 3. |
| OPS03 | A7 §3 | Normal/Degraded/Paused/Stopped/Cancelled/Recovering state model. | Operations/public | Missing | No complete shared operational state machine. Stage 3. |
| OPS04 | A7 §4 | Detect→freeze→rank choices→validate→approve→publish→communicate→learn. | Journey/live | Partial | Repair core/demo; shared projections/outbox delivery incomplete. Stage 3. |
| OPS05 | A7 §5 | Push/pull/ambient answers derive from authoritative truth with fallback. | Public/delivery | Reference/demo only | Three demo surfaces, separate singleton. Stage 2–3. |
| OPS06 | A7 §6–7 | Governed weather/medical/venue readiness; software never diagnoses or invents thresholds. | Safety/pack | Missing | Deferred entry gate: venue/sport policy owners and pilot safety review. |
| OPS07 | A7 §8 | Signed offline truth, durable journal, reconciliation, outbox, restore and manual fallback. | Mac/platform | Partial | Core protocols + in-memory Mac queue; durable app wiring missing. Stage 3. |
| SURF01 | A8 | Install-free public web uses exact published minimal truth. | Public | Implemented and connected | The built Mac opened the persisted exact revision; the browser exposed the identical ID/revision, 98-contest schedule, Guard hash and publication certificate. Production hosting remains a deployment concern. |
| SURF02 | A8 | Mobile/Mac/web are job-specific clients of identical IDs/revisions/permissions/API/events. | Clients/journey | Partial | Connected Mac and web share the published journey identity, revision, contest accounting, Guard evidence and certificate-bound projection; demo/offline and public/live projections still diverge. Stage 2–3. |
| SURF03 | A8 | Mac is a professional offline client, not another truth/product. | Mac | Partial | Mac connected writes are transport-only and server authoritative; durable offline write/reconciliation remains Stage 3. |
| SURF04 | A8 | Adjacent commerce/ratings/booking/video/chat remain outside competition truth. | Product boundary | Adjacent/parked | Explicit decision; no implementation authorised in this programme. |

## Delivered milestone and next decision

No authority conflict required product-owner direction. The smallest connected slice delivered here is:

1. `CompetitionJourney` orchestrates the existing parser, canonical schema, scenario/compiler and Guard components without a new solver or competition definition.
2. Language and quick-form input converge on one sealed, resumable `CompetitionBlueprint` draft; unknown fields and proposer artefacts fail closed.
3. The declared P&K envelope compiles locally and deterministically from server-owned source facts to 98 contests, schedule, simulation and Guard report.
4. `PUBLISH_TOURNAMENT` accepts only organisation/competition identity, expected revision and acknowledgements. The server loads and hashes the authoritative artefact set, independently reruns Guard, enforces compiler/approver/publisher separation and freshness, and atomically appends publication plus its exact-revision outbox intent.
5. The retired `guardInput`/standalone certification contracts and all client-provided specification, graph, schedule, simulation or Guard fields fail closed in legacy platform, pilot, web and direct in-process calls; adversarial, duplicate and restart/replay tests are executable.
6. The Mac presents review, required questions, assumptions/provenance, compilation, Guard acknowledgement and publication as separate stages, then opens the same immutable published web identity and revision.
7. The v1 portfolio/detail projection and responsive web page read only the persisted published journey revision; production v1 reads fail closed without authorization or an authoritative artefact resolver.

YAML/XLSX/CSV/duplicate UI, generic format compilation, full independent path/draw reconstruction, dynamic platform binding, public `/next`, live repair, durable offline transport, and production persistence/deployment remain explicitly traceable Stage 2–4 follow-ons; none is deleted or reclassified as complete. The next critical slice is unifying the remaining creation truths and bringing import/live-repair paths under the same authoritative Guard boundary before broadening formats.
