import assert from "node:assert/strict";
import test from "node:test";
import { buildCompetitionGraph, type Entrant } from "@tournament-os/competition-engine";
import { liveEvent } from "./support/pools-knockout-event.js";

// The knockout a pools-into-knockout event builds follows its declared draw policy: an optimised draw that
// avoids an opening same-pool meeting. The same placement runs for the plan and for the live replay.

test("the event's knockout avoids an opening same-pool meeting that the plain seeded bracket would create", () => {
  const event = liveEvent();
  const record = (event.journey as unknown as { records: Map<string, { compiled: { spec: Parameters<typeof buildCompetitionGraph>[0] } }> })
    .records.get(event.competition.id)!;
  const spec = record.compiled.spec;
  assert.equal(spec.drawPolicies.find(({ structureId }) => structureId === "open.knockout.structure")!.placement, "optimised");
  const roster = Object.values(event.competition.poolMembership!.pools).flatMap(({ entrants }) => entrants.map(({ entrantId }) => entrantId));
  const entrants: Entrant[] = roster.map((id, index) => ({ id, divisionId: "open", memberIds: [`${id}.a`, `${id}.b`], seed: index + 1 }));
  // Qualifiers seeded 1–6, where seed 4 shares a pool with seed 1: in the seeded bracket seed 1's
  // opening opponent is the winner of seeds 4 v 5.
  const pool = ["P1", "P2", "P3", "P1", "P2", "P3"];
  const qualified = pool.map((poolId, index) => ({ ...entrants[index]!, seed: index + 1, poolId: `open.pools.${poolId}` }));
  const graph = buildCompetitionGraph(spec, { open: entrants }, { "open.knockout.structure": qualified });
  assert.deepEqual(graph.findings.filter(({ code }) => code === "TSC511"), []);
  const opening = graph.nodes.filter(({ stageId, roundIndex }) => stageId === "open.main" && roundIndex === 1);
  const poolOf = new Map(qualified.map(({ id, poolId }) => [id, poolId]));
  const seedOne = qualified[0]!.id;
  const byeIndex = opening.findIndex(({ slots }) => slots.some((slot) => slot.type === "entrant" && slot.entrantId === seedOne));
  const neighbour = opening[byeIndex % 2 === 0 ? byeIndex + 1 : byeIndex - 1]!;
  const opponents = neighbour.slots.flatMap((slot) => slot.type === "entrant" ? [slot.entrantId] : []);
  assert.ok(opponents.every((id) => poolOf.get(id) !== poolOf.get(seedOne)), "seed 1 cannot open against a pair from its own pool");
  const byes = opening.filter(({ kind }) => kind === "bye").map(({ id }) => id).sort();
  const seededGraph = buildCompetitionGraph({ ...spec, drawPolicies: spec.drawPolicies.map((policy) => ({ ...policy, placement: "seeded" as const })) },
    { open: entrants }, { "open.knockout.structure": qualified });
  assert.deepEqual(byes, seededGraph.nodes.filter(({ stageId, roundIndex, kind }) => stageId === "open.main" && roundIndex === 1 && kind === "bye")
    .map(({ id }) => id).sort(), "the bracket's shape is the same as the seeded bracket's, so plan and replay agree");
});

function knockoutFixture() {
  const event = liveEvent();
  const record = (event.journey as unknown as { records: Map<string, { compiled: { spec: Parameters<typeof buildCompetitionGraph>[0] } }> })
    .records.get(event.competition.id)!;
  const spec = record.compiled.spec;
  const roster = Object.values(event.competition.poolMembership!.pools).flatMap(({ entrants }) => entrants.map(({ entrantId }) => entrantId));
  const entrants: Entrant[] = roster.map((id, index) => ({ id, divisionId: "open", memberIds: [`${id}.a`, `${id}.b`], seed: index + 1 }));
  const pool = ["P1", "P2", "P3", "P1", "P2", "P3"];
  const qualified = pool.map((poolId, index) => ({ ...entrants[index]!, seed: index + 1, poolId: `open.pools.${poolId}` }));
  const withRules = (priorities: (typeof spec.drawPolicies)[number]["priorities"]) => ({ ...spec,
    drawPolicies: spec.drawPolicies.map((policy) => policy.structureId === "open.knockout.structure" ? { ...policy, priorities } : policy) });
  return { spec, entrants, qualified, withRules };
}

test("a declared draw rule the engine cannot enforce fails closed with TSC512 instead of being ignored", () => {
  const { entrants, qualified, withRules } = knockoutFixture();
  const graph = buildCompetitionGraph(withRules([{ rule: "avoid_same_club", strength: "HARD", priority: 1 }]),
    { open: entrants }, { "open.knockout.structure": qualified });
  assert.equal(graph.findings.filter(({ code }) => code === "TSC512").length, 1);
});

test("a declared any-rematch rule is enforced: pool-mates are prior meetings and are kept apart in the opening round", () => {
  const { entrants, qualified, withRules } = knockoutFixture();
  const graph = buildCompetitionGraph(withRules([{ rule: "avoid_any_rematch", strength: "HARD", priority: 1 }]),
    { open: entrants }, { "open.knockout.structure": qualified });
  assert.deepEqual(graph.findings.filter(({ code }) => code === "TSC511" || code === "TSC512"), []);
  const poolOf = new Map(qualified.map(({ id, poolId }) => [id, poolId]));
  for (const node of graph.nodes.filter(({ stageId, roundIndex, kind }) => stageId === "open.main" && roundIndex === 1 && kind !== "bye")) {
    const ids = node.slots.flatMap((slot) => slot.type === "entrant" ? [slot.entrantId] : []);
    if (ids.length === 2) assert.notEqual(poolOf.get(ids[0]!), poolOf.get(ids[1]!), `${ids.join(" v ")} met in their pool`);
  }
});
