import assert from "node:assert/strict";
import test from "node:test";
import { applyResultThroughInvariantFirewall } from "../src/operator.js";
import { simulateGraph } from "../src/simulation.js";
import type { CompetitionGraph, ContestNode, ContestResult } from "../src/types.js";

const source: ContestNode = {
  id: "GF1", stageId: "double", divisionId: "open", round: "grand final", roundIndex: 1, index: 1,
  kind: "contest", slots: [{ type: "entrant", entrantId: "A" }, { type: "entrant", entrantId: "B" }],
  requiredResourceType: "court",
};
const reset: ContestNode = {
  id: "GF2", stageId: "double", divisionId: "open", round: "reset final", roundIndex: 2, index: 1,
  kind: "contest", slots: [{ type: "winner", contestId: "GF1" }, { type: "loser", contestId: "GF1" }],
  requiredResourceType: "court",
  condition: { type: "SOURCE_SLOT_WON", sourceContestId: "GF1", sourceSlot: 1 },
};
const graph = (nodes: ContestNode[] = [source, reset]): CompetitionGraph => ({
  specHash: "conditional-invariant", nodes,
  edges: nodes.length === 2 ? [
    { fromContestId: "GF1", outcome: "winner", toContestId: "GF2", toSlot: 0 },
    { fromContestId: "GF1", outcome: "loser", toContestId: "GF2", toSlot: 1 },
  ] : [],
  expectedActualContestCount: nodes.filter(({ kind }) => kind === "contest").length,
  generatedActualContestCount: nodes.filter(({ kind }) => kind === "contest").length,
  findings: [],
});

const result = (winnerId: "A" | "B"): ContestResult => ({
  contestId: "GF1", entrants: ["A", "B"], winnerId, loserId: winnerId === "A" ? "B" : "A",
  scoreFor: winnerId === "A" ? [2, 1] : [1, 2], status: "completed",
});

test("the invariant firewall permits a reset only when the declared source slot won", () => {
  const inactive = applyResultThroughInvariantFirewall({ results: {} }, graph(), result("A"));
  assert.throws(() => applyResultThroughInvariantFirewall(inactive, graph(), {
    contestId: "GF2", entrants: ["A", "B"], winnerId: "A", loserId: "B", scoreFor: [2, 1], status: "completed",
  }), /conditional contest is not active/);

  const active = applyResultThroughInvariantFirewall({ results: {} }, graph(), result("B"));
  const completed = applyResultThroughInvariantFirewall(active, graph(), {
    contestId: "GF2", entrants: ["B", "A"], winnerId: "B", loserId: "A", scoreFor: [2, 1], status: "completed",
  });
  assert.equal(completed.results.GF2?.winnerId, "B");
});

test("malformed, self-referential, and nested conditional graphs fail closed before simulation", () => {
  const missing: ContestNode = { ...reset, condition: { type: "SOURCE_SLOT_WON", sourceContestId: "missing", sourceSlot: 1 } };
  assert.throws(() => simulateGraph(graph([source, missing]), "missing"), /invalid or unsupported condition semantics/);
  const self: ContestNode = { ...reset, condition: { type: "SOURCE_SLOT_WON", sourceContestId: "GF2", sourceSlot: 1 } };
  assert.throws(() => simulateGraph(graph([source, self]), "self"), /invalid or unsupported condition semantics/);
  const nestedSource: ContestNode = { ...source, condition: { type: "SOURCE_SLOT_WON", sourceContestId: "GF0", sourceSlot: 0 } };
  assert.throws(() => simulateGraph(graph([nestedSource, reset]), "nested"), /invalid or unsupported condition semantics/);
});
