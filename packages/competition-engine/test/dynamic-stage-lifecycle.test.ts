import assert from "node:assert/strict";
import test from "node:test";
import {
  defineDynamicStage,
  replayDynamicStage,
  transitionDynamicStage,
  verifyDynamicStage,
  type DynamicStageCommand,
  type DynamicStageState,
} from "../src/dynamic-stage-lifecycle.js";

const audit = (kind: DynamicStageCommand["kind"], expectedVersion: number, idempotencyKey: string) => ({
  kind, expectedVersion, idempotencyKey, actorId: "director-1", occurredAt: `2026-09-06T10:0${expectedVersion}:00.000Z`,
});

function apply(state: DynamicStageState, command: DynamicStageCommand): DynamicStageState {
  const result = transitionDynamicStage(state, command);
  assert.equal(result.status, "APPLIED", JSON.stringify(result.findings));
  return result.state;
}

test("runs a multi-round Swiss stage end to end with deterministic pairings, standings, and proof history", () => {
  let state = defineDynamicStage({
    id: "chess-open", revision: 1, kind: "SWISS", entrants: ["a", "b", "c", "d"], totalRounds: 2,
    pairingPolicy: { rematches: "FORBIDDEN" }, points: { win: 2, draw: 1, bye: 2 },
    finalRankingPolicy: { id: "chess.points-id", version: "1", criteria: ["POINTS", "COMPETITOR_ID"] },
  });
  assert.equal(state.phase, "DEFINITION");
  state = apply(state, audit("PREPARE", 0, "prepare") as DynamicStageCommand);
  assert.equal(state.phase, "READY");
  assert.equal(state.runtime.kind, "SWISS");
  assert.deepEqual(state.runtime.kind === "SWISS" ? state.runtime.pairings.map(({ competitors }) => competitors) : [], [["a", "b"], ["c", "d"]]);
  assert.deepEqual(state.schedulingRequests.map(({ contestId }) => contestId), ["chess-open.R1.B1", "chess-open.R1.B2"]);
  assert.ok(state.schedulingRequests.every((request) => !("startAt" in request) && request.adapterStatus === "REQUIRES_EXTERNAL_ASSIGNMENT"));

  state = apply(state, audit("START", 1, "start") as DynamicStageCommand);
  state = apply(state, {
    ...audit("SUBMIT_SWISS_ROUND", 2, "round-1"), kind: "SUBMIT_SWISS_ROUND", round: 1,
    results: [
      { contestId: "chess-open.R1.B1", competitors: ["a", "b"], winnerId: "a" },
      { contestId: "chess-open.R1.B2", competitors: ["c", "d"], winnerId: "c" },
    ],
  });
  assert.equal(state.runtime.kind === "SWISS" ? state.runtime.currentRound : 0, 2);
  assert.deepEqual(state.runtime.kind === "SWISS" ? state.runtime.pairings.map(({ competitors }) => competitors) : [], [["a", "c"], ["b", "d"]]);

  const finalCommand: DynamicStageCommand = {
    ...audit("SUBMIT_SWISS_ROUND", 3, "round-2"), kind: "SUBMIT_SWISS_ROUND", round: 2,
    results: [
      { contestId: "chess-open.R2.B1", competitors: ["a", "c"], winnerId: "a" },
      { contestId: "chess-open.R2.B2", competitors: ["b", "d"], winnerId: null },
    ],
  };
  state = apply(state, finalCommand);
  assert.equal(state.phase, "COMPLETE");
  assert.equal(state.runtime.kind, "SWISS");
  assert.deepEqual(state.runtime.kind === "SWISS" ? state.runtime.finalStandings.map(({ competitorId, points, rank }) => [competitorId, points, rank]) : [],
    [["a", 4, 1], ["c", 2, 2], ["b", 1, 3], ["d", 1, 4]]);
  assert.match(state.runtime.kind === "SWISS" ? state.runtime.rankingPolicyHash ?? "" : "", /^[a-f0-9]{64}$/);
  assert.equal(state.events.length, 4);
  assert.equal(verifyDynamicStage(state).valid, true);
  assert.equal(replayDynamicStage(state.definition, state.events).state.stateHash, state.stateHash);
  assert.match(state.stateHash, /^[a-f0-9]{64}$/);
  assert.ok(Object.isFrozen(state));
  assert.ok(Object.isFrozen(state.runtime));

  const replay = transitionDynamicStage(state, finalCommand);
  assert.equal(replay.status, "REPLAYED");
  assert.equal(replay.state, state);
  assert.equal(replay.proof.nextStateHash, state.stateHash);
});

test("advanced registered Swiss criteria drive lifecycle final standings and bind their policy proof", () => {
  let state = defineDynamicStage({
    id: "advanced-open", revision: 1, kind: "SWISS", entrants: ["a", "b", "c", "d"], totalRounds: 3,
    pairingPolicy: { rematches: "FORBIDDEN" }, points: { win: 2, draw: 1, bye: 2 },
    finalRankingPolicy: { id: "advanced-chess", version: "1.0.0", criteria: ["POINTS", "SONNEBORN_BERGER"],
      medianBuchholzDrop: 0, incompleteData: "REJECT", tieResolution: "COMPETITOR_ID" },
  });
  state = apply(state, audit("PREPARE", 0, "advanced-p") as DynamicStageCommand);
  state = apply(state, audit("START", 1, "advanced-s") as DynamicStageCommand);
  const submissions = [
    [{ contestId: "advanced-open.R1.B1", competitors: ["a", "b"] as const, winnerId: "a" },
      { contestId: "advanced-open.R1.B2", competitors: ["c", "d"] as const, winnerId: "c" }],
    [{ contestId: "advanced-open.R2.B1", competitors: ["a", "c"] as const, winnerId: "a" },
      { contestId: "advanced-open.R2.B2", competitors: ["b", "d"] as const, winnerId: "d" }],
    [{ contestId: "advanced-open.R3.B1", competitors: ["a", "d"] as const, winnerId: "d" },
      { contestId: "advanced-open.R3.B2", competitors: ["c", "b"] as const, winnerId: null }],
  ];
  for (let index = 0; index < submissions.length; index += 1) state = apply(state, {
    ...audit("SUBMIT_SWISS_ROUND", state.version, `advanced-r${index + 1}`), kind: "SUBMIT_SWISS_ROUND", round: index + 1,
    results: submissions[index]!,
  });
  assert.equal(state.phase, "COMPLETE");
  assert.deepEqual(state.runtime.kind === "SWISS" ? state.runtime.finalStandings.map(({ competitorId, rank }) => [competitorId, rank]) : [],
    [["d", 1], ["a", 2], ["c", 3], ["b", 4]]);
  assert.equal(state.runtime.kind === "SWISS" ? state.runtime.finalStandings[0]?.tiebreaks.sonnebornBerger : null, 5);
  assert.deepEqual(state.runtime.kind === "SWISS" ? state.runtime.rankingProof && {
    policyId: state.runtime.rankingProof.policyId, policyVersion: state.runtime.rankingProof.policyVersion,
  } : null, { policyId: "advanced-chess", policyVersion: "1.0.0" });
  assert.match(state.runtime.kind === "SWISS" ? state.runtime.rankingProof?.policyHash ?? "" : "", /^[a-f0-9]{64}$/);
  assert.match(state.runtime.kind === "SWISS" ? state.runtime.rankingProof?.rankingProofHash ?? "" : "", /^[a-f0-9]{64}$/);
  assert.equal(replayDynamicStage(state.definition, state.events).state.stateHash, state.stateHash);
});

test("preserves an explicit Swiss bye in advanced ranking inputs and tiebreak output", () => {
  let state = defineDynamicStage({
    id: "odd-open", revision: 1, kind: "SWISS", entrants: ["a", "b", "c"], totalRounds: 1,
    pairingPolicy: { rematches: "FORBIDDEN", bye: "LOWEST_RANKED_WITHOUT_BYE" }, points: { win: 2, draw: 1, bye: 2 },
    finalRankingPolicy: { id: "bye-aware", version: "1.0.0", criteria: ["POINTS", "BUCHHOLZ"],
      medianBuchholzDrop: 0, incompleteData: "REJECT", tieResolution: "COMPETITOR_ID" },
  });
  state = apply(state, audit("PREPARE", 0, "odd-p") as DynamicStageCommand);
  assert.equal(state.runtime.kind === "SWISS" ? state.runtime.currentByeCompetitorId : null, "c");
  state = apply(state, audit("START", 1, "odd-s") as DynamicStageCommand);
  state = apply(state, { ...audit("SUBMIT_SWISS_ROUND", 2, "odd-r"), kind: "SUBMIT_SWISS_ROUND", round: 1,
    results: [{ contestId: "odd-open.R1.B1", competitors: ["a", "b"], winnerId: null }] });
  assert.deepEqual(state.runtime.kind === "SWISS" ? state.runtime.finalStandings.map(({ competitorId, points, byeCount, tiebreaks }) =>
    [competitorId, points, byeCount, tiebreaks.buchholz]) : [], [["c", 2, 1, 0], ["a", 1, 0, 1], ["b", 1, 0, 1]]);
});

test("leaves lifecycle truth unchanged when an explicit advanced policy cannot resolve the final tie", () => {
  let state = defineDynamicStage({
    id: "unresolved-open", revision: 1, kind: "SWISS", entrants: ["a", "b"], totalRounds: 1,
    pairingPolicy: { rematches: "FORBIDDEN" }, points: { win: 2, draw: 1, bye: 2 },
    finalRankingPolicy: { id: "strict-order", version: "1.0.0", criteria: ["POINTS"], medianBuchholzDrop: 0,
      incompleteData: "REJECT", tieResolution: "REJECT" },
  });
  state = apply(state, audit("PREPARE", 0, "strict-p") as DynamicStageCommand);
  state = apply(state, audit("START", 1, "strict-s") as DynamicStageCommand);
  const result = transitionDynamicStage(state, { ...audit("SUBMIT_SWISS_ROUND", 2, "strict-r"), kind: "SUBMIT_SWISS_ROUND", round: 1,
    results: [{ contestId: "unresolved-open.R1.B1", competitors: ["a", "b"], winnerId: null }] });
  assert.equal(result.status, "REJECTED");
  assert.equal(result.state, state);
  assert.equal(result.findings[0]?.code, "UNRESOLVED_TIE");
  assert.equal(state.runtime.kind === "SWISS" ? state.runtime.rankingProof : "wrong-runtime", null);
});

test("compiles heat lanes, consumes externally observed times, and completes with ranked qualifiers", () => {
  let state = defineDynamicStage({
    id: "200-free", revision: 1, kind: "HEAT_TIME_QUALIFICATION",
    entrants: [
      { id: "a", seedMark: 101 }, { id: "b", seedMark: 102 },
      { id: "c", seedMark: 103 }, { id: "d", seedMark: 104 },
    ],
    heatCount: 2, lanesPerHeat: 2, lanePriority: [2, 1], betterSeedMark: "LOWER",
    qualificationPlaces: 2, timeTiePolicy: "UNRESOLVED", cutoffTiePolicy: "UNRESOLVED",
  });
  state = apply(state, audit("PREPARE", 0, "prepare-heats") as DynamicStageCommand);
  assert.equal(state.runtime.kind, "HEAT_TIME_QUALIFICATION");
  assert.equal(state.runtime.kind === "HEAT_TIME_QUALIFICATION" ? state.runtime.heats.length : 0, 2);
  assert.deepEqual(state.schedulingRequests.map(({ participantIds }) => participantIds), [["a", "d"], ["b", "c"]]);
  state = apply(state, audit("START", 1, "start-heats") as DynamicStageCommand);
  state = apply(state, {
    ...audit("SUBMIT_HEAT_RESULTS", 2, "heat-results"), kind: "SUBMIT_HEAT_RESULTS",
    results: [
      { competitorId: "a", status: "VALID", timeMilliseconds: 100_000 },
      { competitorId: "b", status: "VALID", timeMilliseconds: 101_000 },
      { competitorId: "c", status: "VALID", timeMilliseconds: 102_000 },
      { competitorId: "d", status: "DNF" },
    ],
  });
  assert.equal(state.phase, "COMPLETE");
  assert.deepEqual(state.runtime.kind === "HEAT_TIME_QUALIFICATION" ? state.runtime.qualifiedCompetitorIds : [], ["a", "b"]);
  assert.equal(verifyDynamicStage(state).valid, true);
});

test("a heat cutoff tie remains running and unchanged when the pinned ranking policy cannot resolve it", () => {
  let state = defineDynamicStage({
    id: "100m", revision: 1, kind: "HEAT_TIME_QUALIFICATION",
    entrants: [{ id: "a", seedMark: 1 }, { id: "b", seedMark: 2 }, { id: "c", seedMark: 3 }],
    heatCount: 1, lanesPerHeat: 3, lanePriority: [2, 3, 1], betterSeedMark: "LOWER",
    qualificationPlaces: 2, timeTiePolicy: "SHARED_RANK", cutoffTiePolicy: "UNRESOLVED",
  });
  state = apply(state, audit("PREPARE", 0, "p") as DynamicStageCommand);
  state = apply(state, audit("START", 1, "s") as DynamicStageCommand);
  const result = transitionDynamicStage(state, {
    ...audit("SUBMIT_HEAT_RESULTS", 2, "r"), kind: "SUBMIT_HEAT_RESULTS",
    results: [
      { competitorId: "a", status: "VALID", timeMilliseconds: 10_000 },
      { competitorId: "b", status: "VALID", timeMilliseconds: 11_000 },
      { competitorId: "c", status: "VALID", timeMilliseconds: 11_000 },
    ],
  });
  assert.equal(result.status, "REJECTED");
  assert.equal(result.state, state);
  assert.equal(result.findings[0]?.code, "CUTOFF_TIE_UNRESOLVED");
});

test("ingests partial heat results and audits hash-bound corrections and voids without overwriting truth", () => {
  let state = defineDynamicStage({
    id: "partial-heats", revision: 1, kind: "HEAT_TIME_QUALIFICATION",
    entrants: [
      { id: "a", seedMark: 1 }, { id: "b", seedMark: 2 }, { id: "c", seedMark: 3 }, { id: "d", seedMark: 4 },
    ],
    heatCount: 2, lanesPerHeat: 2, lanePriority: [2, 1], betterSeedMark: "LOWER", qualificationPlaces: 2,
    timeTiePolicy: "UNRESOLVED", cutoffTiePolicy: "UNRESOLVED",
  });
  state = apply(state, audit("PREPARE", 0, "hp") as DynamicStageCommand);
  state = apply(state, audit("START", 1, "hs") as DynamicStageCommand);
  state = apply(state, { ...audit("SUBMIT_HEAT_RESULTS", 2, "batch-1"), kind: "SUBMIT_HEAT_RESULTS", results: [
    { competitorId: "a", status: "VALID", timeMilliseconds: 100_000 },
    { competitorId: "b", status: "VALID", timeMilliseconds: 101_000 },
  ] });
  assert.equal(state.phase, "RUNNING");
  assert.equal(state.runtime.kind === "HEAT_TIME_QUALIFICATION" ? state.runtime.recordedResults.length : 0, 2);
  const bHash = state.runtime.kind === "HEAT_TIME_QUALIFICATION"
    ? state.runtime.recordedResults.find(({ result }) => result.competitorId === "b")!.resultHash : "";
  state = apply(state, {
    ...audit("CORRECT_HEAT_RESULT", 3, "correct-b"), kind: "CORRECT_HEAT_RESULT", competitorId: "b", supersedesResultHash: bHash,
    result: { competitorId: "b", status: "VALID", timeMilliseconds: 103_000 }, reason: "Timing photo reviewed",
  });
  const staleCorrection = transitionDynamicStage(state, {
    ...audit("CORRECT_HEAT_RESULT", 4, "stale-b"), kind: "CORRECT_HEAT_RESULT", competitorId: "b", supersedesResultHash: bHash,
    result: { competitorId: "b", status: "VALID", timeMilliseconds: 104_000 }, reason: "Stale operator screen",
  });
  assert.equal(staleCorrection.status, "REJECTED");
  assert.equal(staleCorrection.findings[0]?.code, "RESULT_LINEAGE_CONFLICT");
  assert.equal(staleCorrection.state, state);
  const aHash = state.runtime.kind === "HEAT_TIME_QUALIFICATION"
    ? state.runtime.recordedResults.find(({ result }) => result.competitorId === "a")!.resultHash : "";
  state = apply(state, {
    ...audit("VOID_HEAT_RESULT", 4, "void-a"), kind: "VOID_HEAT_RESULT", competitorId: "a", supersedesResultHash: aHash,
    reason: "Transponder assigned to wrong lane",
  });
  assert.deepEqual(state.runtime.kind === "HEAT_TIME_QUALIFICATION" ? state.runtime.recordedResults.map(({ result }) => result.competitorId) : [], ["b"]);
  state = apply(state, { ...audit("SUBMIT_HEAT_RESULTS", 5, "batch-2"), kind: "SUBMIT_HEAT_RESULTS", results: [
    { competitorId: "a", status: "VALID", timeMilliseconds: 100_500 },
    { competitorId: "c", status: "VALID", timeMilliseconds: 102_000 },
    { competitorId: "d", status: "DNF" },
  ] });
  assert.equal(state.phase, "COMPLETE");
  assert.deepEqual(state.runtime.kind === "HEAT_TIME_QUALIFICATION" ? state.runtime.qualifiedCompetitorIds : [], ["a", "c"]);
  assert.deepEqual(state.events.slice(-3).map(({ kind }) => kind), ["CORRECT_HEAT_RESULT", "VOID_HEAT_RESULT", "SUBMIT_HEAT_RESULTS"]);

  const cHash = state.runtime.kind === "HEAT_TIME_QUALIFICATION"
    ? state.runtime.recordedResults.find(({ result }) => result.competitorId === "c")!.resultHash : "";
  state = apply(state, {
    ...audit("CORRECT_HEAT_RESULT", 6, "correct-c"), kind: "CORRECT_HEAT_RESULT", competitorId: "c", supersedesResultHash: cHash,
    result: { competitorId: "c", status: "VALID", timeMilliseconds: 104_000 }, reason: "Finish image correction",
  });
  assert.equal(state.phase, "COMPLETE");
  assert.deepEqual(state.runtime.kind === "HEAT_TIME_QUALIFICATION" ? state.runtime.qualifiedCompetitorIds : [], ["a", "b"]);
  const replay = replayDynamicStage(state.definition, state.events);
  assert.equal(replay.status, "REPLAYED");
  assert.equal(replay.state.stateHash, state.stateHash);
  assert.equal(state.events.find(({ kind }) => kind === "CORRECT_HEAT_RESULT")?.command.kind, "CORRECT_HEAT_RESULT");
});

test("corrects and voids only the latest completed Swiss round through explicit result lineage", () => {
  let state = defineDynamicStage({ id: "correction-open", revision: 1, kind: "SWISS", entrants: ["a", "b"], totalRounds: 1,
    pairingPolicy: { rematches: "FORBIDDEN" }, points: { win: 2, draw: 1, bye: 2 },
    finalRankingPolicy: { id: "points-shared", version: "1", criteria: ["POINTS", "SHARED_RANK"] } });
  state = apply(state, audit("PREPARE", 0, "cp") as DynamicStageCommand);
  state = apply(state, audit("START", 1, "cs") as DynamicStageCommand);
  state = apply(state, { ...audit("SUBMIT_SWISS_ROUND", 2, "cr"), kind: "SUBMIT_SWISS_ROUND", round: 1,
    results: [{ contestId: "correction-open.R1.B1", competitors: ["a", "b"], winnerId: "a" }] });
  const firstHash = state.runtime.kind === "SWISS" ? state.runtime.completedRounds[0]!.resultHash : "";
  const firstRankingProof = state.runtime.kind === "SWISS" ? state.runtime.rankingProof?.rankingProofHash : "";
  state = apply(state, { ...audit("CORRECT_SWISS_ROUND", 3, "cc"), kind: "CORRECT_SWISS_ROUND", round: 1,
    supersedesResultHash: firstHash, reason: "Signed scoresheet correction",
    results: [{ contestId: "correction-open.R1.B1", competitors: ["a", "b"], winnerId: "b" }] });
  assert.deepEqual(state.runtime.kind === "SWISS" ? state.runtime.finalStandings.map(({ competitorId, points }) => [competitorId, points]) : [], [["b", 2], ["a", 0]]);
  assert.notEqual(state.runtime.kind === "SWISS" ? state.runtime.rankingProof?.rankingProofHash : "", firstRankingProof);
  assert.equal(replayDynamicStage(state.definition, state.events).state.stateHash, state.stateHash);
  const correctedHash = state.runtime.kind === "SWISS" ? state.runtime.completedRounds[0]!.resultHash : "";
  state = apply(state, { ...audit("VOID_SWISS_ROUND", 4, "cv"), kind: "VOID_SWISS_ROUND", round: 1,
    supersedesResultHash: correctedHash, reason: "Contest ordered to replay" });
  assert.equal(state.phase, "RUNNING");
  assert.equal(state.runtime.kind === "SWISS" ? state.runtime.completedRounds.length : -1, 0);
  assert.deepEqual(state.runtime.kind === "SWISS" ? state.runtime.pairings.map(({ competitors }) => competitors) : [], [["a", "b"]]);
  assert.equal(state.runtime.kind === "SWISS" ? state.runtime.rankingProof : "wrong-runtime", null);
});

test("delegates ladder challenges to the audited ladder engine and completes only on an explicit command", () => {
  let state = defineDynamicStage({ id: "club", revision: 1, kind: "LADDER", initialOrder: ["a", "b", "c"], maxChallengeDistance: 2 });
  state = apply(state, audit("PREPARE", 0, "lp") as DynamicStageCommand);
  state = apply(state, audit("START", 1, "ls") as DynamicStageCommand);
  state = apply(state, {
    ...audit("RECORD_LADDER_CHALLENGE", 2, "lc"), kind: "RECORD_LADDER_CHALLENGE", challengerId: "c", defenderId: "a",
    winnerId: "c", scheduleReference: "scheduler:contest-72", reason: "Recorded challenge result",
  });
  assert.deepEqual(state.runtime.kind === "LADDER" ? state.runtime.ladder?.order ?? [] : [], ["c", "a", "b"]);
  assert.equal(state.phase, "RUNNING");
  state = apply(state, audit("COMPLETE_LADDER", 3, "ld") as DynamicStageCommand);
  assert.equal(state.phase, "COMPLETE");
});

test("version, idempotency, lifecycle, and unsupported commands fail closed without mutation", () => {
  let state = defineDynamicStage({ id: "s", revision: 1, kind: "SWISS", entrants: ["a", "b"], totalRounds: 1,
    pairingPolicy: { rematches: "FORBIDDEN" }, points: { win: 2, draw: 1, bye: 2 },
    finalRankingPolicy: { id: "points", version: "1", criteria: ["POINTS", "SHARED_RANK"] } });
  const prepared = transitionDynamicStage(state, audit("PREPARE", 0, "same") as DynamicStageCommand);
  assert.equal(prepared.status, "APPLIED"); state = prepared.state;

  const stale = transitionDynamicStage(state, audit("START", 0, "stale") as DynamicStageCommand);
  assert.equal(stale.status, "REJECTED"); assert.equal(stale.findings[0]?.code, "VERSION_CONFLICT"); assert.equal(stale.state, state);
  const conflict = transitionDynamicStage(state, audit("START", 1, "same") as DynamicStageCommand);
  assert.equal(conflict.status, "REJECTED"); assert.equal(conflict.findings[0]?.code, "IDEMPOTENCY_CONFLICT");
  const wrong = transitionDynamicStage(state, { ...audit("COMPLETE_LADDER", 1, "wrong"), kind: "COMPLETE_LADDER" });
  assert.equal(wrong.status, "REJECTED"); assert.equal(wrong.findings[0]?.code, "INVALID_TRANSITION");
  const unknown = transitionDynamicStage(state, { ...audit("START", 1, "unknown"), kind: "MAGIC" } as unknown as DynamicStageCommand);
  assert.equal(unknown.status, "REJECTED"); assert.equal(unknown.findings[0]?.code, "UNSUPPORTED_COMMAND");
});
