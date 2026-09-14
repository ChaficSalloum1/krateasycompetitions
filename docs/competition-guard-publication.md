# Competition Guard publication contract

## Invariant

A competition may be proposed by a person, deterministic constructor, exact
search, CP-SAT adapter or AI interpreter. None is publication authority.
Publication requires a fresh Competition Guard decision over the exact approved
revision and all release artefacts.

## Bound evidence

The Guard report binds:

- the approved definition hash;
- the compiled specification hash;
- the graph and complete schedule artefact hashes;
- the optional simulation artefact hash;
- ruleset versions and optional rule-pack hashes;
- requirement-coverage evidence;
- independent certification evidence;
- contest and resource-minute accounting.

The report is itself canonically hashed. A publication certificate binds that
report, the tournament revision, the issuing actor and time, and the exact set of
required operational acknowledgements.

## Transaction boundary

`PUBLISH_TOURNAMENT` is the only publication write interface. Its client payload
contains only competition identity, expected revision and required
acknowledgements. The platform:

1. loads the latest approved immutable revision;
2. loads the organisation- and revision-bound authoritative specification, graph,
   schedule and optional simulation;
3. recomputes every artefact hash and verifies the exact fresh approval set;
4. independently runs Competition Guard over those server-owned artefacts;
5. enforces compiler, approver and publisher separation;
6. rejects critical or integrity findings and requires every and only operational
   acknowledgement;
7. issues the certificate;
8. appends `PUBLICATION_CERTIFIED`, `TOURNAMENT_STATUS_CHANGED` and the exact-revision
   publication outbox intent atomically.

Both events share one command identity and one optimistic-concurrency append.
If any step fails, neither event is stored. Replaying the stream reproduces the
same publication record and published certificate hash.

The older standalone certification command and
`CHANGE_TOURNAMENT_STATUS -> PUBLISHED` route are retired and fail closed. The
same strict boundary is used by the legacy platform API, production pilot API and
connected web/Mac journey.

## Read model

Tenant-scoped dashboards expose one readiness state for each visible tournament:

- `UNCERTIFIED`: no Guard certificate exists;
- `CERTIFIED`: current evidence exists but publication has not committed;
- `PUBLISHED`: the tournament points to the current certificate;
- `STALE`: stored evidence no longer matches the latest revision or fails integrity verification.

## Fail-closed cases covered

- source definition and compiled specification mismatch;
- graph built from another specification;
- missing required contests;
- altered schedule artefacts;
- cross-organisation artefact identities;
- incomplete or additional acknowledgement codes;
- tampered Guard reports or publication certificates;
- compiler/approver or approver/publisher identity collisions;
- caller attempts to supply the authoritative definition hash;
- caller attempts to supply any specification, graph, schedule, simulation or
  Guard report;
- duplicate command and restarted-process replay divergence;
- blocked publication leaving no partial state or event.

## Remaining production evidence

This contract closes the in-process publication invariant. Publication outbox
insertion is now wired into the same PostgreSQL transaction as the authoritative
event append, with tenant-scoped lease, retry and dead-letter operations.
Production deployment still requires managed PostgreSQL provisioning and an
executed outbox/restore/PITR drill, real identity/KMS integration,
historical reconstruction with organiser-supplied data, and live shadow/pilot
evidence. Those environment gates must not be represented as already complete.
