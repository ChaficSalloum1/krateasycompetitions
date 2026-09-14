import assert from "node:assert/strict";
import test from "node:test";
import { playAndKonnectDefinition } from "../examples/play-and-konnect.js";
import {
  applyRevision,
  canonicalHash,
  compileDefinition,
  planRevision,
  semanticDiff,
  validateTournamentSpec,
  type TournamentDefinition,
} from "../src/index.js";

const context = {
  specId: "play-and-konnect.2026", revision: 1, schemaVersion: "1.0.0", compilerVersion: "0.1.0",
  rulesetVersions: { padel: "1.0.0", competition: "1.0.0" }, sourcePrompt: "47 padel pairs...",
  createdAt: "2026-09-05T09:00:00Z",
};

const clone = (): TournamentDefinition => structuredClone(playAndKonnectDefinition);

test("Play & Konnect is representable without engine-specific branches", () => {
  const spec = compileDefinition(clone(), context);
  const result = validateTournamentSpec(spec);
  assert.equal(result.valid, true, JSON.stringify(result.findings, null, 2));
  assert.ok(result.findings.some(({ code }) => code === "TSW210"));
});

test("canonical hashes ignore object key insertion order", () => {
  assert.equal(canonicalHash({ b: 2, a: { d: 4, c: 3 } }), canonicalHash({ a: { c: 3, d: 4 }, b: 2 }));
});

test("tampering is rejected by the replay hash", () => {
  const spec = structuredClone(compileDefinition(clone(), context));
  spec.participants.count = 48;
  const result = validateTournamentSpec(spec);
  assert.ok(result.findings.some(({ code }) => code === "TSC630"));
});

test("qualification and bracket cardinality are independently checked", () => {
  const definition = clone();
  definition.competitionStructures[0]!.targetEntrants = 8;
  const result = validateTournamentSpec(compileDefinition(definition, context));
  assert.ok(result.findings.some(({ code }) => code === "TSC221"));
});

test("selector cardinality is independently re-derived", () => {
  const definition = clone();
  definition.qualificationPolicies[0]!.outputCount = 5;
  const result = validateTournamentSpec(compileDefinition(definition, context));
  assert.ok(result.findings.some(({ code }) => code === "TSC222"));
});

test("minimum participation is proven from the smallest pool path", () => {
  const definition = clone();
  definition.operationalPolicies.find(({ rule }) => rule === "minimum_group_matches")!.strength = "HARD";
  const result = validateTournamentSpec(compileDefinition(definition, context));
  assert.ok(result.findings.some(({ code }) => code === "TSC104"));
});

test("unequal-pool comparisons fail closed without normalization", () => {
  const definition = clone();
  delete definition.qualificationPolicies[0]!.normalization;
  const result = validateTournamentSpec(compileDefinition(definition, context));
  assert.ok(result.findings.some(({ code }) => code === "TSC224"));
});

test("critical policies cannot silently lose provenance", () => {
  const definition = clone();
  definition.assumptions = definition.assumptions.filter(({ rulePath }) => rulePath !== "/qualificationPolicies/advanced.qual.main");
  const result = validateTournamentSpec(compileDefinition(definition, context));
  assert.ok(result.findings.some(({ code }) => code === "TSC601"));
});

test("lost user requirements prevent certification", () => {
  const definition = clone();
  definition.requirements[0]!.mappedRuleIds = [];
  const result = validateTournamentSpec(compileDefinition(definition, context));
  assert.ok(result.findings.some(({ code }) => code === "TSC611"));
});

test("random draw requires a pinned deterministic policy", () => {
  const definition = clone();
  definition.drawPolicies[0]!.placement = "random";
  const result = validateTournamentSpec(compileDefinition(definition, context));
  assert.ok(result.findings.some(({ code }) => code === "TSC620"));
});

test("undefined loser-from-bye paths are rejected before graph generation", () => {
  const definition = clone();
  definition.progressionPolicies.push({
    id: "bad.loser.path", fromStageId: "advanced.consolation", outcome: "loser",
    toStageId: "advanced.main", destinationSlots: 1, sourceCanBeBye: true,
  });
  definition.assumptions.push({
    id: "rule.bad.loser.path", rulePath: "/progressionPolicies/bad.loser.path", origin: "manual_override",
    knowledge: "KNOWN", sourceReference: "test-fixture", approved: true, critical: true,
  });
  const result = validateTournamentSpec(compileDefinition(definition, context));
  assert.ok(result.findings.some(({ code }) => code === "TSC225"));
});

test("progression cycles are rejected", () => {
  const definition = clone();
  definition.progressionPolicies.push(
    { id: "cycle.a", fromStageId: "advanced.main", outcome: "winner", toStageId: "advanced.consolation", destinationSlots: 1, sourceCanBeBye: false },
    { id: "cycle.b", fromStageId: "advanced.consolation", outcome: "winner", toStageId: "advanced.main", destinationSlots: 1, sourceCanBeBye: false },
  );
  definition.assumptions.push(
    { id: "rule.cycle.a", rulePath: "/progressionPolicies/cycle.a", origin: "manual_override", knowledge: "KNOWN", sourceReference: "test-fixture", approved: true, critical: true },
    { id: "rule.cycle.b", rulePath: "/progressionPolicies/cycle.b", origin: "manual_override", knowledge: "KNOWN", sourceReference: "test-fixture", approved: true, critical: true },
  );
  const result = validateTournamentSpec(compileDefinition(definition, context));
  assert.ok(result.findings.some(({ code }) => code === "TSC302"));
});

test("semantic diff exposes only the changed formal value", () => {
  const before = clone();
  const after = clone();
  after.scheduling.durations.find(({ stageId, round }) => stageId === "advanced.main" && round === "final")!.contestMinutes = 65;
  assert.deepEqual(semanticDiff(before, after), [{
    operation: "replace", path: "/scheduling/durations/10/contestMinutes", before: 55, after: 65,
  }]);
});

test("Plan -> Validate -> Apply creates an immutable linked revision", () => {
  const current = compileDefinition(clone(), context);
  const proposed = clone();
  proposed.scheduling.objective = "balanced_quality";
  const plan = planRevision(current as never, proposed, {
    ...context, revision: 2, sourcePrompt: "Balance schedule quality", createdAt: "2026-09-05T09:05:00Z",
    previousSpecHash: current.metadata.compiledSpecHash,
  });
  assert.equal(plan.status, "VALID");
  assert.deepEqual(plan.changes, [{ operation: "replace", path: "/scheduling/objective", before: "earliest_finish", after: "balanced_quality" }]);
  const applied = applyRevision(plan as never);
  assert.equal(applied.metadata.revision, 2);
  assert.equal(applied.metadata.previousSpecHash, current.metadata.compiledSpecHash);
  assert.equal(Object.isFrozen(applied), true);
});
