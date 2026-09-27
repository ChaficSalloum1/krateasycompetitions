import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Browser } from "playwright-core";
import { liveEvent, withPoolTwoCycle } from "../support/pools-knockout-event.js";
import { launchBrowser, noHorizontalOverflow, servers } from "./support.js";

// A pool tie every registered tiebreak leaves level, decided by the organiser in Run Control: the
// knockout it feeds stays empty until the order is recorded, then fills from exactly that order.

let browser: Browser;
const hosts = servers();
before(async () => { browser = await launchBrowser(); });
after(async () => { await browser?.close(); await hosts.close(); });

test("the organiser records the order of a three-way pool tie in Run Control and the knockout fills from it", async () => {
  const event = liveEvent("org.flexible");
  event.playReady(withPoolTwoCycle);
  const origin = await hosts.serve(event.journey);
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(`${origin}/attention?competition=${encodeURIComponent(event.competition.id)}&revision=${event.revision}`);

  const ties = page.getByRole("region", { name: "Ties to decide" });
  await ties.waitFor();
  const names = () => ties.locator("li > span").allInnerTexts();
  assert.deepEqual(await names(), ["Winter Pair 2", "Winter Pair 5", "Winter Pair 8"]);
  assert.ok(await noHorizontalOverflow(page), "the decision reads without horizontal scrolling on a phone");

  await ties.getByRole("button", { name: "Move up Winter Pair 8" }).click();
  await ties.getByRole("button", { name: "Move up Winter Pair 8" }).click();
  assert.deepEqual(await names(), ["Winter Pair 8", "Winter Pair 2", "Winter Pair 5"]);
  await ties.getByLabel("Why this order?").fill("Coin toss at the desk, witnessed by both captains");
  await ties.getByRole("button", { name: "Record this order" }).click();
  await ties.waitFor({ state: "hidden" });

  const live = event.read();
  assert.deepEqual(live.openTies, []);
  const knockoutSides = new Set(live.controlContests.filter(({ contestId }) => contestId.startsWith("open.main"))
    .flatMap(({ sides }) => sides.map(({ entrantId }) => entrantId)));
  assert.ok(knockoutSides.size > 0, "the knockout is filled once the tie is decided");
  assert.ok(!knockoutSides.has("pk.pair.5"), "the pair the organiser placed third does not progress");
  await page.close();
});
