import assert from "node:assert/strict";
import test from "node:test";
import {
  compileDefinition,
  validateTournamentSpec,
  type QualificationPolicy,
  type TournamentDefinition,
  type TournamentSpec,
} from "@tournament-os/tournament-schema";
import { playAndKonnectDefinition } from "@tournament-os/tournament-schema/example";
import { createEntrants } from "../src/graph.js";
import { qualify } from "../src/qualification.js";
import { hashQualificationAuthorityApproval } from "../src/declarative-qualification.js";
import type { Standing } from "../src/types.js";

function definitionWith(policy: QualificationPolicy): TournamentDefinition {
  const definition = structuredClone(playAndKonnectDefinition) as TournamentDefinition;
  definition.participants.count = 4;
  definition.divisions = [{
    id: "open", label: "Open", participantCount: 4, participantShape: "pair", stageIds: ["open.pools", "open.main"],
  }];
  definition.stages = [
    { id: "open.pools", label: "Pools", divisionId: "open", primitive: "groups", inputShape: "pair", outputShape: "pair",
      expectedEntrants: 4, pool: { poolCount: 1, sizes: [4], rounds: 1, allocation: "snake" } },
    { id: "open.main", label: "Main", divisionId: "open", primitive: "single_elimination", inputShape: "pair", outputShape: "pair",
      expectedEntrants: policy.outputCount, bracket: { entrantCount: policy.outputCount, topology: "power_of_two", thirdPlaceMatch: false } },
  ];
  definition.scoringSystems = [{ id: "score", adapterRule: "generic.head-to-head", version: "1.0.0", stageIds: ["open.pools", "open.main"] }];
  definition.standingsPolicies = [{ id: "table", stageIds: ["open.pools"], metricOrder: [{ metric: "wins", direction: "DESC" }], tieFallback: "shared_rank" }];
  definition.qualificationPolicies = [policy];
  definition.competitionStructures = [{ id: "open.main.structure", label: "Main", divisionId: "open", targetEntrants: policy.outputCount, stageIds: ["open.main"] }];
  definition.drawPolicies = [];
  definition.progressionPolicies = [];
  definition.scheduling.start = "2026-01-01T09:00:00Z";
  definition.scheduling.finishBy = "2026-01-02T09:00:00Z";
  definition.scheduling.durations = [
    { stageId: "open.pools", contestMinutes: 15, turnaroundMinutes: 0 },
    { stageId: "open.main", contestMinutes: 15, turnaroundMinutes: 0 },
  ];
  definition.scheduling.constraints = [];
  definition.resources = [{ id: "courts", type: "court", quantity: 2,
    availability: [{ start: "2026-01-01T09:00:00Z", end: "2026-01-02T09:00:00Z" }] }];
  definition.operationalPolicies = [];
  definition.randomisation = { mode: "none" };
  definition.assumptions = [
    { id: "rule.qualification", rulePath: `/qualificationPolicies/${policy.id}`, origin: "explicit_prompt", knowledge: "KNOWN", sourceReference: "test", approved: true, critical: true },
    { id: "rule.standings", rulePath: "/standingsPolicies/table", origin: "explicit_prompt", knowledge: "KNOWN", sourceReference: "test", approved: true, critical: true },
  ];
  definition.requirements = [];
  return definition;
}

function compile(policy: QualificationPolicy): TournamentSpec {
  return compileDefinition(definitionWith(policy), {
    specId: "qualification-integration", revision: 1, schemaVersion: "1.0.0", compilerVersion: "1.0.0",
    rulesetVersions: { qualification: "1.0.0" }, sourcePrompt: "qualification integration", createdAt: "2026-01-01T00:00:00Z",
  }) as TournamentSpec;
}

function standing(id: string, rank: number, wins: number, played = 3): Standing {
  return {
    entrantId: id, poolId: "open.pools.P1", rank, played, wins, losses: played - wins, draws: 0,
    scoreFor: wins * 10, scoreAgainst: (played - wins) * 10, scoreDifference: (wins * 10) - ((played - wins) * 10),
    winningPercentage: wins / played, tieResolution: [],
  };
}

test("canonical ranking-points policy executes through the primary qualification path", () => {
  const policy = {
    id: "open.qualify", sourceStageId: "open.pools", destinationStructureId: "open.main.structure", outputCount: 2,
    selectors: [{ type: "ranking_points", metricKey: "wins", count: 2, cutoffTiePolicy: "candidate_id" }],
  } as never as QualificationPolicy;
  const spec = compile(policy);
  const validation = validateTournamentSpec(spec);
  assert.equal(validation.valid, true, JSON.stringify(validation.findings));
  const entrants = createEntrants(spec);
  const result = qualify(spec, { "open.pools": [
    standing("open.team.1", 1, 3), standing("open.team.2", 2, 2),
    standing("open.team.3", 3, 2), standing("open.team.4", 4, 0),
  ] }, entrants);
  assert.deepEqual(result.byStructure["open.main.structure"]?.map(({ id }) => id), ["open.team.1", "open.team.2"]);
  assert.equal(result.findings.length, 0);
  assert.equal(result.evidence[1]?.selector, "ranking_points");
  assert.match(result.policyProofs?.[0]?.proofHash ?? "", /^[a-f0-9]{64}$/);
  assert.equal(result.evidence.every(({ proofHash }) => proofHash === result.policyProofs?.[0]?.proofHash), true);
});

test("generic and score thresholds compile from canonical selector configuration", () => {
  for (const selector of [
    { type: "threshold", metric: { type: "value", key: "scoreDifference" }, comparison: "at_least", value: 0 },
    { type: "score_threshold", metricKey: "scoreFor", minimum: 20 },
  ]) {
    const policy = {
      id: `open.${selector.type}`, sourceStageId: "open.pools", destinationStructureId: "open.main.structure", outputCount: 2,
      selectors: [selector],
    } as never as QualificationPolicy;
    const spec = compile(policy);
    const validation = validateTournamentSpec(spec);
    assert.equal(validation.valid, true, `${selector.type}:${JSON.stringify(validation.findings)}`);
    const result = qualify(spec, { "open.pools": [
      standing("open.team.1", 1, 3), standing("open.team.2", 2, 2),
      standing("open.team.3", 3, 1), standing("open.team.4", 4, 0),
    ] }, createEntrants(spec));
    assert.deepEqual(result.byStructure["open.main.structure"]?.map(({ id }) => id), ["open.team.1", "open.team.2"]);
    assert.equal(result.findings.length, 0);
  }
});

test("percentage and elapsed-time selectors retain explicit metric semantics", () => {
  for (const selector of [
    { type: "percentage_threshold", numeratorMetricKey: "wins", denominatorMetricKey: "played", minimumPercent: 60 },
    { type: "elapsed_time", metricKey: "scoreAgainst", count: 2, cutoffTiePolicy: "reject" },
  ]) {
    const policy = {
      id: `open.${selector.type}`, sourceStageId: "open.pools", destinationStructureId: "open.main.structure", outputCount: 2,
      selectors: [selector],
    } as never as QualificationPolicy;
    const spec = compile(policy);
    const validation = validateTournamentSpec(spec);
    assert.equal(validation.valid, true, `${selector.type}:${JSON.stringify(validation.findings)}`);
    const result = qualify(spec, { "open.pools": [
      standing("open.team.1", 1, 3), standing("open.team.2", 2, 2),
      standing("open.team.3", 3, 1), standing("open.team.4", 4, 0),
    ] }, createEntrants(spec));
    assert.deepEqual(result.byStructure["open.main.structure"]?.map(({ id }) => id), ["open.team.1", "open.team.2"]);
    assert.equal(result.findings.length, 0);
  }
});

test("aggregate and best-N runner-up policies map metric expressions without sport branches", () => {
  const aggregate = {
    id: "open.aggregate", sourceStageId: "open.pools", destinationStructureId: "open.main.structure", outputCount: 2,
    selectors: [{ type: "aggregate_metric", metric: { type: "aggregate", reducer: "sum", terms: [
      { key: "wins", weight: 3 }, { key: "scoreDifference", weight: 1 },
    ] }, count: 2, direction: "higher", cutoffTiePolicy: "reject" }],
  } as never as QualificationPolicy;
  const aggregateSpec = compile(aggregate);
  assert.equal(validateTournamentSpec(aggregateSpec).valid, true);
  const aggregateResult = qualify(aggregateSpec, { "open.pools": [
    standing("open.team.1", 1, 3), standing("open.team.2", 2, 2),
    standing("open.team.3", 3, 1), standing("open.team.4", 4, 0),
  ] }, createEntrants(aggregateSpec));
  assert.deepEqual(aggregateResult.byStructure["open.main.structure"]?.map(({ id }) => id), ["open.team.1", "open.team.2"]);

  const runners = {
    id: "open.runners", sourceStageId: "open.pools", destinationStructureId: "open.main.structure", outputCount: 2,
    selectors: [{ type: "best_n", metric: { type: "value", key: "scoreFor" }, count: 2,
      direction: "higher", eligibleRank: 2, cutoffTiePolicy: "reject" }],
  } as never as QualificationPolicy;
  const runnersSpec = compile(runners);
  assert.equal(validateTournamentSpec(runnersSpec).valid, true);
  const runnerStandings = [
    { ...standing("open.team.1", 2, 3), poolId: "A" }, { ...standing("open.team.2", 2, 2), poolId: "B" },
    { ...standing("open.team.3", 2, 1), poolId: "C" }, { ...standing("open.team.4", 1, 0), poolId: "D" },
  ];
  const runnerResult = qualify(runnersSpec, { "open.pools": runnerStandings }, createEntrants(runnersSpec));
  assert.deepEqual(runnerResult.byStructure["open.main.structure"]?.map(({ id }) => id), ["open.team.1", "open.team.2"]);
  assert.equal(runnerResult.findings.length, 0);
});

test("approved wildcard and host selectors bind authority while remainder stays sequential", () => {
  const policyId = "open.authority";
  const authorityId = "selection-panel";
  const selectors = (["wildcard", "host"] as const).map((selectionType, selectorIndex) => {
    const candidateIds = [`open.team.${selectorIndex + 3}`];
    return {
      type: "authority_selection", selectionType, candidateIds,
      approval: { status: "approved", authorityId, approvalHash: hashQualificationAuthorityApproval({
        policyId, selectorIndex, selectionType: selectionType.toUpperCase() as "WILDCARD" | "HOST", candidateIds, authorityId,
      }) },
    };
  });
  const authority = {
    id: policyId, sourceStageId: "open.pools", destinationStructureId: "open.main.structure", outputCount: 2, selectors,
  } as never as QualificationPolicy;
  const authoritySpec = compile(authority);
  assert.equal(validateTournamentSpec(authoritySpec).valid, true);
  const standings = [
    standing("open.team.1", 1, 3), standing("open.team.2", 2, 2),
    standing("open.team.3", 3, 1), standing("open.team.4", 4, 0),
  ];
  const authorityResult = qualify(authoritySpec, { "open.pools": standings }, createEntrants(authoritySpec));
  assert.deepEqual(authorityResult.byStructure["open.main.structure"]?.map(({ id }) => id), ["open.team.3", "open.team.4"]);
  assert.deepEqual(authorityResult.evidence.map(({ authorityId: id }) => id), [authorityId, authorityId]);

  const remainder = {
    id: "open.remainder", sourceStageId: "open.pools", destinationStructureId: "open.main.structure", outputCount: 4,
    selectors: [
      { type: "score_threshold", metricKey: "wins", minimum: 3 },
      { type: "remainder" },
    ],
  } as never as QualificationPolicy;
  const remainderSpec = compile(remainder);
  assert.equal(validateTournamentSpec(remainderSpec).valid, true);
  const remainderResult = qualify(remainderSpec, { "open.pools": standings }, createEntrants(remainderSpec));
  assert.deepEqual(remainderResult.byStructure["open.main.structure"]?.map(({ id }) => id), [
    "open.team.1", "open.team.2", "open.team.3", "open.team.4",
  ]);
  assert.deepEqual(remainderResult.evidence.map(({ selectorIndex }) => selectorIndex), [0, 1, 1, 1]);
});

test("multiple policies append into one destination with stable global seeds", () => {
  const first = {
    id: "open.first", sourceStageId: "open.pools", destinationStructureId: "open.main.structure", outputCount: 1,
    selectors: [{ type: "score_threshold", metricKey: "wins", minimum: 3 }],
  } as never as QualificationPolicy;
  const second = {
    id: "open.second", sourceStageId: "open.pools", destinationStructureId: "open.main.structure", outputCount: 1,
    selectors: [{ type: "score_threshold", metricKey: "wins", minimum: 2 }],
  } as never as QualificationPolicy;
  const definition = definitionWith(first);
  definition.qualificationPolicies.push(second);
  definition.competitionStructures[0]!.targetEntrants = 2;
  definition.stages[1]!.expectedEntrants = 2;
  definition.stages[1]!.bracket!.entrantCount = 2;
  definition.assumptions.push({ id: "rule.second", rulePath: "/qualificationPolicies/open.second", origin: "explicit_prompt",
    knowledge: "KNOWN", sourceReference: "test", approved: true, critical: true });
  const spec = compileDefinition(definition, {
    specId: "qualification-append", revision: 1, schemaVersion: "1.0.0", compilerVersion: "1.0.0",
    rulesetVersions: { qualification: "1.0.0" }, sourcePrompt: "append", createdAt: "2026-01-01T00:00:00Z",
  }) as TournamentSpec;
  assert.equal(validateTournamentSpec(spec).valid, true);
  const result = qualify(spec, { "open.pools": [
    standing("open.team.1", 1, 3), standing("open.team.2", 2, 2),
    standing("open.team.3", 3, 1), standing("open.team.4", 4, 0),
  ] }, createEntrants(spec));
  assert.deepEqual(result.byStructure["open.main.structure"]?.map(({ id, seed }) => [id, seed]), [
    ["open.team.1", 1], ["open.team.2", 2],
  ]);
  assert.equal(result.policyProofs?.length, 2);
});

test("global exclusions are intersected with each source-stage candidate universe", () => {
  const first = {
    id: "open.source-a", sourceStageId: "open.pools", destinationStructureId: "open.main.structure", outputCount: 1,
    selectors: [{ type: "score_threshold", metricKey: "wins", minimum: 1 }],
  } as never as QualificationPolicy;
  const second = {
    id: "open.source-b", sourceStageId: "open.secondary", destinationStructureId: "open.main.structure", outputCount: 1,
    selectors: [{ type: "score_threshold", metricKey: "wins", minimum: 1 }],
  } as never as QualificationPolicy;
  const definition = definitionWith(first);
  definition.qualificationPolicies.push(second);
  definition.divisions[0]!.stageIds.splice(1, 0, "open.secondary");
  definition.stages.splice(1, 0, { ...structuredClone(definition.stages[0]!), id: "open.secondary", label: "Secondary" });
  definition.scoringSystems[0]!.stageIds.push("open.secondary");
  definition.scheduling.durations.push({ stageId: "open.secondary", contestMinutes: 15, turnaroundMinutes: 0 });
  definition.competitionStructures[0]!.targetEntrants = 2;
  definition.stages.at(-1)!.expectedEntrants = 2;
  definition.stages.at(-1)!.bracket!.entrantCount = 2;
  definition.assumptions.push({ id: "rule.source-b", rulePath: "/qualificationPolicies/open.source-b", origin: "explicit_prompt",
    knowledge: "KNOWN", sourceReference: "test", approved: true, critical: true });
  const spec = compileDefinition(definition, {
    specId: "qualification-sources", revision: 1, schemaVersion: "1.0.0", compilerVersion: "1.0.0",
    rulesetVersions: { qualification: "1.0.0" }, sourcePrompt: "sources", createdAt: "2026-01-01T00:00:00Z",
  }) as TournamentSpec;
  assert.equal(validateTournamentSpec(spec).valid, true);
  const result = qualify(spec, {
    "open.pools": [standing("open.team.1", 1, 3)],
    "open.secondary": [standing("open.team.2", 1, 3)],
  }, createEntrants(spec));
  assert.equal(result.findings.length, 0);
  assert.deepEqual(result.byStructure["open.main.structure"]?.map(({ id }) => id), ["open.team.1", "open.team.2"]);
});

test("cutoff tie policies reject ambiguity, deterministically break it, or explicitly include every tied candidate", () => {
  const standings = [
    standing("open.team.1", 1, 3), standing("open.team.2", 2, 2),
    standing("open.team.3", 2, 2), standing("open.team.4", 4, 0),
  ];
  const make = (cutoffTiePolicy: "reject" | "candidate_id" | "include_all", outputCount: number) => ({
    id: `open.tie-${cutoffTiePolicy}`, sourceStageId: "open.pools", destinationStructureId: "open.main.structure", outputCount,
    selectors: [{ type: "ranking_points", metricKey: "wins", count: 2, cutoffTiePolicy }],
  }) as never as QualificationPolicy;

  const rejectedSpec = compile(make("reject", 2));
  assert.equal(validateTournamentSpec(rejectedSpec).valid, true);
  const rejected = qualify(rejectedSpec, { "open.pools": standings }, createEntrants(rejectedSpec));
  assert.deepEqual(rejected.byStructure["open.main.structure"], []);
  assert.deepEqual(rejected.policyProofs, []);
  assert.equal(rejected.findings.some(({ code }) => code === "TSC804"), true);

  const deterministicSpec = compile(make("candidate_id", 2));
  const deterministic = qualify(deterministicSpec, { "open.pools": standings }, createEntrants(deterministicSpec));
  assert.deepEqual(deterministic.byStructure["open.main.structure"]?.map(({ id }) => id), ["open.team.1", "open.team.2"]);

  const includeAllSpec = compile(make("include_all", 3));
  const includeAllValidation = validateTournamentSpec(includeAllSpec);
  assert.equal(includeAllValidation.valid, true, JSON.stringify(includeAllValidation.findings));
  const includeAll = qualify(includeAllSpec, { "open.pools": standings }, createEntrants(includeAllSpec));
  assert.deepEqual(includeAll.byStructure["open.main.structure"]?.map(({ id }) => id), ["open.team.1", "open.team.2", "open.team.3"]);
});

test("authority tampering, unavailable metrics, and incompatible selector families fail closed", () => {
  const policyId = "open.tampered";
  const tampered = {
    id: policyId, sourceStageId: "open.pools", destinationStructureId: "open.main.structure", outputCount: 2,
    selectors: [{ type: "authority_selection", selectionType: "wildcard", candidateIds: ["open.team.1", "open.team.2"],
      approval: { status: "approved", authorityId: "panel", approvalHash: "0".repeat(64) } }],
  } as never as QualificationPolicy;
  const tamperedSpec = compile(tampered);
  const tamperedValidation = validateTournamentSpec(tamperedSpec);
  assert.equal(tamperedValidation.findings.some(({ code }) => code === "TSC227"), true, JSON.stringify(tamperedValidation.findings));
  const tamperedResult = qualify(tamperedSpec, { "open.pools": [standing("open.team.1", 1, 3), standing("open.team.2", 2, 2)] }, createEntrants(tamperedSpec));
  assert.deepEqual(tamperedResult.byStructure["open.main.structure"], []);
  assert.equal(tamperedResult.findings.some(({ code }) => code === "TSC804"), true);

  const missingMetric = {
    id: "open.missing-metric", sourceStageId: "open.pools", destinationStructureId: "open.main.structure", outputCount: 1,
    selectors: [{ type: "ranking_points", metricKey: "metricThatDoesNotExist", count: 1, cutoffTiePolicy: "reject" }],
  } as never as QualificationPolicy;
  const missingMetricSpec = compile(missingMetric);
  const missingMetricResult = qualify(missingMetricSpec, { "open.pools": [standing("open.team.1", 1, 3)] }, createEntrants(missingMetricSpec));
  assert.deepEqual(missingMetricResult.byStructure["open.main.structure"], []);
  assert.equal(missingMetricResult.findings.some(({ code }) => code === "TSC804"), true);

  const mixed = {
    id: "open.mixed", sourceStageId: "open.pools", destinationStructureId: "open.main.structure", outputCount: 2,
    selectors: [
      { type: "ranking_points", metricKey: "wins", count: 1, cutoffTiePolicy: "reject" },
      { type: "top_n", count: 1 },
    ],
  } as never as QualificationPolicy;
  const mixedSpec = compile(mixed);
  assert.equal(validateTournamentSpec(mixedSpec).findings.some(({ code }) => code === "TSC226"), true);
  assert.doesNotThrow(() => qualify(mixedSpec, { "open.pools": [standing("open.team.1", 1, 3)] }, createEntrants(mixedSpec)));
  assert.deepEqual(qualify(mixedSpec, { "open.pools": [standing("open.team.1", 1, 3)] }, createEntrants(mixedSpec)).byStructure["open.main.structure"], []);
});

test("a later policy failure rolls back the entire shared destination without partial evidence", () => {
  const first = {
    id: "open.success", sourceStageId: "open.pools", destinationStructureId: "open.main.structure", outputCount: 1,
    selectors: [{ type: "score_threshold", metricKey: "wins", minimum: 3 }],
  } as never as QualificationPolicy;
  const second = {
    id: "open.failure", sourceStageId: "open.pools", destinationStructureId: "open.main.structure", outputCount: 1,
    selectors: [{ type: "score_threshold", metricKey: "wins", minimum: 99 }],
  } as never as QualificationPolicy;
  const definition = definitionWith(first);
  definition.qualificationPolicies.push(second);
  definition.competitionStructures[0]!.targetEntrants = 2;
  definition.stages[1]!.expectedEntrants = 2;
  definition.stages[1]!.bracket!.entrantCount = 2;
  definition.assumptions.push({ id: "rule.failure", rulePath: "/qualificationPolicies/open.failure", origin: "explicit_prompt",
    knowledge: "KNOWN", sourceReference: "test", approved: true, critical: true });
  const spec = compileDefinition(definition, {
    specId: "qualification-rollback", revision: 1, schemaVersion: "1.0.0", compilerVersion: "1.0.0",
    rulesetVersions: { qualification: "1.0.0" }, sourcePrompt: "rollback", createdAt: "2026-01-01T00:00:00Z",
  }) as TournamentSpec;
  assert.equal(validateTournamentSpec(spec).valid, true);
  const result = qualify(spec, { "open.pools": [
    standing("open.team.1", 1, 3), standing("open.team.2", 2, 2),
    standing("open.team.3", 3, 1), standing("open.team.4", 4, 0),
  ] }, createEntrants(spec));
  assert.deepEqual(result.byStructure["open.main.structure"], []);
  assert.deepEqual(result.evidence, []);
  assert.deepEqual(result.policyProofs, []);
  assert.equal(result.findings.some(({ code }) => code === "TSC804"), true);
});

test("schema/config mismatches are rejected before execution", () => {
  const compiled = compile({
    id: "open.schema", sourceStageId: "open.pools", destinationStructureId: "open.main.structure", outputCount: 1,
    selectors: [{ type: "ranking_points", metricKey: "wins", count: 1, cutoffTiePolicy: "reject" }],
  } as never as QualificationPolicy);
  const spec = structuredClone(compiled);
  delete (spec.qualificationPolicies[0]!.selectors[0] as unknown as { metricKey?: string }).metricKey;
  const validation = validateTournamentSpec(spec);
  assert.equal(validation.valid, false);
  assert.equal(validation.findings.some(({ code }) => code === "TSC000"), true);
});
