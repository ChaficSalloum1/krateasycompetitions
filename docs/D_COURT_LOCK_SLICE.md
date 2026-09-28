# D4c — protected draft court locks

JOB: Let an organiser pin a contest to one committed court and start time without weakening existing draft protections.
INPUT: Current contest identity, explicit resource-unit identity and offset start time.
OUTPUT: Plan-owned lock; canonical hard start and court constraints; visible editable/exportable draft evidence.
AUTHORITATIVE OWNER: Draft Plan owns assignment choices. Definition owns resource windows. Existing scheduler and independent schedule validation consume constraints. No authority over Reality.
STATE / COMMANDS: Existing SET_START_LOCK, REMOVE_START_LOCK, UNDO and REVIEW use expected revision, idempotency, atomic rejection and replay. Optional resourceUnitId preserves time-only locks.
INVARIANTS: Exact contest identity; existing court unit; full duration inside that court's window; no overlapping pinned contests on one unit; existing dependency/rest/capacity checks retained. Invalid resource or stale lock blocks, never silently unpins. Constraint consumers must enforce or reject court locks.
TELEMETRY: Existing command receipts, revision transitions and before/after hashes include the court choice.
ACCEPTANCE SCENARIO: Pin/unpin, reject unknown/closed/double-booked court, retain locks on incompatible edits, undo/replay, export exact constraints; core scheduling honours the pin and independent validation rejects a tampered assignment. Normalized schedule-model adapter preserves court locks or rejects malformed inputs.
NON-GOALS: Schedule UI, automatic repairs, publication, production authority, E/F/G gate completion. Necessary lock consistency is not full schedule feasibility.
EXIT GATE: Focused adverse tests, build, bundled interaction test and affected core regressions pass. Full D still requires complete P&K organiser acceptance and real-browser/mobile/accessibility evidence.

Implementation uses `locked_match_resource`, HARD string unit id, constraint id `courtlock.<contestId>`, paired with `lock.<contestId>` start. This is an explicit projection of an existing Plan assignment concept, not a new engine or rule primitive. Resource units retain the existing `<resource.id>.<unit-number>` identity convention.

## D4c verification — 2026-09-28

- `npm run build`, `npm run creator:build`, and `npm run creator:check-ui`: passed. The actual Site-bound bundle also passed `node scripts/check-creator-ui.mjs /workspace/sites/krateasy-core-evidence/dist`.
- `node --import tsx --test apps/compiler-web/test/creator-*.test.ts packages/competition-engine/test/schedule-model.test.ts`: **47/47**, zero failures (`scenario/verification/phase-d-court-locks.txt`).
- `TOURNAMENT_OS_CP_SAT_PYTHON=/workspace/scratch/b4b1b247a24a/core-solver-env/bin/python node --import tsx --test --test-concurrency=2 packages/*/test/*.test.ts apps/*/test/*.test.ts`: **658/658**, zero failures, 95.5 seconds (`phase-d-court-regression.txt`). Node 24.19.0; Python 3.12.14; OR-Tools 9.15.6755.
- Earlier environment-failure run retained in `phase-d-court-runtime-missing.txt`: 631/656 passed, 25 failed because the restored virtual environment lacked its `bin/python3` executable. Recreated the interpreter using `python3 -m venv --upgrade`; verified the pinned OR-Tools import; reran the complete suite. Two additional focused regression cases were added before that final broad run. No solver expectations were weakened.

D4c bounded gate passes. This is draft/editor/adapter evidence, not full D organiser acceptance, schedule feasibility for every input, production authority, or E/F/G completion.
