import { CompetitionJourney } from "../../src/competition-journey.js";

/** Harbour Six-Pair Round Robin: a real generic competition that compiles through CP-SAT. */
export const clock = "2026-10-18T08:00:00.000Z";
const harbour = {
  sport: "padel", participantUnit: "pairs", resourceCount: 4, resourceLabel: "courts",
  minimumRestMinutes: 10, matchDurationMinutes: 20, timezone: "Europe/London", priority: "fair_recovery",
  scoringPolicy: "head_to_head_total_score_no_draw", tiebreakPolicy: "wins_score_difference_score_for_manual",
  withdrawalPolicy: "preserve_played_walkover_future", drawPolicy: "seeded_input_order",
  name: "Harbour Six-Pair Round Robin", format: "round_robin", participantCount: 6, minimumMatches: 5,
  startsAt: "2026-10-18T08:00:00.000Z", endsAt: "2026-10-18T17:00:00.000Z",
} as const;
const roster = ["entrant_id,display_name,division_id,member_ids,seed", ...Array.from({ length: 6 }, (_, index) =>
  `harbour.pair.${index + 1},Harbour Pair ${index + 1},open,harbour.pair.${index + 1}.member.1|harbour.pair.${index + 1}.member.2,${index + 1}`)].join("\n");

/** A journey holding one draft and one competition taken all the way to live play. */
export function journeyWithLiveCompetition() {
  const journey = new CompetitionJourney({ organizationId: "org.flexible", now: () => clock,
    participantTokenSecret: "design-system-participant-key-32-bytes-minimum",
    offlinePackSigningSeedHex: "9f4f6abf4f1433ccb52966db4b69e85f71bc78b39bece0413e2ef56ef34a6dd8" });
  const draft = journey.create({ mode: "describe", text: "A private organiser draft" }, "organiser.author");
  const blueprint = journey.create({ mode: "quick", value: harbour }, "organiser.author");
  const ready = journey.addSource(blueprint.id, blueprint.draftVersion, { mode: "csv", text: roster });
  const compiled = journey.compile(ready.id, ready.draftVersion);
  const published = journey.approve(compiled.id, compiled.revision, "organiser.approver",
    compiled.compiled?.requiredAcknowledgementCodes ?? []);
  const live = journey.activateLive(published.id, published.publication!.revision, "operator.lead");
  return { journey, draft, live };
}
