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
  createPublicationCertificate,
  evaluateCompetitionGuard,
  replayLiveOperationsEvents,
  runScenario,
  submitLiveOperationsCommand,
  type CompetitionGraph,
  type CompetitionGuardReport,
  type ScheduleSolution,
  type SimulationRun,
  InMemoryTransactionalOutbox,
  type OutboxDeliveryStore,
  type OutboxMessage,
  runAuthoritativeRestoreDrill,
} from "@tournament-os/competition-engine";
import {
  createCompetitionProposal,
  type CompetitionBlueprint,
  type CreationProposal,
  type CreationSource,
} from "./creation-proposal.js";
import {
  applyWorkbenchEdit,
  analyseCompetitionSources,
  planWorkbenchEdit,
  rebaseWorkbenchSources,
  recognisedCompetitionName,
  type CompetitionWorkbenchProjection,
  type StructuredWorkbenchEdit,
  type StructuredWorkbenchEditPreview,
  workbenchSourceDocument,
  workbenchDecisionValues,
} from "./competition-workbench.js";
import { definitionFromProductionLock, entrantsFromProductionLock, participantNamesFromProductionLock,
  verifiedScheduleFromProductionLock } from "./production-lock-definition.js";
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
  deriveParticipantNext,
  derivePublicLive,
  resolveParticipantAccess,
  type ParticipantAccess,
  type ParticipantAccessGrant,
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
}

interface JourneyApproval {
  readonly revision: number;
  readonly approvedBy: string;
  readonly approvedAt: string;
  readonly guardReportHash: string;
  readonly acknowledgedFindingCodes: readonly string[];
  readonly approvalHash: string;
}

interface JourneyPublication {
  readonly revision: number;
  readonly definitionHash: string;
  readonly guardReportHash: string;
  readonly certificateHash: string;
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
    guardFindings: CompetitionGuardReport["findings"];
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

export interface CompetitionJourneyOptions {
  readonly storagePath?: string;
  readonly now?: () => string;
  readonly organizationId?: string;
  readonly participantTokenSecret?: string;
  readonly participantTokenKeyVersion?: string;
  readonly offlinePackSigningSeedHex?: string;
  readonly operationalAuthorityAssignments?: OperationalAuthorityAssignments;
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

function makeRecordHash(record: Omit<StoredJourneyRecord, "recordHash">): string {
  return canonicalHash(record);
}

function sealRecord(record: Omit<StoredJourneyRecord, "recordHash">): StoredJourneyRecord {
  return { ...record, recordHash: makeRecordHash(record) };
}

function closureAuthority(record: StoredJourneyRecord): CompetitionClosure["authority"] | null {
  if (!record.compiled || !record.publication || !record.live) return null;
  return {
    specificationHash: canonicalHash(record.compiled.spec),
    graphHash: canonicalHash(record.compiled.graph),
    scheduleHash: canonicalHash(record.compiled.schedule),
    simulationHash: record.compiled.simulation ? canonicalHash(record.compiled.simulation) : null,
    guardReportHash: record.compiled.guardReport.reportHash,
    publicationCertificateHash: record.publication.certificateHash,
    operationalPublicationHash: record.live.publication?.publicationHash ?? null,
    liveStateProofHash: record.live.state.proofHash,
    operationalStateProofHash: record.live.operations.proofHash,
    sourceDocumentsHash: canonicalHash(record.workbench?.sources ?? []),
  };
}

function evidenceBundleForRecord(record: StoredJourneyRecord): CompetitionEvidenceBundle {
  if (!record.closure || !record.compiled || !record.approval || !record.publication || !record.live)
    throw new Error("competition_closure_mismatch");
  return createCompetitionEvidenceBundle({
    name: recognisedCompetitionName(record.workbench!) ?? record.proposal.blueprint.name ?? "Competition",
    closure: record.closure, sources: record.workbench?.sources ?? [], spec: record.compiled.spec,
    graph: record.compiled.graph, schedule: record.compiled.schedule,
    ...(record.compiled.simulation ? { simulation: record.compiled.simulation } : {}),
    guardReport: record.compiled.guardReport, approval: record.approval, publication: record.publication,
    operationalPublications: record.live.publicationHistory ?? [], live: record.live.state,
    operations: record.live.operations, authoritativeRecord: record, recordHash: record.recordHash,
  });
}

function verifyRecord(record: StoredJourneyRecord): boolean {
  const { recordHash, ...body } = record;
  if (recordHash !== makeRecordHash(body)) return false;
  if (record.duplication) {
    const memory = { sourceCompetitionId: record.duplication.sourceCompetitionId,
      sourceClosureHash: record.duplication.sourceClosureHash,
      newEditionName: record.duplication.newEditionName, newEventDate: record.duplication.newEventDate };
    if (record.duplication.memoryHash !== canonicalHash(memory) || memory.sourceCompetitionId === record.id
      || !/^[a-f0-9]{64}$/.test(memory.sourceClosureHash)
      || new Set(record.duplication.sourceDocumentHashes).size !== record.duplication.sourceDocumentHashes.length
      || record.duplication.sourceDocumentHashes.some((hash) => !/^[a-f0-9]{64}$/.test(hash))) return false;
  }
  if (record.participantAccess && (new Set(record.participantAccess.map(({ tokenHash }) => tokenHash)).size
    !== record.participantAccess.length || record.participantAccess.some((grant) => grant.organizationId !== record.organizationId
      || grant.competitionId !== record.id || !/^[a-f0-9]{64}$/.test(grant.tokenHash)))) return false;
  if (!record.live) return !record.closure;
  if (!record.live.operations || !verifyOperationalSafetyState(record.live.operations)) return false;
  const replay = replayLiveOperationsEvents(record.live.state.definition, record.live.state.events);
  if (!replay.valid || replay.state.proofHash !== record.live.state.proofHash) return false;
  const progressionEntrants = record.workbench ? entrantsFromProductionLock(record.workbench) : null;
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

function snapshotOf(record: StoredJourneyRecord): CompetitionJourneySnapshot {
  const compiled = record.compiled;
  const workbench = record.workbench ?? analyseCompetitionSources(record.sources ?? [record.source], record.createdAt);
  const previewAssumptions = playAndKonnectDefinition.assumptions ?? [];
  const sourceParticipantCount = workbench.understoodFacts.find(({ id }) => id === "entrants.total")?.value;
  const effectiveBlueprint: CompetitionBlueprint = typeof sourceParticipantCount === "number" ? {
    ...record.proposal.blueprint,
    name: recognisedCompetitionName(workbench), sport: "padel", participantUnit: "pairs",
    participantCount: sourceParticipantCount, resourceCount: 7, resourceLabel: "courts", format: "pools_to_knockout",
    matchDurationMinutes: 30,
  } : record.proposal.blueprint;
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
    assumptions: (compiled?.spec.assumptions ?? (record.supportFindings.length === 0 ? previewAssumptions : [])).map(({ id, rulePath, origin, knowledge, approved, critical }) =>
      ({ id, rulePath, origin, knowledge, approved, critical })),
    requirements: compiled?.spec.requirements ?? (record.supportFindings.length === 0 ? playAndKonnectDefinition.requirements : []),
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
      guardFindings: compiled.guardReport.findings,
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

function compileReferenceRevision(record: StoredJourneyRecord, compiledAt: string): CompiledJourneyRevision {
  const blueprint = record.proposal.blueprint;
  const productionLockDefinition = record.workbench ? definitionFromProductionLock(record.workbench) : null;
  if (!productionLockDefinition && (!blueprint.startsAt || !blueprint.endsAt)) throw new Error("journey_not_ready");
  const base = structuredClone(playAndKonnectDefinition);
  const definition: TournamentDefinition = productionLockDefinition ?? {
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
  const entrants = productionLockDefinition ? entrantsFromProductionLock(record.workbench!) : null;
  const scenario = runScenario(spec, entrants ?? createEntrants(spec), `journey:${record.id}:revision:${revision}`);
  const schedule = productionLockDefinition
    ? (verifiedScheduleFromProductionLock(record.workbench!, spec, scenario.graph) ?? scenario.schedule)
    : scenario.schedule;
  const guardReport = evaluateCompetitionGuard({
    sourceDefinitionHash: canonicalHash(spec),
    spec,
    graph: scenario.graph,
    schedule,
    ...(scenario.simulation ? { simulation: scenario.simulation } : {}),
  });
  return {
    revision,
    compiledBy: "competition-journey.compiler",
    compiledAt,
    spec,
    graph: scenario.graph,
    schedule,
    ...(scenario.simulation ? { simulation: scenario.simulation } : {}),
    guardReport,
  };
}

export class CompetitionJourney {
  private records = new Map<string, StoredJourneyRecord>();
  private readonly storagePath: string | undefined;
  private readonly now: () => string;
  private readonly organizationId: string;
  private readonly participantTokenSecret: string;
  private readonly participantTokenKeyVersion: string;
  private readonly offlinePackSigningSeedHex: string;
  private readonly operationalAuthorityAssignments: OperationalAuthorityAssignments;

  public constructor(options: CompetitionJourneyOptions = {}) {
    this.storagePath = options.storagePath;
    this.now = options.now ?? (() => new Date().toISOString());
    this.organizationId = options.organizationId ?? "org.local";
    this.participantTokenSecret = options.participantTokenSecret ?? "";
    this.participantTokenKeyVersion = options.participantTokenKeyVersion ?? "v1";
    this.offlinePackSigningSeedHex = options.offlinePackSigningSeedHex ?? "";
    this.operationalAuthorityAssignments = options.operationalAuthorityAssignments ?? {
      incidentLead: "local.incident-lead", competitionLead: "local.competition-lead",
      safetyLead: "local.safety-lead", communicationsLead: "local.communications-lead", scribe: "local.scribe",
    };
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
    const proposal = createCompetitionProposal(source);
    const timestamp = this.canonicalNow();
    const workbench = analyseCompetitionSources([source], timestamp);
    const name = recognisedCompetitionName(workbench) ?? proposal.blueprint.name;
    const base = (name ?? "competition").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "competition";
    let id = `${base}.${proposal.proposalHash.slice(0, 10)}`;
    let suffix = 1;
    while (this.records.has(id)) { suffix += 1; id = `${base}.${proposal.proposalHash.slice(0, 10)}.${suffix}`; }
    const record = sealRecord({ id, organizationId: this.organizationId, draftVersion: 1, createdBy, createdAt: timestamp, updatedAt: timestamp,
      source, sources: [source], proposal, workbench,
      supportFindings: workbench.understoodFacts.length ? [] : supportedMilestoneFindings(proposal.blueprint) });
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
      supportFindings: workbench.understoodFacts.length ? [] : supportedMilestoneFindings(proposal.blueprint),
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

  public planStructuredEdit(id: string, expectedDraftVersion: number, edits: readonly StructuredWorkbenchEdit[],
    editedBy: string): StructuredWorkbenchEditPreview {
    const current = this.require(id);
    if (current.draftVersion !== expectedDraftVersion) throw new Error("journey_version_conflict");
    if (current.approval) throw new Error("approved_revision_is_immutable");
    const workbench = current.workbench ?? analyseCompetitionSources(current.sources ?? [current.source], current.createdAt);
    return planWorkbenchEdit(workbench, expectedDraftVersion, edits, editedBy);
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
    const compiled = compileReferenceRevision(current, compiledAt);
    const revised = sealRecord({ ...withoutSeal(current), updatedAt: compiledAt, compiled });
    this.records.set(id, revised);
    this.persist();
    return snapshotOf(revised);
  }

  public approve(id: string, expectedRevision: number, approvedBy: string, acknowledgedFindingCodes: readonly string[]): CompetitionJourneySnapshot {
    const current = this.require(id);
    const compiled = current.compiled;
    if (!compiled || compiled.revision !== expectedRevision) throw new Error("journey_revision_conflict");
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
      acknowledgedFindingCodes: [...new Set(acknowledgedFindingCodes)].sort() };
    const approval: JourneyApproval = { ...approvalBody, approvalHash: canonicalHash(approvalBody) };
    const publishedBy = "competition-journey.publisher" as const;
    if (publishedBy === approvedBy) throw new Error("publication_requires_independent_actor");
    const certificate = createPublicationCertificate({ tournamentId: current.id, tournamentRevision: compiled.revision,
      report: independentlyVerifiedReport, acknowledgedFindingCodes, issuedBy: publishedBy, issuedAt: approvedAt });
    const publicationBody = { revision: compiled.revision, definitionHash,
      guardReportHash: independentlyVerifiedReport.reportHash, certificateHash: certificate.certificateHash,
      publishedBy, publishedAt: approvedAt };
    const publication: JourneyPublication = { ...publicationBody, outboxIntents: [{
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
      state: activatePublishedLiveState(id, compiled.graph, compiled.schedule) };
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
    const progressionEntrants = entrantsFromProductionLock(current.workbench!);
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
    const participantNames = participantNamesFromProductionLock(current.workbench!);
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
      const participantNames = participantNamesFromProductionLock(current.workbench!);
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
    strategy: NoShowRepairStrategy, approvedBy: string, approvedAt: string): CompetitionJourneySnapshot {
    const current = this.require(id);
    if (current.closure) throw new Error("competition_is_closed");
    const live = this.requireLive(current, expectedRevision);
    this.assertOperationalPublicationAllowed(live);
    const proposal = live.proposal;
    if (!proposal || proposal.proposalHash !== expectedProposalHash || !verifyNoShowProposal(proposal))
      throw new Error("no_show_proposal_mismatch");
    if (live.publication) {
      if (live.publication.proposalHash === proposal.proposalHash && live.publication.approvedBy === approvedBy
        && proposal.options.some(({ strategy: candidate, optionHash }) => candidate === strategy
          && optionHash === live.publication!.optionHash)) return snapshotOf(current);
      throw new Error("live_revision_already_published");
    }
    if (live.state.proofHash !== proposal.baseLiveStateProofHash) throw new Error("stale_live_proposal");
    if (!approvedBy.trim() || approvedBy === proposal.proposedBy) throw new Error("no_show_approval_requires_independent_actor");
    if (!Number.isFinite(Date.parse(approvedAt)) || new Date(Date.parse(approvedAt)).toISOString() !== approvedAt)
      throw new Error("invalid_no_show_approval_time");
    if (approvedAt < proposal.proposedAt) throw new Error("stale_no_show_approval_time");
    const option = proposal.options.find((candidate) => candidate.strategy === strategy);
    if (!option) throw new Error("no_show_option_not_found");
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
            participantNames: participantNamesFromProductionLock(current.workbench!), state: option.proposedLiveState,
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
    const revisedLive: JourneyLiveState = { ...live, courtOutageProposal: proposal };
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
    const revisedLive: JourneyLiveState = { ...live, courtOutageProposal: proposal };
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
            participantNames: participantNamesFromProductionLock(current.workbench!), state: proposedLiveState,
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
    const source = (current.sources ?? [current.source])[0]!;
    const workbench = analyseCompetitionSources([source], duplicatedAt);
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
      source: editSource, sources: [source, editSource], proposal: createCompetitionProposal(source),
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
    const { grant, access } = createParticipantAccessGrant({ organizationId: input.organizationId,
      competitionId: input.competitionId, publishedRevision: input.expectedPublishedRevision,
      participantId: input.participantId, expiresAt: input.expiresAt,
      keyVersion: this.participantTokenKeyVersion }, this.participantTokenSecret,
    current.live.publication?.revision ?? current.live.baseRevision);
    const grants = current.participantAccess ?? [];
    if (!grants.some(({ tokenHash }) => tokenHash === grant.tokenHash)) {
      const revised = sealRecord({ ...withoutSeal(current), updatedAt: issuedAt, participantAccess: [...grants, grant]
        .sort((left, right) => left.participantId.localeCompare(right.participantId) || left.expiresAt.localeCompare(right.expiresAt)) });
      this.records.set(current.id, revised);
      this.persist();
    }
    return access;
  }

  public readParticipantNext(input: { readonly organizationId: string; readonly competitionId: string;
    readonly expectedOperationalRevision: number; readonly token: string; readonly at: string }): ParticipantNextProjection {
    const current = this.requireScoped(input.organizationId, input.competitionId);
    const live = this.requireProjectedLive(current, input.expectedOperationalRevision);
    const grant = resolveParticipantAccess(current.participantAccess ?? [], input.token, this.participantTokenSecret,
      input.organizationId, input.competitionId, input.at);
    if (grant.publishedRevision !== current.publication!.revision) throw new Error("participant_access_denied");
    return deriveParticipantNext({ competitionId: current.id,
      competitionName: recognisedCompetitionName(current.workbench!) ?? current.proposal.blueprint.name ?? "Competition",
      publishedRevision: current.publication!.revision, operationalRevision: input.expectedOperationalRevision,
      affectedParticipantIds: live.publication?.affectedEntrantIds ?? [], participantId: grant.participantId,
      participantRevisions: live.participantRevisions,
      participantNames: participantNamesFromProductionLock(current.workbench!), state: live.state,
      assignments: live.publication?.operationalAssignments ?? current.compiled!.schedule.contests,
      operation: live.operations.publicStatus });
  }

  public readPublicLive(input: { readonly organizationId: string; readonly competitionId: string;
    readonly expectedOperationalRevision: number }): PublicLiveProjection {
    const current = this.requireScoped(input.organizationId, input.competitionId);
    const live = this.requireProjectedLive(current, input.expectedOperationalRevision);
    return derivePublicLive({ competitionId: current.id,
      competitionName: recognisedCompetitionName(current.workbench!) ?? current.proposal.blueprint.name ?? "Competition",
      publishedRevision: current.publication!.revision, operationalRevision: input.expectedOperationalRevision,
      affectedContestIds: live.publication?.affectedContestIds ?? [],
      contestRevisions: live.contestRevisions,
      participantNames: participantNamesFromProductionLock(current.workbench!), state: live.state,
      assignments: live.publication?.operationalAssignments ?? current.compiled!.schedule.contests,
      operation: live.operations.publicStatus });
  }

  public readOrganiserLive(input: { readonly organizationId: string; readonly competitionId: string;
    readonly expectedOperationalRevision: number; readonly at: string }): OrganiserLiveProjection {
    const current = this.requireScoped(input.organizationId, input.competitionId);
    const live = this.requireProjectedLive(current, input.expectedOperationalRevision);
    if (!Number.isFinite(Date.parse(input.at)) || new Date(Date.parse(input.at)).toISOString() !== input.at)
      throw new Error("invalid_projection_time");
    const participantNames = participantNamesFromProductionLock(current.workbench!);
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
    const deliveryEvidence = live.delivery.map((message) => ({ messageId: message.id,
      recipientParticipantId: String((message.payload as Record<string, unknown>).recipientEntrantId ?? ""),
      status: message.status, attempts: message.attempts,
      ...(message.providerId ? { providerId: message.providerId } : {}),
      ...(message.providerMessageId ? { providerMessageId: message.providerMessageId } : {}),
      ...(message.deliveredAt ? { deliveredAt: message.deliveredAt } : {}) }));
    const body = { apiVersion: "1.0" as const, organizationId: input.organizationId,
      public: publicProjection, liveVersion: live.state.version, stateProofHash: live.state.proofHash,
      authorityAssignments: live.operations.authorityAssignments, incidents: live.operations.incidents,
      restartClearances: live.operations.restartClearances, participants, deliveryEvidence };
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
    const participantNames = participantNamesFromProductionLock(current.workbench!);
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
    if (this.participantTokenSecret.length > 0) {
      for (const participantId of participantIds) {
        const created = createParticipantAccessGrant({ organizationId: input.organizationId,
          competitionId: current.id, publishedRevision: current.publication!.revision, participantId,
          expiresAt: input.expiresAt, keyVersion: this.participantTokenKeyVersion }, this.participantTokenSecret,
        input.expectedOperationalRevision);
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
    return { mode: "json", text: record.text };
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
  :root{color-scheme:light;font-family:Inter,ui-sans-serif,system-ui,sans-serif;background:#f4f6f2;color:#17201d}*{box-sizing:border-box;min-width:0}html{font-size:100%;scroll-behavior:smooth}body{margin:0;overflow-wrap:anywhere}.skip{position:absolute;left:-9999px;top:8px;z-index:100;background:#fff;color:#17201d;padding:12px 16px;border:2px solid currentColor;border-radius:8px}.skip:focus{left:8px}:focus-visible{outline:3px solid #c95635;outline-offset:3px}.shell{max-width:1100px;margin:auto;padding:32px 22px 64px}a{color:#315d4b;min-height:44px;display:inline-flex;align-items:center}.eyebrow{font-size:.78rem;text-transform:uppercase;letter-spacing:.12em;color:#577064}.hero,.card{background:#fff;border:1px solid #dce3dc;border-radius:20px;box-shadow:0 10px 30px #1c3a2d0c}.hero{padding:28px;margin:18px 0}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(220px,100%),1fr));gap:14px}.card{padding:18px}.metric{font-size:2rem;font-weight:720}.ok{color:#19734a}.blocked{color:#a23b28}.schedule{margin-top:18px;overflow:auto}table{width:100%;border-collapse:collapse;background:#fff}caption{text-align:left;font-size:1.5rem;font-weight:700;padding:0 0 16px}th,td{text-align:left;padding:11px;border-bottom:1px solid #e5e9e5;white-space:nowrap}code{font-size:.78rem;overflow-wrap:anywhere}.muted{color:#617068}.error{padding:18px;background:#fff1ee;color:#8b2c1f;border-radius:12px}@media(max-width:600px){.shell{padding:20px 14px}.hero{padding:20px}}@media(max-width:320px){.shell{padding-inline:10px}.hero,.card{padding:14px}}@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important;scroll-behavior:auto!important}}@media(prefers-contrast:more){.hero,.card{border:2px solid #17201d}.muted,.eyebrow{color:#3f4e47}}@media(forced-colors:active){.hero,.card,.error,.skip{border:2px solid CanvasText}}@media print{body{background:white}.skip,.back{display:none}.shell{max-width:none;padding:0}.hero,.card{box-shadow:none;break-inside:avoid}}
  </style></head><body><a class="skip" href="#main">Skip to published competition</a><main id="main" tabindex="-1" class="shell"><a class="back" href="/">← Competitions</a><section id="app" role="status" aria-live="polite" aria-atomic="true"><p>Loading authoritative revision…</p></section></main>
  <script>const id=${encodedId};const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  fetch('/v1/competition-journey/'+encodeURIComponent(id)).then(async r=>{const v=await r.json();if(!r.ok)throw Error(v.error||'Not found');return v}).then(v=>{const c=v.compiled;const closed=v.closure?'<div class="card"><div class="eyebrow">Final closure</div><div class="metric ok">'+esc(v.closure.resultSummary.total)+'</div><p>settled results · 0 unresolved</p><p><code>'+esc(v.closure.closureHash.slice(0,16))+'</code></p><a href="/v1/competition-journey/'+encodeURIComponent(id)+'/closure-bundle?closure='+encodeURIComponent(v.closure.closureHash)+'">Open machine and human evidence bundle</a></div>':'';document.title=v.name+' · Krateasy';document.querySelector('#app').removeAttribute('role');document.querySelector('#app').innerHTML='<div class="hero"><div class="eyebrow">Immutable published competition revision</div><h1>'+esc(v.name)+'</h1><p class="muted">'+esc(v.id)+' · revision '+v.revision+' · '+esc(v.status)+'</p></div><div class="grid"><div class="card"><div class="eyebrow">Guard</div><div class="metric '+(c?.guardStatus==='PASSED'?'ok':'blocked')+'">'+esc(c?.guardStatus||'Not run')+'</div><p>'+esc(c?.guardReportHash?.slice(0,16)||'No proof yet')+'</p></div><div class="card"><div class="eyebrow">Contest accounting</div><div class="metric">'+esc(c?.actualContestCount??'—')+'</div><p>'+esc(c?.scheduledContestCount??0)+' scheduled</p></div><div class="card"><div class="eyebrow">Publication</div><div class="metric">'+esc(v.publication?'Bound':'Pending')+'</div><p>'+esc(v.publication?.certificateHash?.slice(0,16)||'Independent approval required')+'</p></div>'+closed+'</div>'+(c?'<div class="schedule card"><table><caption>Published schedule</caption><thead><tr><th scope="col">Contest</th><th scope="col">Resource</th><th scope="col">Start</th><th scope="col">End</th></tr></thead><tbody>'+c.schedule.map(x=>'<tr><td><code>'+esc(x.contestId)+'</code></td><td>'+esc(x.resourceId)+'</td><td>'+esc(x.start)+'</td><td>'+esc(x.end)+'</td></tr>').join('')+'</tbody></table></div>':'<div class="card"><h2>Needs input</h2><p>'+esc(v.supportFindings.concat(v.questions.map(q=>q.prompt)).join(' · '))+'</p></div>')}).catch(e=>document.querySelector('#app').innerHTML='<p class="error" role="alert">'+esc(e.message)+'</p>');</script></body></html>`;
}
