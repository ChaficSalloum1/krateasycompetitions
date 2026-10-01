import assert from "node:assert/strict";
import test from "node:test";
import { CompetitionJourney, type PoolPlacementRequest } from "../src/competition-journey.js";
import { pairs } from "./support/pools-knockout-event.js";

// Replacing a roster is one previewed change: pairs joining, leaving and renamed, seed changes, and what
// happens to a created plan, saved pools and pool rules. It replaces every roster source at once.

const facts = { name: "Winter Pools and Knockout", sport: "padel", participantUnit: "pairs", participantCount: 12, resourceCount: 3,
  resourceLabel: "courts", format: "pools_to_knockout", poolSize: 4, qualifiersPerPool: 2, minimumMatches: 3, minimumRestMinutes: 10,
  matchDurationMinutes: 20, timezone: "Europe/London", priority: "fair_recovery", scoringPolicy: "head_to_head_total_score_no_draw",
  tiebreakPolicy: "wins_score_difference_score_for_manual", withdrawalPolicy: "preserve_played_walkover_future",
  drawPolicy: "seeded_input_order", startsAt: "2026-11-07T09:00:00.000Z", endsAt: "2026-11-07T21:00:00.000Z" } as const;
const roster = (ids: readonly string[], rename: Record<string, string> = {}) => ({ mode: "csv" as const, text: ["entrant_id,display_name,division_id,member_ids,seed",
  ...ids.map((id, index) => `${id},${rename[id] ?? `Winter Pair ${id.split(".").at(-1)}`},open,${id}.a|${id}.b,${index + 1}`)].join("\n") });
type Snapshot = ReturnType<CompetitionJourney["create"]>;
const change = (journey: CompetitionJourney, c: Snapshot, request: PoolPlacementRequest) =>
  journey.applyPoolMembership(c.id, c.draftVersion, request, journey.previewPoolMembership(c.id, c.draftVersion, request).previewHash, "organiser.author");

function compiled() {
  const journey = new CompetitionJourney({ organizationId: "org.pk", now: () => "2026-11-01T08:00:00.000Z" });
  let c = journey.create({ mode: "quick", value: facts }, "organiser.author");
  c = journey.addSource(c.id, c.draftVersion, roster(pairs));
  c = journey.compile(c.id, c.draftVersion);
  assert.equal(c.status, "READY_FOR_APPROVAL");
  return { journey, c };
}

test("a roster replacement is previewed with who joins, leaves and is renamed, then applied in one revision", () => {
  const { journey, c: start } = compiled();
  // Pair 12 withdraws, pair 13 joins, pair 3 corrects its name, and the seeds of 12 and 13 differ.
  const next = roster([...pairs.slice(0, 11), "pk.pair.13"], { "pk.pair.3": "Winter Pair Three" });
  const preview = journey.previewRosterReplacement(start.id, start.draftVersion, next);
  assert.deepEqual(preview.added.map(({ entrantId }) => entrantId), ["pk.pair.13"]);
  assert.deepEqual(preview.removed.map(({ entrantId }) => entrantId), ["pk.pair.12"]);
  assert.deepEqual(preview.renamed, [{ entrantId: "pk.pair.3", from: "Winter Pair 3", to: "Winter Pair Three" }]);
  assert.ok(preview.consequences.some((text) => /plan already created is set aside/.test(text)));
  assert.equal(journey.read(start.id)!.status, "READY_FOR_APPROVAL", "a preview changes nothing");

  assert.throws(() => journey.applyRosterReplacement(start.id, start.draftVersion, roster(pairs), preview.previewHash),
    /roster_replacement_preview_mismatch/, "a different roster cannot ride on another preview");
  const c = journey.applyRosterReplacement(start.id, start.draftVersion, next, preview.previewHash);
  assert.equal(c.draftVersion, start.draftVersion + 1, "one revision");
  assert.equal(c.status, "DRAFT");
  assert.equal(c.workbench.sources.filter(({ kind }) => kind === "csv").length, 1, "the old roster is replaced, not kept beside the new one");
  const compiledAgain = journey.compile(c.id, c.draftVersion);
  assert.equal(compiledAgain.compiled!.guardStatus, "PASSED");
  assert.ok(journey.read(c.id)!.poolMembership!.pools.some(({ entrants }) => entrants.some(({ displayName }) => displayName === "Winter Pair Three")));
});

test("an unreadable roster is refused and the preview says what a roster change breaks", () => {
  const { journey, c: start } = compiled();
  assert.throws(() => journey.previewRosterReplacement(start.id, start.draftVersion, { mode: "csv", text: "wrong,header\n1,2" }),
    /roster_replacement_invalid/);
  let c = change(journey, start, { kind: "RULES", rules: [{ kind: "SEPARATE", entrantIds: ["pk.pair.4", "pk.pair.12"] }] });
  const view = c.poolMembership!;
  c = change(journey, c, { kind: "PLACED", stageId: view.stageId, basisHash: view.basisHash,
    assignments: view.pools.flatMap(({ poolId, entrants }) => entrants.map(({ entrantId }) => ({ entrantId, poolId }))) });
  const preview = journey.previewRosterReplacement(c.id, c.draftVersion, roster([...pairs.slice(0, 11), "pk.pair.13"]));
  assert.ok(preview.consequences.some((text) => /saved pools no longer cover the roster/.test(text)));
  assert.ok(preview.consequences.some((text) => /pool rule names a pair who leaves/.test(text)));
  const short = journey.previewRosterReplacement(c.id, c.draftVersion, roster(pairs.slice(0, 11)));
  assert.ok(short.consequences.some((text) => /11 entrants; the event's facts say 12/.test(text)));
  c = journey.applyRosterReplacement(c.id, c.draftVersion, roster([...pairs.slice(0, 11), "pk.pair.13"]), preview.previewHash);
  assert.equal(c.status, "NEEDS_INPUT");
  assert.equal(c.poolMembership!.stale, true);
  assert.equal(c.poolMembership!.rulesStale, true);
});
