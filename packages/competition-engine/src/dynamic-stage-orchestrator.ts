import {
  canonicalHash,
  deepFreeze,
  validateTournamentSpec,
  type StageDefinition,
  type StagePrimitive,
  type TournamentSpec,
  type ValidationFinding,
} from "@tournament-os/tournament-schema";
import {
  replayDynamicStage,
  transitionDynamicStage,
  verifyDynamicStage,
  type DynamicStageCommand,
  type DynamicStageDefinition,
  type DynamicStageState,
  type LifecycleFinding,
  type RankingStageDefinition,
} from "./dynamic-stage-lifecycle.js";
import {
  createDynamicStageRepository,
  verifyPersistedDynamicStageStream,
  type DynamicStagePersistencePort,
  type DynamicStageRepository,
  type DurableCreateResult,
} from "./dynamic-stage-store.js";
import { solveSchedule, validateSchedule } from "./scheduler.js";
import type { CompetitionGraph, ContestNode, ProgressionEdge, ScheduleSolution } from "./types.js";

const SUPPORTED = new Set<StagePrimitive>(["swiss", "ladder", "qualifying_heat", "time_trial", "ranking_stage"]);

export interface DynamicStageCompilation {
  readonly status: "COMPILED" | "REJECTED";
  readonly primitive: StagePrimitive | null;
  readonly definition: DynamicStageDefinition | null;
  readonly findings: readonly LifecycleFinding[];
  readonly proofHash: string;
}

export type PrimaryDynamicStageCommand = Exclude<DynamicStageCommand, { kind: "RECORD_LADDER_CHALLENGE" }> |
  Omit<Extract<DynamicStageCommand, { kind: "RECORD_LADDER_CHALLENGE" }>, "scheduleReference">;

export interface DynamicStageSchedule {
  readonly status: "SCHEDULED" | "REJECTED";
  readonly solution: Readonly<ScheduleSolution>;
  readonly graphHash: string;
  readonly proofHash: string;
}

export interface PrimaryDynamicOperationResult {
  readonly status: "APPLIED" | "REPLAYED" | "REJECTED" | "NOT_FOUND" | "VERSION_CONFLICT" | "IDEMPOTENCY_CONFLICT";
  readonly state: DynamicStageState | null;
  readonly schedule: DynamicStageSchedule | null;
  readonly findings: readonly LifecycleFinding[];
  readonly persistenceHash: string | null;
  readonly operationHash: string;
}

export interface DynamicStageCertification {
  readonly status: "CERTIFIED" | "REJECTED";
  readonly primitive: StagePrimitive;
  readonly stageId: string;
  readonly specHash: string;
  readonly definitionHash: string;
  readonly streamHash: string | null;
  readonly stateHash: string | null;
  readonly replayHash: string | null;
  readonly scheduleHash: string | null;
  readonly evidence: readonly string[];
  readonly findings: readonly LifecycleFinding[];
  readonly certificationHash: string;
}

export interface PrimaryDynamicStageOrchestrator {
  readonly stageId: string;
  readonly primitive: StagePrimitive;
  initialise(): Promise<DurableCreateResult>;
  execute(command: PrimaryDynamicStageCommand): Promise<PrimaryDynamicOperationResult>;
  load(): ReturnType<DynamicStageRepository["load"]>;
  certify(): Promise<DynamicStageCertification>;
}

function rejectedCompilation(primitive: StagePrimitive | null, code: string, message: string): DynamicStageCompilation {
  const base = { status: "REJECTED" as const, primitive, definition: null, findings: [{ code, message }] };
  return deepFreeze({ ...base, proofHash: canonicalHash(base) });
}

export function compilePrimaryDynamicStage(spec: TournamentSpec, stageId: string): DynamicStageCompilation {
  const validation = validateTournamentSpec(spec);
  if (!validation.valid) return rejectedCompilation(null, "INVALID_TOURNAMENT_SPEC", "TournamentSpec validation failed before dynamic compilation.");
  const stage = spec.stages.find(({ id }) => id === stageId);
  if (!stage) return rejectedCompilation(null, "STAGE_NOT_FOUND", `Stage '${stageId}' does not exist.`);
  if (!SUPPORTED.has(stage.primitive)) return rejectedCompilation(stage.primitive, "UNSUPPORTED_DYNAMIC_PRIMITIVE", `No primary dynamic adapter is registered for '${stage.primitive}'.`);
  let definition: DynamicStageDefinition;
  if (stage.primitive === "swiss" && stage.swiss) {
    definition = { id: stage.id, revision: spec.metadata.revision, kind: "SWISS", entrants: [...stage.swiss.entrantIds],
      totalRounds: stage.swiss.totalRounds, pairingPolicy: { ...stage.swiss.pairingPolicy }, points: { ...stage.swiss.points },
      finalRankingPolicy: structuredClone(stage.swiss.finalRankingPolicy) };
  } else if (stage.primitive === "ladder" && stage.ladder) {
    definition = { id: stage.id, revision: spec.metadata.revision, kind: "LADDER", initialOrder: [...stage.ladder.initialOrder],
      maxChallengeDistance: stage.ladder.maxChallengeDistance };
  } else if (stage.primitive === "qualifying_heat" && stage.qualifyingHeat) {
    definition = heatDefinition(stage, spec.metadata.revision, stage.qualifyingHeat);
  } else if (stage.primitive === "time_trial" && stage.timeTrial) {
    const active = stage.timeTrial.entrants.filter(({ withdrawn }) => !withdrawn).length;
    definition = heatDefinition(stage, spec.metadata.revision, { ...stage.timeTrial, heatCount: 1, lanesPerHeat: active,
      lanePriority: Array.from({ length: active }, (_, index) => index + 1), betterSeedMark: "LOWER", seedTiePolicy: "COMPETITOR_ID" });
  } else if (stage.primitive === "ranking_stage" && stage.rankingStage) {
    definition = { id: stage.id, revision: spec.metadata.revision, kind: "RANKING_STAGE", entrantIds: [...stage.rankingStage.entrantIds],
      qualificationPlaces: stage.rankingStage.qualificationPlaces, betterScore: stage.rankingStage.betterScore,
      cutoffTiePolicy: stage.rankingStage.cutoffTiePolicy, ...(stage.rankingStage.seedOrder ? { seedOrder: [...stage.rankingStage.seedOrder] } : {}) };
  } else return rejectedCompilation(stage.primitive, "MISSING_DYNAMIC_CONFIGURATION", "The matching dynamic configuration is absent.");
  const base = { status: "COMPILED" as const, primitive: stage.primitive, definition, findings: [] as readonly LifecycleFinding[] };
  return deepFreeze({ ...base, proofHash: canonicalHash(base) });
}

function heatDefinition(stage: StageDefinition, revision: number, config: NonNullable<StageDefinition["qualifyingHeat"]>): DynamicStageDefinition {
  return { id: stage.id, revision, kind: "HEAT_TIME_QUALIFICATION", entrants: structuredClone(config.entrants), heatCount: config.heatCount,
    lanesPerHeat: config.lanesPerHeat, lanePriority: [...config.lanePriority], betterSeedMark: config.betterSeedMark,
    ...(config.seedTiePolicy ? { seedTiePolicy: config.seedTiePolicy } : {}), qualificationPlaces: config.qualificationPlaces,
    timeTiePolicy: config.timeTiePolicy, cutoffTiePolicy: config.cutoffTiePolicy,
    ...(config.seedOrder ? { seedOrder: [...config.seedOrder] } : {}) };
}

function ladderRequests(state: DynamicStageState): Array<{ contestId: string; stageId: string; round: number; participantIds: readonly string[] }> {
  let sequence = 0;
  return state.events.flatMap((event) => {
    if (event.command.kind !== "RECORD_LADDER_CHALLENGE") return [];
    sequence += 1;
    return [{ contestId: `${state.definition.id}.C${sequence}`, stageId: state.definition.id, round: sequence,
      participantIds: [event.command.challengerId, event.command.defenderId] }];
  });
}

function graphFor(spec: TournamentSpec, state: DynamicStageState): CompetitionGraph {
  const requests = [...state.schedulingRequests.map((request) => ({ ...request, round: request.round === "HEAT" ? 1 : request.round })), ...ladderRequests(state)];
  const nodes: ContestNode[] = requests.map((request, index) => ({ id: request.contestId, stageId: request.stageId,
    divisionId: spec.stages.find(({ id }) => id === request.stageId)!.divisionId, round: String(request.round), roundIndex: request.round,
    index: index + 1, kind: "contest" as const,
    slots: [{ type: "entrant", entrantId: request.participantIds[0]! }, { type: "entrant", entrantId: request.participantIds[1]! }],
    requiredResourceType: spec.sport.defaultResourceType }));
  const edges: ProgressionEdge[] = [];
  for (const next of nodes) for (const prior of nodes) if (prior.roundIndex < next.roundIndex) edges.push({
    fromContestId: prior.id, outcome: "complete", toContestId: next.id, toSlot: 0,
  });
  return { specHash: spec.metadata.compiledSpecHash, nodes, edges, expectedActualContestCount: nodes.length,
    generatedActualContestCount: nodes.length, findings: [] };
}

function scheduleState(spec: TournamentSpec, state: DynamicStageState): DynamicStageSchedule {
  const graph = graphFor(spec, state);
  const participants = new Map<string, readonly string[]>([
    ...state.schedulingRequests.map((request): [string, readonly string[]] => [request.contestId, request.participantIds]),
    ...ladderRequests(state).map((request): [string, readonly string[]] => [request.contestId, request.participantIds]),
  ]);
  const solved = solveSchedule(spec, graph);
  const contests = solved.contests.map((contest) => ({ ...contest, possibleEntrantIds: [...(participants.get(contest.contestId) ?? contest.possibleEntrantIds)].sort() }));
  const candidate: ScheduleSolution = { ...solved, contests, audit: { ...solved.audit } };
  const validation = validateSchedule(spec, graph, candidate);
  const findings = [...solved.findings, ...validation];
  const auditBase = { ...candidate.audit, validationHash: canonicalHash(validation) };
  delete auditBase.scheduleHash;
  const scheduleHash = canonicalHash({ scheduled: contests, audit: auditBase });
  const solution = { contests, findings, audit: { ...auditBase, scheduleHash,
    status: findings.some(({ severity }) => severity === "ERROR") ? "INFEASIBLE" as const : solved.audit.status } };
  const base = { status: solution.audit.status === "FEASIBLE" || solution.audit.status === "OPTIMAL" ? "SCHEDULED" as const : "REJECTED" as const,
    solution, graphHash: canonicalHash(graph) };
  return deepFreeze({ ...base, proofHash: canonicalHash(base) });
}

function lifecycleFindings(findings: readonly ValidationFinding[]): LifecycleFinding[] {
  return findings.map(({ code, message }) => ({ code, message }));
}

function evidenceFor(state: DynamicStageState, primitive: StagePrimitive): string[] {
  const common = ["validated-tournament-spec", "atomic-transactional-event-stream", "deterministic-lifecycle-replay", "production-scheduler-validation"];
  if (primitive === "swiss" && state.runtime.kind === "SWISS" && state.runtime.rankingProof) return [...common, "multi-round-pairing-proof", "registered-final-ranking-proof"];
  if (primitive === "ladder" && state.runtime.kind === "LADDER" && state.runtime.ladder) return [...common, "hash-chained-challenge-audit", "scheduled-challenge-reference"];
  if (primitive === "qualifying_heat" && state.runtime.kind === "HEAT_TIME_QUALIFICATION") return [...common, "heat-assignment-proof", "time-ranking-proof", "cutoff-qualification-proof"];
  if (primitive === "time_trial" && state.runtime.kind === "HEAT_TIME_QUALIFICATION") return [...common, "time-ranking-proof", "cutoff-qualification-proof"];
  if (primitive === "ranking_stage" && state.runtime.kind === "RANKING_STAGE") return [...common, "score-order-proof", "cutoff-qualification-proof"];
  return common;
}

export function createPrimaryDynamicStageOrchestrator(input: {
  readonly spec: TournamentSpec; readonly stageId: string; readonly persistence: DynamicStagePersistencePort;
}): PrimaryDynamicStageOrchestrator {
  if (input.persistence.capabilities.durability !== "TRANSACTIONAL_SQLITE" || !input.persistence.capabilities.multiProcessAtomicity) {
    throw new Error("Primary dynamic orchestration requires the transactional SQLite persistence capability");
  }
  const compilation = compilePrimaryDynamicStage(input.spec, input.stageId);
  if (compilation.status !== "COMPILED" || !compilation.definition || !compilation.primitive) {
    throw new Error(compilation.findings.map(({ code, message }) => `${code}: ${message}`).join("; "));
  }
  const repository = createDynamicStageRepository(input.persistence, { snapshotEvery: 10 });
  const operation = (status: PrimaryDynamicOperationResult["status"], state: DynamicStageState | null, schedule: DynamicStageSchedule | null,
    findings: readonly LifecycleFinding[], persistenceHash: string | null): PrimaryDynamicOperationResult => {
    const base = { status, state, schedule, findings, persistenceHash };
    return deepFreeze({ ...base, operationHash: canonicalHash(base) });
  };
  return {
    stageId: input.stageId,
    primitive: compilation.primitive,
    initialise: () => repository.create(compilation.definition!),
    load: () => repository.load(input.stageId),
    execute: async (requested) => {
      const loaded = await repository.load(input.stageId);
      if (loaded.status !== "LOADED" || !loaded.state) return operation(loaded.status === "NOT_FOUND" ? "NOT_FOUND" : "REJECTED", null, null, loaded.findings,
        loaded.proof?.streamHash ?? null);
      let command: DynamicStageCommand = requested as DynamicStageCommand;
      if (requested.kind === "RECORD_LADDER_CHALLENGE") {
        const prior = loaded.state.events.find(({ idempotencyKey }) => idempotencyKey === requested.idempotencyKey)?.command;
        if (prior?.kind === "RECORD_LADDER_CHALLENGE") {
          const { scheduleReference: _priorReference, ...priorPublic } = prior;
          command = canonicalHash(priorPublic) === canonicalHash(requested) ? prior : ({ ...requested, scheduleReference: "conflicting-replay" } as DynamicStageCommand);
        } else {
          const placeholder = { ...requested, scheduleReference: "pending" } as DynamicStageCommand;
          const preview = transitionDynamicStage(loaded.state, placeholder);
          if (preview.status === "REJECTED") return operation("REJECTED", loaded.state, null, preview.findings, loaded.proof!.streamHash);
          const prospective = scheduleState(input.spec, preview.state);
          if (prospective.status !== "SCHEDULED") return operation("REJECTED", loaded.state, prospective,
            lifecycleFindings(prospective.solution.findings), loaded.proof!.streamHash);
          const contestId = `${input.stageId}.C${preview.state.events.filter(({ kind }) => kind === "RECORD_LADDER_CHALLENGE").length}`;
          command = { ...requested, scheduleReference: `${prospective.solution.audit.scheduleHash}:${contestId}` } as DynamicStageCommand;
        }
      }
      const preview = transitionDynamicStage(loaded.state, command);
      if (preview.status === "REJECTED") return operation("REJECTED", loaded.state, null, preview.findings, loaded.proof!.streamHash);
      const prospectiveSchedule = scheduleState(input.spec, preview.state);
      if (prospectiveSchedule.status !== "SCHEDULED") return operation("REJECTED", loaded.state, prospectiveSchedule,
        lifecycleFindings(prospectiveSchedule.solution.findings), loaded.proof!.streamHash);
      const executed = await repository.execute(input.stageId, command);
      if (!executed.state) return operation(executed.status, null, null, executed.findings, executed.persistenceHash);
      return operation(executed.status, executed.state, scheduleState(input.spec, executed.state), executed.findings, executed.persistenceHash);
    },
    certify: async () => {
      const stream = await input.persistence.load(input.stageId);
      const findings: LifecycleFinding[] = [];
      const specValidation = validateTournamentSpec(input.spec);
      if (!specValidation.valid) findings.push(...lifecycleFindings(specValidation.findings));
      if (!stream) findings.push({ code: "STAGE_NOT_FOUND", message: "Dynamic stage stream does not exist." });
      const streamProof = stream ? verifyPersistedDynamicStageStream(stream) : null;
      if (streamProof && !streamProof.valid) findings.push(...streamProof.findings);
      const replay = stream && streamProof?.valid ? replayDynamicStage(stream.definition, stream.events) : null;
      if (replay?.status === "REJECTED") findings.push(...replay.findings);
      const state = replay?.status === "REPLAYED" ? replay.state : null;
      if (state && !verifyDynamicStage(state).valid) findings.push({ code: "INVALID_STATE_PROOF", message: "Replayed lifecycle state proof is invalid." });
      if (state?.phase !== "COMPLETE") findings.push({ code: "DYNAMIC_STAGE_INCOMPLETE", message: "Only a complete dynamic stage can be certified." });
      if (stream && canonicalHash(stream.definition) !== canonicalHash(compilation.definition)) findings.push({ code: "DEFINITION_SPEC_DIVERGENCE", message: "Persisted definition does not match the compiled TournamentSpec stage." });
      const schedule = state ? scheduleState(input.spec, state) : null;
      if (schedule?.status === "REJECTED") findings.push(...lifecycleFindings(schedule.solution.findings));
      const evidence = state ? evidenceFor(state, compilation.primitive!) : [];
      const proof = { status: findings.length === 0 ? "CERTIFIED" as const : "REJECTED" as const, primitive: compilation.primitive!, stageId: input.stageId,
        specHash: input.spec.metadata.compiledSpecHash, definitionHash: canonicalHash(compilation.definition), streamHash: streamProof?.streamHash ?? null,
        stateHash: state?.stateHash ?? null, replayHash: replay?.replayHash ?? null, scheduleHash: schedule?.solution.audit.scheduleHash ?? null,
        evidence, findings };
      return deepFreeze({ ...proof, certificationHash: canonicalHash(proof) });
    },
  };
}
