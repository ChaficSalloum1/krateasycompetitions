import assert from "node:assert/strict";
import test from "node:test";
import { runFormatGenerativeCampaign } from "../src/generative-campaign.js";

test("one million seeded format trials cover the complete registered static case catalogue", () => {
  const report = runFormatGenerativeCampaign({ seed: "universality-v1", iterations: 1_000_000 });

  assert.equal(report.status, "CERTIFIED");
  assert.equal(report.iterations, 1_000_000);
  assert.equal(report.uniqueCases, 142);
  assert.equal(report.catalogueCases, 142);
  assert.equal(report.violations.length, 0);
  assert.match(report.proofHash, /^[a-f0-9]{64}$/);
  assert.deepEqual(runFormatGenerativeCampaign({ seed: "universality-v1", iterations: 1_000_000 }), report);
  assert.ok(Object.isFrozen(report));
});

test("a campaign that cannot cover the catalogue is UNKNOWN rather than partially certified", () => {
  const report = runFormatGenerativeCampaign({ seed: "short", iterations: 10 });
  assert.equal(report.status, "UNKNOWN");
  assert.ok(report.uniqueCases < report.catalogueCases);
});
