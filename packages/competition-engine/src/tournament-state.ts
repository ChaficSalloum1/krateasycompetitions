import { canonicalHash, deepFreeze } from "@tournament-os/tournament-schema";

interface CommandMetadata { commandId: string; expectedVersion: number; actorId: string; recordedAt: string; }
interface RevisionCommand { revisionId: string; revision: number; artifactHash: string; }
interface ResultCommand {
  contestId: string;
  entrantIds: readonly [string, string];
  winnerId: string;
  score: readonly [number, number];
  reason: string;
}

export type TournamentCommand = CommandMetadata & (
  | ({ kind: "REGISTER_DEFINITION" } & RevisionCommand)
  | ({ kind: "ACTIVATE_PLAN"; definitionRevisionId: string } & RevisionCommand)
  | ({ kind: "ACTIVATE_OPERATIONAL"; planRevisionId: string; contests: readonly OperationalContest[] } & RevisionCommand)
  | ({ kind: "RECORD_RESULT" } & ResultCommand)
  | ({ kind: "CORRECT_RESULT"; supersedesEventId: string } & ResultCommand)
  | { kind: "VOID_RESULT"; contestId: string; supersedesEventId: string; reason: string }
);

export interface OperationalContest { contestId: string; entrantIds: readonly [string, string]; }
export interface RevisionRecord { revisionId: string; revision: number; artifactHash: string; activatedByEventId: string; }
export interface PlanRevisionRecord extends RevisionRecord { definitionRevisionId: string; }
export interface OperationalRevisionRecord extends RevisionRecord { planRevisionId: string; contests: readonly OperationalContest[]; }
export interface LayerState<T extends RevisionRecord> { revisions: readonly T[]; activeRevisionId: string | null; }

export interface ActualResult {
  eventId: string;
  contestId: string;
  status: "RECORDED" | "VOIDED";
  entrantIds: readonly [string, string];
  winnerId: string | null;
  score: readonly [number, number] | null;
  supersedesEventId: string | null;
  reason: string;
}

export interface TournamentState {
  tournamentId: string;
  phase: "EMPTY" | "DEFINITION" | "PLAN" | "OPERATIONAL" | "ACTUAL";
  version: number;
  lastEventHash: string | null;
  processedCommandIds: readonly string[];
  commandFingerprints: Readonly<Record<string, string>>;
  definition: LayerState<RevisionRecord>;
  plan: LayerState<PlanRevisionRecord>;
  operational: LayerState<OperationalRevisionRecord>;
  actual: {
    effectiveResults: Readonly<Record<string, ActualResult>>;
    history: readonly ActualResult[];
  };
  proofHash: string;
}

interface EventMetadata {
  tournamentId: string;
  eventId: string;
  eventHash: string;
  previousEventHash: string | null;
  sequence: number;
  commandId: string;
  commandFingerprint: string;
  actorId: string;
  recordedAt: string;
}
type TournamentEventData =
  | ({ kind: "DEFINITION_REGISTERED" } & RevisionCommand)
  | ({ kind: "PLAN_ACTIVATED"; definitionRevisionId: string } & RevisionCommand)
  | ({ kind: "OPERATIONAL_ACTIVATED"; planRevisionId: string; contests: readonly OperationalContest[] } & RevisionCommand)
  | ({ kind: "RESULT_RECORDED" } & ResultCommand)
  | ({ kind: "RESULT_CORRECTED"; supersedesEventId: string } & ResultCommand)
  | { kind: "RESULT_VOIDED"; contestId: string; supersedesEventId: string; reason: string };
export type TournamentEvent = EventMetadata & TournamentEventData;

export interface TournamentStateFinding { code: string; path: string; message: string; evidence?: Record<string, unknown>; }
export type TournamentDecision =
  | { accepted: true; events: readonly TournamentEvent[]; findings: readonly TournamentStateFinding[] }
  | { accepted: false; events: readonly TournamentEvent[]; findings: readonly TournamentStateFinding[] };
export type TournamentReplay =
  | { valid: true; state: TournamentState; findings: readonly [] }
  | { valid: false; state: TournamentState; findings: readonly TournamentStateFinding[] };

class InvariantFirewallError extends Error {
  constructor(readonly code: string, message: string, readonly evidence?: Record<string, unknown>) { super(message); }
}

const HASH = /^[a-f0-9]{64}$/;
const fail = (code: string, message: string, evidence?: Record<string, unknown>): never => { throw new InvariantFirewallError(code, message, evidence); };
const findingFrom = (error: unknown): TournamentStateFinding => error instanceof InvariantFirewallError
  ? { code: error.code, path: "/tournamentState", message: error.message, ...(error.evidence ? { evidence: error.evidence } : {}) }
  : { code: "TOS500", path: "/tournamentState", message: error instanceof Error ? error.message : "Unknown state transition failure." };

function coreState(state: Omit<TournamentState, "proofHash">): TournamentState {
  return deepFreeze({ ...state, proofHash: canonicalHash(state) }) as TournamentState;
}

export function createTournamentState(tournamentId: string): TournamentState {
  if (!tournamentId.trim()) throw new Error("Tournament id is required.");
  return coreState({
    tournamentId,
    phase: "EMPTY",
    version: 0,
    lastEventHash: null,
    processedCommandIds: [],
    commandFingerprints: {},
    definition: { revisions: [], activeRevisionId: null },
    plan: { revisions: [], activeRevisionId: null },
    operational: { revisions: [], activeRevisionId: null },
    actual: { effectiveResults: {}, history: [] },
  });
}

function eventBase(event: TournamentEvent): Omit<TournamentEvent, "eventId" | "eventHash"> {
  const { eventId: _eventId, eventHash: _eventHash, ...base } = event;
  return base;
}

function verifyEventEnvelope(state: TournamentState, event: TournamentEvent): void {
  if (event.tournamentId !== state.tournamentId) fail("TOS401", "Invariant firewall rejected an event for a different tournament aggregate.", { expectedTournamentId: state.tournamentId, actualTournamentId: event.tournamentId });
  if (event.sequence !== state.version + 1 || event.previousEventHash !== state.lastEventHash) {
    fail("TOS401", "Invariant firewall rejected a broken event sequence or hash-chain link.", { expectedSequence: state.version + 1, actualSequence: event.sequence, expectedPreviousEventHash: state.lastEventHash, actualPreviousEventHash: event.previousEventHash });
  }
  const base = eventBase(event);
  const expectedEventId = `evt_${canonicalHash(base).slice(0, 24)}`;
  const { eventHash: _eventHash, ...withoutHash } = event;
  if (event.eventId !== expectedEventId || event.eventHash !== canonicalHash(withoutHash)) {
    fail("TOS402", "Invariant firewall rejected event content that does not match its deterministic identity or proof hash.", { eventId: event.eventId });
  }
  if (state.processedCommandIds.includes(event.commandId)) fail("TOS409", "Invariant firewall rejected a repeated command event.", { commandId: event.commandId });
  if (!event.actorId.trim() || !event.commandId.trim() || !HASH.test(event.commandFingerprint) || !Number.isFinite(Date.parse(event.recordedAt))) fail("TOS400", "Event audit metadata is incomplete or invalid.");
}

function validateRevision(revisions: readonly RevisionRecord[], event: RevisionCommand): void {
  if (!event.revisionId.trim() || !HASH.test(event.artifactHash) || !Number.isInteger(event.revision) || event.revision <= 0) {
    fail("TOS410", "Revision identity, number, and artifact hash must be explicit and valid.", { revisionId: event.revisionId, revision: event.revision });
  }
  if (revisions.some(({ revisionId, revision }) => revisionId === event.revisionId || revision === event.revision)) {
    fail("TOS411", "Activated revisions are immutable and their ids and numbers cannot be reused.", { revisionId: event.revisionId, revision: event.revision });
  }
  const expectedRevision = (revisions.at(-1)?.revision ?? 0) + 1;
  if (event.revision !== expectedRevision) fail("TOS412", "Revision numbers must be contiguous.", { expectedRevision, actualRevision: event.revision });
}

function validateOperationalContests(contests: readonly OperationalContest[]): OperationalContest[] {
  const ids = contests.map(({ contestId }) => contestId);
  const duplicates = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))].sort();
  if (contests.length === 0 || duplicates.length) fail("TOS420", "An operational revision needs unique registered contests.", { contestCount: contests.length, duplicateContestIds: duplicates });
  return [...contests].map(({ contestId, entrantIds }) => {
    const normalized = [...entrantIds] as [string, string];
    if (!contestId.trim() || normalized.length !== 2 || !normalized[0]?.trim() || !normalized[1]?.trim() || normalized[0] === normalized[1]) {
      fail("TOS420", "Operational contest entrants must be two distinct registered identities.", { contestId, entrantIds });
    }
    return { contestId, entrantIds: normalized };
  }).sort((left, right) => left.contestId.localeCompare(right.contestId));
}

function activeOperational(state: TournamentState): OperationalRevisionRecord | undefined {
  return state.operational.revisions.find(({ revisionId }) => revisionId === state.operational.activeRevisionId);
}

function registeredContest(state: TournamentState, contestId: string): OperationalContest {
  const contest = activeOperational(state)?.contests.find((entry) => entry.contestId === contestId);
  if (!contest) fail("TOS421", "Actual truth can only target a contest in the active operational revision.", { contestId });
  return contest!;
}

function sameEntrants(left: readonly string[], right: readonly string[]): boolean {
  return [...left].sort().join("|") === [...right].sort().join("|");
}

function validateResult(state: TournamentState, data: ResultCommand): OperationalContest {
  const contest = registeredContest(state, data.contestId);
  if (!sameEntrants(contest.entrantIds, data.entrantIds) || !data.entrantIds.includes(data.winnerId) || data.entrantIds[0] === data.entrantIds[1]) {
    fail("TOS430", "Result entrants and winner must match active operational truth.", { contestId: data.contestId, registeredEntrantIds: contest.entrantIds, suppliedEntrantIds: data.entrantIds, winnerId: data.winnerId });
  }
  if (data.score.length !== 2 || data.score.some((value) => !Number.isFinite(value) || value < 0) || !data.reason.trim()) {
    fail("TOS430", "Result score and audit reason are invalid.", { contestId: data.contestId, score: data.score });
  }
  return contest;
}

function phaseFor(definition: LayerState<RevisionRecord>, plan: LayerState<PlanRevisionRecord>, operational: LayerState<OperationalRevisionRecord>, actualCount: number): TournamentState["phase"] {
  if (actualCount) return "ACTUAL";
  if (operational.activeRevisionId) return "OPERATIONAL";
  if (plan.activeRevisionId) return "PLAN";
  if (definition.activeRevisionId) return "DEFINITION";
  return "EMPTY";
}

export function evolveTournamentState(state: TournamentState, event: TournamentEvent): TournamentState {
  verifyEventEnvelope(state, event);
  let definition = state.definition;
  let plan = state.plan;
  let operational = state.operational;
  let actual = state.actual;

  if (event.kind === "DEFINITION_REGISTERED") {
    validateRevision(definition.revisions, event);
    const revision: RevisionRecord = { revisionId: event.revisionId, revision: event.revision, artifactHash: event.artifactHash, activatedByEventId: event.eventId };
    definition = { revisions: [...definition.revisions, revision], activeRevisionId: revision.revisionId };
  } else if (event.kind === "PLAN_ACTIVATED") {
    validateRevision(plan.revisions, event);
    if (definition.activeRevisionId !== event.definitionRevisionId) fail("TOS413", "A plan must activate against the current definition revision.", { activeDefinitionRevisionId: definition.activeRevisionId, suppliedDefinitionRevisionId: event.definitionRevisionId });
    const revision: PlanRevisionRecord = { revisionId: event.revisionId, revision: event.revision, artifactHash: event.artifactHash, activatedByEventId: event.eventId, definitionRevisionId: event.definitionRevisionId };
    plan = { revisions: [...plan.revisions, revision], activeRevisionId: revision.revisionId };
  } else if (event.kind === "OPERATIONAL_ACTIVATED") {
    validateRevision(operational.revisions, event);
    if (plan.activeRevisionId !== event.planRevisionId) fail("TOS414", "Operational truth must activate against the current approved plan.", { activePlanRevisionId: plan.activeRevisionId, suppliedPlanRevisionId: event.planRevisionId });
    const contests = validateOperationalContests(event.contests);
    for (const result of Object.values(actual.effectiveResults)) {
      const replacement = contests.find(({ contestId }) => contestId === result.contestId);
      if (!replacement || !sameEntrants(replacement.entrantIds, result.entrantIds)) fail("TOS422", "A new operational revision cannot invalidate existing actual truth.", { contestId: result.contestId });
    }
    const revision: OperationalRevisionRecord = { revisionId: event.revisionId, revision: event.revision, artifactHash: event.artifactHash, activatedByEventId: event.eventId, planRevisionId: event.planRevisionId, contests };
    operational = { revisions: [...operational.revisions, revision], activeRevisionId: revision.revisionId };
  } else if (event.kind === "RESULT_RECORDED") {
    validateResult(state, event);
    if (actual.effectiveResults[event.contestId]) fail("TOS431", "Existing actual truth cannot be overwritten; issue a linked correction or void.", { contestId: event.contestId, currentEventId: actual.effectiveResults[event.contestId]!.eventId });
    const result: ActualResult = { eventId: event.eventId, contestId: event.contestId, status: "RECORDED", entrantIds: [...event.entrantIds] as [string, string], winnerId: event.winnerId, score: [...event.score] as [number, number], supersedesEventId: null, reason: event.reason };
    actual = { effectiveResults: { ...actual.effectiveResults, [event.contestId]: result }, history: [...actual.history, result] };
  } else if (event.kind === "RESULT_CORRECTED") {
    validateResult(state, event);
    const current = actual.effectiveResults[event.contestId];
    if (!current || current.status !== "RECORDED" || current.eventId !== event.supersedesEventId) fail("TOS432", "A correction must supersede the current recorded result.", { contestId: event.contestId, currentEventId: current?.eventId ?? null, suppliedSupersedesEventId: event.supersedesEventId });
    const result: ActualResult = { eventId: event.eventId, contestId: event.contestId, status: "RECORDED", entrantIds: [...event.entrantIds] as [string, string], winnerId: event.winnerId, score: [...event.score] as [number, number], supersedesEventId: event.supersedesEventId, reason: event.reason };
    actual = { effectiveResults: { ...actual.effectiveResults, [event.contestId]: result }, history: [...actual.history, result] };
  } else {
    const contest = registeredContest(state, event.contestId);
    const current = actual.effectiveResults[event.contestId];
    if (!event.reason.trim() || !current || current.status !== "RECORDED" || current.eventId !== event.supersedesEventId) fail("TOS433", "A void must supersede the current recorded result and include a reason.", { contestId: event.contestId, currentEventId: current?.eventId ?? null, suppliedSupersedesEventId: event.supersedesEventId });
    const result: ActualResult = { eventId: event.eventId, contestId: event.contestId, status: "VOIDED", entrantIds: [...contest.entrantIds] as [string, string], winnerId: null, score: null, supersedesEventId: event.supersedesEventId, reason: event.reason };
    actual = { effectiveResults: { ...actual.effectiveResults, [event.contestId]: result }, history: [...actual.history, result] };
  }

  const withoutProof: Omit<TournamentState, "proofHash"> = {
    tournamentId: state.tournamentId,
    phase: phaseFor(definition, plan, operational, actual.history.length),
    version: event.sequence,
    lastEventHash: event.eventHash,
    processedCommandIds: [...state.processedCommandIds, event.commandId],
    commandFingerprints: { ...state.commandFingerprints, [event.commandId]: event.commandFingerprint },
    definition,
    plan,
    operational,
    actual,
  };
  return coreState(withoutProof);
}

function makeEvent(state: TournamentState, command: TournamentCommand): TournamentEvent {
  const { expectedVersion: _expectedVersion, ...idempotentCommand } = command;
  const common = { tournamentId: state.tournamentId, sequence: state.version + 1, previousEventHash: state.lastEventHash, commandId: command.commandId, commandFingerprint: canonicalHash(idempotentCommand), actorId: command.actorId, recordedAt: command.recordedAt };
  let data: TournamentEventData;
  if (command.kind === "REGISTER_DEFINITION") data = { kind: "DEFINITION_REGISTERED", revisionId: command.revisionId, revision: command.revision, artifactHash: command.artifactHash };
  else if (command.kind === "ACTIVATE_PLAN") data = { kind: "PLAN_ACTIVATED", revisionId: command.revisionId, revision: command.revision, artifactHash: command.artifactHash, definitionRevisionId: command.definitionRevisionId };
  else if (command.kind === "ACTIVATE_OPERATIONAL") data = { kind: "OPERATIONAL_ACTIVATED", revisionId: command.revisionId, revision: command.revision, artifactHash: command.artifactHash, planRevisionId: command.planRevisionId, contests: command.contests };
  else if (command.kind === "RECORD_RESULT") data = { kind: "RESULT_RECORDED", contestId: command.contestId, entrantIds: command.entrantIds, winnerId: command.winnerId, score: command.score, reason: command.reason };
  else if (command.kind === "CORRECT_RESULT") data = { kind: "RESULT_CORRECTED", contestId: command.contestId, entrantIds: command.entrantIds, winnerId: command.winnerId, score: command.score, reason: command.reason, supersedesEventId: command.supersedesEventId };
  else data = { kind: "RESULT_VOIDED", contestId: command.contestId, supersedesEventId: command.supersedesEventId, reason: command.reason };
  const base = { ...common, ...data };
  const eventId = `evt_${canonicalHash(base).slice(0, 24)}`;
  const withoutHash = { ...base, eventId };
  return deepFreeze({ ...withoutHash, eventHash: canonicalHash(withoutHash) }) as TournamentEvent;
}

export function decideTournamentCommand(state: TournamentState, command: TournamentCommand): TournamentDecision {
  const { expectedVersion: _expectedVersion, ...idempotentCommand } = command;
  const commandFingerprint = canonicalHash(idempotentCommand);
  if (state.processedCommandIds.includes(command.commandId)) {
    if (state.commandFingerprints[command.commandId] === commandFingerprint) return deepFreeze({ accepted: true as const, events: [], findings: [] });
    return deepFreeze({ accepted: false as const, events: [], findings: [{ code: "TOS409", path: "/tournamentState/commandId", message: "Command id was already used for different content.", evidence: { commandId: command.commandId } }] });
  }
  const findings: TournamentStateFinding[] = [];
  if (command.expectedVersion !== state.version) findings.push({ code: "TOS409", path: "/tournamentState/version", message: "Optimistic concurrency version does not match.", evidence: { expectedVersion: command.expectedVersion, actualVersion: state.version } });
  if (!command.commandId.trim() || !command.actorId.trim() || !Number.isFinite(Date.parse(command.recordedAt))) findings.push({ code: "TOS400", path: "/tournamentState/command", message: "Command audit metadata is incomplete or invalid." });
  if (findings.length) return deepFreeze({ accepted: false as const, events: [], findings });
  try {
    const event = makeEvent(state, command);
    void evolveTournamentState(state, event);
    return deepFreeze({ accepted: true as const, events: [event], findings: [] });
  } catch (error) {
    return deepFreeze({ accepted: false as const, events: [], findings: [findingFrom(error)] });
  }
}

export function replayTournamentEvents(tournamentId: string, events: readonly TournamentEvent[]): TournamentReplay {
  let state = createTournamentState(tournamentId);
  try {
    for (const event of events) state = evolveTournamentState(state, event);
    return deepFreeze({ valid: true as const, state, findings: [] });
  } catch (error) {
    return deepFreeze({ valid: false as const, state, findings: [findingFrom(error)] });
  }
}
