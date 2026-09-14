import { canonicalHash, deepFreeze, type TournamentSpec } from "@tournament-os/tournament-schema";
import {
  createLiveOperationsState,
  evaluateCompetitionGuard,
  replayLiveOperationsEvents,
  submitLiveOperationsCommand,
  type CompetitionGraph,
  type LiveContestState,
  type LiveOperationsCommand,
  type LiveOperationsDefinition,
  type LiveOperationsState,
  type ScheduleSolution,
  type SimulationRun,
} from "@tournament-os/competition-engine";

export interface OperationalAssignment {
  readonly contestId: string;
  readonly resourceId: string;
  readonly start: string;
  readonly end: string;
}

export interface GuardProofSummary {
  readonly status: "PASSED" | "BLOCKED";
  readonly reportHash: string;
  readonly requiredAcknowledgementCodes: readonly string[];
}

export interface LiveGuardFinding {
  readonly code: string;
  readonly path: string;
  readonly message: string;
}

export interface LiveGuardReport {
  readonly status: "PASSED" | "BLOCKED";
  readonly findings: readonly LiveGuardFinding[];
  readonly reportHash: string;
}

export type NoShowRepairStrategy = "KEEP_ANNOUNCED_SLOTS" | "RELEASE_WALKOVER_SLOTS";

export interface NoShowRepairOption {
  readonly optionId: string;
  readonly strategy: NoShowRepairStrategy;
  readonly rank: number;
  readonly proposedLiveState: LiveOperationsState;
  readonly operationalAssignments: readonly OperationalAssignment[];
  readonly settledAsWalkoverContestIds: readonly string[];
  readonly consequences: readonly string[];
  readonly competitionGuard: GuardProofSummary;
  readonly liveGuard: LiveGuardReport;
  readonly minimumChangeProof: {
    readonly method: "ZERO_MOVE_LOWER_BOUND";
    readonly lowerBoundMovedContestCount: 0;
    readonly movedContestCount: 0;
    readonly removedAssignmentCount: number;
    readonly optimalityProven: true;
    readonly proofHash: string;
  };
  readonly optionHash: string;
}

export interface NoShowProposalRequest {
  readonly proposalId: string;
  readonly contestId: string;
  readonly entrantId: string;
  readonly reason: string;
  readonly proposedBy: string;
  readonly proposedAt: string;
}

export interface NoShowProposal {
  readonly proposalId: string;
  readonly basePublishedRevision: number;
  readonly baseLiveStateProofHash: string;
  readonly contestId: string;
  readonly entrantId: string;
  readonly reason: string;
  readonly proposedBy: string;
  readonly proposedAt: string;
  readonly affectedContestIds: readonly string[];
  readonly affectedEntrantIds: readonly string[];
  readonly options: readonly NoShowRepairOption[];
  readonly proposalHash: string;
}

export interface NoShowArtifacts {
  readonly spec: TournamentSpec;
  readonly graph: CompetitionGraph;
  readonly schedule: ScheduleSolution;
  readonly simulation?: SimulationRun;
}

const canonicalTimestamp = (value: string): boolean => {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
};

const assignmentsFrom = (schedule: ScheduleSolution): OperationalAssignment[] => schedule.contests
  .map(({ contestId, resourceId, start, end }) => ({ contestId, resourceId, start, end }))
  .sort((left, right) => left.start.localeCompare(right.start) || left.contestId.localeCompare(right.contestId));

export function liveDefinitionFromPublished(tournamentId: string, graph: CompetitionGraph,
  schedule: ScheduleSolution): LiveOperationsDefinition {
  const scheduleByContest = new Map(schedule.contests.map((contest) => [contest.contestId, contest]));
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const actualContestIds = new Set(graph.nodes.filter(({ kind }) => kind === "contest").map(({ id }) => id));
  const possibleByDivision = new Map<string, readonly string[]>();
  for (const divisionId of new Set(graph.nodes.map(({ divisionId }) => divisionId))) {
    possibleByDivision.set(divisionId, [...new Set(graph.nodes.filter((node) => node.divisionId === divisionId && node.poolId)
      .flatMap((node) => node.slots.flatMap((slot) => slot.type === "entrant" ? [slot.entrantId] : [])))].sort());
  }
  const resolving = new Set<string>();
  const entrantsForNode = (contestId: string): string[] => {
    if (resolving.has(contestId)) throw new Error(`live_activation_cyclic_contest:${contestId}`);
    const node = nodesById.get(contestId);
    if (!node) return [];
    resolving.add(contestId);
    const entrants = node.slots.flatMap((slot) => slot.type === "entrant" ? [slot.entrantId]
      : slot.type === "winner" || slot.type === "loser" ? entrantsForNode(slot.contestId) : []);
    resolving.delete(contestId);
    return [...new Set(entrants)].sort();
  };
  const dependencies = new Map<string, Set<string>>();
  for (const edge of graph.edges) {
    if (!actualContestIds.has(edge.fromContestId) || !actualContestIds.has(edge.toContestId)) continue;
    const existing = dependencies.get(edge.toContestId) ?? new Set<string>();
    existing.add(edge.fromContestId);
    dependencies.set(edge.toContestId, existing);
  }
  const contests = graph.nodes.filter(({ kind }) => kind === "contest").map((node) => {
    const assignment = scheduleByContest.get(node.id);
    if (!assignment) throw new Error(`live_activation_missing_assignment:${node.id}`);
    return {
      contestId: node.id,
      entrantIds: [...new Set([...assignment.possibleEntrantIds, ...entrantsForNode(node.id),
        ...(!node.poolId ? (possibleByDivision.get(node.divisionId) ?? []) : [])])].sort(),
      ...(node.poolId && node.slots.every((slot) => slot.type === "entrant")
        ? { fixedEntrantIds: node.slots.map((slot) => (slot as { type: "entrant"; entrantId: string }).entrantId)
          .sort() as [string, string] } : {}),
      ...(!node.poolId ? { requiresEntrantResolution: true } : {}),
      courtId: assignment.resourceId,
      dependencyContestIds: [...(dependencies.get(node.id) ?? [])].sort(),
      scheduledStart: assignment.start,
      scheduledEnd: assignment.end,
    };
  });
  return { tournamentId, courts: [...new Set(schedule.contests.map(({ resourceId }) => resourceId))].sort(), contests };
}

export function activatePublishedLiveState(tournamentId: string, graph: CompetitionGraph,
  schedule: ScheduleSolution): LiveOperationsState {
  return createLiveOperationsState(liveDefinitionFromPublished(tournamentId, graph, schedule));
}

function submitRequired(state: LiveOperationsState, command: LiveOperationsCommand): LiveOperationsState {
  const result = submitLiveOperationsCommand(state, command);
  if (!result.accepted) throw new Error(`no_show_repair_command_rejected:${result.findings.map(({ code }) => code).join(",")}`);
  return result.state;
}

function directWalkoverContests(state: LiveOperationsState, entrantId: string): readonly string[] {
  return state.definition.contests.filter((contest) => state.resolvedEntrants[contest.contestId]?.length === 2
    && state.resolvedEntrants[contest.contestId]!.includes(entrantId) && state.contests[contest.contestId]?.status === "SCHEDULED")
    .map(({ contestId }) => contestId).sort();
}

function affectedScope(graph: CompetitionGraph, directIds: readonly string[]): readonly string[] {
  const affected = new Set(directIds);
  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of graph.edges) {
      if (affected.has(edge.fromContestId) && !affected.has(edge.toContestId)) {
        affected.add(edge.toContestId);
        changed = true;
      }
    }
  }
  return [...affected].sort();
}

function proposedState(base: LiveOperationsState, request: NoShowProposalRequest,
  walkoverContestIds: readonly string[]): LiveOperationsState {
  let state = submitRequired(base, {
    kind: "DECLARE_NO_SHOW", contestId: request.contestId, entrantId: request.entrantId,
    reason: request.reason, commandId: `${request.proposalId}.declare-no-show`, expectedVersion: base.version,
    actorId: request.proposedBy, occurredAt: request.proposedAt,
  });
  state = submitRequired(state, {
    kind: "WITHDRAW_ENTRANT", entrantId: request.entrantId, reason: request.reason,
    commandId: `${request.proposalId}.withdraw`, expectedVersion: state.version,
    actorId: request.proposedBy, occurredAt: request.proposedAt,
  });
  for (const contestId of walkoverContestIds) {
    const winnerEntrantId = state.resolvedEntrants[contestId]!.find((id) => id !== request.entrantId)!;
    state = submitRequired(state, {
      kind: "AWARD_WALKOVER", contestId, winnerEntrantId, absentEntrantId: request.entrantId,
      reason: request.reason, commandId: `${request.proposalId}.walkover.${canonicalHash(contestId).slice(0, 16)}`,
      expectedVersion: state.version, actorId: request.proposedBy, occurredAt: request.proposedAt,
    });
  }
  return state;
}

function liveGuard(base: LiveOperationsState, candidate: LiveOperationsState,
  authoritativeAssignments: readonly OperationalAssignment[], operationalAssignments: readonly OperationalAssignment[],
  omittedWalkoverIds: readonly string[]): LiveGuardReport {
  const findings: LiveGuardFinding[] = [];
  const replay = replayLiveOperationsEvents(candidate.definition, candidate.events);
  if (!replay.valid || replay.state.proofHash !== candidate.proofHash) findings.push({
    code: "LIVE_GUARD_REPLAY", path: "/liveState", message: "The proposed live state does not replay to the supplied proof hash.",
  });
  for (const [contestId, before] of Object.entries(base.contests)) {
    if (before.status !== "COMPLETED" && before.status !== "IN_PROGRESS") continue;
    if (canonicalHash(before) !== canonicalHash(candidate.contests[contestId])) findings.push({
      code: "LIVE_GUARD_TRUTH", path: `/contests/${contestId}`,
      message: "Completed and in-progress contest truth is immutable during repair.",
    });
  }
  const authoritative = new Map(authoritativeAssignments.map((assignment) => [assignment.contestId, assignment]));
  const seen = new Set<string>();
  for (const assignment of operationalAssignments) {
    if (seen.has(assignment.contestId)) findings.push({
      code: "LIVE_GUARD_DUPLICATE", path: "/operationalAssignments", message: "Operational assignments must be unique.",
    });
    seen.add(assignment.contestId);
    const expected = authoritative.get(assignment.contestId);
    if (!expected || canonicalHash(expected) !== canonicalHash(assignment)) findings.push({
      code: "LIVE_GUARD_ASSIGNMENT", path: `/operationalAssignments/${assignment.contestId}`,
      message: "Every retained assignment must exactly match the authoritative published schedule.",
    });
  }
  const omitted = new Set(omittedWalkoverIds);
  for (const assignment of authoritativeAssignments) {
    if (seen.has(assignment.contestId)) continue;
    if (!omitted.has(assignment.contestId) || candidate.contests[assignment.contestId]?.status !== "WALKOVER") findings.push({
      code: "LIVE_GUARD_OMISSION", path: `/operationalAssignments/${assignment.contestId}`,
      message: "Only a newly settled walkover may be released from the operational schedule.",
    });
  }
  const body = { status: findings.length ? "BLOCKED" as const : "PASSED" as const,
    findings: findings.sort((left, right) => left.code.localeCompare(right.code) || left.path.localeCompare(right.path)) };
  return deepFreeze({ ...body, reportHash: canonicalHash(body) });
}

function competitionGuard(artifacts: NoShowArtifacts): GuardProofSummary {
  const report = evaluateCompetitionGuard({ sourceDefinitionHash: canonicalHash(artifacts.spec), ...artifacts });
  return { status: report.status, reportHash: report.reportHash,
    requiredAcknowledgementCodes: [...report.requiredAcknowledgementCodes] };
}

function makeOption(strategy: NoShowRepairStrategy, rank: number, base: LiveOperationsState,
  state: LiveOperationsState, artifacts: NoShowArtifacts, walkoverContestIds: readonly string[], downstreamCount: number,
  proposalId: string): NoShowRepairOption {
  const authoritativeAssignments = assignmentsFrom(artifacts.schedule);
  const omitted = strategy === "RELEASE_WALKOVER_SLOTS" ? [...walkoverContestIds] : [];
  const omittedSet = new Set(omitted);
  const operationalAssignments = authoritativeAssignments.filter(({ contestId }) => !omittedSet.has(contestId));
  const proofBody = { method: "ZERO_MOVE_LOWER_BOUND" as const, lowerBoundMovedContestCount: 0 as const,
    movedContestCount: 0 as const, removedAssignmentCount: omitted.length, optimalityProven: true as const };
  const minimumChangeProof = { ...proofBody, proofHash: canonicalHash(proofBody) };
  const optionBody = {
    optionId: `${proposalId}.${strategy.toLowerCase()}`, strategy, rank, proposedLiveState: state,
    operationalAssignments, settledAsWalkoverContestIds: [...walkoverContestIds],
    consequences: strategy === "KEEP_ANNOUNCED_SLOTS" ? [
      `${walkoverContestIds.length} future contest(s) are settled as walkovers.`,
      `${downstreamCount} downstream dependent contest(s) remain conditional until qualification is resolved.`,
      "Published court slots stay visible so on-site displays do not move.",
      "Completed and in-progress contest truth is unchanged.",
    ] : [
      `${walkoverContestIds.length} future contest(s) are settled as walkovers.`,
      `${downstreamCount} downstream dependent contest(s) remain conditional until qualification is resolved.`,
      `${omitted.length} redundant court slot(s) are released; no remaining contest is moved.`,
      "Completed and in-progress contest truth is unchanged.",
    ],
    competitionGuard: competitionGuard(artifacts),
    liveGuard: liveGuard(base, state, authoritativeAssignments, operationalAssignments, omitted),
    minimumChangeProof,
  };
  return deepFreeze({ ...optionBody, optionHash: canonicalHash(optionBody) });
}

export function proposeNoShowRepair(basePublishedRevision: number, base: LiveOperationsState,
  artifacts: NoShowArtifacts, request: NoShowProposalRequest): NoShowProposal {
  if (!request.proposalId.trim() || !request.reason.trim() || !request.proposedBy.trim()
    || !canonicalTimestamp(request.proposedAt)) throw new Error("invalid_no_show_request");
  const contest = base.definition.contests.find(({ contestId }) => contestId === request.contestId);
  if (!contest || !base.resolvedEntrants[request.contestId]?.includes(request.entrantId)) throw new Error("invalid_no_show_contest_or_entrant");
  if (base.contests[request.contestId]?.status !== "SCHEDULED") throw new Error("no_show_requires_scheduled_contest");
  if (base.events.at(-1) && base.events.at(-1)!.occurredAt > request.proposedAt)
    throw new Error("stale_no_show_timestamp");
  if (base.definition.contests.some(({ contestId, entrantIds }) => entrantIds.includes(request.entrantId)
    && base.contests[contestId]?.status === "IN_PROGRESS")) throw new Error("no_show_conflicts_with_in_progress_truth");
  const walkoverContestIds = directWalkoverContests(base, request.entrantId);
  if (!walkoverContestIds.includes(request.contestId)) throw new Error("no_show_contest_cannot_be_settled_deterministically");
  const state = proposedState(base, request, walkoverContestIds);
  const affectedContestIds = affectedScope(artifacts.graph, walkoverContestIds);
  const affectedEntrantIds = [...new Set(base.definition.contests
    .filter(({ contestId }) => walkoverContestIds.includes(contestId)).flatMap(({ entrantIds }) => entrantIds))].sort();
  const options = [
    makeOption("KEEP_ANNOUNCED_SLOTS", 1, base, state, artifacts, walkoverContestIds,
      affectedContestIds.length - walkoverContestIds.length, request.proposalId),
    makeOption("RELEASE_WALKOVER_SLOTS", 2, base, state, artifacts, walkoverContestIds,
      affectedContestIds.length - walkoverContestIds.length, request.proposalId),
  ];
  const body = { ...request, basePublishedRevision, baseLiveStateProofHash: base.proofHash,
    affectedContestIds, affectedEntrantIds, options };
  return deepFreeze({ ...body, proposalHash: canonicalHash(body) });
}

export function verifyNoShowProposal(proposal: NoShowProposal): boolean {
  const { proposalHash, ...body } = proposal;
  if (proposalHash !== canonicalHash(body)) return false;
  return proposal.options.every((option) => {
    const { optionHash, ...optionBody } = option;
    return optionHash === canonicalHash(optionBody);
  });
}

export function independentlyVerifyNoShowOption(base: LiveOperationsState, artifacts: NoShowArtifacts,
  option: NoShowRepairOption): boolean {
  const authoritativeAssignments = assignmentsFrom(artifacts.schedule);
  const omitted = authoritativeAssignments.filter(({ contestId }) =>
    !option.operationalAssignments.some((assignment) => assignment.contestId === contestId)).map(({ contestId }) => contestId);
  const independentCompetitionGuard = competitionGuard(artifacts);
  const independentLiveGuard = liveGuard(base, option.proposedLiveState, authoritativeAssignments,
    option.operationalAssignments, omitted);
  return independentCompetitionGuard.status === "PASSED"
    && independentCompetitionGuard.reportHash === option.competitionGuard.reportHash
    && independentLiveGuard.status === "PASSED" && independentLiveGuard.reportHash === option.liveGuard.reportHash;
}

export function preservedActualTruth(before: Readonly<Record<string, Readonly<LiveContestState>>>,
  after: Readonly<Record<string, Readonly<LiveContestState>>>): boolean {
  return Object.entries(before).every(([contestId, state]) => (state.status !== "COMPLETED" && state.status !== "IN_PROGRESS")
    || canonicalHash(state) === canonicalHash(after[contestId]));
}
