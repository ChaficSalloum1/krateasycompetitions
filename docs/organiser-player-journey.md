# Krateasy Competitions: organiser and player journey

## Product decision

The participant experience must not depend on installing a PWA, downloading an app, creating an account, or returning to a home-screen icon. A normal browser link is the minimum reliable product surface. Native and PWA installation remain optional retention channels.

The organiser experience must start outside a tournament. The persistent hierarchy is:

```text
Organisation
└── Clubs and venues
    └── Competitions portfolio
        ├── Draft tournament
        ├── Published tournament
        └── Live tournament
            ├── Home
            ├── Run event
            ├── Schedule
            ├── People
            └── Design and verify
```

`All tournaments` and `New tournament` must remain available while an event is open. Opening an event changes context; it must never remove the global exits.

## Persona 1: event director

**Persona:** an experienced club operator running a 40–100-player event while also answering questions, handling check-in, coordinating coaches, and reacting to courts running late.

**Job to be done:** “Help me make the event run fairly and on time without keeping the entire schedule in my head.”

| Stage | Touchpoint | User action | Emotion | Pain point | Product response |
|---|---|---|---|---|---|
| Return | Competition portfolio | See all drafts, upcoming and live events | Oriented | Dropping directly into an old event feels like a locked demo | Start at the portfolio; preserve global exits |
| Create | Guided sheet | Define basics, people, format, rules, resources and priorities | In control | Blank-canvas configuration exposes system complexity | Progressive disclosure with an explicit review step |
| Verify | Compiler and schedule review | Resolve ambiguity and compare valid plans | Cautious | “AI generated” does not explain correctness | Show assumptions, findings, hard constraints and proof state |
| Publish | Approval gate | Approve one exact revision | Confident | Edits can silently invalidate a public schedule | Bind publication to the approved, certified revision |
| Operate | Control room | Work now, next, late, blocked and missing-result queues | Focused | Generic dashboards make everything equally loud | Prioritise exceptions and the next action |
| Recover | What-if repair | Remove a court, delay a match or process a withdrawal | Under pressure | Rebuilding a schedule causes widespread disruption | Preview minimum-disruption repair and its blast radius |
| Close | Results and evidence | Finalise results, exports and participant history | Relieved | Final state can diverge from published history | Deterministic replay and immutable publication evidence |

### Critical moments

- **Aha moment:** the first valid schedule includes an explanation of rest, resource and progression decisions.
- **Moment of truth:** a live disruption is repaired without breaking player rest or moving unaffected matches.
- **Churn trigger:** the organiser cannot tell how to leave an event, create another one, or distinguish demo data from authoritative data.

## Persona 2: tournament participant

**Persona:** a player at a social or competitive club event who is talking with friends, warming up, eating, or away from the desk and does not want another app.

**Job to be done:** “Tell me when and where I play next, and alert me only if it changes.”

| Stage | Touchpoint | User action | Emotion | Pain point | Product response |
|---|---|---|---|---|---|
| Join | Registration confirmation | Receive personal event link | Reassured | Link gets lost before event day | Resend on the morning of the event |
| Arrive | Entrance, desk and court QR | Scan once | Busy | Add-to-home-screen prompts feel like work | Open directly in the browser with no account gate |
| Identify | Personal token or name search | Confirm player/team | Impatient | Full schedule is hard to scan on a phone | Put “your next match” above everything else |
| Prepare | Personal next-match page | See time, court, opponent and arrival target | Clear | Published start may be stale during overruns | Show live effective time and last-updated state |
| Change | Browser/SMS/WhatsApp notification | Read a targeted update | Trusting | Broadcast messages create noise and are ignored | Notify only affected participants; include old and new details |
| Play again | Same browser link | Return after a result | Habitual | Re-searching every round adds friction | Keep identity in an opaque, expiring link |
| Finish | Results card | View and share result/history | Proud | Event products disappear after the final | Add result history and shareable outcome card |

### Critical moments

- **Aha moment:** a QR scan shows the correct next court in under ten seconds.
- **Moment of truth:** a court change reaches the affected player before they walk to the wrong court.
- **Churn trigger:** the product asks for installation, login, notification permission and profile setup before answering the next-match question.

## Match Beacon delivery ladder

1. **Universal entry:** one event QR at reception, on every court sign and in organiser messages.
2. **Private identity:** preferred production path is a signed, opaque participant link. Name search is a fallback and must be rate-limited to prevent schedule enumeration.
3. **Dominant answer:** next effective start, arrival target, sponsor/venue-facing court name, opponent or qualification dependency, and freshness indicator.
4. **Optional retention:** browser notifications, Add to Wallet, calendar subscription, PWA or Krateasy app deep link only after the answer is visible.
5. **Delivery fallback:** SMS or WhatsApp for material changes; email for non-urgent summaries; public display and announcer queue for on-site redundancy.
6. **Desk relief:** staff player lookup answers the same question from the same authoritative projection.

## Operating metrics

- Median time from QR scan to visible next match: **under 10 seconds**.
- “When is my next match?” desk questions: measure per 100 participants and target a **70% reduction** in the first pilot.
- Material schedule-change delivery: track acknowledged, delivered, failed and fallback status separately.
- Stale detail incidents: **zero** after an approved repair.
- Player identity leakage or cross-participant token access: **zero**.
- Install conversion is a secondary metric; successful next-match retrieval is the primary metric.

## Production boundary

The current install-free `/player` surface is a local product preview backed by the certified reference schedule. Production requires a public read model keyed by signed participant tokens, event-scoped rate limiting, token rotation/revocation, privacy-safe analytics, live refresh, and durable notification delivery. It must never expose the organiser API or rely on unbounded name search.
