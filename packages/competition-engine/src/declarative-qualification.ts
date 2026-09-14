import { canonicalHash, deepFreeze } from "@tournament-os/tournament-schema";

export const DECLARATIVE_QUALIFICATION_SCALE_ENVELOPE = deepFreeze({
  maximumCandidates: 4_096,
  maximumSelectors: 128,
  maximumAggregateTerms: 32,
  exhaustiveCorpus: "1-6 candidates; every binary ranking-point assignment, field size, and cutoff policy (1,926 cases)",
  qualification: "STRUCTURAL_LIMITS_ARE_NOT_A_PRODUCTION_CAPACITY_GUARANTEE",
} as const);

export interface QualificationCandidate {
  readonly id: string;
  readonly groupId?: string;
  readonly rank?: number;
  readonly metrics: Readonly<Record<string, number>>;
}

export type CutoffTiePolicy = "REJECT" | "CANDIDATE_ID" | "INCLUDE_ALL";

export type QualificationMetricExpression =
  | Readonly<{ type: "VALUE"; key: string }>
  | Readonly<{ type: "RATIO_PERCENT"; numeratorKey: string; denominatorKey: string }>
  | Readonly<{ type: "AGGREGATE"; reducer: "SUM" | "AVERAGE"; terms: readonly Readonly<{ key: string; weight: number }>[] }>;

type RankingSelector = Readonly<{
  type: "RANKING_POINTS" | "ELAPSED_TIME";
  metricKey: string;
  count: number;
  cutoffTiePolicy: CutoffTiePolicy;
}>;

type ThresholdSelector = Readonly<{
  type: "THRESHOLD";
  metric: QualificationMetricExpression;
  comparison: "AT_LEAST" | "AT_MOST" | "GREATER_THAN" | "LESS_THAN";
  value: number;
}>;

type ScoreThresholdSelector = Readonly<{
  type: "SCORE_THRESHOLD";
  metricKey: string;
  minimum: number;
}>;

type PercentageThresholdSelector = Readonly<{
  type: "PERCENTAGE_THRESHOLD";
  numeratorMetricKey: string;
  denominatorMetricKey: string;
  minimumPercent: number;
}>;

type AggregateMetricSelector = Readonly<{
  type: "AGGREGATE_METRIC";
  metric: Extract<QualificationMetricExpression, { type: "AGGREGATE" }>;
  count: number;
  direction: "HIGHER" | "LOWER";
  cutoffTiePolicy: CutoffTiePolicy;
}>;

type BestNSelector = Readonly<{
  type: "BEST_N";
  metric: QualificationMetricExpression;
  count: number;
  direction: "HIGHER" | "LOWER";
  eligibleRank?: number;
  cutoffTiePolicy: CutoffTiePolicy;
}>;

type AuthoritySelectionSelector = Readonly<{
  type: "AUTHORITY_SELECTION";
  selectionType: "WILDCARD" | "HOST";
  candidateIds: readonly string[];
  approval: Readonly<{ status: "APPROVED"; authorityId: string; approvalHash: string }>;
}>;

type RemainderSelector = Readonly<{ type: "REMAINDER" }>;

export type DeclarativeQualificationSelector = RankingSelector | AggregateMetricSelector | BestNSelector | ThresholdSelector | ScoreThresholdSelector | PercentageThresholdSelector | AuthoritySelectionSelector | RemainderSelector;

export function hashQualificationAuthorityApproval(input: Readonly<{
  policyId: string;
  selectorIndex: number;
  selectionType: "WILDCARD" | "HOST";
  candidateIds: readonly string[];
  authorityId: string;
}>): string {
  return canonicalHash({ ...input, candidateIds: [...input.candidateIds].sort() });
}

function rankingSpec(selector: RankingSelector | AggregateMetricSelector | BestNSelector): {
  metric: QualificationMetricExpression;
  count: number;
  direction: "HIGHER" | "LOWER";
  cutoffTiePolicy: CutoffTiePolicy;
  eligibleRank?: number;
} {
  if (selector.type === "AGGREGATE_METRIC" || selector.type === "BEST_N") return selector;
  return { metric: { type: "VALUE", key: selector.metricKey }, count: selector.count,
    direction: selector.type === "ELAPSED_TIME" ? "LOWER" : "HIGHER", cutoffTiePolicy: selector.cutoffTiePolicy };
}

function metricValue(candidate: QualificationCandidate, expression: QualificationMetricExpression): number | undefined {
  if (expression.type === "VALUE") {
    const value = candidate.metrics[expression.key];
    return Number.isFinite(value) ? value : undefined;
  }
  if (expression.type === "RATIO_PERCENT") {
    const numerator = candidate.metrics[expression.numeratorKey];
    const denominator = candidate.metrics[expression.denominatorKey];
    return Number.isFinite(numerator) && Number.isFinite(denominator) && denominator! > 0
      ? numerator! / denominator! * 100 : undefined;
  }
  const values = expression.terms.map(({ key, weight }) => ({ value: candidate.metrics[key], weight }));
  if (values.some(({ value, weight }) => !Number.isFinite(value) || !Number.isFinite(weight) || weight <= 0)) return undefined;
  const sum = values.reduce((total, { value, weight }) => total + value! * weight, 0);
  return expression.reducer === "SUM" ? sum : sum / values.reduce((total, { weight }) => total + weight, 0);
}

function validExpression(expression: QualificationMetricExpression): boolean {
  return expression.type === "VALUE" ? expression.key.trim().length > 0
    : expression.type === "RATIO_PERCENT" ? expression.numeratorKey.trim().length > 0 && expression.denominatorKey.trim().length > 0
      : expression.terms.length > 0 && expression.terms.length <= DECLARATIVE_QUALIFICATION_SCALE_ENVELOPE.maximumAggregateTerms
        && expression.terms.every(({ key, weight }) => key.trim().length > 0 && Number.isFinite(weight) && weight > 0);
}

function satisfies(value: number, comparison: ThresholdSelector["comparison"], threshold: number): boolean {
  if (comparison === "AT_LEAST") return value >= threshold;
  if (comparison === "AT_MOST") return value <= threshold;
  if (comparison === "GREATER_THAN") return value > threshold;
  return value < threshold;
}

function thresholdSpec(selector: ThresholdSelector | ScoreThresholdSelector | PercentageThresholdSelector): {
  metric: QualificationMetricExpression;
  comparison: ThresholdSelector["comparison"];
  value: number;
} {
  if (selector.type === "THRESHOLD") return { metric: selector.metric, comparison: selector.comparison, value: selector.value };
  if (selector.type === "SCORE_THRESHOLD") return { metric: { type: "VALUE", key: selector.metricKey }, comparison: "AT_LEAST", value: selector.minimum };
  return { metric: { type: "RATIO_PERCENT", numeratorKey: selector.numeratorMetricKey, denominatorKey: selector.denominatorMetricKey },
    comparison: "AT_LEAST", value: selector.minimumPercent };
}

export interface DeclarativeQualificationRequest {
  readonly policyId: string;
  readonly outputCount: number;
  readonly candidates: readonly QualificationCandidate[];
  readonly alreadySelectedCandidateIds: readonly string[];
  readonly selectors: readonly DeclarativeQualificationSelector[];
}

export interface DeclarativeQualificationFinding {
  readonly code: string;
  readonly message: string;
  readonly selectorIndex?: number;
  readonly candidateIds?: readonly string[];
}

export interface QualificationSelectionEvidence {
  readonly candidateId: string;
  readonly selectorIndex: number;
  readonly selectorType: DeclarativeQualificationSelector["type"];
  readonly metricValue?: number;
  readonly comparisonSetIds: readonly string[];
  readonly cutoffTiePolicy?: CutoffTiePolicy;
  readonly authorityId?: string;
}

export interface DeclarativeQualificationProof {
  readonly requestHash: string;
  readonly candidateUniverseHash: string;
  readonly exactOutputCardinality: boolean;
  readonly noDuplicateSelections: boolean;
  readonly globallyExclusive: boolean;
  readonly sequentialSelectorProvenance: boolean;
  readonly everySelectionJustified: boolean;
  readonly scaleEnvelope: typeof DECLARATIVE_QUALIFICATION_SCALE_ENVELOPE;
  readonly proofHash: string;
}

export interface DeclarativeQualificationCompilation {
  readonly status: "CERTIFIED" | "REJECTED";
  readonly selectedCandidateIds: readonly string[];
  readonly evidence: readonly QualificationSelectionEvidence[];
  readonly findings: readonly DeclarativeQualificationFinding[];
  readonly proof: DeclarativeQualificationProof;
}

export interface DeclarativeQualificationVerification {
  readonly status: "CERTIFIED" | "REJECTED";
  readonly findings: readonly DeclarativeQualificationFinding[];
  readonly verificationHash: string;
}

type NormalizedRequest = Omit<DeclarativeQualificationRequest, "candidates" | "alreadySelectedCandidateIds"> & {
  readonly candidates: readonly QualificationCandidate[];
  readonly alreadySelectedCandidateIds: readonly string[];
};

function normalizeRequest(request: DeclarativeQualificationRequest): NormalizedRequest {
  return {
    ...request,
    candidates: [...request.candidates].map((candidate) => ({ ...candidate, metrics: { ...candidate.metrics } }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    alreadySelectedCandidateIds: [...request.alreadySelectedCandidateIds].sort(),
    selectors: request.selectors.map((selector) => selector.type === "AUTHORITY_SELECTION"
      ? { ...selector, candidateIds: [...selector.candidateIds].sort(), approval: { ...selector.approval } }
      : { ...selector }),
  };
}

function finding(code: string, message: string, selectorIndex?: number, candidateIds?: readonly string[]): DeclarativeQualificationFinding {
  return { code, message, ...(selectorIndex === undefined ? {} : { selectorIndex }), ...(candidateIds === undefined ? {} : { candidateIds: [...candidateIds].sort() }) };
}

function proofFor(
  request: NormalizedRequest,
  selectedCandidateIds: readonly string[],
  evidence: readonly QualificationSelectionEvidence[],
  findings: readonly DeclarativeQualificationFinding[],
): DeclarativeQualificationProof {
  const selectedSet = new Set(selectedCandidateIds);
  const global = new Set(request.alreadySelectedCandidateIds);
  const proofBase = {
    requestHash: canonicalHash(request),
    candidateUniverseHash: canonicalHash(request.candidates),
    exactOutputCardinality: findings.length === 0 && selectedCandidateIds.length === request.outputCount,
    noDuplicateSelections: selectedSet.size === selectedCandidateIds.length,
    globallyExclusive: selectedCandidateIds.every((id) => !global.has(id)),
    sequentialSelectorProvenance: evidence.length === selectedCandidateIds.length
      && evidence.every((entry, index) => entry.candidateId === selectedCandidateIds[index]),
    everySelectionJustified: evidence.length === selectedCandidateIds.length,
    scaleEnvelope: DECLARATIVE_QUALIFICATION_SCALE_ENVELOPE,
  };
  return { ...proofBase, proofHash: canonicalHash({ request, selectedCandidateIds, evidence, findings, proof: proofBase }) };
}

function rejected(request: NormalizedRequest, findings: readonly DeclarativeQualificationFinding[]): DeclarativeQualificationCompilation {
  return deepFreeze({ status: "REJECTED" as const, selectedCandidateIds: [], evidence: [], findings, proof: proofFor(request, [], [], findings) });
}

function validateRequest(request: NormalizedRequest): DeclarativeQualificationFinding[] {
  const findings: DeclarativeQualificationFinding[] = [];
  const ids = request.candidates.map(({ id }) => id);
  if (!request.policyId.trim()) findings.push(finding("INVALID_POLICY_ID", "Qualification policy id is required."));
  if (!Number.isInteger(request.outputCount) || request.outputCount < 0 || request.outputCount > request.candidates.length) {
    findings.push(finding("INVALID_OUTPUT_COUNT", "Output count must be a bounded non-negative integer."));
  }
  if (request.candidates.length > DECLARATIVE_QUALIFICATION_SCALE_ENVELOPE.maximumCandidates) findings.push(finding("CANDIDATE_LIMIT", "Candidate count exceeds the explicit scale envelope."));
  if (request.selectors.length < 1 || request.selectors.length > DECLARATIVE_QUALIFICATION_SCALE_ENVELOPE.maximumSelectors) findings.push(finding("SELECTOR_LIMIT", "Selector count is outside the explicit scale envelope."));
  if (new Set(ids).size !== ids.length || ids.some((id) => !id.trim())) findings.push(finding("INVALID_CANDIDATE_IDS", "Candidate ids must be non-empty and unique."));
  const universe = new Set(ids);
  const global = request.alreadySelectedCandidateIds;
  if (new Set(global).size !== global.length || global.some((id) => !universe.has(id))) findings.push(finding("INVALID_GLOBAL_SELECTION", "Prior global selections must be unique members of the candidate universe."));
  return findings;
}

export function compileDeclarativeQualification(request: DeclarativeQualificationRequest): DeclarativeQualificationCompilation {
  const normalized = normalizeRequest(request);
  const findings = validateRequest(normalized);
  if (findings.length > 0) return rejected(normalized, findings);
  const selected = new Set(normalized.alreadySelectedCandidateIds);
  const selectedCandidateIds: string[] = [];
  const evidence: QualificationSelectionEvidence[] = [];
  for (const [selectorIndex, selector] of normalized.selectors.entries()) {
    const available = normalized.candidates.filter(({ id }) => !selected.has(id));
    if (selector.type === "AUTHORITY_SELECTION") {
      const candidateIds = [...selector.candidateIds].sort();
      const unavailableIds = candidateIds.filter((id) => !available.some((candidate) => candidate.id === id));
      const expectedApprovalHash = hashQualificationAuthorityApproval({ policyId: normalized.policyId, selectorIndex,
        selectionType: selector.selectionType, candidateIds, authorityId: selector.approval.authorityId });
      if (selector.approval.status !== "APPROVED" || !selector.approval.authorityId.trim()
        || candidateIds.length < 1 || new Set(candidateIds).size !== candidateIds.length || unavailableIds.length > 0
        || selector.approval.approvalHash !== expectedApprovalHash) {
        findings.push(finding("INVALID_AUTHORITY_SELECTION", "Wildcard and host selections require a named, hash-bound approval over available candidates.", selectorIndex, unavailableIds));
        break;
      }
      for (const candidateId of candidateIds) {
        selected.add(candidateId); selectedCandidateIds.push(candidateId);
        evidence.push({ candidateId, selectorIndex, selectorType: selector.type,
          comparisonSetIds: available.map(({ id }) => id), authorityId: selector.approval.authorityId });
      }
      continue;
    }
    if (selector.type === "REMAINDER") {
      for (const candidate of available) {
        selected.add(candidate.id); selectedCandidateIds.push(candidate.id);
        evidence.push({ candidateId: candidate.id, selectorIndex, selectorType: selector.type,
          comparisonSetIds: available.map(({ id }) => id) });
      }
      continue;
    }
    if (selector.type === "THRESHOLD" || selector.type === "SCORE_THRESHOLD" || selector.type === "PERCENTAGE_THRESHOLD") {
      const threshold = thresholdSpec(selector);
      const evaluated = available.map((candidate) => ({ candidate, value: metricValue(candidate, threshold.metric) }));
      const missing = evaluated.filter(({ value }) => value === undefined).map(({ candidate }) => candidate.id);
      if (!Number.isFinite(threshold.value) || !validExpression(threshold.metric) || missing.length > 0) {
        findings.push(finding("INVALID_THRESHOLD_METRIC", "Threshold comparison requires a finite registered metric for every eligible candidate.", selectorIndex, missing));
        break;
      }
      const picked = evaluated.filter((entry): entry is { candidate: QualificationCandidate; value: number } =>
        entry.value !== undefined && satisfies(entry.value, threshold.comparison, threshold.value));
      for (const { candidate, value } of picked) {
        selected.add(candidate.id); selectedCandidateIds.push(candidate.id);
        evidence.push({ candidateId: candidate.id, selectorIndex, selectorType: selector.type,
          metricValue: value, comparisonSetIds: available.map(({ id }) => id) });
      }
      continue;
    }
    const ranking = rankingSpec(selector);
    const eligible = ranking.eligibleRank === undefined ? available : available.filter(({ rank }) => rank === ranking.eligibleRank);
    if (!validExpression(ranking.metric) || !Number.isInteger(ranking.count) || ranking.count < 1 || ranking.count > eligible.length
      || (ranking.eligibleRank !== undefined && (!Number.isInteger(ranking.eligibleRank) || ranking.eligibleRank < 1))) {
      findings.push(finding("INVALID_RANKING_SELECTOR", "Ranking-points selector requires a registered metric and available bounded count.", selectorIndex));
      break;
    }
    const evaluated = eligible.map((candidate) => ({ candidate, value: metricValue(candidate, ranking.metric) }));
    const invalidMetricIds = evaluated.filter(({ value }) => value === undefined).map(({ candidate }) => candidate.id);
    if (invalidMetricIds.length > 0) {
      findings.push(finding("MISSING_METRIC", "The declared ranking metric must be finite for every eligible candidate.", selectorIndex, invalidMetricIds));
      break;
    }
    const ordered = (evaluated as { candidate: QualificationCandidate; value: number }[]).sort((left, right) =>
      (ranking.direction === "HIGHER" ? right.value - left.value : left.value - right.value) || left.candidate.id.localeCompare(right.candidate.id));
    const cutoff = ordered[ranking.count - 1]!.value;
    const strictlyAhead = ordered.filter(({ value }) => ranking.direction === "HIGHER" ? value > cutoff : value < cutoff).length;
    const tied = ordered.filter(({ value }) => value === cutoff);
    const crossesCutoff = strictlyAhead < ranking.count && strictlyAhead + tied.length > ranking.count;
    if (crossesCutoff && ranking.cutoffTiePolicy === "REJECT") {
      findings.push(finding("CUTOFF_TIE_UNRESOLVED", "A ranking tie crosses the qualification cutoff.", selectorIndex, tied.map(({ candidate }) => candidate.id)));
      break;
    }
    const picked = crossesCutoff && ranking.cutoffTiePolicy === "INCLUDE_ALL"
      ? ordered.slice(0, strictlyAhead + tied.length)
      : ordered.slice(0, ranking.count);
    for (const { candidate, value } of picked) {
      selected.add(candidate.id); selectedCandidateIds.push(candidate.id);
      evidence.push({ candidateId: candidate.id, selectorIndex, selectorType: selector.type,
        metricValue: value, comparisonSetIds: ordered.map(({ candidate: entry }) => entry.id), cutoffTiePolicy: ranking.cutoffTiePolicy });
    }
  }
  if (findings.length === 0 && selectedCandidateIds.length !== normalized.outputCount) findings.push(finding(
    "OUTPUT_CARDINALITY_MISMATCH", "Sequential selectors did not resolve the exact declared output count.", undefined, selectedCandidateIds,
  ));
  if (findings.length > 0) return rejected(normalized, findings);
  const proof = proofFor(normalized, selectedCandidateIds, evidence, findings);
  return deepFreeze({ status: "CERTIFIED" as const, selectedCandidateIds, evidence, findings, proof });
}

export function verifyDeclarativeQualification(
  request: DeclarativeQualificationRequest,
  compilation: DeclarativeQualificationCompilation,
): DeclarativeQualificationVerification {
  const normalized = normalizeRequest(request);
  const findings: DeclarativeQualificationFinding[] = validateRequest(normalized);
  if (compilation.status !== "CERTIFIED") findings.push(finding("COMPILATION_NOT_CERTIFIED", "Only a certified selection can be independently verified."));
  const candidateById = new Map(normalized.candidates.map((candidate) => [candidate.id, candidate]));
  const selected = compilation.selectedCandidateIds;
  if (selected.length !== normalized.outputCount) findings.push(finding("OUTPUT_CARDINALITY_MISMATCH", "Verified output cardinality differs from the request."));
  if (new Set(selected).size !== selected.length || selected.some((id) => normalized.alreadySelectedCandidateIds.includes(id))) {
    findings.push(finding("DUPLICATE_SELECTION", "Verified selections must be unique and globally exclusive."));
  }
  const expected: string[] = [];
  const expectedEvidence: QualificationSelectionEvidence[] = [];
  const consumed = new Set(normalized.alreadySelectedCandidateIds);
  for (const [selectorIndex, selector] of normalized.selectors.entries()) {
    const available = normalized.candidates.filter(({ id }) => !consumed.has(id));
    if (selector.type === "AUTHORITY_SELECTION") {
      const candidateIds = [...selector.candidateIds].sort();
      const expectedApprovalHash = hashQualificationAuthorityApproval({ policyId: normalized.policyId, selectorIndex,
        selectionType: selector.selectionType, candidateIds, authorityId: selector.approval.authorityId });
      if (!selector.approval.authorityId.trim() || selector.approval.approvalHash !== expectedApprovalHash
        || candidateIds.some((id) => !available.some((candidate) => candidate.id === id))) {
        findings.push(finding("INVALID_AUTHORITY_SELECTION", "Independent verification rejected authority selection semantics.", selectorIndex, candidateIds));
      }
      for (const candidateId of candidateIds) {
        expected.push(candidateId); consumed.add(candidateId);
        expectedEvidence.push({ candidateId, selectorIndex, selectorType: selector.type,
          comparisonSetIds: available.map(({ id }) => id), authorityId: selector.approval.authorityId });
      }
      continue;
    }
    if (selector.type === "REMAINDER") {
      for (const candidate of available) {
        expected.push(candidate.id); consumed.add(candidate.id);
        expectedEvidence.push({ candidateId: candidate.id, selectorIndex, selectorType: selector.type,
          comparisonSetIds: available.map(({ id }) => id) });
      }
      continue;
    }
    if (selector.type === "THRESHOLD" || selector.type === "SCORE_THRESHOLD" || selector.type === "PERCENTAGE_THRESHOLD") {
      const threshold = thresholdSpec(selector);
      if (!Number.isFinite(threshold.value) || !validExpression(threshold.metric)
        || available.some((candidate) => metricValue(candidate, threshold.metric) === undefined)) {
        findings.push(finding("INVALID_THRESHOLD_METRIC", "Independent verification rejected threshold metric semantics.", selectorIndex));
      }
      const picked = available.filter((candidate) => {
        const value = metricValue(candidate, threshold.metric);
        return value !== undefined && satisfies(value, threshold.comparison, threshold.value);
      });
      for (const candidate of picked) {
        const value = metricValue(candidate, threshold.metric)!;
        expected.push(candidate.id); consumed.add(candidate.id);
        expectedEvidence.push({ candidateId: candidate.id, selectorIndex, selectorType: selector.type,
          metricValue: value, comparisonSetIds: available.map(({ id }) => id) });
      }
      continue;
    }
    const ranking = rankingSpec(selector);
    const eligible = ranking.eligibleRank === undefined ? available : available.filter(({ rank }) => rank === ranking.eligibleRank);
    if (!validExpression(ranking.metric) || !Number.isInteger(ranking.count) || ranking.count < 1 || ranking.count > eligible.length
      || eligible.some((candidate) => metricValue(candidate, ranking.metric) === undefined)) {
      findings.push(finding("INVALID_RANKING_SELECTOR", "Independent verification rejected ranking selector semantics.", selectorIndex));
    }
    const ordered = eligible.map((candidate) => ({ candidate, value: metricValue(candidate, ranking.metric) }))
      .filter((entry): entry is { candidate: QualificationCandidate; value: number } => entry.value !== undefined)
      .sort((left, right) => (ranking.direction === "HIGHER" ? right.value - left.value : left.value - right.value)
        || left.candidate.id.localeCompare(right.candidate.id));
    const cutoff = ordered[ranking.count - 1]?.value;
    const ahead = cutoff === undefined ? 0 : ordered.filter(({ value }) => ranking.direction === "HIGHER" ? value > cutoff : value < cutoff).length;
    const tied = cutoff === undefined ? [] : ordered.filter(({ value }) => value === cutoff);
    const crosses = cutoff !== undefined && ahead < ranking.count && ahead + tied.length > ranking.count;
    if (crosses && ranking.cutoffTiePolicy === "REJECT") findings.push(finding(
      "CUTOFF_TIE_UNRESOLVED", "Independent verification found an unresolved cutoff tie.", selectorIndex,
      tied.map(({ candidate }) => candidate.id),
    ));
    const picked = crosses && ranking.cutoffTiePolicy === "INCLUDE_ALL" ? ordered.slice(0, ahead + tied.length) : ordered.slice(0, ranking.count);
    for (const { candidate, value } of picked) {
      expected.push(candidate.id); consumed.add(candidate.id);
      expectedEvidence.push({ candidateId: candidate.id, selectorIndex, selectorType: selector.type, metricValue: value,
        comparisonSetIds: ordered.map(({ candidate: entry }) => entry.id), cutoffTiePolicy: ranking.cutoffTiePolicy });
    }
  }
  if (expected.length !== selected.length || expected.some((id, index) => id !== selected[index])) findings.push(finding("SELECTION_NOT_REPRODUCIBLE", "Independent selector replay produced a different selection."));
  if (compilation.evidence.length !== selected.length || compilation.evidence.some((entry, index) =>
    entry.candidateId !== selected[index] || !candidateById.has(entry.candidateId))) findings.push(finding("INVALID_PROVENANCE", "Selection provenance does not cover the certified output in sequence."));
  if (canonicalHash(compilation.evidence) !== canonicalHash(expectedEvidence)) findings.push(finding(
    "INVALID_PROVENANCE", "Independent selector evaluation does not reproduce the supplied sequential evidence.",
  ));
  const expectedProof = proofFor(normalized, compilation.selectedCandidateIds, compilation.evidence, compilation.findings);
  if (canonicalHash(expectedProof) !== canonicalHash(compilation.proof)) findings.push(finding("PROOF_BODY_MISMATCH", "Qualification proof assertions do not match independently derived assertions."));
  if (expectedProof.proofHash !== compilation.proof.proofHash) findings.push(finding("PROOF_HASH_MISMATCH", "Qualification proof does not bind the supplied request and evidence."));
  const status = findings.length === 0 ? "CERTIFIED" as const : "REJECTED" as const;
  return deepFreeze({ status, findings, verificationHash: canonicalHash({ request: normalized, compilation, findings }) });
}
