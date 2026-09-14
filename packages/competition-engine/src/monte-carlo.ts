import { deterministicRandom } from "./random.js";
import type { ScheduleSolution } from "./types.js";

export interface OperationalRiskReport {
  iterations: number;
  p50Finish: string;
  p95Finish: string;
  maximumFinish: string;
  overrunProbability: number;
  deadline?: string;
}

export function simulateOperationalRisk(
  schedule: ScheduleSolution,
  options: { iterations: number; seed: string; durationStdDevFraction: number; deadline?: string },
): OperationalRiskReport {
  if (!schedule.contests.length) throw new Error("Cannot simulate an empty schedule");
  const random = deterministicRandom(options.seed);
  const baselineStart = Math.min(...schedule.contests.map(({ start }) => Date.parse(start)));
  const finishes: number[] = [];
  for (let iteration = 0; iteration < options.iterations; iteration += 1) {
    let maximum = baselineStart;
    for (const contest of schedule.contests) {
      const duration = Date.parse(contest.end) - Date.parse(contest.start);
      const triangularNoise = random.next() + random.next() + random.next() - 1.5;
      maximum = Math.max(maximum, Date.parse(contest.start) + Math.max(1, duration * (1 + triangularNoise * options.durationStdDevFraction)));
    }
    finishes.push(maximum);
  }
  finishes.sort((a, b) => a - b);
  const percentile = (value: number) => finishes[Math.min(finishes.length - 1, Math.floor((finishes.length - 1) * value))]!;
  const deadlineMs = options.deadline ? Date.parse(options.deadline) : undefined;
  return {
    iterations: options.iterations, p50Finish: new Date(percentile(0.5)).toISOString(), p95Finish: new Date(percentile(0.95)).toISOString(),
    maximumFinish: new Date(finishes.at(-1)!).toISOString(),
    overrunProbability: deadlineMs === undefined ? 0 : finishes.filter((finish) => finish > deadlineMs).length / finishes.length,
    ...(options.deadline ? { deadline: options.deadline } : {}),
  };
}
