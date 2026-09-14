import assert from "node:assert/strict";
import test from "node:test";
import { compileDefinition, type TournamentSpec } from "@tournament-os/tournament-schema";
import { playAndKonnectDefinition } from "@tournament-os/tournament-schema/example";
import { calculateSchedulingLowerBounds, type CompetitionGraph } from "../src/index.js";

const context = {
  specId: "lower-bounds.test", revision: 1, schemaVersion: "1.0.0", compilerVersion: "0.1.0",
  rulesetVersions: { padel: "1.0.0", competition: "1.0.0" }, sourcePrompt: "lower bound",
  createdAt: "2026-09-05T09:00:00Z",
};

function fixture(): { spec: TournamentSpec; graph: CompetitionGraph } {
  const definition = structuredClone(playAndKonnectDefinition);
  definition.scheduling.durations = [
    { stageId: "court-stage", contestMinutes: 30, turnaroundMinutes: 0 },
    { stageId: "show-stage", contestMinutes: 60, turnaroundMinutes: 0 },
  ];
  definition.resources = [
    { id: "courts", type: "court", quantity: 2, availability: [{ start: "2026-09-05T12:00:00Z", end: "2026-09-05T18:00:00Z" }] },
    { id: "show", type: "show-court", quantity: 1, availability: [{ start: "2026-09-05T12:00:00Z", end: "2026-09-05T18:00:00Z" }] },
  ];
  const spec = compileDefinition(definition, context) as TournamentSpec;
  const graph: CompetitionGraph = {
    specHash: spec.metadata.compiledSpecHash,
    nodes: [
      { id: "C1", stageId: "court-stage", divisionId: "open", round: "R1", roundIndex: 1, index: 1, kind: "contest", slots: [{ type: "entrant", entrantId: "A" }, { type: "entrant", entrantId: "B" }], requiredResourceType: "court" },
      { id: "C2", stageId: "court-stage", divisionId: "open", round: "R1", roundIndex: 1, index: 2, kind: "contest", slots: [{ type: "entrant", entrantId: "C" }, { type: "entrant", entrantId: "D" }], requiredResourceType: "court" },
      { id: "S1", stageId: "show-stage", divisionId: "open", round: "F", roundIndex: 2, index: 1, kind: "contest", slots: [{ type: "winner", contestId: "C1" }, { type: "winner", contestId: "C2" }], requiredResourceType: "show-court" },
    ],
    edges: [
      { fromContestId: "C1", outcome: "winner", toContestId: "S1", toSlot: 0 },
      { fromContestId: "C2", outcome: "winner", toContestId: "S1", toSlot: 1 },
    ],
    expectedActualContestCount: 3, generatedActualContestCount: 3, findings: [],
  };
  return { spec, graph };
}

test("lower-bound proof includes capacity for each restricted resource type", () => {
  const { spec, graph } = fixture();
  const proof = calculateSchedulingLowerBounds(spec, graph);
  assert.deepEqual(proof.resourceSpecificMinutes, { court: 30, "show-court": 60 });
  assert.equal(proof.dependencyCriticalPathMinutes, 90);
  assert.equal(proof.verifiedLowerBoundMinutes, 90);
});

test("lower-bound derivation fails closed on a cyclic graph", () => {
  const { spec, graph } = fixture();
  graph.edges.push({ fromContestId: "S1", outcome: "winner", toContestId: "C1", toSlot: 0 });
  assert.throws(() => calculateSchedulingLowerBounds(spec, graph), /cyclic/);
});
