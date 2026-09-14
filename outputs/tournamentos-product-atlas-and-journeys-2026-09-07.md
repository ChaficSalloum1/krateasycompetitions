# TournamentOS Product Atlas and Journeys

Date: 7 September 2026

## 1. The platform model

TournamentOS is best understood as four layers:

1. **Organiser universe** — an isolated organisation with memberships, roles,
   clubs, persistent directories, seasons, formats, privacy state and backups.
2. **Tournament truth** — immutable definition, plan, operational and actual
   revisions for every tournament.
3. **Universal compiler** — explicit sport semantics, competition structure,
   qualification, resources, scheduling objectives and independent proofs.
4. **Experience and distribution** — organiser control room, official tools,
   participant view, notifications, calendars, scoreboards, exports and media.

The organisation is the tenant boundary. Clubs are scopes within that universe.
A member receives an organisation role and explicit club IDs. Players, teams,
venues, courts, officials, equipment, tournaments, formats, seasons, alerts,
notifications, live state, scores and repair proposals persist inside the
organisation state. Cross-organisation access fails closed.

## 2. Organiser universe hierarchy

```text
Account / verified principal
└── Organisation universe
    ├── Memberships and invitations
    │   └── Owner · Club admin · Director · Operator · Official · Viewer
    ├── Club A
    │   ├── Persistent players and teams
    │   ├── Venues and competition resources
    │   ├── Officials and equipment
    │   ├── Seasons and tournaments
    │   └── Club-default format versions
    ├── Club B
    │   └── Its own scoped records and defaults
    ├── Organisation format and rule-pack library
    ├── Notifications, privacy, recovery and backups
    └── Immutable event/audit history
```

A linked person may have records in more than one organisation, but this should
be a consented identity link—not a shared database row that weakens tenant
isolation. The user-facing organisation switcher is still an important UI layer
to complete.

## 3. Organiser journey

| Stage | Touchpoint | User action | Likely emotion | Main risk | Product opportunity |
|---|---|---|---|---|---|
| Consider | Public site/demo | Tests whether an awkward real format is representable | Sceptical | Generic software overpromises | Interactive format check with an honest capability result |
| Establish | Organisation setup | Creates clubs, roles and defaults | Cautious | Scope and permissions feel abstract | Guided setup with a visible universe map |
| Remember | Directories/library | Imports players, places and approved formats | Relieved | Duplicate/stale records | Reviewable import, merge and provenance tools |
| Create | Six-step wizard | Selects entrants, format, rules, resources and priorities | Focused | Silent assumptions | One question at a time; unresolved policy is explicit |
| Compile | Review workspace | Compares feasible plan, risks and requirements | Delighted or concerned | “Optimal” without evidence | Explain feasibility, trade-offs and counterexamples |
| Publish | Approval | Authorised person publishes one revision | Confident | Accidental or stale publication | Impact preview, separation of duties and receipt |
| Operate | Control room | Checks in, calls, scores and resolves exceptions | Pressured | Hidden downstream damage | Action-first queue and independently validated repair |
| Close | Results/exports | Certifies results and saves the format | Proud | Corrections lose history | Immutable correction lineage and reusable template |
| Advocate | Participant/media | Shares a clear result and recommends the system | Proud | Cheap-looking or incorrect creative | Verified, brand-safe social graphics |

### Critical moments

- **Aha:** the system compiles an unusual event into a feasible, understandable
  draft and names the remaining decisions.
- **Moment of truth:** a court closes and the proposed repair explains every
  affected promise before an authorised operator publishes it.
- **Churn trigger:** setup feels like configuring an engine, or a live repair is
  technically correct but operationally surprising.
- **Advocacy:** participants understand where to be, organisers finish without
  spreadsheet firefighting, and polished verified results are easy to share.

## 4. Tournament-day journeys

### Director

```text
Attention queue → Inspect consequence → Approve/reject → Monitor live state
                → Preview repair → Verify affected people → Publish revision
                → Close tournament → Reuse lessons as a new format version
```

### Court official

```text
Assignment → Call ready contest → Confirm entrants → Record result
           → Correct with reason if needed → Escalate protest/incident
           → Signed operational receipt
```

### Participant

```text
Open personal/QR link → Find next match → Arrive at named place
                      → Receive meaningful change → See verified result
                      → Add to calendar / share result / follow event
```

## 5. How multi-sport composition works

The engine should not contain one giant branch per sport. A governed sport
profile composes independent dimensions:

| Dimension | Examples |
|---|---|
| Entrant unit | Individual, fixed team, pair, relay/team composition |
| Contest semantics | Head-to-head, best-of units, timed result, ranked performance, judged panel |
| Structure | Groups, round robin, knockout, consolation, double elimination, repechage, league |
| Dynamic structure | Swiss, ladder, qualifying heats, time trials, custom graphs |
| Progression | Top N, best runners-up, threshold, wildcard, host place, metric ranking |
| Result policy | Score values, win margin/cap, draws, non-results, retirements, walkovers |
| Ranking | Points, head-to-head, Buchholz, time/distance, aggregate attempts, shared rank |
| Resources | Courts, fields, lanes, boards, equipment, officials and availability |
| Scheduling | Duration, precedence, rest, conflicts, closures, locks, freeze horizon, objectives |
| Governance | Authority, jurisdiction, effective dates, version, approval and proof |

This already supports or exercises materially different families: padel, tennis,
pickleball, badminton, squash, football, chess, athletics, swimming, combat,
golf, motorsport and judged/ranked performance. Coverage is deliberately
classified: an illustrative scoring conformance pack is not represented as a
complete federation-approved rulebook.

The product language should gradually generalise `court` into a competition
resource with sport-appropriate display terms—court, pitch, mat, lane, board,
table, course or stage—while retaining one stable scheduling identity.

## 6. Sponsorship and venue naming

The present directory can name a court. Production sponsorship needs a distinct
commercial presentation layer so a public name never mutates the stable resource
identity.

Recommended model:

```text
Stable resource: venue.harbour.court.1
├── Operational name: Centre Court
├── Public alias: Acme Centre Court
├── Sponsor assignment
│   ├── sponsor / campaign / contract reference
│   ├── effective start and end
│   ├── tournament, division or session scope
│   ├── permitted surfaces and locales
│   └── approval and asset-rights evidence
└── Placement inventory
    ├── schedule and player view
    ├── venue display / call-to-court
    ├── scoreboard and broadcast lower third
    ├── social graphic
    └── exported programme / calendar
```

Commercial inventory opportunities include organisation or league partner,
tournament title sponsor, division sponsor, court/field naming rights, featured
match sponsor, prize partner, scoreboard placement, QR activation, participant
offer and verified delivery reporting.

Guardrails:

- Sponsorship may change presentation but never entrant identity, draw, result,
  resource availability or proof.
- Every assignment is effective-dated, scoped and reversible.
- Asset rights, exclusivity categories, safe zones and youth/privacy rules are
  explicit.
- Operational screens retain a short unambiguous resource label even when the
  public sponsor name is long.

## 7. Verified social graphics

This is an attractive product and distribution opportunity, but it is not yet an
implemented production subsystem.

Recommended pipeline:

```text
Certified publication event
→ deterministic story payload
→ organisation/tournament brand template
→ sponsor placement policy
→ Instagram Story / portrait feed / landscape / venue display variants
→ alt text + preview + rights validation
→ authorised download or connected-channel publication
→ content hash and delivery receipt
```

High-value template families:

- Next match and call-to-court.
- Final score and match result.
- Qualified / through to the next stage.
- Bracket or pool update.
- Champion, finalist and podium.
- Day schedule and court programme.
- Delay, court change or weather notice.
- Sponsor thank-you and post-event statistics.

The renderer should consume certified public DTOs only. It must never generate a
score, invent an opponent, resolve a tie, or publish a stale revision. Text should
remain editable only in non-authoritative headline fields, while score and
competition facts stay locked to the source revision.

## 8. Recommended implementation order

1. Add organisation/club/tournament switcher and complete tenant administration.
2. Generalise venue `court` records into stable competition resources with
   sport-specific labels.
3. Add brand profiles, asset library and public display names.
4. Add sponsor, campaign, rights, placement inventory and effective-dated
   assignments.
5. Build the production schedule/control-room experience and participant links.
6. Add deterministic creative templates generated from certified publications.
7. Add approval, accessible alt text, download and delivery receipts.
8. Add Instagram/channel connections only after the controlled export workflow
   and permissions are proven.

This sequencing keeps the commercial and media layer downstream of authoritative
tournament truth—the safe architecture and also the strongest differentiator.
