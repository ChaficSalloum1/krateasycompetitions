# TournamentOS — Play & Konnect elite benchmark delivery

Date: 2026-09-07  
Source fixture: `PLAY_AND_KONNECT_TOURNAMENT_SPECIFICATION.md`

## Outcome

The attached Play & Konnect padel tournament is now a first-class acceptance
benchmark for the compiler. The canonical scenario compiles, schedules,
simulates, independently validates, and certifies without hidden placeholders or
cardinality drift.

| Benchmark fact | Certified value |
|---|---:|
| Padel pairs | 47 |
| Courts | 7 |
| Advanced pools | 4 / 4 / 3 |
| Intermediate pools | 4 / 4 / 3 / 3 / 3 |
| Beginner pools | 4 / 3 / 3 / 3 / 3 / 3 |
| Pool contests | 57 |
| Konnect contests | 9 |
| Tower contests | 32 |
| Total contests | 98 |
| Court-minutes | 3,080 |
| Opening | 12:00 Asia/Beirut |
| Target finish | 20:00 Asia/Beirut |
| Delivered earliest-finish candidate | 19:30 Asia/Beirut |
| Independently verified lower bound | 440 minutes |
| Candidate makespan | 450 minutes |
| Remaining optimality gap | 10 minutes |

The 19:30 schedule is `FEASIBLE`, not falsely labelled `OPTIMAL`. OR-Tools
CP-SAT found it within the bounded 30-second run, and the TypeScript shadow
validator independently reconstructed all 98 assignments, resource calendars,
durations, dependencies, and participant-path exclusions with zero findings.
The quality audit classifies zero minutes as genuinely avoidable idle under its
branch-release test. The Intermediate and Advanced headline finals occupy the
closing sequence, ending at 19:20 and 19:30 respectively.

## What changed

### Exact fixture repair

The stale reference fixture was corrected from 120 contests and late operation
to the source-backed 98-contest model. Pool sizes, qualification counts, court
window, 30/50/60-minute blocks, and the absence of mandatory player rest are now
executable requirements with acceptance tests. A formal soft policy identifies
the Advanced and Intermediate Konnect finals as the event climax.

### Qualification and seeding hardening

The Play & Konnect conformance adapter now proves:

- exact integer-rational MP-per-match, GD-per-match, and GW-per-match comparison,
  using cross multiplication rather than floating-point ordering;
- complete single round-robin inputs before cup seeding;
- match points, game difference, games won, two-team head-to-head, multi-team
  mini-league recalculation, and a pinned deterministic final tiebreak;
- three-pool wildcard behavior and more-than-four-pool winner selection;
- immutable K1–K4 identities and K1 v K4 / K2 v K3 semifinals;
- Tower order by achievement tier before normalized comparison;
- explicit audit of a forced same-pool Konnect semifinal instead of seed
  distortion;
- fail-closed handling for incomplete matches, unsafe numeric values, malformed
  pool ranks, and stale/tampered rule proofs.

This adapter is a governed illustrative Play & Konnect rule pack. It demonstrates
the universal policy seams; it is not represented as an official federation
rulebook.

### Scheduling intelligence

The deterministic primary scheduler now prioritizes downstream-critical work,
which moved the canonical complete schedule from failure to a certified 19:50
baseline. Its climax alignment then places both headline finals at the event end
without extending the makespan.

A separate production-scale seam compiles the same graph into a pinned CP-SAT
model. The 30-second candidate improves makespan to 19:30. A new schedule-quality
auditor separates:

- occupied, actual overrun, closed, dependency-blocked, genuinely free, and
  competition-complete court intervals;
- avoidable from unavoidable idle;
- division interleaving and longest division clumps;
- pool rotation and repeated pool adjacency;
- critical-path unlock delay;
- conservative possible-player wait and back-to-back exposure;
- headline-final climax distance.

The audit supports actual match overruns and identifies downstream disruption.
The repair planner accepts a solver candidate only after independent validation
and only when its pinned lexicographic quality vector improves.

## Two legitimate operating profiles

The generated CSV and JSON use the source requirement’s primary objective:
earliest finish.

| Profile | Finish | Conservative possible-path back-to-back exposure | Use when |
|---|---:|---:|---|
| CP-SAT earliest finish | 19:30 | 109 | Venue finish and programme compression dominate |
| Deterministic balanced baseline | 19:50 | 58 | Lower possible-path back-to-back exposure is preferred |

The exposure count is deliberately conservative: unresolved knockout contests
carry every entrant who could reach them, so it is not a claim that 109 known
teams literally play back-to-back. The source explicitly says there is no
mandatory rest. The remaining product opportunity is a true lexicographic
multi-objective solve that minimizes preferred-rest violations after fixing the
best makespan, rather than choosing between profiles after the fact.

## Verification ledger

Fresh gates executed for this delivery:

- TypeScript composite build: PASS
- TypeScript/web tests: 353/353 PASS
- Swift XCTest: 12/12 PASS
- Swift Testing: 5/5 PASS
- Failed, skipped, and cancelled tests: 0
- Play & Konnect scenario certification: CERTIFIED
- Play & Konnect CP-SAT schedule: FEASIBLE, independently valid
- Play & Konnect quality audit: CERTIFIED

The full TypeScript run includes the one-million-trial static campaign, the
16/16 primary capability conformance audit, the 420-case whole-spec grammar,
the 729-case Swiss outcome corpus, exhaustive small bracket properties, CP-SAT
differential tests, persistence races, tamper tests, and cross-sport governed
semantics.

### Delivery proof identities

| Proof | SHA-256 |
|---|---|
| Compiled specification | `4d469a1a39c313e64eede90094a90899fa55c9923865f8fa652f0aeded2a9058` |
| Competition graph | `0907e5aabfdaf8f3c8ee2a0cc338c4e5d78355692918ffdaf87627ca5d4b3d07` |
| CP-SAT schedule | `bdc3e2221f2ecbf059a4f21023399c81f058ac08827713422ae4df7c80d9d131` |
| Independent validation | `4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945` |
| Scenario certification | `2393a70ad703fea2681e2dd54608017dbe763ee7de490ee6792446aba02f0585` |
| Schedule-quality audit | `09fdb49626f18b7ad74b494286270c3f5028d3756c11bf8e91a9e70442a0412a` |
| CP-SAT adapter envelope | `f3e19c1f2991baacca9a969a30095cc49c5e3ae24ed0593e139262b15d0c246c` |
| Generated delivery artifact | `0bbbf0a7a2cd118d15993f822e6f5668348801e3d1e3e5484000424470523cde` |

## Product, Jobs-to-be-Done, and Apple pass

The organiser’s core job is now supported as one inspectable flow: express the
competition, see what the compiler understood, expose ambiguity, compare viable
plans, operate the schedule, explain why a match cannot move, repair disruption,
and publish only certified truth. The differentiator is not a long list of
format names; it is making difficult constraints visible, composable, testable,
and explainable.

The monorepo remains the correct product architecture. TypeScript owns tournament
truth and proof generation. Web and the SwiftUI iPhone/iPad/macOS client consume
versioned DTOs and do not fork competition logic. The Apple client’s 17 tests are
green and its existing interaction foundation covers explicit loading, empty,
failure, offline-command, reduced-motion, textual-status, and minimum-target-size
states. App Store completion still requires real production endpoints, signing,
privacy/support metadata, screenshots, reviewer access, physical-device runs,
VoiceOver evidence, account-deletion handling, and Sign in with Apple where the
chosen identity product triggers it.

## Plugin and connection assessment

No plugin should be placed inside the correctness kernel. Solver truth,
qualification, standings, scheduling, and certification must remain local,
versioned, replayable code.

Three optional integrations would materially improve the operating product:

1. **Codex Security** — an independent security pass over authentication,
   tenant boundaries, dependencies, and deployment configuration.
2. **Airtable** — controlled import/export for organiser rosters, courts,
   divisions, and check-in data during pilots.
3. **Google Calendar** — publish team, official, and court schedules after a
   certified operational revision.

Gmail can later support transactional notices, but it should follow a proper
outbox/idempotency integration rather than become source-of-truth infrastructure.
None of these plugins was installed or connected during this delivery.

## Honest capability boundary and next milestones

TournamentOS is now a strong proof-carrying universal tournament compiler inside
published envelopes. It is not mathematically honest to claim “any complexity”:
general scheduling and constrained draw problems are combinatorial, official
sport rules change, and finite tests cannot prove an unbounded input universe.

The next milestones, in order, are:

1. Add true lexicographic CP-SAT objectives: earliest finish, preferred rest,
   critical unlock, pool/division flow, then headline placement—each with
   independent objective reconstruction.
2. Add live disruption repair with freeze horizons, minimal-change penalties,
   withdrawals/no-shows, court failures, overruns, and notification diffs.
3. Expose the rich pool-construction constraints through TournamentSpec and the
   organiser Studio rather than only through the verified engine API.
4. Extend the bounded whole-spec generator across every native static and dynamic
   primitive, corrections, conditional branches, and schedule-quality mutations,
   with shrinking counterexamples.
5. Commission official, authority-approved rule packs for the first commercial
   sports and jurisdictions.
6. Complete the production environment: distributed persistence where needed,
   real identity, secrets, observability, load/chaos/recovery evidence, provider
   contracts, and Apple submission evidence.

No new series of prompts is required for internal engineering. External accounts,
official rule authorities, production deployment choices, and App Store submission
will require owner decisions and credentials when those milestones begin.
