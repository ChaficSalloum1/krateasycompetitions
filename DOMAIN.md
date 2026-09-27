# Krateasy Competitions — canonical domain, state and rule contract

Status: ACTIVE. Normative transcription of the supplied domain contract into repository reference form; [source and precedence](docs/AUTHORITY_SOURCES.md). Domain semantics take precedence over product copy, UI and implementation. Differences require an explicit recorded architecture decision; code and tests describe behaviour, not permission to redefine the contract.

## 1. Design discipline

For every behaviour answer: JOB, TRUTH, ENTITIES, STATE, COMMANDS, AUTHORITY, INVARIANTS, EVENTS / OUTPUTS, FAILURES, TELEMETRY, PROOF. Begin with these, not tables or screens. [MODULE_CONTRACTS.md](MODULE_CONTRACTS.md) assigns owners and interfaces.

## 2–3. Truth and revision

| Truth | Authoritative owner | Contains | Excludes / mutation rule |
|---|---|---|---|
| Definition | CompetitionDefinition | Divisions, stages, rules, qualification, scoring/tiebreaks, bracket, duration/rest/resource policies | No results, actual times or arbitrary live state; approved design commands only |
| Plan | CompetitionPlan | Pool membership, fixtures, draw, court/time assignments, locks and published promises | Compiler/draw/scheduler proposals become approved plans; Reality cannot silently mutate them |
| Reality | CompetitionRuntime | Check-in, calls, actual start/end, results, incidents and corrections | Append-only facts; corrections retain previous facts |

Competition identity persists through the lifecycle. DefinitionRevision, PlanRevision, PublicationRevision and OperationalRevision are distinct immutable version identities in linked chains. Every meaningful authoritative change binds cause, actor/approval, exact rules and artefacts, validation evidence, changes and protected/unchanged scope. New rules never silently recalculate old confirmed history. Operational revisions change the future plan without overwriting the published plan or played truth.

## 4–5. Universes and resource commitment

| Universe | Entities / owned truth | Does not own |
|---|---|---|
| Platform | Workspace, Organisation, Membership, UserIdentity, RoleGrant, IntegrationConnection, PlatformPolicy; identity, access, provider credentials | Competition outcomes, qualification, facility reality |
| Organiser | Competition, CompetitionAuthority, CompetitionRevision, EntryDecision, PublicationDecision; format, accepted entries, division and approvals/adjudication within policy | Facility resources outside commitment, unrelated facility data, global participant identity |
| Facility | Facility, Venue, Court, FacilityResource, ResourceCommitment, ResourceAvailability, FacilityIncident; physical availability/capacity/closure | Standings, qualification, draw, result adjudication |
| Participant | Participant, ParticipantIdentity, Team, Entry, Registration, PartnerRelationship, CheckInState; allowed personal/participation facts | Administration merely through participation |
| Public | PublicCompetitionProjection, PublicScheduleProjection, PublicStandingProjection, PublicDrawProjection | All authoritative writes |
| External provider | ExternalSource, ExternalRecord, ProviderReference, SourceProvenance | Competition truth before normalisation and validation |

ResourceCommitment explicitly binds a competition to facility-authorised resources, windows and restrictions. The facility owns availability; organiser owns intent; scheduler combines them; Guard checks assignments. Scheduling outside the commitment is invalid.

## 6. Core identities

Competition persists across design/run/completion. CompetitionRevision references exact definition, governed rule packs, outputs and approval evidence. Participant is a person/participant identity; Team groups participants; Entry is the admitted unit and can reference either. Division partitions entries. Stage is a structural progression component. Contest is the generic competition unit (Match is presentation), containing stage, participant sources, result semantics, dependencies and resource needs.

## 7–9. Source, interpretation, definition

Source intake owns Source, SourceVersion, SourceFact, Provenance and SourceConflict. ADD_SOURCE, REPLACE_SOURCE, REMOVE_SOURCE, REPROCESS_SOURCE preserve lineage. Every fact identifies its source; replacement cannot mutate approved Definition. Conflicts persist visibly. Failures: SOURCE_UNREADABLE, SOURCE_UNSUPPORTED, SOURCE_CONFLICT, EXTRACTION_INCOMPLETE.

Interpretation owns Interpretation, InterpretationClaim, OpenDecision, Assumption and InterpretationConflict. PROPOSE_INTERPRETATION, ANSWER_OPEN_DECISION, CORRECT_INTERPRETATION, REJECT_ASSUMPTION operate on SourceFact[] and produce ProposedDefinition, decisions, conflicts and provenance. AI/parsers propose, never directly authorise. Ambiguity, unsupported semantics and attributable assumptions remain explicit. Same facts plus explicit decisions produce the same canonical proposal under the same registered interpretation version. Failures: AMBIGUOUS, UNSUPPORTED, CONFLICTING_SOURCE_FACTS, INSUFFICIENT_INFORMATION.

Definition owns Division, Stage, Pool, ContestTemplate, QualificationPolicy, StandingPolicy, TiebreakPolicy, MatchFormat, SchedulingPolicy, ResourceRequirement and PlacementPolicy. Commands: ADD_DIVISION, ADD_STAGE, REMOVE_STAGE, CHANGE_POOL_STRUCTURE, CHANGE_QUALIFICATION, CHANGE_TIEBREAK, CHANGE_MATCH_FORMAT, CHANGE_DURATION, CHANGE_REST_POLICY, CHANGE_PLACEMENT_POLICY.

Lifecycle: DRAFT → NEEDS_DECISIONS → DEFINITION_READY → DEFINITION_VALIDATED → LOCKED. Structural mutation invalidates validation. Every active entry has valid scope; stages connect legally, destinations accept their complete inputs, dependencies are acyclic, qualification cardinality and semantics resolve, and no entries are orphaned. Definition excludes specific schedule assignments. Failures: DEFINITION_AMBIGUOUS, DEFINITION_INVALID, DEFINITION_UNSUPPORTED, CARDINALITY_MISMATCH, DEPENDENCY_CYCLE, ORPHAN_ENTRY.

## 10–14. Classification, qualification, seeding, topology and placement

These are separate observable stages; do not collapse them.

| Domain | Output and invariant | Legitimate failure |
|---|---|---|
| Standings | Versioned StandingTable/Row/Metric and TiebreakResolution from valid terminal results, each counted once; active policy order, reproducible registered randomness, historical rule binding | RESULT_SET_INCOMPLETE, TIE_UNRESOLVED, POLICY_UNSUPPORTED, INVALID_RESULT |
| Qualification | QualificationSnapshot: considered population, policy version, selected identities, reasons and standing evidence; eligible entries only, required cardinality, explicit cross-pool population; never change selection to improve draw | QUALIFICATION_INCOMPLETE, QUALIFICATION_CARDINALITY_MISMATCH, CROSS_POOL_COMPARISON_UNDEFINED, QUALIFICATION_POLICY_INVALID |
| Seed / tier | SeedAssignment over qualified identities; qualification identity and seed identity remain distinct and inspectable | Invalid seed input must block placement |
| Topology | Empty Bracket, rounds, slots, ByeSlot/PlayInSlot from count/format/policy; valid paths and terminal contests, correct byes/play-ins; no occupant selection | Structurally invalid topology cannot proceed |
| Placement | CandidateDraw, PlacementEvidence, UnavoidableConflict[]; every qualifier once, no others, correct byes, protected seeds | NO_VALID_PLACEMENT, UNAVOIDABLE_POLICY_CONFLICT, INVALID_SEED_INPUT |

Placement policy governs same-pool and previous-opponent R1 avoidance and same-source separation where mathematically possible; balance/path symmetry are preferences. Search exhaustion without a proof cannot establish unavoidable conflict. Pool results → classification → qualification → seed/tier → placement → validation → approval → lock remains explicit.

## 15. Scheduling

Inputs: contest graph/dependencies, commitments, durations, rest, hard locks, policies and preferences. ScheduleCandidate assigns contest, resource, planned start and duration. Hard constraints: availability, possible participant collisions, dependency order, hard rest, venue hours and fixed locks. Governed policy: preferred court, maximum waiting, finals arrangement. Optimisation: finish, idle/wait time and resource movement.

Every required contest appears once; no resource double booking or possible entrant collision; rest, dependencies and locks hold. Status: FEASIBLE, OPTIMAL, INFEASIBLE, UNKNOWN. OPTIMAL requires proof; INFEASIBLE requires proof within the stated problem. Failure to find a schedule is UNKNOWN. Failures include SOLVER_UNAVAILABLE and CANDIDATE_REJECTED_BY_ASSURANCE. Producer never solely verifies its answer.

## 16–19. Scenarios, assurance, Guard and publication

Scenario references base CompetitionRevision, proposed assumptions/mutations, derived result and comparison. CREATE_SCENARIO, CHANGE_SCENARIO_ASSUMPTION, COMPILE_SCENARIO, APPLY_SCENARIO_AS_PROPOSAL do not bypass ordinary proposed-revision validation. A scenario is not authoritative.

Run Assurance owns AssuranceRun, AssuranceFinding, EvidenceReference and Counterexample across definition, qualification, draw, schedule, runtime and completion. It independently re-derives critical facts; producer success flags are not proof. Finding classes: PASS, WARNING, APPROVAL_REQUIRED, BLOCK.

Tournament Guard protects LOCK_DEFINITION, PUBLISH_COMPETITION, APPLY_PRE_EVENT_REVISION, APPLY_OPERATIONAL_REPAIR and CLOSE_COMPETITION. It loads server-owned exact artefacts and fresh assurance; returns READY, WARNING, APPROVAL_REQUIRED, BLOCKED. Caller-supplied evidence is not authoritative; stale evidence cannot authorise new revisions; hashes/revisions bind exact inputs; blocked commands commit nothing; consequential operations are atomic. Definition-facing readiness in Phase E uses READY / NEEDS DECISION / BLOCKED; these are not solver statuses or assurance finding classes.

PublicationCertificate binds exact approved Definition and Plan into a Published Promise. PUBLISH_COMPETITION requires approved definition/plan, fresh Guard, authorised actor and current revision. DRAFT → READY_TO_PUBLISH → PUBLISHED. Any definition/plan change invalidates prior readiness; it does not rewrite an existing certificate.

## 20. Pre-event change

ADD_ENTRY, REMOVE_ENTRY, CHANGE_PARTNER, SWITCH_DIVISION, MOVE_POOL, CHANGE_RESOURCE_AVAILABILITY follow current revision + mutation → affected scope → candidates → disruption cost → assurance → Guard → human review → new revision. Unchanged scope stays unchanged unless required; all surviving entries remain accounted for; qualification/draw remain coherent; locks are never silently destroyed.

## 21–23. Runtime, recovery and evidence

Runtime entities: OperationalRevision, OperationalFact, ContestRuntimeState, Result, Correction, Incident. Competition: PRE_EVENT → CHECK_IN → LIVE → COMPLETE → ARCHIVED. Contest: PLANNED → CALLED → IN_PROGRESS → COMPLETED, with governed WALKOVER, VOID, RETIRED, ABANDONED outcomes. Commands: CHECK_IN, CALL_CONTEST, START_CONTEST, RECORD_RESULT, COMPLETE_CONTEST, CORRECT_RESULT. Stale versions and impossible transitions fail; duplicate commands are idempotent; corrections retain lineage; completed history is not deleted.

Recovery consumes incidents such as closure, withdrawal/no-show, overrun or result correction. RepairProposal binds base revision, trigger fact, affected future, proposed assignments, disruption score, assurance and explanation. Completed truth is immutable; in-progress truth strongly protected; moves outside affected future require explanation; proposals remain non-authoritative until approval. Deterministic/replayable repair never conflates planned, operational and actual states.

EventRecord references definitions, plans, publication, rules, results, corrections, qualification, draws, schedules, incidents, approvals and completion evidence. Replay under the same rule versions reproduces authoritative state.

## 24–25. Failure and mutation protocol

Taxonomy: interpretation AMBIGUOUS / UNSUPPORTED / CONFLICTING; domain INVALID; solver INFEASIBLE / UNKNOWN; version STALE; authority UNAUTHORIZED; integrity EVIDENCE_MISMATCH / FORGED_INPUT / REPLAY_DIVERGENCE. Preserve domain failures rather than generic 500; UI translates them into calm language without hiding counterexamples.

Every consequential command: (1) load authoritative state, (2) verify actor, (3) verify expected revision, (4) validate command, (5) simulate/derive consequences, (6) check invariants, (7) run required assurance/Guard, (8) commit atomically, (9) append audit event, (10) emit projections/outbox. State, audit and required outbox intent must share the atomic boundary; delivery occurs after commit. No half-applied change.

## 26–27. Module and behaviour admission

Every new module documents MODULE, JOB, INPUTS, OUTPUTS, OWNS, DOES NOT OWN, STATE, COMMANDS, INVARIANTS, FAILURE MODES, EVENTS, TELEMETRY, TESTS, ACCEPTANCE PROOF. Before implementation identify the user job, universe, entity, state, command, truth owner, invariants, event, legitimate failures and proving telemetry/tests. Unclear answers mean the design is not ready.
