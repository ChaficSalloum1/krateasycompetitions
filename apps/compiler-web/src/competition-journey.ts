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

export type CompetitionJourneyStatus = "NEEDS_INPUT" | "DRAFT" | "GUARD_BLOCKED" | "READY_FOR_APPROVAL" | "PUBLISHED";

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
  readonly delivery: readonly Readonly<OutboxMessage>[];
  readonly participantRevisions: Readonly<Record<string, number>>;
  readonly contestRevisions: Readonly<Record<string, number>>;
  readonly proposal?: NoShowProposal;
  readonly publication?: LiveJourneyPublication;
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
  readonly webPath: string;
}

export interface CompetitionJourneyOptions {
  readonly storagePath?: string;
  readonly now?: () => string;
  readonly organizationId?: string;
  readonly participantTokenSecret?: string;
  readonly participantTokenKeyVersion?: string;
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

function verifyRecord(record: StoredJourneyRecord): boolean {
  const { recordHash, ...body } = record;
  if (recordHash !== makeRecordHash(body)) return false;
  if (record.participantAccess && (new Set(record.participantAccess.map(({ tokenHash }) => tokenHash)).size
    !== record.participantAccess.length || record.participantAccess.some((grant) => grant.organizationId !== record.organizationId
      || grant.competitionId !== record.id || !/^[a-f0-9]{64}$/.test(grant.tokenHash)))) return false;
  if (!record.live) return true;
  const replay = replayLiveOperationsEvents(record.live.state.definition, record.live.state.events);
  if (!replay.valid || replay.state.proofHash !== record.live.state.proofHash) return false;
  const progressionEntrants = record.workbench ? entrantsFromProductionLock(record.workbench) : null;
  if (record.compiled && progressionEntrants
    && !verifyLiveProgression(record.compiled.spec, record.compiled.graph, progressionEntrants, replay.state)) return false;
  if (record.live.proposal && !verifyNoShowProposal(record.live.proposal)) return false;
  if (record.live.publication) {
    const { publicationHash, ...publicationBody } = record.live.publication;
    const publishedState = replayLiveOperationsEvents(record.live.state.definition,
      record.live.state.events.slice(0, publicationBody.stateVersion));
    const option = record.live.proposal?.options.find(({ optionHash }) => optionHash === publicationBody.optionHash);
    if (publicationHash !== canonicalHash(publicationBody) || !publishedState.valid
      || publicationBody.stateProofHash !== publishedState.state.proofHash || !record.live.proposal || !option
      || publicationBody.proposalHash !== record.live.proposal.proposalHash
      || publicationBody.baseRevision !== record.live.baseRevision
      || publicationBody.revision !== publicationBody.baseRevision + 1
      || publicationBody.approvedBy === record.live.proposal.proposedBy
      || publicationBody.approvedBy === publicationBody.publishedBy
      || canonicalHash(publicationBody.affectedContestIds) !== canonicalHash(record.live.proposal.affectedContestIds)
      || canonicalHash(publicationBody.affectedEntrantIds) !== canonicalHash(record.live.proposal.affectedEntrantIds)
      || canonicalHash(publicationBody.operationalAssignments) !== canonicalHash(option.operationalAssignments)
      || canonicalHash(publicationBody.settledAsWalkoverContestIds) !== canonicalHash(option.settledAsWalkoverContestIds)) return false;
  }
  try { new InMemoryTransactionalOutbox(record.organizationId, record.live.delivery); } catch { return false; }
  return true;
}

function statusOf(record: StoredJourneyRecord): CompetitionJourneyStatus {
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

  public constructor(options: CompetitionJourneyOptions = {}) {
    this.storagePath = options.storagePath;
    this.now = options.now ?? (() => new Date().toISOString());
    this.organizationId = options.organizationId ?? "org.local";
    this.participantTokenSecret = options.participantTokenSecret ?? "";
    this.participantTokenKeyVersion = options.participantTokenKeyVersion ?? "v1";
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
      state: activatePublishedLiveState(id, compiled.graph, compiled.schedule) };
    const revised = sealRecord({ ...withoutSeal(current), updatedAt: activatedAt, live });
    this.records.set(id, revised);
    this.persist();
    return snapshotOf(revised);
  }

  public submitLiveCommand(id: string, expectedRevision: number,
    command: LiveOperationsCommand): CompetitionJourneySnapshot {
    const current = this.require(id);
    const live = this.requireProjectedLive(current, expectedRevision);
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
        participantId, participantNames, state: progression.state, assignments });
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

  public proposeNoShow(id: string, expectedRevision: number, expectedLiveVersion: number,
    request: NoShowProposalRequest): CompetitionJourneySnapshot {
    const current = this.require(id);
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
    const live = this.requireLive(current, expectedRevision);
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
            assignments: option.operationalAssignments }) },
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
      keyVersion: this.participantTokenKeyVersion }, this.participantTokenSecret);
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
      assignments: live.publication?.operationalAssignments ?? current.compiled!.schedule.contests });
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
      assignments: live.publication?.operationalAssignments ?? current.compiled!.schedule.contests });
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
        participantId, participantNames, state: live.state, assignments });
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
      participants, deliveryEvidence };
    return { ...body, projectionHash: canonicalHash(body) };
  }

  public participantDeliveryStore(organizationId: string, competitionId: string): OutboxDeliveryStore {
    const mutate = <T>(at: string, operation: (outbox: InMemoryTransactionalOutbox) => T): T => {
      const current = this.requireScoped(organizationId, competitionId);
      if (!current.live?.publication) throw new Error("journey_revision_conflict");
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
  :root{color-scheme:light;font-family:Inter,ui-sans-serif,system-ui,sans-serif;background:#f4f6f2;color:#17201d}body{margin:0}.shell{max-width:1100px;margin:auto;padding:32px 22px 64px}a{color:#315d4b}.eyebrow{font-size:.78rem;text-transform:uppercase;letter-spacing:.12em;color:#577064}.hero,.card{background:#fff;border:1px solid #dce3dc;border-radius:20px;box-shadow:0 10px 30px #1c3a2d0c}.hero{padding:28px;margin:18px 0}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px}.card{padding:18px}.metric{font-size:2rem;font-weight:720}.ok{color:#19734a}.blocked{color:#a23b28}.schedule{margin-top:18px;overflow:auto}table{width:100%;border-collapse:collapse;background:#fff}th,td{text-align:left;padding:11px;border-bottom:1px solid #e5e9e5;white-space:nowrap}code{font-size:.78rem}.muted{color:#617068}.error{padding:18px;background:#fff1ee;color:#8b2c1f;border-radius:12px}@media(max-width:600px){.shell{padding:20px 14px}.hero{padding:20px}}
  </style></head><body><main class="shell"><a href="/">← Competitions</a><section id="app" aria-live="polite"><p>Loading authoritative revision…</p></section></main>
  <script>const id=${encodedId};const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  fetch('/v1/competition-journey/'+encodeURIComponent(id)).then(async r=>{const v=await r.json();if(!r.ok)throw Error(v.error||'Not found');return v}).then(v=>{const c=v.compiled;document.title=v.name+' · Krateasy';document.querySelector('#app').innerHTML='<div class="hero"><div class="eyebrow">Immutable published competition revision</div><h1>'+esc(v.name)+'</h1><p class="muted">'+esc(v.id)+' · revision '+v.revision+' · '+esc(v.status)+'</p></div><div class="grid"><div class="card"><div class="eyebrow">Guard</div><div class="metric '+(c?.guardStatus==='PASSED'?'ok':'blocked')+'">'+esc(c?.guardStatus||'Not run')+'</div><p>'+esc(c?.guardReportHash?.slice(0,16)||'No proof yet')+'</p></div><div class="card"><div class="eyebrow">Contest accounting</div><div class="metric">'+esc(c?.actualContestCount??'—')+'</div><p>'+esc(c?.scheduledContestCount??0)+' scheduled</p></div><div class="card"><div class="eyebrow">Publication</div><div class="metric">'+esc(v.publication?'Bound':'Pending')+'</div><p>'+esc(v.publication?.certificateHash?.slice(0,16)||'Independent approval required')+'</p></div></div>'+(c?'<div class="schedule card"><h2>Published schedule</h2><table><thead><tr><th>Contest</th><th>Resource</th><th>Start</th><th>End</th></tr></thead><tbody>'+c.schedule.map(x=>'<tr><td><code>'+esc(x.contestId)+'</code></td><td>'+esc(x.resourceId)+'</td><td>'+esc(x.start)+'</td><td>'+esc(x.end)+'</td></tr>').join('')+'</tbody></table></div>':'<div class="card"><h2>Needs input</h2><p>'+esc(v.supportFindings.concat(v.questions.map(q=>q.prompt)).join(' · '))+'</p></div>')}).catch(e=>document.querySelector('#app').innerHTML='<p class="error">'+esc(e.message)+'</p>');</script></body></html>`;
}
