import { canonicalHash, deepFreeze, type ValidationFinding } from "@tournament-os/tournament-schema";

export type ResourceKind = "venue" | "official" | "equipment";

export interface TimeWindowSource { start: string; end: string; }
export interface ContestResourceRequirementSource { resourceKind: ResourceKind; resourceType: string; quantity: number; }
export interface ScheduleContestSource {
  id: string;
  durationMinutes: number;
  participantIds: readonly string[];
  requirements: readonly ContestResourceRequirementSource[];
}
export interface PrecedenceSource { beforeContestId: string; afterContestId: string; minimumLagMinutes?: number; }
export interface ResourceUnitSource { id: string; kind: ResourceKind; type: string; availability: readonly TimeWindowSource[]; }
export interface ResourceClosureSource extends TimeWindowSource { resourceUnitId: string; }
export interface HardLockSource { contestId: string; start: string; end?: string; resourceUnitIds?: readonly string[]; }
export interface LegacyScheduleConstraintSource {
  id: string;
  rule: string;
  strength: "HARD" | "SOFT";
  value?: string | number | boolean | Readonly<{ resourceUnitId?: string; start: string; end: string }>;
}
export type ScheduleObjectiveKind =
  | "earliest_finish"
  | "minimum_resource_idle"
  | "minimum_participant_waiting"
  | "balanced_participant_rest"
  | "minimum_resource_changes";
export interface ScheduleObjectiveSource { kind: ScheduleObjectiveKind; priority: number; weight?: number; }

export interface ScheduleModelSource {
  horizon: TimeWindowSource;
  contests: readonly ScheduleContestSource[];
  precedence: readonly PrecedenceSource[];
  resourceUnits: readonly ResourceUnitSource[];
  closures: readonly ResourceClosureSource[];
  locks: readonly HardLockSource[];
  constraints?: readonly LegacyScheduleConstraintSource[];
  minimumRestMinutes: number;
  objectives: readonly ScheduleObjectiveSource[];
}

export interface MinuteWindow { startMinute: number; endMinute: number; }
export interface NormalizedScheduleContest {
  id: string;
  durationMinutes: number;
  participantIds: string[];
  requirements: ContestResourceRequirementSource[];
}
export interface NormalizedPrecedence { beforeContestId: string; afterContestId: string; minimumLagMinutes: number; }
export interface NormalizedResourceUnit { id: string; kind: ResourceKind; type: string; availability: MinuteWindow[]; }
export interface NormalizedHardLock { contestId: string; startMinute: number; endMinute: number; resourceUnitIds: string[]; }
export interface ParticipantConflict {
  leftContestId: string;
  rightContestId: string;
  participantIds: string[];
  minimumRestMinutes: number;
}
export interface NormalizedScheduleObjective { kind: ScheduleObjectiveKind; priority: number; weight: number; }

export interface NormalizedScheduleModel {
  horizonMinutes: number;
  contests: NormalizedScheduleContest[];
  precedence: NormalizedPrecedence[];
  resourceUnits: NormalizedResourceUnit[];
  locks: NormalizedHardLock[];
  participantConflicts: ParticipantConflict[];
  minimumRestMinutes: number;
  objectives: NormalizedScheduleObjective[];
}

export type ScheduleModelCompilation =
  | { valid: true; model: Readonly<NormalizedScheduleModel>; findings: readonly []; proofHash: string }
  | { valid: false; findings: readonly ValidationFinding[]; proofHash: string };

const error = (code: string, path: string, message: string, evidence: Record<string, unknown>): ValidationFinding => ({
  code, severity: "ERROR", path, message, evidence,
});

const serialized = (value: unknown): unknown => JSON.parse(JSON.stringify(value)) as unknown;

function invalid(source: ScheduleModelSource, findings: ValidationFinding[]): ScheduleModelCompilation {
  const ordered = findings.sort((left, right) => left.path.localeCompare(right.path) || left.code.localeCompare(right.code) || left.message.localeCompare(right.message));
  return deepFreeze({ valid: false as const, findings: ordered, proofHash: canonicalHash({ source: serialized(source), findings: ordered }) });
}

function parseInstant(value: string): number | undefined {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function relativeMinute(value: string, horizonStart: number): number | undefined {
  const instant = parseInstant(value);
  if (instant === undefined) return undefined;
  const relative = (instant - horizonStart) / 60_000;
  return Number.isInteger(relative) ? relative : undefined;
}

function duplicates(values: readonly string[]): string[] {
  return [...new Set(values.filter((value, index) => values.indexOf(value) !== index))].sort();
}

function overlap(leftStart: number, leftEnd: number, rightStart: number, rightEnd: number): boolean {
  return leftStart < rightEnd && rightStart < leftEnd;
}

function subtractClosures(windows: MinuteWindow[], closures: MinuteWindow[]): MinuteWindow[] {
  let current = windows;
  for (const closure of closures) {
    current = current.flatMap((window): MinuteWindow[] => {
      if (!overlap(window.startMinute, window.endMinute, closure.startMinute, closure.endMinute)) return [window];
      const result: MinuteWindow[] = [];
      if (window.startMinute < closure.startMinute) result.push({ startMinute: window.startMinute, endMinute: closure.startMinute });
      if (closure.endMinute < window.endMinute) result.push({ startMinute: closure.endMinute, endMinute: window.endMinute });
      return result;
    });
  }
  return current;
}

function hasCycle(contestIds: readonly string[], precedence: readonly NormalizedPrecedence[]): boolean {
  const outgoing = new Map(contestIds.map((id) => [id, [] as string[]]));
  const indegree = new Map(contestIds.map((id) => [id, 0]));
  for (const edge of precedence) {
    outgoing.get(edge.beforeContestId)?.push(edge.afterContestId);
    indegree.set(edge.afterContestId, (indegree.get(edge.afterContestId) ?? 0) + 1);
  }
  const queue = [...indegree].filter(([, count]) => count === 0).map(([id]) => id).sort();
  let visited = 0;
  while (queue.length) {
    const id = queue.shift()!;
    visited += 1;
    for (const next of (outgoing.get(id) ?? []).sort()) {
      const remaining = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, remaining);
      if (remaining === 0) queue.push(next);
    }
    queue.sort();
  }
  return visited !== contestIds.length;
}

export function compileScheduleModel(source: ScheduleModelSource): ScheduleModelCompilation {
  const findings: ValidationFinding[] = [];
  const horizonStart = parseInstant(source.horizon.start);
  const horizonEnd = parseInstant(source.horizon.end);
  if (horizonStart === undefined || horizonEnd === undefined || horizonStart >= horizonEnd || (horizonEnd - horizonStart) % 60_000 !== 0) {
    findings.push(error("TSC410", "/scheduleModel/horizon", "Scheduling horizon must be a valid positive whole-minute interval.", { horizon: source.horizon }));
    return invalid(source, findings);
  }
  const horizonMinutes = (horizonEnd - horizonStart) / 60_000;

  const constraintLocks: HardLockSource[] = [];
  const constraintClosures: ResourceClosureSource[] = [];
  for (const constraint of source.constraints ?? []) {
    if (constraint.rule === "locked_match_start") {
      const contestId = constraint.id.startsWith("lock.") ? constraint.id.slice("lock.".length) : "";
      if (constraint.strength !== "HARD" || !contestId || typeof constraint.value !== "string") {
        findings.push(error("TSC412", `/scheduleModel/constraints/${constraint.id}`, "A locked_match_start constraint must be HARD, use id 'lock.<contestId>', and carry an ISO timestamp.", { constraint: serialized(constraint) as Record<string, unknown> }));
      } else {
        constraintLocks.push({ contestId, start: constraint.value, resourceUnitIds: [] });
      }
    }
    if (constraint.rule === "resource_closure") {
      const value = constraint.value;
      const resourceUnitId = constraint.id.startsWith("closure.") ? constraint.id.slice("closure.".length) : "";
      if (constraint.strength !== "HARD" || !resourceUnitId || typeof value !== "object" || value === null || !("start" in value) || !("end" in value) || typeof value.start !== "string" || typeof value.end !== "string") {
        findings.push(error("TSC413", `/scheduleModel/constraints/${constraint.id}`, "A resource_closure constraint must be HARD, use id 'closure.<resourceUnitId>', and carry start/end timestamps.", { constraint: serialized(constraint) as Record<string, unknown> }));
      } else {
        constraintClosures.push({ resourceUnitId, start: value.start, end: value.end });
      }
    }
  }
  const allLocks = [...source.locks, ...constraintLocks];
  const allClosures = [...source.closures, ...constraintClosures];

  const duplicateContestIds = duplicates(source.contests.map(({ id }) => id));
  const duplicateResourceIds = duplicates(source.resourceUnits.map(({ id }) => id));
  const duplicateLockContestIds = duplicates(allLocks.map(({ contestId }) => contestId));
  if (duplicateContestIds.length) findings.push(error("TSC410", "/scheduleModel/contests", "Contest ids must be unique.", { duplicateContestIds }));
  if (duplicateResourceIds.length) findings.push(error("TSC410", "/scheduleModel/resourceUnits", "Resource unit ids must be unique.", { duplicateResourceIds }));
  if (duplicateLockContestIds.length) findings.push(error("TSC412", "/scheduleModel/locks", "A contest can have at most one hard lock.", { duplicateLockContestIds }));
  if (!Number.isInteger(source.minimumRestMinutes) || source.minimumRestMinutes < 0) {
    findings.push(error("TSC410", "/scheduleModel/minimumRestMinutes", "Minimum rest must be a non-negative integer.", { minimumRestMinutes: source.minimumRestMinutes }));
  }

  const contests: NormalizedScheduleContest[] = [...source.contests].sort((left, right) => left.id.localeCompare(right.id)).map((contest) => {
    if (!Number.isInteger(contest.durationMinutes) || contest.durationMinutes <= 0) {
      findings.push(error("TSC410", `/scheduleModel/contests/${contest.id}/durationMinutes`, "Contest duration must be a positive integer.", { durationMinutes: contest.durationMinutes }));
    }
    const duplicateParticipantIds = duplicates(contest.participantIds);
    if (duplicateParticipantIds.length) findings.push(error("TSC410", `/scheduleModel/contests/${contest.id}/participantIds`, "A participant cannot occupy multiple conflict slots in one contest.", { duplicateParticipantIds }));
    const suppliedRequirements = [...contest.requirements].map((requirement) => ({ ...requirement })).sort((left, right) =>
      left.resourceKind.localeCompare(right.resourceKind) || left.resourceType.localeCompare(right.resourceType));
    for (const requirement of suppliedRequirements) if (!Number.isInteger(requirement.quantity) || requirement.quantity <= 0) {
      findings.push(error("TSC410", `/scheduleModel/contests/${contest.id}/requirements`, "Resource quantities must be positive integers.", { requirement }));
    }
    const requirementTotals = new Map<string, ContestResourceRequirementSource>();
    for (const requirement of suppliedRequirements) {
      const key = `${requirement.resourceKind}|${requirement.resourceType}`;
      const existing = requirementTotals.get(key);
      requirementTotals.set(key, { ...requirement, quantity: (existing?.quantity ?? 0) + requirement.quantity });
    }
    const requirements = [...requirementTotals.values()];
    return { id: contest.id, durationMinutes: contest.durationMinutes, participantIds: [...new Set(contest.participantIds)].sort(), requirements };
  });
  const contestById = new Map(contests.map((contest) => [contest.id, contest]));

  const precedence: NormalizedPrecedence[] = source.precedence.map((edge) => ({
    beforeContestId: edge.beforeContestId,
    afterContestId: edge.afterContestId,
    minimumLagMinutes: edge.minimumLagMinutes ?? 0,
  })).sort((left, right) => left.beforeContestId.localeCompare(right.beforeContestId) || left.afterContestId.localeCompare(right.afterContestId));
  for (const edge of precedence) {
    const unknownContestIds = [edge.beforeContestId, edge.afterContestId].filter((id) => !contestById.has(id));
    if (unknownContestIds.length) findings.push(error("TSC411", "/scheduleModel/precedence", "Precedence references unknown contests.", { edge, unknownContestIds }));
    if (edge.beforeContestId === edge.afterContestId || !Number.isInteger(edge.minimumLagMinutes) || edge.minimumLagMinutes < 0) {
      findings.push(error("TSC410", "/scheduleModel/precedence", "Precedence must connect different contests with a non-negative integer lag.", { edge }));
    }
  }
  if (!findings.some(({ code }) => code === "TSC411") && hasCycle(contests.map(({ id }) => id), precedence)) {
    findings.push(error("TSC415", "/scheduleModel/precedence", "Precedence graph contains a cycle.", {}));
  }

  const closuresByResource = new Map<string, MinuteWindow[]>();
  const resourceSourceById = new Map(source.resourceUnits.map((resource) => [resource.id, resource]));
  for (const closure of [...allClosures].sort((left, right) => left.resourceUnitId.localeCompare(right.resourceUnitId) || left.start.localeCompare(right.start))) {
    const startMinute = relativeMinute(closure.start, horizonStart);
    const endMinute = relativeMinute(closure.end, horizonStart);
    if (!resourceSourceById.has(closure.resourceUnitId)) {
      findings.push(error("TSC411", `/scheduleModel/closures/${closure.resourceUnitId}`, "Closure references an unknown resource unit.", { resourceUnitId: closure.resourceUnitId }));
    } else if (startMinute === undefined || endMinute === undefined || startMinute < 0 || endMinute > horizonMinutes || startMinute >= endMinute) {
      findings.push(error("TSC413", `/scheduleModel/closures/${closure.resourceUnitId}`, "Closure must be a valid whole-minute interval inside the horizon.", { closure }));
    } else {
      const windows = closuresByResource.get(closure.resourceUnitId) ?? [];
      windows.push({ startMinute, endMinute });
      closuresByResource.set(closure.resourceUnitId, windows);
    }
  }

  const resourceUnits: NormalizedResourceUnit[] = [...source.resourceUnits].sort((left, right) => left.id.localeCompare(right.id)).map((resource) => {
    const availability: MinuteWindow[] = [];
    for (const window of resource.availability) {
      const rawStart = relativeMinute(window.start, horizonStart);
      const rawEnd = relativeMinute(window.end, horizonStart);
      if (rawStart === undefined || rawEnd === undefined || rawStart >= rawEnd) {
        findings.push(error("TSC413", `/scheduleModel/resourceUnits/${resource.id}/availability`, "Availability must contain valid positive whole-minute intervals.", { window }));
        continue;
      }
      const startMinute = Math.max(0, rawStart);
      const endMinute = Math.min(horizonMinutes, rawEnd);
      if (startMinute < endMinute) availability.push({ startMinute, endMinute });
    }
    availability.sort((left, right) => left.startMinute - right.startMinute || left.endMinute - right.endMinute);
    for (let index = 1; index < availability.length; index += 1) if (availability[index]!.startMinute < availability[index - 1]!.endMinute) {
      findings.push(error("TSC413", `/scheduleModel/resourceUnits/${resource.id}/availability`, "Availability intervals must not overlap.", { intervals: availability }));
    }
    const closures = (closuresByResource.get(resource.id) ?? []).sort((left, right) => left.startMinute - right.startMinute);
    for (const closure of closures) if (!availability.some((window) => closure.startMinute >= window.startMinute && closure.endMinute <= window.endMinute)) {
      findings.push(error("TSC413", `/scheduleModel/closures/${resource.id}`, "A closure must be contained by declared resource availability.", { closure, availability }));
    }
    const effective = subtractClosures(availability, closures);
    if (effective.length === 0) findings.push(error("TSC413", `/scheduleModel/resourceUnits/${resource.id}/availability`, "Resource unit has no effective availability.", { resourceUnitId: resource.id }));
    return { id: resource.id, kind: resource.kind, type: resource.type, availability: effective };
  });
  const resourceById = new Map(resourceUnits.map((resource) => [resource.id, resource]));

  for (const contest of contests) for (const requirement of contest.requirements) {
    const availableCount = resourceUnits.filter(({ kind, type }) => kind === requirement.resourceKind && type === requirement.resourceType).length;
    if (availableCount < requirement.quantity) findings.push(error(
      "TSC416", `/scheduleModel/contests/${contest.id}/requirements`, "Contest resource requirement cannot be supplied by known typed units.",
      { contestId: contest.id, requirement, availableCount },
    ));
  }

  const locks: NormalizedHardLock[] = [];
  for (const lock of [...allLocks].sort((left, right) => left.contestId.localeCompare(right.contestId))) {
    const contest = contestById.get(lock.contestId);
    const startMinute = relativeMinute(lock.start, horizonStart);
    const suppliedEndMinute = lock.end ? relativeMinute(lock.end, horizonStart) : undefined;
    const resourceUnitIds = [...(lock.resourceUnitIds ?? [])];
    const duplicateLockResourceIds = duplicates(resourceUnitIds);
    const unknownResourceUnitIds = resourceUnitIds.filter((id) => !resourceById.has(id)).sort();
    if (!contest || unknownResourceUnitIds.length) {
      findings.push(error("TSC411", `/scheduleModel/locks/${lock.contestId}`, "Hard lock references an unknown contest or resource unit.", { contestId: lock.contestId, contestExists: contest !== undefined, unknownResourceUnitIds }));
      continue;
    }
    const endMinute = startMinute === undefined ? undefined : startMinute + contest.durationMinutes;
    if (startMinute === undefined || endMinute === undefined || startMinute < 0 || endMinute > horizonMinutes || (lock.end !== undefined && suppliedEndMinute === undefined) || (suppliedEndMinute !== undefined && suppliedEndMinute !== endMinute)) {
      findings.push(error("TSC412", `/scheduleModel/locks/${lock.contestId}`, "Hard lock timing must fit the horizon and exactly match contest duration.", { contestId: lock.contestId, startMinute: startMinute ?? null, computedEndMinute: endMinute ?? null, suppliedEndMinute: suppliedEndMinute ?? null }));
      continue;
    }
    const selectedResources = resourceUnitIds.map((id) => resourceById.get(id)!);
    const unavailableResourceIds = selectedResources.filter(({ availability }) => !availability.some((window) => startMinute >= window.startMinute && endMinute <= window.endMinute)).map(({ id }) => id).sort();
    const unsatisfiedRequirements = resourceUnitIds.length === 0 ? [] : contest.requirements.filter((requirement) => selectedResources.filter(({ kind, type }) => kind === requirement.resourceKind && type === requirement.resourceType).length !== requirement.quantity);
    const requiredResourceKeys = new Set(contest.requirements.map(({ resourceKind, resourceType }) => `${resourceKind}|${resourceType}`));
    const unexpectedResourceUnitIds = selectedResources.filter(({ kind, type }) => !requiredResourceKeys.has(`${kind}|${type}`)).map(({ id }) => id).sort();
    if (duplicateLockResourceIds.length || unavailableResourceIds.length || unsatisfiedRequirements.length || unexpectedResourceUnitIds.length) {
      findings.push(error("TSC412", `/scheduleModel/locks/${lock.contestId}`, "Hard lock resources are unavailable or do not exactly satisfy typed requirements.", { duplicateLockResourceIds, unavailableResourceIds, unsatisfiedRequirements, unexpectedResourceUnitIds }));
    }
    locks.push({ contestId: lock.contestId, startMinute, endMinute, resourceUnitIds: [...new Set(resourceUnitIds)].sort() });
  }

  for (let leftIndex = 0; leftIndex < locks.length; leftIndex += 1) for (let rightIndex = leftIndex + 1; rightIndex < locks.length; rightIndex += 1) {
    const left = locks[leftIndex]!;
    const right = locks[rightIndex]!;
    const sharedResourceUnitIds = left.resourceUnitIds.filter((id) => right.resourceUnitIds.includes(id));
    const sharedParticipantIds = contestById.get(left.contestId)!.participantIds.filter((id) => contestById.get(right.contestId)!.participantIds.includes(id));
    if (overlap(left.startMinute, left.endMinute, right.startMinute, right.endMinute)) {
      if (sharedResourceUnitIds.length || sharedParticipantIds.length) findings.push(error(
        "TSC412", "/scheduleModel/locks", "Hard locks create a resource or participant collision.",
        { contestIds: [left.contestId, right.contestId], sharedResourceUnitIds, sharedParticipantIds },
      ));
    }
    if (sharedParticipantIds.length) {
      const [earlier, later] = left.startMinute < right.startMinute ? [left, right] : [right, left];
      const actualRestMinutes = later.startMinute - earlier.endMinute;
      if (actualRestMinutes < source.minimumRestMinutes) findings.push(error(
        "TSC412", "/scheduleModel/locks", "Hard locks violate participant minimum rest.",
        { contestIds: [earlier.contestId, later.contestId], sharedParticipantIds, actualRestMinutes, minimumRestMinutes: source.minimumRestMinutes },
      ));
    }
  }
  for (const edge of precedence) {
    const before = locks.find(({ contestId }) => contestId === edge.beforeContestId);
    const after = locks.find(({ contestId }) => contestId === edge.afterContestId);
    if (before && after && after.startMinute < before.endMinute + edge.minimumLagMinutes) findings.push(error(
      "TSC412", "/scheduleModel/locks", "Hard locks violate precedence or its minimum lag.", { edge, before, after },
    ));
  }

  const participantConflicts: ParticipantConflict[] = [];
  for (let leftIndex = 0; leftIndex < contests.length; leftIndex += 1) for (let rightIndex = leftIndex + 1; rightIndex < contests.length; rightIndex += 1) {
    const left = contests[leftIndex]!;
    const right = contests[rightIndex]!;
    const participantIds = left.participantIds.filter((id) => right.participantIds.includes(id));
    if (participantIds.length) participantConflicts.push({ leftContestId: left.id, rightContestId: right.id, participantIds, minimumRestMinutes: source.minimumRestMinutes });
  }

  const duplicatePriorities = duplicates(source.objectives.map(({ priority }) => String(priority)));
  const duplicateObjectiveKinds = duplicates(source.objectives.map(({ kind }) => kind));
  if (source.objectives.length === 0 || duplicatePriorities.length || duplicateObjectiveKinds.length || source.objectives.some(({ priority, weight }) => !Number.isInteger(priority) || priority <= 0 || (weight !== undefined && (!Number.isFinite(weight) || weight <= 0)))) {
    findings.push(error("TSC414", "/scheduleModel/objectives", "Objectives require unique positive integer priorities, unique kinds, and positive weights.", { duplicatePriorities, duplicateObjectiveKinds }));
  }
  const objectives: NormalizedScheduleObjective[] = source.objectives.map(({ kind, priority, weight }) => ({ kind, priority, weight: weight ?? 1 }))
    .sort((left, right) => left.priority - right.priority || left.kind.localeCompare(right.kind));

  if (findings.length) return invalid(source, findings);
  const model = deepFreeze({ horizonMinutes, contests, precedence, resourceUnits, locks, participantConflicts, minimumRestMinutes: source.minimumRestMinutes, objectives });
  return deepFreeze({ valid: true as const, model, findings: [] as const, proofHash: canonicalHash(model) });
}
