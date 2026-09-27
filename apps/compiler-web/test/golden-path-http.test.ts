import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, test } from "node:test";
import { CompetitionJourney } from "../src/competition-journey.js";
import { CLOSE_ACKNOWLEDGEMENTS } from "../src/competition-lifecycle.js";
import { createCompilerServer } from "../src/server.js";

// The golden path of a fresh tournament, driven only through the HTTP API the web product uses:
// create, add a roster, compile, reconfigure before approval, recompile, approve, go live, handle a
// no-show and an overrun through guarded repairs, play every fixture, close, export, restore on a
// fresh host and duplicate. No fixture helper builds any state on the way.

let now = "2026-11-07T08:00:00.000Z";
const at = (iso: string) => { now = iso; };
const later = (minutes: number) => { now = new Date(Date.parse(now) + minutes * 60_000).toISOString(); };
const journeyOptions = { organizationId: "org.local", now: () => now,
  participantTokenSecret: "golden-path-participant-key-32-bytes-minimum",
  offlinePackSigningSeedHex: "9f4f6abf4f1433ccb52966db4b69e85f71bc78b39bece0413e2ef56ef34a6dd8" };
const servers: Array<ReturnType<typeof createCompilerServer>> = [];
after(() => Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve)))));

async function host(journey: CompetitionJourney) {
  const server = createCompilerServer({ production: false, competitionJourney: journey, organizationId: "org.local" });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return async (method: string, path: string, body?: unknown) => {
    const response = await fetch(origin + path, { method, ...(body === undefined ? {} : {
      headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) });
    const value = await response.json() as any;
    assert.ok(response.ok, `${method} ${path} → ${response.status} ${JSON.stringify(value).slice(0, 300)}`);
    return value;
  };
}

const facts = { name: "Autumn Club Round Robin", sport: "padel", participantUnit: "pairs", participantCount: 8,
  resourceCount: 5, resourceLabel: "courts", format: "round_robin", minimumMatches: 7, minimumRestMinutes: 10,
  matchDurationMinutes: 25, timezone: "Europe/London", priority: "fair_recovery", scoringPolicy: "head_to_head_total_score_no_draw",
  tiebreakPolicy: "wins_score_difference_score_for_manual", withdrawalPolicy: "preserve_played_walkover_future",
  drawPolicy: "seeded_input_order", startsAt: "2026-11-07T09:00:00.000Z", endsAt: "2026-11-07T18:00:00.000Z" };
const pairs = Array.from({ length: 8 }, (_, index) => `autumn.pair.${index + 1}`);
const roster = ["entrant_id,display_name,division_id,member_ids,seed", ...pairs.map((id, index) =>
  `${id},Autumn Pair ${index + 1},open,${id}.a|${id}.b,${index + 1}`)].join("\n");

test("a fresh round robin runs the whole golden path over HTTP, including reconfiguration and guarded repairs", async () => {
  const journey = new CompetitionJourney(journeyOptions);
  const api = await host(journey);

  // Create, add the roster, compile.
  let c = await api("POST", "/v1/competition-journey", { source: { mode: "quick", value: facts } });
  const id = encodeURIComponent(c.id);
  assert.equal(c.status, "NEEDS_INPUT");
  assert.deepEqual(c.workbench.missingDecisions.map(({ id: decision }: { id: string }) => decision), ["entrant-roster"]);
  c = await api("POST", `/v1/competition-journey/${id}/sources`, { expectedDraftVersion: c.draftVersion, source: { mode: "csv", text: roster } });
  assert.equal(c.status, "DRAFT");
  c = await api("POST", `/v1/competition-journey/${id}/compile`, { expectedDraftVersion: c.draftVersion });
  assert.equal(c.compiled.guardStatus, "PASSED");
  assert.equal(c.compiled.scheduledContestCount, 28);

  // Reconfigure before approval: one court fewer and shorter matches.
  // (Five and four courts: with three or fewer the CP-SAT model is currently slow or undecided on this
  // event; docs/requirements-traceability.md records that as an open engine issue.) The revised facts replace the old
  // ones (no conflict), the roster is kept, and the plan must be recompiled.
  c = await api("POST", `/v1/competition-journey/${id}/draft`, { expectedDraftVersion: c.draftVersion,
    source: { mode: "quick", value: { ...facts, resourceCount: 4, matchDurationMinutes: 20 } } });
  assert.equal(c.status, "DRAFT", "revised facts supersede the earlier ones instead of conflicting with them");
  assert.deepEqual(c.workbench.conflicts, []);
  assert.equal(c.compiled, null, "a reconfigured draft has no compiled plan until it is recompiled");
  c = await api("POST", `/v1/competition-journey/${id}/compile`, { expectedDraftVersion: c.draftVersion });
  assert.equal(c.compiled.guardStatus, "PASSED");
  assert.deepEqual([...new Set(c.compiled.schedule.map(({ resourceId }: { resourceId: string }) => resourceId))].sort(),
    ["venue.courts.1", "venue.courts.2", "venue.courts.3", "venue.courts.4"], "the recompiled plan uses the four courts that remain");
  assert.ok(c.compiled.schedule.every(({ start, end }: { start: string; end: string }) => Date.parse(end) - Date.parse(start) === 20 * 60_000));

  // Approve, publish and go live.
  c = await api("POST", `/v1/competition-journey/${id}/approve`, { expectedRevision: c.revision,
    acknowledgedFindingCodes: c.compiled.requiredAcknowledgementCodes });
  assert.equal(c.status, "PUBLISHED");
  c = await api("POST", `/v1/competition-journey/${id}/live-activate`, { expectedRevision: c.publication.revision });
  let revision: number = c.publication.revision;
  let sequence = 0;
  const live = () => api("GET", `/v1/competition-journey/${id}/organiser-live?revision=${revision}`);
  const command = async (input: Record<string, unknown>) => api("POST", `/v1/competition-journey/${id}/live-command`, {
    expectedRevision: revision, command: { ...input, commandId: `golden.${++sequence}`, expectedVersion: journey.read(c.id)!.live!.state.version } });

  at("2026-11-07T08:50:00.000Z");
  for (const entrantId of pairs.slice(0, 7)) await command({ kind: "CHECK_IN", entrantId });

  // Pair 8 does not arrive: a guarded no-show repair.
  let view = await live();
  const absent = view.controlContests.filter(({ sides }: any) => sides.some(({ entrantId }: any) => entrantId === "autumn.pair.8"))
    .sort((a: any, b: any) => a.scheduledStart.localeCompare(b.scheduledStart))[0];
  at("2026-11-07T09:05:00.000Z");
  const noShow = (await api("POST", `/v1/competition-journey/${id}/no-show-preview`, { expectedRevision: revision,
    expectedLiveVersion: view.liveVersion, proposalId: "golden.no-show", contestId: absent.contestId,
    entrantId: "autumn.pair.8", reason: "Absent at call" })).live.proposal;
  assert.ok(noShow.options.every((option: any) => option.competitionGuard.status === "PASSED" && option.liveGuard.status === "PASSED"));
  c = await api("POST", `/v1/competition-journey/${id}/no-show-approve`, { expectedRevision: revision,
    expectedProposalHash: noShow.proposalHash, expectedOptionHash: noShow.options[0].optionHash, strategy: noShow.options[0].strategy });
  revision = c.live.publication.revision;

  // The first fixture overruns: a guarded delay repair that keeps every player's hard rest.
  view = await live();
  const first = view.controlContests.filter((x: any) => x.status === "SCHEDULED" && x.sides.every(({ entrantId }: any) => entrantId !== "autumn.pair.8"))
    .sort((a: any, b: any) => a.scheduledStart.localeCompare(b.scheduledStart))[0];
  await command({ kind: "START_CONTEST", contestId: first.contestId, courtId: first.courtId, startedAt: now });
  later(20); view = await live();
  const overrun = (await api("POST", `/v1/competition-journey/${id}/delay-preview`, { expectedOperationalRevision: revision,
    expectedLiveVersion: view.liveVersion, proposalId: "golden.delay", contestId: first.contestId, reason: "Long rallies",
    expectedEndAt: new Date(Date.parse(now) + 25 * 60_000).toISOString() })).live.courtOutageProposal;
  assert.equal(overrun.status, "READY_FOR_APPROVAL", "a repairable overrun yields a repair both Guards accept");
  assert.equal(overrun.competitionGuard.status, "PASSED");
  assert.equal(overrun.liveGuard.status, "PASSED");
  c = await api("POST", `/v1/competition-journey/${id}/delay-approve`, { expectedOperationalRevision: revision, expectedProposalHash: overrun.proposalHash });
  revision = c.live.publication.revision;

  // Play every remaining fixture to a result.
  const settle = async (contest: any) => {
    await command({ kind: "RECORD_SCORE", contestId: contest.contestId, scores: [{ entrantId: contest.sides[0].entrantId, value: 6 },
      { entrantId: contest.sides[1].entrantId, value: 3 }] });
    await command({ kind: "COMPLETE_CONTEST", contestId: contest.contestId, endedAt: now });
    await command({ kind: "RECORD_RESULT_RECEIPT", contestId: contest.contestId, source: "desk" });
  };
  later(25); await settle((await live()).controlContests.find(({ contestId }: any) => contestId === first.contestId));
  for (let round = 0; round < 40; round += 1) {
    view = await live();
    const next = view.controlContests.filter(({ status }: any) => status === "SCHEDULED")
      .sort((a: any, b: any) => a.scheduledStart.localeCompare(b.scheduledStart))[0];
    if (!next) break;
    if (Date.parse(now) < Date.parse(next.scheduledStart)) at(next.scheduledStart);
    await command({ kind: "START_CONTEST", contestId: next.contestId, courtId: next.courtId, startedAt: now });
    later(20); await settle(next);
  }
  view = await live();
  assert.ok(view.controlContests.every(({ status }: any) => status === "COMPLETED" || status === "WALKOVER"), "every fixture has a result");

  // Close, export, restore on a fresh host, duplicate.
  const current = journey.read(c.id)!;
  c = await api("POST", `/v1/competition-journey/${id}/close`, { expectedPublishedRevision: current.publication!.revision,
    expectedOperationalRevision: revision, expectedLiveVersion: current.live!.state.version, acknowledgedCodes: [...CLOSE_ACKNOWLEDGEMENTS] });
  assert.equal(c.status, "CLOSED");
  assert.equal(c.closure.resultSummary.total, 28);
  assert.equal(c.closure.resultSummary.unresolved, 0);
  const bundle = await api("GET", `/v1/competition-journey/${id}/closure-bundle?closure=${encodeURIComponent(c.closure.closureHash)}`);
  const restored = await (await host(new CompetitionJourney(journeyOptions)))("POST", "/v1/competition-journey/restore", { bundle });
  assert.equal(restored.snapshot.status, "CLOSED");
  assert.equal(restored.snapshot.closure.closureHash, c.closure.closureHash, "a fresh host restores the identical closed record");
  const duplicate = await api("POST", `/v1/competition-journey/${id}/duplicate`, { expectedClosureHash: c.closure.closureHash,
    name: "Spring Club Round Robin", eventDate: "2027-03-06" });
  assert.equal(duplicate.status, "DRAFT");
  assert.equal(duplicate.publication, null);
  assert.equal(duplicate.live, null);
});
