# Current status

This is the single statement of where the product stands and what comes next. It replaces any "next step" text in older plans. When this file and another document disagree about status, this file is current. `requirements-traceability.md` holds the evidence for each item below.

## What exists

Once PR #5 is merged, `main` includes the shared organiser shell and design system (PR #4) and the items below.

| Capability | Evidence |
|---|---|
| Engine reliability on realistic club events | Format benchmark in CI: 62/62 cases produce a Guard-passed plan within 10 s, or are refused with the capacity numbers. |
| Formats a new event can use | Round robin, single elimination, and pools into a knockout, within the tested envelope in traceability item 56. |
| Pool ties | Raised for acknowledgement at approval. Decided by the organiser in Run Control before progression (decision record in item 56). |
| Editing a draft | The Studio facts form, and roster add/remove. Times are held in the event's timezone. |
| Changes after approval, before play | "Change before play" creates revision N+1, with a change set against N and an independent approval. |
| Live operation | Check-in, start, score, finish and result receipt, plus guarded no-show, overrun and court-outage repairs, and the court timeline. |
| Close, restore, duplicate | A closure evidence bundle that verifies across amendments, restore on a fresh host, and clean duplication. |
| Golden path | Over HTTP, and in one browser session through the product's own pages: create, publish, run, close. |

## What is not yet proven

1. **Production identity and durability.** The browser golden path uses the in-memory journey on the development server. Real authentication, tenant membership, and a PostgreSQL-backed acceptance journey on a non-production deployment are required.
2. **Visual and accessibility regression.** Behaviour is covered by browser tests at phone and desktop widths. There is no screenshot regression, and no assistive-technology acceptance by a person.
3. **Pilot gates.** Eleven named-owner acceptances in `pilot-release-readiness.ts`. The software reports no blockers of its own; every remaining gate needs a person, a provider or a hosted environment.

## Parallel work

Draft PRs #6–#17 are a separate stacked programme. #6 targets `main`, and each later PR targets the one before it. They contain useful capabilities:
- roster and source composition;
- visible rule provenance;
- pool membership editing;
- per-court windows and stage durations;
- protected court and start locks;
- missing-decision detection;
- a visual structure and rule map.

Their creator is a client-side prototype, separate from the persisted, server-owned Studio journey. They will not be merged as a second creator. Their capabilities are to be brought into the existing Studio journey one at a time, each with the same server-side authority and tests.

## Order of work

The shortest honest route to a hosted pilot is these slices, in order.

1. ~~Merge PR #5 once CI is green.~~ Merged.
2. ~~Finish PR #18 (pool placement).~~ Merged (traceability item 57).
3. **Pilot-critical creation correctness**, brought in from the draft stack and reimplemented on `main`:
   - ~~"keep together" and "keep apart" pool rules~~ (item 59);
   - ~~knockout draws that do what their policy declares, with hierarchical top-seed protection~~ (item 58);
   - ~~roster replacement with stale pool, seed and assignment detection~~ (item 60).
4. **Pilot scheduling controls**, with PRs #13–#16 as reference material:
   - per-court availability windows;
   - stage and round durations;
   - protected start-time locks and protected court assignments;
   - independent verification that the locks hold after recompiling.
5. **Production identity and durable PostgreSQL.** Today the competition journey stores data in a local JSON file, and its organiser routes are disabled in production mode. So this is engineering in the repository, not only a hosting account:
   - sign-in, organisation membership and roles;
   - tenant-isolated Studio routes, and separate people for consequential approvals;
   - a PostgreSQL journey store with migrations, restart and replay, backup and isolated restore;
   - the Studio routes enabled safely in production;
   - the browser golden path run against a hosted non-production deployment.
6. **Interface, design and accessibility (E3)**, refining the connected product rather than redesigning it:
   - the visual rule and structure map;
   - consistent navigation;
   - shared colour tokens in place of page-local colours;
   - an impact preview for live tie decisions;
   - screenshot regression at phone, desktop, 200% and 400%;
   - keyboard, focus, contrast, forced-colour and screen-reader acceptance;
   - loading, permission-denied and stale states.
7. **Operational pilot evidence (E4).** The eleven gates in `pilot-release-readiness.ts`, then the pilot.

After the pilot, the platform programmes are in `ROADMAP.md`. Deferred until then: universal PDF, ZIP and image ingestion; Scenario Lab; more sports; and wider format claims.

## How the other branches are used

| Branch | Use |
|---|---|
| PR #6 | Obsolete documentation reset; not merged. |
| PRs #7–#8 | Salvage individual adversarial and draw-integrity tests, and the missing draw rules. |
| PRs #9–#11 | A client-side creator prototype. Reuse requirements and interaction ideas only. |
| PR #12 | Mostly superseded by PR #18. "Keep together" and "keep apart" remain useful. |
| PRs #13–#16 | Court windows, durations and protected locks. Port selectively. |
| PR #17 | Salvage roster replacement, missing-decision coverage and rule-map ideas. |
| `claude/tender-euler-rbnhkw` | An earlier production experiment (Clerk, PostgreSQL, R2, Resend). Reference for slice 5; not merged or cherry-picked. |
| PR #2 | Its document is already identical on `main`; it can be closed. |
