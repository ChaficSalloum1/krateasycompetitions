import assert from "node:assert/strict";
import test from "node:test";
import {
  createTournamentState,
  decideTournamentCommand,
  evolveTournamentState,
  replayTournamentEvents,
  type TournamentCommand,
  type TournamentEvent,
  type TournamentState,
} from "../src/tournament-state.js";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);

type CommandInput<T = TournamentCommand> = T extends TournamentCommand ? Omit<T, "expectedVersion" | "actorId" | "recordedAt"> : never;

const command = <T extends CommandInput>(value: T, state: TournamentState): T & Pick<TournamentCommand, "expectedVersion" | "actorId" | "recordedAt"> => ({
  ...value,
  expectedVersion: state.version,
  actorId: "director",
  recordedAt: `2026-09-05T${String(9 + state.version).padStart(2, "0")}:00:00Z`,
});

function execute(state: TournamentState, value: TournamentCommand, events: TournamentEvent[] = []): TournamentState {
  const decision = decideTournamentCommand(state, value);
  assert.equal(decision.accepted, true, decision.accepted ? undefined : decision.findings.map(({ message }) => message).join("; "));
  if (!decision.accepted) return state;
  events.push(...decision.events);
  return decision.events.reduce(evolveTournamentState, state);
}

function operationalState(events: TournamentEvent[] = []): TournamentState {
  let state = createTournamentState("tournament-1");
  state = execute(state, command({ kind: "REGISTER_DEFINITION", commandId: "cmd-def", revisionId: "definition-1", revision: 1, artifactHash: HASH_A }, state), events);
  state = execute(state, command({ kind: "ACTIVATE_PLAN", commandId: "cmd-plan", revisionId: "plan-1", revision: 1, artifactHash: HASH_B, definitionRevisionId: "definition-1" }, state), events);
  state = execute(state, command({
    kind: "ACTIVATE_OPERATIONAL",
    commandId: "cmd-operational",
    revisionId: "operational-1",
    revision: 1,
    artifactHash: HASH_C,
    planRevisionId: "plan-1",
    contests: [{ contestId: "final", entrantIds: ["A", "B"] }],
  }, state), events);
  return state;
}

test("Definition, Plan, Operational, and Actual truth remain distinct immutable layers", () => {
  const events: TournamentEvent[] = [];
  let state = operationalState(events);
  state = execute(state, command({
    kind: "RECORD_RESULT", commandId: "cmd-result", contestId: "final", entrantIds: ["A", "B"], winnerId: "A", score: [6, 4], reason: "Final score confirmed",
  }, state), events);

  assert.equal(state.phase, "ACTUAL");
  assert.equal(state.definition.activeRevisionId, "definition-1");
  assert.equal(state.plan.activeRevisionId, "plan-1");
  assert.equal(state.operational.activeRevisionId, "operational-1");
  assert.equal(state.actual.effectiveResults.final?.winnerId, "A");
  assert.equal(Object.isFrozen(state), true);
  assert.equal(Object.isFrozen(state.actual.history), true);
  assert.match(state.proofHash, /^[a-f0-9]{64}$/);
});

test("plans and operational revisions cannot skip or target stale lifecycle layers", () => {
  let state = createTournamentState("tournament-1");
  const earlyPlan = decideTournamentCommand(state, command({ kind: "ACTIVATE_PLAN", commandId: "early-plan", revisionId: "plan-1", revision: 1, artifactHash: HASH_B, definitionRevisionId: "definition-1" }, state));
  assert.equal(earlyPlan.accepted, false);
  if (!earlyPlan.accepted) assert.equal(earlyPlan.findings[0]?.code, "TOS413");

  state = execute(state, command({ kind: "REGISTER_DEFINITION", commandId: "def-1", revisionId: "definition-1", revision: 1, artifactHash: HASH_A }, state));
  state = execute(state, command({ kind: "REGISTER_DEFINITION", commandId: "def-2", revisionId: "definition-2", revision: 2, artifactHash: HASH_B }, state));
  const stalePlan = decideTournamentCommand(state, command({ kind: "ACTIVATE_PLAN", commandId: "stale-plan", revisionId: "plan-1", revision: 1, artifactHash: HASH_C, definitionRevisionId: "definition-1" }, state));
  assert.equal(stalePlan.accepted, false);
  if (!stalePlan.accepted) assert.equal(stalePlan.findings[0]?.code, "TOS413");
});

test("revision identities and sequence numbers are immutable", () => {
  let state = createTournamentState("tournament-1");
  state = execute(state, command({ kind: "REGISTER_DEFINITION", commandId: "def-1", revisionId: "definition-1", revision: 1, artifactHash: HASH_A }, state));
  const duplicate = decideTournamentCommand(state, command({ kind: "REGISTER_DEFINITION", commandId: "def-duplicate", revisionId: "definition-1", revision: 2, artifactHash: HASH_B }, state));
  const skipped = decideTournamentCommand(state, command({ kind: "REGISTER_DEFINITION", commandId: "def-skipped", revisionId: "definition-3", revision: 3, artifactHash: HASH_C }, state));

  assert.equal(duplicate.accepted, false);
  assert.equal(skipped.accepted, false);
  if (!duplicate.accepted) assert.equal(duplicate.findings[0]?.code, "TOS411");
  if (!skipped.accepted) assert.equal(skipped.findings[0]?.code, "TOS412");
});

test("result correction and voiding preserve explicit current-event lineage", () => {
  let state = operationalState();
  state = execute(state, command({ kind: "RECORD_RESULT", commandId: "result-1", contestId: "final", entrantIds: ["A", "B"], winnerId: "A", score: [6, 4], reason: "Initial sheet" }, state));
  const firstEventId = state.actual.effectiveResults.final!.eventId;
  state = execute(state, command({ kind: "CORRECT_RESULT", commandId: "result-2", contestId: "final", entrantIds: ["A", "B"], winnerId: "B", score: [4, 6], reason: "Transcription corrected", supersedesEventId: firstEventId }, state));
  const correctionEventId = state.actual.effectiveResults.final!.eventId;
  state = execute(state, command({ kind: "VOID_RESULT", commandId: "result-3", contestId: "final", reason: "Match invalidated", supersedesEventId: correctionEventId }, state));

  assert.equal(state.actual.history.length, 3);
  assert.equal(state.actual.history[1]?.supersedesEventId, firstEventId);
  assert.equal(state.actual.effectiveResults.final?.status, "VOIDED");
  assert.equal(state.actual.effectiveResults.final?.supersedesEventId, correctionEventId);
});

test("the invariant firewall rejects overwrites, stale corrections, and invented entrants", () => {
  let state = operationalState();
  state = execute(state, command({ kind: "RECORD_RESULT", commandId: "result-1", contestId: "final", entrantIds: ["A", "B"], winnerId: "A", score: [6, 4], reason: "Initial sheet" }, state));
  const duplicate = decideTournamentCommand(state, command({ kind: "RECORD_RESULT", commandId: "result-overwrite", contestId: "final", entrantIds: ["A", "B"], winnerId: "B", score: [4, 6], reason: "Overwrite" }, state));
  const invented = decideTournamentCommand(state, command({ kind: "RECORD_RESULT", commandId: "result-invented", contestId: "final", entrantIds: ["A", "C"], winnerId: "C", score: [4, 6], reason: "Wrong entrant" }, state));
  const stale = decideTournamentCommand(state, command({ kind: "CORRECT_RESULT", commandId: "result-stale", contestId: "final", entrantIds: ["A", "B"], winnerId: "B", score: [4, 6], reason: "Stale", supersedesEventId: "evt_missing" }, state));

  assert.equal(duplicate.accepted, false);
  assert.equal(invented.accepted, false);
  assert.equal(stale.accepted, false);
  if (!duplicate.accepted) assert.equal(duplicate.findings[0]?.code, "TOS431");
  if (!invented.accepted) assert.equal(invented.findings[0]?.code, "TOS430");
  if (!stale.accepted) assert.equal(stale.findings[0]?.code, "TOS432");
});

test("optimistic concurrency and content-bound idempotency are enforced", () => {
  let state = createTournamentState("tournament-1");
  const first = command({ kind: "REGISTER_DEFINITION", commandId: "def-1", revisionId: "definition-1", revision: 1, artifactHash: HASH_A }, state);
  state = execute(state, first);
  const retry = decideTournamentCommand(state, first);
  const reused = decideTournamentCommand(state, { ...first, artifactHash: HASH_B });
  const staleCommand = command({ kind: "REGISTER_DEFINITION", commandId: "def-stale", revisionId: "definition-2", revision: 2, artifactHash: HASH_B }, createTournamentState("tournament-1"));

  assert.deepEqual(retry, { accepted: true, events: [], findings: [] });
  assert.equal(reused.accepted, false);
  const staleAgainstCurrent = decideTournamentCommand(state, staleCommand);
  assert.equal(staleAgainstCurrent.accepted, false);
});

test("event replay reconstructs the same proof and rejects tampering", () => {
  const events: TournamentEvent[] = [];
  let state = operationalState(events);
  state = execute(state, command({ kind: "RECORD_RESULT", commandId: "result-1", contestId: "final", entrantIds: ["A", "B"], winnerId: "A", score: [6, 4], reason: "Confirmed" }, state), events);
  const replay = replayTournamentEvents("tournament-1", events);

  assert.equal(replay.valid, true);
  if (replay.valid) assert.equal(replay.state.proofHash, state.proofHash);
  const tampered = events.map((event) => structuredClone(event));
  (tampered.at(-1)! as Extract<TournamentEvent, { kind: "RESULT_RECORDED" }>).winnerId = "B";
  const rejected = replayTournamentEvents("tournament-1", tampered);
  assert.equal(rejected.valid, false);
  if (!rejected.valid) assert.equal(rejected.findings[0]?.code, "TOS402");
});
