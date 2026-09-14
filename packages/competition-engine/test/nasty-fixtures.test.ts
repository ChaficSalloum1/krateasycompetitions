import assert from "node:assert/strict";
import test from "node:test";
import {
  compileDefinition,
  type TournamentDefinition,
  type TournamentSpec,
} from "@tournament-os/tournament-schema";
import { playAndKonnectDefinition } from "@tournament-os/tournament-schema/example";
import {
  analyzeParticipantPaths,
  buildCompetitionGraph,
  calculateStandings,
  createEntrants,
  describeBracketTopology,
  normalizedStandingScore,
  possibleEntrants,
  seedOrder,
  simulateGraph,
  solveSchedule,
  topologicalNodes,
  validateSchedule,
  type CompetitionGraph,
  type ContestNode,
  type ContestResult,
  type ProgressionEdge,
  type ScheduleSolution,
  type Standing,
} from "../src/index.js";

const compile = (definition: TournamentDefinition, id: string): TournamentSpec => compileDefinition(definition, {
  specId: `nasty.${id}`,
  revision: 1,
  schemaVersion: "1.0.0",
  compilerVersion: "0.1.0",
  rulesetVersions: { padel: "1.0.0", competition: "1.0.0" },
  sourcePrompt: `canonical nasty fixture: ${id}`,
  createdAt: "2026-09-05T09:00:00Z",
}) as TournamentSpec;

const reference = (): TournamentSpec => compile(structuredClone(playAndKonnectDefinition), "reference");

function singleEliminationDefinition(entrantCount: number): TournamentDefinition {
  const definition = structuredClone(playAndKonnectDefinition);
  definition.participants.count = entrantCount;
  definition.divisions = [{
    id: "open",
    label: "Open",
    participantCount: entrantCount,
    participantShape: "pair",
    stageIds: ["open.knockout"],
  }];
  definition.stages = [{
    id: "open.knockout",
    label: "Open knockout",
    divisionId: "open",
    primitive: "single_elimination",
    inputShape: "pair",
    outputShape: "pair",
    expectedEntrants: entrantCount,
    bracket: { entrantCount, topology: "arbitrary", thirdPlaceMatch: false },
  }];
  definition.scoringSystems = [{
    id: "padel.timed",
    adapterRule: "padel.timed.standard",
    version: "1.0.0",
    stageIds: ["open.knockout"],
  }];
  definition.standingsPolicies = [];
  definition.qualificationPolicies = [];
  definition.competitionStructures = [];
  definition.drawPolicies = [];
  definition.progressionPolicies = [];
  definition.scheduling.durations = [{ stageId: "open.knockout", contestMinutes: 10, turnaroundMinutes: 0 }];
  definition.scheduling.constraints = [];
  definition.scheduling.start = "2026-09-05T09:00:00Z";
  definition.scheduling.finishBy = "2026-09-07T09:00:00Z";
  definition.resources = [{
    id: "shared.court",
    type: "court",
    quantity: 4,
    availability: [{ start: "2026-09-05T09:00:00Z", end: "2026-09-07T09:00:00Z" }],
  }];
  definition.operationalPolicies = [];
  definition.assumptions = [];
  definition.requirements = [];
  return definition;
}

const graphOf = (nodes: ContestNode[], edges: ProgressionEdge[] = []): CompetitionGraph => ({
  specHash: "nasty-fixture",
  nodes,
  edges,
  expectedActualContestCount: nodes.filter(({ kind }) => kind === "contest").length,
  generatedActualContestCount: nodes.filter(({ kind }) => kind === "contest").length,
  findings: [],
});

test("nasty fixture: unequal pools preserve opportunity counts and require normalized comparison", () => {
  const spec = reference();
  const graph = buildCompetitionGraph(spec, createEntrants(spec));
  const advancedPools = graph.nodes.filter(({ stageId }) => stageId === "advanced.pools");
  const counts = new Map<string, number>();
  for (const { poolId } of advancedPools) counts.set(poolId!, (counts.get(poolId!) ?? 0) + 1);
  const poolContestCounts = [...counts]
    .sort(([left], [right]) => left.localeCompare(right));
  assert.deepEqual(poolContestCounts, [
    ["advanced.pools.P1", 6],
    ["advanced.pools.P2", 6],
    ["advanced.pools.P3", 3],
  ]);

  const perfectTwoMatchPool: Standing = {
    entrantId: "pool-of-3-winner", poolId: "P3", rank: 1, played: 2, wins: 2, losses: 0, draws: 0,
    scoreFor: 12, scoreAgainst: 4, scoreDifference: 8, winningPercentage: 1, tieResolution: [],
  };
  const perfectThreeMatchPool: Standing = {
    entrantId: "pool-of-4-winner", poolId: "P4", rank: 1, played: 3, wins: 3, losses: 0, draws: 0,
    scoreFor: 18, scoreAgainst: 6, scoreDifference: 12, winningPercentage: 1, tieResolution: [],
  };
  assert.notEqual(perfectTwoMatchPool.wins, perfectThreeMatchPool.wins);
  assert.deepEqual(
    normalizedStandingScore(perfectTwoMatchPool, "percentage"),
    normalizedStandingScore(perfectThreeMatchPool, "percentage"),
  );
});

test("nasty fixture: circular three-way head-to-head tie fails closed with all entrants as evidence", () => {
  const nodes: ContestNode[] = [["A", "B"], ["B", "C"], ["C", "A"]].map(([left, right], index) => ({
    id: `circle.M${index + 1}`,
    stageId: "circle.pools",
    divisionId: "open",
    poolId: "circle.P1",
    round: "pool-round-1",
    roundIndex: 1,
    index: index + 1,
    kind: "contest",
    slots: [{ type: "entrant", entrantId: left! }, { type: "entrant", entrantId: right! }],
    requiredResourceType: "court",
  }));
  const results: ContestResult[] = [
    { contestId: "circle.M1", entrants: ["A", "B"], winnerId: "A", loserId: "B", scoreFor: [1, 0], status: "completed" },
    { contestId: "circle.M2", entrants: ["B", "C"], winnerId: "B", loserId: "C", scoreFor: [1, 0], status: "completed" },
    { contestId: "circle.M3", entrants: ["C", "A"], winnerId: "C", loserId: "A", scoreFor: [1, 0], status: "completed" },
  ];
  const calculated = calculateStandings(nodes, results, {
    id: "circular-head-to-head",
    stageIds: ["circle.pools"],
    metricOrder: [{ metric: "wins", direction: "DESC" }, { metric: "head_to_head", direction: "DESC" }],
    tieFallback: "manual_decision",
  });
  const finding = calculated.findings.find(({ code }) => code === "TSC712");
  assert.ok(finding);
  assert.deepEqual(finding.evidence?.entrants, ["A", "B", "C"]);
});

test("nasty fixture: a bye has no loser while a played match feeds exactly one loser path", () => {
  const nodes: ContestNode[] = [
    {
      id: "main.R1.bye", stageId: "main", divisionId: "open", round: "round-1", roundIndex: 1, index: 1,
      kind: "bye", slots: [{ type: "entrant", entrantId: "A" }, { type: "bye" }], requiredResourceType: "court",
    },
    {
      id: "main.R1.played", stageId: "main", divisionId: "open", round: "round-1", roundIndex: 1, index: 2,
      kind: "contest", slots: [{ type: "entrant", entrantId: "B" }, { type: "entrant", entrantId: "C" }], requiredResourceType: "court",
    },
    {
      id: "main.final", stageId: "main", divisionId: "open", round: "final", roundIndex: 2, index: 1,
      kind: "contest", slots: [{ type: "winner", contestId: "main.R1.bye" }, { type: "winner", contestId: "main.R1.played" }], requiredResourceType: "court",
    },
    {
      id: "consolation.final", stageId: "consolation", divisionId: "open", round: "final", roundIndex: 2, index: 2,
      kind: "contest", slots: [{ type: "loser", contestId: "main.R1.played" }, { type: "entrant", entrantId: "D" }], requiredResourceType: "court",
    },
  ];
  const edges: ProgressionEdge[] = [
    { fromContestId: "main.R1.bye", outcome: "winner", toContestId: "main.final", toSlot: 0 },
    { fromContestId: "main.R1.played", outcome: "winner", toContestId: "main.final", toSlot: 1 },
    { fromContestId: "main.R1.played", outcome: "loser", toContestId: "consolation.final", toSlot: 0 },
  ];
  const graph = graphOf(nodes, edges);
  const potentials = possibleEntrants(graph);
  assert.deepEqual([...potentials.get("main.final")!].sort(), ["A", "B", "C"]);
  assert.deepEqual([...potentials.get("consolation.final")!].sort(), ["B", "C", "D"]);

  const simulation = simulateGraph(graph, "bye-and-loser-replay");
  assert.deepEqual(simulation.unresolvedDependencies, []);
  assert.equal(simulation.results.some(({ contestId }) => contestId === "main.R1.bye"), false);
  const opening = simulation.results.find(({ contestId }) => contestId === "main.R1.played")!;
  const consolation = simulation.results.find(({ contestId }) => contestId === "consolation.final")!;
  assert.ok(consolation.entrants.includes(opening.loserId));
  assert.equal(analyzeParticipantPaths(graph).find(({ entrantId }) => entrantId === "A")?.possibleContestIds.includes("consolation.final"), false);
});

test("nasty fixture: two divisions that share one court are scheduled as one resource problem", () => {
  const definition = singleEliminationDefinition(2);
  definition.participants.count = 4;
  definition.divisions = [
    { id: "women", label: "Women", participantCount: 2, participantShape: "pair", stageIds: ["women.final"] },
    { id: "men", label: "Men", participantCount: 2, participantShape: "pair", stageIds: ["men.final"] },
  ];
  definition.stages = ["women", "men"].map((divisionId) => ({
    id: `${divisionId}.final`, label: `${divisionId} final`, divisionId, primitive: "single_elimination" as const,
    inputShape: "pair" as const, outputShape: "pair" as const, expectedEntrants: 2,
    bracket: { entrantCount: 2, topology: "power_of_two" as const, thirdPlaceMatch: false },
  }));
  definition.scoringSystems[0]!.stageIds = definition.stages.map(({ id }) => id);
  definition.scheduling.durations = definition.stages.map(({ id }) => ({ stageId: id, contestMinutes: 10, turnaroundMinutes: 0 }));
  definition.resources[0]!.quantity = 1;
  const spec = compile(definition, "cross-division-resource");
  const graph = buildCompetitionGraph(spec, createEntrants(spec));
  const schedule = solveSchedule(spec, graph);
  assert.equal(schedule.audit.status, "FEASIBLE");
  assert.equal(schedule.contests.length, 2);
  assert.deepEqual(new Set(schedule.contests.map(({ resourceId }) => resourceId)), new Set(["shared.court.1"]));
  const [first, second] = [...schedule.contests].sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  assert.ok(Date.parse(first!.end) <= Date.parse(second!.start));
  assert.deepEqual(validateSchedule(spec, graph, schedule), []);
});

test("nasty fixture: a final pinned before its latest feeder completes is independently infeasible", () => {
  const spec = reference();
  const nodes: ContestNode[] = [
    {
      id: "advanced.main.semi.1", stageId: "advanced.main", divisionId: "advanced", round: "semifinal", roundIndex: 1, index: 1,
      kind: "contest", slots: [{ type: "entrant", entrantId: "A" }, { type: "entrant", entrantId: "B" }], requiredResourceType: "court",
    },
    {
      id: "advanced.main.semi.2", stageId: "advanced.main", divisionId: "advanced", round: "semifinal", roundIndex: 1, index: 2,
      kind: "contest", slots: [{ type: "entrant", entrantId: "C" }, { type: "entrant", entrantId: "D" }], requiredResourceType: "court",
    },
    {
      id: "advanced.main.final", stageId: "advanced.main", divisionId: "advanced", round: "final", roundIndex: 2, index: 1,
      kind: "contest", slots: [{ type: "winner", contestId: "advanced.main.semi.1" }, { type: "winner", contestId: "advanced.main.semi.2" }], requiredResourceType: "court",
    },
  ];
  const graph = graphOf(nodes, [
    { fromContestId: "advanced.main.semi.1", outcome: "winner", toContestId: "advanced.main.final", toSlot: 0 },
    { fromContestId: "advanced.main.semi.2", outcome: "winner", toContestId: "advanced.main.final", toSlot: 1 },
  ]);
  const schedule: ScheduleSolution = {
    contests: [
      { contestId: "advanced.main.semi.1", resourceId: "venue.courts.1", start: "2026-09-05T17:15:00+03:00", end: "2026-09-05T18:05:00+03:00", possibleEntrantIds: ["A", "B"] },
      { contestId: "advanced.main.semi.2", resourceId: "venue.courts.2", start: "2026-09-05T17:05:00+03:00", end: "2026-09-05T17:55:00+03:00", possibleEntrantIds: ["C", "D"] },
      { contestId: "advanced.main.final", resourceId: "venue.courts.3", start: "2026-09-05T18:00:00+03:00", end: "2026-09-05T19:05:00+03:00", possibleEntrantIds: ["A", "B", "C", "D"] },
    ],
    audit: { solver: "fixture", version: "1", status: "FEASIBLE", objective: "earliest_finish", lowerBoundMinutes: 0 },
    findings: [],
  };
  const findings = validateSchedule(spec, graph, schedule);
  assert.ok(findings.some(({ code, path }) => code === "TSV405" && path.endsWith("advanced.main.final")));
});

test("deterministic property: actual bracket graphs for every entrant count 2-64 are complete and replayable", () => {
  for (let entrantCount = 2; entrantCount <= 64; entrantCount += 1) {
    const topology = describeBracketTopology(entrantCount);
    const spec = compile(singleEliminationDefinition(entrantCount), `topology-${entrantCount}`);
    const graph = buildCompetitionGraph(spec, createEntrants(spec));
    const first = simulateGraph(graph, `entrant-count-${entrantCount}`);
    const replay = simulateGraph(graph, `entrant-count-${entrantCount}`);

    assert.equal(topology.actualContestCount, entrantCount - 1, `topology cardinality for ${entrantCount}`);
    assert.equal(graph.generatedActualContestCount, entrantCount - 1, `graph cardinality for ${entrantCount}`);
    assert.deepEqual(graph.findings, [], `graph findings for ${entrantCount}`);
    assert.equal(first.completedContestCount, entrantCount - 1, `simulation cardinality for ${entrantCount}`);
    assert.deepEqual(first.unresolvedDependencies, [], `simulation dependencies for ${entrantCount}`);
    assert.equal(first.hash, replay.hash, `same-seed replay for ${entrantCount}`);
  }
});

test("malformed graph: cycles are rejected by every topological public entry point", () => {
  const nodes: ContestNode[] = ["A", "B"].map((id, index) => ({
    id,
    stageId: "bad",
    divisionId: "open",
    round: "round",
    roundIndex: index + 1,
    index: 1,
    kind: "contest",
    slots: [{ type: "winner", contestId: id === "A" ? "B" : "A" }, { type: "entrant", entrantId: `entrant-${id}` }],
    requiredResourceType: "court",
  }));
  const graph = graphOf(nodes, [
    { fromContestId: "A", outcome: "winner", toContestId: "B", toSlot: 0 },
    { fromContestId: "B", outcome: "winner", toContestId: "A", toSlot: 0 },
  ]);
  assert.throws(() => topologicalNodes(graph), /cyclic/);
  assert.throws(() => possibleEntrants(graph), /cyclic/);
  assert.throws(() => simulateGraph(graph, "cycle"), /cyclic/);
});

test("malformed graph: dangling outcome slots cannot manufacture a contest result", () => {
  const graph = graphOf([{
    id: "bad.final",
    stageId: "bad",
    divisionId: "open",
    round: "final",
    roundIndex: 1,
    index: 1,
    kind: "contest",
    slots: [{ type: "winner", contestId: "missing.semifinal" }, { type: "entrant", entrantId: "B" }],
    requiredResourceType: "court",
  }]);
  const simulation = simulateGraph(graph, "dangling-slot");
  assert.deepEqual(simulation.results, []);
  assert.deepEqual(simulation.unresolvedDependencies, ["bad.final"]);
  assert.equal(simulation.completedContestCount, 0);
  assert.throws(() => seedOrder(6), /power of two/);
});
