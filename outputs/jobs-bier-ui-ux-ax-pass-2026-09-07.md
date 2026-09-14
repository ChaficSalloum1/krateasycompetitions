# TournamentOS Jobs / Product-Growth UI, UX and AX Pass

Date: 7 September 2026

## Outcome

TournamentOS Studio has moved from an engine-shaped demonstration to an
organiser-shaped product foundation. The UI now leads with the decision that
needs attention, exposes complexity progressively, and keeps formal evidence
available without forcing it into normal workflows.

This is a completed major first pass, not a claim that the entire production UX
is finished. The compiler core is substantially ahead of the operator product.

## Product principles applied

1. **The user sees their job, not our architecture.** Navigation is grouped as
   Plan, Operate, Library, and Advanced. Compiler vocabulary is demoted.
2. **One screen has one dominant question.** Home asks “What needs you now?”;
   creation asks for one class of decision at a time; player view asks who the
   participant is.
3. **Complexity is earned progressively.** Proofs, graph structure, rule
   interpretation, and revision identities remain available but do not compete
   with the immediate operational action.
4. **Trust comes from visible consequences.** Draft creation says exactly what
   changes and what does not; publication remains a separate authorised action.
5. **Activation means proven value, not account creation.** The meaningful first
   success is a reviewed, feasible tournament draft whose rules and resource
   assumptions are inspectable.
6. **Retention should be event-driven.** Useful reasons to return are a real
   operational exception, a schedule change, a match becoming ready, or an
   approval request—not manufactured engagement.
7. **Sharing should serve the tournament.** Participant links, QR entry, calendar
   actions, and follow-a-tournament notifications are the appropriate organic
   loop. Contact harvesting and premature notification prompts are not.

## Job stories and acceptance criteria

### Organiser triage

When I open a club workspace while preparing or running an event, I want to see
the next consequential decision, so I can prevent participant impact without
searching through system modules.

Acceptance:

- The highest-priority unresolved decision is visible on first paint.
- Passive counts are secondary to the decision.
- Status includes words and never depends on colour alone.
- The eventual action opens the affected tournament and explains consequence,
  authority, and reversibility before application.

### Guided creation

When I create a difficult tournament, I want to answer only the decision in front
of me, so I can use the compiler without learning its internal model.

Acceptance:

- The flow is Participants → Format → Rules → Resources → Priorities → Review.
- It preserves entered data when moving backward.
- It never silently invents a rule or relaxes a hard constraint.
- Review shows the pinned template version, participants, resources, priorities,
  unresolved questions, feasibility status, and publishing authority.
- Creation produces a draft; publication is explicit and separately authorised.

### Tournament-day operator

When disruption occurs, I want the safest valid repair and its human impact, so
I can recover the event without creating a hidden downstream problem.

Acceptance:

- The control room orders information as Now, Next, Attention, then remaining
  resources.
- A repair preview shows old/new time and court, affected participants,
  notifications, objective trade-offs, and independent validation.
- Pinned contests, freeze horizons, and already communicated promises are clear.
- No repair is published from an unverified or stale revision.

### Participant

When I arrive or receive a schedule link, I want to find myself and see my next
match, so I know where to be and whether anything changed.

Acceptance:

- Search by player or team is the first interaction.
- The first answer is time, opponent, court, and arrival guidance.
- Changes show the previous value and effective revision in human language.
- Verification details are disclosed on demand.
- A personal deep link, QR route, calendar action, and accessible notification
  preference are available after publication.

### Competition specialist / auditor

When I inspect an unusual format, I want to reveal its formal structure and proof
without burdening ordinary operators, so I can verify that the system has not
invented or lost competition policy.

Acceptance:

- Every rule maps to source, authority, semantic version, and executable status.
- The graph, schedule proof, replay identity, unresolved requirements, and
  counterexamples are inspectable from Advanced views.
- A human-readable explanation and the exact machine artifact describe the same
  revision.

## Implemented in this pass

- Job-based desktop and mobile navigation.
- A calm, asymmetric desktop home focused on decisions rather than equal-weight
  dashboard cards.
- A genuine six-step progressive tournament-creation wizard with validation,
  review, draft-only language, and focus management.
- A player-first published view with participant/team search, next-match hero,
  human schedule information, and progressive disclosure of proof identity.
- Responsive one-column mobile behaviour, internal-only horizontal scrolling for
  wide operational tables, and 44-pixel minimum interactive targets.
- Skip link, visible focus, semantic headings and landmarks, labelled controls,
  live status regions, reduced-motion handling, and forced-colour support.
- Humanised product labels in place of enum-shaped text in primary surfaces.
- An explicit design system and anti-pattern list.
- Regression coverage integrated into the existing 398-test suite.

## Next product-quality sequence

### 1. Close the first-session activation loop

Build a resumable onboarding path using one representative club and tournament.
Measure time to imported participants, time to first feasible draft, unresolved
questions per draft, and abandonment by creation step. Do not optimise for signup
completion.

### 2. Make home decisions actionable

Every alert needs one safe primary action, affected scope, owner, due/impact
language, and a route into the exact decision. Add organisation/club switching,
season context, saved views, and honest loading/empty/error/offline states.

### 3. Build the real schedule workspace

Implement a desktop resource timeline with search, filters, zoom, conflict
explanations, lock/freeze controls, and a repair drawer. Supply a compact mobile
day-of-operation list rather than shrinking the desktop grid.

### 4. Finish operator workflows

Add check-in, court readiness, call-to-court, score entry, retirement, walkover,
correction, protest/appeal, outage, and recovery surfaces. Test duplicate, stale,
offline, and reordered commands through the UI, not only the domain layer.

### 5. Create the participant distribution loop

Add signed tournament and participant deep links, QR entry, add-to-calendar,
follow/unfollow, notification preferences, and a shareable live board. Ask for
notifications only after the person follows a tournament or a published schedule
has value for them.

### 6. Complete the accessibility evidence

Run axe in CI; keyboard-only task scripts; VoiceOver on macOS/iOS and NVDA on
Windows; 200% and 400% zoom; text-size and reflow; high contrast/forced colours;
reduced motion; target-size and contrast measurement; error recovery; switch
control; and representative RTL/localised layouts. Record defects and evidence
per release.

### 7. Validate with real people under tournament pressure

Use moderated tests with organisers, desk operators, referees, and participants.
Then shadow real tournaments. Success gates should include task completion,
median decision time, error recovery, schedule comprehension, support requests,
and zero unsafe publications—not subjective “looks polished” ratings alone.

## Release gates for the product surface

- A new organiser can create and understand a feasible draft without instruction.
- No engine enum or proof hash appears before it is useful.
- Every destructive or public action states impact, authority, and reversibility.
- Every workflow has loading, empty, error, offline, stale, duplicate, and success
  behaviour.
- Core tasks complete by keyboard and screen reader at the same semantic fidelity.
- Participant information remains useful on a small screen, in sunlight, and with
  intermittent connectivity.
- Product analytics never contain personal competition data or proof secrets.
- No engagement prompt appears before the user has received corresponding value.

## Honest boundary

The current Studio demonstrates a substantially improved information architecture,
visual system, creation flow, and player view. The remaining items above require
real interaction design, implementation, telemetry, accessibility evidence, and
field validation. They should not be represented as complete until those gates
are backed by executable tests and observed tournament use.
