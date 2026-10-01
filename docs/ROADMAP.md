# Roadmap after the pilot

`CURRENT_STATUS.md` covers the seven slices that finish the controlled, dependable product loop: a production-capable tournament operating system for its defined pilot envelope. This file covers what comes after it: turning that loop into the broadly capable competition compiler platform in `MASTER-PRODUCT-SPECIFICATION.md`.

## What the slices must leave solid

Authenticated organiser → sources and facts → canonical definition → deterministic compiler → structure and schedule → independent Guard → approved immutable publication → live runtime → guarded repairs and participant updates → verified close, restore and duplication.

1. **Production spine.**
   - Users, organisations, roles and tenant isolation.
   - Authoritative PostgreSQL persistence with restart, replay, backup and restore.
   - Separate compiler, approver and operational actors.
   - Immutable revisions and evidence, and production-safe routes.
   - A hosted browser journey with no seeded or browser-owned truth.
2. **A bounded compiler.**
   - Round robin, single elimination, pools into a knockout, and pilot multi-stage compositions.
   - Automatic and organiser pool placement.
   - Explicit qualification, seeding, tiebreak and withdrawal policies.
   - Court windows, durations and protected assignments.
   - Deterministic refusal when an event cannot fit.
   - Every format compiles to the same canonical model.
3. **Independent assurance.** The Guard verifies:
   - fixture coverage and entrant eligibility;
   - progression closure and possible-qualifier collisions;
   - rest and resources, and protected courts and times;
   - publication identity and live changes;
   - result completeness and restore equivalence.
   A corrupted plan never becomes publishable because the compiler produced it.
4. **A usable organiser product.**
   - Create or import an event, then resolve missing facts and conflicts.
   - Shape pools and scheduling rules, and see the structure.
   - Preview consequences, then compile, approve and publish.
   - Run the event, repair disruptions and communicate changes.
   - Close, restore and repeat.
5. **A credible pilot release.** Evidence for:
   - mobile and assistive-technology use;
   - weak networks and the delivery provider;
   - paper fallback and staff restore;
   - venue safety and incident ownership;
   - support.

## Programmes after the pilot, in order

Order matters most here: no ingestion interface or format catalogue is built on an unstable internal model.

1. **Canonical Competition IR v1.**
   - Freeze and version the blueprint and IR.
   - Migrate the remaining historical creation representations.
   - Deterministic IR migrations.
   - Explicit extension points for stages, scoring, qualification and resources.
   - Machine-readable schemas, and semantic invariants documented independently of the web app.
   - Old publications preserved across compiler upgrades.
   - *Exit:* every client, importer, format pack and runtime uses one versioned model.
2. **Industrial-strength Guard.**
   - Extract the Guard as a first-class package, with pure validators for every persisted authority object.
   - Property, mutation and corruption testing on every artifact layer.
   - Exhaustive result permutations for bounded formats.
   - Model checking of the revision and approval state machines.
   - Differential compiler-versus-Guard testing.
   - Frozen, human-reviewed reference competitions.
   - Performance and denial-of-service limits, and versioned rules.
   - *Standard:* a format is not supported until the Guard can reconstruct and challenge it.
3. **Governed format and policy packs.**
   - A registered pack system, not more format-specific branches.
   - Each pack defines its schema, topology compiler, standings, qualification, draw and seeding, Guard reconstruction, explanation templates, and reference and corruption fixtures.
   - Targets: Swiss; double elimination with reset finals; repechage; consolation and placement brackets; ladders; group-to-multiple-bracket qualification; best-N and cross-pool ranking; multi-division shared resources; conditional paths; multi-day sessions; rematch restrictions.
4. **Universal ingestion.**
   - Sources: PDF, ZIP, screenshots and scans, messy multi-sheet spreadsheets, notes, emails and pasted regulations.
   - Every source becomes claims with provenance and citations, then explicit ambiguity and conflict analysis, then proposed facts, then reversible human confirmation.
   - Tested against a corpus of real organiser inputs, inside sandboxing, size limits and hostile-file testing.
   - AI interprets and explains; it never publishes truth.
5. **Scenario Lab and advanced scheduling.**
   - Compare court counts, start times and durations.
   - Multi-objective optimisation.
   - Finish and waiting distributions, fairness and recovery metrics, and bottleneck explanations.
   - Resilience to overruns.
   - "Why this plan?", and exact before-and-after consequences.
   - Guarded application of one chosen scenario.
   - Server-derived only; never a second client-owned schedule.
6. **Platform ecosystem and scale.**
   - Integrations: registration providers, participant and venue directories, privacy-aware contacts, payments and eligibility, webhook ingestion with replay protection, provider-neutral notifications.
   - Organisation features: branding, format and venue libraries, governed import and export APIs, audit and dispute tools.
   - Scale only as usage requires: concurrent organisations, background compile workers, partitioning and retention, idempotent multi-instance delivery, dashboards and alerting.
7. **Earned claims: the Tournament Torture Corpus.**
   - Start with 25 genuinely different real competitions and grow toward 50–100.
   - Keep the original sources, with expert-confirmed expected structures.
   - Run each one through ingestion, compilation, Guard, simulation and close.
   - Classify every failure by layer: ingestion, model, format, scheduler, Guard or presentation.
   - A sport or format is claimed only with reproducible evidence.

## Definition of done for the platform

An organiser gives messy real-world material. Krateasy then:
- identifies what is known, conflicting and missing;
- builds a versioned canonical definition;
- generates and compares safe alternatives;
- independently proves the chosen structure and schedule;
- publishes one immutable approved revision;
- operates and repairs the event without losing history;
- keeps every participant accurately informed;
- closes, restores and reproduces the competition;
- explains every consequential decision;
- backs each marketed format with real evidence.
