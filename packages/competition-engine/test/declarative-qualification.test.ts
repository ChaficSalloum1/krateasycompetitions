import assert from "node:assert/strict";
import test from "node:test";
import {
  compileDeclarativeQualification,
  DECLARATIVE_QUALIFICATION_SCALE_ENVELOPE,
  hashQualificationAuthorityApproval,
  verifyDeclarativeQualification,
} from "../src/declarative-qualification.js";

test("ranking points select an exact field with an explicit deterministic cutoff policy", () => {
  const request = {
    policyId: "open.points",
    outputCount: 2,
    candidates: [
      { id: "a", metrics: { points: 12 } },
      { id: "b", metrics: { points: 10 } },
      { id: "c", metrics: { points: 10 } },
      { id: "d", metrics: { points: 8 } },
    ],
    alreadySelectedCandidateIds: [],
    selectors: [{ type: "RANKING_POINTS" as const, metricKey: "points", count: 2, cutoffTiePolicy: "CANDIDATE_ID" as const }],
  };
  const result = compileDeclarativeQualification(request);

  assert.equal(result.status, "CERTIFIED");
  assert.deepEqual(result.selectedCandidateIds, ["a", "b"]);
  assert.equal(result.proof.exactOutputCardinality, true);
  assert.equal(result.proof.noDuplicateSelections, true);
  assert.equal(result.evidence[1]?.selectorIndex, 0);
  assert.equal(result.evidence[1]?.metricValue, 10);
  assert.match(result.proof.proofHash, /^[a-f0-9]{64}$/);
  assert.equal(verifyDeclarativeQualification(request, result).status, "CERTIFIED");
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.evidence));
});

test("elapsed time ranks lower finite values first without sport-specific logic", () => {
  const request = {
    policyId: "open.time",
    outputCount: 2,
    candidates: [
      { id: "slow", metrics: { elapsedMs: 63_000 } },
      { id: "fast", metrics: { elapsedMs: 58_000 } },
      { id: "middle", metrics: { elapsedMs: 60_000 } },
    ],
    alreadySelectedCandidateIds: [],
    selectors: [{ type: "ELAPSED_TIME" as const, metricKey: "elapsedMs", count: 2, cutoffTiePolicy: "REJECT" as const }],
  };
  const result = compileDeclarativeQualification(request);
  assert.equal(result.status, "CERTIFIED");
  assert.deepEqual(result.selectedCandidateIds, ["fast", "middle"]);
  assert.equal(verifyDeclarativeQualification(request, result).status, "CERTIFIED");
});

test("a generic threshold selects every candidate satisfying its declared comparison", () => {
  const request = {
    policyId: "open.threshold",
    outputCount: 2,
    candidates: [
      { id: "a", metrics: { rating: 1800 } },
      { id: "b", metrics: { rating: 1750 } },
      { id: "c", metrics: { rating: 1699 } },
    ],
    alreadySelectedCandidateIds: [],
    selectors: [{
      type: "THRESHOLD" as const,
      metric: { type: "VALUE" as const, key: "rating" },
      comparison: "AT_LEAST" as const,
      value: 1750,
    }],
  };
  const result = compileDeclarativeQualification(request);
  assert.equal(result.status, "CERTIFIED");
  assert.deepEqual(result.selectedCandidateIds, ["a", "b"]);
  assert.equal(verifyDeclarativeQualification(request, result).status, "CERTIFIED");
});

test("a score threshold is first-class while using the generic metric evaluator", () => {
  const request = {
    policyId: "open.score",
    outputCount: 2,
    candidates: [
      { id: "a", metrics: { score: 80 } },
      { id: "b", metrics: { score: 75 } },
      { id: "c", metrics: { score: 74.99 } },
    ],
    alreadySelectedCandidateIds: [],
    selectors: [{ type: "SCORE_THRESHOLD" as const, metricKey: "score", minimum: 75 }],
  };
  const result = compileDeclarativeQualification(request);
  assert.equal(result.status, "CERTIFIED");
  assert.deepEqual(result.selectedCandidateIds, ["a", "b"]);
  assert.equal(verifyDeclarativeQualification(request, result).status, "CERTIFIED");
});

test("percentage qualification derives a bounded ratio instead of comparing raw totals", () => {
  const request = {
    policyId: "open.percentage",
    outputCount: 2,
    candidates: [
      { id: "a", metrics: { wins: 8, played: 10 } },
      { id: "b", metrics: { wins: 3, played: 4 } },
      { id: "c", metrics: { wins: 7, played: 10 } },
    ],
    alreadySelectedCandidateIds: [],
    selectors: [{
      type: "PERCENTAGE_THRESHOLD" as const,
      numeratorMetricKey: "wins", denominatorMetricKey: "played", minimumPercent: 75,
    }],
  };
  const result = compileDeclarativeQualification(request);
  assert.equal(result.status, "CERTIFIED");
  assert.deepEqual(result.selectedCandidateIds, ["a", "b"]);
  assert.deepEqual(result.evidence.map(({ metricValue }) => metricValue), [80, 75]);
  assert.equal(verifyDeclarativeQualification(request, result).status, "CERTIFIED");
});

test("aggregate qualification ranks a declared weighted metric expression", () => {
  const request = {
    policyId: "open.aggregate",
    outputCount: 2,
    candidates: [
      { id: "a", metrics: { wins: 3, differential: 2 } },
      { id: "b", metrics: { wins: 2, differential: 6 } },
      { id: "c", metrics: { wins: 2, differential: 1 } },
    ],
    alreadySelectedCandidateIds: [],
    selectors: [{
      type: "AGGREGATE_METRIC" as const,
      metric: { type: "AGGREGATE" as const, reducer: "SUM" as const, terms: [
        { key: "wins", weight: 3 }, { key: "differential", weight: 1 },
      ] },
      count: 2, direction: "HIGHER" as const, cutoffTiePolicy: "REJECT" as const,
    }],
  };
  const result = compileDeclarativeQualification(request);
  assert.equal(result.status, "CERTIFIED");
  assert.deepEqual(result.selectedCandidateIds, ["b", "a"]);
  assert.deepEqual(result.evidence.map(({ metricValue }) => metricValue), [12, 11]);
  assert.equal(verifyDeclarativeQualification(request, result).status, "CERTIFIED");
});

test("best-N can restrict comparison to runner-ups across groups", () => {
  const request = {
    policyId: "open.runners-up",
    outputCount: 2,
    candidates: [
      { id: "pool-a-1", groupId: "a", rank: 1, metrics: { normalized: 100 } },
      { id: "pool-a-2", groupId: "a", rank: 2, metrics: { normalized: 80 } },
      { id: "pool-b-2", groupId: "b", rank: 2, metrics: { normalized: 90 } },
      { id: "pool-c-2", groupId: "c", rank: 2, metrics: { normalized: 85 } },
    ],
    alreadySelectedCandidateIds: [],
    selectors: [{
      type: "BEST_N" as const,
      metric: { type: "VALUE" as const, key: "normalized" }, count: 2, direction: "HIGHER" as const,
      eligibleRank: 2, cutoffTiePolicy: "REJECT" as const,
    }],
  };
  const result = compileDeclarativeQualification(request);
  assert.equal(result.status, "CERTIFIED");
  assert.deepEqual(result.selectedCandidateIds, ["pool-b-2", "pool-c-2"]);
  assert.deepEqual(result.evidence[0]?.comparisonSetIds, ["pool-b-2", "pool-c-2", "pool-a-2"]);
  assert.equal(verifyDeclarativeQualification(request, result).status, "CERTIFIED");
});

test("wildcard and host places require named authority whose approval binds the selected ids", () => {
  for (const selectionType of ["WILDCARD", "HOST"] as const) {
    const authorityId = "committee-17";
    const candidateIds = ["c"];
    const selectorIndex = 0;
    const request = {
      policyId: `open.${selectionType.toLowerCase()}`,
      outputCount: 1,
      candidates: [
        { id: "a", metrics: {} }, { id: "b", metrics: {} }, { id: "c", metrics: {} },
      ],
      alreadySelectedCandidateIds: [],
      selectors: [{
        type: "AUTHORITY_SELECTION" as const, selectionType, candidateIds,
        approval: {
          status: "APPROVED" as const, authorityId,
          approvalHash: hashQualificationAuthorityApproval({
            policyId: `open.${selectionType.toLowerCase()}`, selectorIndex, selectionType, candidateIds, authorityId,
          }),
        },
      }],
    };
    const result = compileDeclarativeQualification(request);
    assert.equal(result.status, "CERTIFIED");
    assert.deepEqual(result.selectedCandidateIds, ["c"]);
    assert.equal(result.evidence[0]?.authorityId, authorityId);
    assert.equal(verifyDeclarativeQualification(request, result).status, "CERTIFIED");
  }
});

test("selectors execute sequentially and remainder excludes prior local and global selections", () => {
  const request = {
    policyId: "open.sequence",
    outputCount: 3,
    candidates: [
      { id: "a", metrics: { score: 10 } }, { id: "b", metrics: { score: 8 } },
      { id: "c", metrics: { score: 7 } }, { id: "d", metrics: { score: 9 } },
    ],
    alreadySelectedCandidateIds: ["d"],
    selectors: [
      { type: "SCORE_THRESHOLD" as const, metricKey: "score", minimum: 10 },
      { type: "REMAINDER" as const },
    ],
  };
  const result = compileDeclarativeQualification(request);
  assert.equal(result.status, "CERTIFIED");
  assert.deepEqual(result.selectedCandidateIds, ["a", "b", "c"]);
  assert.deepEqual(result.evidence.map(({ selectorIndex }) => selectorIndex), [0, 1, 1]);
  assert.equal(result.proof.globallyExclusive, true);
  assert.equal(result.proof.sequentialSelectorProvenance, true);
  assert.equal(verifyDeclarativeQualification(request, result).status, "CERTIFIED");
});

test("cutoff ties reject, include all, or break by candidate id only when explicitly pinned", () => {
  const base = {
    policyId: "open.tie",
    candidates: [
      { id: "a", metrics: { points: 10 } },
      { id: "b", metrics: { points: 9 } },
      { id: "c", metrics: { points: 9 } },
    ],
    alreadySelectedCandidateIds: [],
  };
  const unresolved = compileDeclarativeQualification({ ...base, outputCount: 2, selectors: [{
    type: "RANKING_POINTS", metricKey: "points", count: 2, cutoffTiePolicy: "REJECT",
  }] });
  assert.equal(unresolved.status, "REJECTED");
  assert.deepEqual(unresolved.selectedCandidateIds, []);
  assert.ok(unresolved.findings.some(({ code }) => code === "CUTOFF_TIE_UNRESOLVED"));

  const shared = compileDeclarativeQualification({ ...base, outputCount: 3, selectors: [{
    type: "RANKING_POINTS", metricKey: "points", count: 2, cutoffTiePolicy: "INCLUDE_ALL",
  }] });
  assert.equal(shared.status, "CERTIFIED");
  assert.deepEqual(shared.selectedCandidateIds, ["a", "b", "c"]);
});

test("authority conflicts and output drift fail closed with no partial qualifiers", () => {
  const policyId = "open.host";
  const authorityId = "director";
  const result = compileDeclarativeQualification({
    policyId, outputCount: 1,
    candidates: [{ id: "host", metrics: {} }, { id: "other", metrics: {} }],
    alreadySelectedCandidateIds: ["host"],
    selectors: [{
      type: "AUTHORITY_SELECTION", selectionType: "HOST", candidateIds: ["host"],
      approval: { status: "APPROVED", authorityId, approvalHash: hashQualificationAuthorityApproval({
        policyId, selectorIndex: 0, selectionType: "HOST", candidateIds: ["host"], authorityId,
      }) },
    }],
  });
  assert.equal(result.status, "REJECTED");
  assert.deepEqual(result.selectedCandidateIds, []);
  assert.ok(result.findings.some(({ code }) => code === "INVALID_AUTHORITY_SELECTION"));

  const cardinality = compileDeclarativeQualification({
    policyId: "open.short", outputCount: 2,
    candidates: [{ id: "a", metrics: { score: 10 } }, { id: "b", metrics: { score: 5 } }],
    alreadySelectedCandidateIds: [], selectors: [{ type: "SCORE_THRESHOLD", metricKey: "score", minimum: 10 }],
  });
  assert.equal(cardinality.status, "REJECTED");
  assert.deepEqual(cardinality.selectedCandidateIds, []);
  assert.ok(cardinality.findings.some(({ code }) => code === "OUTPUT_CARDINALITY_MISMATCH"));
});

test("the independent verifier rejects result, provenance, and proof tampering", () => {
  const request = {
    policyId: "open.verify", outputCount: 1,
    candidates: [{ id: "a", metrics: { points: 10 } }, { id: "b", metrics: { points: 5 } }],
    alreadySelectedCandidateIds: [],
    selectors: [{ type: "RANKING_POINTS" as const, metricKey: "points", count: 1, cutoffTiePolicy: "REJECT" as const }],
  };
  const certified = compileDeclarativeQualification(request);
  const tampered = structuredClone(certified) as unknown as {
    status: "CERTIFIED"; selectedCandidateIds: string[]; evidence: typeof certified.evidence;
    findings: typeof certified.findings; proof: typeof certified.proof;
  };
  tampered.selectedCandidateIds[0] = "b";
  const verification = verifyDeclarativeQualification(request, tampered);
  assert.equal(verification.status, "REJECTED");
  assert.ok(verification.findings.some(({ code }) => code === "SELECTION_NOT_REPRODUCIBLE"));
  assert.ok(verification.findings.some(({ code }) => code === "PROOF_HASH_MISMATCH"));

  const proofTampered = structuredClone(certified) as unknown as {
    status: "CERTIFIED"; selectedCandidateIds: string[]; evidence: typeof certified.evidence;
    findings: typeof certified.findings; proof: { exactOutputCardinality: boolean } & typeof certified.proof;
  };
  proofTampered.proof.exactOutputCardinality = false;
  const proofVerification = verifyDeclarativeQualification(request, proofTampered);
  assert.equal(proofVerification.status, "REJECTED");
  assert.ok(proofVerification.findings.some(({ code }) => code === "PROOF_BODY_MISMATCH"));
});

test("bounded exhaustive ranking corpus and candidate-order metamorphism close every binary small field", () => {
  let executed = 0;
  for (let candidateCount = 1; candidateCount <= 6; candidateCount += 1) {
    for (let scoreMask = 0; scoreMask < 2 ** candidateCount; scoreMask += 1) {
      const candidates = Array.from({ length: candidateCount }, (_, index) => ({
        id: `c${index + 1}`, metrics: { points: (scoreMask >> index) & 1 },
      }));
      const ordered = [...candidates].sort((left, right) => right.metrics.points - left.metrics.points || left.id.localeCompare(right.id));
      for (let count = 1; count <= candidateCount; count += 1) {
        const cutoff = ordered[count - 1]!.metrics.points;
        const ahead = ordered.filter(({ metrics }) => metrics.points > cutoff).length;
        const tied = ordered.filter(({ metrics }) => metrics.points === cutoff);
        const crosses = ahead < count && ahead + tied.length > count;
        for (const cutoffTiePolicy of ["REJECT", "CANDIDATE_ID", "INCLUDE_ALL"] as const) {
          const expected = cutoffTiePolicy === "INCLUDE_ALL" && crosses
            ? ordered.slice(0, ahead + tied.length).map(({ id }) => id)
            : ordered.slice(0, count).map(({ id }) => id);
          const request = {
            policyId: `corpus.${candidateCount}.${scoreMask}.${count}.${cutoffTiePolicy}`,
            outputCount: expected.length, candidates, alreadySelectedCandidateIds: [],
            selectors: [{ type: "RANKING_POINTS" as const, metricKey: "points", count, cutoffTiePolicy }],
          };
          const result = compileDeclarativeQualification(request);
          if (cutoffTiePolicy === "REJECT" && crosses) {
            assert.equal(result.status, "REJECTED");
          } else {
            assert.equal(result.status, "CERTIFIED");
            assert.deepEqual(result.selectedCandidateIds, expected);
            assert.equal(verifyDeclarativeQualification(request, result).status, "CERTIFIED");
            const permuted = compileDeclarativeQualification({ ...request, candidates: [...candidates].reverse() });
            assert.deepEqual(permuted.selectedCandidateIds, result.selectedCandidateIds);
            assert.equal(permuted.proof.proofHash, result.proof.proofHash);
          }
          executed += 1;
        }
      }
    }
  }
  assert.equal(executed, 1926);
});

test("undefined ratios and requests beyond the published scale envelope reject without output", () => {
  const ratio = compileDeclarativeQualification({
    policyId: "invalid.ratio", outputCount: 1,
    candidates: [{ id: "a", metrics: { wins: 0, played: 0 } }], alreadySelectedCandidateIds: [],
    selectors: [{ type: "PERCENTAGE_THRESHOLD", numeratorMetricKey: "wins", denominatorMetricKey: "played", minimumPercent: 0 }],
  });
  assert.equal(ratio.status, "REJECTED");
  assert.deepEqual(ratio.selectedCandidateIds, []);
  assert.ok(ratio.findings.some(({ code }) => code === "INVALID_THRESHOLD_METRIC"));

  const overLimit = compileDeclarativeQualification({
    policyId: "over.limit", outputCount: 1,
    candidates: Array.from({ length: DECLARATIVE_QUALIFICATION_SCALE_ENVELOPE.maximumCandidates + 1 }, (_, index) => ({
      id: `c${index}`, metrics: {},
    })),
    alreadySelectedCandidateIds: [], selectors: [{ type: "REMAINDER" }],
  });
  assert.equal(overLimit.status, "REJECTED");
  assert.ok(overLimit.findings.some(({ code }) => code === "CANDIDATE_LIMIT"));
  assert.equal(DECLARATIVE_QUALIFICATION_SCALE_ENVELOPE.qualification, "STRUCTURAL_LIMITS_ARE_NOT_A_PRODUCTION_CAPACITY_GUARANTEE");
});
