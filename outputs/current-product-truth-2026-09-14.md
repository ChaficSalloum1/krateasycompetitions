# Krateasy Competitions — current product truth

Date: 2026-09-14

## Product definition

Krateasy Competitions is a web-first competition operating system. Its core job
is to turn explicit organiser intent into a verified competition plan, operate
that plan on the day, and recover safely when reality changes.

TournamentOS is the deterministic compiler/Guard inside the product. It is not a
second customer-facing product. The existing Apple client remains a reference
and internal operator client until pilots demonstrate that native offline value
justifies maintaining another full interface.

## What exists now

| Layer | Present capability | Honest status |
|---|---|---|
| Compiler kernel | Typed specification, stage graph, qualification, scheduling, simulation, proofs and deterministic replay | Executable and extensively tested |
| Format families | Round robin, knockout, Swiss, double elimination, ladders, heats/time trials, rankings, repechage and dynamic formats | Named conformance evidence exists; production envelopes still need real-event validation |
| Schedule intelligence | Hard constraints, exact/deterministic solver, optional CP-SAT, minimum-change repair and why-not evidence | Executable; large real-event operating envelope still needs pilot data |
| Competition Guard | Requirement reconciliation, accounting, independent validation and exact-revision publication certificate | Executable |
| Live operations | Scores, corrections, voids, withdrawals, protests, resource/official/equipment changes and governed repair | Kernel exists; operator actions are not all complete in the polished UI |
| Organisation platform | Organisations, clubs, memberships, invitations, roles, directories, tournaments, revisions, templates, lifecycle and dashboard projections | Domain/API implementation exists; demo UI is not a production multi-tenant service |
| Production boundary | Request limits, exact command schemas, idempotency, rate limiting, webhook replay protection, PostgreSQL coordination seams, health/readiness and backup/restore procedures | Hardened seams and tests exist; credentials, providers and deployed infrastructure are not configured |
| Organiser web experience | Workspace, creation wizard, schedule, control room, publication/repair rehearsal, directories, templates and evidence | Playable local rehearsal; creation does not yet continue through the full live lifecycle |
| Participant attention | Answer-in-message preview, `/next`, QR recovery, venue display, delivery/fallback rehearsal and court calls | Playable local rehearsal; no real provider delivery or production privacy boundary |
| Apple client | macOS/iOS-capable SwiftUI reference surfaces and platform API projections | Reference client, not the canonical product |

## The two visible proof points

1. **Trusted live recovery:** freeze the affected scope, propose the smallest
   valid repair, explain the blast radius, require the right authority, publish
   atomically, and preserve a replayable history.
2. **Participant attention without installation:** put the useful answer inside
   the existing message channel, provide universal `/next` recovery, and maintain
   ambient venue displays.

## The most important remaining integration gate

One newly created competition must travel through one continuous identity and
revision chain:

```text
Create → compile → resolve issues → generate → approve → publish
       → run → score → disrupt → repair → notify → complete → duplicate
```

Today, the repository proves these capabilities in several deterministic
reference scenarios. It does not yet prove that every polished surface mutates
the same newly created competition. No “production-ready” or “handles anything”
claim should cross that gap.

## Product boundaries that prevent drift

Keep in the core: workspace isolation, creation, explicit rules, schedule trade-
offs, Guard, live control, repair, participant attention, templates, directories,
completion/export/duplication.

Defer: ratings, partner matching, feeds/chat, social graphics, sponsor inventory,
deep white-labelling, a separately marketed Mac app, and participant app-install
requirements. These can return only when they improve the verified competition
loop for a measured customer need.

## Expert-panel synthesis

> Simulated council — these takes apply published frameworks; they are not the
> named experts' actual review.

- **April Dunford:** position against spreadsheets, WhatsApp groups and manual
  schedule rebuilding. “Universal compiler” is an implementation claim; trusted
  recovery for difficult events is a customer value.
- **Seth Godin:** serve organisers whose complexity genuinely hurts, and respect
  participant attention by sending a useful next action rather than another link.
- **Rory Sutherland:** uncertainty is the participant's real problem. Freshness,
  arrival targets, ambient boards and old-to-new changes reduce the felt cost of
  waiting.
- **Byron Sharp, dissenting:** keep the entry points memorable and broad enough:
  create a tournament, run a league, fix a delayed event, find my next match.
  Use one consistent Krateasy identity.

The synthesis: broad engine capability, narrow first promise, web-first canonical
experience, and proof through live pilots rather than superlatives.
