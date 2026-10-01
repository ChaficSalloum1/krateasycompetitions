import assert from "node:assert/strict";
import test from "node:test";
import { CompetitionJourney } from "../src/competition-journey.js";

// Club events on two to four courts. Each of these failed before the solver fixes: the planner found
// a legal plan and then discarded it (its search budget outran its safety cap), or found none at all.
// The full sweep, with its 10-second bar, is scripts/format-benchmark.ts; this guards the regression.

const facts = (pairs: number, courts: number, minutes: number) => ({ name: `Club ${pairs}p ${courts}c`, sport: "padel",
  participantUnit: "pairs", participantCount: pairs, resourceCount: courts, resourceLabel: "courts", format: "round_robin",
  minimumMatches: pairs - 1, minimumRestMinutes: 10, matchDurationMinutes: minutes, timezone: "Europe/London", priority: "fair_recovery",
  scoringPolicy: "head_to_head_total_score_no_draw", tiebreakPolicy: "wins_score_difference_score_for_manual",
  withdrawalPolicy: "preserve_played_walkover_future", drawPolicy: "seeded_input_order",
  startsAt: "2026-11-07T09:00:00.000Z", endsAt: "2026-11-07T21:00:00.000Z" });
const roster = (pairs: number) => ["entrant_id,display_name,division_id,member_ids,seed", ...Array.from({ length: pairs }, (_, i) =>
  `club.pair.${i + 1},Club Pair ${i + 1},open,club.pair.${i + 1}.a|club.pair.${i + 1}.b,${i + 1}`)].join("\n");

for (const [pairs, courts, minutes] of [[8, 2, 20], [8, 3, 25], [12, 3, 30], [12, 4, 20]] as const) {
  test(`a ${pairs}-pair round robin on ${courts} courts with ${minutes}-minute matches compiles to a Guard-passed plan`, () => {
    const journey = new CompetitionJourney({ organizationId: "org.reach", now: () => "2026-11-07T08:00:00.000Z" });
    let snapshot = journey.create({ mode: "quick", value: facts(pairs, courts, minutes) } as never, "organiser");
    snapshot = journey.addSource(snapshot.id, snapshot.draftVersion, { mode: "csv", text: roster(pairs) });
    const started = Date.now();
    snapshot = journey.compile(snapshot.id, snapshot.draftVersion);
    assert.equal(snapshot.compiled!.guardStatus, "PASSED");
    assert.equal(snapshot.compiled!.scheduledContestCount, pairs * (pairs - 1) / 2);
    assert.ok(Date.now() - started < 60_000, "a legal plan is produced well within a minute even on a slow host");
  });
}
