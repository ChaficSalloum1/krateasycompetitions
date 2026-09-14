import assert from "node:assert/strict";
import test from "node:test";
import { deterministicExactSolver, type SchedulingProblem } from "../src/schedule-solver.js";

const singleResourceProblem = (): SchedulingProblem => ({
  id: "one-court",
  tasks: [
    { id: "A", durationMinutes: 30, eligibleResourceIds: ["court.1"], dependencyIds: [], participantIds: ["p1", "p2"] },
    { id: "B", durationMinutes: 30, eligibleResourceIds: ["court.1"], dependencyIds: [], participantIds: ["p3", "p4"] },
  ],
  resources: [{ id: "court.1", calendars: [{ startMinute: 0, endMinute: 60 }], closures: [] }],
  locks: [],
  minimumRestMinutes: 0,
});

test("exhaustive search reports OPTIMAL with lower-bound and gap evidence", () => {
  const result = deterministicExactSolver.solve(singleResourceProblem(), { maxSearchNodes: 10_000 });

  assert.equal(result.status, "OPTIMAL");
  assert.equal(result.objectiveValueMinutes, 60);
  assert.equal(result.proof.searchExhausted, true);
  assert.equal(result.proof.initialLowerBoundMinutes, 30);
  assert.deepEqual(result.proof.lowerBoundEvidence, [
    { kind: "CRITICAL_PATH", minutes: 30 },
    { kind: "LOCKED_FINISH", minutes: 0 },
  ]);
  assert.equal(result.proof.provenLowerBoundMinutes, 60);
  assert.equal(result.proof.optimalityGap, 0);
  assert.deepEqual(result.assignments.map(({ taskId, resourceId, startMinute, endMinute }) =>
    ({ taskId, resourceId, startMinute, endMinute })), [
    { taskId: "A", resourceId: "court.1", startMinute: 0, endMinute: 30 },
    { taskId: "B", resourceId: "court.1", startMinute: 30, endMinute: 60 },
  ]);
  assert.deepEqual(deterministicExactSolver.solve(singleResourceProblem(), { maxSearchNodes: 10_000 }), result);
});

test("a node-limited incumbent is FEASIBLE and never falsely reported as OPTIMAL", () => {
  const result = deterministicExactSolver.solve(singleResourceProblem(), { maxSearchNodes: 2 });

  assert.equal(result.status, "FEASIBLE");
  assert.equal(result.objectiveValueMinutes, 60);
  assert.equal(result.proof.searchExhausted, false);
  assert.equal(result.proof.termination, "NODE_LIMIT");
  assert.equal(result.proof.provenLowerBoundMinutes, 30);
  assert.equal(result.proof.optimalityGap, 0.5);
  assert.equal(result.proof.optimalityProvenBy, null);
});

test("a bounded search without an incumbent reports UNKNOWN rather than INFEASIBLE", () => {
  const result = deterministicExactSolver.solve(singleResourceProblem(), { maxSearchNodes: 1 });
  assert.equal(result.status, "UNKNOWN");
  assert.deepEqual(result.assignments, []);
  assert.equal(result.objectiveValueMinutes, null);
  assert.equal(result.proof.searchExhausted, false);
  assert.equal(result.proof.optimalityGap, null);
});

test("exhausted contradictory locks prove INFEASIBLE", () => {
  const problem = singleResourceProblem();
  const result = deterministicExactSolver.solve({
    ...problem,
    locks: [
      { taskId: "A", resourceId: "court.1", startMinute: 0 },
      { taskId: "B", resourceId: "court.1", startMinute: 0 },
    ],
  }, { maxSearchNodes: 100 });

  assert.equal(result.status, "INFEASIBLE");
  assert.equal(result.proof.searchExhausted, true);
  assert.equal(result.proof.termination, "EXHAUSTED");
  assert.deepEqual(result.assignments, []);
});

test("honours locks, resource closures, dependencies, and participant rest", () => {
  const result = deterministicExactSolver.solve({
    id: "operational-constraints",
    tasks: [
      { id: "A", durationMinutes: 20, eligibleResourceIds: ["court.1"], dependencyIds: [], participantIds: ["p1"] },
      { id: "B", durationMinutes: 20, eligibleResourceIds: ["court.1"], dependencyIds: ["A"], participantIds: ["p1"] },
    ],
    resources: [{
      id: "court.1",
      calendars: [{ startMinute: 0, endMinute: 120 }],
      closures: [{ startMinute: 20, endMinute: 40 }],
    }],
    locks: [{ taskId: "A", resourceId: "court.1", startMinute: 0 }],
    minimumRestMinutes: 10,
  }, { maxSearchNodes: 1_000 });

  assert.equal(result.status, "OPTIMAL");
  assert.deepEqual(result.assignments.map(({ taskId, startMinute, endMinute, locked }) =>
    ({ taskId, startMinute, endMinute, locked })), [
    { taskId: "A", startMinute: 0, endMinute: 20, locked: true },
    { taskId: "B", startMinute: 40, endMinute: 60, locked: false },
  ]);
  assert.deepEqual(result.proof.validationErrors, []);
  assert.match(result.proof.proofHash, /^[a-f0-9]{64}$/);
  assert.ok(Object.isFrozen(result));
});
