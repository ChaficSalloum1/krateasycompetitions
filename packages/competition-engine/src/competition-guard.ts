import {
  canonicalHash,
  deepFreeze,
  type TournamentSpec,
  type ValidationFinding,
} from "@tournament-os/tournament-schema";
import { certify } from "./certification.js";
import { independentlyExpectedContestCount } from "./graph.js";
import type { CompetitionGraph, ScheduleSolution, SimulationRun } from "./types.js";

export type CompetitionGuardSeverity =
  | "CRITICAL"
  | "INTEGRITY"
  | "OPERATIONAL"
  | "EXPERIENCE"
  | "OPTIMIZATION"
  | "INFORMATION";

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
  readonly status: "FAILED";
  readonly path: string;
  readonly entities: readonly string[];
  readonly message: string;
  readonly evidence: Readonly<Record<string, unknown>>;
}

export interface CompetitionGuardAccounting {
  readonly requiredContestCount: number;
  readonly scheduledContestCount: number;
  readonly uniqueScheduledContestCount: number;
  readonly unscheduledContestIds: readonly string[];
  readonly duplicateContestIds: readonly string[];
  readonly occupiedMinutes: number;
  readonly availableResourceMinutes: number;
  readonly trueSpareCapacityMinutes: number;
  readonly earliestStart: string | null;
  readonly latestFinish: string | null;
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
  readonly guardVersion: "1.0.0";
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
  readonly certificateVersion: "1.0.0";
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

function classify(finding: ValidationFinding): CompetitionGuardSeverity {
  if (finding.severity === "WARNING") return "OPERATIONAL";
  if (/^(TSV|TSC4)/.test(finding.code)) return "CRITICAL";
  return "INTEGRITY";
}

function accountingFor(graph: CompetitionGraph, schedule: ScheduleSolution, spec: TournamentSpec): CompetitionGuardAccounting {
  const scheduledIds = schedule.contests.map(({ contestId }) => contestId);
  const uniqueScheduledIds = new Set(scheduledIds);
  const requiredIds = graph.nodes.filter(({ kind }) => kind === "contest").map(({ id }) => id).sort();
  const duplicateContestIds = [...new Set(scheduledIds.filter((id, index) => scheduledIds.indexOf(id) !== index))].sort();
  const occupiedMinutes = schedule.contests.reduce((total, contest) =>
    total + Math.max(0, (Date.parse(contest.end) - Date.parse(contest.start)) / 60_000), 0);
  const availableResourceMinutes = spec.resources.reduce((total, resource) => total + resource.quantity * resource.availability.reduce(
    (resourceTotal, window) => resourceTotal + Math.max(0, (Date.parse(window.end) - Date.parse(window.start)) / 60_000), 0), 0);
  const starts = schedule.contests.map(({ start }) => Date.parse(start)).filter(Number.isFinite);
  const finishes = schedule.contests.map(({ end }) => Date.parse(end)).filter(Number.isFinite);
  return {
    requiredContestCount: graph.generatedActualContestCount,
    scheduledContestCount: schedule.contests.length,
    uniqueScheduledContestCount: uniqueScheduledIds.size,
    unscheduledContestIds: requiredIds.filter((id) => !uniqueScheduledIds.has(id)),
    duplicateContestIds,
    occupiedMinutes,
    availableResourceMinutes,
    trueSpareCapacityMinutes: availableResourceMinutes - occupiedMinutes,
    earliestStart: starts.length ? new Date(Math.min(...starts)).toISOString() : null,
    latestFinish: finishes.length ? new Date(Math.max(...finishes)).toISOString() : null,
  };
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
  const findings = [...certification.findings, ...bindingFindings]
    .map((finding): CompetitionGuardFinding => ({
      rule: finding.path,
      sourceCode: finding.code,
      severity: classify(finding),
      status: "FAILED",
      path: finding.path,
      entities: entitiesFrom(finding),
      message: finding.message,
      evidence: structuredClone(finding.evidence ?? {}),
    }))
    .sort((left, right) => left.severity.localeCompare(right.severity)
      || left.sourceCode.localeCompare(right.sourceCode)
      || left.path.localeCompare(right.path)
      || left.message.localeCompare(right.message));
  const blocked = findings.some(({ severity }) => severity === "CRITICAL" || severity === "INTEGRITY");
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
    guardVersion: "1.0.0" as const,
    status: blocked ? "BLOCKED" as const : "PASSED" as const,
    integrityGrade: blocked ? "REJECTED" as const : "CERTIFIED" as const,
    findings,
    requiredAcknowledgementCodes: [...new Set(findings.filter(({ severity }) => severity === "OPERATIONAL")
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
  const body = {
    schemaVersion: "1.0.0" as const,
    certificateVersion: "1.0.0" as const,
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
): boolean {
  const { certificateHash, ...body } = certificate;
  if (canonicalHash(body) !== certificateHash) return false;
  if (!report) return true;
  return verifyCompetitionGuardReport(report)
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
    && certificate.certificationHash === report.certificationHash
    && canonicalHash(certificate.acknowledgedFindingCodes) === canonicalHash(report.requiredAcknowledgementCodes);
}
