import assert from "node:assert/strict";
import test from "node:test";
import {
  approveLiveChange,
  createLiveOperationsState,
  proposeLiveChange,
} from "../src/index.js";

const at = "2026-09-07T09:00:00.000Z";

test("a court outage produces one approval-ready repair with affected people and notification drafts", () => {
  const live = createLiveOperationsState({ tournamentId: "tournament.live-change", courts: ["court.1", "court.2"], contests: [
    { contestId: "A", entrantIds: ["p1", "p2"], courtId: "court.1",
      scheduledStart: at, scheduledEnd: "2026-09-07T09:20:00.000Z" },
    { contestId: "B", entrantIds: ["p3", "p4"], courtId: "court.1",
      scheduledStart: "2026-09-07T09:30:00.000Z", scheduledEnd: "2026-09-07T09:50:00.000Z" },
  ] });
  const proposal = proposeLiveChange({ proposalId: "change.court-closure", proposedBy: "user.operator", proposedAt: at, liveState: live,
    liveCommand: { kind: "CLOSE_COURT", courtId: "court.1", reason: "Unsafe surface", expectedReopenAt: "2026-09-07T09:30:00.000Z",
      commandId: "live.close.1", expectedVersion: 0, actorId: "user.operator", occurredAt: at },
    repairRequest: { problem: { id: "repair.outage", minimumRestMinutes: 0, locks: [], tasks: [
      { id: "A", durationMinutes: 20, eligibleResourceIds: ["court.1", "court.2"], dependencyIds: [], participantIds: ["p1", "p2"] },
      { id: "B", durationMinutes: 20, eligibleResourceIds: ["court.1", "court.2"], dependencyIds: [], participantIds: ["p3", "p4"] },
    ], resources: [
      { id: "court.1", calendars: [{ startMinute: 0, endMinute: 60 }], closures: [{ startMinute: 0, endMinute: 30 }] },
      { id: "court.2", calendars: [{ startMinute: 0, endMinute: 60 }], closures: [] },
    ] }, baseline: [
      { taskId: "A", resourceId: "court.1", startMinute: 0, endMinute: 20, locked: false },
      { taskId: "B", resourceId: "court.1", startMinute: 30, endMinute: 50, locked: false },
    ], freezeThroughMinute: 0 }, maxSearchNodes: 100_000 });

  assert.equal(proposal.status, "READY_FOR_APPROVAL");
  assert.deepEqual(proposal.impact.movedContestIds, ["A"]);
  assert.deepEqual(proposal.impact.directlyAffectedContestIds, ["A", "B"]);
  assert.deepEqual(proposal.impact.affectedEntrantIds, ["p1", "p2", "p3", "p4"]);
  assert.deepEqual(proposal.notificationDrafts.map(({ recipientEntrantId }) => recipientEntrantId), ["p1", "p2", "p3", "p4"]);
  assert.equal(proposal.repair.proof.optimalityProven, true);
  assert.match(proposal.proofHash, /^[a-f0-9]{64}$/);

  const approved = approveLiveChange(proposal, { approvedBy: "user.director", approvedAt: "2026-09-07T09:01:00.000Z" });
  assert.equal(approved.status, "APPROVED");
  assert.equal(approved.liveState.resources.courts["court.1"]?.available, false);
  assert.equal(approved.assignments.find(({ taskId }) => taskId === "A")?.resourceId, "court.2");
  assert.deepEqual(approved.notificationDrafts, proposal.notificationDrafts);
});

test("an unproven repair blocks the entire live change without releasing proposed state", () => {
  const live = createLiveOperationsState({ tournamentId: "tournament.blocked-change", courts: ["court.1", "court.2"], contests: [
    { contestId: "A", entrantIds: ["p1", "p2"], courtId: "court.1", scheduledStart: at, scheduledEnd: "2026-09-07T09:20:00.000Z" },
  ] });
  const proposal = proposeLiveChange({ proposalId: "change.unproven", proposedBy: "user.operator", proposedAt: at, liveState: live,
    liveCommand: { kind: "CLOSE_COURT", courtId: "court.1", reason: "Unsafe surface", commandId: "live.close.blocked",
      expectedVersion: 0, actorId: "user.operator", occurredAt: at },
    repairRequest: { problem: { id: "repair.unproven", minimumRestMinutes: 0, locks: [], tasks: [
      { id: "A", durationMinutes: 20, eligibleResourceIds: ["court.1", "court.2"], dependencyIds: [], participantIds: ["p1", "p2"] },
    ], resources: [
      { id: "court.1", calendars: [{ startMinute: 0, endMinute: 60 }], closures: [{ startMinute: 0, endMinute: 30 }] },
      { id: "court.2", calendars: [{ startMinute: 0, endMinute: 60 }], closures: [] },
    ] }, baseline: [{ taskId: "A", resourceId: "court.1", startMinute: 0, endMinute: 20, locked: false }] }, maxSearchNodes: 1 });

  assert.equal(proposal.status, "BLOCKED");
  assert.equal(proposal.proposedLiveState, null);
  assert.deepEqual(proposal.notificationDrafts, []);
  assert.ok(proposal.findings.some(({ code }) => code === "LCH002"));
  assert.throws(() => approveLiveChange(proposal, { approvedBy: "user.director", approvedAt: "2026-09-07T09:01:00.000Z" }),
    /approval-ready live change/);
  assert.equal(live.resources.courts["court.1"]?.available, true);
});

test("approval rejects self-approval and a tampered impact preview", () => {
  const live = createLiveOperationsState({ tournamentId: "tournament.change-integrity", courts: ["court.1"], contests: [
    { contestId: "A", entrantIds: ["p1", "p2"], courtId: "court.1", scheduledStart: at, scheduledEnd: "2026-09-07T09:20:00.000Z" },
  ] });
  const proposal = proposeLiveChange({ proposalId: "change.withdrawal", proposedBy: "user.operator", proposedAt: at, liveState: live,
    liveCommand: { kind: "WITHDRAW_ENTRANT", entrantId: "p1", reason: "Injury", commandId: "live.withdraw.1",
      expectedVersion: 0, actorId: "user.operator", occurredAt: at },
    repairRequest: { problem: { id: "repair.withdrawal", minimumRestMinutes: 0, locks: [], tasks: [
      { id: "A", durationMinutes: 20, eligibleResourceIds: ["court.1"], dependencyIds: [], participantIds: ["p1", "p2"] },
    ], resources: [{ id: "court.1", calendars: [{ startMinute: 0, endMinute: 60 }], closures: [] }] },
    baseline: [{ taskId: "A", resourceId: "court.1", startMinute: 0, endMinute: 20, locked: false }] }, maxSearchNodes: 100 });

  assert.throws(() => approveLiveChange(proposal, { approvedBy: "user.operator", approvedAt: "2026-09-07T09:01:00.000Z" }),
    /different actor/);
  const tampered = { ...proposal, impact: { ...proposal.impact, affectedEntrantIds: [] } };
  assert.throws(() => approveLiveChange(tampered, { approvedBy: "user.director", approvedAt: "2026-09-07T09:01:00.000Z" }),
    /intact approval-ready live change/);
});
