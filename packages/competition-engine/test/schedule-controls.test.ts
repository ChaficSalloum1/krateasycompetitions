import assert from "node:assert/strict";
import test from "node:test";
import { compileDefinition, type TournamentDefinition, type TournamentSpec } from "@tournament-os/tournament-schema";
import { compileGraphSchedulingProblem, solveGraphWithCpSat } from "../src/scheduling-quality.js";
import { solveSchedule, validateSchedule } from "../src/scheduler.js";
import type { CompetitionGraph, ScheduleSolution } from "../src/types.js";

// Organiser scheduling controls: each court's own opening hours, and protected assignments pinning a
// contest's start, court, or both. Both schedulers honour them and the validator checks them itself.

const at = (minute: number) => new Date(Date.parse("2026-09-06T09:00:00Z") + minute * 60_000).toISOString();
type Constraint = TournamentDefinition["scheduling"]["constraints"][number];
type Resource = TournamentDefinition["resources"][number];

function spec(options: { constraints?: Constraint[]; unitAvailability?: Resource["unitAvailability"]; courts?: number } = {}): TournamentSpec {
  const definition: TournamentDefinition = {
    sport: { id: "test", adapterVersion: "1.0.0", participantUnit: "individual", contest: { kind: "head_to_head", sides: 2 },
      scoringCapabilities: ["win"], defaultResourceType: "court" }, participants: { count: 4, shape: "individual" },
    divisions: [{ id: "open", label: "Open", participantCount: 4, participantShape: "individual", stageIds: ["open.main"] }],
    stages: [{ id: "open.main", label: "Main", divisionId: "open", primitive: "single_elimination", inputShape: "individual",
      outputShape: "individual", expectedEntrants: 4, bracket: { entrantCount: 4, topology: "power_of_two", thirdPlaceMatch: false } }],
    scoringSystems: [{ id: "score", adapterRule: "test", version: "1.0.0", stageIds: ["open.main"] }], standingsPolicies: [],
    qualificationPolicies: [], competitionStructures: [], drawPolicies: [], progressionPolicies: [],
    scheduling: { timezone: "UTC", start: at(0), constraints: options.constraints ?? [],
      durations: [{ stageId: "open.main", contestMinutes: 10, turnaroundMinutes: 0 }], objective: "earliest_finish" },
    resources: [{ id: "courts", type: "court", quantity: options.courts ?? 2, availability: [{ start: at(0), end: at(120) }],
      ...(options.unitAvailability ? { unitAvailability: options.unitAvailability } : {}) }],
    operationalPolicies: [], randomisation: { mode: "none" }, assumptions: [], requirements: [],
  };
  return compileDefinition(definition, { specId: "controls", revision: 1, schemaVersion: "1.0.0", compilerVersion: "1.0.0",
    rulesetVersions: { test: "1.0.0" }, sourcePrompt: "controls", createdAt: "2026-09-06T08:00:00Z" }) as TournamentSpec;
}

const graph = (): CompetitionGraph => ({ specHash: "fixture", nodes: [
  { id: "semi-a", stageId: "open.main", divisionId: "open", round: "semifinal", roundIndex: 1, index: 1, kind: "contest",
    slots: [{ type: "entrant", entrantId: "a" }, { type: "entrant", entrantId: "d" }], requiredResourceType: "court" },
  { id: "semi-b", stageId: "open.main", divisionId: "open", round: "semifinal", roundIndex: 1, index: 2, kind: "contest",
    slots: [{ type: "entrant", entrantId: "b" }, { type: "entrant", entrantId: "c" }], requiredResourceType: "court" },
  { id: "final", stageId: "open.main", divisionId: "open", round: "final", roundIndex: 2, index: 1, kind: "contest",
    slots: [{ type: "winner", contestId: "semi-a" }, { type: "winner", contestId: "semi-b" }], requiredResourceType: "court" },
], edges: [
  { fromContestId: "semi-a", outcome: "winner", toContestId: "final", toSlot: 0 },
  { fromContestId: "semi-b", outcome: "winner", toContestId: "final", toSlot: 1 },
], expectedActualContestCount: 3, generatedActualContestCount: 3, findings: [] });

const protect = (contestId: string, pin: { start?: string; resourceId?: string }): Constraint =>
  ({ id: `protect.${contestId}`, rule: "protected_assignment", strength: "HARD", value: JSON.stringify({ contestId, ...pin }) });

const placed = (solution: ScheduleSolution, contestId: string) => solution.contests.find((entry) => entry.contestId === contestId)!;

const solvers = {
  "CP-SAT": (subject: TournamentSpec) => {
    const solved = solveGraphWithCpSat(subject, graph(), { maxTimeSeconds: 5 });
    assert.ok(solved.solution, `CP-SAT returned ${solved.status}`);
    return solved.solution;
  },
  "list scheduler": (subject: TournamentSpec) => solveSchedule(subject, graph()),
};

for (const [name, solve] of Object.entries(solvers)) {
  test(`${name}: a court with its own opening hours is never used outside them`, () => {
    const subject = spec({ unitAvailability: [{ unit: 2, availability: [{ start: at(30), end: at(120) }] }] });
    const solution = solve(subject);
    assert.deepEqual(validateSchedule(subject, graph(), solution).filter(({ severity }) => severity === "ERROR"), []);
    for (const entry of solution.contests.filter(({ resourceId }) => resourceId === "courts.2"))
      assert.ok(Date.parse(entry.start) >= Date.parse(at(30)), `${entry.contestId} uses court 2 before it opens`);
  });

  test(`${name}: protected starts, courts and both are all held`, () => {
    const subject = spec({ constraints: [protect("semi-a", { resourceId: "courts.2" }), protect("semi-b", { start: at(20) }),
      protect("final", { start: at(60), resourceId: "courts.1" })] });
    const solution = solve(subject);
    assert.deepEqual(validateSchedule(subject, graph(), solution).filter(({ severity }) => severity === "ERROR"), []);
    assert.equal(placed(solution, "semi-a").resourceId, "courts.2");
    assert.equal(placed(solution, "semi-b").start, at(20));
    assert.equal(placed(solution, "final").start, at(60));
    assert.equal(placed(solution, "final").resourceId, "courts.1");
  });
}

test("CP-SAT honours a stage/round's required court instead of leaving it for the validator to reject", () => {
  const subject = spec({ constraints: [{ id: "final.court", rule: "required_resource", strength: "HARD",
    value: JSON.stringify({ stageId: "open.main", round: "final", resourceId: "courts.2" }) }] });
  const problem = compileGraphSchedulingProblem(subject, graph()).problem!;
  assert.deepEqual(problem.tasks.find(({ id }) => id === "final")!.eligibleResourceIds, ["courts.2"]);
  assert.equal(placed(solvers["CP-SAT"](subject), "final").resourceId, "courts.2");
});

test("the validator independently rejects a plan that moves a protected contest", () => {
  const subject = spec({ constraints: [protect("final", { start: at(60), resourceId: "courts.1" })] });
  const solution = solvers["CP-SAT"](subject);
  const moved = { ...solution, contests: solution.contests.map((entry) => entry.contestId === "final"
    ? { ...entry, resourceId: "courts.2" } : entry) };
  assert.ok(validateSchedule(subject, graph(), moved).some(({ code }) => code === "TSV412"), "a protected court that moved is caught");
  const late = { ...solution, contests: solution.contests.map((entry) => entry.contestId === "final"
    ? { ...entry, start: at(70), end: at(80) } : entry) };
  assert.ok(validateSchedule(subject, graph(), late).some(({ code }) => code === "TSV407"), "a protected start that moved is caught");
});

test("a protection for a contest the competition no longer has blocks instead of being dropped", () => {
  const subject = spec({ constraints: [protect("quarter-a", { start: at(0) })] });
  const solution = solveSchedule(spec(), graph());
  assert.ok(validateSchedule(subject, graph(), solution).some(({ code }) => code === "TSV413"));
});

test("malformed protections and court hours outside the venue's are refused", () => {
  const malformed = spec({ constraints: [{ id: "protect.final", rule: "protected_assignment", strength: "SOFT",
    value: JSON.stringify({ contestId: "final", start: at(60) }) }] });
  assert.ok(validateSchedule(malformed, graph(), solveSchedule(spec(), graph())).some(({ code }) => code === "TSV412"));
  const outside = spec({ unitAvailability: [{ unit: 2, availability: [{ start: at(60), end: at(180) }] }] });
  assert.ok(validateSchedule(outside, graph(), solveSchedule(spec(), graph())).some(({ code }) => code === "TSV415"));
  const unknownUnit = spec({ unitAvailability: [{ unit: 3, availability: [{ start: at(0), end: at(60) }] }] });
  assert.ok(validateSchedule(unknownUnit, graph(), solveSchedule(spec(), graph())).some(({ code }) => code === "TSV415"));
});

test("list scheduler: a time-only protection still goes to its round's required court", () => {
  const subject = spec({ constraints: [protect("final", { start: at(60) }), { id: "final.court", rule: "required_resource", strength: "HARD",
    value: JSON.stringify({ stageId: "open.main", round: "final", resourceId: "courts.2" }) }] });
  const solution = solveSchedule(subject, graph());
  assert.deepEqual(validateSchedule(subject, graph(), solution).filter(({ severity }) => severity === "ERROR"), []);
  assert.deepEqual([placed(solution, "final").start, placed(solution, "final").resourceId], [at(60), "courts.2"]);
});

test("list scheduler: a protected start is reserved before earlier contests are placed greedily", () => {
  // One court, two independent semi-finals: protecting the second at the start must not be defeated by
  // the first taking the court then.
  const semis: CompetitionGraph = { ...graph(), nodes: graph().nodes.filter(({ id }) => id !== "final"), edges: [],
    expectedActualContestCount: 2, generatedActualContestCount: 2 };
  const subject = spec({ courts: 1, constraints: [protect("semi-b", { start: at(0) })] });
  const solution = solveSchedule(subject, semis);
  assert.deepEqual(solution.findings.filter(({ severity }) => severity === "ERROR"), []);
  assert.deepEqual(validateSchedule(subject, semis, solution).filter(({ severity }) => severity === "ERROR"), []);
  assert.equal(placed(solution, "semi-b").start, at(0));
  assert.equal(placed(solution, "semi-a").start, at(10));
});
