import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Browser } from "playwright-core";
import { CompetitionJourney } from "../../src/competition-journey.js";
import { pairs } from "../support/pools-knockout-event.js";
import { launchBrowser, noHorizontalOverflow, servers } from "./support.js";

// The organiser moves pairs between pools in the Studio. Counts follow each move, an uneven placement
// is refused by the server, and a valid one becomes the pools the plan is built from.

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

test("an organiser places two pairs in each other's pools and the plan is built from those pools", async () => {
  const journey = new CompetitionJourney({ organizationId: "org.flexible", now: () => "2026-11-01T08:00:00.000Z" });
  let c = journey.create({ mode: "quick", value: facts }, "organiser.author");
  c = journey.addSource(c.id, c.draftVersion, { mode: "csv", text: roster });
  const origin = await hosts.serve(journey);
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(`${origin}/competitions/${encodeURIComponent(c.id)}`);

  await page.getByText("Pools", { exact: true }).click();
  const editor = page.locator("#pool-form");
  assert.match(await page.locator("#pool-editor").innerText(), /Drawn automatically from the seeds/);
  const poolOf = (name: string) => editor.getByLabel(name, { exact: true }).inputValue();
  const [one, two] = [await poolOf("Winter Pair 1"), await poolOf("Winter Pair 2")];
  assert.notEqual(one, two);
  const partner = (await editor.locator(`fieldset[data-pool-id="${one}"] label`).allInnerTexts()).find((name) => name !== "Winter Pair 1")!;

  await editor.getByLabel("Winter Pair 2", { exact: true }).selectOption(one);
  assert.equal(await editor.locator(`fieldset[data-pool-id="${one}"] .pool-count`).innerText(), "5 of 4", "the count follows the move");
  const refused = page.waitForResponse((r) => r.url().endsWith("/pool-membership-preview"));
  await editor.getByRole("button", { name: "Save pools" }).click();
  assert.equal((await refused).status() >= 400, true, "an uneven placement is refused");
  assert.match(await page.locator("#pool-status").innerText(), /Place every entrant exactly once, with 4, 4, 4/);

  await editor.getByLabel(partner, { exact: true }).selectOption(two);
  assert.equal(await editor.locator(`fieldset[data-pool-id="${one}"] .pool-count`).innerText(), "4 of 4");
  assert.ok(await noHorizontalOverflow(page), "the pools read without horizontal scrolling on a phone");
  await editor.getByRole("button", { name: "Save pools" }).click();
  const review = page.getByRole("region", { name: "Review the pool change" });
  await review.waitFor();
  assert.match(await review.innerText(), /2 pairs move/);
  assert.match(await review.innerText(), /Winter Pair 2: Pool \d → Pool \d/);
  assert.match(await review.innerText(), /Pool matches: 6 added, 6 removed/);
  assert.equal(journey.read(c.id)!.poolMembership!.source, "AUTOMATIC", "nothing is saved until the change is applied");
  await Promise.all([page.waitForEvent("load"), review.getByRole("button", { name: "Apply this change" }).click()]);

  const saved = journey.read(c.id)!.poolMembership!;
  assert.equal(saved.source, "ORGANISER");
  const together = saved.pools.find(({ poolId }) => poolId === one)!.entrants.map(({ displayName }) => displayName);
  assert.ok(together.includes("Winter Pair 1") && together.includes("Winter Pair 2") && !together.includes(partner));

  await Promise.all([page.waitForEvent("load"), page.getByRole("button", { name: "Create and check plan" }).click()]);
  assert.equal(journey.read(c.id)!.compiled!.guardStatus, "PASSED");
  await page.close();
});

test("drawing the pools automatically again discards the organiser's placement", async () => {
  const journey = new CompetitionJourney({ organizationId: "org.flexible", now: () => "2026-11-01T08:00:00.000Z" });
  let c = journey.create({ mode: "quick", value: facts }, "organiser.author");
  c = journey.addSource(c.id, c.draftVersion, { mode: "csv", text: roster });
  const view = c.poolMembership!;
  const assignments = view.pools.flatMap(({ poolId, entrants }) => entrants.map(({ entrantId }) => ({ entrantId, poolId })));
  const [a, b] = [assignments.find(({ entrantId }) => entrantId === "pk.pair.1")!, assignments.find(({ entrantId }) => entrantId === "pk.pair.2")!];
  [a.poolId, b.poolId] = [b.poolId, a.poolId];
  const request = { kind: "PLACED" as const, stageId: view.stageId, basisHash: view.basisHash, assignments };
  c = journey.applyPoolMembership(c.id, c.draftVersion, request, journey.previewPoolMembership(c.id, c.draftVersion, request).previewHash, "organiser.author");
  const origin = await hosts.serve(journey);
  const page = await browser.newPage();
  await page.goto(`${origin}/competitions/${encodeURIComponent(c.id)}`);
  await page.getByText("Pools", { exact: true }).click();
  assert.match(await page.locator("#pool-editor").innerText(), /These are your pools/);
  await page.getByRole("button", { name: "Draw automatically again" }).click();
  const review = page.getByRole("region", { name: "Review the pool change" });
  await review.waitFor();
  assert.match(await review.innerText(), /Your saved placement is discarded/);
  await Promise.all([page.waitForEvent("load"), review.getByRole("button", { name: "Apply this change" }).click()]);
  const after = journey.read(c.id)!;
  assert.equal(after.poolMembership!.source, "AUTOMATIC");
  assert.deepEqual(after.poolMembershipHistory!.map(({ action }) => action), ["PLACED", "RETURNED_TO_AUTOMATIC"]);
  await page.close();
});
