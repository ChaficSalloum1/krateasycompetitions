import assert from "node:assert/strict";
import test from "node:test";
import { canonicalStringify, compileDefinition, type TournamentSpec } from "@tournament-os/tournament-schema";
import { playAndKonnectDefinition } from "@tournament-os/tournament-schema/example";
import { createEntrants } from "../src/graph.js";
import { runScenario } from "../src/scenario.js";
import { compareScenarios } from "../src/scenario-comparison.js";
import type { ScenarioResult } from "../src/types.js";

const context = (revision: number, previousSpecHash?: string) => ({
  specId: "comparison.test",
  revision,
  schemaVersion: "1.0.0",
  compilerVersion: "0.1.0",
  rulesetVersions: { padel: "1.0.0" },
  sourcePrompt: `revision ${revision}`,
  createdAt: `2026-09-05T${String(8 + revision).padStart(2, "0")}:00:00Z`,
  ...(previousSpecHash ? { previousSpecHash } : {}),
});

const scenarios = (): { baseline: ScenarioResult; candidate: ScenarioResult } => {
  const baselineSpec = compileDefinition(structuredClone(playAndKonnectDefinition), context(1)) as TournamentSpec;
  const candidateDefinition = structuredClone(playAndKonnectDefinition);
  candidateDefinition.resources[0]!.quantity = 6;
  const candidateSpec = compileDefinition(candidateDefinition, context(2, baselineSpec.metadata.compiledSpecHash)) as TournamentSpec;
  return {
    baseline: runScenario(baselineSpec, createEntrants(baselineSpec), "comparison"),
    candidate: runScenario(candidateSpec, createEntrants(candidateSpec), "comparison"),
  };
};

test("comparison is deterministic, read-only, and separates formal changes from unaffected rules", () => {
  const { baseline, candidate } = scenarios();
  const beforeBaseline = canonicalStringify(baseline);
  const beforeCandidate = canonicalStringify(candidate);

  const first = compareScenarios(baseline, candidate);
  const replay = compareScenarios(baseline, candidate);

  assert.ok(first.formalChanges.some(({ path }) => path === "/resources/0/quantity"));
  assert.equal(first.unaffectedRuleGroups.includes("resources"), false);
  assert.equal(first.unaffectedRuleGroups.includes("sport"), true);
  assert.equal(first.comparisonHash, replay.comparisonHash);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(canonicalStringify(baseline), beforeBaseline);
  assert.equal(canonicalStringify(candidate), beforeCandidate);
});

test("feasibility, finish, lower-bound gap, cardinality, and guarantees are comparable", () => {
  const { baseline, candidate } = scenarios();
  const comparison = compareScenarios(baseline, candidate);

  assert.equal(comparison.metrics.baseline.solverStatus, baseline.schedule.audit.status);
  assert.equal(comparison.metrics.candidate.scheduledContestCount, candidate.schedule.contests.length);
  assert.equal(comparison.metrics.candidate.generatedContestCount, candidate.graph.generatedActualContestCount);
  assert.equal(comparison.metrics.candidate.lowerBoundGapMinutes,
    comparison.metrics.candidate.objectiveMinutes! - comparison.metrics.candidate.lowerBoundMinutes);
  assert.match(comparison.metrics.candidate.finish ?? "", /^2026-/);
  assert.equal(comparison.participantGuarantees.baseline.entrantCount, 47);
  assert.equal(comparison.participantGuarantees.changes.length, 47);
  assert.equal(comparison.approval.requiresExplicitApproval, true);
});

test("findings added by the candidate and resolved from the baseline are separated", () => {
  const pair = scenarios();
  const baseline = structuredClone(pair.baseline);
  const candidate = structuredClone(pair.candidate);
  baseline.certification.findings.push({ code: "OLD001", severity: "WARNING", path: "/old", message: "Old concern." });
  candidate.certification.findings.push({ code: "NEW001", severity: "WARNING", path: "/new", message: "New concern." });
  const comparison = compareScenarios(baseline, candidate);

  assert.ok(comparison.findings.added.some(({ code }) => code === "NEW001"));
  assert.ok(comparison.findings.resolved.some(({ code }) => code === "OLD001"));
});

test("participant guarantee regressions identify entrants and retain counterexample paths", () => {
  const pair = scenarios();
  const candidate = structuredClone(pair.candidate);
  const removed = candidate.graph.nodes.find(({ poolId, slots }) => poolId?.startsWith("advanced") && slots.some((slot) => slot.type === "entrant" && slot.entrantId === "advanced.team.1"))!;
  candidate.graph.nodes = candidate.graph.nodes.filter(({ id }) => id !== removed.id);
  candidate.graph.edges = candidate.graph.edges.filter(({ fromContestId, toContestId }) => fromContestId !== removed.id && toContestId !== removed.id);
  candidate.graph.generatedActualContestCount -= 1;
  candidate.graph.expectedActualContestCount -= 1;
  candidate.schedule.contests = candidate.schedule.contests.filter(({ contestId }) => contestId !== removed.id);
  const comparison = compareScenarios(pair.baseline, candidate);

  assert.ok(comparison.participantGuarantees.regressedEntrantIds.includes("advanced.team.1"));
  assert.ok(comparison.participantGuarantees.changes.find(({ entrantId }) => entrantId === "advanced.team.1")!.counterexample.length > 0);
});

test("lineage, feasibility, certification, cardinality, errors, and unresolved requirements block approval", () => {
  const pair = scenarios();
  const candidate = structuredClone(pair.candidate);
  candidate.spec.metadata.previousSpecHash = "0".repeat(64);
  candidate.schedule.audit.status = "INFEASIBLE";
  candidate.certification.status = "REJECTED";
  candidate.graph.generatedActualContestCount -= 1;
  candidate.certification.findings.push({ code: "BROKEN", severity: "ERROR", path: "/candidate", message: "Broken candidate." });
  candidate.spec.requirements[0]!.status = "UNRESOLVED";
  const comparison = compareScenarios(pair.baseline, candidate);

  assert.equal(comparison.approval.canApprove, false);
  assert.deepEqual(comparison.approval.blockingReasons.map(({ code }) => code), ["SCN101", "SCN102", "SCN103", "SCN104", "SCN105", "SCN106", "SCN109"]);
});
