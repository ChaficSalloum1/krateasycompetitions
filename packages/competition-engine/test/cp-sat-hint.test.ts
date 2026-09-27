import assert from "node:assert/strict";
import test from "node:test";
import { greedyCpSatHint } from "../src/scheduling-quality.js";
import type { SchedulingProblem } from "../src/schedule-solver.js";

// The starting plan handed to CP-SAT must itself be complete and legal, so that the search begins from
// a real plan; and it must keep every player's chain moving rather than playing rounds one by one.

function roundRobin(pairs: number, courts: number, duration: number, rest: number): SchedulingProblem {
  const tasks = [];
  for (let a = 0; a < pairs; a += 1) for (let b = a + 1; b < pairs; b += 1)
    tasks.push({ id: `m.${a}.${b}`, durationMinutes: duration, eligibleResourceIds: Array.from({ length: courts }, (_, i) => `court.${i + 1}`),
      dependencyIds: [], participantIds: [`p${a}`, `p${b}`] });
  return { id: `rr.${pairs}.${courts}`, tasks, locks: [], minimumRestMinutes: rest,
    resources: Array.from({ length: courts }, (_, i) => ({ id: `court.${i + 1}`, calendars: [{ startMinute: 0, endMinute: 720 }],
      closures: i === 0 ? [{ startMinute: 60, endMinute: 90 }] : [] })) };
}

test("the CP-SAT starting plan is complete and keeps every hard rule", () => {
  for (const [pairs, courts, duration, rest] of [[8, 2, 20, 10], [12, 3, 20, 10], [12, 4, 30, 10], [6, 3, 25, 0]] as const) {
    const problem = roundRobin(pairs, courts, duration, rest);
    const hint = greedyCpSatHint(problem)!;
    assert.ok(hint, `${problem.id}: a starting plan exists`);
    assert.deepEqual(hint.map(({ taskId }) => taskId).sort(), problem.tasks.map(({ id }) => id).sort(), `${problem.id}: every contest is placed once`);
    const byId = new Map(problem.tasks.map((task) => [task.id, task]));
    const placed = hint.map((h) => ({ ...h, end: h.startMinute + byId.get(h.taskId)!.durationMinutes, players: byId.get(h.taskId)!.participantIds }));
    for (const p of placed) {
      const court = problem.resources.find(({ id }) => id === p.resourceId)!;
      assert.ok(p.end <= 720 && !court.closures.some((c) => p.startMinute < c.endMinute && c.startMinute < p.end), `${p.taskId} respects its court's hours and closures`);
    }
    for (let i = 0; i < placed.length; i += 1) for (let j = i + 1; j < placed.length; j += 1) {
      const [a, b] = [placed[i]!, placed[j]!];
      if (a.resourceId === b.resourceId) assert.ok(a.end <= b.startMinute || b.end <= a.startMinute, `${a.taskId} and ${b.taskId} share no court time`);
      if (a.players.some((id) => b.players.includes(id))) assert.ok(b.startMinute >= a.end + rest || a.startMinute >= b.end + rest,
        `${a.taskId} and ${b.taskId} keep the ${rest}-minute rest`);
    }
  }
});

test("the starting plan finishes near the capacity bound instead of spreading rounds across the day", () => {
  const problem = roundRobin(12, 4, 20, 10);
  const hint = greedyCpSatHint(problem)!;
  const finish = Math.max(...hint.map(({ startMinute }) => startMinute + 20));
  // 66 matches of 20 minutes on 4 courts (one closed for 30 minutes) need at least 338 minutes.
  assert.ok(finish <= 338 * 1.25, `finishes in ${finish} minutes, within 25% of the ${338}-minute capacity bound`);
});
