import assert from "node:assert/strict";
import test from "node:test";
import { betterSeed, liveEvent, pairs, withPoolTwoCycle } from "./support/pools-knockout-event.js";

// A generic pools-into-knockout event, played live to its final: pools settle, the knockout sides are
// filled from the real pool standings (with byes for a six-pair knockout), and the event closes clean.

test("pools into a knockout is created, played live from pools to final, and closed", () => {
  const event = liveEvent();
  assert.ok(event.competition.compiled!.requiredAcknowledgementCodes.includes("TSC712"),
    "approval acknowledges that a pool tie deciding progression may need the organiser's decision");
  event.playReady(betterSeed);

  const final = event.read();
  assert.deepEqual(final.openTies, []);
  assert.ok(final.controlContests.every(({ status }) => status === "COMPLETED"), "every playable fixture has a result");
  const knockout = final.controlContests.filter(({ contestId }) => contestId.startsWith("open.main"));
  assert.ok(knockout.length >= 4, "the knockout was reached and played with sides decided by the pools");
  const knockoutPlayers = new Set(knockout.flatMap(({ sides }) => sides.map(({ entrantId }) => entrantId)));
  assert.ok([...knockoutPlayers].every((id) => pairs.includes(id)), "knockout sides are registered pairs");

  const closed = event.close();
  assert.equal(closed.status, "CLOSED");
  assert.equal(closed.closure!.resultSummary.unresolved, 0);
});

test("a pool tie the tiebreaks cannot separate waits for the organiser's recorded order, then fills the knockout from it", () => {
  const event = liveEvent();
  event.playReady(withPoolTwoCycle);

  const waiting = event.read();
  assert.deepEqual(waiting.openTies!.map(({ poolId, entrantIds }) => ({ poolId, entrantIds })),
    [{ poolId: "open.pools.P2", entrantIds: ["pk.pair.2", "pk.pair.5", "pk.pair.8"] }]);
  assert.ok(waiting.controlContests.every(({ contestId }) => !contestId.startsWith("open.main")),
    "no knockout side is filled while the tie that decides it is open");
  const tie = waiting.openTies![0]!;

  // The decision must order exactly the open tie: it cannot rerank a pair the tiebreaks already placed.
  assert.throws(() => event.submit({ kind: "DECIDE_STANDINGS_TIE", standingsPolicyId: tie.standingsPolicyId, poolId: tie.poolId,
    orderedEntrantIds: ["pk.pair.8", "pk.pair.5"], reason: "Coin toss at the desk" }), /standings_tie_not_open/);
  assert.throws(() => event.submit({ kind: "DECIDE_STANDINGS_TIE", standingsPolicyId: tie.standingsPolicyId, poolId: tie.poolId,
    orderedEntrantIds: ["pk.pair.8", "pk.pair.5", "pk.pair.11"], reason: "Coin toss at the desk" }), /standings_tie_not_open/);

  event.submit({ kind: "DECIDE_STANDINGS_TIE", standingsPolicyId: tie.standingsPolicyId, poolId: tie.poolId,
    orderedEntrantIds: ["pk.pair.8", "pk.pair.5", "pk.pair.2"], reason: "Coin toss at the desk, witnessed by both captains" });
  const decided = event.read();
  assert.deepEqual(decided.openTies, []);
  const knockoutSides = new Set(decided.controlContests.filter(({ contestId }) => contestId.startsWith("open.main"))
    .flatMap(({ sides }) => sides.map(({ entrantId }) => entrantId)));
  assert.ok(knockoutSides.has("pk.pair.8") || knockoutSides.has("pk.pair.5"), "the knockout is filled from the recorded order");
  assert.ok(!knockoutSides.has("pk.pair.2"), "the pair placed third by the decision does not progress");
  assert.ok(event.competition.live!.state.events.some((e) => e.kind === "STANDINGS_TIE_DECIDED" && e.reason.includes("captains")),
    "the decision and its reason are in the audited event chain");

  event.playReady(withPoolTwoCycle);
  const closed = event.close();
  assert.equal(closed.status, "CLOSED");
  assert.equal(closed.closure!.resultSummary.unresolved, 0);
});
