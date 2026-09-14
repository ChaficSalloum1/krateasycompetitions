# TournamentOS niche-sport and stress-program delivery

Date: 2026-09-07

## Delivered in this pass

- Governed illustrative sport profiles and executable scoring policies for pickleball, badminton, squash, golf stroke play, golf Stableford, and golf match play.
- A generic capped win-by-margin unit rule, required for badminton's 29-all deciding point at 30 without weakening ordinary two-point margins.
- Rule-pack provenance, version, approval state, expiry, jurisdiction, compatible format primitives, and explicit semantic boundaries.
- A deterministic lifecycle fuzz campaign covering duplicate and stale commands, completion, withdrawals, walkovers, retirements, protests, appeals, court/equipment outages and recovery, score corrections, voids, event reordering, payload tampering, and authoritative replay.
- A stress-certification ledger containing all seven evidence lanes and all nine non-negotiable release gates.
- A delta-debugging reducer that shrinks any reproducible ordered failure to a smaller counterexample.
- A historical/live evidence intake gate that refuses to count synthetic fixtures as real historical reconstructions, live shadows, or pilots.
- A measured CP-SAT scale campaign at 128, 512, and 2,048 tasks across three tasks-per-resource ratios.

## Executed evidence

The complete TypeScript build passes. The full automated suite contains 398 tests and the final clean rerun passed all 398. One preceding run exposed an intermittent SQLite initialisation lock in the multi-process arbitration test; the immediate full rerun passed, so the flake remains a hardening target rather than being hidden.

Lifecycle fuzz execution:

- 120 seeded histories.
- 120 exact duplicate commands accepted as no-op idempotent replays.
- 120 stale commands rejected without mutation.
- 240 reordered or tampered histories rejected.
- 120 deterministic authoritative replay checks.
- 120 independently verified score → correction → void lineages.
- Five court and equipment failure/recovery cycles per history.

CP-SAT measured reference envelope on Apple Silicon, Node v26.0.0:

| Tasks | Resources | Tasks/resource | Status | Total latency | Process RSS | Objective gap |
|---:|---:|---:|---|---:|---:|---:|
| 128 | 16 | 8 | OPTIMAL, independently validated | 244.44 ms | 93.86 MB | 0 |
| 128 | 8 | 16 | OPTIMAL, independently validated | 239.24 ms | 93.91 MB | 0 |
| 128 | 4 | 32 | OPTIMAL, independently validated | 244.01 ms | 94.38 MB | 0 |
| 512 | 64 | 8 | OPTIMAL, independently validated | 282.26 ms | 94.86 MB | 0 |
| 512 | 32 | 16 | OPTIMAL, independently validated | 285.21 ms | 95.22 MB | 0 |
| 512 | 16 | 32 | OPTIMAL, independently validated | 308.81 ms | 95.42 MB | 0 |
| 2,048 | 256 | 8 | OPTIMAL, independently validated | 684.94 ms | 100.98 MB | 0 |
| 2,048 | 128 | 16 | OPTIMAL, independently validated | 714.01 ms | 120.83 MB | 0 |
| 2,048 | 64 | 32 | OPTIMAL, independently validated | 813.31 ms | 123.50 MB | 0 |

These are controlled precedence-chain fixtures with deterministic resource eligibility. They establish a measured reference envelope, not general capacity for arbitrary dense graphs. Timing and RSS remain outside proof hashes so deterministic replay is not corrupted by observational telemetry.

## Current truth by requested stress lane

| Lane | Current evidence | Status |
|---|---|---|
| Composition fuzzing | 420 bounded whole-spec cases, 1,222 metamorphic checks, one million seeded static trials, canonical coverage of all 16 primitives, new failure shrinker | Partial: not yet the full Cartesian multi-stage composition of every primitive and selector |
| Solver differential | Exact versus CP-SAT agreement on bounded small instances, safe `UNKNOWN`/`INFEASIBLE` distinction, independent schedule validation | Certified only inside named small-instance envelopes |
| Dynamic lifecycle fuzzing | New executable 120-history campaign plus existing event-store, live-operation, outbox, correction and replay tests | Certified inside the named campaign envelope |
| Scale envelopes | Nine new measured 128/512/2,048-task CP-SAT points | Partial: repair quality and dense/shared-participant graph profiles remain open |
| Infrastructure chaos | Lease expiry/recovery, duplicate delivery, retries, dead letters, event replay, backup-manifest and restore-integrity tests | Partial: real worker termination during writes, deployed DB failover and full restore drill remain open |
| Security/tenant red-team | Cross-tenant authorization, role escalation, malicious CSV/formula input, prompt/rulebook injection, signature replay, secret/PII redaction, payload bounds | Partial: deployed DAST, dependency/container scanning and independent penetration test remain open |
| Historical/live validation | Strict intake and anti-counterfeit gate implemented | Unknown: requires 50 sourced real reconstructions, about ten real live shadows, then controlled pilots with manual fallback |

The global certification therefore remains `UNKNOWN`, not `CERTIFIED`. This is intentional and correct: several requested lanes require broader automated generation or real operational evidence.

## Sport-model truth and boundaries

The compiler can reuse format primitives across sports while binding each contest to a versioned sport policy. That allows pickleball, badminton, and squash to use groups, round robin, knockout, double elimination, consolation, Swiss, or other compatible structures without conflating their scoring rules. Golf can use ranking-stage, qualifying, group, league, elimination, or custom-graph structures with stroke, Stableford, or match-play result semantics.

The newly added packs are illustrative implementation fixtures, not claims of federation certification. Before public production advertising, each target jurisdiction needs a reviewed and signed ruleset covering competition-specific variants. Important remaining examples include pickleball side-out versus rally scoring and doubles service rotation; badminton team ties and event order; squash lets/strokes and conduct decisions; and golf handicap, course rating/slope, countback, shotgun starts, foursomes/four-ball, team aggregation, cuts, and weather suspension.

## Release gates still open

1. Expand composition generation from canonical per-primitive proof to actual multi-stage Cartesian compositions spanning every primitive, selector, conditional edge, pool constraint, and result state.
2. Differentially solve every generated small scheduling instance with exhaustive, deterministic, and CP-SAT paths; preserve minimized counterexamples in a regression corpus.
3. Add dense-graph, scarce-resource, shared-participant, closure, lock, rest and repair profiles to the 128/512/2,048 scale campaign.
4. Run the chaos suite against a deployed non-production stack: hard-kill workers at transaction boundaries, duplicate webhooks, disconnect clients, fail over PostgreSQL, restore backups, then compare state and proof hashes.
5. Run security tooling against the deployed stack and independently review tenant isolation and operator privilege boundaries.
6. Source and reconstruct at least 50 real tournaments across racket, team league/cup, Swiss, combat/repechage, timed/heat and judged/ranked families.
7. Shadow approximately ten real events, then conduct controlled pilots with a rehearsed manual fallback and named rollback authority.

No “any sport, any format, any complexity” claim should be made until these gates close. The defensible edge today is a fail-closed, proof-carrying composition kernel with unusually explicit semantics and operational lineage—not mathematical infinity.
