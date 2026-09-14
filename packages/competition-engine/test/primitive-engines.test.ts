import assert from "node:assert/strict";
import test from "node:test";
import { compileClassificationStage, compileCustomGraph, compilePlayInStage } from "../src/primitive-engines.js";

test("compiles the exact single-round play-ins required to reduce ten seeds to an eight-place main draw", () => {
  const result = compilePlayInStage({ id: "open.qualifying", entrantCount: 10, mainDrawSize: 8 });

  assert.equal(result.status, "CERTIFIED");
  assert.deepEqual(result.nodes.map(({ inputs }) => inputs.map((input) => input.type === "ENTRANT" ? input.seed : null)), [[7, 10], [8, 9]]);
  assert.deepEqual(result.qualifiers, [
    { type: "ENTRANT", seed: 1 }, { type: "ENTRANT", seed: 2 }, { type: "ENTRANT", seed: 3 },
    { type: "ENTRANT", seed: 4 }, { type: "ENTRANT", seed: 5 }, { type: "ENTRANT", seed: 6 },
    { type: "PORT", nodeId: "open.qualifying.M1", port: "WINNER" },
    { type: "PORT", nodeId: "open.qualifying.M2", port: "WINNER" },
  ]);
  assert.equal(result.proof.entrantCoverage, true);
  assert.equal(result.proof.eliminatedEntrants, 2);
  assert.match(result.proofHash, /^[a-f0-9]{64}$/);
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.qualifiers));
});

test("compiles independent classification contests into explicit winner and loser places", () => {
  const result = compileClassificationStage({
    id: "open.placement",
    sourceNodes: [
      { id: "semi.1", kind: "MATCH" }, { id: "semi.2", kind: "MATCH" },
      { id: "place5.source.1", kind: "MATCH" }, { id: "place5.source.2", kind: "MATCH" },
    ],
    contests: [
      { id: "third", label: "Third place", places: [3, 4], sources: [
        { nodeId: "semi.1", port: "LOSER" }, { nodeId: "semi.2", port: "LOSER" },
      ] },
      { id: "fifth", label: "Fifth place", places: [5, 6], sources: [
        { nodeId: "place5.source.1", port: "WINNER" }, { nodeId: "place5.source.2", port: "WINNER" },
      ] },
    ],
  });
  assert.equal(result.status, "CERTIFIED");
  assert.deepEqual(result.nodes.map(({ id, label }) => [id, label]), [
    ["open.placement.third", "Third place"], ["open.placement.fifth", "Fifth place"],
  ]);
  assert.deepEqual(result.places, [
    { place: 3, source: { nodeId: "open.placement.third", port: "WINNER" } },
    { place: 4, source: { nodeId: "open.placement.third", port: "LOSER" } },
    { place: 5, source: { nodeId: "open.placement.fifth", port: "WINNER" } },
    { place: 6, source: { nodeId: "open.placement.fifth", port: "LOSER" } },
  ]);
  assert.equal(result.proof.uniquePlaces, true);
  assert.equal(result.proof.provenanceResolved, true);
});

test("validates and topologically normalizes a versioned custom competition graph", () => {
  const nodes = [
    { id: "final", kind: "MATCH" as const, inputs: [
      { type: "PORT" as const, nodeId: "semi-a", port: "WINNER" as const },
      { type: "PORT" as const, nodeId: "semi-b", port: "WINNER" as const },
    ], outputs: ["WINNER" as const, "LOSER" as const] },
    { id: "semi-b", kind: "MATCH" as const, inputs: [
      { type: "ENTRANT" as const, seed: 2 }, { type: "ENTRANT" as const, seed: 3 },
    ], outputs: ["WINNER" as const, "LOSER" as const] },
    { id: "semi-a", kind: "MATCH" as const, inputs: [
      { type: "ENTRANT" as const, seed: 1 }, { type: "ENTRANT" as const, seed: 4 },
    ], outputs: ["WINNER" as const, "LOSER" as const] },
  ];
  const result = compileCustomGraph({ schemaVersion: "1.0.0", id: "custom-cup", entrantCount: 4, nodes });
  assert.equal(result.status, "CERTIFIED");
  assert.deepEqual(result.nodes.map(({ id }) => id), ["semi-a", "semi-b", "final"]);
  assert.equal(result.proof.acyclic, true);
  assert.equal(result.proof.entrantCoverage, true);
  assert.equal(result.proof.outcomeProvenance, true);
  assert.equal(result.proof.compilerVersion, "1.0.0");
  assert.equal(compileCustomGraph({ schemaVersion: "1.0.0", id: "custom-cup", entrantCount: 4, nodes: [...nodes].reverse() }).proofHash,
    result.proofHash);
});

test("rejects loser-from-bye, dangling, and cyclic custom graphs with precise findings", () => {
  const loserFromBye = compileCustomGraph({ schemaVersion: "1.0.0", id: "bad-bye", entrantCount: 2, nodes: [
    { id: "bye", kind: "BYE", inputs: [{ type: "ENTRANT", seed: 1 }], outputs: ["WINNER"] },
    { id: "final", kind: "MATCH", inputs: [{ type: "PORT", nodeId: "bye", port: "LOSER" },
      { type: "ENTRANT", seed: 2 }], outputs: ["WINNER", "LOSER"] },
  ] });
  assert.equal(loserFromBye.status, "REJECTED");
  assert.ok(loserFromBye.findings.some(({ code }) => code === "LOSER_FROM_BYE"));

  const dangling = compileCustomGraph({ schemaVersion: "1.0.0", id: "bad-link", entrantCount: 2, nodes: [
    { id: "final", kind: "MATCH", inputs: [{ type: "PORT", nodeId: "missing", port: "WINNER" },
      { type: "ENTRANT", seed: 1 }], outputs: ["WINNER", "LOSER"] },
  ] });
  assert.ok(dangling.findings.some(({ code }) => code === "DANGLING_PORT"));
  assert.equal(dangling.proof.outcomeProvenance, false);

  const cyclic = compileCustomGraph({ schemaVersion: "1.0.0", id: "bad-cycle", entrantCount: 2, nodes: [
    { id: "a", kind: "MATCH", inputs: [{ type: "ENTRANT", seed: 1 }, { type: "PORT", nodeId: "b", port: "WINNER" }],
      outputs: ["WINNER", "LOSER"] },
    { id: "b", kind: "MATCH", inputs: [{ type: "ENTRANT", seed: 2 }, { type: "PORT", nodeId: "a", port: "WINNER" }],
      outputs: ["WINNER", "LOSER"] },
  ] });
  assert.equal(cyclic.status, "REJECTED");
  assert.ok(cyclic.findings.some(({ code }) => code === "CYCLIC_GRAPH"));
  assert.equal(cyclic.proof.acyclic, false);
});
