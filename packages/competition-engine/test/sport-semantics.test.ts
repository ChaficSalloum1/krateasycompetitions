import assert from "node:assert/strict";
import test from "node:test";
import { createSportSemantics } from "../src/sport-semantics.js";

test("adjudicates football scores through a registered declarative head-to-head policy", () => {
  const semantics = createSportSemantics([{
    id: "football-3-1-0", version: "1.0.0",
    adapter: "HEAD_TO_HEAD",
    resultShape: "TOTAL_SCORE",
    valueRule: { kind: "NON_NEGATIVE_INTEGER" },
    draws: "ALLOWED",
    standingsPoints: { win: 3, draw: 1, loss: 0 },
    walkover: "OPPONENT_WINS",
  }]);

  const result = semantics.evaluate({
    policyId: "football-3-1-0",
    contestId: "match-17",
    entrants: ["home", "away"],
    result: { shape: "TOTAL_SCORE", score: [2, 2] },
  });

  assert.equal(result.status, "CERTIFIED");
  assert.equal(result.adapter, "HEAD_TO_HEAD");
  assert.deepEqual(result.placements, [
    { competitorId: "away", rank: 1, outcome: "DRAW", standingsPoints: 1 },
    { competitorId: "home", rank: 1, outcome: "DRAW", standingsPoints: 1 },
  ]);
  assert.match(result.proofHash, /^[a-f0-9]{64}$/);
  assert.equal(semantics.evaluate({
    policyId: "football-3-1-0", contestId: "match-17", entrants: ["home", "away"],
    result: { shape: "TOTAL_SCORE", score: [2, 2] },
  }).proofHash, result.proofHash);
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.placements));
});

test("validates completed best-of series for tennis and padel without sport-name branches", () => {
  const semantics = createSportSemantics([{
    id: "racket-best-of-three", version: "1.0.0", adapter: "HEAD_TO_HEAD", resultShape: "BEST_OF_UNITS",
    valueRule: { kind: "NON_NEGATIVE_INTEGER" }, bestOf: 3, draws: "FORBIDDEN",
    standingsPoints: { win: 1, draw: 0, loss: 0 }, walkover: "OPPONENT_WINS",
  }]);

  const certified = semantics.evaluate({
    policyId: "racket-best-of-three", contestId: "court-2", entrants: ["pair-z", "pair-a"],
    result: { shape: "BEST_OF_UNITS", units: [[6, 4], [3, 6], [7, 5]] },
  });
  assert.equal(certified.status, "CERTIFIED");
  assert.deepEqual(certified.placements.map(({ competitorId, outcome }) => [competitorId, outcome]),
    [["pair-z", "WIN"], ["pair-a", "LOSS"]]);

  const incomplete = semantics.evaluate({
    policyId: "racket-best-of-three", contestId: "court-3", entrants: ["a", "b"],
    result: { shape: "BEST_OF_UNITS", units: [[6, 4]] },
  });
  assert.equal(incomplete.status, "REJECTED");
  assert.equal(incomplete.findings[0]?.code, "SERIES_INCOMPLETE");
});

test("ranks athletics distances by the best valid attempt and preserves non-result truth", () => {
  const semantics = createSportSemantics([{
    id: "long-jump", version: "1.0.0", adapter: "RANKED_PERFORMANCE", resultShape: "PERFORMANCE_ATTEMPTS",
    metricId: "metres", direction: "HIGHER_IS_BETTER", valueRule: { kind: "NON_NEGATIVE_NUMBER" },
    attempts: { minimum: 1, maximum: 6, aggregation: "BEST" }, tiePolicy: "REJECT",
    permittedNonResults: ["DNS", "DNF", "DQ"],
  }]);
  const result = semantics.evaluate({
    policyId: "long-jump", contestId: "final", entrants: ["c", "a", "b", "d"],
    result: { shape: "PERFORMANCE_ATTEMPTS", metricId: "metres", performances: [
      { competitorId: "a", status: "VALID", attempts: [6.41, 6.63, 6.58] },
      { competitorId: "b", status: "VALID", attempts: [6.71, 6.7] },
      { competitorId: "c", status: "DNS" },
      { competitorId: "d", status: "DQ" },
    ] },
  });
  assert.equal(result.status, "CERTIFIED");
  assert.deepEqual(result.placements, [
    { competitorId: "b", rank: 1, outcome: "VALID", mark: 6.71 },
    { competitorId: "a", rank: 2, outcome: "VALID", mark: 6.63 },
    { competitorId: "c", rank: null, outcome: "DNS" },
    { competitorId: "d", rank: null, outcome: "DQ" },
  ]);
  assert.ok(Object.isFrozen(result.placements[0]));
});

test("accepts only registered chess score values and certifies a game draw", () => {
  const semantics = createSportSemantics([{
    id: "chess-game", version: "1.0.0", adapter: "HEAD_TO_HEAD", resultShape: "TOTAL_SCORE",
    valueRule: { kind: "ENUM", values: [0, 0.5, 1] }, draws: "ALLOWED",
    standingsPoints: { win: 1, draw: 0.5, loss: 0 }, walkover: "OPPONENT_WINS",
  }]);
  const draw = semantics.evaluate({ policyId: "chess-game", contestId: "board-1", entrants: ["black", "white"],
    result: { shape: "TOTAL_SCORE", score: [0.5, 0.5] } });
  assert.equal(draw.status, "CERTIFIED");
  assert.deepEqual(draw.placements.map(({ outcome, standingsPoints }) => [outcome, standingsPoints]), [["DRAW", 0.5], ["DRAW", 0.5]]);

  const inventedQuarterPoint = semantics.evaluate({ policyId: "chess-game", contestId: "board-2", entrants: ["black", "white"],
    result: { shape: "TOTAL_SCORE", score: [0.75, 0.25] } });
  assert.equal(inventedQuarterPoint.status, "REJECTED");
  assert.equal(inventedQuarterPoint.findings[0]?.code, "INVALID_SCORE");
});

test("derives a scoreless walkover winner only from the registered opponent policy", () => {
  const semantics = createSportSemantics([{
    id: "club-match", version: "1.0.0", adapter: "HEAD_TO_HEAD", resultShape: "TOTAL_SCORE",
    valueRule: { kind: "NON_NEGATIVE_INTEGER" }, draws: "ALLOWED",
    standingsPoints: { win: 3, draw: 1, loss: 0 }, walkover: "OPPONENT_WINS",
  }]);
  const result = semantics.evaluate({ policyId: "club-match", contestId: "m-9", entrants: ["a", "b"],
    result: { shape: "WALKOVER", absentCompetitorId: "a" } });
  assert.equal(result.status, "CERTIFIED");
  assert.deepEqual(result.placements, [
    { competitorId: "b", rank: 1, outcome: "WIN", standingsPoints: 3 },
    { competitorId: "a", rank: 2, outcome: "LOSS", standingsPoints: 0 },
  ]);
  assert.ok(result.proof.assertions.includes("scoreless-walkover"));
});

test("ranks swimming times in the lower-is-better direction with a DNF outside the ranking", () => {
  const semantics = createSportSemantics([{
    id: "swim-time", version: "1.0.0", adapter: "RANKED_PERFORMANCE", resultShape: "PERFORMANCE_ATTEMPTS",
    metricId: "milliseconds", direction: "LOWER_IS_BETTER", valueRule: { kind: "NON_NEGATIVE_INTEGER" },
    attempts: { minimum: 1, maximum: 1, aggregation: "BEST" }, tiePolicy: "REJECT", permittedNonResults: ["DNF", "DQ"],
  }]);
  const result = semantics.evaluate({ policyId: "swim-time", contestId: "heat-1", entrants: ["c", "b", "a"],
    result: { shape: "PERFORMANCE_ATTEMPTS", metricId: "milliseconds", performances: [
      { competitorId: "c", status: "DNF" }, { competitorId: "b", status: "VALID", attempts: [50100] },
      { competitorId: "a", status: "VALID", attempts: [49200] },
    ] } });
  assert.equal(result.status, "CERTIFIED");
  assert.deepEqual(result.placements.map(({ competitorId, rank, outcome }) => [competitorId, rank, outcome]),
    [["a", 1, "VALID"], ["b", 2, "VALID"], ["c", null, "DNF"]]);
});

test("uses an explicit shared-rank policy for judged points and is invariant to submission order", () => {
  const policy = {
    id: "judged-points", version: "1.0.0" as const, adapter: "RANKED_PERFORMANCE" as const, resultShape: "PERFORMANCE_ATTEMPTS" as const,
    metricId: "jury-points", direction: "HIGHER_IS_BETTER" as const, valueRule: { kind: "NON_NEGATIVE_NUMBER" as const },
    attempts: { minimum: 1, maximum: 3, aggregation: "BEST" as const }, tiePolicy: "SHARED_RANK" as const,
    permittedNonResults: ["DQ" as const],
  };
  const semantics = createSportSemantics([policy]);
  const performances = [
    { competitorId: "b", status: "VALID", attempts: [8.9, 9.5] },
    { competitorId: "c", status: "VALID", attempts: [9.1] },
    { competitorId: "a", status: "VALID", attempts: [9.5] },
  ];
  const request = { policyId: policy.id, contestId: "final", entrants: ["c", "b", "a"],
    result: { shape: "PERFORMANCE_ATTEMPTS", metricId: "jury-points", performances } };
  const result = semantics.evaluate(request);
  assert.equal(result.status, "CERTIFIED");
  assert.deepEqual(result.placements.map(({ competitorId, rank }) => [competitorId, rank]), [["a", 1], ["b", 1], ["c", 3]]);
  assert.equal(semantics.evaluate({ ...request, result: { ...request.result, performances: [...performances].reverse() } }).proofHash,
    result.proofHash);
});

test("fails closed for unregistered policies, metrics, shapes, and unresolved performance ties", () => {
  const semantics = createSportSemantics([{
    id: "sprint-time", version: "1.0.0", adapter: "RANKED_PERFORMANCE", resultShape: "PERFORMANCE_ATTEMPTS",
    metricId: "milliseconds", direction: "LOWER_IS_BETTER", valueRule: { kind: "NON_NEGATIVE_INTEGER" },
    attempts: { minimum: 1, maximum: 1, aggregation: "BEST" }, tiePolicy: "REJECT", permittedNonResults: ["DNS"],
  }]);
  const base = { contestId: "100m", entrants: ["a", "b"], result: { shape: "PERFORMANCE_ATTEMPTS", metricId: "milliseconds",
    performances: [{ competitorId: "a", status: "VALID", attempts: [10001] }, { competitorId: "b", status: "VALID", attempts: [10001] }] } };

  assert.equal(semantics.evaluate({ ...base, policyId: "missing" }).findings[0]?.code, "UNREGISTERED_POLICY");
  assert.equal(semantics.evaluate({ ...base, policyId: "sprint-time", result: { ...base.result, metricId: "seconds" } }).findings[0]?.code,
    "RESULT_SHAPE_MISMATCH");
  assert.equal(semantics.evaluate({ ...base, policyId: "sprint-time", result: { shape: "PLACEMENTS", metricId: "milliseconds" } }).findings[0]?.code,
    "RESULT_SHAPE_MISMATCH");
  assert.equal(semantics.evaluate({ ...base, policyId: "sprint-time" }).findings[0]?.code, "UNRESOLVED_TIE");
});

test("never routes an unregistered scoring adapter through a default implementation", () => {
  const forgedPolicies: Parameters<typeof createSportSemantics>[0] = [
    { id: "unknown-scoring", version: "1.0.0", adapter: "MAGIC_WINNER" } as never,
  ];
  const result = createSportSemantics(forgedPolicies).evaluate({
    policyId: "unknown-scoring", contestId: "x", entrants: ["a", "b"], result: { shape: "TOTAL_SCORE", score: [1, 0] },
  });
  assert.equal(result.status, "REJECTED");
  assert.equal(result.adapter, "UNRESOLVED");
  assert.equal(result.findings[0]?.code, "UNREGISTERED_ADAPTER");
});

test("validates best-of units against a declarative minimum and win-by-two rule", () => {
  const semantics = createSportSemantics([{
    id: "volleyball-best-of-five", version: "1.0.0", adapter: "HEAD_TO_HEAD", resultShape: "BEST_OF_UNITS",
    valueRule: { kind: "NON_NEGATIVE_INTEGER" }, bestOf: 5, draws: "FORBIDDEN",
    unitWinRule: { minimum: 25, decidingMinimum: 15, margin: 2 },
    standingsPoints: { win: 3, draw: 0, loss: 0 }, walkover: "OPPONENT_WINS",
  }]);
  const certified = semantics.evaluate({ policyId: "volleyball-best-of-five", contestId: "pool-1", entrants: ["blue", "red"],
    result: { shape: "BEST_OF_UNITS", units: [[25, 20], [22, 25], [27, 25], [23, 25], [15, 13]] } });
  assert.equal(certified.status, "CERTIFIED");
  assert.equal(certified.outcomePorts.winnerId, "blue");

  const invalid = semantics.evaluate({ policyId: "volleyball-best-of-five", contestId: "pool-2", entrants: ["blue", "red"],
    result: { shape: "BEST_OF_UNITS", units: [[25, 24], [25, 20], [25, 20]] } });
  assert.equal(invalid.status, "REJECTED");
  assert.equal(invalid.findings[0]?.code, "UNIT_WIN_RULE_VIOLATION");
});

test("preserves explicit combat decisions, disqualifications, and no-contests for downstream provenance", () => {
  const policy = {
    id: "combat-outcome", version: "1.0.0" as const, adapter: "HEAD_TO_HEAD" as const, resultShape: "OUTCOME" as const,
    valueRule: { kind: "NON_NEGATIVE_INTEGER" as const }, draws: "FORBIDDEN" as const,
    standingsPoints: { win: 1, draw: 0, loss: 0 }, walkover: "REJECT" as const,
    permittedOutcomes: ["DECISION", "DISQUALIFICATION", "NO_CONTEST"] as const,
    decisionScore: "REQUIRED" as const,
  };
  const semantics = createSportSemantics([policy]);
  const base = { policyId: policy.id, contestId: "bout-1", entrants: ["fighter-b", "fighter-a"] };
  const decision = semantics.evaluate({ ...base, result: {
    shape: "OUTCOME", outcome: "DECISION", winnerCompetitorId: "fighter-a", score: [28, 29],
  } });
  assert.equal(decision.status, "CERTIFIED");
  assert.deepEqual(decision.outcomePorts, { winnerId: "fighter-a", loserId: "fighter-b" });

  const disqualification = semantics.evaluate({ ...base, result: {
    shape: "OUTCOME", outcome: "DISQUALIFICATION", disqualifiedCompetitorId: "fighter-b",
  } });
  assert.equal(disqualification.status, "CERTIFIED");
  assert.equal(disqualification.placements.find(({ competitorId }) => competitorId === "fighter-b")?.outcome, "DQ");
  assert.deepEqual(disqualification.outcomePorts, { winnerId: "fighter-a", loserId: "fighter-b" });

  const noContest = semantics.evaluate({ ...base, result: { shape: "OUTCOME", outcome: "NO_CONTEST" } });
  assert.equal(noContest.status, "CERTIFIED");
  assert.ok(noContest.placements.every(({ outcome, rank }) => outcome === "NO_CONTEST" && rank === null));
  assert.deepEqual(noContest.outcomePorts, { winnerId: null, loserId: null });
  assert.equal(semantics.evaluate({ ...base, result: { shape: "OUTCOME", outcome: "TECHNICAL_DRAW" } }).status, "REJECTED");
  assert.equal(semantics.evaluate({ ...base, result: {
    shape: "OUTCOME", outcome: "DECISION", winnerCompetitorId: "fighter-a", score: [30, 27],
  } }).findings[0]?.code, "INVALID_DECISION_SCORE");
});

test("certifies an ordered finish with explicit motorsport non-results independent of input order", () => {
  const policy = {
    id: "ordered-finish", version: "1.0.0" as const, adapter: "RANKED_PERFORMANCE" as const,
    resultShape: "ORDERED_FINISH" as const, nonResultOrder: ["DNF", "DSQ", "DNS"] as const,
    permittedNonResults: ["DNS", "DNF", "DSQ"] as const,
  };
  const semantics = createSportSemantics([policy]);
  const result = { shape: "ORDERED_FINISH", finishers: ["car-c", "car-a"], nonResults: [
    { competitorId: "car-e", status: "DNS" }, { competitorId: "car-b", status: "DNF" },
    { competitorId: "car-d", status: "DSQ" },
  ] };
  const certified = semantics.evaluate({ policyId: policy.id, contestId: "race-1",
    entrants: ["car-e", "car-a", "car-d", "car-c", "car-b"], result });
  assert.equal(certified.status, "CERTIFIED");
  assert.deepEqual(certified.placements.map(({ competitorId, rank, outcome }) => [competitorId, rank, outcome]), [
    ["car-c", 1, "VALID"], ["car-a", 2, "VALID"], ["car-b", null, "DNF"],
    ["car-d", null, "DSQ"], ["car-e", null, "DNS"],
  ]);
  const permuted = semantics.evaluate({ policyId: policy.id, contestId: "race-1",
    entrants: ["car-b", "car-c", "car-d", "car-a", "car-e"], result: { ...result, nonResults: [...result.nonResults].reverse() } });
  assert.equal(permuted.proofHash, certified.proofHash);
  assert.equal(semantics.evaluate({ policyId: policy.id, contestId: "race-2", entrants: ["a", "b"],
    result: { shape: "ORDERED_FINISH", finishers: ["a"], nonResults: [{ competitorId: "b", status: "DQ" }] } }).status, "REJECTED");
});

test("aggregates judged panels with declarative dropped highs and lows", () => {
  const policy = {
    id: "trimmed-panel", version: "1.0.0" as const, adapter: "RANKED_PERFORMANCE" as const,
    resultShape: "PERFORMANCE_ATTEMPTS" as const, metricId: "panel-points", direction: "HIGHER_IS_BETTER" as const,
    valueRule: { kind: "NON_NEGATIVE_NUMBER" as const },
    attempts: { minimum: 5, maximum: 5, aggregation: { kind: "TRIMMED_MEAN" as const, dropHighest: 1, dropLowest: 1 } },
    tiePolicy: "REJECT" as const, permittedNonResults: ["DQ"] as const,
  };
  const semantics = createSportSemantics([policy]);
  const performances = [
    { competitorId: "gym-a", status: "VALID", attempts: [8, 9, 9.2, 9.4, 10] },
    { competitorId: "gym-b", status: "VALID", attempts: [8.5, 8.8, 9, 9.1, 9.8] },
  ];
  const request = { policyId: policy.id, contestId: "apparatus-final", entrants: ["gym-b", "gym-a"],
    result: { shape: "PERFORMANCE_ATTEMPTS", metricId: "panel-points", performances } };
  const certified = semantics.evaluate(request);
  assert.equal(certified.status, "CERTIFIED");
  assert.deepEqual(certified.placements.map(({ competitorId }) => competitorId), ["gym-a", "gym-b"]);
  assert.ok(Math.abs((certified.placements[0]?.mark ?? 0) - 9.2) < 1e-12);
  assert.ok(Math.abs((certified.placements[1]?.mark ?? 0) - 8.966666666666667) < 1e-12);
  const permuted = semantics.evaluate({ ...request, entrants: [...request.entrants].reverse(), result: { ...request.result,
    performances: [...performances].reverse().map((entry) => ({ ...entry, attempts: [...entry.attempts].reverse() })) } });
  assert.equal(permuted.proofHash, certified.proofHash);
});

test("validates relay and team composition without changing ranked-performance semantics", () => {
  const policy = {
    id: "relay-time", version: "1.0.0" as const, adapter: "RANKED_PERFORMANCE" as const,
    resultShape: "PERFORMANCE_ATTEMPTS" as const, metricId: "milliseconds", direction: "LOWER_IS_BETTER" as const,
    valueRule: { kind: "NON_NEGATIVE_INTEGER" as const }, attempts: { minimum: 1, maximum: 1, aggregation: "BEST" as const },
    tiePolicy: "REJECT" as const, permittedNonResults: ["DNS"] as const,
    participantUnit: { kind: "RELAY" as const, memberCount: 4 },
  };
  const teamPolicy = {
    id: "team-total", version: "1.0.0" as const, adapter: "RANKED_PERFORMANCE" as const,
    resultShape: "PERFORMANCE_ATTEMPTS" as const, metricId: "points", direction: "HIGHER_IS_BETTER" as const,
    valueRule: { kind: "NON_NEGATIVE_INTEGER" as const }, attempts: { minimum: 2, maximum: 2, aggregation: "SUM" as const },
    tiePolicy: "REJECT" as const, permittedNonResults: [] as const,
    participantUnit: { kind: "TEAM" as const, memberCount: 2 },
  };
  const semantics = createSportSemantics([policy, teamPolicy]);
  const performances = [
    { competitorId: "team-b", memberIds: ["b4", "b3", "b2", "b1"], status: "VALID", attempts: [40100] },
    { competitorId: "team-a", memberIds: ["a1", "a2", "a3", "a4"], status: "VALID", attempts: [39800] },
  ];
  const certified = semantics.evaluate({ policyId: policy.id, contestId: "relay-final", entrants: ["team-b", "team-a"],
    result: { shape: "PERFORMANCE_ATTEMPTS", metricId: "milliseconds", performances } });
  assert.equal(certified.status, "CERTIFIED");
  assert.deepEqual(certified.placements.map(({ competitorId }) => competitorId), ["team-a", "team-b"]);
  const overlap = semantics.evaluate({ policyId: policy.id, contestId: "relay-final", entrants: ["team-b", "team-a"], result: {
    shape: "PERFORMANCE_ATTEMPTS", metricId: "milliseconds", performances: [performances[0],
      { ...performances[1], memberIds: ["a1", "a2", "a3", "b1"] }],
  } });
  assert.equal(overlap.status, "REJECTED");
  assert.equal(overlap.findings[0]?.code, "INVALID_PARTICIPANT_COMPOSITION");
  const team = semantics.evaluate({ policyId: teamPolicy.id, contestId: "team-final", entrants: ["alpha", "beta"], result: {
    shape: "PERFORMANCE_ATTEMPTS", metricId: "points", performances: [
      { competitorId: "beta", memberIds: ["b-2", "b-1"], status: "VALID", attempts: [8, 9] },
      { competitorId: "alpha", memberIds: ["a-1", "a-2"], status: "VALID", attempts: [10, 9] },
    ],
  } });
  assert.equal(team.status, "CERTIFIED");
  assert.deepEqual(team.placements.map(({ competitorId, mark }) => [competitorId, mark]), [["alpha", 19], ["beta", 17]]);
  assert.equal(team.proof.scaleEnvelope.maximumMembersPerEntrant, 64);
});
