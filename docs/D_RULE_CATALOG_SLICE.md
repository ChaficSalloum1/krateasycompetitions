# D8 — bounded rule catalog and question coverage

JOB: Ask only for rules required by the supported competition shape and explain each question using an explicit rule inventory.
INPUT: Source facts with provenance, explicit answers for the exact source hash, proposed draft shape and any conflicting/unrecognised claims.
OUTPUT: A versioned catalog of supported nouns/rules, a coverage record for each applicable field, and deduplicated OpenDecision[] with a reason and source/answer lineage.
AUTHORITATIVE OWNER: Interpretation owns proposed claims and open decisions. The catalog describes supported semantics and dependencies; CompetitionDefinition remains the rule authority, and the organiser decides ambiguities. Definition validation remains separate.
INVARIANTS: A stated fact is not asked for again if it maps to the same field. Unrecognised text does not become a rule or disappear silently. Conflicting claims require explicit resolution. Unused format-specific questions are not required. A changed source invalidates prior answers; coverage and question identity are bound to the catalog version and source hash. The catalog cannot imply that all tournament semantics are supported.
TELEMETRY: Export catalog version, coverage status and evidence fact IDs with the draft. Existing open-decision and rule-change events remain; do not create authoritative approval events.
ACCEPTANCE SCENARIO: An imperfect pools-to-cups description omits cross-pool comparison, so the catalog explains why it is needed. Adding an explicit comparison to the text removes that question. A top-per-pool format with no extra runners-up does not ask for an unused comparison. A knockout without pools does not ask for pool tiebreaks. Conflicts and unsupported clauses remain visible and block review.
NON-GOALS: General AI understanding, adding new sports/formats, changing qualification/draw/schedule algorithms, Phase E Guard, publication or production intake.
EXIT GATE: Focused coverage and regression tests pass with exact decision paths/provenance and no duplicate questions. Full D organiser and browser acceptance remains open; E is gated.
