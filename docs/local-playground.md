# Krateasy Competitions local playground

Date: 2026-09-14

## Start it

From the repository root:

```bash
npm install
npm start
```

Open `http://127.0.0.1:4173`.

This is a local product rehearsal. It does not contact WhatsApp, email or SMS
providers, charge money, or publish anything to the internet.

## Five-minute product rehearsal

1. Open `/` and choose **Start 5-minute rehearsal**.
2. Compare the two valid schedule options and inspect why each one is valid.
3. Choose **Publish certified plan**. The Guard binds the exact definition,
   graph, schedule and dry-run evidence.
4. Choose **Preview court outage**. The original published schedule remains
   authoritative while the minimum-change alternative is calculated.
5. Choose **Approve minimal repair**. The demonstration uses a separate
   tournament-director identity for approval.
6. Open `/attention`. Test a delivery success, test a delivery failure, and
   call a pair to court. No provider is contacted.
7. Open `/display` and confirm the called state appears on the venue board.
8. Open `/next`, search for `Beginner Pair 1`, and confirm the browser remembers
   the opaque participant route. Use **Not my pair** to recover.
9. Return to `/attention` and use **Reset rehearsal** to repeat the attention
   exercise.

The publication-and-repair journey and the 98-contest attention schedule are
currently two clearly labelled, deterministic rehearsal projections of the same
Play & Konnect specification. They are not yet a claim that an approved repair
from the first projection has mutated every participant projection in the second.
Making one newly created competition flow through every surface is the next
integration gate.

## Useful routes

| Route | Audience | Purpose |
|---|---|---|
| `/` | Organiser | Workspace, creation, rehearsal, run view and evidence |
| `/#journey` | Organiser | Guarded publication and minimum-change repair |
| `/attention` | Desk/operator | Delivery rehearsal, fallback queue and court calls |
| `/next` | Participant | No-install personal next-match finder |
| `/display` | Venue | High-contrast ambient order-of-play display |
| `/health/live` | Operator | Process liveness |
| `/health/ready` | Operator | Dependency/readiness state |

## Test it on a phone on the same Wi-Fi

Start the server on the local network:

```bash
HOST=0.0.0.0 npm start
```

Find the Mac's private Wi-Fi address in **System Settings → Wi-Fi → Details →
TCP/IP**. On the phone, open:

```text
http://MAC_PRIVATE_IP:4173/next
```

Use this only on a trusted local network. macOS may ask whether Node can accept
incoming connections. The QR generated through that network address will point
back to the same host.

## What is intentionally simulated

- Delivery outcomes and fallback states.
- Court-ready calls.
- The venue display clock relative to a fixed historical rehearsal schedule.
- The Play & Konnect publication and Centre Court outage.
- Demo organisation, clubs, roles, people and tournaments.

Production must replace the local aggregate snapshot with separate authenticated
operator, rate-limited lookup, signed participant-token and public-display APIs.
Provider acceptance, delivery and participant acknowledgement must remain
distinct states.
