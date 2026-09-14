# Krateasy Competitions product reset and continuous-slice contract

Date: 2026-09-14

## Decision

No prior engine, research, product-atlas, multi-universe, Competition Guard,
participant-attention, or live-repair work is being discarded.

The failure was that the visible clients exposed those capabilities as a feature
gallery and several unrelated rehearsals. The engine is much more mature than
the customer experience. The corrective work is integration and hierarchy, not
a smaller product.

Krateasy Competitions is:

> A multi-organisation competition operating system that turns messy intent
> into a verified plan, publishes one trustworthy version, keeps participants
> informed without installation, and safely repairs live disruption.

Natural language is a signature input. It is not the whole product and it is not
a second engine.

## Product spine

```text
Organisation universe and memory
  Clubs · people · teams · places · resources · formats · team · settings
                              │
                              ▼
Create / duplicate / import / describe / JSON
                              │
                              ▼
Recognise → clarify → canonical TournamentSpec
                              │
                              ▼
Compile structure → generate schedules → compare trade-offs
                              │
                              ▼
Competition Guard → human approval → authoritative publication
                              │
                              ▼
Run → score → incident → validated repair → targeted communication
                              │
                              ▼
Complete → replay → export → reuse as a governed format version
```

Every step must retain one organisation ID, club scope, competition ID,
definition revision, plan revision, operational revision, actual result history,
and audit chain. A fixed demo may illustrate a capability but may not masquerade
as the continuation of a newly created competition.

## What is retained, moved, parked, and deferred

| Decision | Capability | Reason |
|---|---|---|
| Retain in the core | Canonical TournamentSpec, typed graphs, qualification, draws, scheduling, simulation, revisions, deterministic replay | This is the original product and technical moat. |
| Retain in the core | Sport rule packs, static and dynamic formats, solver portfolio, independent validation, tested envelopes | Breadth remains real only where executable evidence closes it. |
| Retain as a visible differentiator | Competition Guard, exact-revision publication, explainability, minimum-change repair | This is the trusted recovery promise competitors generally do not make. |
| Retain as a visible differentiator | Install-free personal next-match view, targeted messages, venue display, delivery fallback | This directly addresses real participant and desk pain. |
| Retain around the lifecycle | Organisation universes, clubs, roles, persistent directories, seasons, format library, alerts, privacy and backup contracts | These create security, memory, reuse, and multi-event value. |
| Move out of primary navigation | Raw graph, solver runs, proof hashes, requirement ledger, replay and technical evidence | They belong in an advanced workbench and expandable “Why is this valid?” details. |
| Retain the Mac app | Professional organiser and event-day cockpit | Native density, keyboard speed, offline continuity, and tangible premium quality can be valuable. It must use the same API and truth as web. |
| Make web canonical | Full organiser Studio and universal browser access | It has the lowest deployment and adoption friction and must carry the complete lifecycle first. |
| Keep separate but connected | `/next`, event public view, venue display | These are participant/public projections of one competition, not organiser navigation destinations. |
| Defer until the core slice is pilot-proven | Ratings, partner matching, feeds, chat, sponsor inventory, social graphics, deep white-label controls | Valuable later, but they do not repair the discontinuous core journey. |

## Surface model

### Web Studio

The complete, canonical organiser product:

```text
Workspace
├── Competitions
├── Templates
├── People & places
├── Team
└── Settings

Selected competition — lifecycle-aware
├── Draft: Setup · Plan · Publish
├── Published/live: Today · Schedule · People · Communications
└── Complete: Results · History · Reuse
```

### macOS / iPad professional client

Keep it, but connect it rather than expanding a parallel demo. Its proper role is
high-density schedule operation, keyboard commands, multi-window monitoring,
offline command capture, venue displays, and incident continuity. It may not own
local-only competition truth.

### Participant and public web

No install, account, or PWA prompt before value. The primary answer is next time,
arrival target, opponent/dependency, public resource name, current status, and
freshness. Optional Wallet, calendar, notification, account, or app retention
comes afterward.

### Advanced workbench

Graph, constraint inspector, solver status, proof, rules provenance, semantic
diff, revision history, event log, replay, capability ledger, and scale envelope.
This remains accessible to expert organisers, support, auditors, and governing
bodies without crowding the normal path.

## Equivalent creation doors

The following are adapters into the same canonical specification and validation
pipeline:

1. Duplicate a prior event.
2. Start from a governed format template.
3. Paste participant names and use quick setup.
4. Describe the event in ordinary language.
5. Import CSV/XLSX with an explicit mapping and quarantine.
6. Import strict JSON or a versioned TournamentSpec.
7. Compose a typed custom graph in the expert workbench.

Every door must display recognised facts, source provenance, assumptions,
unresolved material questions, invalid values, and unsupported clauses. None may
write live competition truth directly.

## Current truth after the reset

| Layer | Current evidence | Honest status |
|---|---|---|
| Compiler and competition engine | Extensive typed engines and automated conformance, fuzz, solver, Guard, replay, tenant and lifecycle tests | Core, tested inside named envelopes |
| Organisation platform | Roles, clubs, directories, templates, tournament lifecycle, privacy, backup and operator commands exist in tested domain/API code | Core backend; production composition still required |
| Web product | New organisation-first workspace and lifecycle-aware selected-competition shell; old feature gallery moved to `/lab` | Local reference, not production |
| Assisted creation | Ordinary language, quick setup and strict JSON now converge on one explicit proposal; values are bounded and unknown fields fail closed | Local reference adapter |
| Continuous arbitrary-event journey | The fixed Play & Konnect event demonstrates later stages, while newly saved drafts still stop before real compilation | Critical integration gap |
| Participant attention | `/next`, operator attention and venue display work as a local rehearsal | Strong concept; production tokens, providers and privacy boundary required |
| Mac client | Builds and demonstrates native surfaces, but reads fixed projections and saves local drafts | Retained reference client; write/API/offline integration required |
| Production infrastructure | Durable store, migrations, security, worker, readiness, backup and deployment contracts exist | Provisioning, credentials, identity, provider and live drills required |

## Non-negotiable next engineering gate

One newly created competition—not a fixed scenario—must complete this chain:

```text
Create → interpret → resolve → compile → schedule → compare → Guard → approve
→ publish → call → score → disrupt → repair → notify → complete → duplicate
```

The slice should first support the initial proven wedge: a multi-division racket
or paddle event with pools, knockout/placement paths, rest, shared resources,
and a live court outage. It must reuse the actual engine, Guard, platform and
participant projections. Only then should more customer-facing surfaces be
added.

## Product-quality gates

- A first-time organiser always knows which organisation and competition is open.
- All competitions and organisation switching remain available from every event.
- Every screen has one dominant next action tied to lifecycle state.
- Technical evidence is available but never required to understand ordinary work.
- No action silently invents a rule, relaxes a hard constraint, changes a live
  promise, sends a message, or crosses a tenant.
- Web and Mac display the same revision and authority state.
- Participant information works without installation and shows freshness.
- Every local rehearsal, reference capability, integration seam, and production
  feature is labelled honestly.

This contract supersedes any interpretation that the product should be reduced
to an AI prompt form or that the Mac client should be discarded.
