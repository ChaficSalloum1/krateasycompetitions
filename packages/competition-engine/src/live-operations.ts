import { canonicalHash, deepFreeze } from "@tournament-os/tournament-schema";

export interface LiveContestDefinition {
  readonly contestId: string;
  readonly entrantIds: readonly string[];
  readonly fixedEntrantIds?: readonly [string, string];
  readonly requiresEntrantResolution?: boolean;
  readonly courtId: string;
  readonly officialId?: string;
  readonly equipmentIds?: readonly string[];
  readonly dependencyContestIds?: readonly string[];
  readonly scheduledStart: string;
  readonly scheduledEnd: string;
}

export interface LiveOperationsDefinition {
  readonly tournamentId: string;
  readonly lateToleranceMinutes?: number;
  readonly courts: readonly string[];
  readonly officials?: readonly string[];
  readonly equipment?: readonly string[];
  readonly contests: readonly LiveContestDefinition[];
}

interface CommandAudit {
  readonly commandId: string;
  readonly expectedVersion: number;
  readonly actorId: string;
  readonly occurredAt: string;
}

export type LiveOperationsCommand = CommandAudit & (
  | { readonly kind: "CHECK_IN"; readonly entrantId: string }
  | { readonly kind: "MARK_LATE"; readonly entrantId: string; readonly reason: string }
  | { readonly kind: "WITHDRAW_ENTRANT"; readonly entrantId: string; readonly reason: string }
  | { readonly kind: "DECLARE_NO_SHOW"; readonly contestId: string; readonly entrantId: string; readonly reason: string }
  | { readonly kind: "AWARD_WALKOVER"; readonly contestId: string; readonly winnerEntrantId: string; readonly absentEntrantId: string; readonly reason: string }
  | { readonly kind: "CALL_CONTEST"; readonly contestId: string }
  | { readonly kind: "START_CONTEST"; readonly contestId: string; readonly courtId: string; readonly startedAt: string }
  | { readonly kind: "RECORD_SCORE"; readonly contestId: string; readonly scores: readonly ContestScore[] }
  | { readonly kind: "COMPLETE_CONTEST"; readonly contestId: string; readonly endedAt: string }
  | { readonly kind: "RESOLVE_CONTEST_ENTRANTS"; readonly contestId: string; readonly entrantIds: readonly [string, string]; readonly sourceProofHash: string }
  | { readonly kind: "RECORD_RETIREMENT"; readonly contestId: string; readonly retiredEntrantId: string; readonly winnerEntrantId: string; readonly endedAt: string; readonly reason: string }
  | { readonly kind: "RECORD_RESULT_RECEIPT"; readonly contestId: string; readonly source: string }
  | { readonly kind: "FILE_PROTEST"; readonly protestId: string; readonly contestId: string; readonly filedById: string; readonly reason: string }
  | { readonly kind: "RESOLVE_PROTEST"; readonly protestId: string; readonly outcome: DisputeOutcome; readonly reason: string }
  | { readonly kind: "FILE_APPEAL"; readonly appealId: string; readonly protestId: string; readonly filedById: string; readonly reason: string }
  | { readonly kind: "RESOLVE_APPEAL"; readonly appealId: string; readonly outcome: DisputeOutcome; readonly reason: string }
  | { readonly kind: "CORRECT_OPERATION"; readonly supersedesEventId: string; readonly replacement: LiveOperationCorrection; readonly reason: string }
  | { readonly kind: "CLOSE_COURT"; readonly courtId: string; readonly reason: string; readonly expectedReopenAt?: string }
  | { readonly kind: "REOPEN_COURT"; readonly courtId: string; readonly reason: string }
  | { readonly kind: "MARK_OFFICIAL_ABSENT"; readonly officialId: string; readonly reason: string }
  | { readonly kind: "RESTORE_OFFICIAL"; readonly officialId: string; readonly reason: string }
  | { readonly kind: "REPORT_EQUIPMENT_FAILURE"; readonly equipmentId: string; readonly reason: string }
  | { readonly kind: "RESTORE_EQUIPMENT"; readonly equipmentId: string; readonly reason: string }
);

export type EntrantPresenceStatus = "CHECKED_IN" | "LATE" | "NO_SHOW" | "WITHDRAWN";
export type LiveContestStatus = "SCHEDULED" | "IN_PROGRESS" | "COMPLETED" | "WALKOVER" | "RETIRED";

export interface LiveContestState {
  readonly status: LiveContestStatus;
  readonly calledAt?: string;
  readonly scores?: readonly ContestScore[];
  readonly winnerEntrantId?: string;
  readonly absentEntrantId?: string;
  readonly retiredEntrantId?: string;
  readonly actualCourtId?: string;
  readonly actualStart?: string;
  readonly actualEnd?: string;
  readonly actualDurationMinutes?: number;
  readonly resultRecordedAt?: string;
}

export interface ContestScore {
  readonly entrantId: string;
  readonly value: number;
}

export interface ResourceAvailability {
  readonly available: boolean;
  readonly changedAt: string | null;
  readonly reason: string | null;
  readonly expectedAvailableAt?: string;
}

export type DisputeOutcome = "UPHELD" | "DENIED";

export interface ProtestState {
  readonly protestId: string;
  readonly contestId: string;
  readonly filedById: string;
  readonly reason: string;
  readonly status: "PENDING" | DisputeOutcome;
  readonly resolutionReason?: string;
}

export interface AppealState {
  readonly appealId: string;
  readonly protestId: string;
  readonly filedById: string;
  readonly reason: string;
  readonly status: "PENDING" | DisputeOutcome;
  readonly resolutionReason?: string;
}

export type LiveOperationCorrection =
  | { readonly kind: "SET_ENTRANT_PRESENCE"; readonly entrantId: string; readonly status: EntrantPresenceStatus; readonly reason: string }
  | { readonly kind: "SET_CONTEST_TIMING"; readonly contestId: string; readonly actualStart: string; readonly actualEnd?: string; readonly reason: string }
  | { readonly kind: "SET_CONTEST_SCORE"; readonly contestId: string; readonly scores: readonly ContestScore[]; readonly reason: string }
  | { readonly kind: "SET_RESOURCE_AVAILABILITY"; readonly resourceKind: "COURT" | "OFFICIAL" | "EQUIPMENT"; readonly resourceId: string; readonly available: boolean; readonly reason: string; readonly expectedAvailableAt?: string };

interface LiveOperationsEventAudit {
  readonly eventId: string;
  readonly eventHash: string;
  readonly previousEventHash: string | null;
  readonly sequence: number;
  readonly tournamentId: string;
  readonly commandId: string;
  readonly commandFingerprint: string;
  readonly actorId: string;
  readonly occurredAt: string;
}

type LiveOperationsEventData =
  | { readonly kind: "ENTRANT_CHECKED_IN"; readonly entrantId: string }
  | { readonly kind: "ENTRANT_MARKED_LATE"; readonly entrantId: string; readonly reason: string }
  | { readonly kind: "ENTRANT_WITHDRAWN"; readonly entrantId: string; readonly reason: string }
  | { readonly kind: "ENTRANT_DECLARED_NO_SHOW"; readonly contestId: string; readonly entrantId: string; readonly reason: string }
  | { readonly kind: "WALKOVER_AWARDED"; readonly contestId: string; readonly winnerEntrantId: string; readonly absentEntrantId: string; readonly reason: string }
  | { readonly kind: "CONTEST_CALLED"; readonly contestId: string }
  | { readonly kind: "CONTEST_STARTED"; readonly contestId: string; readonly courtId: string; readonly startedAt: string }
  | { readonly kind: "SCORE_RECORDED"; readonly contestId: string; readonly scores: readonly ContestScore[] }
  | { readonly kind: "CONTEST_COMPLETED"; readonly contestId: string; readonly endedAt: string }
  | { readonly kind: "CONTEST_ENTRANTS_RESOLVED"; readonly contestId: string; readonly entrantIds: readonly [string, string]; readonly sourceProofHash: string }
  | { readonly kind: "RETIREMENT_RECORDED"; readonly contestId: string; readonly retiredEntrantId: string; readonly winnerEntrantId: string; readonly endedAt: string; readonly reason: string }
  | { readonly kind: "RESULT_RECEIVED"; readonly contestId: string; readonly source: string }
  | { readonly kind: "PROTEST_FILED"; readonly protestId: string; readonly contestId: string; readonly filedById: string; readonly reason: string }
  | { readonly kind: "PROTEST_RESOLVED"; readonly protestId: string; readonly outcome: DisputeOutcome; readonly reason: string }
  | { readonly kind: "APPEAL_FILED"; readonly appealId: string; readonly protestId: string; readonly filedById: string; readonly reason: string }
  | { readonly kind: "APPEAL_RESOLVED"; readonly appealId: string; readonly outcome: DisputeOutcome; readonly reason: string }
  | { readonly kind: "OPERATION_CORRECTED"; readonly supersedesEventId: string; readonly replacement: LiveOperationCorrection; readonly reason: string }
  | { readonly kind: "RESOURCE_AVAILABILITY_CHANGED"; readonly resourceKind: "COURT" | "OFFICIAL" | "EQUIPMENT"; readonly resourceId: string; readonly available: boolean; readonly reason: string; readonly expectedAvailableAt?: string };

export type LiveOperationsEvent = LiveOperationsEventAudit & LiveOperationsEventData;

export interface LiveOperationsFinding {
  readonly code: string;
  readonly path: string;
  readonly message: string;
  readonly evidence?: Readonly<Record<string, unknown>>;
}

export interface LiveOperationsState {
  readonly definition: Readonly<LiveOperationsDefinition>;
  readonly version: number;
  readonly lastEventHash: string | null;
  readonly events: readonly Readonly<LiveOperationsEvent>[];
  readonly entrantPresence: Readonly<Record<string, EntrantPresenceStatus>>;
  readonly contests: Readonly<Record<string, Readonly<LiveContestState>>>;
  readonly resolvedEntrants: Readonly<Record<string, readonly string[]>>;
  readonly resources: {
    readonly courts: Readonly<Record<string, Readonly<ResourceAvailability>>>;
    readonly officials: Readonly<Record<string, Readonly<ResourceAvailability>>>;
    readonly equipment: Readonly<Record<string, Readonly<ResourceAvailability>>>;
  };
  readonly protests: Readonly<Record<string, Readonly<ProtestState>>>;
  readonly appeals: Readonly<Record<string, Readonly<AppealState>>>;
  readonly commandFingerprints: Readonly<Record<string, string>>;
  readonly proofHash: string;
}

export interface LiveControlRoomContest {
  readonly contestId: string;
  readonly scheduledStart: string;
  readonly courtId: string;
}

export interface LiveControlRoomLateContest extends LiveControlRoomContest {
  readonly minutesLate: number;
}

export interface LiveControlRoomBlockedContest extends LiveControlRoomContest {
  readonly reasons: readonly { readonly code: "PENDING_PREDECESSOR" | "ENTRANT_NOT_CHECKED_IN" | "ENTRANT_NO_SHOW" | "ENTRANT_WITHDRAWN" | "COURT_CLOSED" | "OFFICIAL_ABSENT" | "EQUIPMENT_FAILED" | "PROTEST_PENDING" | "APPEAL_PENDING"; readonly subjectIds: readonly string[] }[];
}

export interface LiveControlRoomView {
  readonly generatedAt: string;
  readonly version: number;
  readonly now: readonly LiveControlRoomContest[];
  readonly next: readonly LiveControlRoomContest[];
  readonly late: readonly LiveControlRoomLateContest[];
  readonly blocked: readonly LiveControlRoomBlockedContest[];
  readonly unreported: readonly LiveControlRoomContest[];
}

export type LiveOperationsResult =
  | { readonly accepted: true; readonly idempotentReplay: boolean; readonly state: LiveOperationsState; readonly events: readonly LiveOperationsEvent[]; readonly findings: readonly [] }
  | { readonly accepted: false; readonly idempotentReplay: false; readonly state: LiveOperationsState; readonly events: readonly []; readonly findings: readonly LiveOperationsFinding[] };

export type LiveOperationsReplay =
  | { readonly valid: true; readonly state: LiveOperationsState; readonly findings: readonly [] }
  | { readonly valid: false; readonly state: LiveOperationsState; readonly findings: readonly LiveOperationsFinding[] };

const canonicalTimestamp = (value: string): boolean => {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
};

const unique = (values: readonly string[]): boolean => new Set(values).size === values.length;

function validatedDefinition(input: LiveOperationsDefinition): LiveOperationsDefinition {
  if (!input.tournamentId.trim() || input.contests.length === 0 || !unique(input.courts) || !unique(input.officials ?? []) || !unique(input.equipment ?? [])) {
    throw new Error("Live operations require a tournament, contests, and unique resource identities.");
  }
  const contestIds = input.contests.map(({ contestId }) => contestId);
  if (!unique(contestIds)) throw new Error("Live operations require unique contest identities.");
  const knownContests = new Set(contestIds);
  const knownCourts = new Set(input.courts);
  const knownOfficials = new Set(input.officials ?? []);
  const knownEquipment = new Set(input.equipment ?? []);
  for (const contest of input.contests) {
    if (!contest.contestId.trim() || contest.entrantIds.length === 0 || !unique(contest.entrantIds) || contest.entrantIds.some((id) => !id.trim())
      || (contest.fixedEntrantIds !== undefined && (contest.fixedEntrantIds.length !== 2
        || !unique(contest.fixedEntrantIds) || contest.fixedEntrantIds.some((id) => !contest.entrantIds.includes(id))))
      || !knownCourts.has(contest.courtId) || (contest.officialId !== undefined && !knownOfficials.has(contest.officialId))
      || (contest.equipmentIds ?? []).some((id) => !knownEquipment.has(id))
      || (contest.dependencyContestIds ?? []).some((id) => !knownContests.has(id) || id === contest.contestId)
      || !canonicalTimestamp(contest.scheduledStart) || !canonicalTimestamp(contest.scheduledEnd)
      || Date.parse(contest.scheduledEnd) <= Date.parse(contest.scheduledStart)) {
      throw new Error(`Invalid live contest definition: ${contest.contestId || "<missing>"}.`);
    }
  }
  const lateToleranceMinutes = input.lateToleranceMinutes ?? 5;
  if (!Number.isFinite(lateToleranceMinutes) || lateToleranceMinutes < 0) throw new Error("Late tolerance must be a non-negative number of minutes.");
  return {
    ...input,
    lateToleranceMinutes,
    officials: [...(input.officials ?? [])].sort(),
    equipment: [...(input.equipment ?? [])].sort(),
    courts: [...input.courts].sort(),
    contests: input.contests.map((contest) => ({
      ...contest,
      entrantIds: [...contest.entrantIds],
      ...(contest.fixedEntrantIds ? { fixedEntrantIds: [...contest.fixedEntrantIds].sort() as [string, string] } : {}),
      ...(contest.requiresEntrantResolution ? { requiresEntrantResolution: true } : {}),
      equipmentIds: [...(contest.equipmentIds ?? [])].sort(),
      dependencyContestIds: [...(contest.dependencyContestIds ?? [])].sort(),
    })).sort((left, right) => left.contestId.localeCompare(right.contestId)),
  };
}

function freezeState(withoutProof: Omit<LiveOperationsState, "proofHash">): LiveOperationsState {
  return deepFreeze({ ...withoutProof, proofHash: canonicalHash(withoutProof) }) as LiveOperationsState;
}

export function createLiveOperationsState(input: LiveOperationsDefinition): LiveOperationsState {
  const definition = validatedDefinition(input);
  const contests = Object.fromEntries(definition.contests.map(({ contestId }) => [contestId, { status: "SCHEDULED" as const }]));
  const resolvedEntrants = Object.fromEntries(definition.contests.flatMap(({ contestId, entrantIds, fixedEntrantIds,
    requiresEntrantResolution }) => {
    const resolved = fixedEntrantIds ?? (!requiresEntrantResolution ? entrantIds : undefined);
    return resolved ? [[contestId, [...resolved].sort()]] : [];
  }));
  const available = (ids: readonly string[]) => Object.fromEntries(ids.map((id) => [id, { available: true, changedAt: null, reason: null }]));
  const resources = { courts: available(definition.courts), officials: available(definition.officials ?? []), equipment: available(definition.equipment ?? []) };
  return freezeState({ definition, version: 0, lastEventHash: null, events: [], entrantPresence: {}, contests,
    resolvedEntrants, resources, protests: {}, appeals: {}, commandFingerprints: {} });
}

function eventData(command: LiveOperationsCommand): LiveOperationsEventData {
  if (command.kind === "CHECK_IN") return { kind: "ENTRANT_CHECKED_IN", entrantId: command.entrantId };
  if (command.kind === "MARK_LATE") return { kind: "ENTRANT_MARKED_LATE", entrantId: command.entrantId, reason: command.reason };
  if (command.kind === "WITHDRAW_ENTRANT") return { kind: "ENTRANT_WITHDRAWN", entrantId: command.entrantId, reason: command.reason };
  if (command.kind === "DECLARE_NO_SHOW") return { kind: "ENTRANT_DECLARED_NO_SHOW", contestId: command.contestId, entrantId: command.entrantId, reason: command.reason };
  if (command.kind === "AWARD_WALKOVER") return { kind: "WALKOVER_AWARDED", contestId: command.contestId, winnerEntrantId: command.winnerEntrantId, absentEntrantId: command.absentEntrantId, reason: command.reason };
  if (command.kind === "CALL_CONTEST") return { kind: "CONTEST_CALLED", contestId: command.contestId };
  if (command.kind === "START_CONTEST") return { kind: "CONTEST_STARTED", contestId: command.contestId, courtId: command.courtId, startedAt: command.startedAt };
  if (command.kind === "RECORD_SCORE") return { kind: "SCORE_RECORDED", contestId: command.contestId,
    scores: [...command.scores].sort((left, right) => left.entrantId.localeCompare(right.entrantId)) };
  if (command.kind === "COMPLETE_CONTEST") return { kind: "CONTEST_COMPLETED", contestId: command.contestId, endedAt: command.endedAt };
  if (command.kind === "RESOLVE_CONTEST_ENTRANTS") return { kind: "CONTEST_ENTRANTS_RESOLVED",
    contestId: command.contestId, entrantIds: [...command.entrantIds].sort() as [string, string],
    sourceProofHash: command.sourceProofHash };
  if (command.kind === "RECORD_RETIREMENT") return { kind: "RETIREMENT_RECORDED", contestId: command.contestId, retiredEntrantId: command.retiredEntrantId, winnerEntrantId: command.winnerEntrantId, endedAt: command.endedAt, reason: command.reason };
  if (command.kind === "RECORD_RESULT_RECEIPT") return { kind: "RESULT_RECEIVED", contestId: command.contestId, source: command.source };
  if (command.kind === "FILE_PROTEST") return { kind: "PROTEST_FILED", protestId: command.protestId, contestId: command.contestId, filedById: command.filedById, reason: command.reason };
  if (command.kind === "RESOLVE_PROTEST") return { kind: "PROTEST_RESOLVED", protestId: command.protestId, outcome: command.outcome, reason: command.reason };
  if (command.kind === "FILE_APPEAL") return { kind: "APPEAL_FILED", appealId: command.appealId, protestId: command.protestId, filedById: command.filedById, reason: command.reason };
  if (command.kind === "RESOLVE_APPEAL") return { kind: "APPEAL_RESOLVED", appealId: command.appealId, outcome: command.outcome, reason: command.reason };
  if (command.kind === "CORRECT_OPERATION") return { kind: "OPERATION_CORRECTED", supersedesEventId: command.supersedesEventId, replacement: command.replacement, reason: command.reason };
  if (command.kind === "CLOSE_COURT") return { kind: "RESOURCE_AVAILABILITY_CHANGED", resourceKind: "COURT", resourceId: command.courtId, available: false, reason: command.reason, ...(command.expectedReopenAt === undefined ? {} : { expectedAvailableAt: command.expectedReopenAt }) };
  if (command.kind === "REOPEN_COURT") return { kind: "RESOURCE_AVAILABILITY_CHANGED", resourceKind: "COURT", resourceId: command.courtId, available: true, reason: command.reason };
  if (command.kind === "MARK_OFFICIAL_ABSENT") return { kind: "RESOURCE_AVAILABILITY_CHANGED", resourceKind: "OFFICIAL", resourceId: command.officialId, available: false, reason: command.reason };
  if (command.kind === "RESTORE_OFFICIAL") return { kind: "RESOURCE_AVAILABILITY_CHANGED", resourceKind: "OFFICIAL", resourceId: command.officialId, available: true, reason: command.reason };
  if (command.kind === "REPORT_EQUIPMENT_FAILURE") return { kind: "RESOURCE_AVAILABILITY_CHANGED", resourceKind: "EQUIPMENT", resourceId: command.equipmentId, available: false, reason: command.reason };
  return { kind: "RESOURCE_AVAILABILITY_CHANGED", resourceKind: "EQUIPMENT", resourceId: command.equipmentId, available: true, reason: command.reason };
}

function resourceCommand(command: LiveOperationsCommand): { kind: "COURT" | "OFFICIAL" | "EQUIPMENT"; id: string; available: boolean; expectedAvailableAt?: string } | undefined {
  if (command.kind === "CLOSE_COURT") return { kind: "COURT", id: command.courtId, available: false, ...(command.expectedReopenAt === undefined ? {} : { expectedAvailableAt: command.expectedReopenAt }) };
  if (command.kind === "REOPEN_COURT") return { kind: "COURT", id: command.courtId, available: true };
  if (command.kind === "MARK_OFFICIAL_ABSENT") return { kind: "OFFICIAL", id: command.officialId, available: false };
  if (command.kind === "RESTORE_OFFICIAL") return { kind: "OFFICIAL", id: command.officialId, available: true };
  if (command.kind === "REPORT_EQUIPMENT_FAILURE") return { kind: "EQUIPMENT", id: command.equipmentId, available: false };
  if (command.kind === "RESTORE_EQUIPMENT") return { kind: "EQUIPMENT", id: command.equipmentId, available: true };
  return undefined;
}

function validScores(scores: readonly ContestScore[], entrantIds: readonly string[]): boolean {
  return scores.length === entrantIds.length && new Set(scores.map(({ entrantId }) => entrantId)).size === scores.length
    && scores.every(({ entrantId, value }) => entrantIds.includes(entrantId)
      && Number.isSafeInteger(value) && value >= 0);
}

function effectiveContestEntrants(state: LiveOperationsState, contest: LiveContestDefinition): readonly string[] {
  return state.resolvedEntrants[contest.contestId] ?? [];
}

function acceptedEvent(state: LiveOperationsState, command: LiveOperationsCommand, commandFingerprint: string): LiveOperationsEvent {
  const base = {
    tournamentId: state.definition.tournamentId,
    sequence: state.version + 1,
    previousEventHash: state.lastEventHash,
    commandId: command.commandId,
    commandFingerprint,
    actorId: command.actorId,
    occurredAt: command.occurredAt,
    ...eventData(command),
  };
  const eventId = `live_evt_${canonicalHash(base).slice(0, 24)}`;
  const withoutHash = { ...base, eventId };
  return deepFreeze({ ...withoutHash, eventHash: canonicalHash(withoutHash) }) as LiveOperationsEvent;
}

export function submitLiveOperationsCommand(state: LiveOperationsState, command: LiveOperationsCommand): LiveOperationsResult {
  const { expectedVersion: _expectedVersion, ...content } = command;
  const fingerprint = canonicalHash(content);
  const prior = state.commandFingerprints[command.commandId];
  if (prior !== undefined) {
    if (prior === fingerprint) return deepFreeze({ accepted: true as const, idempotentReplay: true, state, events: [], findings: [] });
    return deepFreeze({ accepted: false as const, idempotentReplay: false as const, state, events: [] as const, findings: [{ code: "LIVE409", path: "/commandId", message: "Command id was already used for different content." }] });
  }
  const findings: LiveOperationsFinding[] = [];
  if (!command.commandId.trim() || !command.actorId.trim() || !canonicalTimestamp(command.occurredAt)) findings.push({ code: "LIVE400", path: "/command", message: "Command audit metadata is incomplete or invalid." });
  if (command.expectedVersion !== state.version) findings.push({ code: "LIVE409", path: "/expectedVersion", message: "Optimistic concurrency version does not match.", evidence: { expectedVersion: command.expectedVersion, actualVersion: state.version } });
  const knownEntrants = new Set(state.definition.contests.flatMap(({ entrantIds }) => entrantIds));
  if ("entrantId" in command && !knownEntrants.has(command.entrantId)) findings.push({ code: "LIVE404", path: "/entrantId", message: "Entrant is not registered in the operational definition." });
  if ("reason" in command && !command.reason.trim()) findings.push({ code: "LIVE400", path: "/reason", message: "An audited operational reason is required." });
  const requestedResource = resourceCommand(command);
  if (requestedResource) {
    const resourceMap = requestedResource.kind === "COURT" ? state.resources.courts : requestedResource.kind === "OFFICIAL" ? state.resources.officials : state.resources.equipment;
    const current = resourceMap[requestedResource.id];
    if (!current) findings.push({ code: "LIVE404", path: "/resourceId", message: "Resource is not registered in the operational definition." });
    else if (current.available === requestedResource.available) findings.push({ code: "LIVE422", path: "/resourceId", message: "Resource is already in the requested availability state." });
    if (requestedResource.expectedAvailableAt !== undefined && (!canonicalTimestamp(requestedResource.expectedAvailableAt) || Date.parse(requestedResource.expectedAvailableAt) < Date.parse(command.occurredAt))) findings.push({ code: "LIVE400", path: "/expectedReopenAt", message: "Expected availability must be a canonical timestamp at or after the command time." });
  }
  if ("contestId" in command) {
    const contest = state.definition.contests.find(({ contestId }) => contestId === command.contestId);
    if (!contest) findings.push({ code: "LIVE404", path: "/contestId", message: "Contest is not registered in the operational definition." });
    else if (command.kind === "RESOLVE_CONTEST_ENTRANTS") {
      if (state.contests[command.contestId]?.status !== "SCHEDULED" || state.contests[command.contestId]?.calledAt)
        findings.push({ code: "LIVE422", path: "/contestId", message: "Entrant identity can only resolve while a contest is untouched and scheduled." });
      if (command.entrantIds.length !== 2 || new Set(command.entrantIds).size !== 2
        || command.entrantIds.some((entrantId) => !contest.entrantIds.includes(entrantId)))
        findings.push({ code: "LIVE422", path: "/entrantIds", message: "Resolved entrants must be two distinct members of the published possible-entrant set." });
      if (!/^[a-f0-9]{64}$/.test(command.sourceProofHash))
        findings.push({ code: "LIVE400", path: "/sourceProofHash", message: "Entrant resolution requires a canonical source proof hash." });
    } else if (contest.requiresEntrantResolution && !state.resolvedEntrants[contest.contestId]) {
      findings.push({ code: "LIVE425", path: "/contestId", message: "The actual contest entrants are not yet resolved from authoritative results." });
    } else if (command.kind === "DECLARE_NO_SHOW" && !effectiveContestEntrants(state, contest).includes(command.entrantId)) findings.push({ code: "LIVE422", path: "/entrantId", message: "No-show entrant is not registered in the contest." });
    else if (command.kind === "AWARD_WALKOVER") {
      const entrantIds = effectiveContestEntrants(state, contest);
      if (state.contests[command.contestId]?.status !== "SCHEDULED") findings.push({ code: "LIVE422", path: "/contestId", message: "Walkover can only settle a scheduled contest." });
      if (command.winnerEntrantId === command.absentEntrantId || !entrantIds.includes(command.winnerEntrantId) || !entrantIds.includes(command.absentEntrantId)) findings.push({ code: "LIVE422", path: "/winnerEntrantId", message: "Walkover winner and absent entrant must be distinct registered contest entrants." });
      if (state.entrantPresence[command.absentEntrantId] !== "NO_SHOW" && state.entrantPresence[command.absentEntrantId] !== "WITHDRAWN") findings.push({ code: "LIVE422", path: "/absentEntrantId", message: "A walkover requires an established no-show or withdrawal fact." });
    } else if (command.kind === "CALL_CONTEST") {
      const contestState = state.contests[command.contestId];
      if (contestState?.status !== "SCHEDULED" || contestState.calledAt)
        findings.push({ code: "LIVE422", path: "/contestId", message: "Only an uncalled scheduled contest can be called." });
    } else if (command.kind === "START_CONTEST") {
      const contestState = state.contests[command.contestId];
      const missing = effectiveContestEntrants(state, contest).filter((id) => state.entrantPresence[id] !== "CHECKED_IN" && state.entrantPresence[id] !== "LATE");
      const terminal = new Set<LiveContestStatus>(["COMPLETED", "WALKOVER", "RETIRED"]);
      const pendingDependencies = (contest.dependencyContestIds ?? []).filter((id) => !terminal.has(state.contests[id]?.status ?? "SCHEDULED"));
      if (contestState?.status !== "SCHEDULED") findings.push({ code: "LIVE422", path: "/contestId", message: "Only a scheduled contest can start." });
      if (!state.definition.courts.includes(command.courtId)) findings.push({ code: "LIVE404", path: "/courtId", message: "Actual court is not registered." });
      if (!canonicalTimestamp(command.startedAt)) findings.push({ code: "LIVE400", path: "/startedAt", message: "Actual start must be a canonical timestamp." });
      // Hard rules hold at live time too: a closed court stays closed until it is reopened or the
      // approved reopen time arrives, and a court holds one contest in play at a time.
      const court = state.resources.courts[command.courtId];
      if (court && !court.available && (court.expectedAvailableAt === undefined
        || !canonicalTimestamp(command.startedAt) || Date.parse(command.startedAt) < Date.parse(court.expectedAvailableAt)))
        findings.push({ code: "LIVE422", path: "/courtId", message: "The court is closed; a contest cannot start on it before it reopens.",
          evidence: { courtId: command.courtId, ...(court.expectedAvailableAt ? { expectedAvailableAt: court.expectedAvailableAt } : {}) } });
      const occupying = Object.entries(state.contests).filter(([id, other]) => id !== command.contestId
        && other.status === "IN_PROGRESS" && other.actualCourtId === command.courtId).map(([id]) => id);
      if (occupying.length) findings.push({ code: "LIVE422", path: "/courtId", message: "The court already has a contest in progress.",
        evidence: { courtId: command.courtId, contestIds: occupying } });
      if (missing.length) findings.push({ code: "LIVE422", path: "/entrantPresence", message: "All contest entrants must be checked in or marked late before start.", evidence: { entrantIds: missing } });
      if (pendingDependencies.length) findings.push({ code: "LIVE422", path: "/dependencyContestIds", message: "All predecessor contests must be settled before start.", evidence: { contestIds: pendingDependencies } });
    } else if (command.kind === "RECORD_SCORE") {
      if (state.contests[command.contestId]?.status !== "IN_PROGRESS" || !validScores(command.scores, effectiveContestEntrants(state, contest)))
        findings.push({ code: "LIVE422", path: "/scores", message: "A score requires an in-progress contest and one non-negative integer value for every entrant." });
    } else if (command.kind === "COMPLETE_CONTEST") {
      const contestState = state.contests[command.contestId];
      if (contestState?.status !== "IN_PROGRESS" || !canonicalTimestamp(command.endedAt) || !contestState.actualStart || Date.parse(command.endedAt) < Date.parse(contestState.actualStart)) {
        findings.push({ code: "LIVE422", path: "/endedAt", message: "Completion requires an in-progress contest and an end at or after its actual start." });
      }
    } else if (command.kind === "RECORD_RETIREMENT") {
      const contestState = state.contests[command.contestId];
      if (contestState?.status !== "IN_PROGRESS" || !contestState.actualStart || !canonicalTimestamp(command.endedAt) || Date.parse(command.endedAt) < Date.parse(contestState.actualStart)) findings.push({ code: "LIVE422", path: "/endedAt", message: "Retirement requires an in-progress contest and a valid actual end." });
      const entrantIds = effectiveContestEntrants(state, contest);
      if (command.retiredEntrantId === command.winnerEntrantId || !entrantIds.includes(command.retiredEntrantId) || !entrantIds.includes(command.winnerEntrantId)) findings.push({ code: "LIVE422", path: "/retiredEntrantId", message: "Retired entrant and winner must be distinct registered contest entrants." });
    } else if (command.kind === "RECORD_RESULT_RECEIPT") {
      const contestState = state.contests[command.contestId];
      if (!new Set<LiveContestStatus>(["COMPLETED", "WALKOVER", "RETIRED"]).has(contestState?.status ?? "SCHEDULED") || contestState?.resultRecordedAt) findings.push({ code: "LIVE422", path: "/contestId", message: "A result can be received once for a settled contest." });
      if (!command.source.trim()) findings.push({ code: "LIVE400", path: "/source", message: "Result receipt source is required." });
    }
  }
  if (command.kind === "FILE_PROTEST") {
    if (!command.protestId.trim() || !command.filedById.trim()) findings.push({ code: "LIVE400", path: "/protest", message: "Protest identity and filing party are required." });
    if (state.protests[command.protestId]) findings.push({ code: "LIVE409", path: "/protestId", message: "Protest identity is already registered." });
    if (!new Set<LiveContestStatus>(["COMPLETED", "WALKOVER", "RETIRED"]).has(state.contests[command.contestId]?.status ?? "SCHEDULED")) findings.push({ code: "LIVE422", path: "/contestId", message: "A protest can only target a settled contest." });
  } else if (command.kind === "RESOLVE_PROTEST") {
    if (state.protests[command.protestId]?.status !== "PENDING") findings.push({ code: "LIVE422", path: "/protestId", message: "Only a pending protest can be resolved." });
  } else if (command.kind === "FILE_APPEAL") {
    const protest = state.protests[command.protestId];
    if (!command.appealId.trim() || !command.filedById.trim()) findings.push({ code: "LIVE400", path: "/appeal", message: "Appeal identity and filing party are required." });
    if (!protest || protest.status === "PENDING") findings.push({ code: "LIVE422", path: "/protestId", message: "An appeal requires a resolved protest." });
    if (state.appeals[command.appealId] || Object.values(state.appeals).some(({ protestId }) => protestId === command.protestId)) findings.push({ code: "LIVE409", path: "/appealId", message: "An appeal is already registered for this identity or protest." });
  } else if (command.kind === "RESOLVE_APPEAL") {
    if (state.appeals[command.appealId]?.status !== "PENDING") findings.push({ code: "LIVE422", path: "/appealId", message: "Only a pending appeal can be resolved." });
  } else if (command.kind === "CORRECT_OPERATION") {
    const target = state.events.find(({ eventId }) => eventId === command.supersedesEventId);
    if (!target || target.kind === "OPERATION_CORRECTED") findings.push({ code: "LIVE422", path: "/supersedesEventId", message: "A correction must target an existing original operational event." });
    if (state.events.some((event) => event.kind === "OPERATION_CORRECTED" && event.supersedesEventId === command.supersedesEventId)) findings.push({ code: "LIVE409", path: "/supersedesEventId", message: "The operational event has already been superseded." });
    const replacement = command.replacement;
    if (!replacement.reason.trim()) findings.push({ code: "LIVE400", path: "/replacement/reason", message: "A correction replacement requires an audited reason." });
    if (replacement.kind === "SET_ENTRANT_PRESENCE" && !knownEntrants.has(replacement.entrantId)) findings.push({ code: "LIVE404", path: "/replacement/entrantId", message: "Correction entrant is not registered." });
    if (replacement.kind === "SET_CONTEST_TIMING") {
      if (!state.contests[replacement.contestId] || !canonicalTimestamp(replacement.actualStart) || (replacement.actualEnd !== undefined && (!canonicalTimestamp(replacement.actualEnd) || Date.parse(replacement.actualEnd) < Date.parse(replacement.actualStart)))) findings.push({ code: "LIVE422", path: "/replacement", message: "Corrected contest timing must target a registered contest and contain a valid interval." });
    }
    if (replacement.kind === "SET_CONTEST_SCORE") {
      const contest = state.definition.contests.find(({ contestId }) => contestId === replacement.contestId);
      if (!contest || !validScores(replacement.scores, effectiveContestEntrants(state, contest))
        || target?.kind !== "SCORE_RECORDED" || target.contestId !== replacement.contestId)
        findings.push({ code: "LIVE422", path: "/replacement", message: "A score correction must replace a score event for the same registered contest." });
    }
    if (replacement.kind === "SET_RESOURCE_AVAILABILITY") {
      const map = replacement.resourceKind === "COURT" ? state.resources.courts : replacement.resourceKind === "OFFICIAL" ? state.resources.officials : state.resources.equipment;
      if (!map[replacement.resourceId]) findings.push({ code: "LIVE404", path: "/replacement/resourceId", message: "Correction resource is not registered." });
      if (replacement.expectedAvailableAt !== undefined && !canonicalTimestamp(replacement.expectedAvailableAt)) findings.push({ code: "LIVE400", path: "/replacement/expectedAvailableAt", message: "Corrected expected availability must be a canonical timestamp." });
    }
  }
  if (findings.length) return deepFreeze({ accepted: false as const, idempotentReplay: false as const, state, events: [] as const, findings });
  const event = acceptedEvent(state, command, fingerprint);
  const next = projectLiveOperations(state.definition, [...state.events, event]);
  return deepFreeze({ accepted: true as const, idempotentReplay: false, state: next, events: [event], findings: [] });
}

function projectLiveOperations(definition: LiveOperationsDefinition, events: readonly LiveOperationsEvent[]): LiveOperationsState {
  const initial = createLiveOperationsState(definition);
  const { proofHash: _initialProofHash, ...initialWithoutProof } = initial;
  const entrantPresence: Record<string, EntrantPresenceStatus> = {};
  const contests = { ...initial.contests };
  const resolvedEntrants: Record<string, readonly string[]> = { ...initial.resolvedEntrants };
  const resources = { courts: { ...initial.resources.courts }, officials: { ...initial.resources.officials }, equipment: { ...initial.resources.equipment } };
  const protests: Record<string, ProtestState> = {};
  const appeals: Record<string, AppealState> = {};
  const commandFingerprints: Record<string, string> = {};
  const superseded = new Set(events.filter((event) => event.kind === "OPERATION_CORRECTED").map((event) => event.supersedesEventId));
  const setResource = (kind: "COURT" | "OFFICIAL" | "EQUIPMENT", id: string, available: boolean, changedAt: string, reason: string, expectedAvailableAt?: string) => {
    const value: ResourceAvailability = { available, changedAt, reason, ...(expectedAvailableAt === undefined ? {} : { expectedAvailableAt }) };
    if (kind === "COURT") resources.courts[id] = value;
    else if (kind === "OFFICIAL") resources.officials[id] = value;
    else resources.equipment[id] = value;
  };
  for (const event of events) {
    commandFingerprints[event.commandId] = event.commandFingerprint;
    if (event.kind === "OPERATION_CORRECTED") {
      const replacement = event.replacement;
      if (replacement.kind === "SET_ENTRANT_PRESENCE") entrantPresence[replacement.entrantId] = replacement.status;
      else if (replacement.kind === "SET_CONTEST_TIMING") contests[replacement.contestId] = {
        ...contests[replacement.contestId]!, status: replacement.actualEnd === undefined ? "IN_PROGRESS" : "COMPLETED", actualStart: replacement.actualStart,
        ...(replacement.actualEnd === undefined ? {} : { actualEnd: replacement.actualEnd, actualDurationMinutes: Math.round((Date.parse(replacement.actualEnd) - Date.parse(replacement.actualStart)) / 60_000) }),
      };
      else if (replacement.kind === "SET_CONTEST_SCORE") contests[replacement.contestId] = {
        ...contests[replacement.contestId]!,
        scores: [...replacement.scores].sort((left, right) => left.entrantId.localeCompare(right.entrantId)),
      };
      else setResource(replacement.resourceKind, replacement.resourceId, replacement.available, event.occurredAt, replacement.reason, replacement.expectedAvailableAt);
      continue;
    }
    if (superseded.has(event.eventId)) continue;
    if (event.kind === "ENTRANT_CHECKED_IN") entrantPresence[event.entrantId] = "CHECKED_IN";
    else if (event.kind === "ENTRANT_MARKED_LATE") entrantPresence[event.entrantId] = "LATE";
    else if (event.kind === "ENTRANT_WITHDRAWN") entrantPresence[event.entrantId] = "WITHDRAWN";
    else if (event.kind === "ENTRANT_DECLARED_NO_SHOW") entrantPresence[event.entrantId] = "NO_SHOW";
    else if (event.kind === "WALKOVER_AWARDED") contests[event.contestId] = { status: "WALKOVER", winnerEntrantId: event.winnerEntrantId, absentEntrantId: event.absentEntrantId };
    else if (event.kind === "CONTEST_CALLED") contests[event.contestId] = { ...contests[event.contestId]!, calledAt: event.occurredAt };
    else if (event.kind === "CONTEST_STARTED") contests[event.contestId] = { ...contests[event.contestId]!, status: "IN_PROGRESS", actualCourtId: event.courtId, actualStart: event.startedAt };
    else if (event.kind === "SCORE_RECORDED") contests[event.contestId] = { ...contests[event.contestId]!, scores: [...event.scores] };
    else if (event.kind === "CONTEST_COMPLETED") {
      const contest = contests[event.contestId]!;
      contests[event.contestId] = { ...contest, status: "COMPLETED", actualEnd: event.endedAt, actualDurationMinutes: Math.round((Date.parse(event.endedAt) - Date.parse(contest.actualStart!)) / 60_000) };
    } else if (event.kind === "CONTEST_ENTRANTS_RESOLVED") {
      resolvedEntrants[event.contestId] = [...event.entrantIds] as [string, string];
    } else if (event.kind === "RETIREMENT_RECORDED") {
      const contest = contests[event.contestId]!;
      contests[event.contestId] = { ...contest, status: "RETIRED", actualEnd: event.endedAt, actualDurationMinutes: Math.round((Date.parse(event.endedAt) - Date.parse(contest.actualStart!)) / 60_000), retiredEntrantId: event.retiredEntrantId, winnerEntrantId: event.winnerEntrantId };
    } else if (event.kind === "RESULT_RECEIVED") contests[event.contestId] = { ...contests[event.contestId]!, resultRecordedAt: event.occurredAt };
    else if (event.kind === "PROTEST_FILED") protests[event.protestId] = { protestId: event.protestId, contestId: event.contestId, filedById: event.filedById, reason: event.reason, status: "PENDING" };
    else if (event.kind === "PROTEST_RESOLVED") protests[event.protestId] = { ...protests[event.protestId]!, status: event.outcome, resolutionReason: event.reason };
    else if (event.kind === "APPEAL_FILED") appeals[event.appealId] = { appealId: event.appealId, protestId: event.protestId, filedById: event.filedById, reason: event.reason, status: "PENDING" };
    else if (event.kind === "APPEAL_RESOLVED") appeals[event.appealId] = { ...appeals[event.appealId]!, status: event.outcome, resolutionReason: event.reason };
    else setResource(event.resourceKind, event.resourceId, event.available, event.occurredAt, event.reason, event.expectedAvailableAt);
  }
  const last = events.at(-1);
  const withoutProof: Omit<LiveOperationsState, "proofHash"> = {
    ...initialWithoutProof,
    version: events.length,
    lastEventHash: last?.eventHash ?? null,
    events: [...events],
    entrantPresence,
    contests,
    resolvedEntrants,
    resources,
    protests,
    appeals,
    commandFingerprints,
  };
  return freezeState(withoutProof);
}

export function replayLiveOperationsEvents(definition: LiveOperationsDefinition, events: readonly LiveOperationsEvent[]): LiveOperationsReplay {
  const initial = createLiveOperationsState(definition);
  let previousHash: string | null = null;
  const commandIds = new Set<string>();
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index]!;
    const { eventId, eventHash, ...base } = event;
    const expectedId = `live_evt_${canonicalHash(base).slice(0, 24)}`;
    const expectedHash = canonicalHash({ ...base, eventId });
    if (event.tournamentId !== initial.definition.tournamentId || event.sequence !== index + 1 || event.previousEventHash !== previousHash
      || event.eventId !== expectedId || event.eventHash !== expectedHash || commandIds.has(event.commandId)
      || !event.commandId.trim() || !event.actorId.trim() || !canonicalTimestamp(event.occurredAt) || !/^[a-f0-9]{64}$/.test(event.commandFingerprint)) {
      return deepFreeze({ valid: false as const, state: initial, findings: [{ code: "LIVE401", path: `/events/${index}`, message: "Invariant firewall rejected an invalid event envelope, sequence, identity, or hash-chain link." }] });
    }
    commandIds.add(event.commandId);
    previousHash = event.eventHash;
  }
  try {
    return deepFreeze({ valid: true as const, state: projectLiveOperations(initial.definition, events), findings: [] });
  } catch (error) {
    return deepFreeze({ valid: false as const, state: initial, findings: [{ code: "LIVE422", path: "/events", message: error instanceof Error ? error.message : "Invariant firewall rejected event semantics." }] });
  }
}

export function deriveLiveControlRoom(state: LiveOperationsState, generatedAt: string): LiveControlRoomView {
  if (!canonicalTimestamp(generatedAt)) throw new Error("Control-room time must be a canonical ISO-8601 timestamp.");
  const terminalStatuses = new Set<LiveContestStatus>(["COMPLETED", "WALKOVER", "RETIRED"]);
  const completed = new Set(Object.entries(state.contests).filter(([, value]) => terminalStatuses.has(value.status)).map(([contestId]) => contestId));
  const now: LiveControlRoomContest[] = [];
  const next: LiveControlRoomContest[] = [];
  const late: LiveControlRoomLateContest[] = [];
  const blocked: LiveControlRoomBlockedContest[] = [];
  for (const contest of state.definition.contests) {
    const contestState = state.contests[contest.contestId]!;
    const entrantIds = effectiveContestEntrants(state, contest);
    const common = { contestId: contest.contestId, scheduledStart: contest.scheduledStart, courtId: contestState.actualCourtId ?? contest.courtId };
    if (contestState.status === "IN_PROGRESS") {
      now.push(common);
      continue;
    }
    if (terminalStatuses.has(contestState.status)) {
      continue;
    }
    const reasons: LiveControlRoomBlockedContest["reasons"][number][] = [];
    const pending = (contest.dependencyContestIds ?? []).filter((id) => !completed.has(id));
    if (pending.length) reasons.push({ code: "PENDING_PREDECESSOR", subjectIds: pending });
    const noShows = entrantIds.filter((id) => state.entrantPresence[id] === "NO_SHOW");
    if (noShows.length) reasons.push({ code: "ENTRANT_NO_SHOW", subjectIds: noShows });
    const withdrawn = entrantIds.filter((id) => state.entrantPresence[id] === "WITHDRAWN");
    if (withdrawn.length) reasons.push({ code: "ENTRANT_WITHDRAWN", subjectIds: withdrawn });
    const absent = entrantIds.filter((id) => state.entrantPresence[id] === undefined);
    if (absent.length) reasons.push({ code: "ENTRANT_NOT_CHECKED_IN", subjectIds: absent });
    if (state.resources.courts[contest.courtId]?.available === false) reasons.push({ code: "COURT_CLOSED", subjectIds: [contest.courtId] });
    if (contest.officialId && state.resources.officials[contest.officialId]?.available === false) reasons.push({ code: "OFFICIAL_ABSENT", subjectIds: [contest.officialId] });
    const failedEquipment = (contest.equipmentIds ?? []).filter((id) => state.resources.equipment[id]?.available === false);
    if (failedEquipment.length) reasons.push({ code: "EQUIPMENT_FAILED", subjectIds: failedEquipment });
    const dependencyIds = new Set(contest.dependencyContestIds ?? []);
    const pendingProtests = Object.values(state.protests).filter(({ contestId, status }) => dependencyIds.has(contestId) && status === "PENDING").map(({ protestId }) => protestId).sort();
    if (pendingProtests.length) reasons.push({ code: "PROTEST_PENDING", subjectIds: pendingProtests });
    const pendingAppeals = Object.values(state.appeals).filter(({ protestId, status }) => dependencyIds.has(state.protests[protestId]?.contestId ?? "") && status === "PENDING").map(({ appealId }) => appealId).sort();
    if (pendingAppeals.length) reasons.push({ code: "APPEAL_PENDING", subjectIds: pendingAppeals });
    if (reasons.length) blocked.push({ ...common, reasons });
    else {
      const minutesLate = Math.max(0, Math.floor((Date.parse(generatedAt) - Date.parse(contest.scheduledStart)) / 60_000));
      if (minutesLate > (state.definition.lateToleranceMinutes ?? 5) || entrantIds.some((id) => state.entrantPresence[id] === "LATE")) late.push({ ...common, minutesLate });
      else next.push(common);
    }
  }
  const byStart = (left: LiveControlRoomContest, right: LiveControlRoomContest) => left.scheduledStart.localeCompare(right.scheduledStart) || left.contestId.localeCompare(right.contestId);
  next.sort(byStart);
  late.sort(byStart);
  blocked.sort(byStart);
  now.sort(byStart);
  const unreported = state.definition.contests.filter(({ contestId }) => {
    const contest = state.contests[contestId];
    return contest !== undefined && terminalStatuses.has(contest.status) && contest.resultRecordedAt === undefined;
  }).map(({ contestId, scheduledStart, courtId }) => ({ contestId, scheduledStart, courtId: state.contests[contestId]?.actualCourtId ?? courtId })).sort(byStart);
  return deepFreeze({ generatedAt, version: state.version, now, next, late, blocked, unreported });
}
