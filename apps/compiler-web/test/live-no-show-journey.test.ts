import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import { canonicalHash } from "@tournament-os/tournament-schema";
import { CompetitionJourney, parseConnectedLiveCommand } from "../src/competition-journey.js";
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

test("a no-show preserves actual truth, Guards deterministic options, and publishes only affected updates", () => {
  const directory = mkdtempSync(join(tmpdir(), "krateasy-live-no-show-"));
  const storagePath = join(directory, "journey.json");
  try {
    const journey = new CompetitionJourney({ storagePath, now: () => now });
    const base = published(journey);
    let current = journey.activateLive(base.id, base.revision, "operator.lead");
    const groups = current.live!.state.definition.contests.filter(({ contestId }) => contestId.includes(".pools."));
    const completedContest = groups[0]!;
    const inProgressContest = groups.find(({ entrantIds }) => entrantIds.every((id) => !completedContest.entrantIds.includes(id)))!;
    const noShowContest = groups.find(({ entrantIds }) => entrantIds.every((id) =>
      !completedContest.entrantIds.includes(id) && !inProgressContest.entrantIds.includes(id)))!;

    const submit = (body: Record<string, unknown>) => {
      current = journey.submitLiveCommand(base.id, base.revision, {
        ...body, commandId: `command.${current.live!.state.version + 1}`,
        expectedVersion: current.live!.state.version, actorId: "operator.lead", occurredAt: now,
      } as never);
    };
    for (const entrantId of [...completedContest.entrantIds, ...inProgressContest.entrantIds])
      submit({ kind: "CHECK_IN", entrantId });
    submit({ kind: "START_CONTEST", contestId: completedContest.contestId,
      courtId: completedContest.courtId, startedAt: "2026-09-20T11:00:00.000Z" });
    submit({ kind: "COMPLETE_CONTEST", contestId: completedContest.contestId, endedAt: "2026-09-20T11:30:00.000Z" });
    submit({ kind: "START_CONTEST", contestId: inProgressContest.contestId,
      courtId: inProgressContest.courtId, startedAt: "2026-09-20T12:30:00.000Z" });

    const truthBefore = structuredClone(current.live!.state.contests);
    const absentEntrantId = noShowContest.entrantIds[0]!;
    const proposal = journey.proposeNoShow(base.id, base.revision, current.live!.state.version, {
      proposalId: "no-show.1", contestId: noShowContest.contestId, entrantId: absentEntrantId,
      reason: "Entrant did not arrive after the published call window.", proposedBy: "operator.lead", proposedAt: now,
    });
    assert.equal(proposal.live?.proposal?.options.length, 2);
    assert.deepEqual(proposal.live?.proposal?.options.map(({ strategy }) => strategy),
      ["KEEP_ANNOUNCED_SLOTS", "RELEASE_WALKOVER_SLOTS"]);
    assert.equal(proposal.live?.proposal?.options.every(({ competitionGuard, liveGuard, minimumChangeProof }) =>
      competitionGuard.status === "PASSED" && liveGuard.status === "PASSED"
      && minimumChangeProof.optimalityProven && minimumChangeProof.movedContestCount === 0), true);
    assert.ok(proposal.live?.proposal?.affectedContestIds.includes(noShowContest.contestId));
    assert.equal(proposal.live?.state.proofHash, current.live?.state.proofHash, "proposal must not mutate live truth");

    assert.throws(() => journey.approveNoShow(base.id, base.revision, proposal.live!.proposal!.proposalHash,
      undefined as unknown as string, "RELEASE_WALKOVER_SLOTS", "tournament.director", now), /no_show_option_hash_required/);
    assert.throws(() => journey.approveNoShow(base.id, base.revision, proposal.live!.proposal!.proposalHash,
      proposal.live!.proposal!.options[1]!.optionHash, "RELEASE_WALKOVER_SLOTS", "operator.lead", now), /independent_actor/);
    const repaired = journey.approveNoShow(base.id, base.revision, proposal.live!.proposal!.proposalHash,
      proposal.live!.proposal!.options[1]!.optionHash, "RELEASE_WALKOVER_SLOTS", "tournament.director", now);
    assert.equal(repaired.live?.publication?.revision, 2);
    assert.equal(repaired.live?.publication?.baseRevision, 1);
    assert.equal(repaired.live?.state.contests[completedContest.contestId]?.status, "COMPLETED");
    assert.equal(repaired.live?.state.contests[inProgressContest.contestId]?.status, "IN_PROGRESS");
    assert.deepEqual(repaired.live?.state.contests[completedContest.contestId], truthBefore[completedContest.contestId]);
    assert.deepEqual(repaired.live?.state.contests[inProgressContest.contestId], truthBefore[inProgressContest.contestId]);
    assert.equal(repaired.live?.publication?.operationalAssignments.some(({ contestId }) =>
      repaired.live!.publication!.settledAsWalkoverContestIds.includes(contestId)), false);
    const recipients = repaired.live?.publication?.outboxIntents.map(({ payload }) => payload.recipientEntrantId).sort() ?? [];
    assert.deepEqual(recipients, repaired.live?.publication?.affectedEntrantIds.slice().sort());
    const directlyAffected = [...new Set(repaired.live!.publication!.settledAsWalkoverContestIds.flatMap((contestId) =>
      repaired.live!.state.definition.contests.find((contest) => contest.contestId === contestId)!.entrantIds))].sort();
    assert.deepEqual(recipients, directlyAffected, "outbox must contain every and only directly affected entrant consumer");

    const restarted = new CompetitionJourney({ storagePath });
    assert.deepEqual(restarted.read(base.id), repaired);
    assert.deepEqual(restarted.approveNoShow(base.id, base.revision, proposal.live!.proposal!.proposalHash,
      proposal.live!.proposal!.options[1]!.optionHash, "RELEASE_WALKOVER_SLOTS", "tournament.director", now), repaired, "approval replay must be idempotent");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("no-show proposals replay deterministically and stale live truth cannot be approved", () => {
  const journey = new CompetitionJourney({ now: () => now });
  const base = published(journey);
  const active = journey.activateLive(base.id, base.revision, "operator.lead");
  const contest = active.live!.state.definition.contests.find(({ contestId }) => contestId.includes(".pools."))!;
  const request = { proposalId: "no-show.replay", contestId: contest.contestId, entrantId: contest.entrantIds[0]!,
    reason: "Absent after call window.", proposedBy: "operator.lead", proposedAt: now } as const;
  const first = journey.proposeNoShow(base.id, base.revision, active.live!.state.version, request);
  const replay = journey.proposeNoShow(base.id, base.revision, active.live!.state.version, request);
  assert.equal(first.live?.proposal?.proposalHash, replay.live?.proposal?.proposalHash);
  assert.deepEqual(first.live?.proposal?.options.map(({ optionHash }) => optionHash),
    replay.live?.proposal?.options.map(({ optionHash }) => optionHash));

  journey.submitLiveCommand(base.id, base.revision, { kind: "MARK_LATE", entrantId: contest.entrantIds[1]!,
    reason: "Reported at desk", commandId: "late.after.proposal", expectedVersion: active.live!.state.version,
    actorId: "operator.lead", occurredAt: now });
  assert.throws(() => journey.approveNoShow(base.id, base.revision, first.live!.proposal!.proposalHash,
    first.live!.proposal!.options[0]!.optionHash, "KEEP_ANNOUNCED_SLOTS", "tournament.director", now), /stale_live_proposal/);
});

test("live command replay is idempotent and the connected boundary rejects privileged or repair-bypassing input", () => {
  const journey = new CompetitionJourney({ now: () => now });
  const base = published(journey);
  const active = journey.activateLive(base.id, base.revision, "operator.lead");
  const entrantId = active.live!.state.definition.contests[0]!.entrantIds[0]!;
  const command = { kind: "CHECK_IN" as const, entrantId, commandId: "check-in.replay", expectedVersion: 0,
    actorId: "operator.lead", occurredAt: now };
  const first = journey.submitLiveCommand(base.id, base.revision, command);
  const replay = journey.submitLiveCommand(base.id, base.revision, command);
  assert.equal(first.live?.state.version, 1);
  assert.equal(replay.live?.state.proofHash, first.live?.state.proofHash);
  assert.throws(() => journey.submitLiveCommand(base.id, base.revision, { ...command, entrantId: "forged.entrant" }),
    /live_command_rejected:LIVE409/);

  assert.throws(() => parseConnectedLiveCommand({ kind: "CHECK_IN", entrantId, commandId: "injected",
    expectedVersion: 1, actorId: "attacker", occurredAt: "2020-01-01T00:00:00.000Z" }, "server.actor", now),
  /invalid_live_command/);
  assert.throws(() => parseConnectedLiveCommand({ kind: "WITHDRAW_ENTRANT", entrantId, reason: "bypass",
    commandId: "bypass", expectedVersion: 1 }, "server.actor", now), /invalid_live_command/);
});

test("Run Control projection exposes only runtime-owned fixture sides and attention queues", () => {
  const journey = new CompetitionJourney({ now: () => now });
  const base = published(journey);
  const active = journey.activateLive(base.id, base.revision, "operator.lead");
  const projection = journey.readOrganiserLive({ organizationId: "org.local", competitionId: base.id,
    expectedOperationalRevision: base.revision, at: now });
  const fixture = active.live!.state.definition.contests.find(({ contestId }) =>
    active.live!.state.resolvedEntrants[contestId]?.length === 2)!;
  const control = projection.controlContests.find(({ contestId }) => contestId === fixture.contestId)!;
  assert.deepEqual(control.sides.map(({ entrantId }) => entrantId), active.live!.state.resolvedEntrants[fixture.contestId],
    "score and walkover controls must bind to the live definition, never matching labels");
  assert.ok(projection.attention.some(({ kind }) => kind === "NEXT") || projection.attention.some(({ kind }) => kind === "BLOCKED"));
  assert.throws(() => journey.readOrganiserLive({ organizationId: "other-org", competitionId: base.id,
    expectedOperationalRevision: base.revision, at: now }), /journey_not_found/);
});

test("restart independently rejects a re-hashed envelope with a forged live event", () => {
  const directory = mkdtempSync(join(tmpdir(), "krateasy-live-replay-firewall-"));
  const storagePath = join(directory, "journey.json");
  try {
    const journey = new CompetitionJourney({ storagePath, now: () => now });
    const base = published(journey);
    const active = journey.activateLive(base.id, base.revision, "operator.lead");
    const entrantId = active.live!.state.definition.contests[0]!.entrantIds[0]!;
    journey.submitLiveCommand(base.id, base.revision, { kind: "CHECK_IN", entrantId,
      commandId: "check-in.persisted", expectedVersion: 0, actorId: "operator.lead", occurredAt: now });

    const envelope = JSON.parse(readFileSync(storagePath, "utf8")) as {
      records: Array<Record<string, any>>; storeHash: string;
    };
    envelope.records[0]!.live.state.events[0].eventHash = "a".repeat(64);
    const { recordHash: _old, ...recordBody } = envelope.records[0]!;
    envelope.records[0]!.recordHash = canonicalHash(recordBody);
    envelope.storeHash = canonicalHash(envelope.records);
    writeFileSync(storagePath, `${JSON.stringify(envelope)}\n`);
    assert.throws(() => new CompetitionJourney({ storagePath }), /journey_store_integrity_failed/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("the connected HTTP journey previews and separately approves a server-owned live repair", async () => {
  const journey = new CompetitionJourney({ now: () => now });
  const base = published(journey);
  const server = createCompilerServer({ production: false, competitionJourney: journey });
  const root = `/v1/competition-journey/${encodeURIComponent(base.id)}`;
  const activated = await post(server, `${root}/live-activate`, { expectedRevision: base.revision });
  assert.equal(activated.status, 200);
  const contest = activated.body.live.state.definition.contests.find(({ contestId }: { contestId: string }) =>
    contestId.includes(".pools."));
  const preview = await post(server, `${root}/no-show-preview`, { expectedRevision: base.revision,
    expectedLiveVersion: activated.body.live.state.version, proposalId: "http.no-show.1",
    contestId: contest.contestId, entrantId: contest.entrantIds[0], reason: "Absent after the call window." });
  assert.equal(preview.status, 200);
  assert.equal(preview.body.live.proposal.options.every(({ competitionGuard, liveGuard }: any) =>
    competitionGuard.status === "PASSED" && liveGuard.status === "PASSED"), true);
  const selected = preview.body.live.proposal.options.find(({ strategy }: any) => strategy === "RELEASE_WALKOVER_SLOTS");
  const missingOption = await post(server, `${root}/no-show-approve`, { expectedRevision: base.revision,
    expectedProposalHash: preview.body.live.proposal.proposalHash, strategy: "RELEASE_WALKOVER_SLOTS" });
  assert.equal(missingOption.status, 400);
  const wrongOption = await post(server, `${root}/no-show-approve`, { expectedRevision: base.revision,
    expectedProposalHash: preview.body.live.proposal.proposalHash, expectedOptionHash: "forged-option-hash",
    strategy: "RELEASE_WALKOVER_SLOTS" });
  assert.equal(wrongOption.status, 400);
  assert.equal(journey.read(base.id)?.live?.publication, undefined);
  const approved = await post(server, `${root}/no-show-approve`, { expectedRevision: base.revision,
    expectedProposalHash: preview.body.live.proposal.proposalHash, expectedOptionHash: selected.optionHash,
    strategy: "RELEASE_WALKOVER_SLOTS" });
  assert.equal(approved.status, 200);
  assert.equal(approved.body.live.publication.revision, 2);

  const forged = await post(server, `${root}/no-show-preview`, { expectedRevision: base.revision,
    expectedLiveVersion: 0, proposalId: "forged", contestId: contest.contestId,
    entrantId: contest.entrantIds[0], reason: "forged", guardInput: { status: "PASSED" } });
  assert.equal(forged.status, 400);
  assert.equal(forged.body.error, "invalid_journey_command");
});
