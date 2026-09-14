# TournamentOS UI/UX and production gap audit

Date: 2026-09-07

## Executive finding

The current Studio is a coherent, stable operational prototype with a credible
TournamentOS visual identity. It is not yet a complete, validated organiser
product. The engine and multi-tenant platform are materially more capable than
the current interface.

The UI has been inspected in a real browser on desktop and at 390 x 844. All ten
primary destinations render, the demonstrated guided submission succeeds, touch
targets and reduced-motion rules exist, and the final console is clean. That
proves functional stability. It does not prove that unfamiliar organisers can
use the product without help.

## What already works well

- The warm canvas, deep forest navigation, restrained terracotta action colour,
  compact typography, and explicit textual state are consistent with the
  TournamentOS design system.
- The hierarchy is calm and legible rather than looking like a generic sports
  bracket site or a neon analytics dashboard.
- Portfolio answers basic scope quickly: clubs, tournaments, players, and alerts.
- Proof, solver status, certification identity, and operational exceptions are
  visible instead of hidden behind unexplained automation.
- Navigation, skip link, focus rules, reduced motion, responsive collapse, and
  44-pixel minimum controls provide a sound accessibility baseline.
- The six-domain creation sequence is conceptually correct and the demonstrated
  submission reaches the real event-sourced API rather than mutating local UI
  state.

## Critical UX gaps

### P0 — creation is not yet a true guided workflow

The interface displays six steps, but presents them as one form and submits all
six commands behind one button. Rules and resources are mostly hidden defaults.
There is no Back, Save and exit, per-step validation, review comparison, or
recovery from a partially completed submission. This makes the hardest formats
less understandable precisely where TournamentOS should be strongest.

Participants are not filtered when the selected club changes; the observed
Harbour form also displayed Hills players. The domain correctly rejects invalid
cross-club choices, but the UI should prevent the mistake and explain scope.

Required redesign: one resumable step per page/panel; explicit simple and
advanced choices; autosaved draft; visible assumptions and blockers; resource
capacity preview; schedule-risk preview; final human-readable review with formal
diff and proof state.

### P0 — capability pages are mostly read-only

- Tournament cards cannot open a tournament workspace or offer duplicate,
  revise, submit for review, approve, publish, archive, or restore actions.
- Directory has no search, filters, bulk import, merge, archive, edit, or record
  detail. Resources are grouped together and two courts named “Court 1” are not
  visually disambiguated by venue.
- Format Library does not expose versions, changelog, compatibility, default
  scope, preview, compare, duplicate, approve, deprecate, or “Use this format”.
- Alerts cannot be acknowledged, assigned, or resolved.
- Control room is a status board rather than the complete scoring, incident, and
  repair-approval console supported by the API.

### P0 — context is ambiguous

Compiler, graph, schedule, public view, and proof screens use the fixed Play &
Konnect reference blueprint rather than a tournament selected from Portfolio.
The global “Certified with visible findings” badge also appears on Directory and
Create, where it can be mistaken for organisation or draft status. A persistent
organisation -> club -> tournament context selector and context-specific status
are required.

### P1 — organisation administration has no complete product surface

Membership, invitation, role, suspension, club lifecycle, privacy export,
account deletion, notification preferences, backup, and restore are available at
the domain/API layer but do not yet have a complete owner/admin interface.

### P1 — mobile navigation scales poorly

At 390 pixels, the page itself does not overflow, but the fixed navigation is a
400-pixel horizontally scrollable grid containing ten destinations. It is usable
only by discovering sideways scrolling and occupies substantial event-day space.
A four- or five-item priority tab bar plus a labelled More destination is needed;
contextual actions should remain reachable with one hand.

### P1 — resilience and feedback need product work

There is no visible offline/stale indicator, optimistic-concurrency recovery,
undo-by-revision flow, field-level server error placement, retry continuation,
notification impact preview, skeleton loading, or success receipt that remains
visible after navigation. The current timestamp-derived creation identity can
leave an abandoned partial draft if the network fails mid-sequence.

## What “intuitive” must be proven by

Passing automated tests is not a usability result. Before claiming that the
product is materially easier than alternatives, run observed task-based studies
with at least:

- first-time volunteer organisers;
- club administrators running weekly events;
- experienced tournament directors handling multi-division events;
- referees and score-desk operators under time pressure;
- coaches/players checking schedules and changes on phones;
- keyboard, screen-reader, low-vision, and motor-access users.

Canonical tasks should include creating a simple event, reproducing the Play &
Konnect format, importing entrants, finding and fixing one invalid participant,
publishing, recording a score correction, closing a court, approving the smallest
safe repair, and explaining a qualification outcome. Measure completion without
help, time, errors, backtracking, confidence, and whether users can explain what
will change before confirming it.

## Recommended delivery order

1. Add persistent organisation/club/tournament context and a tournament workspace.
2. Rebuild creation as a resumable six-step wizard with Simple, Detailed, and
   Expert disclosure modes.
3. Complete tournament, directory, format, alert, membership, and invitation
   write experiences.
4. Make the live desk fully operational: check-in, scores, incidents, impact
   preview, repair approval, notification receipt, and emergency print.
5. Replace mobile navigation with task-priority tabs plus More; add offline/stale
   state and conflict recovery.
6. Add participant-facing personal schedule, bracket, standings, map/check-in,
   changes, notification preferences, and accessible public sharing.
7. Run formative usability studies, fix the observed failures, then run a
   benchmark study against the same canonical tasks in competing products.
8. Complete production identity, managed data, PII vaulting, notifications,
   observability, security/load/restore drills, and release evidence.

## Honest product status

- Compiler/solver foundation: advanced within its tested evidence envelope.
- Multi-club platform and write API: strong production-shaped foundation.
- Visual system: coherent and distinctive.
- Current Studio: useful demonstrator and operational read surface.
- End-to-end organiser UX: incomplete.
- Evidence that unfamiliar users find it intuitive: not yet collected.
- Evidence that it is better than market alternatives: not yet demonstrated in a
  controlled task comparison.
