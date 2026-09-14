# Krateasy Competitions: Jobs × Bier Implementation Charter

**Date:** 14 September 2026  
**Purpose:** restore the original competition-product thesis, map every researched capability to a real customer job, and turn the existing implementation into a coherent programme.

---

## 1. The reset

We have not lost the underlying idea. We have lost the hierarchy that makes the idea usable.

The original product is not a prompt box, a bracket maker, a solver dashboard, a Mac app, or a collection of tournament utilities. It is one connected operating system:

> **Describe the competition. Krateasy compiles it into something you can safely run, keeps the published promise trustworthy, and helps you recover when reality changes.**

The system must answer two questions better than the spreadsheet-and-WhatsApp stack:

1. **Can this competition actually work?**
2. **When the plan stops matching reality, what is the safest next decision?**

The product therefore has one lifecycle:

```text
Bring what I have
      ↓
Recognise and formalise my intent
      ↓
Build the competition and schedule
      ↓
Prove, compare and approve
      ↓
Publish one authoritative promise
      ↓
Run, score and communicate
      ↓
Freeze, repair and republish when reality changes
      ↓
Close, replay and reuse what was learned
```

Everything in the roadmap must strengthen that lifecycle. Anything else is downstream, adjacent, or parked.

## 2. What “Jobs × Bier” means here

This is the doctrine established in the earlier research, not a decorative design style.

### Jobs

- Ruthless hierarchy around the user’s real progress.
- One coherent end-to-end experience.
- Meaningful defaults and progressive disclosure.
- Craft, restraint, accessibility, and trust.
- No internal architecture presented as a customer workflow.

### Bier

- Useful output before commitment.
- Short loops from input to visible value.
- Low-friction collaboration and distribution.
- Observable social utility: the output helps another person immediately.
- Product growth carried by trustworthy schedules, updates, and results—not engagement tricks.

### The combined test

Every feature must answer all six questions:

1. What situation triggers this job?
2. What progress is the person trying to make?
3. What anxiety or failure are they avoiding?
4. What useful value appears in the first interaction?
5. How does the result help another person or make the next event easier?
6. What objective evidence proves the job was completed safely?

If a feature cannot answer these questions, it does not enter the active roadmap.

## 3. Product boundaries

### One product, one truth, different views

**Krateasy Competitions is one product.** The web is its primary experience for creating, running, and sharing competitions.

The **existing competition core**—the compiler, scheduler, Guard, simulation, repair, and replay work already built in the main implementation—is shared by everything. We are not creating another engine or rebuilding that work.

The Mac app is an optional professional client for offline and high-pressure event operation. It uses exactly the same competition truth. We retain it only if pilots prove that its native and offline advantages justify maintaining it; it must not delay the complete web journey.

### The five permanent separations

The engine and interface must never conflate:

1. Qualification — who advances.
2. Competitive seeding — what protection was earned.
3. Bracket topology — the structural graph.
4. Draw placement — where entrants are placed.
5. Scheduling — when and where contests happen.

### AI authority boundary

AI may interpret, explain, critique, and propose. It may not create authoritative competition truth.

```text
Interpreter              Compiler / Solver              Independent Verifier
What might they mean? →  What satisfies the rules?  →   Was every rule satisfied?
```

All natural-language, form, spreadsheet, and JSON entry paths converge on the same canonical specification, type checker, engine, validation, revision, approval, and publication pipeline.

## 4. Evidence we have—and evidence we still need

### What the present direction is grounded in

- The original Universal Tournament Compiler specification and its proof-oriented architecture.
- The Play & Konnect reference format, including unequal pools, two cups, byes, play-ins, rematch protection, mixed durations, shared resources, rest, and interleaving.
- The Modified Americano benchmark, which tests dynamic pair identity and runtime round generation.
- Competitor/category research across lightweight bracket products, federation software, tournament presentation tools, event suites, club systems, and the spreadsheet/message shadow stack.
- Prior product, UI/UX/accessibility, event-day trust, participant-attention, organisation-platform, and production-boundary audits.
- Observed founder/organiser pain: the present surfaces are rigid, engine-shaped, fragmented, and make basic creation or modification harder than the original promise.
- Observed participant behaviour in Play & Konnect: people do not reliably install a PWA and repeatedly ask the desk for their next action.

### What must remain labelled as a hypothesis

- A clean common event can reach a feasible first schedule within 15 minutes.
- A personal next-match page can reduce “when do I play?” desk questions by 70%.
- Trusted repair is strong enough to be the paid design-partner wedge.
- Professional operators need a separately maintained native Mac/iPad client.
- Sponsors and verified social assets materially improve acquisition or event economics.
- The current named sport packs are sufficiently complete for governing-body claims.

These are not copywriting claims. They are pilot questions.

## 5. The product’s twelve job tracks

The roadmap is organised around customer progress loops. Engine primitives are supporting capabilities, never separate products.

---

### Job 1 — Establish a trusted operating home

**Job story:** When I run recurring events across one or more clubs, I want my people, places, roles, and approved ways of working to persist, so I can start the next competition from trusted organisational memory instead of rebuilding everything.

**Pain and anxiety:** duplicate players; stale venues; unclear permissions; demo data mixed with real data; uncertainty about which club or event is open.

**Feature scope:**

- Sign-in, recovery, consent, and workspace discovery.
- Organisation and club switcher with visible current role.
- Memberships, invitations, scoped roles, and separation of duties.
- Player, pair/team, venue, resource, official, and equipment directories.
- Competition portfolio with drafts, upcoming, live, completed, and archived events.
- Reusable organisation defaults and versioned templates.

**Jobs × Bier first value:** let an organiser import or select a known club before asking them to configure the platform; show the next event or the next consequential decision immediately.

**Acceptance criteria:**

1. Every request is scoped to one authenticated organisation; cross-organisation identifiers fail closed.
2. The current organisation, club, role, and competition are visible and switchable without losing work.
3. `All competitions` and `New competition` remain reachable while an event is open.
4. Imports produce reviewable matches, conflicts, and provenance rather than silent merges.
5. Role-sensitive actions state who may perform them and why.
6. A completed event can seed a new draft without sharing mutable historical records.

**Primary metric:** median time from sign-in to resuming the intended event or starting from trusted reusable data.

---

### Job 2 — Bring the messy reality I already have

**Job story:** When my tournament exists as a sentence, spreadsheet, previous event, form, or JSON file, I want Krateasy to recognise it without making me translate it into software concepts, so I can see useful structure before committing to setup.

**Pain and anxiety:** blank configuration canvases; rigid forms; inability to enter the number of pairs; re-keying rosters; fear that import will corrupt existing data.

**Feature scope:**

- Four equal entry doors: **Describe**, **Quick setup**, **Import**, **Duplicate**.
- Ordinary-language input for format, entrant count, divisions, resources, timings, priorities, and exceptional rules.
- Compact form for event type, participant unit, counts, date/time, resources, and desired structure.
- CSV/XLSX mapping, sheet preview, conflict quarantine, formula-injection protection, and rollback.
- Validated JSON/YAML import against the canonical schema.
- Previous-event duplication with explicit pinned versions and editable deltas.
- Autosaved resumable drafts.

**Jobs × Bier first value:** after the first input, show **What we recognised**, **What still needs a decision**, and a provisional shape. Do not require account expansion, notification permission, or expert configuration before this moment.

**Acceptance criteria:**

1. All entry doors compile into the same draft schema and requirement ledger.
2. A user can specify entrants as individuals, fixed pairs, or teams and see the interpreted unit before compilation.
3. Imported rows are previewed with mapped, missing, duplicate, and quarantined states.
4. Invalid JSON/YAML receives path-specific, human-readable errors and cannot bypass validation.
5. Going backward or changing input never loses previously entered data without explicit confirmation.
6. No import or duplicate operation mutates the source event.

**Primary metric:** time from first input to a reviewable recognised draft; percentage of source fields mapped without manual re-entry.

---

### Job 3 — Turn intent into explicit, complete rules

**Job story:** When I describe how a competition should work, I want every rule, assumption, delegation, and missing decision exposed, so I can approve the meaning before the system builds something plausible but wrong.

**Pain and anxiety:** silent AI invention; a familiar format name hiding different rules; 25-question setup interviews; stated requirements disappearing.

**Feature scope:**

- Natural-language extraction into requirement IDs.
- Classification: `KNOWN`, `DERIVED`, `DEFAULTED`, `OPTIMISED`, `RANDOMISED`, `UNRESOLVED`.
- Severity: blocking, safe default with provenance, or explicitly delegated optimisation.
- Assumption ledger with source: prompt, clarification, template, organisation default, sport pack, optimisation, or override.
- Tournament type checker for entrant units, cardinality, progression, result states, and dependency completeness.
- Requirement coverage: satisfied, deliberately relaxed with approval, unresolved, or failed with counterexample.
- Simple, detailed, and technical rule views.
- Optional Tournament Critic that may raise concerns but never change the specification.

**Jobs × Bier first value:** compile as far as safely possible, then ask only material unresolved questions in ordinary language with a recommendation and its source.

**Acceptance criteria:**

1. Every meaningful input clause maps to a formal rule, approved assumption, explicit optimisation objective, or unresolved requirement.
2. Critical rules—qualification, tiebreaks, eligibility, progression, randomisation, and protections—never use an unapproved model guess.
3. Type and cardinality errors appear before scheduling.
4. The user can see what the system chose versus what they explicitly provided.
5. Failed participation or progression requirements include a concrete counterexample path.
6. Unsupported semantics remain unresolved or extension-required; they are never approximated silently.
7. Applying a clarification produces a semantic diff and a new immutable draft revision.

**Primary metric:** unresolved consequential questions per draft and number of source requirements lost or silently changed—the latter must remain zero.

---

### Job 4 — Build a fair, explainable competition structure

**Job story:** When entrant counts and results interact with pools, seeding, qualification, cups, byes, and rematch rules, I want a deterministic structure I can defend, so no one’s path depends on an accidental bracket shortcut.

**Pain and anxiety:** unfair unequal-pool comparison; incorrect byes; double qualification; circular tiebreaks; repeat opponents; unexplained seeds.

**Feature scope:**

- Canonical competition graph and dependency DAG.
- Pool construction with balancing and protected separation policies.
- Standings and explicit tiebreak hierarchy.
- Unequal-group normalisation.
- Qualification selectors and destination accounting.
- Bracket topology, play-ins, byes, consolation/plate paths.
- Deterministic draw placement with stored seed, algorithm, inputs, and candidate report.
- Participant path proof for minimum/maximum matches and every reachable destination.

**Jobs × Bier first value:** show the human shape first—“three pools, top four to Main Cup, everyone else to Plate”—and make every disputed outcome expandable to exact evidence.

**Acceptance criteria:**

1. Qualification, seeding, topology, placement, and scheduling are separate modules and views.
2. Generated entrant counts reconcile independently with every destination capacity.
3. Every qualifier displays standings values, comparison set, and tie-resolution path.
4. Byes follow declared protection priorities and never create undefined loser paths.
5. No entrant can reach two exclusive destinations.
6. Replaying identical versions, inputs, and seeds produces identical graphs, draws, and hashes.
7. Every participant path meets approved minimum participation or exposes a failing counterexample.

**Primary metric:** zero unexplained or non-reproducible qualification/draw outcomes; time to answer a participant challenge.

---

### Job 5 — Produce a schedule that works in the physical world

**Job story:** When matches share courts, people, officials, equipment, time windows, and dependencies, I want the earliest good schedule that honours hard rules and makes trade-offs visible, so I can publish a plan the venue can actually execute.

**Pain and anxiety:** court-only models; schedules that work per division but collide globally; mysterious empty courts; nominal finish times with no contingency; solver claims that cannot be verified.

**Feature scope:**

- Generic `CompetitionResource` with sport-facing labels: court, field, lane, mat, board, table, course, or stage.
- Availability windows, closures, location/travel buffers, officials, equipment, and participant constraints.
- Explicit hard constraints and weighted/lexicographic soft preferences.
- Deterministic small search plus bounded solver portfolio behind one abstraction.
- Independent schedule validator.
- Lower-bound proof: capacity, critical path, participant workload, and restricted resources.
- Participant experience score: shortest/median rest, excessive wait, consecutive matches, court changes.
- Resource timeline with explainable occupied, unavailable, held, blocked, or unused slots.
- Honest statuses: feasible, best-known, timed-out/unknown, or proven infeasible.

**Jobs × Bier first value:** a plain-language feasibility card with earliest finish, hard-rule status, biggest risks, participant experience, and the few decisions that matter—before exposing a dense timeline.

**Acceptance criteria:**

1. No contest starts before dependencies, participant availability, required rest, stage opening, and resource availability allow it.
2. Every returned schedule is independently validated; the solver cannot certify itself.
3. Every empty resource slot can explain why it is blocked or flag that legal work was left unscheduled.
4. Soft-policy sacrifices are named with their affected participants and objective cost.
5. Search timeout reports `UNKNOWN` or `BEST_KNOWN`, never false `INFEASIBLE` or `OPTIMAL`.
6. A user can lock, pin, or freeze promises without bypassing validation.
7. Keyboard, zoom, and mobile operator views provide equivalent actions without shrinking a desktop grid.

**Primary metric:** time to first independently valid schedule; hard-constraint escapes (zero); schedule intervention count; participant wait/rest distribution.

---

### Job 6 — Compare, prove, approve, and publish one promise

**Job story:** When several valid plans or proposed changes exist, I want to compare their consequences and approve one exact revision, so staff and participants share one authoritative promise.

**Pain and anxiety:** “optimised” without proof; silent cascading edits; stale approvals; public schedule diverging from the reviewed schedule.

**Feature scope:**

- Scenario branches that clone rather than mutate the current draft.
- `What if…?` input and deterministic counterfactuals.
- Semantic diff showing changed and explicitly preserved rule paths.
- Competition Guard: requirement reconciliation, match accounting, independent validation, and proof objects.
- Factual certification states rather than confidence scores.
- Authority-aware review and approval.
- Hash-bound atomic publication receipt.
- Public revision/freshness projection.

**Jobs × Bier first value:** make comparison tangible: “six courts moves 11 pairs and finishes 43 minutes later; all competition rules are preserved.” The decision becomes shareable before it becomes live.

**Acceptance criteria:**

1. Scenarios use the same production engine and validator as live events.
2. A diff lists every changed formal path and confirms important unaffected paths.
3. Certification states exactly which checks passed, versions used, and warnings remaining.
4. Only an authorised actor may approve the exact reviewed revision.
5. Publication atomically binds specification, graph, schedule, public projection, and notification intents.
6. The previous revision remains replayable and available for audit.
7. A stale or changed revision invalidates the prior approval and cannot be published.

**Primary metric:** time from feasible draft to confident publish; stale/incorrect publication attempts blocked; percentage of published revisions with complete Guard receipt.

---

### Job 7 — Tell each participant exactly what to do next

**Job story:** When I am travelling, warming up, socialising, or waiting at the venue, I want the answer to my next action without installing anything, so I arrive at the right place and time with minimal uncertainty.

**Pain and anxiety:** scanning a full schedule; stale screenshots; lost links; notification noise; account and app-install gates; privacy leakage through open name search.

**Feature scope:**

- Signed opaque participant links and event-scoped QR recovery.
- `/next` personal view: effective time, arrival target, opponent/dependency, place, and freshness.
- `My day`, result, standings, and accessible full draw after the dominant answer.
- Old → new explanation for material changes.
- Add to calendar/Wallet and follow preferences only after value is visible.
- Staff lookup and ambient venue display driven by the same read model.
- Rate-limited name search as fallback, with token rotation and revocation.

**Jobs × Bier first value:** the message itself carries the new time, place, and action; the link is recovery and live depth, not a demand to hunt for the answer.

**Acceptance criteria:**

1. A participant can see the next action in a normal browser without login or installation.
2. Median QR/link-to-answer time is under 10 seconds on representative mobile networks.
3. The first view prioritises arrival, time, place, opponent/dependency, change, and freshness.
4. Material changes show both previous and effective values in human language.
5. Tokens cannot enumerate other participants and can be revoked or rotated.
6. Notifications are requested only after a person follows an event or receives schedule value.
7. Public, staff, ambient, and message answers all derive from the same authoritative revision.

**Primary metric:** “When do I play?” desk questions per 100 participants; stale-detail incidents (zero); successful next-match retrieval.

---

### Job 8 — Run the event from an action-first control room

**Job story:** When the event is live and my attention is fragmented, I want the system to show what is happening now, what is ready next, and what needs intervention, so I do not have to hold the whole tournament in my head.

**Pain and anxiety:** generic dashboards; every card equally loud; missing scores; unclear court readiness; duplicate or stale commands; broad admin screens on a phone.

**Feature scope:**

- Control-room queues: Now, Next, Late, Blocked, Missing result, Attention.
- Resource lane/state view and compact mobile command cards.
- Check-in, call-to-court, confirm entrants, start, score, finish, correction, void, retirement, walkover, and no-show commands.
- Official assignments and acknowledgement receipts.
- Optimistic but visibly pending UI with idempotency, stale-command rejection, retry, and reconciliation.
- Division completion and newly eligible knockout cues.

**Jobs × Bier first value:** the first screen answers “What needs me now?” and opens the exact safe action, not an analytics dashboard.

**Acceptance criteria:**

1. The highest-consequence unresolved action appears first with owner, impact, and due state.
2. Every command uses an exact schema, idempotency key, revision expectation, and authoritative receipt.
3. Duplicate, reordered, offline, and stale commands cannot create duplicate effects or overwrite newer truth.
4. Corrections preserve the original fact, reason, actor, and resulting revision.
5. Completion of a prerequisite automatically makes valid downstream contests callable and explains why.
6. Operator actions remain possible by keyboard and on a narrow mobile screen.
7. Loading, empty, degraded, offline, error, pending, and reconciled states are designed and tested.

**Primary metric:** median time to resolve an attention item; manual spreadsheet/message interventions; missing-result latency; unsafe command effects (zero).

---

### Job 9 — Recover safely when the plan breaks

**Job story:** When a match overruns, someone withdraws, a court closes, or a result is disputed, I want a small set of independently valid repairs and their human impact, so I can recover quickly without moving the whole day or creating an illegal path.

**Pain and anxiety:** rebuilding from scratch; optimiser silently replacing the approved schedule; unnoticed rest/fairness damage; notifying the wrong people; not knowing who has authority.

**Feature scope:**

- Typed incident intake: delay, no-show, withdrawal, resource/official/equipment outage, incorrect result, protest, appeal, or provider failure.
- Scope freeze for completed, in-progress, pinned, communicated, and near-horizon promises.
- Minimum-change repair objectives: moved contests, affected participants, displacement, resource changes, then finish/wait/idle costs.
- Ranked alternatives with why/why-not explanations.
- Independent validation, authority-aware approval, and atomic activation.
- Targeted notification draft, provider delivery states, fallback, and unresolved-contact queue.
- Immutable incident timeline and after-action record.

**Jobs × Bier first value:** show one calm decision card: what happened, what is frozen, the safest valid option, who is affected, what stays unchanged, and who must approve.

**Acceptance criteria:**

1. Definition, approved plan, operational expectation, and actual result remain distinct.
2. Existing results and in-progress contests are never silently overwritten or rescheduled.
3. Every repair reports old → new, affected people, fairness/rest delta, finish delta, and delivery risk.
4. Unaffected promises are explicitly preserved and prioritised.
5. No proposal becomes authoritative before freshness checks, independent validation, and required approval.
6. Publication and outbox intents commit atomically.
7. The entire incident and repair can be deterministically replayed.

**Primary metric:** time from acknowledged disruption to approved valid repair; contests/participants moved; stale or invalid repairs blocked; delivery success.

---

### Job 10 — Stay controlled during safety or infrastructure failure

**Job story:** When the event becomes unsafe or the network/provider fails, I want authority, last-known truth, fallbacks, and recovery steps to stay clear, so the event fails safely instead of becoming more chaotic.

**Pain and anxiety:** treating a safety incident as a scheduling problem; unclear command transfer; lost offline actions; untested backups; no manual fallback.

**Feature scope:**

- Separate routine competition disruption from life-safety incident workflows.
- Event states: Normal, Degraded, Paused, Stopped, Cancelled, Recovering.
- Named incident, competition/referee, safety/medical/venue, communications, and scribe functions.
- Unmistakable safety stop and blocked automatic publication.
- Pre-approved public messages, next-update time, command transfer, and authorised restart.
- Offline read cache and queued commands with reconciliation.
- Emergency pack: latest signed schedule, court sheets, contacts, QR index, manual score forms, restoration instructions.
- Backup/restore drill and proof-hash comparison.

**Jobs × Bier first value:** preparedness appears as a short readiness rehearsal and printable pack before event day, not a PDF graveyard or false promise that AI manages emergencies.

**Acceptance criteria:**

1. Safety stop is immediate and cannot be blocked by two-person competition approval.
2. Safety authority and competition authority are visibly distinct even if held by one person.
3. Stopped state prevents automatic schedule publication and displays the authorised instruction.
4. Offline commands queue with visible local status and reconcile without duplicate effects.
5. A manual pack can operate the event’s essential truth when devices or providers fail.
6. Restart records venue/service readiness and the authorising person.
7. Restore reproduces the same authoritative event state and proof hashes.

**Primary metric:** readiness rehearsal completion; successful offline reconciliation; recovery time; restore correctness; ambiguous authority incidents (zero).

---

### Job 11 — Close, defend, and reuse the event

**Job story:** When an event finishes or a dispute arises later, I want the exact rules, choices, results, changes, and evidence preserved, so I can establish what happened and make the next edition easier.

**Pain and anxiety:** final results diverging from published history; corrections erasing facts; random draws that cannot be reproduced; learning disappearing with one organiser.

**Feature scope:**

- Completion checklist and unresolved-result/appeal gate.
- Immutable correction lineage and final certified result projection.
- Human event report plus machine-readable specification, graph, schedule, certification, audit, and result bundle.
- Deterministic replay with pinned engine, rule-pack, template, compiler, solver, and randomisation versions.
- Verified export and restore.
- Duplicate-as-new-edition with explicit carried-forward defaults and learnings.
- Post-event operational analytics and after-action prompts.

**Jobs × Bier first value:** automatically produce a credible participant result and organiser close-out summary, then offer “use this as next edition” while the knowledge is fresh.

**Acceptance criteria:**

1. An event cannot close with unresolved authoritative results or appeals without an explicit governed disposition.
2. Original facts and later corrections remain separately visible and linked.
3. Replay reconstructs identical state and proof hashes for pinned versions and seeds.
4. The export contains both understandable human evidence and complete machine artefacts.
5. Restore is tested, not merely documented.
6. Duplication creates a new identity and revision chain while preserving provenance.
7. Post-event metrics do not expose cross-tenant or unnecessary participant data.

**Primary metric:** close-out time; replay/restore match rate; percentage of repeat events started by duplication; repeated manual corrections.

---

### Job 12 — Extend the system without weakening it

**Job story:** When a new sport, format, governing rule, integration, or series is requested, I want a governed deterministic extension path, so the platform can grow without adding hidden special cases or unverified claims.

**Pain and anxiety:** “any sport” marketing; event-name branches in generic code; imported prose executed as policy; official-sounding rule packs without authority review.

**Feature scope:**

- Capability classification: Native, Composable, Extension required, Unsupported.
- Versioned sport adapters and governed rule/format packs.
- Registered metrics, result schemas, transitions, and extension primitives only.
- Conformance, golden fixture, property, fuzz, mutation, replay, and differential tests.
- Signed governing-body packs and lifecycle later.
- Curated template exchange only after certification and support ownership exist.
- Series/federation progression only after single-event truth is proven.

**Jobs × Bier first value:** an honest capability check tells the organiser what is understood, what is composable, and what needs a specialist extension—before they invest in setup.

**Acceptance criteria:**

1. Generic engine packages contain no event-name or brand-name branches.
2. New semantics enter only through registered, versioned, deterministic contracts.
3. Imported prose or AI output cannot become executable code.
4. Every advertised pack publishes its authority, tested envelope, fixtures, and known unsupported cases.
5. Identical versions, inputs, and seeds remain replayable after platform upgrades.
6. Unsupported constructs fail closed with a useful extension or fallback path.
7. Expansion cannot bypass tenant, accessibility, Guard, audit, or restore release gates.

**Primary metric:** conformance coverage by advertised pack; production incidents caused by special cases; unsupported requests correctly identified.

## 6. Complete feature disposition

This register accounts for the previously researched P0/P1/P2 features without turning them into equal-weight navigation.

### Now — complete the minimum lovable pilot loop

| Feature | Owning job | Implementation shape | First visible value | “Done” evidence |
|---|---|---|---|---|
| Organisation/event switcher | 1 | Production identity, tenant-scoped portfolio and role context | Resume the right event immediately | Cross-tenant tests; role/action tests; observed resume task |
| Directories and reusable defaults | 1 | Versioned people/place/resource records with import provenance | Select known participants and courts | Merge/quarantine tests; duplicate-event rehearsal |
| Four-door creation | 2 | Describe, Quick setup, Import, Duplicate over one draft API | Recognised event shape after first input | Same-spec equivalence fixtures across inputs |
| Import and rescue | 2 | CSV/XLSX mapping, quarantine, rollback, JSON/YAML validation | Messy roster becomes reviewable | Security fixtures; mapping completion and rollback tests |
| Requirement/assumption ledger | 3 | Requirement IDs, source provenance, uncertainty and coverage states | “Understood / Needs decision / System may optimise” | Zero lost-requirement gate; counterexample fixtures |
| Rules/templates/format formalisation | 3–4 | Pinned packs and declarative graph composer behind progressive disclosure | Familiar plain-language rule summary | Type-check, migration, provenance and pack conformance |
| Competition graph, standings, qualification and draw | 4 | Existing pure deterministic engine exposed through one review journey | Defensible structure and participant paths | Golden, property, fuzz and replay tests |
| Resource schedule workspace | 5 | Real resource timeline plus compact mobile operations list | Feasibility, finish, risk and understandable schedule | Independent validation; keyboard/zoom/mobile evidence |
| What-if and Why-not | 5–6 | Scenario revisions and deterministic blocking explanations | Answer trade-offs without damaging draft | Semantic diff and counterfactual fixtures |
| Guard/certification | 6 | Independent validation and hash-bound artefact reconciliation | Clear readiness and unresolved risk | Validator disagreement tests; exact revision binding |
| Approval and publication | 6 | Authority gate, immutable revision and atomic public projection | One trustworthy shared schedule | Stale approval tests; publish/outbox transaction tests |
| Personal `/next` | 7 | Signed opaque link over authoritative read model | Time/place/action in under 10 seconds | Privacy, token, reflow, intermittent-network testing |
| Participant delivery ladder | 7 | Answer-in-message, link, QR, ambient display, desk fallback | Affected player receives useful action | Delivery/fallback/acknowledgement metrics |
| Live control room and commands | 8 | Action-first queues and exact idempotent commands | “What needs me now?” | Duplicate/stale/offline/reordered UI tests |
| Routine incident intake | 9 | Typed observations and scoped freeze | Clear incident truth and affected scope | Incident lifecycle/replay fixtures |
| Minimum-change repair studio | 9 | Ranked options, blast radius, validation, approval and notify | Safest valid repair with preserved promises | Court closure and withdrawal golden journeys |
| Offline integrity and emergency pack | 10 | Local queue/cache, reconciliation, printable authoritative pack | Essential operation during outage | Disconnect/reconnect, print and manual fallback rehearsal |
| Safety state and authority | 10 | Separate stopped/paused/recovery workflow and role handoff | Unambiguous instruction and command | Safety scenario tabletop and restart gate |
| Close, replay, export, restore, duplicate | 11 | Pinned event bundle and new-edition workflow | Trustworthy record and faster next event | Replay hash, restore drill and provenance tests |
| Accessibility evidence | All | WCAG 2.2 AA target across core journeys | Equal completion of the same job | Axe + keyboard + VoiceOver/NVDA + zoom/reflow + contrast evidence |

### Next — differentiation and retention after the pilot loop works

| Feature | Owning job | Implementation shape | Admission evidence |
|---|---|---|---|
| Generic resource/logistics model expansion | 5 | Travel, officials, equipment, multi-site and sport labels | Pilot events demonstrably blocked by current resource model |
| Deeper constraint inspector | 5–6 | Smallest relaxation sets and full specialist proof explorer | Organisers/support repeatedly need more than plain explanation |
| Additional sport-adaptive packs | 12 | Verified adapters and conformance packs | Historical fixtures plus domain authority review |
| Brand and sponsor presentation | 7/11 | Stable resource identity with effective-dated public aliases and rights | Public journey works; sponsors/design partners need controlled inventory |
| Certified social graphics | 7/11 | Deterministic renderer from certified public DTOs with alt text | Accurate participant outputs already distribute reliably |
| Integration gateway | 1/2/7 | Explicit source-of-truth contracts for booking, registration, calendars, messaging and scoring | One chosen partner integration removes measured re-entry or delivery pain |
| Operational analytics | 8/9/11 | Delay, utilisation, rest, repair, no-show and delivery projections | Event instrumentation is reliable and privacy reviewed |
| Recovery and observability | 10/11 | Tenant-aware telemetry, proof comparison, alarms and rehearsed runbooks | Production deployment exists and chaos/restore gates can be exercised |
| Partner-based registration/payments | 1/2 | Provider-owned money truth; certified entrant handoff | Design partners require paid entry; refund/chargeback ownership is explicit |

### Later — platform expansion only after repeat paid events

| Feature | Owning job | Why later | Entry gate |
|---|---|---|---|
| Governing-body pack workflow | 12 | Requires authority, lifecycle, legal wording and support ownership | Verified sport pack plus governing design partner |
| Curated template exchange | 12 | Bad templates can distribute bad policy faster | Pack certification, moderation and version/deprecation model |
| Series/federation layer | 12 | Cross-event eligibility and sanctions multiply truth risk | Single-event close/replay proven in repeat production |
| Sponsor operations/reporting | 7/11 | Commercial layer must stay downstream of competition truth | Controlled presentation and analytics already trusted |
| Organiser academy | 10/11 | Valuable, but does not replace a reliable core loop | Incident research shows repeated preparedness gaps |
| Post-event intelligence | 11 | Needs clean operational data before recommendations are credible | Several comparable completed events with validated telemetry |
| New format families beyond the beachhead | 12 | Heats, combat, golf and judged events add genuinely new semantics | Named historical corpus, domain reviewer, support owner, tested envelope |

### Parked or refused

- Partner matching and broad social discovery.
- Community feed or chat.
- Video/highlight editing and performance analytics.
- General POS, payroll, hotel contracting, or a court-booking marketplace.
- Open public template marketplace.
- Mandatory participant account or app installation.
- Arbitrary user code as a competition rule.
- Silent AI policy creation or automatic live publication.
- A separately marketed Mac product before its unique value is proven.
- “Any sport, any format, any complexity” claims.

## 7. Information architecture

The customer sees the lifecycle, not the component diagram.

### Portfolio

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
All competitions

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

Creation may begin with a conversational description, a compact form, an import, or a previous event. It must continue into the same competition workspace and the same revision chain.

`Compiler`, `solver`, `graph`, `proof hash`, and raw API concepts are progressive specialist details—not primary navigation.

### Public participant

```text
My next match
├── When to arrive
├── Place
├── Opponent or dependency
├── What changed
└── My day

Event
├── Live
├── Schedule
├── Standings / draw
└── Results
```

## 8. Shared implementation architecture

```text
INPUT
Natural language | Quick form | CSV/XLSX | JSON/YAML | Prior edition
                              │
                              ▼
INTERPRETATION
Extraction → requirement ledger → ambiguity/provenance → semantic proposal
                              │
                              ▼
FORMAL CORE
TournamentSpec → type checker → competition graph → standings/qualification
             → topology/draw → resource schedule → simulation
                              │
                              ▼
MUTUALLY INDEPENDENT ASSURANCE
Requirement reconciler | cardinality checker | schedule validator | replay proof
                              │
                              ▼
GOVERNED CHANGE
Draft revision → semantic diff → scenario → approval → certified publication
                              │
                              ▼
OPERATION
Commands/events → authoritative state → read models → notifications/displays
                → incident/freeze → repair proposal → validated publication
                              │
                              ▼
MEMORY
Audit/replay/export/restore → organisation defaults → next edition
```

### The current fracture to remove

The existing implementation proves deep capabilities, but it assembles several separate reference worlds:

- the compiler workspace can regenerate the Play & Konnect reference scenario;
- the platform demo constructs a separate in-memory organisation and pilot;
- participant attention owns another demonstration projection;
- natural-language proposals, the registered intent compiler, and guided creation express overlapping creation models;
- production-facing reads do not yet expose every authoritative tournament-detail projection used by the polished surfaces;
- the Apple client reads reference API views while creation remains a local draft.

This is why the engine can be strong while the customer journey feels false or incomplete. The fix is not another UI rewrite. It is one application layer that owns the lifecycle.

### The `CompetitionJourney` application seam

Create one deep module with a small customer-lifecycle interface:

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

Internally, this module composes the existing schema, compiler, engine, scheduler, Guard, live commands, repair, event store, replay, and outbox. A browser or native surface must never construct its own competition scenario.

### Authoritative projections

Build disposable read models from the same event heads:

```text
CompetitionJourney commands
          ↓
Tournament-scoped event streams
          ↓
┌───────────────────┬────────────────────┬──────────────────────────┐
│ Studio projection │ Operator projection│ Public participant view  │
│ create/review     │ now/next/actions   │ next action/change/result│
└───────────────────┴────────────────────┴──────────────────────────┘
```

Every projection must expose its authoritative revision and freshness. Consistency among public message, `/next`, venue display, staff lookup, and organiser control room becomes an executable invariant.

### Aggregate and concurrency boundaries

The present organisation-wide state is a useful reference but will become a concurrency and replay bottleneck when several clubs and live events operate together. After the golden journey contract is stable—and before multi-event production scale—separate streams by ownership:

```text
organization:{id}                         memberships and governance
directory:{organizationId}:{clubId}       people and places
competition:{organizationId}:{eventId}    definition, revisions, publication, lifecycle
operations:{organizationId}:{eventId}     live commands, results, incidents, repair
```

The transactional outbox remains committed beside the authoritative event. Do not begin with a wholesale package split; establish the lifecycle module and projectors first, then split packages only where the stable seams demand it.

### Concrete backend delivery order

1. Define journey commands, responses, authority, idempotency, and version expectations.
2. Add journey-level contract tests against the existing in-memory adapters.
3. Make a new competition ID survive create → compile → retrieve after a fresh process start.
4. Unify all creator inputs into one draft/requirement/decision model.
5. Add the three authoritative projections and delete production dependencies on demo singletons.
6. Bind Guard and publication to server-loaded authoritative artefacts, not UI-assembled objects.
7. Connect live commands, incident facts, repairs, and public attention to the same competition head.
8. Exercise the path with PostgreSQL concurrency, tenant, provider-crash, and restore tests.
9. Move to tournament-scoped streams before real multi-event load.
10. Refactor large surface files around the job projections only after the connected behaviour is proven.

### Sensitive-data boundary

Before production pilots, classify participant fields and retention. Append-only competition history must not imply permanent duplication of phone numbers, medical notes, minor data, or other sensitive attributes. Authoritative event records should use opaque identity references where possible, with managed mutable/erasable personal data behind an explicit privacy boundary.

### Non-negotiable platform contracts

1. **Canonical versioned schemas:** no UI-specific tournament models.
2. **Immutable revisions and append-only events:** corrections and plans add history.
3. **Exact command schemas and idempotency:** retries cannot duplicate effect.
4. **Independent verification:** proposers do not certify themselves.
5. **Hash-bound publication:** public artefacts identify the approved inputs and version.
6. **Transactional outbox:** state and intended communication change together.
7. **Tenant isolation:** organisation identity is enforced at every server boundary.
8. **Deterministic replay:** versions, seeds, inputs, and results reproduce state.
9. **Progressive read models:** organiser, participant, display, and evidence views share truth but optimise for different jobs.
10. **Safe failure:** unknown is not infeasible; queued is not delivered; proposal is not official.

## 9. Delivery plan: vertical outcome slices

Do not build another broad capability pass. Deliver one newly created competition through a continuous identity and revision chain.

### Gate 0 — Freeze drift and establish product truth (week 0–1)

- Adopt this charter as the roadmap and feature-admission contract.
- Inventory the existing engine, APIs, reference UIs, fixtures, demo seams, and incomplete writes.
- Mark every visible action as real, rehearsal, read-only, local draft, or parked.
- Select one pilot reference event and one nasty regression event.
- Park net-new Mac surface work except fixes required to preserve the reference client.

**Exit:** team and interface use one product name, lifecycle, status vocabulary, and selected pilot chain.

### Gate 1 — One real competition from input to feasible draft (weeks 1–4)

- Connect production identity/workspace context.
- Implement the four-door creator over one draft API.
- Make participant unit/count, division count, dates, resources, and imports easy to edit.
- Surface recognition, assumptions, decisions, type errors, and safe defaults.
- Continue directly into engine-backed format and schedule generation.

**Exit:** a design partner can bring a historical event and reach an independently valid draft without developer intervention.

### Gate 2 — One exact revision from review to participant value (weeks 4–7)

- Complete rules, participant paths, schedule review, What-if, Issues, and Evidence.
- Bind Guard, authority, approval, and atomic publication.
- Generate signed personal links, `/next`, venue display, and answer-in-message previews from the published revision.
- Add provider and fallback delivery states.

**Exit:** the organiser publishes exactly what they reviewed, and a participant sees the correct next action in under 10 seconds.

### Gate 3 — One event from first score to controlled disruption (weeks 7–11)

- Complete control-room queues and all authoritative match actions.
- Add idempotent/offline/stale command handling in the actual UI.
- Implement court outage and withdrawal incident journeys first.
- Freeze, propose, validate, approve, republish, and notify through one chain.
- Produce and rehearse the emergency/manual pack.

**Exit:** removing one court in a live rehearsal produces a minimum-change valid revision, reaches affected participants, preserves the old truth, and can be replayed.

### Gate 4 — Close, restore, and repeat (weeks 11–13)

- Complete result/appeal close gates.
- Generate the human and machine evidence bundle.
- Rehearse restore and verify hashes.
- Duplicate the event into a new edition with carried-forward organisation memory.

**Exit:** the event can be defended later and the next edition starts materially faster.

### Gate 5 — Field validation, not feature expansion (months 3–6)

- Reconstruct at least ten historical events across the beachhead.
- Shadow at least two live events before controlled operation.
- Run controlled pilots with explicit manual fallback.
- Measure publish time, desk questions, interventions, repair time/blast radius, delivery, comprehension, replay, and restore.
- Admit only the next feature that removes the largest observed bottleneck.

**Exit:** three paying design partners repeat events because Krateasy handles complexity and change better—not because it exposes more settings.

## 10. Team topology

The programme needs one product team with specialised streams, not independent feature teams shipping separate truths.

### Product trio

- Product lead: owns job hierarchy, pilot outcomes, boundaries, and commercial learning.
- Lead product designer/researcher: owns end-to-end journey, progressive disclosure, field observation, and accessibility.
- Staff/principal engineer: owns architectural integrity, shared contracts, and vertical-slice sequencing.

### Stream A — Competition truth

- Domain/solver engineers.
- Formal validation/property-testing engineer.
- Tournament rules specialist.

Owns schemas, type checking, graph, standings, draw, schedule, proof, replay, conformance, and engine performance.

### Stream B — Organiser product

- Senior web product engineers.
- Interaction designer.
- QA automation engineer.

Owns portfolio, creation, review, schedule, control room, incident, repair, close, and specialist disclosure.

### Stream C — Participant and live delivery

- Senior full-stack/mobile-web engineer.
- Messaging/integration engineer.
- Content/accessibility designer.

Owns `/next`, tokens, QR, venue displays, delivery ladder, notification preferences, and public performance/privacy.

### Shared assurance

- Platform/SRE/security engineer.
- Accessibility specialist.
- Tournament operations adviser/referee.
- Data/privacy reviewer.

No stream may ship a new source of truth. All work integrates through the canonical competition/revision/event contracts.

## 11. Research and validation programme

### Incident reconstruction

Interview 20 experienced organisers around a specific bad event and its artefacts. Reconstruct what broke, what they knew, which source they trusted, who decided, who was affected, and how recovery worked.

### Shadow the desk

Observe ten events from setup through close. Time creation, check-in, score entry, participant questions, court turnover, incident resolution, notification, and reconciliation. Count every spreadsheet, paper sheet, memory handoff, private chat, and duplicate source of truth.

### Format red team

Have coaches, referees, and governing experts attack each advertised pack: ambiguity, withdrawal, abandonment, tie recursion, eligibility, reseeding, consolation, walkover, and appeal.

### Five-product switch test

Give the same difficult event to organisers in the main competitor categories and Krateasy. Measure time, lost requirements, errors, help requests, valid schedule, participant clarity, repair quality, and confidence backed by explanation.

### Participant uncertainty diary

Ask players, parents, coaches, and officials to record every moment they do not know where to go, when to arrive, whether the schedule changed, or what a result means.

### Pilot scorecard

| Outcome | Measure | Initial target |
|---|---|---:|
| First value | Median time from source input to recognised draft | Measure baseline, then reduce |
| Feasible plan | Median time to independently valid publishable schedule | ≤15 min for a clean common event; validate hypothesis |
| Requirement integrity | Lost or silently invented consequential requirements | 0 |
| Schedule integrity | Hard-constraint violations | 0 |
| Participant clarity | QR/link to next action | <10 sec median |
| Desk relief | “When do I play?” questions per 100 participants | 70% reduction hypothesis |
| Repair quality | Time to approved repair; contests and people moved | Baseline, then minimise lexicographically |
| Communication | Material changes delivered/acknowledged/fallback | Report separately; no false “sent = received” |
| Command integrity | Lost or duplicated acknowledged commands | 0 |
| Trust | Stale publication, unexplained qualifier, or unreplayable decision | 0 |
| Resilience | Restore reproduces event state and proof hashes | 100% in drills |
| Retention | Repeat event starts from trusted prior memory | Track by design partner |

## 12. Release gates that apply to every feature

1. **Job completion:** a named user completes a real outcome, not a component demo.
2. **One truth:** the feature mutates or reads the same competition identity and revision chain.
3. **Safety:** hard constraints, authority, freshness, and reversibility are explicit.
4. **Evidence:** the UI can explain consequential output without asking an LLM to invent a reason.
5. **Failure states:** loading, empty, invalid, timeout, offline, stale, duplicate, conflict, partial delivery, and recovery are designed.
6. **Accessibility:** keyboard, screen reader, 200–400% zoom/reflow, contrast, reduced motion, target size, and outdoor readability pass for core tasks.
7. **Privacy and tenancy:** no cross-organisation or cross-participant exposure; analytics avoid unnecessary personal data.
8. **Replay:** authoritative actions and random choices are reproducible.
9. **Support fallback:** a safe manual or read-only path exists when the service cannot complete the job.
10. **Observed proof:** no capability is called production-ready until the connected journey is exercised in a representative event.

## 13. Feature admission template

Every future proposal must be written in this form before design or implementation:

```text
Feature:
Owning job track:
Triggering situation:
Painful moment observed:
Desired functional progress:
Desired emotional/social progress:
Smallest useful first-value loop:
Owning surface:
Authoritative data/command boundary:
Dependencies:
Safe fallback:
What it will not do:
Success metric:
Pilot or evidence source:
Release gates:
Lifecycle phase: Now / Next / Later / Parked
```

A proposal without an observed painful moment, named user, success metric, safe fallback, owning surface, and source-of-truth boundary is parked by default.

## 14. Simulated expert-panel decision

These are applications of the named experts’ published lenses, not claims that those people reviewed Krateasy.

- **April Dunford lens:** sell the progress from spreadsheet/WhatsApp firefighting to defensible live recovery. “Universal compiler” is evidence of capability, not the customer-facing category.
- **Seth Godin lens:** serve organisers whose complexity genuinely hurts; respect participant attention by delivering one useful next action.
- **Rory Sutherland lens:** uncertainty is a major participant cost. Freshness, arrival targets, old → new changes, and ambient venue answers create disproportionate trust.
- **Byron Sharp dissent:** keep broad, memorable entry points—create a competition, run a league, fix a delayed event, find my next match—under one Krateasy identity.
- **Senior tournament director lens:** no elegant interface compensates for a wrong qualifier, missing score, unclear referee authority, or schedule that cannot survive a court outage.
- **Principal-engineering lens:** the most urgent technical milestone is not another engine capability; it is one newly created competition travelling through one production identity, revision, command, event, public projection, and replay chain.
- **Accessibility lens:** on a bright court, under time pressure, on intermittent connectivity, accessibility and resilience are the same product quality.

### Panel verdict

Preserve the full researched system. Reduce the visible product to a clear lifecycle. Complete the connected pilot loop before expanding the surface area. Let the formal engine absorb complexity while the interface exposes only the next consequential question and the evidence required to trust the answer.

## 15. The immediate decision

The next implementation objective is singular:

> **Take one organiser’s messy historical event through Describe/Import → recognised intent → resolved rules → valid structure → resource-aware schedule → Guard approval → publication → participant `/next` → live score → court outage → minimum-change repair → targeted update → close → replay → duplicate, using one competition identity and no demo hand-offs.**

If a proposed task does not help that chain complete, become safer, or become measurably easier, it waits.

---

## Source artefacts used for this reset

- Original `TournamentOS Universal Tournament Compiler — Codex Master Build Specification`.
- Original compiler safeguard addendum covering type checking, requirement coverage, fuzzing, independent validation, semantic diff, and Why-not.
- `work/report-source.md` — category research and Jobs × Bier doctrine.
- `docs/jobs-to-be-done.md`.
- `docs/product-scope-and-surface-contract.md`.
- `docs/organiser-player-journey.md`.
- `outputs/current-product-truth-2026-09-14.md`.
- `outputs/jobs-bier-ui-ux-ax-pass-2026-09-07.md`.
- `outputs/tournamentos-product-atlas-and-journeys-2026-09-07.md`.
- `outputs/event-day-operations-and-trust-research-2026-09-14.md`.
