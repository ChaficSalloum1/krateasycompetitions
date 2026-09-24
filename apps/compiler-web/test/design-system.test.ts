import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";
import { CompetitionJourney, type CompetitionJourneySnapshot } from "../src/competition-journey.js";
import { clock, journeyWithLiveCompetition } from "./support/harbour-journey.js";
import { renderCompetitionPortfolio } from "../src/competition-portfolio-view.js";
import { COMPETITION_STATES, competitionStateOf, DESIGN_SYSTEM_ID, nextActionOf } from "../src/design-system.js";
import { createCompilerServer } from "../src/server.js";

// Slice 1: one design system, one organiser navigation model and one state vocabulary across every
// product page, with the portfolio's empty, failure and permission states made explicit.

async function get(server: ReturnType<typeof createCompilerServer>, url: string): Promise<{ status: number; body: string }> {
  const request = Readable.from([]) as never;
  Object.assign(request, { method: "GET", url, headers: {} });
  return new Promise((resolve) => {
    let status = 0;
    server.emit("request", request, { writeHead: (next: number) => { status = next; }, end: (body = "") => resolve({ status, body }) } as never);
  });
}

const organiserNav = (html: string) => /<nav class="app-nav" aria-label="Organiser">(.*?)<\/nav>/.exec(html)?.[1];
/** Each place's full accessible label: visually shortened parts included, the unavailable reason left out. */
const navLabels = (nav: string) => [...nav.matchAll(/<a [^>]*>(.*?)<\/a>|<span class="unavailable"[^>]*>(.*?)<span class="visually-hidden">/g)]
  .map(([, linked, unlinked]) => (linked ?? unlinked)!.replace(/<[^>]+>/g, "").trim());

test("every product page uses the one design system and none defines its own palette, font or accent", async () => {
  const { journey, live } = journeyWithLiveCompetition();
  const server = createCompilerServer({ production: false, competitionJourney: journey, organizationId: "org.flexible" });
  const id = encodeURIComponent(live.id); const revision = live.publication!.revision;
  const pages: Record<string, string> = {};
  for (const [name, url] of [["portfolio", "/"], ["create", "/create"], ["studio", `/competitions/${id}`],
    ["preflight", `/competitions/${id}/preflight`], ["receipt", `/competitions/${id}/receipt`],
    ["run control", `/attention?competition=${id}&revision=${revision}`], ["venue display", `/display?competition=${id}&revision=${revision}`],
    ["participant next", "/next"], ["participant recovery", "/next/recover"]] as const) {
    const response = await get(server, url);
    assert.equal(response.status, 200, `${name} is served`);
    pages[name] = response.body;
  }
  const fallback = await get(server, `/v1/competition-journey/${id}/manual-pack?published=${revision}&operational=${revision}`);
  assert.equal(fallback.status, 200, "printed fallback is served");
  pages["printed fallback"] = fallback.body;

  for (const [name, html] of Object.entries(pages)) {
    assert.ok(html.includes(`/*${DESIGN_SYSTEM_ID}*/`), `${name} is built on the shared design system`);
    // The venue display may re-point the tokens only through the design system's named dark theme.
    const themes = name === "venue display" ? 1 : 0;
    assert.equal(html.match(/--canvas:#f4f2ec/g)?.length, 1, `${name} carries exactly one token set`);
    assert.equal(html.match(/--ink:#/g)?.length, 1 + themes, `${name} does not define a second palette`);
    assert.equal((html.match(new RegExp(`/\\*${DESIGN_SYSTEM_ID}:venue-display\\*/`, "g")) ?? []).length, themes,
      `${name} uses the named venue theme only where it belongs`);
    assert.doesNotMatch(html, /\bInter\b/, `${name} does not use the Inter face DESIGN.md rules out`);
    assert.doesNotMatch(html, /#087b59|#c95635/i, `${name} uses only the shared accent`);
    assert.doesNotMatch(html, /\$\{sharedStyles\}/, `${name} interpolated the shared styles`);
  }
});

test("organiser pages share one navigation, marking the current place and linking one competition's routes", async () => {
  const { journey, live } = journeyWithLiveCompetition();
  const server = createCompilerServer({ production: false, competitionJourney: journey, organizationId: "org.flexible" });
  const id = encodeURIComponent(live.id); const revision = live.publication!.revision;
  const inside = ["Competitions", "New competition", "Studio", "Guard pre-flight", "Run Control", "Close receipt"];
  for (const [url, current, expectedLabels] of [
    ["/", "Competitions", ["Competitions", "New competition"]],
    ["/create", "New competition", ["Competitions", "New competition"]],
    [`/competitions/${id}`, "Studio", inside],
    [`/competitions/${id}/preflight`, "Guard pre-flight", inside],
    [`/competitions/${id}/receipt`, "Close receipt", inside],
    [`/attention?competition=${id}&revision=${revision}`, "Run Control", inside],
  ] as const) {
    const nav = organiserNav((await get(server, url)).body);
    assert.ok(nav, `${url} has the organiser navigation`);
    assert.deepEqual(navLabels(nav!), expectedLabels, `${url} offers the same places in the same order`);
    assert.equal(nav!.match(/aria-current="page"/g)?.length, 1, `${url} marks exactly one current place`);
    assert.equal(/aria-current="page">(.*?)<\/a>/.exec(nav!)?.[1]?.replace(/<[^>]+>/g, ""), current, `${url} marks ${current} as current`);
  }
  const studioNav = organiserNav((await get(server, `/competitions/${id}`)).body)!;
  assert.match(studioNav, new RegExp(`href="/attention\\?competition=${id.replace(/\./g, "\\.")}&amp;revision=${revision}"`),
    "Run Control is linked with the live operational revision");
});

test("routes that do not apply yet are named but not linked, so the navigation never changes shape", async () => {
  const { journey, draft } = journeyWithLiveCompetition();
  const server = createCompilerServer({ production: false, competitionJourney: journey, organizationId: "org.flexible" });
  const nav = organiserNav((await get(server, `/competitions/${encodeURIComponent(draft.id)}`)).body)!;
  assert.deepEqual(navLabels(nav), ["Competitions", "New competition", "Studio", "Guard pre-flight", "Run Control", "Close receipt"]);
  assert.doesNotMatch(nav, /href="[^"]*preflight"/, "no pre-flight link before compilation");
  assert.doesNotMatch(nav, /href="\/attention/, "no Run Control link before live activation");
  assert.match(nav, /Run Control<span class="visually-hidden"> \(after live activation\)<\/span>/);
  assert.match(nav, /Guard<span class="short-hide"> pre-flight<\/span><\/span><span class="visually-hidden"> \(after compilation\)<\/span>/);
});

test("public and participant pages never expose organiser routes", async () => {
  const { journey, live } = journeyWithLiveCompetition();
  const server = createCompilerServer({ production: false, competitionJourney: journey, organizationId: "org.flexible" });
  const id = encodeURIComponent(live.id);
  for (const url of [`/display?competition=${id}&revision=1`, "/next", "/next/recover"]) {
    const { body } = await get(server, url);
    assert.equal(organiserNav(body), undefined, `${url} has no organiser navigation`);
    assert.doesNotMatch(body, /href="\/create"|href="\/attention|\/receipt"/, `${url} links to no organiser route`);
  }
});

test("reference demo pages carry the visible demo label before anything else", async () => {
  const server = createCompilerServer({ production: false, competitionJourney: new CompetitionJourney({ now: () => clock }) });
  for (const url of ["/demo", "/lab"]) {
    const { status, body } = await get(server, url);
    assert.equal(status, 200);
    assert.match(body, /<body[^>]*><div class="demo-banner" role="note" data-state="DEMO"[^>]*><strong>Reference demo<\/strong>/,
      `${url} opens with the reference-demo label`);
  }
});

test("every competition shows one truthful, worded state instead of an internal code", () => {
  const { journey, draft, live } = journeyWithLiveCompetition();
  const states = journey.list().map((snapshot) => [snapshot.id, competitionStateOf(snapshot)] as const);
  assert.deepEqual(Object.fromEntries(states)[draft.id], "NEEDS_INPUT");
  assert.deepEqual(Object.fromEntries(states)[live.id], "LIVE", "a published competition with live play reads as Live");

  const html = renderCompetitionPortfolio(journey.list());
  assert.match(html, /data-state="LIVE"[^>]*>Live<\/span>/);
  assert.match(html, /data-state="NEEDS_INPUT"[^>]*>Needs input<\/span>/);
  assert.doesNotMatch(html, /READY_FOR_APPROVAL|GUARD_BLOCKED|NEEDS_INPUT<|>PUBLISHED</, "no raw status code is shown");

  const statuses: CompetitionJourneySnapshot["status"][] = ["NEEDS_INPUT", "DRAFT", "GUARD_BLOCKED", "READY_FOR_APPROVAL", "PUBLISHED", "CLOSED"];
  for (const status of statuses) {
    const key = competitionStateOf({ status, live: null });
    assert.ok(COMPETITION_STATES[key].label && COMPETITION_STATES[key].description, `${status} has a worded label`);
  }
});

test("the portfolio has explicit empty, failure and permission states and never falls back to demo data", async () => {
  const empty = await get(createCompilerServer({ production: false, competitionJourney: new CompetitionJourney({ now: () => clock }) }), "/");
  assert.equal(empty.status, 200);
  assert.match(empty.body, /data-competition-state="EMPTY"/);
  assert.match(empty.body, /No competitions yet/);
  assert.match(empty.body, /href="\/create">Create your first competition/);

  const broken = new CompetitionJourney({ now: () => clock });
  broken.list = () => { throw new Error("store unavailable"); };
  const failed = await get(createCompilerServer({ production: false, competitionJourney: broken }), "/");
  assert.equal(failed.status, 503);
  assert.match(failed.body, /role="alert" data-competition-state="UNAVAILABLE"/);
  assert.doesNotMatch(failed.body, /<li class="competition"|No competitions yet/, "a failure is never shown as an empty list");

  const production = createCompilerServer({ production: true, competitionJourney: new CompetitionJourney({ now: () => clock }) });
  for (const url of ["/", "/create", "/competitions/anything"]) {
    const response = await get(production, url);
    assert.notEqual(response.status, 200, `${url} is not served without a production projection and authorisation`);
    assert.doesNotMatch(response.body, /aria-label="Organiser"/);
  }
});

test("each competition offers one next step, derived from its state and routed to where that step happens", () => {
  const { journey, draft, live } = journeyWithLiveCompetition();
  const needsInput = journey.read(draft.id)!;
  const running = journey.read(live.id)!;
  const id = (snapshot: CompetitionJourneySnapshot) => `/competitions/${encodeURIComponent(snapshot.id)}`;

  assert.deepEqual(nextActionOf(needsInput), { label: "Answer open questions", href: id(needsInput),
    detail: `${needsInput.questions.length} decisions needed before it can be compiled.` });
  assert.deepEqual(nextActionOf(running), { label: "Open Run Control",
    href: `/attention?competition=${encodeURIComponent(running.id)}&revision=${running.publication!.revision}`,
    detail: `Play is running from published revision ${running.publication!.revision}.` });

  const as = (status: CompetitionJourneySnapshot["status"], live: unknown = null) => ({ ...running, status, live }) as CompetitionJourneySnapshot;
  assert.deepEqual(Object.fromEntries((["DRAFT", "GUARD_BLOCKED", "READY_FOR_APPROVAL", "PUBLISHED", "CLOSED"] as const)
    .map((status) => [status, (({ label, href }) => ({ label, href }))(nextActionOf(as(status)))])), {
    DRAFT: { label: "Compile and check", href: id(running) },
    GUARD_BLOCKED: { label: "Review Guard findings", href: `${id(running)}/preflight` },
    READY_FOR_APPROVAL: { label: "Approve and publish", href: id(running) },
    PUBLISHED: { label: "Go live", href: id(running) },
    CLOSED: { label: "View close receipt", href: `${id(running)}/receipt` },
  }, "approval, publication and activation are named as steps, never performed from the portfolio");
});

test("a question the workbench repeats as a missing decision is counted once", () => {
  const { journey, draft } = journeyWithLiveCompetition();
  const snapshot = journey.read(draft.id)!;
  const repeated = snapshot.questions.slice(0, 2).map(({ field, prompt }) => ({ id: String(field), path: `/blueprint/${String(field)}`, prompt, critical: true as const }));
  const imported = { ...snapshot, workbench: { ...snapshot.workbench, missingDecisions: [...repeated,
    { id: "entrant-roster", path: "/entrants", prompt: "Add an authoritative CSV or XLSX entrant roster before compilation.", critical: true as const }] } };
  assert.equal(nextActionOf(imported).detail, `${snapshot.questions.length + 1} decisions needed before it can be compiled.`);
});

test("the portfolio links each competition's name to its Studio and its button to the next step", () => {
  const { journey, live } = journeyWithLiveCompetition();
  const html = renderCompetitionPortfolio(journey.list());
  const card = html.slice(html.indexOf(`data-competition-state="LIVE"`));
  assert.match(card, new RegExp(`<h2><a class="name" href="/competitions/${encodeURIComponent(live.id).replace(/\./g, "\\.")}">`));
  assert.match(card, /<a class="open" href="\/attention\?competition=[^"]+&amp;revision=1" data-next-action>Open Run Control<span class="visually-hidden"> for /);
  assert.match(card, /<p class="next"><strong>Next:<\/strong> Play is running from published revision 1\.<\/p>/);
});
