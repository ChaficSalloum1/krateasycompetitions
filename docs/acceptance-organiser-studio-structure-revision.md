# Organiser Studio structure-revision acceptance matrix

**Goal:** Make Organiser Studio explain and safely revise a competition's structure.

**Admission classification**

| Field | Decision |
| --- | --- |
| Organiser job | J2 — understand and defend the proposed plan before publication. |
| Lifecycle state | Competition Design → Certified Plan → Published Promise. |
| Authoritative boundary | The existing `CompetitionJourney` structured-edit proposal/apply, compiler, Run Assurance, Guard and publication boundaries. The browser supplies only a constrained edit command, draft revision and expected preview hash; it never supplies a graph, compiler output, assurance result or Guard report. |
| Primary surface | Organiser Studio — Structure Map and Publish Review. |
| Scope | Explain the existing canonical definition graph, expose one supported qualification-rule control in this Structure Map UI slice, render server-derived consequences, and apply only the exact reviewed proposal into the existing guarded revision path. “One change” bounds this UI slice; it does not narrow the existing generic server structured-edit API or its registered decisions. |
| Non-goals | Scenario Lab, narrative editing, new tournament models or engines, production deployment, and Mac redesign. |

## Acceptance matrix

| Outcome / claim | Domain invariant | Automated proof | Browser / operational proof | Durable evidence |
| --- | --- | --- | --- | --- |
| The Structure Map explains canonical structure | Pools, qualification and cup/bracket nodes are derived by the server from the current canonical definition, never reconstructed from display names in the client. | Structure-map projection tests cover pools, qualifications and cups/brackets. | Organiser opens Structure Map and sees the seeded canonical chain. | Goal rehearsal JSON records the rendered stable IDs and revision. |
| Unsafe edges are visible where they matter | Invalid, incomplete or consequential edges carry server-derived warnings with stable node/edge identities; absent evidence is labelled unavailable. | Deterministic `structure-edge-warning-cases.json` fixtures prove `INVALID_EDGE`, `INCOMPLETE_EDGE`, and `CONSEQUENTIAL_EDGE` remain attached to their affected stable edge and pass through the Organiser Studio renderer. | Warnings are rendered next to the affected edge, not hidden in a generic report. | Render tests plus rehearsal JSON containing rendered edge IDs and warning codes. |
| One change is proposed, not mutated by the browser | This Structure Map UI submits one supported qualification edit plus expected draft revision; the existing generic server API continues to accept its registered structured-edit set and produces a hash-bound authoritative preview. No client graph, compiled artefact, assurance or Guard result is accepted. | Valid, malformed/invalid and forged-command tests. | Organiser chooses the supported change and sees a proposal before any definition revision changes. | Preview hash and resulting guarded revision in rehearsal JSON. |
| Review is explainable | The authoritative preview states changed and unchanged structure, server-derived before/after match and qualification counts, explicit deltas, Run Assurance/Guard evidence and whether the current state may proceed to publication. A delta is labelled unavailable when either canonical side is incomplete. | Preview/projection tests assert a derived zero delta when both definitions exist and honest unavailable deltas when the current definition is incomplete. | Review is read before apply; no optimistic success state is shown. | Rehearsal JSON includes the rendered before/after/delta values. |
| Apply binds to the exact review | Apply requires the current draft revision and exact server preview hash. It creates the existing proposed definition revision only; compile, Run Assurance, Guard approval and publication remain their existing server-owned gates. | Stale, forged-hash, duplicate/replay and post-apply revision tests. | Apply a material change, compile/Guard it, then open Publish Review for that exact revision. | Resulting revision, preview hash and outcome in rehearsal JSON. |
| Regression and quality closure | No invalid request mutates state; replay is idempotent or rejected without a new revision. | TypeScript, Apple checks, valid/invalid/stale/forged/replay/post-apply suites. | Deterministic browser rehearsal registered with QA gate. | `output/playwright/organiser-structure-map-browser.json`; the independent goal-gate report embeds that exact artifact with its SHA-256. |

## Exit rule

This matrix is complete only when its tests and deterministic browser rehearsal pass from a clean checkout, an independent QA worktree accepts the command below with no P1 or P2 finding, traceability and release-readiness are updated honestly, and the resulting vertical slice is committed.

```sh
npm run qa:goal-gate -- --goal "Organiser Studio structure revision closure" --baseline 17fbbb7 --rehearsal rehearse:organiser-structure-map-browser --artifact output/playwright/organiser-structure-map-browser.json
```
