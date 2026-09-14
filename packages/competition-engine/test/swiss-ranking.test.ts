import assert from "node:assert/strict";
import test from "node:test";
import { createSwissRankingEngine } from "../src/swiss-ranking.js";

const rounds = [
  { round: 1, games: [
    { competitors: ["A", "B"] as const, result: "LEFT_WIN" as const },
    { competitors: ["C", "D"] as const, result: "LEFT_WIN" as const },
  ], byes: [] },
  { round: 2, games: [
    { competitors: ["A", "C"] as const, result: "LEFT_WIN" as const },
    { competitors: ["B", "D"] as const, result: "RIGHT_WIN" as const },
  ], byes: [] },
  { round: 3, games: [
    { competitors: ["A", "D"] as const, result: "RIGHT_WIN" as const },
    { competitors: ["B", "C"] as const, result: "DRAW" as const },
  ], byes: [] },
];

test("computes exact Buchholz, median Buchholz, Sonneborn-Berger, head-to-head, and progressive scores", () => {
  const engine = createSwissRankingEngine([{
    id: "fide-like", version: "1.0.0", criteria: ["POINTS", "SONNEBORN_BERGER", "HEAD_TO_HEAD", "BUCHHOLZ", "MEDIAN_BUCHHOLZ", "PROGRESSIVE_SCORE"],
    points: { win: 1, draw: 0.5, loss: 0, bye: 1 }, medianBuchholzDrop: 1,
    incompleteData: "REJECT", tieResolution: "COMPETITOR_ID",
  }]);
  const result = engine.rank({ policyId: "fide-like", tournamentId: "chess-open", entrants: ["D", "B", "A", "C"], rounds });

  assert.equal(result.status, "CERTIFIED");
  assert.deepEqual(result.rows.map(({ competitorId, rank }) => [competitorId, rank]), [["D", 1], ["A", 2], ["C", 3], ["B", 4]]);
  assert.deepEqual(result.rows.find(({ competitorId }) => competitorId === "A")?.metrics,
    { points: 2, buchholz: 4, medianBuchholz: 1.5, sonnebornBerger: 2, progressiveScore: 5, headToHead: 0 });
  assert.deepEqual(result.rows.find(({ competitorId }) => competitorId === "D")?.metrics,
    { points: 2, buchholz: 4, medianBuchholz: 1.5, sonnebornBerger: 2.5, progressiveScore: 3, headToHead: 1 });
  assert.match(result.proofHash, /^[a-f0-9]{64}$/);
  assert.equal(result.proof.scaleEnvelope.maximumEntrants, 256);
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.rows));
});

test("uses head-to-head only when every member of the tied group has played the others", () => {
  const engine = createSwissRankingEngine([{
    id: "direct-encounter", version: "1.0.0", criteria: ["POINTS", "HEAD_TO_HEAD"],
    points: { win: 1, draw: 0.5, loss: 0, bye: 1 }, medianBuchholzDrop: 0,
    incompleteData: "REJECT", tieResolution: "REJECT",
  }]);
  const result = engine.rank({ policyId: "direct-encounter", tournamentId: "one-round", entrants: ["A", "B", "X", "Y"], rounds: [{
    round: 1, byes: [], games: [
      { competitors: ["A", "X"], result: "LEFT_WIN" }, { competitors: ["B", "Y"], result: "LEFT_WIN" },
    ],
  }] });
  assert.equal(result.status, "REJECTED");
  assert.equal(result.findings[0]?.code, "UNRESOLVED_TIE");
});

test("never invents incomplete results and exposes the registered reject or provisional policy", () => {
  const base = {
    version: "1.0.0" as const, criteria: ["POINTS" as const], points: { win: 1, draw: 0.5, loss: 0, bye: 1 },
    medianBuchholzDrop: 0, tieResolution: "COMPETITOR_ID" as const,
  };
  const engine = createSwissRankingEngine([
    { ...base, id: "strict", incompleteData: "REJECT" },
    { ...base, id: "live", incompleteData: "PROVISIONAL" },
  ]);
  const request = { tournamentId: "live-event", entrants: ["A", "B"], rounds: [{ round: 1, byes: [],
    games: [{ competitors: ["A", "B"] as const, result: null }] }] };
  const strict = engine.rank({ ...request, policyId: "strict" });
  assert.equal(strict.status, "REJECTED");
  assert.equal(strict.findings[0]?.code, "INCOMPLETE_RESULT");

  const provisional = engine.rank({ ...request, policyId: "live" });
  assert.equal(provisional.status, "PROVISIONAL");
  assert.equal(provisional.proof.completeRounds, false);
  assert.ok(provisional.findings.some(({ code }) => code === "INCOMPLETE_RESULT"));
});

test("is invariant to entrant, round, board, and left-right input ordering", () => {
  const policy = {
    id: "stable", version: "1.0.0" as const, criteria: ["POINTS" as const, "BUCHHOLZ" as const, "SONNEBORN_BERGER" as const],
    points: { win: 1, draw: 0.5, loss: 0, bye: 1 }, medianBuchholzDrop: 0,
    incompleteData: "REJECT" as const, tieResolution: "COMPETITOR_ID" as const,
  };
  const engine = createSwissRankingEngine([policy]);
  const baseline = engine.rank({ policyId: policy.id, tournamentId: "stable-open", entrants: ["A", "B", "C", "D"], rounds });
  const reordered = rounds.map((round) => ({ ...round, games: [...round.games].reverse().map((game) => ({
    competitors: [game.competitors[1], game.competitors[0]] as const,
    result: game.result === "LEFT_WIN" ? "RIGHT_WIN" as const : game.result === "RIGHT_WIN" ? "LEFT_WIN" as const : game.result,
  })) })).reverse();
  const transformed = engine.rank({ policyId: policy.id, tournamentId: "stable-open", entrants: ["D", "C", "B", "A"], rounds: reordered });
  assert.equal(transformed.proofHash, baseline.proofHash);
  assert.deepEqual(transformed.rows, baseline.rows);
});

test("assigns shared competition ranks only when that final tie policy is explicit", () => {
  const engine = createSwissRankingEngine([{
    id: "shared", version: "1.0.0", criteria: ["POINTS"], points: { win: 1, draw: 0.5, loss: 0, bye: 1 },
    medianBuchholzDrop: 0, incompleteData: "REJECT", tieResolution: "SHARED_RANK",
  }]);
  const result = engine.rank({ policyId: "shared", tournamentId: "drawn-match", entrants: ["B", "A"], rounds: [{
    round: 1, byes: [], games: [{ competitors: ["A", "B"], result: "DRAW" }],
  }] });
  assert.equal(result.status, "CERTIFIED");
  assert.deepEqual(result.rows.map(({ competitorId, rank }) => [competitorId, rank]), [["A", 1], ["B", 1]]);
});

test("certifies the complete 729-case outcome corpus for a four-player three-round chess-like schedule", () => {
  const engine = createSwissRankingEngine([{
    id: "corpus", version: "1.0.0", criteria: ["POINTS", "BUCHHOLZ", "MEDIAN_BUCHHOLZ", "SONNEBORN_BERGER", "HEAD_TO_HEAD", "PROGRESSIVE_SCORE"],
    points: { win: 1, draw: 0.5, loss: 0, bye: 1 }, medianBuchholzDrop: 1,
    incompleteData: "REJECT", tieResolution: "COMPETITOR_ID",
  }]);
  const pairings = [
    [["A", "B"], ["C", "D"]], [["A", "C"], ["B", "D"]], [["A", "D"], ["B", "C"]],
  ] as const;
  const outcomes = ["LEFT_WIN", "RIGHT_WIN", "DRAW"] as const;
  for (let encoded = 0; encoded < 3 ** 6; encoded += 1) {
    let cursor = encoded;
    const selected = Array.from({ length: 6 }, () => { const result = outcomes[cursor % 3]!; cursor = Math.floor(cursor / 3); return result; });
    const corpusRounds = pairings.map((boards, round) => ({ round: round + 1, byes: [], games: boards.map((competitors, board) => ({
      competitors, result: selected[round * 2 + board]!,
    })) }));
    const result = engine.rank({ policyId: "corpus", tournamentId: `corpus-${encoded}`, entrants: ["D", "B", "A", "C"], rounds: corpusRounds });
    assert.equal(result.status, "CERTIFIED", `outcome vector ${encoded}`);
    assert.equal(result.rows.reduce((sum, row) => sum + row.metrics.points, 0), 6, `point conservation ${encoded}`);
    assert.ok(result.rows.every(({ metrics }) => metrics.medianBuchholz !== null && Number.isFinite(metrics.buchholz) && Number.isFinite(metrics.sonnebornBerger)));
  }
});
