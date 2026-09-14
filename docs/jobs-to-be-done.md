# TournamentOS Jobs-to-be-Done Product Lens

## 1. Prove a proposed format is runnable

When I receive a tournament idea expressed in informal language, I want every
rule, assumption, and missing decision made visible, so I can approve a format
without discovering contradictions during the event.

Acceptance criteria:

1. Every meaningful source clause has a coverage status.
2. Critical defaults require traceable, approved provenance.
3. Type and cardinality errors appear before scheduling.
4. Unsupported constructs remain unresolved instead of being approximated.
5. The organiser can inspect simple, detailed, and technical rule views.
6. Certification states facts proved, never a confidence percentage.

## 2. Compare viable alternatives under real constraints

When venue capacity or event rules change, I want to compare the exact impact of
each option, so I can make a defensible tradeoff without corrupting the approved
plan.

Acceptance criteria:

1. Changes create a proposed immutable revision.
2. Semantic diff identifies every affected formal path.
3. Unaffected rules are explicitly preserved.
4. Each scenario uses the production competition and scheduling engine.
5. Feasibility, finish time, participation, and policy violations are compared.
6. No repair or scenario becomes active without approval.

## 3. Build a fair draw that can be defended

When qualifiers become known, I want earned protection and rematch preferences
applied deterministically, so I can explain the draw to participants.

Acceptance criteria:

1. Qualification, seeding, topology, placement, and scheduling remain separate.
2. Every qualifier carries standings and tiebreak evidence.
3. Byes are assigned according to declared protection priority.
4. Candidate placements and unavoidable conflicts are reported.
5. Random draws store algorithm, seed, input, and output.
6. Replaying the same inputs produces the same draw and proof hash.

## 4. Keep the event moving when reality changes

When a court closes, a player withdraws, or a match overruns, I want safe repair
options based on current truth, so I can recover quickly without creating illegal
participant paths.

Acceptance criteria:

1. Definition, approved plan, operational expectation, and actual results remain distinct.
2. Live commands pass through the invariant firewall.
3. Existing results are never silently overwritten.
4. Partial rescheduling respects completed matches and explicit locks.
5. Repairs show affected participants and downstream matches.
6. Every operational decision is replayable from the audit log.

## 5. Understand any consequential decision

When someone challenges a qualifier, court assignment, or start time, I want an
exact derivation and counterfactual explanation, so I can answer with evidence
rather than intuition.

Acceptance criteria:

1. Objects link to their source rule and version.
2. Qualification shows comparison set, values, and tie-resolution path.
3. Scheduling explains dependencies, rest, availability, and resource conflicts.
4. “Why not?” returns every blocking hard constraint and earliest legal time.
5. Failed requirements include a concrete counterexample path.
6. Proof objects are machine-readable and hash-verifiable.

## 6. Operate from the right device without changing truth

When I move between planning at a Mac, managing courts on an iPad, and responding
on an iPhone, I want each device to support the job appropriate to its context,
so I can stay effective without fragmented state.

Acceptance criteria:

1. All clients consume the same versioned API and certification objects.
2. Mac and iPad provide dense graph, table, timeline, and inspector workspaces.
3. iPhone prioritises check-in, next actions, score entry, alerts, and quick explanations.
4. Navigation adapts without hiding the current tournament or validation state.
5. Offline actions are queued, conflict-checked, and visibly reconciled.
6. Accessibility and keyboard operation are tested as release gates.

## 7. Reproduce and audit the tournament later

When a dispute or operational review happens after the event, I want to replay the
exact rules, random choices, schedule, and commands, so I can establish what the
system knew and why it acted.

Acceptance criteria:

1. Specs, rulesets, adapters, compiler, and solver versions are pinned.
2. Revisions and results are append-only and linked by hashes.
3. Random choices use stored seeds and algorithms.
4. Event replay reconstructs the same state and proof hashes.
5. Corrections remain separate from original facts.
6. Export contains a human report and machine certification bundle.

## 8. Extend the system without weakening safety

When a new sport or unusual format is requested, I want a registered deterministic
extension boundary, so the system can grow without executing arbitrary rules or
adding product-specific branches.

Acceptance criteria:

1. Capability is classified as native, composable, extension-required, or unsupported.
2. Extensions declare immutable identifiers, versions, inputs, and outputs.
3. No imported prose becomes executable code.
4. New metrics and transitions are pure and deterministic.
5. Conformance, property, replay, and mutation tests are mandatory.
6. Generic engine packages contain no event-name branches.
