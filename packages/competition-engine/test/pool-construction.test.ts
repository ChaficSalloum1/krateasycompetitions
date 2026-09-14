import assert from "node:assert/strict";
import test from "node:test";
import { constructPools, verifyPoolConstruction } from "../src/pool-construction.js";

test("constructs balanced pools with deterministic entrant coverage and an independent proof", () => {
  const request = {
    id: "open-pools",
    entrants: Array.from({ length: 10 }, (_, index) => ({ id: `E${index + 1}`, seed: index + 1 })),
    poolCount: 3,
    size: { minimum: 3, maximum: 4 },
    hardConstraints: [],
    objectives: [{ kind: "BALANCE_SEED_STRENGTH" as const, priority: 1, weight: 1 }],
    search: { maximumNodes: 250_000 },
  };

  const result = constructPools(request);

  assert.equal(result.status, "OPTIMAL");
  assert.deepEqual(result.pools.map(({ entrants }) => entrants.length).sort(), [3, 3, 4]);
  assert.deepEqual(result.pools.flatMap(({ entrants }) => entrants.map(({ id }) => id)).sort(), request.entrants.map(({ id }) => id).sort());
  assert.equal(verifyPoolConstruction(request, result).valid, true);
  assert.deepEqual(constructPools(request), result);
});

test("honours fixed placement, separation, together, and attribute-limit hard constraints", () => {
  const request = {
    id: "constrained",
    entrants: [
      { id: "A", seed: 1, attributes: { club: "red" } },
      { id: "B", seed: 2, attributes: { club: "red" } },
      { id: "C", seed: 3, attributes: { club: "blue" } },
      { id: "D", seed: 4, attributes: { club: "blue" } },
      { id: "E", seed: 5 }, { id: "F", seed: 6 }, { id: "G", seed: 7 }, { id: "H", seed: 8 },
    ],
    poolCount: 2,
    size: { minimum: 4, maximum: 4 },
    hardConstraints: [
      { kind: "FIXED_POOL" as const, entrantId: "A", poolIndex: 0 },
      { kind: "SEPARATE" as const, entrantIds: ["A", "B"] },
      { kind: "TOGETHER" as const, entrantIds: ["A", "C"] },
      { kind: "ATTRIBUTE_LIMIT" as const, attribute: "club", value: "red", maximumPerPool: 1 },
    ],
    objectives: [{ kind: "BALANCE_SEED_STRENGTH" as const, priority: 1, weight: 1 }],
    search: { maximumNodes: 100_000 },
  };

  const result = constructPools(request);

  assert.equal(result.status, "OPTIMAL");
  assert.deepEqual(result.pools.find(({ index }) => index === 0)?.entrants.map(({ id }) => id).includes("C"), true);
  assert.notEqual(result.pools.find(({ entrants }) => entrants.some(({ id }) => id === "A"))?.index,
    result.pools.find(({ entrants }) => entrants.some(({ id }) => id === "B"))?.index);
  assert.equal(verifyPoolConstruction(request, result).valid, true);
});

test("distinguishes an exhausted infeasibility proof from a bounded unknown search", () => {
  const base = {
    id: "proof-status",
    entrants: ["A", "B", "C", "D"].map((id) => ({ id })),
    poolCount: 2,
    size: { minimum: 2, maximum: 2 },
    objectives: [{ kind: "BALANCE_SIZE" as const, priority: 1, weight: 1 }],
  };
  const impossible = constructPools({ ...base, hardConstraints: [
    { kind: "TOGETHER" as const, entrantIds: ["A", "B", "C"] },
    { kind: "SEPARATE" as const, entrantIds: ["A", "B"] },
  ], search: { maximumNodes: 10_000 } });
  const bounded = constructPools({ ...base, hardConstraints: [
    { kind: "FIXED_POOL" as const, entrantId: "A", poolIndex: 0 },
  ], search: { maximumNodes: 1 } });

  assert.equal(impossible.status, "INFEASIBLE");
  assert.equal(impossible.audit.searchExhausted, true);
  assert.equal(bounded.status, "UNKNOWN");
  assert.equal(bounded.audit.searchExhausted, false);
});

test("independent verification rejects entrant duplication and a forged optimal claim", () => {
  const request = {
    id: "tamper-check",
    entrants: ["A", "B", "C", "D"].map((id) => ({ id })), poolCount: 2,
    size: { minimum: 2, maximum: 2 }, hardConstraints: [],
    objectives: [{ kind: "BALANCE_SIZE" as const, priority: 1, weight: 1 }], search: { maximumNodes: 100 },
  };
  const valid = constructPools(request);
  const forged: any = structuredClone(valid);
  forged.status = "OPTIMAL";
  forged.audit.searchExhausted = false;
  forged.pools[1]!.entrants[0] = structuredClone(forged.pools[0]!.entrants[0]!);

  const proof = verifyPoolConstruction(request, forged);

  assert.equal(proof.valid, false);
  assert.ok(proof.violations.some((violation) => violation.includes("more than once")));
  assert.ok(proof.violations.includes("optimal status requires exhausted search"));
});

test("returns a balanced independently valid incumbent when exact optimisation hits its node bound", () => {
  const request = {
    id: "bounded-incumbent",
    entrants: Array.from({ length: 12 }, (_, index) => ({ id: `E${index + 1}`, seed: index + 1 })),
    poolCount: 3, size: { minimum: 4, maximum: 4 }, hardConstraints: [],
    objectives: [{ kind: "BALANCE_SEED_STRENGTH" as const, priority: 1, weight: 1 }], search: { maximumNodes: 1 },
  };

  const result = constructPools(request);

  assert.equal(result.status, "FEASIBLE");
  assert.equal(result.audit.searchExhausted, false);
  assert.ok((result.objective?.[0] ?? Number.POSITIVE_INFINITY) <= 2);
  assert.equal(verifyPoolConstruction(request, result).valid, true);
});
