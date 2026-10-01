import assert from "node:assert/strict";
import test from "node:test";
import type { CompetitionBlueprint } from "../src/creation-proposal.js";
import { connectedBlueprintFindings } from "../src/generic-blueprint-definition.js";

// Only qualifiers play on into the knockout, so pools of N guarantee every entrant N − 1 matches, not N.

const blueprint = (overrides: Partial<CompetitionBlueprint>): CompetitionBlueprint => ({
  name: "Guarantee", sport: "padel", participantUnit: "pairs", participantCount: 16, resourceCount: 4, resourceLabel: "courts",
  format: "pools_to_knockout", poolSize: 4, qualifiersPerPool: 2, minimumMatches: 3, minimumRestMinutes: 10,
  matchDurationMinutes: 20, startsAt: "2026-11-07T09:00:00.000Z", endsAt: "2026-11-07T21:00:00.000Z", timezone: "Europe/London",
  priority: "fair_recovery", scoringPolicy: "head_to_head_total_score_no_draw", tiebreakPolicy: "wins_score_difference_score_for_manual",
  withdrawalPolicy: "preserve_played_walkover_future", drawPolicy: "seeded_input_order", ...overrides,
});
const guarantee = (findings: readonly string[]) => findings.find((finding) => finding.includes("guarantees at most"));

test("pools of four guarantee three matches: a pair that finishes third plays no knockout match", () => {
  assert.equal(guarantee(connectedBlueprintFindings(blueprint({ minimumMatches: 3 }))), undefined);
  assert.match(guarantee(connectedBlueprintFindings(blueprint({ minimumMatches: 4 })))!, /guarantees at most 3 matches/);
});

test("uneven pools guarantee the smallest pool's matches", () => {
  // 13 pairs with a target pool of 4 make four pools of 4, 3, 3 and 3: a pair in a pool of three plays two.
  assert.equal(guarantee(connectedBlueprintFindings(blueprint({ participantCount: 13, qualifiersPerPool: 1, minimumMatches: 2 }))), undefined);
  assert.match(guarantee(connectedBlueprintFindings(blueprint({ participantCount: 13, qualifiersPerPool: 1, minimumMatches: 3 })))!,
    /guarantees at most 2 matches/);
});
