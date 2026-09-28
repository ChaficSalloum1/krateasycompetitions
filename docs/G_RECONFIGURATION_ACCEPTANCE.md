# G — organiser changes without manual schedule reconstruction

Status: ACTIVE acceptance clarification for future Phase G, supplied by the user in this conversation on 2026-09-28. Does not advance the current Phase D gate or authorise skipping E/F. This elaborates the existing finite plan, not a new programme.

## Job and ownership

JOB: An organiser changes participants, pair composition, pool membership/counts/sizes or division membership/counts and receives a coherent, guarded replacement competition plan without manually rebuilding brackets and schedules.
INPUT: Exact current DefinitionRevision, PlanRevision, roster with stable Participant/Team/Entry identities, resource commitments, approved policies, protected locks, mutation, actor and expected revision.
OUTPUT: Proposed Definition/Plan revisions, explicit impact scope, contest identity mapping, guarded qualification/draw/schedule candidate, disruption measures, before/after review; or a precise unresolved decision, violation, proved infeasibility or inconclusive search result.
AUTHORITATIVE OWNER: Definition owns rules; roster/entry domain owns accepted identities and relationships; Plan owns assignments; compiler derives the new contest graph; qualification/draw/scheduler propose; independent assurance checks; Guard protects application. Reality remains separate. This slice is PRE_EVENT only; changes after play begins belong to L.

## Ordered mutations and acceptance cases

| Mutation | Required acceptance behavior |
|---|---|
| Correct a participant display name | Identity and fixtures remain stable; no unnecessary schedule movement |
| Replace a partner in an existing pair | Membership lineage is explicit; eligibility and person-level collision/rest checks re-run; keep fixture/time identities where valid |
| Add or remove a pair | Account for all surviving entries; regenerate affected pool fixtures, qualification counts, byes/play-ins, brackets and schedule |
| Split/re-form pairs | Explicit new/retired team and entry identities; never silently transfer eligibility, seeding or old results |
| Move a pair between pools | Preserve pool policies and sizes where possible; rebuild changed encounters and downstream dependencies |
| Change pool count or sizes | Reallocate using explicit approved policies; show pool membership changes; account for every entry; ask if required policy is absent |
| Move a pair between divisions | Recompile both source and destination divisions and all shared-resource impacts; unchanged scope stays stable where valid |
| Add, remove, split or merge divisions | Require explicit rule inheritance and entrant destinations; reject orphan entries, broken stage links or undefined qualification semantics |
| Change court availability | Reuse the same scheduling repair contract; protect commitments, locks and entrant rest |

Required source-backed G scenarios remain: one Intermediate pair withdraws, one pair switches division, one court disappears. The additional rows are the user's explicit completeness criteria. A fixture is not labelled a historical replay without actual source evidence.

## State machine and commands

Mutation request → scope derivation → candidate compilation/search → independent assurance → guarded review → approved atomic application.

- NEEDS_DECISION: an essential policy is unspecified; ask about that policy, not for manual schedule reconstruction.
- INVALID: the mutation violates an invariant or references invalid identities; provide a counterexample.
- SEARCHING: candidate work is non-authoritative and version-bound.
- READY_FOR_REVIEW: an independently validated feasible candidate exists; show exact changes and remaining tradeoffs.
- INFEASIBLE: only when supported by a proof for the exact model and supported search domain.
- UNKNOWN: timeout, unavailable solver or incomplete search; never relabel as infeasible or valid.
- APPLIED: authorised actor approved the exact candidate against the current base; commit Definition/Plan references, history and outbox atomically.
- STALE: base changed before approval; reject application and derive a fresh proposal.

Commands use the canonical ADD_ENTRY, REMOVE_ENTRY, CHANGE_PARTNER, SWITCH_DIVISION, MOVE_POOL and CHANGE_RESOURCE_AVAILABILITY boundaries; pool/division structural edits enter the same proposal workflow through Definition design commands. Additional pair restructuring must have a typed domain contract before implementation.

Automatic means recomputation and repair search happen without the organiser manually placing every match. It does not mean secretly changing competition rules, destroying locks or replacing published promises without the documented approval boundary. Answered decisions resume the same governed workflow. The last authoritative revision remains intact until atomic application succeeds.

## Hard invariants

1. Every surviving entry is accounted for exactly once in its governed scope; removed entries do not linger in future fixtures.
2. Participant, team/pair and competition-entry identities remain distinct. Collision/rest validation considers actual people across entries, including cross-division participation when policy permits it.
3. Qualification identity is decided only by the active policy; it never changes merely to make a draw or schedule easier.
4. Qualifiers appear once in the intended destination, with correct topology/byes/play-ins and seed protection; rematch constraints obey their declared strength.
5. Every required contest has one valid schedule assignment; no resource/person collision; dependencies, durations, rest, availability and hard locks hold.
6. A surviving contest is matched by semantic identity, not just a reused position-based ID. Record added, removed, retained and meaning-changed contests; never transplant a lock onto a different matchup.
7. Preserve unaffected memberships, encounters, courts and times where valid. Broader changes require an explicit reason and disruption cost.
8. No hidden policy relaxation: a locked promise that prevents repair produces a decision/counterexample. Only an explicit permitted command may release it.
9. Assurance independently reconstructs critical facts against the exact candidate. Guard uses fresh server-owned artifacts, never caller-supplied PASS assertions.
10. Invalid/stale/blocked application changes no authoritative state. Duplicate commands are idempotent. Replay under pinned rule versions reproduces the same result.

## Repair boundary and minimal disruption

The affected scope is dependency closure plus shared participant/resource constraints. A division edit may legitimately affect other divisions sharing courts or people. Do not promise a purely division-local repair when global constraints require more.

Compare old/new contest graphs before schedule search. Reuse valid surviving assignments, remove obsolete assignments, and schedule new contests. Record participants moved, pool-membership changes, added/removed/changed contests, time shifts, court changes and published-information changes. Apply an explicit versioned disruption objective; report whether it is proved minimal or merely the best validated candidate found. A feasible repair need not wait for a global optimum proof.

Observed implementation gap at core commit 1532d4afc880aa30a66c2373ff2aba24d780b256: schedule-repair.ts validates that baseline assignments cover exactly the new problem's tasks and rejects unknown baseline tasks. It is useful existing repair machinery, but by itself cannot reconcile added/removed matches after structural mutations. G needs a semantic contest-diff adapter and a repair path admitting new/retired tasks, with independent checks. live-change.ts is an operational proposal path, not evidence of this generic PRE_EVENT structural pipeline. Preserve and extend the core through bounded slices; do not build a second scheduler.

## Telemetry and proof

TELEMETRY: requested mutation/base revision, affected scope and why, old/new graph hashes and identity map, candidate/rule versions, solver status/search limits, disruption components, assurance findings, Guard disposition, review decision, commit revision and audit event. Rejected requests remain observable without mutating authoritative competition state.
ACCEPTANCE SCENARIO: For every supported mutation above, run valid, impossible, missing-policy, locked, stale and duplicate cases as applicable. Chain mutations, undo/withdraw proposals, and replay. Inject duplicate entrants, orphan destinations, remapped contest IDs, overlapping people/courts and stale evidence. Verify precise counterexamples and unchanged authoritative state on rejection. Test person identity across different pairs/divisions, not only entry IDs.
NON-GOALS: New signup/auth/provider features, live-history rewriting, notification sending, format expansion or P&K cutover. No hand-authored repaired schedule masquerading as compiler output.
EXIT GATE: An organiser performs the supported mutations in the UI; the engine produces and independently validates a replacement or truthfully reports decisions/infeasibility/unknown; before/after and disruption evidence are reviewable; exact approved application is atomic. No manual spreadsheet repair. For the required programme acceptance fixtures, UNKNOWN does not pass the exit gate: they must obtain a valid guarded repair or a supported impossibility proof. This gate is not passed by documenting it.
NEXT ALLOWED WORK: Remains the current D gate, then E, then F. G implementation begins only after those gates pass.

Inspection evidence (2026-09-28): the existing schedule-repair and live-change suites passed 11/11. They cover closure, pins, proof limits, replay, incomplete baseline rejection and approval tampering; they do not establish structural roster/group/division recompilation. The existing repair also withholds feasible incumbents when minimality is unproved; G must explicitly distinguish feasible repair approval from optimality, with an appropriate versioned contract and tests rather than silently changing live behavior.
