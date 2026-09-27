# D4a — explicit resource windows and durations

JOB: Express different court opening/closing times, breaks and stage/round durations visually.
INPUT: Compilable definition, event envelope, committed court count and executable stage/round IDs.
OUTPUT: Resource availability and duration policies inside the same canonical definition/spec.
AUTHORITATIVE OWNER: Draft Definition owns requested scheduling policy; resource windows are a draft commitment projection, not facility confirmation or a scheduled assignment.
STATE/COMMANDS: SET_OPERATIONS, CLEAR_OPERATIONS through revision-safe commands. Success clears review; malformed/invalid candidates reject atomically. Later incompatible definition edits keep overrides visible and block review until corrected/cleared/undone.
INVARIANTS: Exactly the declared number of individually identified courts; unique stable IDs; ordered non-overlapping positive windows within event bounds; explicit offset times; valid positive durations; known stage/round references; no silent reset on source edit; no resource booked by this editor.
TELEMETRY: revision transition and complete hash-bound input export.
ACCEPTANCE: Court 1 opens later and pauses for a break; semifinal has different duration; invalid windows, count drift, nonexistent rounds reject/block; undo/replay recover exactly; UI edits canonical outputs.
NON-GOALS: Schedule generation/optimisation, resource reservations, facility authorisation, publication, auth, runtime or Phase F.
EXIT GATE: Model plus bundled UI tests pass before D4b plan locks starts.

GATE PASSED: 27 creator/model tests; TypeScript and bundle builds; bundled UI edits later court opening and a 45-minute duration, then undoes both. See phase-d-operations.txt, phase-d-operations-regression.txt and creator-ui.txt. Revision-local derived evaluation is cached and detached on read to avoid repeated compilation without weakening snapshot isolation. Next: D4b start locks.
