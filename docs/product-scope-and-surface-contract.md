# Krateasy Competitions product scope and surface contract

Date: 2026-09-14

## The product in one sentence

Krateasy Competitions turns a competition idea into a validated operating plan,
publishes one trustworthy version, and helps organisers keep the event moving
when reality changes.

The internal TournamentOS compiler is the correctness kernel. It is not a second
customer-facing product.

## The only core loop

```text
Describe or choose
        ↓
Formalise the format and rules
        ↓
Build the draw and schedule
        ↓
Guard, explain and approve
        ↓
Publish one authoritative version
        ↓
Run, score and safely repair
        ↓
Close, replay and reuse
```

An organisation workspace surrounds this loop with people, roles, reusable
templates and history. It is a security and memory boundary, not a competing
workflow.

## Status vocabulary

| Label | Exact meaning |
|---|---|
| **CORE — tested** | Deterministic engine or platform behaviour exists and has automated tests. |
| **REFERENCE — usable locally** | A working local UI, API, adapter or deployment boundary exists, but it is not a connected production service. |
| **INTEGRATION — required** | The contract or seam exists, but real Krateasy identity, infrastructure, credentials or providers are still needed. |
| **PARKED — research only** | A researched opportunity. It is not part of the current product and should not appear as if available. |

## One platform, four customer surfaces

| Surface | Primary user and job | What belongs here | What does not belong here | Current truth |
|---|---|---|---|---|
| **Install-free public web** | Player, parent, spectator: “What do I need to do next?” | Personal next match, arrival time, court, opponent, changes, results and standings | Compiler, tenant settings, proofs, complex navigation | **REFERENCE — usable locally.** A responsive public event view exists; opaque personal links, registration and production delivery are not connected. |
| **Krateasy mobile** | Existing Krateasy player or on-the-move official/organiser | My competitions, alerts, check-in, focused scoring, next actions and quick-play creation | Dense format design, full evidence inspection, broad admin | **INTEGRATION — required.** A compact shared SwiftUI client exists, but it is not yet integrated into the existing Krateasy mobile application or production identity. |
| **Competitions Web Studio** | Coach, facility owner, promoter, league or federation staff | Complete create, review, schedule, operate and recover journey from any browser | Consumer social feed, booking marketplace, raw engine internals as the home | **REFERENCE — usable locally.** The engine-backed Studio and pilot API work locally; production auth, hosting and persistence composition remain. |
| **Competitions Studio for Mac/iPad** | Professional operator: “Give me speed, density and resilience on event day.” | Multi-workspace portfolio, guided creation, control room, schedule, people, issues, scenarios and evidence | A separate Mac copy of competition truth; mandatory player installation | **REFERENCE — usable locally.** The native app builds and switches isolated demo workspaces. Its network client is currently read-oriented and creation saves local drafts; production writes and identity are not connected. |

Every surface uses the same competition IDs, revisions, permissions, API and live
event stream. Layouts may differ by job and device; truth may not.

## Capability placement: what we have, where it goes, and why it stays

### 1. Create and formalise

| Capability | Owning layer | Visible location | Status | Why it deserves to exist |
|---|---|---|---|---|
| Versioned competition specification and strict validation | Compiler core | Hidden behind creation and review | **CORE — tested** | Prevents a plausible-looking UI from creating an incoherent event. |
| Guided six-step creation | Web and Mac/iPad Studio | New competition | **REFERENCE — usable locally** | Gives ordinary organisers a predictable path without exposing the compiler. |
| Quick play, club event, league/season and complex-event entry paths | Studio portfolio; quick play ultimately in mobile/web | New competition | **REFERENCE — usable locally on Apple** | Starts with the organiser’s job while retaining one underlying builder. |
| Constrained natural-language interpretation | Compiler core; surfaced as assisted input | Format and rules | **CORE — tested** | Speeds translation of unusual requirements while refusing invented policy. It remains proposal-only. |
| Reusable versioned formats and organisation defaults | Organisation platform | Format library and creation | **CORE — tested backend; REFERENCE UI** | Makes repeat events faster and compounds organiser knowledge. |
| Sport semantics and governed rule packs | Compiler core | Plain-language rules review; technical detail on demand | **CORE — tested within named envelopes** | Captures real scoring and ranking differences without sport-specific product forks. Authority review is still required before claiming official jurisdictional compliance. |

### 2. Prove and publish

| Capability | Owning layer | Visible location | Status | Why it deserves to exist |
|---|---|---|---|---|
| Topology, pools, qualification, draws, standings and tiebreak evidence | Competition engine | Overview, format, standings and explanations | **CORE — tested** | This is the basis for handling difficult formats correctly and defensibly. |
| Resource-aware scheduling, exact small search and CP-SAT portfolio | Competition engine | Schedule and scenario comparison | **CORE — tested within published envelopes** | Produces workable plans under courts, time, rest, official, equipment, closure and dependency constraints. |
| Independent schedule validation and honest solver status | Competition Guard | Review, Issues and Evidence | **CORE — tested** | A solver may propose; an independent path must prove hard validity. |
| Competition Guard and hash-bound publication certificate | Competition Guard/platform | Review and publish; Evidence for experts | **CORE — tested** | Guarantees that the exact approved artefacts are the ones published. This is a central product differentiator. |
| “Why this?” and counterfactual explanations | Engine/read model | Match or schedule detail | **CORE evidence exists; REFERENCE UI is partial** | Converts correctness into organiser trust and faster dispute resolution. |
| Immutable revisions, semantic changes and approvals | Organisation platform | Review and publish | **CORE — tested backend; REFERENCE UI** | Prevents silent changes and preserves accountability. |

### 3. Operate and recover

| Capability | Owning layer | Visible location | Status | Why it deserves to exist |
|---|---|---|---|---|
| Now, next, late, blocked and missing-result queues | Live-operation read model | Run event | **CORE — tested; REFERENCE UI** | Replaces the desk’s mental model with a single actionable queue. |
| Check-in, start, score, finish, walkover, retirement and correction commands | Operator API/live state | Focused match action on mobile, iPad, web or Mac | **CORE — tested API; UI writes not yet complete** | These are the authoritative actions required to run an event. |
| Court/official/equipment outage, withdrawal, protest and appeal | Live state | Incident action | **CORE — tested API; UI workflow partial** | Models real event-day disruption instead of treating the original schedule as reality. |
| Minimal-change schedule repair with impact preview | Live-change engine | Repair flow in Studio | **CORE — tested; REFERENCE UI is partial** | This is the clearest wedge beyond ordinary bracket products: recover safely with minimum disruption. |
| Separate approval before applying material repairs | Platform/live change | Repair review | **CORE — tested** | Keeps AI and solvers advisory and avoids accidental live mutation. |
| Targeted notification drafts and durable outbox | Platform/infrastructure | Communication review | **CORE protocol — tested; provider INTEGRATION required** | Tells only affected people after approval and supports reliable replay. |

### 4. Remember and reuse

| Capability | Owning layer | Visible location | Status | Why it deserves to exist |
|---|---|---|---|---|
| Organisation workspaces, clubs, memberships, invitations and roles | Platform/identity | Workspace switcher, Team and Settings | **CORE — tested backend; Apple switcher REFERENCE** | Gives each organiser a durable, isolated operating home. |
| Player, team, venue, court, official and equipment directories | Organisation platform | People and places | **CORE — tested backend; REFERENCE UI is limited** | Avoids rebuilding the same operational facts for every event. |
| Competition lifecycle, duplication, revisions and archive | Organisation platform | Portfolio | **CORE — tested backend; REFERENCE UI is partial** | Makes the system useful across many events rather than for one bracket. |
| Audit, replay, certified export and verified restore | Core/platform/infrastructure | Evidence, export and administration | **CORE — tested locally; production drill required** | Preserves authoritative history for disputes, recovery and portability. |

## Platform capabilities that support the product but must stay out of the way

| Capability | Correct home | Why it is not primary navigation | Current truth |
|---|---|---|---|
| Authentication, recovery and consent | Krateasy account layer | It enables work; it is not the competition job | Recovery/privacy primitives exist; real identity provider integration is required. |
| Tenant isolation and authorisation | Every server boundary | Security should be enforced, not marketed as a workflow | Deny-by-default roles, audit and forced-RLS production contracts exist; deployment composition remains. |
| Rate limits, webhook replay protection and request budgets | Production API edge | Invisible unless something fails | Implemented and tested in the production boundary. |
| PostgreSQL event store and transactional outbox | Infrastructure | Implementation detail behind reliable truth | Adapters/migrations and isolated verification exist; managed production deployment remains. |
| Health, telemetry, backups and incident runbooks | Operations | Admin/operator concern, not normal organiser navigation | Reference implementation and runbooks exist; provider-backed drills remain. |
| Custom public domains and branding | Organisation Settings → Public presence | Important packaging, but unrelated to competition correctness | **INTEGRATION — required.** The current organisation model does not yet contain the complete versioned domain/brand entitlement model. |

## Capabilities that are adjacent, not Competition Core

These can integrate through explicit APIs and certified competition events. They
must not become reasons to complicate the core creation or live-operation loop.

| Capability | Product owner | Decision |
|---|---|---|
| Facility booking and court inventory commerce | Krateasy booking | Integrate availability and reservations; do not rebuild a booking marketplace here. |
| Registration, entry fees, refunds and payouts | Krateasy commerce / provider integration | Necessary for an end-to-end commercial product, but keep payment truth outside the compiler. Not yet production-connected. |
| Cross-event ratings and player history | Krateasy player identity | Consume certified results; never let a silent rating decide competition eligibility or seeding without an explicit approved rule. |
| Partner matching and social discovery | Krateasy player product | Park until the competition journey is proven. It is not a Studio feature. |
| Classes and activities | Krateasy facility product | May use shared identity, venue and payment primitives; do not model a class as a tournament stage. |
| Sponsor inventory, branded court names and social graphics | Public/presentation layer | Useful commercial extension after the public next-match and result journeys work reliably. Operational court IDs remain stable beneath sponsor display names. |
| Video, highlights and performance analytics | Separate media service | Subscribe to certified match/result events; never block scheduling, scoring or repair. |
| Broad community feed or chat | Krateasy consumer product | **PARKED.** It does not strengthen the present wedge. |

## The minimum lovable product

The first production pilot should contain only this complete loop:

1. An organiser signs in and selects one workspace.
2. They create from a template or guided flow and import/select participants.
3. The engine builds the competition and resource-aware schedule.
4. Issues, assumptions and required decisions are made understandable.
5. An authorised person approves and publishes a Guard-certified revision.
6. Every participant receives an install-free personal next-match link.
7. Staff score and manage the event from a focused control room.
8. A delay, court outage or withdrawal can be previewed, safely repaired,
   approved and communicated.
9. The event closes into a replayable record and can be duplicated.

If this loop is not excellent, branding tools, social features, ratings, partner
matching, video and broad white-label customisation do not compensate for it.

## Navigation contract

### Studio portfolio

```text
Workspace switcher
├── Competitions
├── Templates
├── People & places
├── Team
└── Workspace settings
```

### Open competition

```text
All competitions  ← permanent escape

OPERATE
├── Home
├── Run event
├── Schedule
└── People

DESIGN & VERIFY
├── Format & rules
├── What-if plans
├── Issues
└── Evidence
```

“Compiler”, “graph”, “proof hash” and “API” are not normal top-level navigation.
They appear as progressive detail under Format, Issues or Evidence.

### Public/player

```text
My next match
├── When to arrive
├── Court / location
├── Opponent or qualifying dependency
├── What changed
└── My day

Event
├── Live
├── Schedule
├── Standings / draw
└── Results
```

## Feature admission rule

A proposed feature enters the active roadmap only if it measurably does at least
one of the following:

1. Reduces time to a correct publishable competition.
2. Prevents an invalid, unfair or unauthorised decision.
3. Reduces event-day intervention, delay or repair disruption.
4. Gives a participant or operator a clearer next action.
5. Makes a repeat competition materially easier through trusted organisation memory.

It must also have one named user, one observed painful moment, one success metric,
one safe fallback and one owning surface. Otherwise it is parked.

## Immediate product sequence

1. Connect production identity and workspace discovery to Web Studio and Apple Studio.
2. Connect competition CRUD and operator write commands; remove the local-draft/demo seam from production builds.
3. Complete the golden organiser journey through Guard-certified publication.
4. Complete the install-free personal next-match experience and real notification provider.
5. Complete the outage/withdrawal repair journey end to end.
6. Run observed pilot events with manual fallback and measure desk questions,
   publish time, repair time, schedule movement and participant comprehension.
7. Only after those results decide which adjacent commercial capability enters next.

## Minimalist decision

Simplify, do not split. Keep one connected Krateasy Competitions platform and one
authoritative engine. Sell and validate the complete pilot loop before expanding
the number of products or feature categories. The largest risk is presenting
well-tested backend primitives and researched opportunities as if they were one
finished customer experience.

The validation action for this week is one real event rehearsal: give an organiser
the Web/Mac Studio, give participants only personal browser links, remove one court
mid-simulation, and record every moment someone asks what to do next or returns to
a spreadsheet or message thread.
