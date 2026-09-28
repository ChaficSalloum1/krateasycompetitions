# D9 — visible interpretation basis

JOB: Let an organiser distinguish stated rules, explicit decisions, defaults and unresolved material while reviewing the visual structure.
INPUT: The current revision's SourceFact[], RuleCoverage[], OpenDecision[], conflicts and unparsed clauses.
OUTPUT: A compact, visible interpretation-basis summary with direct access to the existing exact rule ledger.
AUTHORITATIVE OWNER: Interpretation owns provenance and open decisions. This UI projection owns no competition truth.
INVARIANTS: A displayed source count includes only mapped source-backed rules; an answer count includes only explicit current-revision answers; defaults are labelled as defaults; unresolved and conflicting clauses never appear as accepted rules. A source change invalidates answers through the existing aggregate. No new readiness or Guard claim follows from this display.
TELEMETRY: Existing source hash, catalog version, fact IDs and command transitions remain in the export. Opening the evidence ledger emits a local `structure_node_opened` interaction event.
ACCEPTANCE SCENARIO: A pools-to-cups example visibly distinguishes its source rules from the missing cross-pool policy; answering that policy moves its coverage to an organiser decision. Conflicting or unsupported text remains unresolved. The St Albans study remains labelled as a study.
NON-GOALS: New language interpretation, AI chat, general rule ontology, definition Guard, schedule compilation, organiser approval.
EXIT GATE: Built UI interaction check confirms source/answer/default/open counts and exact source lineage after answering and source replacement; focused regression and build pass. Full D remains open for organiser and real-browser/mobile/accessibility acceptance.
