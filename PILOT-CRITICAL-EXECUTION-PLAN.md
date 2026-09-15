# Krateasy Competitions Pilot-Critical Execution Plan

**Date:** 15 September 2026
**Authority:** [`PRD-Krateasy-Competitions-Execution-Control.md`](./PRD-Krateasy-Competitions-Execution-Control.md)
**Starting point:** commit `39c18a0` (`Connect authoritative live participant information`), preserving the separately committed publication, St Albans workbench and guarded no-show slices
**Programme status:** Sprint 1 is complete. Sprint 2 now has one connected web/API workbench for Describe, Quick, exact JSON/YAML, CSV/XLSX entrant evidence and clean-edition duplication; raw sources, hashes, field provenance, quarantine, conflicts and reversible last-source removal survive restart. Mac import/duplicate controls and broader organisation deployment remain open. Sprint 3 has authoritative signed participant/public/organiser projections, durable targeted delivery, active-key rotation, participant revocation, a generic event QR and rate-limited privacy-safe recovery. An external provider/fallback and representative weak-network timing remain open. Sprint 4 has the connected command set, guarded no-show and court-outage repair, actual-result knockout progression and a server-derived delay/overrun revision. Sprint 5 has a server-signed, revision-scoped Mac offline event pack and participant lookup, a durable live/incident/stop command journal with explicit retry/conflict/reconciliation, a replayable Normal/Degraded/Paused/Stopped/Cancelled/Recovering authority state, typed incident log, command transfer and separately cleared restart, plus signed printable order-of-play, court, score, participant-QR and restoration materials. Sprint 6 has the connected authoritative close, replay, evidence export, isolated restore and clean-duplication journey over the completed St Albans state, plus executable markup/contrast/motion/forced-colour/print contracts and keyboard/200–400% reflow browser evidence across the live-information surfaces. The authorised emergency details, external delivery provider/fallback, full disconnect/manual restore rehearsal, named-assistive-technology/outdoor inspection and staff dress rehearsal remain open.
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

### Sprint 2 — Complete canonical creation and durable organisation context — **In progress (connected multi-source workbench)**

**Sprint goal:** an organiser can bring the event they already have into one durable, organisation-scoped draft.

Committed outcomes:

1. Unify Describe, Quick setup, JSON/YAML, CSV/XLSX and Duplicate behind one canonical creation command/model. **Connected for web/API:** the creator saves through `CompetitionJourney`; YAML normalises to the existing definition shape and CSV/XLSX reuse the existing entrant importer. Mac import/duplicate controls remain.
2. Add spreadsheet mapping, original-file preservation, quarantine, duplicate resolution, formula-injection protection and reversible commit. **Connected for the pilot envelope:** values-only `Entrants` sheets, exact CSV headers, byte/text hashes, active-content/formula/alias/duplicate/size/expansion quarantine, cross-source field conflicts and last-source removal are executable.
3. Persist requirement IDs, uncertainty classes, provenance and unresolved decisions. **Connected for St Albans:** every entrant display name, division, member identity and seed retains per-source provenance; the eight critical policy decisions remain explicit. Broader fresh-format uncertainty classes remain.
4. Add semantic diff for draft revisions and explicit preserved paths. **Connected for registered organiser decisions and source revisions.**
5. Connect participant unit and counts—individual, pair or team—without reference-event assumptions.
6. Connect organisation/workspace identity, roles and durable competition storage.
7. Retire or isolate overlapping guided `JsonValue`, legacy interpreter and local-only draft paths where migration evidence allows. **Partial:** the web creator no longer writes the mutable platform-demo singleton; the historical demo and local-only Mac draft remain explicitly isolated.
8. Prove Mac and web reopen the same draft after a fresh process. **Partial:** multi-source web/API originals, hashes and provenance replay byte-identically after restart; the Mac already reads the authoritative journey but does not yet initiate these import modes.

**Dependencies:** Sprint 1 publication contract; directory and organisation identifiers.
**Exit:** a historical pilot workbook or description reaches a resumable, explicit, Guard-eligible draft without a demo handoff.

### Sprint 3 — Make the published promise useful to participants — **In progress (connected live information and governed recovery)**

**Sprint goal:** every participant can retrieve the current next action from the authoritative published revision without installing anything.

Committed outcomes:

1. Replace participant-attention demo singleton with a projector derived from published competition plus live-operation heads. **Connected.**
2. Issue signed opaque participant tokens with expiry, rotation and revocation. **Connected:** versioned keyrings validate old keys only until an atomic participant rotation/revocation invalidates them; lifecycle evidence replays after restart.
3. Deliver `/next`: arrival target, effective time, resource/place, opponent or dependency, change summary and freshness. **Connected for the pilot projection; richer changed-from copy remains.**
4. Add event QR and rate-limited privacy-safe recovery. **Connected:** the generic QR contains no participant identity or token; a private expiring code exchanges at the exact operational head under a five-attempt/minute opaque-client bucket.
5. Make staff lookup, message payload and venue display use the same participant DTO and revision. **Connected for the current minimal projections:** staff issuance and private recovery resolve the same participant projection; delivery and public/venue reads bind the same authoritative heads.
6. Connect one real messaging provider plus non-urgent email fallback; distinguish queued, accepted, delivered, failed and acknowledged.
7. Add public privacy, enumeration, superseded-message, stale-projection and weak-network tests. **Partial:** privacy/enumeration, forged credentials, stale heads, superseded credentials, rate limiting and restart are executable; representative weak-network/provider timing remains.
8. Verify under ten-second median retrieval in representative pilot conditions.

**Dependencies:** authoritative publication and durable public projection boundary.
**Exit:** a published change produces one consistent answer across `/next`, message, staff lookup and venue display.

### Sprint 4 — Operate and recover the live event — **In progress (guarded no-show, court outage, delay, commands and actual-result progression connected)**

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

### Sprint 5 — Make Mac and manual operation resilient — **In progress (signed offline truth, journal/reconciliation and operational-safety state connected)**

**Sprint goal:** essential event operation remains controlled through connectivity loss and recovery.

Committed outcomes:

1. Download a signed, scoped offline event pack to Mac. **Connected:** Ed25519-signed exact-publication/current-operational projections are verified against a pinned key and cached per competition.
2. Persist the Mac command journal durably; show pending, accepted, conflicted and reconciled states. **Connected.**
3. Reconcile with idempotency and expected revisions instead of overwriting server state. **Connected.**
4. Support offline participant lookup, essential live commands and incident capture within the declared envelope. **Connected:** the signed lookup and durable journal cover essential live commands plus typed incident facts and an optional atomically queued venue-stop intent; authority, time, public wording and update deadline remain server-owned.
5. Keep on-device AI optional and advisory; deterministic creation, Guard and operation work without it. **Connected for the implemented journey.**
6. Produce the emergency pack: signed schedule, court sheets, contacts by permitted role, QR index, manual scores and restoration steps. **Partial:** the exact-revision schedule, 108 court/score sheets, 48 privacy-preserving participant QR cards and seven restoration steps are server-derived, signed, Mac-linked and print-ready. The pack visibly blocks emergency readiness because the venue address, access/evacuation details, emergency contact and named responders remain safety-owner facts.
7. Add Normal, Degraded, Paused, Stopped, Cancelled and Recovering operational states with separate safety and competition authority. **Connected:** typed incidents, fixed message codes, authority transfer, stop precedence and separate restart clearances share one replayable history.
8. Rehearse disconnect, conflicting device commands, provider failure, manual fallback and authorised restart. **Partial:** conflict/reconciliation and the authorised two-clearance restart are executable, and the deterministic manual materials render at desktop/mobile widths; provider failure and a staff-practised paper-to-restored-system rehearsal remain.

**Dependencies:** authoritative operation commands and projections from Sprint 4.
**Exit:** the event continues in the declared offline envelope and reconciles without lost or duplicated acknowledged commands.

### Sprint 6 — Close, restore and pass the pilot gate — **In progress**

**Sprint goal:** complete the event with defensible evidence and demonstrate that it can safely repeat.

Committed outcomes:

1. Block close on unresolved results, corrections or appeals unless explicitly governed. **Connected:** close requires all 108 exact terminal results, no pending protest/appeal, normal operational authority and four exact acknowledgements.
2. Seal final result and competition revisions without rewriting original facts. **Connected:** closure binds publication, operational and live heads, result and delivery hashes, server time, separate closer identity and an atomic outbox intent.
3. Generate human report and machine spec/graph/schedule/Guard/audit/result bundle. **Connected:** one verified evidence bundle contains preserved sources, canonical artefacts, Guard, approval, publication history, actual/live/operational truth, closure, authoritative record and human-readable audit.
4. Replay from pinned versions and seeds and compare proof hashes. **Connected:** export and restore independently replay live, operational and closure truth and compare every artifact and manifest hash.
5. Execute backup/restore and fresh-process recovery drills. **Connected for the isolated local file-store drill:** a fresh store restores and re-exports byte-identical evidence. Managed production backup credentials and the staff-run recovery drill remain deployment gates.
6. Duplicate the completed event into a clean new edition with explicit carried-forward memory. **Connected:** duplicate carries the exact closed source and organiser decisions with closure provenance, applies explicit name/date edits, and starts without compile, approval, publication, live or result truth.
7. Complete accessibility evidence: automated checks plus keyboard, VoiceOver/NVDA, 200–400% zoom/reflow, contrast, reduced motion, print and representative outdoor/mobile conditions. **Partial:** connected participant, organiser, venue, closure and fallback pages now have tested landmarks, names, live announcements, skip navigation, zoom permission, 320px reflow, AA colour pairs, reduced-motion, increased/forced-colour and print rules. A real browser proves keyboard focus and 200%/400% reflow with no page-level horizontal overflow. Named VoiceOver/NVDA, printed-paper and representative outdoor-device inspection still require the accessibility/pilot operations owners.
8. Complete tenant, privacy, concurrency, provider-crash and malicious-import review. **Partial:** organisation-scoped publication/projections, optimistic concurrency and provider-crash replay are executable. Malicious YAML/CSV/XLSX imports now fail closed on aliases/anchors/tags, formulas, active content, duplicate identities, unsafe archive paths, encrypted/unsupported entries, excessive expansion, depth and size; production persistence and deployment review remain.
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
- [x] Live commands survive retry, reordering and reconnection without duplicate effect.
- [x] Court outage, delay, withdrawal and correction rehearsals pass.
- [ ] Delivery failure visibly triggers the declared fallback.
- [ ] Manual/emergency operation has been rehearsed.
- [x] Close, replay, export, restore and duplicate pass from the pilot state.
- [ ] Core tasks pass accessibility evidence.
- [ ] Cross-organisation attacks fail closed.
- [ ] Known operational limitations, support owner and rollback plan are documented.
- [ ] Product, competition, assurance and event-operation owners approve the pilot envelope.

## 10. Instruction for the implementation task

Sprint 1’s publication migration is complete. Retain this implementation instruction for the remaining programme:

> Continue implementation through the complete pilot-critical programme in `/Users/chaficsalloum/Documents/ChatGPT/Krateasy Tournaments Compiler/PILOT-CRITICAL-EXECUTION-PLAN.md`, governed by `PRD-Krateasy-Competitions-Execution-Control.md` and the existing `docs/requirements-traceability.md`. Do not stop after isolated slices or expand into later product features. Work sprint by sprint along the documented critical path, preserve all deferred original capabilities in traceability, and satisfy each exit gate with executable evidence. Use specialised parallel agents only for bounded workstreams, integrate continuously through the same authoritative competition journey, and keep independent Guard/assurance review separate from the proposing implementation. Stop only for a genuine product-authority conflict, destructive migration decision, missing external credential/provider choice, or unsafe pilot condition. At each sprint boundary, update traceability, run all relevant TypeScript/Swift/macOS/browser checks, commit the clean slice, and report the next critical risk. The programme ends only when every pilot readiness item is evidenced or explicitly blocked with an owner and fallback.
