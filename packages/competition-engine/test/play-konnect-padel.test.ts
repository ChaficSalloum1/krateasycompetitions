import assert from "node:assert/strict";
import test from "node:test";
import {
  createIllustrativePlayKonnectPadelRules,
  createPlayKonnectPadelConformance,
  compilePlayKonnectCupSeeds,
  PLAY_KONNECT_REQUIREMENTS,
  type PlayKonnectStanding,
} from "../src/play-konnect-padel.js";

const standing = (entrantId: string, poolId: string, poolRank: number, played: number,
  matchPoints: number, gameDifference: number, gamesWon: number): PlayKonnectStanding => ({
  entrantId, poolId, poolRank, played, matchPoints, gamesWon, gamesLost: gamesWon - gameDifference,
  gameDifference, tieResolution: "RAW", deterministicKey: entrantId,
});

test("governed illustrative match policies certify timed and standard padel score shapes", () => {
  const rules = createIllustrativePlayKonnectPadelRules();
  const conformance = createPlayKonnectPadelConformance(rules);
  const timed = conformance.evaluateMatch({ format: "TIMED", contestId: "pool-a-1", entrants: ["a", "b"],
    result: { shape: "TOTAL_SCORE", score: [8, 6] }, at: "2026-06-01T00:00:00.000Z" });
  const standard = conformance.evaluateMatch({ format: "STANDARD", contestId: "tower-final", entrants: ["c", "d"],
    result: { shape: "BEST_OF_UNITS", units: [[6, 4], [3, 6], [7, 5]] }, at: "2026-06-01T00:00:00.000Z" });

  assert.equal(timed.status, "CERTIFIED");
  assert.equal(timed.semanticResult?.outcomePorts.winnerId, "a");
  assert.equal(standard.status, "CERTIFIED");
  assert.equal(standard.semanticResult?.outcomePorts.winnerId, "c");
  assert.ok(PLAY_KONNECT_REQUIREMENTS.every(({ assurance }) => assurance === "ILLUSTRATIVE_REQUIREMENT_INTERPRETATION"));
  assert.ok(rules.packs.every(({ content }) => content.assurance === "ILLUSTRATIVE_CONFORMANCE_ONLY"));
  assert.ok(Object.isFrozen(rules));
});

test("derives raw in-pool standings and resolves a circular tie with the pinned deterministic tiebreak", () => {
  const conformance = createPlayKonnectPadelConformance(createIllustrativePlayKonnectPadelRules());
  const matches = [
    { contestId: "a-b", poolId: "pool-a", format: "TIMED" as const, entrants: ["a", "b"] as const,
      result: { shape: "TOTAL_SCORE", score: [6, 4] } },
    { contestId: "b-c", poolId: "pool-a", format: "TIMED" as const, entrants: ["b", "c"] as const,
      result: { shape: "TOTAL_SCORE", score: [6, 4] } },
    { contestId: "c-a", poolId: "pool-a", format: "TIMED" as const, entrants: ["c", "a"] as const,
      result: { shape: "TOTAL_SCORE", score: [6, 4] } },
  ];
  const request = { at: "2026-06-01T00:00:00.000Z", pools: [{ id: "pool-a", entrantIds: ["c", "a", "b"] }], matches };
  const result = conformance.rankPools(request);
  assert.equal(result.status, "CERTIFIED");
  assert.deepEqual(result.standings.map(({ matchPoints, gameDifference, gamesWon }) => [matchPoints, gameDifference, gamesWon]),
    [[3, 0, 10], [3, 0, 10], [3, 0, 10]]);
  assert.ok(result.standings.every(({ tieResolution }) => tieResolution === "DETERMINISTIC_FINAL"));
  assert.equal(conformance.rankPools({ ...request, pools: [{ id: "pool-a", entrantIds: ["b", "c", "a"] }],
    matches: [...matches].reverse() }).proofHash, result.proofHash);
  assert.ok(Object.isFrozen(result.standings));
});

test("a multi-team tie is recalculated as a mini-league before the deterministic final fallback", () => {
  const conformance = createPlayKonnectPadelConformance(createIllustrativePlayKonnectPadelRules());
  const match = (contestId: string, left: string, right: string, score: readonly [number, number]) => ({
    contestId, poolId: "P", format: "TIMED" as const, entrants: [left, right] as [string, string],
    result: { shape: "TOTAL_SCORE", score },
  });
  const result = conformance.rankPools({ at: "2026-06-01T00:00:00.000Z", pools: [{ id: "P", entrantIds: ["A", "B", "C", "D"] }],
    matches: [
      match("AB", "A", "B", [6, 0]), match("BC", "B", "C", [6, 2]), match("CA", "C", "A", [6, 4]),
      match("AD", "A", "D", [10, 4]), match("BD", "B", "D", [14, 2]), match("CD", "C", "D", [12, 0]),
    ] });
  assert.equal(result.status, "CERTIFIED");
  assert.deepEqual(result.standings.slice(0, 3).map(({ entrantId, tieResolution }) => [entrantId, tieResolution]), [
    ["A", "MINI_LEAGUE"], ["C", "MINI_LEAGUE"], ["B", "MINI_LEAGUE"],
  ]);
});

test("Konnect below four pools adds the best runner-up without weakening immutable seed order", () => {
  const rules = createIllustrativePlayKonnectPadelRules();
  const rows = [
    standing("P1-W", "P1", 1, 2, 6, 12, 16), standing("P1-R", "P1", 2, 2, 5, 10, 15), standing("P1-3", "P1", 3, 2, 0, -22, 3),
    standing("P2-W", "P2", 1, 2, 6, 8, 14), standing("P2-R", "P2", 2, 2, 3, 2, 10), standing("P2-3", "P2", 3, 2, 0, -10, 5),
    standing("P3-W", "P3", 1, 2, 6, 6, 12), standing("P3-R", "P3", 2, 2, 3, 0, 9), standing("P3-3", "P3", 3, 2, 0, -6, 6),
  ];
  const result = compilePlayKonnectCupSeeds({ rules, standings: rows });
  assert.equal(result.status, "CERTIFIED");
  assert.deepEqual(result.konnectSeeds.map(({ seedId, entrantId }) => [seedId, entrantId]), [
    ["K1", "P1-W"], ["K2", "P2-W"], ["K3", "P3-W"], ["K4", "P1-R"],
  ]);
  assert.deepEqual(result.openingSemifinals.map(({ seedIds }) => seedIds), [["K1", "K4"], ["K2", "K3"]]);
  assert.equal(result.openingSemifinals[0]?.samePoolRematch, true);
  assert.equal(result.findings[0]?.code, "FORCED_SAME_POOL_REMATCH");
  assert.deepEqual(result.towerSeeds.slice(0, 2).map(({ entrantId }) => entrantId), ["P2-R", "P3-R"]);
});

test("Konnect above four pools takes only the best four winners and Tower preserves achievement tiers", () => {
  const rules = createIllustrativePlayKonnectPadelRules();
  const rows = Array.from({ length: 6 }, (_, index) => {
    const pool = `P${index + 1}`; const winnerPoints = 6 - index;
    return [standing(`${pool}-W`, pool, 1, 2, winnerPoints, 12 - index, 16 - index),
      standing(`${pool}-R`, pool, 2, 2, 3, 1, 9), standing(`${pool}-3`, pool, 3, 2, 0, -10, 4)];
  }).flat();
  const result = compilePlayKonnectCupSeeds({ rules, standings: rows });
  assert.equal(result.status, "CERTIFIED");
  assert.deepEqual(result.konnectSeeds.map(({ entrantId }) => entrantId), ["P1-W", "P2-W", "P3-W", "P4-W"]);
  assert.deepEqual(result.towerSeeds.slice(0, 2).map(({ entrantId, finishingPositionTier }) => [entrantId, finishingPositionTier]), [
    ["P5-W", 1], ["P6-W", 1],
  ]);
  assert.ok(result.towerSeeds.slice(2, 8).every(({ finishingPositionTier }) => finishingPositionTier === 2));
});

test("cup seeding rejects stale rule proofs and incomplete pool standings without partial output", () => {
  const rules = { ...structuredClone(createIllustrativePlayKonnectPadelRules()), disclaimer: "tampered" };
  const rows = [standing("A", "P1", 1, 2, 6, 4, 10), standing("B", "P1", 2, 2, 3, 0, 8),
    standing("C", "P1", 3, 2, 0, -4, 6), standing("D", "P2", 1, 2, 6, 4, 10),
    standing("E", "P2", 2, 2, 3, 0, 8), standing("F", "P2", 3, 2, 0, -4, 6)];
  const tampered = compilePlayKonnectCupSeeds({ rules, standings: rows });
  assert.equal(tampered.status, "REJECTED");
  assert.equal(tampered.findings[0]?.code, "RULES_PROOF_MISMATCH");
  assert.deepEqual(tampered.konnectSeeds, []);
  const incomplete = compilePlayKonnectCupSeeds({ rules: createIllustrativePlayKonnectPadelRules(),
    standings: rows.map((row, index) => index === 0 ? { ...row, played: 1 } : row) });
  assert.equal(incomplete.status, "REJECTED");
  assert.equal(incomplete.findings[0]?.code, "INCOMPLETE_POOL_STANDINGS");
});

test("pool ranking fails closed on incomplete fixtures and unsafe numeric scores", () => {
  const conformance = createPlayKonnectPadelConformance(createIllustrativePlayKonnectPadelRules());
  const base = { at: "2026-06-01T00:00:00.000Z", pools: [{ id: "P", entrantIds: ["A", "B", "C"] }] };
  const incomplete = conformance.rankPools({ ...base, matches: [{ contestId: "AB", poolId: "P", format: "TIMED",
    entrants: ["A", "B"], result: { shape: "TOTAL_SCORE", score: [6, 4] } }] });
  assert.equal(incomplete.status, "REJECTED");
  assert.equal(incomplete.findings[0]?.code, "INCOMPLETE_ROUND_ROBIN");
  const unsafe = conformance.rankPools({ ...base, matches: [
    { contestId: "AB", poolId: "P", format: "TIMED", entrants: ["A", "B"], result: { shape: "TOTAL_SCORE", score: [Number.MAX_VALUE, 0] } },
    { contestId: "AC", poolId: "P", format: "TIMED", entrants: ["A", "C"], result: { shape: "TOTAL_SCORE", score: [6, 4] } },
    { contestId: "BC", poolId: "P", format: "TIMED", entrants: ["B", "C"], result: { shape: "TOTAL_SCORE", score: [6, 4] } },
  ] });
  assert.equal(unsafe.status, "REJECTED");
  assert.equal(unsafe.findings[0]?.code, "UNCERTIFIED_MATCH");
});
