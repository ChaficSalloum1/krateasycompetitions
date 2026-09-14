import { canonicalHash, deepFreeze, type TournamentSpec } from "@tournament-os/tournament-schema";
import {
  approveLiveChange,
  compileGraphSchedulingProblem,
  evaluateCompetitionGuard,
  proposeLiveChange,
  replayLiveOperationsEvents,
  validateSchedule,
  verifyLiveChangeProposal,
  type CompetitionGraph,
  type CompetitionGuardReport,
  type LiveOperationsState,
  type MinimalChangeScheduleRepairResult,
  type ScheduleSolution,
  type SchedulingProblem,
  type SimulationRun,
  type SolverAssignment,
} from "@tournament-os/competition-engine";
import type { GuardProofSummary, LiveGuardReport, OperationalAssignment } from "./no-show-journey.js";

export interface CourtOutageProposalRequest {
  readonly proposalId: string;
  readonly courtId: string;
  readonly reason: string;
  readonly expectedReopenAt: string;
  readonly proposedBy: string;
  readonly proposedAt: string;
  readonly incidentKind?: "COURT_OUTAGE" | "DELAY_OVERRUN";
  readonly sourceContestId?: string;
  readonly closureStartsAt?: string;
}

export interface DelayOverrunProposalRequest {
  readonly proposalId: string;
  readonly contestId: string;
  readonly reason: string;
  readonly expectedEndAt: string;
  readonly proposedBy: string;
  readonly proposedAt: string;
}

export interface CourtOutageArtifacts {
  readonly spec: TournamentSpec;
  readonly graph: CompetitionGraph;
  readonly schedule: ScheduleSolution;
  readonly simulation?: SimulationRun;
}

export interface CourtOutageProposal {
  readonly proposalId: string;
  readonly baseOperationalRevision: number;
  readonly baseLiveStateProofHash: string;
  readonly incidentKind: "COURT_OUTAGE" | "DELAY_OVERRUN";
  readonly sourceContestId?: string;
  readonly courtId: string;
  readonly closureStartsAt: string;
  readonly reason: string;
  readonly expectedReopenAt: string;
  readonly proposedBy: string;
  readonly proposedAt: string;
  readonly status: "READY_FOR_APPROVAL" | "BLOCKED";
  readonly proposedLiveState: LiveOperationsState | null;
  readonly repair: MinimalChangeScheduleRepairResult;
  readonly affectedContestIds: readonly string[];
  readonly affectedEntrantIds: readonly string[];
  readonly operationalAssignments: readonly OperationalAssignment[];
  readonly candidateSchedule: ScheduleSolution | null;
  readonly competitionGuard: GuardProofSummary;
  readonly liveGuard: LiveGuardReport;
  readonly consequences: readonly string[];
  readonly proposalHash: string;
}

const canonicalTimestamp = (value: string): boolean => {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
};

const overlaps = (leftStart: number, leftEnd: number, rightStart: number, rightEnd: number): boolean =>
  leftStart < rightEnd && rightStart < leftEnd;

const operationalAssignmentsFrom = (schedule: ScheduleSolution): OperationalAssignment[] => schedule.contests
  .map(({ contestId, resourceId, start, end }) => ({ contestId, resourceId, start, end }))
  .sort((left, right) => left.start.localeCompare(right.start) || left.contestId.localeCompare(right.contestId));

function guardSummary(report: CompetitionGuardReport): GuardProofSummary {
  return { status: report.status, reportHash: report.reportHash,
    requiredAcknowledgementCodes: [...report.requiredAcknowledgementCodes] };
}

function liveGuard(base: LiveOperationsState, candidate: LiveOperationsState | null,
  assignments: readonly OperationalAssignment[], request: CourtOutageProposalRequest,
  competitionGuard: GuardProofSummary): LiveGuardReport {
  const findings: Array<{ code: string; path: string; message: string }> = [];
  if (!candidate) findings.push({ code: "LIVE_GUARD_PROPOSAL", path: "/liveState",
    message: "The court outage did not produce an approval-ready live state." });
  else {
    const replay = replayLiveOperationsEvents(candidate.definition, candidate.events);
    if (!replay.valid || replay.state.proofHash !== candidate.proofHash) findings.push({
      code: "LIVE_GUARD_REPLAY", path: "/liveState", message: "The proposed live state does not replay to its proof hash.",
    });
    for (const [contestId, before] of Object.entries(base.contests)) {
      if (!["COMPLETED", "IN_PROGRESS"].includes(before.status)) continue;
      if (canonicalHash(before) !== canonicalHash(candidate.contests[contestId])) findings.push({
        code: "LIVE_GUARD_TRUTH", path: `/contests/${contestId}`,
        message: "Completed and in-progress contest truth is immutable during a court repair.",
      });
    }
  }
  const outageStart = Date.parse(request.closureStartsAt ?? request.proposedAt);
  const outageEnd = Date.parse(request.expectedReopenAt);
  for (const assignment of assignments) if (assignment.resourceId === request.courtId
    && overlaps(Date.parse(assignment.start), Date.parse(assignment.end), outageStart, outageEnd)) findings.push({
      code: "LIVE_GUARD_CLOSED_COURT", path: `/operationalAssignments/${assignment.contestId}`,
      message: "An operational assignment overlaps the declared court closure.",
    });
  if (competitionGuard.status !== "PASSED") findings.push({ code: "LIVE_GUARD_COMPETITION",
    path: "/candidateSchedule", message: "The independently recomposed competition schedule did not pass Guard." });
  const body = { status: findings.length ? "BLOCKED" as const : "PASSED" as const,
    findings: findings.sort((left, right) => left.code.localeCompare(right.code) || left.path.localeCompare(right.path)) };
  return deepFreeze({ ...body, reportHash: canonicalHash(body) });
}

function scheduleWithAssignments(artifacts: CourtOutageArtifacts,
  assignments: readonly OperationalAssignment[], repair: MinimalChangeScheduleRepairResult, origin: number): ScheduleSolution {
  const byId = new Map(assignments.map((assignment) => [assignment.contestId, assignment]));
  const omitted = artifacts.schedule.contests.filter(({ contestId }) => !byId.has(contestId));
  const vacated = repair.diff.map(({ before }) => ({ resourceId: before.resourceId,
    start: new Date(origin + before.startMinute * 60_000).toISOString(),
    end: new Date(origin + before.endMinute * 60_000).toISOString() }));
  const occupied = [...assignments];
  for (const contest of omitted) {
    const collides = occupied.some((assignment) => assignment.resourceId === contest.resourceId
      && overlaps(Date.parse(assignment.start), Date.parse(assignment.end), Date.parse(contest.start), Date.parse(contest.end)));
    if (!collides) continue;
    const replacement = vacated.find((slot) => !occupied.some((assignment) => assignment.resourceId === slot.resourceId
      && overlaps(Date.parse(assignment.start), Date.parse(assignment.end), Date.parse(slot.start), Date.parse(slot.end))));
    if (replacement) byId.set(contest.contestId, { contestId: contest.contestId, ...replacement });
  }
  const contests = artifacts.schedule.contests.map((contest) => {
    const assignment = byId.get(contest.contestId);
    return assignment ? { ...contest, resourceId: assignment.resourceId, start: assignment.start, end: assignment.end } : contest;
  }).sort((left, right) => left.start.localeCompare(right.start) || left.contestId.localeCompare(right.contestId));
  const { scheduleHash: _oldScheduleHash, validationHash: _oldValidationHash, ...baseAudit } = artifacts.schedule.audit;
  const audit = { ...baseAudit, solver: "deterministic-lexicographic-live-repair", version: "1.0.0",
    status: "FEASIBLE" as const };
  const unvalidated: ScheduleSolution = { contests, audit: { ...audit,
    scheduleHash: canonicalHash({ scheduled: contests, audit }) }, findings: [] };
  const findings = validateSchedule(artifacts.spec, artifacts.graph, unvalidated);
  return deepFreeze({ ...unvalidated, findings, audit: { ...unvalidated.audit, validationHash: canonicalHash(findings) } });
}

function repairProblem(base: LiveOperationsState, artifacts: CourtOutageArtifacts,
  currentAssignments: readonly OperationalAssignment[], request: CourtOutageProposalRequest): {
    problem: SchedulingProblem; baseline: readonly SolverAssignment[]; affectedContestIds: readonly string[]; origin: number;
  } {
  const origin = Date.parse(artifacts.spec.scheduling.start);
  const finish = artifacts.spec.scheduling.finishBy ? Date.parse(artifacts.spec.scheduling.finishBy)
    : Math.max(...artifacts.spec.resources.flatMap(({ availability }) => availability.map(({ end }) => Date.parse(end))));
  const outageStart = Date.parse(request.closureStartsAt ?? request.proposedAt);
  const outageEnd = Date.parse(request.expectedReopenAt);
  if (![origin, finish, outageStart, outageEnd].every(Number.isFinite) || outageStart < origin || outageEnd <= outageStart || outageEnd > finish)
    throw new Error("invalid_court_outage_request");
  if (!base.definition.courts.includes(request.courtId)) throw new Error("court_outage_unknown_court");
  const definitionById = new Map(base.definition.contests.map((contest) => [contest.contestId, contest]));
  const scheduledById = new Map(artifacts.schedule.contests.map((contest) => [contest.contestId, contest]));
  const affected = currentAssignments.filter((assignment) => assignment.resourceId === request.courtId
    && base.contests[assignment.contestId]?.status === "SCHEDULED"
    && overlaps(Date.parse(assignment.start), Date.parse(assignment.end), outageStart, outageEnd));
  if (affected.some(({ contestId }) => base.contests[contestId]?.calledAt))
    throw new Error("court_outage_conflicts_communicated_promise");
  const inProgress = Object.entries(base.contests).filter(([, contest]) => contest.status === "IN_PROGRESS")
    .filter(([contestId, contest]) => (contest.actualCourtId ?? definitionById.get(contestId)?.courtId) === request.courtId);
  if (request.incidentKind === "DELAY_OVERRUN") {
    if (inProgress.length !== 1 || inProgress[0]![0] !== request.sourceContestId)
      throw new Error("delay_overrun_requires_matching_in_progress_contest");
  } else if (inProgress.length) throw new Error("court_outage_requires_in_progress_authority");
  if (!affected.length) throw new Error("court_outage_has_no_affected_contest");
  const affectedIds = new Set(affected.map(({ contestId }) => contestId));
  const affectedParticipants = new Set(affected.flatMap(({ contestId }) =>
    base.resolvedEntrants[contestId] ?? scheduledById.get(contestId)?.possibleEntrantIds ?? []));
  const minute = (instant: number) => Math.round((instant - origin) / 60_000);
  const busy = currentAssignments.filter(({ contestId }) => !affectedIds.has(contestId));
  const participantBusy = busy.filter(({ contestId }) => scheduledById.get(contestId)?.possibleEntrantIds
    .some((entrantId) => affectedParticipants.has(entrantId)));
  const compiledProblem = compileGraphSchedulingProblem(artifacts.spec, artifacts.graph);
  if (compiledProblem.status !== "COMPILED" || !compiledProblem.problem) throw new Error("court_outage_schedule_model_unavailable");
  const authoritativeResources = new Map(compiledProblem.problem.resources.map((resource) => [resource.id, resource]));
  const resources = base.definition.courts.map((id) => ({ id,
    calendars: (authoritativeResources.get(id)?.calendars ?? [])
      .map((window) => ({ startMinute: Math.max(window.startMinute, minute(Math.max(origin, outageStart))),
        endMinute: Math.min(window.endMinute, minute(finish)) }))
      .filter(({ startMinute, endMinute }) => endMinute > startMinute),
    closures: [
      ...busy.filter(({ resourceId }) => resourceId === id).map(({ start, end }) =>
        ({ startMinute: minute(Date.parse(start)), endMinute: minute(Date.parse(end)) })),
      ...participantBusy.map(({ start, end }) =>
        ({ startMinute: minute(Date.parse(start)), endMinute: minute(Date.parse(end)) })),
      ...(id === request.courtId ? [{ startMinute: minute(outageStart), endMinute: minute(outageEnd) }] : []),
    ].filter(({ startMinute, endMinute }) => endMinute > startMinute),
  })).filter(({ calendars }) => calendars.length > 0);
  const availableResourceIds = resources.map(({ id }) => id);
  const tasks = affected.map((assignment) => {
    const scheduled = scheduledById.get(assignment.contestId)!;
    const definition = definitionById.get(assignment.contestId)!;
    return { id: assignment.contestId,
      durationMinutes: Math.round((Date.parse(assignment.end) - Date.parse(assignment.start)) / 60_000),
      eligibleResourceIds: availableResourceIds,
      dependencyIds: (definition.dependencyContestIds ?? []).filter((id) => affectedIds.has(id)),
      participantIds: [...(base.resolvedEntrants[assignment.contestId] ?? scheduled.possibleEntrantIds)].sort() };
  });
  const baseline = affected.map((assignment): SolverAssignment => ({ taskId: assignment.contestId,
    resourceId: assignment.resourceId, startMinute: minute(Date.parse(assignment.start)),
    endMinute: minute(Date.parse(assignment.end)), locked: false }));
  return { problem: { id: `court-outage:${base.definition.tournamentId}:${request.proposalId}`, tasks, resources,
    locks: [], minimumRestMinutes: Number(artifacts.spec.scheduling.constraints.find(({ rule, strength }) =>
      rule === "minimum_rest" && strength === "HARD")?.value ?? 0) }, baseline,
    affectedContestIds: [...affectedIds].sort(), origin };
}

export function proposeCourtOutageRepair(baseOperationalRevision: number, base: LiveOperationsState,
  artifacts: CourtOutageArtifacts, currentAssignments: readonly OperationalAssignment[],
  request: CourtOutageProposalRequest): Readonly<CourtOutageProposal> {
  if (!Number.isSafeInteger(baseOperationalRevision) || baseOperationalRevision < 1 || !request.proposalId.trim()
    || !request.courtId.trim() || !request.reason.trim() || !request.proposedBy.trim()
    || !canonicalTimestamp(request.proposedAt) || !canonicalTimestamp(request.expectedReopenAt)
    || (request.closureStartsAt !== undefined && !canonicalTimestamp(request.closureStartsAt))
    || (request.incidentKind === "DELAY_OVERRUN" && !request.sourceContestId?.trim()))
    throw new Error("invalid_court_outage_request");
  const derived = repairProblem(base, artifacts, currentAssignments, request);
  const liveChange = proposeLiveChange({ proposalId: request.proposalId, proposedBy: request.proposedBy,
    proposedAt: request.proposedAt, liveState: base, liveCommand: { kind: "CLOSE_COURT", courtId: request.courtId,
      reason: request.reason, expectedReopenAt: request.expectedReopenAt, commandId: `${request.proposalId}.close-court`,
      expectedVersion: base.version, actorId: request.proposedBy, occurredAt: request.proposedAt },
    repairRequest: { problem: derived.problem, baseline: derived.baseline }, maxSearchNodes: 100_000 });
  const repairAssignments = new Map((liveChange.repair.assignments ?? []).map((assignment) => [assignment.taskId, assignment]));
  const operationalAssignments = currentAssignments.map((assignment) => {
    const repaired = repairAssignments.get(assignment.contestId);
    return repaired ? { contestId: assignment.contestId, resourceId: repaired.resourceId,
      start: new Date(derived.origin + repaired.startMinute * 60_000).toISOString(),
      end: new Date(derived.origin + repaired.endMinute * 60_000).toISOString() } : assignment;
  }).sort((left, right) => left.start.localeCompare(right.start) || left.contestId.localeCompare(right.contestId));
  const candidateSchedule = liveChange.status === "READY_FOR_APPROVAL"
    ? scheduleWithAssignments(artifacts, operationalAssignments, liveChange.repair, derived.origin) : null;
  const report = candidateSchedule ? evaluateCompetitionGuard({ sourceDefinitionHash: canonicalHash(artifacts.spec),
    ...artifacts, schedule: candidateSchedule }) : null;
  const competitionGuard = report ? guardSummary(report) : { status: "BLOCKED" as const,
    reportHash: canonicalHash({ status: "BLOCKED", proposalId: request.proposalId }), requiredAcknowledgementCodes: [] };
  const proposedLiveState = liveChange.proposedLiveState;
  const checkedLive = liveGuard(base, proposedLiveState, operationalAssignments, request, competitionGuard);
  const affectedContestIds = [...new Set([...derived.affectedContestIds, ...liveChange.repair.diff.map(({ taskId }) => taskId),
    ...(request.sourceContestId ? [request.sourceContestId] : [])])].sort();
  const definitions = new Map(base.definition.contests.map((contest) => [contest.contestId, contest]));
  const affectedEntrantIds = [...new Set(affectedContestIds.flatMap((contestId) =>
    base.resolvedEntrants[contestId] ?? definitions.get(contestId)?.entrantIds ?? []))].sort();
  const status = liveChange.status === "READY_FOR_APPROVAL" && competitionGuard.status === "PASSED"
    && checkedLive.status === "PASSED" ? "READY_FOR_APPROVAL" as const : "BLOCKED" as const;
  const incidentKind = request.incidentKind ?? "COURT_OUTAGE";
  const body = { proposalId: request.proposalId, baseOperationalRevision, baseLiveStateProofHash: base.proofHash,
    incidentKind, ...(request.sourceContestId ? { sourceContestId: request.sourceContestId } : {}),
    courtId: request.courtId, closureStartsAt: request.closureStartsAt ?? request.proposedAt,
    reason: request.reason, expectedReopenAt: request.expectedReopenAt,
    proposedBy: request.proposedBy, proposedAt: request.proposedAt, status,
    proposedLiveState: status === "READY_FOR_APPROVAL" ? proposedLiveState : null, repair: liveChange.repair,
    affectedContestIds, affectedEntrantIds, operationalAssignments: status === "READY_FOR_APPROVAL" ? operationalAssignments : [],
    candidateSchedule: status === "READY_FOR_APPROVAL" ? candidateSchedule : null,
    competitionGuard, liveGuard: checkedLive,
    consequences: status === "READY_FOR_APPROVAL" ? [
      `${affectedContestIds.length} contest(s) require an operational assignment change.`,
      `${affectedEntrantIds.length} participant(s) require a targeted revision update.`,
      `${incidentKind === "DELAY_OVERRUN" ? "The overrun reserves" : "Court"} ${request.courtId} until ${request.expectedReopenAt}.`,
      "Completed and in-progress results remain immutable.",
    ] : ["No court-outage revision can be published until repair and both Guards pass."],
  };
  return deepFreeze({ ...body, proposalHash: canonicalHash(body) });
}

export function verifyCourtOutageProposal(proposal: CourtOutageProposal): boolean {
  const { proposalHash, ...body } = proposal;
  return canonicalHash(body) === proposalHash;
}

export function approveCourtOutageProposal(proposal: CourtOutageProposal, approvedBy: string,
  approvedAt: string): LiveOperationsState {
  if (!verifyCourtOutageProposal(proposal) || proposal.status !== "READY_FOR_APPROVAL" || !proposal.proposedLiveState
    || !proposal.candidateSchedule || proposal.competitionGuard.status !== "PASSED" || proposal.liveGuard.status !== "PASSED")
    throw new Error("court_outage_guard_blocked_publication");
  const synthetic = { schemaVersion: "1.0.0" as const, proposalId: proposal.proposalId,
    tournamentId: proposal.proposedLiveState.definition.tournamentId, proposedBy: proposal.proposedBy,
    proposedAt: proposal.proposedAt, status: "READY_FOR_APPROVAL" as const, commandKind: "CLOSE_COURT" as const,
    baseLiveStateProofHash: proposal.baseLiveStateProofHash, proposedLiveState: proposal.proposedLiveState,
    repair: proposal.repair, impact: { directlyAffectedContestIds: proposal.affectedContestIds,
      movedContestIds: proposal.repair.diff.map(({ taskId }) => taskId), affectedEntrantIds: proposal.affectedEntrantIds,
      resourceChangeCount: proposal.repair.objective?.resourceChanges ?? 0, finishDeltaMinutes: 0 },
    notificationDrafts: proposal.affectedEntrantIds.map((recipientEntrantId) => ({ recipientEntrantId,
      contestIds: proposal.affectedContestIds, reason: "CLOSE_COURT", requiresApproval: true as const })), findings: [] };
  const intact = { ...synthetic, proofHash: canonicalHash(synthetic) };
  if (!verifyLiveChangeProposal(intact)) throw new Error("court_outage_guard_blocked_publication");
  return approveLiveChange(intact, { approvedBy, approvedAt }).liveState;
}

export const authoritativeOperationalAssignments = operationalAssignmentsFrom;
