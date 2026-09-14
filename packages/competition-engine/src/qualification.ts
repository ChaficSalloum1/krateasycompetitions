import type { TournamentSpec, ValidationFinding } from "@tournament-os/tournament-schema";
import { normalizedStandingScore } from "./standings.js";
import type { Entrant, QualificationEvidence, QualificationResult, Standing } from "./types.js";
import { compileDeclarativeQualification, verifyDeclarativeQualification, type DeclarativeQualificationSelector } from "./declarative-qualification.js";

const declarativeSelectorTypes = new Set(["ranking_points", "threshold", "score_threshold", "percentage_threshold", "elapsed_time", "aggregate_metric", "best_n", "authority_selection"]);

function mapMetric(metric: import("@tournament-os/tournament-schema").QualificationMetricExpression): import("./declarative-qualification.js").QualificationMetricExpression {
  if (metric.type === "value") return { type: "VALUE", key: metric.key };
  if (metric.type === "ratio_percent") return { type: "RATIO_PERCENT", numeratorKey: metric.numeratorKey, denominatorKey: metric.denominatorKey };
  return { type: "AGGREGATE", reducer: metric.reducer === "sum" ? "SUM" : "AVERAGE", terms: metric.terms.map((term) => ({ ...term })) };
}

function mapDeclarativeSelector(selector: import("@tournament-os/tournament-schema").QualificationSelector): DeclarativeQualificationSelector {
  if (selector.type === "ranking_points") return { type: "RANKING_POINTS", metricKey: selector.metricKey, count: selector.count,
    cutoffTiePolicy: selector.cutoffTiePolicy === "reject" ? "REJECT" : selector.cutoffTiePolicy === "include_all" ? "INCLUDE_ALL" : "CANDIDATE_ID" };
  if (selector.type === "threshold") return { type: "THRESHOLD", metric: mapMetric(selector.metric),
    comparison: selector.comparison === "at_least" ? "AT_LEAST" : selector.comparison === "at_most" ? "AT_MOST"
      : selector.comparison === "greater_than" ? "GREATER_THAN" : "LESS_THAN", value: selector.value };
  if (selector.type === "score_threshold") return { type: "SCORE_THRESHOLD", metricKey: selector.metricKey, minimum: selector.minimum };
  if (selector.type === "percentage_threshold") return { type: "PERCENTAGE_THRESHOLD", numeratorMetricKey: selector.numeratorMetricKey,
    denominatorMetricKey: selector.denominatorMetricKey, minimumPercent: selector.minimumPercent };
  if (selector.type === "elapsed_time") return { type: "ELAPSED_TIME", metricKey: selector.metricKey, count: selector.count,
    cutoffTiePolicy: selector.cutoffTiePolicy === "reject" ? "REJECT" : selector.cutoffTiePolicy === "include_all" ? "INCLUDE_ALL" : "CANDIDATE_ID" };
  if (selector.type === "aggregate_metric") return { type: "AGGREGATE_METRIC",
    metric: mapMetric(selector.metric) as Extract<import("./declarative-qualification.js").QualificationMetricExpression, { type: "AGGREGATE" }>,
    count: selector.count, direction: selector.direction === "higher" ? "HIGHER" : "LOWER",
    cutoffTiePolicy: selector.cutoffTiePolicy === "reject" ? "REJECT" : selector.cutoffTiePolicy === "include_all" ? "INCLUDE_ALL" : "CANDIDATE_ID" };
  if (selector.type === "best_n") return { type: "BEST_N", metric: mapMetric(selector.metric), count: selector.count,
    direction: selector.direction === "higher" ? "HIGHER" : "LOWER",
    ...(selector.eligibleRank === undefined ? {} : { eligibleRank: selector.eligibleRank }),
    cutoffTiePolicy: selector.cutoffTiePolicy === "reject" ? "REJECT" : selector.cutoffTiePolicy === "include_all" ? "INCLUDE_ALL" : "CANDIDATE_ID" };
  if (selector.type === "authority_selection") return { type: "AUTHORITY_SELECTION",
    selectionType: selector.selectionType === "wildcard" ? "WILDCARD" : "HOST", candidateIds: [...selector.candidateIds],
    approval: { status: "APPROVED", authorityId: selector.approval.authorityId, approvalHash: selector.approval.approvalHash } };
  if (selector.type === "remainder") return { type: "REMAINDER" };
  throw new Error("Qualification selector has no declarative adapter.");
}

const compareScores = (left: number[], right: number[]) => {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const delta = (right[index] ?? 0) - (left[index] ?? 0);
    if (delta !== 0) return delta;
  }
  return 0;
};

export function qualify(
  spec: TournamentSpec,
  standingsByStage: Record<string, Standing[]>,
  entrantsByDivision: Record<string, Entrant[]>,
): QualificationResult {
  const byStructure: Record<string, Entrant[]> = {};
  const evidence: QualificationEvidence[] = [];
  const findings: ValidationFinding[] = [];
  const selected = new Set<string>();
  const policyProofs: NonNullable<QualificationResult["policyProofs"]> = [];
  const failedDestinations = new Set<string>();
  const failDestination = (destinationStructureId: string): void => {
    for (const entrant of byStructure[destinationStructureId] ?? []) selected.delete(entrant.id);
    byStructure[destinationStructureId] = [];
    for (let index = evidence.length - 1; index >= 0; index -= 1) if (evidence[index]!.destinationStructureId === destinationStructureId) evidence.splice(index, 1);
    const destinationPolicyIds = new Set(spec.qualificationPolicies.filter((policy) => policy.destinationStructureId === destinationStructureId).map(({ id }) => id));
    for (let index = policyProofs.length - 1; index >= 0; index -= 1) if (destinationPolicyIds.has(policyProofs[index]!.policyId)) policyProofs.splice(index, 1);
    failedDestinations.add(destinationStructureId);
  };
  const appendDestination = (destinationStructureId: string, entrants: readonly Entrant[]): void => {
    if (failedDestinations.has(destinationStructureId)) return;
    const combined = [...(byStructure[destinationStructureId] ?? []), ...entrants];
    byStructure[destinationStructureId] = combined.map((entrant, index) => ({ ...entrant, seed: index + 1 }));
  };
  for (const policy of spec.qualificationPolicies) {
    if (failedDestinations.has(policy.destinationStructureId)) continue;
    if (policy.normalization !== undefined && !["per_match", "percentage"].includes(policy.normalization)) {
      findings.push({
        code: "TSC803", severity: "ERROR", path: `/qualificationPolicies/${policy.id}/normalization`,
        message: "Qualification normalization is declared by the schema but has no executable registered implementation.",
        evidence: { normalization: policy.normalization, supported: ["per_match", "percentage"] },
      });
      failDestination(policy.destinationStructureId);
      continue;
    }
    const stage = spec.stages.find(({ id }) => id === policy.sourceStageId);
    const divisionEntrants = entrantsByDivision[stage?.divisionId ?? ""] ?? [];
    const entrantMap = new Map(divisionEntrants.map((entrant) => [entrant.id, entrant]));
    const standings = standingsByStage[policy.sourceStageId] ?? [];
    const declarative = policy.selectors.some(({ type }) => declarativeSelectorTypes.has(type));
    if (declarative) {
      const incompatibleSelectorTypes = policy.selectors
        .map(({ type }) => type)
        .filter((type) => !declarativeSelectorTypes.has(type) && type !== "remainder");
      const unknownCandidateIds = standings
        .map(({ entrantId }) => entrantId)
        .filter((entrantId) => !entrantMap.has(entrantId));
      if (incompatibleSelectorTypes.length > 0 || unknownCandidateIds.length > 0) {
        findings.push({ code: "TSC804", severity: "ERROR", path: `/qualificationPolicies/${policy.id}`,
          message: "Declarative qualification configuration cannot be adapted into a closed candidate universe.",
          evidence: {
            incompatibleSelectorTypes: [...new Set(incompatibleSelectorTypes)].sort(),
            unknownCandidateIds: [...new Set(unknownCandidateIds)].sort(),
          } });
        failDestination(policy.destinationStructureId);
        continue;
      }
      const selectors: DeclarativeQualificationSelector[] = policy.selectors.map(mapDeclarativeSelector);
      const candidateMetrics = standings.map((standing) => ({
        id: standing.entrantId, ...(standing.poolId ? { groupId: standing.poolId } : {}), rank: standing.rank,
        metrics: Object.fromEntries(Object.entries(standing).filter((entry): entry is [string, number] => typeof entry[1] === "number")),
      }));
      const candidateIds = new Set(candidateMetrics.map(({ id }) => id));
      const selectedFromThisUniverse = [...selected].filter((id) => candidateIds.has(id));
      const compilation = compileDeclarativeQualification({ policyId: policy.id, outputCount: policy.outputCount,
        candidates: candidateMetrics, alreadySelectedCandidateIds: selectedFromThisUniverse, selectors });
      const verification = verifyDeclarativeQualification({ policyId: policy.id, outputCount: policy.outputCount,
        candidates: candidateMetrics, alreadySelectedCandidateIds: selectedFromThisUniverse, selectors }, compilation);
      if (compilation.status !== "CERTIFIED" || verification.status !== "CERTIFIED") {
        const causes = [...compilation.findings, ...verification.findings];
        findings.push({ code: "TSC804", severity: "ERROR", path: `/qualificationPolicies/${policy.id}`,
          message: "Declarative qualification did not produce an independently verified exact selection.",
          evidence: { causes: causes.map(({ code }) => code) } });
        failDestination(policy.destinationStructureId);
        continue;
      }
      const standingById = new Map(standings.map((standing) => [standing.entrantId, standing]));
      const qualified = compilation.selectedCandidateIds.map((id) => ({
        ...entrantMap.get(id)!, ...(standingById.get(id)?.poolId ? { poolId: standingById.get(id)!.poolId } : {}),
      }));
      appendDestination(policy.destinationStructureId, qualified);
      for (const item of compilation.evidence) {
        const standing = standingById.get(item.candidateId)!;
        selected.add(item.candidateId);
        evidence.push({ entrantId: item.candidateId, policyId: policy.id, destinationStructureId: policy.destinationStructureId,
          selector: policy.selectors[item.selectorIndex]!.type, sourceStanding: standing,
          comparisonSet: [...item.comparisonSetIds], tieResolution: standing.tieResolution,
          selectorIndex: item.selectorIndex, ...(item.metricValue === undefined ? {} : { metricValue: item.metricValue }),
          ...(item.authorityId === undefined ? {} : { authorityId: item.authorityId }), proofHash: compilation.proof.proofHash });
      }
      policyProofs.push({ policyId: policy.id, proofHash: compilation.proof.proofHash, verificationHash: verification.verificationHash });
      continue;
    }
    const picked: Standing[] = [];
    for (const selector of policy.selectors) {
      const availableStandings = standings.filter(({ entrantId }) =>
        !selected.has(entrantId) && !picked.some((candidate) => candidate.entrantId === entrantId));
      let candidates: Standing[] = [];
      switch (selector.type) {
        case "pool_winners": candidates = availableStandings.filter(({ rank }) => rank === 1); break;
        case "pool_position": candidates = availableStandings.filter(({ rank }) => rank === selector.position); break;
        case "best_n_across_pools":
          candidates = availableStandings.filter(({ rank }) => selector.poolPosition === undefined || rank === selector.poolPosition)
            .sort((a, b) => compareScores(normalizedStandingScore(a, policy.normalization), normalizedStandingScore(b, policy.normalization)) || a.entrantId.localeCompare(b.entrantId)).slice(0, selector.count);
          break;
        case "top_n": candidates = [...availableStandings].sort((a, b) => a.rank - b.rank || a.entrantId.localeCompare(b.entrantId)).slice(0, selector.count); break;
        case "bottom_n": candidates = [...availableStandings].sort((a, b) => b.rank - a.rank || a.entrantId.localeCompare(b.entrantId)).slice(0, selector.count); break;
        case "remainder": candidates = availableStandings; break;
        case "manual_decision":
          findings.push({ code: "TSC801", severity: "ERROR", path: `/qualificationPolicies/${policy.id}`, message: "Manual qualification decision is unresolved." });
          break;
      }
      picked.push(...candidates);
    }
    if (picked.length !== policy.outputCount) {
      findings.push({ code: "TSC802", severity: "ERROR", path: `/qualificationPolicies/${policy.id}`, message: "Resolved qualifier count differs from declared output.", evidence: { resolved: picked.length, expected: policy.outputCount } });
      failDestination(policy.destinationStructureId);
      continue;
    }
    appendDestination(policy.destinationStructureId, picked.map((standing) => ({ ...entrantMap.get(standing.entrantId)!, ...(standing.poolId ? { poolId: standing.poolId } : {}) })));
    for (const standing of picked) {
      selected.add(standing.entrantId);
      evidence.push({ entrantId: standing.entrantId, policyId: policy.id, destinationStructureId: policy.destinationStructureId, selector: policy.selectors.map(({ type }) => type).join("+"), sourceStanding: standing, comparisonSet: picked.map(({ entrantId }) => entrantId), tieResolution: standing.tieResolution });
    }
  }
  return { byStructure, evidence, findings, policyProofs };
}
