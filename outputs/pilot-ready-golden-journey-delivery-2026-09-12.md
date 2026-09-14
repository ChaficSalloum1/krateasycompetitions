# Pilot-Ready Golden Journey delivery

Date: 2026-09-12

## Outcome

The Studio now demonstrates one coherent organiser-to-player journey for the
Play & Konnect padel benchmark:

1. the original organiser intent and resolved assumptions remain visible;
2. valid schedule strategies are compared through independently derived
   resilience evidence;
3. an invalid shortcut is rejected before it reaches the UI;
4. the approved 98-contest revision is published atomically with an exact
   Competition Guard certificate;
5. a Centre Court outage is proposed without mutating the published truth;
6. the smallest proven repair exposes moved contests, affected entrants,
   finish impact, notification recipients, and a proof identity;
7. a different tournament director approves the repair; and
8. the player view reports the approved change and limits the update to affected
   entrants.

## Trust corrections made during browser QA

The first schedule comparison used radio controls even though publication was
bound to the already-approved schedule. That implied a false interaction. The
final design removes the misleading control and labels the two facts separately:
"Resilience recommendation" and "Approved plan".

Programmatic route focus initially drew an error-like border around page headings.
The heading still receives focus for assistive-technology orientation, while only
interactive controls retain visible keyboard focus styling.

## Implemented surfaces

- `apps/compiler-web/src/pilot-journey.ts` — deterministic schedule-decision
  projection with rejected-candidate evidence.
- `apps/compiler-web/src/platform-demo.ts` — multi-actor pilot lifecycle,
  certificate-bound publication, outage proposal, and independent approval.
- `apps/compiler-web/src/server.ts` — development-only pilot read/action routes.
- `apps/compiler-web/src/ui.ts` — responsive golden-journey UI and player-visible
  change state.
- `apps/compiler-web/test/pilot-journey.test.ts` — public behavior tests.

## Verification

- TypeScript build and complete JavaScript/TypeScript suite: 418 of 418 passed.
- Critical bounded protocol models: VERIFIED; 49 states and 133 transitions;
  zero violations; aggregate proof hash
  `bcba8729f0ee2669c1c628bf14e07b2164e64ff82bdc1db66b4f1f312dfcf94f`.
- Apple client: 19 of 19 tests passed.
- Real-browser journey exercised at 1440x1000 and 390x844, including publish,
  outage preview, independent repair approval, and player-view confirmation.

## Production boundary

The pilot actions are intentionally development-only. Moving this exact journey
to production still requires provider-backed identity, the production PostgreSQL
runtime, deployed forward-only migrations, notification delivery adapters,
rate limiting, external secret management, recovery drills, and real pilot-event
evidence. Those external integrations must not be simulated or described as
complete.
