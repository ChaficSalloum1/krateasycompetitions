# Krateasy Competitions Pilot-Critical Execution Plan

**Date:** 14 September 2026
**Authority:** [`PRD-Krateasy-Competitions-Execution-Control.md`](./PRD-Krateasy-Competitions-Execution-Control.md)
**Starting point:** commit `39c18a0` (`Connect authoritative live participant information`), preserving the separately committed publication, St Albans workbench and guarded no-show slices
**Programme status:** Sprint 1 is complete. Sprint 2 has a connected first golden JSON workbench but its broader import, duplicate and organisation scope remains open. Sprint 3 has authoritative signed participant/public/organiser projections and durable targeted delivery, while token lifecycle, recovery and an external provider/fallback remain open. Sprint 4 has the connected command set, guarded no-show repair, actual-result knockout progression and a server-derived court-outage revision; delay/overrun and broader incident-policy rehearsals remain the next pilot-critical slice.
**Outcome:** a controlled live pilot can be created, validated, published, operated, disrupted, repaired, communicated, closed, replayed and repeated without a second source of competition truth.

## 1. Pilot definition

“Pilot-ready” means a trained organiser can run a controlled real event with a documented manual fallback. It does not mean every preserved multi-sport, league, federation or commercial capability is productised.

The pilot must prove this exact chain:

```text
Create or import
→ interpret and resolve decisions
→ compile structure and schedule
→ independently Guard
→ approve and publish exact revision
→ deliver personal participant truth
→ check in, call, score and correct
→ record a disruption
→ freeze, repair, Guard, approve and notify
→ close, replay, export, restore and duplicate
```

The first pilot envelope is deliberately named:

- Multi-division racket/paddle competition.
- Individuals, fixed pairs or teams as declared entrant units.
- Pool/round-robin to primary and consolation/placement knockout.
- Unequal pools with explicit normalisation.
- Deterministic tiebreaks, seeding, byes, play-ins and rematch policy.
- Shared courts/resources, availability windows, durations, buffers and rest.
- Court outage, delay/overrun, withdrawal/no-show and score correction.
- Install-free participant next action.
- Manual fallback during provider or connectivity failure.

Play & Konnect remains the difficult static benchmark. Modified Americano remains a required regression benchmark for the preserved dynamic-format architecture, but it does not block the first live pilot unless the selected pilot uses it.

## 2. Scope boundary

### Required for the controlled pilot

- Server-owned publication and Guard artifacts.
- One authoritative competition and operation history.
- Durable storage and organisation-scoped access.
- Describe, Quick setup, validated JSON/YAML, CSV/XLSX import and duplicate-event creation through one draft model.
- Editable interpretation, unresolved decisions, provenance and requirement coverage.
- Valid structure, participant paths, schedule and Guard pre-flight.
- Approval separation, semantic diff and atomic publication.
- Authoritative public `/next`, QR recovery and minimal public event view.
- Check-in, call, start, score, finish, walkover/retirement and correction.
- Typed incidents and minimum-change court-outage, delay and withdrawal repairs.
- Targeted delivery with provider states and fallback.
- Mac local/offline event pack, durable command journal and reconciliation.
- Emergency/manual pack.
- Close, audit, replay, export, restore and duplicate.
- Accessibility, privacy, tenant, reliability and recovery evidence.

### Preserved but not required to productise before the first pilot

- Full Swiss, ladder and Americano customer journeys.
- Double elimination, repechage, heat/time-trial, ranked and judged customer journeys.
- Broad sport and governing-body pack catalogue.
- Series and federation operation.
- Sponsor inventory and certified social graphics.
- Payments and broad registration-provider portfolio.
- Native feature parity between Mac and web.

These requirements remain in the traceability ledger with evidence gates. They are not deleted.

### Outside the pilot

- Community feed or chat.
- Partner matching.
- Video/highlight production.
- General POS, hotels, payroll or booking marketplace.
- Public template marketplace.
- Claims of arbitrary sport/format support.

## 3. Capacity model

Historical team velocity and human availability have not been supplied, so assigning confident story points would be false precision.

Recommended operating model:

- **Stream A — Authoritative journey/platform:** one lead implementation agent/engineer.
- **Stream B — Mac, web and participant experience:** one lead implementation agent/engineer.
- **Stream C — Live operation, delivery and offline:** one lead implementation agent/engineer.
- **Independent assurance:** one Guard/test/review stream that does not author the artifact it certifies.
- Reserve **20% capacity** in every sprint for regression, integration failures, accessibility defects and newly exposed legacy seams.

Use two-week sprints as planning boxes, not promises. Re-estimate after each exit gate using actual completed work and failures. Do not pull later work forward merely because one stream becomes idle; it should help finish or assure the critical path.

## 4. Definition of Ready

A story enters a sprint only when it has:

1. A stable requirement ID from `docs/requirements-traceability.md`.
2. A named user job and owning surface.
3. Exact authoritative input, command and event boundaries.
4. Acceptance criteria for normal, invalid, stale, duplicate, offline and recovery states as applicable.
5. Dependencies and migration impact identified.
6. A safe fallback.
7. Test evidence required for completion.
8. No unresolved product or authority conflict.

## 5. Definition of Done

A story is not done because a screen renders or a unit test passes. It is done only when:

1. The authoritative end-to-end journey exercises it.
2. No client can inject core artifacts or a Guard verdict.
3. Relevant negative and adversarial tests pass.
4. Mac, web, public and operator projections identify the same competition/revision where applicable.
5. Keyboard, screen-reader, zoom/reflow, contrast, weak-network and safe-error behaviors are verified for affected core tasks.
6. The requirements ledger links the runtime path and executable evidence.
7. Generated/demo-only fallback is removed from production routes or clearly isolated.
8. Full TypeScript, Swift and macOS application checks pass.
9. The working tree is clean and the slice is committed.

## 6. Delivery sequence

### Sprint 1 — Make publication authoritative — **Completed (`e709cf4`)**

**Sprint goal:** every publication path loads and validates server-owned artifacts for the exact approved revision.

Committed outcomes:

1. Remove `guardInput` and all client-provided spec/graph/schedule/simulation/Guard artifacts from `PUBLISH_TOURNAMENT`.
2. Add authoritative artifact resolution by organisation, competition and expected revision.
3. Re-run or cryptographically verify Guard from server-owned inputs.
4. Enforce freshness, approval separation and exact acknowledgement sets.
5. Commit publication and outbox intents atomically.
6. Route legacy platform, pilot and web publication through the same boundary.
7. Add forged-artifact, omitted-contest, stale-revision, cross-organisation, self-approval, acknowledgement, retry and replay attacks.
8. Remove the duplicate `G09` ledger row and update evidence.

**Dependencies:** existing `CompetitionJourney`, Guard and platform publication code.
**Exit:** no public API accepts authoritative competition artifacts or a Guard verdict from a client.

### Sprint 2 — Complete canonical creation and durable organisation context — **In progress (`36f91a9` golden JSON workbench)**

**Sprint goal:** an organiser can bring the event they already have into one durable, organisation-scoped draft.

Committed outcomes:

1. Unify Describe, Quick setup, JSON/YAML, CSV/XLSX and Duplicate behind one canonical creation command/model.
2. Add spreadsheet mapping, original-file preservation, quarantine, duplicate resolution, formula-injection protection and reversible commit.
3. Persist requirement IDs, uncertainty classes, provenance and unresolved decisions.
4. Add semantic diff for draft revisions and explicit preserved paths.
5. Connect participant unit and counts—individual, pair or team—without reference-event assumptions.
6. Connect organisation/workspace identity, roles and durable competition storage.
7. Retire or isolate overlapping guided `JsonValue`, legacy interpreter and local-only draft paths where migration evidence allows.
8. Prove Mac and web reopen the same draft after a fresh process.

**Dependencies:** Sprint 1 publication contract; directory and organisation identifiers.
**Exit:** a historical pilot workbook or description reaches a resumable, explicit, Guard-eligible draft without a demo handoff.

### Sprint 3 — Make the published promise useful to participants — **In progress (`39c18a0` connected live information)**

**Sprint goal:** every participant can retrieve the current next action from the authoritative published revision without installing anything.

Committed outcomes:

1. Replace participant-attention demo singleton with a projector derived from published competition plus live-operation heads.
2. Issue signed opaque participant tokens with expiry, rotation and revocation.
3. Deliver `/next`: arrival target, effective time, resource/place, opponent or dependency, change summary and freshness.
4. Add event QR and rate-limited privacy-safe recovery.
5. Make staff lookup, message payload and venue display use the same participant DTO and revision.
6. Connect one real messaging provider plus non-urgent email fallback; distinguish queued, accepted, delivered, failed and acknowledged.
7. Add public privacy, enumeration, superseded-message, stale-projection and weak-network tests.
8. Verify under ten-second median retrieval in representative pilot conditions.

**Dependencies:** authoritative publication and durable public projection boundary.
**Exit:** a published change produces one consistent answer across `/next`, message, staff lookup and venue display.

### Sprint 4 — Operate and recover the live event — **In progress (guarded no-show, court outage, commands and actual-result progression connected)**

**Sprint goal:** staff can run the event and recover from common disruption without corrupting competition truth.

Committed outcomes:

1. Connect check-in, call, confirm, start, score, finish, walkover, retirement and correction commands to the authoritative operations stream.
2. Build action-first Now, Next, Late, Blocked and Missing result projections.
3. Enforce exact schemas, roles, expected revisions, idempotency and correction lineage.
4. Add typed court outage, delay/overrun, withdrawal/no-show and score-dispute incidents.
5. Freeze completed, in-progress, pinned, communicated and near-horizon promises.
6. Generate minimum-change repair options with affected people, preserved promises, rest/fairness and finish deltas.
7. Independently Guard, separately approve, atomically publish and target delivery.
8. Add duplicate, reordered, stale, partial-append, notification-before-approval and downstream-invalidation attacks.

**Dependencies:** Sprints 1–3; live command and repair kernels.
**Exit:** a deliberate court outage is resolved end to end and only affected participants receive the new authoritative instruction.

### Sprint 5 — Make Mac and manual operation resilient — **Not started**

**Sprint goal:** essential event operation remains controlled through connectivity loss and recovery.

Committed outcomes:

1. Download a signed, scoped offline event pack to Mac.
2. Persist the Mac command journal durably; show pending, accepted, conflicted and reconciled states.
3. Reconcile with idempotency and expected revisions instead of overwriting server state.
4. Support offline participant lookup, essential live commands and incident capture within the declared envelope.
5. Keep on-device AI optional and advisory; deterministic creation, Guard and operation work without it.
6. Produce the emergency pack: signed schedule, court sheets, contacts by permitted role, QR index, manual scores and restoration steps.
7. Add Normal, Degraded, Paused, Stopped, Cancelled and Recovering operational states with separate safety and competition authority.
8. Rehearse disconnect, conflicting device commands, provider failure, manual fallback and authorised restart.

**Dependencies:** authoritative operation commands and projections from Sprint 4.
**Exit:** the event continues in the declared offline envelope and reconciles without lost or duplicated acknowledged commands.

### Sprint 6 — Close, restore and pass the pilot gate — **Not started**

**Sprint goal:** complete the event with defensible evidence and demonstrate that it can safely repeat.

Committed outcomes:

1. Block close on unresolved results, corrections or appeals unless explicitly governed.
2. Seal final result and competition revisions without rewriting original facts.
3. Generate human report and machine spec/graph/schedule/Guard/audit/result bundle.
4. Replay from pinned versions and seeds and compare proof hashes.
5. Execute backup/restore and fresh-process recovery drills.
6. Duplicate the completed event into a clean new edition with explicit carried-forward memory.
7. Complete accessibility evidence: automated checks plus keyboard, VoiceOver/NVDA, 200–400% zoom/reflow, contrast, reduced motion, print and representative outdoor/mobile conditions.
8. Complete tenant, privacy, concurrency, provider-crash and malicious-import review.
9. Run a full dress rehearsal with trained staff and documented manual fallback.
10. Resolve all Critical/Integrity findings and record accepted operational risks.

**Dependencies:** all prior sprints.
**Exit:** the pilot readiness checklist is signed by product, engineering, competition-domain, assurance, accessibility and operations owners.

## 7. Critical path

```text
Server-owned publication
→ durable canonical creation and organisation context
→ authoritative public projection
→ authoritative live commands
→ governed repair and delivery
→ Mac offline reconciliation
→ close/replay/restore
→ dress rehearsal
```

Guard hardening and independent assurance run across every step. UI polish that does not unblock or validate this path is secondary.

## 8. Risks and mitigations

| Risk | Consequence | Mitigation |
|---|---|---|
| Legacy demos remain reachable as production truth | Conflicting schedules and false confidence | Fail closed on production routes; label/isolate reference modes; add consistency invariants |
| Creation inputs create new schemas | Five existing authoring truths become six | One canonical draft command and migration plan before adding adapters |
| Guard reuses proposer derivations | Coordinated errors can pass | Independent re-derivation, mutation attacks and separate assurance ownership |
| Real auth/database/provider work expands unpredictably | Pilot schedule slips | Choose one identity/database/provider composition; keep adapters narrow |
| Offline scope grows into full replicated editing | Conflict and complexity explode | Limit offline authority to essential event-day commands and signed packs |
| Multi-sport breadth distracts from pilot | Many partial claims, no reliable event | Preserve/test architecture; productise only the named pilot envelope |
| Accessibility is deferred | Core event tasks fail under real conditions | Include acceptance and manual evidence in every affected sprint |
| Sensitive data enters append-only history | Privacy and deletion conflicts | Store opaque identity references; classify and separate mutable personal data |
| Parallel streams drift | Multiple truths return | Shared journey contracts, daily integration and independent cross-surface tests |
| Pilot becomes an unbounded production launch | Unsafe operating expectations | Controlled design partner, trained staff, manual fallback and published envelope |

## 9. Pilot readiness checklist

The event may proceed only when all statements are true:

- [ ] Every active pilot requirement has connected evidence in the traceability ledger.
- [ ] One organisation, competition and operation identity persists across fresh processes.
- [x] No client provides core artifacts or a Guard verdict.
- [x] Every required contest is independently accounted for exactly once in the named St Albans pilot fixture.
- [x] Zero hard structure, dependency, participant or resource violations remain in the named St Albans pilot fixture.
- [x] The exact approved revision is the exact published and publicly projected revision.
- [x] Participant tokens cannot enumerate or expose other participants.
- [ ] Live commands survive retry, reordering and reconnection without duplicate effect.
- [ ] Court outage, delay, withdrawal and correction rehearsals pass.
- [ ] Delivery failure visibly triggers the declared fallback.
- [ ] Manual/emergency operation has been rehearsed.
- [ ] Close, replay, export, restore and duplicate pass from the pilot state.
- [ ] Core tasks pass accessibility evidence.
- [ ] Cross-organisation attacks fail closed.
- [ ] Known operational limitations, support owner and rollback plan are documented.
- [ ] Product, competition, assurance and event-operation owners approve the pilot envelope.

## 10. Instruction for the implementation task

Sprint 1’s publication migration is complete. Retain this implementation instruction for the remaining programme:

> Continue implementation through the complete pilot-critical programme in `/Users/chaficsalloum/Documents/ChatGPT/Krateasy Tournaments Compiler/PILOT-CRITICAL-EXECUTION-PLAN.md`, governed by `PRD-Krateasy-Competitions-Execution-Control.md` and the existing `docs/requirements-traceability.md`. Do not stop after isolated slices or expand into later product features. Work sprint by sprint along the documented critical path, preserve all deferred original capabilities in traceability, and satisfy each exit gate with executable evidence. Use specialised parallel agents only for bounded workstreams, integrate continuously through the same authoritative competition journey, and keep independent Guard/assurance review separate from the proposing implementation. Stop only for a genuine product-authority conflict, destructive migration decision, missing external credential/provider choice, or unsafe pilot condition. At each sprint boundary, update traceability, run all relevant TypeScript/Swift/macOS/browser checks, commit the clean slice, and report the next critical risk. The programme ends only when every pilot readiness item is evidenced or explicitly blocked with an owner and fallback.
