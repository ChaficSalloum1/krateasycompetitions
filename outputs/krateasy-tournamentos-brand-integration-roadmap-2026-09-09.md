# Krateasy Competitions brand and integration roadmap

Date: 2026-09-09

## Executive decision

Adopt **Krateasy as the master brand**. Use **Krateasy Competitions** as the
customer-facing competition product inside Krateasy and as the umbrella for the
standalone professional competition platform.

TournamentOS is a useful architecture description but is too generic to deserve
continued investment as a separate public brand. Retain it as an internal
engine/package codename during an orderly transition; do not undertake a risky
code-level rename before the integrated product journey is validated.

Recommended public relationship:

> **Krateasy Competitions**  
> Tournaments, leagues and live competition—made easier.

This gives every interaction a cumulative Krateasy memory effect while preserving
an independently sellable product for clubs, promoters, federations, schools,
universities, venue groups, and organisations that do not use Krateasy. Independent
customers do not need to use Krateasy booking or its consumer marketplace to use
Krateasy Competitions.

Both names remain working names until formal trademark, linguistic, App Store,
domain, and customer-comprehension checks are completed.

## Naming architecture considered

| Option | Appropriate use | Decision |
|---|---|---|
| Krateasy Competitions | Competition umbrella: tournaments, leagues, ladders and circuits | Recommended public product name |
| Krateasy Competition Studio | Advanced organiser and competition-control workspace | Recommended professional surface |
| Krateasy Live | Install-free public schedules, scores and results | Candidate; validate before launch |
| Krateasy Arena | More emotional participant/event expression | Reserve for campaigns or a live-event surface, not the engine |
| TournamentOS | Current architecture and repository name | Retain internally during transition; do not build as a separate brand |

The distinctive asset is `Krateasy`, derived from the Greek `kratisi` (booking)
and the promise of making participation and facility operations easier. The brand
can stretch from booking into the complete journey from finding play to running
competition. `Competitions` supplies clarity; it does not need to be ownable on
its own because `Krateasy` carries the memory.

For neutral white-label sales, use discreet `Powered by Krateasy` endorsement or
contractual/API attribution rather than maintaining a second public platform
brand.

## Product and system boundary

```text
Krateasy mobile                     Krateasy owner panel
participant experience              common organiser workflows
        |                                      |
        +---- Krateasy Competition Platform ---+
                               |
                   Krateasy Competition Core
          competition truth, formats, scheduling, scoring,
              standings, live repair, replay and proofs
                               |
             +-----------------+------------------+
             |                                    |
 Krateasy Competition Studio             White-label universes
     advanced operators                  customer brand/domain
```

Krateasy owns:

- player identity and social experience;
- facility discovery and booking;
- payments and commercial catalogue;
- player rating and matching;
- the ordinary participant mobile journey;
- classes and activities that are not competitions.

The competition core owns:

- tournament, league, ladder and circuit definitions;
- competition formats, stages and advancement;
- draws, fixtures, standings and official results;
- resource-aware scheduling and independently validated repairs;
- competition revisions, event history, certification and replay;
- organisation competition templates and governed rule packs.

Krateasy may present cached read models for speed, but it must not become a second
authority for brackets, standings, qualification or published schedules.

## Outcome roadmap

### Outcome 1 — Establish one identity and authority model

**Target window:** weeks 1–3

Enable one person to participate globally and hold different responsibilities in
different organisations and competitions, so that every Krateasy surface can
share access without global role inflation.

Deliverables:

- Replace assumptions based on `user | facility_owner | super_admin` with scoped
  organisation memberships and competition assignments.
- Retain `super_admin` as an internal platform role only.
- Define capabilities for competition creation, publication, scheduling, result
  submission, correction, membership, finance and administration.
- Define the identity mapping and SSO contract between Krateasy products and the
  competition platform.
- Add contract tests for revoked membership, cross-tenant identifiers, stale
  sessions, role changes and one user holding multiple simultaneous roles.

Gate:

- No operation can cross an organisation boundary, and
  every privileged action is explained by a current scoped grant.

### Outcome 2 — Create ordinary competitions without leaving Krateasy

**Target window:** weeks 2–6

Enable a facility owner to create and publish a common tournament or league from
the existing Krateasy panel, so that competition adoption does not require a
second product onboarding.

Deliverables:

- Add a Competitions area to the owner panel.
- Support template-led tournament and league creation.
- Reuse the competition platform's guided flow: participants, format, rules, resources,
  priorities and review.
- Create competitions through versioned platform commands rather than shared
  database writes.
- Return plain-language feasibility, ambiguity and approval states.
- Publish schedules and results back into Krateasy discovery surfaces.

Gate:

- A pilot owner can create a standard racket-sport tournament and recurring league
  without assistance or a second login, and the resulting authoritative state is
  reproducible from authoritative competition history.

### Outcome 3 — Give participants one coherent mobile journey

**Target window:** weeks 4–8

Enable Krateasy users to discover, register for, participate in and follow a
competition within the existing app, so that advanced competition power does not create
consumer-app fragmentation.

Deliverables:

- Competition discovery and detail.
- Individual, pair and team registration.
- Eligibility and wait-list feedback.
- Availability, payment and check-in hand-offs.
- Personal schedule, court/location, live status and change notices.
- Score submission or confirmation when authorised.
- Standings, draws, results and verified sharing.
- Install-free public links for guests.

Gate:

- A participant completes discovery through final result without installing a
  second app; all displayed competitive truth matches its authoritative
  version and proof identity.

### Outcome 4 — Make advanced power seamless rather than mandatory

**Target window:** weeks 5–9

Enable experienced organisers to enter Krateasy Competition Studio with the
same account, organisation and competition context, so that exceptional
complexity is available without burdening normal setup.

Deliverables:

- Context-preserving SSO and deep linking.
- Progressive disclosure between simple and advanced settings.
- A safe hand-off from the owner panel to Scenario Lab, proof inspection,
  constraint diagnostics and advanced live repair.
- Shared revision and approval state across both interfaces.
- A return path to the Krateasy owner panel without re-selection or re-login.

Gate:

- Edits in either authorised interface create one revision history; there is no
  import/export or hidden synchronisation step.

### Outcome 5 — Validate the integrated wedge in real operations

**Target window:** weeks 7–12

Enable design-partner facilities to run difficult racket-sport events through the
integrated product, so that roadmap decisions are based on observed organiser and
participant behaviour rather than further speculative breadth.

Deliverables:

- Reconstruct at least five historical events from source material.
- Shadow-run two live events before controlling publication.
- Operate one controlled pilot with printed/manual fallback.
- Observe setup, check-in, scoring, court failure, withdrawal and schedule repair.
- Measure setup time, interventions, schedule movement, participant waiting,
  notification comprehension and operator confidence.

Gate:

- Zero hard-constraint violations or cross-tenant paths; every material rule is
  resolved or visibly unresolved; every acknowledged command is applied exactly
  once; every published repair passes independent validation.

### Outcome 6 — Package one platform for three routes to market

**Target window:** after the integrated pilot gate

Enable Krateasy facilities, independent Krateasy Competitions customers and white-label
organisations to consume the same competition platform, so that each new customer
strengthens one engine and evidence corpus rather than funding a fork.

Routes:

1. **Krateasy Competitions:** first-party module and natural adoption funnel.
2. **Krateasy Competition Studio:** professional standalone subscription or event
   product.
3. **Krateasy Competition Platform:** API and configurable white-label universes.

Gate:

- The same reference competition can be created through Krateasy, operated in
  Studio and published through a branded universe without duplicating authority.

## What not to do next

- Do not build a second Krateasy competition engine.
- Do not require ordinary Krateasy participants to install another competition
  app.
- Do not force classes into the competition compiler; share identity, resources,
  catalogue and calendar while retaining their distinct lifecycle.
- Do not create one polymorphic mega-table for bookings, classes and competitions.
- Do not make rating or partner matching authoritative for seeding without an
  explicit competition policy and a versioned rating snapshot.
- Do not add more format labels until a pilot exposes a real capability gap.
- Do not expand natural-language input ahead of the integrated golden journey.
- Do not launch TournamentOS as a competing public brand.

## Immediate execution order

1. Freeze this brand and ownership boundary as an architecture decision.
2. Write the shared identity, organisation, competition and event
   contracts.
3. Implement scoped authorisation and integration contract tests.
4. Build one golden vertical slice: owner creates in Krateasy, participant joins
   on mobile, the competition core compiles, owner approves, participant sees schedule,
   score is submitted, disruption is repaired and result is published.
5. Put that slice in front of real facility owners and participants.
6. Fix observed activation and tournament-day failures before increasing breadth.
7. Complete managed infrastructure, recovery, security, accessibility and live
   evidence gates before calling the system production-ready.

## Success measure

The near-term metric is not number of format options. It is:

> **Percentage of pilot competitions completed through authoritative competition
> truth without an unplanned spreadsheet or manual data fork.**

Supporting measures are median time to first publishable plan, manual schedule
interventions, invalid changes prevented, repair time, participant change
comprehension, repeat organiser use, and competitions created per active facility.
