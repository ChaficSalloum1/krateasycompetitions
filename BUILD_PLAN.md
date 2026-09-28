# Finite migration and implementation plan

Status: ACTIVE. Supersedes competing implementation sequences. Source: the user's supplied finite plan, [authority record](docs/AUTHORITY_SOURCES.md).

## Current slice and gate state

Current delivery: **D8 — bounded rule catalog and question coverage**; see [contract](docs/D_RULE_CATALOG_SLICE.md) and [D gate](docs/D_REVIEW_GATE.md). Prior bounded D slices cover revision-safe commands, membership, resource windows/durations, start/court locks, format/roster composition, independent cup controls and interpretation clarity. Full D requires complete P&K organiser acceptance and real-browser/mobile/accessibility evidence. E/F/G remain gated.

The required later G outcome is automatic guarded structural/schedule repair for participant, pair, pool and division changes; [G acceptance](docs/G_RECONFIGURATION_ACCEPTANCE.md) records the exact requirements. It is not an implemented creator journey.

Every slice must contain JOB, INPUT, OUTPUT, AUTHORITATIVE OWNER, INVARIANTS, TELEMETRY, ACCEPTANCE SCENARIO, NON-GOALS and EXIT GATE. Work outside the current slice goes to FUTURE.md unless it violates a hard invariant or blocks current acceptance; document that exception and its evidence.

## Historical A1 ticket contract

- JOB: Remove competing implementation authorities so a fresh agent can identify product, exclusions, truth owners and current work without chat history.
- INPUT: The two supplied contracts and tracked repository documentation at baseline `71b7160b60295d8f43aba9ba51cd221dc8a4b146`.
- OUTPUT: PRODUCT, DOMAIN, ARCHITECTURE, MODULE_CONTRACTS, BUILD_PLAN, TELEMETRY, CLAUDE, FUTURE; complete document classification and a self-contained entry point.
- AUTHORITATIVE OWNER: This active set, derived only from the supplied plan/domain; source provenance and precedence recorded in AUTHORITY_SOURCES.
- INVARIANTS: No research deletion; no product-code change; no other-chat requirements; no inferred gate completion; existing safeguards retained.
- TELEMETRY: Documentation review record with baseline, file inventory, coverage and scope checks; no runtime instrumentation in A1.
- ACCEPTANCE SCENARIO: Read only the active entry points and answer the four ticket questions with exact links.
- NON-GOALS: Features, UI, compiler/solver/runtime changes, P&K migration, production deployment, filling missing historical fixtures.
- EXIT GATE: All eight authority files present, every pre-existing documentation file classified, earlier authority claims explicitly subordinated, four answers unambiguous, diff documentation-only and preserved branch reviewable.

## Ordered programme

The table below preserves the complete required gates. A/B/C evidence is separately scoped in the exit records; D is a review milestone with remaining work, not a full gate pass. Existing implementations/tests may provide reusable evidence when inspected in their slice; absence of new gate evidence is not a claim that code is absent.

| Phase | Job / required delivery | Acceptance and exit gate | Stop / non-goal |
|---|---|---|---|
| A — Freeze & observe | A1 active authority set; A2 freeze P&K generic expansion; A3 SOURCE → FACTS → DEFINITION → GRAPH → QUALIFICATION → DRAW → SCHEDULE → GUARD audit | simple-knockout, six-pair-round-robin, historical P&K; each boundary exposes input/output/revision/hash/failure/telemetry; intentional corruption precisely localised | No UX improvements |
| B — Competition correctness | B1 separate standings/qualification/cross-pool; B2 seed assignment; B3 topology; B4 protected seeds/byes/same-pool/prior-opponent placement; B5 properties; B6 historical regression | 4/6/8/10/12/16 qualifiers, 2–5 equal/unequal pools, byes/play-ins/two cups/wildcards; each qualifier once, no non-qualifier, correct byes/seeds, avoidable rematches removed, progression resolves; `scenario/play-konnect-knockout-regression` | No additional runtime features |
| C — Source → Definition | C1 natural language, JSON/YAML, CSV/XLSX; C2 SourceFact[] provenance; C3 ProposedDefinition/OpenDecision[]/Conflicts[]; C4 no guessed policy | Knockout, pools→knockout, St Albans material become coherent definitions without tournament-specific code; undefined runners-up comparison stays open | PDF/ZIP/images deferred; inspection-only UI |
| D — Visual editor | D1 pool count/size/membership constraints; D2 top N/runners-up/comparison/destination; D3 size/byes/seeds/rematches; D4 duration/rest/courts/locks | Non-developer reproduces and changes P&K format without JSON/code; Division→Pools→Qualification→Cup→Bracket inspectable/editable | No full production auth/organisation UI |
| E — Definition Guard | Entry accounting, completeness, cardinality, cycles, destinations, unresolved/unsupported semantics | READY / NEEDS DECISION / BLOCKED; every deliberately invalid fixture has precise counterexample, e.g. ten qualifiers/eight slots leaves two without destination | Never silently repair invalid semantics |
| F — Schedule compiler | Graph/resources/availability/duration/rest/locks/dependencies/preferences → candidate/status/evidence/tradeoffs; independent validation | KO, RR, St Albans compile; generic configuration schedules P&K; FEASIBLE/OPTIMAL/INFEASIBLE/UNKNOWN truthful, optimal only proved | No P&K migration |
| G — Pre-event recompilation | Dropout, division switch, partner change, late entrant, pool change, court availability; affected scope/candidates/cost/Guard/before-after/approval | Real P&K Intermediate dropout, division switch, court disappears: guarded repair or proved impossibility; measure participants/matches/courts/times/published information changed | No live migration; no spreadsheet repair |
| H — P&K parity | Matrix: pools, standings, qualification, Konnect/Tower, tiebreaks, score/result progression, generic schedule, player next state, revisions | Complete authoritative fixture: same entrants/rules/intended qualification/score semantics/progression and valid draw/schedule, with Guard evidence | Do not cut over live site |
| I — Shadow | Same real/replayed inputs to live P&K authority and non-authoritative Krateasy; compare standings/qualification/draw/progression/schedule feasibility | Complete event has no unexplained correctness differences; differences return to responsible module | No new feature to evade a difference |
| J — Cutover | J1 core standings/qualification/draw validation, P&K UI/capture/DB/public; J2 core scheduling; J3 published Definition/revisions; J4 P&K client | playbook.ts is legacy fixture only, no longer authoritative runtime truth | Incremental ownership migration only |
| K — Generic runtime | CHECK_IN, CALL_CONTEST, START_CONTEST, RECORD_RESULT, COMPLETE_CONTEST, CORRECT_RESULT; Definition/Plan/Operational/Actual distinct | KO, RR and P&K run end-to-end through one runtime | Preserve truth boundaries |
| L — Live recovery | Closure, withdrawal/no-show, overrun, correction → affected future/search/disruption/Guard/review/operational revision | All four preserve played truth, future validity, explicit scope and deterministic replay | No destructive plan/operational/actual conflation |
| M — External Guard | Structured bundle + schedule → definition/qualification/draw/schedule findings and counterexamples | Meaningful report for imported tournament without Krateasy generation | CSV/XLSX/API adapters later |
| N — Format/sport proof | N1 Americano; N2 multi-week league; N3 ladder; N4 one non-padel sport | At least three structurally different families use same kernel without bespoke engine branches; classify missing primitive/composition/sport semantics/interpreter/presentation | No premature generic UIs; concepts need evidence |

After N, the foundational programme ends. Customer-driven bounded features are independent product bets, not another architecture programme.

## Historical A1 handoff — A2 then A3

A2: P&K remains production maintenance only. No generic multi-tenancy, second scheduler/compiler, or separate completion of old PLATFORM_SCOPE.md; exceptions only for keeping live service functioning. Record repository baseline and scope when starting next ticket; this branch has not inspected or changed P&K.

A3 contract to instantiate before coding:

- JOB: Find the exact failing layer for any scenario output.
- INPUT: Existing schema/engine/Guard and three source-backed scenarios.
- OUTPUT: `scenario/simple-knockout`, `scenario/six-pair-round-robin`, `scenario/play-konnect-reference`, boundary records and corruption evidence.
- AUTHORITATIVE OWNER: Existing core producers, independent assurance and Guard; harness observes, does not become a second engine.
- INVARIANTS: All boundary artefacts revision/hash-bound; failures localised; missing evidence explicit; historical labels require actual provenance.
- TELEMETRY: TELEMETRY.md boundary envelope and scope-specific events.
- ACCEPTANCE SCENARIO: Run all three and deliberately corrupt qualification, draw and schedule; inspect the first failing layer and downstream rejection.
- NON-GOALS: UX, new formats, runtime features, prototype changes, production migration.
- EXIT GATE: All three source-backed scenarios expose every required boundary; corruption has precise counterexamples; missing historical source blocks the historical portion, never replaced silently by synthetic data.

Ticket 3 is Phase B only, admitted after A. Do not proceed beyond the current slice.

## Required review record

Every PR states Phase, Slice, Entry condition, Exit condition, Evidence, Next allowed slice. No “while I was here” work except a documented current invariant/acceptance blocker. Record command, exact revision/environment, scenario and result for executable claims. A review report or old test count is not a new gate pass.
