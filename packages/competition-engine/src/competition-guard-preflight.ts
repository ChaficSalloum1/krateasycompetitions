import { canonicalHash, deepFreeze } from "@tournament-os/tournament-schema";
import type {
  CompetitionGuardFinding,
  CompetitionGuardReport,
  CompetitionGuardSeverity,
} from "./competition-guard.js";
import { COMPETITION_GUARD_SEVERITY_POLICY } from "./competition-guard.js";

export interface CompetitionGuardPreflightSection {
  readonly id: "DEFINITION" | "SCHEDULE" | "ACCOUNTING" | "DEPENDENCIES";
  readonly status: "PASSED" | "WARNING" | "BLOCKED";
  readonly findingCodes: readonly string[];
  readonly evidenceHash: string;
}

export interface CompetitionGuardPreflight {
  readonly schemaVersion: "1.0.0";
  readonly guardReportHash: string;
  readonly outcome: "READY" | "ACKNOWLEDGEMENT_REQUIRED" | "BLOCKED";
  readonly simple: {
    readonly headline: string;
    readonly action: string;
    readonly requiredAcknowledgementCodes: readonly string[];
  };
  readonly detailed: {
    readonly assurance: {
      readonly integrityGrade: CompetitionGuardReport["integrityGrade"];
      readonly operationalQuality: "CLEAR" | "ATTENTION_REQUIRED";
      readonly operationalFindingCodes: readonly string[];
    };
    readonly sections: readonly CompetitionGuardPreflightSection[];
    readonly findings: readonly {
      readonly ruleId: string;
      readonly severity: CompetitionGuardSeverity;
      readonly entities: readonly string[];
      readonly message: string;
      readonly suggestedCorrection: string;
      readonly evidenceHash: string;
    }[];
    readonly accounting: CompetitionGuardReport["accounting"];
  };
  readonly technical: {
    readonly guardVersion: CompetitionGuardReport["guardVersion"];
    readonly binding: CompetitionGuardReport["binding"];
    readonly certificationHash: string;
    readonly reportHash: string;
  };
  readonly projectionHash: string;
}

function sectionFor(finding: CompetitionGuardFinding): CompetitionGuardPreflightSection["id"] {
  if (finding.sourceCode === "KCG005" || /dependency|progression|qualification|path/i.test(finding.path)) return "DEPENDENCIES";
  if (/^TSV/.test(finding.sourceCode) || /schedule|resource|duration|availability|rest/i.test(finding.path)) return "SCHEDULE";
  if (/^KCG00[34]$/.test(finding.sourceCode) || /count|account/i.test(finding.path)) return "ACCOUNTING";
  return "DEFINITION";
}

function sectionStatus(findings: readonly CompetitionGuardFinding[]): CompetitionGuardPreflightSection["status"] {
  if (findings.some(({ publicationDisposition }) => publicationDisposition === "BLOCK")) return "BLOCKED";
  if (findings.length) return "WARNING";
  return "PASSED";
}

/** Projects one immutable Guard report at three inspection depths without changing its meaning. */
export function createCompetitionGuardPreflight(report: CompetitionGuardReport): Readonly<CompetitionGuardPreflight> {
  const legacyAccounting = report.accounting as CompetitionGuardReport["accounting"] & {
    readonly contestLedger?: CompetitionGuardReport["accounting"]["contestLedger"];
    readonly resourceLedger?: CompetitionGuardReport["accounting"]["resourceLedger"];
    readonly unexpectedContestIds?: readonly string[];
    readonly reconciled?: boolean;
  };
  const accounting: CompetitionGuardReport["accounting"] = {
    ...legacyAccounting,
    unexpectedContestIds: legacyAccounting.unexpectedContestIds ?? [],
    contestLedger: legacyAccounting.contestLedger ?? [],
    resourceLedger: legacyAccounting.resourceLedger ?? [],
    reconciled: legacyAccounting.reconciled ?? false,
  };
  if ((report as { readonly guardVersion: string }).guardVersion !== "1.2.0") {
    const evidenceHash = canonicalHash({ historicalGuardReportHash: report.reportHash,
      historicalGuardVersion: (report as { readonly guardVersion: string }).guardVersion });
    const sections: CompetitionGuardPreflightSection[] = ["DEFINITION", "SCHEDULE", "ACCOUNTING", "DEPENDENCIES"]
      .map((id) => ({ id: id as CompetitionGuardPreflightSection["id"], status: "BLOCKED" as const,
        findingCodes: ["GUARD_REVALIDATION_REQUIRED"], evidenceHash }));
    const body = { schemaVersion: "1.0.0" as const, guardReportHash: report.reportHash,
      outcome: "BLOCKED" as const, simple: { headline: "This historical publication requires current Guard revalidation.",
        action: "Create a new revision and run the current Guard before another approval or publication.",
        requiredAcknowledgementCodes: [] as string[] }, detailed: { assurance: {
        integrityGrade: report.integrityGrade, operationalQuality: "ATTENTION_REQUIRED" as const,
        operationalFindingCodes: ["GUARD_REVALIDATION_REQUIRED"] }, sections,
      findings: [{ ruleId: "GUARD_REVALIDATION_REQUIRED", severity: "INTEGRITY" as const, entities: [] as string[],
        message: "Historical evidence remains readable but does not satisfy the current pilot Guard contract.",
        suggestedCorrection: "Create a new authoritative revision and rerun Guard 1.2.", evidenceHash }], accounting },
      technical: { guardVersion: report.guardVersion, binding: report.binding,
        certificationHash: report.certificationHash, reportHash: report.reportHash } };
    return deepFreeze({ ...body, projectionHash: canonicalHash(body) });
  }
  const findings = report.findings.map((finding) => ({ ...finding,
    publicationDisposition: finding.publicationDisposition
      ?? COMPETITION_GUARD_SEVERITY_POLICY[finding.severity],
    evidenceHash: finding.evidenceHash ?? canonicalHash(finding.evidence ?? {}),
    suggestedCorrection: finding.suggestedCorrection
      ?? "Revalidate this historical finding with the current Guard before a new publication.",
  }));
  const sectionIds: CompetitionGuardPreflightSection["id"][] = ["DEFINITION", "SCHEDULE", "ACCOUNTING", "DEPENDENCIES"];
  const sections = sectionIds.map((id): CompetitionGuardPreflightSection => {
    const sectionFindings = findings.filter((finding) => sectionFor(finding) === id);
    const evidence = id === "ACCOUNTING" ? { findings: sectionFindings, accounting } : { findings: sectionFindings };
    return { id, status: id === "ACCOUNTING" && !accounting.reconciled ? "BLOCKED" : sectionStatus(sectionFindings),
      findingCodes: [...new Set(sectionFindings.map(({ sourceCode }) => sourceCode))].sort(),
      evidenceHash: canonicalHash(evidence) };
  });
  const outcome: CompetitionGuardPreflight["outcome"] = report.status === "BLOCKED" || !accounting.reconciled
    ? "BLOCKED" : report.requiredAcknowledgementCodes.length ? "ACKNOWLEDGEMENT_REQUIRED" : "READY";
  const simple = outcome === "BLOCKED"
    ? { headline: "Publication is blocked.", action: "Correct the blocking Guard findings and rerun the pre-flight.",
      requiredAcknowledgementCodes: [...report.requiredAcknowledgementCodes] }
    : outcome === "ACKNOWLEDGEMENT_REQUIRED"
      ? { headline: "The plan is valid with operational warnings.", action: "Review and acknowledge every listed operational warning before publication.",
        requiredAcknowledgementCodes: [...report.requiredAcknowledgementCodes] }
      : { headline: "The exact revision passed pre-flight.", action: "A separate authorised actor may approve this revision for publication.",
        requiredAcknowledgementCodes: [] };
  const operationalFindingCodes = [...new Set(findings.filter(({ publicationDisposition }) =>
    publicationDisposition !== "BLOCK").map(({ sourceCode }) => sourceCode))].sort();
  const detailed = { assurance: { integrityGrade: report.integrityGrade,
    operationalQuality: operationalFindingCodes.length ? "ATTENTION_REQUIRED" as const : "CLEAR" as const,
    operationalFindingCodes }, sections,
    findings: findings.map((finding) => ({ ruleId: finding.sourceCode, severity: finding.severity,
      entities: [...finding.entities], message: finding.message, suggestedCorrection: finding.suggestedCorrection,
      evidenceHash: finding.evidenceHash ?? canonicalHash(finding.evidence ?? {}) })), accounting };
  const technical = { guardVersion: report.guardVersion, binding: report.binding,
    certificationHash: report.certificationHash, reportHash: report.reportHash };
  const body = { schemaVersion: "1.0.0" as const, guardReportHash: report.reportHash, outcome,
    simple, detailed, technical };
  return deepFreeze({ ...body, projectionHash: canonicalHash(body) });
}
