import assert from "node:assert/strict";
import test from "node:test";
import { CompetitionJourney } from "../src/competition-journey.js";
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

  let c = journey.setPoolMembership(start.id, start.draftVersion, { stageId: automatic.stageId, basisHash: automatic.basisHash,
    assignments: placeTopSeedsTogether(automatic) }, "organiser.author");
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
    journey.setPoolMembership(c.id, c.draftVersion, { stageId: view.stageId, basisHash, assignments }, "organiser.author");
  assert.throws(() => attempt(all.slice(1)), /pool_membership_invalid/, "an entrant left out");
  assert.throws(() => attempt([...all.slice(1), { ...all[0]!, entrantId: "pk.pair.99" }]), /pool_membership_invalid/, "an unknown entrant");
  assert.throws(() => attempt(all.map((a, i) => i === 0 ? { ...a, poolId: view.pools[1]!.poolId } : a)), /pool_membership_invalid/,
    "pools of 3, 5 and 4 do not match the declared 4, 4 and 4");
  assert.throws(() => attempt(all.map((a, i) => i === 0 ? { ...a, poolId: "open.pools.P9" } : a)), /pool_membership_invalid/, "an undeclared pool");
  assert.throws(() => attempt(all, "0".repeat(64)), /pool_membership_stale/, "a placement made for something else");
  assert.equal(journey.read(c.id)!.draftVersion, c.draftVersion, "nothing was saved");
});

test("changing the roster after placing the pools blocks the plan until the pools are placed again or cleared", () => {
  const { journey, c: start } = draft();
  let c = journey.setPoolMembership(start.id, start.draftVersion, { stageId: start.poolMembership!.stageId,
    basisHash: start.poolMembership!.basisHash, assignments: placeTopSeedsTogether(start.poolMembership) }, "organiser.author");
  // Pair 12 withdraws and pair 13 enters: the saved placement no longer covers the roster.
  c = journey.removeSource(c.id, c.draftVersion, c.workbench.sources.at(-1)!.id);
  c = journey.addSource(c.id, c.draftVersion, { mode: "csv", text: roster([...pairs.slice(0, 11), "pk.pair.13"]) });
  assert.equal(c.status, "NEEDS_INPUT");
  assert.equal(c.poolMembership!.stale, true);
  assert.equal(c.poolMembership!.source, "AUTOMATIC", "a stale placement is never shown as the pools in force");
  assert.throws(() => journey.compile(c.id, c.draftVersion), /pool_membership_stale/);
  c = journey.clearPoolMembership(c.id, c.draftVersion);
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
  let c = journey.setPoolMembership(start.id, start.draftVersion, { stageId: start.poolMembership!.stageId,
    basisHash: start.poolMembership!.basisHash, assignments: placeTopThreeTogether(start.poolMembership) }, "organiser.author");
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
  const placed = qualifiers(journey.read(c.id)!.poolMembership!);
  assert.deepEqual([...knockout].sort(), [...placed].sort(), "the knockout is filled from the placed pools");
  assert.notDeepEqual([...placed].sort(), [...qualifiers(start.poolMembership!)].sort(), "and not from the automatic draw");
});
