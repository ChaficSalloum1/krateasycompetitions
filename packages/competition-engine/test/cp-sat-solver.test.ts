import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createCpSatSolver, probeCpSatSolver } from "../src/cp-sat-solver.js";
import { deterministicExactSolver, type SchedulingProblem } from "../src/schedule-solver.js";

const twoTaskProblem = (): SchedulingProblem => ({
  id: "two-task",
  tasks: [
    { id: "A", durationMinutes: 30, eligibleResourceIds: ["court.1"], dependencyIds: [], participantIds: ["p1"] },
    { id: "B", durationMinutes: 30, eligibleResourceIds: ["court.1"], dependencyIds: [], participantIds: ["p2"] },
  ],
  resources: [{ id: "court.1", calendars: [{ startMinute: 0, endMinute: 60 }], closures: [] }],
  locks: [],
  minimumRestMinutes: 0,
});

test("an unavailable CP-SAT runtime fails closed as UNKNOWN rather than infeasible", () => {
  const solver = createCpSatSolver({ pythonExecutable: "/definitely/missing/python" });
  const result = solver.solve(twoTaskProblem(), { maxTimeSeconds: 1 });

  assert.equal(result.status, "UNKNOWN");
  assert.equal(result.proof.backendAvailable, false);
  assert.equal(result.proof.backendStatus, "UNAVAILABLE");
  assert.deepEqual(result.assignments, []);
  assert.equal(result.objective.valueMinutes, null);
  assert.match(result.proof.findings[0] ?? "", /CPS001/);
  assert.match(result.proof.proofHash, /^[a-f0-9]{64}$/);
  assert.ok(Object.isFrozen(result));
});

test("CP-SAT matches the exact solver objective and returns independently certified no-overlap evidence", () => {
  const problem = twoTaskProblem();
  const exact = deterministicExactSolver.solve(problem, { maxSearchNodes: 10_000 });
  const solver = createCpSatSolver();
  const result = solver.solve(problem, { maxTimeSeconds: 5 });

  assert.equal(exact.status, "OPTIMAL");
  assert.equal(result.status, "CERTIFIED");
  assert.equal(result.objective.valueMinutes, exact.objectiveValueMinutes);
  assert.equal(result.objective.bestBoundMinutes, exact.objectiveValueMinutes);
  assert.equal(result.objective.absoluteGapMinutes, 0);
  assert.equal(result.objective.relativeGap, 0);
  assert.equal(result.objective.optimal, true);
  assert.equal(result.proof.backendStatus, "OPTIMAL");
  assert.equal(result.proof.backendVersion, "9.15.6755");
  assert.deepEqual(result.proof.validationErrors, []);
  assert.deepEqual(solver.solve(problem, { maxTimeSeconds: 5 }), result);
});

test("CP-SAT and the exact solver agree with precedence, calendars, closures, locks, and participant rest", () => {
  const problem: SchedulingProblem = {
    id: "operational-differential",
    tasks: [
      { id: "A", durationMinutes: 20, eligibleResourceIds: ["court.1"], dependencyIds: [], participantIds: ["p1"] },
      { id: "B", durationMinutes: 20, eligibleResourceIds: ["court.2"], dependencyIds: ["A"], participantIds: ["p2"] },
      { id: "C", durationMinutes: 20, eligibleResourceIds: ["court.1", "court.2"], dependencyIds: [], participantIds: ["p1"] },
    ],
    resources: [
      { id: "court.1", calendars: [{ startMinute: 0, endMinute: 90 }], closures: [{ startMinute: 20, endMinute: 30 }] },
      { id: "court.2", calendars: [{ startMinute: 0, endMinute: 90 }], closures: [] },
    ],
    locks: [{ taskId: "A", resourceId: "court.1", startMinute: 0 }],
    minimumRestMinutes: 10,
  };
  const exact = deterministicExactSolver.solve(problem, { maxSearchNodes: 100_000 });
  const result = createCpSatSolver().solve(problem, { maxTimeSeconds: 5 });

  assert.equal(exact.status, "OPTIMAL");
  assert.equal(result.status, "CERTIFIED");
  assert.equal(result.objective.valueMinutes, exact.objectiveValueMinutes);
  assert.equal(result.objective.valueMinutes, 50);
  assert.deepEqual(result.proof.validationErrors, []);
  const assignments = new Map(result.assignments.map((assignment) => [assignment.taskId, assignment]));
  assert.ok(assignments.get("B")!.startMinute >= assignments.get("A")!.endMinute);
  assert.ok(assignments.get("C")!.startMinute >= assignments.get("A")!.endMinute + 10);
});

test("only an exhausted CP-SAT proof becomes INFEASIBLE; bounded or version-drift runs stay UNKNOWN", () => {
  const base = twoTaskProblem();
  const impossible: SchedulingProblem = {
    ...base,
    locks: [
      { taskId: "A", resourceId: "court.1", startMinute: 0 },
      { taskId: "B", resourceId: "court.1", startMinute: 0 },
    ],
  };
  const exact = deterministicExactSolver.solve(impossible, { maxSearchNodes: 1_000 });
  const infeasible = createCpSatSolver().solve(impossible, { maxTimeSeconds: 5 });
  assert.equal(exact.status, "INFEASIBLE");
  assert.equal(infeasible.status, "INFEASIBLE");
  assert.equal(infeasible.proof.backendStatus, "INFEASIBLE");
  assert.deepEqual(infeasible.assignments, []);
  assert.equal(infeasible.objective.valueMinutes, null);

  // The budget is deterministic work, so a trivial model can finish in presolve; bound a real
  // combinatorial model instead: 60 contests, 4 interchangeable courts, shared players, rest.
  const combinatorial: SchedulingProblem = {
    id: "bounded-combinatorial",
    tasks: Array.from({ length: 60 }, (_, index) => ({ id: `task.${String(index).padStart(2, "0")}`,
      durationMinutes: 20 + (index * 7) % 25, eligibleResourceIds: ["court.1", "court.2", "court.3", "court.4"],
      dependencyIds: [], participantIds: [`p${index % 13}`, `p${(index * 5 + 3) % 13}`] })),
    resources: ["court.1", "court.2", "court.3", "court.4"].map((id) => ({ id,
      calendars: [{ startMinute: 0, endMinute: 1_440 }], closures: [] })),
    locks: [],
    minimumRestMinutes: 10,
  };
  const bounded = createCpSatSolver().solve(combinatorial, { maxTimeSeconds: 0.000001 });
  assert.equal(bounded.status, "UNKNOWN");
  assert.notEqual(bounded.proof.backendStatus, "INFEASIBLE");

  const drift = createCpSatSolver({ requiredBackendVersion: "0.0.0" }).solve(base, { maxTimeSeconds: 1 });
  assert.equal(drift.status, "UNKNOWN");
  assert.equal(drift.proof.backendAvailable, true);
  assert.equal(drift.proof.backendVersion, "9.15.6755");
  assert.match(drift.proof.findings[0] ?? "", /CPS003/);
});

test("the published tested scale envelope is backed by an executed 128-task deterministic fixture", () => {
  const tasks = Array.from({ length: 128 }, (_, index) => ({
    id: `task.${String(index).padStart(3, "0")}`,
    durationMinutes: 10,
    eligibleResourceIds: [`resource.${index % 8}`],
    dependencyIds: index === 0 ? [] : [`task.${String(index - 1).padStart(3, "0")}`],
    participantIds: [`participant.${index}`],
  }));
  const problem: SchedulingProblem = {
    id: "executed-scale-envelope",
    tasks,
    resources: Array.from({ length: 8 }, (_, index) => ({
      id: `resource.${index}`,
      calendars: [{ startMinute: 0, endMinute: 1_440 }],
      closures: [],
    })),
    locks: [],
    minimumRestMinutes: 0,
  };
  const result = createCpSatSolver().solve(problem, { maxTimeSeconds: 10 });

  assert.equal(result.status, "CERTIFIED");
  assert.equal(result.objective.valueMinutes, 1_280);
  assert.equal(result.assignments.length, 128);
  assert.deepEqual(result.proof.testedScaleEnvelope.largestExecutedFixture, {
    tasks: 128, resources: 8, horizonMinutes: 1_440, precedenceEdges: 127,
  });
  assert.equal(result.proof.testedScaleEnvelope.qualification, "TESTED_REFERENCE_ENVELOPE_NOT_A_CAPACITY_GUARANTEE");
});

test("an invalid cyclic model is UNKNOWN and can never masquerade as proven infeasible", () => {
  const problem: SchedulingProblem = {
    ...twoTaskProblem(),
    id: "cycle",
    tasks: [
      { id: "A", durationMinutes: 30, eligibleResourceIds: ["court.1"], dependencyIds: ["B"], participantIds: [] },
      { id: "B", durationMinutes: 30, eligibleResourceIds: ["court.1"], dependencyIds: ["A"], participantIds: [] },
    ],
  };
  const result = createCpSatSolver().solve(problem, { maxTimeSeconds: 1 });
  assert.equal(result.status, "UNKNOWN");
  assert.equal(result.proof.backendStatus, "MODEL_INVALID");
  assert.match(result.proof.findings[0] ?? "", /CPS007/);
});

test("a worker claim is never certified until the TypeScript boundary independently validates it", () => {
  const workerPath = fileURLToPath(new URL("./fixtures/cp_sat_invalid_worker.mjs", import.meta.url));
  const result = createCpSatSolver({ pythonExecutable: process.execPath, workerPath }).solve(twoTaskProblem(), { maxTimeSeconds: 1 });

  assert.equal(result.status, "UNKNOWN");
  assert.equal(result.proof.backendStatus, "OPTIMAL");
  assert.deepEqual(result.assignments, []);
  assert.ok(result.proof.validationErrors.some((message) => message.includes("Resource collision")));
  assert.match(result.proof.findings[0] ?? "", /CPS006/);
});

test("the CP-SAT readiness probe is healthy only when the pinned backend solves its known model", () => {
  const observedAt = "2026-09-23T12:00:00.000Z";
  const healthy = probeCpSatSolver(observedAt);
  assert.deepEqual({ name: healthy.name, required: healthy.required, status: healthy.status },
    { name: "cp-sat-solver", required: true, status: "HEALTHY" });
  assert.match(healthy.detail, /OR-Tools 9\.15\.6755/);

  const missing = probeCpSatSolver(observedAt, createCpSatSolver({ pythonExecutable: "/definitely/missing/python" }));
  assert.equal(missing.status, "UNHEALTHY");
  assert.match(missing.detail, /CPS001/);

  const drifted = probeCpSatSolver(observedAt, createCpSatSolver({ requiredBackendVersion: "0.0.0" }));
  assert.equal(drifted.status, "UNHEALTHY");
  assert.match(drifted.detail, /CPS003/);
});

test("the worker never publishes a feasible answer that the wall-time safety cap cut short", () => {
  const workerDirectory = fileURLToPath(new URL("../solver/", import.meta.url));
  const script = [
    "import json, sys",
    "sys.path.insert(0, sys.argv[1])",
    "import cp_sat_worker as w",
    "budget, cap = w.search_limits(30)",
    "print(json.dumps({'budget': budget, 'cap': cap,",
    "  'capped': w.reproducible_status('FEASIBLE', cap, cap),",
    "  'deterministic': w.reproducible_status('FEASIBLE', budget, cap),",
    "  'optimal': w.reproducible_status('OPTIMAL', cap, cap),",
    "  'infeasible': w.reproducible_status('INFEASIBLE', cap, cap)}))",
  ].join("\n");
  const run = spawnSync(process.env.TOURNAMENT_OS_CP_SAT_PYTHON ?? "python3", ["-c", script, workerDirectory], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(JSON.parse(run.stdout), { budget: 30, cap: 65, capped: "UNKNOWN", deterministic: "FEASIBLE",
    optimal: "OPTIMAL", infeasible: "INFEASIBLE" });
});
