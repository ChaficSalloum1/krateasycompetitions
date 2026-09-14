# TournamentOS autonomous engineering chain — steps 1–7

Date: 2026-09-07  
Scope: production-shaped vertical slices derived from the original Universal
Tournament Compiler specification, safeguards addendum, Play & Konnect padel
benchmark, engineering backlog, JTBD review, and Apple product/preflight lens.

## Executive result

All seven roadmap steps now have an executable, tested vertical slice in the
monorepo. The work materially advances TournamentOS from a proof-carrying compiler
kernel to an operational product foundation: strict import, certified compilation,
live event truth, exact minimal-change disruption repair, real PostgreSQL storage,
versioned web/Apple read contracts, an organiser control room, a participant view,
and deterministic export.

This is not an honest basis for claiming “any sport, any format, any complexity.”
The defensible claim is stronger and more useful: every advertised primitive is
evidence-backed inside a published finite envelope, unsupported semantics fail
closed, and difficult combinations are exercised by exhaustive, generative,
metamorphic, mutation, differential, replay, and cross-sport tests.

## Step 1 — import to audit: delivered vertical slice

Delivered:

- strict entrant CSV ingestion with quoted-field support, roster mapping, seeds,
  duplicate detection, formula-injection rejection, canonical hashing, and
  all-or-nothing failure;
- existing typed IR -> graph -> schedule -> simulation -> certification pipeline;
- deterministic scenario comparison and explicit approval blockers;
- signed, versioned, idempotent publication with external identity mapping;
- immutable result correction and replayable audit lineage;
- deterministic UTC iCalendar schedule export bound to certified schedule truth;
- versioned portfolio, blueprint, schedule, operations, findings, and
  certification read DTOs.

Key implementation:

- `packages/competition-engine/src/interoperability.ts`
- `packages/competition-engine/test/interoperability.test.ts`
- `apps/compiler-web/src/server.ts`
- `apps/compiler-web/test/studio.test.ts`

Still external or intentionally deferred: XLSX mapping UI, operator write API,
generated SDK publication, real provider credentials, payment/registration
systems, and managed deployment.

## Step 2 — live disruption and minimal-change repair: delivered

Delivered live truth:

- check-in, late arrival, no-show, withdrawal, retirement, walkover;
- actual start/end, result receipt, court closure, official absence, equipment
  failure, protest, appeal, restoration, and linked immutable correction;
- optimistic concurrency, content-bound idempotency, tamper-evident event hashes,
  replay verification, and deterministic now/next/late/blocked/unreported views.

Delivered repair:

- freeze horizons, exact pins, and original-lock preservation;
- exact deterministic lexicographic minimisation of moved contests, affected
  participants, time displacement, resource changes, makespan, waits, and idle;
- before/after diff, affected-person evidence, why-not reasons, and independently
  reconstructed objectives;
- fail-closed `UNKNOWN` when minimality is not proven and explicit `INFEASIBLE`
  when pins/locks contradict the disruption.

Key implementation:

- `packages/competition-engine/src/live-operations.ts`
- `packages/competition-engine/test/live-operations.test.ts`
- `packages/competition-engine/src/schedule-repair.ts`
- `packages/competition-engine/test/schedule-repair.test.ts`

Still remaining: integrate repair commands with the durable service/outbox and
benchmark the standard 128-contest incident fixtures against the five-second and
notification-churn release targets.

## Step 3 — production data seam: delivered and database-verified

Delivered:

- a real `pg`-backed event-store adapter;
- explicit transactions and atomic multi-stream append;
- optimistic concurrency and content-bound command idempotency;
- authoritative event hash chains, replay, and disposable snapshots;
- tenant-bound sessions using `set_config` and forced PostgreSQL row-level security;
- versioned SQL migration and a real-database verification harness.

Verification was executed against an isolated local PostgreSQL 16.14 cluster and
returned:

```json
{"status":"VERIFIED","tenantIsolation":true,"idempotency":true,"optimisticConcurrency":true,"atomicRollback":true,"replay":true,"snapshots":true}
```

Key implementation:

- `packages/competition-engine/src/postgres-event-store.ts`
- `deployment/postgres/001_event_store.sql`
- `scripts/verify-postgres-event-store.ts`

Still external: choose/provision managed PostgreSQL, use distinct migration and
runtime roles, build the transactional outbox projection, configure KMS/identity,
run PITR restore and chaos drills, and attach measured SLO/RPO/RTO evidence.

## Step 4 — elite schedule quality and repair semantics: advanced

The existing scheduler already includes exact small-instance search, a pinned
OR-Tools CP-SAT scale adapter, independent hard-constraint validation, lower
bounds, gap reporting, mutation tests, and a 128-task/8-resource evidence envelope.
This pass adds an exact lexicographic disruption-repair solver whose priorities are
observable and independently reconstructed rather than hidden in a blended score.

The remaining engineering frontier is to move the complete lexicographic hierarchy
into the large CP-SAT path: preferred rest/thermal load, resilience slack,
participant/referee/venue flow, presentation quality, rolling-horizon warm starts,
multi-venue travel, setup/teardown, skills, curfews, and measured Pareto comparisons.

## Step 5 — organiser and participant product: delivered vertical slice

The web Studio is now a calm operational control room with seven explicit
workspaces:

1. Overview
2. Control room
3. Compiler
4. Competition
5. Schedule
6. Public view
7. Proofs

The control room separates operational truth from the approved plan. The public
view answers the participant’s core question: where, when, against whom, and what
changed. The visual system uses dense but readable operational hierarchy, textual
status, responsive layouts, reduced-motion behavior, visible focus, and 44-point
minimum controls.

Real-browser QA verified navigation and semantics at desktop and 390×844 mobile
viewport sizes. The page produced no console errors or warnings, and the live
workspace request returned HTTP 200.

Key implementation:

- `apps/compiler-web/DESIGN.md`
- `apps/compiler-web/src/ui.ts`
- `apps/compiler-web/src/server.ts`

Still remaining: authenticated mutations, score-entry workflow, repair approval,
notification delivery, low-connectivity PWA behavior, localisation, real user
research, and recorded WCAG 2.2 AA assistive-technology evidence.

## Step 6 — universality and conformance: evidence retained and extended

The gate now includes 375 TypeScript/web tests. Existing evidence includes:

- all 16 advertised stage primitives executed through primary certified paths;
- one million seeded static-format trials;
- whole-spec bounded exhaustive grammar;
- cross-sport fixtures for racket knockout/league, chess Swiss, football scoring,
  athletics/swimming heats and time trials, combat/repechage, motorsport, and
  judged/ranked performance;
- deterministic replay, exact-versus-CP-SAT differential checks, mutation traps,
  metamorphic invariants, topology properties for entrant counts 2–64, and a
  complete 729-outcome Swiss standings corpus.

The product advantage is not a long list of format labels. It is the combination
of composable primitives, fail-closed unknowns, independent proof, reproducible
revisions, and explicit operational repair when reality changes.

Still external/ongoing: federation-owned rule-pack approval, historical tournament
corpora, larger dynamic combination campaigns, lifecycle counterexample shrinking,
and publication of performance envelopes by hardware and solver version.

## Step 7 — integrations and Apple release seam: delivered vertical slice

Delivered:

- one versioned server read model for web and Apple clients;
- live-operations endpoint matching the Swift DTO exactly;
- a native SwiftUI operations screen and Today summary for
  now/next/late/blocked/unreported items;
- text-plus-symbol status, accessible labels, minimum target sizing, adaptive
  iPhone/iPad/Mac navigation, durable offline queue, and explicit conflict state;
- privacy manifest, macOS sandbox/network entitlement, and native app icon.

Apple gate: 19/19 Swift tests pass. Existing iOS Simulator and macOS build evidence
remains green. The current source-level preflight contains zero detected rejection
patterns.

Still external: final bundle/team identity, production API URL and auth, push
entitlements, privacy/support URLs, metadata/screenshots, reviewer account, account
deletion/Sign in with Apple decision, physical-device networking, and recorded
VoiceOver/Voice Control/Full Keyboard Access/Dynamic Type testing.

## Consolidated verification

| Gate | Result |
|---|---:|
| TypeScript build | Pass |
| TypeScript/web tests | 375/375 pass |
| Swift tests | 19/19 pass |
| PostgreSQL 16.14 integration harness | Verified: 6/6 properties |
| Browser desktop/mobile smoke and console | Pass; 0 errors, 0 warnings after correction |
| Production npm advisory audit | 0 vulnerabilities |

## What still needs the owner or an external environment

No further prompt decomposition is needed for continued engineering. These inputs
cannot be truthfully fabricated:

- chosen cloud/region, domain, managed PostgreSQL, KMS, observability, backup, and
  on-call accounts;
- identity provider and approved organisation/role model;
- Krateasy or other provider contracts, sandbox credentials, and mapping samples;
- federation/rule-authority owners and signed rule fixtures;
- privacy/retention/legal decisions and support contact;
- Apple Developer/App Store Connect access, signing identity, final bundle ID,
  production URLs, metadata, screenshots, and review credentials;
- pilot organisers, real historical data, and permission to conduct observed event
  and accessibility tests.

## Recommended next build order

1. Provision a non-production managed environment and connect Postgres plus identity.
2. Add the durable operator write API/outbox and make live commands/repair proposals
   round-trip through it.
3. Complete large-scale CP-SAT lexicographic repair and publish measured envelopes.
4. Run a real Play & Konnect rehearsal: import, publish, check-in, court failure,
   repair approval, score, correction, participant notification, audit, restore.
5. Convert rehearsal failures into permanent named fixtures before adding breadth.
6. Commission the first federation-approved padel rule pack.
7. Only then finish production push/auth and App Store submission evidence.

No optional plugin is required to continue the compiler core. A security-scanning
plugin becomes valuable at the deployment/CI boundary, while Airtable/Asana/
ClickUp/Trello are workflow choices rather than product dependencies. Provider
connectors should be installed only after a concrete operational system is chosen.

