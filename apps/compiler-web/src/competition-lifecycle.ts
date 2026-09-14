import { Buffer } from "node:buffer";
import { canonicalHash, canonicalStringify, deepFreeze, sha256, type TournamentSpec } from "@tournament-os/tournament-schema";
import {
  createBackupManifest,
  verifyRestore,
  type BackupManifest,
  type CompetitionGraph,
  type CompetitionGuardReport,
  type LiveOperationsState,
  type OutboxMessage,
  type ScheduleSolution,
  type SimulationRun,
} from "@tournament-os/competition-engine";
import type { OperationalSafetyState } from "./operational-safety.js";

export const CLOSE_ACKNOWLEDGEMENTS = [
  "FINAL_RESULTS_REVIEWED",
  "OPEN_DISPUTES_RESOLVED",
  "MANUAL_RECORDS_RECONCILED",
  "DELIVERY_EVIDENCE_REVIEWED",
] as const;

export interface ClosedContestResult {
  readonly contestId: string;
  readonly entrantIds: readonly [string, string];
  readonly status: "COMPLETED" | "WALKOVER" | "RETIRED";
  readonly scores: readonly { readonly entrantId: string; readonly value: number }[];
  readonly winnerEntrantId: string;
  readonly actualCourtId: string | null;
  readonly actualStart: string | null;
  readonly actualEnd: string | null;
  readonly resultHash: string;
}

export interface CompetitionClosure {
  readonly schemaVersion: "1.0.0";
  readonly organizationId: string;
  readonly competitionId: string;
  readonly publishedRevision: number;
  readonly operationalRevision: number;
  readonly liveVersion: number;
  readonly closedBy: string;
  readonly closedAt: string;
  readonly acknowledgedCodes: readonly string[];
  readonly resultSummary: {
    readonly total: number;
    readonly completed: number;
    readonly walkovers: number;
    readonly retirements: number;
    readonly unresolved: 0;
    readonly resultsHash: string;
  };
  readonly results: readonly ClosedContestResult[];
  readonly deliveryEvidence: readonly {
    readonly messageId: string;
    readonly status: string;
    readonly attempts: number;
    readonly providerId?: string;
    readonly providerMessageId?: string;
  }[];
  readonly authority: {
    readonly specificationHash: string;
    readonly graphHash: string;
    readonly scheduleHash: string;
    readonly simulationHash: string | null;
    readonly guardReportHash: string;
    readonly publicationCertificateHash: string;
    readonly operationalPublicationHash: string | null;
    readonly liveStateProofHash: string;
    readonly operationalStateProofHash: string;
    readonly sourceDocumentsHash: string;
  };
  readonly outboxIntents: readonly [{
    readonly topic: "competition.closed.v1";
    readonly key: string;
    readonly payload: {
      readonly organizationId: string;
      readonly competitionId: string;
      readonly publishedRevision: number;
      readonly operationalRevision: number;
      readonly liveVersion: number;
      readonly resultsHash: string;
    };
  }];
  readonly closureHash: string;
}

export interface CompetitionEvidenceArtifact {
  readonly fileName: string;
  readonly mediaType: string;
  readonly content: string;
  readonly sha256: string;
}

export interface CompetitionEvidenceBundle {
  readonly schemaVersion: "1.0.0";
  readonly organizationId: string;
  readonly competitionId: string;
  readonly closureHash: string;
  readonly generatedAt: string;
  readonly manifest: BackupManifest;
  readonly artifacts: readonly CompetitionEvidenceArtifact[];
  readonly sourceTruth: readonly {
    readonly organizationId: string;
    readonly streamId: string;
    readonly streamVersion: number;
    readonly eventHeadHash: string;
    readonly stateHash: string;
    readonly proofHashes: Readonly<Record<string, string>>;
  }[];
  readonly bundleHash: string;
}

function canonicalTimestamp(value: string, label: string): void {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) throw new Error(`${label}_must_be_canonical`);
}

function exactAcknowledgements(input: readonly string[]): boolean {
  return canonicalHash([...new Set(input)].sort()) === canonicalHash([...CLOSE_ACKNOWLEDGEMENTS].sort());
}

function terminalResults(state: LiveOperationsState): ClosedContestResult[] {
  const results: ClosedContestResult[] = [];
  const problems: string[] = [];
  for (const definition of state.definition.contests) {
    const contest = state.contests[definition.contestId];
    const entrants = state.resolvedEntrants[definition.contestId];
    if (!contest || !entrants || entrants.length !== 2) {
      problems.push(`${definition.contestId}:entrant_identity_unresolved`);
      continue;
    }
    if (!new Set(["COMPLETED", "WALKOVER", "RETIRED"]).has(contest.status)) {
      problems.push(`${definition.contestId}:not_terminal`);
      continue;
    }
    let winnerEntrantId = contest.winnerEntrantId;
    const scores = [...(contest.scores ?? [])].sort((left, right) => left.entrantId.localeCompare(right.entrantId));
    if (contest.status === "COMPLETED") {
      if (scores.length !== 2 || scores.some(({ entrantId, value }) => !entrants.includes(entrantId)
        || !Number.isSafeInteger(value) || value < 0) || scores[0]!.value === scores[1]!.value) {
        problems.push(`${definition.contestId}:result_unresolved`);
        continue;
      }
      winnerEntrantId = scores[0]!.value > scores[1]!.value ? scores[0]!.entrantId : scores[1]!.entrantId;
      if (!contest.actualStart || !contest.actualEnd || !contest.actualCourtId) {
        problems.push(`${definition.contestId}:actual_timing_unresolved`);
        continue;
      }
    }
    if (!winnerEntrantId || !entrants.includes(winnerEntrantId)) {
      problems.push(`${definition.contestId}:winner_unresolved`);
      continue;
    }
    const body = { contestId: definition.contestId, entrantIds: [...entrants].sort() as [string, string],
      status: contest.status as ClosedContestResult["status"], scores, winnerEntrantId,
      actualCourtId: contest.actualCourtId ?? null, actualStart: contest.actualStart ?? null,
      actualEnd: contest.actualEnd ?? null };
    results.push({ ...body, resultHash: canonicalHash(body) });
  }
  if (problems.length) throw new Error(`competition_close_blocked:${problems.sort().join(",")}`);
  return results.sort((left, right) => left.contestId.localeCompare(right.contestId));
}

export function deriveCompetitionClosure(input: {
  readonly organizationId: string;
  readonly competitionId: string;
  readonly publishedRevision: number;
  readonly operationalRevision: number;
  readonly closedBy: string;
  readonly closedAt: string;
  readonly acknowledgedCodes: readonly string[];
  readonly live: LiveOperationsState;
  readonly operations: OperationalSafetyState;
  readonly delivery?: readonly Readonly<OutboxMessage>[];
  readonly deliveryEvidence?: CompetitionClosure["deliveryEvidence"];
  readonly authority: CompetitionClosure["authority"];
}): CompetitionClosure {
  if (!input.organizationId.trim() || !input.competitionId.trim() || !input.closedBy.trim())
    throw new Error("invalid_competition_close_identity");
  canonicalTimestamp(input.closedAt, "closedAt");
  if (!exactAcknowledgements(input.acknowledgedCodes)) throw new Error("competition_close_acknowledgements_mismatch");
  if (input.operations.mode !== "NORMAL") throw new Error("competition_close_blocked:operational_mode_not_normal");
  const pendingProtests = Object.values(input.live.protests).filter(({ status }) => status === "PENDING").map(({ protestId }) => protestId);
  const pendingAppeals = Object.values(input.live.appeals).filter(({ status }) => status === "PENDING").map(({ appealId }) => appealId);
  if (pendingProtests.length || pendingAppeals.length) throw new Error(`competition_close_blocked:open_disputes:${[
    ...pendingProtests, ...pendingAppeals].sort().join(",")}`);
  const results = terminalResults(input.live);
  const resultsHash = canonicalHash(results);
  const deliveryEvidence = (input.deliveryEvidence ? [...input.deliveryEvidence] : (input.delivery ?? [])
    .map(({ id, status, attempts, providerId, providerMessageId }) => ({
      messageId: id, status, attempts, ...(providerId ? { providerId } : {}),
      ...(providerMessageId ? { providerMessageId } : {}),
    }))).sort((left, right) => left.messageId.localeCompare(right.messageId));
  const resultSummary = { total: results.length,
    completed: results.filter(({ status }) => status === "COMPLETED").length,
    walkovers: results.filter(({ status }) => status === "WALKOVER").length,
    retirements: results.filter(({ status }) => status === "RETIRED").length,
    unresolved: 0 as const, resultsHash };
  const outboxIntents = [{ topic: "competition.closed.v1" as const,
    key: `${input.competitionId}:closed:p${input.publishedRevision}:o${input.operationalRevision}`,
    payload: { organizationId: input.organizationId, competitionId: input.competitionId,
      publishedRevision: input.publishedRevision, operationalRevision: input.operationalRevision,
      liveVersion: input.live.version, resultsHash } }] as const;
  const body = { schemaVersion: "1.0.0" as const, organizationId: input.organizationId,
    competitionId: input.competitionId, publishedRevision: input.publishedRevision,
    operationalRevision: input.operationalRevision, liveVersion: input.live.version,
    closedBy: input.closedBy, closedAt: input.closedAt,
    acknowledgedCodes: [...CLOSE_ACKNOWLEDGEMENTS], resultSummary, results, deliveryEvidence,
    authority: input.authority, outboxIntents };
  return deepFreeze({ ...body, closureHash: canonicalHash(body) });
}

export function verifyCompetitionClosure(closure: CompetitionClosure, input: {
  readonly live: LiveOperationsState;
  readonly operations: OperationalSafetyState;
  readonly authority: CompetitionClosure["authority"];
}): boolean {
  try {
    const rebuilt = deriveCompetitionClosure({ organizationId: closure.organizationId,
      competitionId: closure.competitionId, publishedRevision: closure.publishedRevision,
      operationalRevision: closure.operationalRevision, closedBy: closure.closedBy, closedAt: closure.closedAt,
      acknowledgedCodes: closure.acknowledgedCodes, live: input.live, operations: input.operations,
      deliveryEvidence: closure.deliveryEvidence, authority: input.authority });
    return canonicalHash(rebuilt) === canonicalHash(closure);
  } catch { return false; }
}

function artifact(fileName: string, mediaType: string, value: unknown, raw = false): CompetitionEvidenceArtifact {
  const content = raw ? String(value) : canonicalStringify(value);
  return { fileName, mediaType, content, sha256: sha256(content) };
}

function auditMarkdown(input: { readonly name: string; readonly closure: CompetitionClosure }): string {
  const { closure } = input;
  return ["# Krateasy Competition Closure Evidence", "", `Competition: ${input.name}`,
    `Identity: ${closure.competitionId}`, `Published revision: ${closure.publishedRevision}`,
    `Operational revision: ${closure.operationalRevision}`, `Live version: ${closure.liveVersion}`,
    `Closed: ${closure.closedAt}`, `Closure proof: \`${closure.closureHash}\``, "",
    "## Final result accounting", "", `- Total: ${closure.resultSummary.total}`,
    `- Completed: ${closure.resultSummary.completed}`, `- Walkovers: ${closure.resultSummary.walkovers}`,
    `- Retirements: ${closure.resultSummary.retirements}`, `- Unresolved: ${closure.resultSummary.unresolved}`,
    `- Results proof: \`${closure.resultSummary.resultsHash}\``, "", "## Authority proofs", "",
    ...Object.entries(closure.authority).sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => `- ${key}: \`${value ?? "not-applicable"}\``), "",
    "This report is a projection of the immutable machine artifacts in the same content-addressed bundle.", ""].join("\n");
}

export function createCompetitionEvidenceBundle(input: {
  readonly name: string;
  readonly closure: CompetitionClosure;
  readonly sources: unknown;
  readonly spec: TournamentSpec;
  readonly graph: CompetitionGraph;
  readonly schedule: ScheduleSolution;
  readonly simulation?: SimulationRun;
  readonly guardReport: CompetitionGuardReport;
  readonly approval: unknown;
  readonly publication: unknown;
  readonly operationalPublications: unknown;
  readonly live: LiveOperationsState;
  readonly operations: OperationalSafetyState;
  readonly authoritativeRecord: unknown;
  readonly recordHash: string;
}): CompetitionEvidenceBundle {
  const artifacts = [
    artifact("sources.json", "application/json", input.sources),
    artifact("specification.json", "application/json", input.spec),
    artifact("graph.json", "application/json", input.graph),
    artifact("schedule.json", "application/json", input.schedule),
    ...(input.simulation ? [artifact("simulation.json", "application/json", input.simulation)] : []),
    artifact("guard-report.json", "application/json", input.guardReport),
    artifact("approval.json", "application/json", input.approval),
    artifact("publication.json", "application/json", { publication: input.publication,
      operationalPublications: input.operationalPublications }),
    artifact("actual-results.json", "application/json", input.closure.results),
    artifact("live-events.json", "application/json", input.live.events),
    artifact("operational-events.json", "application/json", input.operations.events),
    artifact("closure.json", "application/json", input.closure),
    artifact("authoritative-record.json", "application/json", input.authoritativeRecord),
    artifact("audit.md", "text/markdown; charset=utf-8", auditMarkdown({ name: input.name, closure: input.closure }), true),
  ].sort((left, right) => left.fileName.localeCompare(right.fileName));
  const manifest = createBackupManifest({ backupId: `closure.${input.closure.closureHash.slice(0, 24)}`,
    createdAt: input.closure.closedAt, schemaVersion: "competition-journey-closure-bundle/1.0.0",
    artifacts: artifacts.map(({ fileName: path, content, sha256 }) => ({ path,
      bytes: Buffer.byteLength(content, "utf8"), sha256 })) });
  const sourceTruth = [{ organizationId: input.closure.organizationId, streamId: input.closure.competitionId,
    streamVersion: input.live.version + input.operations.version + 1,
    eventHeadHash: canonicalHash({ live: input.live.lastEventHash, operations: input.operations.lastEventHash }),
    stateHash: input.recordHash, proofHashes: { closure: input.closure.closureHash,
      live: input.live.proofHash, operations: input.operations.proofHash,
      results: input.closure.resultSummary.resultsHash } }];
  const body = { schemaVersion: "1.0.0" as const, organizationId: input.closure.organizationId,
    competitionId: input.closure.competitionId, closureHash: input.closure.closureHash,
    generatedAt: input.closure.closedAt, manifest, artifacts, sourceTruth };
  return deepFreeze({ ...body, bundleHash: canonicalHash(body) });
}

export function verifyCompetitionEvidenceBundle(bundle: CompetitionEvidenceBundle): Readonly<{
  authoritativeRecord: unknown;
  restoredArtifacts: readonly { path: string; bytes: number; sha256: string }[];
}> {
  const { bundleHash, ...body } = bundle;
  if (bundle.schemaVersion !== "1.0.0" || canonicalHash(body) !== bundleHash)
    throw new Error("invalid_competition_evidence_bundle");
  const paths = new Set(bundle.artifacts.map(({ fileName }) => fileName));
  const required = ["sources.json", "specification.json", "graph.json", "schedule.json", "guard-report.json",
    "approval.json", "publication.json", "actual-results.json", "live-events.json", "operational-events.json",
    "closure.json", "authoritative-record.json", "audit.md"];
  if (paths.size !== bundle.artifacts.length || required.some((path) => !paths.has(path)))
    throw new Error("invalid_competition_evidence_bundle");
  const restoredArtifacts = bundle.artifacts.map(({ fileName: path, content, sha256: expected }) => {
    const actual = sha256(content);
    if (actual !== expected) throw new Error("invalid_competition_evidence_bundle");
    return { path, bytes: Buffer.byteLength(content, "utf8"), sha256: actual };
  });
  if (verifyRestore(bundle.manifest, restoredArtifacts,
    { expectedSchemaVersion: "competition-journey-closure-bundle/1.0.0" }).status !== "VERIFIED")
    throw new Error("invalid_competition_evidence_bundle");
  const recordArtifact = bundle.artifacts.find(({ fileName }) => fileName === "authoritative-record.json")!;
  let authoritativeRecord: unknown;
  try { authoritativeRecord = JSON.parse(recordArtifact.content); }
  catch { throw new Error("invalid_competition_evidence_bundle"); }
  return { authoritativeRecord, restoredArtifacts };
}
