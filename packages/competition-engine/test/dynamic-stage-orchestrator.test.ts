import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  compileDefinition,
  validateTournamentSpec,
  type StageDefinition,
  type StagePrimitive,
  type TournamentDefinition,
  type TournamentSpec,
} from "@tournament-os/tournament-schema";
import {
  compilePrimaryDynamicStage,
  createPrimaryDynamicStageOrchestrator,
} from "../src/dynamic-stage-orchestrator.js";
import { createSQLiteDynamicStagePort } from "../src/dynamic-stage-store.js";
import type { DynamicStageCommand, DynamicStageState } from "../src/dynamic-stage-lifecycle.js";

const entrants = ["a", "b", "c", "d"];

function configuredStage(primitive: StagePrimitive): StageDefinition {
  const base = { id: `stage.${primitive}`, label: primitive, divisionId: "open", primitive,
    inputShape: "individual" as const, outputShape: "individual" as const, expectedEntrants: 4 };
  if (primitive === "swiss") return { ...base, swiss: { schemaVersion: "1.0.0", entrantIds: entrants, totalRounds: 2,
    pairingPolicy: { rematches: "FORBIDDEN" }, points: { win: 2, draw: 1, bye: 2 },
    finalRankingPolicy: { id: "points-id", version: "1", criteria: ["POINTS", "COMPETITOR_ID"] } } };
  if (primitive === "ladder") return { ...base, ladder: { schemaVersion: "1.0.0", initialOrder: entrants, maxChallengeDistance: 3 } };
  if (primitive === "qualifying_heat") return { ...base, qualifyingHeat: { schemaVersion: "1.0.0",
    entrants: entrants.map((id, index) => ({ id, seedMark: 10 + index / 10 })), heatCount: 2, lanesPerHeat: 2,
    lanePriority: [2, 1], betterSeedMark: "LOWER", qualificationPlaces: 2, timeTiePolicy: "UNRESOLVED", cutoffTiePolicy: "UNRESOLVED" } };
  if (primitive === "time_trial") return { ...base, timeTrial: { schemaVersion: "1.0.0",
    entrants: entrants.map((id, index) => ({ id, seedMark: 10 + index / 10 })), qualificationPlaces: 2,
    timeTiePolicy: "UNRESOLVED", cutoffTiePolicy: "UNRESOLVED" } };
  if (primitive === "ranking_stage") return { ...base, rankingStage: { schemaVersion: "1.0.0", entrantIds: entrants,
    qualificationPlaces: 2, betterScore: "HIGHER", cutoffTiePolicy: "UNRESOLVED" } };
  throw new Error(`unsupported fixture ${primitive}`);
}

function specFor(primitive: StagePrimitive): TournamentSpec {
  const stage = configuredStage(primitive);
  const definition: TournamentDefinition = {
    sport: { id: primitive === "swiss" || primitive === "ladder" ? "chess" : "athletics", adapterVersion: "1.0.0",
      participantUnit: "individual", contest: primitive === "swiss" || primitive === "ladder"
        ? { kind: "head_to_head", sides: 2 } : { kind: "ranked_performance" },
      scoringCapabilities: primitive === "ranking_stage" ? ["points"] : ["time"], defaultResourceType: "field" },
    participants: { count: 4, shape: "individual" },
    divisions: [{ id: "open", label: "Open", participantCount: 4, participantShape: "individual", stageIds: [stage.id] }],
    stages: [stage], scoringSystems: [{ id: "score", adapterRule: "score.v1", version: "1.0.0", stageIds: [stage.id] }],
    standingsPolicies: [], qualificationPolicies: [], competitionStructures: [], drawPolicies: [], progressionPolicies: [],
    scheduling: { timezone: "UTC", start: "2026-09-06T09:00:00Z", constraints: [],
      durations: [{ stageId: stage.id, contestMinutes: 10, turnaroundMinutes: 0 }], objective: "earliest_finish" },
    resources: [{ id: "venue", type: "field", quantity: 2,
      availability: [{ start: "2026-09-06T09:00:00Z", end: "2026-09-06T14:00:00Z" }] }],
    operationalPolicies: [], randomisation: { mode: "none" }, assumptions: [], requirements: [],
  };
  return compileDefinition(definition, { specId: `spec.${primitive}`, revision: 1, schemaVersion: "1.0.0", compilerVersion: "1.0.0",
    rulesetVersions: { dynamic: "1.0.0" }, sourcePrompt: primitive, createdAt: "2026-09-06T08:00:00Z" }) as TournamentSpec;
}

const audited = (kind: DynamicStageCommand["kind"], expectedVersion: number, idempotencyKey: string) => ({
  kind, expectedVersion, idempotencyKey, actorId: "director", occurredAt: `2026-09-06T08:${String(expectedVersion).padStart(2, "0")}:00Z`,
});

async function harness(primitive: StagePrimitive) {
  const spec = specFor(primitive);
  const directory = await mkdtemp(join(tmpdir(), `tos-primary-${primitive}-`));
  const persistence = createSQLiteDynamicStagePort(join(directory, "stages.sqlite"));
  const orchestrator = createPrimaryDynamicStageOrchestrator({ spec, stageId: spec.stages[0]!.id, persistence });
  assert.equal((await orchestrator.initialise()).status, "CREATED");
  return { spec, persistence, orchestrator };
}

async function prepareAndStart(orchestrator: Awaited<ReturnType<typeof harness>>["orchestrator"]): Promise<DynamicStageState> {
  const prepared = await orchestrator.execute(audited("PREPARE", 0, "prepare") as DynamicStageCommand);
  assert.equal(prepared.status, "APPLIED", JSON.stringify(prepared.findings));
  assert.equal(prepared.schedule?.status, "SCHEDULED");
  const started = await orchestrator.execute(audited("START", 1, "start") as DynamicStageCommand);
  assert.equal(started.status, "APPLIED", JSON.stringify(started.findings));
  return started.state!;
}

test("canonical schema type-checks each explicit primary dynamic primitive and rejects mismatched config", () => {
  for (const primitive of ["swiss", "ladder", "qualifying_heat", "time_trial", "ranking_stage"] as const) {
    const spec = specFor(primitive);
    assert.equal(validateTournamentSpec(spec).valid, true, `${primitive}: ${JSON.stringify(validateTournamentSpec(spec).findings)}`);
    assert.equal(compilePrimaryDynamicStage(spec, spec.stages[0]!.id).status, "COMPILED");
  }
  const definition = structuredClone(specFor("swiss"));
  definition.stages[0]!.ladder = { schemaVersion: "1.0.0", initialOrder: entrants, maxChallengeDistance: 1 };
  const recompiled = compileDefinition(definition, { specId: "bad", revision: 1, schemaVersion: "1.0.0", compilerVersion: "1.0.0",
    rulesetVersions: { dynamic: "1.0.0" }, sourcePrompt: "bad", createdAt: "2026-09-06T08:00:00Z" });
  assert.equal(validateTournamentSpec(recompiled).valid, false);
  assert.ok(validateTournamentSpec(recompiled).findings.some(({ code }) => code === "TSC152"));
});

test("Swiss runs from TournamentSpec through transactional operations, multi-round scheduling, replay, and certification", async () => {
  const { orchestrator, persistence } = await harness("swiss");
  let state = await prepareAndStart(orchestrator);
  for (let round = 1; round <= 2; round += 1) {
    assert.equal(state.runtime.kind, "SWISS");
    const runtime = state.runtime.kind === "SWISS" ? state.runtime : null;
    const results = runtime!.pairings.map((pairing) => ({ contestId: pairing.contestId, competitors: pairing.competitors, winnerId: pairing.competitors[0] }));
    const result = await orchestrator.execute({ ...audited("SUBMIT_SWISS_ROUND", state.version, `round-${round}`), kind: "SUBMIT_SWISS_ROUND", round, results });
    assert.equal(result.status, "APPLIED", JSON.stringify(result.findings));
    assert.equal(result.schedule?.status, "SCHEDULED");
    state = result.state!;
  }
  assert.equal(state.phase, "COMPLETE");
  assert.equal(state.runtime.kind === "SWISS" ? state.runtime.finalStandings.length : 0, 4);
  const certification = await orchestrator.certify();
  assert.equal(certification.status, "CERTIFIED", JSON.stringify(certification.findings));
  assert.ok(certification.evidence.includes("multi-round-pairing-proof"));
  assert.equal((await orchestrator.certify()).certificationHash, certification.certificationHash);
  persistence.close();
});

test("ladder challenge is scheduled by the production seam before its audited result is persisted and certified", async () => {
  const { orchestrator, persistence } = await harness("ladder");
  await prepareAndStart(orchestrator);
  const challengeCommand = { ...audited("RECORD_LADDER_CHALLENGE", 2, "challenge"), kind: "RECORD_LADDER_CHALLENGE" as const,
    challengerId: "d", defenderId: "a", winnerId: "d", reason: "official result" };
  const challenge = await orchestrator.execute(challengeCommand);
  assert.equal(challenge.status, "APPLIED", JSON.stringify(challenge.findings));
  assert.equal(challenge.schedule?.solution.contests.length, 1);
  const reference = challenge.state?.events.at(-1)?.command;
  assert.match(reference?.kind === "RECORD_LADDER_CHALLENGE" ? reference.scheduleReference : "", /^[a-f0-9]{64}:stage\.ladder\.C1$/);
  const replay = await orchestrator.execute(challengeCommand);
  assert.equal(replay.status, "REPLAYED");
  assert.equal(replay.state?.stateHash, challenge.state?.stateHash);
  const completed = await orchestrator.execute(audited("COMPLETE_LADDER", 3, "complete") as DynamicStageCommand);
  assert.equal(completed.status, "APPLIED");
  assert.equal((await orchestrator.certify()).status, "CERTIFIED");
  persistence.close();
});

test("qualifying heat and standalone time trial both execute recorded marks, qualification, schedule replay, and certification", async () => {
  for (const primitive of ["qualifying_heat", "time_trial"] as const) {
    const { orchestrator, persistence } = await harness(primitive);
    await prepareAndStart(orchestrator);
    const result = await orchestrator.execute({ ...audited("SUBMIT_HEAT_RESULTS", 2, "results"), kind: "SUBMIT_HEAT_RESULTS",
      results: entrants.map((competitorId, index) => ({ competitorId, status: "VALID" as const, timeMilliseconds: 10_000 + index * 100 })) });
    assert.equal(result.status, "APPLIED", `${primitive}: ${JSON.stringify(result.findings)}`);
    assert.equal(result.state?.phase, "COMPLETE");
    assert.deepEqual(result.state?.runtime.kind === "HEAT_TIME_QUALIFICATION" ? result.state.runtime.qualifiedCompetitorIds : [], ["a", "b"]);
    const certification = await orchestrator.certify();
    assert.equal(certification.status, "CERTIFIED", `${primitive}: ${JSON.stringify(certification.findings)}`);
    assert.ok(certification.evidence.includes("time-ranking-proof"));
    persistence.close();
  }
});

test("generic ranking stage preserves score direction, fails closed on ambiguous cutoff ties, and certifies explicit results", async () => {
  const ambiguous = await harness("ranking_stage");
  await prepareAndStart(ambiguous.orchestrator);
  const tied = await ambiguous.orchestrator.execute({ ...audited("SUBMIT_RANKING_RESULTS", 2, "tie"), kind: "SUBMIT_RANKING_RESULTS",
    results: [{ competitorId: "a", score: 9.5 }, { competitorId: "b", score: 9 }, { competitorId: "c", score: 9 }, { competitorId: "d", score: 8 }] });
  assert.equal(tied.status, "REJECTED");
  assert.equal(tied.findings[0]?.code, "CUTOFF_TIE_UNRESOLVED");
  assert.equal((await ambiguous.orchestrator.certify()).status, "REJECTED");
  ambiguous.persistence.close();

  const resolved = await harness("ranking_stage");
  await prepareAndStart(resolved.orchestrator);
  const result = await resolved.orchestrator.execute({ ...audited("SUBMIT_RANKING_RESULTS", 2, "scores"), kind: "SUBMIT_RANKING_RESULTS",
    results: [{ competitorId: "a", score: 9.5 }, { competitorId: "b", score: 9.2 }, { competitorId: "c", score: 9 }, { competitorId: "d", score: 8 }] });
  assert.equal(result.status, "APPLIED", JSON.stringify(result.findings));
  assert.deepEqual(result.state?.runtime.kind === "RANKING_STAGE" ? result.state.runtime.qualifiedCompetitorIds : [], ["a", "b"]);
  const certification = await resolved.orchestrator.certify();
  assert.equal(certification.status, "CERTIFIED", JSON.stringify(certification.findings));
  assert.ok(certification.evidence.includes("score-order-proof"));
  resolved.persistence.close();
});

test("primary orchestration refuses non-transactional persistence instead of weakening its production contract", () => {
  const spec = specFor("swiss");
  assert.throws(() => createPrimaryDynamicStageOrchestrator({ spec, stageId: spec.stages[0]!.id,
    persistence: { capabilities: { durability: "PROCESS_MEMORY", multiProcessAtomicity: false, externalDatabase: false } } as never }),
  /transactional SQLite/);
});
