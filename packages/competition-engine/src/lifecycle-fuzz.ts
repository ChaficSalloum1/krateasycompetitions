import { canonicalHash, deepFreeze } from "@tournament-os/tournament-schema";
import { appendAdjudication, createAdjudicationLedger, verifyAdjudicationLedger } from "./adjudication.js";
import {
  createLiveOperationsState,
  replayLiveOperationsEvents,
  submitLiveOperationsCommand,
  type LiveOperationsCommand,
  type LiveOperationsDefinition,
  type LiveOperationsState,
} from "./live-operations.js";

export interface LifecycleFuzzOptions {
  readonly seed: string;
  readonly iterations: number;
  readonly outageCycles?: number;
}

export interface LifecycleFuzzReport {
  readonly status: "CERTIFIED" | "REJECTED";
  readonly seed: string;
  readonly iterations: number;
  readonly commandsAttempted: number;
  readonly commandsAccepted: number;
  readonly intentionalRejections: number;
  readonly idempotentReplays: number;
  readonly deterministicReplayChecks: number;
  readonly tamperAndReorderRejections: number;
  readonly adjudicationLineageChecks: number;
  readonly scenarioKinds: readonly ["COMPLETION_APPEAL", "WITHDRAWAL_WALKOVER", "RETIREMENT"];
  readonly findings: readonly string[];
  readonly envelope: string;
  readonly proofHash: string;
}

type CommandInput = LiveOperationsCommand extends infer Command
  ? Command extends LiveOperationsCommand ? Omit<Command, "expectedVersion" | "actorId" | "occurredAt"> : never
  : never;

const time = (minute: number) => new Date(Date.parse("2026-09-07T09:00:00.000Z") + minute * 60_000).toISOString();

function definition(seed: string, iteration: number): LiveOperationsDefinition {
  return {
    tournamentId: `fuzz.${canonicalHash({ seed, iteration }).slice(0, 16)}`,
    courts: ["court.1"],
    officials: ["official.1"],
    equipment: ["net.1"],
    contests: [{
      contestId: "match.1",
      entrantIds: ["entrant.a", "entrant.b"],
      courtId: "court.1",
      officialId: "official.1",
      equipmentIds: ["net.1"],
      scheduledStart: time(0),
      scheduledEnd: time(60),
    }],
  };
}

/**
 * Runs reproducible destructive operational histories. Rejections are expected
 * only for deliberately stale/conflicting commands and corrupted/reordered logs.
 */
export function runLifecycleFuzzCampaign(options: LifecycleFuzzOptions): Readonly<LifecycleFuzzReport> {
  if (!options.seed.trim()) throw new Error("Lifecycle fuzz seed is required.");
  if (!Number.isSafeInteger(options.iterations) || options.iterations < 1 || options.iterations > 100_000) {
    throw new Error("Lifecycle fuzz iterations must be between 1 and 100,000.");
  }
  const outageCycles = options.outageCycles ?? 4;
  if (!Number.isSafeInteger(outageCycles) || outageCycles < 0 || outageCycles > 100) throw new Error("Outage cycles must be between 0 and 100.");
  const findings: string[] = [];
  let commandsAttempted = 0;
  let commandsAccepted = 0;
  let intentionalRejections = 0;
  let idempotentReplays = 0;
  let deterministicReplayChecks = 0;
  let tamperAndReorderRejections = 0;
  let adjudicationLineageChecks = 0;

  for (let iteration = 0; iteration < options.iterations; iteration += 1) {
    const model = definition(options.seed, iteration);
    let state = createLiveOperationsState(model);
    let sequence = 0;
    const submit = (input: CommandInput, occurredAt = time(sequence)): LiveOperationsCommand | undefined => {
      const command = { ...input, expectedVersion: state.version, actorId: "fuzz.director", occurredAt } as LiveOperationsCommand;
      sequence += 1;
      commandsAttempted += 1;
      const result = submitLiveOperationsCommand(state, command);
      if (!result.accepted) {
        findings.push(`iteration ${iteration}: ${input.kind} unexpectedly rejected (${result.findings.map(({ code }) => code).join(",")}).`);
        return undefined;
      }
      commandsAccepted += 1;
      state = result.state;
      return command;
    };

    const first = submit({ kind: "CHECK_IN", commandId: `i${iteration}.check.a`, entrantId: "entrant.a" });
    submit({ kind: "CHECK_IN", commandId: `i${iteration}.check.b`, entrantId: "entrant.b" });
    if (!first) continue;

    commandsAttempted += 1;
    const duplicate = submitLiveOperationsCommand(state, first);
    if (duplicate.accepted && duplicate.idempotentReplay && duplicate.state === state) idempotentReplays += 1;
    else findings.push(`iteration ${iteration}: exact duplicate was not a no-op replay.`);

    commandsAttempted += 1;
    const stale = submitLiveOperationsCommand(state, {
      kind: "MARK_LATE",
      commandId: `i${iteration}.stale`,
      entrantId: "entrant.a",
      reason: "delayed command",
      expectedVersion: 0,
      actorId: "fuzz.director",
      occurredAt: time(sequence++),
    });
    if (!stale.accepted && stale.state === state) intentionalRejections += 1;
    else findings.push(`iteration ${iteration}: stale command mutated authoritative state.`);

    for (let cycle = 0; cycle < outageCycles; cycle += 1) {
      submit({ kind: "CLOSE_COURT", commandId: `i${iteration}.close.${cycle}`, courtId: "court.1", reason: "chaos closure" });
      submit({ kind: "REOPEN_COURT", commandId: `i${iteration}.open.${cycle}`, courtId: "court.1", reason: "chaos recovery" });
      submit({ kind: "REPORT_EQUIPMENT_FAILURE", commandId: `i${iteration}.fail.${cycle}`, equipmentId: "net.1", reason: "chaos failure" });
      submit({ kind: "RESTORE_EQUIPMENT", commandId: `i${iteration}.restore.${cycle}`, equipmentId: "net.1", reason: "chaos recovery" });
    }

    const scenario = iteration % 3;
    if (scenario === 1) {
      submit({ kind: "WITHDRAW_ENTRANT", commandId: `i${iteration}.withdraw`, entrantId: "entrant.a", reason: "generated withdrawal" });
      submit({ kind: "AWARD_WALKOVER", commandId: `i${iteration}.walkover`, contestId: "match.1", winnerEntrantId: "entrant.b", absentEntrantId: "entrant.a", reason: "declared policy" });
    } else {
      submit({ kind: "START_CONTEST", commandId: `i${iteration}.start`, contestId: "match.1", courtId: "court.1", startedAt: time(sequence) });
      if (scenario === 2) submit({ kind: "RECORD_RETIREMENT", commandId: `i${iteration}.retire`, contestId: "match.1", retiredEntrantId: "entrant.a", winnerEntrantId: "entrant.b", endedAt: time(sequence + 20), reason: "generated retirement" }, time(sequence + 20));
      else submit({ kind: "COMPLETE_CONTEST", commandId: `i${iteration}.complete`, contestId: "match.1", endedAt: time(sequence + 20) }, time(sequence + 20));
    }
    submit({ kind: "RECORD_RESULT_RECEIPT", commandId: `i${iteration}.receipt`, contestId: "match.1", source: "fuzz-scoring-adapter" });
    submit({ kind: "FILE_PROTEST", commandId: `i${iteration}.protest`, protestId: `protest.${iteration}`, contestId: "match.1", filedById: "entrant.a", reason: "generated appeal path" });
    submit({ kind: "RESOLVE_PROTEST", commandId: `i${iteration}.protest.resolve`, protestId: `protest.${iteration}`, outcome: "DENIED", reason: "evidence reviewed" });
    submit({ kind: "FILE_APPEAL", commandId: `i${iteration}.appeal`, appealId: `appeal.${iteration}`, protestId: `protest.${iteration}`, filedById: "entrant.a", reason: "generated appeal" });
    submit({ kind: "RESOLVE_APPEAL", commandId: `i${iteration}.appeal.resolve`, appealId: `appeal.${iteration}`, outcome: "DENIED", reason: "panel reviewed" });

    const replay = replayLiveOperationsEvents(model, state.events);
    deterministicReplayChecks += 1;
    if (!replay.valid || replay.state.proofHash !== state.proofHash) findings.push(`iteration ${iteration}: authoritative replay diverged.`);
    if (state.events.length > 1) {
      const reordered = [state.events[1]!, state.events[0]!, ...state.events.slice(2)];
      if (!replayLiveOperationsEvents(model, reordered).valid) tamperAndReorderRejections += 1;
      else findings.push(`iteration ${iteration}: reordered history was accepted.`);
    }
    const tampered = structuredClone(state.events);
    (tampered[0] as { actorId: string }).actorId = "attacker";
    if (!replayLiveOperationsEvents(model, tampered).valid) tamperAndReorderRejections += 1;
    else findings.push(`iteration ${iteration}: tampered history was accepted.`);

    let ledger = appendAdjudication(createAdjudicationLedger({ withdrawal: "VOID_CONTEST" }), {
      kind: "RECORD_RESULT", contestId: "match.1", entrants: ["entrant.a", "entrant.b"], winnerId: "entrant.a", score: [11, 7],
      actorId: "fuzz.official", recordedAt: time(80), reason: "generated score",
    });
    ledger = appendAdjudication(ledger, {
      kind: "CORRECT_RESULT", contestId: "match.1", entrants: ["entrant.a", "entrant.b"], winnerId: "entrant.b", score: [9, 11],
      supersedesEventId: ledger.events[0]!.eventId, actorId: "fuzz.referee", recordedAt: time(81), reason: "generated correction",
    });
    ledger = appendAdjudication(ledger, {
      kind: "VOID_RESULT", contestId: "match.1", supersedesEventId: ledger.events[1]!.eventId,
      actorId: "fuzz.director", recordedAt: time(82), reason: "generated void",
    });
    adjudicationLineageChecks += 1;
    if (!verifyAdjudicationLedger(ledger).valid) findings.push(`iteration ${iteration}: score/correction/void lineage failed verification.`);
  }
  const base = {
    status: findings.length ? "REJECTED" as const : "CERTIFIED" as const,
    seed: options.seed,
    iterations: options.iterations,
    commandsAttempted,
    commandsAccepted,
    intentionalRejections,
    idempotentReplays,
    deterministicReplayChecks,
    tamperAndReorderRejections,
    adjudicationLineageChecks,
    scenarioKinds: ["COMPLETION_APPEAL", "WITHDRAWAL_WALKOVER", "RETIREMENT"] as const,
    findings: [...findings].sort(),
    envelope: `${options.iterations} seeded histories; ${outageCycles} court/equipment failure-recovery cycles per history; completion, appeal, withdrawal, walkover, retirement, score, correction, void, duplicate, stale, reorder, and tamper paths.`,
  };
  return deepFreeze({ ...base, proofHash: canonicalHash(base) });
}
