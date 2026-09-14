# Governed live-change workflow

## Purpose

Tournament-day facts arrive faster than an organiser can safely reason through
their consequences. The live-change module turns one outage, withdrawal or other
audited live command into a reviewable proposal rather than mutating truth early.

## Proposal

`proposeLiveChange` binds the current live-state proof, applies the proposed fact
to an isolated copy, runs the deterministic minimal-change repair, and produces:

- directly affected and moved contests;
- every affected entrant;
- resource-change and finish-time impact;
- targeted notification drafts;
- the full repair result and proof;
- one hash over the complete preview.

The proposal is `BLOCKED` unless the live command is valid and repair is proven
minimal and independently hard-constraint valid. Blocked proposals expose no
proposed live state and no notification drafts.

## Approval and application

The organisation platform persists proposals through `PROPOSE_LIVE_CHANGE`.
`DECIDE_LIVE_CHANGE` requires a different authorised actor and verifies that
current operational truth still matches the proposal's base proof hash. Approval
stores the decision and new live state in one event append. The same append emits
one tenant-scoped outbox message containing the approved impact and targeted
drafts. Rejection leaves live truth unchanged.

No notification is sent while a proposal is awaiting approval. Delivery workers
must still apply provider-level idempotency using the outbox message identity.
