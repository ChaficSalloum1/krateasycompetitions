# Krateasy implementation brief for AI agents

## Purpose

This is the canonical implementation handoff for Krateasy Competitions. It is
deliberately self-contained so that a human developer or coding agent can clone
the repository, read this file, and begin the next safe delivery slice without
access to a previous chat, a private review, or an uncommitted document tree.

Krateasy is a proof-carrying competition operating system. It must become easier
to use and visually excellent without weakening the authoritative tournament
model that already exists. Prefer a small connected change that makes one real
job work end to end over a broad collection of convincing but disconnected UI.

## How to start every task

1. Run `git status --short`, inspect the current branch, and preserve existing
   work that is not yours.
2. Run `git log -1 --oneline` and inspect open work before trusting the status
   recorded in this document.
3. Read the relevant source, tests, and governing repository document before
   editing.
4. State the user job, authoritative command or projection, invariants,
   explicit non-goals, and verification plan.
5. Implement the smallest vertical slice that can be independently reviewed.
6. Verify the focused behavior and the proportionate broader release gate.
7. Report local evidence as local evidence. Never describe it as hosted,
   production, field, accessibility, or pilot evidence unless it actually is.

## Product outcome

One ordinary organiser must be able to run this connected journey against one
persisted, authorized competition identity:

```text
source intake
→ review missing or conflicting facts
→ compile a candidate
→ independent Competition Guard review
→ approval by a distinct authorized actor
→ exact publication and activation
→ organiser, public, and participant projections
→ check-in, call, start, score, and finish
→ guarded no-show or court-outage repair
→ targeted participant update
→ close, export, restore, and clean-edition duplication
```

The interface renders revision-bound projections and submits typed facts or
commands. It is never a second source of tournament truth.

## Authority hierarchy

When sources disagree, use this order:

1. Executable schemas, invariants, authorization boundaries, replay behavior,
   and passing tests establish current behavior.
2. `docs/MASTER-PRODUCT-SPECIFICATION.md` establishes product intent and the
   documentation hierarchy.
3. `docs/requirements-traceability.md` records connectedness and evidence.
4. `docs/product-scope-and-surface-contract.md` defines product and surface
   boundaries.
5. `docs/competition-guard-publication.md` defines Guard, approval, and
   publication invariants.
6. `docs/live-change-workflow.md` defines live repair rules.
7. `docs/production-runbook.md` defines operational and deployment gates.
8. `apps/compiler-web/DESIGN.md` defines the current visual language.

If executable behavior and a governing document conflict, do not silently pick
one. Record the discrepancy and make the smallest corrective proposal.

## System map

| Area | Main locations | Responsibility |
|---|---|---|
| Canonical schema and revisions | `packages/tournament-schema/src/` | Typed input, canonical form, semantic diff, hashes, revision identity |
| Competition engine | `packages/competition-engine/src/` | Formats, graph, scheduling, standings, Guard, live state, events, solver adapters |
| HTTP and web composition | `apps/compiler-web/src/` | Server boundary, journey DTOs, commands, projections, rendered surfaces |
| Persistence and deployment | `deployment/`, `packages/competition-engine/src/postgres-event-store.ts` | Migrations, RLS, event log, outbox, production composition |
| Native client | `apps/apple-client/` | Projection consumer and command client; never independent competition truth |
| Verification | `packages/*/test/`, `apps/*/test/`, `apps/apple-client/Tests/` | Behavioral, hostile-input, replay, integration, and client evidence |

## Non-negotiable architecture rules

1. Clients, AI, importers, and solvers may propose. Server-side validation,
   authorization, Guard, and the event store decide authoritative truth.
2. A client never supplies the authoritative actor, compiled artifact,
   schedule, Guard report, certificate, repair plan, or final status.
3. Every mutation carries expected revision or version and idempotency. Stale,
   duplicate, forged, unauthorized, and cross-tenant requests fail without
   partial writes.
4. Results, corrections, voids, withdrawals, walkovers, and repairs append
   facts. They never rewrite played history.
5. Publication binds the exact approved definition, graph, schedule, governed
   rule packs, requirement coverage, Guard evidence, and acknowledgements.
6. Public and participant views contain only authorized, revision-bound data
   and never fall back to demo state.
7. Fixtures and rehearsals remain visibly isolated from persisted production
   identities.
8. An unavailable solver, provider, or dependency produces `UNKNOWN`,
   non-approvable, or unready state—not an invented success or infeasibility.
9. Accessibility, responsive behavior, empty/error/permission states, and
   operational fallback are functional requirements, not final polish.

## Evidence vocabulary

Use these terms precisely:

| Term | Meaning |
|---|---|
| Implemented | The code exists on the named branch or commit |
| Locally verified | A named command passed in one local environment |
| Hosted verified | A named CI run passed on the exact commit |
| Production-shaped | Real dependency classes were exercised with production-like configuration; this is not production evidence |
| Production ready | Every mandatory readiness dependency has current evidence and the runtime can truthfully route traffic |
| Pilot ready | Release, operational, accessibility, fallback, privacy, and restore gates have current evidence |

A green unit suite alone does not make a provider, deployment, workflow, UI, or
pilot production ready.

## Baseline to verify before implementation

At the time this brief was authored, `main` ended at `7285138`. A focused E0
branch existed separately with shared-clock, AJV runtime-dependency, hosted CI,
container-smoke, Swift, and real-PostgreSQL checks. A different experimental
branch contained unapproved Clerk, R2, and Resend integrations. Do not assume
either branch has since been merged; inspect the repository and open pull
requests first.

The baseline already contains substantial deterministic competition logic,
Guard/publication evidence, event replay, tenant boundaries, web surfaces, a
Swift client, and broad tests. The work below is consolidation and connected
delivery, not permission to replace the engine with browser state or prototype
logic.

## Ordered delivery plan

### E0 — Reproducible release foundation

Finish E0 before claiming that later product work is releasable. UI exploration
may happen separately, but it cannot be presented as integrated production work
until this gate closes.

#### E0.1 One composition-root clock

Scope:

- Trace time from `createCompilerServer` through `CompetitionJourney`, token
  issue/validation, projections, rate limiting, and live commands.
- Use one explicit clock for a composed server and journey.
- If an API accepts an injected journey and an additional clock, reject a
  conflicting combination or define one unambiguous owner. Do not merely claim
  the clocks agree.

Exit evidence:

- A fixed token is accepted immediately before its expiry.
- The same token is rejected at and after expiry.
- Injected and internally constructed journeys use the same clock as the server.
- The tests do not depend on the machine date.

#### E0.2 Runtime dependency ownership

Scope:

- Every package that imports a module at runtime declares that module in its
  runtime dependencies.
- In particular, the schema package importing AJV must own AJV.
- Exercise the dependency graph after production pruning.

Exit evidence:

- A clean install and `npm prune --omit=dev` retain AJV.
- A built production image reaches its intended fail-closed configuration error
  instead of `ERR_MODULE_NOT_FOUND`.

#### E0.3 Explicit CP-SAT production mode

Choose and document exactly one deployed answer:

- **Mode A:** package a pinned Python/OR-Tools worker or service, health-check
  it, and independently validate returned solutions; or
- **Mode B:** declare CP-SAT unavailable in that deployment and return an
  explicit non-approvable `UNKNOWN` capability state.

Installing OR-Tools only in CI is test infrastructure, not a production-mode
decision. Missing or version-drifted solver infrastructure must never become
`INFEASIBLE` or publishable.

Exit evidence:

- The selected mode is named in `docs/production-runbook.md`.
- Readiness/capability output exposes it.
- A container-level test covers the selected mode.

#### E0.4 Hosted release gate

Every pull request must run:

```text
npm ci
git diff --check against the merge base
npm audit --omit=dev
npm run check
npm run stress:protocols
npm run check:apple on a supported macOS runner
production image build and fail-closed smoke test
real PostgreSQL event-store and coordination verification
```

Pin Node, package manager, Python, OR-Tools, actions, service images, and runtime
base-image policy at the precision required by the approved supply-chain policy.
Attach useful machine-readable test or rehearsal evidence to the run.

#### E0.5 Repository policy decisions

- The owner chooses the licence; an agent must not infer one.
- Add the approved root licence and NOTICE when selected.
- Document supported Node, npm, Python, solver, Swift, database, and container
  versions plus the update policy.

E0 is complete only when E0.1–E0.5 are merged and the hosted gate passes on the
exact merge candidate.

### E1 and E2 — Build one authoritative product vertically

Do not complete a detached redesign and connect it later. Interleave shell work
with the golden journey so each visible surface consumes real projections and
submits real commands.

#### Slice 1: authoritative portfolio and shell

User job: understand what competitions exist, their truthful state, and the
next action.

Implement:

- One route and navigation model for portfolio, Studio, Run Control,
  publication/share, participant/public views, and close/export.
- Shared design tokens and reusable server-rendered components instead of
  copied page-level CSS.
- Stable labels for draft, blocked, certified, published, live, stale, closed,
  demo, and unavailable states.
- Persisted authorized records only on the default portfolio.

Done when:

- Empty, loading, failure, stale, and permission-denied states are visible and
  tested.
- No route silently reads a demo singleton or browser storage for truth.
- Keyboard and mobile browser tests cover the primary portfolio task.

#### Slice 2: source-backed creation and review

User job: create or import a competition and understand what is missing or in
conflict before compilation.

Implement:

- Quick setup and supported source imports through one normalization boundary.
- Original source, hash, provenance, disagreements, assumptions, and unsupported
  clauses remain reviewable.
- The UI submits source facts only; it cannot inject derived authority.

Done when valid, contradictory, oversized, hostile, duplicate, restart, and
cross-tenant cases are covered without partial drafts.

#### Slice 3: compile, Guard, approve, publish, activate

User job: understand whether a plan is safe, what blocks it, what will change,
and who must approve it.

Implement:

- Human-readable schedule/structure explanation with technical evidence behind
  progressive disclosure.
- Independent Guard findings bound to exact artifact hashes.
- Distinct compile and approval actors.
- Exact acknowledgements and revision-bound publication.

Done when forged artifacts, stale approvals, self-approval, mismatched hashes,
missing acknowledgements, duplicate commands, and restart replay fail safely.

#### Slice 4: connected live operation

User job: call participants, start and finish contests, enter results, understand
attention items, and keep public information current.

Implement:

- Stable fixture-side identities and typed live commands.
- Run Control, venue display, and participant next-action projections from the
  same published/live head.
- Accessible confirmation, failure, pending, offline, and recovery states.

Done when organizer, public, venue, and participant surfaces agree after every
accepted command and do not change after rejected commands.

#### Slice 5: guarded disruption and targeted update

User job: recover from a no-show, overrun, or court outage with the smallest
safe change.

Implement:

- Preview-only repair proposal with affected contests and recipients.
- Independent approval against the current operational head.
- Minimum-change publication, targeted delivery intent, and explicit fallback.

Done when stale, forged, unauthorized, cross-tenant, replayed, and post-restart
approvals fail without altering the live plan.

#### Slice 6: close, export, restore, duplicate

User job: finish the event, retain auditable history, prove recovery, and create
a clean later edition without copying live results.

Done when closure identity, export hashes, isolated restore, replay equivalence,
and clean-edition duplication are tested end to end.

### E3 — Safely adopt the strongest Gemini visual ideas

Gemini-KratComps is a visual and interaction reference, not an authority source.
Reimplement concepts on Krateasy projections and commands; do not copy its state
machine or domain logic.

Allowed concepts:

- A calm competition home emphasizing current state and next action.
- Tenant-authorized workspace switching.
- Read-only court timeline leading into guarded change proposal.
- Clear public event and participant next-action presentation.
- Accessible command palette using real routes and permissions.
- Tenant-scoped branding.
- Format-specific winner or progression presentation only when registered
  semantics derive it.

Forbidden imports:

- Browser-only authentication or authorization.
- `localStorage` as tournament truth.
- Client-side Guard, scheduling, standings, scoring, qualification, publication,
  closure, receipts, or random hashes.
- Hard-coded competition counts or fixture identities.
- Nonsemantic click targets, fixed-width desktop-only rails, or inaccessible
  overlays.

Visual acceptance for every changed route:

- No document overflow at 320px, 390px, 200% zoom, or 400% zoom.
- Complete keyboard operation, visible focus, semantic controls, and safe focus
  return from dialogs.
- Dialog name, role, modal behavior, focus trap, Escape handling, and background
  inertness.
- AA contrast for normal text, forced-colors support, reduced motion, and
  minimum 44px touch targets unless a documented dense desktop alternative is
  necessary.
- Screenshot or visual-regression coverage at representative desktop and mobile
  widths, plus functional assertions for truthful content and blocked states.

### E4 — Pilot and scale evidence

Before a real pilot, require:

- Hosted release evidence on the exact candidate.
- Tenant, authentication, participant-token, authorization, rate-limit, and
  replay validation.
- A named incident lead and practiced manual fallback.
- Backup, isolated restore, and authoritative replay equivalence.
- Observed organizer and participant task checks, including accessibility.
- An approved notification provider and fallback decision.
- A bounded scale claim backed by executed fixtures and recorded evidence.

Measure, without inventing values: time to publish, desk questions, repair time,
schedule movement, affected recipient count, participant next-action accuracy,
unauthorized acceptance (must be zero), and restore equivalence.

Push most speculative visual expansion and broad scale work until the connected
golden journey has pilot evidence. Fix field-blocking usability issues when they
are observed; do not pre-build every imagined dashboard.

## Recommended execution order

```text
E0.1 clock + E0.2 dependencies
→ E0.3 solver decision
→ E0.4 hosted gate + E0.5 approved repository policy
→ E1/E2 Slice 1 portfolio shell
→ E1/E2 Slices 2–3 create through publication
→ E1/E2 Slices 4–5 live operation and repair
→ E1/E2 Slice 6 close and recovery
→ E3 visual refinement on the connected surfaces
→ E4 pilot evidence and bounded scale expansion
```

## Verification matrix

| Change | Minimum evidence |
|---|---|
| Schema, engine, authorization, or tenant behavior | Focused valid/invalid tests and `npm run check` |
| HTTP command or projection | Valid, stale, forged, unauthorized, duplicate, cross-tenant, and restart/replay tests |
| Time-sensitive behavior | Explicit injected clock with before/at/after boundary cases |
| UI route | Functional browser test, keyboard path, mobile/zoom inspection, and empty/error/stale/permission states |
| Production dependency | Clean install, production prune or image build, import/start smoke, and fail-closed readiness |
| PostgreSQL behavior | Real PostgreSQL integration with tenant isolation and concurrency where relevant |
| Solver behavior | Pinned version, explicit capability status, independent validation, and missing/unhealthy behavior |
| Native projection or command | Focused Swift tests and `npm run check:apple` |
| Documentation claim | Link to current executable evidence and name its evidence level |

Never weaken a safety assertion, skip a required suite, fabricate a readiness
state, or add a demo fallback to obtain a green result.

## Provider and production boundary

Authentication, object storage, notification delivery, secret management, key
management, retention, and external writes require explicit owner decisions.
Before integrating a provider, document:

- approved provider and account boundary;
- tenant-to-provider identity mapping;
- current token/claim contract and authorized parties;
- data classification, residency, retention, and deletion behavior;
- idempotency and replay guarantees;
- readiness probe and outage/fallback behavior;
- secret and key ownership/rotation;
- test, sandbox, and production separation.

Do not equate an external organization identifier with an internal tenant ID
without an explicit mapping contract. Do not call a provider integration
functional when its production write, recipient, or readiness path is absent.

## Required delivery handoff

Every implementation handoff must contain:

```markdown
## Outcome

## Delivery slice and scope
- Slice and user job:
- Branch and commit:
- Changed files:
- Explicit non-goals:

## Boundary and invariants
- Authoritative command/projection:
- Tenant, identity, revision, and idempotency behavior:
- Failure and fallback behavior:

## Verification
- Focused checks:
- Broader checks:
- Hosted run:
- Browser/accessibility evidence:

## Remaining risks or owner decisions
```

## Stop and request direction when

- A decision changes sport rules, fairness, approval separation, privacy,
  retention, licensing, pricing, or a public product claim.
- Production credentials, provider contracts, external writes, or migration
  approval are required.
- Existing work overlaps the necessary files and cannot be preserved safely.
- Executable behavior contradicts governing documentation.
- A tenant or external-provider identity mapping is unspecified.
- The smallest safe vertical slice cannot be identified.

## Final instruction

Make one truthful user job work against one authoritative competition identity.
Keep domain truth on the server, make uncertainty visible, verify the hostile
paths, and improve the interface only on top of real projections and commands.
