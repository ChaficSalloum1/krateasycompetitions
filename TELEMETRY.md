# Pipeline telemetry and evidence contract

Status: ACTIVE specification. A1 defines this contract; A3 instruments/maps it. No claim that new runtime telemetry was implemented in A1.

## Required boundary envelope

For each SOURCE, FACTS, DEFINITION, GRAPH, QUALIFICATION, DRAW, SCHEDULE and GUARD boundary record:

| Field | Meaning |
|---|---|
| run_id, scenario_id, competition_id | Correlate one run and competition without conflating fixtures with production |
| stage, boundary_id, parent_boundary_ids | Name producer/assurance scope and dependency lineage |
| implementation_version, rule_versions | Exact behaviour and rule identity |
| input, output | Immutable artefact references plus inspectable evidence; missing output is explicit, not fabricated |
| revision, input_hashes, output_hashes | Exact base/derived revision identities and canonical artefact hashes |
| status, failure | Success, blocked, skipped or failure; stable domain code, responsible layer, explanation and counterexample reference |
| telemetry | Start/end and elapsed duration, counts, solver/search status and bounds where applicable |

Classification, seed/tier, topology, draw validation, approval and lock are separate sub-boundaries. A missing earlier output leaves later boundaries explicitly blocked/skipped with cause. Guard records evaluated scope and exact artefact hashes. Failed runs remain inspectable. Telemetry cannot authorise an operation or contain provider secrets; raw source/participant details belong in authorised artefact storage, not general logs. Hash canonical domain data; timing/correlation metadata does not change domain identity.

## Domain event vocabulary to preserve

- Source: source_added, source_parse_started, source_parse_completed, source_parse_failed, fact_extracted, source_conflict_detected.
- Interpretation: interpretation_proposed, interpretation_corrected, open_decision_created, open_decision_answered, interpretation_reverted.
- Definition: definition_created, definition_changed, stage_added, pool_changed, qualification_changed, definition_validation_failed, definition_locked.
- Visual editor in D: structure_node_opened, rule_changed, qualification_changed, edit_reverted, validation_blocked.
- Qualification: qualification_started, qualification_computed, qualification_blocked.
- Placement: draw_search_started, draw_candidate_evaluated, draw_candidate_rejected, draw_conflict_unavoidable, draw_selected.
- Scheduling: schedule_started, schedule_candidate_found, schedule_feasible, schedule_optimal, schedule_infeasible, schedule_unknown.
- Shadow in I: shadow_standings_match, shadow_qualification_match, shadow_draw_difference, shadow_schedule_difference.

Map existing event names to this contract explicitly in the relevant slice; do not duplicate authoritative events merely to match presentation labels. Proposed generic A3 envelope events: boundary_started, boundary_completed, boundary_failed, boundary_blocked; Guard decision records include command, current revision, evidence identity, decision and no-commit/commit result. These names are implementation guidance, not an additional product milestone.

## Evidence versus telemetry

Evidence attaches scenario/source provenance, input/output artefacts, exact implementation/rule versions, independent findings, reproduction command, environment and outcome. Solver evidence records constraints/objective, search limits, incumbent and proof bounds. FEASIBLE is not OPTIMAL; search failure is not INFEASIBLE; missing observations are not PASS. A3 must demonstrate qualification/draw/schedule corruption localisation. B then establishes algorithmic properties and historical regression, not just trace presence.

A1's evidence is a documentation inventory, source-authority decision, link/scope checks and the four-question handoff. Runtime tests are not required for this documentation-only change and prior suite totals do not close A–N gates.
