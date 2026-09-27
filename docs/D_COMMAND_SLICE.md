# D — revision-safe visual draft commands

JOB: Make live text interpretation and visual edits safe to review, undo and replay before extending membership and resource controls.
INPUT: Current source, source-bound answers, expected revision and a uniquely identified editor command.
OUTPUT: Either one complete new draft revision with an immutable transition record, or a typed rejection with no draft changes.
AUTHORITATIVE OWNER: CreatorSession owns local draft input and review state only. Interpretation owns proposed meaning; compiler owns derived structure. No Plan, Reality, publication or server Guard authority is created.

## State machine

Compilation projects NEEDS_DECISIONS, BLOCKED or READY_FOR_REVIEW. REVIEWED requires a successful REVIEW command against the exact current artifact hash. Every successful source edit, answer or undo invalidates review. Invalid competition designs remain editable BLOCKED drafts; invalid commands do not commit. REVIEW cannot transition from BLOCKED or NEEDS_DECISIONS. Undo creates a new revision; it never rewinds history.

## Commands and invariants

CHANGE_SOURCE, ANSWER, UNDO, REVIEW use {id, expectedRevision, command}. Duplicate identical envelopes return the original receipt without mutation, even after later revisions. Reusing an ID for different content fails FORGED_INPUT. Stale revisions fail STALE. Unknown answer paths, non-finite values and malformed source inputs fail INVALID. Empty undo fails NOTHING_TO_UNDO. Review requiring decisions or corrections fails VALIDATION_BLOCKED. Rejected commands leave inputs, history, revision, review and transition log unchanged. Successful commands are prepared and evaluated before committing. Read access returns detached snapshots. Every committed transition records before/after hashes, states and revision plus the command.

TELEMETRY: draft_command_committed; receipts contain typed rejection; existing interaction telemetry remains separate from the transition log.
ACCEPTANCE SCENARIO: Narrative → question → answer → review → edit → blocked → undo → review. Replay the committed command log from the initial source; obtain identical state and hashes. Inject stale, duplicate, malformed and conflicting-ID commands and verify atomicity.
NON-GOALS: Server authentication, distributed transactions, authoritative approval, persistence, pool allocation, court windows, locks or Phase E/F certification.
EXIT GATE: State-machine, adversarial and replay tests pass; bundled creator displays state and exports transition evidence. This closes a D integrity prerequisite, not the full Phase D gate.
NEXT: D membership and operational controls, then organiser/browser acceptance. Do not advance to E before full D passes.
