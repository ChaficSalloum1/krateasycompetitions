import assert from "node:assert/strict";
import test from "node:test";
import {
  compileDefinition,
  validateTournamentSpec,
  type StagePrimitive,
  type TournamentDefinition,
  type TournamentSpec,
} from "@tournament-os/tournament-schema";
import { playAndKonnectDefinition } from "@tournament-os/tournament-schema/example";
import { runScenario } from "../src/scenario.js";
import { buildCompetitionGraph, createEntrants } from "../src/graph.js";
import { tournamentFormatCapabilities } from "../src/format-capabilities.js";

function definitionFor(
  primitive: StagePrimitive,
  participantCount: number,
  configuration: Record<string, unknown>,
): TournamentDefinition {
  const definition = structuredClone(playAndKonnectDefinition) as TournamentDefinition;
  definition.participants.count = participantCount;
  definition.divisions = [{
    id: "open", label: "Open", participantCount, participantShape: "pair", stageIds: ["open.main"],
  }];
  definition.stages = [{
    id: "open.main", label: "Open main", divisionId: "open", primitive,
    inputShape: "pair", outputShape: "pair", expectedEntrants: participantCount,
    ...configuration,
  } as never];
  definition.scoringSystems = [{
    id: "score", adapterRule: "generic.head-to-head", version: "1.0.0", stageIds: ["open.main"],
  }];
  definition.standingsPolicies = [];
  definition.qualificationPolicies = [];
  definition.competitionStructures = [];
  definition.drawPolicies = [];
  definition.progressionPolicies = [];
  definition.scheduling.start = "2026-01-01T09:00:00Z";
  definition.scheduling.finishBy = "2026-01-02T09:00:00Z";
  definition.scheduling.durations = [{ stageId: "open.main", contestMinutes: 15, turnaroundMinutes: 0 }];
  definition.scheduling.constraints = [];
  definition.resources = [{
    id: "courts", type: "court", quantity: 4,
    availability: [{ start: "2026-01-01T09:00:00Z", end: "2026-01-02T09:00:00Z" }],
  }];
  definition.operationalPolicies = [];
  definition.assumptions = [];
  definition.requirements = [];
  return definition;
}

function compile(definition: TournamentDefinition): TournamentSpec {
  return compileDefinition(definition, {
    specId: "native-primitives", revision: 1, schemaVersion: "1.0.0", compilerVersion: "1.0.0",
    rulesetVersions: { generic: "1.0.0" }, sourcePrompt: "native primitive scenario", createdAt: "2026-01-01T00:00:00Z",
  }) as TournamentSpec;
}

test("an explicit single-round play-in reduction executes through primary certification", () => {
  const spec = compile(definitionFor("play_in", 10, { playIn: { mainDrawSize: 8 } }));
  assert.equal(validateTournamentSpec(spec).valid, true);

  const scenario = runScenario(spec, createEntrants(spec), "native-play-in");
  assert.equal(scenario.graph.generatedActualContestCount, 2);
  assert.equal(scenario.graph.stageProofs?.length, 1);
  assert.deepEqual(scenario.graph.nodes.map(({ slots }) => slots.map((slot) => slot.type === "entrant" ? slot.entrantId : slot.type)), [
    ["open.team.7", "open.team.10"], ["open.team.8", "open.team.9"],
  ]);
  assert.equal(scenario.schedule.contests.length, 2);
  assert.equal(scenario.simulation?.completedContestCount, 2);
  assert.equal(scenario.certification.status, "CERTIFIED", JSON.stringify(scenario.certification.findings));
});

test("explicit classification sources and places execute after their source stage", () => {
  const definition = definitionFor("single_elimination", 4, {
    bracket: { entrantCount: 4, topology: "power_of_two", thirdPlaceMatch: false },
  });
  definition.divisions[0]!.stageIds = ["open.elim", "open.placement"];
  definition.stages[0]!.id = "open.elim";
  definition.stages.push({
    id: "open.placement", label: "Open placement", divisionId: "open", primitive: "placement",
    inputShape: "pair", outputShape: "pair", expectedEntrants: 4,
    classification: {
      schemaVersion: "1.0.0",
      sourceNodes: [
        { id: "open.elim.R1.M1", kind: "MATCH" }, { id: "open.elim.R1.M2", kind: "MATCH" },
      ],
      contests: [{
        id: "third", label: "Third place", places: [3, 4],
        sources: [
          { nodeId: "open.elim.R1.M1", port: "LOSER" },
          { nodeId: "open.elim.R1.M2", port: "LOSER" },
        ],
      }],
    },
  } as never);
  definition.scoringSystems[0]!.stageIds = ["open.elim", "open.placement"];
  definition.scheduling.durations = [
    { stageId: "open.elim", contestMinutes: 15, turnaroundMinutes: 0 },
    { stageId: "open.placement", contestMinutes: 15, turnaroundMinutes: 0 },
  ];
  const spec = compile(definition);
  assert.equal(validateTournamentSpec(spec).valid, true);

  const scenario = runScenario(spec, createEntrants(spec), "native-placement");
  const placement = scenario.graph.nodes.find(({ id }) => id === "open.placement.third");
  assert.deepEqual(placement?.slots, [
    { type: "loser", contestId: "open.elim.R1.M1" },
    { type: "loser", contestId: "open.elim.R1.M2" },
  ]);
  assert.equal(scenario.graph.generatedActualContestCount, 4);
  assert.equal(scenario.graph.stageProofs?.some(({ stageId, proofHash }) =>
    stageId === "open.placement" && /^[a-f0-9]{64}$/.test(proofHash)), true);
  assert.equal(scenario.schedule.contests.length, 4);
  assert.equal(scenario.simulation?.completedContestCount, 4);
  assert.equal(scenario.certification.status, "CERTIFIED", JSON.stringify(scenario.certification.findings));
});

test("a versioned custom graph is namespace-safe and certifies through the primary compiler", () => {
  const spec = compile(definitionFor("custom_graph", 4, {
    customGraph: {
      schemaVersion: "1.0.0", entrantCount: 4,
      nodes: [
        { id: "final", kind: "MATCH", inputs: [
          { type: "PORT", nodeId: "semi-a", port: "WINNER" },
          { type: "PORT", nodeId: "semi-b", port: "WINNER" },
        ], outputs: ["WINNER", "LOSER"] },
        { id: "semi-b", kind: "MATCH", inputs: [
          { type: "ENTRANT", seed: 2 }, { type: "ENTRANT", seed: 3 },
        ], outputs: ["WINNER", "LOSER"] },
        { id: "semi-a", kind: "MATCH", inputs: [
          { type: "ENTRANT", seed: 1 }, { type: "ENTRANT", seed: 4 },
        ], outputs: ["WINNER", "LOSER"] },
      ],
    },
  }));
  assert.equal(validateTournamentSpec(spec).valid, true);

  const scenario = runScenario(spec, createEntrants(spec), "native-custom");
  assert.deepEqual(scenario.graph.nodes.map(({ id }) => id), [
    "open.main.semi-a", "open.main.semi-b", "open.main.final",
  ]);
  assert.deepEqual(scenario.graph.nodes.at(-1)?.slots, [
    { type: "winner", contestId: "open.main.semi-a" },
    { type: "winner", contestId: "open.main.semi-b" },
  ]);
  assert.equal(scenario.graph.generatedActualContestCount, 3);
  assert.match(scenario.graph.stageProofs?.[0]?.proofHash ?? "", /^[a-f0-9]{64}$/);
  assert.equal(scenario.schedule.contests.length, 3);
  assert.equal(scenario.simulation?.completedContestCount, 3);
  assert.equal(scenario.certification.status, "CERTIFIED", JSON.stringify(scenario.certification.findings));
});

test("native primitive stages fail closed instead of inferring absent execution semantics", () => {
  for (const primitive of ["play_in", "placement", "custom_graph"] as const) {
    const spec = compile(definitionFor(primitive, 4, {}));
    assert.equal(validateTournamentSpec(spec).valid, false, primitive);
    const scenario = runScenario(spec, createEntrants(spec), `missing-${primitive}`);
    assert.equal(scenario.graph.nodes.length, 0, primitive);
    assert.ok(scenario.graph.findings.some(({ code }) => code === "TSC705"), primitive);
    assert.equal(scenario.certification.status, "REJECTED", primitive);
  }
});

test("unresolved source ports, cyclic graphs, and multi-round play-ins never produce partial graphs", () => {
  const placement = compile(definitionFor("placement", 4, {
    classification: {
      schemaVersion: "1.0.0",
      sourceNodes: [{ id: "missing-a", kind: "MATCH" }, { id: "missing-b", kind: "MATCH" }],
      contests: [{ id: "third", label: "Third", places: [3, 4], sources: [
        { nodeId: "missing-a", port: "LOSER" }, { nodeId: "missing-b", port: "LOSER" },
      ] }],
    },
  }));
  assert.equal(validateTournamentSpec(placement).valid, true);
  const placementScenario = runScenario(placement, createEntrants(placement), "missing-sources");
  assert.equal(placementScenario.graph.nodes.length, 0);
  assert.equal(placementScenario.certification.status, "REJECTED");

  const cyclic = compile(definitionFor("custom_graph", 2, {
    customGraph: { schemaVersion: "1.0.0", entrantCount: 2, nodes: [
      { id: "a", kind: "MATCH", inputs: [
        { type: "ENTRANT", seed: 1 }, { type: "PORT", nodeId: "b", port: "WINNER" },
      ], outputs: ["WINNER", "LOSER"] },
      { id: "b", kind: "MATCH", inputs: [
        { type: "ENTRANT", seed: 2 }, { type: "PORT", nodeId: "a", port: "WINNER" },
      ], outputs: ["WINNER", "LOSER"] },
    ] },
  }));
  assert.equal(validateTournamentSpec(cyclic).valid, true);
  const cyclicScenario = runScenario(cyclic, createEntrants(cyclic), "cyclic-custom");
  assert.equal(cyclicScenario.graph.nodes.length, 0);
  assert.equal(cyclicScenario.certification.status, "REJECTED");

  const multiRound = compile(definitionFor("play_in", 12, { playIn: { mainDrawSize: 4 } }));
  assert.equal(validateTournamentSpec(multiRound).valid, false);
  const multiRoundScenario = runScenario(multiRound, createEntrants(multiRound), "multi-round-play-in");
  assert.equal(multiRoundScenario.graph.nodes.length, 0);
  assert.equal(multiRoundScenario.certification.status, "REJECTED");
});

test("capability truth promotes only the three primary-certified primitive paths", () => {
  const levels = Object.fromEntries(tournamentFormatCapabilities(["play_in", "placement", "custom_graph"])
    .capabilities.map(({ id, level }) => [id, level]));
  assert.deepEqual(levels, { play_in: "NATIVE", placement: "NATIVE", custom_graph: "NATIVE" });
});

test("native adapters reject malformed entrant seed identity without throwing or inventing mappings", () => {
  const spec = compile(definitionFor("custom_graph", 2, {
    customGraph: { schemaVersion: "1.0.0", entrantCount: 2, nodes: [{
      id: "final", kind: "MATCH", inputs: [
        { type: "ENTRANT", seed: 1 }, { type: "ENTRANT", seed: 2 },
      ], outputs: ["WINNER", "LOSER"],
    }] },
  }));
  const entrants = createEntrants(spec);
  entrants.open![1]!.seed = 1;
  const graph = buildCompetitionGraph(spec, entrants);
  assert.equal(graph.nodes.length, 0);
  assert.ok(graph.findings.some(({ code, evidence }) => code === "TSC705" && evidence?.reason === "INVALID_ENTRANT_SEED_IDENTITY"));
});

test("custom-graph proof identity ignores declaration order after topological normalization", () => {
  const nodes = [
    { id: "final", kind: "MATCH" as const, inputs: [
      { type: "PORT" as const, nodeId: "semi-a", port: "WINNER" as const },
      { type: "PORT" as const, nodeId: "semi-b", port: "WINNER" as const },
    ], outputs: ["WINNER" as const, "LOSER" as const] },
    { id: "semi-a", kind: "MATCH" as const, inputs: [
      { type: "ENTRANT" as const, seed: 1 }, { type: "ENTRANT" as const, seed: 4 },
    ], outputs: ["WINNER" as const, "LOSER" as const] },
    { id: "semi-b", kind: "MATCH" as const, inputs: [
      { type: "ENTRANT" as const, seed: 2 }, { type: "ENTRANT" as const, seed: 3 },
    ], outputs: ["WINNER" as const, "LOSER" as const] },
  ];
  const first = compile(definitionFor("custom_graph", 4, {
    customGraph: { schemaVersion: "1.0.0", entrantCount: 4, nodes },
  }));
  const second = compile(definitionFor("custom_graph", 4, {
    customGraph: { schemaVersion: "1.0.0", entrantCount: 4, nodes: [...nodes].reverse() },
  }));
  const firstGraph = buildCompetitionGraph(first, createEntrants(first));
  const secondGraph = buildCompetitionGraph(second, createEntrants(second));
  assert.deepEqual(firstGraph.nodes, secondGraph.nodes);
  assert.deepEqual(firstGraph.edges, secondGraph.edges);
  assert.equal(firstGraph.stageProofs?.[0]?.proofHash, secondGraph.stageProofs?.[0]?.proofHash);
});
