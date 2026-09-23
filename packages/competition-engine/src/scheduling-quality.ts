import { canonicalHash, deepFreeze, type TournamentSpec, type ValidationFinding } from "@tournament-os/tournament-schema";
import { createCpSatSolver, type CpSatResult } from "./cp-sat-solver.js";
import { calculateSchedulingLowerBounds } from "./lower-bounds.js";
import { possibleEntrants, validateSchedule } from "./scheduler.js";
import type { SchedulingProblem } from "./schedule-solver.js";
import type { CompetitionGraph, ContestNode, ScheduleSolution, ScheduledContest } from "./types.js";

export type CourtIntervalClassification = "OCCUPIED" | "EXTENDED" | "GENUINELY_FREE" | "DEPENDENCY_BLOCKED" | "COMPETITION_COMPLETE" | "CLOSED";
export interface ContestActualTiming { readonly contestId: string; readonly actualEnd: string; }
export interface CourtIntervalEvidence {
  readonly resourceId: string; readonly start: string; readonly end: string; readonly durationMinutes: number;
  readonly classification: CourtIntervalClassification; readonly avoidable: boolean; readonly contestId: string | null;
  readonly readyContestIds: readonly string[]; readonly blockingReasons: readonly string[]; readonly proofHash: string;
}
export interface ScheduleQualityMetrics {
  readonly makespanMinutes: number; readonly avoidableIdleMinutes: number; readonly unavoidableIdleMinutes: number;
  readonly divisionInterleavingTransitions: number; readonly longestDivisionClump: number;
  readonly poolRotationTransitions: number; readonly repeatedPoolAdjacencies: number;
  readonly criticalPathUnlockDelay: number; readonly averagePlayerWaitMinutes: number; readonly maximumPlayerWaitMinutes: number;
  readonly backToBackCount: number; readonly headlineFinalGapMinutes: number | null; readonly headlineFinalIsClimax: boolean | null;
}
export interface ScheduleQualityAudit {
  readonly status: "CERTIFIED" | "DISRUPTED" | "REJECTED"; readonly intervals: readonly CourtIntervalEvidence[];
  readonly metrics: ScheduleQualityMetrics; readonly lexicographicVector: readonly number[];
  readonly requirementCoverage: readonly { readonly requirementId: string; readonly sourceText: string; readonly metricIds: readonly string[] }[];
  readonly findings: readonly ValidationFinding[]; readonly proofHash: string;
}
export interface SchedulingProblemAdapterResult {
  readonly status: "COMPILED" | "REJECTED"; readonly problem: Readonly<SchedulingProblem> | null;
  readonly horizonStart: string; readonly findings: readonly ValidationFinding[]; readonly proofHash: string;
}
export interface CpSatScheduleResult {
  readonly status: "OPTIMAL" | "FEASIBLE" | "INFEASIBLE" | "UNKNOWN" | "REJECTED";
  readonly problem: Readonly<SchedulingProblem> | null; readonly solution: Readonly<ScheduleSolution> | null;
  readonly cpSat: Readonly<CpSatResult> | null; readonly validationFindings: readonly ValidationFinding[]; readonly proofHash: string;
}
export interface ScheduleRepairPlan {
  readonly status: "IMPROVED" | "UNCHANGED" | "REJECTED"; readonly baseline: ScheduleQualityAudit;
  readonly candidate: ScheduleQualityAudit | null; readonly solution: Readonly<ScheduleSolution> | null;
  readonly cpSatStatus: CpSatScheduleResult["status"]; readonly reason: string; readonly proofHash: string;
}

const minutes = (value: number): number => value * 60_000;
const iso = (value: number): string => new Date(value).toISOString();
const error = (code: string, path: string, message: string, evidence?: Record<string, unknown>): ValidationFinding => ({
  code, severity: "ERROR", path, message, ...(evidence ? { evidence } : {}),
});

function durationMinutes(spec: TournamentSpec, node: ContestNode): number {
  const rules = [...spec.scheduling.durations].reverse();
  const selected = rules.find(({ stageId, round }) => stageId === node.stageId && round === node.round)
    ?? rules.find(({ stageId, round }) => stageId === node.stageId && round === undefined);
  if (!selected) throw new Error(`No duration is declared for ${node.id}`);
  return selected.contestMinutes + selected.turnaroundMinutes;
}
function resourceUnits(spec: TournamentSpec) {
  return spec.resources.flatMap((resource) => Array.from({ length: resource.quantity }, (_, index) => ({
    id: `${resource.id}.${index + 1}`, type: resource.type,
    availability: resource.availability.map(({ start, end }) => ({ start: Date.parse(start), end: Date.parse(end) })),
  })));
}
function dependencies(graph: CompetitionGraph): Map<string, string[]> {
  const result = new Map(graph.nodes.map(({ id }) => [id, [] as string[]]));
  for (const edge of graph.edges) result.get(edge.toContestId)?.push(edge.fromContestId);
  return result;
}
function descendants(graph: CompetitionGraph): Map<string, number> {
  const outgoing = new Map(graph.nodes.map(({ id }) => [id, [] as string[]]));
  for (const edge of graph.edges) outgoing.get(edge.fromContestId)?.push(edge.toContestId);
  return new Map(graph.nodes.map(({ id }) => {
    const seen = new Set<string>(); const queue = [...(outgoing.get(id) ?? [])];
    while (queue.length) { const next = queue.shift()!; if (seen.has(next)) continue; seen.add(next); queue.push(...(outgoing.get(next) ?? [])); }
    return [id, seen.size];
  }));
}

function requirementCoverage(spec: TournamentSpec): ScheduleQualityAudit["requirementCoverage"] {
  const mappings: Record<string, readonly string[]> = {
    resources: ["resource-availability", "avoidable-idle"], duration: ["duration-conformance", "makespan"],
    schedule_quality: ["avoidable-idle", "player-wait", "back-to-back", "pool-rotation", "division-interleaving"],
    schedule_objective: ["makespan", "critical-path-unlock", "headline-final-climax"],
  };
  return spec.requirements.filter(({ type }) => mappings[type]).map(({ id, sourceText, type }) => ({
    requirementId: id, sourceText, metricIds: [...mappings[type]!],
  }));
}

function qualityMetrics(spec: TournamentSpec, graph: CompetitionGraph, schedule: ScheduleSolution,
  intervals: readonly CourtIntervalEvidence[]): ScheduleQualityMetrics {
  const actual = graph.nodes.filter(({ kind }) => kind === "contest");
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const ordered = [...schedule.contests].sort((left, right) => Date.parse(left.start) - Date.parse(right.start) || left.resourceId.localeCompare(right.resourceId));
  const start = Date.parse(spec.scheduling.start); const finish = ordered.length ? Math.max(...ordered.map(({ end }) => Date.parse(end))) : start;
  const adjacent = ordered.slice(1).map((entry, index) => [ordered[index]!, entry] as const);
  const divisions = ordered.map(({ contestId }) => nodeById.get(contestId)?.divisionId ?? "unknown");
  let longestDivisionClump = divisions.length ? 1 : 0; let clump = divisions.length ? 1 : 0;
  for (let index = 1; index < divisions.length; index += 1) {
    clump = divisions[index] === divisions[index - 1] ? clump + 1 : 1; longestDivisionClump = Math.max(longestDivisionClump, clump);
  }
  const playerEntries = new Map<string, ScheduledContest[]>();
  for (const entry of schedule.contests) for (const id of entry.possibleEntrantIds) playerEntries.set(id, [...(playerEntries.get(id) ?? []), entry]);
  const waits: number[] = []; let backToBackCount = 0;
  for (const entries of playerEntries.values()) {
    entries.sort((left, right) => Date.parse(left.start) - Date.parse(right.start));
    for (let index = 1; index < entries.length; index += 1) {
      const wait = (Date.parse(entries[index]!.start) - Date.parse(entries[index - 1]!.end)) / 60_000; waits.push(wait);
      if (wait === 0) backToBackCount += 1;
    }
  }
  const unlocks = descendants(graph); const totalUnlocks = actual.reduce((sum, node) => sum + (unlocks.get(node.id) ?? 0), 0);
  const criticalPathUnlockDelay = totalUnlocks === 0 ? 0 : ordered.reduce((sum, entry) =>
    sum + ((Date.parse(entry.end) - start) / 60_000) * (unlocks.get(entry.contestId) ?? 0), 0) / totalUnlocks;
  const configuredHeadlineStages = new Set(spec.scheduling.constraints
    .filter(({ rule, strength, value }) => rule === "headline_final_climax" && strength === "SOFT" && typeof value === "string")
    .flatMap(({ value }) => (value as string).split(",").map((entry) => entry.trim()).filter(Boolean)));
  const finals = ordered.filter(({ contestId }) => {
    const node = nodeById.get(contestId); const round = node?.round.toLowerCase() ?? "";
    return round.includes("final") && !round.includes("semi") && (!configuredHeadlineStages.size || configuredHeadlineStages.has(node?.stageId ?? ""));
  });
  const headlineFinish = finals.length ? Math.max(...finals.map(({ end }) => Date.parse(end))) : null;
  const headlineFinalGapMinutes = headlineFinish === null ? null : (finish - headlineFinish) / 60_000;
  return {
    makespanMinutes: (finish - start) / 60_000,
    avoidableIdleMinutes: intervals.filter(({ avoidable }) => avoidable).reduce((sum, interval) => sum + interval.durationMinutes, 0),
    unavoidableIdleMinutes: intervals.filter(({ classification }) => classification === "DEPENDENCY_BLOCKED")
      .reduce((sum, interval) => sum + interval.durationMinutes, 0),
    divisionInterleavingTransitions: adjacent.filter(([left, right]) => nodeById.get(left.contestId)?.divisionId !== nodeById.get(right.contestId)?.divisionId).length,
    longestDivisionClump,
    poolRotationTransitions: adjacent.filter(([left, right]) => nodeById.get(left.contestId)?.poolId && nodeById.get(right.contestId)?.poolId &&
      nodeById.get(left.contestId)?.poolId !== nodeById.get(right.contestId)?.poolId).length,
    repeatedPoolAdjacencies: adjacent.filter(([left, right]) => nodeById.get(left.contestId)?.poolId &&
      nodeById.get(left.contestId)?.poolId === nodeById.get(right.contestId)?.poolId).length,
    criticalPathUnlockDelay,
    averagePlayerWaitMinutes: waits.length ? waits.reduce((sum, value) => sum + value, 0) / waits.length : 0,
    maximumPlayerWaitMinutes: waits.length ? Math.max(...waits) : 0,
    backToBackCount,
    headlineFinalGapMinutes,
    headlineFinalIsClimax: headlineFinalGapMinutes === null ? null : headlineFinalGapMinutes === 0,
  };
}

export function auditScheduleQuality(spec: TournamentSpec, graph: CompetitionGraph, schedule: ScheduleSolution,
  actualTimings: readonly ContestActualTiming[] = []): ScheduleQualityAudit {
  const findings = [...validateSchedule(spec, graph, schedule)];
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node])); const scheduledById = new Map(schedule.contests.map((entry) => [entry.contestId, entry]));
  const deps = dependencies(graph); const potential = possibleEntrants(graph);
  const actualEnd = new Map(actualTimings.map(({ contestId, actualEnd }) => [contestId, Date.parse(actualEnd)]));
  for (const actual of actualTimings) if (!scheduledById.has(actual.contestId) || !Number.isFinite(Date.parse(actual.actualEnd))) findings.push(error(
    "TSQ001", `/actualTimings/${actual.contestId}`, "Actual timing must name a scheduled contest and a valid end instant.",
  ));
  const intervals: CourtIntervalEvidence[] = [];
  for (const resource of resourceUnits(spec)) {
    const resourceSchedule = schedule.contests.filter(({ resourceId }) => resourceId === resource.id);
    const competitionFinish = schedule.contests.length ? Math.max(...schedule.contests.map(({ contestId, end }) => actualEnd.get(contestId) ?? Date.parse(end))) : Date.parse(spec.scheduling.start);
    const horizonStart = Math.min(...resource.availability.map(({ start }) => start)); const horizonEnd = Math.max(...resource.availability.map(({ end }) => end));
    const boundaries = new Set<number>([horizonStart, horizonEnd]);
    for (const window of resource.availability) { boundaries.add(window.start); boundaries.add(window.end); }
    for (const entry of schedule.contests) { boundaries.add(Date.parse(entry.start)); boundaries.add(Date.parse(entry.end));
      const observed = actualEnd.get(entry.contestId); if (observed !== undefined) boundaries.add(observed); }
    for (const entry of resourceSchedule) { boundaries.add(Date.parse(entry.start)); boundaries.add(Date.parse(entry.end));
      const observed = actualEnd.get(entry.contestId); if (observed !== undefined) boundaries.add(observed); }
    const points = [...boundaries].filter((value) => value >= horizonStart && value <= horizonEnd).sort((left, right) => left - right);
    for (let index = 0; index < points.length - 1; index += 1) {
      const from = points[index]!; const to = points[index + 1]!; if (to <= from) continue;
      const available = resource.availability.some((window) => from >= window.start && to <= window.end);
      let classification: CourtIntervalClassification; let contestId: string | null = null; let readyContestIds: string[] = []; let blockingReasons: string[] = [];
      if (!available) classification = "CLOSED";
      else {
        const extension = resourceSchedule.find((entry) => from >= Date.parse(entry.end) && from < (actualEnd.get(entry.contestId) ?? Date.parse(entry.end)));
        const planned = resourceSchedule.find((entry) => from >= Date.parse(entry.start) && from < Date.parse(entry.end));
        if (extension) { classification = "EXTENDED"; contestId = extension.contestId; }
        else if (planned) { classification = "OCCUPIED"; contestId = planned.contestId; }
        else {
          const pending = schedule.contests.filter((entry) => Date.parse(entry.start) >= to && nodeById.get(entry.contestId)?.requiredResourceType === resource.type);
          if (pending.length === 0 && from >= competitionFinish) classification = "COMPETITION_COMPLETE";
          else {
            if (pending.length === 0) blockingReasons.push("competition-work-occupied-elsewhere");
            for (const candidate of pending) {
              const node = nodeById.get(candidate.contestId)!; const duration = minutes(durationMinutes(spec, node));
              const dependencyEnd = Math.max(0, ...(deps.get(candidate.contestId) ?? []).map((id) => {
                const entry = scheduledById.get(id); return entry ? actualEnd.get(id) ?? Date.parse(entry.end) : Number.POSITIVE_INFINITY;
              }));
              const participantIds = [...(potential.get(candidate.contestId) ?? [])];
              const participantReady = Math.max(0, ...schedule.contests.filter((entry) => Date.parse(entry.start) < Date.parse(candidate.start) &&
                entry.possibleEntrantIds.some((id) => participantIds.includes(id))).map((entry) => actualEnd.get(entry.contestId) ?? Date.parse(entry.end)));
              const rest = Number(spec.scheduling.constraints.find(({ rule, strength }) => rule === "minimum_rest" && strength === "HARD")?.value ?? 0);
              if (dependencyEnd <= from && participantReady + minutes(rest) <= from && from + duration <= to) readyContestIds.push(candidate.contestId);
              else {
                if (dependencyEnd > from) blockingReasons.push(`${candidate.contestId}:dependency`);
                if (participantReady + minutes(rest) > from) blockingReasons.push(`${candidate.contestId}:participant-rest`);
                if (from + duration > to) blockingReasons.push(`${candidate.contestId}:interval-too-short`);
              }
            }
            readyContestIds = [...new Set(readyContestIds)].sort(); blockingReasons = [...new Set(blockingReasons)].sort();
            classification = readyContestIds.length ? "GENUINELY_FREE" : "DEPENDENCY_BLOCKED";
          }
        }
      }
      const content = { resourceId: resource.id, start: iso(from), end: iso(to), durationMinutes: (to - from) / 60_000,
        classification, avoidable: classification === "GENUINELY_FREE", contestId, readyContestIds, blockingReasons };
      intervals.push(deepFreeze({ ...content, proofHash: canonicalHash(content) }));
    }
  }
  for (const entry of schedule.contests) {
    const observed = actualEnd.get(entry.contestId);
    if (observed !== undefined && observed > Date.parse(entry.end) && schedule.contests.some((other) => other.resourceId === entry.resourceId &&
      other.contestId !== entry.contestId && Date.parse(other.start) < observed && Date.parse(other.end) > Date.parse(entry.end))) findings.push(error(
      "TSQ002", `/actualTimings/${entry.contestId}`, "An extended contest overlaps another planned contest on the resource.",
      { contestId: entry.contestId, resourceId: entry.resourceId },
    ));
  }
  intervals.sort((left, right) => left.resourceId.localeCompare(right.resourceId) || left.start.localeCompare(right.start));
  const metrics = qualityMetrics(spec, graph, schedule, intervals);
  const lexicographicVector = [metrics.makespanMinutes, metrics.avoidableIdleMinutes, metrics.maximumPlayerWaitMinutes,
    metrics.longestDivisionClump, metrics.repeatedPoolAdjacencies, metrics.backToBackCount, metrics.criticalPathUnlockDelay,
    metrics.headlineFinalGapMinutes === null ? 0 : metrics.headlineFinalGapMinutes, -metrics.divisionInterleavingTransitions, -metrics.poolRotationTransitions];
  const status = findings.some(({ code }) => code === "TSQ002") ? "DISRUPTED" as const
    : findings.some(({ severity }) => severity === "ERROR") ? "REJECTED" as const : "CERTIFIED" as const;
  const body = { status, intervals, metrics, lexicographicVector, requirementCoverage: requirementCoverage(spec), findings };
  return deepFreeze({ ...body, proofHash: canonicalHash(body) });
}

export function compareScheduleQuality(left: ScheduleQualityAudit, right: ScheduleQualityAudit): -1 | 0 | 1 {
  const statusRank = { CERTIFIED: 0, DISRUPTED: 1, REJECTED: 2 } as const;
  if (statusRank[left.status] !== statusRank[right.status]) return statusRank[left.status] < statusRank[right.status] ? -1 : 1;
  for (let index = 0; index < Math.max(left.lexicographicVector.length, right.lexicographicVector.length); index += 1) {
    const l = left.lexicographicVector[index] ?? 0; const r = right.lexicographicVector[index] ?? 0;
    if (l !== r) return l < r ? -1 : 1;
  }
  return 0;
}

export function compileGraphSchedulingProblem(spec: TournamentSpec, graph: CompetitionGraph): SchedulingProblemAdapterResult {
  const findings: ValidationFinding[] = []; const start = Date.parse(spec.scheduling.start);
  const end = Math.max(start, ...spec.resources.flatMap(({ availability }) => availability.map((window) => Date.parse(window.end))));
  const potential = possibleEntrants(graph); const incoming = dependencies(graph);
  const units = resourceUnits(spec); const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || (end - start) % 60_000 !== 0) findings.push(error(
    "TSQ101", "/scheduling", "CP-SAT scheduling requires a positive whole-minute horizon.",
  ));
  const locked = spec.scheduling.constraints.filter(({ rule, strength }) => rule === "locked_match_start" && strength === "HARD");
  if (locked.length) findings.push(error("TSQ102", "/scheduling/constraints", "Graph-to-CP-SAT adapter does not infer a resource for legacy time-only locks."));
  const minimumRestMinutes = Number(spec.scheduling.constraints.find(({ rule, strength }) => rule === "minimum_rest" && strength === "HARD")?.value ?? 0);
  // Any feeder entrant can qualify through a `complete` edge, so with hard rest each such feeder and its
  // qualification-fed contest share a synthetic participant: CP-SAT then keeps the rest gap between them
  // for every possible qualifier, not only the simulated ones in the participant sets.
  const qualificationRestTokens = new Map<string, string[]>();
  if (minimumRestMinutes > 0) for (const edge of graph.edges) {
    if (edge.outcome !== "complete" || nodeById.get(edge.fromContestId)?.kind !== "contest" || nodeById.get(edge.toContestId)?.kind !== "contest") continue;
    const token = `qualification-rest:${edge.fromContestId}>${edge.toContestId}`;
    for (const id of [edge.fromContestId, edge.toContestId]) qualificationRestTokens.set(id, [...(qualificationRestTokens.get(id) ?? []), token]);
  }
  const tasks = graph.nodes.filter(({ kind }) => kind === "contest").map((node) => ({ id: node.id, durationMinutes: durationMinutes(spec, node),
    eligibleResourceIds: units.filter(({ type }) => type === node.requiredResourceType).map(({ id }) => id).sort(),
    dependencyIds: [...new Set(incoming.get(node.id) ?? [])].filter((id) => nodeById.get(id)?.kind === "contest").sort(),
    participantIds: [...new Set([...(potential.get(node.id) ?? []), ...(qualificationRestTokens.get(node.id) ?? [])])].sort() }));
  const resources = units.map((unit) => ({ id: unit.id, calendars: unit.availability.map((window) => ({
    startMinute: Math.max(0, (window.start - start) / 60_000), endMinute: Math.min((end - start) / 60_000, (window.end - start) / 60_000),
  })).filter(({ startMinute, endMinute }) => Number.isInteger(startMinute) && Number.isInteger(endMinute) && startMinute < endMinute), closures: [] }));
  if (tasks.some(({ eligibleResourceIds }) => eligibleResourceIds.length === 0)) findings.push(error(
    "TSQ103", "/resources", "At least one contest has no compatible concrete resource unit.",
  ));
  const problem: SchedulingProblem = { id: `graph:${spec.metadata.compiledSpecHash}`, tasks, resources, locks: [], minimumRestMinutes };
  const body = { status: findings.length ? "REJECTED" as const : "COMPILED" as const, problem: findings.length ? null : problem,
    horizonStart: iso(start), findings };
  return deepFreeze({ ...body, proofHash: canonicalHash(body) });
}

export function solveGraphWithCpSat(spec: TournamentSpec, graph: CompetitionGraph,
  options: { readonly maxTimeSeconds: number; readonly pythonExecutable?: string } = { maxTimeSeconds: 10 }): CpSatScheduleResult {
  const compilation = compileGraphSchedulingProblem(spec, graph);
  if (compilation.status === "REJECTED" || !compilation.problem) {
    const body = { status: "REJECTED" as const, problem: null, solution: null, cpSat: null, validationFindings: compilation.findings };
    return deepFreeze({ ...body, proofHash: canonicalHash(body) });
  }
  const cpSat = createCpSatSolver(options.pythonExecutable ? { pythonExecutable: options.pythonExecutable } : {}).solve(compilation.problem,
    { maxTimeSeconds: options.maxTimeSeconds });
  if (cpSat.status !== "CERTIFIED") {
    const body = { status: cpSat.status, problem: compilation.problem, solution: null, cpSat, validationFindings: [] as readonly ValidationFinding[] };
    return deepFreeze({ ...body, proofHash: canonicalHash(body) });
  }
  const start = Date.parse(compilation.horizonStart); const potential = possibleEntrants(graph);
  const contests: ScheduledContest[] = cpSat.assignments.map((assignment) => ({ contestId: assignment.taskId, resourceId: assignment.resourceId,
    start: iso(start + minutes(assignment.startMinute)), end: iso(start + minutes(assignment.endMinute)),
    possibleEntrantIds: [...(potential.get(assignment.taskId) ?? [])].sort() })).sort((left, right) => Date.parse(left.start) - Date.parse(right.start) || left.contestId.localeCompare(right.contestId));
  const independentlyVerifiedLowerBound = calculateSchedulingLowerBounds(spec, graph).verifiedLowerBoundMinutes;
  const auditBase = { solver: "or-tools-cp-sat", version: cpSat.proof.backendVersion ?? cpSat.proof.requiredBackendVersion,
    status: cpSat.proof.backendStatus === "OPTIMAL" ? "OPTIMAL" as const : "FEASIBLE" as const, objective: spec.scheduling.objective,
    ...(cpSat.objective.valueMinutes === null ? {} : { objectiveValueMinutes: cpSat.objective.valueMinutes }),
    lowerBoundMinutes: Math.max(cpSat.objective.bestBoundMinutes ?? 0, independentlyVerifiedLowerBound),
    ...(cpSat.objective.relativeGap !== null ? { optimalityGap: cpSat.objective.relativeGap } : {}) };
  const candidate: ScheduleSolution = { contests, audit: auditBase, findings: [] };
  const validationFindings = validateSchedule(spec, graph, candidate);
  const validationHash = canonicalHash(validationFindings); const scheduleHash = canonicalHash({ scheduled: contests, audit: { ...auditBase, validationHash } });
  const solution = deepFreeze({ contests, audit: { ...auditBase, validationHash, scheduleHash }, findings: [...validationFindings] });
  const status = validationFindings.some(({ severity }) => severity === "ERROR") ? "REJECTED" as const
    : cpSat.proof.backendStatus === "OPTIMAL" ? "OPTIMAL" as const : "FEASIBLE" as const;
  const body = { status, problem: compilation.problem, solution, cpSat, validationFindings };
  return deepFreeze({ ...body, proofHash: canonicalHash(body) });
}

export function planScheduleQualityRepair(spec: TournamentSpec, graph: CompetitionGraph, baseline: ScheduleSolution,
  options: { readonly maxTimeSeconds: number; readonly pythonExecutable?: string } = { maxTimeSeconds: 10 }): ScheduleRepairPlan {
  const baselineAudit = auditScheduleQuality(spec, graph, baseline); const solved = solveGraphWithCpSat(spec, graph, options);
  if (!solved.solution || solved.status === "UNKNOWN" || solved.status === "INFEASIBLE" || solved.status === "REJECTED") {
    const body = { status: "REJECTED" as const, baseline: baselineAudit, candidate: null, solution: null, cpSatStatus: solved.status,
      reason: solved.status === "UNKNOWN" ? "CP-SAT feasibility is unknown; no repair is proposed." : "No independently valid CP-SAT candidate is available." };
    return deepFreeze({ ...body, proofHash: canonicalHash(body) });
  }
  const candidate = auditScheduleQuality(spec, graph, solved.solution); const improved = compareScheduleQuality(candidate, baselineAudit) < 0;
  const body = { status: improved ? "IMPROVED" as const : "UNCHANGED" as const, baseline: baselineAudit, candidate,
    solution: solved.solution, cpSatStatus: solved.status,
    reason: improved ? "The independently valid solver candidate improves the pinned lexicographic quality vector."
      : "The independently valid solver candidate does not improve the pinned lexicographic quality vector." };
  return deepFreeze({ ...body, proofHash: canonicalHash(body) });
}
