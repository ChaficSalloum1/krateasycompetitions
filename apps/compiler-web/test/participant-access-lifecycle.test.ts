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
const timestamp = "2026-09-20T13:00:00.000Z";
const v1Secret = "participant-access-v1-signing-secret-for-tests-2026";
const v2Secret = "participant-access-v2-signing-secret-for-tests-2026";

function activeCompetition(journey: CompetitionJourney) {
  const draft = journey.create({ mode: "json", text: fixture }, "organiser.author");
  const preview = journey.planStructuredEdit(draft.id, draft.draftVersion, decisions, "organiser.author");
  const resolved = journey.applyStructuredEdit(draft.id, draft.draftVersion, decisions, preview.previewHash, "organiser.author");
  const compiled = journey.compile(resolved.id, resolved.draftVersion);
  const published = journey.approve(compiled.id, compiled.revision, "organiser.approver",
    compiled.compiled?.requiredAcknowledgementCodes ?? []);
  return journey.activateLive(published.id, 1, "operator.lead");
}

async function http(server: ReturnType<typeof createCompilerServer>, method: "GET" | "POST", url: string,
  body?: unknown): Promise<{ status: number; body: any; headers: Record<string, string> }> {
  const payload = body === undefined ? Buffer.alloc(0) : Buffer.from(JSON.stringify(body));
  const request = Readable.from(payload.length ? [payload] : []) as never;
  Object.assign(request, { method, url, headers: body === undefined ? {} : {
    "content-type": "application/json", "content-length": String(payload.length), "user-agent": "pilot-browser" },
    socket: { remoteAddress: "192.0.2.10" } });
  return new Promise((resolve) => {
    let status = 0; let headers: Record<string, string> = {};
    server.emit("request", request, { writeHead: (nextStatus: number, nextHeaders: Record<string, string>) => {
      status = nextStatus; headers = nextHeaders ?? {};
    }, end: (encoded = "") => {
      const contentType = headers["content-type"] ?? "";
      resolve({ status, headers, body: contentType.includes("application/json") ? JSON.parse(encoded) : encoded });
    } } as never);
  });
}

test("participant access rotates and revokes with idempotent restart-safe evidence", () => {
  const directory = mkdtempSync(join(tmpdir(), "krateasy-participant-token-lifecycle-"));
  const storagePath = join(directory, "journey.json");
  try {
    const first = new CompetitionJourney({ storagePath, organizationId: "org.st-albans",
      participantTokenSecret: v1Secret, participantTokenKeyVersion: "v1", now: () => timestamp });
    const active = activeCompetition(first);
    const participantIds = [...new Set(active.live!.state.definition.contests.flatMap(({ entrantIds }) => entrantIds))].sort();
    const participantId = participantIds[0]!;
    const unaffectedParticipantId = participantIds[1]!;
    const oldAccess = first.issueParticipantAccess({ organizationId: "org.st-albans", competitionId: active.id,
      expectedPublishedRevision: 1, participantId, expiresAt: "2026-09-21T00:00:00.000Z" });
    const unaffected = first.issueParticipantAccess({ organizationId: "org.st-albans", competitionId: active.id,
      expectedPublishedRevision: 1, participantId: unaffectedParticipantId, expiresAt: "2026-09-21T00:00:00.000Z" });

    const rotatedJourney = new CompetitionJourney({ storagePath, organizationId: "org.st-albans",
      participantTokenKeys: { v1: v1Secret, v2: v2Secret }, participantTokenKeyVersion: "v2", now: () => timestamp });
    const rotateInput = { organizationId: "org.st-albans", competitionId: active.id,
      expectedPublishedRevision: 1, expectedOperationalRevision: 1, participantId,
      expiresAt: "2026-09-21T12:00:00.000Z", commandId: "participant.rotate.1",
      actorId: "communications.lead", reason: "Participant requested a replacement link." };
    const rotated = rotatedJourney.rotateParticipantAccess(rotateInput);
    assert.match(rotated.token, /^kp1_[a-f0-9]{64}$/);
    assert.notEqual(rotated.token, oldAccess.token);
    assert.deepEqual(rotatedJourney.rotateParticipantAccess(rotateInput), rotated,
      "replaying the same command must return the same replacement without another mutation");
    assert.throws(() => rotatedJourney.rotateParticipantAccess({ ...rotateInput,
      reason: "A conflicting replay payload." }), /participant_access_command_conflict/);
    assert.throws(() => rotatedJourney.readParticipantNext({ organizationId: "org.st-albans",
      competitionId: active.id, expectedOperationalRevision: 1, token: oldAccess.token, at: timestamp }),
    /participant_access_denied/);
    assert.equal(rotatedJourney.readParticipantNext({ organizationId: "org.st-albans",
      competitionId: active.id, expectedOperationalRevision: 1, token: rotated.token, at: timestamp }).revision, 1);
    assert.equal(rotatedJourney.readParticipantNext({ organizationId: "org.st-albans",
      competitionId: active.id, expectedOperationalRevision: 1, token: unaffected.token, at: timestamp }).revision, 1);

    const revoked = rotatedJourney.revokeParticipantAccess({ organizationId: "org.st-albans",
      competitionId: active.id, expectedPublishedRevision: 1, expectedOperationalRevision: 1,
      participantId, commandId: "participant.revoke.1", actorId: "communications.lead",
      reason: "The replacement device was lost." });
    assert.deepEqual(revoked, { status: "REVOKED", revokedGrantCount: 1 });
    assert.deepEqual(rotatedJourney.revokeParticipantAccess({ organizationId: "org.st-albans",
      competitionId: active.id, expectedPublishedRevision: 1, expectedOperationalRevision: 1,
      participantId, commandId: "participant.revoke.1", actorId: "communications.lead",
      reason: "The replacement device was lost." }), revoked);
    assert.throws(() => rotatedJourney.readParticipantNext({ organizationId: "org.st-albans",
      competitionId: active.id, expectedOperationalRevision: 1, token: rotated.token, at: timestamp }),
    /participant_access_denied/);

    const restarted = new CompetitionJourney({ storagePath, organizationId: "org.st-albans",
      participantTokenKeys: { v1: v1Secret, v2: v2Secret }, participantTokenKeyVersion: "v2", now: () => timestamp });
    assert.throws(() => restarted.readParticipantNext({ organizationId: "org.st-albans",
      competitionId: active.id, expectedOperationalRevision: 1, token: rotated.token, at: timestamp }),
    /participant_access_denied/);
    assert.equal(restarted.readParticipantNext({ organizationId: "org.st-albans", competitionId: active.id,
      expectedOperationalRevision: 1, token: unaffected.token, at: timestamp }).revision, 1);
    const accessEvidence = restarted.readOrganiserLive({ organizationId: "org.st-albans",
      competitionId: active.id, expectedOperationalRevision: 1, at: timestamp }).accessEvidence;
    assert.deepEqual(accessEvidence.map(({ kind, affectedCredentialCount }) => ({ kind, affectedCredentialCount })), [
      { kind: "ROTATED", affectedCredentialCount: 1 }, { kind: "REVOKED", affectedCredentialCount: 1 },
    ]);
    assert.doesNotMatch(JSON.stringify(accessEvidence), /tokenHash|codeHash|secret/);
    assert.throws(() => restarted.rotateParticipantAccess({ ...rotateInput, commandId: "participant.rotate.stale",
      expectedOperationalRevision: 2 }), /journey_revision_conflict/);
    assert.throws(() => restarted.rotateParticipantAccess({ ...rotateInput, organizationId: "org.other",
      commandId: "participant.rotate.cross-org" }), /journey_not_found/);

    const envelope = JSON.parse(readFileSync(storagePath, "utf8"));
    const rotatedGrant = envelope.records[0].participantAccess.find((grant: any) =>
      grant.issuedByCommandId === "participant.rotate.1");
    delete rotatedGrant.revokedAt;
    delete rotatedGrant.revokedBy;
    delete rotatedGrant.revocationReason;
    delete rotatedGrant.revokedByCommandId;
    const { recordHash: _recordHash, ...recordBody } = envelope.records[0];
    envelope.records[0].recordHash = canonicalHash(recordBody);
    envelope.storeHash = canonicalHash(envelope.records);
    writeFileSync(storagePath, `${JSON.stringify(envelope)}\n`);
    assert.throws(() => new CompetitionJourney({ storagePath, organizationId: "org.st-albans",
      participantTokenKeys: { v1: v1Secret, v2: v2Secret }, participantTokenKeyVersion: "v2" }),
    /journey_store_integrity_failed/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("generic event recovery is opaque, exact-head bound and rate limited", async () => {
  const journey = new CompetitionJourney({ organizationId: "org.st-albans",
    participantTokenKeys: { v1: v1Secret }, participantTokenKeyVersion: "v1", now: () => timestamp });
  const active = activeCompetition(journey);
  const participantId = [...new Set(active.live!.state.definition.contests.flatMap(({ entrantIds }) => entrantIds))].sort()[0]!;
  const recovery = journey.issueParticipantRecoveryCode({ organizationId: "org.st-albans",
    competitionId: active.id, expectedPublishedRevision: 1, expectedOperationalRevision: 1,
    participantId, codeExpiresAt: "2026-09-20T20:00:00.000Z", accessExpiresAt: "2026-09-21T00:00:00.000Z",
    commandId: "participant.recovery.issue.1", actorId: "local.communications-lead" });
  assert.match(recovery.code, /^kpr1_[a-f0-9]{32}$/);
  assert.equal(recovery.eventPath, `/next/recover?competition=${encodeURIComponent(active.id)}&revision=1`);
  assert.equal(JSON.stringify(recovery).includes(participantId), false);
  assert.deepEqual(journey.issueParticipantRecoveryCode({ organizationId: "org.st-albans",
    competitionId: active.id, expectedPublishedRevision: 1, expectedOperationalRevision: 1,
    participantId, codeExpiresAt: "2026-09-20T20:00:00.000Z", accessExpiresAt: "2026-09-21T00:00:00.000Z",
    commandId: "participant.recovery.issue.1", actorId: "local.communications-lead" }), recovery);

  const recovered = journey.recoverParticipantAccess({ organizationId: "org.st-albans",
    competitionId: active.id, expectedOperationalRevision: 1, code: recovery.code, at: timestamp });
  const staffIssued = journey.issueParticipantAccess({ organizationId: "org.st-albans", competitionId: active.id,
    expectedPublishedRevision: 1, participantId, expiresAt: "2026-09-21T00:00:00.000Z" });
  assert.deepEqual(journey.readParticipantNext({ organizationId: "org.st-albans", competitionId: active.id,
    expectedOperationalRevision: 1, token: recovered.token, at: timestamp }),
  journey.readParticipantNext({ organizationId: "org.st-albans", competitionId: active.id,
    expectedOperationalRevision: 1, token: staffIssued.token, at: timestamp }),
  "staff lookup and participant recovery must resolve the same minimal projection");
  assert.throws(() => journey.recoverParticipantAccess({ organizationId: "org.st-albans", competitionId: active.id,
    expectedOperationalRevision: 2, code: recovery.code, at: timestamp }), /journey_revision_conflict/);
  assert.throws(() => journey.recoverParticipantAccess({ organizationId: "org.st-albans", competitionId: active.id,
    expectedOperationalRevision: 1, code: `${recovery.code.slice(0, -1)}0`, at: timestamp }),
  /participant_recovery_denied/);

  const server = createCompilerServer({ production: false, competitionJourney: journey,
    organizationId: "org.st-albans" });
  const encodedId = encodeURIComponent(active.id);
  const page = await http(server, "GET", `/next/recover?competition=${encodedId}&revision=1`);
  assert.equal(page.status, 200);
  assert.match(page.body, /Recover my private next action/);
  assert.doesNotMatch(page.body, new RegExp(participantId));
  const eventQr = await http(server, "GET", `/next-recovery-qr.svg?competition=${encodedId}&revision=1`);
  assert.equal(eventQr.status, 200);
  assert.match(eventQr.body, /<svg/);
  assert.doesNotMatch(eventQr.body, /token=|participant/);

  const root = `/v1/competition-journey/${encodedId}`;
  const staffRecovery = await http(server, "POST", `${root}/participant-recovery-code`, {
    expectedPublishedRevision: 1, expectedOperationalRevision: 1, participantId,
    codeExpiresAt: "2026-09-20T20:00:00.000Z", accessExpiresAt: "2026-09-21T00:00:00.000Z",
    commandId: "participant.recovery.issue.1" });
  assert.equal(staffRecovery.status, 201);
  assert.deepEqual(staffRecovery.body, recovery);
  const forgedAuthority = await http(server, "POST", `${root}/participant-recovery-code`, {
    expectedPublishedRevision: 1, expectedOperationalRevision: 1, participantId,
    codeExpiresAt: "2026-09-20T20:00:00.000Z", accessExpiresAt: "2026-09-21T00:00:00.000Z",
    commandId: "participant.recovery.forged", actorId: "attacker" });
  assert.equal(forgedAuthority.status, 400);
  assert.equal(forgedAuthority.body.error, "invalid_journey_command");
  const exchange = await http(server, "POST", `${root}/participant-recover`, {
    expectedOperationalRevision: 1, code: recovery.code });
  assert.equal(exchange.status, 200);
  assert.equal(exchange.body.token, recovered.token);
  assert.equal(JSON.stringify(exchange.body).includes(participantId), false);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const denied = await http(server, "POST", `${root}/participant-recover`, {
      expectedOperationalRevision: 1, code: "kpr1_00000000000000000000000000000000" });
    assert.equal(denied.status, 400);
    assert.deepEqual(denied.body, { error: "participant_recovery_denied" });
  }
  const limited = await http(server, "POST", `${root}/participant-recover`, {
    expectedOperationalRevision: 1, code: "kpr1_00000000000000000000000000000000" });
  assert.equal(limited.status, 429);
  assert.equal(limited.body.error, "participant_recovery_rate_limited");
  assert.equal(limited.headers["retry-after"], "60");
  assert.throws(() => journey.recoverParticipantAccess({ organizationId: "org.st-albans", competitionId: active.id,
    expectedOperationalRevision: 1, code: recovery.code, at: "2026-09-20T20:00:00.000Z" }),
  /participant_recovery_denied/);
  const rotated = await http(server, "POST", `${root}/participant-access-rotate`, {
    expectedPublishedRevision: 1, expectedOperationalRevision: 1, participantId,
    expiresAt: "2026-09-21T12:00:00.000Z", commandId: "participant.recovery.rotate.1",
    reason: "Replace all participant credentials." });
  assert.equal(rotated.status, 201);
  assert.throws(() => journey.recoverParticipantAccess({ organizationId: "org.st-albans", competitionId: active.id,
    expectedOperationalRevision: 1, code: recovery.code, at: timestamp }), /participant_recovery_denied/);
  const revoked = await http(server, "POST", `${root}/participant-access-revoke`, {
    expectedPublishedRevision: 1, expectedOperationalRevision: 1, participantId,
    commandId: "participant.recovery.revoke.1", reason: "Replacement device reported lost." });
  assert.equal(revoked.status, 200);
  assert.equal(revoked.body.revokedGrantCount, 1);
  const rejectedRotatedToken = await http(server, "GET",
    `${root}/participant-next?revision=1&token=${rotated.body.token}`);
  assert.equal(rejectedRotatedToken.status, 400);
  assert.equal(rejectedRotatedToken.body.error, "participant_access_denied");
});
