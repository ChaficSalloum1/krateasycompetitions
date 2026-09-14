import assert from "node:assert/strict";
import test from "node:test";
import { compileDefinition, validateTournamentSpec, type TournamentSpec } from "@tournament-os/tournament-schema";
import { playAndKonnectDefinition } from "@tournament-os/tournament-schema/example";
import { auditScheduleQuality, buildCompetitionGraph, createEntrants, qualify, runScenario, type Standing } from "../src/index.js";

const context = {
  specId: "play-and-konnect.acceptance", revision: 1, schemaVersion: "1.0.0", compilerVersion: "0.1.0",
  rulesetVersions: { padel: "1.0.0", competition: "1.0.0" }, sourcePrompt: "canonical Play & Konnect acceptance fixture",
  createdAt: "2026-09-05T09:00:00Z",
};

const compileFixture = (): TournamentSpec => compileDefinition(structuredClone(playAndKonnectDefinition), context) as TournamentSpec;

test("the canonical fixture compiles the exact settled pools and 98-contest inventory", () => {
  const spec = compileFixture();
  const validation = validateTournamentSpec(spec);
  assert.equal(validation.valid, true, JSON.stringify(validation.findings));
  assert.deepEqual(spec.stages.filter(({ pool }) => pool).map(({ divisionId, pool }) => [divisionId, pool!.sizes]), [
    ["advanced", [4, 4, 3]],
    ["intermediate", [4, 4, 3, 3, 3]],
    ["beginner", [4, 3, 3, 3, 3, 3]],
  ]);
  const graph = buildCompetitionGraph(spec, createEntrants(spec));
  const inventory = Object.fromEntries(["pools", "main", "consolation"].map((kind) => [kind,
    graph.nodes.filter(({ kind: nodeKind, stageId }) => nodeKind === "contest" && stageId.endsWith(`.${kind}`)).length,
  ]));
  assert.deepEqual(inventory, { pools: 57, main: 9, consolation: 32 });
  assert.equal(graph.generatedActualContestCount, 98);
  assert.equal(graph.expectedActualContestCount, 98);
  assert.deepEqual(graph.findings, []);
});

test("the canonical ledger declares 3,080 court-minutes inside the seven-court target window with no mandatory rest", () => {
  const spec = compileFixture();
  const graph = buildCompetitionGraph(spec, createEntrants(spec));
  const duration = (stageId: string, round: string): number => {
    const exact = [...spec.scheduling.durations].reverse().find((entry) => entry.stageId === stageId && entry.round === round);
    const general = [...spec.scheduling.durations].reverse().find((entry) => entry.stageId === stageId && entry.round === undefined);
    const rule = exact ?? general;
    assert.ok(rule, `missing duration for ${stageId}/${round}`);
    return rule.contestMinutes + rule.turnaroundMinutes;
  };
  const courtMinutes = graph.nodes.filter(({ kind }) => kind === "contest")
    .reduce((sum, node) => sum + duration(node.stageId, node.round), 0);
  assert.equal(courtMinutes, 3_080);
  assert.deepEqual(spec.scheduling.durations.filter(({ stageId, round }) =>
    (stageId === "advanced.main" || stageId === "intermediate.main") && round !== undefined)
    .map(({ stageId, round, contestMinutes, turnaroundMinutes }) => [stageId, round, contestMinutes + turnaroundMinutes]), [
      ["advanced.main", "round-1", 50], ["advanced.main", "final", 60],
      ["intermediate.main", "round-1", 50], ["intermediate.main", "final", 60],
    ]);
  assert.equal(spec.resources[0]?.quantity, 7);
  assert.equal(spec.resources[0]?.availability[0]?.start, "2026-09-05T12:00:00+03:00");
  assert.equal(spec.resources[0]?.availability[0]?.end, "2026-09-05T20:00:00+03:00");
  assert.equal(spec.scheduling.finishBy, "2026-09-05T20:00:00+03:00");
  assert.equal(spec.scheduling.constraints.some(({ rule, strength }) => rule === "minimum_rest" && strength === "HARD"), false);
});

test("qualification preserves winner tiers and normalized cross-pool order for Konnect and Tower seeds", () => {
  const spec = compileFixture();
  const entrants = createEntrants(spec);
  const standingsByStage: Record<string, Standing[]> = {};
  for (const stage of spec.stages.filter(({ pool }) => pool)) {
    let cursor = 0;
    const rows: Standing[] = [];
    stage.pool!.sizes.forEach((size, poolIndex) => {
      const played = size - 1;
      for (let rank = 1; rank <= size; rank += 1) {
        const entrant = entrants[stage.divisionId]![cursor + rank - 1]!;
        const wins = rank === 1 ? played : rank === 2 ? played - 1 : 0;
        const ratePriority = 20 - poolIndex;
        rows.push({
          entrantId: entrant.id, poolId: `${stage.id}.P${poolIndex + 1}`, rank, played, wins,
          losses: played - wins, draws: 0, scoreFor: ratePriority * played,
          scoreAgainst: rank * played, scoreDifference: (ratePriority - rank) * played,
          winningPercentage: wins / played, tieResolution: [],
        });
      }
      cursor += size;
    });
    standingsByStage[stage.id] = rows.reverse();
  }
  const result = qualify(spec, standingsByStage, entrants);
  assert.deepEqual(result.findings, []);
  assert.deepEqual(result.byStructure["advanced.main.structure"]?.map(({ id }) => id), [
    "advanced.team.1", "advanced.team.5", "advanced.team.9", "advanced.team.2",
  ]);
  assert.deepEqual(result.byStructure["intermediate.main.structure"]?.map(({ id }) => id), [
    "intermediate.team.1", "intermediate.team.5", "intermediate.team.9", "intermediate.team.12",
  ]);
  assert.deepEqual(result.byStructure["beginner.main.structure"]?.map(({ id }) => id), [
    "beginner.team.1", "beginner.team.5", "beginner.team.8", "beginner.team.11",
  ]);
  assert.deepEqual(result.byStructure["intermediate.consolation.structure"]?.slice(0, 3).map(({ id, seed }) => [id, seed]), [
    ["intermediate.team.15", 1], ["intermediate.team.2", 2], ["intermediate.team.6", 3],
  ]);
  assert.deepEqual(result.byStructure["beginner.consolation.structure"]?.slice(0, 3).map(({ id, seed }) => [id, seed]), [
    ["beginner.team.14", 1], ["beginner.team.17", 2], ["beginner.team.2", 3],
  ]);
  for (const division of spec.divisions) {
    const qualified = [
      ...(result.byStructure[`${division.id}.main.structure`] ?? []),
      ...(result.byStructure[`${division.id}.consolation.structure`] ?? []),
    ];
    assert.equal(qualified.length, division.participantCount);
    assert.equal(new Set(qualified.map(({ id }) => id)).size, division.participantCount);
  }
});

test("the complete benchmark schedule is certified, finishes early, and puts both headline finals at the climax", () => {
  const spec = compileFixture(); const scenario = runScenario(spec, createEntrants(spec), "play-konnect-acceptance");
  assert.equal(scenario.certification.status, "CERTIFIED", JSON.stringify(scenario.certification.findings));
  assert.equal(scenario.schedule.contests.length, 98);
  assert.equal(scenario.schedule.audit.objectiveValueMinutes, 470);
  assert.ok(Date.parse("2026-09-05T20:00:00+03:00") - Math.max(...scenario.schedule.contests.map(({ end }) => Date.parse(end))) >= 10 * 60_000);
  const quality = auditScheduleQuality(spec, scenario.graph, scenario.schedule);
  assert.equal(quality.status, "CERTIFIED", JSON.stringify(quality.findings));
  assert.equal(quality.metrics.avoidableIdleMinutes, 0);
  assert.equal(quality.metrics.headlineFinalGapMinutes, 0);
  assert.equal(quality.metrics.headlineFinalIsClimax, true);
  const finish = Math.max(...scenario.schedule.contests.map(({ end }) => Date.parse(end)));
  assert.deepEqual(scenario.schedule.contests.filter(({ contestId }) =>
    contestId === "advanced.main.R2.M1" || contestId === "intermediate.main.R2.M1").map(({ end }) => Date.parse(end)), [finish, finish]);
  assert.match(quality.proofHash, /^[a-f0-9]{64}$/);
});
