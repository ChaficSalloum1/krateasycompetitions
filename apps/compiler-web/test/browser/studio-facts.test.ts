import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Browser } from "playwright-core";
import { CompetitionJourney } from "../../src/competition-journey.js";
import { launchBrowser, noHorizontalOverflow, servers } from "./support.js";

// B1: an organiser changes a draft's facts in the Studio, with no API call of their own. The facts
// round-trip through the event's timezone without drifting, the roster survives, and a draft that is
// missing its rules can be completed from the page alone.

let browser: Browser;
const hosts = servers();
before(async () => { browser = await launchBrowser(); });
after(async () => { await browser?.close(); await hosts.close(); });

const rules = { scoringPolicy: "head_to_head_total_score_no_draw", tiebreakPolicy: "wins_score_difference_score_for_manual",
  withdrawalPolicy: "preserve_played_walkover_future", drawPolicy: "seeded_input_order" } as const;
// 09:00 to 18:00 in London, which is British Summer Time on 18 October.
const facts = { name: "Harbour Eight", sport: "padel", participantUnit: "pairs", participantCount: 8, resourceCount: 2,
  resourceLabel: "courts", format: "round_robin", minimumMatches: 7, minimumRestMinutes: 10, matchDurationMinutes: 25,
  timezone: "Europe/London", priority: "fair_recovery", startsAt: "2026-10-18T08:00:00.000Z", endsAt: "2026-10-18T17:00:00.000Z" } as const;
const roster = ["entrant_id,display_name,division_id,member_ids,seed", ...Array.from({ length: 8 }, (_, index) =>
  `h8.pair.${index + 1},Harbour Pair ${index + 1},open,h8.pair.${index + 1}.a|h8.pair.${index + 1}.b,${index + 1}`)].join("\n");

function journey() {
  return new CompetitionJourney({ organizationId: "org.flexible", now: () => "2026-10-01T08:00:00.000Z" });
}

test("an organiser changes a compiled draft's courts and match length in the Studio, then recompiles", async () => {
  const j = journey();
  let c = j.create({ mode: "quick", value: { ...facts, ...rules } }, "organiser.author");
  c = j.addSource(c.id, c.draftVersion, { mode: "csv", text: roster });
  c = j.compile(c.id, c.draftVersion);
  assert.equal(c.status, "READY_FOR_APPROVAL");
  const origin = await hosts.serve(j);
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(`${origin}/competitions/${encodeURIComponent(c.id)}`);

  await page.getByText("Change the event's facts").click();
  const form = page.locator("#facts-form");
  assert.equal(await form.getByLabel("Play starts").inputValue(), "2026-10-18T09:00", "start shown as London wall-clock time");
  assert.equal(await form.getByLabel("Must finish by").inputValue(), "2026-10-18T18:00");
  assert.ok(await noHorizontalOverflow(page), "the form reads without horizontal scrolling on a phone");

  await form.getByLabel("Number of courts").fill("3");
  await form.getByLabel("Match length").fill("20");
  await Promise.all([page.waitForEvent("load"), form.getByRole("button", { name: "Save facts" }).click()]);

  const revised = j.read(c.id)!;
  assert.equal(revised.status, "DRAFT", "the earlier plan is set aside until it is created again");
  assert.equal(revised.draftVersion, c.draftVersion + 1);
  assert.deepEqual({ courts: revised.blueprint.resourceCount, minutes: revised.blueprint.matchDurationMinutes,
    starts: revised.blueprint.startsAt, ends: revised.blueprint.endsAt, pairs: revised.blueprint.participantCount },
  { courts: 3, minutes: 20, starts: facts.startsAt, ends: facts.endsAt, pairs: 8 }, "only what was changed changes");
  assert.ok(revised.workbench.sources.some(({ kind }) => kind === "csv"), "the roster is kept");

  await Promise.all([page.waitForEvent("load"), page.getByRole("button", { name: "Create certified plan" }).click()]);
  const recompiled = j.read(c.id)!;
  assert.equal(recompiled.status, "READY_FOR_APPROVAL");
  assert.equal(recompiled.compiled!.guardStatus, "PASSED");
  assert.equal(new Set(recompiled.compiled!.schedule.map(({ resourceId }) => resourceId)).size, 3, "the plan uses the third court");
  await page.close();
});

test("a draft missing its rules is completed from the Studio alone", async () => {
  const j = journey();
  let c = j.create({ mode: "quick", value: facts }, "organiser.author");
  c = j.addSource(c.id, c.draftVersion, { mode: "csv", text: roster });
  assert.equal(c.status, "NEEDS_INPUT");
  const origin = await hosts.serve(j);
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(`${origin}/competitions/${encodeURIComponent(c.id)}`);
  const form = page.locator("#facts-form");
  await page.getByText("Change the event's facts").click();
  for (const [label, option] of [["Scoring", "Total score, no draws"], ["Ranking ties", /^Wins, then/], ["Withdrawals", /^Played results stand/], ["Draw", "Seeded in roster order"]] as const) {
    assert.equal(await form.getByLabel(label, { exact: true }).inputValue(), "", `${label} starts unchosen`);
    await form.getByLabel(label, { exact: true }).selectOption({ label: typeof option === "string" ? option
      : (await form.getByLabel(label, { exact: true }).locator("option").allInnerTexts()).find((text) => option.test(text))! });
  }
  await Promise.all([page.waitForEvent("load"), form.getByRole("button", { name: "Save facts" }).click()]);
  const completed = j.read(c.id)!;
  assert.equal(completed.status, "DRAFT", "every decision is made; the draft can be compiled");
  assert.deepEqual({ scoring: completed.blueprint.scoringPolicy, draw: completed.blueprint.drawPolicy },
    { scoring: rules.scoringPolicy, draw: rules.drawPolicy });
  assert.ok(await page.getByRole("button", { name: "Create certified plan" }).isVisible());
  await page.close();
});

test("after approval and before play, the organiser changes the courts and publishes revision 2 from the Studio", async () => {
  const j = journey();
  let c = j.create({ mode: "quick", value: { ...facts, ...rules } }, "organiser.author");
  c = j.addSource(c.id, c.draftVersion, { mode: "csv", text: roster });
  c = j.compile(c.id, c.draftVersion);
  c = j.approve(c.id, c.revision, "organiser.approver", c.compiled!.requiredAcknowledgementCodes);
  const origin = await hosts.serve(j);
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(`${origin}/competitions/${encodeURIComponent(c.id)}`);

  await Promise.all([page.waitForEvent("load"), page.getByRole("button", { name: "Change before play" }).click()]);
  await page.locator("#amendment-notice").waitFor();
  assert.match(await page.locator("#amendment-notice").innerText(), /Revision 1 stays in force until you approve this change/);
  await page.getByText("Change the event's facts").click();
  await page.locator("#facts-form").getByLabel("Number of courts").fill("3");
  await Promise.all([page.waitForEvent("load"), page.locator("#facts-form").getByRole("button", { name: "Save facts" }).click()]);
  await Promise.all([page.waitForEvent("load"), page.getByRole("button", { name: "Create certified plan" }).click()]);
  for (const box of await page.locator("#acks input[type=checkbox]").all()) await box.check();
  await Promise.all([page.waitForEvent("load"), page.getByRole("button", { name: "Approve and publish exact revision" }).click()]);

  const republished = j.read(c.id)!;
  assert.equal(republished.status, "PUBLISHED");
  assert.equal(republished.publication!.revision, 2);
  assert.equal(republished.blueprint.resourceCount, 3);
  assert.deepEqual(republished.publicationHistory!.map(({ revision }) => revision), [1]);
  assert.equal(await page.locator("#amendment-notice").count(), 0);
  await page.close();
});
