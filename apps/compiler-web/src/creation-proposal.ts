import { createHash } from "node:crypto";

export const creationFormats = [
  "round_robin", "pools_to_knockout", "single_elimination", "double_elimination", "swiss", "league",
  "ladder", "heats_to_final", "time_trial", "stroke_play", "match_play", "custom",
] as const;

export type CreationFormat = typeof creationFormats[number];
export type CreationSource =
  | { readonly mode: "language"; readonly text: string }
  | { readonly mode: "quick"; readonly value: unknown }
  | { readonly mode: "json"; readonly text: string };

export interface CompetitionBlueprint {
  readonly name: string | null;
  readonly sport: string | null;
  readonly participantUnit: "pairs" | "teams" | "players" | "athletes" | null;
  readonly participantCount: number | null;
  readonly resourceCount: number | null;
  readonly resourceLabel: string | null;
  readonly format: CreationFormat | null;
  readonly poolSize: number | null;
  readonly qualifiersPerPool: number | null;
  readonly minimumMatches: number | null;
  readonly minimumRestMinutes: number | null;
  readonly matchDurationMinutes: number | null;
  readonly startsAt: string | null;
  readonly endsAt: string | null;
  readonly priority: "finish_on_time" | "fair_recovery" | "minimum_disruption" | null;
}

export interface CreationQuestion {
  readonly field: keyof CompetitionBlueprint | "source";
  readonly prompt: string;
  readonly why: string;
  readonly blocking: boolean;
}

export interface CreationProposal {
  readonly apiVersion: "1.0";
  readonly status: "READY_TO_COMPILE" | "NEEDS_INPUT" | "REJECTED";
  readonly sourceMode: CreationSource["mode"];
  readonly blueprint: CompetitionBlueprint;
  readonly understood: readonly string[];
  readonly questions: readonly CreationQuestion[];
  readonly warnings: readonly string[];
  readonly draftCanBeSaved: boolean;
  readonly compilationCanStart: boolean;
  readonly approvalRequired: true;
  readonly proposalHash: string;
}

const allowedKeys = new Set([
  "name", "sport", "participantUnit", "participantCount", "resourceCount", "resourceLabel", "format", "poolSize",
  "qualifiersPerPool", "minimumMatches", "minimumRestMinutes", "matchDurationMinutes", "startsAt", "endsAt", "priority",
]);
const unitAliases: Readonly<Record<string, CompetitionBlueprint["participantUnit"]>> = {
  pair: "pairs", pairs: "pairs", team: "teams", teams: "teams", player: "players", players: "players",
  athlete: "athletes", athletes: "athletes", entrant: "players", entrants: "players",
};
const formatAliases: Readonly<Record<string, CreationFormat>> = {
  "round robin": "round_robin", "round-robin": "round_robin", round_robin: "round_robin",
  "pools to knockout": "pools_to_knockout", "pools into knockout": "pools_to_knockout", pools_to_knockout: "pools_to_knockout",
  knockout: "single_elimination", "single elimination": "single_elimination", single_elimination: "single_elimination",
  "double elimination": "double_elimination", double_elimination: "double_elimination", swiss: "swiss", league: "league",
  ladder: "ladder", "heats to final": "heats_to_final", heats_to_final: "heats_to_final", "time trial": "time_trial",
  time_trial: "time_trial", "stroke play": "stroke_play", stroke_play: "stroke_play", "match play": "match_play",
  match_play: "match_play", custom: "custom",
};

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(",")}}`;
  return JSON.stringify(value) ?? "undefined";
}

function cleanString(value: unknown, maximum = 120): string | null {
  if (typeof value !== "string") return null;
  const result = value.trim().replace(/\s+/g, " ");
  return result && result.length <= maximum ? result : null;
}

function integer(value: unknown, minimum: number, maximum: number): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum && value <= maximum ? value : null;
}

function timestamp(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim() || !Number.isFinite(Date.parse(value))) return null;
  return new Date(value).toISOString();
}

function fromObject(value: unknown): { blueprint: CompetitionBlueprint; warnings: string[]; rejected?: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { blueprint: emptyBlueprint(), warnings: [], rejected: "Input must be one JSON object." };
  const record = value as Record<string, unknown>;
  const extra = Object.keys(record).filter((key) => !allowedKeys.has(key));
  if (extra.length) return { blueprint: emptyBlueprint(), warnings: [], rejected: `Unknown fields: ${extra.sort().join(", ")}.` };
  const unit = typeof record.participantUnit === "string" ? unitAliases[record.participantUnit.toLowerCase()] ?? null : null;
  const format = typeof record.format === "string" ? formatAliases[record.format.toLowerCase()] ?? null : null;
  const priority = record.priority === "finish_on_time" || record.priority === "fair_recovery" || record.priority === "minimum_disruption"
    ? record.priority : null;
  const blueprint: CompetitionBlueprint = {
    name: cleanString(record.name), sport: cleanString(record.sport, 60)?.toLowerCase() ?? null, participantUnit: unit,
    participantCount: integer(record.participantCount, 2, 100_000), resourceCount: integer(record.resourceCount, 1, 10_000),
    resourceLabel: cleanString(record.resourceLabel, 40)?.toLowerCase() ?? null, format,
    poolSize: integer(record.poolSize, 2, 256), qualifiersPerPool: integer(record.qualifiersPerPool, 1, 256),
    minimumMatches: integer(record.minimumMatches, 1, 10_000), minimumRestMinutes: integer(record.minimumRestMinutes, 0, 1_440),
    matchDurationMinutes: integer(record.matchDurationMinutes, 1, 1_440), startsAt: timestamp(record.startsAt), endsAt: timestamp(record.endsAt), priority,
  };
  const warnings: string[] = [];
  for (const [key, raw, parsed] of [
    ["participantCount", record.participantCount, blueprint.participantCount], ["resourceCount", record.resourceCount, blueprint.resourceCount],
    ["poolSize", record.poolSize, blueprint.poolSize], ["qualifiersPerPool", record.qualifiersPerPool, blueprint.qualifiersPerPool],
    ["minimumMatches", record.minimumMatches, blueprint.minimumMatches], ["minimumRestMinutes", record.minimumRestMinutes, blueprint.minimumRestMinutes],
    ["matchDurationMinutes", record.matchDurationMinutes, blueprint.matchDurationMinutes], ["startsAt", record.startsAt, blueprint.startsAt],
    ["endsAt", record.endsAt, blueprint.endsAt],
  ] as const) if (raw !== undefined && parsed === null) warnings.push(`${key} has an invalid value and was not applied.`);
  if (record.participantUnit !== undefined && !unit) warnings.push("participantUnit must be pairs, teams, players, or athletes.");
  if (record.format !== undefined && !format) warnings.push("format is not a registered competition format.");
  if (record.priority !== undefined && !priority) warnings.push("priority must be finish_on_time, fair_recovery, or minimum_disruption.");
  return { blueprint, warnings };
}

function emptyBlueprint(): CompetitionBlueprint {
  return { name: null, sport: null, participantUnit: null, participantCount: null, resourceCount: null, resourceLabel: null,
    format: null, poolSize: null, qualifiersPerPool: null, minimumMatches: null, minimumRestMinutes: null,
    matchDurationMinutes: null, startsAt: null, endsAt: null, priority: null };
}

function fromLanguage(text: string): { blueprint: CompetitionBlueprint; warnings: string[]; rejected?: string } {
  if (text.length > 12_000) return { blueprint: emptyBlueprint(), warnings: [], rejected: "Description is longer than 12,000 characters." };
  const injection = text.match(/\bignore\s+(?:all\s+)?(?:previous|prior|above|system|developer)\s+instructions?\b|\b(?:execute|eval(?:uate)?|run)\s+(?:this\s+)?(?:code|javascript|shell|command|sql)\b|<script\b/i);
  if (injection) return { blueprint: emptyBlueprint(), warnings: [], rejected: "Instructions that attempt to execute code or change compiler authority are rejected." };
  const value: Record<string, unknown> = {};
  const name = text.match(/\b(?:called|named)\s+["“]?([^"”.,;\n]{2,120}?)["”]?(?=\s+for\s+\d+\s+(?:pairs?|teams?|players?|athletes?|entrants?)\b|[.,;\n]|$)/i);
  if (name) value.name = name[1];
  const sport = text.match(/\b(padel|pickleball|tennis|badminton|squash|golf|football|soccer|basketball|volleyball|chess|swimming|athletics|table tennis|bowls|darts|esports?)\b/i);
  if (sport) value.sport = sport[1]!.toLowerCase() === "soccer" ? "football" : sport[1];
  const participants = text.match(/\b(\d{1,6})\s+(pairs?|teams?|players?|athletes?|entrants?)\b/i);
  if (participants) { value.participantCount = Number(participants[1]); value.participantUnit = participants[2]; }
  const resources = text.match(/\b(\d{1,5})\s+(courts?|pitches?|fields?|lanes?|tables?|courses?|rinks?|mats?)\b/i);
  if (resources) { value.resourceCount = Number(resources[1]); value.resourceLabel = resources[2]!.toLowerCase(); }
  if (/\bpools?\b[^.!?\n]{0,48}\b(?:into|to|then)\b[^.!?\n]{0,24}\b(?:knockout|single elimination)\b/i.test(text))
    value.format = "pools_to_knockout";
  else for (const [alias, registered] of Object.entries(formatAliases).sort(([left], [right]) => right.length - left.length)) {
    if (new RegExp(`\\b${alias.replaceAll("_", "[ _-]").replaceAll(" ", "\\s+")}\\b`, "i").test(text)) { value.format = registered; break; }
  }
  const poolSize = text.match(/\bpools?\s+of\s+(\d{1,3})\b/i); if (poolSize) value.poolSize = Number(poolSize[1]);
  const qualifiers = text.match(/\btop\s+(\d{1,3})\s+(?:from|per|in)\s+(?:each\s+)?pool\b|\b(\d{1,3})\s+(?:qualify|qualifiers?)\s+(?:from|per)\s+(?:each\s+)?pool\b/i);
  if (qualifiers) value.qualifiersPerPool = Number(qualifiers[1] ?? qualifiers[2]);
  const minimum = text.match(/\b(?:at least|minimum(?: of)?)\s+(\d{1,4})\s+(?:matches|games)\b/i); if (minimum) value.minimumMatches = Number(minimum[1]);
  const rest = text.match(/\b(\d{1,4})\s+minutes?\s+(?:minimum\s+)?rest\b|\bminimum\s+rest(?:\s+of)?\s+(\d{1,4})\s+minutes?\b/i);
  if (rest) value.minimumRestMinutes = Number(rest[1] ?? rest[2]);
  const duration = text.match(/\b(?:matches|games)(?:\s+(?:are|last|take))?\s+(\d{1,4})\s+minutes?\b|\b(\d{1,4})[- ]minute\s+(?:matches|games)\b/i);
  if (duration) value.matchDurationMinutes = Number(duration[1] ?? duration[2]);
  const start = text.match(/\bstart(?:s|ing)?(?:\s+(?:on|at))?\s+(\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:?\d{2})?)?)/i);
  const end = text.match(/\b(?:end|finish)(?:s|ing)?(?:\s+by|\s+(?:on|at))?\s+(\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:?\d{2})?)?)/i);
  if (start) value.startsAt = start[1]!.replace(" ", "T"); if (end) value.endsAt = end[1]!.replace(" ", "T");
  if (/\bfair(?:ness| recovery)?\b/i.test(text)) value.priority = "fair_recovery";
  else if (/\b(?:minimum|minimise|minimize)\s+(?:changes?|disruption)\b/i.test(text)) value.priority = "minimum_disruption";
  else if (/\bfinish\s+on\s+time\b/i.test(text)) value.priority = "finish_on_time";
  return fromObject(value);
}

function question(field: CreationQuestion["field"], prompt: string, why: string, blocking = true): CreationQuestion {
  return { field, prompt, why, blocking };
}

export function createCompetitionProposal(source: CreationSource): Readonly<CreationProposal> {
  let parsed: ReturnType<typeof fromObject>;
  if (source.mode === "language") parsed = fromLanguage(typeof source.text === "string" ? source.text.trim() : "");
  else if (source.mode === "json") {
    try { parsed = fromObject(JSON.parse(source.text)); } catch { parsed = { blueprint: emptyBlueprint(), warnings: [], rejected: "The JSON is not valid." }; }
  } else parsed = fromObject(source.value);
  const blueprint = parsed.blueprint;
  const questions: CreationQuestion[] = [];
  if (!blueprint.name) questions.push(question("name", "What should this competition be called?", "A stable name is required for the draft and public links."));
  if (!blueprint.sport) questions.push(question("sport", "Which sport or activity is this for?", "The rule pack and resource language depend on the sport."));
  if (!blueprint.participantCount || !blueprint.participantUnit) questions.push(question("participantCount", "How many pairs, teams, players, or athletes are entering?", "The compiler cannot construct the contest graph without entrant cardinality."));
  if (!blueprint.resourceCount) questions.push(question("resourceCount", "How many playable courts or equivalent resources are available?", "Capacity and feasibility depend on real resources."));
  if (!blueprint.format) questions.push(question("format", "What format do you want?", "Choose a known format or explicitly start a custom graph."));
  if (!blueprint.startsAt) questions.push(question("startsAt", "When can play start?", "The schedule needs an explicit availability window."));
  if (!blueprint.endsAt) questions.push(question("endsAt", "When must play finish?", "Without a finish boundary the compiler cannot prove the event fits."));
  if (blueprint.startsAt && blueprint.endsAt && Date.parse(blueprint.endsAt) <= Date.parse(blueprint.startsAt))
    questions.push(question("endsAt", "Choose a finish time after the start time.", "The event window is currently impossible."));
  if (blueprint.matchDurationMinutes === null) questions.push(question("matchDurationMinutes", "How long should one match slot be?", "Duration is required for a schedule, including changeover if applicable."));
  if (blueprint.minimumRestMinutes === null) questions.push(question("minimumRestMinutes", "What minimum rest must a participant receive?", "Rest is a hard fairness constraint, not a hidden default."));
  if (blueprint.format === "pools_to_knockout") {
    if (!blueprint.poolSize) questions.push(question("poolSize", "What pool size should the compiler target?", "Pool size changes match guarantees and event duration."));
    if (!blueprint.qualifiersPerPool) questions.push(question("qualifiersPerPool", "How many advance from each pool?", "Progression cannot be invented silently."));
  }
  if (blueprint.format === "custom") questions.push(question("format", "Describe or import the custom stage graph.", "Custom format is a deliberate hand-off to the advanced graph editor."));
  if (blueprint.poolSize && blueprint.qualifiersPerPool && blueprint.qualifiersPerPool >= blueprint.poolSize)
    questions.push(question("qualifiersPerPool", "Choose fewer qualifiers than entrants in each pool.", "The current progression rule eliminates nobody."));
  const draftCanBeSaved = Boolean(blueprint.name && blueprint.sport && blueprint.participantCount && blueprint.participantUnit
    && blueprint.resourceCount && blueprint.format && blueprint.startsAt && !parsed.rejected);
  const compilationCanStart = draftCanBeSaved && questions.filter(({ blocking }) => blocking).length === 0 && parsed.warnings.length === 0;
  const understood = Object.entries(blueprint).filter(([, value]) => value !== null).map(([field]) => field);
  const body = { apiVersion: "1.0" as const, status: parsed.rejected ? "REJECTED" as const
    : compilationCanStart ? "READY_TO_COMPILE" as const : "NEEDS_INPUT" as const, sourceMode: source.mode, blueprint,
    understood, questions, warnings: [...parsed.warnings, ...(parsed.rejected ? [parsed.rejected] : [])], draftCanBeSaved,
    compilationCanStart, approvalRequired: true as const };
  return Object.freeze({ ...body, proposalHash: createHash("sha256").update(canonical(body)).digest("hex") });
}

export function parseCreationProposalPayload(value: unknown): Readonly<CreationProposal> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return createCompetitionProposal({ mode: "quick", value: null });
  const record = value as Record<string, unknown>;
  if (record.mode === "language") return createCompetitionProposal({ mode: "language", text: typeof record.text === "string" ? record.text : "" });
  if (record.mode === "json") return createCompetitionProposal({ mode: "json", text: typeof record.text === "string" ? record.text : "" });
  if (record.mode === "quick") return createCompetitionProposal({ mode: "quick", value: record.value });
  return createCompetitionProposal({ mode: "quick", value: null });
}
