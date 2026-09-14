import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
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

test("an in-progress St Albans overrun preserves actual truth and publishes a guarded downstream repair", () => {
  const directory = mkdtempSync(join(tmpdir(), "krateasy-delay-overrun-"));
  const storagePath = join(directory, "journey.json");
  try {
    const journey = new CompetitionJourney({ storagePath, now: () => "2026-09-20T12:30:00.000Z" });
    const base = published(journey);
    let current = journey.activateLive(base.id, base.revision, "operator.lead");
    const inProgress = current.live!.state.definition.contests.find(({ courtId, scheduledStart, scheduledEnd }) =>
      courtId === "venue.courts.main.2" && scheduledStart === "2026-09-20T12:30:00.000Z"
      && scheduledEnd === "2026-09-20T13:00:00.000Z")!;
    const displaced = current.live!.state.definition.contests.find(({ courtId, scheduledStart }) =>
      courtId === inProgress.courtId && scheduledStart === inProgress.scheduledEnd)!;
    const protectedEntrants = new Set([...inProgress.entrantIds, ...displaced.entrantIds]);
    const released = current.live!.state.definition.contests.find((contest) => contest.contestId.includes(".pools.")
      && contest.scheduledStart === displaced.scheduledStart && contest.courtId !== displaced.courtId
      && contest.entrantIds.every((id) => !protectedEntrants.has(id)))!;

    const submit = (command: Record<string, unknown>, occurredAt: string) => {
      current = journey.submitLiveCommand(base.id, base.revision, { ...command,
        commandId: `delay.setup.${current.live!.state.version + 1}`, expectedVersion: current.live!.state.version,
        actorId: "operator.lead", occurredAt } as never);
    };
    for (const entrantId of inProgress.fixedEntrantIds ?? inProgress.entrantIds.slice(0, 2))
      submit({ kind: "CHECK_IN", entrantId }, "2026-09-20T12:25:00.000Z");
    submit({ kind: "START_CONTEST", contestId: inProgress.contestId, courtId: inProgress.courtId,
      startedAt: "2026-09-20T12:30:00.000Z" }, "2026-09-20T12:30:00.000Z");

    const noShow = journey.proposeNoShow(base.id, base.revision, current.live!.state.version, {
      proposalId: "delay.capacity-release", contestId: released.contestId, entrantId: released.entrantIds[0]!,
      reason: "Absent after final call", proposedBy: "operator.lead", proposedAt: "2026-09-20T12:45:00.000Z",
    });
    current = journey.approveNoShow(base.id, base.revision, noShow.live!.proposal!.proposalHash,
      "RELEASE_WALKOVER_SLOTS", "tournament.director", "2026-09-20T12:46:00.000Z");
    const actualBefore = structuredClone(current.live!.state.contests[inProgress.contestId]);
    const deliveryBefore = structuredClone(current.live!.delivery);

    const preview = journey.proposeDelayOverrun(base.id, 2, current.live!.state.version, {
      proposalId: "delay-overrun.1", contestId: inProgress.contestId,
      reason: "Match is running thirty minutes beyond plan", expectedEndAt: "2026-09-20T13:30:00.000Z",
      proposedBy: "operator.lead", proposedAt: "2026-09-20T12:50:00.000Z",
    });
    const proposal = preview.live!.courtOutageProposal!;
    assert.equal(proposal.incidentKind, "DELAY_OVERRUN");
    assert.equal(proposal.status, "READY_FOR_APPROVAL");
    assert.equal(proposal.competitionGuard.status, "PASSED");
    assert.equal(proposal.liveGuard.status, "PASSED");
    assert.ok(proposal.repair.diff.some(({ taskId }) => taskId === displaced.contestId));
    assert.ok(proposal.affectedContestIds.includes(inProgress.contestId));
    assert.ok(proposal.affectedContestIds.includes(displaced.contestId));
    assert.equal(canonicalHash(preview.live!.state.contests[inProgress.contestId]), canonicalHash(actualBefore));
    assert.deepEqual(preview.live!.delivery, deliveryBefore);

    assert.throws(() => journey.approveDelayOverrun(base.id, 2, proposal.proposalHash,
      "operator.lead", "2026-09-20T12:51:00.000Z"), /independent_actor/);
    const approved = journey.approveDelayOverrun(base.id, 2, proposal.proposalHash,
      "tournament.director", "2026-09-20T12:51:00.000Z");
    assert.equal(approved.live!.publication!.revision, 3);
    assert.equal(approved.live!.publication!.changeKind, "DELAY_OVERRUN");
    assert.equal(canonicalHash(approved.live!.state.contests[inProgress.contestId]), canonicalHash(actualBefore));
    assert.equal(approved.live!.state.resources.courts[inProgress.courtId]?.expectedAvailableAt,
      "2026-09-20T13:30:00.000Z");
    assert.deepEqual(approved.live!.publication!.outboxIntents.map(({ payload }) => payload.recipientEntrantId).sort(),
      proposal.affectedEntrantIds.slice().sort());
    assert.deepEqual(journey.approveDelayOverrun(base.id, 3, proposal.proposalHash,
      "tournament.director", "2026-09-20T12:51:00.000Z"), approved);
    assert.deepEqual(new CompetitionJourney({ storagePath }).read(base.id), approved);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("delay proposals reject non-live contests, stale heads and client-owned artefacts", async () => {
  const journey = new CompetitionJourney({ now: () => "2026-09-20T12:30:00.000Z" });
  const base = published(journey);
  const active = journey.activateLive(base.id, base.revision, "operator.lead");
  const contest = active.live!.state.definition.contests[0]!;
  const request = { proposalId: "delay.invalid", contestId: contest.contestId, reason: "Claimed overrun",
    expectedEndAt: "2026-09-20T13:30:00.000Z", proposedBy: "operator.lead",
    proposedAt: "2026-09-20T12:30:00.000Z" } as const;
  assert.throws(() => journey.proposeDelayOverrun(base.id, base.revision, active.live!.state.version, request),
    /requires_in_progress_contest/);
  assert.throws(() => journey.proposeDelayOverrun(base.id, base.revision, active.live!.state.version, {
    ...request, guardInput: { status: "PASSED" }, repairRequest: { assignments: [] },
  } as never), /invalid_delay_overrun_request/);
  assert.throws(() => journey.proposeDelayOverrun(base.id, base.revision + 1, active.live!.state.version, request),
    /journey_revision_conflict/);
  const server = createCompilerServer({ production: false, competitionJourney: journey,
    now: () => "2026-09-20T12:30:00.000Z" });
  const response = await post(server, `/v1/competition-journey/${encodeURIComponent(base.id)}/delay-preview`, {
    expectedOperationalRevision: base.revision, expectedLiveVersion: active.live!.state.version,
    proposalId: request.proposalId, contestId: request.contestId, reason: request.reason,
    expectedEndAt: request.expectedEndAt, guardInput: { status: "PASSED" },
  });
  assert.equal(response.status, 400);
  assert.equal(response.body.error, "invalid_journey_command");
});
