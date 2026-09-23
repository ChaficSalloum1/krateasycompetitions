import {
  canonicalHash,
  deepFreeze,
  type TournamentSpec,
  type ValidationFinding,
} from "@tournament-os/tournament-schema";
import { certify } from "./certification.js";
import { independentlyExpectedContestCount } from "./graph.js";
import { independentlyValidateAdvancementPaths } from "./guard-path-reconstruction.js";
import { verifyPublicationChangeSet, type PublicationChangeSet } from "./publication-change-set.js";
import type { CompetitionGraph, ScheduleSolution, SimulationRun } from "./types.js";

export type CompetitionGuardSeverity =
  | "CRITICAL"
  | "INTEGRITY"
  | "OPERATIONAL"
  | "EXPERIENCE"
  | "OPTIMIZATION"
  | "INFORMATION";

export type CompetitionGuardPublicationDisposition = "BLOCK" | "ACKNOWLEDGE" | "ALLOW";

export const COMPETITION_GUARD_SEVERITY_POLICY: Readonly<Record<CompetitionGuardSeverity,
  CompetitionGuardPublicationDisposition>> = deepFreeze({
    CRITICAL: "BLOCK", INTEGRITY: "BLOCK", OPERATIONAL: "ACKNOWLEDGE",
    EXPERIENCE: "ALLOW", OPTIMIZATION: "ALLOW", INFORMATION: "ALLOW",
  });

export interface CompetitionGuardInput {
  readonly sourceDefinitionHash: string;
  readonly spec: TournamentSpec;
  readonly graph: CompetitionGraph;
  readonly schedule: ScheduleSolution;
  readonly simulation?: SimulationRun;
  readonly rulePackHashes?: readonly string[];
}

export interface CompetitionGuardFinding {
  readonly rule: string;
  readonly sourceCode: string;
  readonly severity: CompetitionGuardSeverity;
  readonly publicationDisposition: CompetitionGuardPublicationDisposition;
  readonly status: "FAILED";
  readonly path: string;
  readonly entities: readonly string[];
  readonly message: string;
  readonly evidence: Readonly<Record<string, unknown>>;
  readonly evidenceHash: string;
  readonly suggestedCorrection: string;
}

export interface CompetitionGuardContestLedgerRow {
  readonly divisionId: string;
  readonly stageId: string;
  readonly primitive: TournamentSpec["stages"][number]["primitive"];
  readonly poolId: string | null;
  readonly round: string;
  readonly requiredContestIds: readonly string[];
  readonly scheduledContestIds: readonly string[];
  readonly unscheduledContestIds: readonly string[];
  readonly duplicateContestIds: readonly string[];
  readonly contestMinutes: number;
  readonly turnaroundMinutes: number;
  readonly requiredOccupiedMinutes: number;
  readonly scheduledOccupiedMinutes: number;
}

export interface CompetitionGuardResourceLedgerRow {
  readonly resourceId: string;
  readonly resourceType: string;
  readonly scheduledContestIds: readonly string[];
  readonly occupiedMinutes: number;
  readonly availableMinutes: number;
  readonly spareCapacityMinutes: number;
}

export interface CompetitionGuardAccounting {
  readonly requiredContestCount: number;
  readonly scheduledContestCount: number;
  readonly uniqueScheduledContestCount: number;
  readonly unscheduledContestIds: readonly string[];
  readonly duplicateContestIds: readonly string[];
  readonly unexpectedContestIds: readonly string[];
  readonly occupiedMinutes: number;
  readonly availableResourceMinutes: number;
  readonly trueSpareCapacityMinutes: number;
  readonly earliestStart: string | null;
  readonly latestFinish: string | null;
  readonly contestLedger: readonly CompetitionGuardContestLedgerRow[];
  readonly resourceLedger: readonly CompetitionGuardResourceLedgerRow[];
  readonly reconciled: boolean;
}

export interface CompetitionGuardBinding {
  readonly sourceDefinitionHash: string;
  readonly specHash: string;
  readonly graphHash: string;
  readonly scheduleHash: string;
  readonly simulationHash?: string;
  readonly rulesetVersionsHash: string;
  readonly rulePackHashes: readonly string[];
  readonly requirementCoverageHash: string;
}

export interface CompetitionGuardReport {
  readonly schemaVersion: "1.0.0";
  readonly guardVersion: "1.2.0";
  readonly status: "PASSED" | "BLOCKED";
  readonly integrityGrade: "CERTIFIED" | "REJECTED";
  readonly findings: readonly CompetitionGuardFinding[];
  readonly requiredAcknowledgementCodes: readonly string[];
  readonly accounting: CompetitionGuardAccounting;
  readonly binding: CompetitionGuardBinding;
  readonly certificationHash: string;
  readonly reportHash: string;
}

export interface PublicationCertificate {
  readonly schemaVersion: "1.0.0";
  readonly certificateVersion: "1.1.0";
  readonly tournamentId: string;
  readonly tournamentRevision: number;
  readonly sourceDefinitionHash: string;
  readonly specHash: string;
  readonly graphHash: string;
  readonly scheduleHash: string;
  readonly simulationHash?: string;
  readonly rulesetVersionsHash: string;
  readonly rulePackHashes: readonly string[];
  readonly requirementCoverageHash: string;
  readonly changeSetHash: string;
  readonly guardReportHash: string;
  readonly certificationHash: string;
  readonly acknowledgedFindingCodes: readonly string[];
  readonly issuedBy: string;
  readonly issuedAt: string;
  readonly certificateHash: string;
}

export interface PublicationCertificateRequest {
  readonly tournamentId: string;
  readonly tournamentRevision: number;
  readonly report: CompetitionGuardReport;
  readonly changeSet: PublicationChangeSet;
  readonly acknowledgedFindingCodes: readonly string[];
  readonly issuedBy: string;
  readonly issuedAt: string;
}

function entitiesFrom(finding: ValidationFinding): string[] {
  if (!finding.evidence) return [];
  const ids = Object.entries(finding.evidence).flatMap(([key, value]) => {
    if (!/(^id$|Id$|Ids$|entrant|participant|contest|resource|stage|pool)/i.test(key)) return [];
    if (typeof value === "string") return [value];
    if (Array.isArray(value)) return value.filter((entry): entry is string => typeof entry === "string");
    return [];
  });
  return [...new Set(ids)].sort();
}

export function classifyCompetitionGuardFinding(finding: ValidationFinding): CompetitionGuardSeverity {
  if (finding.severity === "WARNING") {
    if (/optim|better plan|unused capacity/i.test(`${finding.code} ${finding.message}`)) return "OPTIMIZATION";
    if (/information|observation|informational/i.test(`${finding.code} ${finding.message}`)) return "INFORMATION";
    if (/^TSW|experience|fairness|wait|rest|opportunity/i.test(`${finding.code} ${finding.message}`)) return "EXPERIENCE";
    return "OPERATIONAL";
  }
  if (/^(TSV|TSC4)/.test(finding.code)) return "CRITICAL";
  return "INTEGRITY";
}

function suggestedCorrection(finding: ValidationFinding): string {
  if (finding.code === "KCG001") return "Resolve and compile the exact authoritative definition revision, then rerun Guard.";
  if (/^KCG00[23456]$/.test(finding.code)) return "Regenerate the graph from the authoritative definition and rerun independent Guard validation.";
  if (/^TSV/.test(finding.code)) return "Repair the schedule against the declared resources, durations and dependencies, then rerun Guard.";
  if (/^TSW/.test(finding.code)) return "Review the operational risk, choose an explicit policy and record the required acknowledgement.";
  if (/^TSC/.test(finding.code)) return "Resolve the cited definition or rule evidence and recompile before publication.";
  return "Correct the cited entities at the authoritative source and rerun the complete Guard.";
}

function durationFor(spec: TournamentSpec, stageId: string, round: string): {
  readonly contestMinutes: number; readonly turnaroundMinutes: number;
} {
  const exact = [...spec.scheduling.durations].reverse().find((duration) =>
    duration.stageId === stageId && duration.round === round);
  const general = [...spec.scheduling.durations].reverse().find((duration) =>
    duration.stageId === stageId && duration.round === undefined);
  const duration = exact ?? general;
  return duration ? { contestMinutes: duration.contestMinutes, turnaroundMinutes: duration.turnaroundMinutes }
    : { contestMinutes: 0, turnaroundMinutes: 0 };
}

function accountingFor(graph: CompetitionGraph, schedule: ScheduleSolution, spec: TournamentSpec): CompetitionGuardAccounting {
  const scheduledIds = schedule.contests.map(({ contestId }) => contestId);
  const uniqueScheduledIds = new Set(scheduledIds);
  const requiredIds = graph.nodes.filter(({ kind }) => kind === "contest").map(({ id }) => id).sort();
  const requiredIdSet = new Set(requiredIds);
  const duplicateContestIds = [...new Set(scheduledIds.filter((id, index) => scheduledIds.indexOf(id) !== index))].sort();
  const unexpectedContestIds = [...new Set(scheduledIds.filter((id) => !requiredIdSet.has(id)))].sort();
  const occupiedMinutes = schedule.contests.reduce((total, contest) =>
    total + Math.max(0, (Date.parse(contest.end) - Date.parse(contest.start)) / 60_000), 0);
  const availableResourceMinutes = spec.resources.reduce((total, resource) => total + resource.quantity * resource.availability.reduce(
    (resourceTotal, window) => resourceTotal + Math.max(0, (Date.parse(window.end) - Date.parse(window.start)) / 60_000), 0), 0);
  const starts = schedule.contests.map(({ start }) => Date.parse(start)).filter(Number.isFinite);
  const finishes = schedule.contests.map(({ end }) => Date.parse(end)).filter(Number.isFinite);
  const stageById = new Map(spec.stages.map((stage) => [stage.id, stage]));
  const grouped = new Map<string, typeof graph.nodes>();
  for (const node of graph.nodes.filter(({ kind }) => kind === "contest")) {
    const key = `${node.divisionId}\u0000${node.stageId}\u0000${node.poolId ?? ""}\u0000${node.round}`;
    grouped.set(key, [...(grouped.get(key) ?? []), node]);
  }
  const contestLedger = [...grouped.values()].map((nodes): CompetitionGuardContestLedgerRow => {
    const first = nodes[0]!;
    const ids = nodes.map(({ id }) => id).sort();
    const idSet = new Set(ids);
    const scheduled = schedule.contests.filter(({ contestId }) => idSet.has(contestId));
    const scheduledRowIds = scheduled.map(({ contestId }) => contestId).sort();
    const duration = durationFor(spec, first.stageId, first.round);
    return {
      divisionId: first.divisionId, stageId: first.stageId,
      primitive: stageById.get(first.stageId)?.primitive ?? "custom_graph",
      poolId: first.poolId ?? null, round: first.round, requiredContestIds: ids,
      scheduledContestIds: scheduledRowIds,
      unscheduledContestIds: ids.filter((id) => !scheduledRowIds.includes(id)),
      duplicateContestIds: [...new Set(scheduledRowIds.filter((id, index) => scheduledRowIds.indexOf(id) !== index))].sort(),
      contestMinutes: duration.contestMinutes * ids.length,
      turnaroundMinutes: duration.turnaroundMinutes * ids.length,
      requiredOccupiedMinutes: (duration.contestMinutes + duration.turnaroundMinutes) * ids.length,
      scheduledOccupiedMinutes: scheduled.reduce((total, contest) => total
        + Math.max(0, (Date.parse(contest.end) - Date.parse(contest.start)) / 60_000), 0),
    };
  }).sort((left, right) => left.divisionId.localeCompare(right.divisionId)
    || left.stageId.localeCompare(right.stageId) || (left.poolId ?? "").localeCompare(right.poolId ?? "")
    || left.round.localeCompare(right.round));
  const resourceLedger = spec.resources.flatMap((resource) => Array.from({ length: resource.quantity }, (_, index) => {
    const resourceId = `${resource.id}.${index + 1}`;
    const contests = schedule.contests.filter((contest) => contest.resourceId === resourceId);
    const availableMinutes = resource.availability.reduce((total, window) => total
      + Math.max(0, (Date.parse(window.end) - Date.parse(window.start)) / 60_000), 0);
    const occupied = contests.reduce((total, contest) => total
      + Math.max(0, (Date.parse(contest.end) - Date.parse(contest.start)) / 60_000), 0);
    return { resourceId, resourceType: resource.type,
      scheduledContestIds: contests.map(({ contestId }) => contestId).sort(), occupiedMinutes: occupied,
      availableMinutes, spareCapacityMinutes: availableMinutes - occupied };
  })).sort((left, right) => left.resourceId.localeCompare(right.resourceId));
  const unscheduledContestIds = requiredIds.filter((id) => !uniqueScheduledIds.has(id));
  const requiredMinutes = contestLedger.reduce((total, row) => total + row.requiredOccupiedMinutes, 0);
  const base = {
    requiredContestCount: graph.generatedActualContestCount,
    scheduledContestCount: schedule.contests.length,
    uniqueScheduledContestCount: uniqueScheduledIds.size,
    unscheduledContestIds,
    duplicateContestIds,
    unexpectedContestIds,
    occupiedMinutes,
    availableResourceMinutes,
    trueSpareCapacityMinutes: availableResourceMinutes - occupiedMinutes,
    earliestStart: starts.length ? new Date(Math.min(...starts)).toISOString() : null,
    latestFinish: finishes.length ? new Date(Math.max(...finishes)).toISOString() : null,
    contestLedger,
    resourceLedger,
  };
  return { ...base, reconciled: unscheduledContestIds.length === 0 && duplicateContestIds.length === 0
    && unexpectedContestIds.length === 0 && requiredIds.length === graph.generatedActualContestCount
    && requiredMinutes === occupiedMinutes
    && resourceLedger.reduce((total, row) => total + row.occupiedMinutes, 0) === occupiedMinutes
    && resourceLedger.reduce((total, row) => total + row.availableMinutes, 0) === availableResourceMinutes };
}

export function evaluateCompetitionGuard(input: CompetitionGuardInput): Readonly<CompetitionGuardReport> {
  const certification = certify(input.spec, input.graph, input.schedule, input.simulation);
  const bindingFindings: ValidationFinding[] = [];
  const independentlyRequiredContestCount = independentlyExpectedContestCount(input.spec);
  if (canonicalHash(input.spec) !== input.sourceDefinitionHash) bindingFindings.push({
    code: "KCG001", severity: "ERROR", path: "/sourceDefinitionHash",
    message: "The proposed source definition hash does not bind the exact compiled specification supplied to the Competition Guard.",
    evidence: { expected: canonicalHash(input.spec), actual: input.sourceDefinitionHash },
  });
  if (input.graph.specHash !== input.spec.metadata.compiledSpecHash) bindingFindings.push({
    code: "KCG002", severity: "ERROR", path: "/graph/specHash",
    message: "The competition graph was not derived from the supplied compiled specification.",
    evidence: { expected: input.spec.metadata.compiledSpecHash, actual: input.graph.specHash },
  });
  if (input.graph.expectedActualContestCount !== independentlyRequiredContestCount) bindingFindings.push({
    code: "KCG003", severity: "ERROR", path: "/graph/expectedActualContestCount",
    message: "The proposed graph's expected contest count disagrees with the Guard's independent derivation from the compiled specification.",
    evidence: { expected: independentlyRequiredContestCount, actual: input.graph.expectedActualContestCount },
  });
  if (input.graph.generatedActualContestCount !== independentlyRequiredContestCount) bindingFindings.push({
    code: "KCG004", severity: "ERROR", path: "/graph/generatedActualContestCount",
    message: "The proposed graph omits or invents contests relative to the Guard's independent derivation from the compiled specification.",
    evidence: { expected: independentlyRequiredContestCount, actual: input.graph.generatedActualContestCount },
  });
  const countedContests = input.graph.nodes.filter(({ kind }) => kind === "contest").length;
  if (countedContests !== input.graph.generatedActualContestCount) bindingFindings.push({
    code: "KCG006", severity: "ERROR", path: "/graph/nodes",
    message: "The graph's reported contest count disagrees with the contests the Guard counted in the graph itself.",
    evidence: { counted: countedContests, reported: input.graph.generatedActualContestCount },
  });
  bindingFindings.push(...independentlyValidateAdvancementPaths(input.spec, input.graph));
  const findings = [...certification.findings, ...bindingFindings]
    .map((finding): CompetitionGuardFinding => {
      const severity = classifyCompetitionGuardFinding(finding);
      return {
      rule: finding.path,
      sourceCode: finding.code,
      severity,
      publicationDisposition: COMPETITION_GUARD_SEVERITY_POLICY[severity],
      status: "FAILED",
      path: finding.path,
      entities: entitiesFrom(finding),
      message: finding.message,
      evidence: structuredClone(finding.evidence ?? {}),
      evidenceHash: canonicalHash(finding.evidence ?? {}),
      suggestedCorrection: suggestedCorrection(finding),
    }; })
    .sort((left, right) => left.severity.localeCompare(right.severity)
      || left.sourceCode.localeCompare(right.sourceCode)
      || left.path.localeCompare(right.path)
      || left.message.localeCompare(right.message));
  const blocked = findings.some(({ publicationDisposition }) => publicationDisposition === "BLOCK");
  const binding: CompetitionGuardBinding = {
    sourceDefinitionHash: input.sourceDefinitionHash,
    specHash: certification.specHash,
    graphHash: certification.graphHash,
    scheduleHash: canonicalHash(input.schedule),
    ...(input.simulation ? { simulationHash: canonicalHash(input.simulation) } : {}),
    rulesetVersionsHash: canonicalHash(input.spec.metadata.rulesetVersions),
    rulePackHashes: [...new Set(input.rulePackHashes ?? [])].sort(),
    requirementCoverageHash: canonicalHash(certification.requirementCoverage),
  };
  const body = {
    schemaVersion: "1.0.0" as const,
    guardVersion: "1.2.0" as const,
    status: blocked ? "BLOCKED" as const : "PASSED" as const,
    integrityGrade: blocked ? "REJECTED" as const : "CERTIFIED" as const,
    findings,
    requiredAcknowledgementCodes: [...new Set(findings.filter(({ publicationDisposition }) => publicationDisposition === "ACKNOWLEDGE")
      .map(({ sourceCode }) => sourceCode))].sort(),
    accounting: accountingFor(input.graph, input.schedule, input.spec),
    binding,
    certificationHash: certification.certificationHash,
  };
  return deepFreeze({ ...body, reportHash: canonicalHash(body) });
}

export function verifyCompetitionGuardReport(report: CompetitionGuardReport): boolean {
  const { reportHash, ...body } = report;
  return canonicalHash(body) === reportHash;
}

export function createPublicationCertificate(request: PublicationCertificateRequest): Readonly<PublicationCertificate> {
  if (!verifyCompetitionGuardReport(request.report) || request.report.status !== "PASSED"
    || request.report.integrityGrade !== "CERTIFIED") {
    throw new Error("A publication certificate requires an intact, passing Competition Guard report");
  }
  if (!request.tournamentId.trim() || !Number.isInteger(request.tournamentRevision) || request.tournamentRevision < 1
    || !request.issuedBy.trim()) {
    throw new Error("Publication certificate identity and revision are invalid");
  }
  const issuedAt = Date.parse(request.issuedAt);
  if (!Number.isFinite(issuedAt) || new Date(issuedAt).toISOString() !== request.issuedAt) {
    throw new Error("Publication certificate time must be a canonical timestamp");
  }
  const acknowledgedFindingCodes = [...new Set(request.acknowledgedFindingCodes)].sort();
  if (canonicalHash(acknowledgedFindingCodes) !== canonicalHash(request.report.requiredAcknowledgementCodes)) {
    throw new Error("Every and only required operational Guard finding must be acknowledged");
  }
  if (!verifyPublicationChangeSet(request.changeSet)
    || request.changeSet.toRevision !== request.tournamentRevision
    || request.changeSet.definitionHash !== request.report.binding.sourceDefinitionHash
    || request.changeSet.specHash !== request.report.binding.specHash
    || request.changeSet.scheduleHash !== request.report.binding.scheduleHash) {
    throw new Error("Publication change set must be intact and bound to the exact guarded revision");
  }
  const body = {
    schemaVersion: "1.0.0" as const,
    certificateVersion: "1.1.0" as const,
    tournamentId: request.tournamentId,
    tournamentRevision: request.tournamentRevision,
    sourceDefinitionHash: request.report.binding.sourceDefinitionHash,
    specHash: request.report.binding.specHash,
    graphHash: request.report.binding.graphHash,
    scheduleHash: request.report.binding.scheduleHash,
    ...(request.report.binding.simulationHash ? { simulationHash: request.report.binding.simulationHash } : {}),
    rulesetVersionsHash: request.report.binding.rulesetVersionsHash,
    rulePackHashes: [...request.report.binding.rulePackHashes],
    requirementCoverageHash: request.report.binding.requirementCoverageHash,
    changeSetHash: request.changeSet.changeSetHash,
    guardReportHash: request.report.reportHash,
    certificationHash: request.report.certificationHash,
    acknowledgedFindingCodes,
    issuedBy: request.issuedBy,
    issuedAt: request.issuedAt,
  };
  return deepFreeze({ ...body, certificateHash: canonicalHash(body) });
}

export function verifyPublicationCertificate(
  certificate: PublicationCertificate,
  report?: CompetitionGuardReport,
  changeSet?: PublicationChangeSet,
): boolean {
  const { certificateHash, ...body } = certificate;
  if (canonicalHash(body) !== certificateHash) return false;
  if (!report && !changeSet) return true;
  if (!report || !changeSet) return false;
  return verifyCompetitionGuardReport(report)
    && verifyPublicationChangeSet(changeSet)
    && report.status === "PASSED"
    && report.integrityGrade === "CERTIFIED"
    && certificate.guardReportHash === report.reportHash
    && certificate.sourceDefinitionHash === report.binding.sourceDefinitionHash
    && certificate.specHash === report.binding.specHash
    && certificate.graphHash === report.binding.graphHash
    && certificate.scheduleHash === report.binding.scheduleHash
    && certificate.simulationHash === report.binding.simulationHash
    && certificate.rulesetVersionsHash === report.binding.rulesetVersionsHash
    && canonicalHash(certificate.rulePackHashes) === canonicalHash(report.binding.rulePackHashes)
    && certificate.requirementCoverageHash === report.binding.requirementCoverageHash
    && certificate.changeSetHash === changeSet.changeSetHash
    && changeSet.toRevision === certificate.tournamentRevision
    && changeSet.definitionHash === report.binding.sourceDefinitionHash
    && changeSet.specHash === report.binding.specHash
    && changeSet.scheduleHash === report.binding.scheduleHash
    && certificate.certificationHash === report.certificationHash
    && canonicalHash(certificate.acknowledgedFindingCodes) === canonicalHash(report.requiredAcknowledgementCodes);
}
