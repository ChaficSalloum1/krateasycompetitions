import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  canonicalHash,
  compileDefinition,
  type TournamentDefinition,
  type TournamentSpec,
} from "@tournament-os/tournament-schema";
import { playAndKonnectDefinition } from "@tournament-os/tournament-schema/example";
import {
  type LiveOperationsCommand,
  type LiveOperationsState,
  createEntrants,
  createCompetitionGuardPreflight,
  createPublicationChangeSet,
  createPublicationCertificate,
  evaluateCompetitionGuard,
  replayLiveOperationsEvents,
  runScenario,
  solveGraphWithCpSat,
  submitLiveOperationsCommand,
  type CompetitionGraph,
  type CompetitionGuardReport,
  type CompetitionGuardPreflight,
  type Entrant,
  type PublicationChangeSet,
  type PublicationCertificate,
  type ScheduleSolution,
  type SimulationRun,
  InMemoryTransactionalOutbox,
  type OutboxDeliveryStore,
  type OutboxMessage,
  runAuthoritativeRestoreDrill,
  deriveLiveControlRoom,
} from "@tournament-os/competition-engine";
import {
  createCompetitionProposal,
  type CompetitionBlueprint,
  type CreationProposal,
  type CreationSource,
} from "./creation-proposal.js";
import { ingestCreationSource, validBase64Xlsx, validCreationSourceText } from "./creation-source-ingestion.js";
import {
  applyWorkbenchEdit,
  analyseCompetitionSources,
  planWorkbenchEdit,
  rebaseWorkbenchSources,
  recognisedCompetitionName,
  rosterFromWorkbench,
  type CompetitionWorkbenchProjection,
  type StructuredWorkbenchEdit,
  type StructuredWorkbenchEditPreview,
  type StructuredEditReview,
  workbenchSourceDocument,
  workbenchDecisionValues,
} from "./competition-workbench.js";
import { definitionFromProductionLock, entrantsFromProductionLock, isProductionLockWorkbench, participantNamesFromProductionLock,
  verifiedScheduleFromProductionLock } from "./production-lock-definition.js";
import { connectedBlueprintFindings, connectedBlueprintFromWorkbench,
  definitionFromConnectedBlueprint } from "./generic-blueprint-definition.js";
import {
  activatePublishedLiveState,
  independentlyVerifyNoShowOption,
  preservedActualTruth,
  proposeNoShowRepair,
  verifyNoShowProposal,
  type NoShowProposal,
  type NoShowProposalRequest,
  type NoShowRepairStrategy,
  type OperationalAssignment,
} from "./no-show-journey.js";
import {
  createParticipantAccessGrant,
  createParticipantRecoveryGrant,
  deriveParticipantNext,
  derivePublicLive,
  resolveParticipantAccess,
  resolveParticipantRecovery,
  type ParticipantAccess,
  type ParticipantAccessGrant,
  type ParticipantRecoveryCode,
  type ParticipantRecoveryGrant,
  type ParticipantNextProjection,
  type OrganiserLiveProjection,
  type PublicLiveProjection,
} from "./participant-information.js";
import { advanceLiveProgression, verifyLiveProgression } from "./live-progression.js";
import {
  approveCourtOutageProposal,
  authoritativeOperationalAssignments,
  proposeCourtOutageRepair,
  verifyCourtOutageProposal,
  type CourtOutageProposal,
  type CourtOutageProposalRequest,
  type DelayOverrunProposalRequest,
} from "./court-outage-journey.js";
import { signOfflineEventPack, type SignedOfflineEventPack } from "./offline-event-pack.js";
import { deriveManualFallbackPack, type ManualParticipantAccess } from "./manual-fallback-pack.js";
import {
  createOperationalSafetyState,
  submitOperationalSafetyCommand,
  verifyOperationalSafetyState,
  type OperationalAuthorityAssignments,
  type OperationalSafetyCommand,
  type OperationalSafetyState,
} from "./operational-safety.js";
import {
  createCompetitionEvidenceBundle,
  deriveCompetitionClosure,
  verifyCompetitionClosure,
  verifyCompetitionEvidenceBundle,
  type CompetitionClosure,
  type CompetitionEvidenceBundle,
} from "./competition-lifecycle.js";

export type CompetitionJourneyStatus = "NEEDS_INPUT" | "DRAFT" | "GUARD_BLOCKED" | "READY_FOR_APPROVAL" | "PUBLISHED" | "CLOSED";

interface CompiledJourneyRevision {
  readonly revision: number;
  readonly compiledBy: "competition-journey.compiler";
  readonly compiledAt: string;
  readonly spec: TournamentSpec;
  readonly graph: CompetitionGraph;
  readonly schedule: ScheduleSolution;
  readonly simulation?: SimulationRun;
  readonly guardReport: CompetitionGuardReport;
  readonly changeSet?: PublicationChangeSet;
}

interface JourneyApproval {
  readonly revision: number;
  readonly approvedBy: string;
  readonly approvedAt: string;
  readonly guardReportHash: string;
  readonly changeSetHash: string;
  readonly acknowledgedFindingCodes: readonly string[];
  readonly approvalHash: string;
}

interface JourneyPublication {
  readonly revision: number;
  readonly definitionHash: string;
  readonly guardReportHash: string;
  readonly changeSetHash: string;
  readonly certificateHash: string;
  readonly certificate: PublicationCertificate;
  readonly publishedBy: "competition-journey.publisher";
  readonly publishedAt: string;
  readonly outboxIntents: readonly [{
    readonly topic: "competition.publication.v1";
    readonly key: string;
    readonly payload: {
      readonly competitionId: string;
      readonly revision: number;
      readonly definitionHash: string;
      readonly guardReportHash: string;
      readonly changeSetHash: string;
      readonly certificateHash: string;
    };
  }];
}

export interface LiveJourneyPublication {
  readonly changeKind?: "NO_SHOW" | "COURT_OUTAGE" | "DELAY_OVERRUN";
  readonly revision: number;
  readonly baseRevision: number;
  readonly proposalHash: string;
  readonly optionHash: string;
  readonly stateProofHash: string;
  readonly stateVersion: number;
  readonly approvedBy: string;
  readonly approvedAt: string;
  readonly publishedBy: "competition-journey.live-publisher";
  readonly affectedContestIds: readonly string[];
  readonly affectedEntrantIds: readonly string[];
  readonly operationalAssignments: readonly OperationalAssignment[];
  readonly settledAsWalkoverContestIds: readonly string[];
  readonly outboxIntents: readonly {
    readonly topic: "competition.live-update.v1";
    readonly key: string;
    readonly payload: {
      readonly competitionId: string;
      readonly revision: number;
      readonly baseRevision: number;
      readonly recipientEntrantId: string;
      readonly affectedContestIds: readonly string[];
      readonly stateProofHash: string;
      readonly organizationId: string;
      readonly projection: ParticipantNextProjection;
    };
  }[];
  readonly publicationHash: string;
}

interface JourneyLiveState {
  readonly baseRevision: number;
  readonly activatedBy: string;
  readonly activatedAt: string;
  readonly state: LiveOperationsState;
  readonly operations: OperationalSafetyState;
  readonly delivery: readonly Readonly<OutboxMessage>[];
  readonly participantRevisions: Readonly<Record<string, number>>;
  readonly contestRevisions: Readonly<Record<string, number>>;
  readonly proposal?: NoShowProposal;
  readonly courtOutageProposal?: CourtOutageProposal;
  readonly publication?: LiveJourneyPublication;
  readonly publicationHistory?: readonly LiveJourneyPublication[];
}

interface JourneyDuplication {
  readonly sourceCompetitionId: string;
  readonly sourceClosureHash: string;
  readonly sourceDocumentHashes: readonly string[];
  readonly carriedDecisionIds: readonly string[];
  readonly newEditionName: string;
  readonly newEventDate: string;
  readonly duplicatedBy: string;
  readonly duplicatedAt: string;
  readonly memoryHash: string;
}

interface StoredJourneyRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly draftVersion: number;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly source: CreationSource;
  readonly sources?: readonly CreationSource[];
  readonly proposal: CreationProposal;
  readonly workbench?: CompetitionWorkbenchProjection;
  readonly supportFindings: readonly string[];
  readonly compiled?: CompiledJourneyRevision;
  readonly approval?: JourneyApproval;
  readonly publication?: JourneyPublication;
  readonly live?: JourneyLiveState;
  readonly participantAccess?: readonly ParticipantAccessGrant[];
  readonly participantRecovery?: readonly ParticipantRecoveryGrant[];
  readonly participantAccessEvents?: readonly ParticipantAccessControlEvent[];
  readonly closure?: CompetitionClosure;
  readonly duplication?: JourneyDuplication;
  readonly recordHash: string;
}

interface StoredJourneyEnvelope {
  readonly schemaVersion: "1.0.0";
  readonly records: readonly StoredJourneyRecord[];
  readonly storeHash: string;
}

export interface CompetitionJourneySnapshot {
  readonly apiVersion: "1.0";
  readonly id: string;
  readonly name: string;
  readonly draftVersion: number;
  readonly revision: number;
  readonly status: CompetitionJourneyStatus;
  readonly sourceMode: CreationSource["mode"];
  readonly blueprint: CompetitionBlueprint;
  readonly understood: readonly string[];
  readonly questions: CreationProposal["questions"];
  readonly warnings: readonly string[];
  readonly supportFindings: readonly string[];
  readonly workbench: CompetitionWorkbenchProjection;
  readonly approvalRequired: true;
  readonly assumptions: readonly {
    id: string;
    rulePath: string;
    origin: string;
    knowledge: string;
    approved: boolean;
    critical: boolean;
  }[];
  readonly requirements: TournamentSpec["requirements"];
  /**
   * J2 · Competition Design. A read-only map derived by the server from the
   * same canonical definition the compiler will consume. It is deliberately
   * not a client-editable graph DTO.
   */
  readonly structureMap: CompetitionStructureMap;
  readonly compiled: null | {
    revision: number;
    compiledAt: string;
    timezone: string;
    specHash: string;
    graphHash: string;
    scheduleHash: string;
    simulationHash: string | null;
    solverStatus: ScheduleSolution["audit"]["status"];
    actualContestCount: number;
    scheduledContestCount: number;
    guardStatus: CompetitionGuardReport["status"];
    guardReportHash: string;
    changeSet: PublicationChangeSet | null;
    changeSetHash: string | null;
    guardFindings: CompetitionGuardReport["findings"];
    guardPreflight: CompetitionGuardPreflight;
    preflightPath: string;
    requiredAcknowledgementCodes: readonly string[];
    schedule: readonly {
      contestId: string;
      resourceId: string;
      start: string;
      end: string;
    }[];
  };
  readonly approval: JourneyApproval | null;
  readonly publication: JourneyPublication | null;
  readonly live: JourneyLiveState | null;
  readonly closure: CompetitionClosure | null;
  readonly duplication: JourneyDuplication | null;
  readonly webPath: string;
}

export interface CompetitionStructureMap {
  readonly definitionAvailable: boolean;
  readonly nodes: readonly {
    readonly id: string;
    readonly label: string;
    readonly kind: "POOL" | "PLAY_IN" | "CUP" | "BRACKET" | "OTHER";
    readonly expectedEntrants: number | null;
    readonly poolCount: number | null;
    readonly poolSizes: readonly number[];
  }[];
  readonly edges: readonly {
    readonly id: string;
    readonly sourceStageId: string;
    readonly destinationStructureId: string;
    readonly destinationStageIds: readonly string[];
    readonly outputCount: number;
    readonly selectorSummary: string;
    readonly normalization: string | null;
    readonly warnings: readonly {
      readonly code: "INVALID_EDGE" | "INCOMPLETE_EDGE" | "CONSEQUENTIAL_EDGE";
      readonly message: string;
    }[];
  }[];
  readonly unavailableReason: string | null;
}

export interface CompetitionJourneyOptions {
  readonly storagePath?: string;
  readonly now?: () => string;
  readonly organizationId?: string;
  readonly participantTokenSecret?: string;
  readonly participantTokenKeys?: Readonly<Record<string, string>>;
  readonly participantTokenKeyVersion?: string;
  readonly offlinePackSigningSeedHex?: string;
  readonly operationalAuthorityAssignments?: OperationalAuthorityAssignments;
  readonly solverPythonExecutable?: string;
}

interface ParticipantAccessControlEvent {
  readonly sequence: number;
  readonly previousEventHash: string | null;
  readonly commandId: string;
  readonly requestHash: string;
  readonly kind: "ROTATED" | "REVOKED" | "RECOVERY_ISSUED";
  readonly participantId: string;
  readonly actorId: string;
  readonly occurredAt: string;
  readonly affectedCredentialHashes: readonly string[];
  readonly resultCredentialHash?: string;
  readonly eventHash: string;
}

const exactAcknowledgements = (left: readonly string[], right: readonly string[]): boolean =>
  canonicalHash([...new Set(left)].sort()) === canonicalHash([...new Set(right)].sort());

function supportedMilestoneFindings(blueprint: CompetitionBlueprint): string[] {
  const findings: string[] = [];
  if (blueprint.sport !== "padel") findings.push("This milestone compiles the validated Play & Konnect padel envelope only.");
  if (blueprint.participantUnit !== "pairs" || blueprint.participantCount !== 47)
    findings.push("This milestone requires exactly 47 pairs split by the approved 11/17/19 division template.");
  if (blueprint.resourceCount !== 7 || !["court", "courts"].includes(blueprint.resourceLabel ?? "courts"))
    findings.push("This milestone requires seven courts.");
  if (blueprint.format !== "pools_to_knockout" || blueprint.poolSize !== 4 || blueprint.qualifiersPerPool !== 1)
    findings.push("This milestone requires the approved mixed 3/4-pair pools-to-knockout template, entered as pool size 4 and one qualifier per pool.");
  if (blueprint.minimumRestMinutes !== 0)
    findings.push("This milestone has no mandatory rest; preferred recovery remains an explicit soft rule in the compiled specification.");
  if (blueprint.matchDurationMinutes !== 30)
    findings.push("This milestone requires the approved 30-minute standard slot; featured semi-finals and finals retain their explicit longer durations.");
  return [...new Set(findings)].sort();
}

function connectedJourneyFindings(blueprint: CompetitionBlueprint): string[] {
  return blueprint.format === "pools_to_knockout"
    ? supportedMilestoneFindings(blueprint) : [...connectedBlueprintFindings(blueprint)];
}

function findingsForWorkbench(workbench: CompetitionWorkbenchProjection, blueprint: CompetitionBlueprint): string[] {
  return isProductionLockWorkbench(workbench) ? [] : connectedJourneyFindings(blueprint);
}

function makeRecordHash(record: Omit<StoredJourneyRecord, "recordHash">): string {
  return canonicalHash(record);
}

function sealRecord(record: Omit<StoredJourneyRecord, "recordHash">): StoredJourneyRecord {
  return { ...record, recordHash: makeRecordHash(record) };
}

function closureAuthority(record: StoredJourneyRecord): CompetitionClosure["authority"] | null {
  if (!record.compiled || !record.compiled.changeSet || !record.publication || !record.live) return null;
  return {
    specificationHash: canonicalHash(record.compiled.spec),
    graphHash: canonicalHash(record.compiled.graph),
    scheduleHash: canonicalHash(record.compiled.schedule),
    simulationHash: record.compiled.simulation ? canonicalHash(record.compiled.simulation) : null,
    guardReportHash: record.compiled.guardReport.reportHash,
    publicationChangeSetHash: record.compiled.changeSet.changeSetHash,
    publicationCertificateHash: record.publication.certificateHash,
    operationalPublicationHash: record.live.publication?.publicationHash ?? null,
    liveStateProofHash: record.live.state.proofHash,
    operationalStateProofHash: record.live.operations.proofHash,
    sourceDocumentsHash: canonicalHash(record.workbench?.sources ?? []),
  };
}

function evidenceBundleForRecord(record: StoredJourneyRecord): CompetitionEvidenceBundle {
  if (!record.closure || !record.compiled || !record.compiled.changeSet || !record.approval || !record.publication || !record.live)
    throw new Error("competition_closure_mismatch");
  return createCompetitionEvidenceBundle({
    name: recognisedCompetitionName(record.workbench!) ?? record.proposal.blueprint.name ?? "Competition",
    closure: record.closure, sources: record.workbench?.sources ?? [], spec: record.compiled.spec,
    graph: record.compiled.graph, schedule: record.compiled.schedule,
    ...(record.compiled.simulation ? { simulation: record.compiled.simulation } : {}),
    guardReport: record.compiled.guardReport, changeSet: record.compiled.changeSet,
    approval: record.approval, publication: record.publication,
    operationalPublications: record.live.publicationHistory ?? [], live: record.live.state,
    operations: record.live.operations, authoritativeRecord: record, recordHash: record.recordHash,
  });
}

function genericSourceRoster(record: StoredJourneyRecord) {
  if (!record.workbench) return null;
  const sources = record.sources ?? [record.source];
  const ingestions = sources.map(ingestCreationSource);
  if (ingestions.some(({ status }) => status !== "ACCEPTED")) return null;
  const sourceRosters = ingestions.map(({ entrants }) => entrants).filter(({ length }) => length > 0);
  const roster = sourceRosters[0]; const projected = rosterFromWorkbench(record.workbench);
  if (!roster || !projected || sourceRosters.some((candidate) => canonicalHash(candidate) !== canonicalHash(roster))
    || canonicalHash(projected) !== canonicalHash(roster)
    || roster.length !== record.proposal.blueprint.participantCount
    || roster.some(({ divisionId, memberIds }) => divisionId !== "open" || memberIds.length !== 2)) return null;
  const suppliedSeeds = roster.flatMap(({ seed }) => seed === undefined ? [] : [seed]);
  if (suppliedSeeds.length > 0 && (suppliedSeeds.length !== roster.length
    || canonicalHash([...suppliedSeeds].sort((left, right) => left - right))
      !== canonicalHash(Array.from({ length: roster.length }, (_, index) => index + 1)))) return null;
  return roster;
}

function genericRosterEntrants(record: StoredJourneyRecord): Record<string, Entrant[]> | null {
  const roster = genericSourceRoster(record);
  if (!roster) return null;
  const ordered = roster.every(({ seed }) => seed !== undefined)
    ? [...roster].sort((left, right) => left.seed! - right.seed!) : [...roster];
  const entrants = ordered.map(({ id, divisionId, memberIds, seed }, index) => ({ id, divisionId,
    memberIds: [...memberIds], seed: seed ?? index + 1 }));
  return { open: entrants };
}

function authoritativeEntrants(record: StoredJourneyRecord): Record<string, ReturnType<typeof createEntrants>[string]> | null {
  if (!record.compiled) return null;
  const productionLock = record.workbench ? entrantsFromProductionLock(record.workbench) : null;
  if (productionLock) return productionLock;
  if (record.proposal.blueprint.format === "round_robin" || record.proposal.blueprint.format === "single_elimination")
    return genericRosterEntrants(record);
  return createEntrants(record.compiled.spec);
}

function authoritativeParticipantNames(record: StoredJourneyRecord): Readonly<Record<string, string>> {
  const imported = record.workbench ? participantNamesFromProductionLock(record.workbench) : {};
  if (Object.keys(imported).length > 0) return imported;
  const roster = genericSourceRoster(record);
  if (roster) return Object.fromEntries(roster.map(({ id, displayName }) => [id, displayName]));
  const entrants = authoritativeEntrants(record);
  if (!entrants) return {};
  const label = record.proposal.blueprint.participantUnit === "pairs" ? "Pair"
    : record.proposal.blueprint.participantUnit === "teams" ? "Team"
      : record.proposal.blueprint.participantUnit === "athletes" ? "Athlete" : "Player";
  return Object.fromEntries(Object.values(entrants).flat().map((entrant, index) => [entrant.id, `${label} ${index + 1}`]));
}

const validParticipantCredentialTimestamp = (value: string): boolean => {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
};

function verifyParticipantCredentials(record: StoredJourneyRecord): boolean {
  const access = record.participantAccess ?? [];
  const recovery = record.participantRecovery ?? [];
  const events = record.participantAccessEvents ?? [];
  if (new Set(access.map(({ tokenHash }) => tokenHash)).size !== access.length
    || access.some((grant) => grant.organizationId !== record.organizationId || grant.competitionId !== record.id
      || !/^[a-f0-9]{64}$/.test(grant.tokenHash) || !validParticipantCredentialTimestamp(grant.expiresAt)
      || Boolean(grant.revokedAt) !== Boolean(grant.revokedByCommandId)
      || (grant.revokedAt !== undefined && !validParticipantCredentialTimestamp(grant.revokedAt)))) return false;
  if (new Set(recovery.map(({ codeHash }) => codeHash)).size !== recovery.length
    || recovery.some((grant) => grant.organizationId !== record.organizationId || grant.competitionId !== record.id
      || !Number.isSafeInteger(grant.operationalRevision) || grant.operationalRevision < grant.publishedRevision
      || !/^[a-f0-9]{64}$/.test(grant.codeHash) || !validParticipantCredentialTimestamp(grant.codeExpiresAt)
      || !validParticipantCredentialTimestamp(grant.accessExpiresAt) || !validParticipantCredentialTimestamp(grant.issuedAt)
      || !grant.issuedByCommandId.trim() || !/^[a-f0-9]{64}$/.test(grant.requestHash)
      || Boolean(grant.revokedAt) !== Boolean(grant.revokedByCommandId)
      || (grant.revokedAt !== undefined && !validParticipantCredentialTimestamp(grant.revokedAt)))) return false;
  const credentialHashes = new Set([...access.map(({ tokenHash }) => tokenHash), ...recovery.map(({ codeHash }) => codeHash)]);
  let previousEventHash: string | null = null;
  const commandIds = new Set<string>();
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index]!;
    const { eventHash, ...body } = event;
    if (event.sequence !== index + 1 || event.previousEventHash !== previousEventHash || eventHash !== canonicalHash(body)
      || commandIds.has(event.commandId) || !event.commandId.trim() || !/^[a-f0-9]{64}$/.test(event.requestHash)
      || !event.participantId.trim() || !event.actorId.trim() || !validParticipantCredentialTimestamp(event.occurredAt)
      || event.affectedCredentialHashes.some((hash) => !credentialHashes.has(hash))) return false;
    if (event.kind === "ROTATED" && (!event.resultCredentialHash
      || !access.some((grant) => grant.tokenHash === event.resultCredentialHash
        && grant.issuedByCommandId === event.commandId && grant.participantId === event.participantId))) return false;
    if (event.kind === "RECOVERY_ISSUED" && (!event.resultCredentialHash
      || !recovery.some((grant) => grant.codeHash === event.resultCredentialHash
        && grant.issuedByCommandId === event.commandId && grant.participantId === event.participantId))) return false;
    if (event.kind === "REVOKED" && event.resultCredentialHash !== undefined) return false;
    if ((event.kind === "ROTATED" || event.kind === "REVOKED")
      && event.affectedCredentialHashes.some((hash) =>
        !access.some((grant) => grant.tokenHash === hash && grant.participantId === event.participantId
          && grant.revokedByCommandId === event.commandId)
        && !recovery.some((grant) => grant.codeHash === hash && grant.participantId === event.participantId
          && grant.revokedByCommandId === event.commandId))) return false;
    commandIds.add(event.commandId);
    previousEventHash = event.eventHash;
  }
  return true;
}

function nextParticipantAccessEvent(events: readonly ParticipantAccessControlEvent[],
  input: Omit<ParticipantAccessControlEvent, "sequence" | "previousEventHash" | "eventHash">): ParticipantAccessControlEvent {
  const body = { sequence: events.length + 1, previousEventHash: events.at(-1)?.eventHash ?? null, ...input };
  return { ...body, eventHash: canonicalHash(body) };
}

function verifyRecord(record: StoredJourneyRecord): boolean {
  const { recordHash, ...body } = record;
  if (recordHash !== makeRecordHash(body)) return false;
  if (record.compiled && (record.proposal.blueprint.format === "round_robin"
    || record.proposal.blueprint.format === "single_elimination") && !genericSourceRoster(record)) return false;
  if (record.duplication) {
    const memory = { sourceCompetitionId: record.duplication.sourceCompetitionId,
      sourceClosureHash: record.duplication.sourceClosureHash,
      newEditionName: record.duplication.newEditionName, newEventDate: record.duplication.newEventDate };
    if (record.duplication.memoryHash !== canonicalHash(memory) || memory.sourceCompetitionId === record.id
      || !/^[a-f0-9]{64}$/.test(memory.sourceClosureHash)
      || new Set(record.duplication.sourceDocumentHashes).size !== record.duplication.sourceDocumentHashes.length
      || record.duplication.sourceDocumentHashes.some((hash) => !/^[a-f0-9]{64}$/.test(hash))) return false;
  }
  if (!verifyParticipantCredentials(record)) return false;
  if (!record.live) return !record.closure;
  if (!record.live.operations || !verifyOperationalSafetyState(record.live.operations)) return false;
  const replay = replayLiveOperationsEvents(record.live.state.definition, record.live.state.events);
  if (!replay.valid || replay.state.proofHash !== record.live.state.proofHash) return false;
  const progressionEntrants = authoritativeEntrants(record);
  if (record.compiled && progressionEntrants && replay.state.version > 0
    && !verifyLiveProgression(record.compiled.spec, record.compiled.graph, progressionEntrants, replay.state)) return false;
  if (record.live.proposal && !verifyNoShowProposal(record.live.proposal)) return false;
  if (record.live.courtOutageProposal) {
    const proposal = record.live.courtOutageProposal;
    if (!verifyCourtOutageProposal(proposal) || !record.compiled) return false;
    const baseEventCount = record.live.state.events.findIndex((_event, index) => {
      const replayed = replayLiveOperationsEvents(record.live!.state.definition, record.live!.state.events.slice(0, index + 1));
      return replayed.valid && replayed.state.proofHash === proposal.baseLiveStateProofHash;
    });
    const baseReplay = proposal.baseLiveStateProofHash === replayLiveOperationsEvents(record.live.state.definition, []).state.proofHash
      ? replayLiveOperationsEvents(record.live.state.definition, [])
      : baseEventCount >= 0 ? replayLiveOperationsEvents(record.live.state.definition,
        record.live.state.events.slice(0, baseEventCount + 1)) : null;
    const previousPublication = record.live.publicationHistory?.find(({ revision }) => revision === proposal.baseOperationalRevision);
    const assignments = previousPublication?.operationalAssignments
      ?? (proposal.baseOperationalRevision === record.publication?.revision
        ? authoritativeOperationalAssignments(record.compiled.schedule) : null);
    if (!baseReplay?.valid || !assignments) return false;
    try {
      const regenerated = proposeCourtOutageRepair(proposal.baseOperationalRevision, baseReplay.state, {
        spec: record.compiled.spec, graph: record.compiled.graph, schedule: record.compiled.schedule,
        ...(record.compiled.simulation ? { simulation: record.compiled.simulation } : {}),
      }, assignments, { proposalId: proposal.proposalId, courtId: proposal.courtId, reason: proposal.reason,
        expectedReopenAt: proposal.expectedReopenAt, proposedBy: proposal.proposedBy, proposedAt: proposal.proposedAt,
        incidentKind: proposal.incidentKind, closureStartsAt: proposal.closureStartsAt,
        ...(proposal.sourceContestId ? { sourceContestId: proposal.sourceContestId } : {}) });
      if (regenerated.proposalHash !== proposal.proposalHash) return false;
    } catch { return false; }
  }
  if (record.live.publication) {
    const { publicationHash, ...publicationBody } = record.live.publication;
    const publishedState = replayLiveOperationsEvents(record.live.state.definition,
      record.live.state.events.slice(0, publicationBody.stateVersion));
    if (publicationHash !== canonicalHash(publicationBody) || !publishedState.valid
      || publicationBody.stateProofHash !== publishedState.state.proofHash
      || publicationBody.revision !== publicationBody.baseRevision + 1
      || publicationBody.approvedBy === publicationBody.publishedBy) return false;
    if (publicationBody.changeKind === "COURT_OUTAGE" || publicationBody.changeKind === "DELAY_OVERRUN") {
      const proposal = record.live.courtOutageProposal;
      if (!proposal || publicationBody.proposalHash !== proposal.proposalHash
        || publicationBody.changeKind !== proposal.incidentKind
        || publicationBody.optionHash !== proposal.proposalHash || publicationBody.approvedBy === proposal.proposedBy
        || canonicalHash(publicationBody.affectedContestIds) !== canonicalHash(proposal.affectedContestIds)
        || canonicalHash(publicationBody.affectedEntrantIds) !== canonicalHash(proposal.affectedEntrantIds)
        || canonicalHash(publicationBody.operationalAssignments) !== canonicalHash(proposal.operationalAssignments)
        || publicationBody.settledAsWalkoverContestIds.length) return false;
    } else {
      const option = record.live.proposal?.options.find(({ optionHash }) => optionHash === publicationBody.optionHash);
      if (!record.live.proposal || !option || publicationBody.proposalHash !== record.live.proposal.proposalHash
        || publicationBody.baseRevision !== record.live.baseRevision
        || publicationBody.approvedBy === record.live.proposal.proposedBy
        || canonicalHash(publicationBody.affectedContestIds) !== canonicalHash(record.live.proposal.affectedContestIds)
        || canonicalHash(publicationBody.affectedEntrantIds) !== canonicalHash(record.live.proposal.affectedEntrantIds)
        || canonicalHash(publicationBody.operationalAssignments) !== canonicalHash(option.operationalAssignments)
        || canonicalHash(publicationBody.settledAsWalkoverContestIds) !== canonicalHash(option.settledAsWalkoverContestIds)) return false;
    }
  }
  if (record.live.publicationHistory && (record.live.publicationHistory.some((publication) => {
    const { publicationHash, ...body } = publication;
    return publicationHash !== canonicalHash(body);
  }) || record.live.publicationHistory.at(-1)?.publicationHash !== record.live.publication?.publicationHash)) return false;
  try { new InMemoryTransactionalOutbox(record.organizationId, record.live.delivery); } catch { return false; }
  if (record.closure) {
    const authority = closureAuthority(record);
    if (!authority || record.closure.organizationId !== record.organizationId || record.closure.competitionId !== record.id
      || record.closure.publishedRevision !== record.publication?.revision
      || record.closure.operationalRevision !== (record.live.publication?.revision ?? record.publication?.revision)
      || !verifyCompetitionClosure(record.closure, { live: record.live.state,
        operations: record.live.operations, authority })) return false;
  }
  return true;
}

function statusOf(record: StoredJourneyRecord): CompetitionJourneyStatus {
  if (record.closure) return "CLOSED";
  if (record.publication) return "PUBLISHED";
  if (record.compiled?.guardReport.status === "PASSED") return "READY_FOR_APPROVAL";
  if (record.compiled) return "GUARD_BLOCKED";
  if (record.workbench?.missingDecisions.length || record.workbench?.conflicts.length
    || record.workbench?.unsupportedSemantics.some(({ blocking }) => blocking)) return "NEEDS_INPUT";
  if (record.workbench && definitionFromProductionLock(record.workbench)) return "DRAFT";
  if (record.proposal.status === "READY_TO_COMPILE" && record.supportFindings.length === 0) return "DRAFT";
  return "NEEDS_INPUT";
}

function selectorSummary(selectors: TournamentDefinition["qualificationPolicies"][number]["selectors"]): string {
  return selectors.map((selector) => {
    if (selector.type === "pool_position") return `pool position ${selector.position}`;
    if (selector.type === "best_n_across_pools") return `best ${selector.count} at position ${selector.poolPosition ?? "any"}`;
    if (selector.type === "top_n" || selector.type === "bottom_n") return `${selector.type.replace("_", " ")} ${selector.count}`;
    if (selector.type === "remainder" || selector.type === "pool_winners") return selector.type.replace("_", " ");
    return selector.type.replaceAll("_", " ");
  }).join("; ");
}

export function projectCompetitionStructureMap(definition: TournamentDefinition | null,
  unavailableReason: string | null): CompetitionStructureMap {
  if (!definition) return { definitionAvailable: false, nodes: [], edges: [], unavailableReason };
  const structures = new Map(definition.competitionStructures.map((structure) => [structure.id, structure]));
  const stages = new Map(definition.stages.map((stage) => [stage.id, stage]));
  const nodes = definition.stages.map((stage) => ({
    id: stage.id,
    label: stage.label,
    kind: stage.pool ? "POOL" as const : stage.playIn ? "PLAY_IN" as const
      : stage.bracket ? (stage.primitive === "consolation" ? "CUP" as const : "BRACKET" as const) : "OTHER" as const,
    expectedEntrants: stage.expectedEntrants ?? null,
    poolCount: stage.pool?.poolCount ?? null,
    poolSizes: stage.pool?.sizes ?? [],
  }));
  const edges = definition.qualificationPolicies.map((policy) => {
    const source = stages.get(policy.sourceStageId);
    const destination = structures.get(policy.destinationStructureId);
    const warnings: CompetitionStructureMap["edges"][number]["warnings"][number][] = [];
    if (!source) warnings.push({ code: "INVALID_EDGE", message: `Source stage '${policy.sourceStageId}' is not present in this definition.` });
    if (!destination) warnings.push({ code: "INVALID_EDGE", message: `Destination structure '${policy.destinationStructureId}' is not present in this definition.` });
    if (source?.pool && new Set(source.pool.sizes).size > 1
      && policy.selectors.some(({ type }) => type === "best_n_across_pools") && !policy.normalization)
      warnings.push({ code: "INCOMPLETE_EDGE", message: "Unequal pools require an explicit cross-pool normalization policy." });
    if (destination && policy.outputCount !== destination.targetEntrants)
      warnings.push({ code: "INVALID_EDGE", message: `This edge supplies ${policy.outputCount} entrants but its destination requires ${destination.targetEntrants}.` });
    if (warnings.length === 0) warnings.push({ code: "CONSEQUENTIAL_EDGE", message:
      `Routes ${policy.outputCount} entrants; changing it requires a fresh compiler, Run Assurance and Guard result.` });
    return {
      id: policy.id, sourceStageId: policy.sourceStageId, destinationStructureId: policy.destinationStructureId,
      destinationStageIds: destination?.stageIds ?? [], outputCount: policy.outputCount,
      selectorSummary: selectorSummary(policy.selectors), normalization: policy.normalization ?? null, warnings,
    };
  });
  return { definitionAvailable: true, nodes, edges, unavailableReason: null };
}

function countDefinitionContests(definition: TournamentDefinition): number {
  return definition.stages.reduce((total, stage) => {
    const pool = stage.pool;
    if (pool) return total + pool.sizes.reduce((sum, size) => sum + size * (size - 1) / 2 * pool.rounds, 0);
    if (stage.bracket) return total + Math.max(0, stage.bracket.entrantCount - 1);
    return total;
  }, 0);
}

function countDelta(before: number | null, after: number | null, label: string) {
  if (before !== null && after !== null) return { before, after, delta: after - before, unavailableReason: null };
  const missing = before === null && after === null ? "current and proposed" : before === null ? "current" : "proposed";
  return { before, after, delta: null,
    unavailableReason: `The ${missing} canonical definition is incomplete, so the ${label} delta cannot be derived.` };
}

function canonicalDesignFor(blueprint: CompetitionBlueprint, workbench: CompetitionWorkbenchProjection,
  sources: readonly CreationSource[], supportFindings: readonly string[]) {
  const sourceParticipantCount = workbench.understoodFacts.find(({ id }) => id === "entrants.total")?.value;
  const effectiveBlueprint: CompetitionBlueprint = isProductionLockWorkbench(workbench) && typeof sourceParticipantCount === "number" ? {
    ...blueprint,
    name: recognisedCompetitionName(workbench), sport: "padel", participantUnit: "pairs",
    participantCount: sourceParticipantCount, resourceCount: 7, resourceLabel: "courts", format: "pools_to_knockout",
    matchDurationMinutes: 30,
  } : connectedBlueprintFromWorkbench(blueprint, workbench);
  const definition = definitionFromProductionLock(workbench)
    ?? definitionFromConnectedBlueprint(effectiveBlueprint, sources)
    ?? (supportFindings.length === 0 && workbench.missingDecisions.length === 0
      && workbench.conflicts.length === 0 && !workbench.unsupportedSemantics.some(({ blocking }) => blocking)
      ? playAndKonnectDefinition : null);
  return { effectiveBlueprint, definition };
}

function reviewStructuredEdit(workbench: CompetitionWorkbenchProjection, preview: StructuredWorkbenchEditPreview,
  createdAt: string, blueprint: CompetitionBlueprint, sources: readonly CreationSource[], supportFindings: readonly string[],
  compiledDefinition: TournamentDefinition | null): StructuredEditReview {
  const source: CreationSource = { mode: "quick", value: { kind: "structured-organiser-edit-preview", edits: preview.edits } };
  const candidate = applyWorkbenchEdit(workbench, preview, workbenchSourceDocument(source, createdAt));
  const currentDefinition = compiledDefinition ?? canonicalDesignFor(blueprint, workbench, sources, supportFindings).definition;
  const proposedDefinition = canonicalDesignFor(blueprint, candidate, [...sources, source], supportFindings).definition;
  const currentMatchCount = currentDefinition ? countDefinitionContests(currentDefinition) : null;
  const proposedMatchCount = proposedDefinition ? countDefinitionContests(proposedDefinition) : null;
  const currentQualificationCount = currentDefinition?.qualificationPolicies.length ?? null;
  const proposedQualificationCount = proposedDefinition?.qualificationPolicies.length ?? null;
  const available = proposedDefinition !== null;
  return {
    changedDecisionIds: preview.edits.map(({ id }) => id).sort(),
    unchangedDecisionIds: workbench.assumptions.map(({ id }) => id).filter((id) => !preview.edits.some((edit) => edit.id === id)).sort(),
    matchCount: countDelta(currentMatchCount, proposedMatchCount, "match-count"),
    qualificationCount: countDelta(currentQualificationCount, proposedQualificationCount, "qualification-count"),
    assurance: available
      ? { status: "PENDING_EXACT_COMPILE", message: "The exact candidate must now be compiled for independent Run Assurance." }
      : { status: "UNAVAILABLE", message: "The candidate definition remains incomplete; Run Assurance cannot be claimed." },
    guard: available
      ? { status: "PENDING_EXACT_COMPILE", message: "Guard runs only against the exact compiled candidate, never this browser proposal." }
      : { status: "UNAVAILABLE", message: "Guard is unavailable until an exact complete candidate exists." },
    publication: { possible: false, reason: available
      ? "Not yet: record this reviewed proposal, compile the exact revision, then pass Run Assurance and Guard before publication."
      : "No: the proposed definition is incomplete and cannot enter publication review." },
  };
}

function snapshotOf(record: StoredJourneyRecord): CompetitionJourneySnapshot {
  const compiled = record.compiled;
  const workbench = record.workbench ?? analyseCompetitionSources(record.sources ?? [record.source], record.createdAt);
  const { effectiveBlueprint, definition: previewDefinition } = canonicalDesignFor(record.proposal.blueprint, workbench,
    record.sources ?? [record.source], record.supportFindings);
  return {
    apiVersion: "1.0",
    id: record.id,
    name: recognisedCompetitionName(workbench) ?? record.proposal.blueprint.name ?? "Untitled competition",
    draftVersion: record.draftVersion,
    revision: compiled?.revision ?? 0,
    status: statusOf(record),
    sourceMode: record.source.mode,
    blueprint: effectiveBlueprint,
    understood: record.proposal.understood,
    questions: record.proposal.questions,
    warnings: record.proposal.warnings,
    supportFindings: record.supportFindings,
    workbench,
    approvalRequired: true,
    assumptions: (compiled?.spec.assumptions ?? previewDefinition?.assumptions ?? []).map(({ id, rulePath, origin, knowledge, approved, critical }) =>
      ({ id, rulePath, origin, knowledge, approved, critical })),
    requirements: compiled?.spec.requirements ?? previewDefinition?.requirements ?? [],
    structureMap: projectCompetitionStructureMap(compiled?.spec ?? previewDefinition,
      previewDefinition || compiled ? null : "The canonical definition is incomplete; resolve the listed design decisions before its structure can be derived."),
    compiled: compiled ? {
      revision: compiled.revision,
      compiledAt: compiled.compiledAt,
      timezone: compiled.spec.scheduling.timezone,
      specHash: canonicalHash(compiled.spec),
      graphHash: canonicalHash(compiled.graph),
      scheduleHash: canonicalHash(compiled.schedule),
      simulationHash: compiled.simulation ? canonicalHash(compiled.simulation) : null,
      solverStatus: compiled.schedule.audit.status,
      actualContestCount: compiled.graph.generatedActualContestCount,
      scheduledContestCount: compiled.schedule.contests.length,
      guardStatus: compiled.guardReport.status,
      guardReportHash: compiled.guardReport.reportHash,
      changeSet: compiled.changeSet ?? null,
      changeSetHash: compiled.changeSet?.changeSetHash ?? null,
      guardFindings: compiled.guardReport.findings,
      guardPreflight: createCompetitionGuardPreflight(compiled.guardReport),
      preflightPath: `/competitions/${encodeURIComponent(record.id)}/preflight`,
      requiredAcknowledgementCodes: compiled.guardReport.requiredAcknowledgementCodes,
      schedule: compiled.schedule.contests.map(({ contestId, resourceId, start, end }) => ({ contestId, resourceId, start, end })),
    } : null,
    approval: record.approval ?? null,
    publication: record.publication ?? null,
    live: record.live ?? null,
    closure: record.closure ?? null,
    duplication: record.duplication ?? null,
    webPath: `/competitions/${encodeURIComponent(record.id)}`,
  };
}

function compileReferenceRevision(record: StoredJourneyRecord, compiledAt: string,
  solverPythonExecutable?: string): CompiledJourneyRevision {
  const workbench = record.workbench ?? analyseCompetitionSources(record.sources ?? [record.source], record.createdAt);
  const blueprint = connectedBlueprintFromWorkbench(record.proposal.blueprint, workbench);
  const productionLockDefinition = record.workbench ? definitionFromProductionLock(record.workbench) : null;
  const connectedBlueprintDefinition = definitionFromConnectedBlueprint(blueprint, record.sources ?? [record.source]);
  if (!productionLockDefinition && !connectedBlueprintDefinition && (!blueprint.startsAt || !blueprint.endsAt)) throw new Error("journey_not_ready");
  const base = structuredClone(playAndKonnectDefinition);
  const definition: TournamentDefinition = productionLockDefinition ?? connectedBlueprintDefinition ?? {
    ...base,
    scheduling: { ...base.scheduling, start: blueprint.startsAt!, finishBy: blueprint.endsAt! },
    resources: base.resources.map((resource, index) => index === 0 ? { ...resource,
      quantity: blueprint.resourceCount ?? resource.quantity,
      availability: [{ start: blueprint.startsAt!, end: blueprint.endsAt! }] } : resource),
  };
  const revision = (record.compiled?.revision ?? 0) + 1;
  const spec = compileDefinition(definition, {
    specId: record.id,
    revision,
    schemaVersion: "1.0.0",
    compilerVersion: "0.1.0",
    rulesetVersions: { padel: "1.0.0", competition: "1.0.0" },
    sourcePrompt: `sources:${canonicalHash(record.sources ?? [record.source])}:definition:${record.workbench?.definitionVersion ?? 1}`,
    createdAt: compiledAt,
  });
  const entrants = productionLockDefinition ? entrantsFromProductionLock(record.workbench!)
    : connectedBlueprintDefinition ? genericRosterEntrants(record) : null;
  if ((productionLockDefinition || connectedBlueprintDefinition) && !entrants) throw new Error("journey_roster_unavailable");
  const scenario = runScenario(spec, entrants ?? createEntrants(spec), `journey:${record.id}:revision:${revision}`);
  const genericSolve = connectedBlueprintDefinition ? solveGraphWithCpSat(spec, scenario.graph,
    { maxTimeSeconds: 30, ...(solverPythonExecutable ? { pythonExecutable: solverPythonExecutable } : {}) }) : null;
  if (genericSolve && !genericSolve.solution) throw new Error(`journey_solver_${genericSolve.status.toLowerCase()}`);
  const schedule = productionLockDefinition
    ? (verifiedScheduleFromProductionLock(record.workbench!, spec, scenario.graph) ?? scenario.schedule)
    : genericSolve?.solution ?? scenario.schedule;
  const guardReport = evaluateCompetitionGuard({
    sourceDefinitionHash: canonicalHash(spec),
    spec,
    graph: scenario.graph,
    schedule,
    ...(scenario.simulation ? { simulation: scenario.simulation } : {}),
  });
  const previous = record.compiled;
  const pendingImpact = record.workbench?.pendingImpact;
  const changeSet = createPublicationChangeSet({ fromRevision: previous?.revision ?? null, toRevision: revision,
    ...(previous ? { previousDefinition: previous.spec, previousSchedule: previous.schedule } : {}),
    definition: spec, specHash: guardReport.binding.specHash, schedule,
    ...(pendingImpact ? { reviewedImpact: { previewHash: pendingImpact.previewHash,
      semanticChanges: pendingImpact.semantic, operationalImpact: pendingImpact.operational } } : {}) });
  return {
    revision,
    compiledBy: "competition-journey.compiler",
    compiledAt,
    spec,
    graph: scenario.graph,
    schedule,
    ...(scenario.simulation ? { simulation: scenario.simulation } : {}),
    guardReport,
    changeSet,
  };
}

export class CompetitionJourney {
  private records = new Map<string, StoredJourneyRecord>();
  private readonly storagePath: string | undefined;
  private readonly now: () => string;
  private readonly organizationId: string;
  private readonly participantTokenKeys: Readonly<Record<string, string>>;
  private readonly participantTokenKeyVersion: string;
  private readonly offlinePackSigningSeedHex: string;
  private readonly operationalAuthorityAssignments: OperationalAuthorityAssignments;
  private readonly solverPythonExecutable: string | undefined;

  public constructor(options: CompetitionJourneyOptions = {}) {
    this.storagePath = options.storagePath;
    this.now = options.now ?? (() => new Date().toISOString());
    this.organizationId = options.organizationId ?? "org.local";
    this.participantTokenKeyVersion = options.participantTokenKeyVersion ?? "v1";
    this.participantTokenKeys = options.participantTokenKeys
      ?? (options.participantTokenSecret ? { [this.participantTokenKeyVersion]: options.participantTokenSecret } : {});
    if (Object.entries(this.participantTokenKeys).some(([version, secret]) => !version.trim() || secret.length < 32)
      || (Object.keys(this.participantTokenKeys).length > 0 && !this.participantTokenKeys[this.participantTokenKeyVersion]))
      throw new Error("participant_signing_not_configured");
    this.offlinePackSigningSeedHex = options.offlinePackSigningSeedHex ?? "";
    this.operationalAuthorityAssignments = options.operationalAuthorityAssignments ?? {
      incidentLead: "local.incident-lead", competitionLead: "local.competition-lead",
      safetyLead: "local.safety-lead", communicationsLead: "local.communications-lead", scribe: "local.scribe",
    };
    this.solverPythonExecutable = options.solverPythonExecutable;
    if (!this.organizationId.trim()) throw new Error("invalid_journey_organization");
    this.load();
  }

  public list(): readonly CompetitionJourneySnapshot[] {
    return [...this.records.values()].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id))
      .map(snapshotOf);
  }

  public read(id: string): CompetitionJourneySnapshot | undefined {
    const record = this.records.get(id);
    return record ? snapshotOf(record) : undefined;
  }

  public create(source: CreationSource, createdBy = "local.organiser"): CompetitionJourneySnapshot {
    return this.createWithSources([source], createdBy);
  }

  /** Creates one draft from a complete source bundle; persistence happens only after every source is parsed. */
  public createWithSources(sources: readonly CreationSource[], createdBy = "local.organiser"): CompetitionJourneySnapshot {
    if (sources.length === 0 || sources.length > 8) throw new Error("invalid_creation_source_bundle");
    const source = sources[0]!;
    const proposal = createCompetitionProposal(source);
    const timestamp = this.canonicalNow();
    const workbench = analyseCompetitionSources(sources, timestamp);
    const name = recognisedCompetitionName(workbench) ?? proposal.blueprint.name;
    const base = (name ?? "competition").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "competition";
    let id = `${base}.${proposal.proposalHash.slice(0, 10)}`;
    let suffix = 1;
    while (this.records.has(id)) { suffix += 1; id = `${base}.${proposal.proposalHash.slice(0, 10)}.${suffix}`; }
    const record = sealRecord({ id, organizationId: this.organizationId, draftVersion: 1, createdBy, createdAt: timestamp, updatedAt: timestamp,
      source, sources: [...sources], proposal, workbench,
      supportFindings: findingsForWorkbench(workbench, proposal.blueprint) });
    this.records.set(id, record);
    this.persist();
    return snapshotOf(record);
  }

  public revise(id: string, expectedDraftVersion: number, source: CreationSource): CompetitionJourneySnapshot {
    const current = this.require(id);
    if (current.draftVersion !== expectedDraftVersion) throw new Error("journey_version_conflict");
    if (current.approval) throw new Error("approved_revision_is_immutable");
    const proposal = createCompetitionProposal(source);
    const updatedAt = this.canonicalNow();
    const sources = [...(current.sources ?? [current.source]), source];
    const workbench = analyseCompetitionSources(sources, updatedAt);
    const revised = sealRecord({
      id: current.id,
      organizationId: current.organizationId,
      draftVersion: current.draftVersion + 1,
      createdBy: current.createdBy,
      createdAt: current.createdAt,
      updatedAt,
      source,
      sources,
      proposal,
      workbench,
      supportFindings: findingsForWorkbench(workbench, proposal.blueprint),
    });
    this.records.set(id, revised);
    this.persist();
    return snapshotOf(revised);
  }

  public addSource(id: string, expectedDraftVersion: number, source: CreationSource): CompetitionJourneySnapshot {
    const current = this.require(id);
    if (current.draftVersion !== expectedDraftVersion) throw new Error("journey_version_conflict");
    if (current.approval) throw new Error("approved_revision_is_immutable");
    const updatedAt = this.canonicalNow();
    const sources = [...(current.sources ?? [current.source]), source];
    const currentWorkbench = current.workbench ?? analyseCompetitionSources(current.sources ?? [current.source], current.createdAt);
    const workbench = rebaseWorkbenchSources(currentWorkbench, sources, updatedAt);
    const { compiled: _compiled, approval: _approval, publication: _publication, ...draft } = withoutSeal(current);
    const revised = sealRecord({ ...draft, draftVersion: current.draftVersion + 1, updatedAt, sources, workbench });
    this.records.set(id, revised);
    this.persist();
    return snapshotOf(revised);
  }

  public removeSource(id: string, expectedDraftVersion: number, sourceId: string): CompetitionJourneySnapshot {
    const current = this.require(id);
    if (current.draftVersion !== expectedDraftVersion) throw new Error("journey_version_conflict");
    if (current.approval) throw new Error("approved_revision_is_immutable");
    const currentWorkbench = current.workbench ?? analyseCompetitionSources(current.sources ?? [current.source], current.createdAt);
    const index = currentWorkbench.sources.findIndex(({ id: candidate }) => candidate === sourceId);
    const currentSources = current.sources ?? [current.source];
    if (index < 0 || index !== currentSources.length - 1 || currentSources.length <= 1)
      throw new Error("journey_source_not_removable");
    const sources = currentSources.filter((_, candidate) => candidate !== index);
    const updatedAt = this.canonicalNow(); const workbench = rebaseWorkbenchSources(currentWorkbench, sources, updatedAt);
    const { compiled: _compiled, approval: _approval, publication: _publication, ...draft } = withoutSeal(current);
    const revised = sealRecord({ ...draft, draftVersion: current.draftVersion + 1, updatedAt,
      source: sources.at(-1)!, sources, workbench });
    this.records.set(id, revised); this.persist(); return snapshotOf(revised);
  }

  public planStructuredEdit(id: string, expectedDraftVersion: number, edits: readonly StructuredWorkbenchEdit[],
    editedBy: string): StructuredWorkbenchEditPreview {
    const current = this.require(id);
    if (current.draftVersion !== expectedDraftVersion) throw new Error("journey_version_conflict");
    if (current.approval) throw new Error("approved_revision_is_immutable");
    const workbench = current.workbench ?? analyseCompetitionSources(current.sources ?? [current.source], current.createdAt);
    const preview = planWorkbenchEdit(workbench, expectedDraftVersion, edits, editedBy);
    return { ...preview, review: reviewStructuredEdit(workbench, preview, current.createdAt, current.proposal.blueprint,
      current.sources ?? [current.source], current.supportFindings, current.compiled?.spec ?? null) };
  }

  public applyStructuredEdit(id: string, expectedDraftVersion: number, edits: readonly StructuredWorkbenchEdit[],
    expectedPreviewHash: string, editedBy: string): CompetitionJourneySnapshot {
    const current = this.require(id);
    if (current.draftVersion !== expectedDraftVersion) throw new Error("journey_version_conflict");
    if (current.approval) throw new Error("approved_revision_is_immutable");
    const workbench = current.workbench ?? analyseCompetitionSources(current.sources ?? [current.source], current.createdAt);
    const preview = planWorkbenchEdit(workbench, expectedDraftVersion, edits, editedBy);
    if (preview.previewHash !== expectedPreviewHash) throw new Error("structured_edit_preview_mismatch");
    const updatedAt = this.canonicalNow();
    const source: CreationSource = { mode: "quick", value: { kind: "structured-organiser-edit", editedBy,
      previewHash: expectedPreviewHash, edits: [...edits] } };
    const revisedWorkbench = applyWorkbenchEdit(workbench, preview, workbenchSourceDocument(source, updatedAt));
    const { compiled: _compiled, approval: _approval, publication: _publication, ...draft } = withoutSeal(current);
    const revised = sealRecord({ ...draft, draftVersion: current.draftVersion + 1, updatedAt,
      source, sources: [...(current.sources ?? [current.source]), source], workbench: revisedWorkbench });
    this.records.set(id, revised);
    this.persist();
    return snapshotOf(revised);
  }

  public compile(id: string, expectedDraftVersion: number): CompetitionJourneySnapshot {
    const current = this.require(id);
    if (current.draftVersion !== expectedDraftVersion) throw new Error("journey_version_conflict");
    const workbenchReady = Boolean(current.workbench && definitionFromProductionLock(current.workbench));
    if ((!current.proposal.compilationCanStart && !workbenchReady) || current.supportFindings.length || current.workbench?.missingDecisions.length
      || current.workbench?.conflicts.length || current.workbench?.unsupportedSemantics.some(({ blocking }) => blocking))
      throw new Error("journey_not_ready");
    if (current.approval) throw new Error("approved_revision_is_immutable");
    const compiledAt = this.canonicalNow();
    const compiled = compileReferenceRevision(current, compiledAt, this.solverPythonExecutable);
    const revised = sealRecord({ ...withoutSeal(current), updatedAt: compiledAt, compiled });
    this.records.set(id, revised);
    this.persist();
    return snapshotOf(revised);
  }

  public approve(id: string, expectedRevision: number, approvedBy: string, acknowledgedFindingCodes: readonly string[]): CompetitionJourneySnapshot {
    const current = this.require(id);
    const compiled = current.compiled;
    if (!compiled || compiled.revision !== expectedRevision) throw new Error("journey_revision_conflict");
    if (!compiled.changeSet) throw new Error("journey_revision_requires_recompile");
    if (!approvedBy.trim() || approvedBy === compiled.compiledBy) throw new Error("approval_requires_independent_actor");
    const definitionHash = canonicalHash(compiled.spec);
    const independentlyVerifiedReport = evaluateCompetitionGuard({ sourceDefinitionHash: definitionHash, spec: compiled.spec,
      graph: compiled.graph, schedule: compiled.schedule, ...(compiled.simulation ? { simulation: compiled.simulation } : {}) });
    if (independentlyVerifiedReport.status !== "PASSED") throw new Error("competition_guard_blocked_approval");
    if (independentlyVerifiedReport.reportHash !== compiled.guardReport.reportHash) throw new Error("journey_guard_report_mismatch");
    if (!exactAcknowledgements(acknowledgedFindingCodes, independentlyVerifiedReport.requiredAcknowledgementCodes))
      throw new Error("guard_acknowledgements_mismatch");
    if (current.publication) return snapshotOf(current);
    const approvedAt = this.canonicalNow();
    const approvalBody = { revision: compiled.revision, approvedBy, approvedAt,
      guardReportHash: independentlyVerifiedReport.reportHash,
      changeSetHash: compiled.changeSet.changeSetHash,
      acknowledgedFindingCodes: [...new Set(acknowledgedFindingCodes)].sort() };
    const approval: JourneyApproval = { ...approvalBody, approvalHash: canonicalHash(approvalBody) };
    const publishedBy = "competition-journey.publisher" as const;
    if (publishedBy === approvedBy) throw new Error("publication_requires_independent_actor");
    const certificate = createPublicationCertificate({ tournamentId: current.id, tournamentRevision: compiled.revision,
      report: independentlyVerifiedReport, changeSet: compiled.changeSet,
      acknowledgedFindingCodes, issuedBy: publishedBy, issuedAt: approvedAt });
    const publicationBody = { revision: compiled.revision, definitionHash,
      guardReportHash: independentlyVerifiedReport.reportHash, changeSetHash: compiled.changeSet.changeSetHash,
      certificateHash: certificate.certificateHash,
      publishedBy, publishedAt: approvedAt };
    const publication: JourneyPublication = { ...publicationBody, certificate, outboxIntents: [{
      topic: "competition.publication.v1", key: `${current.id}:v${compiled.revision}`,
      payload: { competitionId: current.id, ...publicationBody },
    }] };
    const revised = sealRecord({ ...withoutSeal(current), updatedAt: approvedAt, approval, publication });
    this.records.set(id, revised);
    this.persist();
    return snapshotOf(revised);
  }

  public activateLive(id: string, expectedRevision: number, activatedBy: string): CompetitionJourneySnapshot {
    const current = this.require(id);
    if (current.closure) throw new Error("competition_is_closed");
    const compiled = current.compiled;
    if (!compiled || !current.publication || compiled.revision !== expectedRevision
      || current.publication.revision !== expectedRevision) throw new Error("journey_revision_conflict");
    if (!activatedBy.trim()) throw new Error("live_activation_requires_actor");
    if (current.live) {
      if (current.live.baseRevision !== expectedRevision) throw new Error("live_base_revision_conflict");
      return snapshotOf(current);
    }
    const activatedAt = this.canonicalNow();
    const live: JourneyLiveState = { baseRevision: expectedRevision, activatedBy, activatedAt, delivery: [],
      participantRevisions: {}, contestRevisions: {},
      operations: createOperationalSafetyState(this.operationalAuthorityAssignments),
      state: activatePublishedLiveState(id, compiled.spec, compiled.graph, compiled.schedule) };
    const revised = sealRecord({ ...withoutSeal(current), updatedAt: activatedAt, live });
    this.records.set(id, revised);
    this.persist();
    return snapshotOf(revised);
  }

  public submitLiveCommand(id: string, expectedRevision: number,
    command: LiveOperationsCommand): CompetitionJourneySnapshot {
    const current = this.require(id);
    if (current.closure) throw new Error("competition_is_closed");
    const live = this.requireProjectedLive(current, expectedRevision);
    if (["PAUSED", "STOPPED", "RECOVERING", "CANCELLED"].includes(live.operations.mode)
      && ["CALL_CONTEST", "START_CONTEST"].includes(command.kind))
      throw new Error("operational_mode_blocks_live_command");
    if (command.kind === "RESOLVE_CONTEST_ENTRANTS") throw new Error("live_command_is_server_owned");
    const result = submitLiveOperationsCommand(live.state, command);
    if (!result.accepted) throw new Error(`live_command_rejected:${result.findings.map(({ code }) => code).join(",")}`);
    if (result.idempotentReplay) return snapshotOf(current);
    const progressionEntrants = authoritativeEntrants(current);
    if (!progressionEntrants) throw new Error("live_progression_roster_unavailable");
    const progression = advanceLiveProgression(current.compiled!.spec, current.compiled!.graph,
      progressionEntrants, result.state, command.occurredAt);
    const acceptedEvents = [...result.events, ...progression.events];
    const touchedContestIds = new Set<string>();
    const touchedEntrantIds = new Set<string>();
    for (const event of acceptedEvents) {
      if ("contestId" in event) touchedContestIds.add(event.contestId);
      if ("entrantId" in event) touchedEntrantIds.add(event.entrantId);
      if ("entrantIds" in event) event.entrantIds.forEach((entrantId) => touchedEntrantIds.add(entrantId));
      if ("winnerEntrantId" in event) touchedEntrantIds.add(event.winnerEntrantId);
      if ("absentEntrantId" in event) touchedEntrantIds.add(event.absentEntrantId);
      if (event.kind === "OPERATION_CORRECTED") {
        if ("contestId" in event.replacement) touchedContestIds.add(event.replacement.contestId);
        if ("entrantId" in event.replacement) touchedEntrantIds.add(event.replacement.entrantId);
      }
    }
    for (const contestId of touchedContestIds) {
      const definition = progression.state.definition.contests.find((contest) => contest.contestId === contestId);
      (progression.state.resolvedEntrants[contestId] ?? definition?.entrantIds ?? [])
        .forEach((entrantId) => touchedEntrantIds.add(entrantId));
    }
    const participantRevisions = { ...live.participantRevisions,
      ...Object.fromEntries([...touchedEntrantIds].map((entrantId) => [entrantId, expectedRevision])) };
    const contestRevisions = { ...live.contestRevisions,
      ...Object.fromEntries([...touchedContestIds].map((contestId) => [contestId, expectedRevision])) };
    const outbox = new InMemoryTransactionalOutbox(current.organizationId, live.delivery);
    const participantNames = authoritativeParticipantNames(current);
    const assignments = live.publication?.operationalAssignments ?? current.compiled!.schedule.contests;
    const committedEvent = acceptedEvents.at(-1)!;
    for (const participantId of [...touchedEntrantIds].sort()) {
      const projection = deriveParticipantNext({ competitionId: current.id,
        competitionName: recognisedCompetitionName(current.workbench!) ?? current.proposal.blueprint.name ?? "Competition",
        publishedRevision: current.publication!.revision, operationalRevision: expectedRevision,
        affectedParticipantIds: live.publication?.affectedEntrantIds ?? [], participantRevisions,
        participantId, participantNames, state: progression.state, assignments,
        operation: live.operations.publicStatus });
      outbox.enqueueFromCommittedEvent({ id: committedEvent.eventId, streamId: current.id,
        streamVersion: committedEvent.sequence, type: committedEvent.kind, occurredAt: committedEvent.occurredAt,
        committedAt: command.occurredAt, payload: projection }, {
        topic: "competition.participant-next.v1",
        key: `${current.id}:v${expectedRevision}:live-${committedEvent.sequence}:${participantId}`,
        payload: { organizationId: current.organizationId, competitionId: current.id,
          revision: expectedRevision, recipientEntrantId: participantId, projection },
      });
    }
    const revisedLive: JourneyLiveState = { ...live, state: progression.state, participantRevisions,
      contestRevisions, delivery: outbox.list() };
    const revised = sealRecord({ ...withoutSeal(current), updatedAt: command.occurredAt, live: revisedLive });
    this.records.set(id, revised);
    this.persist();
    return snapshotOf(revised);
  }

  public submitOperationalCommand(id: string, expectedOperationalRevision: number,
    command: OperationalSafetyCommand): CompetitionJourneySnapshot {
    const current = this.require(id);
    if (current.closure) throw new Error("competition_is_closed");
    const live = this.requireProjectedLive(current, expectedOperationalRevision);
    const result = submitOperationalSafetyCommand(live.operations, command);
    if (!result.accepted) throw new Error(`operational_command_rejected:${result.findings.join(",")}`);
    if (result.idempotentReplay) return snapshotOf(current);
    const acceptedEvent = result.state.events.at(-1)!;
    const outbox = new InMemoryTransactionalOutbox(current.organizationId, live.delivery);
    if (acceptedEvent.command.kind === "TRANSITION_MODE") {
      const participantNames = authoritativeParticipantNames(current);
      const participantIds = [...new Set(live.state.definition.contests.flatMap(({ entrantIds }) => entrantIds))].sort();
      const assignments = live.publication?.operationalAssignments ?? current.compiled!.schedule.contests;
      for (const participantId of participantIds) {
        const projection = deriveParticipantNext({ competitionId: current.id,
          competitionName: recognisedCompetitionName(current.workbench!) ?? current.proposal.blueprint.name ?? "Competition",
          publishedRevision: current.publication!.revision, operationalRevision: expectedOperationalRevision,
          affectedParticipantIds: live.publication?.affectedEntrantIds ?? [], participantRevisions: live.participantRevisions,
          participantId, participantNames, state: live.state, assignments, operation: result.state.publicStatus });
        outbox.enqueueFromCommittedEvent({ id: acceptedEvent.eventId, streamId: current.id,
          streamVersion: acceptedEvent.sequence, type: "competition.operational-mode-transitioned",
          occurredAt: command.occurredAt, committedAt: command.occurredAt,
          payload: { operation: result.state.publicStatus } }, {
          topic: "competition.operational-status.v1",
          key: `${current.id}:operations-${acceptedEvent.sequence}:${participantId}`,
          payload: { organizationId: current.organizationId, competitionId: current.id,
            publishedRevision: current.publication!.revision, operationalRevision: expectedOperationalRevision,
            recipientEntrantId: participantId, operation: result.state.publicStatus, projection },
        });
      }
    }
    const revisedLive: JourneyLiveState = { ...live, operations: result.state, delivery: outbox.list() };
    const revised = sealRecord({ ...withoutSeal(current), updatedAt: command.occurredAt, live: revisedLive });
    this.records.set(id, revised);
    this.persist();
    return snapshotOf(revised);
  }

  public proposeNoShow(id: string, expectedRevision: number, expectedLiveVersion: number,
    request: NoShowProposalRequest): CompetitionJourneySnapshot {
    const current = this.require(id);
    if (current.closure) throw new Error("competition_is_closed");
    const live = this.requireLive(current, expectedRevision);
    if (live.publication) throw new Error("live_revision_already_published");
    if (live.state.version !== expectedLiveVersion) throw new Error("live_version_conflict");
    const compiled = current.compiled!;
    const proposal = proposeNoShowRepair(expectedRevision, live.state, {
      spec: compiled.spec, graph: compiled.graph, schedule: compiled.schedule,
      ...(compiled.simulation ? { simulation: compiled.simulation } : {}),
    }, request);
    const revisedLive: JourneyLiveState = { ...live, proposal };
    const revised = sealRecord({ ...withoutSeal(current), updatedAt: request.proposedAt, live: revisedLive });
    this.records.set(id, revised);
    this.persist();
    return snapshotOf(revised);
  }

  public approveNoShow(id: string, expectedRevision: number, expectedProposalHash: string,
    expectedOptionHash: string, strategy: NoShowRepairStrategy, approvedBy: string, approvedAt: string): CompetitionJourneySnapshot {
    const current = this.require(id);
    if (current.closure) throw new Error("competition_is_closed");
    const live = this.requireLive(current, expectedRevision);
    this.assertOperationalPublicationAllowed(live);
    const proposal = live.proposal;
    if (!proposal || proposal.proposalHash !== expectedProposalHash || !verifyNoShowProposal(proposal))
      throw new Error("no_show_proposal_mismatch");
    if (typeof expectedOptionHash !== "string" || !expectedOptionHash.trim()) throw new Error("no_show_option_hash_required");
    const option = proposal.options.find((candidate) => candidate.strategy === strategy && candidate.optionHash === expectedOptionHash);
    if (!option) throw new Error("no_show_option_not_found");
    if (live.publication) {
      if (live.publication.proposalHash === proposal.proposalHash && live.publication.approvedBy === approvedBy
        && option.optionHash === live.publication.optionHash) return snapshotOf(current);
      throw new Error("live_revision_already_published");
    }
    if (live.state.proofHash !== proposal.baseLiveStateProofHash) throw new Error("stale_live_proposal");
    if (!approvedBy.trim() || approvedBy === proposal.proposedBy) throw new Error("no_show_approval_requires_independent_actor");
    if (!Number.isFinite(Date.parse(approvedAt)) || new Date(Date.parse(approvedAt)).toISOString() !== approvedAt)
      throw new Error("invalid_no_show_approval_time");
    if (approvedAt < proposal.proposedAt) throw new Error("stale_no_show_approval_time");
    const compiled = current.compiled!;
    const artifacts = { spec: compiled.spec, graph: compiled.graph, schedule: compiled.schedule,
      ...(compiled.simulation ? { simulation: compiled.simulation } : {}) };
    if (option.competitionGuard.status !== "PASSED" || option.liveGuard.status !== "PASSED"
      || !independentlyVerifyNoShowOption(live.state, artifacts, option)
      || !preservedActualTruth(live.state.contests, option.proposedLiveState.contests))
      throw new Error("no_show_guard_blocked_publication");
    const publishedBy = "competition-journey.live-publisher" as const;
    if (approvedBy === publishedBy) throw new Error("live_publication_requires_independent_actor");
    const publicationBody = {
      changeKind: "NO_SHOW" as const,
      revision: expectedRevision + 1, baseRevision: expectedRevision, proposalHash: proposal.proposalHash,
      optionHash: option.optionHash, stateProofHash: option.proposedLiveState.proofHash,
      stateVersion: option.proposedLiveState.version, approvedBy, approvedAt,
      publishedBy, affectedContestIds: [...proposal.affectedContestIds],
      affectedEntrantIds: [...proposal.affectedEntrantIds], operationalAssignments: [...option.operationalAssignments],
      settledAsWalkoverContestIds: [...option.settledAsWalkoverContestIds],
      outboxIntents: proposal.affectedEntrantIds.map((recipientEntrantId) => ({
        topic: "competition.live-update.v1" as const,
        key: `${id}:v${expectedRevision + 1}:${recipientEntrantId}`,
        payload: { organizationId: current.organizationId, competitionId: id,
          revision: expectedRevision + 1, baseRevision: expectedRevision,
          recipientEntrantId, affectedContestIds: [...proposal.affectedContestIds],
          stateProofHash: option.proposedLiveState.proofHash,
          projection: deriveParticipantNext({ competitionId: current.id,
            competitionName: recognisedCompetitionName(current.workbench!) ?? current.proposal.blueprint.name ?? "Competition",
            publishedRevision: expectedRevision, operationalRevision: expectedRevision + 1,
            affectedParticipantIds: proposal.affectedEntrantIds, participantId: recipientEntrantId,
            participantNames: authoritativeParticipantNames(current), state: option.proposedLiveState,
            assignments: option.operationalAssignments, operation: live.operations.publicStatus }) },
      })),
    };
    const publication: LiveJourneyPublication = { ...publicationBody, publicationHash: canonicalHash(publicationBody) };
    const outbox = new InMemoryTransactionalOutbox(current.organizationId, live.delivery);
    for (const intent of publication.outboxIntents) outbox.enqueueFromCommittedEvent({
      id: `live-publication.${publication.publicationHash}`, streamId: current.id,
      streamVersion: publication.stateVersion, type: "competition.live-revision-published",
      occurredAt: approvedAt, committedAt: approvedAt, payload: intent.payload,
    }, { topic: "competition.participant-next.v1", key: intent.key, payload: intent.payload });
    const revisedLive: JourneyLiveState = { ...live, state: option.proposedLiveState, publication,
      publicationHistory: [...(live.publicationHistory ?? []), publication],
      participantRevisions: { ...live.participantRevisions,
        ...Object.fromEntries(proposal.affectedEntrantIds.map((entrantId) => [entrantId, expectedRevision + 1])) },
      contestRevisions: { ...live.contestRevisions,
        ...Object.fromEntries(proposal.affectedContestIds.map((contestId) => [contestId, expectedRevision + 1])) },
      delivery: outbox.list() };
    const revised = sealRecord({ ...withoutSeal(current), updatedAt: approvedAt, live: revisedLive });
    this.records.set(id, revised);
    this.persist();
    return snapshotOf(revised);
  }

  public proposeCourtOutage(id: string, expectedOperationalRevision: number, expectedLiveVersion: number,
    request: CourtOutageProposalRequest): CompetitionJourneySnapshot {
    const allowed = ["proposalId", "courtId", "reason", "expectedReopenAt", "proposedBy", "proposedAt"];
    if (!request || typeof request !== "object" || Object.keys(request).some((key) => !allowed.includes(key))
      || !allowed.every((key) => typeof (request as unknown as Record<string, unknown>)[key] === "string"))
      throw new Error("invalid_court_outage_request");
    const current = this.require(id);
    if (current.closure) throw new Error("competition_is_closed");
    const live = this.requireProjectedLive(current, expectedOperationalRevision);
    if (live.state.version !== expectedLiveVersion) throw new Error("live_version_conflict");
    if (live.courtOutageProposal?.proposalId === request.proposalId) {
      const existing = live.courtOutageProposal;
      const sameRequest = canonicalHash({ proposalId: existing.proposalId, courtId: existing.courtId,
        reason: existing.reason, expectedReopenAt: existing.expectedReopenAt,
        proposedBy: existing.proposedBy, proposedAt: existing.proposedAt }) === canonicalHash(request);
      if (existing.baseLiveStateProofHash === live.state.proofHash && sameRequest) return snapshotOf(current);
      throw new Error("court_outage_proposal_identity_conflict");
    }
    const compiled = current.compiled!;
    const assignments = live.publication?.operationalAssignments ?? authoritativeOperationalAssignments(compiled.schedule);
    const proposal = proposeCourtOutageRepair(expectedOperationalRevision, live.state, {
      spec: compiled.spec, graph: compiled.graph, schedule: compiled.schedule,
      ...(compiled.simulation ? { simulation: compiled.simulation } : {}),
    }, assignments, request);
    // Only one pending change can be approved at a time.  Clearing a superseded
    // no-show preview prevents a caller from accidentally rendering or approving
    // it while the active proposal is a court closure.
    const { proposal: _supersededNoShow, ...withoutPendingNoShow } = live;
    const revisedLive: JourneyLiveState = { ...withoutPendingNoShow, courtOutageProposal: proposal };
    const revised = sealRecord({ ...withoutSeal(current), updatedAt: request.proposedAt, live: revisedLive });
    this.records.set(id, revised);
    this.persist();
    return snapshotOf(revised);
  }

  public approveCourtOutage(id: string, expectedOperationalRevision: number, expectedProposalHash: string,
    approvedBy: string, approvedAt: string): CompetitionJourneySnapshot {
    return this.approveResourceChange(id, expectedOperationalRevision, expectedProposalHash,
      approvedBy, approvedAt, "COURT_OUTAGE");
  }

  public proposeDelayOverrun(id: string, expectedOperationalRevision: number, expectedLiveVersion: number,
    request: DelayOverrunProposalRequest): CompetitionJourneySnapshot {
    const allowed = ["proposalId", "contestId", "reason", "expectedEndAt", "proposedBy", "proposedAt"];
    if (!request || typeof request !== "object" || Object.keys(request).some((key) => !allowed.includes(key))
      || !allowed.every((key) => typeof (request as unknown as Record<string, unknown>)[key] === "string"))
      throw new Error("invalid_delay_overrun_request");
    const current = this.require(id);
    if (current.closure) throw new Error("competition_is_closed");
    const live = this.requireProjectedLive(current, expectedOperationalRevision);
    if (live.state.version !== expectedLiveVersion) throw new Error("live_version_conflict");
    const definition = live.state.definition.contests.find(({ contestId }) => contestId === request.contestId);
    const contest = live.state.contests[request.contestId];
    if (!definition || contest?.status !== "IN_PROGRESS" || !contest.actualCourtId)
      throw new Error("delay_overrun_requires_in_progress_contest");
    if (Date.parse(request.expectedEndAt) <= Date.parse(definition.scheduledEnd)
      || Date.parse(request.expectedEndAt) <= Date.parse(request.proposedAt))
      throw new Error("invalid_delay_overrun_request");
    if (live.courtOutageProposal?.proposalId === request.proposalId) {
      const existing = live.courtOutageProposal;
      const sameRequest = existing.incidentKind === "DELAY_OVERRUN" && existing.sourceContestId === request.contestId
        && existing.reason === request.reason && existing.expectedReopenAt === request.expectedEndAt
        && existing.proposedBy === request.proposedBy && existing.proposedAt === request.proposedAt;
      if (existing.baseLiveStateProofHash === live.state.proofHash && sameRequest) return snapshotOf(current);
      throw new Error("delay_overrun_proposal_identity_conflict");
    }
    const compiled = current.compiled!;
    const assignments = live.publication?.operationalAssignments ?? authoritativeOperationalAssignments(compiled.schedule);
    const proposal = proposeCourtOutageRepair(expectedOperationalRevision, live.state, {
      spec: compiled.spec, graph: compiled.graph, schedule: compiled.schedule,
      ...(compiled.simulation ? { simulation: compiled.simulation } : {}),
    }, assignments, { proposalId: request.proposalId, courtId: contest.actualCourtId,
      reason: request.reason, expectedReopenAt: request.expectedEndAt, proposedBy: request.proposedBy,
      proposedAt: request.proposedAt, incidentKind: "DELAY_OVERRUN", sourceContestId: request.contestId,
      closureStartsAt: definition.scheduledEnd });
    // A delay uses the same guarded operational proposal slot as a court outage.
    // Do not leave an earlier no-show proposal selectable beside it.
    const { proposal: _supersededNoShow, ...withoutPendingNoShow } = live;
    const revisedLive: JourneyLiveState = { ...withoutPendingNoShow, courtOutageProposal: proposal };
    const revised = sealRecord({ ...withoutSeal(current), updatedAt: request.proposedAt, live: revisedLive });
    this.records.set(id, revised);
    this.persist();
    return snapshotOf(revised);
  }

  public approveDelayOverrun(id: string, expectedOperationalRevision: number, expectedProposalHash: string,
    approvedBy: string, approvedAt: string): CompetitionJourneySnapshot {
    return this.approveResourceChange(id, expectedOperationalRevision, expectedProposalHash,
      approvedBy, approvedAt, "DELAY_OVERRUN");
  }

  private approveResourceChange(id: string, expectedOperationalRevision: number, expectedProposalHash: string,
    approvedBy: string, approvedAt: string, expectedKind: "COURT_OUTAGE" | "DELAY_OVERRUN"): CompetitionJourneySnapshot {
    const current = this.require(id);
    if (current.closure) throw new Error("competition_is_closed");
    const live = this.requireProjectedLive(current, expectedOperationalRevision);
    this.assertOperationalPublicationAllowed(live);
    const proposal = live.courtOutageProposal;
    if (!proposal || proposal.incidentKind !== expectedKind || proposal.proposalHash !== expectedProposalHash
      || !verifyCourtOutageProposal(proposal))
      throw new Error("court_outage_proposal_mismatch");
    if (live.publication?.changeKind === expectedKind && live.publication.proposalHash === proposal.proposalHash) {
      if (live.publication.approvedBy === approvedBy) return snapshotOf(current);
      throw new Error("court_outage_revision_already_published");
    }
    if (proposal.baseOperationalRevision !== expectedOperationalRevision
      || proposal.baseLiveStateProofHash !== live.state.proofHash) throw new Error("stale_live_proposal");
    if (!approvedBy.trim() || approvedBy === proposal.proposedBy)
      throw new Error("court_outage_approval_requires_independent_actor");
    if (!Number.isFinite(Date.parse(approvedAt)) || new Date(Date.parse(approvedAt)).toISOString() !== approvedAt
      || approvedAt < proposal.proposedAt) throw new Error("invalid_court_outage_approval_time");
    const compiled = current.compiled!;
    const assignments = live.publication?.operationalAssignments ?? authoritativeOperationalAssignments(compiled.schedule);
    const regenerated = proposeCourtOutageRepair(expectedOperationalRevision, live.state, {
      spec: compiled.spec, graph: compiled.graph, schedule: compiled.schedule,
      ...(compiled.simulation ? { simulation: compiled.simulation } : {}),
    }, assignments, { proposalId: proposal.proposalId, courtId: proposal.courtId, reason: proposal.reason,
      expectedReopenAt: proposal.expectedReopenAt, proposedBy: proposal.proposedBy, proposedAt: proposal.proposedAt,
      incidentKind: proposal.incidentKind, closureStartsAt: proposal.closureStartsAt,
      ...(proposal.sourceContestId ? { sourceContestId: proposal.sourceContestId } : {}) });
    if (regenerated.proposalHash !== proposal.proposalHash) throw new Error("court_outage_guard_blocked_publication");
    const proposedLiveState = approveCourtOutageProposal(regenerated, approvedBy, approvedAt);
    const publishedBy = "competition-journey.live-publisher" as const;
    if (approvedBy === publishedBy) throw new Error("live_publication_requires_independent_actor");
    const publicationBody = {
      changeKind: proposal.incidentKind,
      revision: expectedOperationalRevision + 1, baseRevision: expectedOperationalRevision,
      proposalHash: proposal.proposalHash, optionHash: proposal.proposalHash,
      stateProofHash: proposedLiveState.proofHash, stateVersion: proposedLiveState.version,
      approvedBy, approvedAt, publishedBy, affectedContestIds: [...proposal.affectedContestIds],
      affectedEntrantIds: [...proposal.affectedEntrantIds], operationalAssignments: [...proposal.operationalAssignments],
      settledAsWalkoverContestIds: [] as readonly string[],
      outboxIntents: proposal.affectedEntrantIds.map((recipientEntrantId) => ({
        topic: "competition.live-update.v1" as const,
        key: `${id}:v${expectedOperationalRevision + 1}:${recipientEntrantId}`,
        payload: { organizationId: current.organizationId, competitionId: id,
          revision: expectedOperationalRevision + 1, baseRevision: expectedOperationalRevision,
          recipientEntrantId, affectedContestIds: [...proposal.affectedContestIds],
          stateProofHash: proposedLiveState.proofHash,
          projection: deriveParticipantNext({ competitionId: current.id,
            competitionName: recognisedCompetitionName(current.workbench!) ?? current.proposal.blueprint.name ?? "Competition",
            publishedRevision: current.publication!.revision, operationalRevision: expectedOperationalRevision + 1,
            affectedParticipantIds: proposal.affectedEntrantIds, participantId: recipientEntrantId,
            participantNames: authoritativeParticipantNames(current), state: proposedLiveState,
            assignments: proposal.operationalAssignments, operation: live.operations.publicStatus }) },
      })),
    };
    const publication: LiveJourneyPublication = { ...publicationBody, publicationHash: canonicalHash(publicationBody) };
    const outbox = new InMemoryTransactionalOutbox(current.organizationId, live.delivery);
    for (const intent of publication.outboxIntents) outbox.enqueueFromCommittedEvent({
      id: `live-publication.${publication.publicationHash}`, streamId: current.id,
      streamVersion: publication.stateVersion, type: "competition.live-revision-published",
      occurredAt: approvedAt, committedAt: approvedAt, payload: intent.payload,
    }, { topic: "competition.participant-next.v1", key: intent.key, payload: intent.payload });
    const revisedLive: JourneyLiveState = { ...live, state: proposedLiveState, publication,
      publicationHistory: [...(live.publicationHistory ?? []), publication],
      participantRevisions: { ...live.participantRevisions,
        ...Object.fromEntries(proposal.affectedEntrantIds.map((entrantId) => [entrantId, expectedOperationalRevision + 1])) },
      contestRevisions: { ...live.contestRevisions,
        ...Object.fromEntries(proposal.affectedContestIds.map((contestId) => [contestId, expectedOperationalRevision + 1])) },
      delivery: outbox.list() };
    const revised = sealRecord({ ...withoutSeal(current), updatedAt: approvedAt, live: revisedLive });
    this.records.set(id, revised);
    this.persist();
    return snapshotOf(revised);
  }

  public closeCompetition(input: { readonly organizationId: string; readonly competitionId: string;
    readonly expectedPublishedRevision: number; readonly expectedOperationalRevision: number;
    readonly expectedLiveVersion: number; readonly acknowledgedCodes: readonly string[];
    readonly closedBy: string }): CompetitionJourneySnapshot {
    const current = this.requireScoped(input.organizationId, input.competitionId);
    if (current.closure) {
      if (current.closure.publishedRevision === input.expectedPublishedRevision
        && current.closure.operationalRevision === input.expectedOperationalRevision
        && current.closure.liveVersion === input.expectedLiveVersion
        && current.closure.closedBy === input.closedBy
        && exactAcknowledgements(current.closure.acknowledgedCodes, input.acknowledgedCodes)) return snapshotOf(current);
      throw new Error("competition_is_closed");
    }
    const live = this.requireProjectedLive(current, input.expectedOperationalRevision);
    if (current.publication!.revision !== input.expectedPublishedRevision
      || live.baseRevision !== input.expectedPublishedRevision
      || live.state.version !== input.expectedLiveVersion) throw new Error("journey_revision_conflict");
    if (!input.closedBy.trim() || input.closedBy === current.approval?.approvedBy
      || input.closedBy === current.publication!.publishedBy
      || input.closedBy === live.publication?.approvedBy) throw new Error("competition_close_requires_independent_actor");
    const replay = replayLiveOperationsEvents(live.state.definition, live.state.events);
    if (!replay.valid || replay.state.proofHash !== live.state.proofHash || !verifyOperationalSafetyState(live.operations))
      throw new Error("competition_close_replay_failed");
    const compiled = current.compiled!;
    const guard = evaluateCompetitionGuard({ sourceDefinitionHash: canonicalHash(compiled.spec), spec: compiled.spec,
      graph: compiled.graph, schedule: compiled.schedule, ...(compiled.simulation ? { simulation: compiled.simulation } : {}) });
    if (guard.status !== "PASSED" || guard.reportHash !== compiled.guardReport.reportHash)
      throw new Error("competition_close_guard_failed");
    const closedAt = this.canonicalNow();
    const latestFactAt = [...live.state.events.map(({ occurredAt }) => occurredAt),
      ...live.operations.events.map(({ command }) => command.occurredAt), current.publication!.publishedAt].sort().at(-1)!;
    if (closedAt < latestFactAt) throw new Error("competition_close_time_precedes_truth");
    const authority = closureAuthority(current)!;
    const closure = deriveCompetitionClosure({ organizationId: current.organizationId, competitionId: current.id,
      publishedRevision: current.publication!.revision,
      operationalRevision: live.publication?.revision ?? current.publication!.revision,
      closedBy: input.closedBy, closedAt, acknowledgedCodes: input.acknowledgedCodes,
      live: live.state, operations: live.operations, delivery: live.delivery, authority });
    const revised = sealRecord({ ...withoutSeal(current), updatedAt: closedAt, closure });
    this.records.set(current.id, revised);
    this.persist();
    return snapshotOf(revised);
  }

  public exportClosedBundle(input: { readonly organizationId: string; readonly competitionId: string;
    readonly expectedClosureHash: string }): CompetitionEvidenceBundle {
    const current = this.requireScoped(input.organizationId, input.competitionId);
    if (!current.closure || current.closure.closureHash !== input.expectedClosureHash)
      throw new Error("competition_closure_mismatch");
    return evidenceBundleForRecord(current);
  }

  public restoreClosedBundle(input: { readonly organizationId: string; readonly bundle: CompetitionEvidenceBundle }): {
    readonly snapshot: CompetitionJourneySnapshot & { readonly closure: CompetitionClosure };
    readonly report: ReturnType<typeof runAuthoritativeRestoreDrill>;
  } {
    if (input.organizationId !== this.organizationId || input.bundle.organizationId !== input.organizationId)
      throw new Error("competition_restore_scope_mismatch");
    const verified = verifyCompetitionEvidenceBundle(input.bundle);
    const record = verified.authoritativeRecord as StoredJourneyRecord;
    if (!record || record.organizationId !== input.organizationId || record.id !== input.bundle.competitionId
      || record.closure?.closureHash !== input.bundle.closureHash || !verifyRecord(record))
      throw new Error("invalid_competition_evidence_bundle");
    if (canonicalHash(evidenceBundleForRecord(record)) !== canonicalHash(input.bundle))
      throw new Error("invalid_competition_evidence_bundle");
    const existing = this.records.get(record.id);
    if (existing && existing.recordHash !== record.recordHash) throw new Error("competition_restore_identity_conflict");
    const restoredTruth = [{ organizationId: record.organizationId, streamId: record.id,
      streamVersion: record.live!.state.version + record.live!.operations.version + 1,
      eventHeadHash: canonicalHash({ live: record.live!.state.lastEventHash,
        operations: record.live!.operations.lastEventHash }), stateHash: record.recordHash,
      proofHashes: { closure: record.closure!.closureHash, live: record.live!.state.proofHash,
        operations: record.live!.operations.proofHash, results: record.closure!.resultSummary.resultsHash } }];
    const at = this.canonicalNow();
    const report = runAuthoritativeRestoreDrill({ drillId: `restore.${record.closure!.closureHash.slice(0, 24)}`,
      startedAt: at, completedAt: at, recoveryPointAt: input.bundle.generatedAt,
      sourceLatestCommittedAt: input.bundle.generatedAt, maximumRecoveryTimeSeconds: 300,
      maximumDataLossSeconds: 0, expectedSchemaVersion: "competition-journey-closure-bundle/1.0.0",
      manifest: input.bundle.manifest, restoredArtifacts: verified.restoredArtifacts,
      sourceTruth: input.bundle.sourceTruth, restoredTruth });
    if (report.status !== "VERIFIED") throw new Error("competition_restore_verification_failed");
    if (!existing) {
      this.records.set(record.id, record);
      this.persist();
    }
    return { snapshot: snapshotOf(record) as CompetitionJourneySnapshot & { closure: CompetitionClosure }, report };
  }

  public duplicateClosed(input: { readonly organizationId: string; readonly competitionId: string;
    readonly expectedClosureHash: string; readonly name: string; readonly eventDate: string;
    readonly createdBy: string }): CompetitionJourneySnapshot {
    const current = this.requireScoped(input.organizationId, input.competitionId);
    if (!current.closure || current.closure.closureHash !== input.expectedClosureHash)
      throw new Error("competition_closure_mismatch");
    const name = input.name.trim();
    if (name.length < 2 || name.length > 120 || !/^\d{4}-\d{2}-\d{2}$/.test(input.eventDate)
      || !Number.isFinite(Date.parse(`${input.eventDate}T00:00:00.000Z`)) || !input.createdBy.trim())
      throw new Error("invalid_competition_duplicate");
    const memoryIdentity = { sourceCompetitionId: current.id, sourceClosureHash: current.closure.closureHash,
      newEditionName: name, newEventDate: input.eventDate };
    const memoryHash = canonicalHash(memoryIdentity);
    const existing = [...this.records.values()].find((record) => record.duplication?.memoryHash === memoryHash);
    if (existing) return snapshotOf(existing);
    const duplicatedAt = this.canonicalNow();
    const baseSources = (current.sources ?? [current.source]).filter((candidate) => {
      if (candidate.mode !== "quick" || !candidate.value || typeof candidate.value !== "object" || Array.isArray(candidate.value)) return true;
      return (candidate.value as Record<string, unknown>).kind !== "structured-organiser-edit";
    });
    const proposalSource = baseSources.find(({ mode }) => mode === "json" || mode === "yaml") ?? baseSources[0]!;
    const workbench = analyseCompetitionSources(baseSources, duplicatedAt);
    const carried = workbenchDecisionValues(current.workbench!);
    const edits = Object.entries({ ...carried, "event-name": name, "event-date": input.eventDate })
      .map(([id, value]) => ({ id, value })).sort((left, right) => left.id.localeCompare(right.id));
    const preview = planWorkbenchEdit(workbench, 1, edits, input.createdBy);
    const editSource: CreationSource = { mode: "quick", value: { kind: "structured-organiser-edit",
      editedBy: input.createdBy, previewHash: preview.previewHash, edits } };
    const revisedWorkbench = applyWorkbenchEdit(workbench, preview, workbenchSourceDocument(editSource, duplicatedAt));
    const memoryBody = { sourceCompetitionId: current.id, sourceClosureHash: current.closure.closureHash,
      sourceDocumentHashes: [...new Set((current.workbench?.sources ?? []).map(({ sourceHash }) => sourceHash))].sort(),
      carriedDecisionIds: edits.map(({ id }) => id), newEditionName: name, newEventDate: input.eventDate,
      duplicatedBy: input.createdBy, duplicatedAt };
    const duplication: JourneyDuplication = { ...memoryBody, memoryHash };
    const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "competition";
    const id = `${base}.${canonicalHash({ sourceClosureHash: input.expectedClosureHash, name,
      eventDate: input.eventDate }).slice(0, 10)}`;
    if (this.records.has(id)) throw new Error("competition_duplicate_identity_conflict");
    const record = sealRecord({ id, organizationId: current.organizationId, draftVersion: 2,
      createdBy: input.createdBy, createdAt: duplicatedAt, updatedAt: duplicatedAt,
      source: editSource, sources: [...baseSources, editSource], proposal: createCompetitionProposal(proposalSource),
      workbench: revisedWorkbench, supportFindings: [], duplication });
    this.records.set(id, record);
    this.persist();
    return snapshotOf(record);
  }

  public issueParticipantAccess(input: { readonly organizationId: string; readonly competitionId: string;
    readonly expectedPublishedRevision: number; readonly participantId: string; readonly expiresAt: string }): ParticipantAccess {
    const current = this.requireScoped(input.organizationId, input.competitionId);
    if (!current.publication || !current.live || current.publication.revision !== input.expectedPublishedRevision
      || current.live.baseRevision !== input.expectedPublishedRevision) throw new Error("journey_revision_conflict");
    const knownParticipants = new Set(current.live.state.definition.contests.flatMap(({ entrantIds }) => entrantIds));
    if (!knownParticipants.has(input.participantId)) throw new Error("participant_access_denied");
    const issuedAt = this.canonicalNow();
    if (Date.parse(input.expiresAt) <= Date.parse(issuedAt)) throw new Error("invalid_participant_access_grant");
    const activeSecret = this.participantTokenKeys[this.participantTokenKeyVersion];
    if (!activeSecret) throw new Error("participant_signing_not_configured");
    const { grant, access } = createParticipantAccessGrant({ organizationId: input.organizationId,
      competitionId: input.competitionId, publishedRevision: input.expectedPublishedRevision,
      participantId: input.participantId, expiresAt: input.expiresAt,
      keyVersion: this.participantTokenKeyVersion }, activeSecret,
    current.live.publication?.revision ?? current.live.baseRevision);
    const grants = current.participantAccess ?? [];
    if (grants.some((candidate) => candidate.tokenHash === grant.tokenHash && candidate.revokedAt))
      throw new Error("participant_access_revoked");
    if (!grants.some(({ tokenHash }) => tokenHash === grant.tokenHash)) {
      const revised = sealRecord({ ...withoutSeal(current), updatedAt: issuedAt, participantAccess: [...grants, grant]
        .sort((left, right) => left.participantId.localeCompare(right.participantId) || left.expiresAt.localeCompare(right.expiresAt)) });
      this.records.set(current.id, revised);
      this.persist();
    }
    return access;
  }

  public rotateParticipantAccess(input: { readonly organizationId: string; readonly competitionId: string;
    readonly expectedPublishedRevision: number; readonly expectedOperationalRevision: number;
    readonly participantId: string; readonly expiresAt: string; readonly commandId: string;
    readonly actorId: string; readonly reason: string }): ParticipantAccess {
    const current = this.requireScoped(input.organizationId, input.competitionId);
    const requestHash = canonicalHash(input);
    const prior = (current.participantAccessEvents ?? []).find(({ commandId }) => commandId === input.commandId);
    if (prior) {
      if (prior.kind !== "ROTATED" || prior.requestHash !== requestHash || !prior.resultCredentialHash)
        throw new Error("participant_access_command_conflict");
      const grant = (current.participantAccess ?? []).find(({ tokenHash }) => tokenHash === prior.resultCredentialHash);
      const secret = grant && this.participantTokenKeys[grant.keyVersion];
      if (!grant || !secret) throw new Error("participant_signing_not_configured");
      return createParticipantAccessGrant({ organizationId: grant.organizationId, competitionId: grant.competitionId,
        publishedRevision: grant.publishedRevision, participantId: grant.participantId, expiresAt: grant.expiresAt,
        keyVersion: grant.keyVersion, ...(grant.issuedAt ? { issuedAt: grant.issuedAt } : {}),
        ...(grant.issuedByCommandId ? { issuedByCommandId: grant.issuedByCommandId } : {}) }, secret,
      current.live?.publication?.revision ?? current.live?.baseRevision ?? grant.publishedRevision).access;
    }
    const live = this.requireProjectedLive(current, input.expectedOperationalRevision);
    if (current.publication!.revision !== input.expectedPublishedRevision || live.baseRevision !== input.expectedPublishedRevision)
      throw new Error("journey_revision_conflict");
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{2,199}$/.test(input.commandId) || !input.actorId.trim()
      || input.reason.trim().length < 4 || input.reason.length > 500) throw new Error("invalid_participant_access_command");
    const knownParticipants = new Set(live.state.definition.contests.flatMap(({ entrantIds }) => entrantIds));
    if (!knownParticipants.has(input.participantId)) throw new Error("participant_access_denied");
    const occurredAt = this.canonicalNow();
    if (!validParticipantCredentialTimestamp(input.expiresAt) || Date.parse(input.expiresAt) <= Date.parse(occurredAt))
      throw new Error("invalid_participant_access_grant");
    const secret = this.participantTokenKeys[this.participantTokenKeyVersion];
    if (!secret) throw new Error("participant_signing_not_configured");
    const revokedAccess = (current.participantAccess ?? []).map((grant) => grant.participantId === input.participantId
      && !grant.revokedAt ? { ...grant, revokedAt: occurredAt, revokedBy: input.actorId,
        revocationReason: input.reason.trim(), revokedByCommandId: input.commandId } : grant);
    const revokedRecovery = (current.participantRecovery ?? []).map((grant) => grant.participantId === input.participantId
      && !grant.revokedAt ? { ...grant, revokedAt: occurredAt, revokedByCommandId: input.commandId } : grant);
    const affectedCredentialHashes = [...(current.participantAccess ?? []).filter((grant) =>
      grant.participantId === input.participantId && !grant.revokedAt).map(({ tokenHash }) => tokenHash),
    ...(current.participantRecovery ?? []).filter((grant) => grant.participantId === input.participantId && !grant.revokedAt)
      .map(({ codeHash }) => codeHash)].sort();
    const created = createParticipantAccessGrant({ organizationId: input.organizationId,
      competitionId: input.competitionId, publishedRevision: input.expectedPublishedRevision,
      participantId: input.participantId, expiresAt: input.expiresAt, keyVersion: this.participantTokenKeyVersion,
      issuedAt: occurredAt, issuedByCommandId: input.commandId }, secret, input.expectedOperationalRevision);
    const events = current.participantAccessEvents ?? [];
    const event = nextParticipantAccessEvent(events, { commandId: input.commandId, requestHash, kind: "ROTATED",
      participantId: input.participantId, actorId: input.actorId, occurredAt, affectedCredentialHashes,
      resultCredentialHash: created.grant.tokenHash });
    const revised = sealRecord({ ...withoutSeal(current), updatedAt: occurredAt,
      participantAccess: [...revokedAccess, created.grant].sort((left, right) =>
        left.participantId.localeCompare(right.participantId) || left.expiresAt.localeCompare(right.expiresAt)
        || left.tokenHash.localeCompare(right.tokenHash)), participantRecovery: revokedRecovery,
      participantAccessEvents: [...events, event] });
    this.records.set(current.id, revised);
    this.persist();
    return created.access;
  }

  public revokeParticipantAccess(input: { readonly organizationId: string; readonly competitionId: string;
    readonly expectedPublishedRevision: number; readonly expectedOperationalRevision: number;
    readonly participantId: string; readonly commandId: string; readonly actorId: string;
    readonly reason: string }): { readonly status: "REVOKED"; readonly revokedGrantCount: number } {
    const current = this.requireScoped(input.organizationId, input.competitionId);
    const requestHash = canonicalHash(input);
    const prior = (current.participantAccessEvents ?? []).find(({ commandId }) => commandId === input.commandId);
    if (prior) {
      if (prior.kind !== "REVOKED" || prior.requestHash !== requestHash)
        throw new Error("participant_access_command_conflict");
      return { status: "REVOKED", revokedGrantCount: prior.affectedCredentialHashes.length };
    }
    const live = this.requireProjectedLive(current, input.expectedOperationalRevision);
    if (current.publication!.revision !== input.expectedPublishedRevision || live.baseRevision !== input.expectedPublishedRevision)
      throw new Error("journey_revision_conflict");
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{2,199}$/.test(input.commandId) || !input.actorId.trim()
      || input.reason.trim().length < 4 || input.reason.length > 500) throw new Error("invalid_participant_access_command");
    const knownParticipants = new Set(live.state.definition.contests.flatMap(({ entrantIds }) => entrantIds));
    if (!knownParticipants.has(input.participantId)) throw new Error("participant_access_denied");
    const occurredAt = this.canonicalNow();
    const activeAccess = (current.participantAccess ?? []).filter((grant) =>
      grant.participantId === input.participantId && !grant.revokedAt);
    const activeRecovery = (current.participantRecovery ?? []).filter((grant) =>
      grant.participantId === input.participantId && !grant.revokedAt);
    const affectedCredentialHashes = [...activeAccess.map(({ tokenHash }) => tokenHash),
      ...activeRecovery.map(({ codeHash }) => codeHash)].sort();
    const participantAccess = (current.participantAccess ?? []).map((grant) => activeAccess.includes(grant)
      ? { ...grant, revokedAt: occurredAt, revokedBy: input.actorId, revocationReason: input.reason.trim(),
        revokedByCommandId: input.commandId } : grant);
    const participantRecovery = (current.participantRecovery ?? []).map((grant) => activeRecovery.includes(grant)
      ? { ...grant, revokedAt: occurredAt, revokedByCommandId: input.commandId } : grant);
    const events = current.participantAccessEvents ?? [];
    const event = nextParticipantAccessEvent(events, { commandId: input.commandId, requestHash, kind: "REVOKED",
      participantId: input.participantId, actorId: input.actorId, occurredAt, affectedCredentialHashes });
    const revised = sealRecord({ ...withoutSeal(current), updatedAt: occurredAt, participantAccess,
      participantRecovery, participantAccessEvents: [...events, event] });
    this.records.set(current.id, revised);
    this.persist();
    return { status: "REVOKED", revokedGrantCount: affectedCredentialHashes.length };
  }

  public issueParticipantRecoveryCode(input: { readonly organizationId: string; readonly competitionId: string;
    readonly expectedPublishedRevision: number; readonly expectedOperationalRevision: number;
    readonly participantId: string; readonly codeExpiresAt: string; readonly accessExpiresAt: string;
    readonly commandId: string; readonly actorId: string }): ParticipantRecoveryCode {
    const current = this.requireScoped(input.organizationId, input.competitionId);
    const requestHash = canonicalHash(input);
    const prior = (current.participantAccessEvents ?? []).find(({ commandId }) => commandId === input.commandId);
    if (prior) {
      if (prior.kind !== "RECOVERY_ISSUED" || prior.requestHash !== requestHash || !prior.resultCredentialHash)
        throw new Error("participant_access_command_conflict");
      const grant = (current.participantRecovery ?? []).find(({ codeHash }) => codeHash === prior.resultCredentialHash);
      const secret = grant && this.participantTokenKeys[grant.keyVersion];
      if (!grant || !secret) throw new Error("participant_signing_not_configured");
      return createParticipantRecoveryGrant({ organizationId: grant.organizationId,
        competitionId: grant.competitionId, publishedRevision: grant.publishedRevision,
        operationalRevision: grant.operationalRevision,
        participantId: grant.participantId, codeExpiresAt: grant.codeExpiresAt,
        accessExpiresAt: grant.accessExpiresAt, keyVersion: grant.keyVersion, issuedAt: grant.issuedAt,
        issuedBy: grant.issuedBy, issuedByCommandId: grant.issuedByCommandId, requestHash: grant.requestHash },
      secret).recovery;
    }
    const live = this.requireProjectedLive(current, input.expectedOperationalRevision);
    if (current.publication!.revision !== input.expectedPublishedRevision || live.baseRevision !== input.expectedPublishedRevision)
      throw new Error("journey_revision_conflict");
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{2,199}$/.test(input.commandId) || !input.actorId.trim())
      throw new Error("invalid_participant_access_command");
    const knownParticipants = new Set(live.state.definition.contests.flatMap(({ entrantIds }) => entrantIds));
    if (!knownParticipants.has(input.participantId)) throw new Error("participant_access_denied");
    const occurredAt = this.canonicalNow();
    const secret = this.participantTokenKeys[this.participantTokenKeyVersion];
    if (!secret) throw new Error("participant_signing_not_configured");
    const created = createParticipantRecoveryGrant({ organizationId: input.organizationId,
      competitionId: input.competitionId, publishedRevision: input.expectedPublishedRevision,
      operationalRevision: input.expectedOperationalRevision,
      participantId: input.participantId, codeExpiresAt: input.codeExpiresAt,
      accessExpiresAt: input.accessExpiresAt, keyVersion: this.participantTokenKeyVersion,
      issuedAt: occurredAt, issuedBy: input.actorId, issuedByCommandId: input.commandId, requestHash }, secret);
    const existing = current.participantRecovery ?? [];
    if (existing.some(({ codeHash }) => codeHash === created.grant.codeHash))
      throw new Error("participant_recovery_conflict");
    const events = current.participantAccessEvents ?? [];
    const event = nextParticipantAccessEvent(events, { commandId: input.commandId, requestHash,
      kind: "RECOVERY_ISSUED", participantId: input.participantId, actorId: input.actorId,
      occurredAt, affectedCredentialHashes: [], resultCredentialHash: created.grant.codeHash });
    const revised = sealRecord({ ...withoutSeal(current), updatedAt: occurredAt,
      participantRecovery: [...existing, created.grant].sort((left, right) =>
        left.participantId.localeCompare(right.participantId) || left.codeHash.localeCompare(right.codeHash)),
      participantAccessEvents: [...events, event] });
    this.records.set(current.id, revised);
    this.persist();
    return created.recovery;
  }

  public recoverParticipantAccess(input: { readonly organizationId: string; readonly competitionId: string;
    readonly expectedOperationalRevision: number; readonly code: string; readonly at: string }): ParticipantAccess {
    const current = this.requireScoped(input.organizationId, input.competitionId);
    const live = this.requireProjectedLive(current, input.expectedOperationalRevision);
    const recovery = resolveParticipantRecovery(current.participantRecovery ?? [], input.code,
      this.participantTokenKeys, input.organizationId, input.competitionId, input.at);
    if (recovery.publishedRevision !== current.publication!.revision
      || Date.parse(recovery.accessExpiresAt) <= Date.parse(input.at)) throw new Error("participant_recovery_denied");
    const secret = this.participantTokenKeys[recovery.keyVersion];
    if (!secret) throw new Error("participant_recovery_denied");
    const created = createParticipantAccessGrant({ organizationId: recovery.organizationId,
      competitionId: recovery.competitionId, publishedRevision: recovery.publishedRevision,
      participantId: recovery.participantId, expiresAt: recovery.accessExpiresAt,
      keyVersion: recovery.keyVersion, issuedAt: recovery.issuedAt,
      issuedByCommandId: `recovery:${recovery.issuedByCommandId}` }, secret,
    live.publication?.revision ?? live.baseRevision);
    const grants = current.participantAccess ?? [];
    const existing = grants.find(({ tokenHash }) => tokenHash === created.grant.tokenHash);
    if (existing?.revokedAt) throw new Error("participant_recovery_denied");
    if (!existing) {
      const revised = sealRecord({ ...withoutSeal(current), updatedAt: this.canonicalNow(),
        participantAccess: [...grants, created.grant].sort((left, right) =>
          left.participantId.localeCompare(right.participantId) || left.expiresAt.localeCompare(right.expiresAt)
          || left.tokenHash.localeCompare(right.tokenHash)) });
      this.records.set(current.id, revised);
      this.persist();
    }
    return created.access;
  }

  public readParticipantNext(input: { readonly organizationId: string; readonly competitionId: string;
    readonly expectedOperationalRevision: number; readonly token: string; readonly at: string }): ParticipantNextProjection {
    const current = this.requireScoped(input.organizationId, input.competitionId);
    const live = this.requireProjectedLive(current, input.expectedOperationalRevision);
    const grant = resolveParticipantAccess(current.participantAccess ?? [], input.token, this.participantTokenKeys,
      input.organizationId, input.competitionId, input.at);
    if (grant.publishedRevision !== current.publication!.revision) throw new Error("participant_access_denied");
    return deriveParticipantNext({ competitionId: current.id,
      competitionName: recognisedCompetitionName(current.workbench!) ?? current.proposal.blueprint.name ?? "Competition",
      publishedRevision: current.publication!.revision, operationalRevision: input.expectedOperationalRevision,
      affectedParticipantIds: live.publication?.affectedEntrantIds ?? [], participantId: grant.participantId,
      participantRevisions: live.participantRevisions,
      participantNames: authoritativeParticipantNames(current), state: live.state,
      assignments: live.publication?.operationalAssignments ?? current.compiled!.schedule.contests,
      operation: live.operations.publicStatus });
  }

  public readPublicLive(input: { readonly organizationId: string; readonly competitionId: string;
    readonly expectedOperationalRevision: number }): PublicLiveProjection {
    const current = this.requireScoped(input.organizationId, input.competitionId);
    const live = this.requireProjectedLive(current, input.expectedOperationalRevision);
    // A later repair can retain an earlier walkover's removed assignment.  The
    // public projection must still render that prior, authoritative outcome,
    // rather than treating only the most recent publication as the whole plan.
    const affectedContestIds = [...new Set((live.publicationHistory ?? [])
      .flatMap((publication) => publication.affectedContestIds))];
    return derivePublicLive({ competitionId: current.id,
      competitionName: recognisedCompetitionName(current.workbench!) ?? current.proposal.blueprint.name ?? "Competition",
      publishedRevision: current.publication!.revision, operationalRevision: input.expectedOperationalRevision,
      affectedContestIds,
      contestRevisions: live.contestRevisions,
      participantNames: authoritativeParticipantNames(current), state: live.state,
      assignments: live.publication?.operationalAssignments ?? current.compiled!.schedule.contests,
      operation: live.operations.publicStatus });
  }

  public readOrganiserLive(input: { readonly organizationId: string; readonly competitionId: string;
    readonly expectedOperationalRevision: number; readonly at: string }): OrganiserLiveProjection {
    const current = this.requireScoped(input.organizationId, input.competitionId);
    const live = this.requireProjectedLive(current, input.expectedOperationalRevision);
    if (!Number.isFinite(Date.parse(input.at)) || new Date(Date.parse(input.at)).toISOString() !== input.at)
      throw new Error("invalid_projection_time");
    const participantNames = authoritativeParticipantNames(current);
    const participantIds = [...new Set(live.state.definition.contests.flatMap(({ entrantIds }) => entrantIds))].sort();
    const assignments = live.publication?.operationalAssignments ?? current.compiled!.schedule.contests;
    const participants = participantIds.map((participantId) => {
      const projection = deriveParticipantNext({ competitionId: current.id,
        competitionName: recognisedCompetitionName(current.workbench!) ?? current.proposal.blueprint.name ?? "Competition",
        publishedRevision: current.publication!.revision, operationalRevision: input.expectedOperationalRevision,
        affectedParticipantIds: live.publication?.affectedEntrantIds ?? [], participantRevisions: live.participantRevisions,
        participantId, participantNames, state: live.state, assignments, operation: live.operations.publicStatus });
      return { participantId, displayName: projection.participant.displayName,
        status: projection.participant.status, revision: projection.revision,
        projectionHash: projection.projectionHash };
    });
    const publicProjection = this.readPublicLive(input);
    const publicContests = new Map(publicProjection.contests.map((contest) => [contest.contestId, contest]));
    const controlContests = live.state.definition.contests.map((contest) => {
      const publicContest = publicContests.get(contest.contestId);
      if (!publicContest) throw new Error("organiser_control_contest_missing_public_projection");
      const resolved = live.state.resolvedEntrants[contest.contestId] ?? [];
      return { contestId: contest.contestId,
        courtId: live.state.contests[contest.contestId]?.actualCourtId ?? contest.courtId,
        scheduledStart: contest.scheduledStart,
        status: publicContest.status,
        sidesResolved: resolved.length === 2,
        sides: resolved.map((entrantId) => ({ entrantId,
          displayName: participantNames[entrantId] ?? entrantId })) };
    }).filter(({ sidesResolved }) => sidesResolved);
    const controlRoom = deriveLiveControlRoom(live.state, input.at);
    const attention = [
      ...controlRoom.now.map((row) => ({ kind: "NOW" as const, ...row, reasons: [] })),
      ...controlRoom.next.map((row) => ({ kind: "NEXT" as const, ...row, reasons: [] })),
      ...controlRoom.late.map((row) => ({ kind: "LATE" as const, ...row,
        reasons: [`${row.minutesLate} minutes late`] })),
      ...controlRoom.blocked.map((row) => ({ kind: "BLOCKED" as const, contestId: row.contestId,
        courtId: row.courtId, scheduledStart: row.scheduledStart,
        reasons: row.reasons.map((reason) => `${reason.code}: ${reason.subjectIds.join(", ")}`) })),
      ...controlRoom.unreported.map((row) => ({ kind: "NEEDS_ATTENTION" as const, ...row,
        reasons: ["Result receipt is missing"] })),
    ];
    const deliveryEvidence = live.delivery.map((message) => ({ messageId: message.id,
      recipientParticipantId: String((message.payload as Record<string, unknown>).recipientEntrantId ?? ""),
      status: message.status, attempts: message.attempts,
      ...(message.providerId ? { providerId: message.providerId } : {}),
      ...(message.providerMessageId ? { providerMessageId: message.providerMessageId } : {}),
      ...(message.deliveredAt ? { deliveredAt: message.deliveredAt } : {}) }));
    const accessEvidence = (current.participantAccessEvents ?? []).map((event) => ({
      commandId: event.commandId, kind: event.kind, participantId: event.participantId,
      actorId: event.actorId, occurredAt: event.occurredAt,
      affectedCredentialCount: event.affectedCredentialHashes.length,
      replacementIssued: event.resultCredentialHash !== undefined,
    }));
    const body = { apiVersion: "1.0" as const, organizationId: input.organizationId,
      public: publicProjection, liveVersion: live.state.version, stateProofHash: live.state.proofHash,
      authorityAssignments: live.operations.authorityAssignments, incidents: live.operations.incidents,
      restartClearances: live.operations.restartClearances, participants, controlContests, attention,
      deliveryEvidence, accessEvidence };
    return { ...body, projectionHash: canonicalHash(body) };
  }

  public issueOfflineEventPack(input: { readonly organizationId: string; readonly competitionId: string;
    readonly expectedPublishedRevision: number; readonly expectedOperationalRevision: number;
    readonly expiresAt: string }): SignedOfflineEventPack {
    const current = this.requireScoped(input.organizationId, input.competitionId);
    const live = this.requireProjectedLive(current, input.expectedOperationalRevision);
    if (current.publication!.revision !== input.expectedPublishedRevision
      || live.baseRevision !== input.expectedPublishedRevision) throw new Error("journey_revision_conflict");
    const generatedAt = this.canonicalNow();
    const expiry = Date.parse(input.expiresAt);
    if (!Number.isFinite(expiry) || new Date(expiry).toISOString() !== input.expiresAt
      || expiry <= Date.parse(generatedAt) || expiry > Date.parse(generatedAt) + 24 * 60 * 60_000)
      throw new Error("invalid_offline_pack_expiry");
    const participantNames = authoritativeParticipantNames(current);
    const participantIds = [...new Set(live.state.definition.contests.flatMap(({ entrantIds }) => entrantIds))].sort();
    const assignments = live.publication?.operationalAssignments ?? current.compiled!.schedule.contests;
    const competitionName = recognisedCompetitionName(current.workbench!) ?? current.proposal.blueprint.name ?? "Competition";
    const publicProjection = this.readPublicLive({ organizationId: input.organizationId,
      competitionId: input.competitionId, expectedOperationalRevision: input.expectedOperationalRevision });
    const participantLookup = participantIds.map((participantId) => ({ participantId,
      projection: deriveParticipantNext({ competitionId: current.id, competitionName,
        publishedRevision: current.publication!.revision, operationalRevision: input.expectedOperationalRevision,
        affectedParticipantIds: live.publication?.affectedEntrantIds ?? [], participantRevisions: live.participantRevisions,
        participantId, participantNames, state: live.state, assignments, operation: live.operations.publicStatus }) }));
    const participantAccess: ManualParticipantAccess[] = [];
    const grants = [...(current.participantAccess ?? [])];
    const participantSecret = this.participantTokenKeys[this.participantTokenKeyVersion];
    if (participantSecret) {
      for (const participantId of participantIds) {
        const created = createParticipantAccessGrant({ organizationId: input.organizationId,
          competitionId: current.id, publishedRevision: current.publication!.revision, participantId,
          expiresAt: input.expiresAt, keyVersion: this.participantTokenKeyVersion }, participantSecret,
        input.expectedOperationalRevision);
        if (grants.some((grant) => grant.tokenHash === created.grant.tokenHash && grant.revokedAt))
          throw new Error("participant_access_revoked");
        participantAccess.push({ participantId, accessPath: created.access.path, expiresAt: created.access.expiresAt });
        if (!grants.some(({ tokenHash }) => tokenHash === created.grant.tokenHash)) grants.push(created.grant);
      }
    }
    const truthReferences = { publicationCertificateHash: current.publication!.certificateHash,
      definitionHash: current.publication!.definitionHash, guardReportHash: current.publication!.guardReportHash,
      stateProofHash: live.state.proofHash, operationalStateProofHash: live.operations.proofHash };
    const manualFallback = deriveManualFallbackPack({ competitionId: current.id,
      publishedRevision: current.publication!.revision, operationalRevision: input.expectedOperationalRevision,
      generatedAt, expiresAt: input.expiresAt, publicProjection, participantLookup, participantAccess, truthReferences });
    const signed = signOfflineEventPack({ schemaVersion: "1.1.0", organizationId: input.organizationId,
      competitionId: current.id, competitionName, publishedRevision: current.publication!.revision,
      operationalRevision: input.expectedOperationalRevision, liveVersion: live.state.version,
      generatedAt, expiresAt: input.expiresAt, timezone: current.compiled!.spec.scheduling.timezone,
      authority: { ...truthReferences, manualFallbackHash: manualFallback.packHash },
      operation: live.operations.publicStatus, publicProjection, participantLookup, manualFallback,
      emergencyReadiness: { status: "BLOCKED_MISSING_AUTHORITY_DATA",
        missingDecisionCodes: ["AED_AND_FIRST_AID_LOCATION", "AMBULANCE_ACCESS", "EMERGENCY_CONTACT_NUMBER",
          "EVACUATION_AND_ASSEMBLY", "INCIDENT_LIAISON", "NAMED_RESPONDERS_AND_BACKUPS",
          "PRINTED_COPY_REHEARSAL", "VENUE_ADDRESS"], emergencyContacts: [], instructions: [] } },
    this.offlinePackSigningSeedHex);
    if (grants.length !== (current.participantAccess ?? []).length) {
      const revised = sealRecord({ ...withoutSeal(current), updatedAt: generatedAt,
        participantAccess: grants.sort((left, right) => left.participantId.localeCompare(right.participantId)
          || left.expiresAt.localeCompare(right.expiresAt)) });
      this.records.set(current.id, revised);
      this.persist();
    }
    return signed;
  }

  public participantDeliveryStore(organizationId: string, competitionId: string): OutboxDeliveryStore {
    const mutate = <T>(at: string, operation: (outbox: InMemoryTransactionalOutbox) => T): T => {
      const current = this.requireScoped(organizationId, competitionId);
      if (!current.live) throw new Error("journey_revision_conflict");
      const outbox = new InMemoryTransactionalOutbox(organizationId, current.live.delivery);
      const result = operation(outbox);
      const revised = sealRecord({ ...withoutSeal(current), updatedAt: at,
        live: { ...current.live, delivery: outbox.list() } });
      this.records.set(current.id, revised);
      this.persist();
      return result;
    };
    return {
      claim: (options) => mutate(options.now, (outbox) => outbox.claim(options)),
      acknowledge: (options) => mutate(options.now, (outbox) => outbox.acknowledge(options)),
      retry: (options) => mutate(options.now, (outbox) => outbox.retry(options)),
      recoverExpiredLeases: (now) => mutate(now, (outbox) => outbox.recoverExpiredLeases(now)),
    };
  }

  private require(id: string): StoredJourneyRecord {
    const record = this.records.get(id);
    if (!record) throw new Error("journey_not_found");
    return record;
  }

  private requireScoped(organizationId: string, id: string): StoredJourneyRecord {
    const record = this.records.get(id);
    if (!record || record.organizationId !== organizationId) throw new Error("journey_not_found");
    return record;
  }

  private requireProjectedLive(record: StoredJourneyRecord, expectedOperationalRevision: number): JourneyLiveState {
    if (!record.compiled || !record.publication || !record.live) throw new Error("journey_revision_conflict");
    const revision = record.live.publication?.revision ?? record.publication.revision;
    if (revision !== expectedOperationalRevision) throw new Error("journey_revision_conflict");
    return record.live;
  }

  private requireLive(record: StoredJourneyRecord, expectedRevision: number): JourneyLiveState {
    if (!record.compiled || !record.publication || record.compiled.revision !== expectedRevision
      || record.publication.revision !== expectedRevision) throw new Error("journey_revision_conflict");
    if (!record.live || record.live.baseRevision !== expectedRevision) throw new Error("live_not_activated");
    return record.live;
  }

  private assertOperationalPublicationAllowed(live: JourneyLiveState): void {
    if (live.operations.mode === "STOPPED" || live.operations.mode === "CANCELLED")
      throw new Error("operational_mode_blocks_publication");
  }

  private canonicalNow(): string {
    const value = this.now();
    if (!Number.isFinite(Date.parse(value)) || new Date(Date.parse(value)).toISOString() !== value) throw new Error("journey_clock_is_not_canonical");
    return value;
  }

  private load(): void {
    if (!this.storagePath) return;
    let text: string;
    try { text = readFileSync(this.storagePath, "utf8"); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    const envelope = JSON.parse(text) as StoredJourneyEnvelope;
    if (envelope.schemaVersion !== "1.0.0" || canonicalHash(envelope.records) !== envelope.storeHash
      || !envelope.records.every(verifyRecord)) throw new Error("journey_store_integrity_failed");
    for (const record of envelope.records) if (record.live && canonicalHash(record.live.operations.authorityAssignments)
      !== canonicalHash(this.operationalAuthorityAssignments)) throw new Error("journey_store_integrity_failed");
    this.records = new Map(envelope.records.map((record) => [record.id, record]));
  }

  private persist(): void {
    if (!this.storagePath) return;
    const records = [...this.records.values()].sort((left, right) => left.id.localeCompare(right.id));
    const envelope: StoredJourneyEnvelope = { schemaVersion: "1.0.0", records, storeHash: canonicalHash(records) };
    mkdirSync(dirname(this.storagePath), { recursive: true });
    const temporary = `${this.storagePath}.${process.pid}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(envelope, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    renameSync(temporary, this.storagePath);
  }
}

function withoutSeal(record: StoredJourneyRecord): Omit<StoredJourneyRecord, "recordHash"> {
  const { recordHash: _, ...body } = record;
  return body;
}

export function parseCreationSource(value: unknown): CreationSource {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid_creation_source");
  const record = value as Record<string, unknown>;
  if (record.mode === "language" && typeof record.text === "string" && Object.keys(record).every((key) => ["mode", "text"].includes(key)))
    return { mode: "language", text: record.text };
  if (record.mode === "json" && typeof record.text === "string" && Object.keys(record).every((key) => ["mode", "text"].includes(key)))
    return validCreationSourceText(record.text) ? { mode: "json", text: record.text } : (() => { throw new Error("invalid_creation_source"); })();
  if (record.mode === "yaml" && typeof record.text === "string" && validCreationSourceText(record.text)
    && Object.keys(record).every((key) => ["mode", "text"].includes(key))) return { mode: "yaml", text: record.text };
  if (record.mode === "csv" && typeof record.text === "string" && validCreationSourceText(record.text)
    && Object.keys(record).every((key) => ["mode", "text"].includes(key))) return { mode: "csv", text: record.text };
  if (record.mode === "xlsx" && typeof record.fileName === "string" && /^[^/\\\0]{1,160}\.xlsx$/i.test(record.fileName)
    && typeof record.base64 === "string" && validBase64Xlsx(record.base64)
    && Object.keys(record).every((key) => ["mode", "fileName", "base64"].includes(key)))
    return { mode: "xlsx", fileName: record.fileName, base64: record.base64 };
  if (record.mode === "quick" && Object.keys(record).every((key) => ["mode", "value"].includes(key)))
    return { mode: "quick", value: record.value };
  throw new Error("invalid_creation_source");
}

export function parseConnectedLiveCommand(value: unknown, actorId: string, occurredAt: string): LiveOperationsCommand {
  if (!value || typeof value !== "object" || Array.isArray(value) || !actorId.trim())
    throw new Error("invalid_live_command");
  const command = value as Record<string, unknown>;
  if (typeof command.kind !== "string" || typeof command.commandId !== "string"
    || !Number.isSafeInteger(command.expectedVersion)) throw new Error("invalid_live_command");
  const exact = (keys: readonly string[]) => Object.keys(command).every((key) => keys.includes(key));
  const audit = { commandId: command.commandId, expectedVersion: command.expectedVersion as number, actorId, occurredAt };
  if (command.kind === "CHECK_IN" && typeof command.entrantId === "string"
    && exact(["kind", "commandId", "expectedVersion", "entrantId"]))
    return { ...audit, kind: "CHECK_IN", entrantId: command.entrantId };
  if (command.kind === "MARK_LATE" && typeof command.entrantId === "string" && typeof command.reason === "string"
    && exact(["kind", "commandId", "expectedVersion", "entrantId", "reason"]))
    return { ...audit, kind: "MARK_LATE", entrantId: command.entrantId, reason: command.reason };
  if (command.kind === "CALL_CONTEST" && typeof command.contestId === "string"
    && exact(["kind", "commandId", "expectedVersion", "contestId"]))
    return { ...audit, kind: "CALL_CONTEST", contestId: command.contestId };
  if (command.kind === "START_CONTEST" && typeof command.contestId === "string" && typeof command.courtId === "string"
    && typeof command.startedAt === "string"
    && exact(["kind", "commandId", "expectedVersion", "contestId", "courtId", "startedAt"]))
    return { ...audit, kind: "START_CONTEST", contestId: command.contestId,
      courtId: command.courtId, startedAt: command.startedAt };
  if (command.kind === "COMPLETE_CONTEST" && typeof command.contestId === "string" && typeof command.endedAt === "string"
    && exact(["kind", "commandId", "expectedVersion", "contestId", "endedAt"]))
    return { ...audit, kind: "COMPLETE_CONTEST", contestId: command.contestId, endedAt: command.endedAt };
  const validScores = (scores: unknown): scores is Array<{ entrantId: string; value: number }> => Array.isArray(scores)
    && scores.length === 2 && scores.every((score) => score && typeof score === "object" && !Array.isArray(score)
      && Object.keys(score as Record<string, unknown>).every((key) => ["entrantId", "value"].includes(key))
      && typeof (score as Record<string, unknown>).entrantId === "string"
      && Number.isSafeInteger((score as Record<string, unknown>).value));
  if (command.kind === "RECORD_SCORE" && typeof command.contestId === "string" && validScores(command.scores)
    && exact(["kind", "commandId", "expectedVersion", "contestId", "scores"]))
    return { ...audit, kind: "RECORD_SCORE", contestId: command.contestId, scores: command.scores };
  if (command.kind === "RECORD_RESULT_RECEIPT" && typeof command.contestId === "string"
    && typeof command.source === "string"
    && exact(["kind", "commandId", "expectedVersion", "contestId", "source"]))
    return { ...audit, kind: "RECORD_RESULT_RECEIPT", contestId: command.contestId, source: command.source };
  if (command.kind === "AWARD_WALKOVER" && typeof command.contestId === "string"
    && typeof command.winnerEntrantId === "string" && typeof command.absentEntrantId === "string"
    && typeof command.reason === "string" && exact(["kind", "commandId", "expectedVersion", "contestId",
      "winnerEntrantId", "absentEntrantId", "reason"]))
    return { ...audit, kind: "AWARD_WALKOVER", contestId: command.contestId,
      winnerEntrantId: command.winnerEntrantId, absentEntrantId: command.absentEntrantId,
      reason: command.reason };
  if (command.kind === "CORRECT_OPERATION" && typeof command.supersedesEventId === "string"
    && typeof command.reason === "string" && command.replacement && typeof command.replacement === "object"
    && !Array.isArray(command.replacement) && exact(["kind", "commandId", "expectedVersion", "supersedesEventId",
      "replacement", "reason"])) {
    const replacement = command.replacement as Record<string, unknown>;
    if (replacement.kind === "SET_CONTEST_SCORE" && typeof replacement.contestId === "string"
      && typeof replacement.reason === "string" && validScores(replacement.scores)
      && Object.keys(replacement).every((key) => ["kind", "contestId", "scores", "reason"].includes(key)))
      return { ...audit, kind: "CORRECT_OPERATION", supersedesEventId: command.supersedesEventId,
        reason: command.reason, replacement: { kind: "SET_CONTEST_SCORE", contestId: replacement.contestId,
          scores: replacement.scores, reason: replacement.reason } };
  }
  throw new Error("invalid_live_command");
}

export function competitionJourneyHtml(competitionId: string): string {
  const encodedId = JSON.stringify(competitionId).replaceAll("<", "\\u003c");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Krateasy competition</title><style>
  :root{color-scheme:light;font-family:Inter,ui-sans-serif,system-ui,sans-serif;background:#f4f6f2;color:#17201d}*{box-sizing:border-box;min-width:0}html{font-size:100%;scroll-behavior:smooth}body{margin:0;overflow-wrap:anywhere}.skip{position:absolute;left:-9999px;top:8px;z-index:100;background:#fff;color:#17201d;padding:12px 16px;border:2px solid currentColor;border-radius:8px}.skip:focus{left:8px}:focus-visible{outline:3px solid #c95635;outline-offset:3px}.shell{max-width:1100px;margin:auto;padding:32px 22px 64px}a{color:#315d4b;min-height:44px;display:inline-flex;align-items:center}.eyebrow{font-size:.78rem;text-transform:uppercase;letter-spacing:.12em;color:#577064}.hero,.card{background:#fff;border:1px solid #dce3dc;border-radius:20px;box-shadow:0 10px 30px #1c3a2d0c}.hero{padding:28px;margin:18px 0}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(220px,100%),1fr));gap:14px}.card{padding:18px}.metric{font-size:2rem;font-weight:720}.ok{color:#19734a}.blocked{color:#a23b28}.schedule,.repeat,.source-import{margin-top:18px}.schedule{overflow:auto}.repeat form,.source-import form{display:grid;grid-template-columns:1fr 180px auto;gap:12px;align-items:end}.field{display:grid;gap:6px;font-weight:650}.field input,.field textarea{min-height:44px;border:1px solid #9aa9a1;border-radius:9px;padding:9px 11px;font:inherit}.field textarea{min-height:120px;resize:vertical}.repeat button,.source-import button{min-height:44px;border:0;border-radius:9px;padding:9px 15px;background:#315d4b;color:#fff;font:inherit;font-weight:700}.repeat button:disabled,.source-import button:disabled{opacity:.55}.repeat .result,.source-import .result{grid-column:1/-1;margin:0}.success{color:#19734a}table{width:100%;border-collapse:collapse;background:#fff}caption{text-align:left;font-size:1.5rem;font-weight:700;padding:0 0 16px}th,td{text-align:left;padding:11px;border-bottom:1px solid #e5e9e5;white-space:nowrap}code{font-size:.78rem;overflow-wrap:anywhere}.muted{color:#617068}.error{padding:18px;background:#fff1ee;color:#8b2c1f;border-radius:12px}@media(max-width:600px){.shell{padding:20px 14px}.hero{padding:20px}.repeat form,.source-import form{grid-template-columns:1fr}}@media(max-width:320px){.shell{padding-inline:10px}.hero,.card{padding:14px}}@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important;scroll-behavior:auto!important}}@media(prefers-contrast:more){.hero,.card{border:2px solid #17201d}.muted,.eyebrow{color:#3f4e47}}@media(forced-colors:active){.hero,.card,.error,.skip{border:2px solid CanvasText}}@media print{body{background:white}.skip,.back,.repeat,.source-import{display:none}.shell{max-width:none;padding:0}.hero,.card{box-shadow:none;break-inside:avoid}}
  </style></head><body><a class="skip" href="#main">Skip to competition</a><main id="main" tabindex="-1" class="shell"><a class="back" href="/">← Competitions</a><section id="app" role="status" aria-live="polite" aria-atomic="true"><p>Loading authoritative revision…</p></section>
  <section id="source-import" class="card source-import" aria-labelledby="source-title" hidden><div class="eyebrow">Authoritative sources</div><h2 id="source-title">Add or corroborate entrants</h2><p>Attach a CSV or values-only XLSX roster to this same draft. The original and its hash are preserved; disagreements stop compilation.</p><ul id="source-list"></ul><form id="source-form"><label class="field" for="source-csv">Entrant CSV<textarea id="source-csv" spellcheck="false">entrant_id,display_name,division_id,member_ids,seed</textarea></label><label class="field" for="source-xlsx">Or entrant XLSX<input id="source-xlsx" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"></label><button type="submit">Add entrant source</button><button id="source-remove" type="button" hidden>Remove last source</button><p class="result muted" id="source-status" role="status" aria-live="polite" aria-atomic="true">No source is authoritative until the server accepts it into this revision.</p></form></section><section id="lifecycle" class="card source-import" aria-labelledby="lifecycle-title" hidden><div class="eyebrow">Controlled lifecycle</div><h2 id="lifecycle-title">Next authoritative action</h2><p id="lifecycle-summary"></p><div id="lifecycle-acks"></div><button id="lifecycle-action" type="button" hidden></button><p id="lifecycle-status" class="result muted" role="status" aria-live="polite" aria-atomic="true"></p><p><a id="organiser-live-link" hidden>Open live control room</a> <a id="public-live-link" hidden>Open venue display</a></p></section><script>const lifecycleCompetitionId=${encodedId};fetch('/v1/competition-journey/'+encodeURIComponent(lifecycleCompetitionId)).then(response=>response.ok?response.json():null).then(view=>{if(!view)return;const section=document.querySelector('#lifecycle'),summary=document.querySelector('#lifecycle-summary'),acks=document.querySelector('#lifecycle-acks'),action=document.querySelector('#lifecycle-action'),status=document.querySelector('#lifecycle-status'),organiser=document.querySelector('#organiser-live-link'),publicLink=document.querySelector('#public-live-link');section.hidden=false;const submit=async(operation,payload)=>{action.disabled=true;status.className='result muted';status.textContent='Submitting the revision-bound command…';try{const response=await fetch('/v1/competition-journey/'+encodeURIComponent(lifecycleCompetitionId)+'/'+operation,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload())}),result=await response.json();if(!response.ok)throw Error(result.error||'The command was not accepted');location.reload()}catch(error){status.className='result error';status.textContent='Action stopped safely: '+error.message;action.disabled=false}};const offer=(label,operation,payload)=>{action.hidden=false;action.textContent=label;action.onclick=()=>submit(operation,payload)};if(view.status==='NEEDS_INPUT'){summary.textContent='Resolve every listed decision or source conflict before compilation.';return}if(view.status==='DRAFT'){summary.textContent='Compile the exact draft with server-owned artifacts, then run the independent Guard.';offer('Compile and run Guard','compile',()=>({expectedDraftVersion:view.draftVersion}));return}if(view.status==='READY_FOR_APPROVAL'){summary.textContent='Review the Guard pre-flight, acknowledge every required finding and approve the exact compiled revision. Publication remains server-owned.';const codes=view.compiled.requiredAcknowledgementCodes;for(const code of codes){const label=document.createElement('label'),input=document.createElement('input');input.type='checkbox';input.value=code;label.append(input,document.createTextNode(' '+code));acks.append(label)}offer('Approve and publish exact revision','approve',()=>{const acknowledgedFindingCodes=[...acks.querySelectorAll('input:checked')].map(input=>input.value);if(acknowledgedFindingCodes.length!==codes.length)throw Error('Acknowledge every required Guard finding.');return{expectedRevision:view.revision,acknowledgedFindingCodes}});return}if(view.status==='GUARD_BLOCKED'){summary.textContent='Guard blocked publication. Open the pre-flight evidence and revise the authoritative draft.';return}if(view.status==='PUBLISHED'&&!view.live){summary.textContent='The exact revision is published. Activate it before accepting operational or actual commands.';offer('Activate live play','live-activate',()=>({expectedRevision:view.revision}));return}if((view.status==='PUBLISHED'||view.status==='CLOSED')&&view.live){const revision=view.live.publication?.revision??view.publication.revision;summary.textContent=view.status==='CLOSED'?'This competition is closed and replayable.':'Live play is active at operational revision '+revision+'.';organiser.href='/attention?competition='+encodeURIComponent(lifecycleCompetitionId)+'&revision='+encodeURIComponent(revision);publicLink.href='/display?competition='+encodeURIComponent(lifecycleCompetitionId)+'&revision='+encodeURIComponent(revision);organiser.hidden=false;publicLink.hidden=false;return}summary.textContent='No lifecycle action is available for this state.'}).catch(()=>{});</script></main>
  <script>const sourceCompetitionId=${encodedId};fetch('/v1/competition-journey/'+encodeURIComponent(sourceCompetitionId)).then(response=>response.ok?response.json():null).then(view=>{if(!view||view.publication)return;const section=document.querySelector('#source-import'),form=document.querySelector('#source-form'),status=document.querySelector('#source-status'),remove=document.querySelector('#source-remove'),documents=view.workbench.sources;section.hidden=false;document.querySelector('#source-list').innerHTML=documents.map(source=>'<li>'+String(source.kind).toUpperCase()+' · '+source.status+' · <code>'+source.sourceHash.slice(0,16)+'</code></li>').join('');if(documents.length>1){remove.hidden=false;remove.addEventListener('click',async()=>{remove.disabled=true;status.textContent='Removing the last source revision…';try{const response=await fetch('/v1/competition-journey/'+encodeURIComponent(sourceCompetitionId)+'/source-remove',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({expectedDraftVersion:view.draftVersion,sourceId:documents.at(-1).id})}),result=await response.json();if(!response.ok)throw Error(result.error||'Source was not removed');location.reload()}catch(error){status.className='result error';status.textContent='Source removal stopped safely: '+error.message;remove.disabled=false}})}form.addEventListener('submit',async event=>{event.preventDefault();const button=form.querySelector('button[type=submit]'),file=document.querySelector('#source-xlsx').files[0],text=document.querySelector('#source-csv').value.trim();button.disabled=true;status.className='result muted';status.textContent='Checking and preserving the source…';try{let source;if(file){const bytes=new Uint8Array(await file.arrayBuffer());let binary='';for(let index=0;index<bytes.length;index+=32768)binary+=String.fromCharCode(...bytes.subarray(index,index+32768));source={mode:'xlsx',fileName:file.name,base64:btoa(binary)}}else{if(text.split(String.fromCharCode(10)).length<2)throw Error('Add at least one entrant row or choose an XLSX file.');source={mode:'csv',text}}const response=await fetch('/v1/competition-journey/'+encodeURIComponent(sourceCompetitionId)+'/sources',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({expectedDraftVersion:view.draftVersion,source})}),result=await response.json();if(!response.ok)throw Error(result.error||'Source was not added');const latest=result.workbench.sources.at(-1);if(latest.status!=='ACCEPTED'){location.reload();return}location.reload()}catch(error){status.className='result error';status.textContent='Source stopped safely: '+error.message;button.disabled=false}})}).catch(()=>{});</script>
  <script>const id=${encodedId};const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  fetch('/v1/competition-journey/'+encodeURIComponent(id)).then(async r=>{const v=await r.json();if(!r.ok)throw Error(v.error||'Not found');return v}).then(v=>{const c=v.compiled,published=Boolean(v.publication),stateLabel=published?'Immutable published competition revision':'Authoritative competition draft',revisionLabel=published?'revision '+v.revision:'draft version '+v.draftVersion,preflight=c?'<a class="back" href="/competitions/'+encodeURIComponent(id)+'/preflight">Open Guard pre-flight</a>':'';const closed=v.closure?'<div class="card"><div class="eyebrow">Final closure</div><div class="metric ok">'+esc(v.closure.resultSummary.total)+'</div><p>settled results · 0 unresolved</p><p><code>'+esc(v.closure.closureHash.slice(0,16))+'</code></p><a href="/v1/competition-journey/'+encodeURIComponent(id)+'/closure-bundle?closure='+encodeURIComponent(v.closure.closureHash)+'">Open machine and human evidence bundle</a></div>':'';const repeat=v.closure?'<section class="card repeat" aria-labelledby="duplicate-title"><div class="eyebrow">Next edition</div><h2 id="duplicate-title">Create a clean edition</h2><p>Carry the exact source and approved decision provenance into a new draft. Results, live state, approval and publication are never copied.</p><form id="duplicate-form"><label class="field" for="duplicate-name">New competition name<input id="duplicate-name" name="name" required minlength="2" autocomplete="off"></label><label class="field" for="duplicate-date">Event date<input id="duplicate-date" name="eventDate" required type="date"></label><button type="submit">Create clean draft</button><p class="result muted" id="duplicate-status" role="status" aria-live="polite" aria-atomic="true">The server will bind this request to the current authoritative closure.</p></form></section>':'';document.title=v.name+' · Krateasy';document.querySelector('#app').removeAttribute('role');document.querySelector('#app').innerHTML='<div class="hero"><div class="eyebrow">'+esc(stateLabel)+'</div><h1>'+esc(v.name)+'</h1><p class="muted">'+esc(v.id)+' · '+esc(revisionLabel)+' · '+esc(v.status)+'</p>'+preflight+'</div><div class="grid"><div class="card"><div class="eyebrow">Guard</div><div class="metric '+(c?.guardStatus==='PASSED'?'ok':'blocked')+'">'+esc(c?.guardStatus||'Not run')+'</div><p>'+esc(c?.guardReportHash?.slice(0,16)||'No proof yet')+'</p></div><div class="card"><div class="eyebrow">Contest accounting</div><div class="metric">'+esc(c?.actualContestCount??'—')+'</div><p>'+esc(c?.scheduledContestCount??0)+' scheduled</p></div><div class="card"><div class="eyebrow">Publication</div><div class="metric">'+esc(v.publication?'Bound':'Pending')+'</div><p>'+esc(v.publication?.certificateHash?.slice(0,16)||'Independent approval required')+'</p></div>'+closed+'</div>'+repeat+(c?'<div class="schedule card"><table>'+(published?'<caption>Published schedule</caption>':'<caption>Candidate schedule</caption>')+'<thead><tr><th scope="col">Contest</th><th scope="col">Resource</th><th scope="col">Start</th><th scope="col">End</th></tr></thead><tbody>'+c.schedule.map(x=>'<tr><td><code>'+esc(x.contestId)+'</code></td><td>'+esc(x.resourceId)+'</td><td>'+esc(x.start)+'</td><td>'+esc(x.end)+'</td></tr>').join('')+'</tbody></table></div>':'<div class="card"><h2>'+(v.status==='DRAFT'?'Ready for compiler review':'Needs input')+'</h2><p>'+esc(v.supportFindings.concat(v.questions.map(q=>q.prompt),v.workbench.missingDecisions.map(d=>d.prompt),v.workbench.conflicts.map(x=>x.description),v.workbench.unsupportedSemantics.map(x=>x.description)).join(' · ')||'The draft is complete and ready for compiler review.')+'</p></div>');const form=document.querySelector('#duplicate-form');if(form)form.addEventListener('submit',async event=>{event.preventDefault();const button=form.querySelector('button'),status=document.querySelector('#duplicate-status'),name=document.querySelector('#duplicate-name').value.trim(),eventDate=document.querySelector('#duplicate-date').value;if(!name||!eventDate)return;button.disabled=true;status.className='result muted';status.textContent='Creating authoritative clean draft…';try{const response=await fetch('/v1/competition-journey/'+encodeURIComponent(id)+'/duplicate',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({expectedClosureHash:v.closure.closureHash,name,eventDate})}),created=await response.json();if(!response.ok)throw Error(created.error||'Duplicate was not created');status.className='result success';status.innerHTML='Clean draft created. <a href="/competitions/'+encodeURIComponent(created.id)+'">Open '+esc(created.name)+' →</a>';button.textContent='Draft created'}catch(error){status.className='result error';status.textContent='Duplicate stopped safely: '+error.message;button.disabled=false}})}).catch(e=>document.querySelector('#app').innerHTML='<p class="error" role="alert">'+esc(e.message)+'</p>');</script></body></html>`;
}
