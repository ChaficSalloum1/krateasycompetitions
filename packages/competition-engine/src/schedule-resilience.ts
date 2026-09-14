import { canonicalHash, deepFreeze } from "@tournament-os/tournament-schema";
import type { SchedulingProblem, SolverAssignment } from "./schedule-solver.js";

export const SCHEDULE_RESILIENCE_OBJECTIVE_ORDER = [
  "WORST_RESOURCE_LOSS_CONTESTS",
  "OVERRUN_CONFLICTS",
  "NOTIFICATION_BLAST_RADIUS",
  "NEGATIVE_MINIMUM_CRITICAL_SLACK",
  "MAKESPAN",
] as const;

export interface ScheduleResilienceCandidate {
  readonly candidateId: string;
  readonly assignments: readonly SolverAssignment[];
}

export interface ScheduleResilienceOptions {
  readonly overrunMinutes: readonly number[];
}

export interface ScheduleResilienceEvidence {
  readonly resourceLoss: {
    readonly byResource: readonly { readonly resourceId: string; readonly contestIds: readonly string[]; readonly affectedParticipantIds: readonly string[] }[];
    readonly worstContestsAffected: number;
    readonly worstParticipantsAffected: number;
  };
  readonly overrun: {
    readonly byMinutes: readonly { readonly overrunMinutes: number; readonly conflictCount: number;
      readonly contestIds: readonly string[]; readonly affectedParticipantIds: readonly string[] }[];
    readonly totalConflictCount: number;
  };
  readonly minimumCriticalSlackMinutes: number | null;
  readonly makespanMinutes: number;
  readonly notificationBlastRadius: number;
}

export interface RankedScheduleResilienceCandidate extends ScheduleResilienceCandidate {
  readonly evidence: ScheduleResilienceEvidence;
  readonly objectiveVector: readonly number[];
  readonly evidenceHash: string;
}

export interface RejectedScheduleResilienceCandidate {
  readonly candidateId: string;
  readonly findings: readonly string[];
}

export interface ScheduleResilienceRanking {
  readonly schemaVersion: "1.0.0";
  readonly status: "RANKED" | "REJECTED";
  readonly objectiveOrder: typeof SCHEDULE_RESILIENCE_OBJECTIVE_ORDER;
  readonly candidates: readonly RankedScheduleResilienceCandidate[];
  readonly rejectedCandidates: readonly RejectedScheduleResilienceCandidate[];
  readonly proofHash: string;
}

const overlaps = (leftStart: number, leftEnd: number, rightStart: number, rightEnd: number): boolean =>
  leftStart < rightEnd && rightStart < leftEnd;

function validateCandidate(problem: SchedulingProblem, assignments: readonly SolverAssignment[]): string[] {
  const findings: string[] = [];
  const taskById = new Map(problem.tasks.map((task) => [task.id, task]));
  const resourceById = new Map(problem.resources.map((resource) => [resource.id, resource]));
  const byTask = new Map(assignments.map((assignment) => [assignment.taskId, assignment]));
  if (assignments.length !== problem.tasks.length || byTask.size !== problem.tasks.length
    || problem.tasks.some(({ id }) => !byTask.has(id))) findings.push("Every task must be assigned exactly once.");
  for (const assignment of assignments) {
    const task = taskById.get(assignment.taskId);
    const resource = resourceById.get(assignment.resourceId);
    if (!task) { findings.push(`${assignment.taskId} is not a known task.`); continue; }
    if (!resource || !task.eligibleResourceIds.includes(assignment.resourceId)) findings.push(`${assignment.taskId} uses an ineligible resource.`);
    if (!Number.isInteger(assignment.startMinute) || assignment.startMinute < 0
      || assignment.endMinute !== assignment.startMinute + task.durationMinutes) findings.push(`${assignment.taskId} has invalid timing.`);
    if (resource && (!resource.calendars.some(({ startMinute, endMinute }) => assignment.startMinute >= startMinute && assignment.endMinute <= endMinute)
      || resource.closures.some(({ startMinute, endMinute }) => overlaps(assignment.startMinute, assignment.endMinute, startMinute, endMinute)))) {
      findings.push(`${assignment.taskId} is outside its resource calendar.`);
    }
    for (const dependencyId of task.dependencyIds) if (assignment.startMinute < (byTask.get(dependencyId)?.endMinute ?? Number.POSITIVE_INFINITY)) {
      findings.push(`${assignment.taskId} violates dependency ${dependencyId}.`);
    }
  }
  for (const lock of problem.locks) {
    const assignment = byTask.get(lock.taskId);
    if (!assignment || assignment.resourceId !== lock.resourceId || assignment.startMinute !== lock.startMinute) findings.push(`${lock.taskId} violates its hard lock.`);
  }
  for (let leftIndex = 0; leftIndex < assignments.length; leftIndex += 1) for (let rightIndex = leftIndex + 1; rightIndex < assignments.length; rightIndex += 1) {
    const left = assignments[leftIndex]!; const right = assignments[rightIndex]!;
    if (!overlaps(left.startMinute, left.endMinute, right.startMinute, right.endMinute)) continue;
    if (left.resourceId === right.resourceId) findings.push(`${left.taskId} and ${right.taskId} overlap on one resource.`);
    const leftParticipants = taskById.get(left.taskId)?.participantIds ?? [];
    const rightParticipants = taskById.get(right.taskId)?.participantIds ?? [];
    if (leftParticipants.some((id) => rightParticipants.includes(id))) findings.push(`${left.taskId} and ${right.taskId} overlap for one participant.`);
  }
  for (const participantId of [...new Set(problem.tasks.flatMap(({ participantIds }) => participantIds))]) {
    const entries = assignments.filter(({ taskId }) => taskById.get(taskId)?.participantIds.includes(participantId))
      .sort((left, right) => left.startMinute - right.startMinute || left.taskId.localeCompare(right.taskId));
    for (let index = 1; index < entries.length; index += 1) if (entries[index]!.startMinute < entries[index - 1]!.endMinute + problem.minimumRestMinutes) {
      findings.push(`${participantId} does not receive minimum rest between ${entries[index - 1]!.taskId} and ${entries[index]!.taskId}.`);
    }
  }
  return [...new Set(findings)].sort();
}

function evidenceFor(problem: SchedulingProblem, assignments: readonly SolverAssignment[], overrunMinutes: readonly number[]): ScheduleResilienceEvidence {
  const taskById = new Map(problem.tasks.map((task) => [task.id, task]));
  const participantsFor = (contestIds: readonly string[]): string[] => [...new Set(contestIds.flatMap((id) => taskById.get(id)?.participantIds ?? []))].sort();
  const byResource = problem.resources.map(({ id: resourceId }) => {
    const contestIds = assignments.filter((assignment) => assignment.resourceId === resourceId).map(({ taskId }) => taskId).sort();
    return { resourceId, contestIds, affectedParticipantIds: participantsFor(contestIds) };
  }).sort((left, right) => left.resourceId.localeCompare(right.resourceId));
  const byMinutes = overrunMinutes.map((minutes) => {
    const conflicts = new Set<string>();
    for (let firstIndex = 0; firstIndex < assignments.length; firstIndex += 1) for (let secondIndex = firstIndex + 1; secondIndex < assignments.length; secondIndex += 1) {
      const first = assignments[firstIndex]!; const second = assignments[secondIndex]!;
      const [earlier, later] = first.startMinute <= second.startMinute ? [first, second] : [second, first];
      if (!overlaps(earlier.startMinute, earlier.endMinute + minutes, later.startMinute, later.endMinute)) continue;
      const sharedParticipant = (taskById.get(earlier.taskId)?.participantIds ?? [])
        .some((id) => taskById.get(later.taskId)?.participantIds.includes(id));
      if (earlier.resourceId === later.resourceId || sharedParticipant || taskById.get(later.taskId)?.dependencyIds.includes(earlier.taskId)) {
        conflicts.add([earlier.taskId, later.taskId].sort().join("|"));
      }
    }
    const contestIds = [...new Set([...conflicts].flatMap((key) => key.split("|")))].sort();
    return { overrunMinutes: minutes, conflictCount: conflicts.size, contestIds, affectedParticipantIds: participantsFor(contestIds) };
  });
  const dependencySlack = problem.tasks.flatMap((task) => task.dependencyIds.map((dependencyId) => {
    const taskAssignment = assignments.find(({ taskId }) => taskId === task.id)!;
    const dependency = assignments.find(({ taskId }) => taskId === dependencyId)!;
    return taskAssignment.startMinute - dependency.endMinute;
  }));
  return {
    resourceLoss: { byResource, worstContestsAffected: Math.max(0, ...byResource.map(({ contestIds }) => contestIds.length)),
      worstParticipantsAffected: Math.max(0, ...byResource.map(({ affectedParticipantIds }) => affectedParticipantIds.length)) },
    overrun: { byMinutes, totalConflictCount: byMinutes.reduce((total, entry) => total + entry.conflictCount, 0) },
    minimumCriticalSlackMinutes: dependencySlack.length ? Math.min(...dependencySlack) : null,
    makespanMinutes: Math.max(0, ...assignments.map(({ endMinute }) => endMinute)),
    notificationBlastRadius: Math.max(0, ...byResource.map(({ affectedParticipantIds }) => affectedParticipantIds.length),
      ...byMinutes.map(({ affectedParticipantIds }) => affectedParticipantIds.length)),
  };
}

function compareVector(left: readonly number[], right: readonly number[]): number {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) if ((left[index] ?? 0) !== (right[index] ?? 0)) {
    return (left[index] ?? 0) - (right[index] ?? 0);
  }
  return 0;
}

export function rankSchedulesByResilience(problem: SchedulingProblem, candidates: readonly ScheduleResilienceCandidate[],
  options: ScheduleResilienceOptions): Readonly<ScheduleResilienceRanking> {
  if (!candidates.length || new Set(candidates.map(({ candidateId }) => candidateId)).size !== candidates.length
    || candidates.some(({ candidateId }) => !candidateId.trim()) || !options.overrunMinutes.length
    || options.overrunMinutes.some((value) => !Number.isInteger(value) || value <= 0)
    || new Set(options.overrunMinutes).size !== options.overrunMinutes.length) throw new Error("Resilience ranking requires unique candidates and unique positive overrun scenarios");
  const scenarios = [...options.overrunMinutes].sort((left, right) => left - right);
  const rejectedCandidates: RejectedScheduleResilienceCandidate[] = [];
  const ranked: RankedScheduleResilienceCandidate[] = [];
  for (const candidate of candidates) {
    const findings = validateCandidate(problem, candidate.assignments);
    if (findings.length) { rejectedCandidates.push({ candidateId: candidate.candidateId, findings }); continue; }
    const assignments = [...candidate.assignments].sort((left, right) => left.taskId.localeCompare(right.taskId));
    const evidence = evidenceFor(problem, assignments, scenarios);
    const objectiveVector = [evidence.resourceLoss.worstContestsAffected, evidence.overrun.totalConflictCount,
      evidence.notificationBlastRadius, -(evidence.minimumCriticalSlackMinutes ?? Number.MAX_SAFE_INTEGER), evidence.makespanMinutes];
    ranked.push({ candidateId: candidate.candidateId, assignments, evidence, objectiveVector,
      evidenceHash: canonicalHash({ problem, assignments, scenarios, evidence, objectiveVector }) });
  }
  ranked.sort((left, right) => compareVector(left.objectiveVector, right.objectiveVector) || left.candidateId.localeCompare(right.candidateId));
  rejectedCandidates.sort((left, right) => left.candidateId.localeCompare(right.candidateId));
  const body = { schemaVersion: "1.0.0" as const, status: ranked.length ? "RANKED" as const : "REJECTED" as const,
    objectiveOrder: SCHEDULE_RESILIENCE_OBJECTIVE_ORDER, candidates: ranked, rejectedCandidates };
  return deepFreeze({ ...body, proofHash: canonicalHash(body) });
}
