# Autonomous frontier milestones delivery

Date: 2026-09-12

## Delivered

### Transactional publication outbox

Publication events now carry a server-authored delivery intent. The PostgreSQL
event store writes its outbox row in the same transaction as the source event.
The table is forced-RLS tenant scoped and supports deterministic lease claim,
acknowledgement, bounded exponential retry, expired-lease recovery and dead
lettering. The production verification script covers insertion, isolation, claim
and acknowledgement when run against PostgreSQL.

An isolated local PostgreSQL cluster was initialized after implementation. The
complete verification script returned `VERIFIED` for tenant isolation,
idempotency, optimistic concurrency, atomic rollback, replay, snapshots and the
transactional outbox. The temporary server was then stopped and its data removed.

### Unified live-change workflow

One proposal binds live operational truth, an outage or withdrawal command, an
independently validated minimal repair, affected contests and entrants, finish
impact and targeted notification drafts. A different authorised actor must
approve it against the unchanged live-state proof. Approval applies live state
and creates its communication outbox event atomically; rejection, stale evidence,
tampering and unproven repairs leave truth unchanged.

### Disruption-resilient schedule ranking

Valid solver candidates can now be compared by their worst single-resource loss,
overrun conflicts, communication blast radius, critical-chain slack and makespan.
Hard-invalid candidates are rejected before scoring and input order is
metamorphically invariant.

### Formal protocol assurance

An executable bounded model checker explores publication, idempotent command and
live-change approval models. The current run verifies 49 unique states and 133
enabled transitions with no invariant violation. A negative control returns the
shortest unsafe-publication counterexample. Equivalent TLA+ specifications and
TLC configurations are checked in for independent pipeline execution.

## Verification

- TypeScript build and complete monorepo suite: 414/414 tests passed.
- Executable protocol check: 49 states, 133 transitions, zero invariant violations.
- Isolated PostgreSQL verification: all event-store and transactional-outbox gates passed.
- Apple package regression: 14 XCTest cases and 5 Swift Testing cases passed.
- External TLC execution: not claimed because a pinned TLC tool artefact was not installed.

## Evidence boundary

The code and deterministic repository evidence are complete for these four
reference milestones. A managed-service PostgreSQL run, restore/PITR drill, external TLC
execution, historical reconstruction and live shadow events remain environment
evidence. They must be recorded before production claims are made.
