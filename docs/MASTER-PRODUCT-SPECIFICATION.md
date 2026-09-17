# Krateasy Competitions — Master Product Specification

**Status:** Canonical product and scope index  
**Version:** 1.0  
**Updated:** 17 September 2026  
**Purpose:** One navigable reference for the product vision, researched capabilities, shipped implementation, pilot boundary, open work and evidence requirements.

This document consolidates the existing PRD, Jobs × Bier work, pilot plan, Guard design, product audits and the broader compiler assessment. It does not invent a second product or replace the authoritative technical documents linked below.

## 1. Executive decision

Krateasy Competitions is one competition operating system:

> Describe or import a competition. Krateasy makes the rules explicit, proves the plan is runnable, publishes one trustworthy version, helps the organiser run it, repairs it when reality changes, and leaves an auditable record.

The deterministic TournamentOS compiler, Competition Blueprint, Scheduler, Run Assurance and Guard are internal parts of that product. They are not separate products, customer workflows or competing sources of truth.

The difficult competition-engine core is substantially advanced. The main remaining gap is productisation and proof: messy real inputs, an intuitive editing experience, real authenticated persistence, field operation and evidence across many real formats.

## 2. Authority and document hierarchy

When documents disagree, use this order:

1. `docs/jobs-to-be-done.md` — product-system lens, jobs, lifecycle and surface placement.
2. `PRD-Krateasy-Competitions-Execution-Control.md` — implementation PRD and traceability authority.
3. `PILOT-CRITICAL-EXECUTION-PLAN.md` — controlled-pilot execution sequence and boundary.
4. `docs/competition-guard-publication.md` — Guard and publication invariants.
5. `docs/requirements-traceability.md` — implementation and test evidence.
6. `docs/pilot-release-readiness.md` — honest release decision and external authority gates.
7. `apps/compiler-web/DESIGN.md` — visual and interaction system.

The original `KRATEASY_COMPETITIONS_JOBS_X_BIER_IMPLEMENTATION_CHARTER.md` remains valuable research and product history. This document is the consolidated index for it, not a licence to bypass the authorities above.

## 3. Product jobs

### J1 — Make a runnable competition

When I know how I want an event to work, I want to describe it or provide the material I already have, so Krateasy can turn it into a complete competition without requiring database, bracket or scheduling expertise.

Success: a versioned Competition Blueprint with participants, divisions, stages, pools, qualification, scoring, tie-breaks, venues, timing, constraints and publication policy.

### J2 — Defend the plan

Before publishing, I want proof that the structure, accounting, dependencies, schedule and rules are coherent.

Success: independent assurance findings, explanations, acknowledgements and an exact Guard-certified revision.

### J3 — Operate the event

During the event, I want one action-first view of what needs attention and safe commands for check-in, calling, scoring, results and participant information.

Success: the operator can act against authoritative fixture identities and receive revision-bound server evidence.

### J4 — Recover safely

When a player withdraws, a court closes, a match overruns or a result is corrected, I want safe repair options that preserve history and show consequences before approval.

Success: simulation → affected scope → Guard proof → explicit approval → targeted updates, with no silent rewrite of played truth.

### J5 — Close and repeat

When the event ends, I want proof that it is complete and a clean, safe way to reuse it.

Success: integrity receipt, replayable evidence, verified restore path and clean-edition duplication.

## 4. One lifecycle, one identity, one truth

```text
Sources / intent
      ↓
Interpretation and decisions
      ↓
Competition Blueprint
      ↓
Definition Assurance
      ↓
Schedule proposal
      ↓
Run Assurance + Guard
      ↓
Approved published revision
      ↓
Live runtime and participant projections
      ↓
Incident → simulate → Guard → approve → targeted update
      ↓
Close → replay → integrity receipt → clean duplicate
```

Every stage must retain the same competition identity and revision chain. AI, humans and solvers may propose. Deterministic compiler, assurance and Guard code decides authoritative truth.

## 5. Product surfaces

There are four customer-facing surfaces:

| Surface | Jobs | Primary purpose |
|---|---|---|
| Organiser Studio | J1, J2 | Define sources, resolve meaning, inspect structure, review assurance and publish |
| Run Control | J3, J4 | Operate by exception, issue commands and review safe recovery |
| Participant/public web | J3, J4 | Show signed revision-scoped next information, venue display and recovery updates |
| Close & Integrity Receipt | J5 | Verify completion, export evidence and create a clean edition |

The Mac client is a focused professional/reference client against the same API. It is not a second authority or a reason to delay the connected web pilot.

## 6. Capability catalogue and honest status

Status vocabulary:

- **Pilot now:** implemented in the connected local/pilot envelope, subject to release gates.
- **Foundation:** strong internal capability, but not yet a complete customer experience or production proof.
- **Next:** required for the first genuinely usable durable pilot.
- **Vision:** part of the broader product, intentionally after the controlled pilot.
- **External gate:** engineering cannot claim completion without deployment, provider or human evidence.

| Capability | What the product must do | Current status | Evidence / next proof |
|---|---|---|---|
| Multi-source intake | Accept JSON/YAML, CSV/XLSX, narrative and multiple corroborating sources with hashes, provenance, conflicts and reversible decisions | **Pilot now / partial** | Connected source journey and traceability; broaden extraction and real messy-file corpus |
| Universal ingestion | Extract claims from PDF, spreadsheets, ZIPs, screenshots and notes; expose ambiguity rather than hallucinating | **Vision** | Build extract → claims → confidence → canonicalise → human confirmation pipeline |
| Competition Blueprint / IR | Represent participants, divisions, stages, pools, qualifiers, brackets, scores, resources, constraints and policies | **Foundation** | Freeze IR v1 and test it against structurally different real formats |
| Deterministic compiler | Compile resolved intent into executable structure and schedule inputs | **Foundation / strong** | Existing compiler and connected St Albans journey; expand corpus coverage |
| Rules, standings and topology | Deterministic qualification, tie-breaks, seeding, byes, feeds and progression | **Foundation / strong** | Guard and compiler tests; prove more compositions without domain hacks |
| Scheduler | Respect hard constraints and optimise finish, rest, waiting, court use and dependencies | **Foundation** | Existing solver and assurance; add scenario comparison and measured experience metrics |
| Independent Guard / Run Assurance | Re-derive correctness, classify PASS/WARN/APPROVAL/BLOCK and provide evidence | **Foundation / strong** | Independent Guard, publication and adversarial/replay suites; extract cleaner first-class package |
| Visual Structure Map | Let organisers understand pools, feeds, brackets, warnings and revision deltas | **Pilot now / partial** | Structure Map closure evidence; deepen editing and explanation |
| Natural-language interpretation | Turn organiser language into a reviewable proposed mutation or blueprint, never direct truth | **Foundation / partial** | Narrative intake exists; build structured interpretation review and deterministic apply |
| Human editing | Visual, form and advanced structured editing against the same Blueprint | **Next / partial** | Complete guided Competition Builder after durable creation foundation |
| Scenario Lab | Compare server-derived plans, capacity, waits, finish and rule consequences; apply one exact revision | **Vision / partial foundation** | Build after durable creation; every comparison must be Guarded and revision-bound |
| Population and integrations | Map registrations and external sources into canonical participants, pairs and teams | **Foundation / partial** | Ticket Tailor and registration work establish adapter direction; complete canonical adapter layer |
| Live Run Control | Show NOW, NEXT, LATE, BLOCKED and NEEDS ATTENTION; provide contextual safe actions | **Pilot now / local evidence** | Dense 108-fixture rehearsal; real authenticated durable deployment remains open |
| Live repair | Handle no-shows, court outages, delays, withdrawals, corrections and walkovers | **Pilot now / local evidence** | Guarded rehearsals and replay tests; field and production persistence still open |
| Participant/public projections | Revision-scoped signed `/next`, venue display, recovery and targeted updates | **Pilot now / local evidence** | Signed projection and outbox tests; real provider/fallback remains open |
| Close and receipt | Prove every fixture/result/progression is complete; export, replay, restore and duplicate | **Pilot now / local evidence** | Closure/replay artifacts; staff-run production restore remains open |
| Identity and tenant authority | Real users, roles, organisations, tenant isolation and separate consequential approval | **Next** | Current code has production-shaped contracts; real auth/database integration is not yet proven |
| Durable production persistence | Real PostgreSQL, migrations, RLS, restart, backup, restore and observability | **External gate / Next** | Must use a real non-production environment; in-memory capability labels do not count |
| Delivery provider | Real messages, receipts, failure handling and safe fallback | **External gate** | Provider selection, credentials and failed-delivery exercise |
| Field resilience | Weak network, manual/paper operation, print, outdoor/mobile and assistive technology | **External gate** | Staff rehearsal and named field acceptance |
| Multi-sport / universal formats | Generic primitives plus governed sport and format policy packs | **Vision / evidence gap** | Tournament Torture Corpus before marketing “any tournament” |

## 7. Architecture

```text
Natural language / templates / files / integrations
                       ↓
              Interpretation layer
                       ↓
             Competition Blueprint / IR
                       ↓
             Definition Assurance
                       ↓
                    Scheduler
                       ↓
               Run Assurance + Guard
                       ↓
              Published exact revision
                       ↓
                 Live Runtime
                       ↕
                 Guarded commands
                       ↓
              Organiser / participant views
```

Bounded responsibilities:

- **Compiler:** defines what competition should exist.
- **Rules engine:** computes domain truth.
- **Scheduler:** proposes temporal allocation.
- **Run Assurance:** independently verifies definitions, dependencies, schedule, runtime, results and completion.
- **Guard:** grants or denies protected mutations.
- **Runtime:** records what actually happened.
- **Operations surfaces:** help people decide and act; they do not own truth.

The fundamental mutation pattern is:

```text
preconditions → proposed mutation → simulation → invariant checks
→ explicit approval if required → atomic commit → postconditions → audit event
```

## 8. Design principles

1. One product, one canonical model, one revision chain.
2. AI interprets and explains; deterministic code decides.
3. Hard invariants, operational policies and optimisation preferences stay visibly separate.
4. Published and played facts are protected; future plans may be repaired.
5. Every consequential action shows affected scope and evidence before commit.
6. Operator experience is exception-first: what needs attention now, not a database dashboard.
7. Stable fixture and participant identities are authoritative; display names are never used for binding.
8. Fail closed on missing identity, stale revision, forged evidence, unavailable solver, incomplete rules or uncertain external facts.
9. Every failure becomes a regression fixture where possible.
10. Do not claim a broader format, production readiness or field usability from local automated evidence alone.

## 9. Research synthesis and maturity assessment

The broader project assessment places the system in an uneven but promising state. These are directional product-studio estimates, not test metrics:

| Layer | Directional maturity |
|---|---:|
| Canonical model | 85–90% |
| Deterministic compiler | 85–90% |
| Qualification/topology/draw logic | 90%+ |
| Scheduler architecture | 80–85% |
| Guard / independent assurance | 90–95% |
| Revision/audit/runtime | 80–85% |
| Live recovery primitives | 75–80% |
| Universal ingestion | 30–40% |
| Visual builder/editor | 35–45% |
| Human-friendly AI interaction | 30–40% |
| Registration/integration ecosystem | 45–55% |
| Complete organiser workflow | 50–60% |
| Polished live control | 45–55% |
| Production operational proof | 50–60% |
| Universal-format evidence | 40–50% |

The central conclusion is important: the engine is ahead of the experience. The next investment should make the existing correctness real, durable and understandable—not add another isolated subsystem.

## 10. Roadmap and gates

### Programme 0 — Establish truth

Keep this document, traceability and release readiness synchronized. Every goal must state its job, boundary, evidence and fallback. Never count commits or local browser rehearsals as production readiness.

### Programme 1 — Durable controlled-pilot product

Order:

1. Close and independently QA the production-authority policy correction.
2. Connect real authentication, tenant membership and competition creation.
3. Connect a real non-production PostgreSQL environment and verify migrations, isolation, restart and replay.
4. Prove the continuous golden journey from creation through close and reopen with no seeded developer state.

Exit: a verified organiser can sign in, create a competition, compile, publish, operate, repair, close and reopen it against durable storage.

### Programme 2 — Operational release proof

1. Backup, restore and observability.
2. Delivery provider, receipts and fallback.
3. Weak-network/manual operation, print and assistive-technology field evidence.
4. Named support, venue, product, domain and operations approvals.

Exit: a controlled pilot is authorised for one explicitly bounded event envelope.

### Programme 3 — Best-in-class creation and trust

1. Universal ingestion pipeline.
2. Guided Competition Builder and visual editing.
3. Structured AI interpretation and explainable diffs.
4. Scenario Lab comparison and exact Guarded apply.
5. Operator analytics, “Why?” explanations and support/dispute tools.

Exit: an organiser can give Krateasy messy real material and confidently shape a safe plan without learning the internal model.

### Programme 4 — Evidence-led expansion

1. Tournament Torture Corpus: begin with 25 real unusual formats, then grow toward 50–100.
2. Classify failures as missing primitive, missing composition, interpreter failure or presentation failure.
3. Add governed sport packs, stages and integrations only when real demand and rules evidence justify them.

Exit: broader format claims are earned by reproducible corpus evidence, not by the presence of generic types.

## 11. The next real acceptance journey

The single most important acceptance test is:

```text
Real sign-in
 → create/import a new event
 → clarify sources and decisions
 → compile Blueprint
 → compare or review plan
 → Guard
 → approve and publish
 → operate live
 → score and correct
 → introduce a disruption
 → simulate and approve repair
 → notify affected participants
 → close
 → restore into isolation
 → reopen and duplicate cleanly
```

It must use real tenant authority and durable storage. It must not rely on pre-seeded reference state, direct database edits, local actors or a fake store claiming PostgreSQL capabilities.

## 12. Release truth

The current repository contains strong local engineering evidence for the St Albans-shaped compiler, Guard, publication, Run Control, participant projection and closure journey. It is not yet a production-ready hosted product.

Production claims remain blocked until the release-readiness gates have named owners and evidence for:

- real identity and tenant authority;
- production PostgreSQL, backup and staff-run restore;
- delivery provider and fallback;
- venue safety facts;
- weak-network/manual rehearsal;
- assistive-technology, print and outdoor/mobile inspection;
- support and rollback ownership;
- competition-rules and product-envelope approval;
- assurance and event-operations approval.

The safe product claim today is:

> Krateasy has a substantial deterministic competition engine and a locally verified connected pilot journey. A durable, authenticated and field-approved pilot remains to be completed.

## 13. Source map

| Source | Role |
|---|---|
| `KRATEASY_COMPETITIONS_JOBS_X_BIER_IMPLEMENTATION_CHARTER.md` | Original Jobs × Bier reset and product thesis |
| `PRD-Krateasy-Competitions-Execution-Control.md` | PRD, implementation authority and traceability |
| `docs/jobs-to-be-done.md` | Product-system lens and feature admission |
| `PILOT-CRITICAL-EXECUTION-PLAN.md` | Pilot-critical execution chain |
| `docs/competition-guard-publication.md` | Guard/publication rules |
| `docs/product-scope-and-surface-contract.md` | Product boundary and core loop |
| `apps/compiler-web/DESIGN.md` | Implemented visual system and accessibility rules |
| `docs/requirements-traceability.md` | Requirement-to-code/test evidence |
| `docs/pilot-release-readiness.md` | Release decision, blockers and fallbacks |
| `outputs/current-product-truth-2026-09-14.md` | Snapshot of product truth |
| `outputs/best-in-class-execution-roadmap.md` | Earlier milestone roadmap |
| External product-studio assessment supplied with this specification | Maturity split, ingestion/editor gap, Torture Corpus and four-programme recommendation |

## 14. Change-control rule

Every future engineering goal must cite this document and identify:

- the customer job;
- the lifecycle state;
- the one authoritative boundary changed, if any;
- the exact surface affected;
- what is explicitly out of scope;
- executable and human evidence required;
- which release claims remain blocked.

No goal may introduce another engine, competition model, standalone assurance product, generic admin surface or feature island without an explicit product-owner decision recorded here.
