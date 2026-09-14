# TournamentOS multi-club platform delivery

Date: 2026-09-07

## Outcome

TournamentOS now has a production-shaped, event-sourced organisation platform
around the proof-carrying compiler. The implementation is a working vertical
slice, not a collection of schema placeholders: commands persist, replay,
authorise, validate references, enforce lifecycle rules, and feed a real
multi-club Studio.

## Delivered capabilities

| Requested capability | Delivered evidence |
|---|---|
| Organisations, clubs, memberships, invitations, roles | Tenant aggregate; organisation and club create/update/suspend/archive rules; scoped roles; expiring hashed invitations; accept/revoke; role/scope/suspension changes; last-owner guard. |
| Persistent directories | Players, teams, venues, courts, officials, and equipment with club scope, archive status, stable IDs, and referential integrity. |
| Tournament CRUD | Draft creation, expected-revision edits, immutable hashes, guarded review/approval/publication/live/completion/archive transitions, and clean duplication. |
| Format Library | Reusable templates with immutable semantic versions, independent approval, deprecation state, and approved club defaults. |
| Guided creation | Participants -> Format -> Rules -> Resources -> Priorities -> Review; exact ordering, reference checks, visible progress, and a review-sealed definition revision. |
| Operator write API | Versioned tenant endpoint with server-injected actor/time/idempotency, authority-injection rejection, live actions, scoring corrections, alerts, publication transitions, and independently approved minimal-change repairs. |
| Portfolio dashboard | Multiple clubs, seasons, tournaments, lifecycle counts, directory counts, and operational alerts, filtered to the member's authorised club scope. |
| Account and operations safety | Hashed recovery secrets, privacy export, logical anonymisation, notification queue state, canonical backup with hash validation, and empty-target restore. |
| Production boundary | Composition root requires transactional PostgreSQL with forced RLS and rejects principals outside its configured tenant. Migrations remain a separate privileged release action. |

## Product experience delivered

The responsive Studio now presents Portfolio, Create tournament, Directory,
Formats, Control room, Compiler, Competition, Schedule, Public view, and Proofs.
The development workspace contains two clubs, persistent people and resources,
three tournaments, an approved reusable format, a club default, and an actionable
alert. The guided flow was exercised in a real browser and created a fourth
reviewed draft through all six API commands. A 390 x 844 viewport retained the
complete navigation and readable single-column content. The final browser console
contained zero errors and zero warnings.

The UI follows the existing operational design system: restrained colour,
explicit textual state, 44-point-equivalent targets, keyboard focus, a skip link,
named scroll regions, reduced-motion support, and proof near consequential
actions. It deliberately does not auto-publish or silently repair a schedule.

## Verification

- TypeScript build: passed.
- TypeScript/web suite: 387/387 passed.
- Focused platform/API/production-runtime suite: 11/11 passed.
- Real-browser creation flow: passed; tournament count changed from three to four.
- Mobile browser inspection at 390 x 844: passed.
- Browser errors/warnings after the corrected pass: 0/0.
- Swift client suite: 19/19 passed (14 XCTest cases plus 5 Swift Testing cases).

## Exact production boundary

The repository is source-complete for the requested platform vertical slice, but
it is not a deployed production service. A launch still requires infrastructure
and accountable owners outside source code:

1. a verified identity provider and session/revocation integration;
2. managed PostgreSQL, TLS ingress, rate limits, secrets/KMS, observability, and
   an exercised point-in-time restore;
3. email/SMS/push providers and a durable transactional notification worker;
4. field-level PII vaulting with per-subject keys and crypto-shredding;
5. legal retention/privacy approval and witnessed account-deletion drills;
6. federation-approved sport packs, production credentials, and human beta
   evidence under real event-day conditions.

Logical account deletion removes personal identity from current aggregate state
and logical backups. It does not erase PII from historical append-only events.
The runbook now explicitly prohibits claiming hard erasure until the PII-vault
control exists.

## Next engineering edge

The best differentiator remains complexity handled safely under pressure. The
next production programme should connect managed infrastructure, then prove the
system against real organisers using hostile event-day scenarios: shared venues,
late arrivals, mass withdrawals, court closures, score appeals, incomplete pools,
cross-club ranking series, and multi-day/multi-site travel. Every discovered
failure should become a permanent named conformance fixture.
