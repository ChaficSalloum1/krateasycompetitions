import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Browser, Page } from "playwright-core";
import { CompetitionJourney } from "../../src/competition-journey.js";
import { clock, journeyWithLiveCompetition } from "../support/harbour-journey.js";
import { launchBrowser, noHorizontalOverflow, servers } from "./support.js";

// Slice 1's primary portfolio task in a real browser: reach and open a competition by keyboard alone,
// see focus at every step, and read the page at phone widths without horizontal scrolling.

let browser: Browser;
const hosts = servers();
const serve = hosts.serve;

before(async () => { browser = await launchBrowser(); });
after(async () => { await browser?.close(); await hosts.close(); });

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
  const open = stops.find((stop) => stop.text === `${live.name}, open Studio`);
  assert.ok(open, "the live competition's name is a keyboard-reachable link to its Studio");
  const next = stops.find((stop) => stop.text === `Open Run Control for ${live.name}`);
  assert.ok(next, "the live competition's next step is reachable by keyboard");

  await page.focus(`a[href="${open!.href}"]`);
  await Promise.all([page.waitForURL(`**${open!.href}`), page.keyboard.press("Enter")]);
  assert.equal(await page.locator('nav[aria-label="Organiser"] [aria-current="page"]').textContent(), "Studio",
    "the opened competition shows the shared navigation with Studio marked current");

  await page.goto(`${origin}/`);
  await page.locator("[data-next-action]").filter({ hasText: live.name }).focus();
  await Promise.all([page.waitForURL("**/attention?**"), page.keyboard.press("Enter")]);
  assert.equal(await page.locator('nav[aria-label="Organiser"] [aria-current="page"]').textContent(), "Run Control",
    "the next step lands in Run Control for the live revision");
  await page.close();
});

test("on phones and at 200% and 400% zoom the organiser header stays compact, whole and named in full", async () => {
  const { journey, live } = journeyWithLiveCompetition();
  const origin = await serve(journey);
  const id = encodeURIComponent(live.id);
  const places = ["Competitions", "New competition", "Studio", "Guard pre-flight", "Run Control", "Close receipt"];
  // 640px and 320px are what a 1280px window shows at 200% and 400% zoom.
  for (const url of [`/competitions/${id}`, `/attention?competition=${id}&revision=${live.publication!.revision}`]) {
    for (const width of [320, 390, 640, 1280]) {
      const page = await browser.newPage({ viewport: { width, height: 800 } });
      await page.goto(`${origin}${url}`);
      const nav = page.getByRole("navigation", { name: "Organiser", exact: true });
      for (const place of places) {
        const item = nav.getByRole("link", { name: place, exact: true });
        const box = await item.boundingBox();
        assert.ok(box, `${place} is shown at ${width}px on ${url}`);
        assert.ok(box!.x >= 0 && box!.x + box!.width <= width, `${place} fits inside ${width}px`);
        assert.ok(box!.height >= 44, `${place} is a ${box!.height}px target at ${width}px`);
      }
      assert.ok(await noHorizontalOverflow(page), `${url} has no horizontal overflow at ${width}px`);
      const modes = page.getByRole("navigation", { name: "Organiser Studio modes" }).getByRole("link");
      if (url.startsWith("/competitions/")) {
        await modes.nth(2).waitFor();
        assert.ok(await page.locator(".stage-nav").evaluate((row) => row.scrollWidth <= row.clientWidth),
          `every Studio mode is in view at ${width}px, none hidden in a sideways scroller`);
      }
      for (const mode of await modes.all()) {
        const box = (await mode.boundingBox())!;
        assert.ok(box.x >= 0 && box.x + box.width <= width && box.height >= 44, `Studio mode "${await mode.innerText()}" is whole and 44px at ${width}px`);
      }
      const header = (await page.locator(".app-header").boundingBox())!.height;
      if (width <= 390) assert.ok(header <= 120, `the header takes ${header}px at ${width}px, two rows at most`);
      // Phones shorten labels visually; with room, labels are whole and their words never run together.
      const hiddenWidths = await page.locator(".app-header .short-hide").evaluateAll((parts) => parts.map((part) => part.getBoundingClientRect().width));
      if (width <= 390) assert.ok(hiddenWidths.every((w) => w <= 1), `long label parts are visually hidden at ${width}px`);
      if (width >= 1280) {
        assert.ok(hiddenWidths.every((w) => w > 1), "every label is whole on desktop");
        assert.match(await nav.innerText(), /New competition[\s\S]*Guard pre-flight[\s\S]*Close receipt/);
        assert.equal(await page.locator(".app-brand").innerText(), "Krateasy Competitions");
      }
      await page.close();
    }
  }
});

test("the portfolio reads without horizontal scrolling at phone, zoomed and desktop widths, in every state", async () => {
  const { journey } = journeyWithLiveCompetition();
  const populated = await serve(journey);
  const empty = await serve(new CompetitionJourney({ now: () => clock }));
  const brokenJourney = new CompetitionJourney({ now: () => clock });
  brokenJourney.list = () => { throw new Error("store unavailable"); };
  const failing = await serve(brokenJourney);

  for (const [state, origin, marker] of [["populated", populated, '[data-competition-state="LIVE"]'],
    ["empty", empty, '[data-competition-state="EMPTY"]'], ["unavailable", failing, '[data-competition-state="UNAVAILABLE"]']] as const) {
    for (const width of [320, 390, 640, 1280]) {
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
