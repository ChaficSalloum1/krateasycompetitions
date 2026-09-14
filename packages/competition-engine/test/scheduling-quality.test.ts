import assert from "node:assert/strict";
import test from "node:test";
import { compileDefinition, type TournamentDefinition, type TournamentSpec } from "@tournament-os/tournament-schema";
import {
  auditScheduleQuality,
  compareScheduleQuality,
  compileGraphSchedulingProblem,
  planScheduleQualityRepair,
  solveGraphWithCpSat,
} from "../src/scheduling-quality.js";
import type { CompetitionGraph, ContestNode, ScheduleSolution } from "../src/types.js";

function spec(availability = [{ start: "2026-09-06T09:00:00Z", end: "2026-09-06T11:00:00Z" }]): TournamentSpec {
  const definition: TournamentDefinition = {
    sport: { id: "test", adapterVersion: "1.0.0", participantUnit: "individual", contest: { kind: "head_to_head", sides: 2 },
      scoringCapabilities: ["win"], defaultResourceType: "court" }, participants: { count: 4, shape: "individual" },
    divisions: [{ id: "open", label: "Open", participantCount: 4, participantShape: "individual", stageIds: ["open.main"] }],
    stages: [{ id: "open.main", label: "Main", divisionId: "open", primitive: "single_elimination", inputShape: "individual",
      outputShape: "individual", expectedEntrants: 4, bracket: { entrantCount: 4, topology: "power_of_two", thirdPlaceMatch: false } }],
    scoringSystems: [{ id: "score", adapterRule: "test", version: "1.0.0", stageIds: ["open.main"] }], standingsPolicies: [],
    qualificationPolicies: [], competitionStructures: [], drawPolicies: [], progressionPolicies: [],
    scheduling: { timezone: "UTC", start: "2026-09-06T09:00:00Z", constraints: [],
      durations: [{ stageId: "open.main", contestMinutes: 10, turnaroundMinutes: 0 }], objective: "earliest_finish" },
    resources: [{ id: "courts", type: "court", quantity: 2, availability }], operationalPolicies: [], randomisation: { mode: "none" },
    assumptions: [], requirements: [
      { id: "R2", sourceText: "Use the declared courts from the opening time", type: "resources", strength: "HARD", status: "SATISFIED", mappedRuleIds: ["rule.resources"] },
      { id: "R12", sourceText: "Pack tightly with sensible player rest", type: "schedule_quality", strength: "SOFT", status: "SATISFIED", mappedRuleIds: ["rule.quality"] },
      { id: "R13", sourceText: "Finish as early as possible", type: "schedule_objective", strength: "SOFT", status: "SATISFIED", mappedRuleIds: ["rule.objective"] },
    ],
  };
  definition.assumptions = [
    { id: "rule.resources", rulePath: "/resources", origin: "explicit_prompt", knowledge: "KNOWN", sourceReference: "test", approved: true, critical: false },
    { id: "rule.quality", rulePath: "/scheduling", origin: "explicit_prompt", knowledge: "KNOWN", sourceReference: "test", approved: true, critical: false },
    { id: "rule.objective", rulePath: "/scheduling/objective", origin: "explicit_prompt", knowledge: "KNOWN", sourceReference: "test", approved: true, critical: false },
  ];
  return compileDefinition(definition, { specId: "quality", revision: 1, schemaVersion: "1.0.0", compilerVersion: "1.0.0",
    rulesetVersions: { test: "1.0.0" }, sourcePrompt: "quality", createdAt: "2026-09-06T08:00:00Z" }) as TournamentSpec;
}

function nodes(): ContestNode[] {
  return [
    { id: "semi-a", stageId: "open.main", divisionId: "open", round: "semifinal", roundIndex: 1, index: 1, kind: "contest",
      slots: [{ type: "entrant", entrantId: "a" }, { type: "entrant", entrantId: "d" }], requiredResourceType: "court" },
    { id: "semi-b", stageId: "open.main", divisionId: "open", round: "semifinal", roundIndex: 1, index: 2, kind: "contest",
      slots: [{ type: "entrant", entrantId: "b" }, { type: "entrant", entrantId: "c" }], requiredResourceType: "court" },
    { id: "final", stageId: "open.main", divisionId: "open", round: "final", roundIndex: 2, index: 1, kind: "contest",
      slots: [{ type: "winner", contestId: "semi-a" }, { type: "winner", contestId: "semi-b" }], requiredResourceType: "court" },
  ];
}

function graph(): CompetitionGraph {
  return { specHash: "fixture", nodes: nodes(), edges: [
    { fromContestId: "semi-a", outcome: "winner", toContestId: "final", toSlot: 0 },
    { fromContestId: "semi-b", outcome: "winner", toContestId: "final", toSlot: 1 },
  ], expectedActualContestCount: 3, generatedActualContestCount: 3, findings: [] };
}

function entry(contestId: string, resourceId: string, startMinute: number, participantIds: string[]) {
  const start = Date.parse("2026-09-06T09:00:00Z") + startMinute * 60_000;
  return { contestId, resourceId, start: new Date(start).toISOString(), end: new Date(start + 10 * 60_000).toISOString(), possibleEntrantIds: participantIds };
}

function delayedSchedule(): ScheduleSolution {
  return { contests: [
    entry("semi-a", "courts.1", 0, ["a", "d"]), entry("semi-b", "courts.1", 10, ["b", "c"]),
    entry("final", "courts.1", 20, ["a", "b", "c", "d"]),
  ], audit: { solver: "fixture", version: "1", status: "FEASIBLE", objective: "earliest_finish", lowerBoundMinutes: 20 }, findings: [] };
}

test("branch-level release proves genuinely free court time is avoidable and solver repair improves it safely", () => {
  const tournament = spec(); const competition = graph(); const baseline = delayedSchedule();
  const audit = auditScheduleQuality(tournament, competition, baseline);
  const free = audit.intervals.find(({ resourceId, start, classification }) => resourceId === "courts.2" &&
    start === "2026-09-06T09:00:00.000Z" && classification === "GENUINELY_FREE");
  assert.deepEqual(free?.readyContestIds, ["semi-b"]);
  assert.equal(free?.avoidable, true);
  assert.ok(audit.metrics.avoidableIdleMinutes >= 10);
  assert.equal(audit.metrics.headlineFinalIsClimax, true);
  assert.deepEqual(audit.requirementCoverage.map(({ requirementId }) => requirementId), ["R2", "R12", "R13"]);

  const repair = planScheduleQualityRepair(tournament, competition, baseline, { maxTimeSeconds: 5 });
  assert.equal(repair.status, "IMPROVED", repair.reason);
  assert.ok(repair.cpSatStatus === "OPTIMAL" || repair.cpSatStatus === "FEASIBLE");
  assert.equal(repair.candidate?.status, "CERTIFIED");
  assert.equal(repair.solution?.findings.length, 0);
  assert.equal(compareScheduleQuality(repair.candidate!, repair.baseline), -1);
  assert.ok(repair.candidate!.metrics.makespanMinutes < audit.metrics.makespanMinutes);
});

test("a narrow bracket proves idle is dependency blocked until its single branch releases", () => {
  const tournament = spec();
  const competition: CompetitionGraph = { ...graph(), nodes: [nodes()[0]!, { ...nodes()[2]!,
    slots: [{ type: "winner", contestId: "semi-a" }, { type: "entrant", entrantId: "b" }] }],
    edges: [{ fromContestId: "semi-a", outcome: "winner", toContestId: "final", toSlot: 0 }],
    expectedActualContestCount: 2, generatedActualContestCount: 2 };
  const schedule: ScheduleSolution = { ...delayedSchedule(), contests: [entry("semi-a", "courts.1", 0, ["a", "d"]),
    entry("final", "courts.1", 10, ["a", "b", "d"])] };
  const audit = auditScheduleQuality(tournament, competition, schedule);
  const blocked = audit.intervals.find(({ resourceId, start }) => resourceId === "courts.2" && start === "2026-09-06T09:00:00.000Z");
  assert.equal(blocked?.classification, "DEPENDENCY_BLOCKED");
  assert.equal(blocked?.avoidable, false);
  assert.ok(blocked?.blockingReasons.includes("final:dependency"));
});

test("resource closures are neither counted as idle nor offered as repair capacity", () => {
  const tournament = spec([
    { start: "2026-09-06T09:00:00Z", end: "2026-09-06T09:10:00Z" },
    { start: "2026-09-06T09:20:00Z", end: "2026-09-06T11:00:00Z" },
  ]);
  const competition = graph();
  const schedule: ScheduleSolution = { ...delayedSchedule(), contests: [entry("semi-a", "courts.1", 0, ["a", "d"]),
    entry("semi-b", "courts.2", 0, ["b", "c"]), entry("final", "courts.1", 20, ["a", "b", "c", "d"])] };
  const audit = auditScheduleQuality(tournament, competition, schedule);
  const closed = audit.intervals.filter(({ classification }) => classification === "CLOSED");
  assert.equal(closed.length, 2);
  assert.ok(closed.every(({ avoidable }) => !avoidable));
  assert.ok(!closed.some(({ durationMinutes }) => audit.metrics.avoidableIdleMinutes === durationMinutes));
  const compiled = compileGraphSchedulingProblem(tournament, competition);
  assert.equal(compiled.status, "COMPILED");
  assert.deepEqual(compiled.problem?.resources[0]?.calendars, [{ startMinute: 0, endMinute: 10 }, { startMinute: 20, endMinute: 120 }]);
});

test("extended matches are isolated from planned occupancy and expose downstream disruption", () => {
  const audit = auditScheduleQuality(spec(), graph(), delayedSchedule(), [{ contestId: "semi-a", actualEnd: "2026-09-06T09:15:00Z" }]);
  assert.equal(audit.status, "DISRUPTED");
  assert.ok(audit.intervals.some(({ resourceId, start, end, classification, contestId }) => resourceId === "courts.1" &&
    start === "2026-09-06T09:10:00.000Z" && end === "2026-09-06T09:15:00.000Z" && classification === "EXTENDED" && contestId === "semi-a"));
  assert.ok(audit.findings.some(({ code }) => code === "TSQ002"));
});

test("graph adapter and CP-SAT ScheduleSolution conversion preserve proof status and replay deterministically", () => {
  const tournament = spec(); const competition = graph();
  const compiled = compileGraphSchedulingProblem(tournament, competition);
  assert.equal(compiled.status, "COMPILED");
  assert.equal(compiled.problem?.tasks.length, 3);
  assert.deepEqual(compiled.problem?.tasks.find(({ id }) => id === "final")?.dependencyIds, ["semi-a", "semi-b"]);
  const first = solveGraphWithCpSat(tournament, competition, { maxTimeSeconds: 5 });
  const replay = solveGraphWithCpSat(tournament, competition, { maxTimeSeconds: 5 });
  assert.ok(first.status === "OPTIMAL" || first.status === "FEASIBLE");
  assert.equal(first.status, first.cpSat?.proof.backendStatus);
  assert.equal(first.validationFindings.length, 0);
  assert.deepEqual(replay, first);
  assert.match(first.proofHash, /^[a-f0-9]{64}$/);

  const unknown = solveGraphWithCpSat(tournament, competition, { maxTimeSeconds: 1, pythonExecutable: "/definitely/missing/python" });
  assert.equal(unknown.status, "UNKNOWN");
  assert.equal(unknown.solution, null);
});
