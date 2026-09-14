import assert from "node:assert/strict";
import test from "node:test";
import {
  compareScheduleRepairObjectives,
  planMinimalChangeScheduleRepair,
  reconstructScheduleRepairObjective,
  SCHEDULE_REPAIR_OBJECTIVE_ORDER,
  type SchedulingProblem,
  type SolverAssignment,
} from "../src/index.js";

const problem = (): SchedulingProblem => ({
  id: "live-repair",
  tasks: [
    { id: "A", durationMinutes: 20, eligibleResourceIds: ["court.1", "court.2"], dependencyIds: [], participantIds: ["p1", "p2"] },
    { id: "B", durationMinutes: 20, eligibleResourceIds: ["court.1", "court.2"], dependencyIds: [], participantIds: ["p3", "p4"] },
    { id: "C", durationMinutes: 20, eligibleResourceIds: ["court.1", "court.2"], dependencyIds: ["A"], participantIds: ["p1", "p5"] },
  ],
  resources: [
    { id: "court.1", calendars: [{ startMinute: 0, endMinute: 100 }], closures: [{ startMinute: 20, endMinute: 40 }] },
    { id: "court.2", calendars: [{ startMinute: 0, endMinute: 100 }], closures: [] },
  ],
  locks: [],
  minimumRestMinutes: 0,
});

const baseline = (): SolverAssignment[] => [
  { taskId: "A", resourceId: "court.1", startMinute: 0, endMinute: 20, locked: false },
  { taskId: "B", resourceId: "court.1", startMinute: 20, endMinute: 40, locked: false },
  { taskId: "C", resourceId: "court.1", startMinute: 40, endMinute: 60, locked: false },
];

test("repairs a resource closure by moving the fewest contests and explains the change", () => {
  const result = planMinimalChangeScheduleRepair({ problem: problem(), baseline: baseline() }, { maxSearchNodes: 100_000 });

  assert.equal(result.status, "REPAIRED");
  assert.deepEqual(result.objective?.vector.slice(0, 2), [1, 2]);
  assert.deepEqual(result.diff.map(({ taskId }) => taskId), ["B"]);
  assert.deepEqual(result.affectedParticipantIds, ["p3", "p4"]);
  assert.ok(result.whyNot.some(({ taskId, code }) => taskId === "B" && code === "BASELINE_RESOURCE_CLOSED"));
  assert.equal(result.proof.optimalityProven, true);
  assert.deepEqual(result.proof.validationErrors, []);
  assert.match(result.proof.proofHash, /^[a-f0-9]{64}$/);
  const reconstructed = reconstructScheduleRepairObjective(problem(), baseline(), result.assignments!);
  assert.deepEqual(result.objective, reconstructed);
  assert.equal(compareScheduleRepairObjectives(result.objective!, reconstructed), 0);
});

test("freeze horizons and pins preserve exact announced assignments before optimizing the remainder", () => {
  const source = problem();
  const disrupted: SchedulingProblem = { ...source, resources: source.resources.map((resource) => ({ ...resource, closures: [] })) };
  const original = baseline();
  const result = planMinimalChangeScheduleRepair({
    problem: disrupted,
    baseline: original,
    freezeThroughMinute: 20,
    pinnedTaskIds: ["C"],
  }, { maxSearchNodes: 100_000 });

  assert.equal(result.status, "UNCHANGED");
  assert.deepEqual(result.assignments?.map(({ taskId, resourceId, startMinute, endMinute }) => ({ taskId, resourceId, startMinute, endMinute })),
    original.map(({ taskId, resourceId, startMinute, endMinute }) => ({ taskId, resourceId, startMinute, endMinute })));
  assert.equal(result.assignments?.find(({ taskId }) => taskId === "A")?.locked, true);
  assert.equal(result.assignments?.find(({ taskId }) => taskId === "C")?.locked, true);
  assert.deepEqual(result.proof.effectiveLockTaskIds, ["A", "C"]);
  assert.equal(result.objective?.movedContests, 0);
  assert.deepEqual(result.diff, []);
});

test("fails closed when a pinned contest conflicts with the disruption", () => {
  const result = planMinimalChangeScheduleRepair({
    problem: problem(),
    baseline: baseline(),
    pinnedTaskIds: ["B"],
  }, { maxSearchNodes: 100_000 });

  assert.equal(result.status, "INFEASIBLE");
  assert.equal(result.assignments, null);
  assert.equal(result.objective, null);
  assert.deepEqual(result.diff, []);
  assert.ok(result.whyNot.some(({ code }) => code === "PIN_CONFLICT"));
  assert.ok(result.proof.baselineHardViolations.includes("B:RESOURCE_UNAVAILABLE_OR_CLOSED"));
  assert.equal(result.proof.optimalityProven, true);
});

test("fails closed instead of overriding either an original hard lock or a new pin", () => {
  const source = problem();
  const conflicting: SchedulingProblem = {
    ...source,
    resources: source.resources.map((resource) => ({ ...resource, closures: [] })),
    locks: [{ taskId: "A", resourceId: "court.1", startMinute: 10 }],
  };
  const result = planMinimalChangeScheduleRepair({
    problem: conflicting,
    baseline: baseline(),
    pinnedTaskIds: ["A"],
  }, { maxSearchNodes: 100_000 });

  assert.equal(result.status, "INFEASIBLE");
  assert.equal(result.assignments, null);
  assert.ok(result.whyNot.some(({ taskId, code }) => taskId === "A" && code === "PIN_CONFLICT"));
});

test("reconstructs the published lexicographic objective independently of assignment order", () => {
  const source = problem();
  const original = baseline();
  const candidate: SolverAssignment[] = [
    original[2]!,
    { ...original[1]!, resourceId: "court.2" },
    original[0]!,
  ];

  const objective = reconstructScheduleRepairObjective(source, [...original].reverse(), candidate);

  assert.deepEqual(SCHEDULE_REPAIR_OBJECTIVE_ORDER, [
    "MOVED_CONTESTS", "AFFECTED_PARTICIPANTS", "TOTAL_START_DISPLACEMENT_MINUTES", "RESOURCE_CHANGES",
    "MAKESPAN_MINUTES", "PARTICIPANT_WAIT_MINUTES", "RESOURCE_IDLE_MINUTES",
  ]);
  assert.deepEqual(objective.vector, [1, 2, 0, 1, 60, 20, 20]);
  assert.ok(Object.isFrozen(objective));
});

test("never releases an incumbent when the search limit prevents a minimality proof", () => {
  const result = planMinimalChangeScheduleRepair({ problem: problem(), baseline: baseline() }, { maxSearchNodes: 1 });

  assert.equal(result.status, "UNKNOWN");
  assert.equal(result.assignments, null);
  assert.equal(result.objective, null);
  assert.equal(result.proof.searchExhausted, false);
  assert.equal(result.proof.optimalityProven, false);
  assert.deepEqual(result.whyNot.map(({ code }) => code), ["SEARCH_LIMIT"]);
});

test("replays deterministically and rejects incomplete baselines without searching", () => {
  const request = { problem: problem(), baseline: baseline() };
  const first = planMinimalChangeScheduleRepair(request, { maxSearchNodes: 100_000 });
  const replay = planMinimalChangeScheduleRepair(request, { maxSearchNodes: 100_000 });
  assert.deepEqual(replay, first);
  assert.ok(Object.isFrozen(first));

  const rejected = planMinimalChangeScheduleRepair({ ...request, baseline: baseline().slice(0, 2) }, { maxSearchNodes: 100_000 });
  assert.equal(rejected.status, "REJECTED");
  assert.equal(rejected.assignments, null);
  assert.equal(rejected.proof.nodesVisited, 0);
  assert.ok(rejected.proof.validationErrors.includes("Baseline must assign every task exactly once."));
});

test("rejects malformed resource calendars before attempting a repair", () => {
  const source = problem();
  const malformed: SchedulingProblem = { ...source, resources: [
    { ...source.resources[0]!, calendars: [{ startMinute: 10, endMinute: 10 }] },
    source.resources[1]!,
  ] };
  const result = planMinimalChangeScheduleRepair({ problem: malformed, baseline: baseline() }, { maxSearchNodes: 100_000 });

  assert.equal(result.status, "REJECTED");
  assert.equal(result.proof.nodesVisited, 0);
  assert.ok(result.proof.validationErrors.some((message) => message.includes("calendar")));
});
