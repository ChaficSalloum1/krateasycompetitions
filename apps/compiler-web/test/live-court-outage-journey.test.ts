import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import { canonicalHash } from "@tournament-os/tournament-schema";
import { CompetitionJourney } from "../src/competition-journey.js";
import { createCompilerServer } from "../src/server.js";

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
const now = "2026-09-20T13:00:00.000Z";

function published(journey: CompetitionJourney) {
  const draft = journey.create({ mode: "json", text: fixture }, "organiser.author");
  const preview = journey.planStructuredEdit(draft.id, draft.draftVersion, decisions, "organiser.author");
  const resolved = journey.applyStructuredEdit(draft.id, draft.draftVersion, decisions, preview.previewHash, "organiser.author");
  const compiled = journey.compile(resolved.id, resolved.draftVersion);
  return journey.approve(compiled.id, compiled.revision, "organiser.approver",
    compiled.compiled?.requiredAcknowledgementCodes ?? []);
}

async function post(server: ReturnType<typeof createCompilerServer>, url: string, value: unknown) {
  const payload = Buffer.from(JSON.stringify(value));
  const request = Readable.from([payload]) as never;
  Object.assign(request, { method: "POST", url, headers: { "content-type": "application/json",
    "content-length": String(payload.byteLength) } });
  return new Promise<{ status: number; body: any }>((resolve) => {
    const result = { status: 0, body: undefined as any };
    server.emit("request", request, { writeHead: (status: number) => { result.status = status; },
      end: (body: string) => { result.body = JSON.parse(body); resolve(result); } } as never);
  });
}

test("a St Albans court outage is server-planned, independently Guarded, approved, published and replayed", () => {
  const directory = mkdtempSync(join(tmpdir(), "krateasy-court-outage-"));
  const storagePath = join(directory, "journey.json");
  try {
    const journey = new CompetitionJourney({ storagePath, now: () => now });
    const base = published(journey);
    let active = journey.activateLive(base.id, base.revision, "operator.lead");
    const target = active.compiled!.schedule.find(({ resourceId, start }) =>
      resourceId === "venue.courts.main.2" && start === now)!;
    const released = active.live!.state.definition.contests.find((contest) => contest.contestId.includes(".pools.")
      && contest.scheduledStart === now && contest.courtId !== target.resourceId
      && contest.entrantIds.every((id) => !active.live!.state.definition.contests
        .find(({ contestId }) => contestId === target.contestId)!.entrantIds.includes(id)))!;
    const noShow = journey.proposeNoShow(base.id, base.revision, active.live!.state.version, {
      proposalId: "no-show.before-outage", contestId: released.contestId, entrantId: released.entrantIds[0]!,
      reason: "Absent after final call", proposedBy: "operator.lead", proposedAt: now,
    });
    active = journey.approveNoShow(base.id, base.revision, noShow.live!.proposal!.proposalHash,
      "RELEASE_WALKOVER_SLOTS", "tournament.director", "2026-09-20T13:00:30.000Z");
    const originalStateHash = active.live!.state.proofHash;
    const deliveryBeforePreview = structuredClone(active.live!.delivery);

    const preview = journey.proposeCourtOutage(base.id, 2, active.live!.state.version, {
      proposalId: "court-outage.1", courtId: target.resourceId, reason: "Unsafe wet surface",
      expectedReopenAt: target.end, proposedBy: "operator.lead", proposedAt: now,
    });
    const proposal = preview.live!.courtOutageProposal!;
    assert.equal(proposal.status, "READY_FOR_APPROVAL");
    assert.equal(proposal.competitionGuard.status, "PASSED");
    assert.equal(proposal.liveGuard.status, "PASSED");
    assert.equal(proposal.repair.proof.optimalityProven, true);
    assert.ok(proposal.affectedContestIds.includes(target.contestId));
    assert.ok(proposal.repair.diff.some(({ taskId }) => taskId === target.contestId));
    assert.equal(proposal.operationalAssignments.length, active.live!.publication!.operationalAssignments.length);
    assert.equal(proposal.candidateSchedule!.contests.length, 108);
    assert.equal(Math.max(...proposal.operationalAssignments.map(({ end }) => Date.parse(end)))
      <= Date.parse("2026-09-20T20:00:00.000Z"), true);
    assert.equal(preview.live!.state.proofHash, originalStateHash, "preview must not mutate operational truth");
    assert.deepEqual(preview.live!.delivery, deliveryBeforePreview, "notifications cannot escape before approval");
    assert.deepEqual(journey.proposeCourtOutage(base.id, 2, active.live!.state.version, {
      proposalId: "court-outage.1", courtId: target.resourceId, reason: "Unsafe wet surface",
      expectedReopenAt: target.end, proposedBy: "operator.lead", proposedAt: now,
    }), preview, "an identical proposal command must replay idempotently");
    assert.throws(() => journey.proposeCourtOutage(base.id, 2, active.live!.state.version, {
      proposalId: "court-outage.1", courtId: target.resourceId, reason: "Forged changed reason",
      expectedReopenAt: target.end, proposedBy: "operator.lead", proposedAt: now,
    }), /proposal_identity_conflict/);

    assert.throws(() => journey.approveCourtOutage(base.id, 2, proposal.proposalHash,
      "operator.lead", "2026-09-20T13:01:00.000Z"), /independent_actor/);
    const approved = journey.approveCourtOutage(base.id, 2, proposal.proposalHash,
      "tournament.director", "2026-09-20T13:01:00.000Z");
    assert.equal(approved.live!.publication!.revision, 3);
    assert.equal(approved.live!.publication!.changeKind, "COURT_OUTAGE");
    assert.equal(approved.live!.state.resources.courts[target.resourceId]?.available, false);
    const organiserProjection = journey.readOrganiserLive({ organizationId: "org.local", competitionId: base.id,
      expectedOperationalRevision: 3, at: "2026-09-20T13:01:00.000Z" });
    assert.ok(organiserProjection.controlContests.some(({ contestId }) => contestId === target.contestId),
      "a later court repair must retain prior walkover outcomes in the current organiser projection");
    assert.deepEqual(approved.live!.publication!.affectedEntrantIds, proposal.affectedEntrantIds);
    assert.deepEqual(approved.live!.publication!.outboxIntents.map(({ payload }) => payload.recipientEntrantId).sort(),
      proposal.affectedEntrantIds.slice().sort());

    const replay = journey.approveCourtOutage(base.id, 3, proposal.proposalHash,
      "tournament.director", "2026-09-20T13:01:00.000Z");
    assert.deepEqual(replay, approved);
    assert.throws(() => journey.proposeCourtOutage(base.id, 2, approved.live!.state.version, {
      proposalId: "court-outage.stale", courtId: "venue.courts.main.3", reason: "Stale revision",
      expectedReopenAt: "2026-09-20T14:00:00.000Z", proposedBy: "operator.lead", proposedAt: now,
    }), /journey_revision_conflict/);

    const restarted = new CompetitionJourney({ storagePath });
    assert.deepEqual(restarted.read(base.id), approved);

    const envelope = JSON.parse(readFileSync(storagePath, "utf8")) as { records: Array<Record<string, any>>; storeHash: string };
    const record = envelope.records[0]!;
    const forgedProposal = { ...record.live.courtOutageProposal, consequences: ["forged consequence"] };
    const { proposalHash: _proposalHash, ...proposalBody } = forgedProposal;
    forgedProposal.proposalHash = canonicalHash(proposalBody);
    record.live.courtOutageProposal = forgedProposal;
    const { publicationHash: _publicationHash, ...publicationBody } = record.live.publication;
    publicationBody.proposalHash = forgedProposal.proposalHash;
    publicationBody.optionHash = forgedProposal.proposalHash;
    record.live.publication = { ...publicationBody, publicationHash: canonicalHash(publicationBody) };
    record.live.publicationHistory[record.live.publicationHistory.length - 1] = record.live.publication;
    const { recordHash: _recordHash, ...recordBody } = record;
    record.recordHash = canonicalHash(recordBody);
    envelope.storeHash = canonicalHash(envelope.records);
    writeFileSync(storagePath, `${JSON.stringify(envelope)}\n`);
    assert.throws(() => new CompetitionJourney({ storagePath }), /journey_store_integrity_failed/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("court-outage requests fail closed on forged repair or Guard artefacts", async () => {
  const journey = new CompetitionJourney({ now: () => now });
  const base = published(journey);
  const active = journey.activateLive(base.id, base.revision, "operator.lead");
  assert.throws(() => journey.proposeCourtOutage(base.id, base.revision, active.live!.state.version, {
    proposalId: "court-outage.forged", courtId: "venue.courts.main.2", reason: "Unsafe wet surface",
    expectedReopenAt: "2026-09-20T13:30:00.000Z", proposedBy: "operator.lead", proposedAt: now,
    guardInput: { status: "PASSED" }, repairRequest: { tasks: [] },
  } as never), /invalid_court_outage_request/);
  const server = createCompilerServer({ production: false, competitionJourney: journey, now: () => now });
  const response = await post(server, `/v1/competition-journey/${encodeURIComponent(base.id)}/court-outage-preview`, {
    expectedOperationalRevision: base.revision, expectedLiveVersion: active.live!.state.version,
    proposalId: "court-outage.http-forged", courtId: "venue.courts.main.2", reason: "Unsafe wet surface",
    expectedReopenAt: "2026-09-20T13:30:00.000Z", guardInput: { status: "PASSED" },
  });
  assert.equal(response.status, 400);
  assert.equal(response.body.error, "invalid_journey_command");
  const target = active.live!.state.definition.contests.find(({ courtId, scheduledStart }) =>
    courtId === "venue.courts.main.2" && scheduledStart === now)!;
  const called = journey.submitLiveCommand(base.id, base.revision, { kind: "CALL_CONTEST",
    contestId: target.contestId, commandId: "call.before-outage", expectedVersion: active.live!.state.version,
    actorId: "operator.lead", occurredAt: now });
  assert.throws(() => journey.proposeCourtOutage(base.id, base.revision, called.live!.state.version, {
    proposalId: "court-outage.called", courtId: target.courtId, reason: "Unsafe wet surface",
    expectedReopenAt: target.scheduledEnd, proposedBy: "operator.lead", proposedAt: now,
  }), /communicated_promise/);
});
