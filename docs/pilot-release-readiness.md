# St Albans pilot release readiness

This is the operational release authority for the first controlled St Albans pilot. It does not declare the pilot ready. A pilot may proceed only when `assessPilotRelease` returns `READY` for the exact server-owned closure evidence bundle that is being accepted.

The executable gate is `apps/compiler-web/src/pilot-release-readiness.ts`. It verifies the content-addressed closure bundle, exact organisation/competition/revision chain, 108-result accounting and the current independent Guard report before considering any human acceptance. Its scope hash binds every acceptance to that exact evidence bundle. Missing, duplicate, stale, future-dated, wrong-role, wrong-scope, rejected or fallback-unacknowledged evidence fails closed.

## Current decision

`BLOCKED_EXTERNAL_AUTHORITY`

The connected software rehearsal is executable and green. The production provider, venue, human rehearsal, named accessibility inspection, support assignment, production persistence and final role approvals remain external facts. No person or acceptance record is invented in this repository.

## Evidence attachment contract

Each authority record must contain:

- the exact gate ID and required role;
- a non-empty accountable owner identity from the production identity provider;
- `ACCEPTED` or `REJECTED`;
- a canonical acceptance timestamp within the configured freshness window;
- an immutable evidence reference to the signed record, rehearsal log or inspection result;
- the exact release scope hash produced from the server-owned bundle; and
- acknowledgement of the fixed safe fallback below.

The acceptance record cannot replace, alter or supply the specification, graph, schedule, Guard report, publication, results or evidence bundle.

## Open authority gates and fixed fallbacks

| Gate | Required owner | Evidence required | Safe fallback while open |
|---|---|---|---|
| `DELIVERY_PROVIDER_AND_FALLBACK` | Platform/security | Provider, credentials, receipt semantics, failure exercise and non-urgent fallback | Disable remote delivery; use signed participant QR, venue display and controlled manual contact. |
| `MANUAL_EMERGENCY_REHEARSAL` | Event operations | Staff disconnect, paper operation, reconciliation and separately authorised restart rehearsal | Pause digital commands; use the signed manual pack and reconcile every paper fact before restart. |
| `VENUE_SAFETY_DETAILS` | Venue safety | Named responders, contacts, access and evacuation details | Do not claim emergency readiness; use the venue-controlled printed safety plan and stop play when uncertain. |
| `ACCESSIBILITY_FIELD_ACCEPTANCE` | Accessibility | Named VoiceOver/NVDA, printed-paper and representative outdoor/mobile inspection | Do not release until equivalent completion is demonstrated; provide staffed assistance without weakening privacy or authority. |
| `WEAK_NETWORK_RETRIEVAL` | Event operations | Representative venue test against the participant retrieval target | Use signed QR/manual lookup and venue display; never present stale cached data as current. |
| `PRODUCTION_PERSISTENCE_AND_RESTORE` | Platform/security | Production identity, PostgreSQL, backup and staff-run restore evidence | Do not route pilot traffic; keep rehearsal-only status and the verified local closure bundle. |
| `SUPPORT_AND_ROLLBACK` | Event operations | Named support owner, limitations, escalation and rollback acceptance | Stop new writes, retain the command journal, switch to the signed manual pack and restore only from verified evidence. |
| `PRODUCT_ENVELOPE_APPROVAL` | Product owner | Acceptance of the named St Albans envelope and limitations | Keep the product in rehearsal. |
| `COMPETITION_RULES_APPROVAL` | Competition domain | Acceptance of qualification, scoring, tiebreak, normalisation and withdrawal policies | Do not publish or operate until the disputed rule is resolved. |
| `ASSURANCE_EVIDENCE_APPROVAL` | Guard/assurance | Acceptance of Guard, adversarial, replay and recovery evidence | Block release and retain the last independently certified revision. |
| `EVENT_OPERATIONS_APPROVAL` | Event operations | Acceptance of commands, disruption, communication, close and recovery | Keep the event in rehearsal or use the separately authorised manual plan. |

## Known operational limitations

- The production delivery provider and non-urgent fallback have not been selected or credentialled.
- The emergency pack intentionally omits venue address, access/evacuation details, emergency contacts and named responders until the venue safety owner supplies them.
- Automated accessibility and browser reflow evidence does not substitute for named assistive-technology, printed-paper and outdoor-device inspection.
- Local deterministic restore evidence does not substitute for production backup credentials or a staff-run production restore.
- The pilot compilation envelope is the documented St Albans multi-division padel format. Broader loser paths, hard rematch policy expansion and additional sports remain preserved Stage 4 work, not pilot claims.
- The Mac app consumes the same authoritative identity and signed pack; it does not provide an independent competition truth or unrestricted offline editing.

## Rollback and controlled fallback

1. Stop accepting new digital commands and record the last accepted operational/live heads.
2. If safety is involved, issue the typed stop and follow the venue-controlled safety plan. Software never invents emergency instructions.
3. Switch staff to the signed exact-revision manual pack. Record every actual result, incident and communication without rewriting prior facts.
4. Preserve the Mac journal, paper records, provider receipts and the last independently certified bundle.
5. Restore only into an isolated store; verify every artifact, event head and proof hash before routing traffic.
6. Reconcile queued and manual facts through expected-revision and idempotent commands. Conflicts require explicit authority; they are never last-write-wins.
7. Require separate safety and competition clearances before restart. If equivalence cannot be proved, remain paused or cancel under the authorised operating plan.

## Executable evidence

Run:

```sh
npx tsc -b --pretty false
node --import tsx --test apps/compiler-web/test/competition-close-journey.test.ts
```

The golden test closes all 108 St Albans fixtures, exports and verifies the exact bundle, proves an empty manifest is blocked with every required owner/fallback, proves forged scope evidence remains blocked, proves input ordering cannot change the manifest, and demonstrates that only a complete fresh exact-scope acceptance set can produce `READY`.
