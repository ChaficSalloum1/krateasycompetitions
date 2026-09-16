# Goal Quality Contract

This is the delivery and independent-QA protocol for Krateasy Competitions.
It exists because a feature, a green unit suite, or an implementation task's
completion message is not by itself proof that a product goal is complete.

## Roles and worktrees

There are two deliberately separate lanes for every goal.

| Lane | Owns | May change product code? |
| --- | --- | --- |
| Delivery | The active organiser job and its implementation | Yes |
| Independent QA | Reproduction, adversarial evaluation, evidence, and acceptance review | No, unless explicitly asked to prepare a corrective patch |

The QA worktree must be refreshed to the exact delivery commit under review.
It must not share uncommitted changes with the delivery lane. A QA reviewer
reports `accepted`, `remediate`, or `blocked`; it does not self-certify the
delivery work.

## Required goal contract

Every goal starts with these explicit fields:

1. **Job:** one organiser outcome in `When … I want … so that …` form.
2. **Scope:** the bounded vertical slice that delivers that outcome.
3. **Non-goals:** surfaces, formats, integrations, and architectural changes
   that must remain untouched.
4. **Authoritative boundary:** the existing server/domain command, revision,
   Guard, and evidence boundary that owns truth.
5. **Invariant matrix:** each protected claim mapped to its checks.
6. **Evidence:** the commands and durable artefacts required to demonstrate
   the slice.
7. **Exit rule:** the goal may not be marked complete until independent QA
   accepts every row and finds no unresolved P1 issue.

Use this matrix inside the goal prompt or its supporting document:

| Outcome / claim | Domain invariant | Automated proof | Browser or operational proof | Durable evidence |
| --- | --- | --- | --- | --- |
| Example: selected repair is safe | exact option hash binds strategy and proposal | missing, forged, stale and replay tests | select and approve each option | JSON rehearsal output |

## Invariant coverage

Where a goal changes an identity, approval, revision, hash, publication, or
live-operation boundary, its tests must cover all applicable states:

- valid request;
- missing or malformed input;
- forged input;
- stale state or revision;
- duplicate/idempotent replay;
- restart or restore;
- post-publication behaviour.

The invariant must be enforced at the domain boundary, not merely in a UI or
HTTP route. A happy path is evidence of use, not evidence of safety.

## Evidence and seeded evaluation

Each goal supplies an executable rehearsal command for any user-visible claim.
The command must create isolated deterministic state, record the seed/config,
assert its outcomes, and emit machine-readable evidence. Human field checks
remain valuable but are recorded as external pilot gates, never fabricated as
automated proof.

Use seeded adversarial evaluation rather than unreproducible random checks.
Set `QA_SEED` for each run and retain it in the gate evidence. A failure must
be reproducible from its seed and exact commit. Existing protocol/model checks
are included in the quality gate; a goal may add focused scenario or property
tests where its invariant demands them.

## Gate sequence

1. **Plan review:** QA checks the contract before delivery begins.
2. **Mid-goal check:** when a protected boundary is first changed, QA confirms
   the intended evidence can prove the invariant.
3. **Delivery complete:** implementation reports its commit and evidence, but
   does not mark the goal complete.
4. **Independent acceptance:** QA runs the goal gate, exercises the specific
   rehearsal, reviews the diff against the contract and design standards, and
   records an outcome.
5. **Close or remediate:** only accepted work closes. A failed row becomes a
   small closure goal; it does not silently roll into the next product goal.

## Running the reusable gate

From the QA worktree, run:

```sh
npm run qa:goal-gate -- --goal "Run Control incident safety" --baseline <pre-goal-commit> --rehearsal rehearse:run-control-options-browser
```

The gate runs repository checks, Apple checks, protocol model checking, and
each supplied rehearsal. It writes a local JSON report under `output/qa/`.
That report is review material; a release/pilot decision must additionally
preserve the relevant durable evidence or CI artefact.

## Reviewer decision template

```text
Goal: <name>
Commit under review: <sha>
QA decision: accepted | remediate | blocked
P1 findings: <count and links>
Evidence run: <commands and artefacts>
External release gates unchanged: <yes/no, with links>
Next action: <close goal or exact corrective goal>
```
