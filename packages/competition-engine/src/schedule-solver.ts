import { createHash } from "node:crypto";

export interface SolverMinuteWindow { readonly startMinute: number; readonly endMinute: number; }
export interface SolverResource { readonly id: string; readonly calendars: readonly SolverMinuteWindow[]; readonly closures: readonly SolverMinuteWindow[]; }
export interface SolverTask {
  readonly id: string; readonly durationMinutes: number; readonly eligibleResourceIds: readonly string[];
  readonly dependencyIds: readonly string[]; readonly participantIds: readonly string[];
}
export interface ScheduleLock { readonly taskId: string; readonly resourceId: string; readonly startMinute: number; }
export interface SchedulingProblem {
  readonly id: string; readonly tasks: readonly SolverTask[]; readonly resources: readonly SolverResource[];
  readonly locks: readonly ScheduleLock[]; readonly minimumRestMinutes: number;
}
export interface SolverOptions { readonly maxSearchNodes: number; readonly granularityMinutes?: number; }
export interface SolverAssignment {
  readonly taskId: string; readonly resourceId: string; readonly startMinute: number; readonly endMinute: number;
  readonly locked: boolean;
}
export type ProofStatus = "OPTIMAL" | "FEASIBLE" | "INFEASIBLE" | "UNKNOWN";
export interface SolverProof {
  readonly method: "DETERMINISTIC_BRANCH_AND_BOUND"; readonly searchExhausted: boolean; readonly nodesVisited: number;
  readonly nodeLimit: number; readonly termination: "EXHAUSTED" | "NODE_LIMIT" | "BOUND_MATCH";
  readonly optimalityProvenBy: "EXHAUSTIVE_SEARCH" | "BOUND_MATCH" | null;
  readonly initialLowerBoundMinutes: number; readonly provenLowerBoundMinutes: number;
  readonly lowerBoundEvidence: readonly [
    { readonly kind: "CRITICAL_PATH"; readonly minutes: number },
    { readonly kind: "LOCKED_FINISH"; readonly minutes: number },
  ];
  readonly optimalityGap: number | null; readonly validationErrors: readonly string[]; readonly proofHash: string;
}
export interface SolverResult {
  readonly status: ProofStatus; readonly assignments: readonly SolverAssignment[];
  readonly objectiveValueMinutes: number | null; readonly proof: SolverProof;
}
export interface ScheduleSolverAdapter {
  readonly name: string; readonly version: string;
  solve(problem: SchedulingProblem, options: SolverOptions): SolverResult;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(",")}}`;
  return JSON.stringify(value);
}
function hash(value: unknown): string { return createHash("sha256").update(canonical(value)).digest("hex"); }
function freeze<T>(value: T): Readonly<T> {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
function overlaps(leftStart: number, leftEnd: number, rightStart: number, rightEnd: number): boolean {
  return leftStart < rightEnd && leftEnd > rightStart;
}
function validateWindow(window: SolverMinuteWindow, label: string): void {
  if (!Number.isInteger(window.startMinute) || !Number.isInteger(window.endMinute) || window.startMinute < 0 || window.endMinute <= window.startMinute) {
    throw new Error(`${label} must have non-negative integer bounds and positive duration`);
  }
}
function topologicalTasks(problem: SchedulingProblem): SolverTask[] {
  if (!problem.id.trim()) throw new Error("Scheduling problem id is required");
  if (!Number.isInteger(problem.minimumRestMinutes) || problem.minimumRestMinutes < 0) throw new Error("Minimum rest must be a non-negative integer");
  const taskMap = new Map<string, SolverTask>();
  for (const task of problem.tasks) {
    if (!task.id.trim() || taskMap.has(task.id)) throw new Error(`Task ids must be non-empty and unique: ${task.id}`);
    if (!Number.isInteger(task.durationMinutes) || task.durationMinutes <= 0) throw new Error(`Task ${task.id} has invalid duration`);
    if (!task.eligibleResourceIds.length) throw new Error(`Task ${task.id} has no eligible resource`);
    taskMap.set(task.id, task);
  }
  const resourceIds = new Set<string>();
  for (const resource of problem.resources) {
    if (!resource.id.trim() || resourceIds.has(resource.id)) throw new Error(`Resource ids must be non-empty and unique: ${resource.id}`);
    resourceIds.add(resource.id);
    resource.calendars.forEach((window) => validateWindow(window, `Calendar for ${resource.id}`));
    resource.closures.forEach((window) => validateWindow(window, `Closure for ${resource.id}`));
  }
  for (const task of problem.tasks) {
    for (const id of task.eligibleResourceIds) if (!resourceIds.has(id)) throw new Error(`Task ${task.id} references unknown resource ${id}`);
    for (const id of task.dependencyIds) if (!taskMap.has(id)) throw new Error(`Task ${task.id} references unknown dependency ${id}`);
  }
  const remaining = new Map(problem.tasks.map((task) => [task.id, new Set(task.dependencyIds)]));
  const ordered: SolverTask[] = [];
  while (remaining.size) {
    const ready = [...remaining].filter(([, dependencies]) => dependencies.size === 0).map(([id]) => id).sort();
    if (!ready.length) throw new Error("Task dependency graph is cyclic");
    for (const id of ready) {
      ordered.push(taskMap.get(id)!); remaining.delete(id);
      for (const dependencies of remaining.values()) dependencies.delete(id);
    }
  }
  const lockTasks = new Set<string>();
  for (const lock of problem.locks) {
    if (!taskMap.has(lock.taskId) || !resourceIds.has(lock.resourceId)) throw new Error("Lock references an unknown task or resource");
    if (lockTasks.has(lock.taskId)) throw new Error(`Task ${lock.taskId} has multiple locks`);
    if (!Number.isInteger(lock.startMinute) || lock.startMinute < 0) throw new Error(`Lock for ${lock.taskId} has invalid start`);
    lockTasks.add(lock.taskId);
  }
  return ordered;
}

function calculateLowerBound(tasks: readonly SolverTask[], locks: ReadonlyMap<string, ScheduleLock>): {
  value: number; evidence: SolverProof["lowerBoundEvidence"];
} {
  const longest = new Map<string, number>();
  for (const task of tasks) longest.set(task.id, task.durationMinutes + Math.max(0, ...task.dependencyIds.map((id) => longest.get(id) ?? 0)));
  const criticalPath = Math.max(0, ...longest.values());
  const lockedFinish = Math.max(0, ...tasks.flatMap((task) => {
    const lock = locks.get(task.id);
    return lock ? [lock.startMinute + task.durationMinutes] : [];
  }));
  return { value: Math.max(criticalPath, lockedFinish), evidence: [
    { kind: "CRITICAL_PATH", minutes: criticalPath }, { kind: "LOCKED_FINISH", minutes: lockedFinish },
  ] };
}
function resourceAllows(resource: SolverResource, start: number, end: number): boolean {
  return resource.calendars.some((window) => start >= window.startMinute && end <= window.endMinute)
    && resource.closures.every((closure) => !overlaps(start, end, closure.startMinute, closure.endMinute));
}
function placementsFor(task: SolverTask, resources: ReadonlyMap<string, SolverResource>, lock: ScheduleLock | undefined, granularity: number): SolverAssignment[] {
  if (lock) return [{ taskId: task.id, resourceId: lock.resourceId, startMinute: lock.startMinute,
    endMinute: lock.startMinute + task.durationMinutes, locked: true }];
  const placements: SolverAssignment[] = [];
  for (const resourceId of [...task.eligibleResourceIds].sort()) {
    const resource = resources.get(resourceId)!;
    for (const window of [...resource.calendars].sort((a, b) => a.startMinute - b.startMinute || a.endMinute - b.endMinute)) {
      for (let start = window.startMinute; start + task.durationMinutes <= window.endMinute; start += granularity) {
        const end = start + task.durationMinutes;
        if (resourceAllows(resource, start, end)) placements.push({ taskId: task.id, resourceId, startMinute: start, endMinute: end, locked: false });
      }
    }
  }
  return placements.sort((a, b) => a.endMinute - b.endMinute || a.startMinute - b.startMinute || a.resourceId.localeCompare(b.resourceId));
}
function isCompatible(candidate: SolverAssignment, task: SolverTask, assigned: readonly SolverAssignment[], taskMap: ReadonlyMap<string, SolverTask>, rest: number): boolean {
  const byId = new Map(assigned.map((entry) => [entry.taskId, entry]));
  if (task.dependencyIds.some((id) => !byId.has(id) || candidate.startMinute < byId.get(id)!.endMinute)) return false;
  for (const other of assigned) {
    if (candidate.resourceId === other.resourceId && overlaps(candidate.startMinute, candidate.endMinute, other.startMinute, other.endMinute)) return false;
    const otherTask = taskMap.get(other.taskId)!;
    if (!task.participantIds.some((id) => otherTask.participantIds.includes(id))) continue;
    const rested = candidate.startMinute >= other.endMinute + rest || other.startMinute >= candidate.endMinute + rest;
    if (!rested) return false;
  }
  return true;
}
function validateSolution(problem: SchedulingProblem, assignments: readonly SolverAssignment[]): string[] {
  const errors: string[] = [];
  const taskMap = new Map(problem.tasks.map((task) => [task.id, task]));
  const resourceMap = new Map(problem.resources.map((resource) => [resource.id, resource]));
  const assignmentMap = new Map(assignments.map((assignment) => [assignment.taskId, assignment]));
  if (assignments.length !== problem.tasks.length) errors.push("Not every task is assigned exactly once.");
  if (assignmentMap.size !== assignments.length) errors.push("A task has more than one assignment.");
  for (const assignment of assignments) {
    const task = taskMap.get(assignment.taskId); const resource = resourceMap.get(assignment.resourceId);
    if (!task || !resource || !task.eligibleResourceIds.includes(assignment.resourceId)) { errors.push(`Invalid resource assignment for ${assignment.taskId}.`); continue; }
    if (assignment.endMinute - assignment.startMinute !== task.durationMinutes || !resourceAllows(resource, assignment.startMinute, assignment.endMinute)) errors.push(`Invalid timing for ${assignment.taskId}.`);
    for (const dependencyId of task.dependencyIds) if (assignment.startMinute < (assignmentMap.get(dependencyId)?.endMinute ?? Number.POSITIVE_INFINITY)) {
      errors.push(`Dependency violation for ${assignment.taskId}.`);
    }
  }
  for (const lock of problem.locks) {
    const assignment = assignmentMap.get(lock.taskId);
    if (!assignment || assignment.resourceId !== lock.resourceId || assignment.startMinute !== lock.startMinute) errors.push(`Lock violation for ${lock.taskId}.`);
  }
  for (let left = 0; left < assignments.length; left += 1) for (let right = left + 1; right < assignments.length; right += 1) {
    const a = assignments[left]!; const b = assignments[right]!;
    if (a.resourceId === b.resourceId && overlaps(a.startMinute, a.endMinute, b.startMinute, b.endMinute)) errors.push(`Resource collision: ${a.taskId}/${b.taskId}.`);
    const leftTask = taskMap.get(a.taskId); const rightTask = taskMap.get(b.taskId);
    if (leftTask && rightTask && leftTask.participantIds.some((id) => rightTask.participantIds.includes(id))) {
      const rested = a.startMinute >= b.endMinute + problem.minimumRestMinutes || b.startMinute >= a.endMinute + problem.minimumRestMinutes;
      if (!rested) errors.push(`Participant rest violation: ${a.taskId}/${b.taskId}.`);
    }
  }
  return errors;
}

function solve(problem: SchedulingProblem, options: SolverOptions): SolverResult {
  const tasks = topologicalTasks(problem);
  if (!Number.isInteger(options.maxSearchNodes) || options.maxSearchNodes <= 0) throw new Error("Search node limit must be a positive integer");
  const granularity = options.granularityMinutes ?? 1;
  if (!Number.isInteger(granularity) || granularity <= 0) throw new Error("Granularity must be a positive integer");
  const resources = new Map(problem.resources.map((resource) => [resource.id, resource]));
  const taskMap = new Map(tasks.map((task) => [task.id, task]));
  const locks = new Map(problem.locks.map((lock) => [lock.taskId, lock]));
  const lowerBoundCalculation = calculateLowerBound(tasks, locks);
  const lowerBound = lowerBoundCalculation.value;
  let nodesVisited = 0; let cutoff = false; let incumbent: SolverAssignment[] | undefined; let incumbentValue = Number.POSITIVE_INFINITY;
  const assigned: SolverAssignment[] = [];
  const search = (depth: number): void => {
    if (cutoff || incumbentValue === lowerBound) return;
    if (depth === tasks.length) {
      const objective = Math.max(0, ...assigned.map(({ endMinute }) => endMinute));
      if (objective < incumbentValue) { incumbentValue = objective; incumbent = assigned.map((entry) => ({ ...entry })); }
      return;
    }
    const task = tasks[depth]!;
    for (const candidate of placementsFor(task, resources, locks.get(task.id), granularity)) {
      if (!resourceAllows(resources.get(candidate.resourceId)!, candidate.startMinute, candidate.endMinute)) continue;
      if (!task.eligibleResourceIds.includes(candidate.resourceId) || !isCompatible(candidate, task, assigned, taskMap, problem.minimumRestMinutes)) continue;
      if (Math.max(candidate.endMinute, ...assigned.map(({ endMinute }) => endMinute)) >= incumbentValue) continue;
      if (nodesVisited >= options.maxSearchNodes) { cutoff = true; return; }
      nodesVisited += 1; assigned.push(candidate); search(depth + 1); assigned.pop();
    }
  };
  search(0);
  const boundMatch = Boolean(incumbent) && incumbentValue === lowerBound;
  const exhausted = !cutoff && !boundMatch;
  const status: ProofStatus = incumbent
    ? (exhausted || boundMatch ? "OPTIMAL" : "FEASIBLE")
    : (exhausted ? "INFEASIBLE" : "UNKNOWN");
  const chosen = incumbent ?? [];
  const errors = incumbent ? validateSolution(problem, chosen) : [];
  if (errors.length) throw new Error(`Internal solver validation failed: ${errors.join(" ")}`);
  const objective = incumbent ? incumbentValue : null;
  const provenLowerBound = status === "OPTIMAL" && objective !== null ? objective : lowerBound;
  const gap = objective === null ? null : Math.max(0, (objective - provenLowerBound) / Math.max(1, objective));
  const proofBase = {
    method: "DETERMINISTIC_BRANCH_AND_BOUND" as const, searchExhausted: exhausted, nodesVisited, nodeLimit: options.maxSearchNodes,
    termination: boundMatch ? "BOUND_MATCH" as const : cutoff ? "NODE_LIMIT" as const : "EXHAUSTED" as const,
    optimalityProvenBy: status === "OPTIMAL" ? (boundMatch ? "BOUND_MATCH" as const : "EXHAUSTIVE_SEARCH" as const) : null,
    initialLowerBoundMinutes: lowerBound, provenLowerBoundMinutes: provenLowerBound,
    lowerBoundEvidence: lowerBoundCalculation.evidence, optimalityGap: gap, validationErrors: errors,
  };
  return freeze({ status, assignments: chosen, objectiveValueMinutes: objective, proof: { ...proofBase, proofHash: hash({ problem, options, assignments: chosen, proof: proofBase }) } });
}

export const deterministicExactSolver: ScheduleSolverAdapter = freeze({ name: "tournament-os-exact", version: "1.0.0", solve });
