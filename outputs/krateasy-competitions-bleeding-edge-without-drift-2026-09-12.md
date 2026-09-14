# Krateasy Competitions: bleeding-edge engineering without product drift

Date: 2026-09-12

## Executive verdict

The proposed Competition Guard is the right direction, but it should consolidate
existing proof and validation work rather than become another validator.

The repository already contains substantial Guard behaviour across schema
validation, the compiler critic, graph findings, independent schedule validation,
certification, immutable revisions, live-operation validation, minimal-change
repair proofs and integration publication checks. The missing architectural move
is to bind those capabilities into one deterministic publication decision for the
exact artefacts being released.

The product should be advanced in its internals and conservative in its promises:

> Any person, solver or AI may propose. The Competition Guard verifies. A human
> approves material trade-offs. Only a hash-bound publication certificate changes
> authoritative competition truth.

That is a defensible product advantage. “AI tournament generator” is not.

## What the attachment gets right

- The verifier must be independent of the scheduler that produced the plan.
- Nothing should mutate a live competition without a proposed revision.
- Hard impossibilities, operational risks, experience concerns and optimisation
  opportunities require different severities.
- Unknown future participants must be checked as possible paths, not ignored.
- Match and court-minute totals need expandable bottom-up evidence.
- Result corrections and live repairs need downstream impact analysis.
- Certification must state its envelope and exclusions instead of implying that
  the real world cannot surprise the system.
- The same findings should power tests, UI explanations, audit and integrations.

## The concrete gap in the current implementation

The current certification function gathers strong evidence, and the schedule has
an independent shadow validator. The organisation platform also provides
immutable revisions, approval separation and controlled lifecycle transitions.

However, the final `APPROVED -> PUBLISHED` lifecycle transition does not currently
require one immutable certificate binding the latest definition revision to its
exact graph, schedule, rule-pack versions, requirement coverage and Guard report.
This creates a seam where individually correct modules are not yet composed into
one enforceable publication invariant.

That is the first engineering priority.

## Architecture deepening opportunities

### 1. Deepen the Competition Guard module

**Files/modules involved:** certification, compiler critic, tournament-schema
validation, schedule validation, scheduling quality, analytics, topology and
participant-path validation.

**Problem:** callers currently need to know which validators to invoke and how to
combine their findings. This is a shallow interface spread across several call
sites, and omission is possible.

**Solution:** concentrate registered correctness rules, evidence normalisation,
severity policy and certificate preparation behind one Competition Guard module.
Keep specialised checks internal; preserve independent implementations where
differential evidence is valuable.

**Benefits:** greater locality for correctness policy, greater leverage for every
Krateasy surface, and one interface for tests, imports, manual edits, AI proposals,
repairs and publication.

### 2. Deepen the publication module

**Files/modules involved:** organisation platform lifecycle, certification,
export bundle, integration gateway and outbox.

**Problem:** approval, certification, publication, export and external delivery
are currently related but not one atomic operation. The system can express role
separation without yet proving that the exact approved artefacts are the exact
published artefacts.

**Solution:** concentrate plan, Guard evaluation, acknowledgement, approval,
atomic publication, durable outbox emission and rollback point creation in one
publication module.

**Benefits:** publication becomes a deep, auditable operation instead of a status
flag; concurrency and replay tests exercise the same interface used in production.

### 3. Deepen the live-change module

**Files/modules involved:** live operations, adjudication, tournament state,
schedule repair, notifications and organisation platform commands.

**Problem:** correct behaviour exists, but a tournament-day operator needs one
coherent proposal-to-impact workflow across scores, withdrawals, outages,
appeals, repairs and notifications.

**Solution:** concentrate downstream invalidation, freeze horizons, affected
people, proposed repair, notification impact and approval state behind one
live-change module, with the Competition Guard used before application.

**Benefits:** the product can answer “what changes, who is affected, why, and can
I safely publish it?” from one testable interface.

### 4. Deepen the Krateasy competition integration module

**Files/modules involved:** integration gateway, organisation platform, identity
mapping, public read models and outbox.

**Problem:** directly sharing tables or duplicating brackets in Krateasy would
destroy locality and create two authorities.

**Solution:** keep Krateasy identity, booking, payment, discovery and player
experience at the integration seam while Krateasy Competition Core remains
authoritative for competition truth.

**Benefits:** Krateasy mobile, Manager, Competition Studio and white-label
universes all gain the same correctness without synchronising competing models.

## Ranked frontier bets

| Rank | Bet | User need solved | Safety rule | Evidence of value |
|---|---|---|---|---|
| 1 | Continuous Competition Guard and publication certificates | Organisers can trust that the exact release is coherent | Guard is deterministic and independent; no direct mutation path | Zero invalid publications; every release traceable to bound hashes |
| 2 | Incremental robust scheduling and minimal-change repair | Events recover calmly from overruns, closures and no-shows | Solver proposes; Guard validates; operator previews and approves | Valid repair latency, future matches moved, people notified, finish impact |
| 3 | Counterexample-guided compiler | Complex requests fail with the smallest understandable reason and correction | No silent relaxation; unresolved policy stays unresolved | Time to resolve ambiguity and percentage of failures with actionable witnesses |
| 4 | Formal modelling of critical state machines | Duplicate, reordered and concurrent commands cannot corrupt truth | Model the protocol above code; implementation remains covered by replay tests | No invariant failure across model checking, fuzzing and chaos runs |
| 5 | Constrained natural-language planning | Owners describe unusual formats without learning compiler vocabulary | Model produces typed proposals only; schema adherence is not semantic correctness | First valid proposal time, clarification rate, correction rate, lost requirements |
| 6 | Operational digital twin and shadow mode | Organisers can compare likely outcomes and rehearse disruption | Simulation never edits authoritative state | Forecast calibration, avoided overruns, decision quality versus baseline |
| 7 | Outcome-learning objective tuner | Schedules improve from real waiting, delay and repair data | Learning changes suggested priorities, never hard rules or past truth | Reduced waiting, overruns and interventions on held-out events |
| 8 | Verifiable public/read models | Participants consistently see where, when, against whom and what changed | Server authority and version identity remain visible; clients fail stale | Stale-view rate, notification comprehension, support contacts |

Google describes CP-SAT as well suited to scheduling-style constraint problems;
that supports a solver portfolio, not blind trust in one solver:
[Google OR-Tools constraint optimisation](https://developers.google.com/optimization/cp).

TLA+ is specifically intended to model concurrent and distributed systems above
implementation code and find fundamental design errors. Use it narrowly for
publication, idempotency, repair approval, outbox delivery and correction
protocols—not to rewrite the whole competition engine:
[TLA+ overview](https://lamport.azurewebsites.net/tla/tla.html).

Structured model output can improve syntactic reliability, but the model remains
non-deterministic and schema conformance does not prove tournament semantics.
This reinforces the proposal-only AI design:
[OpenAI Structured Outputs](https://openai.com/index/introducing-structured-outputs-in-the-api/).

## The solver portfolio that creates real advantage

Do not choose one “best” solver. Keep three independent lanes:

1. **Deterministic construction** for fast, reproducible feasible plans.
2. **Exact bounded search** for small cases and proof-quality differential tests.
3. **CP-SAT optimisation** for production scale, with reconstructed objectives
   and independent validation.

Add scenario-robust objectives after the publication Guard is enforced:

- resilience to one court disappearing;
- sensitivity to 10/20/30-minute overruns;
- number of future matches moved by common disruptions;
- worst-case participant hot/cold paths;
- slack before critical knockout chains;
- notification blast radius;
- fairness across divisions, not only global makespan.

The differentiator is not merely finding a schedule. It is finding one that is
still operable when the day stops matching the plan.

## Formal methods where they pay back

Model-check only the small, dangerous protocols:

- approved revision cannot differ from published revision;
- one command identity cannot produce two effects;
- two command identities cannot silently overwrite the same expected revision;
- an outbox event is eventually delivered without changing authoritative truth
  twice;
- a score correction cannot leave downstream state partially updated;
- a revoked member cannot approve or publish;
- tenant identity cannot change during a command;
- rollback restores a previously certified state rather than inventing one.

Formal methods are not a substitute for whole-spec fuzzing, load tests or live
pilots. They target concurrency and state-machine failures that example tests
often miss.

## AI that is genuinely useful and safe

AI should help with expensive interpretation and communication work:

- turn prose, PDFs and spreadsheets into cited proposed requirements;
- identify contradictions and questions;
- explain infeasibility and counterexamples in organiser language;
- compare scenarios and explain trade-offs;
- draft participant notifications from an approved revision diff;
- cluster anonymised operational incidents into product opportunities;
- help rule authorities convert policy into reviewed test fixtures.

AI should not:

- select winners, invent tiebreaks or silently resolve policy;
- write directly to live state;
- override the Competition Guard;
- claim optimality or feasibility;
- learn a hard rule from observed behaviour;
- send external notifications before approval.

## Product anti-drift system

Every proposed capability must pass seven questions before entering delivery:

1. Which named user has which painful job at which moment?
2. How frequently and severely does that problem occur in observed events?
3. What measurable outcome changes if the capability succeeds?
4. Why is Krateasy Competition Core uniquely positioned to solve it?
5. What is the safe degradation or manual fallback?
6. Can the Competition Guard and replay model contain its failure modes?
7. Can the hypothesis be tested in one historical reconstruction or live shadow?

Reject or park a proposal when it has no named user, no observed pain, no metric,
creates a second authority, or requires a broad platform before one vertical slice
works.

Maintain three portfolios:

- **70% trust and core journey:** creation, feasibility, publication, live repair,
  recovery, clarity and accessibility.
- **20% validated differentiation:** robust scheduling, explanations, governed
  rule packs and cross-event organisation memory.
- **10% frontier experiments:** formal models, constrained AI, learned objective
  suggestions and digital-twin forecasting.

Frontier experiments receive bounded data, a kill switch, a baseline comparison
and an expiry date. Promotion into the product requires measured improvement.

## Product outcomes and metrics

North Star:

> Competitions completed through authoritative Krateasy competition truth without
> an unplanned spreadsheet or manual data fork.

Quarterly operating metric:

> Percentage of pilot competition revisions published with a current Guard
> certificate and no post-publication integrity correction.

Supporting metrics:

- time from source material to first publishable plan;
- material requirements captured versus later discovered;
- schedule interventions per 100 contests;
- valid repair latency and matches moved;
- participant waiting and back-to-back exposure;
- notification comprehension and stale-view rate;
- organiser repeat-event rate;
- restore and deterministic replay success;
- cross-tenant test failures, which must remain zero.

## Sports video job-control plane

Keep the sports-video job-control plane separate from the competition correctness
kernel. It may subscribe to certified match identities and operational events and
publish versioned media/analytics references back through an integration seam.

It should have its own customer job, reliability envelope, cost model and roadmap.
Do not let video processing availability block scoring, scheduling, publication or
live repair. Only integrate it when a validated Krateasy user journey benefits,
such as automatic highlights tied to an official result or reviewed performance
analytics.

## Next 90 days

### Days 1–30: close the publication invariant

- Consolidate existing validators behind the Competition Guard module.
- Define severity and acknowledgement policy.
- Bind exact approved inputs and Guard evidence into a publication certificate.
- Make every publication surface use that module.
- Mutation-test validators and add certificate-tampering tests.
- Reconstruct five difficult historical competitions.

### Days 31–60: prove calm live recovery

- Complete one change workflow from outage/withdrawal to independently validated
  repair, approval and targeted communication.
- Add common disruption scenarios and robust schedule measurements.
- Model-check the publication and idempotent-command protocols.
- Shadow two live events while organisers retain their existing process.
- Observe the control desk and participant communication, not only solver output.

### Days 61–90: validate product and integration

- Run a controlled Krateasy Competitions pilot with manual fallback.
- Deliver the golden journey through Krateasy Manager and mobile read models.
- Measure activation, intervention, repair and comprehension outcomes.
- Fix observed friction before broadening formats or adding another product.
- Decide whether constrained AI interpretation beats the deterministic grammar on
  the collected, redacted request corpus.

## Non-negotiable release gates

- Zero hard-constraint violations.
- Zero silent policy invention.
- Zero lost material requirements.
- Zero cross-tenant access paths.
- Identical versions and seeds replay identically.
- No acknowledged command is lost or applied twice.
- Every published repair is independently validated.
- Restore reproduces authoritative state and proof hashes.
- Every advertised capability names its tested scale and sport-policy envelope.
- Every critical workflow has an accessible interface and manual fallback.

## Bottom line

Be bleeding edge in verification, robustness, explanation and operational
learning. Be deliberately boring in authority, data integrity and publication.

The winning product is not the one with the most algorithms. It is the one that
lets an organiser express a difficult competition, understand every compromise,
survive a chaotic day and finish with trusted results—without needing the
spreadsheet they were trying to replace.
