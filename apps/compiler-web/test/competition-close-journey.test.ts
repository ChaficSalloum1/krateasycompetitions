import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import { canonicalHash, sha256 } from "@tournament-os/tournament-schema";
import { createBackupManifest } from "@tournament-os/competition-engine";
import { CLOSE_ACKNOWLEDGEMENTS } from "../src/competition-lifecycle.js";
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

function publish(journey: CompetitionJourney) {
  const draft = journey.create({ mode: "json", text: fixture }, "organiser.author");
  const preview = journey.planStructuredEdit(draft.id, draft.draftVersion, decisions, "organiser.author");
  const resolved = journey.applyStructuredEdit(draft.id, draft.draftVersion, decisions, preview.previewHash, "organiser.author");
  const compiled = journey.compile(resolved.id, resolved.draftVersion);
  return journey.approve(compiled.id, compiled.revision, "organiser.approver",
    compiled.compiled?.requiredAcknowledgementCodes ?? []);
}

function finishStAlbans(journey: CompetitionJourney, competitionId: string) {
  let snapshot = journey.read(competitionId)!;
  let command = 0;
  const submit = (body: Record<string, unknown>) => {
    command += 1;
    snapshot = journey.submitLiveCommand(competitionId, 2, { ...body,
      commandId: `close.${command}`, expectedVersion: snapshot.live!.state.version,
      actorId: "operator.lead", occurredAt: "2026-09-20T20:00:00.000Z" } as never);
  };
  const absent = Object.entries(snapshot.live!.state.entrantPresence)
    .find(([, status]) => status === "NO_SHOW")?.[0];
  const participantIds = [...new Set(snapshot.live!.state.definition.contests.flatMap(({ entrantIds }) => entrantIds))].sort();
  for (const entrantId of participantIds) if (entrantId !== absent) submit({ kind: "CHECK_IN", entrantId });

  const terminal = new Set(["COMPLETED", "WALKOVER", "RETIRED"]);
  let progressed = true;
  while (progressed) {
    progressed = false;
    for (const contest of snapshot.live!.state.definition.contests) {
      if (terminal.has(snapshot.live!.state.contests[contest.contestId]!.status)) continue;
      const entrants = snapshot.live!.state.resolvedEntrants[contest.contestId];
      if (!entrants || entrants.length !== 2 || (contest.dependencyContestIds ?? []).some((id) =>
        !terminal.has(snapshot.live!.state.contests[id]!.status))) continue;
      assert.equal(entrants.includes(absent ?? ""), false, `no-show repair must settle ${contest.contestId}`);
      submit({ kind: "START_CONTEST", contestId: contest.contestId,
        courtId: contest.courtId, startedAt: contest.scheduledStart });
      submit({ kind: "RECORD_SCORE", contestId: contest.contestId,
        scores: entrants.map((entrantId, index) => ({ entrantId, value: index === 0 ? 6 : 0 })) });
      submit({ kind: "COMPLETE_CONTEST", contestId: contest.contestId, endedAt: contest.scheduledEnd });
      progressed = true;
    }
  }
  const unfinished = Object.entries(snapshot.live!.state.contests).filter(([, { status }]) => !terminal.has(status))
    .map(([contestId, { status }]) => ({ contestId, status,
      entrants: snapshot.live!.state.resolvedEntrants[contestId] ?? [],
      dependencies: snapshot.live!.state.definition.contests.find((contest) => contest.contestId === contestId)?.dependencyContestIds ?? [] }));
  assert.deepEqual(unfinished, []);
  return snapshot;
}

async function request(server: ReturnType<typeof createCompilerServer>, method: "GET" | "POST", url: string, value?: unknown) {
  const payload = value === undefined ? Buffer.alloc(0) : Buffer.from(JSON.stringify(value));
  const incoming = Readable.from(payload.length ? [payload] : []) as never;
  Object.assign(incoming, { method, url, headers: value === undefined ? {} : { "content-type": "application/json",
    "content-length": String(payload.byteLength) } });
  return new Promise<{ status: number; body: any }>((resolve) => {
    const result = { status: 0, body: undefined as any };
    server.emit("request", incoming, { writeHead: (status: number) => { result.status = status; },
      end: (body: string) => { result.body = JSON.parse(body); resolve(result); } } as never);
  });
}

test("the connected St Albans journey closes, exports, restores and duplicates without another truth", async () => {
  const directory = mkdtempSync(join(tmpdir(), "krateasy-close-"));
  const storagePath = join(directory, "journey.json");
  let clock = "2026-09-20T13:00:00.000Z";
  try {
    const journey = new CompetitionJourney({ storagePath, organizationId: "org.st-albans", now: () => clock });
    const published = publish(journey);
    const active = journey.activateLive(published.id, 1, "operator.lead");
    const noShowContest = active.live!.state.definition.contests.find(({ contestId }) => contestId.includes(".pools."))!;
    const proposal = journey.proposeNoShow(published.id, 1, active.live!.state.version, {
      proposalId: "close.no-show", contestId: noShowContest.contestId, entrantId: noShowContest.entrantIds[0]!,
      reason: "Absent after the final call.", proposedBy: "operator.lead", proposedAt: clock,
    });
    journey.approveNoShow(published.id, 1, proposal.live!.proposal!.proposalHash,
      "RELEASE_WALKOVER_SLOTS", "tournament.director", clock);

    assert.throws(() => journey.closeCompetition({ organizationId: "org.st-albans", competitionId: published.id,
      expectedPublishedRevision: 1, expectedOperationalRevision: 2, expectedLiveVersion: journey.read(published.id)!.live!.state.version,
      acknowledgedCodes: CLOSE_ACKNOWLEDGEMENTS, closedBy: "organiser.closer" }), /competition_close_blocked/);

    let finished = finishStAlbans(journey, published.id);
    const disputedContestId = finished.live!.state.definition.contests[0]!.contestId;
    const dispute = (body: Record<string, unknown>) => {
      finished = journey.submitLiveCommand(published.id, 2, { ...body,
        commandId: `dispute.${finished.live!.state.version + 1}`,
        expectedVersion: finished.live!.state.version, actorId: "competition.director",
        occurredAt: "2026-09-20T20:00:00.000Z" } as never);
    };
    dispute({ kind: "FILE_PROTEST", protestId: "protest.final", contestId: disputedContestId,
      filedById: "advanced.team.2", reason: "Final result review requested." });
    dispute({ kind: "RESOLVE_PROTEST", protestId: "protest.final", outcome: "DENIED",
      reason: "Score sheet and official record agree." });
    dispute({ kind: "FILE_APPEAL", appealId: "appeal.final", protestId: "protest.final",
      filedById: "advanced.team.2", reason: "Appeal requested before close." });
    clock = "2026-09-20T20:15:00.000Z";
    assert.throws(() => journey.closeCompetition({ organizationId: "org.st-albans", competitionId: published.id,
      expectedPublishedRevision: 1, expectedOperationalRevision: 2, expectedLiveVersion: finished.live!.state.version,
      acknowledgedCodes: CLOSE_ACKNOWLEDGEMENTS, closedBy: "organiser.closer" }), /open_disputes/);
    dispute({ kind: "RESOLVE_APPEAL", appealId: "appeal.final", outcome: "DENIED",
      reason: "Independent review confirms the recorded result." });
    clock = "2026-09-20T20:30:00.000Z";
    const server = createCompilerServer({ production: false, organizationId: "org.st-albans",
      competitionJourney: journey, now: () => clock });
    const root = `/v1/competition-journey/${encodeURIComponent(published.id)}`;
    const closedResponse = await request(server, "POST", `${root}/close`, {
      expectedPublishedRevision: 1, expectedOperationalRevision: 2,
      expectedLiveVersion: finished.live!.state.version, acknowledgedCodes: CLOSE_ACKNOWLEDGEMENTS,
    });
    assert.equal(closedResponse.status, 200);
    assert.equal(closedResponse.body.status, "CLOSED");
    assert.equal(closedResponse.body.closure.resultSummary.total, 108);
    assert.equal(closedResponse.body.closure.resultSummary.unresolved, 0);
    assert.equal(closedResponse.body.closure.authority.liveStateProofHash, finished.live!.state.proofHash);

    const replayedClose = await request(server, "POST", `${root}/close`, {
      expectedPublishedRevision: 1, expectedOperationalRevision: 2,
      expectedLiveVersion: finished.live!.state.version, acknowledgedCodes: CLOSE_ACKNOWLEDGEMENTS,
    });
    assert.equal(replayedClose.body.closure.closureHash, closedResponse.body.closure.closureHash);
    const rejectedAcknowledgement = await request(server, "POST", `${root}/close`, {
      expectedPublishedRevision: 1, expectedOperationalRevision: 2,
      expectedLiveVersion: finished.live!.state.version, acknowledgedCodes: CLOSE_ACKNOWLEDGEMENTS.slice(1),
    });
    assert.equal(rejectedAcknowledgement.status, 400);

    const bundleResponse = await request(server, "GET", `${root}/closure-bundle?closure=${closedResponse.body.closure.closureHash}`);
    assert.equal(bundleResponse.status, 200);
    const names = bundleResponse.body.artifacts.map(({ fileName }: { fileName: string }) => fileName);
    for (const required of ["specification.json", "graph.json", "schedule.json", "guard-report.json",
      "actual-results.json", "live-events.json", "operational-events.json", "sources.json", "audit.md",
      "authoritative-record.json"]) assert.ok(names.includes(required));
    const forged = structuredClone(bundleResponse.body);
    const forgedSpecification = forged.artifacts.find(({ fileName }: { fileName: string }) => fileName === "specification.json");
    forgedSpecification.content = "{}";
    forgedSpecification.sha256 = sha256(forgedSpecification.content);
    forged.manifest = createBackupManifest({ backupId: forged.manifest.backupId,
      createdAt: forged.manifest.createdAt, schemaVersion: forged.manifest.schemaVersion,
      artifacts: forged.artifacts.map(({ fileName: path, content, sha256: checksum }:
        { fileName: string; content: string; sha256: string }) => ({ path,
        bytes: Buffer.byteLength(content, "utf8"), sha256: checksum })) });
    const { bundleHash: _oldBundleHash, ...forgedBody } = forged;
    forged.bundleHash = canonicalHash(forgedBody);
    const forgedRestore = new CompetitionJourney({ organizationId: "org.st-albans", now: () => clock });
    assert.throws(() => forgedRestore.restoreClosedBundle({ organizationId: "org.st-albans", bundle: forged }),
      /invalid_competition_evidence_bundle/);
    assert.equal(forgedRestore.read(published.id), undefined);
    assert.throws(() => journey.exportClosedBundle({ organizationId: "org.st-albans", competitionId: published.id,
      expectedClosureHash: "f".repeat(64) }), /competition_closure_mismatch/);

    const restoredPath = join(directory, "restored.json");
    const restoreJourney = new CompetitionJourney({ storagePath: restoredPath, organizationId: "org.st-albans", now: () => clock });
    const restored = restoreJourney.restoreClosedBundle({ organizationId: "org.st-albans", bundle: bundleResponse.body });
    assert.equal(restored.report.status, "VERIFIED");
    assert.equal(restored.snapshot.closure.closureHash, closedResponse.body.closure.closureHash);
    assert.deepEqual(restoreJourney.exportClosedBundle({ organizationId: "org.st-albans", competitionId: published.id,
      expectedClosureHash: closedResponse.body.closure.closureHash }), bundleResponse.body);

    const duplicateResponse = await request(server, "POST", `${root}/duplicate`, {
      expectedClosureHash: closedResponse.body.closure.closureHash,
      name: "Encourt Padel & Wellness Club St Albans 2027", eventDate: "2027-09-19",
    });
    assert.equal(duplicateResponse.status, 201);
    assert.equal(duplicateResponse.body.status, "DRAFT");
    assert.equal(duplicateResponse.body.name, "Encourt Padel & Wellness Club St Albans 2027");
    assert.equal(duplicateResponse.body.duplication.sourceCompetitionId, published.id);
    assert.equal(duplicateResponse.body.compiled, null);
    assert.equal(duplicateResponse.body.live, null);
    assert.equal(duplicateResponse.body.publication, null);
    const duplicateReplay = await request(server, "POST", `${root}/duplicate`, {
      expectedClosureHash: closedResponse.body.closure.closureHash,
      name: "Encourt Padel & Wellness Club St Albans 2027", eventDate: "2027-09-19",
    });
    assert.equal(duplicateReplay.body.id, duplicateResponse.body.id);
    const duplicateCompiled = journey.compile(duplicateResponse.body.id, duplicateResponse.body.draftVersion);
    assert.equal(duplicateCompiled.compiled?.schedule.length, 108);
    assert.equal(duplicateCompiled.compiled?.schedule.every(({ start }) => start.startsWith("2027-09-19")), true);
    clock = "2026-09-21T09:00:00.000Z";
    const restartedForDuplicate = new CompetitionJourney({ storagePath, organizationId: "org.st-albans", now: () => clock });
    assert.equal(restartedForDuplicate.duplicateClosed({ organizationId: "org.st-albans", competitionId: published.id,
      expectedClosureHash: closedResponse.body.closure.closureHash,
      name: "Encourt Padel & Wellness Club St Albans 2027", eventDate: "2027-09-19",
      createdBy: "local.organiser" }).id, duplicateResponse.body.id);

    assert.throws(() => journey.submitLiveCommand(published.id, 2, { kind: "CHECK_IN", entrantId: "advanced.team.1",
      commandId: "after.close", expectedVersion: finished.live!.state.version,
      actorId: "operator.lead", occurredAt: clock }), /competition_is_closed/);
    const restarted = new CompetitionJourney({ storagePath, organizationId: "org.st-albans", now: () => clock });
    assert.equal(restarted.read(published.id)!.closure?.closureHash, closedResponse.body.closure.closureHash);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("closure restore rejects forged artifacts, cross-organisation scope and stale identity", () => {
  const journey = new CompetitionJourney({ organizationId: "org.st-albans" });
  assert.throws(() => journey.restoreClosedBundle({ organizationId: "org.other", bundle: {
    schemaVersion: "1.0.0", organizationId: "org.st-albans", competitionId: "forged",
    closureHash: "a".repeat(64), generatedAt: "2026-09-20T20:30:00.000Z", manifest: {}, artifacts: [],
    sourceTruth: [], bundleHash: canonicalHash("forged"),
  } as never }), /competition_restore_scope_mismatch|invalid_competition_evidence_bundle/);
});
