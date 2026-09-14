# TournamentOS production-readiness and competitive roadmap

Date: 2026-09-07

## Executive decision

For the next product cycle, stop broadening the format list unless a live customer
requires it. The compiler kernel is already unusually capable. The largest risk
is now building a brilliant engine without an equally brilliant operating
product, production service, or repeatable sales wedge.

The recommended position is:

> **TournamentOS turns the tournament other systems struggle to express into a
> certified, explainable operating plan—and safely repairs it when the day goes
> wrong.**

Do not lead with “AI tournament generator” or “supports every sport.” Lead with
confidence under complexity: no silent rule drift, no hidden seed distortion, no
double-booked people or courts, explicit tradeoffs, and a recoverable live plan.

The initial beachhead should be complex racket-sport and multi-division event
operators: padel, tennis, badminton, squash, pickleball, and operators running
many categories on scarce courts. This segment has painful scheduling, clear
resource constraints, repeat events, and organizers who can immediately judge
whether the result is good.

## Competitive truth

The public market evidence says that feature parity is not a strategy.

| Product | What it already does well | Strategic implication for TournamentOS |
|---|---|---|
| Tournify | End-to-end registration, team/player management, flexible groups/knockouts/friendlies, generated and drag/drop schedules, scorekeeping, referees, live website, slideshow, branding, and mobile apps. It publicly claims more than 300,000 organizers. Event pricing is free for 8 teams, €40 up to 60 teams, and €120 for unlimited teams. | This is the polished usability and distribution benchmark. Do not try to win with ordinary tournament setup alone. Win where combinations, constraints, proof, scenario comparison, and live repair exceed template behavior. |
| Tournamentsoftware.com | Deep racket-sport history, configurable round robins, eliminations, consolation/playoffs, player/court availability, rescheduling, reports, publication, rankings, and sport-specific planners. Its product family says it has served clubs for more than 25 years. | This is the domain-depth and operator-trust benchmark. TournamentOS needs official rule packs, migration, print/export, and day-of reliability—not only a more modern architecture. |
| Challonge | Low-friction tournament/community product with single and double elimination, Swiss, round robin, league workflows, registration, embeds, API, and a strong free/low-price entry point. | Do not compete for the simplest bracket. Use Challonge-compatible import/export and target competitions where generic bracket tools stop being sufficient. |
| Toornament | Strong esports B2B platform with registration, check-in, reports, APIs, circuits, rankings, white-label sites, publisher integrations, and enterprise platform options. Its 2026 plans span small events through branded competition ecosystems. | This is the API/white-label/ecosystem benchmark. TournamentOS can differentiate in physical-resource scheduling, governed sport semantics, explainability, and proof, while learning from its platform packaging. |
| Playtomic | Strong padel/racket distribution, bookings, club operations, customers, activities, occupancy, and player network. | It is more valuable as a channel/integration target than as the first head-on competitor. TournamentOS should become the complex competition engine that can coexist with booking and club systems. |

These gap statements are inferences from each company’s public product surface;
they are not claims that the competitors cannot support an unpublished workflow.

Sources: [Tournify features](https://tournifyapp.com/en/features),
[Tournify pricing](https://tournifyapp.com/en/pricing),
[Tournamentsoftware product information](https://www.tournamentsoftware.com/product/page.aspx?id=3&s=2),
[Tournamentsoftware platform](https://products.tournamentsoftware.com/en/products/),
[Challonge tournament features](https://doc.challonge.com/features/tournaments),
[Challonge pricing](https://help.challonge.com/pricing),
[Toornament 2026 plans](https://blog.toornament.com/2026/03/new-plans-and-pricing/),
[Toornament Organizer API](https://developer.toornament.com/v2/doc/organizer_tournaments),
[Playtomic Manager](https://playtomic.com/playtomic-manager).

## The moat to build

The durable moat is not the schema or the solver in isolation. It is the closed
learning loop:

1. versioned official and organizer rule packs;
2. a growing corpus of real “nasty tournament” fixtures;
3. independently checkable compiler and schedule proofs;
4. actual operational outcomes—delays, edits, no-shows, court failures, player
   waits, complaints, and successful repairs;
5. better constraint models and repair policies learned from those outcomes;
6. trusted integrations and repeat organizer workflows.

Competitors can copy a feature label. They cannot quickly copy years of
counterexamples, correction histories, governed rule packs, and measured repair
quality.

## Production launch gate

Do not call the product production-ready until one release candidate satisfies
all of these gates:

| Area | Required launch evidence |
|---|---|
| Correctness | 100% of pilot tournaments compile with explicit satisfied, relaxed, unresolved, or unsupported requirements; no silent defaults on material rules. |
| Schedule safety | Zero double-booked participants, officials, or resources across the full adversarial and pilot corpus. |
| Schedule quality | For each pilot, publish makespan, lower bound, gap, preferred-rest exposure, idle classification, and comparison with the organizer’s actual/manual plan. |
| Live repair | A court closure, 20-minute overrun, withdrawal, and no-show each produce a valid minimal-change plan within five seconds for the published pilot envelope. |
| Change safety | Operators see exactly what moves, who is affected, why it moved, and what remains frozen before approving a revision. |
| Reliability | 99.9% measured API availability during a sustained beta; defined latency SLOs; no acknowledged command is lost or applied twice. |
| Recovery | Automated backup plus a witnessed restore drill with measured RPO/RTO and proof that authoritative event history reconstructs state. |
| Security | Independent threat model and security review; tenant isolation, least privilege, secret rotation, dependency scanning, rate limiting, and audit-log export. |
| Privacy | Data inventory, retention/deletion/export workflows, processor agreements, privacy policy, incident process, and child/minor handling where applicable. |
| Accessibility | Keyboard-only, screen-reader, zoom, contrast, reduced-motion, dynamic type, and physical-device evidence for critical operator and participant flows. |
| Operations | Runbook, status page, on-call ownership, support escalation, incident templates, and manual fallback/print pack. |
| Commercial | At least five live design partners, three repeat events, two paying organizations, and evidence of switching value rather than founder goodwill. |

## Outcome roadmap

### Outcome 1 — Prove the wedge with real operators

**Target window:** weeks 1–6

Enable experienced racket-sport organizers to reproduce their hardest historical
tournaments and trust the compiler’s result, so that product decisions are driven
by operational evidence rather than imagined universality.

Work:

- Recruit five design partners who each run several events per year.
- Import ten completed “nightmare” tournaments and shadow-plan five live events.
- Require source documents, final schedules, manual edits, delays, complaints,
  and post-event retrospectives.
- Run a 60-minute setup usability test with each organizer; observe rather than
  teaching the product.
- Compare TournamentOS against the organizer’s existing tool and spreadsheet on
  setup time, edits, finish, idle, participant wait, and operator interventions.

Success metrics:

- Median first valid plan in under 15 minutes from structured import.
- Every material rule appears in the requirement ledger.
- At least 30% fewer manual schedule edits or a 10% better makespan/rest outcome.
- Four of five operators choose TournamentOS for a second event.

### Outcome 2 — Make day-of operations safer than a spreadsheet

**Target window:** weeks 4–12

Enable a tournament desk to absorb real disruption without losing control, so
that TournamentOS becomes the system operators keep open all day.

Work:

- Build the live control room: now/next/late/blocked/unreported views.
- Add check-in, no-show, withdrawal, retirement, walkover, protest, correction,
  court closure, official absence, and actual-duration commands.
- Add freeze horizons and “do not move” pins.
- Produce a minimal-change repair diff with affected people, notification impact,
  quality delta, and why-not explanations.
- Support approve, reject, revise, roll back, and print emergency sheets.
- Make all score and schedule commands idempotent and usable during intermittent
  connectivity.

Success metrics:

- Valid repair in under five seconds at the published 128-task reference scale.
- Fewer than 10% of future matches move for the standard single-court failure
  scenario unless the engine proves that impossible.
- Zero undetected stale edits or conflicting score submissions.
- An unfamiliar assistant operator can recover the four standard incidents from
  the runbook without engineering help.

### Outcome 3 — Reach production-grade trust

**Target window:** weeks 6–16

Enable organizations to rely on TournamentOS as authoritative competition truth,
so that paid pilots can operate without founder supervision.

Work:

- Deploy managed Postgres with migrations, point-in-time recovery, transactional
  outbox, worker leases, and tenant-scoped row-level controls.
- Add production authentication, organization membership, RBAC, separation of
  compile/certify/publish/override powers, session controls, and account recovery.
- Add structured telemetry, traces, audit search/export, SLO dashboards, alerts,
  dead-letter handling, and safe replay tooling.
- Execute load, soak, concurrency, chaos, restore, and regional/time-zone tests.
- Complete threat modeling, dependency/container scanning, penetration testing,
  privacy operations, and incident response.
- Version every public DTO and retain backwards-compatible import/migration paths.

Success metrics:

- 99.9% beta availability and published SLO/error-budget reports.
- RPO at or below five minutes and RTO at or below 30 minutes, demonstrated by
  restore—not asserted in documentation.
- No cross-tenant read/write path in automated or independent security testing.
- Every externally visible result can be traced to its effective event and proof.

### Outcome 4 — Make complexity feel simple

**Target window:** weeks 8–18

Enable a competent organizer to model a complex event without learning compiler
terminology, so that technical power converts into product adoption.

Work:

- Start with proven templates and a guided “participants → format → rules →
  resources → priorities → review” flow.
- Translate prose into a proposal, never directly into active truth.
- Show a plain-language summary: “what we understood,” “choices needed,” “safe
  assumptions,” and “what is impossible.”
- Offer side-by-side scenarios rather than a wall of optimizer settings.
- Let users drag or pin a match, then immediately show downstream consequences.
- Use progressive disclosure: casual organizers see the essentials; experts can
  inspect rules, graph, bounds, and proofs.
- Build a participant web experience requiring no app install: personal schedule,
  map/court, check-in, live status, results, and accessible notifications.

Success metrics:

- 80% of target organizers complete a standard event without assistance.
- Median time to understand and resolve a blocking ambiguity below two minutes.
- At least 90% of proposed changes are understood correctly in comprehension tests.
- WCAG 2.2 AA evidence for the web critical path and recorded Apple accessibility
  evidence for the native client.

### Outcome 5 — Convert trust into a repeatable business

**Target window:** weeks 12–26

Enable repeat operators and governing organizations to standardize their rules
and operations, so that revenue grows through retained events rather than one-off
consumer acquisition.

Work:

- Founder-led “bring us your hardest tournament” sales motion.
- White-glove import and first-event service.
- Organization templates, official rule packs, reusable venues/resources, staff
  roles, and season/circuit aggregation.
- Read/write API, webhooks, spreadsheet import/export, calendar feeds, registration
  and payment integrations, and result-provider adapters.
- Publish anonymized benchmark cases and proof reports as technical marketing.
- Price on organizational value and complexity, not only participant count.

Recommended initial packaging to test—not final pricing:

- **Pilot:** concierge migration and one live event, free or cost-recovery in
  exchange for full observation and evidence rights.
- **Professional event:** roughly €149–€499 per event depending on scale,
  optimization, operations, and support.
- **Organization:** roughly €6k–€20k annually for reusable rule packs, API,
  multi-event operations, permissions, support, and SLA options.
- **Enterprise/federation:** implementation plus annual platform contract.

Do not underprice the difficult-event product against a €40 template tool. If the
product prevents one failed schedule or saves several organizer-days, the value
metric is operational risk and labor—not bracket count.

## Product design doctrine

1. **Never surprise the operator.** Preview every material effect before apply.
2. **Never hide uncertainty.** Use known, defaulted, optimized, unsupported, and
   unresolved states visibly.
3. **Keep proof optional but nearby.** Plain language first; evidence one level
   deeper.
4. **Preserve control.** Pins, freeze horizons, approval, undo through revisions,
   and manual fallback are first-class.
5. **Design for the desk under pressure.** Large status, keyboard speed, bulk
   actions, obvious stale data, few modal decisions, and printable truth.
6. **Design the participant view around “where, when, against whom, what changed.”**
7. **Treat accessibility and offline behavior as operational reliability.**
8. **Do not make mobile clients competition engines.** Keep the monorepo and one
   server-owned truth model; web, iOS, iPadOS, and macOS consume versioned DTOs.

## The next 30 days

1. Name and recruit five design partners; schedule historical reconstruction and
   live shadow dates before writing more format code.
2. Build one production-shaped thin slice: import → compile → compare scenarios →
   approve → publish → score → correct → audit export.
3. Implement freeze-horizon minimal-change repair for court closure, overrun,
   withdrawal, and no-show.
4. Add lexicographic CP-SAT objectives with independently reconstructed values:
   feasibility, deadline, makespan, hard promises, preferred rest, change cost,
   critical unlock, flow, then presentation quality.
5. Provision the non-production managed database and identity boundary; run the
   complete concurrency, authorization, backup, and restore suite there.
6. Conduct five observed setup sessions and two tabletop incident exercises.
7. Produce an operator runbook, printed fallback pack, pricing interview, and
   weekly pilot scorecard.

The founder should personally attend the first ten live events. The highest-value
product requirements will be discovered at the control desk when a match runs
late, a pair disappears, a court becomes unavailable, and twenty people ask what
changed at once.

## What not to do next

- Do not add dozens of sports without a paying rule authority or pilot need.
- Do not claim “any sport, any format, any complexity.” Publish envelopes and
  counterexamples instead.
- Do not build a broad social network or court-booking marketplace before product
  trust and operator retention.
- Do not duplicate compiler logic in iOS or macOS.
- Do not let an LLM silently decide rules, seeds, winners, or operational truth.
- Do not build full feature parity with Tournify before validating the difficult-
  tournament wedge.
- Do not treat a green unit-test suite as production evidence; complete live,
  security, recovery, accessibility, and support evidence.

## Bottom line

The next great version of TournamentOS is not a larger compiler. It is a trusted
tournament operating system wrapped around the compiler: easy to set up, hard to
misconfigure, calm during disruption, explicit about compromise, and measurably
better than the organizer’s previous plan.
