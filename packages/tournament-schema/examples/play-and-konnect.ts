import type { TournamentDefinition } from "../src/types.js";

const divisionData = [
  { id: "advanced", label: "Advanced", count: 11, pools: [4, 4, 3], consolation: 7 },
  { id: "intermediate", label: "Intermediate", count: 17, pools: [4, 4, 3, 3, 3], consolation: 13 },
  { id: "beginner", label: "Beginner", count: 19, pools: [4, 3, 3, 3, 3, 3], consolation: 15 },
] as const;

const stages = divisionData.flatMap((division) => [
  {
    id: `${division.id}.pools`, label: `${division.label} pools`, divisionId: division.id,
    primitive: "groups" as const, inputShape: "pair" as const, outputShape: "pair" as const,
    expectedEntrants: division.count,
    pool: { poolCount: division.pools.length, sizes: [...division.pools], rounds: 1 as const, allocation: "optimised" as const },
  },
  {
    id: `${division.id}.main`, label: `${division.label} main cup`, divisionId: division.id,
    primitive: "single_elimination" as const, inputShape: "pair" as const, outputShape: "pair" as const,
    expectedEntrants: 4, bracket: { entrantCount: 4, topology: "power_of_two" as const, thirdPlaceMatch: false },
  },
  {
    id: `${division.id}.consolation`, label: `${division.label} consolation cup`, divisionId: division.id,
    primitive: "consolation" as const, inputShape: "pair" as const, outputShape: "pair" as const,
    expectedEntrants: division.consolation,
    bracket: { entrantCount: division.consolation, topology: "byes" as const, thirdPlaceMatch: false },
  },
]);

const qualificationPolicies = divisionData.flatMap((division) => {
  const poolCount = division.pools.length;
  const mainWinnerCount = Math.min(4, poolCount);
  const mainRunnerCount = 4 - mainWinnerCount;
  const missedWinnerCount = poolCount - mainWinnerCount;
  const remainingRunnerCount = poolCount - mainRunnerCount;
  const fourthPlaceCount = division.pools.filter((size) => size >= 4).length;
  const selector = (count: number, poolPosition: number) => ({
    type: "best_n_across_pools" as const, count, poolPosition,
  });
  return [
    {
      id: `${division.id}.qual.main`, sourceStageId: `${division.id}.pools`, destinationStructureId: `${division.id}.main.structure`,
      outputCount: 4,
      selectors: [selector(mainWinnerCount, 1), ...(mainRunnerCount ? [selector(mainRunnerCount, 2)] : [])],
      normalization: "percentage" as const,
    },
    {
      id: `${division.id}.qual.consolation`, sourceStageId: `${division.id}.pools`, destinationStructureId: `${division.id}.consolation.structure`,
      outputCount: division.consolation,
      selectors: [
        ...(missedWinnerCount ? [selector(missedWinnerCount, 1)] : []),
        selector(remainingRunnerCount, 2), selector(poolCount, 3),
        ...(fourthPlaceCount ? [selector(fourthPlaceCount, 4)] : []),
      ],
      normalization: "percentage" as const,
    },
  ];
});

const competitionStructures = divisionData.flatMap((division) => [
  { id: `${division.id}.main.structure`, label: `${division.label} main cup`, divisionId: division.id, targetEntrants: 4, stageIds: [`${division.id}.main`] },
  { id: `${division.id}.consolation.structure`, label: `${division.label} consolation cup`, divisionId: division.id, targetEntrants: division.consolation, stageIds: [`${division.id}.consolation`] },
]);

const drawPolicies = competitionStructures.map((structure) => ({
  id: `${structure.id}.draw`, structureId: structure.id, placement: "optimised" as const,
  priorities: [
    { rule: "structural_validity", strength: "HARD" as const, priority: 1 },
    { rule: "protected_byes", strength: "HARD" as const, priority: 2 },
    { rule: "avoid_opening_round_pool_rematch", strength: "SOFT" as const, priority: 3, weight: 60 },
  ],
}));

const criticalPaths = [
  ...divisionData.map((division) => `/standingsPolicies/${division.id}.standings`),
  ...qualificationPolicies.map((policy) => `/qualificationPolicies/${policy.id}`),
  ...drawPolicies.map((policy) => `/drawPolicies/${policy.id}`),
];

const assumptions = criticalPaths.map((rulePath, index) => ({
  id: `rule.${String(index + 1).padStart(2, "0")}`,
  rulePath,
  origin: rulePath.includes("standings") ? "organisation_default" as const : "explicit_prompt" as const,
  knowledge: rulePath.includes("standings") ? "DEFAULTED" as const : "KNOWN" as const,
  sourceReference: rulePath.includes("standings") ? "organisation-defaults@1.0.0" : "organiser-prompt:R1-R12",
  approved: true,
  critical: true,
}));

const requirementEvidence = [
  { id: "rule.participants", rulePath: "/participants", origin: "explicit_prompt" as const, knowledge: "KNOWN" as const, sourceReference: "organiser-prompt:R1", approved: true, critical: false },
  { id: "rule.divisions", rulePath: "/divisions", origin: "explicit_prompt" as const, knowledge: "KNOWN" as const, sourceReference: "organiser-prompt:R1", approved: true, critical: false },
  { id: "rule.resources", rulePath: "/resources/venue.courts", origin: "explicit_prompt" as const, knowledge: "KNOWN" as const, sourceReference: "organiser-prompt:R2", approved: true, critical: false },
  { id: "rule.minimum.matches", rulePath: "/operationalPolicies/minimum.matches", origin: "explicit_prompt" as const, knowledge: "KNOWN" as const, sourceReference: "organiser-prompt:R3", approved: true, critical: false },
  { id: "rule.pool.optimisation", rulePath: "/stages/*/pool/allocation", origin: "compiler_optimisation" as const, knowledge: "OPTIMISED" as const, sourceReference: "organiser-prompt:R4", approved: true, critical: false },
  { id: "rule.normalisation", rulePath: "/qualificationPolicies/*/normalization", origin: "explicit_prompt" as const, knowledge: "KNOWN" as const, sourceReference: "organiser-prompt:R7", approved: true, critical: false },
  { id: "rule.pool.winner.priority", rulePath: "/qualificationPolicies/*/selectors/0", origin: "explicit_prompt" as const, knowledge: "KNOWN" as const, sourceReference: "organiser-prompt:R6", approved: true, critical: false },
  { id: "rule.draw.rematch", rulePath: "/drawPolicies/*/priorities/2", origin: "explicit_prompt" as const, knowledge: "KNOWN" as const, sourceReference: "organiser-prompt:R8", approved: true, critical: false },
  { id: "rule.protected.byes", rulePath: "/drawPolicies/*/priorities/1", origin: "explicit_prompt" as const, knowledge: "KNOWN" as const, sourceReference: "organiser-prompt:R9", approved: true, critical: false },
  { id: "rule.featured.durations", rulePath: "/scheduling/durations", origin: "explicit_prompt" as const, knowledge: "KNOWN" as const, sourceReference: "organiser-prompt:R10", approved: true, critical: false },
  { id: "rule.standard.duration", rulePath: "/scheduling/durations", origin: "explicit_prompt" as const, knowledge: "KNOWN" as const, sourceReference: "organiser-prompt:R11", approved: true, critical: false },
  { id: "rule.preferred.rest", rulePath: "/scheduling/constraints/preferred.rest", origin: "explicit_prompt" as const, knowledge: "KNOWN" as const, sourceReference: "organiser-prompt:R12", approved: true, critical: false },
  { id: "rule.schedule.objective", rulePath: "/scheduling/objective", origin: "explicit_prompt" as const, knowledge: "KNOWN" as const, sourceReference: "organiser-prompt:R13", approved: true, critical: false },
  { id: "rule.headline.finals", rulePath: "/scheduling/constraints/headline.finals", origin: "explicit_prompt" as const, knowledge: "KNOWN" as const, sourceReference: "organiser-prompt:R14", approved: true, critical: false },
];

export const playAndKonnectDefinition: TournamentDefinition = {
  sport: {
    id: "padel", adapterVersion: "1.0.0", participantUnit: "pair", teamSize: 2,
    contest: { kind: "head_to_head", sides: 2 },
    scoringCapabilities: ["games", "sets", "timed_matches", "golden_point", "tie_break"],
    defaultResourceType: "court",
  },
  participants: { count: 47, shape: "pair", rosterSize: 2 },
  divisions: divisionData.map((division) => ({
    id: division.id, label: division.label, participantCount: division.count, participantShape: "pair",
    stageIds: [`${division.id}.pools`, `${division.id}.main`, `${division.id}.consolation`],
  })),
  stages,
  scoringSystems: [{ id: "padel.timed", adapterRule: "padel.timed.standard", version: "1.0.0", stageIds: stages.map(({ id }) => id) }],
  standingsPolicies: divisionData.map((division) => ({
    id: `${division.id}.standings`, stageIds: [`${division.id}.pools`],
    metricOrder: [
      { metric: "wins", direction: "DESC" }, { metric: "game_difference", direction: "DESC" },
      { metric: "games_won", direction: "DESC" }, { metric: "head_to_head", direction: "DESC" },
    ], tieFallback: "manual_decision",
  })),
  qualificationPolicies,
  competitionStructures,
  drawPolicies,
  progressionPolicies: [],
  scheduling: {
    timezone: "Asia/Beirut", start: "2026-09-05T12:00:00+03:00",
    finishBy: "2026-09-05T20:00:00+03:00",
    constraints: [
      { id: "no.participant.overlap", rule: "participant_cannot_play_two_contests_simultaneously", strength: "HARD", value: true, unit: "boolean" },
      { id: "preferred.rest", rule: "preferred_rest", strength: "SOFT", value: 35, unit: "minutes", weight: 80 },
      { id: "headline.finals", rule: "headline_final_climax", strength: "SOFT", value: "advanced.main,intermediate.main", weight: 60 },
    ],
    durations: [
      ...stages.map(({ id }) => ({ stageId: id, contestMinutes: 25, turnaroundMinutes: 5 })),
      { stageId: "advanced.main", round: "round-1", contestMinutes: 45, turnaroundMinutes: 5 },
      { stageId: "advanced.main", round: "final", contestMinutes: 55, turnaroundMinutes: 5 },
      { stageId: "intermediate.main", round: "round-1", contestMinutes: 45, turnaroundMinutes: 5 },
      { stageId: "intermediate.main", round: "final", contestMinutes: 55, turnaroundMinutes: 5 },
    ], objective: "earliest_finish",
  },
  resources: [{ id: "venue.courts", type: "court", quantity: 7, availability: [{ start: "2026-09-05T12:00:00+03:00", end: "2026-09-05T20:00:00+03:00" }] }],
  operationalPolicies: [{ id: "minimum.matches", rule: "minimum_group_matches", strength: "SOFT", value: 3 }],
  randomisation: { mode: "none" },
  assumptions: [...assumptions, ...requirementEvidence],
  requirements: [
    { id: "R1", sourceText: "47 padel pairs: 11 Advanced, 17 Intermediate and 19 Beginner", type: "participants", strength: "HARD", status: "SATISFIED", mappedRuleIds: ["rule.participants", "rule.divisions"] },
    { id: "R2", sourceText: "Seven courts from midday", type: "resources", strength: "HARD", status: "SATISFIED", mappedRuleIds: ["rule.resources"] },
    { id: "R3", sourceText: "Try to give everyone at least three group matches", type: "minimum_participation", strength: "SOFT", status: "DELIBERATELY_RELAXED", mappedRuleIds: ["rule.minimum.matches"], resolutionNote: "A three-team Advanced pool gives two group matches; the preference is retained but cannot be guaranteed by this pool structure." },
    { id: "R4", sourceText: "Split entrants into sensible pools", type: "pool_construction", strength: "SOFT", status: "SATISFIED", mappedRuleIds: ["rule.pool.optimisation"] },
    { id: "R5", sourceText: "The best four in each division enter the main cup and everyone else the consolation cup", type: "qualification", strength: "HARD", status: "SATISFIED", mappedRuleIds: qualificationPolicies.map((_, index) => assumptions[3 + index]!.id) },
    { id: "R6", sourceText: "Pool winners should have priority", type: "qualification_priority", strength: "HARD", status: "SATISFIED", mappedRuleIds: ["rule.pool.winner.priority"] },
    { id: "R7", sourceText: "Normalise comparisons if pools are different sizes", type: "normalisation", strength: "HARD", status: "SATISFIED", mappedRuleIds: ["rule.normalisation"] },
    { id: "R8", sourceText: "Avoid teams immediately replaying someone from their group", type: "draw", strength: "SOFT", status: "SATISFIED", mappedRuleIds: ["rule.draw.rematch"] },
    { id: "R9", sourceText: "Higher seeds should get any available byes", type: "draw", strength: "HARD", status: "SATISFIED", mappedRuleIds: ["rule.protected.byes"] },
    { id: "R10", sourceText: "Advanced and Intermediate main-cup semis are 45 minutes and finals 60", type: "duration", strength: "HARD", status: "SATISFIED", mappedRuleIds: ["rule.featured.durations"] },
    { id: "R11", sourceText: "Everything else is 25 minutes plus five minutes turnaround", type: "duration", strength: "HARD", status: "SATISFIED", mappedRuleIds: ["rule.standard.duration"] },
    { id: "R12", sourceText: "No mandatory rest; avoid unnecessary back-to-back games when equivalent alternatives exist", type: "schedule_quality", strength: "SOFT", status: "SATISFIED", mappedRuleIds: ["rule.preferred.rest"] },
    { id: "R13", sourceText: "Finish as early as possible", type: "schedule_objective", strength: "SOFT", status: "SATISFIED", mappedRuleIds: ["rule.schedule.objective"] },
    { id: "R14", sourceText: "Advanced and Intermediate Konnect finals should normally form the event climax", type: "schedule_quality", strength: "SOFT", status: "SATISFIED", mappedRuleIds: ["rule.headline.finals"] },
  ],
};
