import type { TournamentDefinition } from "@tournament-os/tournament-schema";
import { PROTECTED_ASSIGNMENT_RULE, type CompetitionGraph } from "@tournament-os/competition-engine";
import type { CompetitionBlueprint } from "./creation-proposal.js";
import { eventTimeInstant } from "./generic-blueprint-definition.js";

/**
 * The organiser's scheduling controls for a connected event. Times are wall-clock "HH:MM" on the event
 * day in the event's timezone, so they follow the event if its date changes; courts are numbered from 1.
 */
export interface ScheduleControls {
  /** Courts with their own opening hours, inside the event's hours. */
  readonly courtHours: readonly { readonly court: number; readonly opens: string; readonly closes: string }[];
  /** Match length for a stage, or for its semi-finals or final, in place of the event's match length. */
  readonly durations: readonly { readonly stageId: string; readonly round?: ScheduleControlRound; readonly minutes: number }[];
  /** Matches that must start at a time, be played on a court, or both. */
  readonly protections: readonly { readonly contestId: string; readonly start?: string; readonly court?: number }[];
}

export type ScheduleControlRound = "semifinal" | "final";

export const NO_SCHEDULE_CONTROLS: ScheduleControls = Object.freeze({ courtHours: [], durations: [], protections: [] });

export function hasScheduleControls(controls: ScheduleControls | undefined): controls is ScheduleControls {
  return Boolean(controls && (controls.courtHours.length || controls.durations.length || controls.protections.length));
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const onlyKeys = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).every((key) => keys.includes(key));

/**
 * Reads controls from untrusted input into their one canonical form, or null when the shape is wrong.
 * Entries are sorted, so the same controls always hash the same.
 */
export function parseScheduleControls(value: unknown): ScheduleControls | null {
  if (!isRecord(value) || !onlyKeys(value, ["courtHours", "durations", "protections"])) return null;
  const { courtHours, durations, protections } = value;
  if (!Array.isArray(courtHours) || !Array.isArray(durations) || !Array.isArray(protections)) return null;
  if (courtHours.length > 64 || durations.length > 16 || protections.length > 256) return null;
  const hours: ScheduleControls["courtHours"][number][] = [];
  for (const entry of courtHours) {
    if (!isRecord(entry) || !onlyKeys(entry, ["court", "opens", "closes"]) || !Number.isInteger(entry.court)
      || typeof entry.opens !== "string" || typeof entry.closes !== "string") return null;
    hours.push({ court: entry.court as number, opens: entry.opens, closes: entry.closes });
  }
  const lengths: ScheduleControls["durations"][number][] = [];
  for (const entry of durations) {
    if (!isRecord(entry) || !onlyKeys(entry, ["stageId", "round", "minutes"]) || typeof entry.stageId !== "string"
      || !Number.isInteger(entry.minutes) || (entry.round !== undefined && entry.round !== "semifinal" && entry.round !== "final")) return null;
    lengths.push({ stageId: entry.stageId, ...(entry.round === undefined ? {} : { round: entry.round as ScheduleControlRound }), minutes: entry.minutes as number });
  }
  const pins: ScheduleControls["protections"][number][] = [];
  for (const entry of protections) {
    if (!isRecord(entry) || !onlyKeys(entry, ["contestId", "start", "court"]) || typeof entry.contestId !== "string"
      || (entry.start !== undefined && typeof entry.start !== "string") || (entry.court !== undefined && !Number.isInteger(entry.court))) return null;
    pins.push({ contestId: entry.contestId, ...(entry.start === undefined ? {} : { start: entry.start as string }),
      ...(entry.court === undefined ? {} : { court: entry.court as number }) });
  }
  return {
    courtHours: hours.sort((left, right) => left.court - right.court),
    durations: lengths.sort((left, right) => left.stageId.localeCompare(right.stageId) || (left.round ?? "").localeCompare(right.round ?? "")),
    protections: pins.sort((left, right) => left.contestId.localeCompare(right.contestId)),
  };
}

function bracketSize(stage: TournamentDefinition["stages"][number]): number {
  const entrants = stage.bracket?.entrantCount ?? stage.expectedEntrants ?? 0;
  return entrants < 2 ? 0 : 2 ** Math.ceil(Math.log2(entrants));
}

/** The rounds a stage's matches can be given their own length for. */
export function controllableRounds(stage: TournamentDefinition["stages"][number]): ScheduleControlRound[] {
  if (stage.primitive !== "single_elimination") return [];
  const size = bracketSize(stage);
  return size >= 4 ? ["semifinal", "final"] : size >= 2 ? ["final"] : [];
}

/**
 * The graph's name for a round. The compiler names a bracket's rounds from the first: a two-slot
 * bracket's only round is "round-1" though it is the final, and a four-slot bracket's semi-finals are
 * "round-1" too.
 */
export function graphRoundName(stage: TournamentDefinition["stages"][number], round: ScheduleControlRound): string {
  const size = bracketSize(stage);
  if (round === "final") return size === 2 ? "round-1" : "final";
  return size === 4 ? "round-1" : "semifinal";
}

/**
 * A match's name in the organiser's terms, read from its id and the definition alone, so a protected
 * match keeps its name while no plan exists. Ids are the compiler's: `<stage>.P<pool>.R<n>.M<m>` for pool
 * matches and `<stage>.R<round>.M<m>` for knockout matches, whose last round is the final.
 */
export function contestLabelFromId(contestId: string, definition: Pick<TournamentDefinition, "stages">): string {
  const pool = /^(.+)\.P(\d+)\.R\d+\.M(\d+)$/.exec(contestId);
  const poolStage = pool ? definition.stages.find(({ id }) => id === pool[1]) : undefined;
  if (pool && poolStage) return `${poolStage.label}: pool ${pool[2]}, match ${pool[3]}`;
  const knockout = /^(.+)\.R(\d+)\.M(\d+)$/.exec(contestId);
  const stage = knockout ? definition.stages.find(({ id }) => id === knockout[1]) : undefined;
  if (!knockout || !stage) return contestId;
  const rounds = Math.log2(bracketSize(stage)); const round = Number(knockout[2]);
  if (stage.primitive === "single_elimination" && round === rounds) return `${stage.label}: final`;
  if (stage.primitive === "single_elimination" && rounds >= 2 && round === rounds - 1) return `${stage.label}: semi-final ${knockout[3]}`;
  return `${stage.label}: round ${round}, match ${knockout[3]}`;
}

/**
 * What is wrong with these controls for this event, as stable codes; empty when they can be applied.
 * Every check here depends only on the event's facts, so a change to those facts can make saved
 * controls stale, which blocks compiling until they are changed.
 */
export function scheduleControlFindings(controls: ScheduleControls, blueprint: CompetitionBlueprint,
  definition: TournamentDefinition): string[] {
  const findings = new Set<string>();
  const courts = blueprint.resourceCount ?? 0;
  const timeZone = blueprint.timezone; const startsAt = blueprint.startsAt; const endsAt = blueprint.endsAt;
  if (!timeZone || !startsAt || !endsAt) return ["EVENT_HOURS_UNKNOWN"];
  // Times resolve to the instant they name within the event, so an event past midnight can use 00:30.
  const at = (time: string) => { const value = eventTimeInstant(startsAt, endsAt, timeZone, time); return value === null ? null : Date.parse(value); };
  const within = (time: string) => at(time) !== null;
  const seenCourts = new Set<number>();
  for (const { court, opens, closes } of controls.courtHours) {
    if (court < 1 || court > courts || seenCourts.has(court)) findings.add("COURT_HOURS_COURT");
    seenCourts.add(court);
    if (!within(opens) || !within(closes) || at(opens)! >= at(closes)!) findings.add("COURT_HOURS_TIME");
  }
  const seenLengths = new Set<string>();
  for (const { stageId, round, minutes } of controls.durations) {
    const stage = definition.stages.find(({ id }) => id === stageId);
    if (!stage) findings.add("DURATION_STAGE");
    else if (round !== undefined && !controllableRounds(stage).includes(round)) findings.add("DURATION_ROUND");
    if (minutes < 5 || minutes > 240) findings.add("DURATION_MINUTES");
    const key = `${stageId}:${round ?? ""}`;
    if (seenLengths.has(key)) findings.add("DURATION_DUPLICATE");
    seenLengths.add(key);
  }
  const seenContests = new Set<string>();
  for (const { contestId, start, court } of controls.protections) {
    if (start === undefined && court === undefined) findings.add("PROTECTION_EMPTY");
    if (seenContests.has(contestId)) findings.add("PROTECTION_DUPLICATE");
    seenContests.add(contestId);
    if (court !== undefined && (court < 1 || court > courts)) findings.add("PROTECTION_COURT");
    if (start !== undefined && !within(start)) findings.add("PROTECTION_TIME");
    const hours = court === undefined ? undefined : controls.courtHours.find((entry) => entry.court === court);
    if (start !== undefined && hours && within(start) && within(hours.opens) && within(hours.closes)
      && (at(start)! < at(hours.opens)! || at(start)! >= at(hours.closes)!)) findings.add("PROTECTION_OUTSIDE_COURT_HOURS");
  }
  return [...findings].sort();
}

/** Protections naming a match the competition no longer has: they block compiling, never vanish. */
export function protectionGraphFindings(controls: ScheduleControls, graph: CompetitionGraph): string[] {
  const contests = new Set(graph.nodes.filter(({ kind }) => kind === "contest").map(({ id }) => id));
  return controls.protections.some(({ contestId }) => !contests.has(contestId)) ? ["PROTECTION_UNKNOWN_CONTEST"] : [];
}

/** The definition with the controls applied: court hours, match lengths and protected assignments. */
export function applyScheduleControls(definition: TournamentDefinition, blueprint: CompetitionBlueprint,
  controls: ScheduleControls): TournamentDefinition {
  if (!hasScheduleControls(controls)) return definition;
  const instant = (time: string) => eventTimeInstant(blueprint.startsAt!, blueprint.endsAt!, blueprint.timezone!, time)!;
  const courts = definition.resources[0]!;
  const unitAvailability = controls.courtHours.map(({ court, opens, closes }) =>
    ({ unit: court, availability: [{ start: instant(opens), end: instant(closes) }] }));
  const turnaround = (stageId: string) => definition.scheduling.durations.find((entry) => entry.stageId === stageId && entry.round === undefined)?.turnaroundMinutes ?? 0;
  return {
    ...definition,
    resources: [{ ...courts, ...(unitAvailability.length ? { unitAvailability } : {}) }, ...definition.resources.slice(1)],
    scheduling: {
      ...definition.scheduling,
      // A round's own length is listed after its stage's, and the scheduler takes the most specific match.
      durations: [...definition.scheduling.durations.filter(({ stageId, round }) => round !== undefined
        || !controls.durations.some((entry) => entry.stageId === stageId && entry.round === undefined)),
      ...controls.durations.map(({ stageId, round, minutes }) => ({ stageId,
        ...(round ? { round: graphRoundName(definition.stages.find(({ id }) => id === stageId)!, round) } : {}),
        contestMinutes: minutes, turnaroundMinutes: turnaround(stageId) }))],
      constraints: [...definition.scheduling.constraints, ...controls.protections.map(({ contestId, start, court }) => ({
        id: `protect.${contestId}`, rule: PROTECTED_ASSIGNMENT_RULE, strength: "HARD" as const,
        value: JSON.stringify({ contestId, ...(start ? { start: instant(start) } : {}), ...(court ? { resourceId: `${courts.id}.${court}` } : {}) }),
      }))],
    },
  };
}
