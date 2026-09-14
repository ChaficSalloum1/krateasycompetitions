# Competition Guard and atomic publication delivery

Date: 2026-09-12

## Outcome

The highest-ranked engineering action in the bleeding-edge roadmap is now an
enforced platform invariant. Tournament publication is no longer only a lifecycle
status transition: the exact approved revision must pass a deterministic Guard
and receive a tamper-evident publication certificate.

## Delivered

- A single `evaluateCompetitionGuard` entry point over existing independent certification.
- Normalised critical, integrity and operational findings with entity evidence.
- Expandable contest and resource-minute accounting.
- Canonical bindings for definition, spec, graph, full schedule, optional simulation, rules and requirement coverage.
- Hash-verifiable Guard reports and publication certificates.
- Exact acknowledgement policy for operational findings.
- Server-owned definition binding; API callers cannot substitute another definition identity.
- Atomic `PUBLISH_TOURNAMENT`: certificate and published state commit together or not at all.
- Existing staged publication remains certificate-gated.
- Tenant-scoped dashboard readiness: uncertified, certified, published or stale.
- Organiser web cards now show publication evidence state alongside lifecycle state.
- API error correction so validation failures are not incorrectly reported as authorization failures.

## Adversarial evidence

Tests cover a foreign graph, source-definition mismatch, removed required contest,
changed schedule artefact, wrong acknowledgement set, modified certificate,
modified Guard report, blocked atomic publication, actor separation, caller hash
injection, event replay and shared command identity for the atomic append.

## Honest boundary

This completes the first repository-controlled Days 1–30 invariant. It does not
claim that production infrastructure or field validation exists. The next work is:

1. wire committed publication events to the durable transactional outbox;
2. consolidate outage/withdrawal/correction into one Guarded live-change workflow;
3. add robust disruption objectives and comparative schedule evidence;
4. model-check publication/idempotency protocols;
5. reconstruct five difficult historical competitions from supplied records;
6. shadow two live events before a controlled Krateasy pilot.

Items 1–4 are autonomous engineering work. Items 5–6 require real organiser data,
access and consent; they cannot be honestly fabricated from repository fixtures.
