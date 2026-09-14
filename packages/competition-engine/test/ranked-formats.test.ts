import assert from "node:assert/strict";
import test from "node:test";
import {
  applyLadderChallenge,
  assignQualifyingHeats,
  createLadder,
  pairSwissRound,
  qualifyRankingStage,
  rankTimeTrial,
  verifyLadder,
} from "../src/ranked-formats.js";

test("pairs a chess-like Swiss round by score without rematches and proves deterministic coverage", () => {
  const request = {
    round: 3,
    competitors: [
      { id: "a", points: 2, opponents: ["c", "d"], byeCount: 0 },
      { id: "b", points: 2, opponents: ["d", "e"], byeCount: 0 },
      { id: "c", points: 1, opponents: ["a", "f"], byeCount: 0 },
      { id: "d", points: 1, opponents: ["a", "b"], byeCount: 0 },
      { id: "e", points: 0, opponents: ["b"], byeCount: 0 },
      { id: "f", points: 0, opponents: ["c"], byeCount: 0 },
    ],
    policy: { rematches: "FORBIDDEN" as const },
  };

  const result = pairSwissRound(request);

  assert.equal(result.status, "CERTIFIED");
  assert.deepEqual(result.pairings.map(({ competitors }) => competitors), [["a", "b"], ["c", "d"], ["e", "f"]]);
  assert.equal(result.bye, null);
  assert.equal(result.proof.completeCoverage, true);
  assert.equal(result.proof.rematchCount, 0);
  assert.equal(result.proof.scoreGap, 0);
  assert.match(result.replayHash, /^[a-f0-9]{64}$/);
  assert.equal(pairSwissRound(request).replayHash, result.replayHash);
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.pairings));
});

test("Swiss pairing assigns an odd-field bye to the lowest ranked eligible active competitor", () => {
  const result = pairSwissRound({
    round: 4,
    competitors: [
      { id: "leader", points: 3, opponents: [], byeCount: 0 },
      { id: "two", points: 2, opponents: [], byeCount: 0 },
      { id: "three", points: 1, opponents: [], byeCount: 1 },
      { id: "four", points: 1, opponents: [], byeCount: 0 },
      { id: "five", points: 2, opponents: [], byeCount: 0 },
      { id: "withdrawn", points: 0, opponents: [], byeCount: 0, withdrawn: true },
    ],
    policy: { rematches: "FORBIDDEN", bye: "LOWEST_RANKED_WITHOUT_BYE" },
  });

  assert.equal(result.status, "CERTIFIED");
  assert.equal(result.bye?.competitorId, "four");
  assert.equal(result.bye?.reason, "lowest-ranked-active-competitor-without-prior-bye");
  assert.deepEqual(result.proof.excludedCompetitorIds, ["withdrawn"]);
});

test("Swiss pairing fails closed for ambiguous byes and impossible no-rematch constraints", () => {
  const odd = pairSwissRound({
    round: 1,
    competitors: [
      { id: "a", points: 0, opponents: [], byeCount: 0 },
      { id: "b", points: 0, opponents: [], byeCount: 0 },
      { id: "c", points: 0, opponents: [], byeCount: 0 },
    ],
    policy: { rematches: "FORBIDDEN" },
  });
  assert.equal(odd.status, "REJECTED");
  assert.equal(odd.findings[0]?.code, "BYE_POLICY_REQUIRED");

  const impossible = pairSwissRound({
    round: 2,
    competitors: [
      { id: "a", points: 1, opponents: ["b"], byeCount: 0 },
      { id: "b", points: 1, opponents: ["a"], byeCount: 0 },
    ],
    policy: { rematches: "FORBIDDEN" },
  });
  assert.equal(impossible.status, "REJECTED");
  assert.equal(impossible.findings[0]?.code, "PAIRING_INFEASIBLE");

  const explicit = pairSwissRound({
    round: 2,
    competitors: [
      { id: "a", points: 1, opponents: ["b"], byeCount: 0 },
      { id: "b", points: 1, opponents: ["a"], byeCount: 0 },
    ],
    policy: { rematches: "MINIMIZE" },
  });
  assert.equal(explicit.status, "CERTIFIED");
  assert.equal(explicit.proof.rematchCount, 1);
});

test("Swiss pairing distinguishes an exhausted proof search from infeasibility", () => {
  const result = pairSwissRound({
    round: 1,
    competitors: ["a", "b", "c", "d"].map((id) => ({ id, points: 0, opponents: [], byeCount: 0 })),
    policy: { rematches: "FORBIDDEN", searchNodeLimit: 1 },
  });
  assert.equal(result.status, "REJECTED");
  assert.equal(result.findings[0]?.code, "PAIRING_SEARCH_LIMIT");
  assert.ok(result.proof.searchNodes > result.proof.searchNodeLimit);
});

test("applies a ladder upset as an immutable, hash-chained audited transition", () => {
  const initial = createLadder("club-ladder", ["ana", "bea", "cara", "dina"]);
  const transition = applyLadderChallenge(initial, {
    challengerId: "cara", defenderId: "ana", winnerId: "cara", maxChallengeDistance: 2,
    actorId: "referee-7", occurredAt: "2026-09-05T10:00:00.000Z", reason: "Challenge court 1 result",
  });

  assert.equal(transition.status, "CERTIFIED");
  assert.deepEqual(initial.order, ["ana", "bea", "cara", "dina"]);
  assert.deepEqual(transition.ladder.order, ["cara", "ana", "bea", "dina"]);
  assert.equal(transition.ladder.version, 1);
  assert.equal(transition.proof.previousStateHash, initial.stateHash);
  assert.equal(transition.proof.changed, true);
  assert.equal(verifyLadder(transition.ladder).valid, true);
  assert.ok(Object.isFrozen(transition.ladder));
  assert.throws(() => (transition.ladder.order as string[]).push("eve"));
});

test("rejects unaudited, invalid, and out-of-range ladder challenges without changing state", () => {
  const ladder = createLadder("club-ladder", ["a", "b", "c", "d"]);
  const result = applyLadderChallenge(ladder, {
    challengerId: "d", defenderId: "a", winnerId: "d", maxChallengeDistance: 2,
    actorId: "official", occurredAt: "2026-09-05T10:00:00Z", reason: "Verified result",
  });
  assert.equal(result.status, "REJECTED");
  assert.equal(result.findings[0]?.code, "CHALLENGE_OUT_OF_RANGE");
  assert.equal(result.ladder, ladder);
});

test("assigns athletics/swimming qualifying heats with serpentine seeds and explicit lane priority", () => {
  const result = assignQualifyingHeats({
    stageId: "100m-heats",
    entrants: [
      { id: "a", seedMark: 10.01 }, { id: "b", seedMark: 10.04 }, { id: "c", seedMark: 10.08 },
      { id: "d", seedMark: 10.12 }, { id: "e", seedMark: 10.15 }, { id: "f", seedMark: 10.2 },
      { id: "scratch", seedMark: 9.99, withdrawn: true },
    ],
    heatCount: 2,
    lanesPerHeat: 4,
    lanePriority: [4, 3, 2, 1],
    betterMark: "LOWER",
  });

  assert.equal(result.status, "CERTIFIED");
  assert.deepEqual(result.heats.map((heat) => heat.assignments.map(({ competitorId }) => competitorId)), [
    ["a", "d", "e"], ["b", "c", "f"],
  ]);
  assert.deepEqual(result.heats.map((heat) => heat.assignments.map(({ lane }) => lane)), [[4, 3, 2], [4, 3, 2]]);
  assert.equal(result.proof.everyActiveEntrantAssignedExactlyOnce, true);
  assert.deepEqual(result.proof.excludedCompetitorIds, ["scratch"]);
  assert.match(result.replayHash, /^[a-f0-9]{64}$/);
});

test("rejects heat requests whose capacity or lane policy cannot be proven", () => {
  const entrants = ["a", "b", "c"].map((id, index) => ({ id, seedMark: index + 1 }));
  assert.equal(assignQualifyingHeats({ stageId: "h", entrants, heatCount: 1, lanesPerHeat: 2,
    lanePriority: [1, 2], betterMark: "LOWER" }).findings[0]?.code, "INSUFFICIENT_CAPACITY");
  assert.equal(assignQualifyingHeats({ stageId: "h", entrants: entrants.slice(0, 2), heatCount: 1, lanesPerHeat: 2,
    lanePriority: [1, 1], betterMark: "LOWER" }).findings[0]?.code, "INVALID_LANE_POLICY");
});

test("does not silently break equal heat seed marks without an explicit policy", () => {
  const request = { stageId: "h", entrants: [{ id: "a", seedMark: 12 }, { id: "b", seedMark: 12 }],
    heatCount: 1, lanesPerHeat: 2, lanePriority: [1, 2], betterMark: "LOWER" as const };
  const unresolved = assignQualifyingHeats(request);
  assert.equal(unresolved.status, "REJECTED");
  assert.equal(unresolved.findings[0]?.code, "SEED_TIE_UNRESOLVED");

  const explicit = assignQualifyingHeats({ ...request, seedTiePolicy: "COMPETITOR_ID" });
  assert.equal(explicit.status, "CERTIFIED");
  assert.deepEqual(explicit.heats[0]?.assignments.map(({ competitorId }) => competitorId), ["a", "b"]);
});

test("ranks a swimming time trial with non-finishers after valid times", () => {
  const result = rankTimeTrial({
    stageId: "200-free",
    results: [
      { competitorId: "b", status: "VALID", timeMilliseconds: 111220 },
      { competitorId: "a", status: "VALID", timeMilliseconds: 110005 },
      { competitorId: "c", status: "DNF" },
      { competitorId: "d", status: "DQ" },
    ],
    tiePolicy: "UNRESOLVED",
  });
  assert.equal(result.status, "CERTIFIED");
  assert.deepEqual(result.ranking.map(({ competitorId, rank }) => [competitorId, rank]), [["a", 1], ["b", 2], ["c", null], ["d", null]]);
  assert.equal(result.proof.validResultsRanked, 2);
  assert.equal(result.proof.nonFinishersRanked, 0);
});

test("time-trial ties remain unresolved unless an explicit tie policy supplies semantics", () => {
  const request = { stageId: "sprint", results: [
    { competitorId: "a", status: "VALID" as const, timeMilliseconds: 10000 },
    { competitorId: "b", status: "VALID" as const, timeMilliseconds: 10000 },
  ] };
  const unresolved = rankTimeTrial({ ...request, tiePolicy: "UNRESOLVED" });
  assert.equal(unresolved.status, "REJECTED");
  assert.equal(unresolved.findings[0]?.code, "UNRESOLVED_TIE");

  const shared = rankTimeTrial({ ...request, tiePolicy: "SHARED_RANK" });
  assert.equal(shared.status, "CERTIFIED");
  assert.deepEqual(shared.ranking.map(({ rank }) => rank), [1, 1]);
});

test("ranking-stage qualification rejects a cutoff tie until a policy is explicit", () => {
  const base = {
    stageId: "judged-final", qualificationPlaces: 2, betterScore: "HIGHER" as const,
    results: [
      { competitorId: "a", score: 9.5 }, { competitorId: "b", score: 9.1 },
      { competitorId: "c", score: 9.1 }, { competitorId: "d", score: 8.9 },
    ],
  };
  const unresolved = qualifyRankingStage({ ...base, cutoffTiePolicy: "UNRESOLVED" });
  assert.equal(unresolved.status, "REJECTED");
  assert.equal(unresolved.findings[0]?.code, "CUTOFF_TIE_UNRESOLVED");
  assert.deepEqual(unresolved.proof.cutoffTieCompetitorIds, ["b", "c"]);

  const seeded = qualifyRankingStage({ ...base, cutoffTiePolicy: "SEED_ORDER", seedOrder: ["c", "b", "a", "d"] });
  assert.equal(seeded.status, "CERTIFIED");
  assert.deepEqual(seeded.qualifiedCompetitorIds, ["a", "c"]);
  assert.equal(seeded.proof.qualificationCountExact, true);
  assert.equal(qualifyRankingStage({ ...base, cutoffTiePolicy: "SEED_ORDER", seedOrder: ["c", "b", "a", "d"] }).replayHash, seeded.replayHash);
});
