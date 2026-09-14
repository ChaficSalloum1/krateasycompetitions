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
  createEntrants,
  createPublicationCertificate,
  evaluateCompetitionGuard,
  runScenario,
  type CompetitionGraph,
  type CompetitionGuardReport,
  type ScheduleSolution,
  type SimulationRun,
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
import { definitionFromProductionLock, entrantsFromProductionLock,
  verifiedScheduleFromProductionLock } from "./production-lock-definition.js";

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

interface StoredJourneyRecord {
  readonly id: string;
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
  readonly webPath: string;
}

export interface CompetitionJourneyOptions {
  readonly storagePath?: string;
  readonly now?: () => string;
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
  return recordHash === makeRecordHash(body);
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

  public constructor(options: CompetitionJourneyOptions = {}) {
    this.storagePath = options.storagePath;
    this.now = options.now ?? (() => new Date().toISOString());
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
    const record = sealRecord({ id, draftVersion: 1, createdBy, createdAt: timestamp, updatedAt: timestamp,
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

  private require(id: string): StoredJourneyRecord {
    const record = this.records.get(id);
    if (!record) throw new Error("journey_not_found");
    return record;
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

export function competitionJourneyHtml(competitionId: string): string {
  const encodedId = JSON.stringify(competitionId).replaceAll("<", "\\u003c");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Krateasy competition</title><style>
  :root{color-scheme:light;font-family:Inter,ui-sans-serif,system-ui,sans-serif;background:#f4f6f2;color:#17201d}body{margin:0}.shell{max-width:1100px;margin:auto;padding:32px 22px 64px}a{color:#315d4b}.eyebrow{font-size:.78rem;text-transform:uppercase;letter-spacing:.12em;color:#577064}.hero,.card{background:#fff;border:1px solid #dce3dc;border-radius:20px;box-shadow:0 10px 30px #1c3a2d0c}.hero{padding:28px;margin:18px 0}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px}.card{padding:18px}.metric{font-size:2rem;font-weight:720}.ok{color:#19734a}.blocked{color:#a23b28}.schedule{margin-top:18px;overflow:auto}table{width:100%;border-collapse:collapse;background:#fff}th,td{text-align:left;padding:11px;border-bottom:1px solid #e5e9e5;white-space:nowrap}code{font-size:.78rem}.muted{color:#617068}.error{padding:18px;background:#fff1ee;color:#8b2c1f;border-radius:12px}@media(max-width:600px){.shell{padding:20px 14px}.hero{padding:20px}}
  </style></head><body><main class="shell"><a href="/">← Competitions</a><section id="app" aria-live="polite"><p>Loading authoritative revision…</p></section></main>
  <script>const id=${encodedId};const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  fetch('/v1/competition-journey/'+encodeURIComponent(id)).then(async r=>{const v=await r.json();if(!r.ok)throw Error(v.error||'Not found');return v}).then(v=>{const c=v.compiled;document.title=v.name+' · Krateasy';document.querySelector('#app').innerHTML='<div class="hero"><div class="eyebrow">Immutable published competition revision</div><h1>'+esc(v.name)+'</h1><p class="muted">'+esc(v.id)+' · revision '+v.revision+' · '+esc(v.status)+'</p></div><div class="grid"><div class="card"><div class="eyebrow">Guard</div><div class="metric '+(c?.guardStatus==='PASSED'?'ok':'blocked')+'">'+esc(c?.guardStatus||'Not run')+'</div><p>'+esc(c?.guardReportHash?.slice(0,16)||'No proof yet')+'</p></div><div class="card"><div class="eyebrow">Contest accounting</div><div class="metric">'+esc(c?.actualContestCount??'—')+'</div><p>'+esc(c?.scheduledContestCount??0)+' scheduled</p></div><div class="card"><div class="eyebrow">Publication</div><div class="metric">'+esc(v.publication?'Bound':'Pending')+'</div><p>'+esc(v.publication?.certificateHash?.slice(0,16)||'Independent approval required')+'</p></div></div>'+(c?'<div class="schedule card"><h2>Published schedule</h2><table><thead><tr><th>Contest</th><th>Resource</th><th>Start</th><th>End</th></tr></thead><tbody>'+c.schedule.map(x=>'<tr><td><code>'+esc(x.contestId)+'</code></td><td>'+esc(x.resourceId)+'</td><td>'+esc(x.start)+'</td><td>'+esc(x.end)+'</td></tr>').join('')+'</tbody></table></div>':'<div class="card"><h2>Needs input</h2><p>'+esc(v.supportFindings.concat(v.questions.map(q=>q.prompt)).join(' · '))+'</p></div>')}).catch(e=>document.querySelector('#app').innerHTML='<p class="error">'+esc(e.message)+'</p>');</script></body></html>`;
}
