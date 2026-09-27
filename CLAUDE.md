# Coding-agent authority and handoff

Status: ACTIVE. Applies to any coding agent, not only Claude.

1. Read PRODUCT.md, DOMAIN.md, ARCHITECTURE.md and BUILD_PLAN.md, then the current slice's MODULE_CONTRACTS.md and TELEMETRY.md requirements.
2. The only requirement sources for this reset are the two user-supplied contracts recorded in docs/AUTHORITY_SOURCES.md. Do not import preferences/features from other chats, memories, prototypes or historical roadmaps. Existing repository code/tests and reference docs are evidence and implementation context only.
3. Inspect branch/status and preserve unrelated changes. Use the existing core. No second engine, browser kernel, cosmetic rewrite or shared-database bridge to P&K.
4. Current change set is Ticket 1 / A1, documentation only. Its review record is docs/A1_EXIT_GATE.md. Even if its gate passes, stop this ticket; next allowed ticket is A2 freeze verification then A3 audit harness. B requires full A exit evidence.
5. Before any implementation write JOB, INPUT, OUTPUT, AUTHORITATIVE OWNER, INVARIANTS, TELEMETRY, ACCEPTANCE SCENARIO, NON-GOALS, EXIT GATE. Use documented failures and exact truth/revision ownership.
6. Preserve Definition / Plan / Reality and OperationalRevision boundaries. Keep classification / qualification / seed / topology / placement / validation / approval / lock observable. Producers propose; independent assurance verifies; server-owned fresh Guard evidence protects atomic commands.
7. Never infer complete support or production readiness from schemas, old reports or passing unit tests. Prove exact supported inputs and adverse paths on a named revision/environment. Missing historical sources remain missing, never invented.
8. docs/DOCUMENT_REGISTRY.md classifies every pre-existing document. REFERENCE informs implementation without authorising scope; ARCHIVE preserves historical plans/reports without current authority. Inline older “canonical” labels are superseded by their status notices and this active set.
9. Record adjacent work in FUTURE.md unless it violates a hard invariant or blocks current acceptance. If exceptional work is necessary, record the exact invariant/blocker and minimal change; do not widen the slice.
10. Every PR: Phase, Slice, Entry condition, Exit condition, Evidence, Next allowed slice. Do not merge/cut over/deploy merely because tests passed. No production changes in A1.

**DO NOT PROCEED BEYOND THIS SLICE.** Determine whether adjacent work violates a hard invariant or blocks acceptance. If neither, record it in FUTURE.md and do not implement it.
