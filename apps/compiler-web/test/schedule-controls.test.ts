import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalHash } from "@tournament-os/tournament-schema";
import { CompetitionJourney } from "../src/competition-journey.js";
import type { ScheduleControls } from "../src/schedule-controls.js";
import { pairs } from "./support/pools-knockout-event.js";

// Scheduling controls on a connected event: court opening hours, match lengths per stage and round, and
// protected matches. They are previewed, applied with the exact hash, audited, re-verified at load,
// honoured by the plan, and checked again by the Guard on every compile.

const facts = { name: "Winter Pools and Knockout", sport: "padel", participantUnit: "pairs", participantCount: 12, resourceCount: 3,
  resourceLabel: "courts", format: "pools_to_knockout", poolSize: 4, qualifiersPerPool: 2, minimumMatches: 3, minimumRestMinutes: 10,
  matchDurationMinutes: 20, timezone: "Europe/London", priority: "fair_recovery", scoringPolicy: "head_to_head_total_score_no_draw",
  tiebreakPolicy: "wins_score_difference_score_for_manual", withdrawalPolicy: "preserve_played_walkover_future",
  drawPolicy: "seeded_input_order", startsAt: "2026-11-07T09:00:00.000Z", endsAt: "2026-11-07T21:00:00.000Z" } as const;
const roster = ["entrant_id,display_name,division_id,member_ids,seed",
  ...pairs.map((id, index) => `${id},Winter Pair ${index + 1},open,${id}.a|${id}.b,${index + 1}`)].join("\n");
type Snapshot = ReturnType<CompetitionJourney["create"]>;

function planned(options: ConstructorParameters<typeof CompetitionJourney>[0] = {}) {
  const journey = new CompetitionJourney({ organizationId: "org.pk", now: () => "2026-11-01T08:00:00.000Z", ...options });
  let c = journey.create({ mode: "quick", value: facts }, "organiser.author");
  c = journey.addSource(c.id, c.draftVersion, { mode: "csv", text: roster });
  c = journey.compile(c.id, c.draftVersion);
  assert.equal(c.compiled!.guardStatus, "PASSED");
  return { journey, c };
}
function setControls(journey: CompetitionJourney, c: Snapshot, controls: ScheduleControls) {
  const preview = journey.previewScheduleControls(c.id, c.draftVersion, controls);
  return { preview, c: journey.applyScheduleControls(c.id, c.draftVersion, controls, preview.previewHash, "organiser.author") };
}
const schedule = (journey: CompetitionJourney, id: string) => (journey as unknown as {
  records: Map<string, { compiled: { schedule: { contests: { contestId: string; resourceId: string; start: string; end: string }[] } } }> })
  .records.get(id)!.compiled.schedule.contests;

const FINAL = "open.main.R3.M1";

test("court hours, match lengths and protected matches are previewed, applied and honoured by the next plan", () => {
  const { journey, c: start } = planned();
  const view = start.scheduleControls!;
  assert.deepEqual([view.opens, view.closes, view.courts, view.matchMinutes], ["09:00", "21:00", 3, 20]);
  assert.deepEqual(view.stages.map(({ stageId, rounds }) => [stageId, rounds.map(({ round }) => round)]),
    [["open.pools", []], ["open.main", ["semifinal", "final"]]]);
  const final = view.matches.find(({ contestId }) => contestId === FINAL)!;
  assert.equal(final.label, "Open knockout: final");
  const poolMatch = view.matches.find(({ contestId }) => contestId === "open.pools.P1.R1.M1")!;
  assert.equal(poolMatch.label, "Open pools: pool 1, match 1");

  const controls: ScheduleControls = {
    courtHours: [{ court: 3, opens: "12:00", closes: "18:00" }],
    durations: [{ stageId: "open.main", round: "final", minutes: 40 }],
    protections: [{ contestId: FINAL, start: "17:00", court: 1 }, { contestId: "open.pools.P1.R1.M1", court: 2 }],
  };
  const { preview, c: changed } = setControls(journey, start, controls);
  assert.deepEqual(preview.changes, [
    "Court 3 is open 12:00–18:00.",
    "Open knockout final: 40-minute matches.",
    "Open knockout: final is protected: starts at 17:00 on court 1.",
    "Open pools: pool 1, match 1 is protected: on court 2.",
  ]);
  assert.ok(preview.consequences.includes("The plan already created is set aside. Create and check the plan again before approval."));
  assert.ok(preview.consequences.includes("Court time available goes from 2,160 to 1,800 minutes."));
  assert.equal(changed.status, "DRAFT");
  assert.equal(changed.compiled, null);
  assert.deepEqual(changed.scheduleControls!.controls, controls);
  assert.equal(changed.scheduleControlsHistory!.at(-1)!.decidedBy, "organiser.author");
  assert.equal(changed.scheduleControlsHistory!.at(-1)!.controlsHash, canonicalHash(controls));

  const c = journey.compile(changed.id, changed.draftVersion);
  assert.equal(c.compiled!.guardStatus, "PASSED");
  const contests = schedule(journey, c.id);
  for (const entry of contests.filter(({ resourceId }) => resourceId === "venue.courts.3")) {
    assert.ok(entry.start >= "2026-11-07T12:00:00.000Z" && entry.end <= "2026-11-07T18:00:00.000Z", `${entry.contestId} is outside court 3's hours`);
  }
  const planFinal = contests.find(({ contestId }) => contestId === FINAL)!;
  assert.deepEqual([planFinal.start, planFinal.end, planFinal.resourceId],
    ["2026-11-07T17:00:00.000Z", "2026-11-07T17:40:00.000Z", "venue.courts.1"]);
  assert.equal(contests.find(({ contestId }) => contestId === "open.pools.P1.R1.M1")!.resourceId, "venue.courts.2");
  assert.equal(c.scheduleControls!.matches.find(({ contestId }) => contestId === FINAL)!.plannedStart, "17:00");
});

test("controls are checked before they are saved, and what is applied is exactly what was previewed", () => {
  const { journey, c } = planned();
  const refuse = (controls: ScheduleControls, pattern: RegExp) => assert.throws(() => journey.previewScheduleControls(c.id, c.draftVersion, controls),
    (error: Error & { explanation?: string }) => pattern.test(`${error.message} ${error.explanation ?? ""}`));
  const none: ScheduleControls = { courtHours: [], durations: [], protections: [] };
  refuse({ ...none, courtHours: [{ court: 4, opens: "10:00", closes: "12:00" }] }, /courts from 1 to 3/);
  refuse({ ...none, courtHours: [{ court: 1, opens: "08:00", closes: "12:00" }] }, /within the event's hours \(09:00–21:00\)/);
  refuse({ ...none, durations: [{ stageId: "open.pools", round: "final", minutes: 30 }] }, /round this stage does not have/);
  refuse({ ...none, durations: [{ stageId: "open.main", minutes: 2 }] }, /5 to 240 minutes/);
  refuse({ ...none, protections: [{ contestId: FINAL }] }, /start time, a court, or both/);
  refuse({ ...none, protections: [{ contestId: "open.main.R9.M1", court: 1 }] }, /not part of this competition/);
  refuse({ courtHours: [{ court: 1, opens: "09:00", closes: "12:00" }], durations: [], protections: [{ contestId: FINAL, start: "17:00", court: 1 }] },
    /within its court's opening hours/);
  refuse(none, /schedule_controls_unchanged/);
  const controls: ScheduleControls = { ...none, durations: [{ stageId: "open.pools", minutes: 25 }] };
  const preview = journey.previewScheduleControls(c.id, c.draftVersion, controls);
  assert.throws(() => journey.applyScheduleControls(c.id, c.draftVersion, { ...none, durations: [{ stageId: "open.pools", minutes: 30 }] },
    preview.previewHash, "organiser.author"), /schedule_controls_preview_mismatch/);
  assert.throws(() => journey.applyScheduleControls(c.id, c.draftVersion, controls, preview.previewHash, " "), /schedule_controls_requires_actor/);
});

test("a protected match needs a plan to choose it from", () => {
  const journey = new CompetitionJourney({ organizationId: "org.pk", now: () => "2026-11-01T08:00:00.000Z" });
  let c = journey.create({ mode: "quick", value: facts }, "organiser.author");
  c = journey.addSource(c.id, c.draftVersion, { mode: "csv", text: roster });
  assert.deepEqual(c.scheduleControls!.matches, []);
  assert.throws(() => journey.previewScheduleControls(c.id, c.draftVersion, { courtHours: [], durations: [], protections: [{ contestId: FINAL, court: 1 }] }),
    (error: Error & { explanation?: string }) => /Create the plan first/.test(error.explanation ?? ""));
});

test("controls that no longer fit the event block the plan until they are changed", () => {
  const { journey, c: start } = planned();
  let { c } = setControls(journey, start, { courtHours: [{ court: 3, opens: "12:00", closes: "18:00" }], durations: [], protections: [] });
  c = journey.revise(c.id, c.draftVersion, { mode: "quick", value: { ...facts, resourceCount: 2 } });
  assert.equal(c.status, "NEEDS_INPUT");
  assert.equal(c.scheduleControls!.stale, true);
  assert.throws(() => journey.compile(c.id, c.draftVersion), /schedule_controls_stale/);
  ({ c } = setControls(journey, c, { courtHours: [], durations: [], protections: [] }));
  assert.equal(c.status, "DRAFT");
  assert.equal(c.scheduleControlsHistory!.length, 2);
  c = journey.compile(c.id, c.draftVersion);
  assert.equal(c.compiled!.guardStatus, "PASSED");
});

test("stored controls are re-verified at load: controls without their audit entry are refused", () => {
  const directory = mkdtempSync(join(tmpdir(), "schedule-controls-"));
  try {
    const storagePath = join(directory, "journeys.json");
    const { journey, c: start } = planned({ storagePath });
    const { c } = setControls(journey, start, { courtHours: [], durations: [{ stageId: "open.pools", minutes: 25 }], protections: [] });
    assert.equal(new CompetitionJourney({ organizationId: "org.pk", storagePath }).read(c.id)!.scheduleControls!.controls.durations[0]!.minutes, 25);
    const envelope = JSON.parse(readFileSync(storagePath, "utf8"));
    const record = envelope.records.find(({ id }: { id: string }) => id === c.id);
    record.scheduleControls.durations[0].minutes = 15;
    const { recordHash: _hash, ...body } = record;
    record.recordHash = canonicalHash(body);
    envelope.storeHash = canonicalHash(envelope.records);
    writeFileSync(storagePath, JSON.stringify(envelope));
    assert.throws(() => new CompetitionJourney({ organizationId: "org.pk", storagePath }), /journey_store_integrity_failed/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("a protected final keeps its time and court through live play, as the plan promised", () => {
  const clock = { now: "2026-11-01T08:00:00.000Z" };
  const { journey, c: start } = planned({ now: () => clock.now });
  let { c } = setControls(journey, start, { courtHours: [{ court: 3, opens: "09:00", closes: "15:00" }],
    durations: [{ stageId: "open.main", round: "final", minutes: 40 }], protections: [{ contestId: FINAL, start: "17:00", court: 1 }] });
  c = journey.compile(c.id, c.draftVersion);
  c = journey.approve(c.id, c.revision, "organiser.approver", c.compiled!.requiredAcknowledgementCodes);
  c = journey.activateLive(c.id, c.publication!.revision, "operator.lead");
  const revision = c.publication!.revision;
  clock.now = "2026-11-07T08:50:00.000Z";
  const submit = (command: Record<string, unknown>) => {
    c = journey.submitLiveCommand(c.id, revision, { ...command, commandId: `sc.${c.live!.state.version + 1}`,
      expectedVersion: c.live!.state.version, actorId: "operator.lead", occurredAt: clock.now } as never);
  };
  const read = () => journey.readOrganiserLive({ organizationId: "org.pk", competitionId: c.id, expectedOperationalRevision: revision, at: clock.now });
  for (const entrantId of pairs) submit({ kind: "CHECK_IN", entrantId });
  let finalSeen: { scheduledStart: string; courtId: string } | undefined;
  for (let guard = 0; guard < 60; guard += 1) {
    const next = read().controlContests.filter(({ status }) => status === "SCHEDULED")
      .sort((a, b) => a.scheduledStart.localeCompare(b.scheduledStart) || a.contestId.localeCompare(b.contestId))[0];
    if (!next) break;
    if (next.contestId === FINAL) finalSeen = { scheduledStart: next.scheduledStart, courtId: next.courtId };
    if (Date.parse(clock.now) < Date.parse(next.scheduledStart)) clock.now = next.scheduledStart;
    submit({ kind: "START_CONTEST", contestId: next.contestId, courtId: next.courtId, startedAt: clock.now });
    const [first, second] = [...next.sides].sort((a, b) => pairs.indexOf(a.entrantId) - pairs.indexOf(b.entrantId));
    clock.now = new Date(Date.parse(clock.now) + (next.contestId === FINAL ? 40 : 20) * 60_000).toISOString();
    submit({ kind: "RECORD_SCORE", contestId: next.contestId, scores: [{ entrantId: first!.entrantId, value: 6 }, { entrantId: second!.entrantId, value: 2 }] });
    submit({ kind: "COMPLETE_CONTEST", contestId: next.contestId, endedAt: clock.now });
    submit({ kind: "RECORD_RESULT_RECEIPT", contestId: next.contestId, source: "desk" });
  }
  assert.ok(read().controlContests.every(({ status }) => status === "COMPLETED"), "every match, pools to final, was played");
  assert.deepEqual(finalSeen, { scheduledStart: "2026-11-07T17:00:00.000Z", courtId: "venue.courts.1" });
});
