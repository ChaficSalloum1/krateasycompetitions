export type ParticipantShape =
  | "individual"
  | "fixed_team"
  | "dynamic_team"
  | "pair"
  | "squad"
  | "relay_team";

export type StagePrimitive =
  | "single_round_robin"
  | "double_round_robin"
  | "groups"
  | "single_elimination"
  | "double_elimination"
  | "consolation"
  | "placement"
  | "swiss"
  | "ladder"
  | "league_table"
  | "qualifying_heat"
  | "time_trial"
  | "ranking_stage"
  | "play_in"
  | "repechage"
  | "custom_graph";

export type RuleOrigin =
  | "explicit_prompt"
  | "conversation_clarification"
  | "selected_template"
  | "organisation_default"
  | "sport_default"
  | "compiler_optimisation"
  | "manual_override";

export type KnowledgeClass =
  | "KNOWN"
  | "DERIVED"
  | "DEFAULTED"
  | "OPTIMISED"
  | "RANDOMISED"
  | "UNRESOLVED";

export type RequirementStatus =
  | "SATISFIED"
  | "DELIBERATELY_RELAXED"
  | "UNRESOLVED";

export type RuleStrength = "HARD" | "SOFT";

export interface RuleEvidence {
  id: string;
  rulePath: string;
  origin: RuleOrigin;
  knowledge: KnowledgeClass;
  sourceReference: string;
  approved: boolean;
  critical: boolean;
}

export interface Requirement {
  id: string;
  sourceText: string;
  type: string;
  strength: RuleStrength;
  status: RequirementStatus;
  mappedRuleIds: string[];
  resolutionNote?: string;
}

export interface SportDefinition {
  id: string;
  adapterVersion: string;
  participantUnit: ParticipantShape;
  teamSize?: number;
  contest: {
    kind: "head_to_head" | "ranked_performance";
    sides?: number;
  };
  scoringCapabilities: string[];
  defaultResourceType: string;
}

export interface ParticipantModel {
  count: number;
  shape: ParticipantShape;
  rosterSize?: number;
  identityProvider?: string;
}

export interface DivisionDefinition {
  id: string;
  label: string;
  participantCount: number;
  participantShape: ParticipantShape;
  stageIds: string[];
}

export interface PoolConfiguration {
  poolCount: number;
  sizes: number[];
  rounds: 1 | 2;
  allocation: "snake" | "random" | "manual" | "optimised";
}

export interface BracketConfiguration {
  entrantCount: number;
  topology: "power_of_two" | "play_ins" | "byes" | "arbitrary";
  thirdPlaceMatch: boolean;
}

export interface DoubleEliminationConfiguration {
  resetFinalPolicy: "NEVER" | "IF_NECESSARY";
}

export interface RepechageConfiguration {
  model: "QUARTERFINAL_LOSERS_TO_SEMIFINAL_LOSERS";
}

export interface PlayInConfiguration {
  mainDrawSize: number;
}

export interface DynamicEntrantConfiguration {
  id: string;
  seedMark: number;
  withdrawn?: boolean;
}

export interface SwissConfiguration {
  schemaVersion: "1.0.0";
  entrantIds: string[];
  totalRounds: number;
  pairingPolicy: {
    rematches: "FORBIDDEN" | "MINIMIZE";
    bye?: "LOWEST_RANKED_WITHOUT_BYE" | "LOWEST_RANKED";
    searchNodeLimit?: number;
  };
  points: { win: number; draw: number; bye: number };
  finalRankingPolicy: {
    id: string;
    version: "1";
    criteria: Array<"POINTS" | "HEAD_TO_HEAD" | "COMPETITOR_ID" | "SHARED_RANK">;
  };
}

export interface LadderConfiguration {
  schemaVersion: "1.0.0";
  initialOrder: string[];
  maxChallengeDistance: number;
}

export interface QualifyingHeatConfiguration {
  schemaVersion: "1.0.0";
  entrants: DynamicEntrantConfiguration[];
  heatCount: number;
  lanesPerHeat: number;
  lanePriority: number[];
  betterSeedMark: "LOWER" | "HIGHER";
  seedTiePolicy?: "UNRESOLVED" | "COMPETITOR_ID";
  qualificationPlaces: number;
  timeTiePolicy: "UNRESOLVED" | "SHARED_RANK" | "SEED_ORDER";
  cutoffTiePolicy: "UNRESOLVED" | "SEED_ORDER" | "ADVANCE_ALL";
  seedOrder?: string[];
}

export interface TimeTrialConfiguration {
  schemaVersion: "1.0.0";
  entrants: DynamicEntrantConfiguration[];
  qualificationPlaces: number;
  timeTiePolicy: "UNRESOLVED" | "SHARED_RANK" | "SEED_ORDER";
  cutoffTiePolicy: "UNRESOLVED" | "SEED_ORDER" | "ADVANCE_ALL";
  seedOrder?: string[];
}

export interface RankingStageConfiguration {
  schemaVersion: "1.0.0";
  entrantIds: string[];
  qualificationPlaces: number;
  betterScore: "LOWER" | "HIGHER";
  cutoffTiePolicy: "UNRESOLVED" | "SEED_ORDER" | "ADVANCE_ALL";
  seedOrder?: string[];
}

export interface ClassificationConfiguration {
  schemaVersion: "1.0.0";
  sourceNodes: Array<{ id: string; kind: "MATCH" | "BYE" }>;
  contests: Array<{
    id: string;
    label: string;
    places: [number, number];
    sources: [
      { nodeId: string; port: "WINNER" | "LOSER" },
      { nodeId: string; port: "WINNER" | "LOSER" },
    ];
  }>;
}

export type CustomGraphInputConfiguration =
  | { type: "ENTRANT"; seed: number }
  | { type: "PORT"; nodeId: string; port: "WINNER" | "LOSER" };

export type CustomGraphNodeConfiguration =
  | { id: string; kind: "MATCH"; inputs: [CustomGraphInputConfiguration, CustomGraphInputConfiguration]; outputs: ["WINNER" | "LOSER", "WINNER" | "LOSER"] }
  | { id: string; kind: "BYE"; inputs: [Extract<CustomGraphInputConfiguration, { type: "ENTRANT" }>]; outputs: ["WINNER"] };

export interface CustomGraphConfiguration {
  schemaVersion: "1.0.0";
  entrantCount: number;
  nodes: CustomGraphNodeConfiguration[];
}

export interface StageDefinition {
  id: string;
  label: string;
  divisionId: string;
  primitive: StagePrimitive;
  inputShape: ParticipantShape;
  outputShape: ParticipantShape;
  expectedEntrants?: number;
  pool?: PoolConfiguration;
  bracket?: BracketConfiguration;
  doubleElimination?: DoubleEliminationConfiguration;
  repechage?: RepechageConfiguration;
  playIn?: PlayInConfiguration;
  swiss?: SwissConfiguration;
  ladder?: LadderConfiguration;
  qualifyingHeat?: QualifyingHeatConfiguration;
  timeTrial?: TimeTrialConfiguration;
  rankingStage?: RankingStageConfiguration;
  classification?: ClassificationConfiguration;
  customGraph?: CustomGraphConfiguration;
}

export interface ScoringSystemDefinition {
  id: string;
  adapterRule: string;
  version: string;
  stageIds: string[];
}

export interface StandingsPolicy {
  id: string;
  stageIds: string[];
  metricOrder: Array<{ metric: string; direction: "ASC" | "DESC" }>;
  tieFallback: "manual_decision" | "deterministic_draw" | "shared_rank";
}

export type QualificationMetricExpression =
  | { type: "value"; key: string }
  | { type: "ratio_percent"; numeratorKey: string; denominatorKey: string }
  | { type: "aggregate"; reducer: "sum" | "average"; terms: Array<{ key: string; weight: number }> };

export type QualificationSelector =
  | { type: "top_n"; count: number }
  | { type: "bottom_n"; count: number }
  | { type: "pool_position"; position: number }
  | { type: "pool_winners" }
  | { type: "best_n_across_pools"; count: number; poolPosition?: number }
  | { type: "remainder" }
  | { type: "manual_decision"; count: number }
  | { type: "ranking_points"; metricKey: string; count: number; cutoffTiePolicy: "reject" | "candidate_id" | "include_all" }
  | { type: "threshold"; metric: QualificationMetricExpression; comparison: "at_least" | "at_most" | "greater_than" | "less_than"; value: number }
  | { type: "score_threshold"; metricKey: string; minimum: number }
  | { type: "percentage_threshold"; numeratorMetricKey: string; denominatorMetricKey: string; minimumPercent: number }
  | { type: "elapsed_time"; metricKey: string; count: number; cutoffTiePolicy: "reject" | "candidate_id" | "include_all" }
  | { type: "aggregate_metric"; metric: Extract<QualificationMetricExpression, { type: "aggregate" }>; count: number; direction: "higher" | "lower"; cutoffTiePolicy: "reject" | "candidate_id" | "include_all" }
  | { type: "best_n"; metric: QualificationMetricExpression; count: number; direction: "higher" | "lower"; eligibleRank?: number; cutoffTiePolicy: "reject" | "candidate_id" | "include_all" }
  | { type: "authority_selection"; selectionType: "wildcard" | "host"; candidateIds: string[]; approval: {
      status: "approved"; authorityId: string; approvalHash: string;
    } };

export interface QualificationPolicy {
  id: string;
  sourceStageId: string;
  destinationStructureId: string;
  outputCount: number;
  selectors: QualificationSelector[];
  normalization?:
    | "per_match"
    | "percentage"
    | "remove_lowest_finisher"
    | "best_n_results"
    | "strength_adjusted";
}

export interface CompetitionStructure {
  id: string;
  label: string;
  divisionId: string;
  targetEntrants: number;
  stageIds: string[];
}

export interface DrawPolicy {
  id: string;
  structureId: string;
  placement: "seeded" | "random" | "manual" | "optimised";
  priorities: Array<{
    rule: string;
    strength: RuleStrength;
    priority: number;
    weight?: number;
  }>;
}

export interface ProgressionPolicy {
  id: string;
  fromStageId: string;
  outcome: "winner" | "loser" | "rank" | "pool_position";
  outcomeValue?: number;
  toStageId: string;
  destinationSlots: number;
  sourceCanBeBye: boolean;
}

export interface SchedulingDefinition {
  timezone: string;
  start: string;
  finishBy?: string;
  constraints: Array<{
    id: string;
    rule: string;
    strength: RuleStrength;
    value?: number | string | boolean;
    unit?: "minutes" | "count" | "boolean";
    weight?: number;
  }>;
  durations: Array<{
    stageId: string;
    round?: string;
    contestMinutes: number;
    turnaroundMinutes: number;
  }>;
  objective: "earliest_finish" | "minimum_idle" | "balanced_quality";
}

export interface ResourceDefinition {
  id: string;
  type: string;
  quantity: number;
  availability: Array<{ start: string; end: string }>;
}

export interface OperationalPolicy {
  id: string;
  rule: string;
  strength: RuleStrength;
  value?: string | number | boolean;
}

export interface RandomisationPolicy {
  mode: "none" | "deterministic";
  algorithm?: "xoshiro128ss" | "pcg32";
  seed?: string;
}

export interface CompilationMetadata {
  specId: string;
  revision: number;
  schemaVersion: string;
  compilerVersion: string;
  rulesetVersions: Record<string, string>;
  sourcePromptHash: string;
  compiledSpecHash: string;
  createdAt: string;
  previousSpecHash?: string;
}

export interface TournamentDefinition {
  sport: SportDefinition;
  participants: ParticipantModel;
  divisions: DivisionDefinition[];
  stages: StageDefinition[];
  scoringSystems: ScoringSystemDefinition[];
  standingsPolicies: StandingsPolicy[];
  qualificationPolicies: QualificationPolicy[];
  competitionStructures: CompetitionStructure[];
  drawPolicies: DrawPolicy[];
  progressionPolicies: ProgressionPolicy[];
  scheduling: SchedulingDefinition;
  resources: ResourceDefinition[];
  operationalPolicies: OperationalPolicy[];
  randomisation: RandomisationPolicy;
  assumptions: RuleEvidence[];
  requirements: Requirement[];
}

export interface TournamentSpec extends TournamentDefinition {
  metadata: CompilationMetadata;
}

export interface ValidationFinding {
  code: string;
  severity: "ERROR" | "WARNING";
  path: string;
  message: string;
  evidence?: Record<string, unknown>;
}

export interface ValidationResult {
  valid: boolean;
  findings: ValidationFinding[];
}

export interface CompilationContext {
  specId: string;
  revision: number;
  schemaVersion: string;
  compilerVersion: string;
  rulesetVersions: Record<string, string>;
  sourcePrompt: string;
  createdAt: string;
  previousSpecHash?: string;
}

export interface SemanticChange {
  operation: "add" | "remove" | "replace";
  path: string;
  before?: unknown;
  after?: unknown;
}

export interface RevisionPlan {
  id: string;
  fromHash: string;
  candidate: TournamentSpec;
  changes: SemanticChange[];
  validation: ValidationResult;
  status: "VALID" | "INVALID";
}
