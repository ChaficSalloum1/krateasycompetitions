import { canonicalHash, deepFreeze } from "@tournament-os/tournament-schema";
import {
  submitLiveOperationsCommand,
  type LiveOperationsCommand,
  type LiveOperationsFinding,
  type LiveOperationsState,
} from "./live-operations.js";
import {
  planMinimalChangeScheduleRepair,
  type MinimalChangeScheduleRepairResult,
  type ScheduleRepairRequest,
} from "./schedule-repair.js";
import type { SolverAssignment } from "./schedule-solver.js";

export interface LiveChangeNotificationDraft {
  readonly recipientEntrantId: string;
  readonly contestIds: readonly string[];
  readonly reason: string;
  readonly requiresApproval: true;
}

export interface LiveChangeImpact {
  readonly directlyAffectedContestIds: readonly string[];
  readonly movedContestIds: readonly string[];
  readonly affectedEntrantIds: readonly string[];
  readonly resourceChangeCount: number;
  readonly finishDeltaMinutes: number;
}

export interface LiveChangeProposalRequest {
  readonly proposalId: string;
  readonly proposedBy: string;
  readonly proposedAt: string;
  readonly liveState: LiveOperationsState;
  readonly liveCommand: LiveOperationsCommand;
  readonly repairRequest: ScheduleRepairRequest;
  readonly maxSearchNodes: number;
}

export interface LiveChangeProposal {
  readonly schemaVersion: "1.0.0";
  readonly proposalId: string;
  readonly tournamentId: string;
  readonly proposedBy: string;
  readonly proposedAt: string;
  readonly status: "READY_FOR_APPROVAL" | "BLOCKED";
  readonly commandKind: LiveOperationsCommand["kind"];
  readonly baseLiveStateProofHash: string;
  readonly proposedLiveState: LiveOperationsState | null;
  readonly repair: MinimalChangeScheduleRepairResult;
  readonly impact: LiveChangeImpact;
  readonly notificationDrafts: readonly LiveChangeNotificationDraft[];
  readonly findings: readonly LiveOperationsFinding[];
  readonly proofHash: string;
}

export interface ApprovedLiveChange {
  readonly schemaVersion: "1.0.0";
  readonly proposalId: string;
  readonly tournamentId: string;
  readonly status: "APPROVED";
  readonly approvedBy: string;
  readonly approvedAt: string;
  readonly proposalProofHash: string;
  readonly liveState: LiveOperationsState;
  readonly assignments: readonly SolverAssignment[];
  readonly notificationDrafts: readonly LiveChangeNotificationDraft[];
  readonly approvalHash: string;
}

function canonicalTimestamp(value: string): boolean {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function directContestIds(state: LiveOperationsState, command: LiveOperationsCommand): string[] {
  const definitions = state.definition.contests;
  if ("contestId" in command) return definitions.some(({ contestId }) => contestId === command.contestId) ? [command.contestId] : [];
  if ("entrantId" in command) return definitions.filter(({ entrantIds }) => entrantIds.includes(command.entrantId)).map(({ contestId }) => contestId).sort();
  if ("courtId" in command) return definitions.filter(({ courtId }) => courtId === command.courtId).map(({ contestId }) => contestId).sort();
  if ("officialId" in command) return definitions.filter(({ officialId }) => officialId === command.officialId).map(({ contestId }) => contestId).sort();
  if ("equipmentId" in command) return definitions.filter(({ equipmentIds }) => equipmentIds?.includes(command.equipmentId)).map(({ contestId }) => contestId).sort();
  if ("protestId" in command) {
    const protest = state.protests[command.protestId];
    return protest ? [protest.contestId] : [];
  }
  return definitions.map(({ contestId }) => contestId).sort();
}

function emptyImpact(): LiveChangeImpact {
  return { directlyAffectedContestIds: [], movedContestIds: [], affectedEntrantIds: [], resourceChangeCount: 0, finishDeltaMinutes: 0 };
}

function blocked(request: LiveChangeProposalRequest, repair: MinimalChangeScheduleRepairResult,
  findings: readonly LiveOperationsFinding[]): Readonly<LiveChangeProposal> {
  const body = { schemaVersion: "1.0.0" as const, proposalId: request.proposalId, tournamentId: request.liveState.definition.tournamentId,
    proposedBy: request.proposedBy, proposedAt: request.proposedAt, status: "BLOCKED" as const, commandKind: request.liveCommand.kind,
    baseLiveStateProofHash: request.liveState.proofHash,
    proposedLiveState: null, repair, impact: emptyImpact(), notificationDrafts: [], findings: [...findings] };
  return deepFreeze({ ...body, proofHash: canonicalHash(body) });
}

export function proposeLiveChange(request: LiveChangeProposalRequest): Readonly<LiveChangeProposal> {
  if (!request.proposalId.trim() || !request.proposedBy.trim() || !canonicalTimestamp(request.proposedAt)
    || request.liveCommand.actorId !== request.proposedBy || request.liveCommand.occurredAt !== request.proposedAt) {
    throw new Error("Live-change proposal identity, actor and canonical time must agree");
  }
  const liveResult = submitLiveOperationsCommand(request.liveState, request.liveCommand);
  const repair = planMinimalChangeScheduleRepair(request.repairRequest, { maxSearchNodes: request.maxSearchNodes });
  if (!liveResult.accepted) return blocked(request, repair, liveResult.findings);
  const repairContestIds = request.repairRequest.problem.tasks.map(({ id }) => id);
  const unknownRepairIds = repairContestIds.filter((id) => !request.liveState.definition.contests.some(({ contestId }) => contestId === id));
  if (unknownRepairIds.length) return blocked(request, repair, [{ code: "LCH001", path: "/repairRequest/problem/tasks",
    message: "Every repaired task must identify a live competition contest.", evidence: { unknownRepairIds } }]);
  if (!repair.proof.optimalityProven || !["REPAIRED", "UNCHANGED"].includes(repair.status) || !repair.assignments) {
    return blocked(request, repair, [{ code: "LCH002", path: "/repair",
      message: "A live change requires an independently validated, minimal repair before approval.",
      evidence: { repairStatus: repair.status, optimalityProven: repair.proof.optimalityProven } }]);
  }
  const directlyAffectedContestIds = directContestIds(request.liveState, request.liveCommand);
  const movedContestIds = repair.diff.map(({ taskId }) => taskId).sort();
  const affectedContestIds = [...new Set([...directlyAffectedContestIds, ...movedContestIds])].sort();
  const contestById = new Map(request.liveState.definition.contests.map((contest) => [contest.contestId, contest]));
  const affectedEntrantIds = [...new Set(affectedContestIds.flatMap((id) => contestById.get(id)?.entrantIds ?? []))].sort();
  const notificationDrafts = affectedEntrantIds.map((recipientEntrantId): LiveChangeNotificationDraft => ({ recipientEntrantId,
    contestIds: affectedContestIds.filter((id) => contestById.get(id)?.entrantIds.includes(recipientEntrantId)),
    reason: request.liveCommand.kind, requiresApproval: true }));
  const baselineFinish = Math.max(0, ...request.repairRequest.baseline.map(({ endMinute }) => endMinute));
  const repairedFinish = Math.max(0, ...repair.assignments.map(({ endMinute }) => endMinute));
  const impact: LiveChangeImpact = { directlyAffectedContestIds, movedContestIds, affectedEntrantIds,
    resourceChangeCount: repair.objective?.resourceChanges ?? 0, finishDeltaMinutes: repairedFinish - baselineFinish };
  const body = { schemaVersion: "1.0.0" as const, proposalId: request.proposalId, tournamentId: request.liveState.definition.tournamentId,
    proposedBy: request.proposedBy, proposedAt: request.proposedAt, status: "READY_FOR_APPROVAL" as const,
    commandKind: request.liveCommand.kind, baseLiveStateProofHash: request.liveState.proofHash,
    proposedLiveState: liveResult.state, repair, impact, notificationDrafts, findings: [] };
  return deepFreeze({ ...body, proofHash: canonicalHash(body) });
}

export function verifyLiveChangeProposal(proposal: LiveChangeProposal): boolean {
  const { proofHash, ...body } = proposal;
  return canonicalHash(body) === proofHash;
}

export function approveLiveChange(proposal: LiveChangeProposal,
  decision: { readonly approvedBy: string; readonly approvedAt: string }): Readonly<ApprovedLiveChange> {
  if (!verifyLiveChangeProposal(proposal) || proposal.status !== "READY_FOR_APPROVAL" || !proposal.proposedLiveState
    || !proposal.repair.assignments || !proposal.repair.proof.optimalityProven) throw new Error("Only an intact approval-ready live change may be approved");
  if (!decision.approvedBy.trim() || decision.approvedBy === proposal.proposedBy || !canonicalTimestamp(decision.approvedAt)) {
    throw new Error("Live-change approval requires a different actor and canonical time");
  }
  const body = { schemaVersion: "1.0.0" as const, proposalId: proposal.proposalId, tournamentId: proposal.tournamentId,
    status: "APPROVED" as const, approvedBy: decision.approvedBy, approvedAt: decision.approvedAt,
    proposalProofHash: proposal.proofHash, liveState: proposal.proposedLiveState, assignments: proposal.repair.assignments,
    notificationDrafts: proposal.notificationDrafts };
  return deepFreeze({ ...body, approvalHash: canonicalHash(body) });
}
