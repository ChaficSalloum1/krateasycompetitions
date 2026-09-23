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
export const baseCss = `*,*::before,*::after{box-sizing:border-box}body{margin:0;background:var(--canvas);color:var(--ink);overflow-wrap:anywhere}code,kbd,samp{font-family:var(--mono)}:focus-visible{outline:3px solid var(--accent);outline-offset:3px}.skip-link{position:absolute;left:-999px;top:.75rem;z-index:10;background:var(--paper);color:var(--ink);padding:.75rem 1rem;border:2px solid var(--accent);border-radius:var(--radius)}.skip-link:focus{left:1rem}.app-header{display:flex;flex-wrap:wrap;align-items:center;gap:.5rem 1.25rem;padding:.75rem clamp(1rem,4vw,2rem);background:var(--paper);border-bottom:1px solid var(--line)}.app-brand{font-weight:800;color:var(--ink);text-decoration:none;min-height:var(--target);display:inline-flex;align-items:center}.app-nav{display:flex;flex-wrap:wrap;gap:.25rem}.app-nav a,.app-nav .unavailable{display:inline-flex;align-items:center;min-height:var(--target);padding:0 .75rem;border-radius:var(--radius);color:var(--ink);text-decoration:none;font-weight:650}.app-nav a:hover{background:var(--canvas)}.app-nav a[aria-current="page"]{background:var(--ink);color:var(--paper)}.app-nav .unavailable{color:var(--muted);font-weight:500}.app-context{color:var(--muted);font-size:.9rem}.state-badge{display:inline-flex;align-items:center;gap:.35rem;padding:.2rem .6rem;border-radius:999px;border:1px solid currentColor;font-size:.8rem;font-weight:750;letter-spacing:.01em}.state-badge[data-tone="neutral"]{color:var(--ink)}.state-badge[data-tone="positive"]{color:var(--positive);background:var(--positive-soft)}.state-badge[data-tone="warning"]{color:var(--warning);background:var(--warning-soft)}.state-badge[data-tone="danger"]{color:var(--danger);background:var(--danger-soft)}.state-badge[data-tone="accent"]{color:var(--accent-ink);background:var(--paper)}.notice{border:1px solid var(--line);border-left:4px solid var(--warning);background:var(--paper);padding:.75rem 1rem;border-radius:var(--radius)}.notice[data-tone="danger"]{border-left-color:var(--danger)}.visually-hidden{position:absolute!important;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}}@media(prefers-contrast:more){:root{--muted:#3f4a45;--line:#17201d}}@media(forced-colors:active){.state-badge,.app-nav a[aria-current="page"],.notice{border:2px solid CanvasText;forced-color-adjust:none;background:Canvas;color:CanvasText}}@media print{.skip-link,.app-nav{display:none}}`;

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

/**
 * The one organiser navigation model. Portfolio and New competition are always present; inside a
 * competition, its Studio, Guard pre-flight, Run Control and Close receipt follow. A route that does not
 * apply yet is named but not linked, so the set of places never changes shape.
 */
export function renderOrganiserHeader(current: OrganiserRoute, competition?: OrganiserContext): string {
  const link = (route: OrganiserRoute, href: string, label: string) =>
    `<a href="${escapeHtml(href)}"${route === current ? " aria-current=\"page\"" : ""}>${escapeHtml(label)}</a>`;
  const unavailable = (label: string, reason: string) =>
    `<span class="unavailable" title="${escapeHtml(reason)}">${escapeHtml(label)}<span class="visually-hidden"> (${escapeHtml(reason)})</span></span>`;
  const items = [link("portfolio", "/", "Competitions"), link("create", "/create", "New competition")];
  if (competition) {
    const base = `/competitions/${encodeURIComponent(competition.id)}`;
    items.push(link("studio", base, "Studio"));
    items.push(competition.compiled ? link("preflight", `${base}/preflight`, "Guard pre-flight")
      : unavailable("Guard pre-flight", "after compilation"));
    items.push(competition.operationalRevision === null ? unavailable("Run Control", "after live activation")
      : link("run-control", `/attention?competition=${encodeURIComponent(competition.id)}&revision=${competition.operationalRevision}`, "Run Control"));
    items.push(link("receipt", `${base}/receipt`, "Close receipt"));
  }
  return `<header class="app-header"><a class="app-brand" href="/">Krateasy Competitions</a><nav class="app-nav" aria-label="Organiser">${items.join("")}</nav>${competition ? `<span class="app-context">${escapeHtml(competition.name)}</span>` : ""}</header>`;
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
