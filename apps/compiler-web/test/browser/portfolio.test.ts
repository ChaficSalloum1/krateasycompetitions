import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import { chromium, type Browser, type Page } from "playwright-core";
import { CompetitionJourney } from "../../src/competition-journey.js";
import { createCompilerServer } from "../../src/server.js";
import { clock, journeyWithLiveCompetition } from "../support/harbour-journey.js";

// Slice 1's primary portfolio task in a real browser: reach and open a competition by keyboard alone,
// see focus at every step, and read the page at phone widths without horizontal scrolling.
// This suite needs a provisioned Chromium, so it runs as `npm run test:browser`, outside `npm test`.
// CI installs one with `npx playwright-core install --with-deps chromium`; KRATEASY_CHROMIUM names any other build.

const localChromium = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const executablePath = process.env.KRATEASY_CHROMIUM ?? (existsSync(localChromium) ? localChromium : undefined);
const notProvisioned = "Chromium is not provisioned for the browser suite: run `npx playwright-core install --with-deps chromium` "
  + "or set KRATEASY_CHROMIUM to a Chromium executable, then `npm run test:browser`.";

let browser: Browser;
const servers: Array<ReturnType<typeof createCompilerServer>> = [];

async function serve(journey: CompetitionJourney): Promise<string> {
  const server = createCompilerServer({ production: false, competitionJourney: journey, organizationId: "org.flexible" });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

before(async () => {
  if (executablePath === undefined && !existsSync(chromium.executablePath())) throw new Error(notProvisioned);
  browser = await chromium.launch(executablePath ? { executablePath } : {});
});
after(async () => {
  await browser?.close();
  await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))));
});

async function focused(page: Page) {
  return page.evaluate(() => {
    const element = document.activeElement as HTMLElement | null;
    const box = element?.getBoundingClientRect();
    return { tag: element?.tagName.toLowerCase() ?? "", id: element?.id ?? "",
      text: (element?.textContent ?? "").replace(/\s+/g, " ").trim(), href: element?.getAttribute("href") ?? "",
      focusVisible: Boolean(element?.matches(":focus-visible")), height: box?.height ?? 0,
      inViewport: Boolean(box && box.bottom > 0 && box.right > 0 && box.left < innerWidth && box.top < innerHeight) };
  });
}
const noHorizontalOverflow = (page: Page) => page.evaluate(() =>
  Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) <= document.documentElement.clientWidth);

test("an organiser reaches and opens a competition from the portfolio by keyboard alone", async () => {
  const { journey, live } = journeyWithLiveCompetition();
  const origin = await serve(journey);
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(`${origin}/`);

  await page.keyboard.press("Tab");
  const skip = await focused(page);
  assert.equal(skip.text, "Skip to competitions");
  assert.ok(skip.focusVisible && skip.inViewport, "the skip link becomes visible when focused");
  await page.keyboard.press("Enter");
  assert.equal((await focused(page)).id, "main", "the skip link moves focus to the main content");

  // Walk forward through every stop, checking focus is visible and every target is at least 44px tall.
  const stops: Awaited<ReturnType<typeof focused>>[] = [];
  for (let index = 0; index < 12; index += 1) {
    await page.keyboard.press("Tab");
    const stop = await focused(page);
    if (stop.tag === "body") break;
    stops.push(stop);
    assert.ok(stop.focusVisible, `focus is visible on "${stop.text}"`);
    assert.ok(stop.height >= 44, `"${stop.text}" is a ${stop.height}px target, at least 44px`);
  }
  const open = stops.find((stop) => stop.text === `Open Studio for ${live.name}`);
  assert.ok(open, "the live competition's Open Studio link is reachable by keyboard");

  await page.focus(`a[href="${open!.href}"]`);
  await Promise.all([page.waitForURL(`**${open!.href}`), page.keyboard.press("Enter")]);
  assert.equal(await page.locator('nav[aria-label="Organiser"] [aria-current="page"]').textContent(), "Studio",
    "the opened competition shows the shared navigation with Studio marked current");
  await page.close();
});

test("the portfolio reads without horizontal scrolling at phone and desktop widths, in every state", async () => {
  const { journey } = journeyWithLiveCompetition();
  const populated = await serve(journey);
  const empty = await serve(new CompetitionJourney({ now: () => clock }));
  const brokenJourney = new CompetitionJourney({ now: () => clock });
  brokenJourney.list = () => { throw new Error("store unavailable"); };
  const failing = await serve(brokenJourney);

  for (const [state, origin, marker] of [["populated", populated, '[data-competition-state="LIVE"]'],
    ["empty", empty, '[data-competition-state="EMPTY"]'], ["unavailable", failing, '[data-competition-state="UNAVAILABLE"]']] as const) {
    for (const width of [320, 390, 1280]) {
      const page = await browser.newPage({ viewport: { width, height: 800 } });
      await page.goto(`${origin}/`);
      assert.equal(await page.locator(marker).count(), 1, `${state} state is shown at ${width}px`);
      assert.ok(await noHorizontalOverflow(page), `${state} portfolio has no horizontal overflow at ${width}px`);
      await page.close();
    }
  }
});

test("the venue display keeps its last good board and says it is stale when a refresh fails", async () => {
  const { journey, live } = journeyWithLiveCompetition();
  const origin = await serve(journey);
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.clock.install();
  await page.goto(`${origin}/display?competition=${encodeURIComponent(live.id)}&revision=${live.publication!.revision}`);
  await page.locator(".match").first().waitFor();
  const matches = await page.locator(".match").count();
  assert.ok(matches > 0);
  assert.equal(await page.locator("#stale").isHidden(), true, "no stale notice while updates arrive");

  await page.route("**/public-live**", (route) => route.abort());
  await page.clock.runFor(15_000);
  await page.locator("#stale").waitFor({ state: "visible" });
  assert.match(await page.locator("#stale").textContent() ?? "", /^Stale — showing the last update from .+retrying every 15 seconds\.$/);
  assert.equal(await page.locator(".match").count(), matches, "the last good board stays on screen");

  await page.unroute("**/public-live**");
  await page.clock.runFor(15_000);
  await page.locator("#stale").waitFor({ state: "hidden" });
  await page.close();
});
