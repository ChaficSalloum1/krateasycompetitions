import assert from "node:assert/strict";
import test from "node:test";
import { planMinimalChangeScheduleRepair, reconstructScheduleRepairObjective, type ScheduleRepairRequest } from "../src/schedule-repair.js";
import type { SchedulingProblem, SolverAssignment } from "../src/schedule-solver.js";

// The repair search prunes partial repairs that are already worse than the best found. That is only
// sound if it never loses the true optimum, so every generated problem is also solved by brute force
// over every legal placement and the two must agree on the optimal objective (or both find none).

const GRANULARITY = 5;
const HORIZON = 80;

function random(seed: number) {
  let state = seed >>> 0;
  return () => { state = (state * 1_664_525 + 1_013_904_223) >>> 0; return state / 2 ** 32; };
}

function generate(seed: number): ScheduleRepairRequest {
  const next = random(seed);
  const resources = ["court.a", "court.b", "court.c"];
  const players = ["p0", "p1", "p2", "p3"];
  const tasks = Array.from({ length: 4 }, (_, index) => {
    const first = players[index % players.length]!;
    const second = players[(index + 1 + Math.floor(next() * 3)) % players.length]!;
    return { id: `t${index}`, durationMinutes: 15 + 5 * Math.floor(next() * 3), eligibleResourceIds: resources,
      dependencyIds: [], participantIds: [...new Set([first, second])].sort() };
  });
  // A dense baseline, then closures that force several contests to move at once.
  const baseline: SolverAssignment[] = tasks.map((task, index) => {
    const start = GRANULARITY * Math.floor(next() * 6);
    return { taskId: task.id, resourceId: resources[index % 3]!, startMinute: start, endMinute: start + task.durationMinutes, locked: false };
  });
  const closures = (id: string) => next() < 0.6 ? [{ startMinute: 0, endMinute: 15 + GRANULARITY * Math.floor(next() * 5) }] : [];
  const problem: SchedulingProblem = { id: `repair-${seed}`, tasks, locks: [], minimumRestMinutes: 5 * Math.floor(next() * 3),
    resources: resources.map((id) => ({ id, calendars: [{ startMinute: 0, endMinute: HORIZON }], closures: closures(id) })) };
  return { problem, baseline };
}

function legal(problem: SchedulingProblem, assignments: readonly SolverAssignment[]): boolean {
  const byId = new Map(problem.tasks.map((task) => [task.id, task]));
  for (const a of assignments) {
    const resource = problem.resources.find(({ id }) => id === a.resourceId)!;
    if (!resource.calendars.some((w) => a.startMinute >= w.startMinute && a.endMinute <= w.endMinute)) return false;
    if (resource.closures.some((c) => a.startMinute < c.endMinute && c.startMinute < a.endMinute)) return false;
  }
  for (let i = 0; i < assignments.length; i += 1) for (let j = i + 1; j < assignments.length; j += 1) {
    const [a, b] = [assignments[i]!, assignments[j]!];
    if (a.resourceId === b.resourceId && a.startMinute < b.endMinute && b.startMinute < a.endMinute) return false;
    if (byId.get(a.taskId)!.participantIds.some((id) => byId.get(b.taskId)!.participantIds.includes(id))
      && !(a.startMinute >= b.endMinute + problem.minimumRestMinutes || b.startMinute >= a.endMinute + problem.minimumRestMinutes)) return false;
  }
  return true;
}

function lexicographicallyLess(left: readonly number[], right: readonly number[]): boolean {
  for (let index = 0; index < left.length; index += 1) if (left[index] !== right[index]) return left[index]! < right[index]!;
  return false;
}

function bruteForceBest(request: ScheduleRepairRequest): readonly number[] | null {
  const { problem, baseline } = request;
  const options = problem.tasks.map((task) => {
    const placements: SolverAssignment[] = [];
    for (const resourceId of task.eligibleResourceIds)
      for (let start = 0; start + task.durationMinutes <= HORIZON; start += GRANULARITY)
        placements.push({ taskId: task.id, resourceId, startMinute: start, endMinute: start + task.durationMinutes, locked: false });
    return placements;
  });
  let best: readonly number[] | null = null;
  const chosen: SolverAssignment[] = [];
  // Exhaustive: the only cut is a partial assignment that already breaks a hard rule.
  const walk = (depth: number): void => {
    if (depth === options.length) {
      const vector = reconstructScheduleRepairObjective(problem, baseline, chosen).vector;
      if (!best || lexicographicallyLess(vector, best)) best = vector;
      return;
    }
    for (const placement of options[depth]!) {
      chosen.push(placement);
      if (legal(problem, chosen)) walk(depth + 1);
      chosen.pop();
    }
  };
  walk(0);
  return best;
}

test("whenever the pruned repair search claims a proven minimum, it is the brute-force minimum", () => {
  let proven = 0; let infeasible = 0;
  for (let seed = 1; seed <= 40; seed += 1) {
    const request = generate(seed);
    const expected = bruteForceBest(request);
    const result = planMinimalChangeScheduleRepair(request, { maxSearchNodes: 200_000, granularityMinutes: GRANULARITY });
    if (expected === null) {
      assert.equal(result.status, "INFEASIBLE", `seed ${seed}: brute force finds no legal repair`);
      infeasible += 1;
      continue;
    }
    assert.notEqual(result.status, "INFEASIBLE", `seed ${seed}: a legal repair exists`);
    if (!result.proof.optimalityProven) continue;
    assert.deepEqual(result.objective!.vector, expected, `seed ${seed}: the claimed minimum is the true minimum`);
    proven += 1;
  }
  assert.ok(proven >= 20, `enough generated problems are proven to be meaningful (${proven} proven, ${infeasible} infeasible)`);
});
