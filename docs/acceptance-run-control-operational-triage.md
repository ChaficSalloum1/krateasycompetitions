# Run Control operational triage acceptance matrix

**Baseline:** `a7f96c1f9d4cb0942e3a9f0ccde25439c939f0f9`
**Status:** delivery candidate; independent closure acceptance pending

## Job

When an organiser runs a dense live event, they want to find the few root
causes requiring action, act safely by keyboard, and distinguish published
truth from historical source evidence, so they can keep play moving without
mistaking derived symptoms or draft provenance for current authority.

## Scope

- Derive and render a deterministic, urgency-ranked Run Control triage view
  from the existing organiser-live projection.
- Collapse fixtures blocked only by dependency chains beneath their first
  unresolved cause and expose the affected scope.
- Route check-in, call, score and incident rows to their relevant existing
  control, without inventing a command or approval path.
- Keep fixture, entrant, court, revision and proof identities in expandable
  technical evidence rather than primary operator prose.
- On published and closed Organiser Studio views, lead with revision-bound
  canonical facts and label draft questions, conflicts and source records as
  historical provenance.
- Rehearse the actual local routes from Portfolio through Studio and Run
  Control to Close Receipt at the 640 CSS-pixel (200%) and 320 CSS-pixel
  (400%) reflow equivalents, and complete one live action with only the
  keyboard in a deterministic 108-fixture event.

## Non-goals

- No Scenario Lab, compiler/engine breadth, new workflow, new live command,
  new product surface, production routing change or Mac redesign.
- No alteration to competition semantics, schedule derivation, live event
  projection/replay, Guard policy, publication, closure or restore authority.
- No claim that local automated accessibility evidence satisfies the named
  external accessibility or pilot-release authority.

## Authoritative boundary

The existing `CompetitionJourney` read projection supplies current published
and operational truth. Existing server-owned `live-command`, incident preview
and approval, publication, close, duplicate and restore commands remain the
only mutation boundaries. Expected revisions, live versions, proposal/option
hashes, Guard reports, publication certificates, closure hashes and replay
rules remain unchanged. Triage is a deterministic client presentation of the
existing projection; a contextual action only preselects an existing form and
the organiser still submits that server-validated command.

## Invariant matrix

| Outcome / claim | Protected invariant | Automated proof | Browser / operational proof | Durable evidence |
| --- | --- | --- | --- | --- |
| Few actionable root causes replace a wall of blocked fixtures | Dependency-only blocked fixtures are assigned deterministically to their first unresolved cause; no fixture disappears | Focused triage unit tests cover chains, multiple causes, affected counts and deterministic ordering | Dense 108-fixture routed rehearsal records root-cause count, collapsed descendants and the highest-ranked cause | `output/playwright/run-control-operational-triage.json` |
| Urgency and scope determine order | Rank is explicit, stable and derived only from existing queue/reason facts; affected scope breaks equal urgency | Unit tests assert incident/check-in/late/result priority and scope tie-breaks | Browser evidence records rendered order, urgency and affected scope | Same retained triage JSON |
| Every row has the relevant next action | Check-in/call/score/result-receipt buttons prefill existing controls; only exact court/no-show causes enter matching incident review; unsupported causes open evidence without mutation | View tests assert action mapping, exact receipt parsing and absence of universal incident routing | Browser rehearsal proves exact no-show subject binding, non-mutating withdrawal evidence, and keyboard submissions of check-in and result receipt | Same retained triage JSON |
| Operator copy is readable while identities remain available | Stable IDs and proof hashes remain present, but only inside labelled expandable technical evidence | HTML tests assert primary labels, `<details>` evidence and no ID-led action copy | Browser evidence records evidence disclosure state and accessible action names | Same retained triage JSON |
| Published/closed Studio never presents draft provenance as unresolved current truth | Revision-bound publication/closure facts precede a labelled historical-provenance disclosure; draft-only wording remains draft-only | Published and closed rendering tests assert ordering, labels and canonical hashes/revisions | Routed rehearsal inspects Studio before Run Control and again through the receipt route | `output/playwright/routed-operations-accessibility.json` |
| Shipped routes reflow and remain keyboard reachable | Actual Portfolio, Studio, Run Control and Close Receipt routes have no page-level horizontal overflow at 640/320 CSS px, retain visible focus and named landmarks/actions | Routed-server and accessibility source tests remain green | Playwright CLI visits the real routes at 200%/400% equivalents and records viewport/scroll widths and keyboard focus | Same retained routed accessibility JSON |
| Existing safety boundaries remain intact | Valid requests succeed; stale, forged and replayed commands/proposals remain rejected or idempotent at existing domain boundaries | Existing live/incident/close regression suites plus full repository and protocol checks | Browser records only the expected existing endpoint and revision/version transition | Independent goal-gate report under `output/qa/` |
| Evidence is exact and reviewable | Every declared JSON artifact is regenerated at the exact delivery commit and embedded with a SHA-256 by the goal gate | Reusable goal gate removes stale artifacts, runs rehearsals, parses and hashes outputs | Independent QA uses a fresh worktree at the delivery commit and reviews UI/code against this matrix | Independent QA gate report and reviewer decision |

## Planned evidence commands

```sh
npx tsc -b --pretty false
node --import tsx --test apps/compiler-web/test/run-control-triage.test.ts apps/compiler-web/test/authoritative-surface.test.ts apps/compiler-web/test/pilot-accessibility.test.ts apps/compiler-web/test/live-no-show-journey.test.ts apps/compiler-web/test/live-court-outage-journey.test.ts apps/compiler-web/test/live-delay-overrun-journey.test.ts apps/compiler-web/test/competition-close-journey.test.ts
npm run rehearse:run-control-operational-triage-browser
npm run rehearse:routed-operations-accessibility-browser
npm run qa:goal-gate -- --goal "Run Control operational triage and routed accessibility" --baseline a7f96c1f9d4cb0942e3a9f0ccde25439c939f0f9 --rehearsal rehearse:run-control-operational-triage-browser --rehearsal rehearse:routed-operations-accessibility-browser --artifact output/playwright/run-control-operational-triage.json --artifact output/playwright/routed-operations-accessibility.json --evidence output/qa/run-control-operational-triage.json
```

## Exit rule

Delivery stops at a committed delivery candidate with the matrix, commands,
retained artifacts and limitations handed off. The goal closes only after an
independent reviewer refreshes a separate QA worktree to that exact commit,
runs the goal gate and matrix review, and returns `accepted` with no unresolved
P1 or P2 finding. Any finding becomes one narrow closure goal.

## Narrow closure goal — contextual action truth

Independent QA of delivery commit `46b6be1c6a355088a0e1c70c5cb6bd9c213c201b`
returned no P0/P1 and two P2 contextual-action findings. This single closure
is limited to routing a terminal missing receipt through the existing
`RECORD_RESULT_RECEIPT` command, binding existing incident review only to an
exact court/no-show cause and subject, opening technical evidence without
mutation for unsupported causes, and correcting the duplicate traceability
number. It adds no command semantics, incident type, workflow or product
surface. Exit requires a fresh worktree at the closure commit, the exact goal
gate, and independent acceptance with no unresolved P1/P2.

## Known limitations retained honestly

- Contextual actions preselect the existing command or incident form; they do
  not bypass review or submit automatically.
- Upcoming fixtures remain available in one collapsed disclosure so they do
  not compete with ranked causes; this is not a new scheduling workflow.
- The routed browser artifact uses deterministic local state and viewport
  equivalents. It does not replace named VoiceOver/NVDA, print, outdoor/mobile
  or venue-network acceptance.
- The live route chain reaches the pre-close receipt for the same 108-fixture
  event. The artifact additionally opens a separately seeded, fully closed
  108-result Studio snapshot to prove settled canonical-versus-historical
  wording without changing the live rehearsal mid-flow.
