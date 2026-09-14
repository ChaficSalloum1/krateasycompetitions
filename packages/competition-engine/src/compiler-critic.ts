import { canonicalHash, deepFreeze, type RuleStrength } from "@tournament-os/tournament-schema";

export type RequirementQuantifier = "OVERALL" | "PER_POOL" | "PER_DIVISION" | "PER_PARTICIPANT" | "PER_CONTEST";
export type CriticRequirementStatus = "SATISFIED" | "DELIBERATELY_RELAXED" | "UNRESOLVED" | "FAILED";

export interface CriticRequirement {
  id: string;
  sourceText: string;
  strength: RuleStrength;
  quantifier: RequirementQuantifier;
}

export interface CompiledClaim {
  id: string;
  requirementIds: readonly string[];
  rulePath: string;
  quantifier: RequirementQuantifier;
  disposition: "ENFORCED" | "DELIBERATELY_RELAXED";
  proofFactIds: readonly string[];
  assumptionIds: readonly string[];
  relaxationReason?: string;
  relaxationApproved?: boolean;
}

export interface CriticAssumption {
  id: string;
  approved: boolean;
  sourceReference: string;
  proofFactIds?: readonly string[];
}

export interface ProofCounterexample {
  type: string;
  path: string;
  witness: string;
  evidence?: Record<string, unknown>;
}

export interface ProofFact {
  id: string;
  claimId: string;
  passed: boolean;
  statement: string;
  scope: RequirementQuantifier;
  evidence: Record<string, unknown>;
  counterexample?: ProofCounterexample;
  destination?: { subjectId: string; destinationId: string; exclusiveGroup: string };
}

export interface CriticInput {
  requirements: readonly CriticRequirement[];
  claims: readonly CompiledClaim[];
  assumptions: readonly CriticAssumption[];
  proofFacts: readonly ProofFact[];
}

export interface CriticConcern {
  code: string;
  severity: "ERROR" | "WARNING";
  blocking: boolean;
  message: string;
  requirementIds: string[];
  claimIds: string[];
  counterexamples: ProofCounterexample[];
  evidence: Record<string, unknown>;
}

export interface RequirementCoverage {
  requirementId: string;
  strength: RuleStrength;
  status: CriticRequirementStatus;
  claimIds: string[];
  concernCodes: string[];
  counterexamples: ProofCounterexample[];
}

export interface CriticReport {
  coverage: RequirementCoverage[];
  concerns: CriticConcern[];
  certification: {
    eligible: boolean;
    blockingRequirementIds: string[];
    blockingConcernCodes: string[];
    blockingRules: readonly ["FAILED_OR_UNRESOLVED", "HARD_NOT_SATISFIED", "GLOBAL_BLOCKING_CONCERN"];
  };
  proofHash: string;
}

const duplicateValues = (values: readonly string[]): string[] =>
  [...new Set(values.filter((value, index) => values.indexOf(value) !== index))].sort();

const quantifierCounterexample = (requirement: CriticRequirement, claim: CompiledClaim): ProofCounterexample => ({
  type: "QUANTIFIER_DRIFT",
  path: claim.rulePath,
  witness: requirement.quantifier === "PER_POOL" && claim.quantifier === "OVERALL"
    ? "An overall aggregate can pass while at least one individual pool fails."
    : `A ${claim.quantifier} proof does not establish the required ${requirement.quantifier} scope.`,
  evidence: { requiredQuantifier: requirement.quantifier, compiledQuantifier: claim.quantifier },
});

function normalizedInput(input: CriticInput): CriticInput {
  return {
    requirements: [...input.requirements].map((entry) => ({ ...entry })).sort((left, right) => left.id.localeCompare(right.id)),
    claims: [...input.claims].map((entry) => ({
      ...entry,
      requirementIds: [...entry.requirementIds].sort(),
      proofFactIds: [...entry.proofFactIds].sort(),
      assumptionIds: [...entry.assumptionIds].sort(),
    })).sort((left, right) => left.id.localeCompare(right.id)),
    assumptions: [...input.assumptions].map((entry) => ({ ...entry, ...(entry.proofFactIds ? { proofFactIds: [...entry.proofFactIds].sort() } : {}) })).sort((left, right) => left.id.localeCompare(right.id)),
    proofFacts: [...input.proofFacts].map((entry) => ({ ...entry, evidence: structuredClone(entry.evidence) })).sort((left, right) => left.id.localeCompare(right.id)),
  };
}

export function critiqueCompilation(input: CriticInput): CriticReport {
  const normalized = normalizedInput(input);
  const concerns: CriticConcern[] = [];
  const requirementById = new Map(normalized.requirements.map((entry) => [entry.id, entry]));
  const claimById = new Map(normalized.claims.map((entry) => [entry.id, entry]));
  const assumptionById = new Map(normalized.assumptions.map((entry) => [entry.id, entry]));
  const proofById = new Map(normalized.proofFacts.map((entry) => [entry.id, entry]));

  const addConcern = (concern: CriticConcern): void => {
    concerns.push({
      ...concern,
      requirementIds: [...new Set(concern.requirementIds)].sort(),
      claimIds: [...new Set(concern.claimIds)].sort(),
      counterexamples: [...concern.counterexamples].sort((left, right) => left.path.localeCompare(right.path) || left.type.localeCompare(right.type)),
    });
  };

  const duplicateRequirementIds = duplicateValues(normalized.requirements.map(({ id }) => id));
  const duplicateClaimIds = duplicateValues(normalized.claims.map(({ id }) => id));
  const duplicateAssumptionIds = duplicateValues(normalized.assumptions.map(({ id }) => id));
  const duplicateProofFactIds = duplicateValues(normalized.proofFacts.map(({ id }) => id));
  if (duplicateRequirementIds.length || duplicateClaimIds.length || duplicateAssumptionIds.length || duplicateProofFactIds.length) addConcern({
    code: "TCC100", severity: "ERROR", blocking: true, message: "Critic input identities must be unique.",
    requirementIds: duplicateRequirementIds, claimIds: duplicateClaimIds, counterexamples: [],
    evidence: { duplicateRequirementIds, duplicateClaimIds, duplicateAssumptionIds, duplicateProofFactIds },
  });

  for (const claim of normalized.claims) {
    const unknownRequirementIds = claim.requirementIds.filter((id) => !requirementById.has(id));
    if (unknownRequirementIds.length) addConcern({
      code: "TCC102", severity: "ERROR", blocking: true, message: `Claim '${claim.id}' maps to unknown source requirements.`,
      requirementIds: unknownRequirementIds, claimIds: [claim.id], counterexamples: [], evidence: { unknownRequirementIds, rulePath: claim.rulePath },
    });
    const affectedRequirements = claim.requirementIds.filter((id) => requirementById.has(id));
    for (const assumptionId of claim.assumptionIds) {
      const assumption = assumptionById.get(assumptionId);
      const missingSupportFacts = assumption?.proofFactIds?.filter((id) => !proofById.get(id)?.passed) ?? [];
      if (!assumption || !assumption.approved || !assumption.sourceReference.trim() || missingSupportFacts.length) addConcern({
        code: "TCC103", severity: "ERROR", blocking: true, message: `Claim '${claim.id}' relies on unsupported assumption '${assumptionId}'.`,
        requirementIds: affectedRequirements, claimIds: [claim.id], counterexamples: [],
        evidence: { assumptionId, exists: assumption !== undefined, approved: assumption?.approved ?? false, sourceReference: assumption?.sourceReference ?? null, missingSupportFacts },
      });
    }
    if (claim.proofFactIds.length === 0) addConcern({
      code: "TCC104", severity: "ERROR", blocking: true, message: `Claim '${claim.id}' has no registered proof facts.`,
      requirementIds: affectedRequirements, claimIds: [claim.id], counterexamples: [], evidence: { rulePath: claim.rulePath },
    });
    for (const proofFactId of claim.proofFactIds) {
      const fact = proofById.get(proofFactId);
      if (!fact || fact.claimId !== claim.id) addConcern({
        code: "TCC104", severity: "ERROR", blocking: true, message: `Claim '${claim.id}' references a missing or foreign proof fact '${proofFactId}'.`,
        requirementIds: affectedRequirements, claimIds: [claim.id], counterexamples: [], evidence: { proofFactId, registeredClaimId: fact?.claimId ?? null },
      });
    }
    if (claim.disposition === "DELIBERATELY_RELAXED") {
      const validRelaxation = claim.relaxationApproved === true && Boolean(claim.relaxationReason?.trim());
      addConcern({
        code: validRelaxation ? "TCC109" : "TCC108",
        severity: validRelaxation ? "WARNING" : "ERROR",
        blocking: !validRelaxation,
        message: validRelaxation ? `Claim '${claim.id}' was deliberately relaxed with approval.` : `Claim '${claim.id}' has an unapproved or unexplained relaxation.`,
        requirementIds: affectedRequirements, claimIds: [claim.id], counterexamples: [],
        evidence: { relaxationApproved: claim.relaxationApproved ?? false, relaxationReason: claim.relaxationReason ?? null },
      });
    }
  }

  for (const requirement of normalized.requirements) {
    const mappedClaims = normalized.claims.filter(({ requirementIds }) => requirementIds.includes(requirement.id));
    if (mappedClaims.length === 0) addConcern({
      code: "TCC101", severity: "ERROR", blocking: true, message: `Source requirement '${requirement.id}' was lost during compilation.`,
      requirementIds: [requirement.id], claimIds: [],
      counterexamples: [{ type: "LOST_REQUIREMENT", path: "/requirements", witness: requirement.sourceText }],
      evidence: { sourceText: requirement.sourceText, quantifier: requirement.quantifier },
    });
    for (const claim of mappedClaims) {
      if (claim.quantifier !== requirement.quantifier) {
        const counterexample = quantifierCounterexample(requirement, claim);
        addConcern({
          code: "TCC105", severity: "ERROR", blocking: true, message: `Claim '${claim.id}' changes the quantifier of requirement '${requirement.id}'.`,
          requirementIds: [requirement.id], claimIds: [claim.id], counterexamples: [counterexample], evidence: counterexample.evidence ?? {},
        });
      }
      for (const fact of claim.proofFactIds.map((id) => proofById.get(id)).filter((entry): entry is ProofFact => entry?.claimId === claim.id)) {
        if (fact.scope !== claim.quantifier) {
          const counterexample: ProofCounterexample = { type: "PROOF_SCOPE_DRIFT", path: claim.rulePath, witness: `Proof '${fact.id}' has ${fact.scope} scope but claim '${claim.id}' requires ${claim.quantifier}.`, evidence: { proofFactId: fact.id, factScope: fact.scope, claimQuantifier: claim.quantifier } };
          addConcern({ code: "TCC105", severity: "ERROR", blocking: true, message: "Proof scope does not match compiled claim scope.", requirementIds: [requirement.id], claimIds: [claim.id], counterexamples: [counterexample], evidence: counterexample.evidence ?? {} });
        }
        if (!fact.passed) {
          const counterexample = fact.counterexample ?? { type: "PROOF_FAILURE", path: claim.rulePath, witness: fact.statement, evidence: fact.evidence };
          addConcern({ code: "TCC107", severity: "ERROR", blocking: true, message: `Proof '${fact.id}' refutes claim '${claim.id}'.`, requirementIds: [requirement.id], claimIds: [claim.id], counterexamples: [counterexample], evidence: { proofFactId: fact.id } });
        }
      }
    }
  }

  for (const fact of normalized.proofFacts) if (!claimById.has(fact.claimId)) addConcern({
    code: "TCC100", severity: "ERROR", blocking: true, message: `Proof '${fact.id}' references unknown claim '${fact.claimId}'.`,
    requirementIds: [], claimIds: [fact.claimId], counterexamples: [], evidence: { proofFactId: fact.id },
  });

  const destinationFacts = normalized.proofFacts.filter((fact) => fact.passed && fact.destination);
  const destinationGroups = new Map<string, ProofFact[]>();
  for (const fact of destinationFacts) {
    const destination = fact.destination!;
    const key = `${destination.exclusiveGroup}|${destination.subjectId}`;
    destinationGroups.set(key, [...(destinationGroups.get(key) ?? []), fact]);
  }
  for (const facts of destinationGroups.values()) {
    const destinations = [...new Set(facts.map((fact) => fact.destination!.destinationId))].sort();
    if (destinations.length <= 1) continue;
    const claimIds = facts.map(({ claimId }) => claimId).sort();
    const requirementIds = claimIds.flatMap((id) => claimById.get(id)?.requirementIds ?? []).sort();
    const { subjectId, exclusiveGroup } = facts[0]!.destination!;
    const counterexample: ProofCounterexample = { type: "DUPLICATE_DESTINATION", path: "/qualification", witness: `Subject '${subjectId}' is assigned to mutually exclusive destinations ${destinations.join(", ")}.`, evidence: { subjectId, exclusiveGroup, destinations } };
    addConcern({ code: "TCC106", severity: "ERROR", blocking: true, message: "Compiled truth assigns one subject to multiple mutually exclusive destinations.", requirementIds, claimIds, counterexamples: [counterexample], evidence: { subjectId, exclusiveGroup, destinations } });
  }

  concerns.sort((left, right) => left.code.localeCompare(right.code)
    || left.requirementIds.join("|").localeCompare(right.requirementIds.join("|"))
    || left.claimIds.join("|").localeCompare(right.claimIds.join("|"))
    || left.message.localeCompare(right.message));

  const coverage: RequirementCoverage[] = normalized.requirements.map((requirement) => {
    const mappedClaims = normalized.claims.filter(({ requirementIds }) => requirementIds.includes(requirement.id));
    const related = concerns.filter(({ requirementIds }) => requirementIds.includes(requirement.id));
    const hasFailure = related.some(({ code }) => ["TCC105", "TCC106", "TCC107"].includes(code));
    const hasUnresolved = related.some(({ code }) => ["TCC101", "TCC103", "TCC104", "TCC108"].includes(code));
    const hasRelaxation = mappedClaims.some(({ disposition }) => disposition === "DELIBERATELY_RELAXED");
    const status: CriticRequirementStatus = hasFailure ? "FAILED" : hasUnresolved ? "UNRESOLVED" : hasRelaxation ? "DELIBERATELY_RELAXED" : "SATISFIED";
    return {
      requirementId: requirement.id,
      strength: requirement.strength,
      status,
      claimIds: mappedClaims.map(({ id }) => id).sort(),
      concernCodes: [...new Set(related.map(({ code }) => code))].sort(),
      counterexamples: related.flatMap(({ counterexamples }) => counterexamples),
    };
  });
  const blockingRequirementIds = coverage.filter(({ status, strength }) => status === "FAILED" || status === "UNRESOLVED" || (strength === "HARD" && status !== "SATISFIED")).map(({ requirementId }) => requirementId);
  const blockingConcernCodes = [...new Set(concerns.filter(({ blocking }) => blocking).map(({ code }) => code))].sort();
  const certification = {
    eligible: blockingRequirementIds.length === 0 && blockingConcernCodes.length === 0,
    blockingRequirementIds,
    blockingConcernCodes,
    blockingRules: ["FAILED_OR_UNRESOLVED", "HARD_NOT_SATISFIED", "GLOBAL_BLOCKING_CONCERN"] as const,
  };
  const partial = { coverage, concerns, certification };
  return deepFreeze({ ...partial, proofHash: canonicalHash({ input: normalized, report: partial }) }) as CriticReport;
}
