import assert from "node:assert/strict";
import test from "node:test";
import { compileDefinition, type TournamentSpec } from "@tournament-os/tournament-schema";
import { playAndKonnectDefinition } from "@tournament-os/tournament-schema/example";
import type { ContestNode } from "../src/index.js";
import {
  americanoEngine,
  analyzeParticipantPaths,
  analyzeSchedule,
  verifyParticipantPathRequirements,
  buildCompetitionGraph,
  calculateStandings,
  certify,
  createEntrants,
  createPublicationEnvelope,
  describeBracketTopology,
  deterministicRandom,
  interpretEnglish,
  applyResultThroughInvariantFirewall,
  explainWhyNot,
  placeDraw,
  planEnglishModification,
  runScenario,
  seedOrder,
  simulateGraph,
  simulateOperationalRisk,
  validateSchedule,
} from "../src/index.js";

const context = {
  specId: "pk.engine.test", revision: 1, schemaVersion: "1.0.0", compilerVersion: "0.1.0",
  rulesetVersions: { padel: "1.0.0", competition: "1.0.0" }, sourcePrompt: "reference",
  createdAt: "2026-09-05T09:00:00Z",
};
const reference = (): TournamentSpec => compileDefinition(structuredClone(playAndKonnectDefinition), context) as TournamentSpec;

test("bracket seed topology is deterministic and protects high seeds", () => {
  assert.deepEqual(seedOrder(8), [1, 8, 4, 5, 2, 7, 3, 6]);
});

test("arbitrary entrant counts 2 through 64 preserve n-1 elimination cardinality", () => {
  for (let count = 2; count <= 64; count += 1) {
    const topology = describeBracketTopology(count);
    assert.equal(topology.actualContestCount, count - 1);
    assert.equal(topology.bracketSize - topology.byeCount, count);
  }
});

test("graph generation and independent cardinality agree", () => {
  const spec = structuredClone(reference());
  const graph = buildCompetitionGraph(spec, createEntrants(spec));
  assert.equal(graph.generatedActualContestCount, 98);
  assert.equal(graph.expectedActualContestCount, 98);
  assert.deepEqual(graph.findings, []);
});

test("the reference benchmark executes through one certified pipeline", () => {
  const spec = reference();
  const scenario = runScenario(spec, createEntrants(spec), "scenario-seed");
  assert.equal(scenario.certification.status, "CERTIFIED");
  assert.equal(scenario.schedule.audit.status, "FEASIBLE");
  assert.equal(scenario.schedule.contests.length, scenario.graph.generatedActualContestCount);
  assert.equal(scenario.simulation?.unresolvedDependencies.length, 0);
});

test("certification requires a positive solver feasibility claim", () => {
  const spec = reference();
  const scenario = runScenario(spec, createEntrants(spec), "solver-proof-closure");
  const unproven = structuredClone(scenario.schedule);
  unproven.audit.status = "UNKNOWN";

  const certification = certify(spec, scenario.graph, unproven, scenario.simulation);

  assert.equal(certification.status, "REJECTED");
  assert.ok(certification.findings.some(({ code, path }) =>
    code === "TSC903" && path === "/schedule/audit/status"));
});

test("participant-path and schedule proof objects cover the complete benchmark", () => {
  const spec = reference(); const entrants = createEntrants(spec); const scenario = runScenario(spec, entrants, "analytics");
  const paths = analyzeParticipantPaths(scenario.graph);
  assert.equal(paths.length, 47);
  assert.ok(paths.every(({ minimumContestCount, maximumContestCount }) => minimumContestCount > 0 && maximumContestCount >= minimumContestCount));
  const analytics = analyzeSchedule(spec, scenario.graph, scenario.schedule);
  assert.equal(analytics.scheduledContestCount, 98);
  assert.ok(analytics.criticalPathContestIds.length > 0);
  assert.equal(analytics.resourceUtilisation.length, 7);
});

test("soft minimum-participation shortfalls carry concrete entrant counterexamples", () => {
  const spec = reference(); const scenario = runScenario(spec, createEntrants(spec), "path-requirement");
  const findings = verifyParticipantPathRequirements(spec, analyzeParticipantPaths(scenario.graph));
  const shortfall = findings.find(({ code }) => code === "TSW104");
  assert.ok(shortfall);
  assert.ok(Array.isArray(shortfall.evidence?.counterexample));
  assert.ok((shortfall.evidence?.affectedEntrants as string[]).length > 0);
});

test("the shadow validator catches schedule tampering", () => {
  const spec = reference();
  const scenario = runScenario(spec, createEntrants(spec), "tamper-seed");
  const tampered = structuredClone(scenario.schedule);
  tampered.contests[0]!.end = new Date(Date.parse(tampered.contests[0]!.end) + 60_000).toISOString();
  assert.ok(validateSchedule(spec, scenario.graph, tampered).some(({ code }) => code === "TSV403"));
});

test("Why-not explanations identify occupied resources", () => {
  const spec = reference(); const scenario = runScenario(spec, createEntrants(spec), "why-not");
  const first = scenario.schedule.contests[0]!; const second = scenario.schedule.contests.find(({ resourceId, contestId }) => resourceId === first.resourceId && contestId !== first.contestId)!;
  const answer = explainWhyNot(scenario.graph, scenario.schedule, second.contestId, first.start);
  assert.equal(answer.legal, false);
  assert.ok(answer.reasons.length > 0);
});

test("simulation replay is deterministic", () => {
  const spec = reference(); const graph = buildCompetitionGraph(spec, createEntrants(spec));
  assert.equal(simulateGraph(graph, "same-seed").hash, simulateGraph(graph, "same-seed").hash);
  assert.notEqual(simulateGraph(graph, "same-seed").hash, simulateGraph(graph, "different-seed").hash);
});

test("three-way circular head-to-head ties fail closed with evidence", () => {
  const nodes: ContestNode[] = [["A", "B"], ["B", "C"], ["C", "A"]].map(([left, right], index) => ({
    id: `M${index + 1}`, stageId: "pools", divisionId: "open", poolId: "P1", round: "pool", roundIndex: 1, index: index + 1,
    kind: "contest" as const, slots: [{ type: "entrant" as const, entrantId: left! }, { type: "entrant" as const, entrantId: right! }],
    requiredResourceType: "court",
  }));
  const results = [
    { contestId: "M1", entrants: ["A", "B"] as [string, string], winnerId: "A", loserId: "B", scoreFor: [1, 0] as [number, number], status: "completed" as const },
    { contestId: "M2", entrants: ["B", "C"] as [string, string], winnerId: "B", loserId: "C", scoreFor: [1, 0] as [number, number], status: "completed" as const },
    { contestId: "M3", entrants: ["C", "A"] as [string, string], winnerId: "C", loserId: "A", scoreFor: [1, 0] as [number, number], status: "completed" as const },
  ];
  const calculated = calculateStandings(nodes, results, { id: "three-way", stageIds: ["pools"], metricOrder: [{ metric: "wins", direction: "DESC" }, { metric: "head_to_head", direction: "DESC" }], tieFallback: "manual_decision" });
  const finding = calculated.findings.find(({ code }) => code === "TSC712");
  assert.deepEqual(finding?.evidence?.entrants, ["A", "B", "C"]);
});

test("unregistered standings metrics fail closed instead of ranking every entrant as zero", () => {
  const nodes: ContestNode[] = [{
    id: "M1", stageId: "pools", divisionId: "open", poolId: "P1", round: "pool", roundIndex: 1, index: 1,
    kind: "contest", slots: [{ type: "entrant", entrantId: "A" }, { type: "entrant", entrantId: "B" }],
    requiredResourceType: "court",
  }];
  const calculated = calculateStandings(nodes, [], {
    id: "invented-metric", stageIds: ["pools"],
    metricOrder: [{ metric: "vibes", direction: "DESC" }], tieFallback: "shared_rank",
  });

  assert.deepEqual(calculated.standings, []);
  assert.ok(calculated.findings.some(({ code, path }) =>
    code === "TSC713" && path === "/standingsPolicies/invented-metric/metricOrder/0"));
});

test("unimplemented cross-pool normalizations reject the scenario instead of using raw totals", () => {
  const spec = structuredClone(reference());
  spec.qualificationPolicies[0]!.normalization = "strength_adjusted";

  const result = runScenario(spec, createEntrants(spec), "unsupported-normalization");

  assert.equal(result.certification.status, "REJECTED");
  assert.ok(result.certification.findings.some(({ code, path }) =>
    code === "TSC803" && path === `/qualificationPolicies/${spec.qualificationPolicies[0]!.id}/normalization`));
});

test("draw optimisation is replayable", () => {
  const entrants = createEntrants(reference()).advanced!.slice(0, 8);
  const policy = reference().drawPolicies[0]!;
  const first = placeDraw(entrants, policy, new Set(["advanced.team.1|advanced.team.2"]), { mode: "deterministic", algorithm: "xoshiro128ss", seed: "draw-seed" });
  const second = placeDraw(entrants, policy, new Set(["advanced.team.1|advanced.team.2"]), { mode: "deterministic", algorithm: "xoshiro128ss", seed: "draw-seed" });
  const differentAlgorithm = placeDraw(entrants, policy, new Set(["advanced.team.1|advanced.team.2"]), { mode: "deterministic", algorithm: "pcg32", seed: "draw-seed" });
  assert.equal(first.proofHash, second.proofHash);
  assert.notEqual(first.proofHash, differentAlgorithm.proofHash);
  assert.throws(() => placeDraw(entrants, policy, new Set(), { mode: "none" }), /pinned/i);
});

test("English interpretation extracts facts and classifies optimiser delegation", () => {
  const intent = interpretEnglish("I have 47 padel pairs. 11 Advanced, 17 Intermediate and 19 Beginner. Seven courts. Split into sensible pools.");
  assert.equal(intent.facts.participantCount, 47);
  assert.equal(intent.facts.courtCount, 7);
  assert.deepEqual(intent.facts.divisionCounts, { advanced: 11, intermediate: 17, beginner: 19 });
  assert.ok(intent.ambiguities.some(({ severity }) => severity === "OPTIMISABLE"));
});

test("unregistered English modifications fail closed", () => {
  const current = reference();
  const result = planEnglishModification(current, "Make it more exciting", { ...context, revision: 2, createdAt: "2026-09-05T10:00:00Z", previousSpecHash: current.metadata.compiledSpecHash });
  assert.equal(result.plan, undefined);
  assert.equal(result.unresolved.length, 1);
});

test("registered English modifications produce inspectable semantic plans", () => {
  const current = reference();
  const result = planEnglishModification(current, "Make finals 70 minutes", { ...context, revision: 2, createdAt: "2026-09-05T10:00:00Z", previousSpecHash: current.metadata.compiledSpecHash });
  assert.equal(result.plan?.status, "VALID");
  assert.equal(result.plan?.changes.length, 2);
  assert.ok(result.plan?.changes.every(({ path }) => path.endsWith("/contestMinutes")));
});

test("Americano dynamic rounds keep every player in exactly one contest", () => {
  let state = americanoEngine.initialise({ players: Array.from({ length: 8 }, (_, index) => `P${index + 1}`), rounds: 2, seed: "americano" });
  const round = americanoEngine.generateNextRound(state);
  assert.deepEqual(americanoEngine.validateRound(state, round), []);
  state = americanoEngine.applyResults(state, round.contests.map(({ id }) => ({ contestId: id, scores: [21, 17] })));
  assert.equal(state.round, 1);
  assert.equal(americanoEngine.isComplete(state), false);
});

test("Monte Carlo operational risk is deterministic", () => {
  const spec = reference(); const scenario = runScenario(spec, createEntrants(spec), "risk-scenario");
  const options = { iterations: 100, seed: "risk", durationStdDevFraction: 0.2 };
  assert.deepEqual(simulateOperationalRisk(scenario.schedule, options), simulateOperationalRisk(scenario.schedule, options));
});

test("uncertified truth cannot cross the external integration boundary", () => {
  assert.throws(() => createPublicationEnvelope({
    status: "REJECTED", specHash: "x", graphHash: "y", findings: [], requirementCoverage: [], statement: "rejected", certificationHash: "z",
  }, [], {}, []), /Only certified/);
});

test("runtime invariant firewall rejects destructive result overwrite", () => {
  const spec = reference(); const graph = buildCompetitionGraph(spec, createEntrants(spec)); const simulation = simulateGraph(graph, "firewall");
  const result = simulation.results[0]!;
  const state = applyResultThroughInvariantFirewall({ results: {} }, graph, result);
  assert.throws(() => applyResultThroughInvariantFirewall(state, graph, result), /immutable/);
});

test("a declared stage can never disappear from the graph and still certify", () => {
  const definition = structuredClone(playAndKonnectDefinition);
  definition.participants.count = 4;
  definition.divisions = [{ id: "open", label: "Open", participantCount: 4, participantShape: "pair", stageIds: ["open.swiss"] }];
  definition.stages = [{
    id: "open.swiss", label: "Swiss", divisionId: "open", primitive: "swiss",
    inputShape: "pair", outputShape: "pair", expectedEntrants: 4,
    swiss: { schemaVersion: "1.0.0", entrantIds: ["a", "b", "c", "d"], totalRounds: 2,
      pairingPolicy: { rematches: "FORBIDDEN" }, points: { win: 2, draw: 1, bye: 2 },
      finalRankingPolicy: { id: "points-id", version: "1", criteria: ["POINTS", "COMPETITOR_ID"] } },
  }];
  definition.scoringSystems = [{ id: "scoring", adapterRule: "padel.timed.standard", version: "1.0.0", stageIds: ["open.swiss"] }];
  definition.standingsPolicies = [];
  definition.qualificationPolicies = [];
  definition.competitionStructures = [];
  definition.drawPolicies = [];
  definition.progressionPolicies = [];
  definition.scheduling.durations = [{ stageId: "open.swiss", contestMinutes: 20, turnaroundMinutes: 5 }];
  definition.operationalPolicies = [];
  definition.assumptions = [];
  definition.requirements = [];
  const spec = compileDefinition(definition, { ...context, specId: "unsupported-stage" }) as TournamentSpec;

  const result = runScenario(spec, createEntrants(spec), "unsupported-stage");
  assert.equal(result.certification.status, "REJECTED");
  assert.ok(result.certification.findings.some(({ code, path }) => code === "TSC704" && path === "/stages/open.swiss"));
});

test("a configured bracket is not mistaken for an executable double-elimination engine", () => {
  const spec = structuredClone(reference());
  const bracketStage = spec.stages.find(({ bracket }) => bracket !== undefined)!;
  bracketStage.primitive = "double_elimination";

  const graph = buildCompetitionGraph(spec, createEntrants(spec));

  assert.ok(graph.findings.some(({ code, path }) =>
    code === "TSC705" && path === `/stages/${bracketStage.id}/primitive`));
  assert.equal(graph.nodes.some(({ stageId }) => stageId === bracketStage.id), false);
});

test("random source produces a stable replay sequence", () => {
  const left = deterministicRandom("seed"); const right = deterministicRandom("seed");
  assert.deepEqual(Array.from({ length: 10 }, () => left.next()), Array.from({ length: 10 }, () => right.next()));
});
