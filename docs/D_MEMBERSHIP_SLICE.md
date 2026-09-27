# D1 — roster-bound membership editing

JOB: Inspect actual pool membership, swap two entries and protect together/separate membership rules without editing JSON.
INPUT: A compilable draft and its exact roster, pool sizes and existing core allocation.
OUTPUT: Definition-owned membership constraints, separately identified draft Plan assignments, and the rebuilt graph.
AUTHORITATIVE OWNER: Definition owns membership policy; draft Plan owns entrant→pool assignment; core allocation validates coverage, sizes and constraints. Browser remains non-authoritative.
STATE/COMMANDS: SET_MEMBERSHIP accepts a complete candidate for one stage; CLEAR_MEMBERSHIP explicitly removes the draft override. Both use the existing revision/idempotency/undo boundary and invalidate review. Changed roster or pool structure makes saved assignment STALE/BLOCKED until explicitly cleared or restored; it is never silently reinterpreted.
INVARIANTS: IDs/member identities preserved; one entry once; exact pool sizes; no cross-division assignments; together/separate rules hold; assignments bind roster and pool shape; no hidden solver or automatic reshuffle.
TELEMETRY: command transition plus before/after hashes; typed rejection with no partial commit.
ACCEPTANCE: Swap named imported entries, protect separation, reject a violating swap and unknown/duplicate entries, invalidate on pool/roster change, undo and replay exactly. UI exposes the same command through pool cards.
NON-GOALS: Registration workflows, optimal pool search, scheduling, publication, runtime, new product layout.
EXIT GATE: Model/core tests and bundled UI swap/constraint flow pass before D4a begins.

GATE PASSED: 24 creator/model tests; existing pool allocator/construction regression; actual bundled UI swap, protected separation and undo flow. Named CSV identities/member IDs preserved. No real-browser claim. See phase-d-membership.txt, phase-d-pool-regression.txt and creator-ui.txt. Next allowed slice: D4a resource windows/durations.
