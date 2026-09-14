import assert from "node:assert/strict";
import test from "node:test";
import { compileTopology } from "../src/topology-compiler.js";

test("compiles a power-of-two single-elimination graph with explicit winner and loser ports", () => {
  const topology = compileTopology({ id: "open", entrantCount: 8 });

  assert.equal(topology.nodes.filter(({ kind }) => kind === "MATCH").length, 7);
  assert.equal(topology.nodes.filter(({ kind }) => kind === "BYE").length, 0);
  assert.ok(topology.nodes.filter(({ kind }) => kind === "MATCH").every(({ outputs }) =>
    outputs.some(({ port }) => port === "WINNER") && outputs.some(({ port }) => port === "LOSER")));
  assert.equal(topology.proof.generatedCompetitiveMatchCount, 7);
  assert.equal(topology.proof.expectedCompetitiveMatchCount, 7);
  assert.equal(topology.proof.valid, true);
  assert.match(topology.proof.proofHash, /^[a-f0-9]{64}$/);
});

test("entrant counts 2 through 64 have explicit play-ins/byes and complete cardinality proofs", () => {
  for (let entrantCount = 2; entrantCount <= 64; entrantCount += 1) {
    const topology = compileTopology({ id: `draw.${entrantCount}`, entrantCount });
    const bracketSize = 2 ** Math.ceil(Math.log2(entrantCount));
    const expectedByes = bracketSize - entrantCount;
    const expectedPlayIns = expectedByes === 0 ? 0 : entrantCount - bracketSize / 2;
    assert.equal(topology.proof.byeCount, expectedByes);
    assert.equal(topology.proof.playInMatchCount, expectedPlayIns);
    assert.equal(topology.proof.generatedCompetitiveMatchCount, entrantCount - 1);
    assert.equal(topology.proof.entrantSeedsPlacedExactlyOnce, true);
    assert.equal(topology.proof.valid, true);
    assert.equal(compileTopology({ id: `draw.${entrantCount}`, entrantCount }).proof.proofHash, topology.proof.proofHash);
    assert.ok(Object.isFrozen(topology));
  }
});

test("adds third-place and generic classification matches from explicit loser ports", () => {
  const topology = compileTopology({
    id: "open",
    entrantCount: 8,
    thirdPlaceMatch: true,
    classificationMatches: [{
      id: "fifth-place-semifinal",
      label: "5th-8th classification",
      sources: [{ nodeId: "open.R1.M1", port: "LOSER" }, { nodeId: "open.R1.M2", port: "LOSER" }],
    }],
  });

  const classification = topology.nodes.filter(({ phase }) => phase === "CLASSIFICATION");
  assert.equal(classification.length, 2);
  assert.equal(topology.proof.classificationMatchCount, 2);
  assert.equal(topology.proof.expectedCompetitiveMatchCount, 9);
  assert.equal(topology.proof.generatedCompetitiveMatchCount, 9);
  assert.equal(topology.proof.allInputPortsResolved, true);
  assert.equal(topology.proof.acyclic, true);
});

test("fails closed when a requested loser port belongs to a bye", () => {
  assert.throws(() => compileTopology({ id: "three", entrantCount: 3, thirdPlaceMatch: true }),
    /Undefined LOSER port from bye/);
});

test("rejects unsupported entrant counts and unresolved classification sources", () => {
  assert.throws(() => compileTopology({ id: "small", entrantCount: 1 }), /2 to 64/);
  assert.throws(() => compileTopology({ id: "large", entrantCount: 65 }), /2 to 64/);
  assert.throws(() => compileTopology({
    id: "open", entrantCount: 8,
    classificationMatches: [{ id: "invalid", label: "Invalid", sources: [
      { nodeId: "missing", port: "LOSER" }, { nodeId: "open.R1.M1", port: "LOSER" },
    ] }],
  }), /Unresolved LOSER port from unknown node missing/);
});
