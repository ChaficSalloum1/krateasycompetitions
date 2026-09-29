# D5 — Compose a format source with a roster source

JOB: Let an organiser describe the rules and import the entrants into the same inspectable draft.
INPUT: One supported format source, optional CSV/XLSX entrant source, exact revision and organiser commands.
OUTPUT: One proposed Definition and graph with source facts and entrant identities from separate provenances.
AUTHORITATIVE OWNER: Source intake owns both immutable source identities and provenance; Interpretation proposes mapping; Definition owns rules; the draft aggregate owns only local attachment/review state. No uploaded file or browser assertion becomes authority.
STATE / COMMANDS: ATTACH_ROSTER and REMOVE_ROSTER join CHANGE_SOURCE, ANSWER, UNDO and REVIEW. A valid but incompatible roster produces a BLOCKED draft until the organiser corrects the format, replaces the roster, removes it or undoes. Malformed/unsupported source is rejected atomically. Every successful command creates a revision and clears review.
INVARIANTS: Match imported division labels to the format's named divisions without inventing or silently moving entries. Every entry and member retains source identity, division and provenance; declared counts must equal attached rows. Source changes retain an attached roster for explicit reconciliation. Membership and contest locks remain stale/block when their identities change. No hidden substitution of anonymous entries. Idempotent command receipt, expected revision and exact replay remain intact.
FAILURES: SOURCE_UNSUPPORTED / SOURCE_UNREADABLE for import failure; ROSTER_DIVISION for unmapped/ambiguous division; ROSTER_ACCOUNTING for count disagreement; existing graph errors for duplicate identities.
TELEMETRY: Draft command transition and before/after hash, source hashes and locators for all imported rows, visible blocked findings.
ACCEPTANCE SCENARIO: Use the source-backed three-division St Albans planning format; attach its source-backed 48-pair roster as CSV; inspect each identity/pool and source locator, edit membership and operations, review, change source counts and see BLOCKED until reconciled. Deliberately import unknown division and malformed roster; assert no fabricated entrants or partial command. Undo, remove and replay exactly.
NON-GOALS: Claiming the historical candidate is an approved live event, full P&K rule parity, registration, production upload, publication, scheduling or G reconfiguration.
EXIT GATE: Focused adverse and integrated UI tests plus affected regression pass. Full D still requires organiser-confirmed P&K semantics and real-browser/mobile/accessibility acceptance. E remains gated.

The historical planning candidate is explicitly labelled as such. Its roster may be used as source-backed test data but does not supply unrecorded qualification, scoring or adjudication rules.

Gate evidence: 43/43 focused creator checks, 664/664 full core/web regressions, TypeScript build, browser bundle and DOM-emulated source/roster attachment/removal flow passed. The downloadable planning roster preserves pair names and division labels from the repository candidate; its entrant/person IDs are deterministic illustrative IDs, not approved participant identity. Full D organiser and real-browser acceptance remains open. Next bounded D control: independent second-cup editing.
