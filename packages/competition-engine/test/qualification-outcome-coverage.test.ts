import assert from "node:assert/strict";
import test from "node:test";
import { compileDefinition, type TournamentSpec } from "@tournament-os/tournament-schema";
import { playAndKonnectDefinition } from "@tournament-os/tournament-schema/example";
import { solveSchedule, validateSchedule } from "../src/scheduler.js";
import { solveGraphWithCpSat } from "../src/scheduling-quality.js";
import type { CompetitionGraph, ContestNode, ProgressionEdge, ScheduleSolution } from "../src/types.js";

// A hard rule has to hold in every qualification outcome, not only in the one the planning simulation
// picked. These fixtures name one simulated qualifier set in the graph, exactly as runScenario does,
// and check the other teams that could qualify instead.

const REST = 30;
const withRest = (): TournamentSpec => {
  const spec = structuredClone(compileDefinition(structuredClone(playAndKonnectDefinition), {
    specId: "qualification.outcomes", revision: 1, schemaVersion: "1.0.0", compilerVersion: "0.1.0",
    rulesetVersions: { padel: "1.0.0", competition: "1.0.0" }, sourcePrompt: "qualification outcomes",
    createdAt: "2026-09-12T09:00:00.000Z",
  })) as TournamentSpec;
  spec.scheduling.constraints.push({ id: "rest.hard", rule: "minimum_rest", strength: "HARD", value: REST } as never);
  return spec;
};

const contest = (id: string, stageId: string, round: string, a: string, b: string): ContestNode => ({
  id, stageId, divisionId: "advanced", round, roundIndex: 1, index: 1, kind: "contest",
  slots: [{ type: "entrant", entrantId: a }, { type: "entrant", entrantId: b }], requiredResourceType: "court",
});
const roundRobin = (pool: string, entrants: string[]): ContestNode[] => entrants.flatMap((a, i) =>
  entrants.slice(i + 1).map((b) => contest(`advanced.pools.${pool}.${a}${b}`, "advanced.pools", "pool", a, b)));
const completion = (feeders: ContestNode[], toContestId: string): ProgressionEdge[] =>
  feeders.map(({ id }) => ({ fromContestId: id, outcome: "complete", toContestId, toSlot: 0 }));
const graphOf = (nodes: ContestNode[], edges: ProgressionEdge[]): CompetitionGraph => ({
  specHash: "qualification-outcomes", nodes, edges, findings: [],
  expectedActualContestCount: nodes.length, generatedActualContestCount: nodes.length,
});
const at = (hhmm: string) => `2026-09-05T${hhmm}:00+03:00`;
const slot = (contestId: string, court: number, start: string, end: string, possibleEntrantIds: string[]) =>
  ({ contestId, resourceId: `venue.courts.${court}`, start: at(start), end: at(end), possibleEntrantIds });
const scheduleOf = (contests: ScheduleSolution["contests"]): ScheduleSolution =>
  ({ contests, audit: { solver: "fixture", version: "1", status: "FEASIBLE", objective: "earliest_finish", lowerBoundMinutes: 0 }, findings: [] });
const tsv412 = (findings: ReturnType<typeof validateSchedule>) => findings.filter(({ code }) => code === "TSV412");

/** A four-team pool in three rounds, every team resting 30 minutes between matches; ends at 14:30. */
const poolOfFourSlots = (pool: ContestNode[]) => {
  const round: Record<string, [number, string, string]> = { AB: [1, "12:00", "12:30"], CD: [2, "12:00", "12:30"],
    AC: [1, "13:00", "13:30"], BD: [2, "13:00", "13:30"], AD: [1, "14:00", "14:30"], BC: [2, "14:00", "14:30"] };
  return pool.map((node) => {
    const pair = node.slots.map((s) => (s as { entrantId: string }).entrantId);
    const [court, start, end] = round[pair.join("")]!;
    return slot(node.id, court, start, end, pair);
  });
};

/** Two pools of three feed a final that names the simulated winners A and D. */
function twoPoolsIntoFinal() {
  const p1 = [contest("advanced.pools.P1.AB", "advanced.pools", "pool", "A", "B"), contest("advanced.pools.P1.AC", "advanced.pools", "pool", "A", "C"),
    contest("advanced.pools.P1.BC", "advanced.pools", "pool", "B", "C")];
  const p2 = [contest("advanced.pools.P2.DE", "advanced.pools", "pool", "D", "E"), contest("advanced.pools.P2.DF", "advanced.pools", "pool", "D", "F"),
    contest("advanced.pools.P2.EF", "advanced.pools", "pool", "E", "F")];
  const final = contest("advanced.main.final", "advanced.main", "final", "A", "D");
  return { graph: graphOf([...p1, ...p2, final], completion([...p1, ...p2], final.id)), final };
}

test("hard rest is checked for every team that could qualify, not only the simulated qualifiers", () => {
  const spec = withRest();
  const { graph } = twoPoolsIntoFinal();
  // A and D finish at 13:30 and get their 30 minutes; B, C, E and F finish at 14:30 and could equally qualify.
  const schedule = scheduleOf([
    slot("advanced.pools.P1.AB", 1, "12:00", "12:30", ["A", "B"]), slot("advanced.pools.P1.AC", 1, "13:00", "13:30", ["A", "C"]),
    slot("advanced.pools.P1.BC", 1, "14:00", "14:30", ["B", "C"]), slot("advanced.pools.P2.DE", 2, "12:00", "12:30", ["D", "E"]),
    slot("advanced.pools.P2.DF", 2, "13:00", "13:30", ["D", "F"]), slot("advanced.pools.P2.EF", 2, "14:00", "14:30", ["E", "F"]),
    slot("advanced.main.final", 3, "14:30", "15:30", ["A", "D"]),
  ]);
  const findings = validateSchedule(spec, graph, schedule);
  assert.deepEqual(findings.filter(({ code }) => code !== "TSV412"), [], "only the unseen-qualifier rule is broken");
  assert.deepEqual(tsv412(findings).map(({ path, evidence }) => ({ path, evidence })), [{
    path: "/schedule/advanced.main.final", evidence: { entrantIds: ["B", "C", "E", "F"], minimumRestMinutes: REST } }]);
});

test("parallel knockout matches fed by one qualification stay legal: a team fills only one slot", () => {
  const spec = withRest();
  const pool = roundRobin("P", ["A", "B", "C", "D"]);
  const semiOne = contest("advanced.main.S1", "advanced.main", "semifinal", "A", "D");
  const semiTwo = contest("advanced.main.S2", "advanced.main", "semifinal", "B", "C");
  const graph = graphOf([...pool, semiOne, semiTwo], [...completion(pool, semiOne.id), ...completion(pool, semiTwo.id)]);
  const poolSlots = poolOfFourSlots(pool);
  const legal = scheduleOf([...poolSlots, slot(semiOne.id, 1, "15:00", "15:30", ["A", "D"]), slot(semiTwo.id, 2, "15:00", "15:30", ["B", "C"])]);
  assert.deepEqual(tsv412(validateSchedule(spec, graph, legal)), [], "the semis may run side by side");

  const tooSoon = scheduleOf([...poolSlots, slot(semiOne.id, 1, "15:00", "15:30", ["A", "D"]), slot(semiTwo.id, 2, "14:30", "15:00", ["B", "C"])]);
  assert.deepEqual(tsv412(validateSchedule(spec, graph, tooSoon)).map(({ path }) => path), ["/schedule/advanced.main.S2"],
    "rest after the last pool match still applies to every possible qualifier");
});

test("qualifying through one stage into the next is not exclusive: rest holds across both stages", () => {
  const spec = withRest();
  const pool = roundRobin("P", ["A", "B", "C", "D"]);
  const second = contest("advanced.consolation.G1", "advanced.consolation", "group", "A", "B");
  const final = contest("advanced.main.final", "advanced.main", "final", "C", "D");
  const graph = graphOf([...pool, second, final], [...completion(pool, second.id), ...completion([second], final.id)]);
  const poolSlots = poolOfFourSlots(pool);
  // The planning simulation named different teams in each stage, so the fixed-membership check sees no shared player.
  const schedule = scheduleOf([...poolSlots, slot(second.id, 1, "15:00", "15:30", ["A", "B"]), slot(final.id, 2, "15:30", "16:30", ["C", "D"])]);
  const findings = validateSchedule(spec, graph, schedule);
  assert.equal(findings.some(({ code }) => code === "TSV406"), false);
  assert.deepEqual(tsv412(findings).map(({ path }) => path), ["/schedule/advanced.main.final"]);
});

test("the list scheduler keeps hard rest for every possible qualifier", () => {
  const spec = withRest();
  const { graph, final } = twoPoolsIntoFinal();
  const schedule = solveSchedule(spec, graph);
  assert.equal(schedule.audit.status, "FEASIBLE");
  assert.deepEqual(validateSchedule(spec, graph, schedule), []);
  const lastPoolEnd = Math.max(...schedule.contests.filter(({ contestId }) => contestId !== final.id).map(({ end }) => Date.parse(end)));
  const finalStart = Date.parse(schedule.contests.find(({ contestId }) => contestId === final.id)!.start);
  assert.ok(finalStart - lastPoolEnd >= REST * 60_000, "the final waits the hard rest after the last feeder, whoever qualifies");
});

test("CP-SAT keeps hard rest for every possible qualifier and its plan passes the verifier", () => {
  const spec = withRest();
  const { graph } = twoPoolsIntoFinal();
  const solved = solveGraphWithCpSat(spec, graph, { maxTimeSeconds: 10 });
  assert.equal(solved.status, "OPTIMAL");
  assert.deepEqual(solved.validationFindings, []);
});
