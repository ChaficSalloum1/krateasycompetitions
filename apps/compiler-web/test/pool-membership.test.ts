import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalHash } from "@tournament-os/tournament-schema";
import { CompetitionJourney, type PoolPlacementRequest } from "../src/competition-journey.js";
import { betterSeed, pairs } from "./support/pools-knockout-event.js";

// The organiser places pairs into pools themselves. The placement is stored on the draft, bound to the
// roster and pool sizes it was made for, applied as a manual allocation, and carried into live play.

const facts = { name: "Winter Pools and Knockout", sport: "padel", participantUnit: "pairs", participantCount: 12, resourceCount: 3,
  resourceLabel: "courts", format: "pools_to_knockout", poolSize: 4, qualifiersPerPool: 2, minimumMatches: 3, minimumRestMinutes: 10,
  matchDurationMinutes: 20, timezone: "Europe/London", priority: "fair_recovery", scoringPolicy: "head_to_head_total_score_no_draw",
  tiebreakPolicy: "wins_score_difference_score_for_manual", withdrawalPolicy: "preserve_played_walkover_future",
  drawPolicy: "seeded_input_order", startsAt: "2026-11-07T09:00:00.000Z", endsAt: "2026-11-07T21:00:00.000Z" } as const;
const roster = (ids: readonly string[]) => ["entrant_id,display_name,division_id,member_ids,seed",
  ...ids.map((id, index) => `${id},Winter Pair ${id.split(".").at(-1)},open,${id}.a|${id}.b,${index + 1}`)].join("\n");

function draft(clock = { now: "2026-11-01T08:00:00.000Z" }) {
  const journey = new CompetitionJourney({ organizationId: "org.pk", now: () => clock.now });
  let c = journey.create({ mode: "quick", value: facts }, "organiser.author");
  c = journey.addSource(c.id, c.draftVersion, { mode: "csv", text: roster(pairs) });
  assert.equal(c.status, "DRAFT");
  return { journey, c, clock };
}

type Snapshot = ReturnType<CompetitionJourney["create"]>;
type Assignments = { entrantId: string; poolId: string }[];
/** Preview a pool change, then apply exactly that preview, as the Studio does. */
function change(journey: CompetitionJourney, c: Snapshot, request: PoolPlacementRequest, by = "organiser.author") {
  const preview = journey.previewPoolMembership(c.id, c.draftVersion, request);
  return journey.applyPoolMembership(c.id, c.draftVersion, request, preview.previewHash, by);
}
const placed = (c: Snapshot, assignments: Assignments): PoolPlacementRequest =>
  ({ kind: "PLACED", stageId: c.poolMembership!.stageId, basisHash: c.poolMembership!.basisHash, assignments });

/** Pairs 1 and 2 are the top seeds, so the automatic draw always puts them in different pools. */
function placeTopSeedsTogether(view: NonNullable<ReturnType<CompetitionJourney["read"]>>["poolMembership"]) {
  const assignments = view!.pools.flatMap(({ poolId, entrants }) => entrants.map(({ entrantId }) => ({ entrantId, poolId })));
  const one = assignments.find(({ entrantId }) => entrantId === "pk.pair.1")!;
  const two = assignments.find(({ entrantId }) => entrantId === "pk.pair.2")!;
  const swap = assignments.find(({ poolId, entrantId }) => poolId === one.poolId && entrantId !== "pk.pair.1")!;
  [swap.poolId, two.poolId] = [two.poolId, one.poolId];
  return assignments;
}

test("an organiser's pool placement replaces the automatic draw and is what the pools play", () => {
  const { journey, c: start } = draft();
  const automatic = start.poolMembership!;
  assert.equal(automatic.source, "AUTOMATIC");
  assert.deepEqual(automatic.sizes, [4, 4, 4]);
  const poolOf = (view: typeof automatic, id: string) => view.pools.find(({ entrants }) => entrants.some(({ entrantId }) => entrantId === id))!.poolId;
  assert.notEqual(poolOf(automatic, "pk.pair.1"), poolOf(automatic, "pk.pair.2"), "the automatic draw separates the top seeds");

  let c = change(journey, start, placed(start, placeTopSeedsTogether(automatic)));
  assert.equal(c.poolMembership!.source, "ORGANISER");
  assert.equal(poolOf(c.poolMembership!, "pk.pair.1"), poolOf(c.poolMembership!, "pk.pair.2"));
  assert.equal(c.status, "DRAFT");

  c = journey.compile(c.id, c.draftVersion);
  assert.equal(c.compiled!.guardStatus, "PASSED");
  const record = (journey as unknown as { records: Map<string, { compiled: { spec: { stages: { id: string; pool?: { allocation: string } }[] };
    graph: { nodes: { kind: string; stageId: string; slots: { type: string; entrantId?: string }[] }[] } } }> }).records.get(c.id)!;
  assert.equal(record.compiled.spec.stages.find(({ id }) => id === "open.pools")!.pool!.allocation, "manual");
  assert.ok(record.compiled.graph.nodes.some((node) => node.kind === "contest" && node.stageId === "open.pools"
    && ["pk.pair.1", "pk.pair.2"].every((id) => node.slots.some((slot) => slot.entrantId === id))),
  "pairs 1 and 2 now meet in their pool");
});

test("a placement is refused unless it places the exact roster once and fills every pool to its size", () => {
  const { journey, c } = draft();
  const view = c.poolMembership!;
  const all = view.pools.flatMap(({ poolId, entrants }) => entrants.map(({ entrantId }) => ({ entrantId, poolId })));
  const attempt = (assignments: typeof all, basisHash = view.basisHash) =>
    journey.previewPoolMembership(c.id, c.draftVersion, { kind: "PLACED", stageId: view.stageId, basisHash, assignments });
  assert.throws(() => attempt(all.slice(1)), /pool_membership_invalid/, "an entrant left out");
  assert.throws(() => attempt([...all.slice(1), { ...all[0]!, entrantId: "pk.pair.99" }]), /pool_membership_invalid/, "an unknown entrant");
  assert.throws(() => attempt(all.map((a, i) => i === 0 ? { ...a, poolId: view.pools[1]!.poolId } : a)), /pool_membership_invalid/,
    "pools of 3, 5 and 4 do not match the declared 4, 4 and 4");
  assert.throws(() => attempt(all.map((a, i) => i === 0 ? { ...a, poolId: "open.pools.P9" } : a)), /pool_membership_invalid/, "an undeclared pool");
  assert.throws(() => attempt(all, "0".repeat(64)), /pool_membership_stale/, "a placement made for something else");
  assert.equal(journey.read(c.id)!.draftVersion, c.draftVersion, "nothing was saved");
  assert.equal(journey.read(c.id)!.poolMembershipHistory, undefined);
});

test("changing the roster after placing the pools blocks the plan until the pools are placed again or cleared", () => {
  const { journey, c: start } = draft();
  let c = change(journey, start, placed(start, placeTopSeedsTogether(start.poolMembership)));
  // Pair 12 withdraws and pair 13 enters: the saved placement no longer covers the roster.
  c = journey.removeSource(c.id, c.draftVersion, c.workbench.sources.at(-1)!.id);
  c = journey.addSource(c.id, c.draftVersion, { mode: "csv", text: roster([...pairs.slice(0, 11), "pk.pair.13"]) });
  assert.equal(c.status, "NEEDS_INPUT");
  assert.equal(c.poolMembership!.stale, true);
  assert.equal(c.poolMembership!.source, "AUTOMATIC", "a stale placement is never shown as the pools in force");
  assert.throws(() => journey.compile(c.id, c.draftVersion), /pool_membership_stale/);
  c = change(journey, c, { kind: "AUTOMATIC" });
  assert.equal(c.status, "DRAFT");
  assert.equal(c.poolMembership!.stale, false);
  assert.equal(journey.compile(c.id, c.draftVersion).compiled!.guardStatus, "PASSED");
});

/** Seeds 1, 2 and 3 in one pool: only two of them can qualify, so the knockout differs from the automatic draw's. */
function placeTopThreeTogether(view: NonNullable<ReturnType<CompetitionJourney["read"]>>["poolMembership"]) {
  const assignments = view!.pools.flatMap(({ poolId, entrants }) => entrants.map(({ entrantId }) => ({ entrantId, poolId })));
  const home = assignments.find(({ entrantId }) => entrantId === "pk.pair.1")!.poolId;
  for (const mover of ["pk.pair.2", "pk.pair.3"]) {
    const moving = assignments.find(({ entrantId }) => entrantId === mover)!;
    const displaced = assignments.find(({ poolId, entrantId }) => poolId === home && !["pk.pair.1", "pk.pair.2", "pk.pair.3"].includes(entrantId))!;
    [displaced.poolId, moving.poolId] = [moving.poolId, home];
  }
  return assignments;
}

test("the organiser's pools carry into live play and the knockout fills from them", () => {
  const clock = { now: "2026-11-01T08:00:00.000Z" };
  const { journey, c: start } = draft(clock);
  let c = change(journey, start, placed(start, placeTopThreeTogether(start.poolMembership)));
  c = journey.compile(c.id, c.draftVersion);
  c = journey.approve(c.id, c.revision, "organiser.approver", c.compiled!.requiredAcknowledgementCodes);
  c = journey.activateLive(c.id, c.publication!.revision, "operator.lead");
  const revision = c.publication!.revision;
  clock.now = "2026-11-07T08:50:00.000Z";
  const submit = (command: Record<string, unknown>) => {
    c = journey.submitLiveCommand(c.id, revision, { ...command, commandId: `pm.${c.live!.state.version + 1}`,
      expectedVersion: c.live!.state.version, actorId: "operator.lead", occurredAt: clock.now } as never);
  };
  for (const entrantId of pairs) submit({ kind: "CHECK_IN", entrantId });
  for (let guard = 0; guard < 60; guard += 1) {
    const live = journey.readOrganiserLive({ organizationId: "org.pk", competitionId: c.id, expectedOperationalRevision: revision, at: clock.now });
    const next = live.controlContests.filter(({ status }) => status === "SCHEDULED")
      .sort((a, b) => a.scheduledStart.localeCompare(b.scheduledStart) || a.contestId.localeCompare(b.contestId))[0];
    if (!next) break;
    if (Date.parse(clock.now) < Date.parse(next.scheduledStart)) clock.now = next.scheduledStart;
    submit({ kind: "START_CONTEST", contestId: next.contestId, courtId: next.courtId, startedAt: clock.now });
    const [first, second] = betterSeed(next.sides);
    clock.now = new Date(Date.parse(clock.now) + 20 * 60_000).toISOString();
    submit({ kind: "RECORD_SCORE", contestId: next.contestId, scores: [{ entrantId: first.entrantId, value: 6 }, { entrantId: second.entrantId, value: 2 }] });
    submit({ kind: "COMPLETE_CONTEST", contestId: next.contestId, endedAt: clock.now });
    submit({ kind: "RECORD_RESULT_RECEIPT", contestId: next.contestId, source: "desk" });
  }
  const final = journey.readOrganiserLive({ organizationId: "org.pk", competitionId: c.id, expectedOperationalRevision: revision, at: clock.now });
  assert.ok(final.controlContests.every(({ status }) => status === "COMPLETED"));
  const knockout = new Set(final.controlContests.filter(({ contestId }) => contestId.startsWith("open.main"))
    .flatMap(({ sides }) => sides.map(({ entrantId }) => entrantId)));
  // The better seed always wins, so each pool's top two by seed qualify. The knockout must be exactly that
  // set for the placed pools, which differs from what the automatic pools would have produced.
  const qualifiers = (view: NonNullable<typeof start.poolMembership>) => new Set(view.pools.flatMap(({ entrants }) =>
    entrants.map(({ entrantId }) => entrantId).sort((a, b) => pairs.indexOf(a) - pairs.indexOf(b)).slice(0, 2)));
  const fromPlacedPools = qualifiers(journey.read(c.id)!.poolMembership!);
  assert.deepEqual([...knockout].sort(), [...fromPlacedPools].sort(), "the knockout is filled from the placed pools");
  assert.notDeepEqual([...fromPlacedPools].sort(), [...qualifiers(start.poolMembership!)].sort(), "and not from the automatic draw");
});

test("a placement left over from a format without these pools stays visible so it can be cleared", () => {
  const { journey, c: start } = draft();
  let c = change(journey, start, placed(start, placeTopSeedsTogether(start.poolMembership)));
  c = journey.revise(c.id, c.draftVersion, { mode: "quick", value: { ...facts, format: "round_robin", minimumMatches: 11 } });
  assert.equal(c.status, "NEEDS_INPUT", "the obsolete placement still blocks the plan");
  assert.deepEqual({ stale: c.poolMembership?.stale, pools: c.poolMembership?.pools.length }, { stale: true, pools: 0 },
    "and the Studio still has it to show, with nothing left to place");
  c = change(journey, c, { kind: "AUTOMATIC" });
  assert.equal(c.poolMembership, undefined);
  assert.equal(c.status, "DRAFT");
});

test("a pool change is previewed with its consequences and applied only with that exact preview", () => {
  const { journey, c: start } = draft();
  let c = journey.compile(start.id, start.draftVersion);
  const request = placed(c, placeTopSeedsTogether(c.poolMembership));
  const preview = journey.previewPoolMembership(c.id, c.draftVersion, request);
  assert.equal(preview.moves.length, 2, "pair 2 and the pair it swaps with change pool");
  assert.ok(preview.moves.some(({ displayName }) => displayName === "Winter Pair 2"));
  assert.deepEqual(preview.poolMatches, { added: 6, removed: 6 }, "each moved pair gains three pool opponents and loses three");
  assert.ok(preview.consequences.some((text) => /plan already created is set aside/.test(text)));
  assert.equal(journey.read(c.id)!.status, "READY_FOR_APPROVAL", "a preview changes nothing");

  assert.throws(() => journey.applyPoolMembership(c.id, c.draftVersion, request, "0".repeat(64), "organiser.author"),
    /pool_membership_preview_mismatch/);
  const other = placed(c, placeTopThreeTogether(c.poolMembership));
  assert.throws(() => journey.applyPoolMembership(c.id, c.draftVersion, other, preview.previewHash, "organiser.author"),
    /pool_membership_preview_mismatch/, "a different placement cannot ride on another preview");
  assert.throws(() => journey.applyPoolMembership(c.id, c.draftVersion, request, preview.previewHash, " "), /pool_membership_requires_actor/);

  c = journey.applyPoolMembership(c.id, c.draftVersion, request, preview.previewHash, "organiser.author");
  assert.equal(c.status, "DRAFT", "the earlier plan is set aside");
  c = change(journey, c, { kind: "AUTOMATIC" }, "organiser.second");
  assert.deepEqual(c.poolMembershipHistory!.map(({ action, decidedBy }) => ({ action, decidedBy })),
    [{ action: "PLACED", decidedBy: "organiser.author" }, { action: "RETURNED_TO_AUTOMATIC", decidedBy: "organiser.second" }],
    "every applied pool change is attributed");
  assert.equal(c.poolMembershipHistory![0]!.previewHash, preview.previewHash);
  assert.throws(() => journey.previewPoolMembership(c.id, c.draftVersion, { kind: "AUTOMATIC" }), /pool_membership_already_automatic/);
});

test("a stored placement is verified independently when the store is loaded", () => {
  const directory = mkdtempSync(join(tmpdir(), "pools-"));
  try {
    const storagePath = join(directory, "journeys.json");
    const options = { organizationId: "org.pk", now: () => "2026-11-01T08:00:00.000Z", storagePath };
    const journey = new CompetitionJourney(options);
    let c = journey.create({ mode: "quick", value: facts }, "organiser.author");
    c = journey.addSource(c.id, c.draftVersion, { mode: "csv", text: roster(pairs) });
    c = change(journey, c, placed(c, placeTopSeedsTogether(c.poolMembership)));
    assert.equal(new CompetitionJourney(options).read(c.id)!.poolMembership!.source, "ORGANISER", "an honest store reloads");

    // Forge the stored placement: pool 1 gets five pairs and pool 2 three, under the current fingerprint,
    // with the history and every hash recomputed so that only the placement's own validity can catch it.
    const envelope = JSON.parse(readFileSync(storagePath, "utf8"));
    const record = envelope.records.find(({ id }: { id: string }) => id === c.id);
    const moved = record.poolMembership.assignments.find(({ poolId }: { poolId: string }) => poolId === "open.pools.P2");
    moved.poolId = "open.pools.P1";
    record.poolMembershipHistory.at(-1).assignmentsHash = canonicalHash(record.poolMembership.assignments);
    const { recordHash: _recordHash, ...body } = record;
    record.recordHash = canonicalHash(body);
    envelope.storeHash = canonicalHash(envelope.records);
    writeFileSync(storagePath, JSON.stringify(envelope));
    assert.throws(() => new CompetitionJourney(options), /journey_store_integrity_failed/);

    // A placement with no audit entry is refused too.
    record.poolMembershipHistory = [];
    const { recordHash: _again, ...unaudited } = record;
    record.recordHash = canonicalHash(unaudited);
    envelope.storeHash = canonicalHash(envelope.records);
    writeFileSync(storagePath, JSON.stringify(envelope));
    assert.throws(() => new CompetitionJourney(options), /journey_store_integrity_failed/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
