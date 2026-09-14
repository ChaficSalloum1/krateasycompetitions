import assert from "node:assert/strict";
import test from "node:test";
import { placeConstraintDraw, type ConstraintDrawInput } from "../src/draw-constraints.js";
import type { Entrant } from "../src/types.js";

const entrants: Entrant[] = [
  { id: "E1", divisionId: "open", memberIds: ["P1"], seed: 1, poolId: "A" },
  { id: "E2", divisionId: "open", memberIds: ["P2"], seed: 2, poolId: "A" },
  { id: "E3", divisionId: "open", memberIds: ["P3"], seed: 3, poolId: "B" },
  { id: "E4", divisionId: "open", memberIds: ["P4"], seed: 4, poolId: "B" },
  { id: "E5", divisionId: "open", memberIds: ["P5"], seed: 5, poolId: "C" },
];

const input = (overrides: Partial<ConstraintDrawInput> = {}): ConstraintDrawInput => ({
  structureId: "main",
  entrants,
  priorMeetings: [],
  ...overrides,
});

test("protected byes go to the highest seeds deterministically", () => {
  const first = placeConstraintDraw(input());
  const replay = placeConstraintDraw(input({ entrants: [...entrants].reverse() }));

  assert.equal(first.status, "PLACED");
  assert.deepEqual(first.orderedSlotIds, replay.orderedSlotIds);
  assert.equal(first.proofHash, replay.proofHash);
  const byeRecipients = first.orderedSlotIds.flatMap((entrantId, index, slots) => {
    if (entrantId === null) return [];
    return slots[index % 2 === 0 ? index + 1 : index - 1] === null ? [entrantId] : [];
  });
  assert.deepEqual(byeRecipients.sort(), ["E1", "E2", "E3"]);
  assert.ok(first.candidatesEvaluated > 0);
});

test("the top four seeds occupy distinct quarters", () => {
  const eightEntrants = Array.from({ length: 8 }, (_, index) => ({
    id: `E${index + 1}`,
    divisionId: "open",
    memberIds: [`P${index + 1}`],
    seed: index + 1,
    poolId: `P${index + 1}`,
  }));
  const result = placeConstraintDraw(input({ entrants: eightEntrants }));

  assert.equal(result.status, "PLACED");
  const quarters = ["E1", "E2", "E3", "E4"].map((id) => Math.floor(result.orderedSlotIds.indexOf(id) / 2));
  assert.equal(new Set(quarters).size, 4);
  assert.equal(result.violations.some(({ rule }) => rule === "protected_seed_separation"), false);
});

test("lexicographic policy prefers avoiding same-pool rematches before other rematches", () => {
  const fourEntrants = entrants.slice(0, 4);
  const result = placeConstraintDraw(input({
    entrants: fourEntrants,
    priorMeetings: [["E1", "E3"], ["E1", "E4"], ["E2", "E3"], ["E2", "E4"]],
  }));

  assert.equal(result.status, "PLACED");
  assert.equal(result.violations.filter(({ rule }) => rule === "avoid_same_pool_rematch").length, 0);
  assert.equal(result.violations.filter(({ rule }) => rule === "avoid_any_rematch").length, 2);
  assert.equal(result.unavoidableViolations.filter(({ rule }) => rule === "avoid_any_rematch").length, 2);
  assert.ok(result.alternatives.length > 0);
});

test("a residual hard conflict fails the draw and reports the unavoidable violation", () => {
  const result = placeConstraintDraw(input({
    entrants: entrants.slice(0, 2),
    constraints: { avoid_same_pool_rematch: { strength: "HARD" } },
  }));

  assert.equal(result.status, "INFEASIBLE");
  assert.deepEqual(result.orderedSlotIds, []);
  assert.equal(result.findings[0]?.code, "TSC511");
  assert.equal(result.unavoidableViolations[0]?.rule, "avoid_same_pool_rematch");
  assert.equal(result.unavoidableViolations[0]?.strength, "HARD");
  assert.equal(result.searchComplete, true);
});

test("structurally invalid entrant identity fails before candidate evaluation", () => {
  const result = placeConstraintDraw(input({ entrants: [entrants[0]!, { ...entrants[1]!, id: entrants[0]!.id }] }));

  assert.equal(result.status, "INFEASIBLE");
  assert.equal(result.candidatesEvaluated, 0);
  assert.deepEqual(result.findings[0]?.evidence?.duplicateIds, ["E1"]);
});

test("proofs bind normalized prior meetings as well as the selected placement", () => {
  const withoutMeeting = placeConstraintDraw(input({ entrants: entrants.slice(0, 4) }));
  const withMeeting = placeConstraintDraw(input({ entrants: entrants.slice(0, 4), priorMeetings: [["E1", "E4"]] }));

  assert.match(withoutMeeting.proofHash, /^[a-f0-9]{64}$/);
  assert.notEqual(withoutMeeting.proofHash, withMeeting.proofHash);
});
