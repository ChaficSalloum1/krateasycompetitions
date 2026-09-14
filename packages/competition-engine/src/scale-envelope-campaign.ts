import { performance } from "node:perf_hooks";
import { canonicalHash, deepFreeze } from "@tournament-os/tournament-schema";
import { createCpSatSolver } from "./cp-sat-solver.js";
import type { SchedulingProblem } from "./schedule-solver.js";

export interface ScaleEnvelopePoint {
  readonly taskCount: number;
  readonly resourceCount: number;
  readonly tasksPerResourceRatio: number;
  readonly status: "CERTIFIED" | "INFEASIBLE" | "UNKNOWN";
  readonly backendStatus: string;
  readonly totalLatencyMs: number;
  readonly solverWallTimeSeconds: number | null;
  readonly processRssMb: number;
  readonly objectiveValueMinutes: number | null;
  readonly objectiveGap: number | null;
  readonly validationErrors: readonly string[];
  readonly repairQuality: null;
  readonly repairStatus: "NOT_EXERCISED_BY_THIS_FIXTURE";
  readonly proofHash: string;
}

export interface ScaleEnvelopeCampaignReport {
  readonly status: "CERTIFIED" | "REJECTED" | "UNKNOWN";
  readonly points: readonly ScaleEnvelopePoint[];
  readonly findings: readonly string[];
  readonly environment: Readonly<{ node: string; platform: string; architecture: string }>;
  readonly qualification: "MEASURED_REFERENCE_ENVELOPE_NOT_A_CAPACITY_GUARANTEE";
  readonly proofHash: string;
}

function fixture(taskCount: number, resourceCount: number): SchedulingProblem {
  const width = String(taskCount).length;
  const resourceIds = Array.from({ length: resourceCount }, (_, index) => `resource.${String(index).padStart(width, "0")}`);
  const durationMinutes = 5;
  const chainLength = Math.ceil(taskCount / resourceCount);
  const horizon = chainLength * durationMinutes + 30;
  return {
    id: `scale.${taskCount}.resources.${resourceCount}`,
    tasks: Array.from({ length: taskCount }, (_, index) => {
      const resourceIndex = index % resourceCount;
      const predecessor = index >= resourceCount ? index - resourceCount : undefined;
      return {
        id: `task.${String(index).padStart(width, "0")}`,
        durationMinutes,
        eligibleResourceIds: [resourceIds[resourceIndex]!],
        dependencyIds: predecessor === undefined ? [] : [`task.${String(predecessor).padStart(width, "0")}`],
        participantIds: [`participant.${index}`],
      };
    }),
    resources: resourceIds.map((id) => ({ id, calendars: [{ startMinute: 0, endMinute: horizon }], closures: [] })),
    locks: resourceIds.map((resourceId, index) => ({ taskId: `task.${String(index).padStart(width, "0")}`, resourceId, startMinute: 0 })),
    minimumRestMinutes: 0,
  };
}

export function runScaleEnvelopeCampaign(
  taskCounts: readonly number[] = [128, 512, 2_048],
  tasksPerResourceRatios: readonly number[] = [8, 16, 32],
  maxTimeSeconds = 20,
): Readonly<ScaleEnvelopeCampaignReport> {
  if (!taskCounts.length || taskCounts.some((value) => !Number.isSafeInteger(value) || value < 1 || value > 100_000)) {
    throw new Error("Scale task counts must be positive safe integers no greater than 100,000.");
  }
  if (!tasksPerResourceRatios.length || tasksPerResourceRatios.some((value) => !Number.isSafeInteger(value) || value < 1)) {
    throw new Error("Tasks-per-resource ratios must be positive safe integers.");
  }
  const solver = createCpSatSolver();
  const points: ScaleEnvelopePoint[] = [];
  const findings: string[] = [];
  for (const taskCount of [...taskCounts].sort((left, right) => left - right)) for (const ratio of [...tasksPerResourceRatios].sort((left, right) => left - right)) {
    const resourceCount = Math.max(1, Math.ceil(taskCount / ratio));
    const problem = fixture(taskCount, resourceCount);
    const started = performance.now();
    const result = solver.solve(problem, { maxTimeSeconds });
    const totalLatencyMs = Math.round((performance.now() - started) * 100) / 100;
    if (result.status !== "CERTIFIED") findings.push(`${problem.id}: solver status ${result.status}/${result.proof.backendStatus}.`);
    const base = {
      taskCount,
      resourceCount,
      tasksPerResourceRatio: taskCount / resourceCount,
      status: result.status,
      backendStatus: result.proof.backendStatus,
      totalLatencyMs,
      solverWallTimeSeconds: result.proof.wallTimeSeconds,
      processRssMb: Math.round(process.memoryUsage().rss / (1024 * 1024) * 100) / 100,
      objectiveValueMinutes: result.objective.valueMinutes,
      objectiveGap: result.objective.relativeGap,
      validationErrors: result.proof.validationErrors,
      repairQuality: null,
      repairStatus: "NOT_EXERCISED_BY_THIS_FIXTURE" as const,
    };
    points.push({ ...base, proofHash: canonicalHash({ problem, result, measurement: base }) });
  }
  const status = findings.length ? "REJECTED" as const : "UNKNOWN" as const;
  findings.push("Repair quality is intentionally unclaimed: this feasibility/optimality envelope does not exercise disruption repair.");
  const base = {
    status,
    points,
    findings: [...findings].sort(),
    environment: { node: process.version, platform: process.platform, architecture: process.arch },
    qualification: "MEASURED_REFERENCE_ENVELOPE_NOT_A_CAPACITY_GUARANTEE" as const,
  };
  return deepFreeze({ ...base, proofHash: canonicalHash(base) });
}
