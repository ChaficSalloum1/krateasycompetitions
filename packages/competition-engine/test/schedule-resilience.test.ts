import assert from "node:assert/strict";
import test from "node:test";
import {
  rankSchedulesByResilience,
  type SchedulingProblem,
  type SolverAssignment,
} from "../src/index.js";

const problem: SchedulingProblem = {
  id: "resilience-ranking",
  minimumRestMinutes: 0,
  locks: [],
  tasks: [
    { id: "A", durationMinutes: 20, eligibleResourceIds: ["court.1", "court.2"], dependencyIds: [], participantIds: ["p1", "p2"] },
    { id: "B", durationMinutes: 20, eligibleResourceIds: ["court.1", "court.2"], dependencyIds: [], participantIds: ["p3", "p4"] },
    { id: "C", durationMinutes: 20, eligibleResourceIds: ["court.1", "court.2"], dependencyIds: [], participantIds: ["p5", "p6"] },
  ],
  resources: [
    { id: "court.1", calendars: [{ startMinute: 0, endMinute: 90 }], closures: [] },
    { id: "court.2", calendars: [{ startMinute: 0, endMinute: 90 }], closures: [] },
  ],
};

const brittle: SolverAssignment[] = [
  { taskId: "A", resourceId: "court.1", startMinute: 0, endMinute: 20, locked: false },
  { taskId: "B", resourceId: "court.1", startMinute: 20, endMinute: 40, locked: false },
  { taskId: "C", resourceId: "court.1", startMinute: 40, endMinute: 60, locked: false },
];

const resilient: SolverAssignment[] = [
  { taskId: "A", resourceId: "court.1", startMinute: 0, endMinute: 20, locked: false },
  { taskId: "B", resourceId: "court.2", startMinute: 0, endMinute: 20, locked: false },
  { taskId: "C", resourceId: "court.1", startMinute: 30, endMinute: 50, locked: false },
];

test("resilience ranking prefers the valid schedule with lower court-loss and overrun blast radius", () => {
  const ranking = rankSchedulesByResilience(problem, [
    { candidateId: "brittle", assignments: brittle },
    { candidateId: "resilient", assignments: resilient },
  ], { overrunMinutes: [10, 20, 30] });

  assert.equal(ranking.status, "RANKED");
  assert.deepEqual(ranking.candidates.map(({ candidateId }) => candidateId), ["resilient", "brittle"]);
  assert.equal(ranking.candidates[0]?.evidence.resourceLoss.worstContestsAffected, 2);
  assert.equal(ranking.candidates[1]?.evidence.resourceLoss.worstContestsAffected, 3);
  assert.ok((ranking.candidates[0]?.evidence.overrun.totalConflictCount ?? Infinity)
    < (ranking.candidates[1]?.evidence.overrun.totalConflictCount ?? 0));
  assert.match(ranking.proofHash, /^[a-f0-9]{64}$/);
});

test("resilience can never make an invalid schedule outrank a valid candidate", () => {
  const colliding = brittle.map((assignment) => ({ ...assignment, startMinute: 0, endMinute: 20 }));
  const ranking = rankSchedulesByResilience(problem, [
    { candidateId: "invalid-but-short", assignments: colliding },
    { candidateId: "valid", assignments: brittle },
  ], { overrunMinutes: [10] });

  assert.deepEqual(ranking.candidates.map(({ candidateId }) => candidateId), ["valid"]);
  assert.equal(ranking.rejectedCandidates[0]?.candidateId, "invalid-but-short");
  assert.ok(ranking.rejectedCandidates[0]?.findings.some((finding) => finding.includes("overlap")));
});

test("candidate and assignment input ordering cannot change resilience evidence", () => {
  const forward = rankSchedulesByResilience(problem, [
    { candidateId: "brittle", assignments: brittle }, { candidateId: "resilient", assignments: resilient },
  ], { overrunMinutes: [30, 10, 20] });
  const reversed = rankSchedulesByResilience(problem, [
    { candidateId: "resilient", assignments: [...resilient].reverse() },
    { candidateId: "brittle", assignments: [...brittle].reverse() },
  ], { overrunMinutes: [20, 30, 10] });

  assert.deepEqual(reversed, forward);
});
