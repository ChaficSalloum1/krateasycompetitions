import assert from "node:assert/strict";
import test from "node:test";
import { runLifecycleFuzzCampaign } from "../src/lifecycle-fuzz.js";

test("seeded lifecycle fuzz preserves exactly-once effects and deterministic authoritative replay", () => {
  const report = runLifecycleFuzzCampaign({ seed: "lifecycle-v1", iterations: 120, outageCycles: 5 });
  assert.equal(report.status, "CERTIFIED", report.findings.join("\n"));
  assert.equal(report.idempotentReplays, 120);
  assert.equal(report.intentionalRejections, 120);
  assert.equal(report.deterministicReplayChecks, 120);
  assert.equal(report.tamperAndReorderRejections, 240);
  assert.equal(report.adjudicationLineageChecks, 120);
  assert.equal(runLifecycleFuzzCampaign({ seed: "lifecycle-v1", iterations: 120, outageCycles: 5 }).proofHash, report.proofHash);
});
