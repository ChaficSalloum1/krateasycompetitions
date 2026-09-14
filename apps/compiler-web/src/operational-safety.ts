import { canonicalHash } from "@tournament-os/tournament-schema";

export type OperationalMode = "NORMAL" | "DEGRADED" | "PAUSED" | "STOPPED" | "CANCELLED" | "RECOVERING";
export type OperationalAuthorityFunction = "INCIDENT_LEAD" | "COMPETITION_LEAD" | "SAFETY_LEAD"
  | "COMMUNICATIONS_LEAD" | "SCRIBE";
export type OperationalPublicMessageCode = "SERVICE_DEGRADED_USE_VENUE_BOARD" | "PLAY_PAUSED_STAY_CLEAR"
  | "SAFETY_STOP_FOLLOW_VENUE_INSTRUCTIONS" | "EVENT_CANCELLED_AWAIT_CONTACT"
  | "RECOVERY_IN_PROGRESS_AWAIT_UPDATE" | "PLAY_RESUMED_CHECK_NEXT";

export interface OperationalAuthorityAssignments {
  readonly incidentLead: string;
  readonly competitionLead: string;
  readonly safetyLead: string;
  readonly communicationsLead: string;
  readonly scribe: string;
}

export interface OperationalScope {
  readonly kind: "VENUE" | "RESOURCE" | "CONTEST" | "PARTICIPANT";
  readonly ids: readonly string[];
}

export interface OperationalIncident {
  readonly incidentId: string;
  readonly category: "MEDICAL" | "FIRE" | "STRUCTURAL" | "WEATHER" | "SECURITY" | "EVACUATION"
    | "SAFEGUARDING" | "SERVICE" | "RESOURCE" | "COMPETITION";
  readonly severity: "INFO" | "MINOR" | "MAJOR" | "LIFE_SAFETY";
  readonly acknowledgement: "UNVERIFIED" | "ACKNOWLEDGED";
  readonly location: string;
  readonly summary: string;
  readonly affectedContestIds: readonly string[];
  readonly affectedResourceIds: readonly string[];
  readonly affectedParticipantIds: readonly string[];
  readonly evidenceRefs: readonly string[];
  readonly recordedBy: string;
  readonly recordedAt: string;
  readonly incidentHash: string;
}

export interface OperationalRestartClearance {
  readonly kind: "SAFETY" | "COMPETITION";
  readonly actorId: string;
  readonly authorityFunction: "SAFETY_LEAD" | "COMPETITION_LEAD";
  readonly statement: string;
  readonly evidenceRefs: readonly string[];
  readonly recordedAt: string;
  readonly eventSequence: number;
}

export interface OperationalPublicStatus {
  readonly mode: OperationalMode;
  readonly stateVersion: number;
  readonly instruction: string;
  readonly effectiveAt: string | null;
  readonly nextUpdateAt?: string;
  readonly stateProofHash: string;
}

interface CommandBase {
  readonly commandId: string;
  readonly expectedVersion: number;
  readonly actorId: string;
  readonly authorityFunction: OperationalAuthorityFunction;
  readonly occurredAt: string;
}

export type OperationalSafetyCommand =
  | (CommandBase & { readonly kind: "RECORD_INCIDENT"; readonly incident: Omit<OperationalIncident,
      "recordedBy" | "recordedAt" | "incidentHash"> })
  | (CommandBase & { readonly kind: "TRANSITION_MODE"; readonly targetMode: OperationalMode;
      readonly reason: string; readonly sourceIncidentId?: string;
      readonly publicMessageCode: OperationalPublicMessageCode; readonly nextUpdateAt?: string;
      readonly scope: OperationalScope })
  | (CommandBase & { readonly kind: "RECORD_RESTART_CLEARANCE"; readonly clearance: "SAFETY" | "COMPETITION";
      readonly evidenceRefs: readonly string[]; readonly statement: string })
  | (CommandBase & { readonly kind: "TRANSFER_AUTHORITY"; readonly transferredFunction: OperationalAuthorityFunction;
      readonly newActorId: string; readonly reason: string; readonly evidenceRefs: readonly string[] });

export interface OperationalSafetyEvent {
  readonly eventId: string;
  readonly sequence: number;
  readonly command: OperationalSafetyCommand;
  readonly commandHash: string;
  readonly previousEventHash: string | null;
  readonly eventHash: string;
}

export interface OperationalSafetyState {
  readonly mode: OperationalMode;
  readonly version: number;
  readonly authorityAssignments: OperationalAuthorityAssignments;
  readonly incidents: readonly OperationalIncident[];
  readonly activeIncidentId: string | null;
  readonly restartClearances: {
    readonly safety?: OperationalRestartClearance;
    readonly competition?: OperationalRestartClearance;
  };
  readonly publicStatus: OperationalPublicStatus;
  readonly events: readonly OperationalSafetyEvent[];
  readonly lastEventHash: string | null;
  readonly proofHash: string;
}

export interface OperationalSafetyCommandResult {
  readonly accepted: boolean;
  readonly idempotentReplay: boolean;
  readonly state: OperationalSafetyState;
  readonly findings: readonly string[];
}

const publicInstructions: Readonly<Record<OperationalPublicMessageCode, string>> = {
  SERVICE_DEGRADED_USE_VENUE_BOARD: "A service is degraded. Follow the venue board and desk instructions.",
  PLAY_PAUSED_STAY_CLEAR: "Play is paused. Stay clear of courts and await the next update.",
  SAFETY_STOP_FOLLOW_VENUE_INSTRUCTIONS: "Play is stopped. Follow venue staff instructions and await the next update.",
  EVENT_CANCELLED_AWAIT_CONTACT: "The event is cancelled. Preserve your latest instruction and await organiser contact.",
  RECOVERY_IN_PROGRESS_AWAIT_UPDATE: "Recovery checks are in progress. Do not resume play until an authorised update.",
  PLAY_RESUMED_CHECK_NEXT: "Play is authorised to resume. Check your current next instruction before reporting.",
};

const messageForMode: Readonly<Record<OperationalMode, OperationalPublicMessageCode>> = {
  NORMAL: "PLAY_RESUMED_CHECK_NEXT",
  DEGRADED: "SERVICE_DEGRADED_USE_VENUE_BOARD",
  PAUSED: "PLAY_PAUSED_STAY_CLEAR",
  STOPPED: "SAFETY_STOP_FOLLOW_VENUE_INSTRUCTIONS",
  CANCELLED: "EVENT_CANCELLED_AWAIT_CONTACT",
  RECOVERING: "RECOVERY_IN_PROGRESS_AWAIT_UPDATE",
};

const authorityKey: Readonly<Record<OperationalAuthorityFunction, keyof OperationalAuthorityAssignments>> = {
  INCIDENT_LEAD: "incidentLead", COMPETITION_LEAD: "competitionLead", SAFETY_LEAD: "safetyLead",
  COMMUNICATIONS_LEAD: "communicationsLead", SCRIBE: "scribe",
};

function canonicalTimestamp(value: string): boolean {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function validText(value: string, maximum = 500): boolean {
  return value.trim().length > 0 && value === value.trim() && value.length <= maximum;
}

function sortedUnique(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort();
}

function normalizeCommand(command: OperationalSafetyCommand): OperationalSafetyCommand {
  if (command.kind === "RECORD_INCIDENT") return { ...command, incident: { ...command.incident,
    affectedContestIds: sortedUnique(command.incident.affectedContestIds),
    affectedResourceIds: sortedUnique(command.incident.affectedResourceIds),
    affectedParticipantIds: sortedUnique(command.incident.affectedParticipantIds),
    evidenceRefs: sortedUnique(command.incident.evidenceRefs) } };
  if (command.kind === "TRANSITION_MODE") return { ...command,
    scope: { ...command.scope, ids: sortedUnique(command.scope.ids) } };
  if (command.kind === "RECORD_RESTART_CLEARANCE") return { ...command,
    evidenceRefs: sortedUnique(command.evidenceRefs) };
  return { ...command, evidenceRefs: sortedUnique(command.evidenceRefs) };
}

function bodyWithoutProof(state: Omit<OperationalSafetyState, "proofHash">): Omit<OperationalSafetyState, "proofHash"> {
  return state;
}

function sealState(state: Omit<OperationalSafetyState, "proofHash" | "publicStatus"> & {
  readonly publicStatus: Omit<OperationalPublicStatus, "stateProofHash"> }): OperationalSafetyState {
  const proofHash = canonicalHash(bodyWithoutProof({ ...state,
    publicStatus: { ...state.publicStatus, stateProofHash: "" } } as Omit<OperationalSafetyState, "proofHash">));
  return { ...state, publicStatus: { ...state.publicStatus, stateProofHash: proofHash }, proofHash };
}

function validAuthority(assignments: OperationalAuthorityAssignments): boolean {
  return Object.values(assignments).every((actorId) => validText(actorId, 160));
}

export function createOperationalSafetyState(authorityAssignments: OperationalAuthorityAssignments): OperationalSafetyState {
  if (!validAuthority(authorityAssignments)) throw new Error("invalid_operational_authority_assignments");
  return sealState({ mode: "NORMAL", version: 0, authorityAssignments: { ...authorityAssignments }, incidents: [],
    activeIncidentId: null, restartClearances: {}, events: [], lastEventHash: null,
    publicStatus: { mode: "NORMAL", stateVersion: 0, instruction: "Competition operating normally.", effectiveAt: null } });
}

function reject(state: OperationalSafetyState, ...findings: string[]): OperationalSafetyCommandResult {
  return { accepted: false, idempotentReplay: false, state, findings };
}

function requiredTransitionAuthority(state: OperationalSafetyState, target: OperationalMode): readonly OperationalAuthorityFunction[] {
  if (target === "STOPPED") return ["SAFETY_LEAD", "INCIDENT_LEAD"];
  if (target === "CANCELLED" || target === "RECOVERING" || (target === "NORMAL" && state.mode === "RECOVERING"))
    return ["INCIDENT_LEAD"];
  if (target === "PAUSED") return ["COMPETITION_LEAD", "SAFETY_LEAD", "INCIDENT_LEAD"];
  return ["COMPETITION_LEAD", "INCIDENT_LEAD"];
}

const allowedTransitions: Readonly<Record<OperationalMode, readonly OperationalMode[]>> = {
  NORMAL: ["DEGRADED", "PAUSED", "STOPPED", "CANCELLED"],
  DEGRADED: ["NORMAL", "PAUSED", "STOPPED", "CANCELLED"],
  PAUSED: ["NORMAL", "STOPPED", "CANCELLED"],
  STOPPED: ["RECOVERING", "CANCELLED"],
  RECOVERING: ["NORMAL", "STOPPED", "CANCELLED"],
  CANCELLED: [],
};

function validateCommon(state: OperationalSafetyState, command: OperationalSafetyCommand): readonly string[] {
  const findings: string[] = [];
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(command.commandId)) findings.push("INVALID_COMMAND_ID");
  if (!Number.isSafeInteger(command.expectedVersion) || command.expectedVersion !== state.version) findings.push("STALE_STATE_VERSION");
  if (!canonicalTimestamp(command.occurredAt)
    || (state.events.at(-1) && command.occurredAt < state.events.at(-1)!.command.occurredAt)) findings.push("INVALID_EVENT_TIME");
  const assignedActor = state.authorityAssignments[authorityKey[command.authorityFunction]];
  if (command.actorId !== assignedActor) findings.push("AUTHORITY_ACTOR_MISMATCH");
  return findings;
}

function validateSpecific(state: OperationalSafetyState, command: OperationalSafetyCommand): readonly string[] {
  const findings: string[] = [];
  if (command.kind === "RECORD_INCIDENT") {
    if (command.authorityFunction !== "SCRIBE" && command.authorityFunction !== "INCIDENT_LEAD")
      findings.push("INCIDENT_RECORD_REQUIRES_SCRIBE");
    const incident = command.incident;
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(incident.incidentId)
      || state.incidents.some(({ incidentId }) => incidentId === incident.incidentId)) findings.push("INCIDENT_ID_CONFLICT");
    if (!validText(incident.location, 240) || !validText(incident.summary, 1_000)) findings.push("INVALID_INCIDENT_DETAIL");
    if ([...incident.affectedContestIds, ...incident.affectedResourceIds, ...incident.affectedParticipantIds,
      ...incident.evidenceRefs].some((value) => !validText(value, 240))) findings.push("INVALID_INCIDENT_SCOPE");
  } else if (command.kind === "TRANSITION_MODE") {
    if (!allowedTransitions[state.mode].includes(command.targetMode)) findings.push("INVALID_MODE_TRANSITION");
    if (!requiredTransitionAuthority(state, command.targetMode).includes(command.authorityFunction))
      findings.push("MODE_TRANSITION_AUTHORITY_MISMATCH");
    if (messageForMode[command.targetMode] !== command.publicMessageCode) findings.push("PUBLIC_MESSAGE_NOT_APPROVED");
    if (!validText(command.reason, 500) || command.scope.ids.length === 0
      || command.scope.ids.some((value) => !validText(value, 160))) findings.push("INVALID_TRANSITION_DETAIL");
    if (command.sourceIncidentId && !state.incidents.some(({ incidentId }) => incidentId === command.sourceIncidentId))
      findings.push("INCIDENT_NOT_FOUND");
    const needsUpdateTime = ["PAUSED", "STOPPED", "RECOVERING"].includes(command.targetMode);
    if (needsUpdateTime && (!command.nextUpdateAt || !canonicalTimestamp(command.nextUpdateAt)
      || command.nextUpdateAt <= command.occurredAt)) findings.push("NEXT_UPDATE_TIME_REQUIRED");
    if (!needsUpdateTime && command.nextUpdateAt) findings.push("UNEXPECTED_NEXT_UPDATE_TIME");
    const hasClearance = Boolean(state.restartClearances.safety && state.restartClearances.competition);
    if ((command.targetMode === "RECOVERING" || (state.mode === "RECOVERING" && command.targetMode === "NORMAL"))
      && !hasClearance) findings.push("RESTART_CLEARANCE_REQUIRED");
  } else if (command.kind === "RECORD_RESTART_CLEARANCE") {
    if (!["STOPPED", "RECOVERING"].includes(state.mode)) findings.push("RESTART_CLEARANCE_NOT_ALLOWED");
    const expectedFunction = command.clearance === "SAFETY" ? "SAFETY_LEAD" : "COMPETITION_LEAD";
    if (command.authorityFunction !== expectedFunction) findings.push("RESTART_CLEARANCE_AUTHORITY_MISMATCH");
    if (!validText(command.statement, 500) || command.evidenceRefs.length === 0
      || command.evidenceRefs.some((value) => !validText(value, 240))) findings.push("RESTART_EVIDENCE_REQUIRED");
  } else {
    if (command.authorityFunction !== command.transferredFunction) findings.push("TRANSFER_AUTHORITY_MISMATCH");
    if (!validText(command.newActorId, 160) || command.newActorId === command.actorId || !validText(command.reason, 500)
      || command.evidenceRefs.length === 0 || command.evidenceRefs.some((value) => !validText(value, 240)))
      findings.push("INVALID_AUTHORITY_TRANSFER");
  }
  return findings;
}

function projectEvent(state: OperationalSafetyState, event: OperationalSafetyEvent): OperationalSafetyState {
  const command = event.command;
  let mode = state.mode;
  let authorityAssignments = state.authorityAssignments;
  let incidents = state.incidents;
  let activeIncidentId = state.activeIncidentId;
  let restartClearances = state.restartClearances;
  let publicStatus: Omit<OperationalPublicStatus, "stateProofHash"> = {
    ...state.publicStatus, stateVersion: event.sequence,
  };
  if (command.kind === "RECORD_INCIDENT") {
    const body = { ...command.incident, recordedBy: command.actorId, recordedAt: command.occurredAt };
    incidents = [...incidents, { ...body, incidentHash: canonicalHash(body) }];
  } else if (command.kind === "TRANSITION_MODE") {
    mode = command.targetMode;
    activeIncidentId = command.sourceIncidentId ?? (command.targetMode === "NORMAL" ? null : activeIncidentId);
    if (command.targetMode === "STOPPED") restartClearances = {};
    publicStatus = { mode, stateVersion: event.sequence, instruction: publicInstructions[command.publicMessageCode],
      effectiveAt: command.occurredAt, ...(command.nextUpdateAt ? { nextUpdateAt: command.nextUpdateAt } : {}) };
  } else if (command.kind === "RECORD_RESTART_CLEARANCE") {
    const clearance: OperationalRestartClearance = { kind: command.clearance, actorId: command.actorId,
      authorityFunction: command.authorityFunction as "SAFETY_LEAD" | "COMPETITION_LEAD",
      statement: command.statement, evidenceRefs: command.evidenceRefs, recordedAt: command.occurredAt,
      eventSequence: event.sequence };
    restartClearances = command.clearance === "SAFETY" ? { ...restartClearances, safety: clearance }
      : { ...restartClearances, competition: clearance };
  } else {
    authorityAssignments = { ...authorityAssignments, [authorityKey[command.transferredFunction]]: command.newActorId };
  }
  return sealState({ mode, version: event.sequence, authorityAssignments, incidents, activeIncidentId,
    restartClearances, publicStatus, events: [...state.events, event], lastEventHash: event.eventHash });
}

export function submitOperationalSafetyCommand(state: OperationalSafetyState,
  suppliedCommand: OperationalSafetyCommand): OperationalSafetyCommandResult {
  const command = normalizeCommand(suppliedCommand);
  const commandHash = canonicalHash(command);
  const previous = state.events.find((event) => event.command.commandId === command.commandId);
  if (previous) return previous.commandHash === commandHash
    ? { accepted: true, idempotentReplay: true, state, findings: [] }
    : reject(state, "COMMAND_IDENTITY_CONFLICT");
  const findings = [...validateCommon(state, command), ...validateSpecific(state, command)];
  if (findings.length) return reject(state, ...[...new Set(findings)].sort());
  const eventBody = { eventId: `operations.${state.version + 1}.${commandHash.slice(0, 16)}`,
    sequence: state.version + 1, command, commandHash, previousEventHash: state.lastEventHash };
  const event: OperationalSafetyEvent = { ...eventBody, eventHash: canonicalHash(eventBody) };
  return { accepted: true, idempotentReplay: false, state: projectEvent(state, event), findings: [] };
}

export function replayOperationalSafetyEvents(authorityAssignments: OperationalAuthorityAssignments,
  events: readonly OperationalSafetyEvent[]): { readonly valid: boolean; readonly state: OperationalSafetyState } {
  let state = createOperationalSafetyState(authorityAssignments);
  for (const event of events) {
    const { eventHash, ...eventBody } = event;
    if (event.sequence !== state.version + 1 || event.previousEventHash !== state.lastEventHash
      || event.commandHash !== canonicalHash(normalizeCommand(event.command)) || eventHash !== canonicalHash(eventBody))
      return { valid: false, state };
    const result = submitOperationalSafetyCommand(state, event.command);
    if (!result.accepted || result.idempotentReplay || result.state.lastEventHash !== eventHash) return { valid: false, state };
    state = result.state;
  }
  return { valid: true, state };
}

export function verifyOperationalSafetyState(state: OperationalSafetyState): boolean {
  const replay = replayOperationalSafetyEvents(state.authorityAssignments, state.events);
  return replay.valid && replay.state.proofHash === state.proofHash
    && canonicalHash(replay.state) === canonicalHash(state);
}
