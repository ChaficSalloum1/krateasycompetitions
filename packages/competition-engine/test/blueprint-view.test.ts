import assert from "node:assert/strict";
import test from "node:test";
import type { ScenarioResult } from "../src/types.js";
import { buildBlueprintView } from "../src/blueprint-view.js";

function scenario(): ScenarioResult {
  return {
    spec: {
      metadata: { specId: "demo", revision: 2, schemaVersion: "1", compilerVersion: "1", rulesetVersions: { padel: "2026" },
        sourcePromptHash: "source-hash", compiledSpecHash: "spec-hash", createdAt: "2026-09-05T09:00:00.000Z" },
      sport: { id: "padel", adapterVersion: "1", participantUnit: "pair", teamSize: 2, contest: { kind: "head_to_head", sides: 2 }, scoringCapabilities: [], defaultResourceType: "court" },
      participants: { count: 2, shape: "pair" },
      divisions: [{ id: "open", label: "Open", participantCount: 2, participantShape: "pair", stageIds: ["final"] }],
      stages: [{ id: "final", label: "Final", divisionId: "open", primitive: "single_elimination", inputShape: "pair", outputShape: "pair", expectedEntrants: 2, bracket: { entrantCount: 2, topology: "power_of_two", thirdPlaceMatch: false } }],
      scoringSystems: [{ id: "score", adapterRule: "padel", version: "2026", stageIds: ["final"] }],
      standingsPolicies: [], qualificationPolicies: [],
      competitionStructures: [{ id: "main", label: "Main draw", divisionId: "open", targetEntrants: 2, stageIds: ["final"] }],
      drawPolicies: [], progressionPolicies: [],
      scheduling: { timezone: "UTC", start: "2026-09-05T10:00:00.000Z", finishBy: "2026-09-05T12:00:00.000Z",
        constraints: [{ id: "rest", rule: "minimum_rest", strength: "HARD", value: 15, unit: "minutes" }],
        durations: [{ stageId: "final", round: "final", contestMinutes: 30, turnaroundMinutes: 5 }], objective: "earliest_finish" },
      resources: [{ id: "court", type: "court", quantity: 1, availability: [{ start: "2026-09-05T10:00:00.000Z", end: "2026-09-05T12:00:00.000Z" }] }],
      operationalPolicies: [{ id: "minimum", rule: "minimum_total_matches", strength: "HARD", value: 1 }],
      randomisation: { mode: "deterministic", algorithm: "xoshiro128ss", seed: "seed" },
      assumptions: [{ id: "A1", rulePath: "/scheduling/constraints/rest", origin: "organisation_default", knowledge: "DEFAULTED", sourceReference: "rules:2026", approved: true, critical: true }],
      requirements: [{ id: "R1", sourceText: "Finish by noon", type: "schedule", strength: "HARD", status: "SATISFIED", mappedRuleIds: ["rest"], resolutionNote: "Validated" }],
    },
    graph: { specHash: "spec-hash", expectedActualContestCount: 1, generatedActualContestCount: 1,
      nodes: [{ id: "M1", stageId: "final", divisionId: "open", round: "final", roundIndex: 1, index: 1, kind: "contest",
        slots: [{ type: "entrant", entrantId: "A" }, { type: "entrant", entrantId: "B" }], requiredResourceType: "court" }], edges: [],
      findings: [{ code: "W1", severity: "WARNING", path: "/graph", message: "Graph warning" }] },
    schedule: { contests: [{ contestId: "M1", resourceId: "court.1", start: "2026-09-05T10:00:00.000Z", end: "2026-09-05T10:35:00.000Z", possibleEntrantIds: ["A", "B"] }],
      audit: { solver: "exact", version: "1", status: "FEASIBLE", objective: "earliest_finish", objectiveValueMinutes: 35, lowerBoundMinutes: 30, optimalityGap: 1 / 7, scheduleHash: "schedule-hash", validationHash: "validation-hash" },
      findings: [{ code: "E1", severity: "ERROR", path: "/schedule", message: "Schedule error" }] },
    simulation: { seed: "seed", results: [{ contestId: "M1", entrants: ["A", "B"], winnerId: "A", loserId: "B", scoreFor: [6, 4], status: "completed" }],
      completedContestCount: 1, unresolvedDependencies: [], hash: "simulation-hash" },
    certification: { status: "REJECTED", specHash: "spec-hash", graphHash: "graph-hash", scheduleHash: "schedule-hash", simulationHash: "simulation-hash",
      findings: [{ code: "W1", severity: "WARNING", path: "/graph", message: "Graph warning" }, { code: "E1", severity: "ERROR", path: "/schedule", message: "Schedule error" }],
      requirementCoverage: [{ id: "R1", status: "SATISFIED" }], statement: "Rejected", certificationHash: "certification-hash" },
  };
}

test("surfaces summary status and every finding with accessible labels", () => {
  const view = buildBlueprintView(scenario());
  assert.equal(view.summary.certificationStatus, "REJECTED");
  assert.equal(view.summary.actionRequired, true);
  assert.equal(view.findings.errors.length, 1);
  assert.equal(view.findings.warnings.length, 1);
  assert.equal(view.findings.all.length, 2);
  assert.ok(view.findings.all.every(({ accessibilityLabel, hidden }) => accessibilityLabel.length > 0 && hidden === false));
});

test("presents rules, assumptions, and requirement coverage without dropping provenance", () => {
  const governance = buildBlueprintView(scenario()).governance;
  for (const id of ["final", "minimum", "rest", "score", "randomisation", "duration:final:final:0"]) {
    assert.ok(governance.rules.some((rule) => rule.id === id), `missing organiser-facing rule ${id}`);
  }
  assert.deepEqual(governance.assumptions[0], {
    id: "A1", path: "/scheduling/constraints/rest", knowledge: "DEFAULTED", origin: "organisation_default",
    approved: true, critical: true, sourceReference: "rules:2026",
    accessibilityLabel: "Critical defaulted assumption A1, approved.", debugId: "debug-assumption-A1",
  });
  assert.equal(governance.requirementCoverage[0]!.status, "SATISFIED");
  assert.equal(governance.requirementCoverage[0]!.sourceText, "Finish by noon");
  assert.deepEqual(governance.requirementCoverage[0]!.mappedRuleIds, ["rest"]);
  assert.match(governance.requirementCoverage[0]!.accessibilityLabel, /Requirement R1 is satisfied/);
});

test("builds graph paths, schedule timeline/utilisation, dry-run metrics, and navigable proofs", () => {
  const view = buildBlueprintView(scenario());
  assert.equal(view.graph.nodes[0]!.accessibilityLabel, "Contest M1, final, Entrant A versus Entrant B.");
  assert.deepEqual(view.graph.participantPaths.map(({ entrantId, minimumContests, maximumContests }) =>
    ({ entrantId, minimumContests, maximumContests })), [
    { entrantId: "A", minimumContests: 1, maximumContests: 1 },
    { entrantId: "B", minimumContests: 1, maximumContests: 1 },
  ]);
  assert.equal(view.schedule.timeline[0]!.durationMinutes, 35);
  assert.deepEqual(view.schedule.utilisation.map(({ resourceId, busyMinutes, availableMinutes, ratio }) =>
    ({ resourceId, busyMinutes, availableMinutes, ratio })), [
    { resourceId: "court.1", busyMinutes: 35, availableMinutes: 120, ratio: 35 / 120 },
  ]);
  assert.equal(view.dryRun.completionRate, 1);
  assert.deepEqual(view.dryRun.unresolvedDependencies, []);
  assert.deepEqual(view.proofs.map(({ kind }) => kind), ["spec", "graph", "schedule", "validation", "simulation", "certification"]);
  assert.ok(view.proofs.every(({ id, href, label }) => href === `#${id}` && label.length > 0));
  assert.deepEqual(buildBlueprintView(scenario()), view);
  assert.ok(Object.isFrozen(view));
  assert.ok(Object.isFrozen(view.graph.nodes));
});
