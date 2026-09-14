import assert from "node:assert/strict";
import test from "node:test";
import {
  compileApprovedStaticStage,
  hashStaticStagePlan,
  type StaticStagePlan,
} from "../src/static-stage-compiler.js";
import { simulateGraph } from "../src/simulation.js";
import type { CompetitionGraph, Entrant } from "../src/types.js";

const entrants = (count: number, divisionId = "open"): Entrant[] => Array.from({ length: count }, (_, index) => ({
  id: `${divisionId}.entrant.${index + 1}`,
  divisionId,
  memberIds: [`member.${index + 1}`],
  seed: index + 1,
}));

const approved = (plan: StaticStagePlan) => ({
  plan,
  approval: { status: "APPROVED" as const, authority: "competition-director", approvedPlanHash: hashStaticStagePlan(plan) },
});

test("an approved round-robin plan maps stable seed identities into canonical contest nodes", () => {
  const plan: StaticStagePlan = {
    id: "open.league",
    divisionId: "open",
    primitive: "single_round_robin",
    requiredResourceType: "court",
    entrants: [entrants(4)[2]!, entrants(4)[0]!, entrants(4)[3]!, entrants(4)[1]!],
  };
  const result = compileApprovedStaticStage(approved(plan));

  assert.equal(result.status, "COMPILED");
  assert.equal(result.nodes.length, 6);
  assert.equal(result.edges.length, 0);
  assert.equal(result.expectedActualContestCount, 6);
  assert.equal(result.generatedActualContestCount, 6);
  assert.equal(result.proof.valid, true);
  assert.equal(result.proof.allEntrantIdentitiesMapped, true);
  assert.equal(result.proof.edgeSlotClosure, true);
  assert.deepEqual(new Set(result.nodes.flatMap(({ slots }) => slots.flatMap((slot) => slot.type === "entrant" ? [slot.entrantId] : []))),
    new Set(entrants(4).map(({ id }) => id)));
  assert.ok(result.nodes.every(({ stageId, divisionId, requiredResourceType, poolId }) =>
    stageId === plan.id && divisionId === "open" && requiredResourceType === "court" && poolId === "open.league.P1"));
  assert.match(result.proof.proofHash, /^[a-f0-9]{64}$/);
  assert.ok(Object.isFrozen(result));
});

test("single-elimination and consolation reuse canonical bye topology without manufacturing loser paths", () => {
  for (const [primitive, count] of [["single_elimination", 5], ["consolation", 4]] as const) {
    const plan: StaticStagePlan = {
      id: `open.${primitive}`,
      divisionId: "open",
      primitive,
      requiredResourceType: "court",
      entrants: entrants(count),
    };
    const result = compileApprovedStaticStage(approved(plan));
    assert.equal(result.status, "COMPILED");
    assert.equal(result.generatedActualContestCount, count - 1);
    assert.equal(result.expectedActualContestCount, count - 1);
    assert.equal(result.proof.noLoserFromBye, true);
    assert.equal(result.proof.edgeSlotClosure, true);
    assert.equal(result.proof.acyclic, true);
    assert.equal(result.nodes.filter(({ kind }) => kind === "bye").length, primitive === "single_elimination" ? 3 : 0);
    const byeIds = new Set(result.nodes.filter(({ kind }) => kind === "bye").map(({ id }) => id));
    assert.ok(result.edges.filter(({ fromContestId }) => byeIds.has(fromContestId)).every(({ outcome }) => outcome === "winner"));
    assert.ok(result.nodes.every(({ slots }) => slots.every((slot) => slot.type !== "loser" || !byeIds.has(slot.contestId))));
  }
});

test("double elimination and repechage adapt their existing explicit outcome graphs", () => {
  const doublePlan: StaticStagePlan = {
    id: "open.double",
    divisionId: "open",
    primitive: "double_elimination",
    resetFinalPolicy: "NEVER",
    requiredResourceType: "court",
    entrants: entrants(8),
  };
  const double = compileApprovedStaticStage(approved(doublePlan));
  assert.equal(double.status, "COMPILED");
  assert.equal(double.generatedActualContestCount, 14);
  assert.equal(double.nodes.filter(({ id }) => id.includes(".W.")).length, 7);
  assert.equal(double.edges.filter(({ outcome, fromContestId }) => outcome === "loser" && fromContestId.includes(".W.")).length, 7);
  assert.equal(double.proof.edgeSlotClosure, true);
  assert.equal(double.proof.acyclic, true);

  const repechagePlan: StaticStagePlan = {
    id: "open.repechage",
    divisionId: "open",
    primitive: "repechage",
    requiredResourceType: "mat",
    entrants: entrants(8),
  };
  const repechage = compileApprovedStaticStage(approved(repechagePlan));
  assert.equal(repechage.status, "COMPILED");
  assert.equal(repechage.generatedActualContestCount, 11);
  assert.equal(repechage.nodes.filter(({ id }) => id.includes(".REP.")).length, 2);
  assert.equal(repechage.nodes.filter(({ id }) => id.includes(".CLASS.")).length, 2);
  assert.deepEqual(repechage.proof.scaleEnvelope.testedEntrantRanges, {
    singleRoundRobin: "2-64",
    doubleRoundRobin: "2-64",
    singleElimination: "2-64",
    consolation: "2-64",
    doubleElimination: "POWER_OF_TWO_2-64",
    repechage: "POWER_OF_TWO_8-64",
  });
});

test("approval, entrant identity, and cardinality fail closed while conditional semantics stay explicit", () => {
  const base: StaticStagePlan = {
    id: "open.main", divisionId: "open", primitive: "single_elimination",
    requiredResourceType: "court", entrants: entrants(8),
  };
  const staleApproval = approved(base).approval;
  const changedPlan: StaticStagePlan = { ...base, requiredResourceType: "show-court" };
  const changed = compileApprovedStaticStage({ plan: changedPlan, approval: staleApproval });
  assert.equal(changed.status, "REJECTED");
  assert.ok(changed.findings.some(({ code }) => code === "TSS007"));

  const duplicateSeeds: StaticStagePlan = {
    ...base,
    entrants: entrants(8).map((entrant, index) => index === 7 ? { ...entrant, seed: 1 } : entrant),
  };
  const identityRejected = compileApprovedStaticStage(approved(duplicateSeeds));
  assert.equal(identityRejected.status, "REJECTED");
  assert.ok(identityRejected.findings.some(({ code }) => code === "TSS005"));

  const conditional: StaticStagePlan = {
    ...base, primitive: "double_elimination", resetFinalPolicy: "IF_NECESSARY",
  };
  const conditionalCompiled = compileApprovedStaticStage(approved(conditional));
  assert.equal(conditionalCompiled.status, "COMPILED");
  assert.equal(conditionalCompiled.conditionalContestCount, 1);
  assert.equal(conditionalCompiled.minimumActualContestCount, 14);
  assert.equal(conditionalCompiled.maximumActualContestCount, 15);
  assert.deepEqual(conditionalCompiled.nodes.find(({ id }) => id === "open.main.GF2")?.condition, {
    type: "SOURCE_SLOT_WON", sourceContestId: "open.main.GF1", sourceSlot: 1,
  });
  assert.equal(conditionalCompiled.proof.conditionalSemanticsClosed, true);

  const graph: CompetitionGraph = {
    specHash: "conditional-static-stage",
    nodes: [...conditionalCompiled.nodes],
    edges: [...conditionalCompiled.edges],
    expectedActualContestCount: conditionalCompiled.expectedActualContestCount,
    generatedActualContestCount: conditionalCompiled.generatedActualContestCount,
    findings: [],
  };
  const runs = Array.from({ length: 20 }, (_, index) => simulateGraph(graph, `reset-path-${index}`));
  assert.deepEqual([...new Set(runs.map(({ completedContestCount }) => completedContestCount))].sort(), [14, 15]);
  for (const run of runs) {
    const firstFinal = run.results.find(({ contestId }) => contestId === "open.main.GF1")!;
    const resetWasRequired = firstFinal.winnerId === firstFinal.entrants[1];
    assert.equal(run.results.some(({ contestId }) => contestId === "open.main.GF2"), resetWasRequired);
    assert.equal(run.skippedConditionalContestIds?.includes("open.main.GF2"), !resetWasRequired);
    assert.deepEqual(run.unresolvedDependencies, []);
  }

  const unsupportedDouble: StaticStagePlan = {
    ...base, primitive: "double_elimination", resetFinalPolicy: "NEVER", entrants: entrants(6),
  };
  const cardinalityRejected = compileApprovedStaticStage(approved(unsupportedDouble));
  assert.equal(cardinalityRejected.status, "REJECTED");
  assert.ok(cardinalityRejected.findings.some(({ code }) => code === "TSS009"));
});

test("every advertised entrant envelope compiles with closed proofs and deterministic replay", () => {
  for (let count = 2; count <= 64; count += 1) {
    for (const primitive of ["single_round_robin", "double_round_robin", "single_elimination", "consolation"] as const) {
      const plan: StaticStagePlan = {
        id: `${primitive}.${count}`, divisionId: "open", primitive,
        requiredResourceType: "field", entrants: entrants(count),
      };
      const first = compileApprovedStaticStage(approved(plan));
      const replay = compileApprovedStaticStage(approved(plan));
      assert.equal(first.status, "COMPILED", `${primitive}/${count}`);
      assert.equal(first.proof.valid, true, `${primitive}/${count}`);
      assert.equal(first.proof.edgeSlotClosure, true, `${primitive}/${count}`);
      assert.deepEqual(replay, first, `${primitive}/${count}`);
    }
  }
  for (const count of [2, 4, 8, 16, 32, 64]) {
    const plan: StaticStagePlan = {
      id: `double.${count}`, divisionId: "open", primitive: "double_elimination", resetFinalPolicy: "NEVER",
      requiredResourceType: "field", entrants: entrants(count),
    };
    assert.equal(compileApprovedStaticStage(approved(plan)).status, "COMPILED");
  }
  for (const count of [8, 16, 32, 64]) {
    const plan: StaticStagePlan = {
      id: `repechage.${count}`, divisionId: "open", primitive: "repechage",
      requiredResourceType: "field", entrants: entrants(count),
    };
    assert.equal(compileApprovedStaticStage(approved(plan)).status, "COMPILED");
  }
});
