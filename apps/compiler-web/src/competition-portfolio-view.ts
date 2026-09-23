import type { CompetitionJourneySnapshot } from "./competition-journey.js";
import { COMPETITION_STATES, competitionStateOf, escapeHtml, renderOrganiserHeader, sharedStyles, stateBadge } from "./design-system.js";

const portfolioCss = `.page{width:min(72rem,100%);margin:auto;padding:clamp(1rem,4vw,3rem)}.page-head{display:flex;align-items:end;justify-content:space-between;gap:1rem;border-bottom:1px solid var(--line);padding-bottom:1.5rem}h1{font-size:clamp(2rem,6vw,3.5rem);margin:.25rem 0}.eyebrow{font-size:.75rem;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:var(--accent-ink)}.primary{display:inline-flex;align-items:center;min-height:var(--target);padding:0 1rem;border-radius:var(--radius);background:var(--accent);color:#fff;text-decoration:none;font-weight:750}.primary:active{transform:translateY(1px)}ul.competitions{list-style:none;padding:0;display:grid;gap:.75rem}.competition,.empty,.failure{background:var(--paper);border:1px solid var(--line);border-radius:1rem;padding:1.25rem}.competition{display:flex;align-items:center;justify-content:space-between;gap:1rem}.competition h2{margin:.4rem 0 .2rem}.competition p,.page-head p,.empty p{color:var(--muted)}.open{display:inline-flex;align-items:center;min-height:var(--target);padding:0 1rem;border:1px solid var(--line);border-radius:var(--radius);color:var(--ink);font-weight:700;text-decoration:none;white-space:nowrap}summary{display:flex;align-items:center;gap:.5rem;min-height:var(--target);cursor:pointer;font-weight:650}summary::before{content:"▸";color:var(--muted)}details[open]>summary::before{content:"▾"}@media(max-width:40rem){.page-head,.competition{align-items:start;flex-direction:column}}@media(max-width:20rem){.page{padding-inline:.7rem}.competition,.empty{padding:1rem}}@media print{.primary{display:none}.page{padding:0}.competition{break-inside:avoid}}`;

function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} · Krateasy</title><style>${sharedStyles}${portfolioCss}</style></head><body><a class="skip-link" href="#main">Skip to competitions</a>${renderOrganiserHeader("portfolio")}<main id="main" class="page" tabindex="-1">${body}</main></body></html>`;
}

const pageHead = `<div class="page-head"><div><div class="eyebrow">Organiser</div><h1>Competitions</h1><p>Every competition opens into its authoritative design workspace. Reference demos never appear here.</p></div><a class="primary" href="/create">New competition</a></div>`;

/** The default organiser page: persisted, authorised competitions only, each with one truthful state. */
export function renderCompetitionPortfolio(items: readonly CompetitionJourneySnapshot[]): string {
  const competitions = items.length
    ? items.map((item) => {
      const state = competitionStateOf(item);
      return `<li class="competition" data-competition-state="${state}"><div>${stateBadge(state)}<h2>${escapeHtml(item.name)}</h2><p>${escapeHtml(COMPETITION_STATES[state].description)} Draft version ${item.draftVersion} · published revision ${item.publication?.revision ?? "—"}</p><details><summary>Technical identity</summary><code>${escapeHtml(item.id)}</code></details></div><a class="open" href="/competitions/${encodeURIComponent(item.id)}">Open Studio<span class="visually-hidden"> for ${escapeHtml(item.name)}</span></a></li>`;
    }).join("")
    : `<li class="empty" data-competition-state="EMPTY"><h2>No competitions yet</h2><p>Create one or import a source to start. Reference demos are kept separate and never appear here.</p><a class="primary" href="/create">Create your first competition</a></li>`;
  return page("Competitions", `${pageHead}<ul class="competitions" aria-label="Competitions">${competitions}</ul>`);
}

/** Shown when the authoritative list cannot be read: never an empty list, never demo data. */
export function renderCompetitionPortfolioUnavailable(): string {
  return page("Competitions unavailable", `${pageHead}<div class="failure notice" data-tone="danger" role="alert" data-competition-state="UNAVAILABLE"><h2>${COMPETITION_STATES.UNAVAILABLE.label}: competitions could not be loaded</h2><p>Nothing has changed. The list is not shown rather than risk showing an incomplete one. Reload the page to try again.</p></div>`);
}
