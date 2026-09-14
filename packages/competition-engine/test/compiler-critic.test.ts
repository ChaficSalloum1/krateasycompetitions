import assert from "node:assert/strict";
import test from "node:test";
import {
  critiqueCompilation,
  type CriticInput,
} from "../src/compiler-critic.js";

const input = (): CriticInput => ({
  requirements: [
    { id: "R1", sourceText: "Every pool sends its winner to the main cup.", strength: "HARD", quantifier: "PER_POOL" },
  ],
  claims: [
    { id: "C1", requirementIds: ["R1"], rulePath: "/qualification/main", quantifier: "PER_POOL", disposition: "ENFORCED", proofFactIds: ["P1"], assumptionIds: [] },
  ],
  assumptions: [],
  proofFacts: [
    { id: "P1", claimId: "C1", passed: true, statement: "All four pool winners have one main-cup destination.", scope: "PER_POOL", evidence: { poolIds: ["A", "B", "C", "D"] } },
  ],
});

test("the read-only critic certifies fully mapped and proven requirements", () => {
  const source = input();
  const snapshot = structuredClone(source);
  const report = critiqueCompilation(source);

  assert.deepEqual(report.coverage.map(({ requirementId, status }) => ({ requirementId, status })), [
    { requirementId: "R1", status: "SATISFIED" },
  ]);
  assert.deepEqual(report.concerns, []);
  assert.equal(report.certification.eligible, true);
  assert.match(report.proofHash, /^[a-f0-9]{64}$/);
  assert.deepEqual(source, snapshot);
});

test("a lost source requirement remains visible and blocks certification", () => {
  const source = input();
  source.claims = [];
  source.proofFacts = [];
  const report = critiqueCompilation(source);

  assert.equal(report.coverage[0]?.status, "UNRESOLVED");
  assert.equal(report.concerns[0]?.code, "TCC101");
  assert.equal(report.concerns[0]?.counterexamples[0]?.type, "LOST_REQUIREMENT");
  assert.equal(report.certification.eligible, false);
});

test("overall compilation of a per-pool requirement is failed as quantifier drift", () => {
  const source = input();
  source.claims = [{ ...source.claims[0]!, quantifier: "OVERALL" }];
  source.proofFacts = [{ ...source.proofFacts[0]!, scope: "OVERALL" }];
  const report = critiqueCompilation(source);

  assert.equal(report.coverage[0]?.status, "FAILED");
  const concern = report.concerns.find(({ code }) => code === "TCC105");
  assert.match(concern?.counterexamples[0]?.witness ?? "", /overall aggregate.*pool fails/i);
});

test("approved soft relaxation is visible but non-blocking while hard relaxation blocks", () => {
  const source = input();
  source.requirements = [{ ...source.requirements[0]!, strength: "SOFT" }];
  source.claims = [{ ...source.claims[0]!, disposition: "DELIBERATELY_RELAXED", relaxationApproved: true, relaxationReason: "Venue capacity prevents the preferred guarantee." }];
  const soft = critiqueCompilation(source);
  assert.equal(soft.coverage[0]?.status, "DELIBERATELY_RELAXED");
  assert.equal(soft.certification.eligible, true);
  assert.equal(soft.concerns.find(({ code }) => code === "TCC109")?.blocking, false);

  source.requirements = [{ ...source.requirements[0]!, strength: "HARD" }];
  const hard = critiqueCompilation(source);
  assert.equal(hard.coverage[0]?.status, "DELIBERATELY_RELAXED");
  assert.equal(hard.certification.eligible, false);
  assert.deepEqual(hard.certification.blockingRequirementIds, ["R1"]);
});

test("unsupported assumptions and missing proof facts remain unresolved", () => {
  const source = input();
  source.claims = [{ ...source.claims[0]!, proofFactIds: ["missing-proof"], assumptionIds: ["A1"] }];
  source.assumptions = [{ id: "A1", approved: false, sourceReference: "" }];
  source.proofFacts = [];
  const report = critiqueCompilation(source);

  assert.equal(report.coverage[0]?.status, "UNRESOLVED");
  assert.deepEqual(report.coverage[0]?.concernCodes, ["TCC103", "TCC104"]);
  assert.equal(report.certification.eligible, false);
});

test("failed proof facts supply concrete counterexamples", () => {
  const source = input();
  source.proofFacts = [{
    ...source.proofFacts[0]!, passed: false,
    counterexample: { type: "POOL_WINNER_MISSING", path: "/pools/C", witness: "Pool C winner E7 has no destination.", evidence: { entrantId: "E7" } },
  }];
  const report = critiqueCompilation(source);

  assert.equal(report.coverage[0]?.status, "FAILED");
  assert.equal(report.coverage[0]?.counterexamples[0]?.type, "POOL_WINNER_MISSING");
});

test("mutually exclusive duplicate destinations block every affected requirement", () => {
  const source = input();
  source.requirements = [...source.requirements, { id: "R2", sourceText: "Everyone else enters exactly one consolation cup.", strength: "HARD", quantifier: "PER_PARTICIPANT" }];
  source.claims = [
    { ...source.claims[0]!, proofFactIds: ["P1"] },
    { id: "C2", requirementIds: ["R2"], rulePath: "/qualification/consolation-a", quantifier: "PER_PARTICIPANT", disposition: "ENFORCED", proofFactIds: ["P2", "P3"], assumptionIds: [] },
  ];
  source.proofFacts = [
    source.proofFacts[0]!,
    { id: "P2", claimId: "C2", passed: true, statement: "E7 enters consolation A.", scope: "PER_PARTICIPANT", evidence: {}, destination: { subjectId: "E7", destinationId: "consolation-a", exclusiveGroup: "post-pools" } },
    { id: "P3", claimId: "C2", passed: true, statement: "E7 enters consolation B.", scope: "PER_PARTICIPANT", evidence: {}, destination: { subjectId: "E7", destinationId: "consolation-b", exclusiveGroup: "post-pools" } },
  ];
  const report = critiqueCompilation(source);

  assert.equal(report.concerns.find(({ code }) => code === "TCC106")?.blocking, true);
  assert.equal(report.coverage.find(({ requirementId }) => requirementId === "R2")?.status, "FAILED");
  assert.equal(report.certification.eligible, false);
});

test("input ordering cannot change critic findings or proof hash", () => {
  const source = input();
  source.requirements = [...source.requirements, { id: "R2", sourceText: "Use an approved tiebreak.", strength: "SOFT", quantifier: "OVERALL" }];
  source.claims = [...source.claims, { id: "C2", requirementIds: ["R2"], rulePath: "/standings", quantifier: "OVERALL", disposition: "ENFORCED", proofFactIds: ["P2"], assumptionIds: [] }];
  source.proofFacts = [...source.proofFacts, { id: "P2", claimId: "C2", passed: true, statement: "Tiebreak registered.", scope: "OVERALL", evidence: {} }];
  const first = critiqueCompilation(source);
  const reversed = critiqueCompilation({
    requirements: [...source.requirements].reverse(), claims: [...source.claims].reverse(), assumptions: [], proofFacts: [...source.proofFacts].reverse(),
  });

  assert.deepEqual(first.coverage, reversed.coverage);
  assert.deepEqual(first.concerns, reversed.concerns);
  assert.equal(first.proofHash, reversed.proofHash);
});
