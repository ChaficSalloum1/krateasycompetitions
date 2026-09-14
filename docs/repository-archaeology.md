# TournamentOS Repository Archaeology

Date: 2026-09-05

## Finding

This workspace contained no application source, package manifest, tests, database
schema, or existing TournamentOS engine. Only the two source briefs supplied by
the organiser were available outside the workspace.

## Reusable engines

None are present. In particular, there is no existing scheduler, standings
engine, qualification engine, Americano implementation, Scenario Lab, or live
event runtime to reuse.

## Product-specific branches and duplicate logic

None can be inspected because no prior implementation is present. The greenfield
implementation must keep Play & Konnect names and policies in fixtures and format
data; they must never become engine enums or `if` branches.

## Test inventory

No tests were present.

## Migration map

There is no source migration. The staged build starts with a pure,
dependency-light schema package and its certification boundary:

1. Define and validate the canonical Tournament IR.
2. Pin schema/compiler/ruleset/adapter versions and deterministic randomness.
3. Canonically serialise and hash compiled specifications.
4. Preserve immutable revisions through Plan -> Validate -> Apply.
5. Enforce provenance for critical rules and explicit requirement coverage.
6. Add tournament type checks before any graph or scheduling phase.
7. Represent Play & Konnect as data to prove the schema gate.

Later phases must add graph, standings, qualification, topology, draw, scheduling,
simulation, and AI packages behind this boundary. No UI or LLM integration should
precede those deterministic engines.

## Phase 0 gate

PASS: archaeology is complete for the supplied workspace. The absence of an
existing codebase is explicit, so Phase 1 may proceed as a greenfield foundation.
