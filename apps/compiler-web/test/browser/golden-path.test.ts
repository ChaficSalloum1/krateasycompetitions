import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Browser, Page } from "playwright-core";
import { CompetitionJourney } from "../../src/competition-journey.js";
import { launchBrowser, servers } from "./support.js";

// The golden path in one browser session, through the pages an organiser uses and nothing else:
// create a competition, add its roster, create and approve the plan, start Run Control, play every
// fixture, and close it with its integrity record. Live commands carry the server's real clock, so the
// event is scheduled for today.

let browser: Browser;
const hosts = servers();
before(async () => { browser = await launchBrowser(); });
after(async () => { await browser?.close(); await hosts.close(); });

const pairs = [1, 2, 3, 4].map((n) => ({ id: `gp.pair.${n}`, name: `Golden Pair ${n}` }));
const roster = ["entrant_id,display_name,division_id,member_ids,seed",
  ...pairs.map(({ id, name }, index) => `${id},${name},open,${id}.a|${id}.b,${index + 1}`)].join("\n");

/** Wall-clock "YYYY-MM-DDTHH:mm" in UTC, which the creator reads in the timezone it is given. */
const wall = (date: Date) => date.toISOString().slice(0, 16);

async function submitLive(page: Page, kind: string, choose: () => Promise<void>) {
  await page.locator("#command-kind").selectOption(kind);
  await choose();
  const accepted = page.waitForResponse((response) => response.url().endsWith("/live-command") && response.request().method() === "POST");
  // After an accepted command the page reloads the authoritative state; wait for that before the next one.
  const refreshed = page.waitForResponse((response) => response.url().includes("/organiser-live?") && response.request().method() === "GET");
  await page.locator("#command-form button[type=submit]").click();
  const response = await accepted;
  assert.equal(response.status(), 200, `${kind} accepted: ${await response.text()}`);
  await refreshed;
  await page.waitForFunction(() => document.querySelector("#command-form button[type=submit]") !== null);
}

test("an organiser creates, publishes, runs and closes a competition in one browser session", async () => {
  const journey = new CompetitionJourney({ organizationId: "org.flexible" });
  const origin = await hosts.serve(journey);
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const startsAt = new Date(Math.ceil(Date.now() / 3_600_000) * 3_600_000 - 3_600_000);

  // 1. Create.
  await page.goto(`${origin}/create`);
  await page.getByRole("tab", { name: "Quick setup" }).click();
  await page.locator("#name").fill("Golden Path Four");
  await page.locator("#format").selectOption("round_robin");
  await page.locator("#participantCount").fill("4");
  await page.locator("#resourceCount").fill("2");
  await page.locator("#startsAt").fill(wall(startsAt));
  await page.locator("#endsAt").fill(wall(new Date(startsAt.getTime() + 8 * 3_600_000)));
  await page.locator("#timezone").fill("UTC");
  await page.locator("#minimumMatches").fill("3");
  await page.locator("#matchDurationMinutes").fill("20");
  await page.locator("#minimumRestMinutes").fill("0");
  await page.locator("#build").click();
  await page.locator("#save:not([disabled])").waitFor();
  await page.locator("#save").click();
  await Promise.all([page.waitForURL("**/competitions/**"), page.getByRole("link", { name: /Open exact draft/ }).click()]);
  const competitionId = decodeURIComponent(new URL(page.url()).pathname.split("/").at(-1)!);

  // 2. Roster, plan, approval.
  await page.locator("#source-csv").fill(roster);
  await Promise.all([page.waitForEvent("load"), page.getByRole("button", { name: "Add entrant source" }).click()]);
  await Promise.all([page.waitForEvent("load"), page.getByRole("button", { name: "Create and check plan" }).click()]);
  assert.equal(journey.read(competitionId)!.compiled!.guardStatus, "PASSED");
  for (const box of await page.locator("#acks input[type=checkbox]").all()) await box.check();
  await Promise.all([page.waitForEvent("load"), page.getByRole("button", { name: "Approve and publish exact revision" }).click()]);
  assert.equal(journey.read(competitionId)!.status, "PUBLISHED");

  // 3. Live.
  await Promise.all([page.waitForEvent("load"), page.getByRole("button", { name: "Start Run Control" }).click()]);
  await Promise.all([page.waitForURL("**/attention?**"), page.getByRole("link", { name: "Open Run Control" }).click()]);
  await page.locator("#entrant option").first().waitFor({ state: "attached" });
  for (const { name } of pairs)
    await submitLive(page, "CHECK_IN", () => page.locator("#entrant").selectOption({ label: name }).then(() => undefined));

  // 4. Play every fixture: start, score, finish, confirm the result.
  const fixtures = journey.read(competitionId)!.compiled!.schedule.length;
  assert.equal(fixtures, 6);
  for (let played = 0; played < fixtures; played += 1) {
    const contestId = [...journey.read(competitionId)!.compiled!.schedule]
      .sort((a, b) => a.start.localeCompare(b.start) || a.contestId.localeCompare(b.contestId))
      .map(({ contestId }) => contestId)
      .find((id) => journey.read(competitionId)!.live!.state.contests[id]!.status === "SCHEDULED")!;
    const pick = () => page.locator("#contest").selectOption(contestId).then(() => undefined);
    await submitLive(page, "START_CONTEST", pick);
    await submitLive(page, "RECORD_SCORE", async () => { await pick(); await page.locator("#score-one").fill("6"); await page.locator("#score-two").fill("3"); });
    await submitLive(page, "COMPLETE_CONTEST", pick);
    await submitLive(page, "RECORD_RESULT_RECEIPT", pick);
  }
  const live = journey.read(competitionId)!.live!.state;
  assert.ok(Object.values(live.contests).every(({ status }) => status === "COMPLETED"), "every fixture has a result");

  // 5. Close.
  await page.goto(`${origin}/competitions/${encodeURIComponent(competitionId)}/receipt`);
  for (const box of await page.locator("#acks input[type=checkbox]").all()) await box.check();
  await Promise.all([page.waitForEvent("load"), page.getByRole("button", { name: "Create immutable closure" }).click()]);
  const closed = journey.read(competitionId)!;
  assert.equal(closed.status, "CLOSED");
  assert.equal(closed.closure!.resultSummary.completed, 6);
  assert.equal(closed.closure!.resultSummary.unresolved, 0);
  assert.ok(await page.getByRole("link", { name: "Download evidence bundle" }).isVisible());
  await page.close();
});
