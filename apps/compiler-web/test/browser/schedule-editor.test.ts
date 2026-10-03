import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Browser } from "playwright-core";
import { CompetitionJourney } from "../../src/competition-journey.js";
import { pairs } from "../support/pools-knockout-event.js";
import { launchBrowser, noHorizontalOverflow, servers } from "./support.js";

// The organiser sets court hours, a final's length and a protected final in the Studio. Each change is
// reviewed before it is saved, a bad one is refused with the reason, and the next plan honours them all.

let browser: Browser;
const hosts = servers();
before(async () => { browser = await launchBrowser(); });
after(async () => { await browser?.close(); await hosts.close(); });

const facts = { name: "Winter Pools", sport: "padel", participantUnit: "pairs", participantCount: 12, resourceCount: 3,
  resourceLabel: "courts", format: "pools_to_knockout", poolSize: 4, qualifiersPerPool: 2, minimumMatches: 3, minimumRestMinutes: 10,
  matchDurationMinutes: 20, timezone: "Europe/London", priority: "fair_recovery", scoringPolicy: "head_to_head_total_score_no_draw",
  tiebreakPolicy: "wins_score_difference_score_for_manual", withdrawalPolicy: "preserve_played_walkover_future",
  drawPolicy: "seeded_input_order", startsAt: "2026-11-07T09:00:00.000Z", endsAt: "2026-11-07T21:00:00.000Z" } as const;
const roster = ["entrant_id,display_name,division_id,member_ids,seed",
  ...pairs.map((id, index) => `${id},Winter Pair ${index + 1},open,${id}.a|${id}.b,${index + 1}`)].join("\n");

test("an organiser sets court hours, a final's length and a protected final, and the plan honours them", async () => {
  const journey = new CompetitionJourney({ organizationId: "org.flexible", now: () => "2026-11-01T08:00:00.000Z" });
  let c = journey.create({ mode: "quick", value: facts }, "organiser.author");
  c = journey.addSource(c.id, c.draftVersion, { mode: "csv", text: roster });
  c = journey.compile(c.id, c.draftVersion);
  const origin = await hosts.serve(journey);
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(`${origin}/competitions/${encodeURIComponent(c.id)}`);
  const editor = page.locator("#schedule-editor");
  await page.getByText("Scheduling", { exact: true }).click();
  assert.match(await editor.innerText(), /The event runs 09:00–21:00 \(Europe\/London\) on 3 courts, with 20-minute matches/);
  const review = page.getByRole("region", { name: "Review the scheduling change" });
  const apply = async () => {
    await review.waitFor();
    await Promise.all([page.waitForEvent("load"), review.getByRole("button", { name: "Apply this change" }).click()]);
    await page.getByText("Scheduling", { exact: true }).click();
  };

  const hours = page.locator("#court-hours-form");
  await hours.getByLabel("Court", { exact: true }).selectOption("3");
  await hours.getByLabel("Opens").fill("08:00");
  await hours.getByLabel("Closes").fill("18:00");
  await hours.getByRole("button", { name: "Set court hours" }).click();
  await page.waitForFunction(() => /within the event's hours/.test(document.querySelector("#schedule-status")?.textContent ?? ""));
  await hours.getByLabel("Opens").fill("12:00");
  await hours.getByRole("button", { name: "Set court hours" }).click();
  await review.waitFor();
  assert.match(await review.innerText(), /Court 3 is open 12:00–18:00\./);
  assert.match(await review.innerText(), /The plan already created is set aside/);
  assert.equal(journey.read(c.id)!.scheduleControls!.controls.courtHours.length, 0, "nothing is saved until the change is applied");
  await apply();

  await editor.getByLabel("Matches", { exact: true }).selectOption({ label: "Open knockout: final" });
  await editor.getByLabel("Minutes", { exact: true }).fill("40");
  await editor.getByRole("button", { name: "Set match length" }).click();
  await apply();
  assert.match(await editor.innerText(), /Court 3: open 12:00–18:00/);
  assert.match(await editor.innerText(), /Open knockout · final: 40 minutes/);
  assert.match(await editor.innerText(), /Create the plan to choose matches to protect/, "applying a change set the plan aside, so there is nothing to protect yet");

  await Promise.all([page.waitForEvent("load"), page.getByRole("button", { name: "Create and check plan" }).click()]);
  await page.getByText("Scheduling", { exact: true }).click();
  const finalOption = await page.locator("#protect-match option", { hasText: /^Open knockout: final \(planned/ }).getAttribute("value");
  await editor.getByLabel("Match", { exact: true }).selectOption(finalOption!);
  await editor.getByLabel("Starts at (optional)").fill("17:00");
  await page.locator("#protect-form").getByLabel("Court", { exact: true }).selectOption("1");
  await editor.getByRole("button", { name: "Protect this match" }).click();
  await review.waitFor();
  assert.match(await review.innerText(), /Open knockout: final is protected: starts at 17:00 on court 1\./);
  assert.ok(await noHorizontalOverflow(page), "the scheduling controls read without horizontal scrolling on a phone");
  await apply();
  assert.match(await editor.innerText(), /Open knockout: final: starts 17:00, court 1/);

  await Promise.all([page.waitForEvent("load"), page.getByRole("button", { name: "Create and check plan" }).click()]);
  const saved = journey.read(c.id)!;
  assert.equal(saved.compiled!.guardStatus, "PASSED");
  assert.equal(saved.scheduleControls!.matches.find(({ contestId }) => contestId === "open.main.R3.M1")!.plannedStart, "17:00");
  assert.equal(saved.scheduleControlsHistory!.length, 3);
  await page.close();
});
