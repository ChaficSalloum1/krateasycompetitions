# Krateasy Competitions Product-System Lens

**Status:** Product-system authority for customer experience, surface placement and feature admission
**Date:** 16 September 2026
**Companion authorities:** [`PRD-Krateasy-Competitions-Execution-Control.md`](../PRD-Krateasy-Competitions-Execution-Control.md), [`PILOT-CRITICAL-EXECUTION-PLAN.md`](../PILOT-CRITICAL-EXECUTION-PLAN.md), and [`requirements-traceability.md`](./requirements-traceability.md)

## 1. One product, one truth

**Krateasy Competitions** is the product. It helps an organiser turn imperfect event information into a competition they can understand, publish, run, recover and defend.

**TournamentOS** is the internal deterministic competition core. It is not a separate customer product, a second organiser workflow, or an alternative source of truth.

The product promise is:

> Describe or import the competition. Krateasy makes the rules explicit, proves the plan is runnable, publishes one trustworthy version, and helps the organiser recover when reality changes.

AI may interpret, suggest and explain. It never decides standings, qualification, schedule legality, Guard certification or publication. Those remain deterministic and independently verifiable.

## 2. The only lifecycle

```text
Sources and organiser decisions
        ↓
Competition Design
        ↓
Certified Plan
        ↓
Published Promise
        ↓
Live Operation
        ↓
Closed Evidence Record
        ↓
Clean Edition for the next competition
```

The technical layers remain distinct:

| Product language | Technical authority | May change it |
|---|---|---|
| Competition Design | Canonical `TournamentDefinition` / compiled `TournamentSpec`, source provenance and approved decisions | Organiser proposal, then approval |
| Certified Plan | Graph, draw, schedule, simulation and independent Run Assurance evidence | Compiler; Guard validates |
| Published Promise | Exact approved artefact set and publication certificate | Guarded atomic publication only |
| Live Operation | Operational revisions, assignments, incidents and actual results | Strict server-owned commands and approved repairs |
| Closed Evidence Record | Close certificate, replay, export and restore bundle | Guarded close/restore workflow |

Do not introduce another competition model named “Blueprint.” The existing source-intake `CompetitionBlueprint` is a bounded input DTO; the canonical definition remains `TournamentDefinition` / `TournamentSpec`.

## 3. The five north-star jobs

### J1 — Make my event runnable

**When** I have registrations, venue facts, rules and preferences in several formats, **I want** Krateasy to turn them into one editable Competition Design, **so I can** create a complete competition without modelling brackets or schedules manually.

Success means sources, conflicts, missing decisions, assumptions and provenance are visible; the organiser can edit the design; and unsupported semantics stay unresolved rather than being guessed.

### J2 — Approve a plan I can defend

**When** Krateasy proposes pools, qualification, brackets and a schedule, **I want** to understand the proof, trade-offs and consequences, **so I can** publish a plan without discovering a contradiction during the event.

Success means the Run Assurance report independently verifies structure, qualification, bracket paths, contest accounting, capacity and scheduling; semantic/operational diffs are visible; and publication requires a fresh Guard decision.

### J3 — Keep the event moving

**When** the competition is live, **I want** one operational view of what needs attention, **so I can** check in people, run contests and record results without conflicting versions of the event.

Success means the control room, participant `/next`, public display and Mac client read the same published and operational heads; commands are idempotent, permissioned and replayable; and proof is available without obscuring the next action.

### J4 — Recover safely when reality changes

**When** a pair withdraws, a court closes, a match overruns or a score is corrected, **I want** safe, explained repair options, **so I can** preserve known truth and recover without creating an illegal competition.

Success means completed and in-progress truth is preserved; impact and affected people are explicit; repairs are deterministic candidates, not AI assertions; the relevant Run Assurance checks re-run; and a separately approved revision is the only way to change live public truth.

### J5 — Finish, explain and repeat

**When** the event ends or a decision is challenged, **I want** a complete evidence record and a clean next edition, **so I can** close the event confidently, audit it later and reuse the work.

Success means every required contest has a governed terminal state, results and advancement replay from source facts, exports are verifiable, restore is proven, and duplication starts a new clean design rather than copying live history.

Participant `/next` is the customer promise generated by J3 and J4; it is not a separate competition model.

## 4. Product surfaces, not feature islands

There are four primary surfaces. Every customer-facing feature belongs to one of them.

| Surface | Primary jobs | What it contains | What it must not become |
|---|---|---|---|
| **Organiser Studio** | J1, J2 | Sources, Design, Structure Map, Scenario comparison, Publish Review | A raw engine console or a second competition truth |
| **Run Control** | J3, J4 | Now/Next/Attention, score entry, incidents, Change Review and approval | A collection of administrative pages or an unguarded edit tool |
| **Participant and public web** | J3, J4 | Personal next action, venue display and privacy-minimal recovery | An organiser aggregate view or an unversioned schedule |
| **Close and Integrity Receipt** | J5 | Close review, evidence, replay, export, restore and clean duplication | A marketing claim detached from the actual event history |

The Mac is a resilient professional client of these same surfaces: dense Studio/Run Control when connected, signed offline truth and a durable command journal when disconnected. It is not a second product.

Structure Map, Scenario Lab, Publish Review and Change Review are contextual modes inside Studio or Run Control. They are not separate applications or top-level navigation silos.

## 5. System-design contract

```text
Untrusted sources / organiser edits / AI interpretation
                    ↓
          Competition Design proposal
                    ↓
    Compiler and scheduler create candidate artefacts
                    ↓
 Run Assurance independently derives evidence and findings
                    ↓
 Guard applies the relevant policy at a protected command
                    ↓
  Atomic authoritative revision or explicit non-commit
                    ↓
 Live Runtime records operational and actual facts
                    ↓
 Run Assurance + Guard re-evaluate only the affected scope
```

Run Assurance is the user-facing proof capability. It includes definition, roster, pool, qualification, bracket, schedule, dependency, runtime, result, completion and historical assurance. The **Guard** is the enforcement kernel at mutation boundaries; it does not replace domain logic or silently repair an invalid state.

Hard invariants, governed operational policies and optimisation preferences must always remain visibly separate:

| Category | Example | Behaviour |
|---|---|---|
| Hard invariant | A possible participant cannot occupy two courts at once | Block; no override makes it valid |
| Governed policy | Minimum rest or a fixed final court | May require named authority and an explicit non-standard revision where policy permits |
| Optimisation preference | Earlier finish, fewer court moves, lower wait | Compare and explain; never masquerade as correctness |

The detailed six-level Guard severity policy remains the technical authority. The product may present it as four clear decisions: **ready**, **review warning**, **approval required**, or **blocked**.

## 6. Product-flexibility envelope

The first product claim is deliberately narrow and evidence-based:

- St Albans multi-division pools-to-Konnect/Tower event;
- six-pair round robin; and
- eight-pair single elimination.

These prove that the same lifecycle is not a fixture-specific path. They do not authorise claims for Swiss, double elimination, arbitrary sport semantics, individuals or team journeys unless a registered policy and connected end-to-end evidence exists.

Examples in product copy are illustrative only. Event counts, duration policies and names always derive from the selected Competition Design; they must never become hard-coded product assumptions.

## 7. Feature-admission rule

A feature may enter the pilot only if its owner can answer all four questions:

1. Which of J1–J5 does it improve?
2. Which lifecycle state does it read or change?
3. Which authoritative revision, command or event gives it truth?
4. Which of the four product surfaces contains it?

If any answer is unclear, the work is deferred, moved to an advanced/reference surface, or first resolved through a product/architecture decision record. No feature enters merely because the engine can support it.

## 8. Delivery focus after the connected system

The remaining pilot work is primarily operational rather than compiler breadth:

1. make real provider failure trigger the declared fallback;
2. complete emergency, disconnect and paper-to-restored-system rehearsals with named staff;
3. complete named assistive-technology, print and outdoor/mobile inspection;
4. document support ownership, limitations and rollback; and
5. obtain the independent human approvals required by the release authority.

The implementation plan owns those gates. The traceability ledger remains the evidence source. This document prevents either from turning the product into a collection of disconnected capabilities.
