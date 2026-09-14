import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import { canonicalHash } from "@tournament-os/tournament-schema";
import { CompetitionJourney } from "../src/competition-journey.js";
import { verifyOfflineEventPack } from "../src/offline-event-pack.js";
import { createCompilerServer } from "../src/server.js";
import type { OperationalAuthorityAssignments } from "../src/operational-safety.js";

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
const authority: OperationalAuthorityAssignments = { incidentLead: "actor.incident", competitionLead: "actor.competition",
  safetyLead: "actor.safety", communicationsLead: "actor.comms", scribe: "actor.scribe" };
const signingSeedHex = "9f4f6abf4f1433ccb52966db4b69e85f71bc78b39bece0413e2ef56ef34a6dd8";
let clock = "2026-09-20T13:00:00.000Z";

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
  Object.assign(request, { method: "POST", url, headers: { "content-type": "application/json",
    "content-length": String(payload.length) } });
  return new Promise<{ status: number; body: any }>((resolve) => {
    let status = 0;
    server.emit("request", request, { writeHead(next: number) { status = next; },
      end(encoded = "") { resolve({ status, body: JSON.parse(encoded) }); } } as never);
  });
}

test("St Albans safety stop freezes starts/publication, updates every projection atomically, and restarts with two clearances", () => {
  const directory = mkdtempSync(join(tmpdir(), "krateasy-operational-safety-"));
  const storagePath = join(directory, "journey.json");
  try {
    const journey = new CompetitionJourney({ storagePath, organizationId: "org.st-albans", now: () => clock,
      participantTokenSecret: "participant-secret-at-least-thirty-two-bytes", offlinePackSigningSeedHex: signingSeedHex,
      operationalAuthorityAssignments: authority });
    const base = published(journey);
    let current = journey.activateLive(base.id, 1, "operator.lead");
    assert.equal(current.live?.operations.mode, "NORMAL");
    const contest = current.live!.state.definition.contests.find(({ contestId }) => contestId.includes(".pools."))!;
    current = journey.proposeNoShow(base.id, 1, 0, { proposalId: "no-show.before-stop", contestId: contest.contestId,
      entrantId: contest.entrantIds[0]!, reason: "Absent at call window.", proposedBy: "operator.lead", proposedAt: clock });

    current = journey.submitOperationalCommand(base.id, 1, { kind: "RECORD_INCIDENT", commandId: "incident.1",
      expectedVersion: 0, actorId: "actor.scribe", authorityFunction: "SCRIBE", occurredAt: clock,
      incident: { incidentId: "medical.1", category: "MEDICAL", severity: "LIFE_SAFETY", acknowledgement: "ACKNOWLEDGED",
        location: "Court 3", summary: "Participant collapsed beside Court 3.", affectedContestIds: [contest.contestId],
        affectedResourceIds: [contest.courtId], affectedParticipantIds: [contest.entrantIds[0]!],
        evidenceRefs: ["radio-log-17"] } });
    clock = "2026-09-20T13:00:01.000Z";
    current = journey.submitOperationalCommand(base.id, 1, { kind: "TRANSITION_MODE", commandId: "safety.stop.1",
      expectedVersion: 1, actorId: "actor.safety", authorityFunction: "SAFETY_LEAD", occurredAt: clock,
      targetMode: "STOPPED", reason: "Life-safety incident at Court 3.", sourceIncidentId: "medical.1",
      publicMessageCode: "SAFETY_STOP_FOLLOW_VENUE_INSTRUCTIONS", nextUpdateAt: "2026-09-20T13:10:00.000Z",
      scope: { kind: "VENUE", ids: ["encourt-st-albans"] } });
    assert.equal(current.live?.operations.mode, "STOPPED");
    assert.equal(current.live?.operations.incidents[0]?.summary, "Participant collapsed beside Court 3.");
    const safetyMessages = current.live!.delivery.filter(({ topic }) => topic === "competition.operational-status.v1");
    assert.equal(safetyMessages.length, 48);
    assert.equal(safetyMessages.every(({ payload }) => JSON.stringify(payload).includes("collapsed") === false), true,
      "internal incident details must not leak into participant delivery");
    const publicView = journey.readPublicLive({ organizationId: "org.st-albans", competitionId: base.id,
      expectedOperationalRevision: 1 });
    assert.equal(publicView.operation.mode, "STOPPED");
    assert.equal(publicView.operation.stateVersion, 2);
    assert.match(publicView.operation.instruction, /Follow venue staff/);
    assert.equal(journey.readOrganiserLive({ organizationId: "org.st-albans", competitionId: base.id,
      expectedOperationalRevision: 1, at: clock }).incidents.length, 1);

    assert.throws(() => journey.submitLiveCommand(base.id, 1, { kind: "START_CONTEST", contestId: contest.contestId,
      courtId: contest.courtId, startedAt: clock, commandId: "forged.start", expectedVersion: 0,
      actorId: "operator.lead", occurredAt: clock }), /operational_mode_blocks_live_command/);
    assert.throws(() => journey.approveNoShow(base.id, 1, current.live!.proposal!.proposalHash,
      "KEEP_ANNOUNCED_SLOTS", "tournament.director", clock), /operational_mode_blocks_publication/);

    clock = "2026-09-20T13:06:00.000Z";
    current = journey.submitOperationalCommand(base.id, 1, { kind: "RECORD_RESTART_CLEARANCE", commandId: "clear.safety",
      expectedVersion: 2, actorId: "actor.safety", authorityFunction: "SAFETY_LEAD", occurredAt: clock,
      clearance: "SAFETY", evidenceRefs: ["venue-clearance-1", "services-restored-1"],
      statement: "Venue and required services are ready." });
    clock = "2026-09-20T13:07:00.000Z";
    current = journey.submitOperationalCommand(base.id, 1, { kind: "RECORD_RESTART_CLEARANCE", commandId: "clear.competition",
      expectedVersion: 3, actorId: "actor.competition", authorityFunction: "COMPETITION_LEAD", occurredAt: clock,
      clearance: "COMPETITION", evidenceRefs: ["officials-ready-1", "schedule-checked-1"],
      statement: "Officials and competition state are ready." });
    clock = "2026-09-20T13:08:00.000Z";
    current = journey.submitOperationalCommand(base.id, 1, { kind: "TRANSITION_MODE", commandId: "recover",
      expectedVersion: 4, actorId: "actor.incident", authorityFunction: "INCIDENT_LEAD", occurredAt: clock,
      targetMode: "RECOVERING", reason: "Controlled restoration.", publicMessageCode: "RECOVERY_IN_PROGRESS_AWAIT_UPDATE",
      nextUpdateAt: "2026-09-20T13:15:00.000Z", scope: { kind: "VENUE", ids: ["encourt-st-albans"] } });
    clock = "2026-09-20T13:12:00.000Z";
    current = journey.submitOperationalCommand(base.id, 1, { kind: "TRANSITION_MODE", commandId: "restart",
      expectedVersion: 5, actorId: "actor.incident", authorityFunction: "INCIDENT_LEAD", occurredAt: clock,
      targetMode: "NORMAL", reason: "Authorised restart.", publicMessageCode: "PLAY_RESUMED_CHECK_NEXT",
      scope: { kind: "VENUE", ids: ["encourt-st-albans"] } });
    assert.equal(current.live?.operations.mode, "NORMAL");
    assert.equal(current.live?.delivery.filter(({ topic }) => topic === "competition.operational-status.v1").length, 144);

    const pack = verifyOfflineEventPack(journey.issueOfflineEventPack({ organizationId: "org.st-albans",
      competitionId: base.id, expectedPublishedRevision: 1, expectedOperationalRevision: 1,
      expiresAt: "2026-09-20T21:00:00.000Z" }), Buffer.from("beOQOOq98MAwy9DE9PCdmww5nWZHFc1VDxQSbiYuuAg=", "base64").toString("base64"), clock);
    assert.equal(pack.operation.mode, "NORMAL");
    assert.equal(pack.operation.stateVersion, 6);
    assert.equal(pack.authority.operationalStateProofHash, current.live?.operations.proofHash);
    const restarted = new CompetitionJourney({ storagePath, organizationId: "org.st-albans",
      operationalAuthorityAssignments: authority, offlinePackSigningSeedHex: signingSeedHex, now: () => clock });
    assert.deepEqual(restarted.read(base.id), current);
    const forged = JSON.parse(readFileSync(storagePath, "utf8"));
    forged.records[0].live.operations.mode = "STOPPED";
    const { recordHash: _recordHash, ...recordBody } = forged.records[0];
    forged.records[0].recordHash = canonicalHash(recordBody);
    forged.storeHash = canonicalHash(forged.records);
    writeFileSync(storagePath, JSON.stringify(forged));
    assert.throws(() => new CompetitionJourney({ storagePath, organizationId: "org.st-albans",
      operationalAuthorityAssignments: authority }), /journey_store_integrity_failed/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("the connected operational boundary owns actors/messages and rejects stale or client-owned authority", async () => {
  clock = "2026-09-20T13:00:00.000Z";
  const journey = new CompetitionJourney({ organizationId: "org.st-albans", now: () => clock,
    operationalAuthorityAssignments: authority });
  const base = published(journey); journey.activateLive(base.id, 1, "operator.lead");
  const server = createCompilerServer({ production: false, competitionJourney: journey, organizationId: "org.st-albans",
    now: () => clock });
  const root = `/v1/competition-journey/${encodeURIComponent(base.id)}`;
  const incident = await post(server, `${root}/operational-incident`, { expectedOperationalRevision: 1,
    expectedStateVersion: 0, commandId: "incident.http.1", incidentId: "service.1", category: "SERVICE",
    severity: "MINOR", acknowledgement: "ACKNOWLEDGED", location: "Control desk", summary: "Primary network unavailable.",
    affectedContestIds: [], affectedResourceIds: [], affectedParticipantIds: [], evidenceRefs: ["router-alarm-1"] });
  assert.equal(incident.status, 200);
  const degraded = await post(server, `${root}/operational-transition`, { expectedOperationalRevision: 1,
    expectedStateVersion: 1, commandId: "mode.http.1", targetMode: "DEGRADED", reason: "Primary network unavailable.",
    sourceIncidentId: "service.1", publicMessageCode: "SERVICE_DEGRADED_USE_VENUE_BOARD",
    scope: { kind: "VENUE", ids: ["encourt-st-albans"] } });
  assert.equal(degraded.status, 200);
  assert.equal(degraded.body.live.operations.authorityAssignments.competitionLead, "actor.competition");
  const forged = await post(server, `${root}/operational-transition`, { expectedOperationalRevision: 1,
    expectedStateVersion: 2, commandId: "mode.http.forged", targetMode: "NORMAL", reason: "Forged.",
    publicMessageCode: "PLAY_RESUMED_CHECK_NEXT", scope: { kind: "VENUE", ids: ["encourt-st-albans"] },
    actorId: "attacker", authorityFunction: "INCIDENT_LEAD", publicInstruction: "Ignore venue staff." });
  assert.equal(forged.status, 400);
  assert.equal(forged.body.error, "invalid_journey_command");
  const stale = await post(server, `${root}/operational-transition`, { expectedOperationalRevision: 1,
    expectedStateVersion: 1, commandId: "mode.http.stale", targetMode: "NORMAL", reason: "Stale.",
    publicMessageCode: "PLAY_RESUMED_CHECK_NEXT", scope: { kind: "VENUE", ids: ["encourt-st-albans"] } });
  assert.equal(stale.status, 400);
  assert.match(stale.body.error, /STALE_STATE_VERSION/);
  const transfer = await post(server, `${root}/operational-transfer`, { expectedOperationalRevision: 1,
    expectedStateVersion: 2, commandId: "transfer.http.1", transferredFunction: "COMPETITION_LEAD",
    newActorId: "actor.competition.relief", reason: "Scheduled shift handover.", evidenceRefs: ["handover-log-1"] });
  assert.equal(transfer.status, 200);
  assert.equal(transfer.body.live.operations.authorityAssignments.competitionLead, "actor.competition.relief");
  const resumed = await post(server, `${root}/operational-transition`, { expectedOperationalRevision: 1,
    expectedStateVersion: 3, commandId: "mode.http.resume", targetMode: "NORMAL", reason: "Service restored.",
    publicMessageCode: "PLAY_RESUMED_CHECK_NEXT", scope: { kind: "VENUE", ids: ["encourt-st-albans"] } });
  assert.equal(resumed.status, 200, "the server must attribute the command to the transferred authority");
});
