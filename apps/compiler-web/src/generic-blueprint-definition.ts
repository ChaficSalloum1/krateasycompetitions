import { canonicalHash, type ParticipantShape, type StageDefinition, type TournamentDefinition } from "@tournament-os/tournament-schema";
import type { CompetitionBlueprint, CreationSource } from "./creation-proposal.js";
import { workbenchDecisionValues, type CompetitionWorkbenchProjection } from "./competition-workbench.js";

export const connectedBlueprintFormats = ["round_robin", "single_elimination", "pools_to_knockout"] as const;

function participantShape(unit: CompetitionBlueprint["participantUnit"]): ParticipantShape | null {
  if (unit === "pairs") return "pair";
  if (unit === "teams") return "fixed_team";
  if (unit === "players" || unit === "athletes") return "individual";
  return null;
}

/** Pool sizes for `entrants` split as evenly as possible into pools of at most `poolSize`. */
export function evenPoolSizes(entrants: number, poolSize: number): number[] {
  const pools = Math.ceil(entrants / poolSize);
  return Array.from({ length: pools }, (_, index) => Math.floor(entrants / pools) + (index < entrants % pools ? 1 : 0));
}

function isPowerOfTwo(value: number): boolean {
  return value > 0 && (value & (value - 1)) === 0;
}

function sourceReference(sources: readonly CreationSource[]): string {
  return `creation-sources:${canonicalHash(sources)}`;
}

function localParts(instant: string, timeZone: string): Record<string, string> {
  const formatter = new Intl.DateTimeFormat("en-CA", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit",
    day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  return Object.fromEntries(formatter.formatToParts(new Date(instant)).map(({ type, value }) => [type, value]));
}

function localInstant(date: string, time: string, timeZone: string): string {
  const requested = Date.parse(`${date}T${time}Z`);
  const offsetAt = (instant: number) => {
    const parts = localParts(new Date(instant).toISOString(), timeZone);
    return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour),
      Number(parts.minute), Number(parts.second)) - instant;
  };
  let instant = requested - offsetAt(requested);
  instant = requested - offsetAt(instant);
  return new Date(instant).toISOString();
}

function shiftToEventDate(instant: string, originalStart: string, eventDate: string, timeZone: string): string {
  const parts = localParts(instant, timeZone); const start = localParts(originalStart, timeZone);
  const originalDay = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day));
  const startDay = Date.UTC(Number(start.year), Number(start.month) - 1, Number(start.day));
  const target = new Date(Date.parse(`${eventDate}T00:00:00.000Z`) + (originalDay - startDay)).toISOString().slice(0, 10);
  return localInstant(target, `${parts.hour}:${parts.minute}:${parts.second}`, timeZone);
}

export function connectedBlueprintFromWorkbench(blueprint: CompetitionBlueprint,
  workbench: CompetitionWorkbenchProjection): CompetitionBlueprint {
  const decisions = workbenchDecisionValues(workbench);
  const timezone = decisions.timezone ?? blueprint.timezone;
  let startsAt = blueprint.startsAt; let endsAt = blueprint.endsAt;
  if (decisions["event-date"] && timezone && startsAt && endsAt) {
    endsAt = shiftToEventDate(endsAt, startsAt, decisions["event-date"], timezone);
    startsAt = shiftToEventDate(startsAt, startsAt, decisions["event-date"], timezone);
  }
  return { ...blueprint, name: decisions["event-name"] ?? blueprint.name, timezone, startsAt, endsAt };
}

export function connectedBlueprintFindings(blueprint: CompetitionBlueprint): readonly string[] {
  const findings: string[] = [];
  if (blueprint.sport !== "padel") findings.push("Connected generic compilation currently has an approved padel rule envelope only.");
  if (blueprint.participantUnit !== "pairs") findings.push("Connected generic padel compilation currently requires pair entrants.");
  if (!blueprint.format || !connectedBlueprintFormats.includes(blueprint.format as typeof connectedBlueprintFormats[number]))
    findings.push("Connected generic compilation currently supports round robin, single elimination, and pools into a knockout; other preserved formats remain explicit unsupported semantics.");
  if (blueprint.format === "pools_to_knockout" && blueprint.participantCount) {
    if (!blueprint.poolSize || blueprint.poolSize < 3 || blueprint.poolSize > 8)
      findings.push("Pools into a knockout needs a pool size from 3 to 8.");
    else if (!blueprint.qualifiersPerPool || blueprint.qualifiersPerPool < 1
      || blueprint.qualifiersPerPool >= Math.min(...evenPoolSizes(blueprint.participantCount, blueprint.poolSize)))
      findings.push("Choose how many from each pool reach the knockout: at least one, and fewer than the smallest pool.");
    else if (evenPoolSizes(blueprint.participantCount, blueprint.poolSize).length * blueprint.qualifiersPerPool < 2)
      findings.push("Pools into a knockout needs at least two knockout entrants: add pools or qualifiers per pool.");
  }
  if (blueprint.participantCount !== null && (blueprint.participantCount < 2 || blueprint.participantCount > 64))
    findings.push("Connected round-robin and single-elimination compilation is certified only for 2 to 64 entrants.");
  if (!blueprint.resourceLabel || !["court", "courts"].includes(blueprint.resourceLabel))
    findings.push("Connected generic padel compilation requires court resources.");
  if (blueprint.scoringPolicy !== "head_to_head_total_score_no_draw")
    findings.push("Select the registered head-to-head total-score, no-draw scoring policy.");
  if (blueprint.tiebreakPolicy !== "wins_score_difference_score_for_manual")
    findings.push("Select the registered wins, score-difference, score-for, then manual-authority tiebreak policy.");
  if (blueprint.withdrawalPolicy !== "preserve_played_walkover_future")
    findings.push("Select the registered preserve-played and walkover-future withdrawal policy.");
  if (blueprint.drawPolicy !== "seeded_input_order")
    findings.push("Select the registered deterministic input-order draw policy.");
  if (!blueprint.timezone) findings.push("Select an explicit IANA timezone for the connected competition.");
  if (blueprint.priority === "minimum_disruption")
    findings.push("Minimum disruption is a live-repair objective; choose finish on time or fair recovery for initial compilation.");
  if (blueprint.participantCount && blueprint.minimumMatches) {
    const guaranteed = blueprint.format === "round_robin" ? blueprint.participantCount - 1
      // Pools: every entrant plays the rest of its pool (smallest pool − 1), then at least one knockout match.
      : blueprint.format === "pools_to_knockout" && blueprint.poolSize
        ? Math.min(...evenPoolSizes(blueprint.participantCount, blueprint.poolSize)) : 1;
    if (blueprint.minimumMatches > guaranteed)
      findings.push(`The selected ${blueprint.format?.replaceAll("_", " ")} format guarantees at most ${guaranteed} matches per entrant in this envelope, below the requested minimum of ${blueprint.minimumMatches}.`);
  }
  return [...new Set(findings)].sort();
}

export function definitionFromConnectedBlueprint(blueprint: CompetitionBlueprint,
  sources: readonly CreationSource[]): TournamentDefinition | null {
  if (connectedBlueprintFindings(blueprint).length > 0 || !blueprint.participantCount || !blueprint.resourceCount
    || !blueprint.matchDurationMinutes || blueprint.minimumRestMinutes === null || !blueprint.startsAt || !blueprint.endsAt
    || !blueprint.priority || !blueprint.timezone || !blueprint.format) return null;
  const shape = participantShape(blueprint.participantUnit);
  if (!shape) return null;
  const stageId = "open.main";
  const poolsStageId = "open.pools";
  const pooled = blueprint.format === "pools_to_knockout";
  const poolSizes = pooled ? evenPoolSizes(blueprint.participantCount, blueprint.poolSize!) : [];
  const knockoutEntrants = pooled ? poolSizes.length * blueprint.qualifiersPerPool! : blueprint.participantCount;
  const knockout: StageDefinition = {
    id: stageId, label: pooled ? "Open knockout" : "Open single elimination", divisionId: "open", primitive: "single_elimination",
    inputShape: shape, outputShape: shape, expectedEntrants: knockoutEntrants,
    bracket: { entrantCount: knockoutEntrants, topology: isPowerOfTwo(knockoutEntrants) ? "power_of_two" : "byes", thirdPlaceMatch: false },
  };
  const stages: StageDefinition[] = blueprint.format === "round_robin" ? [{
    id: stageId, label: "Open round robin", divisionId: "open", primitive: "single_round_robin",
    inputShape: shape, outputShape: shape, expectedEntrants: blueprint.participantCount,
    pool: { poolCount: 1, sizes: [blueprint.participantCount], rounds: 1, allocation: "snake" },
  }] : pooled ? [{
    id: poolsStageId, label: "Open pools", divisionId: "open", primitive: "groups",
    inputShape: shape, outputShape: shape, expectedEntrants: blueprint.participantCount,
    pool: { poolCount: poolSizes.length, sizes: poolSizes, rounds: 1, allocation: "snake" },
  }, knockout] : [knockout];
  const stageIds = stages.map(({ id }) => id);
  const rankedStageId = pooled ? poolsStageId : stageId;
  const knockoutStructureId = "open.knockout.structure";
  const reference = sourceReference(sources);
  const evidence = [
    ["participants", "/participants", true], ["format", "/stages/0", true], ["scoring", "/scoringSystems/0", true],
    ["tiebreak", blueprint.format === "single_elimination" ? "/scoringSystems/0/tieResolution" : "/standingsPolicies/open.standings", true], ["draw", "/randomisation", true],
    ...(pooled ? [["qualification", "/qualificationPolicies/open.qual.knockout", true] as const,
      ["knockout-draw", `/drawPolicies/${knockoutStructureId}.draw`, true] as const] : []),
    ["schedule", "/scheduling", true], ["resources", "/resources", true],
    ["withdrawal", "/operationalPolicies/0", true],
  ] as const;
  const objective = blueprint.priority === "finish_on_time" ? "earliest_finish" as const : "balanced_quality" as const;
  return {
    sport: { id: "padel", adapterVersion: "1.0.0", participantUnit: shape, teamSize: 2,
      contest: { kind: "head_to_head", sides: 2 },
      scoringCapabilities: ["games", "timed_matches", "tie_break"], defaultResourceType: "court" },
    participants: { count: blueprint.participantCount, shape, rosterSize: 2 },
    divisions: [{ id: "open", label: "Open", participantCount: blueprint.participantCount,
      participantShape: shape, stageIds }],
    stages,
    scoringSystems: [{ id: blueprint.scoringPolicy!, adapterRule: "generic.head-to-head.total-score-no-draw",
      version: "1.0.0", stageIds }],
    standingsPolicies: blueprint.format === "single_elimination" ? [] : [{ id: "open.standings", stageIds: [rankedStageId],
      metricOrder: [{ metric: "wins", direction: "DESC" }, { metric: "score_difference", direction: "DESC" },
        { metric: "score_for", direction: "DESC" }], tieFallback: "manual_decision" }],
    // Pool winners first, then runners-up and so on, each position ranked across pools; unequal pools
    // are compared by percentage so a smaller pool is neither favoured nor penalised.
    qualificationPolicies: pooled ? [{ id: "open.qual.knockout", sourceStageId: poolsStageId, destinationStructureId: knockoutStructureId,
      outputCount: knockoutEntrants, selectors: Array.from({ length: blueprint.qualifiersPerPool! }, (_, index) =>
        ({ type: "best_n_across_pools" as const, count: poolSizes.length, poolPosition: index + 1 })),
      ...(new Set(poolSizes).size > 1 ? { normalization: "percentage" as const } : {}) }] : [],
    competitionStructures: pooled ? [{ id: knockoutStructureId, label: "Open knockout", divisionId: "open",
      targetEntrants: knockoutEntrants, stageIds: [stageId] }] : [],
    drawPolicies: pooled ? [{ id: `${knockoutStructureId}.draw`, structureId: knockoutStructureId, placement: "optimised",
      priorities: [{ rule: "structural_validity", strength: "HARD", priority: 1 }, { rule: "protected_byes", strength: "HARD", priority: 2 },
        { rule: "avoid_opening_round_pool_rematch", strength: "SOFT", priority: 3, weight: 60 }] }] : [],
    progressionPolicies: [],
    scheduling: { timezone: blueprint.timezone, start: blueprint.startsAt, finishBy: blueprint.endsAt,
      constraints: [{ id: "no.participant.overlap", rule: "participant_cannot_play_two_contests_simultaneously",
        strength: "HARD", value: true, unit: "boolean" },
      { id: "minimum.rest", rule: "minimum_rest", strength: "HARD", value: blueprint.minimumRestMinutes, unit: "minutes" }],
      durations: stageIds.map((id) => ({ stageId: id, contestMinutes: blueprint.matchDurationMinutes!, turnaroundMinutes: 0 })), objective },
    resources: [{ id: "venue.courts", type: "court", quantity: blueprint.resourceCount,
      availability: [{ start: blueprint.startsAt, end: blueprint.endsAt }] }],
    operationalPolicies: [{ id: "withdrawal", rule: blueprint.withdrawalPolicy!, strength: "HARD", value: true }],
    randomisation: { mode: "none" },
    assumptions: evidence.map(([id, rulePath, critical]) => ({ id: `blueprint.${id}`, rulePath,
      origin: "explicit_prompt", knowledge: "KNOWN", sourceReference: reference, approved: true, critical })),
    requirements: evidence.map(([id]) => ({ id: `GEN-${id.toUpperCase()}`,
      sourceText: `The organiser explicitly supplied ${id} semantics for the connected blueprint.`,
      type: id, strength: "HARD", status: "SATISFIED", mappedRuleIds: [`blueprint.${id}`] })),
  };
}
