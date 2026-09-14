import {
  canonicalHash,
  canonicalStringify,
  deepFreeze,
  semanticDiff,
  type SemanticChange,
  type TournamentSpec,
  type ValidationFinding,
} from "@tournament-os/tournament-schema";
import { analyzeParticipantPaths, type ParticipantPathProof } from "./analytics.js";
import type { ScenarioResult } from "./types.js";

export interface ScenarioRevisionIdentity {
  revision: number;
  specHash: string;
  previousSpecHash: string | null;
}

export interface ScenarioMetrics {
  certificationStatus: ScenarioResult["certification"]["status"];
  solverStatus: ScenarioResult["schedule"]["audit"]["status"];
  scheduledContestCount: number;
  generatedContestCount: number;
  expectedContestCount: number;
  finish: string | null;
  objectiveMinutes: number | null;
  lowerBoundMinutes: number;
  lowerBoundGapMinutes: number | null;
}

export interface ParticipantGuaranteeSummary {
  entrantCount: number;
  minimumGuaranteedContests: number | null;
  minimumGuaranteedGroupContests: number | null;
  maximumPossibleContests: number | null;
}

export interface ParticipantGuaranteeChange {
  entrantId: string;
  baselineMinimum: number | null;
  candidateMinimum: number | null;
  minimumDelta: number | null;
  baselineGroupMinimum: number | null;
  candidateGroupMinimum: number | null;
  groupMinimumDelta: number | null;
  baselineMaximum: number | null;
  candidateMaximum: number | null;
  maximumDelta: number | null;
  counterexample: string[];
}

export interface ApprovalBlockingReason {
  code: string;
  message: string;
  evidence: Record<string, unknown>;
}

export interface ScenarioComparison {
  baselineRevision: ScenarioRevisionIdentity;
  candidateRevision: ScenarioRevisionIdentity;
  formalChanges: SemanticChange[];
  unaffectedRuleGroups: string[];
  metrics: { baseline: ScenarioMetrics; candidate: ScenarioMetrics };
  participantGuarantees: {
    baseline: ParticipantGuaranteeSummary;
    candidate: ParticipantGuaranteeSummary;
    changes: ParticipantGuaranteeChange[];
    regressedEntrantIds: string[];
  };
  findings: { added: ValidationFinding[]; resolved: ValidationFinding[] };
  approval: {
    requiresExplicitApproval: true;
    canApprove: boolean;
    blockingReasons: ApprovalBlockingReason[];
  };
  comparisonHash: string;
}

const ruleGroups: readonly string[] = [
  "sport", "participants", "divisions", "stages", "scoringSystems", "standingsPolicies",
  "qualificationPolicies", "competitionStructures", "drawPolicies", "progressionPolicies",
  "scheduling", "resources", "operationalPolicies", "randomisation", "assumptions", "requirements",
];

function identity(spec: TournamentSpec): ScenarioRevisionIdentity {
  return {
    revision: spec.metadata.revision,
    specHash: spec.metadata.compiledSpecHash,
    previousSpecHash: spec.metadata.previousSpecHash ?? null,
  };
}

function definition(spec: TournamentSpec): Omit<TournamentSpec, "metadata"> {
  const { metadata: _metadata, ...value } = spec;
  return value;
}

function finishOf(scenario: ScenarioResult): string | null {
  if (!scenario.schedule.contests.length) return null;
  const finish = Math.max(...scenario.schedule.contests.map(({ end }) => Date.parse(end)));
  return Number.isFinite(finish) ? new Date(finish).toISOString() : null;
}

function metrics(scenario: ScenarioResult): ScenarioMetrics {
  const finish = finishOf(scenario);
  const objectiveMinutes = scenario.schedule.audit.objectiveValueMinutes
    ?? (finish ? Math.ceil((Date.parse(finish) - Date.parse(scenario.spec.scheduling.start)) / 60_000) : null);
  const lowerBoundMinutes = scenario.schedule.audit.lowerBoundMinutes;
  return {
    certificationStatus: scenario.certification.status,
    solverStatus: scenario.schedule.audit.status,
    scheduledContestCount: scenario.schedule.contests.length,
    generatedContestCount: scenario.graph.generatedActualContestCount,
    expectedContestCount: scenario.graph.expectedActualContestCount,
    finish,
    objectiveMinutes,
    lowerBoundMinutes,
    lowerBoundGapMinutes: objectiveMinutes === null ? null : objectiveMinutes - lowerBoundMinutes,
  };
}

function findingKey(finding: ValidationFinding): string {
  return canonicalStringify({ code: finding.code, severity: finding.severity, path: finding.path, message: finding.message, evidence: finding.evidence ?? null });
}

function scenarioFindings(scenario: ScenarioResult): ValidationFinding[] {
  const all = [...scenario.graph.findings, ...scenario.schedule.findings, ...scenario.certification.findings];
  return [...new Map(all.map((entry) => [findingKey(entry), structuredClone(entry)])).values()]
    .sort((left, right) => left.code.localeCompare(right.code) || left.path.localeCompare(right.path) || left.message.localeCompare(right.message));
}

function summary(paths: readonly ParticipantPathProof[]): ParticipantGuaranteeSummary {
  return {
    entrantCount: paths.length,
    minimumGuaranteedContests: paths.length ? Math.min(...paths.map(({ minimumContestCount }) => minimumContestCount)) : null,
    minimumGuaranteedGroupContests: paths.length ? Math.min(...paths.map(({ minimumGroupContestCount }) => minimumGroupContestCount)) : null,
    maximumPossibleContests: paths.length ? Math.max(...paths.map(({ maximumContestCount }) => maximumContestCount)) : null,
  };
}

function compareGuarantees(baseline: readonly ParticipantPathProof[], candidate: readonly ParticipantPathProof[]): ScenarioComparison["participantGuarantees"] {
  const baselineById = new Map(baseline.map((entry) => [entry.entrantId, entry]));
  const candidateById = new Map(candidate.map((entry) => [entry.entrantId, entry]));
  const entrantIds = [...new Set([...baselineById.keys(), ...candidateById.keys()])].sort();
  const changes = entrantIds.map((entrantId): ParticipantGuaranteeChange => {
    const before = baselineById.get(entrantId);
    const after = candidateById.get(entrantId);
    return {
      entrantId,
      baselineMinimum: before?.minimumContestCount ?? null,
      candidateMinimum: after?.minimumContestCount ?? null,
      minimumDelta: before && after ? after.minimumContestCount - before.minimumContestCount : null,
      baselineGroupMinimum: before?.minimumGroupContestCount ?? null,
      candidateGroupMinimum: after?.minimumGroupContestCount ?? null,
      groupMinimumDelta: before && after ? after.minimumGroupContestCount - before.minimumGroupContestCount : null,
      baselineMaximum: before?.maximumContestCount ?? null,
      candidateMaximum: after?.maximumContestCount ?? null,
      maximumDelta: before && after ? after.maximumContestCount - before.maximumContestCount : null,
      counterexample: after ? [...after.counterexample] : [`entrant ${entrantId} has no candidate path`],
    };
  });
  const regressedEntrantIds = changes.filter(({ minimumDelta, groupMinimumDelta, candidateMinimum }) =>
    candidateMinimum === null || (minimumDelta !== null && minimumDelta < 0) || (groupMinimumDelta !== null && groupMinimumDelta < 0)).map(({ entrantId }) => entrantId);
  return { baseline: summary(baseline), candidate: summary(candidate), changes, regressedEntrantIds };
}

export function compareScenarios(baseline: ScenarioResult, candidate: ScenarioResult): ScenarioComparison {
  const blockingReasons: ApprovalBlockingReason[] = [];
  const addBlock = (code: string, message: string, evidence: Record<string, unknown>): void => {
    blockingReasons.push({ code, message, evidence });
  };
  const changes = structuredClone(semanticDiff(definition(baseline.spec), definition(candidate.spec)));
  const changedGroups = new Set(changes.map(({ path }) => path.split("/")[1]).filter((value): value is string => Boolean(value)));
  const unaffectedRuleGroups = ruleGroups.filter((group) => !changedGroups.has(group));
  const baselineMetrics = metrics(baseline);
  const candidateMetrics = metrics(candidate);

  let baselinePaths: ParticipantPathProof[] = [];
  let candidatePaths: ParticipantPathProof[] = [];
  try { baselinePaths = analyzeParticipantPaths(baseline.graph); }
  catch (error) { addBlock("SCN107", "Baseline participant guarantees could not be reconstructed.", { error: error instanceof Error ? error.message : String(error) }); }
  try { candidatePaths = analyzeParticipantPaths(candidate.graph); }
  catch (error) { addBlock("SCN108", "Candidate participant guarantees could not be proven.", { error: error instanceof Error ? error.message : String(error) }); }
  const participantGuarantees = compareGuarantees(baselinePaths, candidatePaths);

  const baselineFindings = scenarioFindings(baseline);
  const candidateFindings = scenarioFindings(candidate);
  const baselineKeys = new Set(baselineFindings.map(findingKey));
  const candidateKeys = new Set(candidateFindings.map(findingKey));
  const added = candidateFindings.filter((entry) => !baselineKeys.has(findingKey(entry)));
  const resolved = baselineFindings.filter((entry) => !candidateKeys.has(findingKey(entry)));

  if (candidate.spec.metadata.revision !== baseline.spec.metadata.revision + 1 || candidate.spec.metadata.previousSpecHash !== baseline.spec.metadata.compiledSpecHash) {
    addBlock("SCN101", "Candidate revision is not the direct immutable successor of the baseline.", { baselineRevision: identity(baseline.spec), candidateRevision: identity(candidate.spec) });
  }
  if (!(["OPTIMAL", "FEASIBLE"] as const).includes(candidate.schedule.audit.status as "OPTIMAL" | "FEASIBLE")) {
    addBlock("SCN102", "Candidate schedule has no accepted feasible solver status.", { solverStatus: candidate.schedule.audit.status });
  }
  if (candidate.certification.status !== "CERTIFIED") {
    addBlock("SCN103", "Candidate scenario is not certified.", { certificationStatus: candidate.certification.status });
  }
  if (candidate.graph.generatedActualContestCount !== candidate.graph.expectedActualContestCount || candidate.schedule.contests.length !== candidate.graph.generatedActualContestCount) {
    addBlock("SCN104", "Candidate contest cardinality is inconsistent across graph and schedule.", { expected: candidate.graph.expectedActualContestCount, generated: candidate.graph.generatedActualContestCount, scheduled: candidate.schedule.contests.length });
  }
  const errorFindings = candidateFindings.filter(({ severity }) => severity === "ERROR");
  if (errorFindings.length) addBlock("SCN105", "Candidate contains blocking validation findings.", { findingKeys: errorFindings.map(findingKey) });
  const unresolvedRequirements = candidate.spec.requirements.filter(({ status }) => status === "UNRESOLVED").map(({ id }) => id).sort();
  if (unresolvedRequirements.length) addBlock("SCN106", "Candidate leaves source requirements unresolved.", { requirementIds: unresolvedRequirements });
  if (candidateMetrics.lowerBoundGapMinutes !== null && candidateMetrics.lowerBoundGapMinutes < 0) {
    addBlock("SCN109", "Candidate objective is below its asserted mathematical lower bound.", { objectiveMinutes: candidateMetrics.objectiveMinutes, lowerBoundMinutes: candidateMetrics.lowerBoundMinutes });
  }
  blockingReasons.sort((left, right) => left.code.localeCompare(right.code) || left.message.localeCompare(right.message));

  const partial = {
    baselineRevision: identity(baseline.spec),
    candidateRevision: identity(candidate.spec),
    formalChanges: changes,
    unaffectedRuleGroups: [...unaffectedRuleGroups],
    metrics: { baseline: baselineMetrics, candidate: candidateMetrics },
    participantGuarantees,
    findings: { added, resolved },
    approval: { requiresExplicitApproval: true as const, canApprove: blockingReasons.length === 0, blockingReasons },
  };
  return deepFreeze({ ...partial, comparisonHash: canonicalHash(partial) }) as ScenarioComparison;
}
