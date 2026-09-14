import type { RequirementStatus, TournamentSpec, ValidationFinding } from "@tournament-os/tournament-schema";

export interface Entrant {
  id: string;
  divisionId: string;
  memberIds: string[];
  seed?: number;
  poolId?: string;
}

export type SlotSource =
  | { type: "entrant"; entrantId: string }
  | { type: "winner"; contestId: string }
  | { type: "loser"; contestId: string }
  | { type: "bye" };

export interface ContestCondition {
  type: "SOURCE_SLOT_WON";
  sourceContestId: string;
  sourceSlot: 0 | 1;
}

export interface ContestNode {
  id: string;
  stageId: string;
  divisionId: string;
  poolId?: string;
  round: string;
  roundIndex: number;
  index: number;
  kind: "contest" | "bye";
  slots: [SlotSource, SlotSource];
  requiredResourceType: string;
  condition?: ContestCondition;
}

export interface ProgressionEdge {
  fromContestId: string;
  outcome: "winner" | "loser" | "complete";
  toContestId: string;
  toSlot: 0 | 1;
}

export interface CompetitionGraph {
  specHash: string;
  nodes: ContestNode[];
  edges: ProgressionEdge[];
  expectedActualContestCount: number;
  generatedActualContestCount: number;
  findings: ValidationFinding[];
  stageProofs?: Array<{ stageId: string; adapterId: string; proofHash: string }>;
}

export interface ContestResult {
  contestId: string;
  entrants: [string, string];
  winnerId: string;
  loserId: string;
  scoreFor: [number, number];
  status: "completed" | "walkover";
}

export interface Standing {
  entrantId: string;
  poolId?: string;
  rank: number;
  played: number;
  wins: number;
  losses: number;
  draws: number;
  scoreFor: number;
  scoreAgainst: number;
  scoreDifference: number;
  winningPercentage: number;
  tieResolution: string[];
}

export interface QualificationEvidence {
  entrantId: string;
  policyId: string;
  destinationStructureId: string;
  selector: string;
  sourceStanding: Standing;
  comparisonSet: string[];
  tieResolution: string[];
  selectorIndex?: number;
  metricValue?: number;
  authorityId?: string;
  proofHash?: string;
}

export interface QualificationResult {
  byStructure: Record<string, Entrant[]>;
  evidence: QualificationEvidence[];
  findings: ValidationFinding[];
  policyProofs?: Array<{ policyId: string; proofHash: string; verificationHash: string }>;
}

export interface DrawPlacement {
  structureId: string;
  orderedEntrantIds: string[];
  seedPositions: Record<string, number>;
  violations: Array<{ rule: string; entrants: [string, string]; strength: "HARD" | "SOFT" }>;
  candidatesEvaluated: number;
  randomisationProofHash: string | null;
  proofHash: string;
}

export interface ScheduledContest {
  contestId: string;
  resourceId: string;
  start: string;
  end: string;
  possibleEntrantIds: string[];
}

export interface SolverAudit {
  solver: string;
  version: string;
  status: "OPTIMAL" | "FEASIBLE" | "INFEASIBLE" | "UNKNOWN";
  objective: string;
  objectiveValueMinutes?: number;
  lowerBoundMinutes: number;
  optimalityGap?: number;
  scheduleHash?: string;
  validationHash?: string;
}

export interface ScheduleSolution {
  contests: ScheduledContest[];
  audit: SolverAudit;
  findings: ValidationFinding[];
}

export interface SimulationRun {
  seed: string;
  results: ContestResult[];
  completedContestCount: number;
  unresolvedDependencies: string[];
  skippedConditionalContestIds?: string[];
  hash: string;
}

export interface Certification {
  status: "CERTIFIED" | "REJECTED";
  specHash: string;
  graphHash: string;
  scheduleHash?: string;
  simulationHash?: string;
  findings: ValidationFinding[];
  requirementCoverage: Array<{ id: string; status: RequirementStatus }>;
  statement: string;
  certificationHash: string;
}

export interface ScenarioResult {
  spec: TournamentSpec;
  graph: CompetitionGraph;
  schedule: ScheduleSolution;
  simulation?: SimulationRun;
  certification: Certification;
}
