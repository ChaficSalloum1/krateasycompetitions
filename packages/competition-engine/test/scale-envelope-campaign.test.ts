import assert from "node:assert/strict";
import test from "node:test";
import { runScaleEnvelopeCampaign } from "../src/scale-envelope-campaign.js";

test("scale campaign records latency, memory, gap, validation, and an explicit repair-evidence boundary", () => {
  const report = runScaleEnvelopeCampaign([16], [4], 5);
  assert.equal(report.points.length, 1);
  const point = report.points[0]!;
  assert.equal(point.status, "CERTIFIED");
  assert.equal(point.validationErrors.length, 0);
  assert.equal(point.objectiveGap, 0);
  assert.ok(point.totalLatencyMs > 0);
  assert.equal(point.solverWallTimeSeconds, null);
  assert.ok(point.processRssMb > 0);
  assert.equal(point.repairStatus, "NOT_EXERCISED_BY_THIS_FIXTURE");
  assert.equal(report.status, "UNKNOWN");
});
