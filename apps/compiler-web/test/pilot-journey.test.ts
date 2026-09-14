import assert from "node:assert/strict";
import test from "node:test";
import { buildPilotScheduleDecision } from "../src/pilot-journey.js";
import { createPlatformDemo } from "../src/platform-demo.js";
import { pilotDemoAction } from "../src/server.js";
import { compilerHtml } from "../src/ui.js";

test("the pilot compares only valid schedules and recommends the lowest operational blast radius", () => {
  const decision = buildPilotScheduleDecision();

  assert.equal(decision.status, "READY");
  assert.equal(decision.recommendedCandidateId, "recovery-buffer");
  assert.equal(decision.approvedCandidateId, "fastest-finish");
  assert.deepEqual(decision.options.map(({ candidateId }) => candidateId), [
    "recovery-buffer",
    "fastest-finish",
  ]);
  assert.equal(decision.rejectedOptions[0]?.candidateId, "unsafe-shortcut");
  assert.ok(decision.options[0]!.overrunConflictCount < decision.options[1]!.overrunConflictCount);
  assert.ok(decision.options.every(({ evidenceHash }) => /^[a-f0-9]{64}$/.test(evidenceHash)));
  assert.match(decision.proofHash, /^[a-f0-9]{64}$/);
});

test("the Studio presents the complete golden journey with explicit decisions and responsive guardrails", () => {
  for (const text of [
    "Review &amp; publish",
    "One truth. Visible decisions.",
    "Compare valid schedules",
    "Publish certified plan",
    "Preview court outage",
    "Approve minimal repair",
    "Who will be notified",
  ]) assert.ok(compilerHtml.includes(text), `missing ${text}`);
  for (const id of [
    "pilot-progress",
    "pilot-schedule-options",
    "pilot-guard",
    "pilot-live-change",
    "pilot-publish",
    "pilot-propose-outage",
    "pilot-approve-outage",
  ]) assert.ok(compilerHtml.includes(`id="${id}"`), `missing ${id}`);
  assert.ok(compilerHtml.includes("grid-template-columns:minmax(0,1fr) 360px"));
  assert.ok(compilerHtml.includes("@media(max-width:760px)"));
});

test("the demo boundary exposes the pilot journey and governed actions", async () => {
  const initial = await pilotDemoAction("read");
  assert.equal(initial.publication.guardStatus, "PASSED");

  await pilotDemoAction("publish");
  await pilotDemoAction("propose-outage");
  const view = await pilotDemoAction("approve-outage");
  assert.equal(view.publication.status, "PUBLISHED");
  assert.equal(view.liveChange.status, "APPROVED");
});

test("the pilot moves from approved draft to certified publication and a two-person live repair", async () => {
  const demo = await createPlatformDemo();
  const initial = await demo.pilotJourney();

  assert.equal(initial.lifecycleStatus, "APPROVED");
  assert.equal(initial.publication.status, "READY_TO_PUBLISH");
  assert.equal(initial.publication.guardStatus, "PASSED");

  const published = await demo.publishPilot();
  assert.equal(published.lifecycleStatus, "PUBLISHED");
  assert.equal(published.publication.status, "PUBLISHED");
  assert.match(published.publication.certificateHash ?? "", /^[a-f0-9]{64}$/);

  const proposed = await demo.proposePilotOutage();
  assert.equal(proposed.liveChange.status, "READY_FOR_APPROVAL");
  assert.deepEqual(proposed.liveChange.movedContestIds, ["Opening match 1"]);
  assert.equal(proposed.liveChange.affectedEntrantIds.length, 4);
  assert.equal(proposed.liveChange.notificationCount, 4);

  const approved = await demo.approvePilotOutage();
  assert.equal(approved.liveChange.status, "APPROVED");
  assert.equal(approved.liveChange.approvedBy, "user.demo-director");
  assert.equal(approved.liveChange.notificationCount, 4);
});
