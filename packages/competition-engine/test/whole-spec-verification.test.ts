import assert from "node:assert/strict";
import test from "node:test";
import { runWholeSpecVerification } from "../src/whole-spec-verification.js";

test("bounded whole-spec grammar exhausts supported scheduling, qualification, and partial-withdrawal dimensions", () => {
  const report = runWholeSpecVerification();

  assert.equal(report.status, "CERTIFIED");
  assert.equal(report.searchComplete, true);
  assert.equal(report.totalCases, 420);
  assert.equal(report.passedCases, 420);
  assert.equal(report.failedCases, 0);
  assert.equal(report.metamorphicChecks, 1222);
  assert.deepEqual(report.coverage, {
    participantCounts: [2, 3, 4, 5, 6, 7, 8],
    structures: ["GROUPS_TO_DUAL_DESTINATION", "GROUPS_TO_ELIMINATION", "SINGLE_ELIMINATION", "SINGLE_ROUND_ROBIN"],
    resourceCounts: [1, 2],
    resultStates: ["COMPLETED", "PARTIAL_WITHDRAWAL", "WALKOVER", "WITHDRAWAL"],
    scheduleVariants: ["AVAILABILITY_CLOSURE", "HARD_LOCK", "OPEN"],
  });
  assert.deepEqual(report.grammar, {
    version: "whole-spec-grammar@2",
    structureParticipantCounts: {
      GROUPS_TO_DUAL_DESTINATION: [4, 6, 8], GROUPS_TO_ELIMINATION: [4, 6, 8],
      SINGLE_ELIMINATION: [2, 3, 4, 5, 6, 7, 8], SINGLE_ROUND_ROBIN: [2, 3, 4, 5, 6],
    },
    resultStateRule: "COMPLETED|WALKOVER|WITHDRAWAL for every case; PARTIAL_WITHDRAWAL only when the graph has at least two actual contests",
    schedulingRule: "OPEN|HARD_LOCK|AVAILABILITY_CLOSURE; closure is represented by split resource availability [09:30,10:00)",
    capabilityBoundary: "This finite grammar enumerates single elimination, single round robin, groups-to-elimination, and groups-to-two-destinations; other native primitives are certified by their dedicated bounded corpora.",
  });
  assert.deepEqual(report.counterexamples, []);
  assert.match(report.proofHash, /^[a-f0-9]{64}$/);
  assert.match(report.grammarHash, /^[a-f0-9]{64}$/);
  assert.deepEqual(runWholeSpecVerification(), report);
  assert.ok(Object.isFrozen(report));
});
