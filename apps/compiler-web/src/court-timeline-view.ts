import type { CourtTimelineProjection } from "./competition-journey.js";
import { courtLabel, escapeHtml, renderOrganiserHeader, runControlHref, sharedStyles, type OrganiserContext } from "./design-system.js";

/**
 * The read-only court timeline (E3): every court's fixtures in time order at one operational revision.
 * It renders on the server with no script and holds no command. Each "report" link opens Run Control's
 * guarded Change Review with the incident preselected; only that review can preview, Guard and approve
 * a change.
 */

type Contest = CourtTimelineProjection["courts"][number]["contests"][number];
export type TimelineChange = "COURT_OUTAGE" | "DELAY_OVERRUN" | "NO_SHOW";

const STATUS_WORDS: Readonly<Record<Contest["status"], string>> = {
  SCHEDULED: "Scheduled", CALLED: "Called", IN_PROGRESS: "In play", COMPLETED: "Completed", WALKOVER: "Walkover", RETIRED: "Retired",
};
const TONE: Readonly<Record<Contest["status"], string>> = {
  SCHEDULED: "neutral", CALLED: "warning", IN_PROGRESS: "positive", COMPLETED: "neutral", WALKOVER: "neutral", RETIRED: "neutral",
};

/** Which guarded changes can be proposed for a fixture in this state; a finished fixture has none. */
export function timelineChangesFor(status: Contest["status"]): readonly TimelineChange[] {
  if (status === "SCHEDULED" || status === "CALLED") return ["DELAY_OVERRUN", "NO_SHOW"];
  if (status === "IN_PROGRESS") return ["DELAY_OVERRUN"];
  return [];
}

/** Run Control's Change Review, preselected for one incident. */
export function changeReviewHref(context: OrganiserContext, change: TimelineChange, subject: { courtId?: string; contestId?: string }): string {
  const base = runControlHref(context);
  if (!base) throw new Error("court_timeline_requires_live_competition");
  const params = new URLSearchParams({ change, ...(subject.courtId ? { court: subject.courtId } : {}), ...(subject.contestId ? { contest: subject.contestId } : {}) });
  return `${base}&${params.toString()}#change-review`;
}

const css = `.page{width:min(96rem,100%);margin:auto;padding:clamp(1rem,3vw,2.5rem)}h1{font-size:clamp(1.8rem,5vw,2.8rem);margin:.25rem 0}.eyebrow{font-size:.75rem;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:var(--accent-ink)}.lede{color:var(--muted);max-width:65ch}.courts{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(17rem,100%),1fr));gap:1rem;margin-top:1.5rem}.court{background:var(--paper);border:1px solid var(--line);border-radius:1rem;padding:1rem;min-width:0}.court-head{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:.5rem;border-bottom:1px solid var(--line);padding-bottom:.5rem}.court h2{margin:0;font-size:1.2rem}ol.fixtures{list-style:none;margin:0;padding:0}.fixture{border-bottom:1px solid var(--line);padding:.75rem 0}.fixture:last-child{border-bottom:0}.fixture time{font-family:var(--mono);font-weight:700}.fixture .sides{margin:.25rem 0;font-weight:650}.fixture[data-status="COMPLETED"] .sides,.fixture[data-status="WALKOVER"] .sides,.fixture[data-status="RETIRED"] .sides{color:var(--muted)}.row{display:flex;flex-wrap:wrap;align-items:center;gap:.5rem}.report{display:inline-flex;align-items:center;min-height:var(--target);padding:0 .75rem;border:1px solid var(--line);border-radius:var(--radius);color:var(--ink);text-decoration:none;font-weight:650;background:var(--paper)}.report:hover{background:var(--canvas)}.actions{display:flex;flex-wrap:wrap;gap:.5rem;margin-top:.5rem}@media print{.report,.actions{display:none}.court{break-inside:avoid}}`;

function page(title: string, context: OrganiserContext | undefined, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} · Krateasy</title><style>${sharedStyles}${css}</style></head><body><a class="skip-link" href="#main">Skip to the court timeline</a>${renderOrganiserHeader("run-control", context)}<main id="main" class="page" tabindex="-1">${body}</main></body></html>`;
}

/** Times in the competition's own timezone, so the board reads the same wherever it is opened. */
function clock(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: timezone }).format(new Date(iso));
}

export function renderCourtTimeline(timeline: CourtTimelineProjection, context: OrganiserContext, timezone: string): string {
  const courts = timeline.courts.map((court, index) => {
    const headingId = `court-${index + 1}`;
    const label = courtLabel(court.courtId);
    const fixtures = court.contests.map((contest) => {
      const sides = contest.participantNames.join(" vs ") || "Sides to be decided";
      const from = clock(contest.startsAt, timezone);
      const window = contest.endsAt ? `<time datetime="${escapeHtml(contest.startsAt)}">${from}</time>–<time datetime="${escapeHtml(contest.endsAt)}">${clock(contest.endsAt, timezone)}</time>`
        : `<time datetime="${escapeHtml(contest.startsAt)}">${from}</time>`;
      const about = `<span class="visually-hidden"> for ${escapeHtml(sides)} at ${from} on ${escapeHtml(label)}</span>`;
      const actions = timelineChangesFor(contest.status).map((change) =>
        `<a class="report" href="${escapeHtml(changeReviewHref(context, change, { contestId: contest.contestId }))}">${change === "NO_SHOW" ? "Report a no-show" : "Report running late"}${about}</a>`).join("");
      return `<li class="fixture" data-contest-id="${escapeHtml(contest.contestId)}" data-status="${contest.status}"><div class="row">${window}<span class="state-badge" data-tone="${TONE[contest.status]}">${STATUS_WORDS[contest.status]}</span></div><p class="sides">${escapeHtml(sides)}</p>${actions ? `<div class="actions">${actions}</div>` : ""}</li>`;
    }).join("");
    return `<section class="court" aria-labelledby="${headingId}" data-court-id="${escapeHtml(court.courtId)}"><div class="court-head"><h2 id="${headingId}">${escapeHtml(label)}</h2><a class="report" href="${escapeHtml(changeReviewHref(context, "COURT_OUTAGE", { courtId: court.courtId }))}">Report court unavailable<span class="visually-hidden">: ${escapeHtml(label)}</span></a></div><ol class="fixtures" aria-label="${escapeHtml(label)} fixtures in time order">${fixtures}</ol></section>`;
  }).join("");
  return page(`Court timeline · ${timeline.competition.name}`, context, `<div class="eyebrow">Run Control · read-only</div><h1>Court timeline</h1><p class="lede">${escapeHtml(timeline.competition.name)} at operational revision ${timeline.operationalRevision} (published revision ${timeline.publishedRevision}). Nothing here changes the plan. Each report opens Run Control's guarded Change Review, where the change is previewed, checked by Guard and approved separately.</p><p><a class="report" href="${escapeHtml(runControlHref(context)!)}">Back to Run Control</a></p><div class="courts">${courts}</div>`);
}

/** Before live activation there is no operational timeline to show. */
export function renderCourtTimelineUnavailable(context: OrganiserContext): string {
  return page("Court timeline unavailable", context, `<div class="eyebrow">Run Control · read-only</div><h1>Court timeline</h1><div class="notice" role="alert" data-competition-state="UNAVAILABLE"><h2>Available after live activation</h2><p>${escapeHtml(context.name)} is not live, so there is no operational timeline yet. The compiled schedule is in the Studio.</p><p><a class="report" href="/competitions/${encodeURIComponent(context.id)}">Open Studio</a></p></div>`);
}
