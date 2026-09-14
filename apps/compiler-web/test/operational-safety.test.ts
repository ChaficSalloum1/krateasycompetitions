import assert from "node:assert/strict";
import test from "node:test";
import {
  createOperationalSafetyState,
  replayOperationalSafetyEvents,
  submitOperationalSafetyCommand,
  verifyOperationalSafetyState,
  type OperationalAuthorityAssignments,
} from "../src/operational-safety.js";

const authority: OperationalAuthorityAssignments = {
  incidentLead: "actor.incident",
  competitionLead: "actor.competition",
  safetyLead: "actor.safety",
  communicationsLead: "actor.comms",
  scribe: "actor.scribe",
};

test("life-safety stop is immediate, role-bound, typed and deterministically replayable", () => {
  let state = createOperationalSafetyState(authority);
  const recorded = submitOperationalSafetyCommand(state, {
    kind: "RECORD_INCIDENT", commandId: "incident.1", expectedVersion: 0,
    actorId: "actor.scribe", authorityFunction: "SCRIBE", occurredAt: "2026-09-14T10:00:00.000Z",
    incident: { incidentId: "incident.medical.1", category: "MEDICAL", severity: "LIFE_SAFETY",
      acknowledgement: "ACKNOWLEDGED", location: "Court 3", summary: "Participant collapsed beside Court 3.",
      affectedContestIds: ["GROUP.POOL_A.R1.M1"], affectedResourceIds: ["COURT_3"],
      affectedParticipantIds: ["PAIR_01"], evidenceRefs: ["radio-log-17"] },
  });
  assert.equal(recorded.accepted, true);
  state = recorded.state;
  const stopped = submitOperationalSafetyCommand(state, {
    kind: "TRANSITION_MODE", commandId: "mode.stop.1", expectedVersion: 1,
    actorId: "actor.safety", authorityFunction: "SAFETY_LEAD", occurredAt: "2026-09-14T10:00:01.000Z",
    targetMode: "STOPPED", reason: "Life-safety incident at Court 3.", sourceIncidentId: "incident.medical.1",
    publicMessageCode: "SAFETY_STOP_FOLLOW_VENUE_INSTRUCTIONS", nextUpdateAt: "2026-09-14T10:10:00.000Z",
    scope: { kind: "VENUE", ids: ["encourt-st-albans"] },
  });
  assert.equal(stopped.accepted, true);
  assert.equal(stopped.state.mode, "STOPPED");
  assert.equal(stopped.state.publicStatus.instruction, "Play is stopped. Follow venue staff instructions and await the next update.");
  assert.equal(stopped.state.activeIncidentId, "incident.medical.1");
  assert.equal(stopped.state.version, 2);

  const duplicate = submitOperationalSafetyCommand(stopped.state, {
    kind: "TRANSITION_MODE", commandId: "mode.stop.1", expectedVersion: 1,
    actorId: "actor.safety", authorityFunction: "SAFETY_LEAD", occurredAt: "2026-09-14T10:00:01.000Z",
    targetMode: "STOPPED", reason: "Life-safety incident at Court 3.", sourceIncidentId: "incident.medical.1",
    publicMessageCode: "SAFETY_STOP_FOLLOW_VENUE_INSTRUCTIONS", nextUpdateAt: "2026-09-14T10:10:00.000Z",
    scope: { kind: "VENUE", ids: ["encourt-st-albans"] },
  });
  assert.equal(duplicate.accepted, true);
  assert.equal(duplicate.idempotentReplay, true);
  assert.equal(duplicate.state.proofHash, stopped.state.proofHash);

  const replay = replayOperationalSafetyEvents(authority, stopped.state.events);
  assert.equal(replay.valid, true);
  assert.equal(replay.state.proofHash, stopped.state.proofHash);
  assert.equal(verifyOperationalSafetyState(stopped.state), true);
  assert.equal(verifyOperationalSafetyState({ ...stopped.state, mode: "NORMAL" }), false);
});

test("forged authority, stale heads, free-form public messages and command reuse fail closed", () => {
  const state = createOperationalSafetyState(authority);
  const base = { kind: "TRANSITION_MODE" as const, commandId: "mode.pause.1", expectedVersion: 0,
    actorId: "actor.competition", authorityFunction: "COMPETITION_LEAD" as const,
    occurredAt: "2026-09-14T10:00:00.000Z", targetMode: "PAUSED" as const,
    reason: "Venue check.", publicMessageCode: "PLAY_PAUSED_STAY_CLEAR" as const,
    nextUpdateAt: "2026-09-14T10:10:00.000Z", scope: { kind: "VENUE" as const, ids: ["venue"] } };
  assert.equal(submitOperationalSafetyCommand(state, { ...base, actorId: "actor.attacker" }).accepted, false);
  assert.equal(submitOperationalSafetyCommand(state, { ...base, expectedVersion: 1 }).accepted, false);
  assert.equal(submitOperationalSafetyCommand(state, { ...base,
    publicMessageCode: "SAFETY_STOP_FOLLOW_VENUE_INSTRUCTIONS" }).accepted, false);
  const accepted = submitOperationalSafetyCommand(state, base);
  assert.equal(accepted.accepted, true);
  assert.equal(submitOperationalSafetyCommand(accepted.state, { ...base, reason: "Reused identity." }).accepted, false);
});

test("restart requires distinct safety and competition clearances and incident-lead authority", () => {
  let state = createOperationalSafetyState(authority);
  const stopped = submitOperationalSafetyCommand(state, { kind: "TRANSITION_MODE", commandId: "stop", expectedVersion: 0,
    actorId: "actor.safety", authorityFunction: "SAFETY_LEAD", occurredAt: "2026-09-14T10:00:00.000Z",
    targetMode: "STOPPED", reason: "Safety stop.", publicMessageCode: "SAFETY_STOP_FOLLOW_VENUE_INSTRUCTIONS",
    nextUpdateAt: "2026-09-14T10:10:00.000Z", scope: { kind: "VENUE", ids: ["venue"] } });
  assert.equal(stopped.accepted, true); state = stopped.state;
  const premature = submitOperationalSafetyCommand(state, { kind: "TRANSITION_MODE", commandId: "recover.early",
    expectedVersion: 1, actorId: "actor.incident", authorityFunction: "INCIDENT_LEAD",
    occurredAt: "2026-09-14T10:05:00.000Z", targetMode: "RECOVERING", reason: "Trying early.",
    publicMessageCode: "RECOVERY_IN_PROGRESS_AWAIT_UPDATE", nextUpdateAt: "2026-09-14T10:15:00.000Z",
    scope: { kind: "VENUE", ids: ["venue"] } });
  assert.equal(premature.accepted, false);
  const safety = submitOperationalSafetyCommand(state, { kind: "RECORD_RESTART_CLEARANCE", commandId: "clear.safety",
    expectedVersion: 1, actorId: "actor.safety", authorityFunction: "SAFETY_LEAD",
    occurredAt: "2026-09-14T10:06:00.000Z", clearance: "SAFETY",
    evidenceRefs: ["venue-clearance-1", "services-restored-1"], statement: "Venue and required services are ready." });
  assert.equal(safety.accepted, true); state = safety.state;
  const competition = submitOperationalSafetyCommand(state, { kind: "RECORD_RESTART_CLEARANCE", commandId: "clear.competition",
    expectedVersion: 2, actorId: "actor.competition", authorityFunction: "COMPETITION_LEAD",
    occurredAt: "2026-09-14T10:07:00.000Z", clearance: "COMPETITION",
    evidenceRefs: ["officials-ready-1", "schedule-checked-1"], statement: "Officials and competition state are ready." });
  assert.equal(competition.accepted, true); state = competition.state;
  const recovering = submitOperationalSafetyCommand(state, { kind: "TRANSITION_MODE", commandId: "recover",
    expectedVersion: 3, actorId: "actor.incident", authorityFunction: "INCIDENT_LEAD",
    occurredAt: "2026-09-14T10:08:00.000Z", targetMode: "RECOVERING", reason: "Controlled restoration.",
    publicMessageCode: "RECOVERY_IN_PROGRESS_AWAIT_UPDATE", nextUpdateAt: "2026-09-14T10:15:00.000Z",
    scope: { kind: "VENUE", ids: ["venue"] } });
  assert.equal(recovering.accepted, true); state = recovering.state;
  const normal = submitOperationalSafetyCommand(state, { kind: "TRANSITION_MODE", commandId: "restart",
    expectedVersion: 4, actorId: "actor.incident", authorityFunction: "INCIDENT_LEAD",
    occurredAt: "2026-09-14T10:12:00.000Z", targetMode: "NORMAL", reason: "Authorised restart.",
    publicMessageCode: "PLAY_RESUMED_CHECK_NEXT", scope: { kind: "VENUE", ids: ["venue"] } });
  assert.equal(normal.accepted, true);
  assert.equal(normal.state.mode, "NORMAL");
  assert.equal(normal.state.restartClearances.safety?.actorId, "actor.safety");
  assert.equal(normal.state.restartClearances.competition?.actorId, "actor.competition");
});

test("command transfer is explicit, evidence-bound and immediately changes the active authority", () => {
  const state = createOperationalSafetyState(authority);
  const transfer = submitOperationalSafetyCommand(state, { kind: "TRANSFER_AUTHORITY", commandId: "transfer.1",
    expectedVersion: 0, actorId: "actor.competition", authorityFunction: "COMPETITION_LEAD",
    occurredAt: "2026-09-14T10:00:00.000Z", transferredFunction: "COMPETITION_LEAD",
    newActorId: "actor.competition.relief", reason: "Scheduled shift handover.", evidenceRefs: ["handover-log-1"] });
  assert.equal(transfer.accepted, true);
  assert.equal(transfer.state.authorityAssignments.competitionLead, "actor.competition.relief");
  const pause = { kind: "TRANSITION_MODE" as const, commandId: "pause.after-transfer", expectedVersion: 1,
    authorityFunction: "COMPETITION_LEAD" as const, occurredAt: "2026-09-14T10:01:00.000Z",
    targetMode: "PAUSED" as const, reason: "Scheduled venue check.", publicMessageCode: "PLAY_PAUSED_STAY_CLEAR" as const,
    nextUpdateAt: "2026-09-14T10:10:00.000Z", scope: { kind: "VENUE" as const, ids: ["venue"] } };
  assert.equal(submitOperationalSafetyCommand(transfer.state, { ...pause, actorId: "actor.competition" }).accepted, false);
  assert.equal(submitOperationalSafetyCommand(transfer.state, { ...pause, actorId: "actor.competition.relief" }).accepted, true);
});
