# C — source to proposed definition

- JOB: Turn imperfect organiser material into explicit editable competition intent without inventing rules.
- INPUT: Natural-language text, JSON/YAML definition drafts, CSV/XLSX entrant tables; approved answers.
- OUTPUT: SourceFact[] with source hash/locator, partial proposed draft, OpenDecision[], Conflicts[], canonical TournamentDefinition only when complete.
- AUTHORITATIVE OWNER: Source adapters preserve facts; interpretation proposes; organiser answers resolve semantics; existing schema/core compile. No publication authority in the preview.
- INVARIANTS: Unrecognised content remains visible; conflicting values do not silently win; every answer is source-version bound; source edits invalidate prior answers; draft edits do not change locked or published truth; no tournament-name branches.
- TELEMETRY: source_parse_completed/failed, fact_extracted, open_decision_created/answered, interpretation_changed, definition_proposed, revision hashes.
- ACCEPTANCE SCENARIO: Simple knockout, pools-to-knockout and St Albans narrative expressed as generic division/pool/cup rules; missing runners-up comparison; conflicts; source replacement; JSON/YAML and entrant-table adapters.
- NON-GOALS: Unrestricted LLM understanding, PDFs/images/ZIP source adapters, new sport semantics, scheduling, runtime, production locking/publication.
- EXIT GATE: Supported inputs deterministically yield a coherent canonical definition or explicit unresolved findings; same generic translation serves all three scenarios; independent schema checks pass complete definitions. Then D visual editor.
