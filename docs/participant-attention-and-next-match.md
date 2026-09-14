# Participant attention and next-match system

Date: 2026-09-14

## Decision

Keep Krateasy Competitions separate from the existing Krateasy mobile app for the
pilot. Do not require an app install or “Add to Home Screen”. Do not require a
participant to reopen an old link to learn what happens next.

The system must deliver the answer through three redundant paths:

1. **Push the answer** into the participant's existing communication channel.
2. **Let them recover the answer** from one universal event URL or QR code.
3. **Show the answer ambiently** on venue displays and a desk/operator view.

The personal web page remains the authoritative detail view. It is no longer the
only mechanism carrying the information.

## The user and job

**Persona:** a participant who registered as part of a pair, is socialising or
warming up at the venue, has several WhatsApp threads open, and does not want to
install or learn another product.

**Job:** “Tell me where I need to be and when, and interrupt me only when that
answer becomes important or changes.”

## Why the previous link failed

The observed behaviour is evidence, not user error:

- A link asks the participant to remember that a separate information system exists.
- A pre-event link has little immediate value and disappears inside a chat history.
- Pair-level links may be sent to only one partner or forwarded without context.
- A participant wants the answer, not a dashboard.
- During an event, conversation, warm-up and matches compete for attention.
- If the schedule changes, participants stop trusting a previously opened page.
- “Add to Home Screen” is setup work before value and should not be required.

## The attention model

```text
CERTIFIED COMPETITION TRUTH
            │
            ├── Proactive update
            │     WhatsApp / SMS / email contains time, arrival target and court
            │
            ├── Universal recovery
            │     event URL / venue QR → find pair → personal next-match page
            │
            └── Ambient recovery
                  lobby screen / court screen / desk lookup
```

All three are projections of the same published revision. None calculates its
own schedule.

## The message is the product

A participant should be able to act without opening the link.

### Initial confirmation

```text
Play & Konnect: Pair 7 is checked in for the Autumn Padel Open.
First match: 12:30, Court 4. Please arrive by 12:20.
Live details: [personal link]
```

### Next-match reminder

Trigger when the match becomes confirmed and is within the organisation's
approved reminder window, for example 30 minutes.

```text
Play & Konnect: You are up at 14:20 on Court Alpha.
Pair 7 vs Pair 12. Please be courtside by 14:10.
Live details: [personal link]
```

### Court-ready call

Send only when the operator marks the court and both match inputs ready.

```text
Play & Konnect: Court Alpha is ready now for Pair 7 vs Pair 12.
Please go directly to the court. [personal link]
```

### Material change

Show both old and new truth. The live-change workflow already calculates the
affected participants; only those participants receive the approved update.

```text
Play & Konnect update: Your 14:20 match has moved.
New: 14:35, Court 2. Previous: 14:20, Court Alpha.
Please arrive by 14:25. [personal link]
```

### Result and newly known progression

```text
Play & Konnect: Result recorded — Pair 7 won 6-4.
Your next match is now confirmed: 15:10, Court 3. Arrive by 15:00.
[personal link]
```

Do not send “your schedule changed” or “click to see your next match.” The useful
facts belong in the message body. The link provides provenance, later matches,
map, rules and the latest revision.

## Universal venue recovery

Use one memorable route for the entire event:

```text
play-and-konnect.com/next
```

Place its QR code at reception, every court entrance, the warm-up area, café and
score desk. It opens immediately in the browser and offers:

1. **Find my pair** — search the pair/player name or enter a short event code.
2. **What is on now?** — public court board.
3. **What is next?** — public next-up board.

After a participant chooses their pair once, store only the opaque participant
token on that device. Subsequent scans open their next match directly. Provide a
visible **Not me / change pair** action.

Public name search is a policy choice. For privacy-sensitive events, use a short
pair code printed on check-in material or delivered in the initial message. Never
expose phone numbers, email addresses, eligibility notes or private roster data.

## Ambient venue recovery

The product also needs a display mode because not everyone will scan or read:

- **On court now** by court.
- **Called to court** with a clear visual state.
- **Up next** with an arrival target.
- **Delayed or moved** showing the effective time and court.
- Optional spoken desk announcement for a court-ready call.

Display names can include a sponsor, but the stable operational court identity
must remain visible and unambiguous, for example `Court 2 · Alpha Finance`.

## Participant journey map

| Stage | Touchpoint | Participant action | Likely emotion | Failure to remove | Product response |
|---|---|---|---|---|---|
| Registration | Form or organiser import | Supplies pair and contact route | Neutral | Contact belongs to one partner only | Capture delivery preference and both partners where permitted. |
| Confirmation | WhatsApp/SMS/email | Reads first time and arrival target | Reassured | Generic “view tournament” link | Put actionable facts in the message. |
| Arrival | Venue QR/check-in | Finds pair once | Busy | Account or app-install gate | Browser lookup plus short pair code. |
| Between matches | Proactive reminder | Warms up and arrives courtside | Confident | Must repeatedly refresh a page | Send only confirmed, time-sensitive next actions. |
| Court ready | Message plus display | Goes to named court | Urgent | Message lacks precise court or opponent | One unambiguous action and one effective revision. |
| Disruption | Targeted change | Adjusts arrival/court | Initially frustrated | Old information remains plausible | Show old → new, timestamp and affected action. |
| Completion | Result message/page | Confirms result and next dependency | Satisfied or attentive | Result exists but next consequence is unclear | Combine result with next known action. |

### Aha moment

The participant receives “14:20, Court Alpha, arrive 14:10” in the same channel
they already check, without opening or installing anything.

### Moments of truth

- The first published schedule message must be immediately useful.
- A changed court or time must reach only affected people quickly and clearly.
- The venue QR must recover a participant's answer in less than 20 seconds.
- A correction must supersede, not coexist ambiguously with, an earlier update.

### Churn and trust triggers

- Too many low-value messages.
- A notification arriving after the new start time.
- Different answers on WhatsApp, the website and the venue display.
- Asking for notification permission, an account or an install before showing value.
- Links that expire during the event without a recovery route.

## Communication policy

Separate operational communication from marketing.

- Ask for the minimum permission necessary during registration/check-in.
- Record channel, consent or other lawful basis, disclosure version, timestamp and
  withdrawal state as required for the jurisdiction and provider.
- Support an immediate mute/stop path and a change-channel path.
- Use recipient-local quiet hours for non-urgent messages.
- Treat a material live-event change differently from promotional communication,
  but obtain jurisdiction-specific legal review before launch.
- Do not place sensitive personal data in message bodies or URLs.

WhatsApp, SMS and email are delivery adapters. The platform creates one canonical,
version-bound communication intent; providers report accepted, delivered, failed
or unknown. An accepted provider request is not proof that the participant read it.

## Trigger and deduplication rules

Every communication intent binds:

- organisation ID;
- competition ID;
- recipient or pair ID;
- published revision and live-operation version;
- message purpose;
- effective contest, time and resource;
- idempotency key;
- approval provenance when the message follows a material repair.

Do not resend when the actionable facts are identical. When facts change, create
a superseding communication that explicitly identifies the old and new values.
Provider retries reuse the same idempotency key.

## Operator experience

The Run event screen needs a compact communication state, not a marketing console:

```text
Pair 7 · next at 14:20 Court Alpha
WhatsApp delivered 13:51 · SMS fallback not needed
[Preview personal page] [Resend] [Change channel]
```

The operator should see:

- people with no usable delivery channel;
- queued, accepted, delivered, failed and unknown messages;
- participants whose next match changed but have no successful update;
- which fallback was used;
- last authoritative version communicated.

The system must never claim “player informed” merely because a provider accepted
the message.

## Pilot implementation sequence

1. Add a universal `/next` lookup route and venue QR assets.
2. Replace link-only templates with answer-in-message templates.
3. Add reminder, court-ready, material-change and result/progression intents.
4. Connect one WhatsApp-capable transactional provider and email fallback; add SMS
   only where delivery value justifies its cost and compliance work.
5. Add participant-token persistence in the browser and `Not me` recovery.
6. Add a venue display mode driven by the same public read model.
7. Add operator delivery state and failed-contact alerts.
8. Rehearse with staff and test a complete event using manual announcement fallback.

## Success measures

The primary outcome is not link-open rate. It is fewer moments of participant
uncertainty.

- Desk questions asking “when/where is my next match” per 100 participants.
- Percentage of confirmed next matches with an on-time successful delivery or
  acknowledged fallback.
- Median time to recover an answer through the venue QR.
- Late starts attributable to participant communication.
- Duplicate or contradictory messages: target zero.
- Stale public/message/display disagreements: target zero.
- Opt-out/mute rate and messages per participant.
- Percentage of participants who complete the event without installing anything.

## Scope boundary

This is a competition-operations capability, so it belongs in the active product.
It does not require integrating with the existing Krateasy mobile app. It also
does not justify building chat, a social feed or a general messaging product.

