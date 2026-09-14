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
import { tournamentFormatCapabilities } from "../src/format-capabilities.js";
import { buildCompetitionGraph, createEntrants } from "../src/graph.js";
import { runScenario } from "../src/scenario.js";

function definitionFor(primitive: StagePrimitive, config: Record<string, unknown>): TournamentDefinition {
  const definition = structuredClone(playAndKonnectDefinition) as TournamentDefinition;
  definition.participants.count = 8;
  definition.divisions = [{ id: "open", label: "Open", participantCount: 8, participantShape: "pair", stageIds: ["open.main"] }];
  definition.stages = [{
    id: "open.main", label: "Open main", divisionId: "open", primitive,
    inputShape: "pair", outputShape: "pair", expectedEntrants: 8,
    bracket: { entrantCount: 8, topology: "power_of_two", thirdPlaceMatch: false },
    ...config,
  } as never];
  definition.scoringSystems = [{ id: "score", adapterRule: "generic.head-to-head", version: "1.0.0", stageIds: ["open.main"] }];
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
    specId: "native-static", revision: 1, schemaVersion: "1.0.0", compilerVersion: "1.0.0",
    rulesetVersions: { generic: "1.0.0" }, sourcePrompt: "native static scenario", createdAt: "2026-01-01T00:00:00Z",
  }) as TournamentSpec;
}

test("double elimination with an explicit reset policy executes through certified primary compilation", () => {
  const spec = compile(definitionFor("double_elimination", { doubleElimination: { resetFinalPolicy: "IF_NECESSARY" } }));
  assert.equal(validateTournamentSpec(spec).valid, true);

  const scenario = runScenario(spec, createEntrants(spec), "native-double");
  assert.equal(scenario.graph.nodes.filter(({ kind }) => kind === "contest").length, 15);
  assert.equal(scenario.graph.nodes.filter(({ condition }) => condition !== undefined).length, 1);
  assert.equal(scenario.graph.generatedActualContestCount, 15);
  assert.equal(scenario.graph.stageProofs?.length, 1);
  assert.match(scenario.graph.stageProofs?.[0]?.proofHash ?? "", /^[a-f0-9]{64}$/);
  assert.deepEqual(buildCompetitionGraph(spec, createEntrants(spec)), buildCompetitionGraph(spec, createEntrants(spec)));
  const reversed = createEntrants(spec);
  reversed.open!.reverse();
  assert.deepEqual(buildCompetitionGraph(spec, reversed), buildCompetitionGraph(spec, createEntrants(spec)));
  assert.equal(scenario.schedule.contests.length, 15);
  assert.equal(scenario.simulation?.unresolvedDependencies.length, 0);
  assert.ok([14, 15].includes(scenario.simulation!.completedContestCount));
  assert.equal(scenario.certification.status, "CERTIFIED", JSON.stringify(scenario.certification.findings));
});

test("the registered quarterfinal repechage model executes through the same certified primary path", () => {
  const spec = compile(definitionFor("repechage", {
    repechage: { model: "QUARTERFINAL_LOSERS_TO_SEMIFINAL_LOSERS" },
  }));
  assert.equal(validateTournamentSpec(spec).valid, true);

  const scenario = runScenario(spec, createEntrants(spec), "native-repechage");
  assert.equal(scenario.graph.generatedActualContestCount, 11);
  assert.equal(scenario.graph.nodes.filter(({ id }) => id.includes(".REP.")).length, 2);
  assert.equal(scenario.graph.nodes.filter(({ id }) => id.includes(".CLASS.")).length, 2);
  assert.equal(scenario.schedule.contests.length, 11);
  assert.equal(scenario.simulation?.completedContestCount, 11);
  assert.deepEqual(scenario.simulation?.unresolvedDependencies, []);
  assert.equal(scenario.certification.status, "CERTIFIED", JSON.stringify(scenario.certification.findings));
});

test("native static formats fail closed when their execution configuration is absent", () => {
  for (const primitive of ["double_elimination", "repechage"] as const) {
    const spec = compile(definitionFor(primitive, {}));
    const validation = validateTournamentSpec(spec);
    assert.equal(validation.valid, false);
    const graph = buildCompetitionGraph(spec, createEntrants(spec));
    assert.equal(graph.nodes.some(({ stageId }) => stageId === "open.main"), false);
    assert.ok(graph.findings.some(({ code }) => code === "TSC705"));
  }
  const unsupported = definitionFor("double_elimination", { doubleElimination: { resetFinalPolicy: "NEVER" } });
  unsupported.participants.count = 6;
  unsupported.divisions[0]!.participantCount = 6;
  unsupported.stages[0]!.expectedEntrants = 6;
  unsupported.stages[0]!.bracket!.entrantCount = 6;
  const unsupportedSpec = compile(unsupported);
  assert.equal(validateTournamentSpec(unsupportedSpec).valid, false);
  const unsupportedGraph = buildCompetitionGraph(unsupportedSpec, createEntrants(unsupportedSpec));
  assert.equal(unsupportedGraph.nodes.length, 0);
  assert.ok(unsupportedGraph.findings.some(({ code }) => code === "TSC705"));
});

test("capability truth marks both formats native only after scenario-path evidence is registered", () => {
  const levels = Object.fromEntries(tournamentFormatCapabilities(["double_elimination", "repechage"])
    .capabilities.map(({ id, level }) => [id, level]));
  assert.deepEqual(levels, { double_elimination: "NATIVE", repechage: "NATIVE" });
});
