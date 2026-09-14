import assert from "node:assert/strict";
import test from "node:test";
import { verifyBoundedSpace } from "../src/bounded-verification.js";

test("bounded verification executes every Cartesian case in deterministic order and certifies only complete success", () => {
  const report = verifyBoundedSpace({
    id: "round-robin-small-space",
    dimensions: [
      { name: "entrantCount", values: [2, 3, 4] },
      { name: "rounds", values: [1, 2] },
    ],
    maxCases: 10,
    execute: (input) => ({ contests: Number(input.entrantCount) * (Number(input.entrantCount) - 1) / 2 * Number(input.rounds) }),
    invariants: [{
      id: "positive-cardinality",
      check: (_input, output) => Number((output as { contests: number }).contests) > 0 ? [] : ["contest count must be positive"],
    }],
  });

  assert.equal(report.status, "CERTIFIED");
  assert.equal(report.totalCases, 6);
  assert.equal(report.passedCases, 6);
  assert.equal(report.failedCases, 0);
  assert.equal(report.unknownCases, 0);
  assert.deepEqual(report.cases.map(({ input }) => input), [
    { entrantCount: 2, rounds: 1 }, { entrantCount: 2, rounds: 2 },
    { entrantCount: 3, rounds: 1 }, { entrantCount: 3, rounds: 2 },
    { entrantCount: 4, rounds: 1 }, { entrantCount: 4, rounds: 2 },
  ]);
  assert.match(report.proofHash, /^[a-f0-9]{64}$/);
  assert.ok(Object.isFrozen(report));
});

test("metamorphic checks prove harmless transformations preserve observable tournament truth", () => {
  const report = verifyBoundedSpace({
    id: "entrant-order-invariance",
    dimensions: [{ name: "entrants", values: [["C", "A", "B"], ["D", "B", "A", "C"]] }],
    maxCases: 10,
    execute: (input) => ({ entrantCount: (input.entrants as readonly string[]).length }),
    invariants: [],
    transformations: [{
      id: "reverse-input-order",
      transform: (input) => ({ ...input, entrants: [...input.entrants as readonly string[]].reverse() }),
      compare: ({ output, transformedOutput }) =>
        (output as { entrantCount: number }).entrantCount === (transformedOutput as { entrantCount: number }).entrantCount
          ? [] : ["entrant reordering changed cardinality"],
    }],
  });

  assert.equal(report.status, "CERTIFIED");
  assert.equal(report.metamorphicChecks, 2);
  assert.ok(report.cases.every(({ metamorphicProofs }) => metamorphicProofs.length === 1 && metamorphicProofs[0]?.status === "PASSED"));
});

test("a bounded run reports UNKNOWN instead of certifying a partially explored space", () => {
  const report = verifyBoundedSpace({
    id: "too-large",
    dimensions: [
      { name: "entrants", values: [2, 3, 4, 5] },
      { name: "resources", values: [1, 2, 3] },
    ],
    maxCases: 10,
    execute: () => ({ valid: true }),
    invariants: [],
  });

  assert.equal(report.status, "UNKNOWN");
  assert.equal(report.totalCases, 12);
  assert.equal(report.unknownCases, 12);
  assert.equal(report.searchComplete, false);
  assert.deepEqual(report.cases, []);
});

test("violations reject the space with concrete deterministic counterexamples", () => {
  const report = verifyBoundedSpace({
    id: "minimum-participation",
    dimensions: [{ name: "poolSize", values: [2, 3, 4] }],
    maxCases: 3,
    execute: (input) => ({ guaranteedMatches: Number(input.poolSize) - 1 }),
    invariants: [{ id: "three-match-minimum", check: (_input, output) =>
      (output as { guaranteedMatches: number }).guaranteedMatches >= 3 ? [] : ["entrant can receive fewer than three matches"] }],
  });

  assert.equal(report.status, "REJECTED");
  assert.equal(report.failedCases, 2);
  assert.deepEqual(report.cases.filter(({ status }) => status === "FAILED").map(({ input }) => input), [
    { poolSize: 2 }, { poolSize: 3 },
  ]);
  assert.ok(report.cases[0]?.violations[0]?.includes("three-match-minimum"));
});
