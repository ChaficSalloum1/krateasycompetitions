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

1. Merge PR #5 once CI is green.
2. Bring the valuable creator capabilities from #6–#17 into the server-owned Studio, one at a time.
3. Production identity, tenant membership and durable PostgreSQL, proven by the golden path against a non-production deployment.
4. Visual and accessibility regression on the connected pages.
5. Pilot gates, then the St Albans pilot.

No new feature branches until step 1 is done.
