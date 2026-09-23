import assert from "node:assert/strict";
import test from "node:test";
import { canonicalHash, compileDefinition, type TournamentSpec } from "@tournament-os/tournament-schema";
import { playAndKonnectDefinition } from "@tournament-os/tournament-schema/example";
import { evaluateCompetitionGuard } from "../src/competition-guard.js";
import { createEntrants } from "../src/graph.js";
import { runScenario } from "../src/scenario.js";
import { validateSchedule } from "../src/scheduler.js";
import type { ScheduleSolution } from "../src/types.js";

// The Guard must not believe what a proposed plan says about itself. These attacks keep every
// self-reported field consistent and change only the facts the verifier is supposed to derive.

const reference = (): TournamentSpec => compileDefinition(structuredClone(playAndKonnectDefinition), {
  specId: "guard.independence", revision: 1, schemaVersion: "1.0.0", compilerVersion: "0.1.0",
  rulesetVersions: { padel: "1.0.0", competition: "1.0.0" }, sourcePrompt: "guard independence",
  createdAt: "2026-09-12T09:00:00.000Z",
}) as TournamentSpec;

const guard = (spec: TournamentSpec, scenario: ReturnType<typeof runScenario>,
  overrides: Partial<Pick<ReturnType<typeof runScenario>, "graph" | "schedule">> = {}) => evaluateCompetitionGuard({
  sourceDefinitionHash: canonicalHash(spec), spec, graph: overrides.graph ?? scenario.graph,
  schedule: overrides.schedule ?? scenario.schedule, ...(scenario.simulation ? { simulation: scenario.simulation } : {}),
});

/** Moves one pool contest onto a free court at the exact time another contest of a shared entrant plays. */
function doubleBookWithForgedEntrants(spec: TournamentSpec, scenario: ReturnType<typeof runScenario>) {
  const schedule = structuredClone(scenario.schedule) as ScheduleSolution;
  const pool = schedule.contests.filter(({ contestId }) => contestId.includes(".pools."));
  const courts = [...new Set(schedule.contests.map(({ resourceId }) => resourceId))];
  for (const first of pool) for (const second of pool) {
    if (first === second) continue;
    const shared = first.possibleEntrantIds.find((id) => second.possibleEntrantIds.includes(id));
    if (!shared) continue;
    const duration = Date.parse(second.end) - Date.parse(second.start);
    const start = Date.parse(first.start); const end = start + duration;
    const court = courts.find((resourceId) => resourceId !== first.resourceId && schedule.contests.every((other) =>
      other === second || other.resourceId !== resourceId || end <= Date.parse(other.start) || start >= Date.parse(other.end)));
    if (!court) continue;
    Object.assign(second, { resourceId: court, start: new Date(start).toISOString(), end: new Date(end).toISOString(),
      possibleEntrantIds: [] });
    return { schedule, sharedEntrantId: shared, contestId: second.contestId };
  }
  throw new Error("fixture has no free court to stage the double booking");
}

test("a schedule that hides a contest's entrants cannot double-book a participant past the verifier", () => {
  const spec = reference();
  const scenario = runScenario(spec, createEntrants(spec), "guard-independence");
  assert.deepEqual(validateSchedule(spec, scenario.graph, scenario.schedule), [], "the honest plan is clean");

  const forged = doubleBookWithForgedEntrants(spec, scenario);
  const findings = validateSchedule(spec, scenario.graph, forged.schedule);
  assert.ok(findings.some(({ code, path }) => code === "TSV411" && path === `/schedule/${forged.contestId}`),
    "the verifier derives the contest's entrants from the graph and rejects the understated claim");
  assert.ok(findings.some(({ code, evidence }) => code === "TSV406"
    && (evidence as { entrantId?: string } | undefined)?.entrantId === forged.sharedEntrantId),
    "the collision is judged on graph-derived entrants, not the schedule's claim");
  assert.equal(guard(spec, scenario, { schedule: forged.schedule }).status, "BLOCKED");
});

test("a graph that silently drops a contest cannot pass on its own self-reported counts", () => {
  const spec = reference();
  const scenario = runScenario(spec, createEntrants(spec), "guard-independence");
  assert.equal(guard(spec, scenario).status, "PASSED");

  const dropped = scenario.schedule.contests.find(({ contestId }) => contestId.includes(".pools."))!.contestId;
  const graph = structuredClone(scenario.graph);
  graph.nodes = graph.nodes.filter(({ id }) => id !== dropped);
  graph.edges = graph.edges.filter(({ fromContestId, toContestId }) => fromContestId !== dropped && toContestId !== dropped);
  const schedule = { ...structuredClone(scenario.schedule),
    contests: scenario.schedule.contests.filter(({ contestId }) => contestId !== dropped) } as ScheduleSolution;

  const report = guard(spec, scenario, { graph, schedule });
  assert.equal(report.status, "BLOCKED");
  assert.ok(report.findings.some(({ sourceCode }) => sourceCode === "KCG006"),
    "the Guard counts the graph's contests itself instead of trusting generatedActualContestCount");
});
