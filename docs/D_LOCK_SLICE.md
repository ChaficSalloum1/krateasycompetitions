# D4b — protected draft plan start locks

JOB: Pin a specific compiled contest's start without confusing a draft lock with a published schedule.
INPUT: Exact current contest/ancestry, roster membership and qualification semantics; proposed offset timestamp.
OUTPUT: Plan-owned start lock bound to identity evidence, and a derived hard-start constraint for the later scheduler.
AUTHORITATIVE OWNER: Draft Plan owns the lock. Definition retains rules/resources; Reality is untouched. The schema scheduling constraint is only a compiler input projection of the plan lock.
STATE/COMMANDS: SET_START_LOCK and REMOVE_START_LOCK use expected revision/idempotency/undo. A changed identity/duration/resource policy cannot silently retarget the lock. Compatible rule edits retain it; incompatible edits block review until explicitly resolved.
INVARIANTS: Contest exists and is competitive; exact identity hash matches; complete offset time; full duration fits a committed court window and event bounds; dependency earliest-start bound holds; two locks cannot violate participant rest. No claim that unassigned contests can all be scheduled.
TELEMETRY: lock command and before/after revision hashes. Export keeps plan locks separate from source/definition policy.
ACCEPTANCE: Pin/unpin a contest, reject stale ID/hash and out-of-window time; changing participants or incompatible duration/resources blocks; undo/replay preserve exact locks. UI shows pinned times and explicit unlock.
NON-GOALS: Fixed court assignment, schedule search/optimisation, publication, server Guard, runtime or Phase F certification. Court pinning remains a future D adapter requirement if needed for organiser acceptance.
EXIT GATE: Focused adversarial and integrated UI checks pass; full D still awaits organiser/real-browser acceptance and any remaining documented controls.


GATE EVIDENCE: 33 focused creator/model tests pass across all three slices, including five lock scenarios. TypeScript and bundle builds pass. The actual bundled DOM flow exercises lock/unlock alongside membership swaps/rules, court windows, duration overrides, undo and review. Full D remains unclaimed. A malformed membership payload discovered during integration was rejected as a required invariant fix; no feature scope was added.
Broad regression: 652/652 pass; final focused run 33/33 including the late malformed-membership guard. See D_REVIEW_GATE for exact timing/scope. D4b bounded gate passes; next allowed work is remaining D fixed-court adapter/organiser/browser acceptance, not E.

Successor: D4c now implements optional court pins; the fixed-court non-goal above describes D4b only. Current status is D_REVIEW_GATE.md.
