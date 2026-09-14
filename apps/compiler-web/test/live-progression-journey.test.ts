import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CompetitionJourney } from "../src/competition-journey.js";

const fixture = readFileSync(new URL("./fixtures/pk-st-albans-production-lock-candidate-2.json", import.meta.url), "utf8").trimEnd();
const decisions = [
  { id: "qualification", value: "top_four_konnect_remainder_tower" },
  { id: "scoring", value: "padel.timed.standard@1.0.0" },
  { id: "tiebreak", value: "wins_game_difference_games_won_head_to_head_manual" },
  { id: "normalisation", value: "percentage" },
  { id: "withdrawal", value: "preserve_played_walkover_future" },
  { id: "approval-authority", value: "separate_compiler_approver_publisher" },
  { id: "event-date", value: "2026-09-20" },
  { id: "timezone", value: "Europe/London" },
] as const;
const now = "2026-09-20T10:00:00.000Z";

function published(journey: CompetitionJourney) {
  const draft = journey.create({ mode: "json", text: fixture }, "organiser.author");
  const preview = journey.planStructuredEdit(draft.id, draft.draftVersion, decisions, "organiser.author");
  const resolved = journey.applyStructuredEdit(draft.id, draft.draftVersion, decisions, preview.previewHash, "organiser.author");
  const compiled = journey.compile(resolved.id, resolved.draftVersion);
  return journey.approve(compiled.id, compiled.revision, "organiser.approver",
    compiled.compiled?.requiredAcknowledgementCodes ?? []);
}

test("actual St Albans results resolve knockout identities and replay without trusting the planning simulation", () => {
  const directory = mkdtempSync(join(tmpdir(), "krateasy-live-progression-"));
  const storagePath = join(directory, "journey.json");
  try {
    const journey = new CompetitionJourney({ storagePath, organizationId: "org.st-albans", now: () => now,
      participantTokenSecret: "live-progression-test-signing-secret" });
    const base = published(journey);
    let snapshot = journey.activateLive(base.id, 1, "operator.lead");
    let version = snapshot.live!.state.version;
    let commandNumber = 0;
    const submit = (command: Record<string, unknown>) => {
      commandNumber += 1;
      snapshot = journey.submitLiveCommand(base.id, 1, { ...command,
        commandId: `progression.${commandNumber}`, expectedVersion: version,
        actorId: "operator.lead", occurredAt: now } as never);
      version = snapshot.live!.state.version;
      return snapshot;
    };

    const groupContests = snapshot.live!.state.definition.contests
      .filter(({ contestId }) => contestId.includes(".pools."));
    const knockoutContests = snapshot.live!.state.definition.contests
      .filter(({ contestId }) => !contestId.includes(".pools."));
    const firstKnockout = knockoutContests.find(({ requiresEntrantResolution }) => requiresEntrantResolution)!;
    assert.equal(snapshot.live!.state.resolvedEntrants[firstKnockout.contestId], undefined);
    assert.throws(() => journey.submitLiveCommand(base.id, 1, { kind: "RESOLVE_CONTEST_ENTRANTS",
      contestId: firstKnockout.contestId, entrantIds: firstKnockout.entrantIds.slice(0, 2),
      sourceProofHash: "a".repeat(64), commandId: "forged.client.resolution", expectedVersion: version,
      actorId: "operator.lead", occurredAt: now } as never), /live_command_is_server_owned/);
    assert.throws(() => submit({ kind: "START_CONTEST", contestId: firstKnockout.contestId,
      courtId: firstKnockout.courtId, startedAt: firstKnockout.scheduledStart }), /LIVE425/,
    "a planned possible-entrant set must never be accepted as the actual knockout identity");

    const participantIds = [...new Set(groupContests.flatMap(({ entrantIds }) => entrantIds))].sort();
    for (const entrantId of participantIds) submit({ kind: "CHECK_IN", entrantId });
    for (const contest of groupContests) {
      const entrants = [...contest.entrantIds].sort();
      submit({ kind: "START_CONTEST", contestId: contest.contestId,
        courtId: contest.courtId, startedAt: contest.scheduledStart });
      submit({ kind: "RECORD_SCORE", contestId: contest.contestId,
        scores: [{ entrantId: entrants[0]!, value: 6 }, { entrantId: entrants[1]!, value: 0 }] });
      submit({ kind: "COMPLETE_CONTEST", contestId: contest.contestId, endedAt: contest.scheduledEnd });
    }

    const resolvedFirstRound = knockoutContests.filter(({ contestId }) =>
      snapshot.live!.state.resolvedEntrants[contestId]);
    assert.ok(resolvedFirstRound.length > 0);
    for (const contest of resolvedFirstRound) {
      const entrants = snapshot.live!.state.resolvedEntrants[contest.contestId]!;
      assert.equal(entrants.length, 2);
      assert.equal(entrants.every((entrantId) => participantIds.includes(entrantId)), true);
    }

    const firstRound = resolvedFirstRound.find(({ contestId }) => knockoutContests.some(({ dependencyContestIds }) =>
      dependencyContestIds?.includes(contestId)))!;
    const actualEntrants = snapshot.live!.state.resolvedEntrants[firstRound.contestId]!;
    const access = journey.issueParticipantAccess({ organizationId: "org.st-albans", competitionId: base.id,
      expectedPublishedRevision: 1, participantId: actualEntrants[0]!, expiresAt: "2026-09-21T00:00:00.000Z" });
    const participantNext = journey.readParticipantNext({ organizationId: "org.st-albans", competitionId: base.id,
      expectedOperationalRevision: 1, token: access.token, at: now });
    assert.equal(participantNext.next?.contestId, firstRound.contestId);
    assert.ok(participantNext.next?.opponent);
    submit({ kind: "START_CONTEST", contestId: firstRound.contestId,
      courtId: firstRound.courtId, startedAt: firstRound.scheduledStart });
    const groupScoreEvent = snapshot.live!.state.events.find((event) => event.kind === "SCORE_RECORDED"
      && event.contestId === groupContests[0]!.contestId)!;
    const proofBeforeInvalidCorrection = snapshot.live!.state.proofHash;
    assert.throws(() => submit({ kind: "CORRECT_OPERATION", supersedesEventId: groupScoreEvent.eventId,
      reason: "Disputed group score", replacement: { kind: "SET_CONTEST_SCORE",
        contestId: groupContests[0]!.contestId,
        scores: groupContests[0]!.entrantIds.map((entrantId) => ({ entrantId, value: 3 })),
        reason: "Video review reports a tie" } }), /live_progression_invalidation_requires_repair/);
    assert.equal(journey.read(base.id)!.live!.state.proofHash, proofBeforeInvalidCorrection,
      "a correction that invalidates an already-started knockout identity must not partially append");
    const forgedEntrants = firstRound.entrantIds.filter((entrantId) => !actualEntrants.includes(entrantId)).slice(0, 2);
    if (forgedEntrants.length === 2) assert.throws(() => submit({ kind: "RECORD_SCORE", contestId: firstRound.contestId,
      scores: forgedEntrants.map((entrantId, index) => ({ entrantId, value: 6 - index })) }), /LIVE422/);
    submit({ kind: "RECORD_SCORE", contestId: firstRound.contestId,
      scores: actualEntrants.map((entrantId, index) => ({ entrantId, value: index === 0 ? 6 : 0 })) });
    submit({ kind: "COMPLETE_CONTEST", contestId: firstRound.contestId, endedAt: firstRound.scheduledEnd });

    const downstream = knockoutContests.find(({ dependencyContestIds }) => dependencyContestIds?.includes(firstRound.contestId))!;
    const otherPredecessorId = downstream.dependencyContestIds!.find((id) => id !== firstRound.contestId)!;
    const otherPredecessor = knockoutContests.find(({ contestId }) => contestId === otherPredecessorId)!;
    const otherEntrants = snapshot.live!.state.resolvedEntrants[otherPredecessorId]!;
    submit({ kind: "START_CONTEST", contestId: otherPredecessorId,
      courtId: otherPredecessor.courtId, startedAt: otherPredecessor.scheduledStart });
    submit({ kind: "RECORD_SCORE", contestId: otherPredecessorId,
      scores: otherEntrants.map((entrantId, index) => ({ entrantId, value: index === 0 ? 6 : 0 })) });
    submit({ kind: "COMPLETE_CONTEST", contestId: otherPredecessorId, endedAt: otherPredecessor.scheduledEnd });
    assert.deepEqual(snapshot.live!.state.resolvedEntrants[downstream.contestId],
      [actualEntrants[0], otherEntrants[0]].sort());

    const restarted = new CompetitionJourney({ storagePath, organizationId: "org.st-albans", now: () => now,
      participantTokenSecret: "live-progression-test-signing-secret" });
    assert.deepEqual(restarted.read(base.id)!.live!.state.resolvedEntrants,
      snapshot.live!.state.resolvedEntrants);
    assert.equal(restarted.read(base.id)!.live!.state.proofHash, snapshot.live!.state.proofHash);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
