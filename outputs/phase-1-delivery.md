# TournamentOS foundation delivery

Date: 2026-09-05

## Outcome

Phase 0 repository archaeology and the Phase 1 canonical Tournament IR safety
boundary are complete. The supplied workspace was empty, so this is a greenfield
foundation rather than a migration of an existing TournamentOS engine.

## Included

- npm/TypeScript workspace and pure `@tournament-os/tournament-schema` package
- strict Draft 2020-12 JSON Schema and matching TypeScript types
- canonical JSON serialization and SHA-256 content/replay hashes
- immutable compiled specifications with version-pinned metadata
- linked, immutable revisions using Plan -> Validate -> Apply
- precise semantic diffs using JSON Pointer paths
- deterministic tournament type checker
- explicit provenance for critical policies
- complete requirement-coverage ledger for the benchmark organiser prompt
- fail-closed deterministic randomisation policy
- Play & Konnect benchmark represented entirely as data
- compiler-style error codes and counterexample evidence

## Proven safeguards

The automated suite covers schema/fixture validity, canonical hash stability,
tamper detection, qualifier/topology mismatch, independent selector-cardinality
derivation, minimum-participation paths, unequal-pool normalization, critical-rule
provenance, lost requirements, randomisation pinning, loser-from-bye paths,
progression cycles, narrow semantic diffs, and immutable revision application.

## Honest boundary

This slice does not claim to solve or run tournaments. Competition graph
generation, standings calculation, qualification execution, bracket topology,
draw placement, scheduling, shadow validation, simulation, certification, and
natural-language interpretation remain gated later phases.

## Verification

Run `npm run check` from the workspace root. TypeScript compilation and all tests
must pass before this foundation is extended.

## Next gate

Phase 2 should implement typed contest nodes and progression edges plus an
independent match-cardinality derivation. It should certify DAGs for pools,
round-robin, arbitrary-size elimination, byes/play-ins, and multi-cup splits.
