import {
  rankSchedulesByResilience,
  type ScheduleResilienceCandidate,
  type SchedulingProblem,
  type SolverAssignment,
} from "@tournament-os/competition-engine";

const taskIds = ["Pool A · Round 1", "Pool A · Round 2", "Pool A · Round 3", "Pool B · Round 1", "Pool B · Round 2", "Pool B · Round 3"] as const;
const resourceIds = ["Centre Court", "Harbour Court"] as const;

const problem: SchedulingProblem = {
  id: "pilot-opening-session",
  minimumRestMinutes: 0,
  locks: [],
  tasks: taskIds.map((id, index) => ({
    id,
    durationMinutes: 20,
    eligibleResourceIds: resourceIds,
    dependencyIds: [],
    participantIds: [`pair.${index * 2 + 1}`, `pair.${index * 2 + 2}`],
  })),
  resources: resourceIds.map((id) => ({ id, calendars: [{ startMinute: 0, endMinute: 100 }], closures: [] })),
};

function assignment(taskId: string, resourceId: string, startMinute: number): SolverAssignment {
  return { taskId, resourceId, startMinute, endMinute: startMinute + 20, locked: false };
}

const candidates: readonly ScheduleResilienceCandidate[] = [
  {
    candidateId: "fastest-finish",
    assignments: taskIds.map((taskId, index) => assignment(taskId, resourceIds[index < 3 ? 0 : 1]!, (index % 3) * 20)),
  },
  {
    candidateId: "recovery-buffer",
    assignments: taskIds.map((taskId, index) => assignment(taskId, resourceIds[index < 3 ? 0 : 1]!, (index % 3) * 30)),
  },
  {
    candidateId: "unsafe-shortcut",
    assignments: taskIds.map((taskId) => assignment(taskId, resourceIds[0], 0)),
  },
];

const optionNames: Readonly<Record<string, { name: string; promise: string }>> = {
  "recovery-buffer": {
    name: "Recovery buffer",
    promise: "Adds ten minutes between court slots so routine overruns do not cascade.",
  },
  "fastest-finish": {
    name: "Fastest finish",
    promise: "Ends earlier, but a small overrun immediately affects the following slot.",
  },
};

export interface PilotScheduleOption {
  readonly candidateId: string;
  readonly name: string;
  readonly promise: string;
  readonly finishMinutes: number;
  readonly overrunConflictCount: number;
  readonly worstCourtLossContestCount: number;
  readonly notificationBlastRadius: number;
  readonly minimumCriticalSlackMinutes: number | null;
  readonly evidenceHash: string;
  readonly assignments: readonly SolverAssignment[];
}

export interface PilotScheduleDecision {
  readonly status: "READY" | "BLOCKED";
  readonly recommendedCandidateId: string | null;
  readonly approvedCandidateId: string;
  readonly objectiveOrder: readonly string[];
  readonly options: readonly PilotScheduleOption[];
  readonly rejectedOptions: readonly { readonly candidateId: string; readonly findings: readonly string[] }[];
  readonly proofHash: string;
}

export function buildPilotScheduleDecision(): Readonly<PilotScheduleDecision> {
  const ranking = rankSchedulesByResilience(problem, candidates, { overrunMinutes: [10, 20] });
  const options = ranking.candidates.map((candidate): PilotScheduleOption => ({
    candidateId: candidate.candidateId,
    name: optionNames[candidate.candidateId]?.name ?? candidate.candidateId,
    promise: optionNames[candidate.candidateId]?.promise ?? "Independently validated schedule option.",
    finishMinutes: candidate.evidence.makespanMinutes,
    overrunConflictCount: candidate.evidence.overrun.totalConflictCount,
    worstCourtLossContestCount: candidate.evidence.resourceLoss.worstContestsAffected,
    notificationBlastRadius: candidate.evidence.notificationBlastRadius,
    minimumCriticalSlackMinutes: candidate.evidence.minimumCriticalSlackMinutes,
    evidenceHash: candidate.evidenceHash,
    assignments: candidate.assignments,
  }));
  return {
    status: ranking.status === "RANKED" ? "READY" : "BLOCKED",
    recommendedCandidateId: options[0]?.candidateId ?? null,
    approvedCandidateId: "fastest-finish",
    objectiveOrder: ranking.objectiveOrder,
    options,
    rejectedOptions: ranking.rejectedCandidates.map(({ candidateId, findings }) => ({ candidateId, findings })),
    proofHash: ranking.proofHash,
  };
}
