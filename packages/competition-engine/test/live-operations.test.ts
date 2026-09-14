import assert from "node:assert/strict";
import test from "node:test";
import {
  createLiveOperationsState,
  deriveLiveControlRoom,
  replayLiveOperationsEvents,
  submitLiveOperationsCommand,
  type LiveOperationsCommand,
  type LiveOperationsDefinition,
  type LiveOperationsState,
} from "../src/live-operations.js";

const definition: LiveOperationsDefinition = {
  tournamentId: "open-2026",
  lateToleranceMinutes: 5,
  courts: ["court-1", "court-2"],
  officials: ["official-1"],
  equipment: ["net-1"],
  contests: [
    {
      contestId: "semi-1",
      entrantIds: ["pair-a", "pair-b"],
      courtId: "court-1",
      officialId: "official-1",
      equipmentIds: ["net-1"],
      scheduledStart: "2026-09-07T09:00:00.000Z",
      scheduledEnd: "2026-09-07T09:45:00.000Z",
    },
    {
      contestId: "final",
      entrantIds: ["winner-semi-1", "pair-c"],
      courtId: "court-2",
      dependencyContestIds: ["semi-1"],
      scheduledStart: "2026-09-07T10:00:00.000Z",
      scheduledEnd: "2026-09-07T10:45:00.000Z",
    },
  ],
};

type CommandInput = LiveOperationsCommand extends infer Command
  ? Command extends LiveOperationsCommand ? Omit<Command, "expectedVersion" | "actorId" | "occurredAt"> : never
  : never;

function command(input: CommandInput, state: LiveOperationsState, occurredAt = "2026-09-07T08:55:00.000Z"): LiveOperationsCommand {
  return { ...input, expectedVersion: state.version, actorId: "director-1", occurredAt } as LiveOperationsCommand;
}

function execute(state: LiveOperationsState, input: CommandInput, occurredAt?: string): LiveOperationsState {
  const result = submitLiveOperationsCommand(state, command(input, state, occurredAt));
  assert.equal(result.accepted, true, result.findings.map(({ message }) => message).join("\n"));
  return result.state;
}

test("checked-in entrants make an otherwise available scheduled contest ready next", () => {
  let state = createLiveOperationsState(definition);
  state = execute(state, { kind: "CHECK_IN", commandId: "checkin-a", entrantId: "pair-a" });
  state = execute(state, { kind: "CHECK_IN", commandId: "checkin-b", entrantId: "pair-b" });

  const view = deriveLiveControlRoom(state, "2026-09-07T08:56:00.000Z");

  assert.deepEqual(view.next.map(({ contestId }) => contestId), ["semi-1"]);
  assert.deepEqual(view.blocked.map(({ contestId }) => contestId), ["final"]);
  assert.deepEqual(view.blocked[0]?.reasons.map(({ code }) => code), ["PENDING_PREDECESSOR", "ENTRANT_NOT_CHECKED_IN"]);
  assert.equal(Object.isFrozen(view), true);
  assert.equal(Object.isFrozen(state.events[0]), true);
});

test("commands enforce optimistic concurrency and content-bound idempotency without mutation", () => {
  const initial = createLiveOperationsState(definition);
  const firstCommand = command({ kind: "CHECK_IN", commandId: "checkin-a", entrantId: "pair-a" }, initial);
  const first = submitLiveOperationsCommand(initial, firstCommand);
  assert.equal(first.accepted, true);
  if (!first.accepted) return;

  const replay = submitLiveOperationsCommand(first.state, firstCommand);
  assert.equal(replay.accepted, true);
  if (replay.accepted) {
    assert.equal(replay.idempotentReplay, true);
    assert.equal(replay.state, first.state);
    assert.deepEqual(replay.events, []);
  }

  const conflict = submitLiveOperationsCommand(first.state, {
    kind: "CHECK_IN", commandId: firstCommand.commandId, expectedVersion: firstCommand.expectedVersion,
    actorId: firstCommand.actorId, occurredAt: firstCommand.occurredAt, entrantId: "pair-b",
  });
  assert.equal(conflict.accepted, false);
  if (!conflict.accepted) assert.equal(conflict.findings[0]?.code, "LIVE409");

  const stale = submitLiveOperationsCommand(first.state, command({ kind: "CHECK_IN", commandId: "checkin-b", entrantId: "pair-b" }, initial));
  assert.equal(stale.accepted, false);
  if (!stale.accepted) assert.equal(stale.findings[0]?.code, "LIVE409");
  assert.equal(first.state.version, 1);
});

test("late and no-show facts drive the control room until a scoreless walkover settles the contest", () => {
  let state = createLiveOperationsState(definition);
  state = execute(state, { kind: "CHECK_IN", commandId: "checkin-a", entrantId: "pair-a" });
  state = execute(state, { kind: "CHECK_IN", commandId: "checkin-b", entrantId: "pair-b" });
  state = execute(state, { kind: "MARK_LATE", commandId: "late-a", entrantId: "pair-a", reason: "Traffic" }, "2026-09-07T09:04:00.000Z");

  const late = deriveLiveControlRoom(state, "2026-09-07T09:06:00.000Z");
  assert.deepEqual(late.late.map(({ contestId }) => contestId), ["semi-1"]);
  assert.equal(late.late[0]?.minutesLate, 6);

  state = execute(state, { kind: "DECLARE_NO_SHOW", commandId: "no-show-a", contestId: "semi-1", entrantId: "pair-a", reason: "Call time expired" }, "2026-09-07T09:10:00.000Z");
  const blocked = deriveLiveControlRoom(state, "2026-09-07T09:10:00.000Z");
  assert.deepEqual(blocked.blocked.find(({ contestId }) => contestId === "semi-1")?.reasons.map(({ code }) => code), ["ENTRANT_NO_SHOW"]);

  state = execute(state, { kind: "AWARD_WALKOVER", commandId: "walkover-b", contestId: "semi-1", winnerEntrantId: "pair-b", absentEntrantId: "pair-a", reason: "Published no-show policy" }, "2026-09-07T09:11:00.000Z");
  const settled = deriveLiveControlRoom(state, "2026-09-07T09:12:00.000Z");
  assert.deepEqual(settled.unreported.map(({ contestId }) => contestId), ["semi-1"]);
  assert.equal(state.contests["semi-1"]?.status, "WALKOVER");
  assert.equal(state.contests["semi-1"]?.winnerEntrantId, "pair-b");
});

test("actual start, finish, and result receipt move a contest through now and unreported", () => {
  let state = createLiveOperationsState(definition);
  state = execute(state, { kind: "CHECK_IN", commandId: "checkin-a", entrantId: "pair-a" });
  state = execute(state, { kind: "CHECK_IN", commandId: "checkin-b", entrantId: "pair-b" });
  state = execute(state, { kind: "START_CONTEST", commandId: "start-semi", contestId: "semi-1", courtId: "court-1", startedAt: "2026-09-07T09:02:00.000Z" }, "2026-09-07T09:02:00.000Z");

  assert.deepEqual(deriveLiveControlRoom(state, "2026-09-07T09:10:00.000Z").now.map(({ contestId }) => contestId), ["semi-1"]);
  assert.equal(state.contests["semi-1"]?.actualStart, "2026-09-07T09:02:00.000Z");

  state = execute(state, { kind: "COMPLETE_CONTEST", commandId: "complete-semi", contestId: "semi-1", endedAt: "2026-09-07T09:41:00.000Z" }, "2026-09-07T09:41:00.000Z");
  assert.deepEqual(deriveLiveControlRoom(state, "2026-09-07T09:42:00.000Z").unreported.map(({ contestId }) => contestId), ["semi-1"]);
  assert.equal(state.contests["semi-1"]?.actualDurationMinutes, 39);

  state = execute(state, { kind: "RECORD_RESULT_RECEIPT", commandId: "result-semi", contestId: "semi-1", source: "umpire-tablet" }, "2026-09-07T09:43:00.000Z");
  assert.deepEqual(deriveLiveControlRoom(state, "2026-09-07T09:44:00.000Z").unreported, []);
});

test("call, score, finish, and correction remain immutable replayable operational facts", () => {
  let state = createLiveOperationsState(definition);
  state = execute(state, { kind: "CHECK_IN", commandId: "checkin-a", entrantId: "pair-a" });
  state = execute(state, { kind: "CHECK_IN", commandId: "checkin-b", entrantId: "pair-b" });
  state = execute(state, { kind: "CALL_CONTEST", commandId: "call-semi", contestId: "semi-1" },
    "2026-09-07T08:58:00.000Z");
  assert.equal(state.contests["semi-1"]?.calledAt, "2026-09-07T08:58:00.000Z");
  state = execute(state, { kind: "START_CONTEST", commandId: "start-called-semi", contestId: "semi-1",
    courtId: "court-1", startedAt: "2026-09-07T09:00:00.000Z" }, "2026-09-07T09:00:00.000Z");
  state = execute(state, { kind: "RECORD_SCORE", commandId: "score-semi", contestId: "semi-1",
    scores: [{ entrantId: "pair-a", value: 5 }, { entrantId: "pair-b", value: 3 }] },
  "2026-09-07T09:35:00.000Z");
  const scoreEventId = state.events.at(-1)!.eventId;
  state = execute(state, { kind: "COMPLETE_CONTEST", commandId: "finish-called-semi", contestId: "semi-1",
    endedAt: "2026-09-07T09:40:00.000Z" }, "2026-09-07T09:40:00.000Z");
  state = execute(state, { kind: "CORRECT_OPERATION", commandId: "correct-score-semi",
    supersedesEventId: scoreEventId, reason: "Signed score card verified",
    replacement: { kind: "SET_CONTEST_SCORE", contestId: "semi-1",
      scores: [{ entrantId: "pair-a", value: 5 }, { entrantId: "pair-b", value: 4 }],
      reason: "Second side was transcribed incorrectly" } }, "2026-09-07T09:42:00.000Z");

  assert.deepEqual(state.contests["semi-1"]?.scores,
    [{ entrantId: "pair-a", value: 5 }, { entrantId: "pair-b", value: 4 }]);
  assert.equal(state.contests["semi-1"]?.status, "COMPLETED");
  assert.equal(state.events.filter(({ kind }) => kind === "SCORE_RECORDED").length, 1);
  assert.equal(state.events.at(-1)?.kind, "OPERATION_CORRECTED");
  const replay = replayLiveOperationsEvents(definition, state.events);
  assert.equal(replay.valid, true);
  if (replay.valid) assert.equal(replay.state.proofHash, state.proofHash);
});

test("court, official, and equipment outages block affected contests until explicitly restored", () => {
  let state = createLiveOperationsState(definition);
  state = execute(state, { kind: "CHECK_IN", commandId: "checkin-a", entrantId: "pair-a" });
  state = execute(state, { kind: "CHECK_IN", commandId: "checkin-b", entrantId: "pair-b" });
  state = execute(state, { kind: "CLOSE_COURT", commandId: "close-court", courtId: "court-1", reason: "Surface unsafe", expectedReopenAt: "2026-09-07T09:20:00.000Z" });
  state = execute(state, { kind: "MARK_OFFICIAL_ABSENT", commandId: "official-away", officialId: "official-1", reason: "Medical incident" });
  state = execute(state, { kind: "REPORT_EQUIPMENT_FAILURE", commandId: "net-failed", equipmentId: "net-1", reason: "Net post damaged" });

  const blocked = deriveLiveControlRoom(state, "2026-09-07T08:58:00.000Z");
  assert.deepEqual(blocked.blocked.find(({ contestId }) => contestId === "semi-1")?.reasons.map(({ code }) => code), [
    "COURT_CLOSED",
    "OFFICIAL_ABSENT",
    "EQUIPMENT_FAILED",
  ]);

  state = execute(state, { kind: "REOPEN_COURT", commandId: "reopen-court", courtId: "court-1", reason: "Surface cleared" });
  state = execute(state, { kind: "RESTORE_OFFICIAL", commandId: "official-back", officialId: "official-1", reason: "Replacement assigned" });
  state = execute(state, { kind: "RESTORE_EQUIPMENT", commandId: "net-restored", equipmentId: "net-1", reason: "Post replaced" });
  assert.deepEqual(deriveLiveControlRoom(state, "2026-09-07T08:59:00.000Z").next.map(({ contestId }) => contestId), ["semi-1"]);
});

test("a withdrawal blocks future contests and is eligible for an explicit walkover decision", () => {
  let state = createLiveOperationsState(definition);
  state = execute(state, { kind: "CHECK_IN", commandId: "checkin-b", entrantId: "pair-b" });
  state = execute(state, { kind: "WITHDRAW_ENTRANT", commandId: "withdraw-a", entrantId: "pair-a", reason: "Injury" });

  const blocked = deriveLiveControlRoom(state, "2026-09-07T08:58:00.000Z");
  assert.deepEqual(blocked.blocked.find(({ contestId }) => contestId === "semi-1")?.reasons.map(({ code }) => code), ["ENTRANT_WITHDRAWN"]);

  state = execute(state, { kind: "AWARD_WALKOVER", commandId: "walkover-b", contestId: "semi-1", winnerEntrantId: "pair-b", absentEntrantId: "pair-a", reason: "Withdrawal policy" });
  assert.equal(state.contests["semi-1"]?.status, "WALKOVER");
});

test("retirement settles only an in-progress contest and preserves actual timing", () => {
  let state = createLiveOperationsState(definition);
  state = execute(state, { kind: "CHECK_IN", commandId: "checkin-a", entrantId: "pair-a" });
  state = execute(state, { kind: "CHECK_IN", commandId: "checkin-b", entrantId: "pair-b" });
  state = execute(state, { kind: "START_CONTEST", commandId: "start-semi", contestId: "semi-1", courtId: "court-1", startedAt: "2026-09-07T09:02:00.000Z" }, "2026-09-07T09:02:00.000Z");
  state = execute(state, {
    kind: "RECORD_RETIREMENT",
    commandId: "retirement-a",
    contestId: "semi-1",
    retiredEntrantId: "pair-a",
    winnerEntrantId: "pair-b",
    endedAt: "2026-09-07T09:22:00.000Z",
    reason: "Injury retirement",
  }, "2026-09-07T09:22:00.000Z");

  assert.equal(state.contests["semi-1"]?.status, "RETIRED");
  assert.equal(state.contests["semi-1"]?.retiredEntrantId, "pair-a");
  assert.equal(state.contests["semi-1"]?.winnerEntrantId, "pair-b");
  assert.equal(state.contests["semi-1"]?.actualDurationMinutes, 20);
  assert.deepEqual(deriveLiveControlRoom(state, "2026-09-07T09:23:00.000Z").unreported.map(({ contestId }) => contestId), ["semi-1"]);
});

test("a protest and its appeal block dependent play until each audited decision is resolved", () => {
  let state = createLiveOperationsState(definition);
  for (const entrantId of ["pair-a", "pair-b", "winner-semi-1", "pair-c"]) {
    state = execute(state, { kind: "CHECK_IN", commandId: `checkin-${entrantId}`, entrantId });
  }
  state = execute(state, { kind: "START_CONTEST", commandId: "start-semi", contestId: "semi-1", courtId: "court-1", startedAt: "2026-09-07T09:00:00.000Z" }, "2026-09-07T09:00:00.000Z");
  state = execute(state, { kind: "COMPLETE_CONTEST", commandId: "complete-semi", contestId: "semi-1", endedAt: "2026-09-07T09:40:00.000Z" }, "2026-09-07T09:40:00.000Z");
  state = execute(state, { kind: "FILE_PROTEST", commandId: "file-protest", protestId: "protest-1", contestId: "semi-1", filedById: "pair-a", reason: "Ineligible lineup" }, "2026-09-07T09:42:00.000Z");
  assert.deepEqual(deriveLiveControlRoom(state, "2026-09-07T09:43:00.000Z").blocked.find(({ contestId }) => contestId === "final")?.reasons.map(({ code }) => code), ["PROTEST_PENDING"]);

  state = execute(state, { kind: "RESOLVE_PROTEST", commandId: "resolve-protest", protestId: "protest-1", outcome: "DENIED", reason: "Lineup verified" }, "2026-09-07T09:45:00.000Z");
  state = execute(state, { kind: "FILE_APPEAL", commandId: "file-appeal", appealId: "appeal-1", protestId: "protest-1", filedById: "pair-a", reason: "Request panel review" }, "2026-09-07T09:46:00.000Z");
  assert.deepEqual(deriveLiveControlRoom(state, "2026-09-07T09:47:00.000Z").blocked.find(({ contestId }) => contestId === "final")?.reasons.map(({ code }) => code), ["APPEAL_PENDING"]);

  state = execute(state, { kind: "RESOLVE_APPEAL", commandId: "resolve-appeal", appealId: "appeal-1", outcome: "DENIED", reason: "Original decision confirmed" }, "2026-09-07T09:48:00.000Z");
  assert.deepEqual(deriveLiveControlRoom(state, "2026-09-07T09:49:00.000Z").next.map(({ contestId }) => contestId), ["final"]);
});

test("linked corrections preserve immutable history while replay rejects event tampering", () => {
  let state = createLiveOperationsState(definition);
  state = execute(state, { kind: "CHECK_IN", commandId: "checkin-b", entrantId: "pair-b" });
  state = execute(state, { kind: "DECLARE_NO_SHOW", commandId: "no-show-a", contestId: "semi-1", entrantId: "pair-a", reason: "Desk error" });
  const wrongEventId = state.events.at(-1)!.eventId;

  state = execute(state, {
    kind: "CORRECT_OPERATION",
    commandId: "correct-no-show-a",
    supersedesEventId: wrongEventId,
    replacement: { kind: "SET_ENTRANT_PRESENCE", entrantId: "pair-a", status: "CHECKED_IN", reason: "Entrant was present" },
    reason: "Director verified check-in log",
  });

  assert.equal(state.events.length, 3);
  assert.equal(state.events[1]?.eventId, wrongEventId);
  assert.equal(state.events[2]?.kind, "OPERATION_CORRECTED");
  assert.equal(state.entrantPresence["pair-a"], "CHECKED_IN");
  assert.deepEqual(deriveLiveControlRoom(state, "2026-09-07T08:58:00.000Z").next.map(({ contestId }) => contestId), ["semi-1"]);

  const replay = replayLiveOperationsEvents(definition, state.events);
  assert.equal(replay.valid, true);
  if (replay.valid) assert.equal(replay.state.proofHash, state.proofHash);

  const tampered = structuredClone(state.events);
  (tampered[0] as { actorId: string }).actorId = "invented-director";
  const rejected = replayLiveOperationsEvents(definition, tampered);
  assert.equal(rejected.valid, false);
  if (!rejected.valid) assert.equal(rejected.findings[0]?.code, "LIVE401");
});
