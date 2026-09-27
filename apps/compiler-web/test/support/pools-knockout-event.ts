import assert from "node:assert/strict";
import { CompetitionJourney } from "../../src/competition-journey.js";
import { CLOSE_ACKNOWLEDGEMENTS } from "../../src/competition-lifecycle.js";

// A live generic pools-into-knockout event (12 pairs, three pools of four, two through, three courts),
// shared by the journey test and the Run Control browser test.

export type Side = { entrantId: string };
export const pairs = Array.from({ length: 12 }, (_, index) => `pk.pair.${index + 1}`);
/** The better seed wins, so the pools and the knockout have a definite, checkable outcome. */
export const betterSeed = (sides: readonly Side[]): readonly [Side, Side] =>
  [...sides].sort((a, b) => pairs.indexOf(a.entrantId) - pairs.indexOf(b.entrantId)) as [Side, Side];

export function liveEvent(organizationId = "org.pk") {
  const clock = { now: "2026-11-07T08:00:00.000Z" };
  const journey = new CompetitionJourney({ organizationId, now: () => clock.now });
  let c = journey.create({ mode: "quick", value: { name: "Winter Pools and Knockout", sport: "padel", participantUnit: "pairs",
    participantCount: 12, resourceCount: 3, resourceLabel: "courts", format: "pools_to_knockout", poolSize: 4, qualifiersPerPool: 2,
    minimumMatches: 3, minimumRestMinutes: 10, matchDurationMinutes: 20, timezone: "Europe/London", priority: "fair_recovery",
    scoringPolicy: "head_to_head_total_score_no_draw", tiebreakPolicy: "wins_score_difference_score_for_manual",
    withdrawalPolicy: "preserve_played_walkover_future", drawPolicy: "seeded_input_order",
    startsAt: "2026-11-07T09:00:00.000Z", endsAt: "2026-11-07T21:00:00.000Z" } } as never, "organiser.author");
  c = journey.addSource(c.id, c.draftVersion, { mode: "csv", text: ["entrant_id,display_name,division_id,member_ids,seed",
    ...pairs.map((id, index) => `${id},Winter Pair ${index + 1},open,${id}.a|${id}.b,${index + 1}`)].join("\n") });
  assert.equal(c.status, "DRAFT");
  c = journey.compile(c.id, c.draftVersion);
  assert.equal(c.compiled!.guardStatus, "PASSED");
  assert.equal(c.compiled!.scheduledContestCount, 3 * 6 + 5, "three pools of four (18 matches) and a six-pair knockout (5 matches)");
  c = journey.approve(c.id, c.revision, "organiser.approver", c.compiled!.requiredAcknowledgementCodes);
  c = journey.activateLive(c.id, c.publication!.revision, "operator.lead");
  const revision = c.publication!.revision;
  const event = {
    journey, clock, revision,
    get competition() { return c; },
    read: () => journey.readOrganiserLive({ organizationId, competitionId: c.id, expectedOperationalRevision: revision, at: clock.now }),
    submit(command: Record<string, unknown>) {
      c = journey.submitLiveCommand(c.id, revision, { ...command, commandId: `pk.${c.live!.state.version + 1}`,
        expectedVersion: c.live!.state.version, actorId: "operator.lead", occurredAt: clock.now } as never);
    },
    /** Play whatever is ready, earliest first, until nothing is ready; the knockout becomes ready as its sides are decided. */
    playReady(winner: (sides: readonly Side[]) => readonly [Side, Side]) {
      for (let guard = 0; guard < 60; guard += 1) {
        const next = event.read().controlContests.filter(({ status }) => status === "SCHEDULED")
          .sort((a, b) => a.scheduledStart.localeCompare(b.scheduledStart) || a.contestId.localeCompare(b.contestId))[0];
        if (!next) return;
        if (Date.parse(clock.now) < Date.parse(next.scheduledStart)) clock.now = next.scheduledStart;
        event.submit({ kind: "START_CONTEST", contestId: next.contestId, courtId: next.courtId, startedAt: clock.now });
        const [first, second] = winner(next.sides);
        clock.now = new Date(Date.parse(clock.now) + 20 * 60_000).toISOString();
        event.submit({ kind: "RECORD_SCORE", contestId: next.contestId, scores: [{ entrantId: first.entrantId, value: 6 }, { entrantId: second.entrantId, value: 2 }] });
        event.submit({ kind: "COMPLETE_CONTEST", contestId: next.contestId, endedAt: clock.now });
        event.submit({ kind: "RECORD_RESULT_RECEIPT", contestId: next.contestId, source: "desk" });
      }
    },
    close() {
      return journey.closeCompetition({ organizationId, competitionId: c.id, expectedPublishedRevision: c.publication!.revision,
        expectedOperationalRevision: revision, expectedLiveVersion: c.live!.state.version, acknowledgedCodes: [...CLOSE_ACKNOWLEDGEMENTS],
        closedBy: "organiser.closer" });
    },
  };
  event.clock.now = "2026-11-07T08:50:00.000Z";
  for (const entrantId of pairs) event.submit({ kind: "CHECK_IN", entrantId });
  return event;
}

/**
 * Pool 2 is pairs 2, 5, 8 and 11. A cycle (2 beats 5, 5 beats 8, 8 beats 2) with each beating 11 leaves
 * three pairs level on wins, score difference and score for, competing for two knockout places.
 */
export function withPoolTwoCycle(sides: readonly Side[]): readonly [Side, Side] {
  const cycle = new Map([["pk.pair.2", "pk.pair.5"], ["pk.pair.5", "pk.pair.8"], ["pk.pair.8", "pk.pair.2"]]);
  const [a, b] = sides as [Side, Side];
  if (cycle.get(a.entrantId) === b.entrantId) return [a, b];
  if (cycle.get(b.entrantId) === a.entrantId) return [b, a];
  return betterSeed(sides);
}
