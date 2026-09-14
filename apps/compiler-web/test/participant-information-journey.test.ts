import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createOutboxDeliveryWorker, OutboxProviderError } from "@tournament-os/competition-engine";
import { canonicalHash } from "@tournament-os/tournament-schema";
import { CompetitionJourney } from "../src/competition-journey.js";
import { verifyOfflineEventPack } from "../src/offline-event-pack.js";
import { createCompilerServer } from "../src/server.js";
import { Readable } from "node:stream";

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
const timestamp = "2026-09-20T13:00:00.000Z";
const secret = "participant-access-signing-secret-for-tests-only-2026";
const offlineSeed = "9f4f6abf4f1433ccb52966db4b69e85f71bc78b39bece0413e2ef56ef34a6dd8";

function published(journey: CompetitionJourney) {
  const draft = journey.create({ mode: "json", text: fixture }, "organiser.author");
  const preview = journey.planStructuredEdit(draft.id, draft.draftVersion, decisions, "organiser.author");
  const resolved = journey.applyStructuredEdit(draft.id, draft.draftVersion, decisions, preview.previewHash, "organiser.author");
  const compiled = journey.compile(resolved.id, resolved.draftVersion);
  return journey.approve(compiled.id, compiled.revision, "organiser.approver",
    compiled.compiled?.requiredAcknowledgementCodes ?? []);
}

async function http(server: ReturnType<typeof createCompilerServer>, method: "GET" | "POST", url: string,
  body?: unknown): Promise<{ status: number; body: any; contentType: string }> {
  const payload = body === undefined ? Buffer.alloc(0) : Buffer.from(JSON.stringify(body));
  const request = Readable.from(payload.length ? [payload] : []) as never;
  Object.assign(request, { method, url, headers: body === undefined ? {} : {
    "content-type": "application/json", "content-length": String(payload.length) } });
  return new Promise((resolve) => {
    let status = 0; let headers: Record<string, string> = {};
    server.emit("request", request, { writeHead: (nextStatus: number, nextHeaders: Record<string, string>) => {
      status = nextStatus; headers = nextHeaders ?? {};
    }, end: (encoded = "") => {
      const contentType = headers["content-type"] ?? "";
      resolve({ status, contentType, body: contentType.includes("application/json") ? JSON.parse(encoded) : encoded });
    } } as never);
  });
}

test("signed participant and public projections change only where an approved no-show repair has impact", () => {
  const directory = mkdtempSync(join(tmpdir(), "krateasy-participant-information-"));
  const storagePath = join(directory, "journey.json");
  try {
    const journey = new CompetitionJourney({ storagePath, organizationId: "org.st-albans",
      participantTokenSecret: secret, offlinePackSigningSeedHex: offlineSeed, now: () => timestamp });
    const base = published(journey);
    const active = journey.activateLive(base.id, 1, "operator.lead");
    const groupContests = active.live!.state.definition.contests.filter(({ contestId }) => contestId.includes(".pools."));
    const completedContest = groupContests[0]!;
    const inProgressContest = groupContests.find(({ entrantIds }) =>
      entrantIds.every((id) => !completedContest.entrantIds.includes(id)))!;
    const noShowContest = groupContests.find(({ entrantIds }) => entrantIds.every((id) =>
      !completedContest.entrantIds.includes(id) && !inProgressContest.entrantIds.includes(id)))!;
    let liveVersion = active.live!.state.version;
    const submit = (command: Record<string, unknown>) => {
      const next = journey.submitLiveCommand(base.id, 1, { ...command,
        commandId: `golden.command.${liveVersion + 1}`, expectedVersion: liveVersion,
        actorId: "operator.lead", occurredAt: timestamp } as never);
      liveVersion = next.live!.state.version;
    };
    for (const participantId of [...completedContest.entrantIds, ...inProgressContest.entrantIds])
      submit({ kind: "CHECK_IN", entrantId: participantId });
    submit({ kind: "START_CONTEST", contestId: completedContest.contestId,
      courtId: completedContest.courtId, startedAt: "2026-09-20T11:00:00.000Z" });
    submit({ kind: "RECORD_SCORE", contestId: completedContest.contestId,
      scores: completedContest.entrantIds.map((entrantId, index) => ({ entrantId, value: 6 - index })) });
    submit({ kind: "COMPLETE_CONTEST", contestId: completedContest.contestId,
      endedAt: "2026-09-20T11:30:00.000Z" });
    submit({ kind: "START_CONTEST", contestId: inProgressContest.contestId,
      courtId: inProgressContest.courtId, startedAt: "2026-09-20T12:30:00.000Z" });
    const absentParticipantId = noShowContest.entrantIds[0]!;
    const participantIds = [...new Set(groupContests.flatMap(({ entrantIds }) => entrantIds))].sort();
    const grants = new Map(participantIds.map((participantId) => [participantId,
      journey.issueParticipantAccess({ organizationId: "org.st-albans", competitionId: base.id,
        expectedPublishedRevision: 1, participantId, expiresAt: "2026-09-21T00:00:00.000Z" })]));
    const before = new Map(participantIds.map((participantId) => [participantId,
      journey.readParticipantNext({ organizationId: "org.st-albans", competitionId: base.id,
        expectedOperationalRevision: 1, token: grants.get(participantId)!.token, at: timestamp })]));
    const beforeAbsent = before.get(absentParticipantId)!;
    assert.ok(beforeAbsent.next);
    assert.equal(beforeAbsent.next.reportingTime,
      new Date(Date.parse(beforeAbsent.next.startsAt) - 10 * 60_000).toISOString());
    assert.match(beforeAbsent.next.court, /^venue\.courts\./);
    const publicBefore = journey.readPublicLive({ organizationId: "org.st-albans", competitionId: base.id,
      expectedOperationalRevision: 1 });

    const proposal = journey.proposeNoShow(base.id, 1, liveVersion, {
      proposalId: "participant.no-show.1", contestId: noShowContest.contestId,
      entrantId: absentParticipantId, reason: "Absent after the published reporting window.",
      proposedBy: "operator.lead", proposedAt: timestamp,
    });
    assert.deepEqual(journey.readPublicLive({ organizationId: "org.st-albans", competitionId: base.id,
      expectedOperationalRevision: 1 }), publicBefore, "unpublished repair state must not escape into projections");
    const deliveryIdsBeforeApproval = new Set(proposal.live!.delivery.map(({ id }) => id));

    const repaired = journey.approveNoShow(base.id, 1, proposal.live!.proposal!.proposalHash,
      "RELEASE_WALKOVER_SLOTS", "tournament.director", timestamp);
    const after = new Map(participantIds.map((participantId) => [participantId,
      journey.readParticipantNext({ organizationId: "org.st-albans", competitionId: base.id,
        expectedOperationalRevision: 2, token: grants.get(participantId)!.token, at: timestamp })]));
    const changedParticipantIds = participantIds.filter((participantId) =>
      before.get(participantId)!.projectionHash !== after.get(participantId)!.projectionHash);
    assert.deepEqual(changedParticipantIds, repaired.live!.publication!.affectedEntrantIds.slice().sort());
    assert.equal(after.get(absentParticipantId)!.participant.status, "WITHDRAWN");
    assert.equal(after.get(absentParticipantId)!.next, null);
    assert.equal(after.get(absentParticipantId)!.revision, 2);
    assert.equal(after.get(participantIds.find((id) => !changedParticipantIds.includes(id))!)!.revision, 1);
    assert.equal(repaired.live!.state.contests[completedContest.contestId]?.status, "COMPLETED");
    const refreshedAccess = journey.issueParticipantAccess({ organizationId: "org.st-albans", competitionId: base.id,
      expectedPublishedRevision: 1, participantId: absentParticipantId,
      expiresAt: "2026-09-21T00:00:00.000Z" });
    assert.equal(new URL(refreshedAccess.path, "http://local.invalid").searchParams.get("revision"), "2");
    const repairedPack = journey.issueOfflineEventPack({ organizationId: "org.st-albans", competitionId: base.id,
      expectedPublishedRevision: 1, expectedOperationalRevision: 2, expiresAt: "2026-09-20T21:00:00.000Z" });
    const repairedPackBody = verifyOfflineEventPack(repairedPack, repairedPack.publicKeyBase64, timestamp);
    assert.equal(repairedPackBody.manualFallback.participantQrIndex.entries.length, 48);
    assert.equal(repairedPackBody.manualFallback.participantQrIndex.entries.every(({ accessPath }) =>
      new URL(accessPath, "http://local.invalid").searchParams.get("revision") === "2"), true);
    assert.equal(repaired.live!.state.contests[inProgressContest.contestId]?.status, "IN_PROGRESS");

    const publicAfter = journey.readPublicLive({ organizationId: "org.st-albans", competitionId: base.id,
      expectedOperationalRevision: 2 });
    const beforeContests = new Map(publicBefore.contests.map((contest) => [contest.contestId, contest.projectionHash]));
    const changedContestIds = publicAfter.contests.filter((contest) => beforeContests.get(contest.contestId) !== contest.projectionHash)
      .map(({ contestId }) => contestId).sort();
    assert.deepEqual(changedContestIds, repaired.live!.publication!.affectedContestIds.slice().sort());
    assert.deepEqual(repaired.live!.publication!.outboxIntents.map(({ payload }) => payload.recipientEntrantId).sort(),
      changedParticipantIds);
    assert.deepEqual(repaired.live!.delivery.filter(({ id }) => !deliveryIdsBeforeApproval.has(id))
      .map(({ payload }) => (payload as any).recipientEntrantId).sort(), changedParticipantIds,
    "the atomic outbox delta must contain every and only changed participant projections");

    assert.throws(() => journey.readParticipantNext({ organizationId: "org.st-albans", competitionId: base.id,
      expectedOperationalRevision: 1, token: grants.get(absentParticipantId)!.token, at: timestamp }), /journey_revision_conflict/);
    assert.throws(() => journey.readParticipantNext({ organizationId: "org.other", competitionId: base.id,
      expectedOperationalRevision: 2, token: grants.get(absentParticipantId)!.token, at: timestamp }), /journey_not_found/);
    assert.throws(() => journey.readParticipantNext({ organizationId: "org.st-albans", competitionId: base.id,
      expectedOperationalRevision: 2, token: `${grants.get(absentParticipantId)!.token.slice(0, -1)}x`, at: timestamp }),
    /participant_access_denied/);

    const restarted = new CompetitionJourney({ storagePath, organizationId: "org.st-albans",
      participantTokenSecret: secret, offlinePackSigningSeedHex: offlineSeed, now: () => timestamp });
    assert.deepEqual(restarted.readParticipantNext({ organizationId: "org.st-albans", competitionId: base.id,
      expectedOperationalRevision: 2, token: grants.get(absentParticipantId)!.token, at: timestamp }),
    after.get(absentParticipantId));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("participant access fails closed before authoritative publication and live activation", () => {
  const journey = new CompetitionJourney({ organizationId: "org.st-albans", participantTokenSecret: secret,
    now: () => timestamp });
  const draft = journey.create({ mode: "json", text: fixture }, "organiser.author");
  assert.throws(() => journey.issueParticipantAccess({ organizationId: "org.st-albans", competitionId: draft.id,
    expectedPublishedRevision: 1, participantId: "advanced.team.1", expiresAt: "2026-09-21T00:00:00.000Z" }),
  /journey_revision_conflict/);
});

test("targeted projection delivery is atomic, retryable, and retains provider evidence across restart", async () => {
  const directory = mkdtempSync(join(tmpdir(), "krateasy-participant-delivery-"));
  const storagePath = join(directory, "journey.json");
  try {
    const journey = new CompetitionJourney({ storagePath, organizationId: "org.st-albans",
      participantTokenSecret: secret, now: () => timestamp });
    const base = published(journey);
    const active = journey.activateLive(base.id, 1, "operator.lead");
    const contest = active.live!.state.definition.contests.find(({ contestId }) => contestId.includes(".pools."))!;
    const proposal = journey.proposeNoShow(base.id, 1, 0, { proposalId: "delivery.no-show.1",
      contestId: contest.contestId, entrantId: contest.entrantIds[0]!, reason: "Absent after reporting window.",
      proposedBy: "operator.lead", proposedAt: timestamp });
    const repaired = journey.approveNoShow(base.id, 1, proposal.live!.proposal!.proposalHash,
      "RELEASE_WALKOVER_SLOTS", "tournament.director", timestamp);
    assert.equal(repaired.live!.delivery.length, repaired.live!.publication!.affectedEntrantIds.length);
    assert.equal(repaired.live!.delivery.every(({ status, payload }) => status === "PENDING"
      && (payload as any).projection.projectionHash), true);

    let attempts = 0;
    const firstWorker = createOutboxDeliveryWorker({ tenantId: "org.st-albans", workerId: "delivery.worker.1",
      outbox: journey.participantDeliveryStore("org.st-albans", base.id), now: () => timestamp,
      baseDelayMs: 1_000, providers: [{ id: "pilot.provider", topics: ["competition.participant-next.v1"],
        idempotencyGuarantee: "REPLAY_SAFE", async deliver() {
          attempts += 1;
          throw new OutboxProviderError("TEMPORARY_PROVIDER_FAILURE");
        } }] });
    const firstRun = await firstWorker.runOnce();
    assert.equal(firstRun.retried, repaired.live!.delivery.length);

    const restarted = new CompetitionJourney({ storagePath, organizationId: "org.st-albans",
      participantTokenSecret: secret, now: () => "2026-09-20T13:00:01.000Z" });
    const deliveredKeys = new Set<string>();
    const secondWorker = createOutboxDeliveryWorker({ tenantId: "org.st-albans", workerId: "delivery.worker.2",
      outbox: restarted.participantDeliveryStore("org.st-albans", base.id),
      now: () => "2026-09-20T13:00:01.000Z", providers: [{ id: "pilot.provider",
        topics: ["competition.participant-next.v1"], idempotencyGuarantee: "REPLAY_SAFE",
        async deliver(request) { attempts += 1; deliveredKeys.add(request.idempotencyKey);
          return { status: "ACCEPTED", providerMessageId: `receipt.${request.idempotencyKey.slice(-12)}` }; } }] });
    const secondRun = await secondWorker.runOnce();
    assert.equal(secondRun.delivered, repaired.live!.delivery.length);
    const evidence = restarted.read(base.id)!.live!.delivery;
    assert.equal(evidence.every(({ status, attempts: count, providerId, providerMessageId, providerIdempotencyKey }) =>
      status === "DELIVERED" && count === 2 && providerId === "pilot.provider"
      && Boolean(providerMessageId) && Boolean(providerIdempotencyKey)), true);
    assert.equal(deliveredKeys.size, evidence.length);
    assert.equal(attempts, evidence.length * 2);
    assert.deepEqual(restarted.approveNoShow(base.id, 1, proposal.live!.proposal!.proposalHash,
      "RELEASE_WALKOVER_SLOTS", "tournament.director", timestamp).live!.delivery, evidence,
    "duplicate approval must not enqueue or reset delivery evidence");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("install-free HTTP projections use opaque access and never fall back to the mutable rehearsal singleton", async () => {
  const journey = new CompetitionJourney({ organizationId: "org.st-albans", participantTokenSecret: secret,
    now: () => timestamp });
  const base = published(journey);
  const active = journey.activateLive(base.id, 1, "operator.lead");
  const participantId = active.live!.state.definition.contests.find(({ contestId }) => contestId.includes(".pools."))!
    .entrantIds[0]!;
  const server = createCompilerServer({ production: false, competitionJourney: journey,
    organizationId: "org.st-albans" });
  const root = `/v1/competition-journey/${encodeURIComponent(base.id)}`;
  const issued = await http(server, "POST", `${root}/participant-access`, { expectedPublishedRevision: 1,
    participantId, expiresAt: "2026-09-21T00:00:00.000Z" });
  assert.equal(issued.status, 201);
  assert.match(issued.body.token, /^kp1_[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(issued.body).includes(participantId), false, "the access response must stay opaque");
  const next = await http(server, "GET", `${root}/participant-next?revision=1&token=${issued.body.token}`);
  assert.equal(next.status, 200);
  assert.equal(next.body.revision, 1);
  assert.equal(next.body.participant.displayName.includes(" / "), true);
  assert.equal("participantId" in next.body.participant, false);
  const publicLive = await http(server, "GET", `${root}/public-live?revision=1`);
  assert.equal(publicLive.status, 200);
  assert.equal(publicLive.body.contests.length, 108);
  const organiserLive = await http(server, "GET", `${root}/organiser-live?revision=1`);
  assert.equal(organiserLive.status, 200);
  assert.equal(organiserLive.body.participants.length, 48);
  const legacy = await http(server, "GET", "/api/participant-attention");
  assert.equal(legacy.status, 404);
  const page = await http(server, "GET", `/next?competition=${encodeURIComponent(base.id)}&revision=1&token=${issued.body.token}`);
  assert.equal(page.status, 200);
  assert.match(page.body, /participant-next/);
  assert.doesNotMatch(page.body, /pair-options|participant-attention|DELIVERY_REHEARSAL/);
});

test("connected control-room commands append call, score, finish, correction, and post-repair actual truth", async () => {
  const directory = mkdtempSync(join(tmpdir(), "krateasy-connected-control-room-"));
  const storagePath = join(directory, "journey.json");
  try {
    const journey = new CompetitionJourney({ storagePath, organizationId: "org.st-albans",
      participantTokenSecret: secret, now: () => timestamp });
    const base = published(journey);
    let current = journey.activateLive(base.id, 1, "operator.lead");
    const contest = current.live!.state.definition.contests.find(({ contestId }) => contestId.includes(".pools."))!;
    const server = createCompilerServer({ production: false, competitionJourney: journey,
      organizationId: "org.st-albans", now: () => timestamp });
    const root = `/v1/competition-journey/${encodeURIComponent(base.id)}`;
    const command = async (kind: Record<string, unknown>, revision = 1) => {
      const response = await http(server, "POST", `${root}/live-command`, { expectedRevision: revision,
        command: { ...kind, commandId: `http.command.${current.live!.state.version + 1}`,
          expectedVersion: current.live!.state.version } });
      assert.equal(response.status, 200, JSON.stringify(response.body));
      current = response.body;
    };
    for (const participantId of contest.entrantIds) await command({ kind: "CHECK_IN", entrantId: participantId });
    await command({ kind: "CALL_CONTEST", contestId: contest.contestId });
    assert.equal(current.live!.state.contests[contest.contestId].calledAt, timestamp);
    await command({ kind: "START_CONTEST", contestId: contest.contestId,
      courtId: contest.courtId, startedAt: "2026-09-20T11:00:00.000Z" });
    await command({ kind: "RECORD_SCORE", contestId: contest.contestId,
      scores: contest.entrantIds.map((entrantId, index) => ({ entrantId, value: 6 - index })) });
    const scoreEventId = current.live!.state.events.at(-1)!.eventId;
    await command({ kind: "COMPLETE_CONTEST", contestId: contest.contestId,
      endedAt: "2026-09-20T11:30:00.000Z" });
    await command({ kind: "CORRECT_OPERATION", supersedesEventId: scoreEventId,
      reason: "Signed score card verified", replacement: { kind: "SET_CONTEST_SCORE",
        contestId: contest.contestId, scores: contest.entrantIds.map((entrantId, index) => ({ entrantId, value: 6 - index * 2 })),
        reason: "Transcription correction" } });
    assert.deepEqual(current.live!.state.contests[contest.contestId].scores.map(({ value }: { value: number }) => value), [6, 4]);

    const noShowContest = current.live!.state.definition.contests.find(({ contestId, entrantIds }) =>
      contestId.includes(".pools.") && entrantIds.every((id) => !contest.entrantIds.includes(id)))!;
    const preview = journey.proposeNoShow(base.id, 1, current.live!.state.version, {
      proposalId: "connected.no-show", contestId: noShowContest.contestId,
      entrantId: noShowContest.entrantIds[0]!, reason: "Absent after reporting window.",
      proposedBy: "operator.lead", proposedAt: timestamp });
    current = journey.approveNoShow(base.id, 1, preview.live!.proposal!.proposalHash,
      "RELEASE_WALKOVER_SLOTS", "tournament.director", timestamp);
    assert.equal(current.live!.publication!.revision, 2);
    assert.equal(current.live!.state.contests[noShowContest.contestId].status, "WALKOVER");

    const postRepairEntrant = current.live!.state.definition.contests.find(({ contestId, entrantIds }) =>
      contestId.includes(".pools.") && current.live!.state.contests[contestId]?.status === "SCHEDULED"
      && entrantIds.every((id) => !current.live!.publication!.affectedEntrantIds.includes(id)))!.entrantIds[0]!;
    await command({ kind: "CHECK_IN", entrantId: postRepairEntrant }, 2);
    const replay = await http(server, "POST", `${root}/live-command`, { expectedRevision: 2,
      command: { kind: "CHECK_IN", entrantId: postRepairEntrant,
        commandId: current.live!.state.events.at(-1)!.commandId,
        expectedVersion: current.live!.state.version - 1 } });
    assert.equal(replay.status, 200);
    assert.equal(replay.body.live.state.proofHash, current.live!.state.proofHash);
    const operations = await http(server, "GET", `/v1/tournaments/${encodeURIComponent(base.id)}/operations`);
    assert.equal(operations.status, 200);
    assert.equal(operations.body.revision, current.live!.state.version);
    assert.equal(operations.body.timezone, "Europe/London");
    assert.equal(operations.body.items.length, 108);
    assert.ok(operations.body.items.some((item: any) => item.contestID === contest.contestId
      && item.status === "UNREPORTED" && item.participantIDs.length === 2));
    const restarted = new CompetitionJourney({ storagePath, organizationId: "org.st-albans",
      participantTokenSecret: secret, now: () => timestamp });
    assert.equal(restarted.read(base.id)!.live!.state.proofHash, current.live!.state.proofHash);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("restart rejects a re-hashed live publication that suppresses affected projection recipients", () => {
  const directory = mkdtempSync(join(tmpdir(), "krateasy-projection-replay-firewall-"));
  const storagePath = join(directory, "journey.json");
  try {
    const journey = new CompetitionJourney({ storagePath, organizationId: "org.st-albans",
      participantTokenSecret: secret, now: () => timestamp });
    const base = published(journey);
    const active = journey.activateLive(base.id, 1, "operator.lead");
    const contest = active.live!.state.definition.contests.find(({ contestId }) => contestId.includes(".pools."))!;
    const proposal = journey.proposeNoShow(base.id, 1, 0, { proposalId: "tamper.no-show",
      contestId: contest.contestId, entrantId: contest.entrantIds[0]!, reason: "Absent.",
      proposedBy: "operator.lead", proposedAt: timestamp });
    journey.approveNoShow(base.id, 1, proposal.live!.proposal!.proposalHash,
      "RELEASE_WALKOVER_SLOTS", "tournament.director", timestamp);
    const envelope = JSON.parse(readFileSync(storagePath, "utf8"));
    const publication = envelope.records[0].live.publication;
    publication.affectedEntrantIds = [];
    const { publicationHash: _publicationHash, ...publicationBody } = publication;
    publication.publicationHash = canonicalHash(publicationBody);
    const { recordHash: _recordHash, ...recordBody } = envelope.records[0];
    envelope.records[0].recordHash = canonicalHash(recordBody);
    envelope.storeHash = canonicalHash(envelope.records);
    writeFileSync(storagePath, `${JSON.stringify(envelope)}\n`);
    assert.throws(() => new CompetitionJourney({ storagePath, organizationId: "org.st-albans",
      participantTokenSecret: secret }), /journey_store_integrity_failed/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
