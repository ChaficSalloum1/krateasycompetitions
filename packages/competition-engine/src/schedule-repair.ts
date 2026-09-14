import { canonicalHash, deepFreeze } from "@tournament-os/tournament-schema";
import type {
  ScheduleLock,
  SchedulingProblem,
  SolverAssignment,
  SolverMinuteWindow,
  SolverTask,
} from "./schedule-solver.js";

export const SCHEDULE_REPAIR_OBJECTIVE_ORDER = [
  "MOVED_CONTESTS",
  "AFFECTED_PARTICIPANTS",
  "TOTAL_START_DISPLACEMENT_MINUTES",
  "RESOURCE_CHANGES",
  "MAKESPAN_MINUTES",
  "PARTICIPANT_WAIT_MINUTES",
  "RESOURCE_IDLE_MINUTES",
] as const;

export interface ScheduleRepairRequest {
  readonly problem: SchedulingProblem;
  readonly baseline: readonly SolverAssignment[];
  /** Baseline contests starting before this minute are immutable. */
  readonly freezeThroughMinute?: number;
  /** Explicitly immutable contests, regardless of start time. */
  readonly pinnedTaskIds?: readonly string[];
}

export interface ScheduleRepairOptions {
  readonly maxSearchNodes: number;
  readonly granularityMinutes?: number;
}

export interface ScheduleRepairObjective {
  readonly movedContests: number;
  readonly affectedParticipants: number;
  readonly totalStartDisplacementMinutes: number;
  readonly resourceChanges: number;
  readonly makespanMinutes: number;
  readonly participantWaitMinutes: number;
  readonly resourceIdleMinutes: number;
  readonly vector: readonly number[];
}

export interface ScheduleRepairDiff {
  readonly taskId: string;
  readonly before: Readonly<SolverAssignment>;
  readonly after: Readonly<SolverAssignment>;
  readonly startDeltaMinutes: number;
  readonly resourceChanged: boolean;
  readonly participantIds: readonly string[];
}

export type ScheduleRepairWhyNotCode =
  | "BASELINE_RESOURCE_CLOSED"
  | "BASELINE_RESOURCE_UNAVAILABLE"
  | "BASELINE_HARD_CONSTRAINT_CONFLICT"
  | "LEXICOGRAPHIC_GLOBAL_REPAIR"
  | "PIN_CONFLICT"
  | "SEARCH_LIMIT";

export interface ScheduleRepairWhyNot {
  readonly taskId: string | null;
  readonly code: ScheduleRepairWhyNotCode;
  readonly message: string;
}

export interface MinimalChangeRepairProof {
  readonly method: "DETERMINISTIC_LEXICOGRAPHIC_REPAIR";
  readonly objectiveOrder: typeof SCHEDULE_REPAIR_OBJECTIVE_ORDER;
  readonly searchExhausted: boolean;
  readonly optimalityProven: boolean;
  readonly nodesVisited: number;
  readonly nodeLimit: number;
  readonly effectiveLockTaskIds: readonly string[];
  readonly baselineHardViolations: readonly string[];
  readonly validationErrors: readonly string[];
  readonly proofHash: string;
}

export interface MinimalChangeScheduleRepairResult {
  readonly status: "REPAIRED" | "UNCHANGED" | "INFEASIBLE" | "UNKNOWN" | "REJECTED";
  readonly assignments: readonly SolverAssignment[] | null;
  readonly objective: Readonly<ScheduleRepairObjective> | null;
  readonly diff: readonly ScheduleRepairDiff[];
  readonly affectedParticipantIds: readonly string[];
  readonly whyNot: readonly ScheduleRepairWhyNot[];
  readonly reason: string;
  readonly proof: Readonly<MinimalChangeRepairProof>;
}

const overlaps = (leftStart: number, leftEnd: number, rightStart: number, rightEnd: number): boolean =>
  leftStart < rightEnd && rightStart < leftEnd;

function inside(window: SolverMinuteWindow, start: number, end: number): boolean {
  return start >= window.startMinute && end <= window.endMinute;
}

function resourceAllows(problem: SchedulingProblem, assignment: SolverAssignment): boolean {
  const resource = problem.resources.find(({ id }) => id === assignment.resourceId);
  return Boolean(resource?.calendars.some((window) => inside(window, assignment.startMinute, assignment.endMinute))
    && resource.closures.every((window) => !overlaps(window.startMinute, window.endMinute, assignment.startMinute, assignment.endMinute)));
}

function topologicalTasks(problem: SchedulingProblem): SolverTask[] | null {
  const byId = new Map(problem.tasks.map((task) => [task.id, task]));
  const remaining = new Map(problem.tasks.map((task) => [task.id, new Set(task.dependencyIds)]));
  const ordered: SolverTask[] = [];
  while (remaining.size) {
    const ready = [...remaining].filter(([, dependencies]) => dependencies.size === 0).map(([id]) => id).sort();
    if (!ready.length) return null;
    for (const id of ready) {
      ordered.push(byId.get(id)!);
      remaining.delete(id);
      for (const dependencies of remaining.values()) dependencies.delete(id);
    }
  }
  return ordered;
}

function validateProblemAndBaseline(request: ScheduleRepairRequest, options: ScheduleRepairOptions): string[] {
  const errors: string[] = [];
  const { problem, baseline } = request;
  if (!problem.id.trim()) errors.push("Scheduling problem id is required.");
  if (!Number.isInteger(options.maxSearchNodes) || options.maxSearchNodes <= 0) errors.push("Search node limit must be a positive integer.");
  const granularity = options.granularityMinutes ?? 1;
  if (!Number.isInteger(granularity) || granularity <= 0) errors.push("Granularity must be a positive integer.");
  if (!Number.isInteger(problem.minimumRestMinutes) || problem.minimumRestMinutes < 0) errors.push("Minimum rest must be a non-negative integer.");
  if (request.freezeThroughMinute !== undefined && (!Number.isInteger(request.freezeThroughMinute) || request.freezeThroughMinute < 0)) {
    errors.push("Freeze horizon must be a non-negative integer minute.");
  }
  const taskIds = problem.tasks.map(({ id }) => id);
  const resourceIds = problem.resources.map(({ id }) => id);
  if (new Set(taskIds).size !== taskIds.length || taskIds.some((id) => !id.trim())) errors.push("Task ids must be non-empty and unique.");
  if (new Set(resourceIds).size !== resourceIds.length || resourceIds.some((id) => !id.trim())) errors.push("Resource ids must be non-empty and unique.");
  for (const resource of problem.resources) {
    if (!resource.calendars.length) errors.push(`Resource ${resource.id} must have at least one calendar window.`);
    for (const window of resource.calendars) if (!Number.isInteger(window.startMinute) || !Number.isInteger(window.endMinute)
      || window.startMinute < 0 || window.endMinute <= window.startMinute) {
      errors.push(`Resource ${resource.id} has an invalid calendar window.`);
    }
    for (const window of resource.closures) if (!Number.isInteger(window.startMinute) || !Number.isInteger(window.endMinute)
      || window.startMinute < 0 || window.endMinute <= window.startMinute) {
      errors.push(`Resource ${resource.id} has an invalid closure window.`);
    }
  }
  if (!topologicalTasks(problem)) errors.push("Task dependency graph is cyclic.");
  const taskById = new Map(problem.tasks.map((task) => [task.id, task]));
  const baselineById = new Map<string, SolverAssignment>();
  for (const assignment of baseline) {
    if (baselineById.has(assignment.taskId)) errors.push(`Baseline contains duplicate assignment for ${assignment.taskId}.`);
    baselineById.set(assignment.taskId, assignment);
    const task = taskById.get(assignment.taskId);
    if (!task) errors.push(`Baseline references unknown task ${assignment.taskId}.`);
    else if (!Number.isInteger(assignment.startMinute) || assignment.startMinute < 0
      || assignment.endMinute !== assignment.startMinute + task.durationMinutes) errors.push(`Baseline timing is invalid for ${assignment.taskId}.`);
  }
  if (baselineById.size !== problem.tasks.length || problem.tasks.some(({ id }) => !baselineById.has(id))) {
    errors.push("Baseline must assign every task exactly once.");
  }
  for (const task of problem.tasks) {
    if (!Number.isInteger(task.durationMinutes) || task.durationMinutes <= 0) errors.push(`Task ${task.id} has invalid duration.`);
    if (!task.eligibleResourceIds.length || task.eligibleResourceIds.some((id) => !resourceIds.includes(id))) errors.push(`Task ${task.id} has an invalid eligible resource.`);
    if (task.dependencyIds.some((id) => !taskById.has(id))) errors.push(`Task ${task.id} has an unknown dependency.`);
  }
  const pins = request.pinnedTaskIds ?? [];
  if (new Set(pins).size !== pins.length) errors.push("Pinned task ids must be unique.");
  for (const id of pins) if (!taskById.has(id)) errors.push(`Pinned task ${id} is unknown.`);
  const lockTaskIds = problem.locks.map(({ taskId }) => taskId);
  if (new Set(lockTaskIds).size !== lockTaskIds.length) errors.push("A task can have at most one hard lock.");
  for (const lock of problem.locks) {
    if (!taskById.has(lock.taskId) || !resourceIds.includes(lock.resourceId)) errors.push(`Hard lock for ${lock.taskId} references an unknown task or resource.`);
    if (!Number.isInteger(lock.startMinute) || lock.startMinute < 0) errors.push(`Hard lock for ${lock.taskId} has an invalid start minute.`);
  }
  return [...new Set(errors)].sort();
}

function hardViolations(problem: SchedulingProblem, assignments: readonly SolverAssignment[], locks: readonly ScheduleLock[] = problem.locks): string[] {
  const errors: string[] = [];
  const taskById = new Map(problem.tasks.map((task) => [task.id, task]));
  const byId = new Map(assignments.map((assignment) => [assignment.taskId, assignment]));
  if (assignments.length !== problem.tasks.length || byId.size !== problem.tasks.length) errors.push("NOT_EVERY_TASK_ASSIGNED");
  for (const assignment of assignments) {
    const task = taskById.get(assignment.taskId);
    if (!task || !task.eligibleResourceIds.includes(assignment.resourceId)) errors.push(`${assignment.taskId}:RESOURCE_INELIGIBLE`);
    else if (assignment.endMinute !== assignment.startMinute + task.durationMinutes) errors.push(`${assignment.taskId}:DURATION_INVALID`);
    if (!resourceAllows(problem, assignment)) errors.push(`${assignment.taskId}:RESOURCE_UNAVAILABLE_OR_CLOSED`);
  }
  for (const task of problem.tasks) {
    const assignment = byId.get(task.id);
    if (!assignment) continue;
    for (const dependencyId of task.dependencyIds) if (assignment.startMinute < (byId.get(dependencyId)?.endMinute ?? Number.POSITIVE_INFINITY)) {
      errors.push(`${task.id}:PRECEDENCE`);
    }
  }
  for (const lock of locks) {
    const assignment = byId.get(lock.taskId);
    if (!assignment || assignment.resourceId !== lock.resourceId || assignment.startMinute !== lock.startMinute) errors.push(`${lock.taskId}:LOCK`);
  }
  for (let leftIndex = 0; leftIndex < assignments.length; leftIndex += 1) for (let rightIndex = leftIndex + 1; rightIndex < assignments.length; rightIndex += 1) {
    const left = assignments[leftIndex]!;
    const right = assignments[rightIndex]!;
    if (left.resourceId === right.resourceId && overlaps(left.startMinute, left.endMinute, right.startMinute, right.endMinute)) {
      errors.push(`${left.taskId}/${right.taskId}:RESOURCE_COLLISION`);
    }
    const leftTask = taskById.get(left.taskId);
    const rightTask = taskById.get(right.taskId);
    if (leftTask && rightTask && leftTask.participantIds.some((id) => rightTask.participantIds.includes(id))) {
      const rested = left.startMinute >= right.endMinute + problem.minimumRestMinutes
        || right.startMinute >= left.endMinute + problem.minimumRestMinutes;
      if (!rested) errors.push(`${left.taskId}/${right.taskId}:PARTICIPANT_REST`);
    }
  }
  return [...new Set(errors)].sort();
}

function moved(before: SolverAssignment, after: SolverAssignment): boolean {
  return before.resourceId !== after.resourceId || before.startMinute !== after.startMinute;
}

export function reconstructScheduleRepairObjective(
  problem: SchedulingProblem,
  baseline: readonly SolverAssignment[],
  candidate: readonly SolverAssignment[],
): Readonly<ScheduleRepairObjective> {
  const baselineById = new Map(baseline.map((assignment) => [assignment.taskId, assignment]));
  const taskById = new Map(problem.tasks.map((task) => [task.id, task]));
  const changed = candidate.filter((assignment) => {
    const before = baselineById.get(assignment.taskId);
    return before ? moved(before, assignment) : true;
  });
  const participants = new Set(changed.flatMap(({ taskId }) => taskById.get(taskId)?.participantIds ?? []));
  const totalStartDisplacementMinutes = changed.reduce((sum, assignment) =>
    sum + Math.abs(assignment.startMinute - (baselineById.get(assignment.taskId)?.startMinute ?? assignment.startMinute)), 0);
  const resourceChanges = changed.filter((assignment) => baselineById.get(assignment.taskId)?.resourceId !== assignment.resourceId).length;
  const makespanMinutes = Math.max(0, ...candidate.map(({ endMinute }) => endMinute));
  let participantWaitMinutes = 0;
  for (const participantId of [...new Set(problem.tasks.flatMap(({ participantIds }) => participantIds))]) {
    const entries = candidate.filter(({ taskId }) => taskById.get(taskId)?.participantIds.includes(participantId))
      .sort((left, right) => left.startMinute - right.startMinute || left.taskId.localeCompare(right.taskId));
    for (let index = 1; index < entries.length; index += 1) participantWaitMinutes += Math.max(0, entries[index]!.startMinute - entries[index - 1]!.endMinute);
  }
  let resourceIdleMinutes = 0;
  for (const resource of problem.resources) {
    const entries = candidate.filter(({ resourceId }) => resourceId === resource.id).sort((left, right) => left.startMinute - right.startMinute);
    for (let index = 1; index < entries.length; index += 1) resourceIdleMinutes += Math.max(0, entries[index]!.startMinute - entries[index - 1]!.endMinute);
  }
  const vector = [changed.length, participants.size, totalStartDisplacementMinutes, resourceChanges, makespanMinutes, participantWaitMinutes, resourceIdleMinutes];
  return deepFreeze({ movedContests: changed.length, affectedParticipants: participants.size, totalStartDisplacementMinutes,
    resourceChanges, makespanMinutes, participantWaitMinutes, resourceIdleMinutes, vector });
}

function compareVectors(left: readonly number[], right: readonly number[]): -1 | 0 | 1 {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    if ((left[index] ?? 0) !== (right[index] ?? 0)) return (left[index] ?? 0) < (right[index] ?? 0) ? -1 : 1;
  }
  return 0;
}

export function compareScheduleRepairObjectives(left: ScheduleRepairObjective, right: ScheduleRepairObjective): -1 | 0 | 1 {
  return compareVectors(left.vector, right.vector);
}

function assignmentKey(assignments: readonly SolverAssignment[]): string {
  return [...assignments].sort((left, right) => left.taskId.localeCompare(right.taskId))
    .map(({ taskId, resourceId, startMinute }) => `${taskId}|${resourceId}|${startMinute}`).join(";");
}

function effectiveLocks(request: ScheduleRepairRequest): ScheduleLock[] {
  const baselineById = new Map(request.baseline.map((assignment) => [assignment.taskId, assignment]));
  const ids = new Set(request.problem.locks.map(({ taskId }) => taskId));
  for (const id of request.pinnedTaskIds ?? []) ids.add(id);
  if (request.freezeThroughMinute !== undefined) for (const assignment of request.baseline) {
    if (assignment.startMinute < request.freezeThroughMinute) ids.add(assignment.taskId);
  }
  const locks = new Map(request.problem.locks.map((lock) => [lock.taskId, lock]));
  for (const id of ids) {
    const baseline = baselineById.get(id);
    if (baseline && !locks.has(id)) locks.set(id, { taskId: id, resourceId: baseline.resourceId, startMinute: baseline.startMinute });
  }
  return [...locks.values()].sort((left, right) => left.taskId.localeCompare(right.taskId));
}

function immutableLockConflicts(request: ScheduleRepairRequest): string[] {
  const immutableIds = new Set(request.pinnedTaskIds ?? []);
  if (request.freezeThroughMinute !== undefined) for (const assignment of request.baseline) {
    if (assignment.startMinute < request.freezeThroughMinute) immutableIds.add(assignment.taskId);
  }
  const baselineById = new Map(request.baseline.map((assignment) => [assignment.taskId, assignment]));
  return request.problem.locks.filter((lock) => {
    if (!immutableIds.has(lock.taskId)) return false;
    const baseline = baselineById.get(lock.taskId);
    return Boolean(baseline && (baseline.resourceId !== lock.resourceId || baseline.startMinute !== lock.startMinute));
  }).map(({ taskId }) => taskId).sort();
}

function candidatePlacements(problem: SchedulingProblem, task: SolverTask, baseline: SolverAssignment, lock: ScheduleLock | undefined, granularity: number): SolverAssignment[] {
  if (lock) return [{ taskId: task.id, resourceId: lock.resourceId, startMinute: lock.startMinute,
    endMinute: lock.startMinute + task.durationMinutes, locked: true }];
  const placements: SolverAssignment[] = [];
  for (const resourceId of [...task.eligibleResourceIds].sort()) {
    const resource = problem.resources.find(({ id }) => id === resourceId)!;
    for (const window of resource.calendars) for (let start = window.startMinute; start + task.durationMinutes <= window.endMinute; start += granularity) {
      const assignment = { taskId: task.id, resourceId, startMinute: start, endMinute: start + task.durationMinutes, locked: false };
      if (resourceAllows(problem, assignment)) placements.push(assignment);
    }
  }
  if (task.eligibleResourceIds.includes(baseline.resourceId) && resourceAllows(problem, baseline)
    && !placements.some(({ resourceId, startMinute }) => resourceId === baseline.resourceId && startMinute === baseline.startMinute)) {
    placements.push({ ...baseline, locked: false });
  }
  return placements.sort((left, right) => Number(moved(baseline, left)) - Number(moved(baseline, right))
    || Math.abs(left.startMinute - baseline.startMinute) - Math.abs(right.startMinute - baseline.startMinute)
    || Number(left.resourceId !== baseline.resourceId) - Number(right.resourceId !== baseline.resourceId)
    || left.startMinute - right.startMinute || left.resourceId.localeCompare(right.resourceId));
}

function compatible(problem: SchedulingProblem, task: SolverTask, candidate: SolverAssignment, assigned: readonly SolverAssignment[]): boolean {
  const byId = new Map(assigned.map((assignment) => [assignment.taskId, assignment]));
  if (task.dependencyIds.some((id) => !byId.has(id) || candidate.startMinute < byId.get(id)!.endMinute)) return false;
  const taskById = new Map(problem.tasks.map((entry) => [entry.id, entry]));
  for (const other of assigned) {
    if (candidate.resourceId === other.resourceId && overlaps(candidate.startMinute, candidate.endMinute, other.startMinute, other.endMinute)) return false;
    const otherTask = taskById.get(other.taskId)!;
    if (task.participantIds.some((id) => otherTask.participantIds.includes(id))) {
      const rested = candidate.startMinute >= other.endMinute + problem.minimumRestMinutes
        || other.startMinute >= candidate.endMinute + problem.minimumRestMinutes;
      if (!rested) return false;
    }
  }
  return true;
}

function whyNotForDiff(problem: SchedulingProblem, diff: readonly ScheduleRepairDiff[]): ScheduleRepairWhyNot[] {
  return diff.map(({ taskId, before }) => {
    const resource = problem.resources.find(({ id }) => id === before.resourceId);
    if (resource?.closures.some((window) => overlaps(window.startMinute, window.endMinute, before.startMinute, before.endMinute))) return {
      taskId, code: "BASELINE_RESOURCE_CLOSED" as const,
      message: `${taskId} cannot retain its baseline slot because ${before.resourceId} is closed.`,
    };
    if (!resource?.calendars.some((window) => inside(window, before.startMinute, before.endMinute))) return {
      taskId, code: "BASELINE_RESOURCE_UNAVAILABLE" as const,
      message: `${taskId} cannot retain its baseline slot because ${before.resourceId} is unavailable.`,
    };
    return { taskId, code: "LEXICOGRAPHIC_GLOBAL_REPAIR" as const,
      message: `${taskId} moves as part of the globally minimal lexicographic repair.` };
  });
}

function finalResult(
  status: MinimalChangeScheduleRepairResult["status"],
  request: ScheduleRepairRequest,
  options: ScheduleRepairOptions,
  locks: readonly ScheduleLock[],
  baselineViolations: readonly string[],
  validationErrors: readonly string[],
  nodesVisited: number,
  exhausted: boolean,
  assignments: readonly SolverAssignment[] | null,
  objective: ScheduleRepairObjective | null,
  whyNot: readonly ScheduleRepairWhyNot[],
  reason: string,
): MinimalChangeScheduleRepairResult {
  const baselineById = new Map(request.baseline.map((assignment) => [assignment.taskId, assignment]));
  const taskById = new Map(request.problem.tasks.map((task) => [task.id, task]));
  const diff: ScheduleRepairDiff[] = (assignments ?? []).filter((assignment) => {
    const before = baselineById.get(assignment.taskId);
    return before && moved(before, assignment);
  }).map((after) => {
    const before = baselineById.get(after.taskId)!;
    return { taskId: after.taskId, before, after, startDeltaMinutes: after.startMinute - before.startMinute,
      resourceChanged: before.resourceId !== after.resourceId, participantIds: [...(taskById.get(after.taskId)?.participantIds ?? [])].sort() };
  }).sort((left, right) => left.taskId.localeCompare(right.taskId));
  const affectedParticipantIds = [...new Set(diff.flatMap(({ participantIds }) => participantIds))].sort();
  const proofBase = { method: "DETERMINISTIC_LEXICOGRAPHIC_REPAIR" as const, objectiveOrder: SCHEDULE_REPAIR_OBJECTIVE_ORDER,
    searchExhausted: exhausted, optimalityProven: exhausted && (status === "REPAIRED" || status === "UNCHANGED" || status === "INFEASIBLE"),
    nodesVisited, nodeLimit: options.maxSearchNodes, effectiveLockTaskIds: locks.map(({ taskId }) => taskId),
    baselineHardViolations: [...baselineViolations], validationErrors: [...validationErrors] };
  const proof = { ...proofBase, proofHash: canonicalHash({ request, options, status, assignments, objective, diff, whyNot, proof: proofBase }) };
  return deepFreeze({ status, assignments, objective, diff, affectedParticipantIds, whyNot, reason, proof });
}

export function planMinimalChangeScheduleRepair(
  request: ScheduleRepairRequest,
  options: ScheduleRepairOptions,
): MinimalChangeScheduleRepairResult {
  const inputErrors = validateProblemAndBaseline(request, options);
  const locks = inputErrors.length ? [] : effectiveLocks(request);
  if (inputErrors.length) return finalResult("REJECTED", request, options, locks, [], inputErrors, 0, false, null, null, [],
    "Repair input is invalid; no schedule is proposed.");
  const baselineViolations = hardViolations(request.problem, request.baseline, locks);
  const lockConflicts = immutableLockConflicts(request);
  if (lockConflicts.length) return finalResult("INFEASIBLE", request, options, locks, baselineViolations, [], 0, true, null, null,
    lockConflicts.map((taskId) => ({ taskId, code: "PIN_CONFLICT" as const,
      message: `${taskId} cannot simultaneously preserve its baseline pin and its existing hard lock.` })),
    "An immutable baseline assignment contradicts an existing hard lock.");
  const tasks = topologicalTasks(request.problem)!;
  const baselineById = new Map(request.baseline.map((assignment) => [assignment.taskId, assignment]));
  const lockById = new Map(locks.map((lock) => [lock.taskId, lock]));
  const granularity = options.granularityMinutes ?? 1;
  let nodesVisited = 0;
  let cutoff = false;
  let incumbent: SolverAssignment[] | null = null;
  let incumbentObjective: ScheduleRepairObjective | null = null;
  const assigned: SolverAssignment[] = [];

  const search = (depth: number): void => {
    if (cutoff) return;
    if (depth === tasks.length) {
      const ordered = [...assigned].sort((left, right) => left.taskId.localeCompare(right.taskId));
      const objective = reconstructScheduleRepairObjective(request.problem, request.baseline, ordered);
      if (!incumbentObjective || compareVectors(objective.vector, incumbentObjective.vector) < 0
        || (compareVectors(objective.vector, incumbentObjective.vector) === 0 && assignmentKey(ordered) < assignmentKey(incumbent!))) {
        incumbent = ordered.map((assignment) => ({ ...assignment }));
        incumbentObjective = objective;
      }
      return;
    }
    const task = tasks[depth]!;
    const baseline = baselineById.get(task.id)!;
    for (const candidate of candidatePlacements(request.problem, task, baseline, lockById.get(task.id), granularity)) {
      if (nodesVisited >= options.maxSearchNodes) { cutoff = true; return; }
      nodesVisited += 1;
      if (!resourceAllows(request.problem, candidate)) continue;
      if (!compatible(request.problem, task, candidate, assigned)) continue;
      if (incumbentObjective) {
        const partialMoved = [...assigned, candidate].filter((entry) => moved(baselineById.get(entry.taskId)!, entry)).length;
        if (partialMoved > incumbentObjective.movedContests) continue;
      }
      assigned.push(candidate);
      search(depth + 1);
      assigned.pop();
      if (cutoff) return;
    }
  };
  search(0);

  if (cutoff) return finalResult("UNKNOWN", request, options, locks, baselineViolations, [], nodesVisited, false, null, null,
    [{ taskId: null, code: "SEARCH_LIMIT", message: "The deterministic search limit was reached before minimality could be proven." }],
    "Repair minimality is unproven; no candidate is released.");
  if (!incumbent || !incumbentObjective) {
    const frozenConflict = locks.some(({ taskId }) => baselineViolations.some((violation) => violation.startsWith(`${taskId}:`)));
    return finalResult("INFEASIBLE", request, options, locks, baselineViolations, [], nodesVisited, true, null, null,
      frozenConflict ? [{ taskId: null, code: "PIN_CONFLICT", message: "A frozen or pinned baseline assignment conflicts with a hard constraint." }] : [],
      "No schedule satisfies the hard constraints and effective locks.");
  }
  // Assignments happen inside the synchronous search closure; retain explicit post-search types for TypeScript's flow analysis.
  const chosenAssignments = incumbent as SolverAssignment[];
  const chosenObjective = incumbentObjective as ScheduleRepairObjective;
  const validationErrors = hardViolations(request.problem, chosenAssignments, locks);
  if (validationErrors.length) return finalResult("REJECTED", request, options, locks, baselineViolations, validationErrors, nodesVisited, true, null, null, [],
    "Independent validation rejected the internal repair candidate.");
  const unchanged = chosenObjective.movedContests === 0;
  const provisional = finalResult(unchanged ? "UNCHANGED" : "REPAIRED", request, options, locks, baselineViolations, [], nodesVisited, true,
    chosenAssignments, chosenObjective, [], unchanged ? "The baseline is already a highest-priority minimal-change outcome."
      : "The schedule is the proven lexicographically minimal hard-constraint repair.");
  return finalResult(provisional.status, request, options, locks, baselineViolations, [], nodesVisited, true, chosenAssignments, chosenObjective,
    whyNotForDiff(request.problem, provisional.diff), provisional.reason);
}
