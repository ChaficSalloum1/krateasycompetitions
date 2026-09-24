import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Browser } from "playwright-core";
import { journeyWithLiveCompetition } from "../support/harbour-journey.js";
import { launchBrowser, noHorizontalOverflow, servers } from "./support.js";

// E3: the read-only court timeline in a real browser, and its only way to change anything: a
// preselected handoff into Run Control's guarded Change Review.

let browser: Browser;
const hosts = servers();
before(async () => { browser = await launchBrowser(); });
after(async () => { await browser?.close(); await hosts.close(); });

test("a timeline report opens Run Control's Change Review with that fixture or court preselected", async () => {
  const { journey, live } = journeyWithLiveCompetition();
  const origin = await hosts.serve(journey);
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(`${origin}/competitions/${encodeURIComponent(live.id)}/timeline`);
  const firstFixture = page.locator(".fixture").first();
  const contestId = await firstFixture.getAttribute("data-contest-id");

  await firstFixture.getByRole("link", { name: /^Report running late for / }).focus();
  await Promise.all([page.waitForURL("**/attention?**"), page.keyboard.press("Enter")]);
  await page.locator("#change-contest option").first().waitFor({ state: "attached" });
  await page.waitForFunction(() => document.activeElement?.id === "change-review");
  assert.equal(await page.locator("#change-kind").inputValue(), "DELAY_OVERRUN");
  assert.equal(await page.locator("#change-contest").inputValue(), contestId, "the reported fixture is the one under review");

  await page.goto(`${origin}/competitions/${encodeURIComponent(live.id)}/timeline`);
  const court = page.locator(".court").nth(2);
  const courtId = await court.getAttribute("data-court-id");
  const courtName = await court.locator("h2").innerText();
  await Promise.all([page.waitForURL("**/attention?**"), court.getByRole("link", { name: /^Report court unavailable/ }).click()]);
  await page.waitForFunction(() => document.activeElement?.id === "change-review");
  assert.equal(await page.locator("#change-kind").inputValue(), "COURT_OUTAGE");
  assert.equal(await page.locator("#change-court").inputValue(), courtId);
  assert.equal(await page.locator("#change-court option:checked").innerText(), courtName, "Run Control names the court as the timeline does");
  assert.deepEqual(await page.locator("#change-court option").evaluateAll((options) => options.map((o) => [(o as HTMLOptionElement).value, o.textContent])),
    [1, 2, 3, 4].map((n) => [`venue.courts.${n}`, `Court ${n}`]), "every court keeps its own number, in order");
  assert.equal(await page.locator("#change-status").innerText(), "", "nothing was submitted by following the link");
  await page.close();
});

test("a link to a fixture the live plan no longer has selects nothing and says so", async () => {
  const { journey, live } = journeyWithLiveCompetition();
  const origin = await hosts.serve(journey);
  const page = await browser.newPage();
  await page.goto(`${origin}/attention?competition=${encodeURIComponent(live.id)}&revision=${live.publication!.revision}&change=DELAY_OVERRUN&contest=forged.contest#change-review`);
  await page.waitForFunction(() => document.activeElement?.id === "change-review");
  assert.notEqual(await page.locator("#change-contest").inputValue(), "forged.contest");
  assert.match(await page.locator("#change-status").innerText(), /not in the current live projection/);
  await page.close();
});

test("the timeline reads without horizontal scrolling at phone, zoomed and desktop widths", async () => {
  const { journey, live } = journeyWithLiveCompetition();
  const origin = await hosts.serve(journey);
  for (const width of [320, 390, 640, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 800 } });
    await page.goto(`${origin}/competitions/${encodeURIComponent(live.id)}/timeline`);
    assert.equal(await page.locator(".court").count(), 4);
    assert.ok(await noHorizontalOverflow(page), `no horizontal overflow at ${width}px`);
    for (const link of await page.locator(".report").all()) {
      const box = (await link.boundingBox())!;
      assert.ok(box.height >= 44 && box.x >= 0 && box.x + box.width <= width, `report links are whole 44px targets at ${width}px`);
    }
    await page.close();
  }
});

test("public surfaces name courts for people, never by resource identity", async () => {
  const { journey, live } = journeyWithLiveCompetition();
  const origin = await hosts.serve(journey);
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(`${origin}/display?competition=${encodeURIComponent(live.id)}&revision=${live.publication!.revision}`);
  await page.locator(".match").first().waitFor();
  const shown = await page.locator("main").innerText();
  assert.match(shown, /Court [1-4]/);
  assert.doesNotMatch(shown, /venue\.courts/, "the venue display never shows a court's resource identity");
  const participant = await (await fetch(`${origin}/next`)).text();
  assert.match(participant, /q\('#next-court'\)\.textContent=courtLabel\(value\.next\.court\)/, "the participant page names its court the same way");
  await page.close();
});
