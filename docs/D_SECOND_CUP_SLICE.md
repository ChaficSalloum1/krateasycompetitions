# D6 — independent second-cup bracket controls

JOB: Make each cup's bracket and placement policy individually inspectable and editable in the visual creator.
INPUT: A division with a second-cup destination, qualifier/remainder counts, and explicit organiser decisions.
OUTPUT: Distinct second-cup bracket size, seed protection, bye and rematch policy in the proposed Definition and graph; main-cup policy remains independent.
AUTHORITATIVE OWNER: Definition owns bracket and placement policy. The editor stores local draft decisions against expected revision; compiler translates them; Plan placement is not approved by this UI.
STATE / COMMANDS: ANSWER sets supported second-cup fields; CLEAR_SECONDARY_BRACKET restores inherited source policy. Both create new draft revisions, invalidate REVIEWED and preserve idempotent replay/undo. Eliminating a second-cup destination while overrides remain blocks until explicitly cleared.
INVARIANTS: No qualifier is created to fit slots. Second cup receives exactly the remainder; any explicit capacity must be the smallest power-of-two topology that fits. Seed count must be supported; hard byes and seed separation remain. Distinct rematch policy must reach the second draw policy. Stale or orphan decisions cannot silently authorise review.
FAILURES: CARDINALITY_MISMATCH, INVALID_BRACKET, UNSUPPORTED, ORPHAN_POLICY; rejected command remains atomic.
TELEMETRY: Revision transition, command receipt, before/after hash, visible field and counterexample.
ACCEPTANCE SCENARIO: Change Tower's seed count/rematch policy without changing Konnect, inspect both compiled draw policies; reject ten entrants in eight slots; remove the secondary destination and see blocked saved decisions, then clear explicitly. Undo/replay and bundled UI click each cup separately.
NON-GOALS: Draw generation/approval, schedule search, source-language parsing of tournament-specific names, production Guard, E/F/G gates.
EXIT GATE: Adverse model, command and bundled UI checks pass; affected regression stays green. Full D still needs the organiser-approved event semantics and real-browser/mobile/accessibility acceptance.

Gate evidence: 46/46 focused creator checks and 667/667 full core/web regression checks passed, including distinct compiled draw policies, impossible second-cup capacity, excessive protected seeds, orphan overrides, reset, undo/replay and bundled DOM interaction. TypeScript and browser bundle builds passed. This bounded slice closes; the full D gate does not.
