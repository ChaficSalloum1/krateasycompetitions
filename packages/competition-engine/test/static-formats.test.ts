import assert from "node:assert/strict";
import test from "node:test";
import { compileStaticFormat } from "../src/static-formats.js";

test("single round robin schedules every unordered pairing exactly once", () => {
  const compiled = compileStaticFormat({ id: "league", format: "SINGLE_ROUND_ROBIN", entrantCount: 5 });

  assert.equal(compiled.contests.length, 10);
  assert.equal(compiled.proof.expectedRequiredContestCount, 10);
  assert.equal(compiled.proof.allEntrantsReachable, true);
  assert.equal(compiled.proof.acyclic, true);
  const pairs = compiled.contests.map(({ inputs }) => inputs
    .map((slot) => slot.type === "ENTRANT" ? slot.seed : -1).sort((a, b) => a - b).join("-"));
  assert.equal(new Set(pairs).size, 10);
  assert.deepEqual([...new Set(compiled.contests.map(({ round }) => round))], [1, 2, 3, 4, 5]);
  assert.match(compiled.proof.proofHash, /^[a-f0-9]{64}$/);
  assert.ok(Object.isFrozen(compiled));
  assert.ok(Object.isFrozen(compiled.contests));
});

test("double round robin produces a reversed return fixture for every pairing across small fields", () => {
  for (let entrantCount = 2; entrantCount <= 9; entrantCount += 1) {
    const compiled = compileStaticFormat({ id: `league-${entrantCount}`, format: "DOUBLE_ROUND_ROBIN", entrantCount });
    assert.equal(compiled.contests.length, entrantCount * (entrantCount - 1));
    const orientations = new Map<string, Set<string>>();
    for (const { inputs } of compiled.contests) {
      const seeds = inputs.map((slot) => slot.type === "ENTRANT" ? slot.seed : -1);
      const key = [...seeds].sort((a, b) => a - b).join("-");
      const values = orientations.get(key) ?? new Set<string>();
      values.add(seeds.join("->"));
      orientations.set(key, values);
    }
    assert.equal(orientations.size, entrantCount * (entrantCount - 1) / 2);
    assert.ok([...orientations.values()].every((directions) => directions.size === 2));
    assert.equal(compiled.proof.valid, true);
  }
});

test("double elimination wires complete winner and loser paths with explicit reset semantics", () => {
  for (const entrantCount of [2, 4, 8, 16, 32]) {
    const compiled = compileStaticFormat({
      id: `double-${entrantCount}`,
      format: "DOUBLE_ELIMINATION",
      entrantCount,
      resetFinalPolicy: "IF_NECESSARY",
    });
    assert.equal(compiled.proof.expectedRequiredContestCount, 2 * entrantCount - 2);
    assert.equal(compiled.proof.generatedRequiredContestCount, 2 * entrantCount - 2);
    assert.equal(compiled.proof.generatedConditionalContestCount, 1);
    assert.equal(compiled.contests.length, 2 * entrantCount - 1);
    assert.deepEqual(compiled.champion, {
      type: "RESET_AWARE",
      firstFinalId: `double-${entrantCount}.GF1`,
      resetFinalId: `double-${entrantCount}.GF2`,
    });
    const loserSources = new Set(compiled.edges
      .filter(({ outcome }) => outcome === "LOSER")
      .map(({ fromContestId }) => fromContestId));
    const winnersBracket = compiled.contests.filter(({ bracket }) => bracket === "WINNERS");
    assert.ok(winnersBracket.every(({ id }) => loserSources.has(id)));
    assert.equal(compiled.proof.allEntrantsReachable, true);
    assert.equal(compiled.proof.acyclic, true);
    assert.equal(compiled.proof.noLoserFromNonContest, true);
  }
});

test("quarterfinal repechage produces two explicit classification paths without bye-derived losers", () => {
  for (const entrantCount of [8, 16, 32, 64]) {
    const compiled = compileStaticFormat({
      id: `repechage-${entrantCount}`,
      format: "REPECHAGE_CLASSIFICATION",
      entrantCount,
    });
    assert.equal(compiled.proof.expectedRequiredContestCount, entrantCount + 3);
    assert.equal(compiled.contests.filter(({ bracket }) => bracket === "REPECHAGE").length, 2);
    assert.equal(compiled.contests.filter(({ bracket }) => bracket === "CLASSIFICATION").length, 2);
    assert.equal(compiled.proof.generatedConditionalContestCount, 0);
    assert.equal(compiled.proof.allEntrantsReachable, true);
    assert.equal(compiled.proof.acyclic, true);
    assert.equal(compiled.proof.noLoserFromNonContest, true);
    assert.ok(compiled.edges.filter(({ outcome }) => outcome === "LOSER")
      .every(({ fromContestId }) => compiled.contests.some(({ id, bracket }) => id === fromContestId && bracket === "WINNERS")));
    assert.deepEqual(compiled.champion, { type: "CONTEST_WINNER", contestId: `repechage-${entrantCount}.W.R${Math.log2(entrantCount)}.M1` });
  }
});

test("fails closed instead of approximating unsupported fields or reset policies", () => {
  assert.throws(() => compileStaticFormat({ id: "six", format: "DOUBLE_ELIMINATION", entrantCount: 6, resetFinalPolicy: "NEVER" }),
    /SFC210: Double elimination requires a power-of-two/);
  assert.throws(() => compileStaticFormat({ id: "four", format: "REPECHAGE_CLASSIFICATION", entrantCount: 4 }),
    /SFC310: Quarterfinal repechage requires/);
  assert.throws(() => compileStaticFormat({ id: "twelve", format: "REPECHAGE_CLASSIFICATION", entrantCount: 12 }),
    /SFC310: Quarterfinal repechage requires/);
  assert.throws(() => compileStaticFormat({ id: "", format: "SINGLE_ROUND_ROBIN", entrantCount: 4 }), /SFC001/);
  assert.throws(() => compileStaticFormat({
    id: "invalid-reset", format: "DOUBLE_ELIMINATION", entrantCount: 4, resetFinalPolicy: "ALWAYS",
  } as never), /SFC211: Reset-final policy/);
});

test("small-field compilation is deterministic, entrant-complete, and topologically ordered", () => {
  for (let entrantCount = 2; entrantCount <= 12; entrantCount += 1) {
    const request = { id: `rr-proof-${entrantCount}`, format: "SINGLE_ROUND_ROBIN" as const, entrantCount };
    const first = compileStaticFormat(request);
    const replay = compileStaticFormat(request);
    assert.deepEqual(replay, first);
    assert.equal(replay.proof.proofHash, first.proof.proofHash);
    for (let seed = 1; seed <= entrantCount; seed += 1) {
      assert.equal(first.contests.filter(({ inputs }) => inputs.some((slot) => slot.type === "ENTRANT" && slot.seed === seed)).length,
        entrantCount - 1);
    }
  }

  for (const entrantCount of [2, 4, 8, 16]) {
    const compiled = compileStaticFormat({
      id: `de-proof-${entrantCount}`, format: "DOUBLE_ELIMINATION", entrantCount, resetFinalPolicy: "NEVER",
    });
    assert.equal(compiled.contests.length, 2 * entrantCount - 2);
    assert.equal(compiled.proof.generatedConditionalContestCount, 0);
    assert.deepEqual(compiled.champion, { type: "CONTEST_WINNER", contestId: `de-proof-${entrantCount}.GF1` });
    const directSeeds = compiled.contests.flatMap(({ inputs }) => inputs.flatMap((slot) => slot.type === "ENTRANT" ? [slot.seed] : []));
    assert.deepEqual([...directSeeds].sort((a, b) => a - b), Array.from({ length: entrantCount }, (_, index) => index + 1));
    const order = new Map(compiled.contests.map(({ id }, index) => [id, index]));
    assert.ok(compiled.edges.every(({ fromContestId, toContestId }) => order.get(fromContestId)! < order.get(toContestId)!));
    const outcomeInputCount = compiled.contests.reduce((count, { inputs }) =>
      count + inputs.filter(({ type }) => type === "OUTCOME").length, 0);
    assert.equal(compiled.edges.length, outcomeInputCount);
    assert.deepEqual(compileStaticFormat({
      id: `de-proof-${entrantCount}`, format: "DOUBLE_ELIMINATION", entrantCount, resetFinalPolicy: "NEVER",
    }), compiled);
  }
});
