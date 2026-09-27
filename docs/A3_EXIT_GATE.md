# A3 scenario pipeline — acceptance evidence

Phase: A — Freeze & Observe. Slice: Ticket 2 / A2–A3. Entry condition: A1 documentation gate completed; user explicitly authorised the next working prototype slice. Authority: supplied finite plan and canonical domain contract. Scope contract: A3_SLICE.md.

## Delivered

Real core execution with immutable, inspectable SOURCE, FACTS, DEFINITION, GRAPH, CLASSIFICATION, QUALIFICATION, SEED, TOPOLOGY, DRAW, SCHEDULE and GUARD records. Every boundary contains input references, exact output, revision, canonical hash, findings/failure and telemetry. Failures stop downstream producers. The observer cannot publish or change authoritative competition state.

Three manifests and source fixtures are in `scenario/simple-knockout`, `scenario/six-pair-round-robin`, `scenario/play-konnect-reference`. The historical case is the repository's St Albans planning candidate, preserving its original claims, missing decisions and explicit fixture decisions. Results are labelled synthetic. No live-event parity or actual historical result correctness is claimed.

`npm run audit:serve` starts a loopback-only live audit service and inspector. `npm run audit:scenarios` executes and exports the twelve baseline/corruption runs and a static inspector. The hosted inspector explicitly identifies recorded execution. It is not an online general compiler or production Guard endpoint.

## Defects found by acceptance work

1. A round-robin self-match replacing a required pairing escaped the previous independent coverage check because it counted distinct pairs without reconstructing the complete required pair set. The initial new suite passed 15/16; the six-pair draw corruption was incorrectly READY. The fix in `guard-path-reconstruction.ts` checks every independently derived unordered pair and multiplicity. The same probe now blocks at DRAW. This hard invariant defect blocked A3 acceptance and therefore belongs to this slice.
2. The imported schedule adapter labelled one invalid candidate INFEASIBLE. Rejection of a candidate is not proof of problem infeasibility. It now returns UNKNOWN; the audit retains concrete schedule violations and blocks. A corrupted historical source schedule regression verifies this. No scheduler algorithm was replaced.

## Executed evidence

- TypeScript `npm run build`: passed after implementation and final schedule-status fix.
- Full existing-plus-audit suite, pinned available CP-SAT interpreter: 607 tests passed, zero failed/skipped. Command: `TOURNAMENT_OS_CP_SAT_PYTHON=/workspace/scratch/b4b1b247a24a/core-solver-env/bin/python node --import tsx --test --test-concurrency=4 packages/*/test/*.test.ts apps/*/test/*.test.ts`. Node 24.19.0, OR-Tools 9.15.6755. This run includes the pairing fix and initial 16 audit tests.
- Following the imported-candidate status fix, focused audit + St Albans workbench regression: 26 passed. This includes the added UNKNOWN test; the full 607 count is not misrepresented as a rerun of the expanded suite.
- Live HTTP boundary test: 1 passed, covering all three scenario executions and rejection of malformed JSON, stale revision, caller-supplied forged Guard and unknown paths. The test starts its own local process and uses actual HTTP.
- Export: 12 runs; 3 READY baselines; 9 blocked mutations, exactly at QUALIFICATION / DRAW / SCHEDULE as injected. Evidence hashes match their outputs and parent references; repeated execution preserves proof identity despite timing variation.
- Controller-render test: all 132 boundary views across 12 recorded runs rendered without an exception. Command: `node scripts/check-audit-ui.mjs output/scenario-audit`. This is not real-browser, mobile or accessibility QA.
- `git diff --check`: passed.

## Gate decision and next work

A3 observability acceptance passes for these exact three source-backed scenario configurations and twelve runs. The historical source is a planning candidate with visible fixture assumptions, not a played-results archive. No conclusion about H/I historical parity follows from A3.

A2 records a maintenance-only boundary for this work; no P&K repository or production change was made. A1/A3 changes remain review branches, not merged production releases.

Next allowed slice: B — qualification/draw integrity. In particular, current seed assignment remains coupled inside the existing qualification producer; A3 exposes this honestly as separate observable projections, but does not claim that B2 implementation is complete. B must prove full seeding, topology, rematch/bye properties, and reproduce the historical problematic draw before C begins. C/D creator work is not delivered by this audit inspector.
