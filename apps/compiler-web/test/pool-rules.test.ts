import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalHash } from "@tournament-os/tournament-schema";
import { CompetitionJourney, type PoolPlacementRequest } from "../src/competition-journey.js";
import { betterSeed, pairs } from "./support/pools-knockout-event.js";

// Keep-together and keep-apart rules on the pools: every draw honours them, an organiser's own placement
// must honour them, and they are previewed, applied, audited and re-verified like any pool change.

const facts = { name: "Winter Pools and Knockout", sport: "padel", participantUnit: "pairs", participantCount: 12, resourceCount: 3,
  resourceLabel: "courts", format: "pools_to_knockout", poolSize: 4, qualifiersPerPool: 2, minimumMatches: 3, minimumRestMinutes: 10,
  matchDurationMinutes: 20, timezone: "Europe/London", priority: "fair_recovery", scoringPolicy: "head_to_head_total_score_no_draw",
  tiebreakPolicy: "wins_score_difference_score_for_manual", withdrawalPolicy: "preserve_played_walkover_future",
  drawPolicy: "seeded_input_order", startsAt: "2026-11-07T09:00:00.000Z", endsAt: "2026-11-07T21:00:00.000Z" } as const;
const roster = (ids: readonly string[]) => ["entrant_id,display_name,division_id,member_ids,seed",
  ...ids.map((id, index) => `${id},Winter Pair ${id.split(".").at(-1)},open,${id}.a|${id}.b,${index + 1}`)].join("\n");
type Snapshot = ReturnType<CompetitionJourney["create"]>;

function draft(options: ConstructorParameters<typeof CompetitionJourney>[0] = {}) {
  const journey = new CompetitionJourney({ organizationId: "org.pk", now: () => "2026-11-01T08:00:00.000Z", ...options });
  let c = journey.create({ mode: "quick", value: facts }, "organiser.author");
  c = journey.addSource(c.id, c.draftVersion, { mode: "csv", text: roster(pairs) });
  return { journey, c };
}
function change(journey: CompetitionJourney, c: Snapshot, request: PoolPlacementRequest) {
  return journey.applyPoolMembership(c.id, c.draftVersion, request, journey.previewPoolMembership(c.id, c.draftVersion, request).previewHash, "organiser.author");
}
const poolOf = (c: Snapshot, id: string) => c.poolMembership!.pools.find(({ entrants }) => entrants.some(({ entrantId }) => entrantId === id))!.poolId;
const p = (n: number) => `pk.pair.${n}`;

test("the automatic draw honours keep-together and keep-apart rules, and so does the plan", () => {
  const { journey, c: start } = draft();
  assert.equal(poolOf(start, p(4)), poolOf(start, p(9)), "the seeded draw puts pairs 4 and 9 together");
  assert.notEqual(poolOf(start, p(1)), poolOf(start, p(2)), "and pairs 1 and 2 apart");
  const rules = [{ kind: "SEPARATE" as const, entrantIds: [p(4), p(9)] }, { kind: "TOGETHER" as const, entrantIds: [p(1), p(2)] }];
  const preview = journey.previewPoolMembership(start.id, start.draftVersion, { kind: "RULES", rules });
  assert.ok(preview.moves.length > 0 && preview.consequences.some((text) => /2 pool rules will apply/.test(text)));
  let c = change(journey, start, { kind: "RULES", rules });
  assert.equal(c.poolMembership!.source, "AUTOMATIC");
  assert.deepEqual(c.poolMembership!.rules.map(({ kind, entrants }) => [kind, entrants.map(({ entrantId }) => entrantId)]),
    [["SEPARATE", [p(4), p(9)]], ["TOGETHER", [p(1), p(2)]]]);
  assert.notEqual(poolOf(c, p(4)), poolOf(c, p(9)));
  assert.equal(poolOf(c, p(1)), poolOf(c, p(2)));
  assert.deepEqual(c.poolMembership!.pools.map(({ entrants }) => entrants.length), [4, 4, 4]);

  c = journey.compile(c.id, c.draftVersion);
  assert.equal(c.compiled!.guardStatus, "PASSED");
  const record = (journey as unknown as { records: Map<string, { compiled: { spec: { stages: { id: string; pool?: { allocation: string; membershipConstraints?: unknown } }[] };
    graph: { nodes: { kind: string; stageId: string; slots: { entrantId?: string }[] }[] } } }> }).records.get(c.id)!;
  const stage = record.compiled.spec.stages.find(({ id }) => id === "open.pools")!;
  assert.equal(stage.pool!.allocation, "optimised");
  assert.deepEqual(stage.pool!.membershipConstraints, rules);
  const meets = (a: string, b: string) => record.compiled.graph.nodes.some((node) => node.kind === "contest" && node.stageId === "open.pools"
    && [a, b].every((id) => node.slots.some((slot) => slot.entrantId === id)));
  assert.ok(meets(p(1), p(2)) && !meets(p(4), p(9)), "the plan's pool matches follow the rules, exactly as the Studio showed");
});

test("rules and a saved placement are each checked against the other, and invalid rules are refused", () => {
  const { journey, c: start } = draft();
  const assignments = start.poolMembership!.pools.flatMap(({ poolId, entrants }) => entrants.map(({ entrantId }) => ({ entrantId, poolId })));
  let c = change(journey, start, { kind: "PLACED", stageId: start.poolMembership!.stageId, basisHash: start.poolMembership!.basisHash, assignments });
  assert.throws(() => journey.previewPoolMembership(c.id, c.draftVersion, { kind: "RULES", rules: [{ kind: "SEPARATE", entrantIds: [p(4), p(9)] }] }),
    /pool_rules_break_placement/, "a rule the saved placement breaks is refused");
  c = change(journey, c, { kind: "RULES", rules: [{ kind: "SEPARATE", entrantIds: [p(1), p(2)] }] });
  const together = assignments.map((a) => a.entrantId === p(2) ? { ...a, poolId: poolOf(c, p(1)) }
    : a.entrantId === p(6) ? { ...a, poolId: poolOf(c, p(2)) } : a);
  assert.throws(() => journey.previewPoolMembership(c.id, c.draftVersion, { kind: "PLACED", stageId: c.poolMembership!.stageId,
    basisHash: c.poolMembership!.basisHash, assignments: together }), /pool_membership_breaks_rule/, "a placement that breaks a rule is refused");
  for (const rules of [[{ kind: "TOGETHER" as const, entrantIds: [p(1)] }], [{ kind: "TOGETHER" as const, entrantIds: [p(1), "pk.pair.99"] }],
    [{ kind: "TOGETHER" as const, entrantIds: [p(1), p(2), p(3), p(4), p(5)] }], [{ kind: "SEPARATE" as const, entrantIds: [p(1), p(2), p(3), p(4)] }]])
    assert.throws(() => journey.previewPoolMembership(c.id, c.draftVersion, { kind: "RULES", rules }), /pool_rules_invalid/);
});

test("a rule naming a pair who left the roster blocks the plan until the rules are changed", () => {
  const { journey, c: start } = draft();
  let c = change(journey, start, { kind: "RULES", rules: [{ kind: "SEPARATE", entrantIds: [p(4), p(12)] }] });
  c = journey.removeSource(c.id, c.draftVersion, c.workbench.sources.at(-1)!.id);
  c = journey.addSource(c.id, c.draftVersion, { mode: "csv", text: roster([...pairs.slice(0, 11), "pk.pair.13"]) });
  assert.equal(c.status, "NEEDS_INPUT");
  assert.equal(c.poolMembership!.rulesStale, true);
  assert.throws(() => journey.compile(c.id, c.draftVersion), /pool_rules_stale/);
  c = change(journey, c, { kind: "RULES", rules: [] });
  assert.equal(c.status, "DRAFT");
  assert.deepEqual(c.poolMembershipHistory!.map(({ action }) => action), ["RULES_SET", "RULES_SET"]);
});

test("stored rules are re-verified at load: rules without their audit entry are refused", () => {
  const directory = mkdtempSync(join(tmpdir(), "pool-rules-"));
  try {
    const storagePath = join(directory, "journeys.json");
    const { journey, c: start } = draft({ storagePath });
    const c = change(journey, start, { kind: "RULES", rules: [{ kind: "TOGETHER", entrantIds: [p(1), p(2)] }] });
    assert.equal(new CompetitionJourney({ organizationId: "org.pk", storagePath }).read(c.id)!.poolMembership!.rules.length, 1);
    const envelope = JSON.parse(readFileSync(storagePath, "utf8"));
    const record = envelope.records.find(({ id }: { id: string }) => id === c.id);
    record.poolRules = [{ kind: "SEPARATE", entrantIds: [p(1), p(2)] }];
    const { recordHash: _hash, ...body } = record;
    record.recordHash = canonicalHash(body);
    envelope.storeHash = canonicalHash(envelope.records);
    writeFileSync(storagePath, JSON.stringify(envelope));
    assert.throws(() => new CompetitionJourney({ organizationId: "org.pk", storagePath }), /journey_store_integrity_failed/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("an event with pool rules plays live to the final from the same pools it planned", () => {
  const clock = { now: "2026-11-01T08:00:00.000Z" };
  const { journey, c: start } = draft({ now: () => clock.now });
  let c = change(journey, start, { kind: "RULES", rules: [{ kind: "TOGETHER", entrantIds: [p(1), p(2)] }, { kind: "SEPARATE", entrantIds: [p(4), p(9)] }] });
  const planned = c.poolMembership!;
  c = journey.compile(c.id, c.draftVersion);
  c = journey.approve(c.id, c.revision, "organiser.approver", c.compiled!.requiredAcknowledgementCodes);
  c = journey.activateLive(c.id, c.publication!.revision, "operator.lead");
  const revision = c.publication!.revision;
  clock.now = "2026-11-07T08:50:00.000Z";
  const submit = (command: Record<string, unknown>) => {
    c = journey.submitLiveCommand(c.id, revision, { ...command, commandId: `pr.${c.live!.state.version + 1}`,
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
  assert.ok(final.controlContests.every(({ status }) => status === "COMPLETED"), "every fixture, pools to final, was played");
  const knockout = new Set(final.controlContests.filter(({ contestId }) => contestId.startsWith("open.main")).flatMap(({ sides }) => sides.map(({ entrantId }) => entrantId)));
  const expected = new Set(planned.pools.flatMap(({ entrants }) => entrants.map(({ entrantId }) => entrantId)
    .sort((a, b) => pairs.indexOf(a) - pairs.indexOf(b)).slice(0, 2)));
  assert.deepEqual([...knockout].sort(), [...expected].sort(), "the knockout is filled from the pools the rules produced");
});
