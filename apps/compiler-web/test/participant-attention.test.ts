import assert from "node:assert/strict";
import test from "node:test";
import { runReferenceDemo } from "../src/demo.js";
import { createParticipantAttentionDemo, parseParticipantAttentionAction } from "../src/participant-attention.js";

function demo() {
  const { scenario } = runReferenceDemo();
  return createParticipantAttentionDemo({
    competitionId: scenario.spec.metadata.specId,
    competitionName: "Play & Konnect Padel Tournament",
    revision: scenario.spec.metadata.revision,
    certificationHash: scenario.certification.certificationHash,
    updatedAt: scenario.schedule.contests[0]!.start,
    contests: scenario.schedule.contests,
  });
}

test("participant attention is derived from confirmed certified schedule assignments", () => {
  const first = demo().snapshot();
  const second = demo().snapshot();
  assert.deepEqual(first, second);
  assert.equal(first.mode, "DELIVERY_REHEARSAL");
  assert.match(first.competition.proofHash, /^[a-f0-9]{64}$/);
  assert.ok(first.participants.length > 10);
  assert.ok(first.contests.length > 10);
  assert.ok(first.contests.every(({ participantIds }) => participantIds.length === 2));
  assert.ok(first.participants.every(({ token }) => /^[a-f0-9]{24}$/.test(token)));
  assert.ok(first.participants.every(({ delivery }) => delivery.message?.includes("Please be courtside 10 minutes early")));
});

test("delivery rehearsal never implies that a real provider was contacted", () => {
  const attention = demo();
  const participant = attention.snapshot().participants.find(({ delivery }) => delivery.status === "READY")!;
  const sent = attention.perform({ kind: "SIMULATE_SUCCESS", participantId: participant.id, channel: "WHATSAPP" });
  assert.equal(sent.participants.find(({ id }) => id === participant.id)!.delivery.status, "SIMULATED_SENT");
  assert.match(sent.rehearsalNotice, /No WhatsApp, email or SMS is sent/);

  const failed = attention.perform({ kind: "SIMULATE_FAILURE", participantId: participant.id, channel: "EMAIL" });
  const delivery = failed.participants.find(({ id }) => id === participant.id)!.delivery;
  assert.equal(delivery.status, "SIMULATED_FAILED");
  assert.equal(delivery.channel, "EMAIL");
});

test("calling a contest updates the venue projection without changing its schedule facts", () => {
  const attention = demo();
  const before = attention.snapshot().contests[0]!;
  const after = attention.perform({ kind: "CALL_CONTEST", contestId: before.id }).contests[0]!;
  assert.equal(after.state, "CALLED");
  assert.deepEqual({ ...after, state: before.state }, before);
  assert.throws(() => attention.perform({ kind: "CALL_CONTEST", contestId: "unknown.contest" }), /Unknown confirmed contest/);
});

test("attention action parsing is exact and rejects authority-shaped or unknown fields", () => {
  assert.deepEqual(parseParticipantAttentionAction({ kind: "SIMULATE_SUCCESS", participantId: "beginner.team.1", channel: "WHATSAPP" }),
    { kind: "SIMULATE_SUCCESS", participantId: "beginner.team.1", channel: "WHATSAPP" });
  assert.deepEqual(parseParticipantAttentionAction({ kind: "RESET_REHEARSAL" }), { kind: "RESET_REHEARSAL" });
  assert.equal(parseParticipantAttentionAction({ kind: "SIMULATE_SUCCESS", participantId: "beginner.team.1", channel: "SMS" }), null);
  assert.equal(parseParticipantAttentionAction({ kind: "CALL_CONTEST", contestId: "a", actorUserId: "injected" }), null);
  assert.equal(parseParticipantAttentionAction({ kind: "UNKNOWN" }), null);
});

