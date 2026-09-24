import type { CompetitionJourneySnapshot } from "./competition-journey.js";

/**
 * The single web design system (apps/compiler-web/DESIGN.md): one token set, one accessibility
 * baseline, one vocabulary of competition states and one organiser navigation model. Pages compose
 * these instead of defining their own palette, fonts or route links.
 */

/** Marks a page as built on the shared system; tests use it to find pages that are not. */
export const DESIGN_SYSTEM_ID = "krateasy-web-1";

/**
 * DESIGN.md tokens. The aliases keep existing page stylesheets working while they all resolve to the
 * same values: one canvas, one surface, one ink, one muted slate and one accent (Signal Terracotta, deepened
 * from DESIGN.md's #C95635 to #B74E30 so text and white-on-accent buttons meet WCAG AA 4.5:1).
 * Green, amber and red are semantic status colours only.
 */
export const designTokensCss = `:root{color-scheme:light;--canvas:#f4f2ec;--paper:#fffdf8;--ink:#17201d;--muted:#65706b;--line:#d8d7cf;--accent:#b74e30;--accent-ink:#9b3d26;--positive:#176b48;--positive-soft:#e7f4ed;--warning:#8b5a10;--warning-soft:#fbf1dc;--danger:#9a3124;--danger-soft:#fbeae6;--surface:var(--paper);--bg:var(--canvas);--terracotta:var(--accent);--green:var(--positive);--green-soft:var(--positive-soft);--green2:var(--positive-soft);--warn:var(--warning);--error:var(--danger);--radius:10px;--target:44px;--mono:"Geist Mono",ui-monospace,SFMono-Regular,Menlo,monospace;font-family:Geist,"Avenir Next",-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:var(--ink);background:var(--canvas)}`;

/** Accessibility baseline and the shared header, navigation, badge and notice components. */
export const baseCss = `*,*::before,*::after{box-sizing:border-box}body{margin:0;background:var(--canvas);color:var(--ink);overflow-wrap:anywhere}code,kbd,samp{font-family:var(--mono)}:focus-visible{outline:3px solid var(--accent);outline-offset:3px}.skip-link{position:absolute;left:-999px;top:.75rem;z-index:10;background:var(--paper);color:var(--ink);padding:.75rem 1rem;border:2px solid var(--accent);border-radius:var(--radius)}.skip-link:focus{left:1rem}.app-header{display:flex;flex-wrap:wrap;align-items:center;gap:.5rem 1.25rem;padding:.75rem clamp(1rem,4vw,2rem);background:var(--paper);border-bottom:1px solid var(--line)}.app-brand{font-weight:800;color:var(--ink);text-decoration:none;min-height:var(--target);display:inline-flex;align-items:center}.app-nav{display:flex;flex-wrap:wrap;gap:.25rem}.app-nav a,.app-nav .unavailable{display:inline-flex;align-items:center;min-height:var(--target);padding:0 .75rem;border-radius:var(--radius);color:var(--ink);text-decoration:none;font-weight:650;white-space:nowrap}.app-nav a:hover{background:var(--canvas)}.app-nav a[aria-current="page"]{background:var(--ink);color:var(--paper)}.app-nav .unavailable{color:var(--muted);font-weight:500}.app-nav-group{display:contents}.app-context{color:var(--muted);font-size:.9rem}@media(max-width:40rem){.app-header{gap:.25rem;padding:.5rem .75rem}.app-brand{margin-right:.25rem}.app-nav{display:contents}.app-nav-group{display:flex;flex-wrap:wrap;gap:.25rem}.app-nav-group+.app-nav-group{flex-basis:100%}.app-nav a,.app-nav .unavailable{padding:0 .5rem}@media(max-width:22rem){.app-nav-group{gap:.125rem}.app-nav a,.app-nav .unavailable{padding:0 .25rem}}.short-cap{display:inline-block}.short-cap::first-letter{text-transform:uppercase}.short-hide,.app-context{position:absolute!important;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}}.state-badge{display:inline-flex;align-items:center;gap:.35rem;padding:.2rem .6rem;border-radius:999px;border:1px solid currentColor;font-size:.8rem;font-weight:750;letter-spacing:.01em}.state-badge[data-tone="neutral"]{color:var(--ink)}.state-badge[data-tone="positive"]{color:var(--positive);background:var(--positive-soft)}.state-badge[data-tone="warning"]{color:var(--warning);background:var(--warning-soft)}.state-badge[data-tone="danger"]{color:var(--danger);background:var(--danger-soft)}.state-badge[data-tone="accent"]{color:var(--accent-ink);background:var(--paper)}.notice{border:1px solid var(--line);border-left:4px solid var(--warning);background:var(--paper);padding:.75rem 1rem;border-radius:var(--radius)}.notice[data-tone="danger"]{border-left-color:var(--danger)}.visually-hidden{position:absolute!important;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}}@media(prefers-contrast:more){:root{--muted:#3f4a45;--line:#17201d}}@media(forced-colors:active){.state-badge,.app-nav a[aria-current="page"],.notice{border:2px solid CanvasText;forced-color-adjust:none;background:Canvas;color:CanvasText}}@media print{.skip-link,.app-nav{display:none}}`;

/**
 * The one sanctioned variant: the venue display is a large, dark screen read from across a hall. It
 * re-points the shared tokens rather than defining a separate palette.
 */
export const venueDisplayThemeCss = `/*${DESIGN_SYSTEM_ID}:venue-display*/:root{color-scheme:dark;--ink:#f4f5f2;--muted:#aab3af;--canvas:#101916;--bg:#101916;--paper:#17241f;--surface:#17241f;--line:#304039;--accent:#63d5aa}`;

/** The one stylesheet prefix every product page includes, before its own layout rules. */
export const sharedStyles = `/*${DESIGN_SYSTEM_ID}*/${designTokensCss}${baseCss}`;

export const escapeHtml = (value: unknown): string => String(value ?? "").replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;",
})[character]!);

/**
 * A court's display name from its resource identity: "venue.courts.3" reads "Court 3". Identities are
 * never shown to people; anything unrecognised falls back to its last segment. Serialised into page
 * scripts, so it must stay self-contained.
 */
export function courtLabel(resourceId: string): string {
  const numbered = /(?:^|[.\s_-])courts?(?:[.\s_-][a-z]+)*[.\s_-]?0*(\d+)$/i.exec(String(resourceId));
  if (numbered) return `Court ${Number(numbered[1])}`;
  const last = String(resourceId).split(".").at(-1) ?? String(resourceId);
  return last.replace(/[_-]+/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

export type CompetitionStateKey = "NEEDS_INPUT" | "DRAFT" | "BLOCKED" | "CERTIFIED" | "PUBLISHED" | "LIVE" | "CLOSED"
  | "STALE" | "DEMO" | "UNAVAILABLE";

/** One label vocabulary for every surface; meaning is always carried by words, never colour alone. */
export const COMPETITION_STATES: Readonly<Record<CompetitionStateKey, {
  readonly label: string; readonly tone: "neutral" | "positive" | "warning" | "danger" | "accent"; readonly description: string;
}>> = Object.freeze({
  NEEDS_INPUT: { label: "Needs input", tone: "warning", description: "Required facts are missing or in conflict before it can be compiled." },
  DRAFT: { label: "Draft", tone: "neutral", description: "Complete and ready to compile." },
  BLOCKED: { label: "Blocked by Guard", tone: "danger", description: "The compiled plan has findings that block approval." },
  CERTIFIED: { label: "Certified", tone: "accent", description: "Guard passed; waiting for separate approval and publication." },
  PUBLISHED: { label: "Published", tone: "positive", description: "An exact approved revision is published and can go live." },
  LIVE: { label: "Live", tone: "positive", description: "Play is running from the published revision." },
  CLOSED: { label: "Closed", tone: "neutral", description: "Finished, sealed and exportable." },
  STALE: { label: "Stale", tone: "warning", description: "Showing the last known state; the latest update could not be loaded." },
  DEMO: { label: "Reference demo", tone: "warning", description: "An isolated example, not a real competition." },
  UNAVAILABLE: { label: "Unavailable", tone: "danger", description: "This information cannot be loaded right now." },
});

/** Derives the display state from the authoritative snapshot; a published competition with live play is Live. */
export function competitionStateOf(snapshot: Pick<CompetitionJourneySnapshot, "status" | "live">): CompetitionStateKey {
  switch (snapshot.status) {
    case "NEEDS_INPUT": return "NEEDS_INPUT";
    case "DRAFT": return "DRAFT";
    case "GUARD_BLOCKED": return "BLOCKED";
    case "READY_FOR_APPROVAL": return "CERTIFIED";
    case "PUBLISHED": return snapshot.live ? "LIVE" : "PUBLISHED";
    case "CLOSED": return "CLOSED";
  }
}

export function stateBadge(key: CompetitionStateKey): string {
  const state = COMPETITION_STATES[key];
  return `<span class="state-badge" data-state="${key}" data-tone="${state.tone}" title="${escapeHtml(state.description)}">${escapeHtml(state.label)}</span>`;
}

export type OrganiserRoute = "portfolio" | "create" | "studio" | "preflight" | "run-control" | "receipt";

export interface OrganiserContext {
  readonly id: string;
  readonly name: string;
  /** The live operational revision, or null before live activation (Run Control needs it). */
  readonly operationalRevision: number | null;
  /** Whether a compiled plan exists (Guard pre-flight needs it). */
  readonly compiled: boolean;
}

/** Everything the organiser navigation needs from an authoritative snapshot. */
export function organiserContextOf(snapshot: CompetitionJourneySnapshot): OrganiserContext {
  const live = snapshot.live as { readonly publication?: { readonly revision?: number } } | null;
  const operationalRevision = snapshot.live && snapshot.status !== "CLOSED"
    ? live?.publication?.revision ?? snapshot.publication?.revision ?? null : null;
  return { id: snapshot.id, name: snapshot.name, operationalRevision, compiled: Boolean(snapshot.compiled) };
}

/** Run Control for the live operational revision, or null before live activation. */
export function runControlHref(competition: OrganiserContext): string | null {
  return competition.operationalRevision === null ? null
    : `/attention?competition=${encodeURIComponent(competition.id)}&revision=${competition.operationalRevision}`;
}

export interface NextAction {
  readonly label: string;
  readonly href: string;
  /** Why this is the next step, in the organiser's words; counts come from the snapshot, never invented. */
  readonly detail: string;
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/**
 * The one next step for a competition, derived only from its authoritative state. It names where the
 * step happens; it never performs it, so approval, publication and activation stay separate commands.
 */
export function nextActionOf(snapshot: CompetitionJourneySnapshot): NextAction {
  const context = organiserContextOf(snapshot);
  const studio = `/competitions/${encodeURIComponent(snapshot.id)}`;
  switch (competitionStateOf(snapshot)) {
    case "NEEDS_INPUT": {
      // Source imports copy each proposal question into the workbench's missing decisions, so count each prompt once.
      const open = new Set([...snapshot.questions.map(({ prompt }) => prompt), ...snapshot.workbench.missingDecisions.map(({ prompt }) => prompt)]).size
        + snapshot.workbench.conflicts.length;
      return { label: "Answer open questions", href: studio,
        detail: open ? `${plural(open, "decision", "decisions")} needed before it can be compiled.` : "Resolve what the Studio lists before it can be compiled." };
    }
    case "DRAFT": return { label: "Compile and check", href: studio, detail: "Complete. Compile it to have Guard check the plan." };
    case "BLOCKED": return { label: "Review Guard findings", href: `${studio}/preflight`, detail: "Guard found problems that block approval." };
    case "CERTIFIED": return { label: "Approve and publish", href: studio, detail: "Guard passed. It needs separate approval before anyone sees it." };
    case "PUBLISHED": return { label: "Go live", href: studio, detail: `Published revision ${snapshot.publication?.revision ?? "—"} is ready for play to start.` };
    case "LIVE": return { label: "Open Run Control", href: runControlHref(context) ?? studio, detail: `Play is running from published revision ${context.operationalRevision ?? "—"}.` };
    case "CLOSED": return { label: "View close receipt", href: `${studio}/receipt`, detail: "Finished and sealed. The receipt holds the final record." };
    default: return { label: "Open Studio", href: studio, detail: "" };
  }
}

/**
 * The one organiser navigation model. Portfolio and New competition are always present; inside a
 * competition, its Studio, Guard pre-flight, Run Control and Close receipt follow. A route that does not
 * apply yet is named but not linked, so the set of places never changes shape.
 *
 * On narrow screens the header needs no script (the portfolio and pre-flight pages run none): the two
 * groups sit on two rows and long labels shorten visually, while each accessible name stays whole and
 * contains the visible text (WCAG 2.5.3 Label in Name). Close receipt shortens to "receipt", never to "Close".
 */
export function renderOrganiserHeader(current: OrganiserRoute, competition?: OrganiserContext): string {
  /**
   * A label whose parts phones hide visually; screen readers always hear the full label. The parts share
   * one inline wrapper so the flex link keeps the spaces between them.
   */
  const label = (shown: string, hiddenAfter = "", hiddenBefore = "") => {
    if (!hiddenAfter && !hiddenBefore) return escapeHtml(shown);
    const hide = (text: string) => text ? `<span class="short-hide">${escapeHtml(text)}</span>` : "";
    const visible = hiddenBefore ? `<span class="short-cap">${escapeHtml(shown)}</span>` : escapeHtml(shown);
    return `<span class="nav-label">${hide(hiddenBefore)}${visible}${hide(hiddenAfter)}</span>`;
  };
  const link = (route: OrganiserRoute, href: string, text: string) =>
    `<a href="${escapeHtml(href)}"${route === current ? " aria-current=\"page\"" : ""}>${text}</a>`;
  const unavailable = (text: string, reason: string) =>
    `<span class="unavailable" title="${escapeHtml(reason)}">${text}<span class="visually-hidden"> (${escapeHtml(reason)})</span></span>`;
  const global = [link("portfolio", "/", label("Competitions")), link("create", "/create", label("New", " competition"))];
  const inside: string[] = [];
  if (competition) {
    const base = `/competitions/${encodeURIComponent(competition.id)}`;
    inside.push(link("studio", base, label("Studio")));
    inside.push(competition.compiled ? link("preflight", `${base}/preflight`, label("Guard", " pre-flight"))
      : unavailable(label("Guard", " pre-flight"), "after compilation"));
    inside.push(competition.operationalRevision === null ? unavailable(label("Run Control"), "after live activation")
      : link("run-control", runControlHref(competition)!, label("Run Control")));
    inside.push(link("receipt", `${base}/receipt`, label("receipt", "", "Close ")));
  }
  const groups = `<span class="app-nav-group">${global.join("")}</span>${inside.length ? `<span class="app-nav-group">${inside.join("")}</span>` : ""}`;
  return `<header class="app-header"><a class="app-brand" href="/">${label("Krateasy", " Competitions")}</a><nav class="app-nav" aria-label="Organiser">${groups}</nav>${competition ? `<span class="app-context">${escapeHtml(competition.name)}</span>` : ""}</header>`;
}

/** Public and participant pages carry the brand only: no organiser routes are ever exposed to them. */
export function renderPublicHeader(surface: string): string {
  return `<header class="app-header" data-surface="public"><span class="app-brand">Krateasy Competitions</span><span class="app-context">${escapeHtml(surface)}</span></header>`;
}

/** The visible label on every reference or demo surface; self-styled because demo pages keep their own CSS. */
export const demoBanner = `<div class="demo-banner" role="note" data-state="DEMO" style="background:#fbf1dc;color:#17201d;border-bottom:2px solid #8b5a10;padding:.6rem 1rem;font:700 1rem/1.4 Geist,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif"><strong>${COMPETITION_STATES.DEMO.label}</strong> — ${COMPETITION_STATES.DEMO.description} Nothing here is published or authoritative.</div>`;

/** Puts the demo banner first inside <body> of a reference page. */
export function withDemoBanner(html: string): string {
  const body = /<body[^>]*>/.exec(html);
  if (!body) throw new Error("reference page has no body");
  return html.slice(0, body.index + body[0].length) + demoBanner + html.slice(body.index + body[0].length);
}
