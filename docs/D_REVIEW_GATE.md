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

## D5 — separate format and roster sources

The organiser walkthrough exposed a gate blocker: a CSV/XLSX roster previously replaced the entire format source. D5 attaches an entrant source to the existing format through a revision-checked command. Separate source hashes and row locators remain in the exported draft. Invalid imports reject atomically; a valid but incompatible division/count blocks review and remains inspectable. Source changes retain the attachment for reconciliation; existing pool assignments and locks block if their identities become stale. The planning candidate's 48 named pairs can now be reviewed with the three-division example. The example's person IDs are illustrative; no historical played-event or approved-roster claim follows.

Remaining D gate: the organiser must confirm the real P&K semantics and roster against the proposed model; desktop/mobile/keyboard/accessibility acceptance needs real-browser evidence. The candidate's historical pool membership and qualification policies are not silently inferred from its schedule. E/F/G are still gated.

D5 evidence: 43/43 focused creator checks, 664/664 full core/web regressions, TypeScript build, browser bundle and DOM-emulated source/roster attachment/removal flow passed. Source-backed pair labels and division counts came from `scenario/play-konnect-reference/source.json`; generated row/person IDs are illustrative. The included CSV is a review fixture, not an approved roster. The two-cup control defect found in the next D inspection was handled as D6, without advancing E.

## D6 — each cup has its own bracket controls

Both cup cards previously opened the same main-bracket inspector. The second card now has independent bracket capacity, protected seeds, bye and rematch controls. Unset controls explicitly inherit main-cup policy; changed controls project only to the second draw policy. An impossible capacity, excessive protected seed count, or saved policy after removing the second-cup destination blocks review. Reset is an explicit revisioned command. The editor does not infer new qualifiers or certify draw placement.

D6 evidence: 46/46 focused checks and 667/667 full core/web regressions passed; TypeScript build, bundle and bundled DOM interaction passed. The browser bundle verifies interaction in DOM emulation only. Current full Phase D status remains **OPEN**: no organiser-approved exact P&K format/roster confirmation and no real-browser/mobile/accessibility inspection. The Site skill's managed preview requires an unavailable `control-browser` skill, and the static Site has no compatible supervised development server. A green unit suite or deployment cannot substitute for these observations. Next allowed work remains D acceptance, not E/F/G.

## D7 — interpretation clarity pass

The organiser-facing first view now places the proposed structure ahead of technical evidence. It shows a plain-language readiness explanation, counts of unresolved decisions/corrections, and a visible cue on the affected stage card. The source and roster remain separate; stage cards still edit through the same revisioned draft commands. Technical facts, hashes and transitions stay in the disclosure below. See [D_CLARITY_PASS](D_CLARITY_PASS.md).

Evidence: TypeScript build and bundled UI check passed. The UI check now asserts a decision cue on qualification, its removal after an explicit answer, and a visible blocked summary for an invalid bracket. The focused creator suite passed **46/46**. This is a presentation and interaction check, not a real-browser or organiser acceptance. Full D remains **OPEN** pending the exact P&K source/roster confirmation and desktop/mobile/keyboard/200%-text observations in [D_ORGANISER_REVIEW](D_ORGANISER_REVIEW.md). E/F/G remain gated.

## D8 — versioned supported rule catalog

The hardcoded question list is now a bounded catalog of supported draft nouns, fields, conditional applicability and requirement reasons. Each field projects a coverage state: source, organiser answer, missing, conflict, not applicable, optional unset or default. Coverage contains source fact IDs and references to independently enforced draft finding codes; the catalog itself does not validate the Definition. Named division labels from text/table sources now have fact provenance. Organiser answers are bound to both the source hash and catalog version.

The [six-case intent corpus](../scenario/creator-intent-corpus/cases.json) includes a missing cross-pool comparison, the same rule supplied in text, a top-per-pool path that needs no cross-pool comparison, a pure knockout that needs no pool tiebreak, an unknown bonus policy and conflicting durations. These cases prevent repeated or irrelevant questions in the supported grammar and preserve unknown material. The built UI exposes the rule-coverage ledger under evidence; its main view still shows only the actionable questions.

Evidence: TypeScript build, creator bundle, bundled DOM interaction, **60/60** focused creator checks and **681/681** full core/web regression tests on the final D8 source. Reproduction uses Node's TSX test runner at concurrency 2 and the pinned OR-Tools 9.15.6755 Python interpreter; logs are `scenario/verification/phase-d-rule-catalog-focused.txt` and `phase-d-rule-catalog-regression.txt`. The Site-bound bundle passed the same DOM interaction check. This catalog is not a general language model or exhaustive sport ontology. It does not pass the pending organiser or real-browser Phase D acceptance, and E/F/G remain gated. See [D_RULE_CATALOG_SLICE](D_RULE_CATALOG_SLICE.md).
