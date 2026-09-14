import assert from "node:assert/strict";
import test from "node:test";
import {
  compileDefinition,
  type DrawPolicy,
  type TournamentDefinition,
  type TournamentSpec,
} from "@tournament-os/tournament-schema";
import { playAndKonnectDefinition } from "@tournament-os/tournament-schema/example";
import {
  buildCompetitionGraph,
  createEntrants,
  describeBracketTopology,
  placeDraw,
  possibleEntrants,
  seedOrder,
  simulateGraph,
  type CompetitionGraph,
  type ContestNode,
  type Entrant,
  type ProgressionEdge,
} from "../src/index.js";

function eliminationSpec(entrantCount: number): TournamentSpec {
  const definition: TournamentDefinition = structuredClone(playAndKonnectDefinition);
  definition.participants.count = entrantCount;
  definition.divisions = [{
    id: "open", label: "Open", participantCount: entrantCount, participantShape: "pair", stageIds: ["open.main"],
  }];
  definition.stages = [{
    id: "open.main", label: "Open main", divisionId: "open", primitive: "single_elimination",
    inputShape: "pair", outputShape: "pair", expectedEntrants: entrantCount,
    bracket: { entrantCount, topology: "arbitrary", thirdPlaceMatch: false },
  }];
  definition.scoringSystems = [{ id: "scoring", adapterRule: "padel.timed.standard", version: "1.0.0", stageIds: ["open.main"] }];
  definition.standingsPolicies = [];
  definition.qualificationPolicies = [];
  definition.competitionStructures = [];
  definition.drawPolicies = [];
  definition.progressionPolicies = [];
  definition.scheduling.constraints = [];
  definition.scheduling.durations = [{ stageId: "open.main", contestMinutes: 10, turnaroundMinutes: 0 }];
  definition.resources = [{
    id: "courts", type: "court", quantity: 8,
    availability: [{ start: "2026-09-05T09:00:00Z", end: "2026-09-08T09:00:00Z" }],
  }];
  definition.operationalPolicies = [];
  definition.assumptions = [];
  definition.requirements = [];
  return compileDefinition(definition, {
    specId: `topology.${entrantCount}`,
    revision: 1,
    schemaVersion: "1.0.0",
    compilerVersion: "0.1.0",
    rulesetVersions: { padel: "1.0.0", competition: "1.0.0" },
    sourcePrompt: `property bracket with ${entrantCount} entrants`,
    createdAt: "2026-09-05T09:00:00Z",
  }) as TournamentSpec;
}

const graphOf = (nodes: ContestNode[], edges: ProgressionEdge[] = []): CompetitionGraph => ({
  specHash: "adversarial-topology",
  nodes,
  edges,
  expectedActualContestCount: nodes.filter(({ kind }) => kind === "contest").length,
  generatedActualContestCount: nodes.filter(({ kind }) => kind === "contest").length,
  findings: [],
});

test("topology property 2-64: every entrant occupies exactly one opening slot and every actual bracket has n-1 contests", () => {
  for (let entrantCount = 2; entrantCount <= 64; entrantCount += 1) {
    const topology = describeBracketTopology(entrantCount);
    const spec = eliminationSpec(entrantCount);
    const entrants = createEntrants(spec).open!;
    const graph = buildCompetitionGraph(spec, { open: entrants });
    const opening = graph.nodes.filter(({ roundIndex }) => roundIndex === 1);
    const openingEntrants = opening.flatMap(({ slots }) => slots.flatMap((slot) => slot.type === "entrant" ? [slot.entrantId] : []));
    const openingByes = opening.flatMap(({ slots }) => slots.filter((slot) => slot.type === "bye"));

    assert.equal(new Set(openingEntrants).size, entrantCount, `unique opening entrants for ${entrantCount}`);
    assert.deepEqual([...openingEntrants].sort(), entrants.map(({ id }) => id).sort(), `complete opening field for ${entrantCount}`);
    assert.equal(openingByes.length, topology.byeCount, `bye count for ${entrantCount}`);
    assert.equal(graph.nodes.filter(({ kind }) => kind === "bye").length, topology.byeCount, `bye nodes for ${entrantCount}`);
    assert.equal(graph.generatedActualContestCount, entrantCount - 1, `actual contest count for ${entrantCount}`);
    assert.ok(graph.nodes.filter(({ roundIndex }) => roundIndex > 1).every(({ slots }) => slots.every((slot) => slot.type === "winner")));
  }
});

test("bye property 3-63: only the highest seeds receive byes and no bye creates a result or loser", () => {
  for (let entrantCount = 3; entrantCount <= 63; entrantCount += 1) {
    const topology = describeBracketTopology(entrantCount);
    if (topology.byeCount === 0) continue;
    const spec = eliminationSpec(entrantCount);
    const entrants = createEntrants(spec).open!;
    const graph = buildCompetitionGraph(spec, { open: entrants });
    const byeNodes = graph.nodes.filter(({ kind }) => kind === "bye");
    const byeSeeds = byeNodes.flatMap(({ slots }) => slots.flatMap((slot) => {
      if (slot.type !== "entrant") return [];
      return [entrants.find(({ id }) => id === slot.entrantId)!.seed!];
    })).sort((left, right) => left - right);

    assert.deepEqual(byeSeeds, Array.from({ length: topology.byeCount }, (_, index) => index + 1), `protected byes for ${entrantCount}`);
    assert.ok(byeNodes.every(({ slots }) => slots.filter(({ type }) => type === "bye").length === 1));
    const byeIds = new Set(byeNodes.map(({ id }) => id));
    assert.ok(graph.edges.filter(({ fromContestId }) => byeIds.has(fromContestId)).every(({ outcome }) => outcome === "winner"));
    assert.ok(graph.nodes.every(({ slots }) => slots.every((slot) => slot.type !== "loser" || !byeIds.has(slot.contestId))));
    const simulation = simulateGraph(graph, `bye-${entrantCount}`);
    assert.ok(byeNodes.every(({ id }) => simulation.results.every(({ contestId }) => contestId !== id)));
    assert.deepEqual(simulation.unresolvedDependencies, []);
  }
});

test("seed separation property: the top two seeds occupy opposite bracket halves", () => {
  for (const bracketSize of [4, 8, 16, 32, 64]) {
    const order = seedOrder(bracketSize);
    assert.equal(new Set(order).size, bracketSize);
    assert.deepEqual([...order].sort((left, right) => left - right), Array.from({ length: bracketSize }, (_, index) => index + 1));
    const firstSeedPosition = order.indexOf(1);
    const secondSeedPosition = order.indexOf(2);
    assert.equal(firstSeedPosition < bracketSize / 2, true, `seed 1 first half for ${bracketSize}`);
    assert.equal(secondSeedPosition >= bracketSize / 2, true, `seed 2 second half for ${bracketSize}`);

    const graph = buildCompetitionGraph(eliminationSpec(bracketSize), createEntrants(eliminationSpec(bracketSize)));
    const opening = graph.nodes.filter(({ roundIndex }) => roundIndex === 1);
    const seedOneMatch = opening.findIndex(({ slots }) => slots.some((slot) => slot.type === "entrant" && slot.entrantId === "open.team.1"));
    const seedTwoMatch = opening.findIndex(({ slots }) => slots.some((slot) => slot.type === "entrant" && slot.entrantId === "open.team.2"));
    assert.equal(seedOneMatch < opening.length / 2, true);
    assert.equal(seedTwoMatch >= opening.length / 2, true);
  }
});

test("loser path trap: a played contest resolves its loser but a bye cannot manufacture one", () => {
  const playedSource: ContestNode = {
    id: "main.played", stageId: "main", divisionId: "open", round: "semifinal", roundIndex: 1, index: 1,
    kind: "contest", slots: [{ type: "entrant", entrantId: "A" }, { type: "entrant", entrantId: "B" }], requiredResourceType: "court",
  };
  const byeSource: ContestNode = {
    id: "main.bye", stageId: "main", divisionId: "open", round: "semifinal", roundIndex: 1, index: 2,
    kind: "bye", slots: [{ type: "entrant", entrantId: "C" }, { type: "bye" }], requiredResourceType: "court",
  };
  const playedLoserTarget: ContestNode = {
    id: "plate.played-loser", stageId: "plate", divisionId: "open", round: "final", roundIndex: 2, index: 1,
    kind: "contest", slots: [{ type: "loser", contestId: "main.played" }, { type: "entrant", entrantId: "D" }], requiredResourceType: "court",
  };
  const byeLoserTarget: ContestNode = {
    id: "plate.bye-loser", stageId: "plate", divisionId: "open", round: "final", roundIndex: 2, index: 2,
    kind: "contest", slots: [{ type: "loser", contestId: "main.bye" }, { type: "entrant", entrantId: "E" }], requiredResourceType: "court",
  };
  const graph = graphOf([playedSource, byeSource, playedLoserTarget, byeLoserTarget], [
    { fromContestId: "main.played", outcome: "loser", toContestId: "plate.played-loser", toSlot: 0 },
    { fromContestId: "main.bye", outcome: "loser", toContestId: "plate.bye-loser", toSlot: 0 },
  ]);
  const simulation = simulateGraph(graph, "loser-path-trap");
  assert.ok(simulation.results.some(({ contestId }) => contestId === "plate.played-loser"));
  assert.ok(simulation.unresolvedDependencies.includes("plate.bye-loser"));
  assert.equal(simulation.results.some(({ contestId }) => contestId === "main.bye"), false);
});

test("impossible hard rematch avoidance is surfaced deterministically rather than silently discarded", () => {
  const entrants: Entrant[] = Array.from({ length: 4 }, (_, index) => ({
    id: `team.${index + 1}`, divisionId: "open", memberIds: [`player.${index + 1}`], seed: index + 1,
  }));
  const everyPriorPair = new Set<string>();
  for (let left = 0; left < entrants.length; left += 1) for (let right = left + 1; right < entrants.length; right += 1) {
    everyPriorPair.add([entrants[left]!.id, entrants[right]!.id].sort().join("|"));
  }
  const policy: DrawPolicy = {
    id: "no-rematches", structureId: "main", placement: "optimised",
    priorities: [{ rule: "avoid_opening_round_rematch", strength: "HARD", priority: 1 }],
  };
  const first = placeDraw(entrants, policy, everyPriorPair, { mode: "deterministic", algorithm: "xoshiro128ss", seed: "impossible-rematches" });
  const replay = placeDraw(entrants, policy, everyPriorPair, { mode: "deterministic", algorithm: "xoshiro128ss", seed: "impossible-rematches" });
  assert.equal(first.violations.length, 2);
  assert.ok(first.violations.every(({ strength, rule }) => strength === "HARD" && rule === "avoid_opening_round_rematch"));
  assert.equal(first.proofHash, replay.proofHash);
  assert.deepEqual(first.orderedEntrantIds, replay.orderedEntrantIds);
});

test("deterministic replay property: topology, possible entrants, and outcomes are byte-stable", () => {
  for (const entrantCount of [2, 3, 5, 7, 11, 17, 31, 47, 63, 64]) {
    const spec = eliminationSpec(entrantCount);
    const entrants = createEntrants(spec);
    const firstGraph = buildCompetitionGraph(spec, entrants);
    const replayGraph = buildCompetitionGraph(spec, entrants);
    assert.deepEqual(firstGraph, replayGraph);
    assert.deepEqual(
      [...possibleEntrants(firstGraph)].map(([id, values]) => [id, [...values].sort()]),
      [...possibleEntrants(replayGraph)].map(([id, values]) => [id, [...values].sort()]),
    );
    const firstRun = simulateGraph(firstGraph, "topology-replay");
    const replayRun = simulateGraph(replayGraph, "topology-replay");
    assert.equal(firstRun.hash, replayRun.hash);
    assert.deepEqual(firstRun.results, replayRun.results);
  }
});
