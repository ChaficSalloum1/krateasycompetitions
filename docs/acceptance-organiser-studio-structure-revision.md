# Organiser Studio structure-revision acceptance matrix

**Goal:** Make Organiser Studio explain and safely revise a competition's structure.

**Admission classification**

| Field | Decision |
| --- | --- |
| Organiser job | J2 — understand and defend the proposed plan before publication. |
| Lifecycle state | Competition Design → Certified Plan → Published Promise. |
| Authoritative boundary | The existing `CompetitionJourney` structured-edit proposal/apply, compiler, Run Assurance, Guard and publication boundaries. The browser supplies only a constrained edit command, draft revision and expected preview hash; it never supplies a graph, compiler output, assurance result or Guard report. |
| Primary surface | Organiser Studio — Structure Map and Publish Review. |
| Scope | Explain the existing canonical definition graph, propose one supported structured edit, render server-derived consequences, and apply only the exact reviewed proposal into the existing guarded revision path. |
| Non-goals | Scenario Lab, narrative editing, new tournament models or engines, production deployment, and Mac redesign. |

## Acceptance matrix

| Outcome / claim | Domain invariant | Automated proof | Browser / operational proof | Durable evidence |
| --- | --- | --- | --- | --- |
| The Structure Map explains canonical structure | Pools, qualification and cup/bracket nodes are derived by the server from the current canonical definition, never reconstructed from display names in the client. | Structure-map projection tests cover pools, qualifications and cups/brackets. | Organiser opens Structure Map and sees the seeded canonical chain. | Goal rehearsal JSON records the rendered stable IDs and revision. |
| Unsafe edges are visible where they matter | Invalid, incomplete or consequential edges carry server-derived warnings with stable node/edge identities; absent evidence is labelled unavailable. | Valid and invalid graph-edge tests. | Warnings are rendered next to the affected edge, not hidden in a generic report. | Screenshot/snapshot references and rehearsal JSON. |
| One change is proposed, not mutated by the browser | The server accepts only one supported edit command plus expected draft revision; it produces a hash-bound authoritative preview. No client graph, compiled artefact, assurance or Guard result is accepted. | Valid, malformed/invalid and forged-command tests. | Organiser chooses the supported change and sees a proposal before any definition revision changes. | Preview hash and before/after revision in rehearsal JSON. |
| Review is explainable | The authoritative preview states changed and unchanged structure, match/qualification-count deltas, Run Assurance/Guard evidence and whether the current state may proceed to publication. | Preview/projection tests assert actual deltas and honest unavailable values. | Review is read before apply; no optimistic success state is shown. | Rehearsal JSON includes derived review values. |
| Apply binds to the exact review | Apply requires the current draft revision and exact server preview hash. It creates the existing proposed definition revision only; compile, Run Assurance, Guard approval and publication remain their existing server-owned gates. | Stale, forged-hash, duplicate/replay and post-apply revision tests. | Apply a material change, compile/Guard it, then open Publish Review for that exact revision. | Revision IDs, hashes and outcome in rehearsal JSON. |
| Regression and quality closure | No invalid request mutates state; replay is idempotent or rejected without a new revision. | TypeScript, Apple checks, valid/invalid/stale/forged/replay/post-apply suites. | Deterministic browser rehearsal registered with QA gate. | `output/rehearsals/organiser-structure-map-browser.json` and independent goal-gate report. |

## Exit rule

This matrix is complete only when its tests and deterministic browser rehearsal pass from a clean checkout, an independent QA worktree accepts `npm run qa:goal-gate` with no P1 finding, traceability and release-readiness are updated honestly, and the resulting vertical slice is committed.
