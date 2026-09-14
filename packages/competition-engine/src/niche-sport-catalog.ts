import { createSportRulePackRegistry, sealSportRulePack, type SportRulePack } from "./sport-rule-packs.js";
import type { SportPolicy } from "./sport-semantics.js";

export const NICHE_SPORT_CATALOG_VERSION = "1.0.0" as const;
export const NICHE_SPORT_CATALOG_ASSURANCE =
  "Illustrative conformance packs validate registered result semantics only; governing-body approval and rally, hole, handicap, conduct, and officiating rules remain external.";

export type NicheSportProfile = Readonly<{
  sport: "PICKLEBALL" | "BADMINTON" | "SQUASH" | "GOLF";
  policyIds: readonly string[];
  compatiblePrimitives: readonly string[];
  boundaries: readonly string[];
  references: readonly string[];
}>;

const pickleball = {
  id: "pickleball-best-of-three-11-win-by-two", version: "1.0.0", adapter: "HEAD_TO_HEAD",
  resultShape: "BEST_OF_UNITS", valueRule: { kind: "NON_NEGATIVE_INTEGER" }, bestOf: 3,
  unitWinRule: { minimum: 11, margin: 2 }, draws: "FORBIDDEN",
  standingsPoints: { win: 1, draw: 0, loss: 0 }, walkover: "OPPONENT_WINS",
} as const satisfies SportPolicy;

const badminton = {
  id: "badminton-best-of-three-21-cap-30", version: "1.0.0", adapter: "HEAD_TO_HEAD",
  resultShape: "BEST_OF_UNITS", valueRule: { kind: "NON_NEGATIVE_INTEGER" }, bestOf: 3,
  unitWinRule: { minimum: 21, margin: 2, cap: 30 }, draws: "FORBIDDEN",
  standingsPoints: { win: 1, draw: 0, loss: 0 }, walkover: "OPPONENT_WINS",
} as const satisfies SportPolicy;

const squash = {
  id: "squash-best-of-five-11-win-by-two", version: "1.0.0", adapter: "HEAD_TO_HEAD",
  resultShape: "BEST_OF_UNITS", valueRule: { kind: "NON_NEGATIVE_INTEGER" }, bestOf: 5,
  unitWinRule: { minimum: 11, margin: 2 }, draws: "FORBIDDEN",
  standingsPoints: { win: 1, draw: 0, loss: 0 }, walkover: "OPPONENT_WINS",
} as const satisfies SportPolicy;

const golfStroke = {
  id: "golf-18-hole-stroke-play", version: "1.0.0", adapter: "RANKED_PERFORMANCE",
  resultShape: "PERFORMANCE_ATTEMPTS", metricId: "strokes-per-hole", direction: "LOWER_IS_BETTER",
  valueRule: { kind: "NON_NEGATIVE_INTEGER" }, attempts: { minimum: 18, maximum: 18, aggregation: "SUM" },
  tiePolicy: "REJECT", permittedNonResults: ["DQ", "DNS"], participantUnit: { kind: "INDIVIDUAL", memberCount: 1 },
} as const satisfies SportPolicy;

const golfStableford = {
  id: "golf-18-hole-stableford", version: "1.0.0", adapter: "RANKED_PERFORMANCE",
  resultShape: "PERFORMANCE_ATTEMPTS", metricId: "stableford-points-per-hole", direction: "HIGHER_IS_BETTER",
  valueRule: { kind: "NON_NEGATIVE_INTEGER" }, attempts: { minimum: 18, maximum: 18, aggregation: "SUM" },
  tiePolicy: "REJECT", permittedNonResults: ["DQ", "DNS"], participantUnit: { kind: "INDIVIDUAL", memberCount: 1 },
} as const satisfies SportPolicy;

const golfMatchPlay = {
  id: "golf-match-play-holes", version: "1.0.0", adapter: "HEAD_TO_HEAD", resultShape: "TOTAL_SCORE",
  valueRule: { kind: "NON_NEGATIVE_INTEGER" }, draws: "ALLOWED",
  standingsPoints: { win: 1, draw: 0.5, loss: 0 }, walkover: "OPPONENT_WINS",
} as const satisfies SportPolicy;

export const NICHE_SPORT_POLICIES = Object.freeze([
  pickleball, badminton, squash, golfStroke, golfStableford, golfMatchPlay,
] as const satisfies readonly SportPolicy[]);

export const NICHE_SPORT_PROFILES = Object.freeze([
  {
    sport: "PICKLEBALL", policyIds: [pickleball.id],
    compatiblePrimitives: ["groups", "single_round_robin", "single_elimination", "double_elimination", "consolation", "ladder", "swiss"],
    boundaries: ["Final-score certification does not reconstruct side-out or rally-by-rally serving sequence.", "Alternative games to 7, 15, or 21 require a separately approved policy version."],
    references: ["https://usapickleball.org/docs/2025-USA-Pickleball-Rulebook.pdf"],
  },
  {
    sport: "BADMINTON", policyIds: [badminton.id],
    compatiblePrimitives: ["groups", "single_round_robin", "single_elimination", "double_elimination", "consolation", "swiss"],
    boundaries: ["The pack validates game scores including the 30-point cap; service order, lets, intervals, and change of ends are not reconstructed.", "The announced 2027 scoring change requires a new effective-dated pack."],
    references: ["https://system.bwfbadminton.com/documents/folder_1_81/Statutes/CHAPTER-4---RULES-OF-THE-GAME/SECTION%204.1-%20Laws%20of%20Badminton.pdf"],
  },
  {
    sport: "SQUASH", policyIds: [squash.id],
    compatiblePrimitives: ["groups", "single_round_robin", "single_elimination", "double_elimination", "consolation", "ladder", "swiss"],
    boundaries: ["The pack validates match scores; lets, strokes, conduct, injury time, and referee decisions require separate event semantics."],
    references: ["https://worldsquashofficiating.com/rules-of-squash/"],
  },
  {
    sport: "GOLF", policyIds: [golfStroke.id, golfStableford.id, golfMatchPlay.id],
    compatiblePrimitives: ["ranking_stage", "qualifying_heat", "single_elimination", "groups", "league_table", "custom_graph"],
    boundaries: ["Handicap calculation, concessions, hole-level penalties, cut rules, playoffs, foursomes, four-ball, and team aggregation require explicit policies.", "A tied medal place is unresolved until the competition-specific playoff or sharing rule is registered."],
    references: ["https://www.randa.org/en/rog/the-rules-of-golf/rule-3", "https://www.randa.org/en/rog/the-rules-of-golf/rule-21"],
  },
] as const satisfies readonly NicheSportProfile[]);

function packFor(policy: SportPolicy): SportRulePack {
  return sealSportRulePack({
    id: `illustrative-${policy.id}`, version: policy.version, title: `Illustrative ${policy.id}`,
    owner: { id: "tournamentos-conformance", name: "TournamentOS Conformance" },
    authority: { id: "tournamentos-example-authority", name: "TournamentOS Example Authority", kind: "VENDOR" },
    jurisdiction: "EXAMPLE/GLOBAL", effectiveFrom: "2026-01-01T00:00:00.000Z", expiresAt: "2027-01-01T00:00:00.000Z",
    assurance: "ILLUSTRATIVE_CONFORMANCE_ONLY",
    semanticReference: { policyId: policy.id, policyVersion: policy.version, adapter: policy.adapter },
    compatibility: { sportSemanticsApiVersion: "1.0.0", engineVersion: "1.0.0" },
  }, {
    decision: "APPROVED", authorityId: "tournamentos-example-authority", approverId: "conformance-reviewer",
    approvedAt: "2025-12-01T00:00:00.000Z", evidence: `illustrative-conformance:${policy.id}`,
  });
}

export const NICHE_SPORT_PACKS = Object.freeze(NICHE_SPORT_POLICIES.map(packFor));

export function createNicheSportRegistry() {
  return createSportRulePackRegistry({
    packs: NICHE_SPORT_PACKS,
    policies: NICHE_SPORT_POLICIES,
    compatibility: { sportSemanticsApiVersion: "1.0.0", engineVersion: "1.0.0" },
  });
}
