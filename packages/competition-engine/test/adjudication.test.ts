import assert from "node:assert/strict";
import test from "node:test";
import {
  appendAdjudication,
  createAdjudicationLedger,
  effectiveOutcome,
  verifyAdjudicationLedger,
} from "../src/adjudication.js";

const audit = {
  actorId: "official.7",
  recordedAt: "2026-09-05T10:00:00.000Z",
  reason: "Signed match card",
};

test("a completed result becomes effective tournament truth without mutating the prior ledger", () => {
  const initial = createAdjudicationLedger({ withdrawal: "AWARD_WALKOVER" });
  const next = appendAdjudication(initial, {
    kind: "RECORD_RESULT",
    contestId: "match.1",
    entrants: ["team.a", "team.b"],
    winnerId: "team.a",
    score: [6, 3],
    ...audit,
  });

  assert.equal(initial.events.length, 0);
  assert.equal(next.events.length, 1);
  assert.deepEqual(effectiveOutcome(next, "match.1"), {
    status: "COMPLETED",
    entrants: ["team.a", "team.b"],
    winnerId: "team.a",
    loserId: "team.b",
    score: [6, 3],
  });
  assert.ok(Object.isFrozen(next));
  assert.ok(Object.isFrozen(next.events));
  assert.ok(Object.isFrozen(next.events[0]));
});

test("a walkover is scoreless and deterministically awards the opponent", () => {
  const ledger = createAdjudicationLedger({ withdrawal: "AWARD_WALKOVER" });
  const next = appendAdjudication(ledger, {
    kind: "RECORD_WALKOVER",
    contestId: "match.2",
    entrants: ["team.a", "team.b"],
    absentEntrantId: "team.b",
    actorId: "official.7",
    recordedAt: "2026-09-05T10:05:00.000Z",
    reason: "Team B did not report",
  });

  assert.deepEqual(effectiveOutcome(next, "match.2"), {
    status: "WALKOVER",
    entrants: ["team.a", "team.b"],
    winnerId: "team.a",
    loserId: "team.b",
    score: null,
  });
});

test("a withdrawal fails closed when its outcome policy is unspecified", () => {
  const ledger = createAdjudicationLedger({});
  assert.throws(() => appendAdjudication(ledger, {
    kind: "ADJUDICATE_WITHDRAWAL",
    contestId: "match.3",
    entrants: ["team.a", "team.b"],
    withdrawnEntrantId: "team.a",
    actorId: "director.1",
    recordedAt: "2026-09-05T10:10:00.000Z",
    reason: "Medical withdrawal",
  }), /Ambiguous withdrawal policy/);
  assert.equal(ledger.events.length, 0);
});

test("corrections preserve lineage and only supersede the current effective event", () => {
  const recorded = appendAdjudication(createAdjudicationLedger({ withdrawal: "AWARD_WALKOVER" }), {
    kind: "RECORD_RESULT", contestId: "match.4", entrants: ["team.a", "team.b"], winnerId: "team.a",
    score: [6, 4], ...audit,
  });
  const corrected = appendAdjudication(recorded, {
    kind: "CORRECT_RESULT", contestId: "match.4", entrants: ["team.a", "team.b"], winnerId: "team.b",
    score: [4, 6], supersedesEventId: recorded.events[0]!.eventId, actorId: "referee.2",
    recordedAt: "2026-09-05T10:20:00.000Z", reason: "Transposed scorecard",
  });

  assert.equal(recorded.events.length, 1);
  assert.equal(corrected.events[1]!.supersedesEventId, recorded.events[0]!.eventId);
  const effective = effectiveOutcome(corrected, "match.4");
  assert.ok(effective && effective.status === "COMPLETED");
  assert.equal(effective.winnerId, "team.b");
  assert.throws(() => appendAdjudication(corrected, {
    kind: "CORRECT_RESULT", contestId: "match.4", entrants: ["team.a", "team.b"], winnerId: "team.a",
    score: [6, 4], supersedesEventId: recorded.events[0]!.eventId, actorId: "referee.2",
    recordedAt: "2026-09-05T10:21:00.000Z", reason: "Stale correction",
  }), /current effective event/);
});

test("voids remain explicit truth and the independent proof detects tampering", () => {
  const recorded = appendAdjudication(createAdjudicationLedger({ withdrawal: "VOID_CONTEST" }), {
    kind: "RECORD_RESULT", contestId: "match.5", entrants: ["team.a", "team.b"], winnerId: "team.a",
    score: [6, 4], ...audit,
  });
  const voided = appendAdjudication(recorded, {
    kind: "VOID_RESULT", contestId: "match.5", supersedesEventId: recorded.events[0]!.eventId,
    actorId: "director.1", recordedAt: "2026-09-05T10:30:00.000Z", reason: "Ineligible lineup",
  });
  assert.deepEqual(effectiveOutcome(voided, "match.5"), { status: "VOIDED", entrants: ["team.a", "team.b"] });
  assert.deepEqual(verifyAdjudicationLedger(voided).findings, []);

  const tampered = structuredClone(voided);
  (tampered.events[0]!.outcome as { winnerId: string }).winnerId = "team.b";
  assert.ok(verifyAdjudicationLedger(tampered).findings.some((finding) => finding.code === "HASH_MISMATCH"));
});
