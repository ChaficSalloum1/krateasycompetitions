import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CompetitionJourney, parseCreationSource } from "../src/competition-journey.js";

const source = {
  mode: "quick" as const,
  value: {
    name: "Autumn Play & Konnect",
    sport: "padel",
    participantUnit: "pairs",
    participantCount: 47,
    resourceCount: 7,
    resourceLabel: "courts",
    format: "pools_to_knockout",
    poolSize: 4,
    qualifiersPerPool: 1,
    minimumMatches: 3,
    minimumRestMinutes: 0,
    matchDurationMinutes: 30,
    startsAt: "2026-09-05T09:00:00.000Z",
    endsAt: "2026-09-05T17:00:00.000Z",
    priority: "finish_on_time",
  },
};

test("one durable journey creates, compiles, Guards, approves, and reopens the same authoritative revision", () => {
  const directory = mkdtempSync(join(tmpdir(), "krateasy-journey-"));
  const storagePath = join(directory, "journey.json");
  const times = [
    "2026-09-14T10:00:00.000Z",
    "2026-09-14T10:01:00.000Z",
    "2026-09-14T10:02:00.000Z",
  ];
  try {
    const journey = new CompetitionJourney({ storagePath, now: () => times.shift()! });
    const draft = journey.create(source, "mac.organiser");
    assert.equal(draft.status, "DRAFT");
    assert.equal(draft.revision, 0);

    const compiled = journey.compile(draft.id, draft.draftVersion);
    assert.equal(compiled.status, "READY_FOR_APPROVAL");
    assert.equal(compiled.compiled?.guardStatus, "PASSED");
    assert.equal(compiled.compiled?.actualContestCount, 98);
    assert.equal(compiled.compiled?.scheduledContestCount, 98);

    const approved = journey.approve(draft.id, compiled.revision, "mac.organiser",
      compiled.compiled?.requiredAcknowledgementCodes ?? []);
    assert.equal(approved.status, "PUBLISHED");
    assert.match(approved.approval?.approvalHash ?? "", /^[a-f0-9]{64}$/);
    assert.equal(approved.publication?.revision, approved.revision);
    assert.equal(approved.publication?.guardReportHash, approved.compiled?.guardReportHash);
    assert.equal(approved.publication?.outboxIntents[0]?.key, `${approved.id}:v${approved.revision}`);
    assert.match(approved.publication?.certificateHash ?? "", /^[a-f0-9]{64}$/);

    const freshProcess = new CompetitionJourney({ storagePath });
    assert.deepEqual(freshProcess.read(draft.id), approved);
    assert.deepEqual(freshProcess.approve(draft.id, approved.revision, "mac.organiser",
      approved.compiled?.requiredAcknowledgementCodes ?? []), approved);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("the journey fails closed outside its declared milestone envelope", () => {
  const journey = new CompetitionJourney({ now: () => "2026-09-14T10:00:00.000Z" });
  const draft = journey.create({ mode: "quick", value: { ...source.value, participantCount: 46 } });
  assert.equal(draft.status, "NEEDS_INPUT");
  assert.ok(draft.supportFindings.some((finding) => finding.includes("47 pairs")));
  assert.throws(() => journey.compile(draft.id, draft.draftVersion), /journey_not_ready/);
});

test("the public source boundary rejects proposer-owned Guard artefacts", () => {
  assert.throws(() => parseCreationSource({ ...source, guardInput: { graph: {}, schedule: {} } }), /invalid_creation_source/);
  assert.throws(() => parseCreationSource({ mode: "quick", value: source.value, approval: true }), /invalid_creation_source/);
});
