import { join } from "node:path";
import {
  canonicalHash,
  compileDefinition,
  deepFreeze,
  validateTournamentSpec,
  type StageDefinition,
  type StagePrimitive,
  type TournamentDefinition,
  type TournamentSpec,
} from "@tournament-os/tournament-schema";
import { createPrimaryDynamicStageOrchestrator } from "./dynamic-stage-orchestrator.js";
import { createSQLiteDynamicStagePort } from "./dynamic-stage-store.js";
import type { DynamicStageCommand, DynamicStageState } from "./dynamic-stage-lifecycle.js";
import { tournamentFormatCapabilities } from "./format-capabilities.js";
import { createEntrants } from "./graph.js";
import { runScenario } from "./scenario.js";

const ALL_PRIMITIVES: readonly StagePrimitive[] = [
  "single_round_robin", "double_round_robin", "groups", "single_elimination", "double_elimination", "consolation",
  "placement", "swiss", "ladder", "league_table", "qualifying_heat", "time_trial", "ranking_stage", "play_in", "repechage", "custom_graph",
];
const DYNAMIC = new Set<StagePrimitive>(["swiss", "ladder", "qualifying_heat", "time_trial", "ranking_stage"]);

export interface CanonicalCapabilityFixture {
  readonly primitive: StagePrimitive;
  readonly primaryPath: "STATIC_SCENARIO" | "DYNAMIC_ORCHESTRATOR";
  readonly scaleEnvelope: string;
  readonly metamorphicCheck: "ENTRANT_DECLARATION_ORDER" | "SEEDED_POOL_ORDER_SIGNIFICANT" | "AUDIT_ORDER_SIGNIFICANT";
}

export interface CapabilityConformanceRecord extends CanonicalCapabilityFixture {
  readonly status: "CERTIFIED" | "REJECTED";
  readonly ledgerLevel: string;
  readonly specHash: string | null;
  readonly executionHash: string | null;
  readonly replayHash: string | null;
  readonly metamorphicHash: string | null;
  readonly findings: readonly { readonly code: string; readonly message: string }[];
  readonly proofHash: string;
}

export interface CapabilityConformanceAudit {
  readonly status: "CERTIFIED" | "REJECTED";
  readonly fixtureCount: number;
  readonly ledgerCount: number;
  readonly records: readonly CapabilityConformanceRecord[];
  readonly findings: readonly { readonly code: string; readonly message: string }[];
  readonly scaleStatement: string;
  readonly auditHash: string;
}

const descriptors: readonly CanonicalCapabilityFixture[] = [
  { primitive: "single_round_robin", primaryPath: "STATIC_SCENARIO", scaleEnvelope: "Canonical 4-entrant fixture; dedicated verified envelope remains 2-64.", metamorphicCheck: "SEEDED_POOL_ORDER_SIGNIFICANT" },
  { primitive: "double_round_robin", primaryPath: "STATIC_SCENARIO", scaleEnvelope: "Canonical 4-entrant two-leg fixture; dedicated verified envelope remains 2-64.", metamorphicCheck: "SEEDED_POOL_ORDER_SIGNIFICANT" },
  { primitive: "groups", primaryPath: "STATIC_SCENARIO", scaleEnvelope: "Canonical 4-entrant configured pool; dedicated pool construction and whole-spec corpora remain authoritative.", metamorphicCheck: "SEEDED_POOL_ORDER_SIGNIFICANT" },
  { primitive: "single_elimination", primaryPath: "STATIC_SCENARIO", scaleEnvelope: "Canonical 4-entrant bracket; dedicated verified envelope remains 2-64 including byes.", metamorphicCheck: "ENTRANT_DECLARATION_ORDER" },
  { primitive: "double_elimination", primaryPath: "STATIC_SCENARIO", scaleEnvelope: "Canonical 4-entrant NEVER-reset bracket; dedicated verified envelope remains power-of-two 2-64.", metamorphicCheck: "ENTRANT_DECLARATION_ORDER" },
  { primitive: "consolation", primaryPath: "STATIC_SCENARIO", scaleEnvelope: "Canonical 4-entrant consolation bracket; dedicated verified envelope remains 2-64.", metamorphicCheck: "ENTRANT_DECLARATION_ORDER" },
  { primitive: "placement", primaryPath: "STATIC_SCENARIO", scaleEnvelope: "Canonical four-place source plus explicit third-place contest; classification graph bounded separately to 4,096 contests.", metamorphicCheck: "ENTRANT_DECLARATION_ORDER" },
  { primitive: "league_table", primaryPath: "STATIC_SCENARIO", scaleEnvelope: "Canonical 4-entrant one-leg league pool with registered deterministic standings policy.", metamorphicCheck: "SEEDED_POOL_ORDER_SIGNIFICANT" },
  { primitive: "play_in", primaryPath: "STATIC_SCENARIO", scaleEnvelope: "Canonical 6-to-4 single-round reduction; compiler bound remains 4,096 entrants.", metamorphicCheck: "ENTRANT_DECLARATION_ORDER" },
  { primitive: "repechage", primaryPath: "STATIC_SCENARIO", scaleEnvelope: "Canonical 8-entrant quarterfinal-loser model; dedicated verified envelope remains power-of-two 8-64.", metamorphicCheck: "ENTRANT_DECLARATION_ORDER" },
  { primitive: "custom_graph", primaryPath: "STATIC_SCENARIO", scaleEnvelope: "Canonical 4-entrant three-contest DAG; schema bound remains 4,096 entrants and nodes.", metamorphicCheck: "ENTRANT_DECLARATION_ORDER" },
  { primitive: "swiss", primaryPath: "DYNAMIC_ORCHESTRATOR", scaleEnvelope: "Canonical 4-entrant two-round operation; exact pairing is bounded by the explicit search-node limit.", metamorphicCheck: "AUDIT_ORDER_SIGNIFICANT" },
  { primitive: "ladder", primaryPath: "DYNAMIC_ORCHESTRATOR", scaleEnvelope: "Canonical four-entrant scheduled challenge and explicit completion; finite audited challenge streams.", metamorphicCheck: "AUDIT_ORDER_SIGNIFICANT" },
  { primitive: "qualifying_heat", primaryPath: "DYNAMIC_ORCHESTRATOR", scaleEnvelope: "Canonical 4 entrants across 2 heats × 2 lanes with one complete time-result set.", metamorphicCheck: "AUDIT_ORDER_SIGNIFICANT" },
  { primitive: "time_trial", primaryPath: "DYNAMIC_ORCHESTRATOR", scaleEnvelope: "Canonical 4-entrant finite time-result set including explicit qualification semantics.", metamorphicCheck: "AUDIT_ORDER_SIGNIFICANT" },
  { primitive: "ranking_stage", primaryPath: "DYNAMIC_ORCHESTRATOR", scaleEnvelope: "Canonical 4-entrant finite score set with explicit higher-is-better direction and cutoff policy.", metamorphicCheck: "AUDIT_ORDER_SIGNIFICANT" },
];

export function canonicalCapabilityFixtures(): readonly CanonicalCapabilityFixture[] {
  return deepFreeze(structuredClone(descriptors));
}

function context(primitive: StagePrimitive) {
  return { specId: `conformance.${primitive}`, revision: 1, schemaVersion: "1.0.0", compilerVersion: "1.0.0",
    rulesetVersions: { conformance: "1.0.0" }, sourcePrompt: `canonical ${primitive} conformance fixture`, createdAt: "2026-09-06T00:00:00Z" };
}

function baseDefinition(primitive: StagePrimitive, participantCount: number, stage: StageDefinition): TournamentDefinition {
  const isDynamicPerformance = ["qualifying_heat", "time_trial", "ranking_stage"].includes(primitive);
  return {
    sport: { id: isDynamicPerformance ? "ranked-performance" : "head-to-head", adapterVersion: "1.0.0", participantUnit: "individual",
      contest: isDynamicPerformance ? { kind: "ranked_performance" } : { kind: "head_to_head", sides: 2 },
      scoringCapabilities: isDynamicPerformance ? ["finite-measurement"] : ["win-draw-loss"], defaultResourceType: "field" },
    participants: { count: participantCount, shape: "individual" },
    divisions: [{ id: "open", label: "Open", participantCount, participantShape: "individual", stageIds: [stage.id] }],
    stages: [stage], scoringSystems: [{ id: "score", adapterRule: "conformance.score.v1", version: "1.0.0", stageIds: [stage.id] }],
    standingsPolicies: [], qualificationPolicies: [], competitionStructures: [], drawPolicies: [], progressionPolicies: [],
    scheduling: { timezone: "UTC", start: "2026-09-06T09:00:00Z", constraints: [],
      durations: [{ stageId: stage.id, contestMinutes: 10, turnaroundMinutes: 0 }], objective: "earliest_finish" },
    resources: [{ id: "venue", type: "field", quantity: 8,
      availability: [{ start: "2026-09-06T09:00:00Z", end: "2026-09-07T09:00:00Z" }] }],
    operationalPolicies: [], randomisation: { mode: "none" }, assumptions: [], requirements: [],
  };
}

function staticSpec(primitive: StagePrimitive): TournamentSpec {
  const count = primitive === "repechage" ? 8 : primitive === "play_in" ? 6 : 4;
  const stage: StageDefinition = { id: "open.main", label: primitive, divisionId: "open", primitive, inputShape: "individual", outputShape: "individual", expectedEntrants: count };
  if (["groups", "single_round_robin", "double_round_robin", "league_table"].includes(primitive)) stage.pool = {
    poolCount: 1, sizes: [count], rounds: primitive === "double_round_robin" ? 2 : 1, allocation: "snake",
  };
  if (["single_elimination", "consolation", "double_elimination", "repechage"].includes(primitive)) stage.bracket = {
    entrantCount: count, topology: "power_of_two", thirdPlaceMatch: false,
  };
  if (primitive === "double_elimination") stage.doubleElimination = { resetFinalPolicy: "NEVER" };
  if (primitive === "repechage") stage.repechage = { model: "QUARTERFINAL_LOSERS_TO_SEMIFINAL_LOSERS" };
  if (primitive === "play_in") stage.playIn = { mainDrawSize: 4 };
  if (primitive === "custom_graph") stage.customGraph = { schemaVersion: "1.0.0", entrantCount: 4, nodes: [
    { id: "semi-a", kind: "MATCH", inputs: [{ type: "ENTRANT", seed: 1 }, { type: "ENTRANT", seed: 4 }], outputs: ["WINNER", "LOSER"] },
    { id: "semi-b", kind: "MATCH", inputs: [{ type: "ENTRANT", seed: 2 }, { type: "ENTRANT", seed: 3 }], outputs: ["WINNER", "LOSER"] },
    { id: "final", kind: "MATCH", inputs: [{ type: "PORT", nodeId: "semi-a", port: "WINNER" },
      { type: "PORT", nodeId: "semi-b", port: "WINNER" }], outputs: ["WINNER", "LOSER"] },
  ] };
  const definition = baseDefinition(primitive, count, stage);
  if (primitive === "placement") {
    const source: StageDefinition = { id: "open.source", label: "Source bracket", divisionId: "open", primitive: "single_elimination",
      inputShape: "individual", outputShape: "individual", expectedEntrants: 4,
      bracket: { entrantCount: 4, topology: "power_of_two", thirdPlaceMatch: false } };
    stage.classification = { schemaVersion: "1.0.0", sourceNodes: [
      { id: "open.source.R1.M1", kind: "MATCH" }, { id: "open.source.R1.M2", kind: "MATCH" },
    ], contests: [{ id: "third", label: "Third place", places: [3, 4], sources: [
      { nodeId: "open.source.R1.M1", port: "LOSER" }, { nodeId: "open.source.R1.M2", port: "LOSER" },
    ] }] };
    definition.stages = [source, stage]; definition.divisions[0]!.stageIds = [source.id, stage.id];
    definition.scoringSystems[0]!.stageIds = [source.id, stage.id];
    definition.scheduling.durations = definition.stages.map(({ id }) => ({ stageId: id, contestMinutes: 10, turnaroundMinutes: 0 }));
  }
  if (primitive === "league_table") {
    definition.randomisation = { mode: "deterministic", algorithm: "xoshiro128ss", seed: "league-conformance" };
    definition.standingsPolicies = [{ id: "league.table", stageIds: [stage.id], metricOrder: [{ metric: "wins", direction: "DESC" }], tieFallback: "deterministic_draw" }];
    definition.assumptions = [{ id: "rule.league.table", rulePath: "/standingsPolicies/league.table", origin: "selected_template", knowledge: "KNOWN",
      sourceReference: "canonical-conformance@1", approved: true, critical: true }];
  }
  return compileDefinition(definition, context(primitive)) as TournamentSpec;
}

function dynamicStage(primitive: StagePrimitive): StageDefinition {
  const ids = ["a", "b", "c", "d"];
  const base = { id: "open.main", label: primitive, divisionId: "open", primitive, inputShape: "individual" as const,
    outputShape: "individual" as const, expectedEntrants: 4 };
  if (primitive === "swiss") return { ...base, swiss: { schemaVersion: "1.0.0", entrantIds: ids, totalRounds: 2,
    pairingPolicy: { rematches: "FORBIDDEN" }, points: { win: 2, draw: 1, bye: 2 },
    finalRankingPolicy: { id: "points-id", version: "1", criteria: ["POINTS", "COMPETITOR_ID"] } } };
  if (primitive === "ladder") return { ...base, ladder: { schemaVersion: "1.0.0", initialOrder: ids, maxChallengeDistance: 3 } };
  const seeded = ids.map((id, index) => ({ id, seedMark: 10 + index / 10 }));
  if (primitive === "qualifying_heat") return { ...base, qualifyingHeat: { schemaVersion: "1.0.0", entrants: seeded, heatCount: 2,
    lanesPerHeat: 2, lanePriority: [2, 1], betterSeedMark: "LOWER", qualificationPlaces: 2,
    timeTiePolicy: "UNRESOLVED", cutoffTiePolicy: "UNRESOLVED" } };
  if (primitive === "time_trial") return { ...base, timeTrial: { schemaVersion: "1.0.0", entrants: seeded, qualificationPlaces: 2,
    timeTiePolicy: "UNRESOLVED", cutoffTiePolicy: "UNRESOLVED" } };
  if (primitive === "ranking_stage") return { ...base, rankingStage: { schemaVersion: "1.0.0", entrantIds: ids, qualificationPlaces: 2,
    betterScore: "HIGHER", cutoffTiePolicy: "UNRESOLVED" } };
  throw new Error(`No dynamic fixture for ${primitive}`);
}

function dynamicSpec(primitive: StagePrimitive): TournamentSpec {
  const definition = baseDefinition(primitive, 4, dynamicStage(primitive));
  return compileDefinition(definition, context(primitive)) as TournamentSpec;
}

function scenarioTruthHash(value: ReturnType<typeof runScenario>): string {
  return canonicalHash({ graph: value.graph, schedule: value.schedule, simulation: value.simulation, certification: value.certification });
}

function staticRecord(fixture: CanonicalCapabilityFixture, ledgerLevel: string): CapabilityConformanceRecord {
  const spec = staticSpec(fixture.primitive);
  const findings: Array<{ code: string; message: string }> = [];
  const validation = validateTournamentSpec(spec);
  if (!validation.valid) findings.push(...validation.findings.map(({ code, message }) => ({ code, message })));
  const entrants = createEntrants(spec);
  const first = runScenario(spec, entrants, `conformance:${fixture.primitive}`);
  const replay = runScenario(spec, entrants, `conformance:${fixture.primitive}`);
  const reordered = fixture.metamorphicCheck === "ENTRANT_DECLARATION_ORDER"
    ? runScenario(spec, Object.fromEntries(Object.entries(entrants).map(([division, values]) => [division, [...values].reverse()])),
      `conformance:${fixture.primitive}`) : null;
  const executionHash = scenarioTruthHash(first); const replayHash = scenarioTruthHash(replay);
  const metamorphicHash = reordered ? scenarioTruthHash(reordered) : null;
  if (first.certification.status !== "CERTIFIED") findings.push({ code: "PRIMARY_SCENARIO_REJECTED", message: "Canonical static scenario was not certified." });
  if (executionHash !== replayHash) findings.push({ code: "NONDETERMINISTIC_REPLAY", message: "Identical static scenario replay changed truth." });
  if (metamorphicHash && executionHash !== metamorphicHash) findings.push({ code: "METAMORPHIC_DRIFT", message: "Entrant declaration order changed canonical static truth." });
  const base = { ...fixture, status: findings.length === 0 ? "CERTIFIED" as const : "REJECTED" as const, ledgerLevel,
    specHash: spec.metadata.compiledSpecHash, executionHash, replayHash, metamorphicHash, findings };
  return deepFreeze({ ...base, proofHash: canonicalHash(base) });
}

const audit = (kind: DynamicStageCommand["kind"], expectedVersion: number, idempotencyKey: string) => ({
  kind, expectedVersion, idempotencyKey, actorId: "conformance-director", occurredAt: `2026-09-06T08:${String(expectedVersion).padStart(2, "0")}:00Z`,
});

async function executeDynamic(spec: TournamentSpec, databasePath: string): Promise<{ status: "CERTIFIED" | "REJECTED"; certificationHash: string; replayHash: string | null }> {
  const persistence = createSQLiteDynamicStagePort(databasePath);
  try {
    const engine = createPrimaryDynamicStageOrchestrator({ spec, stageId: "open.main", persistence });
    await engine.initialise();
    await engine.execute(audit("PREPARE", 0, "prepare") as DynamicStageCommand);
    let state = (await engine.execute(audit("START", 1, "start") as DynamicStageCommand)).state!;
    if (engine.primitive === "swiss") {
      for (let round = 1; round <= 2; round += 1) {
        const runtime = state.runtime.kind === "SWISS" ? state.runtime : null;
        const results = runtime!.pairings.map((pairing) => ({ contestId: pairing.contestId, competitors: pairing.competitors, winnerId: pairing.competitors[0] }));
        state = (await engine.execute({ ...audit("SUBMIT_SWISS_ROUND", state.version, `round-${round}`), kind: "SUBMIT_SWISS_ROUND", round, results })).state!;
      }
    } else if (engine.primitive === "ladder") {
      state = (await engine.execute({ ...audit("RECORD_LADDER_CHALLENGE", 2, "challenge"), kind: "RECORD_LADDER_CHALLENGE",
        challengerId: "d", defenderId: "a", winnerId: "d", reason: "canonical result" })).state!;
      state = (await engine.execute(audit("COMPLETE_LADDER", state.version, "complete") as DynamicStageCommand)).state!;
    } else if (engine.primitive === "qualifying_heat" || engine.primitive === "time_trial") {
      state = (await engine.execute({ ...audit("SUBMIT_HEAT_RESULTS", 2, "results"), kind: "SUBMIT_HEAT_RESULTS",
        results: ["a", "b", "c", "d"].map((competitorId, index) => ({ competitorId, status: "VALID" as const, timeMilliseconds: 10_000 + index * 100 })) })).state!;
    } else {
      state = (await engine.execute({ ...audit("SUBMIT_RANKING_RESULTS", 2, "results"), kind: "SUBMIT_RANKING_RESULTS",
        results: [{ competitorId: "a", score: 9.5 }, { competitorId: "b", score: 9.2 }, { competitorId: "c", score: 9 }, { competitorId: "d", score: 8 }] })).state!;
    }
    const certification = await engine.certify();
    return { status: certification.status, certificationHash: certification.certificationHash, replayHash: certification.replayHash };
  } finally { persistence.close(); }
}

async function dynamicRecord(fixture: CanonicalCapabilityFixture, ledgerLevel: string, databaseDirectory: string): Promise<CapabilityConformanceRecord> {
  const spec = dynamicSpec(fixture.primitive);
  const findings: Array<{ code: string; message: string }> = [];
  const validation = validateTournamentSpec(spec);
  if (!validation.valid) findings.push(...validation.findings.map(({ code, message }) => ({ code, message })));
  const first = await executeDynamic(spec, join(databaseDirectory, `${fixture.primitive}.first.sqlite`));
  const replay = await executeDynamic(spec, join(databaseDirectory, `${fixture.primitive}.replay.sqlite`));
  if (first.status !== "CERTIFIED") findings.push({ code: "PRIMARY_DYNAMIC_REJECTED", message: "Canonical dynamic operation was not certified." });
  if (first.certificationHash !== replay.certificationHash) findings.push({ code: "NONDETERMINISTIC_REPLAY", message: "Identical dynamic operation replay changed certification truth." });
  const base = { ...fixture, status: findings.length === 0 ? "CERTIFIED" as const : "REJECTED" as const, ledgerLevel,
    specHash: spec.metadata.compiledSpecHash, executionHash: first.certificationHash, replayHash: replay.certificationHash,
    metamorphicHash: null, findings };
  return deepFreeze({ ...base, proofHash: canonicalHash(base) });
}

export async function auditCapabilityConformance(input: {
  readonly dynamicDatabaseDirectory: string;
  readonly includedFixtures?: readonly StagePrimitive[];
}): Promise<CapabilityConformanceAudit> {
  const included = new Set(input.includedFixtures ?? ALL_PRIMITIVES);
  const ledger = tournamentFormatCapabilities();
  const ledgerById = new Map(ledger.capabilities.map((record) => [record.id, record]));
  const findings: Array<{ code: string; message: string }> = [];
  const selected = descriptors.filter(({ primitive }) => included.has(primitive));
  const missing = ledger.capabilities.map(({ id }) => id).filter((id) => !selected.some(({ primitive }) => primitive === id));
  const extra = selected.map(({ primitive }) => primitive).filter((primitive) => !ledgerById.has(primitive));
  for (const primitive of missing) findings.push({ code: "MISSING_PRIMARY_FIXTURE", message: `Ledger capability '${primitive}' has no included primary fixture.` });
  for (const primitive of extra) findings.push({ code: "ORPHAN_PRIMARY_FIXTURE", message: `Fixture '${primitive}' has no ledger capability.` });
  const records: CapabilityConformanceRecord[] = [];
  for (const fixture of selected) {
    const level = ledgerById.get(fixture.primitive)?.level ?? "MISSING";
    if (level !== "NATIVE") {
      const base = { ...fixture, status: "REJECTED" as const, ledgerLevel: level, specHash: null, executionHash: null, replayHash: null,
        metamorphicHash: null, findings: [{ code: "LEDGER_NOT_NATIVE", message: "A conformance fixture cannot manufacture native status absent ledger evidence." }] };
      records.push(deepFreeze({ ...base, proofHash: canonicalHash(base) }));
    } else records.push(DYNAMIC.has(fixture.primitive) ? await dynamicRecord(fixture, level, input.dynamicDatabaseDirectory) : staticRecord(fixture, level));
  }
  if (records.some(({ status }) => status !== "CERTIFIED")) findings.push({ code: "FIXTURE_EXECUTION_REJECTED", message: "At least one canonical primary fixture failed execution or replay." });
  const body = { status: findings.length === 0 ? "CERTIFIED" as const : "REJECTED" as const, fixtureCount: records.length,
    ledgerCount: ledger.capabilities.length, records, findings,
    scaleStatement: "This audit closes the 16 declared primitive-to-primary-path mappings at canonical fixture sizes. Dedicated bounded/exhaustive corpora remain authoritative; this is not evidence for arbitrary sport, field size, policy, or complexity." };
  return deepFreeze({ ...body, auditHash: canonicalHash(body) });
}
