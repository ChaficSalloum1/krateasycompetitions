import { createHash } from "node:crypto";
import {
  applyLadderChallenge,
  assignQualifyingHeats,
  createLadder,
  pairSwissRound,
  qualifyRankingStage,
  rankTimeTrial,
  verifyLadder,
  type LadderState,
  type QualifyingHeat,
  type RankedTrialResult,
  type SwissPairingPolicy,
  type TimeTrialResult,
} from "./ranked-formats.js";
import {
  createSwissRankingEngine,
  type SwissRankingCriterion,
  type SwissRankingMetrics,
  type SwissRankingPolicy,
} from "./swiss-ranking.js";

interface LegacySwissRankingPolicy {
  readonly id: string; readonly version: "1";
  readonly criteria: readonly ("POINTS" | "HEAD_TO_HEAD" | "COMPETITOR_ID" | "SHARED_RANK")[];
}
interface AdvancedSwissRankingPolicy {
  readonly id: string; readonly version: "1.0.0"; readonly criteria: readonly SwissRankingCriterion[];
  readonly medianBuchholzDrop: number; readonly incompleteData: "REJECT" | "PROVISIONAL";
  readonly tieResolution: "REJECT" | "SHARED_RANK" | "COMPETITOR_ID";
}
export type LifecycleSwissRankingPolicy = LegacySwissRankingPolicy | AdvancedSwissRankingPolicy;

export interface SwissStageDefinition {
  readonly id: string; readonly revision: number; readonly kind: "SWISS"; readonly entrants: readonly string[]; readonly totalRounds: number;
  readonly pairingPolicy: SwissPairingPolicy; readonly points: { readonly win: number; readonly draw: number; readonly bye: number };
  readonly finalRankingPolicy: LifecycleSwissRankingPolicy;
}
export interface HeatStageDefinition {
  readonly id: string; readonly revision: number; readonly kind: "HEAT_TIME_QUALIFICATION";
  readonly entrants: readonly { readonly id: string; readonly seedMark: number; readonly withdrawn?: boolean }[];
  readonly heatCount: number; readonly lanesPerHeat: number; readonly lanePriority: readonly number[]; readonly betterSeedMark: "LOWER" | "HIGHER";
  readonly seedTiePolicy?: "UNRESOLVED" | "COMPETITOR_ID"; readonly qualificationPlaces: number;
  readonly timeTiePolicy: "UNRESOLVED" | "SHARED_RANK" | "SEED_ORDER"; readonly cutoffTiePolicy: "UNRESOLVED" | "SEED_ORDER" | "ADVANCE_ALL";
  readonly seedOrder?: readonly string[];
}
export interface LadderStageDefinition {
  readonly id: string; readonly revision: number; readonly kind: "LADDER"; readonly initialOrder: readonly string[]; readonly maxChallengeDistance: number;
}
export interface RankingStageDefinition {
  readonly id: string; readonly revision: number; readonly kind: "RANKING_STAGE"; readonly entrantIds: readonly string[];
  readonly qualificationPlaces: number; readonly betterScore: "LOWER" | "HIGHER";
  readonly cutoffTiePolicy: "UNRESOLVED" | "SEED_ORDER" | "ADVANCE_ALL"; readonly seedOrder?: readonly string[];
}
export type DynamicStageDefinition = SwissStageDefinition | HeatStageDefinition | LadderStageDefinition | RankingStageDefinition;
export type DynamicStagePhase = "DEFINITION" | "READY" | "RUNNING" | "COMPLETE";

export interface SwissRoundResult {
  readonly contestId: string; readonly competitors: readonly [string, string]; readonly winnerId: string | null;
}
export interface RankingStageResult { readonly competitorId: string; readonly score: number; readonly withdrawn?: boolean; }
interface CommandAudit { readonly expectedVersion: number; readonly idempotencyKey: string; readonly actorId: string; readonly occurredAt: string; }
export type DynamicStageCommand =
  | (CommandAudit & { readonly kind: "PREPARE" })
  | (CommandAudit & { readonly kind: "START" })
  | (CommandAudit & { readonly kind: "SUBMIT_SWISS_ROUND"; readonly round: number; readonly results: readonly SwissRoundResult[] })
  | (CommandAudit & { readonly kind: "SUBMIT_HEAT_RESULTS"; readonly results: readonly TimeTrialResult[] })
  | (CommandAudit & { readonly kind: "CORRECT_HEAT_RESULT"; readonly competitorId: string; readonly supersedesResultHash: string;
      readonly result: TimeTrialResult; readonly reason: string })
  | (CommandAudit & { readonly kind: "VOID_HEAT_RESULT"; readonly competitorId: string; readonly supersedesResultHash: string; readonly reason: string })
  | (CommandAudit & { readonly kind: "CORRECT_SWISS_ROUND"; readonly round: number; readonly supersedesResultHash: string;
      readonly results: readonly SwissRoundResult[]; readonly reason: string })
  | (CommandAudit & { readonly kind: "VOID_SWISS_ROUND"; readonly round: number; readonly supersedesResultHash: string; readonly reason: string })
  | (CommandAudit & { readonly kind: "RECORD_LADDER_CHALLENGE"; readonly challengerId: string; readonly defenderId: string;
      readonly winnerId: string; readonly scheduleReference: string; readonly reason: string })
  | (CommandAudit & { readonly kind: "COMPLETE_LADDER" })
  | (CommandAudit & { readonly kind: "SUBMIT_RANKING_RESULTS"; readonly results: readonly RankingStageResult[] });

export interface LifecycleFinding { readonly code: string; readonly message: string; readonly causes?: readonly string[]; }
export interface StageSchedulingRequest {
  readonly contestId: string; readonly stageId: string; readonly round: number | "HEAT"; readonly participantIds: readonly string[];
  readonly adapterStatus: "REQUIRES_EXTERNAL_ASSIGNMENT";
}
export interface LifecycleEvent {
  readonly sequence: number; readonly kind: DynamicStageCommand["kind"]; readonly idempotencyKey: string; readonly commandHash: string;
  readonly actorId: string; readonly occurredAt: string; readonly command: DynamicStageCommand;
  readonly previousEventHash: string | null; readonly eventHash: string;
}
export interface SwissStanding { readonly competitorId: string; readonly points: number; readonly opponents: readonly string[]; readonly byeCount: number; readonly rank?: number; }
export interface LifecycleSwissPairing { readonly contestId: string; readonly board: number; readonly competitors: readonly [string, string]; readonly pairingProofHash: string; }
export interface SwissRuntime {
  readonly kind: "SWISS"; readonly currentRound: number; readonly standings: readonly SwissStanding[]; readonly pairings: readonly LifecycleSwissPairing[];
  readonly currentByeCompetitorId: string | null;
  readonly completedRounds: readonly { readonly round: number; readonly results: readonly SwissRoundResult[]; readonly resultHash: string;
    readonly byeCompetitorId: string | null; readonly pairings: readonly LifecycleSwissPairing[] }[];
  readonly finalStandings: readonly (SwissStanding & { readonly rank: number; readonly tiebreaks: SwissRankingMetrics })[];
  readonly rankingPolicyHash: string | null;
  readonly rankingProof: Readonly<{ policyId: string; policyVersion: string; policyHash: string; effectivePolicyHash: string;
    rankingProofHash: string }> | null;
}
export interface RecordedHeatResult { readonly result: TimeTrialResult; readonly resultHash: string; }
export interface HeatRuntime {
  readonly kind: "HEAT_TIME_QUALIFICATION"; readonly heats: readonly QualifyingHeat[]; readonly heatAssignmentHash: string | null;
  readonly recordedResults: readonly RecordedHeatResult[]; readonly trialRanking: readonly RankedTrialResult[];
  readonly qualifiedCompetitorIds: readonly string[]; readonly qualificationHash: string | null;
}
export interface LadderRuntime { readonly kind: "LADDER"; readonly ladder: LadderState | null; readonly scheduleReferences: readonly string[]; }
export interface RankingRuntime { readonly kind: "RANKING_STAGE"; readonly results: readonly RankingStageResult[];
  readonly orderedResults: readonly RankingStageResult[]; readonly qualifiedCompetitorIds: readonly string[]; readonly qualificationHash: string | null; }
export interface UnsupportedRuntime { readonly kind: "UNSUPPORTED"; }
export type DynamicStageRuntime = SwissRuntime | HeatRuntime | LadderRuntime | RankingRuntime | UnsupportedRuntime;
export interface DynamicStageState {
  readonly definition: DynamicStageDefinition; readonly phase: DynamicStagePhase; readonly version: number; readonly runtime: DynamicStageRuntime;
  readonly schedulingRequests: readonly StageSchedulingRequest[]; readonly events: readonly LifecycleEvent[]; readonly stateHash: string;
}
export interface DynamicStageTransition {
  readonly status: "APPLIED" | "REPLAYED" | "REJECTED"; readonly state: DynamicStageState; readonly findings: readonly LifecycleFinding[];
  readonly proof: { readonly previousStateHash: string; readonly nextStateHash: string; readonly eventHash: string | null; readonly proofHash: string };
  readonly replayHash: string;
}
export interface DynamicStageReplay {
  readonly status: "REPLAYED" | "REJECTED"; readonly state: DynamicStageState; readonly findings: readonly LifecycleFinding[]; readonly replayHash: string;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(",")}}`;
  return JSON.stringify(value) ?? "undefined";
}
function hash(value: unknown): string { return createHash("sha256").update(canonical(value)).digest("hex"); }
function freeze<T>(value: T): Readonly<T> {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
function stateHash(state: Omit<DynamicStageState, "stateHash">): string { return hash(state); }

function initialRuntime(definition: DynamicStageDefinition): DynamicStageRuntime {
  if (definition.kind === "SWISS") return { kind: "SWISS", currentRound: 0,
    standings: definition.entrants.map((competitorId) => ({ competitorId, points: 0, opponents: [], byeCount: 0 })),
    pairings: [], currentByeCompetitorId: null, completedRounds: [], finalStandings: [], rankingPolicyHash: null, rankingProof: null };
  if (definition.kind === "HEAT_TIME_QUALIFICATION") return { kind: "HEAT_TIME_QUALIFICATION", heats: [], heatAssignmentHash: null,
    recordedResults: [], trialRanking: [], qualifiedCompetitorIds: [], qualificationHash: null };
  if (definition.kind === "LADDER") return { kind: "LADDER", ladder: null, scheduleReferences: [] };
  if (definition.kind === "RANKING_STAGE") return { kind: "RANKING_STAGE", results: [], orderedResults: [], qualifiedCompetitorIds: [], qualificationHash: null };
  return { kind: "UNSUPPORTED" };
}

export function defineDynamicStage(definition: DynamicStageDefinition): DynamicStageState {
  const base = { definition: structuredClone(definition), phase: "DEFINITION" as const, version: 0, runtime: initialRuntime(definition),
    schedulingRequests: [] as readonly StageSchedulingRequest[], events: [] as readonly LifecycleEvent[] };
  return freeze({ ...base, stateHash: stateHash(base) });
}

function transitionResult(status: DynamicStageTransition["status"], previous: DynamicStageState, state: DynamicStageState,
  eventHash: string | null, findings: readonly LifecycleFinding[]): DynamicStageTransition {
  const proofBase = { previousStateHash: previous.stateHash, nextStateHash: state.stateHash, eventHash };
  const proof = { ...proofBase, proofHash: hash(proofBase) };
  const base = { status, state, findings: [...findings], proof };
  return freeze({ ...base, replayHash: hash(base) });
}
function rejected(state: DynamicStageState, code: string, message: string, causes?: readonly string[]): DynamicStageTransition {
  return transitionResult("REJECTED", state, state, null, [{ code, message, ...(causes ? { causes: [...causes] } : {}) }]);
}

function contestPairings(stageId: string, round: number, output: ReturnType<typeof pairSwissRound>): LifecycleSwissPairing[] {
  return output.pairings.map(({ board, competitors }) => ({ contestId: `${stageId}.R${round}.B${board}`, board, competitors, pairingProofHash: output.replayHash }));
}
function swissRequests(stageId: string, round: number, pairings: readonly LifecycleSwissPairing[]): StageSchedulingRequest[] {
  return pairings.map(({ contestId, competitors }) => ({ contestId, stageId, round, participantIds: [...competitors], adapterStatus: "REQUIRES_EXTERNAL_ASSIGNMENT" }));
}
function withSwissBye(standings: readonly SwissStanding[], competitorId: string | undefined, points: number): SwissStanding[] {
  return standings.map((standing) => standing.competitorId === competitorId
    ? { ...standing, points: standing.points + points, byeCount: standing.byeCount + 1 } : { ...standing, opponents: [...standing.opponents] });
}
function swissCompetitors(standings: readonly SwissStanding[]) {
  return standings.map(({ competitorId, points, opponents, byeCount }) => ({ id: competitorId, points, opponents, byeCount }));
}

function effectiveRankingPolicy(definition: SwissStageDefinition): SwissRankingPolicy | undefined {
  const policy = definition.finalRankingPolicy;
  if (!policy.id.trim()) return undefined;
  if (policy.version === "1") {
    if (policy.criteria.length < 2 || policy.criteria[0] !== "POINTS" || new Set(policy.criteria).size !== policy.criteria.length ||
      !["COMPETITOR_ID", "SHARED_RANK"].includes(policy.criteria.at(-1)!) || policy.criteria.slice(0, -1).includes("SHARED_RANK")) return undefined;
    const tieResolution = policy.criteria.at(-1) === "SHARED_RANK" ? "SHARED_RANK" as const : "COMPETITOR_ID" as const;
    const criteria = policy.criteria.filter((criterion): criterion is Extract<SwissRankingCriterion, "POINTS" | "HEAD_TO_HEAD"> =>
      criterion === "POINTS" || criterion === "HEAD_TO_HEAD");
    return { id: policy.id, version: "1.0.0", criteria, points: { ...definition.points, loss: 0 }, medianBuchholzDrop: 0,
      incompleteData: "REJECT", tieResolution };
  }
  return { id: policy.id, version: policy.version, criteria: [...policy.criteria], points: { ...definition.points, loss: 0 },
    medianBuchholzDrop: policy.medianBuchholzDrop, incompleteData: policy.incompleteData, tieResolution: policy.tieResolution };
}

function validRankingPolicy(definition: SwissStageDefinition): boolean {
  const effective = effectiveRankingPolicy(definition);
  return Boolean(effective && effective.criteria.length > 0 && effective.criteria[0] === "POINTS" && new Set(effective.criteria).size === effective.criteria.length &&
    Number.isInteger(effective.medianBuchholzDrop) && effective.medianBuchholzDrop >= 0);
}

type LifecycleRanking = { status: "CERTIFIED"; standings: Array<SwissStanding & { rank: number; tiebreaks: SwissRankingMetrics }>;
  policyHash: string; proof: NonNullable<SwissRuntime["rankingProof"]> } | { status: "REJECTED"; findings: readonly LifecycleFinding[] };

function rankSwiss(definition: SwissStageDefinition, standings: readonly SwissStanding[],
  rounds: readonly SwissRuntime["completedRounds"][number][]): LifecycleRanking {
  const effective = effectiveRankingPolicy(definition);
  if (!effective) return { status: "REJECTED", findings: [{ code: "INVALID_SWISS_RANKING_POLICY", message: "Final ranking policy is not a registered explicit lifecycle policy." }] };
  const rankingRounds = rounds.map((round) => ({ round: round.round, byes: round.byeCompetitorId ? [round.byeCompetitorId] : [],
    games: round.results.map((result) => ({ competitors: result.competitors,
      result: result.winnerId === null ? "DRAW" as const : result.winnerId === result.competitors[0] ? "LEFT_WIN" as const : "RIGHT_WIN" as const })) }));
  const ranked = createSwissRankingEngine([effective]).rank({ policyId: effective.id, tournamentId: definition.id,
    entrants: definition.entrants, rounds: rankingRounds });
  if (ranked.status !== "CERTIFIED") return { status: "REJECTED", findings: ranked.findings.map(({ code, message }) => ({ code, message })) };
  const byId = new Map(standings.map((standing) => [standing.competitorId, standing]));
  const policyHash = hash(definition.finalRankingPolicy);
  return { status: "CERTIFIED", standings: ranked.rows.map((row) => ({ ...byId.get(row.competitorId)!, rank: row.rank, tiebreaks: row.metrics })),
    policyHash, proof: { policyId: definition.finalRankingPolicy.id, policyVersion: definition.finalRankingPolicy.version, policyHash,
      effectivePolicyHash: ranked.proof.policyHash!, rankingProofHash: ranked.proofHash } };
}

function rebuildSwissStandings(definition: SwissStageDefinition, rounds: readonly SwissRuntime["completedRounds"][number][]): SwissStanding[] {
  const standings = definition.entrants.map((competitorId): SwissStanding => ({ competitorId, points: 0, opponents: [], byeCount: 0 }));
  const byId = new Map(standings.map((standing) => [standing.competitorId, { ...standing, opponents: [...standing.opponents] }]));
  for (const round of rounds) {
    if (round.byeCompetitorId) {
      const standing = byId.get(round.byeCompetitorId)!; standing.points += definition.points.bye; standing.byeCount += 1;
    }
    for (const result of round.results) {
      const [left, right] = result.competitors; byId.get(left)!.opponents.push(right); byId.get(right)!.opponents.push(left);
      if (result.winnerId === null) { byId.get(left)!.points += definition.points.draw; byId.get(right)!.points += definition.points.draw; }
      else byId.get(result.winnerId)!.points += definition.points.win;
    }
  }
  return definition.entrants.map((id) => byId.get(id)!);
}

type Prepared = { phase: DynamicStagePhase; runtime: DynamicStageRuntime; schedulingRequests: readonly StageSchedulingRequest[] } | { findings: readonly LifecycleFinding[] };
function prepare(state: DynamicStageState): Prepared {
  const definition = state.definition;
  if (!definition.id.trim() || !Number.isInteger(definition.revision) || definition.revision < 1) {
    return { findings: [{ code: "INVALID_DEFINITION", message: "Stage id and positive integer revision are required." }] };
  }
  if (definition.kind === "SWISS") {
    if (definition.entrants.length < 2 || new Set(definition.entrants).size !== definition.entrants.length || definition.entrants.some((id) => !id.trim()) ||
      !Number.isInteger(definition.totalRounds) || definition.totalRounds < 1 || Object.values(definition.points).some((points) => !Number.isFinite(points) || points < 0) ||
      !validRankingPolicy(definition)) {
      return { findings: [{ code: "INVALID_SWISS_DEFINITION", message: "Swiss fields, entrants, rounds, and point values are invalid." }] };
    }
    const initial = state.runtime as SwissRuntime;
    const pairing = pairSwissRound({ round: 1, competitors: swissCompetitors(initial.standings), policy: definition.pairingPolicy });
    if (pairing.status !== "CERTIFIED") return { findings: pairing.findings.map(({ code, message }) => ({ code, message })) };
    const pairings = contestPairings(definition.id, 1, pairing);
    const standings = withSwissBye(initial.standings, pairing.bye?.competitorId, definition.points.bye);
    return { phase: "READY", runtime: { ...initial, currentRound: 1, standings, pairings,
      currentByeCompetitorId: pairing.bye?.competitorId ?? null }, schedulingRequests: swissRequests(definition.id, 1, pairings) };
  }
  if (definition.kind === "HEAT_TIME_QUALIFICATION") {
    const assignment = assignQualifyingHeats({ stageId: definition.id, entrants: definition.entrants, heatCount: definition.heatCount,
      lanesPerHeat: definition.lanesPerHeat, lanePriority: definition.lanePriority, betterMark: definition.betterSeedMark,
      ...(definition.seedTiePolicy ? { seedTiePolicy: definition.seedTiePolicy } : {}) });
    if (assignment.status !== "CERTIFIED") return { findings: assignment.findings.map(({ code, message }) => ({ code, message })) };
    const requests = assignment.heats.map(({ heat, assignments }): StageSchedulingRequest => ({ contestId: `${definition.id}.H${heat}`, stageId: definition.id,
      round: "HEAT", participantIds: assignments.map(({ competitorId }) => competitorId), adapterStatus: "REQUIRES_EXTERNAL_ASSIGNMENT" }));
    const runtime: HeatRuntime = { kind: "HEAT_TIME_QUALIFICATION", heats: assignment.heats, heatAssignmentHash: assignment.replayHash,
      recordedResults: [], trialRanking: [], qualifiedCompetitorIds: [], qualificationHash: null };
    return { phase: "READY", runtime, schedulingRequests: requests };
  }
  if (definition.kind === "LADDER") {
    if (!Number.isInteger(definition.maxChallengeDistance) || definition.maxChallengeDistance < 1) {
      return { findings: [{ code: "INVALID_LADDER_DEFINITION", message: "Maximum challenge distance must be a positive integer." }] };
    }
    try {
      const ladder = createLadder(definition.id, definition.initialOrder);
      return { phase: "READY", runtime: { kind: "LADDER", ladder, scheduleReferences: [] }, schedulingRequests: [] };
    } catch (error) {
      return { findings: [{ code: "INVALID_LADDER_DEFINITION", message: error instanceof Error ? error.message : "Invalid ladder definition." }] };
    }
  }
  if (definition.kind === "RANKING_STAGE") {
    if (definition.entrantIds.length < 2 || new Set(definition.entrantIds).size !== definition.entrantIds.length ||
      definition.entrantIds.some((id) => !id.trim()) || !Number.isInteger(definition.qualificationPlaces) ||
      definition.qualificationPlaces < 1 || definition.qualificationPlaces > definition.entrantIds.length) {
      return { findings: [{ code: "INVALID_RANKING_DEFINITION", message: "Ranking entrants and qualification places are invalid." }] };
    }
    const request: StageSchedulingRequest = { contestId: `${definition.id}.RANKING`, stageId: definition.id, round: "HEAT",
      participantIds: [...definition.entrantIds], adapterStatus: "REQUIRES_EXTERNAL_ASSIGNMENT" };
    return { phase: "READY", runtime: state.runtime, schedulingRequests: [request] };
  }
  return { findings: [{ code: "UNSUPPORTED_STAGE_KIND", message: "No lifecycle adapter is registered for this stage kind." }] };
}

function commit(previous: DynamicStageState, command: DynamicStageCommand, phase: DynamicStagePhase,
  runtime: DynamicStageRuntime, schedulingRequests: readonly StageSchedulingRequest[]): DynamicStageTransition {
  const commandHash = hash(command);
  const eventBase = { sequence: previous.version + 1, kind: command.kind, idempotencyKey: command.idempotencyKey, commandHash,
    actorId: command.actorId, occurredAt: command.occurredAt, command: structuredClone(command),
    previousEventHash: previous.events.at(-1)?.eventHash ?? null };
  const event: LifecycleEvent = { ...eventBase, eventHash: hash(eventBase) };
  const base = { definition: previous.definition, phase, version: previous.version + 1, runtime,
    schedulingRequests: [...schedulingRequests], events: [...previous.events, event] };
  const next = freeze({ ...base, stateHash: stateHash(base) });
  return transitionResult("APPLIED", previous, next, event.eventHash, []);
}

function submitSwiss(state: DynamicStageState, command: Extract<DynamicStageCommand, { kind: "SUBMIT_SWISS_ROUND" }>): DynamicStageTransition {
  if (state.definition.kind !== "SWISS" || state.runtime.kind !== "SWISS" || state.phase !== "RUNNING") {
    return rejected(state, "INVALID_TRANSITION", "Swiss round results require a running Swiss stage.");
  }
  const runtime = state.runtime;
  if (command.round !== runtime.currentRound) return rejected(state, "ROUND_CONFLICT", "Submitted Swiss round is not the current round.");
  const expected = new Map(runtime.pairings.map((pairing) => [pairing.contestId, pairing]));
  if (command.results.length !== runtime.pairings.length || new Set(command.results.map(({ contestId }) => contestId)).size !== command.results.length) {
    return rejected(state, "INCOMPLETE_ROUND", "Exactly one result is required for every current Swiss pairing.");
  }
  for (const result of command.results) {
    const pairing = expected.get(result.contestId);
    const actualIds = [...result.competitors].sort(); const expectedIds = pairing ? [...pairing.competitors].sort() : [];
    if (!pairing || actualIds.join("|") !== expectedIds.join("|") || result.competitors[0] === result.competitors[1] ||
      result.winnerId !== null && !result.competitors.includes(result.winnerId)) {
      return rejected(state, "INVALID_SWISS_RESULT", "Result identity, competitors, or winner does not match the certified pairing.");
    }
  }
  const points = new Map(runtime.standings.map((standing) => [standing.competitorId, standing.points]));
  const opponents = new Map(runtime.standings.map((standing) => [standing.competitorId, [...standing.opponents]]));
  for (const result of command.results) {
    const [left, right] = result.competitors; opponents.get(left)!.push(right); opponents.get(right)!.push(left);
    if (result.winnerId === null) { points.set(left, points.get(left)! + state.definition.points.draw); points.set(right, points.get(right)! + state.definition.points.draw); }
    else points.set(result.winnerId, points.get(result.winnerId)! + state.definition.points.win);
  }
  let standings: SwissStanding[] = runtime.standings.map((standing) => ({ ...standing, points: points.get(standing.competitorId)!, opponents: opponents.get(standing.competitorId)! }));
  const completedRounds = [...runtime.completedRounds, { round: command.round, results: structuredClone(command.results), resultHash: hash(command.results),
    byeCompetitorId: runtime.currentByeCompetitorId, pairings: runtime.pairings }];
  if (command.round === state.definition.totalRounds) {
    const ranking = rankSwiss(state.definition, standings, completedRounds);
    if (ranking.status === "REJECTED") return rejected(state, ranking.findings[0]?.code ?? "SWISS_RANKING_REJECTED",
      "Final Swiss standings could not be certified by the registered ranking policy.", ranking.findings.map(({ code }) => code));
    const next: SwissRuntime = { ...runtime, standings, pairings: [], completedRounds, finalStandings: ranking.standings,
      rankingPolicyHash: ranking.policyHash, rankingProof: ranking.proof };
    return commit(state, command, "COMPLETE", next, state.schedulingRequests);
  }
  const round = command.round + 1;
  const pairing = pairSwissRound({ round, competitors: swissCompetitors(standings), policy: state.definition.pairingPolicy });
  if (pairing.status !== "CERTIFIED") return rejected(state, pairing.findings[0]?.code ?? "PAIRING_REJECTED", "Next Swiss round could not be certified.", pairing.findings.map(({ code }) => code));
  const pairings = contestPairings(state.definition.id, round, pairing);
  standings = withSwissBye(standings, pairing.bye?.competitorId, state.definition.points.bye);
  const next: SwissRuntime = { ...runtime, currentRound: round, standings, pairings, completedRounds,
    currentByeCompetitorId: pairing.bye?.competitorId ?? null };
  return commit(state, command, "RUNNING", next, [...state.schedulingRequests, ...swissRequests(state.definition.id, round, pairings)]);
}

function validHeatResult(result: TimeTrialResult): boolean {
  return Boolean(result.competitorId.trim()) && (result.status === "VALID"
    ? Number.isInteger(result.timeMilliseconds) && result.timeMilliseconds! >= 0 : result.timeMilliseconds === undefined);
}

function normalizedRecordedResults(definition: HeatStageDefinition, records: readonly RecordedHeatResult[]): RecordedHeatResult[] {
  const rank = new Map(definition.entrants.map(({ id }, index) => [id, index]));
  return records.slice().sort((left, right) => rank.get(left.result.competitorId)! - rank.get(right.result.competitorId)!);
}

function evaluateHeat(state: DynamicStageState & { definition: HeatStageDefinition; runtime: HeatRuntime }, command: DynamicStageCommand,
  recordedResults: readonly RecordedHeatResult[]): DynamicStageTransition {
  const results = recordedResults.map(({ result }) => result);
  const trial = rankTimeTrial({ stageId: state.definition.id, results, tiePolicy: state.definition.timeTiePolicy,
    ...(state.definition.seedOrder ? { seedOrder: state.definition.seedOrder } : {}) });
  if (trial.status !== "CERTIFIED") return rejected(state, trial.findings[0]?.code ?? "TRIAL_RANKING_REJECTED", "Time-trial ranking could not be certified.", trial.findings.map(({ code }) => code));
  const qualification = qualifyRankingStage({ stageId: state.definition.id,
    results: trial.ranking.filter((entry) => entry.status === "VALID").map((entry) => ({ competitorId: entry.competitorId, score: entry.timeMilliseconds! })),
    qualificationPlaces: state.definition.qualificationPlaces, betterScore: "LOWER", cutoffTiePolicy: state.definition.cutoffTiePolicy,
    ...(state.definition.seedOrder ? { seedOrder: state.definition.seedOrder } : {}) });
  if (qualification.status !== "CERTIFIED") return rejected(state, qualification.findings[0]?.code ?? "QUALIFICATION_REJECTED",
    "Ranking qualification could not be certified.", qualification.findings.map(({ code }) => code));
  const runtime: HeatRuntime = { ...state.runtime, recordedResults, trialRanking: trial.ranking, qualifiedCompetitorIds: qualification.qualifiedCompetitorIds,
    qualificationHash: qualification.replayHash };
  return commit(state, command, "COMPLETE", runtime, state.schedulingRequests);
}

function submitHeat(state: DynamicStageState, command: Extract<DynamicStageCommand, { kind: "SUBMIT_HEAT_RESULTS" }>): DynamicStageTransition {
  if (state.definition.kind !== "HEAT_TIME_QUALIFICATION" || state.runtime.kind !== "HEAT_TIME_QUALIFICATION" || state.phase !== "RUNNING") {
    return rejected(state, "INVALID_TRANSITION", "Heat results require a running heat qualification stage.");
  }
  const expected = new Set(state.definition.entrants.filter(({ withdrawn }) => !withdrawn).map(({ id }) => id));
  const received = command.results.map(({ competitorId }) => competitorId);
  const existing = new Set(state.runtime.recordedResults.map(({ result }) => result.competitorId));
  if (received.length === 0 || new Set(received).size !== received.length || command.results.some((result) =>
    !expected.has(result.competitorId) || existing.has(result.competitorId) || !validHeatResult(result))) {
    return rejected(state, "INVALID_HEAT_RESULT_BATCH", "Each batch must contain new, valid results for assigned active entrants only; corrections require an explicit correction command.");
  }
  const recordedResults = normalizedRecordedResults(state.definition, [...state.runtime.recordedResults,
    ...command.results.map((result) => ({ result: structuredClone(result), resultHash: hash(result) }))]);
  if (recordedResults.length < expected.size) {
    const runtime: HeatRuntime = { ...state.runtime, recordedResults, trialRanking: [], qualifiedCompetitorIds: [], qualificationHash: null };
    return commit(state, command, "RUNNING", runtime, state.schedulingRequests);
  }
  return evaluateHeat(state as DynamicStageState & { definition: HeatStageDefinition; runtime: HeatRuntime }, command, recordedResults);
}

function validSwissReplacement(pairings: readonly LifecycleSwissPairing[], results: readonly SwissRoundResult[]): boolean {
  if (results.length !== pairings.length || new Set(results.map(({ contestId }) => contestId)).size !== results.length) return false;
  const expected = new Map(pairings.map((pairing) => [pairing.contestId, pairing]));
  return results.every((result) => {
    const pairing = expected.get(result.contestId);
    return Boolean(pairing) && [...result.competitors].sort().join("|") === [...pairing!.competitors].sort().join("|") &&
      result.competitors[0] !== result.competitors[1] && (result.winnerId === null || result.competitors.includes(result.winnerId));
  });
}

function correctSwiss(state: DynamicStageState, command: Extract<DynamicStageCommand, { kind: "CORRECT_SWISS_ROUND" }>): DynamicStageTransition {
  if (state.definition.kind !== "SWISS" || state.runtime.kind !== "SWISS" || state.phase !== "COMPLETE") {
    return rejected(state, "INVALID_TRANSITION", "Swiss correction is supported only for the final completed round before downstream publication.");
  }
  const latest = state.runtime.completedRounds.at(-1);
  if (!latest || latest.round !== command.round || latest.resultHash !== command.supersedesResultHash) {
    return rejected(state, "RESULT_LINEAGE_CONFLICT", "Correction must supersede the current final-round result hash.");
  }
  if (!command.reason.trim() || !validSwissReplacement(latest.pairings, command.results)) {
    return rejected(state, "INVALID_SWISS_CORRECTION", "Correction requires a reason and complete results matching the certified final-round pairings.");
  }
  const replacement = { ...latest, results: structuredClone(command.results), resultHash: hash(command.results) };
  const rounds = [...state.runtime.completedRounds.slice(0, -1), replacement];
  const standings = rebuildSwissStandings(state.definition, rounds);
  const ranking = rankSwiss(state.definition, standings, rounds);
  if (ranking.status === "REJECTED") return rejected(state, ranking.findings[0]?.code ?? "SWISS_RANKING_REJECTED",
    "Corrected Swiss standings could not be certified by the registered ranking policy.", ranking.findings.map(({ code }) => code));
  const runtime: SwissRuntime = { ...state.runtime, standings, completedRounds: rounds, finalStandings: ranking.standings,
    rankingPolicyHash: ranking.policyHash, rankingProof: ranking.proof };
  return commit(state, command, "COMPLETE", runtime, state.schedulingRequests);
}

function voidSwiss(state: DynamicStageState, command: Extract<DynamicStageCommand, { kind: "VOID_SWISS_ROUND" }>): DynamicStageTransition {
  if (state.definition.kind !== "SWISS" || state.runtime.kind !== "SWISS" || state.phase !== "COMPLETE") {
    return rejected(state, "INVALID_TRANSITION", "Swiss void is supported only for the final completed round.");
  }
  const latest = state.runtime.completedRounds.at(-1);
  if (!latest || latest.round !== command.round || latest.resultHash !== command.supersedesResultHash) {
    return rejected(state, "RESULT_LINEAGE_CONFLICT", "Void must supersede the current final-round result hash.");
  }
  if (!command.reason.trim()) return rejected(state, "VOID_REASON_REQUIRED", "Voiding Swiss results requires an audit reason.");
  const rounds = state.runtime.completedRounds.slice(0, -1);
  const standings = rebuildSwissStandings(state.definition, rounds);
  const runtime: SwissRuntime = { ...state.runtime, currentRound: latest.round, standings, pairings: latest.pairings,
    currentByeCompetitorId: latest.byeCompetitorId, completedRounds: rounds, finalStandings: [], rankingPolicyHash: null, rankingProof: null };
  return commit(state, command, "RUNNING", runtime, state.schedulingRequests);
}

function correctHeat(state: DynamicStageState, command: Extract<DynamicStageCommand, { kind: "CORRECT_HEAT_RESULT" }>): DynamicStageTransition {
  if (state.definition.kind !== "HEAT_TIME_QUALIFICATION" || state.runtime.kind !== "HEAT_TIME_QUALIFICATION" ||
    !["RUNNING", "COMPLETE"].includes(state.phase)) return rejected(state, "INVALID_TRANSITION", "Heat correction requires a running or complete heat stage.");
  if (!command.reason.trim() || command.result.competitorId !== command.competitorId || !validHeatResult(command.result)) {
    return rejected(state, "INVALID_HEAT_CORRECTION", "Correction requires a reason and one valid result for the named competitor.");
  }
  const current = state.runtime.recordedResults.find(({ result }) => result.competitorId === command.competitorId);
  if (!current || current.resultHash !== command.supersedesResultHash) return rejected(state, "RESULT_LINEAGE_CONFLICT", "Correction must supersede the current result hash.");
  const recordedResults = normalizedRecordedResults(state.definition, state.runtime.recordedResults.map((record) => record === current
    ? { result: structuredClone(command.result), resultHash: hash(command.result) } : record));
  if (state.phase === "COMPLETE") return evaluateHeat(state as DynamicStageState & { definition: HeatStageDefinition; runtime: HeatRuntime }, command, recordedResults);
  const runtime: HeatRuntime = { ...state.runtime, recordedResults, trialRanking: [], qualifiedCompetitorIds: [], qualificationHash: null };
  return commit(state, command, "RUNNING", runtime, state.schedulingRequests);
}

function voidHeat(state: DynamicStageState, command: Extract<DynamicStageCommand, { kind: "VOID_HEAT_RESULT" }>): DynamicStageTransition {
  if (state.definition.kind !== "HEAT_TIME_QUALIFICATION" || state.runtime.kind !== "HEAT_TIME_QUALIFICATION" ||
    !["RUNNING", "COMPLETE"].includes(state.phase)) return rejected(state, "INVALID_TRANSITION", "Heat void requires a running or complete heat stage.");
  if (!command.reason.trim()) return rejected(state, "VOID_REASON_REQUIRED", "Voiding a heat result requires an audit reason.");
  const current = state.runtime.recordedResults.find(({ result }) => result.competitorId === command.competitorId);
  if (!current || current.resultHash !== command.supersedesResultHash) return rejected(state, "RESULT_LINEAGE_CONFLICT", "Void must supersede the current result hash.");
  const runtime: HeatRuntime = { ...state.runtime, recordedResults: state.runtime.recordedResults.filter((record) => record !== current),
    trialRanking: [], qualifiedCompetitorIds: [], qualificationHash: null };
  return commit(state, command, "RUNNING", runtime, state.schedulingRequests);
}

function ladderChallenge(state: DynamicStageState, command: Extract<DynamicStageCommand, { kind: "RECORD_LADDER_CHALLENGE" }>): DynamicStageTransition {
  if (state.definition.kind !== "LADDER" || state.runtime.kind !== "LADDER" || !state.runtime.ladder || state.phase !== "RUNNING") {
    return rejected(state, "INVALID_TRANSITION", "Challenge results require a running prepared ladder.");
  }
  if (!command.scheduleReference.trim()) return rejected(state, "SCHEDULE_REFERENCE_REQUIRED", "A challenge must reference its external schedule record.");
  const challenge = applyLadderChallenge(state.runtime.ladder, { challengerId: command.challengerId, defenderId: command.defenderId,
    winnerId: command.winnerId, maxChallengeDistance: state.definition.maxChallengeDistance, actorId: command.actorId,
    occurredAt: command.occurredAt, reason: command.reason });
  if (challenge.status !== "CERTIFIED") return rejected(state, challenge.findings[0]?.code ?? "LADDER_REJECTED", "Ladder challenge could not be certified.", challenge.findings.map(({ code }) => code));
  const runtime: LadderRuntime = { ...state.runtime, ladder: challenge.ladder, scheduleReferences: [...state.runtime.scheduleReferences, command.scheduleReference] };
  return commit(state, command, "RUNNING", runtime, state.schedulingRequests);
}

function submitRanking(state: DynamicStageState, command: Extract<DynamicStageCommand, { kind: "SUBMIT_RANKING_RESULTS" }>): DynamicStageTransition {
  if (state.definition.kind !== "RANKING_STAGE" || state.runtime.kind !== "RANKING_STAGE" || state.phase !== "RUNNING") {
    return rejected(state, "INVALID_TRANSITION", "Ranking results require a running ranking stage.");
  }
  const expected = new Set(state.definition.entrantIds);
  if (command.results.length !== expected.size || new Set(command.results.map(({ competitorId }) => competitorId)).size !== command.results.length ||
    command.results.some(({ competitorId, score }) => !expected.has(competitorId) || !Number.isFinite(score))) {
    return rejected(state, "INVALID_RANKING_RESULT_SET", "Exactly one finite score is required for every declared ranking entrant.");
  }
  const qualification = qualifyRankingStage({ stageId: state.definition.id, results: command.results, qualificationPlaces: state.definition.qualificationPlaces,
    betterScore: state.definition.betterScore, cutoffTiePolicy: state.definition.cutoffTiePolicy,
    ...(state.definition.seedOrder ? { seedOrder: state.definition.seedOrder } : {}) });
  if (qualification.status !== "CERTIFIED") return rejected(state, qualification.findings[0]?.code ?? "QUALIFICATION_REJECTED",
    "Ranking qualification could not be certified.", qualification.findings.map(({ code }) => code));
  const runtime: RankingRuntime = { kind: "RANKING_STAGE", results: structuredClone(command.results), orderedResults: qualification.orderedResults,
    qualifiedCompetitorIds: qualification.qualifiedCompetitorIds, qualificationHash: qualification.replayHash };
  return commit(state, command, "COMPLETE", runtime, state.schedulingRequests);
}

const COMMANDS = new Set(["PREPARE", "START", "SUBMIT_SWISS_ROUND", "CORRECT_SWISS_ROUND", "VOID_SWISS_ROUND",
  "SUBMIT_HEAT_RESULTS", "CORRECT_HEAT_RESULT", "VOID_HEAT_RESULT", "RECORD_LADDER_CHALLENGE", "COMPLETE_LADDER", "SUBMIT_RANKING_RESULTS"]);
export function transitionDynamicStage(state: DynamicStageState, command: DynamicStageCommand): DynamicStageTransition {
  const verification = verifyDynamicStage(state);
  if (!verification.valid) return rejected(state, "INVALID_STATE_PROOF", "Lifecycle state or event proof is invalid.", verification.findings.map(({ code }) => code));
  const commandHash = hash(command);
  const existing = state.events.find(({ idempotencyKey }) => idempotencyKey === command.idempotencyKey);
  if (existing) return existing.commandHash === commandHash ? transitionResult("REPLAYED", state, state, existing.eventHash, [])
    : rejected(state, "IDEMPOTENCY_CONFLICT", "Idempotency key was already bound to different command content.");
  if (!COMMANDS.has((command as { kind: string }).kind)) return rejected(state, "UNSUPPORTED_COMMAND", "Command kind is not registered for dynamic lifecycle execution.");
  if (!command.idempotencyKey.trim() || !command.actorId.trim() || !Number.isFinite(Date.parse(command.occurredAt))) {
    return rejected(state, "INVALID_COMMAND_AUDIT", "Idempotency key, actor, and valid occurrence time are required.");
  }
  if (!Number.isInteger(command.expectedVersion) || command.expectedVersion !== state.version) return rejected(state, "VERSION_CONFLICT", "Expected lifecycle version does not match current state.");
  if (command.kind === "PREPARE") {
    if (state.phase !== "DEFINITION") return rejected(state, "INVALID_TRANSITION", "PREPARE is valid only from Definition.");
    const prepared = prepare(state);
    if ("findings" in prepared) return transitionResult("REJECTED", state, state, null, prepared.findings);
    return commit(state, command, prepared.phase, prepared.runtime, prepared.schedulingRequests);
  }
  if (command.kind === "START") {
    if (state.phase !== "READY") return rejected(state, "INVALID_TRANSITION", "START is valid only from Ready.");
    return commit(state, command, "RUNNING", state.runtime, state.schedulingRequests);
  }
  if (command.kind === "SUBMIT_SWISS_ROUND") return submitSwiss(state, command);
  if (command.kind === "CORRECT_SWISS_ROUND") return correctSwiss(state, command);
  if (command.kind === "VOID_SWISS_ROUND") return voidSwiss(state, command);
  if (command.kind === "SUBMIT_HEAT_RESULTS") return submitHeat(state, command);
  if (command.kind === "CORRECT_HEAT_RESULT") return correctHeat(state, command);
  if (command.kind === "VOID_HEAT_RESULT") return voidHeat(state, command);
  if (command.kind === "RECORD_LADDER_CHALLENGE") return ladderChallenge(state, command);
  if (command.kind === "SUBMIT_RANKING_RESULTS") return submitRanking(state, command);
  if (command.kind === "COMPLETE_LADDER") {
    if (state.phase !== "RUNNING" || state.definition.kind !== "LADDER" || state.runtime.kind !== "LADDER" || !state.runtime.ladder || !verifyLadder(state.runtime.ladder).valid) {
      return rejected(state, "INVALID_TRANSITION", "COMPLETE_LADDER requires a running, proof-valid ladder.");
    }
    return commit(state, command, "COMPLETE", state.runtime, state.schedulingRequests);
  }
  return rejected(state, "UNSUPPORTED_COMMAND", "Command kind is not registered for dynamic lifecycle execution.");
}

export function verifyDynamicStage(state: DynamicStageState): Readonly<{ valid: boolean; findings: readonly LifecycleFinding[]; proofHash: string }> {
  const findings: LifecycleFinding[] = [];
  let previous: string | null = null;
  state.events.forEach((event, index) => {
    const { eventHash, ...base } = event;
    if (event.sequence !== index + 1 || event.previousEventHash !== previous) findings.push({ code: "BROKEN_EVENT_CHAIN", message: `Lifecycle event ${index + 1} has invalid lineage.` });
    if (hash(base) !== eventHash) findings.push({ code: "EVENT_HASH_MISMATCH", message: `Lifecycle event ${index + 1} was modified.` });
    if (hash(event.command) !== event.commandHash || event.command.kind !== event.kind || event.command.idempotencyKey !== event.idempotencyKey ||
      event.command.actorId !== event.actorId || event.command.occurredAt !== event.occurredAt) {
      findings.push({ code: "COMMAND_ENVELOPE_MISMATCH", message: `Lifecycle event ${index + 1} command does not match its audit envelope.` });
    }
    if (!COMMANDS.has(event.kind)) findings.push({ code: "UNKNOWN_EVENT", message: `Lifecycle event ${index + 1} has an unsupported kind.` });
    previous = event.eventHash;
  });
  const { stateHash: proof, ...base } = state;
  if (stateHash(base) !== proof) findings.push({ code: "STATE_HASH_MISMATCH", message: "Lifecycle state does not match its content hash." });
  if (state.version !== state.events.length) findings.push({ code: "VERSION_EVENT_MISMATCH", message: "Lifecycle version does not equal committed event count." });
  const kinds = state.events.map(({ kind }) => kind);
  let expectedPhase: DynamicStagePhase = "DEFINITION";
  if (kinds.length > 0) {
    if (kinds[0] !== "PREPARE") findings.push({ code: "INVALID_EVENT_PROGRESSION", message: "The first lifecycle event must be PREPARE." });
    expectedPhase = "READY";
  }
  if (kinds.length > 1) {
    if (kinds[1] !== "START") findings.push({ code: "INVALID_EVENT_PROGRESSION", message: "The second lifecycle event must be START." });
    expectedPhase = "RUNNING";
  }
  const executionKinds = kinds.slice(2);
  if (state.definition.kind === "SWISS") {
    if (executionKinds.some((kind) => !["SUBMIT_SWISS_ROUND", "CORRECT_SWISS_ROUND", "VOID_SWISS_ROUND"].includes(kind))) {
      findings.push({ code: "INVALID_EVENT_PROGRESSION", message: "Swiss execution contains an event from another format." });
    }
    if (state.runtime.kind === "SWISS") {
      const rounds = state.runtime.completedRounds.map(({ round }) => round);
      if (rounds.some((round, index) => round !== index + 1) || rounds.length > state.definition.totalRounds) {
        findings.push({ code: "INVALID_ROUND_HISTORY", message: "Completed Swiss rounds must be contiguous and within the declared total." });
      }
      if (kinds.length > 1 && rounds.length === state.definition.totalRounds && state.runtime.finalStandings.length > 0) expectedPhase = "COMPLETE";
    }
  } else if (state.definition.kind === "HEAT_TIME_QUALIFICATION") {
    if (executionKinds.some((kind) => !["SUBMIT_HEAT_RESULTS", "CORRECT_HEAT_RESULT", "VOID_HEAT_RESULT"].includes(kind))) {
      findings.push({ code: "INVALID_EVENT_PROGRESSION", message: "Heat qualification execution contains an event from another format." });
    }
    if (state.runtime.kind === "HEAT_TIME_QUALIFICATION") {
      const expectedResults = state.definition.entrants.filter(({ withdrawn }) => !withdrawn).length;
      if (state.runtime.recordedResults.length > expectedResults || new Set(state.runtime.recordedResults.map(({ result }) => result.competitorId)).size !== state.runtime.recordedResults.length) {
        findings.push({ code: "INVALID_HEAT_RESULT_HISTORY", message: "Recorded heat result identities are incomplete or duplicated." });
      }
      if (kinds.length > 1 && state.runtime.recordedResults.length === expectedResults && state.runtime.qualificationHash) expectedPhase = "COMPLETE";
    }
  } else if (state.definition.kind === "LADDER") {
    const completion = executionKinds.indexOf("COMPLETE_LADDER");
    if (executionKinds.some((kind, index) => kind !== "RECORD_LADDER_CHALLENGE" && !(kind === "COMPLETE_LADDER" && index === executionKinds.length - 1)) ||
      completion >= 0 && completion !== executionKinds.length - 1) {
      findings.push({ code: "INVALID_EVENT_PROGRESSION", message: "Ladder challenges must precede one final completion event." });
    }
    if (completion >= 0) expectedPhase = "COMPLETE";
  } else if (state.definition.kind === "RANKING_STAGE") {
    if (executionKinds.some((kind) => kind !== "SUBMIT_RANKING_RESULTS") || executionKinds.length > 1) {
      findings.push({ code: "INVALID_EVENT_PROGRESSION", message: "Ranking execution requires exactly one result-set event." });
    }
    if (state.runtime.kind === "RANKING_STAGE" && state.runtime.qualificationHash) expectedPhase = "COMPLETE";
  }
  if (state.phase !== expectedPhase) findings.push({ code: "PHASE_EVENT_MISMATCH", message: `Event history proves ${expectedPhase}, not ${state.phase}.` });
  if (state.runtime.kind !== state.definition.kind) findings.push({ code: "RUNTIME_FORMAT_MISMATCH", message: "Runtime format does not match the stage definition." });
  if (new Set(state.schedulingRequests.map(({ contestId }) => contestId)).size !== state.schedulingRequests.length) {
    findings.push({ code: "DUPLICATE_SCHEDULING_REQUEST", message: "Scheduling adapter requests must have unique contest ids." });
  }
  return freeze({ valid: findings.length === 0, findings, proofHash: hash({ state, findings }) });
}

export function replayDynamicStage(definition: DynamicStageDefinition, events: readonly LifecycleEvent[]): DynamicStageReplay {
  let state = defineDynamicStage(definition);
  for (const expected of events) {
    const transition = transitionDynamicStage(state, expected.command);
    const actual = transition.state.events.at(-1);
    if (transition.status !== "APPLIED" || !actual || actual.eventHash !== expected.eventHash || actual.commandHash !== expected.commandHash) {
      const findings: LifecycleFinding[] = [{ code: "REPLAY_DIVERGENCE", message: `Replay diverged at lifecycle event ${expected.sequence}.` }];
      const base = { status: "REJECTED" as const, state, findings };
      return freeze({ ...base, replayHash: hash(base) });
    }
    state = transition.state;
  }
  const verification = verifyDynamicStage(state);
  if (!verification.valid) {
    const base = { status: "REJECTED" as const, state, findings: verification.findings };
    return freeze({ ...base, replayHash: hash(base) });
  }
  const base = { status: "REPLAYED" as const, state, findings: [] as readonly LifecycleFinding[] };
  return freeze({ ...base, replayHash: hash(base) });
}
