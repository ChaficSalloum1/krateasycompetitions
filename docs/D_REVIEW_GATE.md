# D review milestone — live source and visual structure

The requested review milestone is implemented. **The full Phase D programme exit gate is not claimed. E/F have not been started as programme slices.**

## Working review journey

- Editable natural-language source updates the draft structure live. JSON/YAML drafts and CSV/XLSX entrant imports reuse source adapters.
- Source facts include provenance. Conflicting/unrecognised statements remain questions; answers bind the current source hash. Text replacement invalidates stale answers.
- Click divisions, pools, qualification, cups/brackets or operations to edit the corresponding rule fields. Source remains intact; edits are explicit draft decisions.
- Core topology visualises byes/rounds independently of qualifier identities. The actual schema, definition compiler and graph builder run in the preview bundle, not a new browser competition kernel.
- Invalid counts show precise findings, including ten qualifiers/eight slots. Nothing silently resizes a bracket or drops entrants.
- Undo restores inputs but clears review state. Export includes source, facts, open decisions, proposed definition, graph, hashes and telemetry. Review is local and non-authoritative; no protected commands or publication endpoint exist here.
- Imported roster identity preservation was completed as a hard-invariant correction: the graph uses imported identities; changing only a count cannot invent/drop entrants. Anonymous narrative examples remain structural entrants, not a real accepted roster.

## Evidence

`scenario/verification/phase-d.txt`: 14 model/session/hash/import checks pass.
`scenario/verification/creator-ui.txt`: the actual built browser bundle passes a DOM-emulated flow covering questions, visual field edits, live text updates, precise invalidity, undo, three divisions, review invalidation and HTML escaping. This is NOT real-browser layout, mobile or assistive-technology verification. Browser-control infrastructure required by the Sites skill is unavailable; no browser QA claim is made.

TypeScript build and bundle build pass. Broader regression result and isolated solver recheck are retained verbatim in `creator-regression.txt` and `creator-solver-recheck.txt`; see current handoff for totals. No test outcome is inferred from the UI.

## Current D controls and remaining gate

Implemented in sequential bounded slices:

1. **D1 membership:** exact roster-bound pool swaps; together/separate definition constraints; core allocation validates coverage, sizes and constraints. Named CSV roster labels/member identities remain intact. Stale assignments remain visible and block review.
2. **D4a operations:** individual court windows including later openings and breaks; stage/round contest duration and turnaround overrides in the canonical spec. Invalid or stale inputs cannot silently clear saved rules.
3. **D4b draft plan starts:** exact contest/ancestry/roster-bound start locks; explicit unlock; availability, dependency lower bound, concurrent court capacity and possible-entrant rest checks. These are necessary checks on locks, not a full schedule feasibility certificate. D4c now adds optional fixed-court pinning; see its contract and latest evidence below.

Still required: the organiser acceptance journey reproducing complete P&K format and real-browser/mobile/accessibility review. No full D gate is claimed. E/F remain gated. The existing runtime or scheduler implementations are not evidence that their programme gates have passed.

## Scope of source understanding

A deterministic, bounded interpreter for the supported grammar and draft schema. There is no connected LLM and no universal-tournament claim. Unsupported statements are preserved, not silently downgraded. St Albans is a structural study using source-backed pool counts and explicitly stated review-scenario operations, not a full event replay.

Final verification record: the full core/web suite executed 634 tests: 633 passed and one existing asynchronous CP-SAT check returned UNKNOWN instead of CERTIFIED under the concurrent run. Its entire solver file then passed 11/11 in isolation. This suggests sensitivity to the bounded runtime budget, but is not represented as a fully green 634-test rerun. The affected solver code was not changed. The focused creator flow and browser-bundle checks remain green after the final UI stale-input flush correction.

## D command-integrity continuation

Implemented under [D_COMMAND_SLICE](D_COMMAND_SLICE.md). The draft aggregate now enforces typed commands, expected revisions, idempotent receipts, conflicting-ID rejection, immutable input snapshots and atomic candidate evaluation. REVIEW binds the exact new draft revision; changes and undo clear it. The UI displays draft state and transition history, and exports replayable commands with before/after hashes. Graph errors now block review readiness.

Evidence: `scenario/verification/phase-d-commands.txt` — 19 focused tests pass, including stale/duplicate/malformed commands, unchanged state on rejection, full command replay, detached snapshots and a duplicate-roster graph counterexample. TypeScript and browser bundle builds pass. Updated DOM-emulated UI check passes, including the REVIEWED state and visible transition history. No new full-suite or real-browser claim is made.

This bounded integrity slice passes. Historical handoff: full D remained open for the requirements above. The three subsequent D slices above now cover membership, individual windows/durations and protected start locks; E is still gated.

## Latest integrated verification — D1 / D4a / D4b

- 652/652 core/web regression tests passed with the existing CP-SAT environment and test concurrency 2 (`phase-d-full-regression.txt`). This replaces the earlier 633/634 run as the latest broader regression evidence; the prior failed run remains recorded above for provenance.
- 33/33 focused creator tests passed on the final implementation (`phase-d-integrated.txt`). This includes an additional malformed-membership regression added after the broader run began; that final defensive check was verified by the focused run, not represented as a 653-test full-suite rerun.
- TypeScript build, browser bundle and actual bundled DOM interaction flow passed. The UI flow covers questions, pool swaps/constraints, court windows, duration overrides, start lock/unlock, invalid edits, undo, live source changes, review state and escaping. It remains DOM emulation, not browser visual/accessibility evidence.
- Start locks are necessary constraints only. No schedule was generated or certified, no competition was published, no production P&K data was changed, and no E/F gate was entered.


## D4c — current court-lock acceptance

Court pinning is implemented in [D_COURT_LOCK_SLICE](D_COURT_LOCK_SLICE.md). Draft Plan owns exact contest/time/unit locks; Definition retains resource windows. Removing a court or changing semantics cannot silently unpin a contest. Rejected commands commit nothing; undo and replay retain exact input lineage.

The existing list scheduler respects and reserves pinned courts; independent schedule validation rejects altered assignments. The normalized typed schedule model retains explicit lock units. The separate graph-to-CP-SAT adapter **rejects** these projected locks with TSQ102: its integration remains Phase F work, not an inferred capability.

The Sites managed-preview instructions require `control-browser`, which is absent from the installed skill catalog; static assets also have no compatible supervised development server. No alternative browser path was improvised. Bundled DOM checks cover interactions only. This does not block publishing the review prototype, but does leave real-browser/mobile/accessibility acceptance open.

Next allowed work: [D organiser review](D_ORGANISER_REVIEW.md) and browser evidence. E/F/G remain gated; participant/pair/pool/division automatic schedule repair is still the future G acceptance outcome, not implemented by court locks.

## D4c verification — 2026-09-28

- `npm run build`, `npm run creator:build`, and `npm run creator:check-ui`: passed. The actual Site-bound bundle also passed `node scripts/check-creator-ui.mjs /workspace/sites/krateasy-core-evidence/dist`.
- `node --import tsx --test apps/compiler-web/test/creator-*.test.ts packages/competition-engine/test/schedule-model.test.ts`: **47/47**, zero failures (`scenario/verification/phase-d-court-locks.txt`).
- `TOURNAMENT_OS_CP_SAT_PYTHON=/workspace/scratch/b4b1b247a24a/core-solver-env/bin/python node --import tsx --test --test-concurrency=2 packages/*/test/*.test.ts apps/*/test/*.test.ts`: **658/658**, zero failures, 95.5 seconds (`phase-d-court-regression.txt`). Node 24.19.0; Python 3.12.14; OR-Tools 9.15.6755.
- Earlier environment-failure run retained in `phase-d-court-runtime-missing.txt`: 631/656 passed, 25 failed because the restored virtual environment lacked its `bin/python3` executable. Recreated the interpreter using `python3 -m venv --upgrade`; verified the pinned OR-Tools import; reran the complete suite. Two additional focused regression cases were added before that final broad run. No solver expectations were weakened.

D4c bounded gate passes. This is draft/editor/adapter evidence, not full D organiser acceptance, schedule feasibility for every input, production authority, or E/F/G completion.
