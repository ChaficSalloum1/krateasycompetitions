import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { SchedulingProblem, SolverAssignment } from "./schedule-solver.js";

export const CP_SAT_BACKEND_VERSION = "9.15.6755";

export interface CpSatTestedScaleEnvelope {
  readonly profile: "TOURNAMENT_OS_CP_SAT_V1";
  readonly largestExecutedFixture: Readonly<{
    tasks: 128;
    resources: 8;
    horizonMinutes: 1_440;
    precedenceEdges: 127;
  }>;
  readonly coveredConstraints: readonly ["RESOURCE_NO_OVERLAP", "PRECEDENCE", "CALENDARS", "CLOSURES", "LOCKS", "PARTICIPANT_REST"];
  readonly qualification: "TESTED_REFERENCE_ENVELOPE_NOT_A_CAPACITY_GUARANTEE";
}

export interface CpSatObjectiveEvidence {
  readonly sense: "MINIMIZE_MAKESPAN";
  readonly valueMinutes: number | null;
  readonly bestBoundMinutes: number | null;
  readonly absoluteGapMinutes: number | null;
  readonly relativeGap: number | null;
  readonly optimal: boolean;
}

export interface CpSatProof {
  readonly method: "OR_TOOLS_CP_SAT";
  readonly backendAvailable: boolean;
  readonly backendVersion: string | null;
  readonly requiredBackendVersion: string;
  readonly backendStatus: "OPTIMAL" | "FEASIBLE" | "INFEASIBLE" | "UNKNOWN" | "MODEL_INVALID" | "UNAVAILABLE";
  readonly deterministicParameters: Readonly<{ randomSeed: 0; workers: 1 }>;
  readonly wallTimeSeconds: number | null;
  readonly branches: number | null;
  readonly conflicts: number | null;
  readonly validationErrors: readonly string[];
  readonly findings: readonly string[];
  readonly testedScaleEnvelope: CpSatTestedScaleEnvelope;
  readonly proofHash: string;
}

export interface CpSatResult {
  readonly status: "CERTIFIED" | "INFEASIBLE" | "UNKNOWN";
  readonly assignments: readonly SolverAssignment[];
  readonly objective: CpSatObjectiveEvidence;
  readonly proof: CpSatProof;
}

export interface CpSatSolveOptions { readonly maxTimeSeconds: number; }
export interface CpSatSolver {
  solve(problem: SchedulingProblem, options: CpSatSolveOptions): CpSatResult;
  /** The same result as `solve`, from a child process that does not block the event loop. */
  solveAsync(problem: SchedulingProblem, options: CpSatSolveOptions): Promise<CpSatResult>;
}
export interface CpSatSolverConfig {
  readonly pythonExecutable?: string;
  readonly workerPath?: string;
  readonly requiredBackendVersion?: string;
}

const TESTED_SCALE_ENVELOPE: CpSatTestedScaleEnvelope = {
  profile: "TOURNAMENT_OS_CP_SAT_V1",
  largestExecutedFixture: { tasks: 128, resources: 8, horizonMinutes: 1_440, precedenceEdges: 127 },
  coveredConstraints: ["RESOURCE_NO_OVERLAP", "PRECEDENCE", "CALENDARS", "CLOSURES", "LOCKS", "PARTICIPANT_REST"],
  qualification: "TESTED_REFERENCE_ENVELOPE_NOT_A_CAPACITY_GUARANTEE",
};

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(",")}}`;
  return JSON.stringify(value);
}

function hash(value: unknown): string {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

function freeze<T>(value: T): Readonly<T> {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

function defaultWorkerPath(): string {
  const sourceAdjacent = fileURLToPath(new URL("../solver/cp_sat_worker.py", import.meta.url));
  if (existsSync(sourceAdjacent)) return sourceAdjacent;
  return fileURLToPath(new URL("../../solver/cp_sat_worker.py", import.meta.url));
}

function unknownResult(
  problem: SchedulingProblem,
  options: CpSatSolveOptions,
  requiredBackendVersion: string,
  backendStatus: CpSatProof["backendStatus"],
  finding: string,
  backendAvailable = false,
  backendVersion: string | null = null,
): CpSatResult {
  const objective: CpSatObjectiveEvidence = {
    sense: "MINIMIZE_MAKESPAN", valueMinutes: null, bestBoundMinutes: null,
    absoluteGapMinutes: null, relativeGap: null, optimal: false,
  };
  const proofBase = {
    method: "OR_TOOLS_CP_SAT" as const,
    backendAvailable,
    backendVersion,
    requiredBackendVersion,
    backendStatus,
    deterministicParameters: { randomSeed: 0 as const, workers: 1 as const },
    wallTimeSeconds: null,
    branches: null,
    conflicts: null,
    validationErrors: [] as string[],
    findings: [finding],
    testedScaleEnvelope: TESTED_SCALE_ENVELOPE,
  };
  return freeze({
    status: "UNKNOWN" as const,
    assignments: [] as SolverAssignment[],
    objective,
    proof: { ...proofBase, proofHash: hash({ problem, options, proof: proofBase }) },
  });
}

interface WorkerResponse {
  readonly protocolVersion: number;
  readonly status: CpSatProof["backendStatus"];
  readonly backendVersion?: string;
  readonly assignments?: readonly SolverAssignment[];
  readonly objectiveValueMinutes?: number;
  readonly bestObjectiveBoundMinutes?: number;
  readonly branches?: number;
  readonly conflicts?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseWorkerResponse(stdout: string): WorkerResponse | undefined {
  let value: unknown;
  try { value = JSON.parse(stdout); } catch { return undefined; }
  if (!isRecord(value) || value.protocolVersion !== 1 || typeof value.status !== "string"
    || !["OPTIMAL", "FEASIBLE", "INFEASIBLE", "UNKNOWN", "MODEL_INVALID", "UNAVAILABLE"].includes(value.status)) return undefined;
  if (value.backendVersion !== undefined && typeof value.backendVersion !== "string") return undefined;
  const numericKeys = ["objectiveValueMinutes", "bestObjectiveBoundMinutes", "branches", "conflicts"] as const;
  if (numericKeys.some((key) => value[key] !== undefined && (typeof value[key] !== "number" || !Number.isFinite(value[key])))) return undefined;
  let assignments: SolverAssignment[] | undefined;
  if (value.assignments !== undefined) {
    if (!Array.isArray(value.assignments)) return undefined;
    assignments = [];
    for (const entry of value.assignments) {
      if (!isRecord(entry) || typeof entry.taskId !== "string" || typeof entry.resourceId !== "string"
        || !Number.isInteger(entry.startMinute) || !Number.isInteger(entry.endMinute) || typeof entry.locked !== "boolean") return undefined;
      assignments.push({ taskId: entry.taskId, resourceId: entry.resourceId,
        startMinute: entry.startMinute as number, endMinute: entry.endMinute as number, locked: entry.locked });
    }
  }
  return {
    protocolVersion: 1,
    status: value.status as WorkerResponse["status"],
    ...(value.backendVersion === undefined ? {} : { backendVersion: value.backendVersion }),
    ...(assignments === undefined ? {} : { assignments }),
    ...(value.objectiveValueMinutes === undefined ? {} : { objectiveValueMinutes: value.objectiveValueMinutes as number }),
    ...(value.bestObjectiveBoundMinutes === undefined ? {} : { bestObjectiveBoundMinutes: value.bestObjectiveBoundMinutes as number }),
    ...(value.branches === undefined ? {} : { branches: value.branches as number }),
    ...(value.conflicts === undefined ? {} : { conflicts: value.conflicts as number }),
  };
}

function overlaps(leftStart: number, leftEnd: number, rightStart: number, rightEnd: number): boolean {
  return leftStart < rightEnd && rightStart < leftEnd;
}

function independentlyValidate(problem: SchedulingProblem, assignments: readonly SolverAssignment[]): string[] {
  const errors: string[] = [];
  const tasks = new Map(problem.tasks.map((task) => [task.id, task]));
  const resources = new Map(problem.resources.map((resource) => [resource.id, resource]));
  const byTask = new Map<string, SolverAssignment>();
  for (const assignment of assignments) {
    if (byTask.has(assignment.taskId)) errors.push(`Duplicate assignment for ${assignment.taskId}.`);
    byTask.set(assignment.taskId, assignment);
    const task = tasks.get(assignment.taskId);
    const resource = resources.get(assignment.resourceId);
    if (!task || !resource || !task.eligibleResourceIds.includes(assignment.resourceId)) {
      errors.push(`Invalid resource assignment for ${assignment.taskId}.`);
      continue;
    }
    if (!Number.isInteger(assignment.startMinute) || assignment.startMinute < 0
      || assignment.endMinute !== assignment.startMinute + task.durationMinutes) {
      errors.push(`Invalid timing for ${assignment.taskId}.`);
      continue;
    }
    const insideCalendar = resource.calendars.some((window) =>
      assignment.startMinute >= window.startMinute && assignment.endMinute <= window.endMinute);
    const outsideClosures = resource.closures.every((closure) =>
      !overlaps(assignment.startMinute, assignment.endMinute, closure.startMinute, closure.endMinute));
    if (!insideCalendar || !outsideClosures) errors.push(`Resource calendar violation for ${assignment.taskId}.`);
  }
  if (assignments.length !== problem.tasks.length || byTask.size !== problem.tasks.length
    || problem.tasks.some(({ id }) => !byTask.has(id))) errors.push("Not every task is assigned exactly once.");
  for (const task of problem.tasks) {
    const assignment = byTask.get(task.id);
    if (!assignment) continue;
    for (const dependencyId of task.dependencyIds) {
      const dependency = byTask.get(dependencyId);
      if (!dependency || assignment.startMinute < dependency.endMinute) errors.push(`Precedence violation for ${task.id}.`);
    }
  }
  for (const lock of problem.locks) {
    const assignment = byTask.get(lock.taskId);
    if (!assignment || assignment.resourceId !== lock.resourceId || assignment.startMinute !== lock.startMinute || !assignment.locked) {
      errors.push(`Lock violation for ${lock.taskId}.`);
    }
  }
  for (let leftIndex = 0; leftIndex < assignments.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < assignments.length; rightIndex += 1) {
      const left = assignments[leftIndex]!;
      const right = assignments[rightIndex]!;
      if (left.resourceId === right.resourceId && overlaps(left.startMinute, left.endMinute, right.startMinute, right.endMinute)) {
        errors.push(`Resource collision: ${left.taskId}/${right.taskId}.`);
      }
      const leftTask = tasks.get(left.taskId);
      const rightTask = tasks.get(right.taskId);
      if (leftTask && rightTask && leftTask.participantIds.some((id) => rightTask.participantIds.includes(id))) {
        const rested = left.startMinute >= right.endMinute + problem.minimumRestMinutes
          || right.startMinute >= left.endMinute + problem.minimumRestMinutes;
        if (!rested) errors.push(`Participant rest violation: ${left.taskId}/${right.taskId}.`);
      }
    }
  }
  return [...new Set(errors)].sort();
}

function preflightProblem(problem: SchedulingProblem): string[] {
  const errors: string[] = [];
  if (!problem.id.trim()) errors.push("Problem id is required.");
  if (!Number.isInteger(problem.minimumRestMinutes) || problem.minimumRestMinutes < 0) errors.push("Minimum rest is invalid.");
  if (problem.tasks.length === 0) errors.push("At least one task is required.");
  const tasks = new Map<string, SchedulingProblem["tasks"][number]>();
  for (const task of problem.tasks) {
    if (!task.id.trim() || tasks.has(task.id)) errors.push(`Task id is empty or duplicated: ${task.id}.`);
    tasks.set(task.id, task);
    if (!Number.isInteger(task.durationMinutes) || task.durationMinutes <= 0) errors.push(`Task duration is invalid: ${task.id}.`);
    if (task.eligibleResourceIds.length === 0) errors.push(`Task has no eligible resource: ${task.id}.`);
  }
  const resources = new Map<string, SchedulingProblem["resources"][number]>();
  for (const resource of problem.resources) {
    if (!resource.id.trim() || resources.has(resource.id)) errors.push(`Resource id is empty or duplicated: ${resource.id}.`);
    resources.set(resource.id, resource);
    if (resource.calendars.length === 0) errors.push(`Resource has no calendar: ${resource.id}.`);
    for (const window of [...resource.calendars, ...resource.closures]) {
      if (!Number.isInteger(window.startMinute) || !Number.isInteger(window.endMinute)
        || window.startMinute < 0 || window.endMinute <= window.startMinute) errors.push(`Resource window is invalid: ${resource.id}.`);
    }
  }
  for (const task of problem.tasks) {
    for (const resourceId of task.eligibleResourceIds) if (!resources.has(resourceId)) errors.push(`Unknown resource ${resourceId} on ${task.id}.`);
    for (const dependencyId of task.dependencyIds) {
      if (!tasks.has(dependencyId)) errors.push(`Unknown dependency ${dependencyId} on ${task.id}.`);
      if (dependencyId === task.id) errors.push(`Task depends on itself: ${task.id}.`);
    }
  }
  if (!errors.some((message) => message.startsWith("Unknown dependency") || message.startsWith("Task depends"))) {
    const remaining = new Map(problem.tasks.map((task) => [task.id, new Set(task.dependencyIds)]));
    while (remaining.size > 0) {
      const ready = [...remaining].filter(([, dependencies]) => dependencies.size === 0).map(([id]) => id);
      if (ready.length === 0) { errors.push("Task dependency graph is cyclic."); break; }
      for (const id of ready) {
        remaining.delete(id);
        for (const dependencies of remaining.values()) dependencies.delete(id);
      }
    }
  }
  const lockedTasks = new Set<string>();
  for (const lock of problem.locks) {
    if (!tasks.has(lock.taskId) || !resources.has(lock.resourceId)) errors.push(`Lock has an unknown target: ${lock.taskId}.`);
    if (lockedTasks.has(lock.taskId)) errors.push(`Task has multiple locks: ${lock.taskId}.`);
    if (!Number.isInteger(lock.startMinute) || lock.startMinute < 0) errors.push(`Lock start is invalid: ${lock.taskId}.`);
    lockedTasks.add(lock.taskId);
  }
  return [...new Set(errors)].sort();
}

function trustedResult(
  problem: SchedulingProblem,
  options: CpSatSolveOptions,
  requiredBackendVersion: string,
  response: WorkerResponse,
): CpSatResult {
  const assignments = [...(response.assignments ?? [])].sort((left, right) => left.taskId.localeCompare(right.taskId));
  const validationErrors = response.status === "OPTIMAL" || response.status === "FEASIBLE"
    ? independentlyValidate(problem, assignments) : [];
  const suppliedObjective = response.objectiveValueMinutes;
  const derivedObjective = assignments.length > 0 ? Math.max(...assignments.map(({ endMinute }) => endMinute)) : null;
  if ((response.status === "OPTIMAL" || response.status === "FEASIBLE")
    && (suppliedObjective === undefined || suppliedObjective !== derivedObjective)) validationErrors.push("Objective does not match the certified assignments.");
  const solutionTrusted = (response.status === "OPTIMAL" || response.status === "FEASIBLE") && validationErrors.length === 0;
  const value = solutionTrusted ? suppliedObjective! : null;
  const bestBound = solutionTrusted && response.bestObjectiveBoundMinutes !== undefined ? response.bestObjectiveBoundMinutes : null;
  const absoluteGap = value !== null && bestBound !== null ? Math.max(0, value - bestBound) : null;
  const objective: CpSatObjectiveEvidence = {
    sense: "MINIMIZE_MAKESPAN",
    valueMinutes: value,
    bestBoundMinutes: bestBound,
    absoluteGapMinutes: absoluteGap,
    relativeGap: value !== null && absoluteGap !== null ? absoluteGap / Math.max(1, Math.abs(value)) : null,
    optimal: solutionTrusted && response.status === "OPTIMAL" && absoluteGap === 0,
  };
  const status: CpSatResult["status"] = solutionTrusted ? "CERTIFIED"
    : response.status === "INFEASIBLE" ? "INFEASIBLE" : "UNKNOWN";
  const findings = status === "CERTIFIED"
    ? [response.status === "OPTIMAL" ? "CPS100: CP-SAT returned an optimal schedule that passed independent validation."
      : "CPS101: CP-SAT returned a feasible schedule that passed independent validation; optimality is not claimed."]
    : status === "INFEASIBLE" ? ["CPS102: CP-SAT exhausted the model and proved it infeasible."]
      : [validationErrors.length ? "CPS006: Worker solution failed independent validation."
        : `CPS005: CP-SAT terminated with ${response.status}; feasibility is unknown.`];
  const proofBase = {
    method: "OR_TOOLS_CP_SAT" as const,
    backendAvailable: true,
    backendVersion: response.backendVersion ?? null,
    requiredBackendVersion,
    backendStatus: response.status,
    deterministicParameters: { randomSeed: 0 as const, workers: 1 as const },
    wallTimeSeconds: null,
    branches: response.branches ?? null,
    conflicts: response.conflicts ?? null,
    validationErrors: [...validationErrors].sort(),
    findings,
    testedScaleEnvelope: TESTED_SCALE_ENVELOPE,
  };
  const safeAssignments = status === "CERTIFIED" ? assignments : [];
  return freeze({ status, assignments: safeAssignments, objective,
    proof: { ...proofBase, proofHash: hash({ problem, options, assignments: safeAssignments, objective, proof: proofBase }) } });
}

interface WorkerRun { readonly errorCode?: string; readonly exitStatus: number | null; readonly stdout: string; }

const workerTimeoutMs = (options: CpSatSolveOptions) =>
  // Outlasts the worker's wall-time safety cap (2 × budget + 5 s) so the worker reports its own limit.
  Math.ceil((options.maxTimeSeconds * 2 + 5) * 1_000) + 30_000;
const workerMaxBuffer = 16 * 1024 * 1024;

export function createCpSatSolver(config: CpSatSolverConfig = {}): CpSatSolver {
  const pythonExecutable = config.pythonExecutable ?? process.env.TOURNAMENT_OS_CP_SAT_PYTHON ?? "python3";
  const workerPath = config.workerPath ?? defaultWorkerPath();
  const requiredBackendVersion = config.requiredBackendVersion ?? CP_SAT_BACKEND_VERSION;
  /** Checks shared by both paths: the model before it is sent, then everything the worker returns. */
  const precheck = (problem: SchedulingProblem, options: CpSatSolveOptions): CpSatResult | undefined => {
    if (!Number.isFinite(options.maxTimeSeconds) || options.maxTimeSeconds <= 0 || options.maxTimeSeconds > 3_600) {
      throw new Error("CP-SAT maximum time must be greater than zero and at most 3600 seconds");
    }
    const modelErrors = preflightProblem(problem);
    return modelErrors.length > 0
      ? unknownResult(problem, options, requiredBackendVersion, "MODEL_INVALID", `CPS007: Scheduling model is invalid (${modelErrors.join(" ")})`)
      : undefined;
  };
  const request = (problem: SchedulingProblem, options: CpSatSolveOptions) =>
    JSON.stringify({ protocolVersion: 1, requiredBackendVersion, problem, options });
  const interpret = (problem: SchedulingProblem, options: CpSatSolveOptions, run: WorkerRun): CpSatResult => {
    if (run.errorCode) {
      return unknownResult(problem, options, requiredBackendVersion, "UNAVAILABLE", `CPS001: CP-SAT worker unavailable (${run.errorCode}).`);
    }
    if (run.exitStatus !== 0) {
      return unknownResult(problem, options, requiredBackendVersion, "UNAVAILABLE", `CPS002: CP-SAT worker exited without a trusted result (exit ${run.exitStatus ?? "unknown"}).`);
    }
    const response = parseWorkerResponse(run.stdout);
    if (!response) return unknownResult(problem, options, requiredBackendVersion, "UNAVAILABLE", "CPS002: CP-SAT worker returned malformed protocol output.");
    if (response.backendVersion !== undefined && response.backendVersion !== requiredBackendVersion) {
      return unknownResult(problem, options, requiredBackendVersion, "UNAVAILABLE", "CPS003: CP-SAT backend version does not match the pinned runtime.", true, response.backendVersion);
    }
    if (response.status === "UNAVAILABLE") {
      return unknownResult(problem, options, requiredBackendVersion, "UNAVAILABLE", "CPS001: Pinned CP-SAT backend is unavailable.", false, response.backendVersion ?? null);
    }
    return trustedResult(problem, options, requiredBackendVersion, response);
  };
  return freeze({
    solve(problem: SchedulingProblem, options: CpSatSolveOptions): CpSatResult {
      const rejected = precheck(problem, options);
      if (rejected) return rejected;
      const process = spawnSync(pythonExecutable, [workerPath], {
        input: request(problem, options), encoding: "utf8", timeout: workerTimeoutMs(options), maxBuffer: workerMaxBuffer,
      });
      return interpret(problem, options, { exitStatus: process.status, stdout: process.stdout ?? "",
        ...(process.error ? { errorCode: (process.error as NodeJS.ErrnoException).code ?? "PROCESS_ERROR" } : {}) });
    },
    solveAsync(problem: SchedulingProblem, options: CpSatSolveOptions): Promise<CpSatResult> {
      let rejected: CpSatResult | undefined;
      try { rejected = precheck(problem, options); } catch (error) { return Promise.reject(error); }
      if (rejected) return Promise.resolve(rejected);
      return new Promise((resolve) => {
        const child = spawn(pythonExecutable, [workerPath], { stdio: ["pipe", "pipe", "ignore"] });
        let stdout = ""; let overflow = false; let settled = false;
        const finish = (run: WorkerRun) => { if (settled) return; settled = true; clearTimeout(timer); resolve(interpret(problem, options, run)); };
        const timer = setTimeout(() => { child.kill("SIGKILL"); finish({ errorCode: "ETIMEDOUT", exitStatus: null, stdout: "" }); }, workerTimeoutMs(options));
        child.stdout.setEncoding("utf8");
        child.stdout.on("data", (chunk: string) => {
          stdout += chunk;
          if (stdout.length > workerMaxBuffer && !overflow) { overflow = true; child.kill("SIGKILL"); }
        });
        child.on("error", (error: NodeJS.ErrnoException) => finish({ errorCode: error.code ?? "PROCESS_ERROR", exitStatus: null, stdout: "" }));
        child.on("close", (code) => finish(overflow ? { errorCode: "ENOBUFS", exitStatus: null, stdout: "" } : { exitStatus: code, stdout }));
        child.stdin.on("error", () => { /* reported through the process close or error event */ });
        child.stdin.end(request(problem, options));
      });
    },
  });
}

/** Identity of a scheduling problem's content, ignoring its id (which embeds the compile timestamp). */
export function cpSatProblemContentHash(problem: SchedulingProblem): string {
  return hash({ ...problem, id: null });
}

/**
 * A solver that answers with a result computed earlier (typically by `solveAsync` off the request
 * path) when asked to solve a problem with the same content, and otherwise solves normally. The
 * caller still validates whatever comes back; a stale result for different content is never reused.
 */
export function createPresolvedCpSatSolver(presolved: { readonly contentHash: string; readonly result: CpSatResult },
  fallback: CpSatSolver = createCpSatSolver()): CpSatSolver {
  return freeze({
    solve: (problem: SchedulingProblem, options: CpSatSolveOptions) =>
      cpSatProblemContentHash(problem) === presolved.contentHash ? presolved.result : fallback.solve(problem, options),
    solveAsync: (problem: SchedulingProblem, options: CpSatSolveOptions) =>
      cpSatProblemContentHash(problem) === presolved.contentHash ? Promise.resolve(presolved.result) : fallback.solveAsync(problem, options),
  });
}

export interface CpSatReadinessProbe {
  readonly name: "cp-sat-solver";
  readonly required: true;
  readonly status: "HEALTHY" | "UNHEALTHY";
  readonly observedAt: string;
  readonly detail: string;
}

/**
 * Production readiness evidence for the pinned CP-SAT runtime (deployment mode A): the solver must
 * solve a fixed two-contest problem to its known optimum on the pinned backend version. Anything else
 * (missing interpreter, version drift, malformed output, a wrong answer) is UNHEALTHY, so traffic is
 * not routed to a host that could only return UNKNOWN for every competition that needs the solver.
 */
export function probeCpSatSolver(observedAt: string, solver: CpSatSolver = createCpSatSolver()): Readonly<CpSatReadinessProbe> {
  const problem: SchedulingProblem = {
    id: "readiness.cp-sat",
    tasks: [
      { id: "A", durationMinutes: 30, eligibleResourceIds: ["court.1"], dependencyIds: [], participantIds: ["p1"] },
      { id: "B", durationMinutes: 30, eligibleResourceIds: ["court.1"], dependencyIds: [], participantIds: ["p2"] },
    ],
    resources: [{ id: "court.1", calendars: [{ startMinute: 0, endMinute: 60 }], closures: [] }],
    locks: [],
    minimumRestMinutes: 0,
  };
  const result = solver.solve(problem, { maxTimeSeconds: 5 });
  const healthy = result.status === "CERTIFIED" && result.objective.optimal && result.objective.valueMinutes === 60
    && result.proof.backendVersion === result.proof.requiredBackendVersion;
  return freeze({ name: "cp-sat-solver" as const, required: true as const, status: healthy ? "HEALTHY" as const : "UNHEALTHY" as const,
    observedAt, detail: healthy ? `OR-Tools ${result.proof.backendVersion} solved the readiness model to its known optimum`
      : `CP-SAT readiness model returned ${result.status} (${result.proof.findings[0] ?? result.proof.backendStatus})` });
}
