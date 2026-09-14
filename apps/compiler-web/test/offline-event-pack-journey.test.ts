import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import { canonicalHash } from "@tournament-os/tournament-schema";
import { replayLiveOperationsEvents } from "@tournament-os/competition-engine";
import { CompetitionJourney } from "../src/competition-journey.js";
import { verifyOfflineEventPack } from "../src/offline-event-pack.js";
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
const expiresAt = "2026-09-20T21:00:00.000Z";
const signingSeedHex = "9f4f6abf4f1433ccb52966db4b69e85f71bc78b39bece0413e2ef56ef34a6dd8";

function published(journey: CompetitionJourney) {
  const draft = journey.create({ mode: "json", text: fixture }, "organiser.author");
  const preview = journey.planStructuredEdit(draft.id, draft.draftVersion, decisions, "organiser.author");
  const resolved = journey.applyStructuredEdit(draft.id, draft.draftVersion, decisions, preview.previewHash, "organiser.author");
  const compiled = journey.compile(resolved.id, resolved.draftVersion);
  return journey.approve(compiled.id, compiled.revision, "organiser.approver",
    compiled.compiled?.requiredAcknowledgementCodes ?? []);
}

async function post(server: ReturnType<typeof createCompilerServer>, url: string, body: unknown) {
  const payload = Buffer.from(JSON.stringify(body));
  const request = Readable.from([payload]) as never;
  Object.assign(request, { method: "POST", url, headers: {
    "content-type": "application/json", "content-length": String(payload.length) } });
  return new Promise<{ status: number; body: any }>((resolve) => {
    let status = 0; let headers: Record<string, string> = {};
    server.emit("request", request, { writeHead(next: number, nextHeaders: Record<string, string>) {
      status = next; headers = nextHeaders ?? {};
    }, end(encoded = "") {
      resolve({ status, body: (headers["content-type"] ?? "").includes("application/json") ? JSON.parse(encoded) : encoded });
    } } as never);
  });
}

test("server signs one scoped offline pack from the exact published revision and operational head", () => {
  const journey = new CompetitionJourney({ organizationId: "org.st-albans", offlinePackSigningSeedHex: signingSeedHex,
    now: () => timestamp });
  const base = published(journey);
  const active = journey.activateLive(base.id, 1, "operator.lead");
  const contest = active.live!.state.definition.contests.find(({ contestId }) => contestId.includes(".pools."))!;
  const live = journey.submitLiveCommand(base.id, 1, { kind: "CALL_CONTEST", contestId: contest.contestId,
    commandId: "pack.call.1", expectedVersion: 0, actorId: "operator.lead", occurredAt: timestamp });

  const pack = journey.issueOfflineEventPack({ organizationId: "org.st-albans", competitionId: base.id,
    expectedPublishedRevision: 1, expectedOperationalRevision: 1, expiresAt });
  const verified = verifyOfflineEventPack(pack, pack.publicKeyBase64, timestamp);

  assert.equal(verified.organizationId, "org.st-albans");
  assert.equal(verified.competitionId, base.id);
  assert.equal(verified.publishedRevision, 1);
  assert.equal(verified.operationalRevision, 1);
  assert.equal(verified.liveVersion, live.live!.state.version);
  assert.equal(verified.authority.publicationCertificateHash, base.publication!.certificateHash);
  assert.equal(verified.authority.stateProofHash, live.live!.state.proofHash);
  assert.equal(verified.publicProjection.contests.length, 108);
  assert.equal(verified.participantLookup.length, 48);
  assert.equal(verified.publicProjection.contests.find(({ contestId }) => contestId === contest.contestId)?.status, "CALLED");
  assert.equal(verified.emergencyReadiness.status, "BLOCKED_MISSING_AUTHORITY_DATA");
  assert.deepEqual(verified.emergencyReadiness.missingDecisionCodes, [
    "AED_AND_FIRST_AID_LOCATION", "AMBULANCE_ACCESS", "EMERGENCY_CONTACT_NUMBER", "EVACUATION_AND_ASSEMBLY",
    "INCIDENT_LIAISON", "NAMED_RESPONDERS_AND_BACKUPS", "PRINTED_COPY_REHEARSAL", "VENUE_ADDRESS",
  ]);
});

test("offline packs fail closed for stale, cross-organisation, unpublished, expired, and forged inputs", () => {
  const journey = new CompetitionJourney({ organizationId: "org.st-albans", offlinePackSigningSeedHex: signingSeedHex,
    now: () => timestamp });
  const base = published(journey);
  journey.activateLive(base.id, 1, "operator.lead");
  const issue = (overrides: Record<string, unknown> = {}) => journey.issueOfflineEventPack({
    organizationId: "org.st-albans", competitionId: base.id, expectedPublishedRevision: 1,
    expectedOperationalRevision: 1, expiresAt, ...overrides,
  } as never);
  assert.throws(() => issue({ organizationId: "org.other" }), /journey_not_found/);
  assert.throws(() => issue({ expectedPublishedRevision: 2 }), /journey_revision_conflict/);
  assert.throws(() => issue({ expectedOperationalRevision: 2 }), /journey_revision_conflict/);
  assert.throws(() => issue({ expiresAt: timestamp }), /invalid_offline_pack_expiry/);
  const pack = issue();
  assert.throws(() => verifyOfflineEventPack({ ...pack, signatureBase64: `${pack.signatureBase64.slice(0, -2)}AA` },
    pack.publicKeyBase64, timestamp), /offline_pack_signature_invalid/);
  assert.throws(() => verifyOfflineEventPack(pack, Buffer.alloc(32, 7).toString("base64"), timestamp),
    /offline_pack_trust_mismatch/);
  assert.throws(() => verifyOfflineEventPack(pack, pack.publicKeyBase64, expiresAt), /offline_pack_expired/);

  const draftJourney = new CompetitionJourney({ organizationId: "org.st-albans", offlinePackSigningSeedHex: signingSeedHex,
    now: () => timestamp });
  const draft = draftJourney.create({ mode: "json", text: fixture }, "organiser.author");
  assert.throws(() => draftJourney.issueOfflineEventPack({ organizationId: "org.st-albans", competitionId: draft.id,
    expectedPublishedRevision: 1, expectedOperationalRevision: 1, expiresAt }), /journey_revision_conflict/);
});

test("offline pack replay is deterministic across restart and HTTP accepts revision identity plus expiry only", async () => {
  const directory = mkdtempSync(join(tmpdir(), "krateasy-offline-pack-"));
  const storagePath = join(directory, "journey.json");
  try {
    const journey = new CompetitionJourney({ storagePath, organizationId: "org.st-albans",
      offlinePackSigningSeedHex: signingSeedHex, now: () => timestamp });
    const base = published(journey);
    journey.activateLive(base.id, 1, "operator.lead");
    const input = { organizationId: "org.st-albans", competitionId: base.id,
      expectedPublishedRevision: 1, expectedOperationalRevision: 1, expiresAt };
    const first = journey.issueOfflineEventPack(input);
    const stored = JSON.parse(readFileSync(storagePath, "utf8"));
    const { recordHash, ...storedBody } = stored.records[0];
    assert.equal(recordHash, canonicalHash(storedBody), "the activated record must remain canonical after JSON persistence");
    const replay = replayLiveOperationsEvents(storedBody.live.state.definition, storedBody.live.state.events);
    assert.equal(replay.valid, true);
    const { proofHash: _storedProof, ...storedLiveBody } = storedBody.live.state;
    assert.equal(storedBody.live.state.proofHash, canonicalHash(storedLiveBody));
    const { proofHash: _replayedProof, ...replayedLiveBody } = replay.state;
    assert.deepEqual(replayedLiveBody, storedLiveBody);
    assert.equal(replay.state.proofHash, storedBody.live.state.proofHash);
    const restarted = new CompetitionJourney({ storagePath, organizationId: "org.st-albans",
      offlinePackSigningSeedHex: signingSeedHex, now: () => timestamp });
    assert.deepEqual(restarted.issueOfflineEventPack(input), first);

    const server = createCompilerServer({ production: false, competitionJourney: restarted,
      organizationId: "org.st-albans", now: () => timestamp });
    const root = `/v1/competition-journey/${encodeURIComponent(base.id)}/offline-pack`;
    const accepted = await post(server, root, { expectedPublishedRevision: 1, expectedOperationalRevision: 1, expiresAt });
    assert.equal(accepted.status, 200);
    assert.deepEqual(accepted.body, first);
    const forged = await post(server, root, { expectedPublishedRevision: 1, expectedOperationalRevision: 1, expiresAt,
      publicProjection: { contests: [] }, emergencyReadiness: { status: "READY" }, signatureBase64: "forged" });
    assert.equal(forged.status, 400);
    assert.equal(forged.body.error, "invalid_journey_command");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
