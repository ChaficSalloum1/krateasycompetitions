import type {
  QualificationPolicy,
  TournamentSpec,
  ValidationFinding,
} from "./types.js";
import { canonicalHash } from "./canonical.js";

const error = (
  code: string,
  path: string,
  message: string,
  evidence?: Record<string, unknown>,
): ValidationFinding => ({ code, severity: "ERROR", path, message, ...(evidence ? { evidence } : {}) });

const warning = (
  code: string,
  path: string,
  message: string,
  evidence?: Record<string, unknown>,
): ValidationFinding => ({ code, severity: "WARNING", path, message, ...(evidence ? { evidence } : {}) });

function duplicateIds(spec: TournamentSpec): ValidationFinding[] {
  const collections: Array<[string, Array<{ id: string }>]> = [
    ["divisions", spec.divisions], ["stages", spec.stages], ["scoringSystems", spec.scoringSystems],
    ["standingsPolicies", spec.standingsPolicies], ["qualificationPolicies", spec.qualificationPolicies],
    ["competitionStructures", spec.competitionStructures], ["drawPolicies", spec.drawPolicies],
    ["progressionPolicies", spec.progressionPolicies], ["resources", spec.resources],
    ["operationalPolicies", spec.operationalPolicies], ["assumptions", spec.assumptions],
    ["requirements", spec.requirements],
  ];
  const findings: ValidationFinding[] = [];
  for (const [name, values] of collections) {
    const seen = new Set<string>();
    for (const value of values) {
      if (seen.has(value.id)) findings.push(error("TSC010", `/${name}`, `Duplicate id '${value.id}'.`));
      seen.add(value.id);
    }
  }
  return findings;
}

function checkReferences(spec: TournamentSpec): ValidationFinding[] {
  const findings: ValidationFinding[] = [];
  const stageIds = new Set(spec.stages.map(({ id }) => id));
  const divisionIds = new Set(spec.divisions.map(({ id }) => id));
  const structureIds = new Set(spec.competitionStructures.map(({ id }) => id));
  const requireStage = (id: string, path: string) => {
    if (!stageIds.has(id)) findings.push(error("TSC020", path, `Unknown stage '${id}'.`));
  };
  for (const division of spec.divisions) for (const id of division.stageIds) requireStage(id, `/divisions/${division.id}/stageIds`);
  for (const stage of spec.stages) {
    if (!divisionIds.has(stage.divisionId)) findings.push(error("TSC021", `/stages/${stage.id}/divisionId`, `Unknown division '${stage.divisionId}'.`));
  }
  for (const policy of spec.scoringSystems) for (const id of policy.stageIds) requireStage(id, `/scoringSystems/${policy.id}/stageIds`);
  for (const policy of spec.standingsPolicies) for (const id of policy.stageIds) requireStage(id, `/standingsPolicies/${policy.id}/stageIds`);
  for (const policy of spec.qualificationPolicies) {
    requireStage(policy.sourceStageId, `/qualificationPolicies/${policy.id}/sourceStageId`);
    if (!structureIds.has(policy.destinationStructureId)) findings.push(error("TSC022", `/qualificationPolicies/${policy.id}/destinationStructureId`, `Unknown competition structure '${policy.destinationStructureId}'.`));
  }
  for (const structure of spec.competitionStructures) {
    if (!divisionIds.has(structure.divisionId)) findings.push(error("TSC021", `/competitionStructures/${structure.id}/divisionId`, `Unknown division '${structure.divisionId}'.`));
    for (const id of structure.stageIds) requireStage(id, `/competitionStructures/${structure.id}/stageIds`);
  }
  for (const policy of spec.drawPolicies) if (!structureIds.has(policy.structureId)) findings.push(error("TSC022", `/drawPolicies/${policy.id}/structureId`, `Unknown structure '${policy.structureId}'.`));
  for (const edge of spec.progressionPolicies) {
    requireStage(edge.fromStageId, `/progressionPolicies/${edge.id}/fromStageId`);
    requireStage(edge.toStageId, `/progressionPolicies/${edge.id}/toStageId`);
  }
  for (const duration of spec.scheduling.durations) requireStage(duration.stageId, `/scheduling/durations/${duration.stageId}`);
  return findings;
}

function checkShapesAndPools(spec: TournamentSpec): ValidationFinding[] {
  const findings: ValidationFinding[] = [];
  const divisionTotal = spec.divisions.reduce((sum, division) => sum + division.participantCount, 0);
  if (divisionTotal !== spec.participants.count) {
    findings.push(error("TSC101", "/divisions", "Division participant counts do not equal the tournament participant count.", { divisionTotal, participantCount: spec.participants.count }));
  }
  for (const division of spec.divisions) {
    if (division.participantShape !== spec.participants.shape) findings.push(error("TSC120", `/divisions/${division.id}/participantShape`, "Division participant shape differs from the registered participant model."));
  }
  for (const stage of spec.stages) {
    const division = spec.divisions.find(({ id }) => id === stage.divisionId);
    if (division && stage.inputShape !== division.participantShape) findings.push(error("TSC120", `/stages/${stage.id}/inputShape`, `Stage expects ${stage.inputShape} but division produces ${division.participantShape}.`));
    if (stage.inputShape !== stage.outputShape && stage.primitive !== "custom_graph") findings.push(error("TSC121", `/stages/${stage.id}/outputShape`, "A participant-shape conversion requires a registered custom graph plugin."));
    if (stage.primitive === "groups" && !stage.pool) findings.push(error("TSC130", `/stages/${stage.id}/pool`, "A groups stage requires pool configuration."));
    if (stage.pool) {
      const sum = stage.pool.sizes.reduce((total, size) => total + size, 0);
      if (stage.pool.poolCount !== stage.pool.sizes.length) findings.push(error("TSC131", `/stages/${stage.id}/pool`, "Pool count differs from the number of supplied pool sizes."));
      if (stage.expectedEntrants !== undefined && sum !== stage.expectedEntrants) findings.push(error("TSC132", `/stages/${stage.id}/pool/sizes`, "Pool sizes do not consume the stage entrant count.", { poolTotal: sum, expectedEntrants: stage.expectedEntrants }));
      if (new Set(stage.pool.sizes).size > 1) findings.push(warning("TSW210", `/stages/${stage.id}/pool/sizes`, "Pools have unequal match opportunity; cross-pool qualification must define normalization."));
      const minimumPolicy = spec.operationalPolicies.find(({ rule }) => rule === "minimum_group_matches");
      if (minimumPolicy?.strength === "HARD" && typeof minimumPolicy.value === "number") {
        const structuralMinimum = (Math.min(...stage.pool.sizes) - 1) * stage.pool.rounds;
        if (structuralMinimum < minimumPolicy.value) findings.push(error("TSC104", `/stages/${stage.id}/pool/sizes`, "Pool structure cannot satisfy minimum participation.", { structuralMinimum, requiredMinimum: minimumPolicy.value }));
      }
    }
    if (["single_elimination", "double_elimination", "consolation", "repechage"].includes(stage.primitive) && !stage.bracket) findings.push(error("TSC133", `/stages/${stage.id}/bracket`, "An elimination or repechage stage requires bracket configuration."));
    if (stage.primitive === "double_elimination" && !stage.doubleElimination) findings.push(error("TSC134", `/stages/${stage.id}/doubleElimination`, "Double elimination requires an explicit reset-final policy."));
    if (stage.primitive === "repechage" && !stage.repechage) findings.push(error("TSC135", `/stages/${stage.id}/repechage`, "Repechage requires an explicit registered model."));
    if (stage.primitive === "play_in" && !stage.playIn) findings.push(error("TSC140", `/stages/${stage.id}/playIn`, "A play-in stage requires an explicit main-draw size."));
    if (stage.primitive === "placement" && !stage.classification) findings.push(error("TSC143", `/stages/${stage.id}/classification`, "A placement stage requires an explicit versioned classification graph."));
    if (stage.primitive === "custom_graph" && !stage.customGraph) findings.push(error("TSC147", `/stages/${stage.id}/customGraph`, "A custom-graph stage requires an explicit versioned graph definition."));
    const dynamicConfigs = [stage.swiss, stage.ladder, stage.qualifyingHeat, stage.timeTrial, stage.rankingStage].filter(Boolean);
    const expectedDynamicConfig = stage.primitive === "swiss" ? stage.swiss : stage.primitive === "ladder" ? stage.ladder
      : stage.primitive === "qualifying_heat" ? stage.qualifyingHeat : stage.primitive === "time_trial" ? stage.timeTrial
        : stage.primitive === "ranking_stage" ? stage.rankingStage : undefined;
    if (["swiss", "ladder", "qualifying_heat", "time_trial", "ranking_stage"].includes(stage.primitive) && !expectedDynamicConfig) {
      findings.push(error("TSC151", `/stages/${stage.id}`, `The ${stage.primitive} primitive requires its explicit dynamic configuration.`));
    }
    if (dynamicConfigs.length > Number(Boolean(expectedDynamicConfig))) {
      findings.push(error("TSC152", `/stages/${stage.id}`, "Dynamic configuration is valid only for its matching primitive."));
    }
    const dynamicIds = stage.swiss?.entrantIds ?? stage.ladder?.initialOrder ?? stage.qualifyingHeat?.entrants.map(({ id }) => id)
      ?? stage.timeTrial?.entrants.map(({ id }) => id) ?? stage.rankingStage?.entrantIds;
    if (dynamicIds) {
      const activeCount = stage.qualifyingHeat ? stage.qualifyingHeat.entrants.filter(({ withdrawn }) => !withdrawn).length
        : stage.timeTrial ? stage.timeTrial.entrants.filter(({ withdrawn }) => !withdrawn).length : dynamicIds.length;
      if (new Set(dynamicIds).size !== dynamicIds.length || dynamicIds.some((id) => !id.trim())) findings.push(error(
        "TSC153", `/stages/${stage.id}`, "Dynamic entrant ids must be non-empty and unique.",
      ));
      if (stage.expectedEntrants !== undefined && activeCount !== stage.expectedEntrants) findings.push(error(
        "TSC154", `/stages/${stage.id}/expectedEntrants`, "Expected entrants must equal the active dynamic entrant count.",
        { expectedEntrants: stage.expectedEntrants, activeDynamicEntrants: activeCount },
      ));
    }
    if (stage.swiss && (stage.swiss.totalRounds < 1 || stage.swiss.finalRankingPolicy.criteria[0] !== "POINTS" ||
      !["COMPETITOR_ID", "SHARED_RANK"].includes(stage.swiss.finalRankingPolicy.criteria.at(-1) ?? ""))) {
      findings.push(error("TSC155", `/stages/${stage.id}/swiss`, "Swiss rounds and terminal tie resolution must be explicit."));
    }
    if (stage.ladder && (stage.ladder.initialOrder.length < 2 || stage.ladder.maxChallengeDistance < 1)) {
      findings.push(error("TSC156", `/stages/${stage.id}/ladder`, "Ladder order and challenge distance are invalid."));
    }
    if (stage.qualifyingHeat && (stage.qualifyingHeat.heatCount * stage.qualifyingHeat.lanesPerHeat <
      stage.qualifyingHeat.entrants.filter(({ withdrawn }) => !withdrawn).length || stage.qualifyingHeat.qualificationPlaces < 1)) {
      findings.push(error("TSC157", `/stages/${stage.id}/qualifyingHeat`, "Heat capacity and qualification places must cover the active field."));
    }
    if (stage.timeTrial && (stage.timeTrial.qualificationPlaces < 1 || stage.timeTrial.qualificationPlaces >
      stage.timeTrial.entrants.filter(({ withdrawn }) => !withdrawn).length)) findings.push(error(
        "TSC158", `/stages/${stage.id}/timeTrial`, "Time-trial qualification places must be within the active field.",
      ));
    if (stage.rankingStage && (stage.rankingStage.qualificationPlaces < 1 || stage.rankingStage.qualificationPlaces > stage.rankingStage.entrantIds.length)) {
      findings.push(error("TSC159", `/stages/${stage.id}/rankingStage`, "Ranking qualification places must be within the entrant field."));
    }
    if (stage.doubleElimination && stage.primitive !== "double_elimination") findings.push(error("TSC136", `/stages/${stage.id}/doubleElimination`, "Double-elimination configuration is valid only for that primitive."));
    if (stage.repechage && stage.primitive !== "repechage") findings.push(error("TSC136", `/stages/${stage.id}/repechage`, "Repechage configuration is valid only for that primitive."));
    if (stage.playIn && stage.primitive !== "play_in") findings.push(error("TSC136", `/stages/${stage.id}/playIn`, "Play-in configuration is valid only for that primitive."));
    if (stage.classification && stage.primitive !== "placement") findings.push(error("TSC136", `/stages/${stage.id}/classification`, "Classification configuration is valid only for the placement primitive."));
    if (stage.customGraph && stage.primitive !== "custom_graph") findings.push(error("TSC136", `/stages/${stage.id}/customGraph`, "Custom-graph configuration is valid only for that primitive."));
    if ((stage.primitive === "double_elimination" || stage.primitive === "repechage") && stage.pool) findings.push(error("TSC139", `/stages/${stage.id}/pool`, "Native elimination and repechage stages cannot also declare pool semantics."));
    if ((stage.primitive === "double_elimination" || stage.primitive === "repechage") && stage.bracket) {
      const count = stage.bracket.entrantCount;
      const powerOfTwo = count >= 2 && count <= 64 && (count & (count - 1)) === 0;
      if (!powerOfTwo || stage.bracket.topology !== "power_of_two" || stage.bracket.thirdPlaceMatch) findings.push(error(
        "TSC137", `/stages/${stage.id}/bracket`, "This verified format requires a power-of-two bracket without a separate third-place contest.",
        { entrantCount: count, topology: stage.bracket.topology, thirdPlaceMatch: stage.bracket.thirdPlaceMatch },
      ));
      if (stage.primitive === "repechage" && count < 8) findings.push(error("TSC138", `/stages/${stage.id}/bracket/entrantCount`, "Quarterfinal repechage requires at least eight entrants."));
    }
    if (stage.bracket && stage.expectedEntrants !== undefined && stage.bracket.entrantCount !== stage.expectedEntrants) findings.push(error("TSC221", `/stages/${stage.id}/bracket/entrantCount`, "Bracket entrant count differs from the stage entrant count."));
    if (stage.primitive === "play_in" && stage.playIn) {
      const entrants = stage.expectedEntrants;
      const mainDrawSize = stage.playIn.mainDrawSize;
      if (entrants === undefined || entrants <= mainDrawSize || entrants - mainDrawSize > Math.floor(entrants / 2)) findings.push(error(
        "TSC141", `/stages/${stage.id}/playIn/mainDrawSize`,
        "The declared counts cannot be reduced to the main draw in exactly one play-in round.",
        { expectedEntrants: entrants, mainDrawSize },
      ));
      if (stage.pool || stage.bracket) findings.push(error("TSC142", `/stages/${stage.id}`, "A native play-in stage cannot also declare pool or bracket semantics."));
    }
    if (stage.primitive === "placement" && stage.classification) {
      if (stage.pool || stage.bracket) findings.push(error("TSC144", `/stages/${stage.id}`, "A native placement stage cannot also declare pool or bracket semantics."));
      const sourceIds = stage.classification.sourceNodes.map(({ id }) => id);
      const contestIds = stage.classification.contests.map(({ id }) => id);
      if (new Set(sourceIds).size !== sourceIds.length || new Set(contestIds).size !== contestIds.length) findings.push(error(
        "TSC145", `/stages/${stage.id}/classification`, "Classification source and contest ids must be unique.",
      ));
      const declaredSources = new Set(sourceIds);
      const unknownSources = stage.classification.contests.flatMap(({ sources }) => sources)
        .map(({ nodeId }) => nodeId).filter((id) => !declaredSources.has(id));
      if (unknownSources.length > 0) findings.push(error("TSC146", `/stages/${stage.id}/classification/contests`, "Every classification source must be explicitly declared.", { unknownSources: [...new Set(unknownSources)].sort() }));
    }
    if (stage.primitive === "custom_graph" && stage.customGraph) {
      if (stage.pool || stage.bracket) findings.push(error("TSC148", `/stages/${stage.id}`, "A native custom graph cannot also declare pool or bracket semantics."));
      if (stage.expectedEntrants === undefined || stage.customGraph.entrantCount !== stage.expectedEntrants) findings.push(error(
        "TSC149", `/stages/${stage.id}/customGraph/entrantCount`, "Custom-graph and stage entrant counts must agree.",
        { expectedEntrants: stage.expectedEntrants, graphEntrants: stage.customGraph.entrantCount },
      ));
      const nodeIds = stage.customGraph.nodes.map(({ id }) => id);
      if (new Set(nodeIds).size !== nodeIds.length) findings.push(error("TSC150", `/stages/${stage.id}/customGraph/nodes`, "Custom-graph node ids must be unique."));
    }
  }
  return findings;
}

function checkQualification(spec: TournamentSpec): ValidationFinding[] {
  const findings: ValidationFinding[] = [];
  const byStructure = new Map<string, QualificationPolicy[]>();
  for (const policy of spec.qualificationPolicies) {
    const current = byStructure.get(policy.destinationStructureId) ?? [];
    current.push(policy);
    byStructure.set(policy.destinationStructureId, current);
    const stage = spec.stages.find(({ id }) => id === policy.sourceStageId);
    const declarativeTypes = new Set(["ranking_points", "threshold", "score_threshold", "percentage_threshold", "elapsed_time", "aggregate_metric", "best_n", "authority_selection"]);
    const usesDeclarativeSelectors = policy.selectors.some(({ type }) => declarativeTypes.has(type));
    if (usesDeclarativeSelectors && policy.selectors.some(({ type }) => !declarativeTypes.has(type) && type !== "remainder")) findings.push(error(
      "TSC226", `/qualificationPolicies/${policy.id}/selectors`, "Declarative and legacy qualification selector families cannot be mixed without an explicit adapter.",
    ));
    const hasDataDependentCount = policy.selectors.some((selector) =>
      selector.type === "threshold" || selector.type === "score_threshold" || selector.type === "percentage_threshold"
      || ((selector.type === "ranking_points" || selector.type === "elapsed_time" || selector.type === "aggregate_metric" || selector.type === "best_n")
        && selector.cutoffTiePolicy === "include_all"),
    );
    if (!policy.selectors.some(({ type }) => type === "remainder") && !hasDataDependentCount) {
      const independentlyDerivedCount = policy.selectors.reduce((sum, selector) => {
        switch (selector.type) {
          case "top_n": case "bottom_n": case "best_n_across_pools": case "manual_decision": case "ranking_points": case "elapsed_time": case "aggregate_metric": case "best_n": return sum + selector.count;
          case "authority_selection": return sum + selector.candidateIds.length;
          case "pool_position": case "pool_winners": return sum + (stage?.pool?.poolCount ?? 0);
          case "remainder": case "threshold": case "score_threshold": case "percentage_threshold": return sum;
        }
      }, 0);
      if (independentlyDerivedCount !== policy.outputCount) findings.push(error("TSC222", `/qualificationPolicies/${policy.id}/outputCount`, "Selector cardinality does not independently re-derive to the declared qualification output.", { independentlyDerivedCount, declaredOutput: policy.outputCount }));
    } else if (policy.selectors.some(({ type }) => type === "remainder") && stage?.expectedEntrants !== undefined) {
      const allocatedElsewhere = spec.qualificationPolicies
        .filter((other) => other.sourceStageId === policy.sourceStageId && other.id !== policy.id)
        .reduce((sum, other) => sum + other.outputCount, 0);
      const independentlyDerivedRemainder = stage.expectedEntrants - allocatedElsewhere;
      if (independentlyDerivedRemainder !== policy.outputCount) findings.push(error("TSC222", `/qualificationPolicies/${policy.id}/outputCount`, "Remainder cardinality does not independently re-derive from the source entrant count.", { independentlyDerivedRemainder, declaredOutput: policy.outputCount }));
    }
    if (stage?.pool) for (const [selectorIndex, selector] of policy.selectors.entries()) {
      if (selector.type === "pool_position" && selector.position > Math.min(...stage.pool.sizes)) findings.push(error(
        "TSC223", `/qualificationPolicies/${policy.id}/selectors/${selectorIndex}`,
        "A pool-position selector must exist in every pool.", { position: selector.position, poolSizes: stage.pool.sizes },
      ));
      if (selector.type === "best_n_across_pools" && selector.poolPosition !== undefined) {
        const eligiblePoolCount = stage.pool.sizes.filter((size) => size >= selector.poolPosition!).length;
        if (selector.count > eligiblePoolCount) findings.push(error(
          "TSC223", `/qualificationPolicies/${policy.id}/selectors/${selectorIndex}`,
          "A cross-pool selector requests more entrants at a position than eligible pools can supply.",
          { position: selector.poolPosition, requested: selector.count, eligiblePoolCount, poolSizes: stage.pool.sizes },
        ));
      }
    }
    if (stage?.pool && new Set(stage.pool.sizes).size > 1 && !policy.normalization && policy.selectors.some(({ type }) => type === "best_n_across_pools")) {
      findings.push(error("TSC224", `/qualificationPolicies/${policy.id}/normalization`, "Cross-pool comparison over unequal pools requires an explicit normalization policy."));
    }
    for (const [selectorIndex, selector] of policy.selectors.entries()) if (selector.type === "authority_selection") {
      const expectedApprovalHash = canonicalHash({ policyId: policy.id, selectorIndex,
        selectionType: selector.selectionType.toUpperCase(), candidateIds: [...selector.candidateIds].sort(), authorityId: selector.approval.authorityId });
      if (selector.approval.approvalHash !== expectedApprovalHash) findings.push(error(
        "TSC227", `/qualificationPolicies/${policy.id}/selectors/${selectorIndex}/approval/approvalHash`,
        "Authority approval hash does not bind the policy, selector position, authority, selection type, and candidate ids.",
      ));
    }
  }
  for (const structure of spec.competitionStructures) {
    const policies = byStructure.get(structure.id) ?? [];
    const outputCount = policies.reduce((sum, policy) => sum + policy.outputCount, 0);
    if (outputCount !== structure.targetEntrants) findings.push(error("TSC221", `/competitionStructures/${structure.id}/targetEntrants`, "Qualification output does not match structure entrant count.", { qualificationOutput: outputCount, targetEntrants: structure.targetEntrants }));
    const openingStage = spec.stages.find(({ id }) => id === structure.stageIds[0]);
    if (openingStage?.expectedEntrants !== undefined && openingStage.expectedEntrants !== structure.targetEntrants) findings.push(error("TSC221", `/competitionStructures/${structure.id}/stageIds`, "Opening stage entrant count does not match structure entrant count.", { openingStageEntrants: openingStage.expectedEntrants, targetEntrants: structure.targetEntrants }));
  }
  return findings;
}

function checkProgression(spec: TournamentSpec): ValidationFinding[] {
  const findings: ValidationFinding[] = [];
  const graph = new Map<string, string[]>();
  for (const stage of spec.stages) graph.set(stage.id, []);
  for (const edge of spec.progressionPolicies) {
    graph.get(edge.fromStageId)?.push(edge.toStageId);
    if (edge.outcome === "loser" && edge.sourceCanBeBye) findings.push(error("TSC225", `/progressionPolicies/${edge.id}`, "A loser path is undefined when its source can resolve as a bye."));
    const from = spec.stages.find(({ id }) => id === edge.fromStageId);
    const to = spec.stages.find(({ id }) => id === edge.toStageId);
    if (from && to && from.outputShape !== to.inputShape) findings.push(error("TSC120", `/progressionPolicies/${edge.id}`, `Progression produces ${from.outputShape} but destination expects ${to.inputShape}.`));
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const walk = (node: string): boolean => {
    if (visiting.has(node)) return true;
    if (visited.has(node)) return false;
    visiting.add(node);
    if ((graph.get(node) ?? []).some(walk)) return true;
    visiting.delete(node);
    visited.add(node);
    return false;
  };
  if ([...graph.keys()].some(walk)) findings.push(error("TSC302", "/progressionPolicies", "Progression graph contains a cycle."));
  return findings;
}

function checkProvenanceAndCoverage(spec: TournamentSpec): ValidationFinding[] {
  const findings: ValidationFinding[] = [];
  const requiredPaths = [
    ...spec.qualificationPolicies.map(({ id }) => `/qualificationPolicies/${id}`),
    ...spec.standingsPolicies.map(({ id }) => `/standingsPolicies/${id}`),
    ...spec.progressionPolicies.map(({ id }) => `/progressionPolicies/${id}`),
    ...spec.drawPolicies.map(({ id }) => `/drawPolicies/${id}`),
  ];
  for (const path of requiredPaths) {
    const evidence = spec.assumptions.find((entry) => entry.rulePath === path);
    if (!evidence || !evidence.critical) findings.push(error("TSC601", path, "Critical competition policy has no explicit provenance."));
    else if (evidence.knowledge === "UNRESOLVED" || !evidence.approved) findings.push(error("TSC602", path, "Critical competition policy is unresolved or unapproved."));
  }
  for (const assumption of spec.assumptions) {
    if (assumption.knowledge === "UNRESOLVED") findings.push(error("TSC603", `/assumptions/${assumption.id}`, "Unresolved assumption prevents certification."));
  }
  const ruleIds = new Set(spec.assumptions.map(({ id }) => id));
  for (const requirement of spec.requirements) {
    if (requirement.status === "UNRESOLVED") findings.push(error("TSC610", `/requirements/${requirement.id}`, "Requirement is unresolved and cannot disappear from compilation."));
    if (requirement.status !== "UNRESOLVED" && requirement.mappedRuleIds.length === 0) findings.push(error("TSC611", `/requirements/${requirement.id}/mappedRuleIds`, "Resolved requirement has no formal rule mapping."));
    for (const id of requirement.mappedRuleIds) if (!ruleIds.has(id)) findings.push(error("TSC612", `/requirements/${requirement.id}/mappedRuleIds`, `Requirement references unknown rule evidence '${id}'.`));
    if (requirement.status === "DELIBERATELY_RELAXED" && !requirement.resolutionNote) findings.push(error("TSC613", `/requirements/${requirement.id}/resolutionNote`, "A deliberately relaxed requirement needs an explanation."));
  }
  if (spec.randomisation.mode === "deterministic" && (!spec.randomisation.seed || !spec.randomisation.algorithm)) findings.push(error("TSC620", "/randomisation", "Deterministic randomisation requires a pinned seed and algorithm."));
  if (spec.randomisation.mode === "none" && spec.drawPolicies.some(({ placement }) => placement === "random")) findings.push(error("TSC620", "/randomisation", "A random draw requires deterministic randomisation metadata."));
  return findings;
}

export function typeCheck(spec: TournamentSpec): ValidationFinding[] {
  return [
    ...duplicateIds(spec),
    ...checkReferences(spec),
    ...checkShapesAndPools(spec),
    ...checkQualification(spec),
    ...checkProgression(spec),
    ...checkProvenanceAndCoverage(spec),
  ];
}
