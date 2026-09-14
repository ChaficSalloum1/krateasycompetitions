# PRD: Krateasy Competitions Execution Control

**Status:** Implementation authority and traceability brief  
**Date:** 14 September 2026  
**Use:** Read this document first in the main implementation task. It points to the detailed source specifications and explains how they fit together.

## 1. Summary

Krateasy Competitions is one product built around the existing competition core. The original master specification, compiler safeguards, Tournament Guard design, and subsequent research remain part of the intended capability set; the Jobs × Bier charter determines how those capabilities become one usable experience and in what order they are delivered.

This document prevents two opposite mistakes: discarding detailed technical work in the name of simplification, or exposing every technical capability as a separate customer feature. Simplify the experience, preserve the capability model, and prove coverage through traceability and tests.

## 2. Contacts and decision roles

| Role | Responsibility |
|---|---|
| Founder/product owner | Final product priorities, beachhead, commercial boundaries, and explicit deprecation decisions |
| Product lead | Customer jobs, outcome measures, feature admission, and scope coherence |
| Principal engineer | Architecture, source precedence, shared competition truth, and technical delivery gates |
| Competition-domain lead | Format semantics, fairness, rule packs, operational edge cases, and governing practice |
| Guard/assurance lead | Independent validation, proof, adversarial testing, and certification policy |
| Product design/research lead | Jobs × Bier experience, usability, progressive disclosure, and field validation |
| Accessibility lead | Equivalent task completion across assistive technology, reflow, print, and event conditions |
| Platform/security lead | Organisation isolation, privacy, reliability, offline reconciliation, and recovery |

One person may fill several roles. The responsibilities remain distinct so that the component proposing a competition or change is not also the only authority validating it.

## 3. Background

### 3.1 What happened

The original work defined an unusually specific universal competition compiler and a strong deterministic Guard. Later work added organisation workspaces, leagues and seasons, participant attention, live recovery, multi-sport composition, production boundaries, branding, integrations, and Jobs × Bier product thinking.

The implementation accumulated deep working components, but the customer experience became fragmented across demos, reference scenarios, web surfaces, and a native client. Simplification efforts then risked making the natural-language creator sound like the whole product and making the wider capability set sound optional or forgotten.

The correction is not a new product or engine. It is one connected application journey through the existing implementation.

### 3.2 Product statement

> **Describe or import the competition. Krateasy makes the rules explicit, proves the plan is runnable, publishes one trustworthy version, and helps the organiser recover when reality changes.**

### 3.3 One product boundary

- **Krateasy Competitions** is the product.
- The **existing competition core** contains the compiler, graph, standings, qualification, draw, scheduler, simulation, Guard, repair, and replay capabilities already built in the main implementation.
- The web is the primary creation, operation, and public-distribution experience.
- The Mac app is an optional professional/offline client of the same competition truth. It is not a separate product or engine.
- “Universe” remains an architectural concept. In customer language it is an isolated organisation workspace.

### 3.4 Authoritative source set

The main implementation task must read these sources. This PRD does not replace their detail.

| Authority | Source | Governs |
|---|---|---|
| A1 | `/Users/chaficsalloum/.codex/attachments/84328dc9-8c35-43cd-a5d4-0996dba06e60/pasted-text.txt` | Original Universal Tournament Compiler master specification; capability and architectural baseline |
| A2 | `/Users/chaficsalloum/.codex/attachments/f4c108f2-f531-40c9-a3e6-012f6aa416b8/pasted-text.txt` | Compiler assurance: type checking, coverage, semantic diff, adversarial review, fuzzing, independent validation |
| A3 | `/Users/chaficsalloum/.codex/attachments/83dce810-d7f9-4d00-89ba-b46a92fa7290/pasted-text.txt` | Tournament Guard responsibilities, evidence, severity, publication and live-change protection |
| A4 | `/Users/chaficsalloum/Documents/ChatGPT/Krateasy Tournaments Compiler/KRATEASY_COMPETITIONS_JOBS_X_BIER_IMPLEMENTATION_CHARTER.md` | Customer jobs, usability, sequencing, product boundaries, measures, team and field validation |
| A5 | `/Users/chaficsalloum/Documents/Codex/2026-09-05/files-pasted-by-the-user-tournamentos/docs/application-universe-field-guide.md` | Organisation workspace/universe model, public/private surfaces and isolation |
| A6 | `/Users/chaficsalloum/Documents/Codex/2026-09-05/files-pasted-by-the-user-tournamentos/outputs/tournamentos-product-atlas-and-journeys-2026-09-07.md` | Organisation, multi-sport, public presentation and journey expansion |
| A7 | `/Users/chaficsalloum/Documents/Codex/2026-09-05/files-pasted-by-the-user-tournamentos/outputs/event-day-operations-and-trust-research-2026-09-14.md` | Event-day disruption, safety, communication, offline and recovery requirements |
| A8 | `/Users/chaficsalloum/Documents/Codex/2026-09-05/files-pasted-by-the-user-tournamentos/docs/product-scope-and-surface-contract.md` | Latest core/adjacent/parked product decisions and surface placement |
| A9 | `/Users/chaficsalloum/Documents/Codex/2026-09-05/files-pasted-by-the-user-tournamentos/outputs/current-product-truth-2026-09-14.md` | Honest implementation status and most important integration gap |

### 3.5 Precedence and conflict rules

1. Executable facts and verified code state override claims that something is complete.
2. Safety, mathematical correctness, tenant isolation, privacy, and audit requirements cannot be weakened by a later UI or growth proposal.
3. A1–A3 define the technical correctness baseline.
4. A4 and A8 govern how the capability set is sequenced, surfaced, and simplified for customers.
5. A5–A7 add organisation, multi-sport, participant, operational, and commercial context; they do not silently fork the core.
6. A9 governs what may honestly be called implemented or production-ready.
7. A later document may rename, regroup, or defer a capability. It may not delete an original requirement without an explicit decision record naming the requirement, reason, impact, and owner.
8. Where two sources genuinely conflict, implementation stops at the affected decision and creates a short Architecture/Product Decision Record. It must not choose silently.

### 3.6 Terminology rule

Use these terms consistently:

- **Competition:** one tournament, league, cup, ladder, heat programme, or other governed competition and its revisions.
- **Organisation workspace:** one strongly isolated owner of clubs, people, places, competitions, formats, settings, and history.
- **Existing competition core:** the shared deterministic implementation. Do not introduce a second “TournamentOS engine.”
- **Guard:** the independent deterministic correctness boundary.
- **Proposal:** never authoritative.
- **Approved revision:** reviewed and authorised, but not necessarily published.
- **Published revision:** the current authoritative promise.
- **Actual state:** completed actions and results; never silently rewritten to match a plan.

## 4. Objective

### 4.1 Objective

Turn the existing deep implementation into one usable, trustworthy product without losing any intended capability or maintaining parallel sources of competition truth.

### 4.2 Key results

1. **Coverage:** every requirement in A1–A8 has a stable ID and one status: implemented, partial, disconnected, missing, deliberately deferred, adjacent, or explicitly deprecated.
2. **No silent loss:** zero requirements disappear between source input, formal specification, compiled graph, solved schedule, published revision, live operation, and final replay.
3. **Connected journey:** one newly created competition completes `create → compile → resolve → schedule → Guard → approve → publish → score → disrupt → repair → notify → close → replay → duplicate` under one competition identity.
4. **Correctness:** zero configured hard-constraint violations and zero scheduler self-certification.
5. **Publication integrity:** every public revision binds the exact approved specification, graph, schedule, validation report, versions, and notification intents.
6. **Participant clarity:** the personal public view shows the next action in under ten seconds median during representative tests.
7. **Operational trust:** a court-outage rehearsal produces a valid minimum-change repair, preserves completed/in-progress truth, and updates only affected people.
8. **Isolation:** zero cross-organisation data, cache, file, command, webhook, analytics, integration, or payment paths.
9. **Resilience:** acknowledged commands are neither lost nor duplicated, and restore reproduces the same authoritative state and proof hashes.
10. **Honesty:** every advertised format and sport has a named tested envelope, version, owner, evidence, and known unsupported cases.

## 5. Market segments

### 5.1 Initial beachhead

Clubs, academies, specialist organisers, leagues, and promoters running difficult recurring racket and paddle competitions:

- 32–512 entrants;
- singles, fixed pairs, and teams;
- several divisions sharing resources;
- pool-to-knockout, consolation/plate, conditional qualification, byes and play-ins;
- resource availability, rest, officials, equipment, closures, and occasional multi-site travel;
- events that currently depend on spreadsheets, messages, printed sheets, and one experienced organiser’s memory.

### 5.2 Additional job segments preserved in the architecture

- League and season operators needing repeated fixtures, tables, qualification, and organisation memory.
- Federation or governing staff needing versioned rule packs, permissions, audit, series, and reproducibility.
- Operators of Swiss, ladder, double-elimination, repechage, heat/time-trial, ranked, judged, combat, golf, motorsport, swimming, athletics, chess, and other competition families.
- Participants, parents, coaches, officials, announcers, venue staff, sponsors, and spectators who need a focused public or operational view.

These are not all first-release claims. They remain part of the capability and extension model and must be classified honestly as native, composable, extension-required, or unsupported.

## 6. Value propositions

### 6.1 Organiser

Move from “I hold the event together manually” to “the system makes every important assumption and consequence visible while I retain authority.”

### 6.2 Participant

Move from “I search screenshots or ask the desk” to “I immediately know where to be, when to arrive, what changed, and what happens next.”

### 6.3 Official and governing body

Move from opaque or mutable decisions to versioned rules, deterministic derivations, controlled corrections, and replayable evidence.

### 6.4 Organisation

Move from disposable one-event files to isolated, reusable memory: clubs, roles, people, teams, seasons, resources, formats, settings, integrations, and history.

### 6.5 Product advantage

Krateasy does not win by exposing more configuration. It combines:

1. fast recognition and creation;
2. deep competition and resource semantics;
3. independent proof before publication;
4. controlled live recovery;
5. install-free participant clarity;
6. reusable organisation memory.

## 7. Solution

### 7.1 The only customer lifecycle

```text
Describe / Quick setup / Import / Duplicate
                    ↓
Recognised facts + unresolved decisions + provenance
                    ↓
Formal competition specification and type checking
                    ↓
Pools / standings / qualification / topology / draw
                    ↓
Resource-aware schedule + participant paths + simulation
                    ↓
Guard report + scenarios + semantic diff
                    ↓
Approval and atomic publication
                    ↓
Control room + scoring + personal next action
                    ↓
Incident → freeze → repair → validate → approve → notify
                    ↓
Close → replay → export/restore → duplicate
```

Every surface uses this lifecycle. No demo, web page, native client, import path, AI assistant, or solver may create its own competing interpretation.

### 7.2 Guard contract

The Guard is not a feature that can be deferred until after the UI. It is the deterministic correctness kernel beneath creation, scheduling, simulation, publication, imports, manual edits, live repair, and future agents.

Every consequential operation follows:

```text
Current authoritative state
          ↓
Proposed isolated revision
          ↓
Deterministic dry run
          ↓
Independent Guard validation
          ↓
Pass / warning / blocked + structured evidence
          ↓
Required human acknowledgement or approval
          ↓
Atomic publication
          ↓
Audit, previous revision and recovery point
```

The Guard owns five areas:

1. **Definition:** entrant identity, divisions, pools, match counts, qualification, cup sizes, byes/play-ins, tiebreaks, normalisation, rematch policy.
2. **Schedule:** resources, people, availability, duration/buffer, window, rest, participant experience, unused capacity, and known-quality comparisons.
3. **Accounting:** every required contest and minute reconciles bottom-up; missing and duplicate contests are zero before publication.
4. **Dependencies:** every possible advancement path is chronologically and structurally legal, including unknown future participants and later corrections.
5. **Live protection:** changes preserve results/history, respect authority, identify downstream impact, create revisions, and never overwrite public truth silently.

Structured findings use severity and publication policy:

| Severity | Meaning | Publication |
|---|---|---|
| Critical | Mathematically or physically impossible | Blocked |
| Integrity | Corrupts results, progression, qualification, or history | Blocked |
| Operational | Valid but serious on-day risk | Explicit acknowledgement |
| Experience | Fairness, wait, rest, or usability concern | Allowed with warning |
| Optimisation | A demonstrably better valid plan may exist | Allowed |
| Information | Neutral observation | Allowed |

An override cannot make an impossible state valid. Exceptional authority can create an explicitly non-standard governed revision only where the policy permits it, with actor, reason, before/after, downstream impact, notification state, and recovery plan.

### 7.3 Compiler and AI safeguard contract

The following requirements remain non-negotiable:

- AI interprets and proposes; deterministic software validates and decides executability.
- Every meaningful source clause becomes a formal rule, approved assumption, explicit optimisation objective, deliberate relaxation, or unresolved requirement.
- Critical rules never use implicit model fallback.
- The type checker validates entrant/result types, cardinality, dependency completeness, and possible paths before scheduling.
- Critical counts and paths are independently re-derived and compared.
- The scheduler cannot certify its own output.
- All proof-carrying decisions identify rule, source, entities, inputs, result, and versions.
- Randomisation stores seed, algorithm, input, and output.
- No free-form generated code becomes tournament policy.
- Runtime commands pass through an invariant firewall.
- Natural-language changes produce plan/validate/apply semantic diffs.
- The Tournament Critic may raise concerns but cannot mutate truth.
- Fuzzing, named nasty fixtures, property tests, mutation tests, differential tests, replay tests, and historical fixtures are permanent release gates.
- Confidence is factual—checks passed, tested paths, solver status, proof identity—not a percentage or “100% correct.”

### 7.4 Capability preservation map

This table is the high-level guarantee that simplification does not discard original scope.

| Capability family | Source baseline | Product home | Disposition |
|---|---|---|---|
| Ordinary-language compiler | A1/A2 | Creation and change proposal | Core; connect now |
| Quick form, JSON/YAML, spreadsheet import, duplication | A4/A5/A8 | Creation | Core; connect now |
| Canonical schema and intermediate representation | A1 | Existing competition core | Permanent foundation |
| Rule DSL, provenance, ambiguity and priorities | A1/A2 | Format & rules; detail on demand | Core |
| Pools and match generation | A1/A3 | Format/structure | Core |
| Standings, tiebreaks and unequal-pool normalisation | A1/A3 | Standings/explanation | Core |
| Qualification, seeding, topology, draw, byes and play-ins | A1/A3 | Structure/review | Core |
| Dependency and participant-path graph | A1–A3 | Guard/Evidence | Core |
| Resource-aware scheduling and packing | A1/A3 | Schedule | Core |
| Rest, thermal quality and participant experience | A1/A3 | Schedule/Issues | Core |
| Lower-bound, solver audit and why-not | A1/A2 | What-if/Evidence | Core; progressive disclosure |
| Structural, deterministic, adversarial and Monte Carlo simulation | A1 | What-if/Evidence | Preserve; stage by validated need |
| Certification, proof, counterfactuals and repair | A1–A4 | Review/Issues/Live repair | Core differentiator |
| Guard definition/schedule/accounting/dependency/live validation | A3 | All consequential writes | Core invariant |
| Live commands, correction, withdrawal, protest and outage | A3/A7 | Run event | Core pilot loop |
| Immutable revisions, approval, audit, replay and restore | A1–A4/A7 | Publish/Evidence/Close | Core invariant |
| Public personal next action and communication ladder | A4/A6/A7/A8 | Install-free public web | Core pilot loop |
| Organisation workspaces/universes and tenant isolation | A5/A6/A8 | Portfolio/platform | Core security and memory boundary |
| Clubs, roles, invitations and directories | A5/A6/A8 | Workspace administration | Core; progressive completion |
| Seasons, leagues and repeat competition memory | A5/A6 | Portfolio/competition formats | Preserved; deepen after golden loop |
| Multi-sport contest semantics and resources | A1/A6 | Versioned sport adapters | Permanent architecture; claims gated by conformance |
| Static formats: groups, round robin, knockout, consolation, placement | A1/A6 | Format packages | Native/core beachhead |
| Additional structures: double elimination, repechage and league tables | A1/A6 | Format packages | Preserve and verify in named envelopes |
| Dynamic formats: Swiss, ladder, Americano and runtime generators | A1 | Dynamic format interface | Preserve; Americano remains reference benchmark |
| Timed/ranked/judged/heats/time trials/golf/combat families | A1/A6 | Sport/format conformance packs | Later verified packs; not deleted |
| Play & Konnect benchmark | A1 | Golden fixtures and pilot | Permanent regression benchmark |
| Modified Americano benchmark | A1 | Dynamic-format regression | Permanent second benchmark |
| Brand, domains, resource aliases and sponsor presentation | A5/A6/A8 | Public presentation/settings | Next/later; downstream of certified truth |
| Certified public graphics and media outputs | A4/A6/A8 | Public distribution | Next; facts locked to published DTO |
| Booking, registration, payment, calendar and messaging integration | A5/A6/A8 | Explicit integration adapters | Partner-owned truth; staged by pilot need |
| Series, federation and governing-body packs | A4/A6/A8 | Platform expansion | Later; preserved behind evidence gates |
| Offline operation and emergency pack | A4/A7/A8 | Professional operation | Core pilot resilience; Mac may specialise here |
| Operational analytics and post-event learning | A4/A6/A8 | Close/organisation memory | After reliable event telemetry |
| Broad feed/chat, partner matching, video editing, POS/hotels/payroll | A8 | Outside competition core | Parked/adjacent, not silently mixed into core |

“Later” means preserved and sequenced, not deleted. “Parked/adjacent” means the research is retained but the capability does not belong inside the core competition workflow unless new evidence changes the decision.

### 7.5 Master specification traceability index

Every numbered section of the original master specification remains accounted for. The implementation audit must split these rows into individual testable requirements where needed.

| IDs | Original scope | Governing solution area |
|---|---|---|
| M00–M03 | Mission, promise, one engine, technical philosophy | Product boundary; shared core; hard/soft rules |
| M04–M08 | Canonical IR, sport as data, primitives, composition, dynamic formats | Schema, graph, adapters, registered dynamic engines |
| M09–M13 | Natural language, assumptions, ambiguity, DSL, rule priority | Creation interpretation and formal rules |
| M14–M19 | Pools, standings, normalisation, topology, placement, dependencies | Deterministic competition construction |
| M20–M23 | Scheduling, lower bounds, rest quality, resource packing | Resource schedule and evidence |
| M24–M29 | Dry runs, state simulation, invariants, property/differential/regression tests | Assurance and simulation programme |
| M30–M32 | Certification, explainability, counterfactuals | Guard, Evidence and What-if |
| M33–M37 | Blueprint, compiler UI, visual graph, error model, feasibility repair | Usable review and governed change |
| M38–M40 | Sport adapters, format packages, extensibility | Multi-sport conformance and registered extensions |
| M41–M46 | Data architecture, definition/plan/operational/actual, Krateasy/API/package boundaries, determinism | Shared platform and replay architecture |
| M47–M49 | AI safety, adversarial protection, imported rulebooks | Interpreter boundary, critic and governed pack ingestion |
| M50–M55 | Test levels, independent validator, solver audit, dashboard, participant paths, truth debugger | Guard and specialist evidence workbench |
| M56 | Development sequence | Superseded only in ordering by this connected vertical delivery plan; capability gates remain |
| M57–M58 | Play & Konnect and Modified Americano benchmarks | Permanent golden benchmark pair |
| M59 | Native/composable/extension-required/unsupported taxonomy | Honest capability catalogue |
| M60 | Ultimate acceptance criterion | Product-level completion test |

### 7.6 Safeguard traceability index

| IDs | Safeguard | Required implementation/evidence |
|---|---|---|
| S01 | Two-pass interpretation and validation | Interpreter cannot certify canonical spec |
| S02 | Semantic diff | Every proposed rule change lists changed and preserved paths |
| S03 | No critical fallback | Critical policy has approved provenance |
| S04 | Constraint completeness | Participant paths, advancement and resources complete before certification |
| S05 | Independent re-derivation | Counts/destinations/path accounting compared independently |
| S06 | Shadow schedule validator | Separate implementation validates every solver result |
| S07 | Proof-carrying output | Structured evidence for consequential decisions |
| S08 | Fail closed | Unproved or unsupported becomes unresolved/blocked |
| S09 | Version-pinned interpretation | Packs, compiler, solver and defaults replay later |
| S10 | Deterministic randomisation | Stored seed, algorithm, inputs and output |
| S11 | No executable generated rules | Only registered declarative primitives/extensions |
| S12 | Invariant firewall | Invalid runtime mutation rejected regardless of caller |
| S13 | Tournament type checker | Types, cardinality, result states and dependencies checked before solve |
| S14 | Plan/validate/apply revisions | No direct destructive mutation of approved/live truth |
| S15 | Tournament Critic | Advisory adversarial review with no write authority |
| S16 | Requirement coverage | Satisfied, deliberately relaxed, unresolved or failed with counterexample |
| S17 | Tournament fuzzing | Ugly generated configurations become regression fixtures |
| S18 | Uncertainty classes | Known, derived, defaulted, optimised, randomised, unresolved |
| S19 | Confidence ceiling | Factual validation state, never blanket certainty |
| S20 | Why-not | Exact blocking constraints and earliest/smallest viable correction |
| S21 | Formal inspection levels | Simple, detailed and technical views of the same rule |

### 7.7 Guard traceability index

| IDs | Guard area | Required evidence |
|---|---|---|
| G01 | Definition validation | Roster, pool, match count, qualification, cup, bye, tiebreak, normalisation and rematch findings |
| G02 | Schedule validation | Resource, participant, availability, duration, rest, window and experience findings |
| G03 | Match accounting | Bottom-up contest/minute ledger and zero unscheduled/duplicate contests |
| G04 | Dependency validation | All possible advancement paths and correction invalidation |
| G05 | Live-change protection | Change classification, authority, preservation, downstream impact and recovery |
| G06 | Organiser pre-flight | Short plain-language report with expandable evidence |
| G07 | Severity/override policy | Deterministic publication outcome by severity |
| G08 | Shared service | Same Guard for builder, imports, solver, manual edits, AI, live repair and every client |
| G09 | Structured rule evidence | Stable rule IDs, entities, messages, machine evidence and suggested correction |
| G10 | Honest guarantee | Integrity certification separate from operational-quality score |
| G11 | Publish rollout | Accounting, collisions, availability, dependencies, diff and atomic publication |
| G12 | Structure rollout | Pools, qualification, normalisation, cups, seeding, byes/play-ins and rematches |
| G13 | Live rollout | Correction, delay, withdrawal, no-show, repair, notification and downstream invalidation |
| G14 | Compiler assurance | Every generated blueprint passes Guard before it can become usable/publishable |

### 7.8 Required codebase audit before more feature expansion

Create `docs/requirements-traceability.md` in the main repository. It must contain one row per decomposed requirement with:

```text
Requirement ID
Source and line/section
Plain-language requirement
Owning job/customer moment
Owning module
Owning surface
Implementation status
Evidence/test references
Delivery phase
Decision record if deferred or deprecated
```

Allowed status values:

- **Implemented and connected** — exercised through the authoritative journey.
- **Implemented but disconnected** — code exists but a new competition cannot reach it.
- **Partial** — some semantics or surface behavior exists.
- **Reference/demo only** — useful evidence, not production truth.
- **Missing** — required but not yet implemented.
- **Deferred** — preserved with named entry gate.
- **Adjacent/parked** — retained research, outside the current core.
- **Deprecated by decision** — removed only through an explicit recorded decision.

The audit must not infer “implemented” from filenames or test names. It must trace the runtime path and cite executable evidence.

### 7.9 Target application seam

Add one lifecycle application module—working name `CompetitionJourney`—that exposes customer operations rather than engine internals:

```text
createDraft
recogniseInput
resolveDecision
compileRevision
comparePlans
approveRevision
publishRevision
submitOperatorCommand
proposeLiveChange
decideLiveChange
completeCompetition
duplicateCompetition
```

All web, public, native, import, AI and integration surfaces call this seam. Internally it composes the existing core. It is not a new engine.

Build organiser, operator and public participant projections from the same authoritative event heads. The public message, `/next`, venue display, staff lookup and organiser view must identify the same effective revision and freshness.

### 7.10 UX requirements

- One consequential question or decision per screen.
- Value appears before advanced commitment: show what was recognised and what remains unresolved.
- Advanced evidence is progressively disclosed, never removed.
- User language is sport-appropriate; internal graph/solver/enum language remains optional detail.
- Draft, approved, published, superseded and actual states are unmistakable.
- A schedule is presented as promises to people and resources, not merely cells.
- Every material change shows what moved, what stayed, who is affected and what to do next.
- Participants receive useful answers without account or app-install gates.
- Every core flow has keyboard, screen-reader, zoom/reflow, reduced-motion, high-contrast, print, weak-network and safe-error behavior.

### 7.11 Assumptions requiring field evidence

- Fifteen minutes is a realistic target for a clean common event to reach a valid first schedule.
- Spreadsheet rescue is the strongest organiser activation path.
- Court outage, withdrawal and delay cover enough frequent incidents for the first repair set.
- Organisers understand and trust Guard evidence when progressively disclosed.
- Install-free `/next` materially reduces desk questions.
- Native Mac/offline operation creates enough unique value to justify a maintained client.
- The generic sport model remains usable when wrapped in sport-specific terminology and packs.
- Repeat-event memory drives retention.
- Sponsorship and verified sharing create value without corrupting operational clarity.

These assumptions must not become irreversible platform work before observation or controlled tests.

## 8. Release

### 8.1 Stage 0 — Establish control and traceability

- Read A1–A9.
- Build the decomposed requirements traceability matrix.
- Inventory current code, demos, fixtures, surfaces, status and duplication.
- Record genuine conflicts and deliberate deprecations.
- Freeze unrelated feature expansion.

**Exit:** every original, safeguard, Guard and later product requirement is accounted for; nothing is being removed by implication.

### 8.2 Stage 1 — Connect one competition

- Production identity and workspace context.
- Unified Describe/Quick setup/Import/Duplicate creation model.
- One competition ID and draft revision persisted through a fresh process.
- Formal rules, decisions, graph and schedule generated by the existing core.
- Guard-backed review, approval and publication.

**Exit:** a historical beachhead event reaches a valid public revision without a developer or demo handoff.

### 8.3 Stage 2 — Operate, recover and inform

- Authoritative control-room commands and live refresh.
- Signed install-free participant projection.
- Court outage, withdrawal and delay incidents.
- Freeze, minimum-change proposal, Guard, authority, atomic publish and targeted delivery.
- Offline command integrity and emergency/manual pack.

**Exit:** a deliberate disruption is resolved without invalidity, silent movement, stale public truth or lost history.

### 8.4 Stage 3 — Close, replay and repeat

- Completion gates, correction/appeal lineage and final publication.
- Human and machine evidence bundle.
- Restore drill and proof comparison.
- Duplicate into the next edition with explicit organisation memory.

**Exit:** the event can be defended later and repeated faster.

### 8.5 Stage 4 — Validate and expand from evidence

- Historical reconstruction, format red team, shadow events and controlled pilots.
- Complete accessibility, security, concurrency, provider-failure and restore evidence.
- Admit the next capability from the preserved map only when a measured bottleneck or customer job justifies it.

**Exit:** expansion is driven by evidence while the full intended capability corpus remains traceable.

### 8.6 Exact handoff instruction for the main implementation task

Send the path to this PRD, not the contents of several competing prompts. Use this message:

> Read `/Users/chaficsalloum/Documents/ChatGPT/Krateasy Tournaments Compiler/PRD-Krateasy-Competitions-Execution-Control.md` first, then read every authoritative source A1–A9 listed inside it. Continue in the existing implementation repository; do not create another product, engine or parallel rewrite. Before further feature expansion, create the decomposed requirements traceability matrix and audit the runtime implementation against it. Preserve the original compiler, Guard, safeguards, multi-sport/format, leagues/seasons and organisation-workspace capability set. Use the Jobs × Bier charter to simplify and sequence the customer experience, not to delete technical scope. Then implement the first missing vertical slice needed for one newly created competition to complete the connected lifecycle under one identity and revision chain. Report conflicts rather than resolving them silently.

