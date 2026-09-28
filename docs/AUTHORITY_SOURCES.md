# Authority source record and precedence

Status: ACTIVE. Recorded 2026-09-27 for Ticket 1 / A1.

## Sole requirements for this reset

1. **Krateasy Competitions — Finite Migration and Implementation Plan**, supplied by the user in this conversation: sections 0–10, phases A–N, immediate tickets 1–3, per-slice protocol and stop conditions.
2. **Krateasy Competitions — Canonical Domain, State & Rule Contract**, supplied in the same message: sections 1–27, truth/revision model, universes, entities, module contracts, invariants, failures and mutation protocol.
3. The user's instruction to follow these documents in exact order and exclude material from other chats.

This record identifies provenance; it does not pretend the linked repository files are verbatim source copies. They are self-contained operational transcriptions. No other chat, memory-derived P&K roster/rule, browser prototype, prior test-count report or unprovided document has been promoted to requirements. Mentions in the supplied text of MASTER_VISION.md, v3 research and the P&K platform plan do not silently import their full contents as authority. Missing source material stays a named evidence gap for the relevant slice.

## Precedence and reconciliation

The supplied domain contract controls semantics; the finite plan controls scope/order/exit gates. PRODUCT, DOMAIN, ARCHITECTURE, MODULE_CONTRACTS, BUILD_PLAN and TELEMETRY express those concerns; CLAUDE/AGENTS route agents, FUTURE holds deferred work. DOCUMENT_REGISTRY and A1_EXIT_GATE are governance/evidence records, not additional roadmaps.

No reference or archive document independently authorises features. Existing code and tests establish current behaviour, not permission to contradict domain requirements. Record discrepancies and resolve them in the responsible slice; retain existing security/correctness protections. An approved architecture decision must explicitly identify any superseded clause; no such semantic exception is made by A1.

The plan's A1 list includes MODULE_CONTRACTS.md although the shorter Ticket 1 deliverables omit it. Include it to satisfy the fuller requirement. Ticket 1 says no product-code changes and each prompt stops at its slice; therefore this change set stops after A1. A1 pass does not imply A3 or whole Phase A pass.

## Coverage map

| Supplied sections | Repository authority |
|---|---|
| Plan 0–2: destination/repositories/bridge | PRODUCT.md; ARCHITECTURE.md |
| Plan 3–4 and all A–N gates | BUILD_PLAN.md; MODULE_CONTRACTS.md |
| Plan 5–6: finite ending/repository work | PRODUCT.md; BUILD_PLAN.md; FUTURE.md |
| Plan 7–8: tickets and scope control | BUILD_PLAN.md; CLAUDE.md; A1_EXIT_GATE.md |
| Plan 9–10: end-to-end outcome | PRODUCT.md; ordered programme in BUILD_PLAN.md |
| Domain 1–6: truth/revision/universes/entities | DOMAIN.md sections 1–6 |
| Domain 7–15: source through scheduling | DOMAIN.md sections 7–15; MODULE_CONTRACTS.md |
| Domain 16–23: scenarios/assurance/Guard/publication/change/runtime/recovery/evidence | DOMAIN.md sections 16–23; MODULE_CONTRACTS.md |
| Domain 24–27: failures/mutation/module/test discipline | DOMAIN.md sections 24–27; CLAUDE.md |
| Named telemetry and pipeline envelopes | TELEMETRY.md |

## Existing material assessment

Inventory baseline: `71b7160b60295d8f43aba9ba51cd221dc8a4b146` in `ChaficSalloum1/krateasycompetitions`.

The review inventories all tracked Markdown and the tracked PDF report, then reads governing hierarchy passages and relevant technical ownership contracts (source agent brief, master product hierarchy, Guard publication, live-change, structure-edit acceptance and deployment runbook). It does not claim a line-by-line verification of every archived report or a fresh correctness audit of code. All files receive a category and rationale in DOCUMENT_REGISTRY. Versioned dependency requirement/constraint text files are executable configuration, not planning documents, and are untouched.

## In-conversation clarification — 2026-09-28

The user explicitly requires participant/pair/pool/division changes, including pool and division counts, to drive automatic guarded bracket/schedule reconfiguration. `G_RECONFIGURATION_ACCEPTANCE.md` records that acceptance clarification under the existing Phase G. It imports no other-chat rules and changes no preceding gate status.
