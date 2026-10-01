import assert from "node:assert/strict";
import test from "node:test";
import { placeConstraintDraw } from "../src/draw-constraints.js";
import { seedOrder } from "../src/graph.js";
import type { Entrant } from "../src/types.js";

// Knockout draws: the seeded bracket protects the top seeds at every tier, and an optimised draw moves
// pairs only as much as its declared rules require, with byes held where the seeded bracket puts them.

const entrant = (seed: number, poolId?: string): Entrant => ({ id: `e${seed}`, divisionId: "open", memberIds: [], seed, ...(poolId ? { poolId } : {}) });

test("the seeded bracket keeps seeds 1 and 2 in opposite halves, the top 4 in separate quarters, and so on, at every size", () => {
  for (let size = 2; size <= 128; size *= 2) {
    const order = seedOrder(size);
    assert.deepEqual([...order].sort((a, b) => a - b), Array.from({ length: size }, (_, i) => i + 1), `size ${size} places every seed once`);
    for (let tier = 2; tier <= size; tier *= 2) {
      const sections = new Set(Array.from({ length: tier }, (_, i) => Math.floor(order.indexOf(i + 1) / (size / tier))));
      assert.equal(sections.size, tier, `size ${size}: the top ${tier} seeds are in ${tier} different sections`);
    }
  }
});

test("seed protection is hierarchical: separate quarters are not enough if seeds 1 and 2 share a half", () => {
  const entrants = Array.from({ length: 8 }, (_, i) => entrant(i + 1));
  // Quarters [e1,e8] [e2,e7] [e4,e5] [e3,e6]: seeds 1-4 are in four different quarters, but 1 and 2
  // share the top half, so they could meet in a semi-final.
  const draw = placeConstraintDraw({ structureId: "ko", entrants, priorMeetings: [], protectedSeedCount: 4,
    constraints: { avoid_same_pool_rematch: { enabled: false }, avoid_any_rematch: { enabled: false } } });
  assert.equal(draw.status, "PLACED");
  const slot = (id: string) => draw.orderedSlotIds.indexOf(id);
  assert.notEqual(Math.floor(slot("e1") / 4), Math.floor(slot("e2") / 4), "seeds 1 and 2 are in opposite halves");
  assert.equal(new Set(["e1", "e2", "e3", "e4"].map((id) => Math.floor(slot(id) / 2))).size, 4, "the top four are in separate quarters");
  assert.deepEqual(draw.orderedSlotIds, seedOrder(8).map((seed) => `e${seed}`), "with nothing to fix, the seeded bracket is kept exactly");
});

test("an optimised draw avoids a bye-holder opening against its own pool, holding the byes in place", () => {
  // Six qualifiers in an eight-slot bracket: seeds 1 and 2 have byes. Seed 1 opens against the winner of
  // seeds 4 v 5, and seed 4 is from seed 1's pool.
  const entrants = [entrant(1, "P1"), entrant(2, "P2"), entrant(3, "P3"), entrant(4, "P1"), entrant(5, "P2"), entrant(6, "P3")];
  const seeded = seedOrder(8).map((seed) => seed <= 6 ? `e${seed}` : null);
  const draw = placeConstraintDraw({ structureId: "ko", entrants, priorMeetings: [], fixedByeSlots: true,
    constraints: { avoid_same_pool_rematch: { enabled: true, strength: "SOFT", priority: 3 }, avoid_any_rematch: { enabled: false } } });
  assert.equal(draw.status, "PLACED");
  assert.deepEqual(draw.orderedSlotIds.map((id) => id === null), seeded.map((id) => id === null), "the byes stay where the seeded bracket puts them");
  assert.deepEqual(draw.violations.filter(({ rule }) => rule === "avoid_same_pool_rematch"), [], "no opening pool rematch remains");
  const one = draw.orderedSlotIds.indexOf("e1");
  const neighbours = one % 4 === 0 ? [one + 2, one + 3] : [one - 2, one - 1];
  assert.ok(neighbours.every((index) => draw.orderedSlotIds[index] !== "e4"), "seed 1 cannot open against its pool-mate");
  assert.notEqual(Math.floor(one / 4), Math.floor(draw.orderedSlotIds.indexOf("e2") / 4), "and seed protection still holds");
  const moved = draw.orderedSlotIds.filter((id, index) => id !== seeded[index]).length;
  assert.ok(moved <= 2, `the draw moves as few pairs as it can (${moved} slots changed)`);
});

test("a large bracket whose seeded opening pairs all share a pool is repaired by local search, not reported impossible", () => {
  // Sixteen entrants in eight pools of two, seeded so that every seeded opening pair (1v16, 8v9, ...) is a pool pair.
  const order = seedOrder(16);
  const poolOf = new Map<number, string>();
  for (let index = 0; index < 16; index += 2) { poolOf.set(order[index]!, `P${index / 2}`); poolOf.set(order[index + 1]!, `P${index / 2}`); }
  const entrants = Array.from({ length: 16 }, (_, i) => entrant(i + 1, poolOf.get(i + 1)));
  const draw = placeConstraintDraw({ structureId: "ko", entrants, priorMeetings: [], fixedByeSlots: true,
    constraints: { avoid_same_pool_rematch: { enabled: true, strength: "HARD", priority: 1 }, avoid_any_rematch: { enabled: false } } });
  assert.equal(draw.status, "PLACED");
  assert.deepEqual(draw.violations.filter(({ rule }) => rule === "avoid_same_pool_rematch"), []);
});

test("an exhausted search that finds nothing is UNKNOWN beyond the exhaustive size, never INFEASIBLE", () => {
  // Every pair has met before, so no opening round can avoid a rematch; at 16 entrants the search is bounded.
  const entrants = Array.from({ length: 16 }, (_, i) => entrant(i + 1));
  const priorMeetings = entrants.flatMap((left, index) => entrants.slice(index + 1).map((right) => [left.id, right.id] as const));
  const draw = placeConstraintDraw({ structureId: "ko", entrants, priorMeetings, fixedByeSlots: true, candidateLimit: 50,
    constraints: { avoid_same_pool_rematch: { enabled: false }, avoid_any_rematch: { enabled: true, strength: "HARD", priority: 1 } } });
  assert.equal(draw.status, "UNKNOWN");
  const small = placeConstraintDraw({ structureId: "ko", entrants: entrants.slice(0, 4), priorMeetings, fixedByeSlots: true,
    constraints: { avoid_same_pool_rematch: { enabled: false }, avoid_any_rematch: { enabled: true, strength: "HARD", priority: 1 } } });
  assert.equal(small.status, "INFEASIBLE", "a complete search may say impossible");
});

test("holding byes in place is part of the draw's proof", () => {
  const entrants = Array.from({ length: 6 }, (_, i) => entrant(i + 1));
  const base = { structureId: "ko", entrants, priorMeetings: [] as const,
    constraints: { avoid_same_pool_rematch: { enabled: false }, avoid_any_rematch: { enabled: false } } };
  assert.notEqual(placeConstraintDraw({ ...base, fixedByeSlots: true }).proofHash,
    placeConstraintDraw({ ...base, fixedByeSlots: false }).proofHash);
});
