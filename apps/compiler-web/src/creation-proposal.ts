import { createHash } from "node:crypto";
import { ingestCreationSource } from "./creation-source-ingestion.js";

export const creationFormats = [
  "round_robin", "pools_to_knockout", "single_elimination", "double_elimination", "swiss", "league",
  "ladder", "heats_to_final", "time_trial", "stroke_play", "match_play", "custom",
] as const;

export type CreationFormat = typeof creationFormats[number];
export const connectedScoringPolicies = ["head_to_head_total_score_no_draw"] as const;
export const connectedTiebreakPolicies = ["wins_score_difference_score_for_manual"] as const;
export const connectedWithdrawalPolicies = ["preserve_played_walkover_future"] as const;
export const connectedDrawPolicies = ["seeded_input_order"] as const;

export type ConnectedScoringPolicy = typeof connectedScoringPolicies[number];
export type ConnectedTiebreakPolicy = typeof connectedTiebreakPolicies[number];
export type ConnectedWithdrawalPolicy = typeof connectedWithdrawalPolicies[number];
export type ConnectedDrawPolicy = typeof connectedDrawPolicies[number];
export type CreationSource =
  | { readonly mode: "language"; readonly text: string }
  | { readonly mode: "quick"; readonly value: unknown }
  | { readonly mode: "json"; readonly text: string }
  | { readonly mode: "yaml"; readonly text: string }
  | { readonly mode: "csv"; readonly text: string }
  | { readonly mode: "xlsx"; readonly fileName: string; readonly base64: string };

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
  readonly timezone: string | null;
  readonly priority: "finish_on_time" | "fair_recovery" | "minimum_disruption" | null;
  readonly scoringPolicy: ConnectedScoringPolicy | null;
  readonly tiebreakPolicy: ConnectedTiebreakPolicy | null;
  readonly withdrawalPolicy: ConnectedWithdrawalPolicy | null;
  readonly drawPolicy: ConnectedDrawPolicy | null;
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
  "timezone", "scoringPolicy", "tiebreakPolicy", "withdrawalPolicy", "drawPolicy",
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

function timezone(value: unknown): string | null {
  const candidate = cleanString(value, 100);
  if (!candidate) return null;
  try { new Intl.DateTimeFormat("en", { timeZone: candidate }).format(new Date(0)); return candidate; }
  catch { return null; }
}

function timestamp(value: unknown, timeZone: string | null): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const candidate = value.trim();
  const local = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(candidate);
  if (local && timeZone) {
    const requested = Date.UTC(Number(local[1]), Number(local[2]) - 1, Number(local[3]), Number(local[4]),
      Number(local[5]), Number(local[6] ?? 0));
    const offsetAt = (instant: number) => {
      const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone, hourCycle: "h23", year: "numeric",
        month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
        .formatToParts(new Date(instant)).map(({ type, value: part }) => [type, part]));
      return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour),
        Number(parts.minute), Number(parts.second)) - instant;
    };
    let instant = requested - offsetAt(requested);
    instant = requested - offsetAt(instant);
    return new Date(instant).toISOString();
  }
  if (!Number.isFinite(Date.parse(candidate))) return null;
  return new Date(candidate).toISOString();
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
  const scoringPolicy = connectedScoringPolicies.includes(record.scoringPolicy as ConnectedScoringPolicy)
    ? record.scoringPolicy as ConnectedScoringPolicy : null;
  const tiebreakPolicy = connectedTiebreakPolicies.includes(record.tiebreakPolicy as ConnectedTiebreakPolicy)
    ? record.tiebreakPolicy as ConnectedTiebreakPolicy : null;
  const withdrawalPolicy = connectedWithdrawalPolicies.includes(record.withdrawalPolicy as ConnectedWithdrawalPolicy)
    ? record.withdrawalPolicy as ConnectedWithdrawalPolicy : null;
  const drawPolicy = connectedDrawPolicies.includes(record.drawPolicy as ConnectedDrawPolicy)
    ? record.drawPolicy as ConnectedDrawPolicy : null;
  const timeZone = timezone(record.timezone);
  const blueprint: CompetitionBlueprint = {
    name: cleanString(record.name), sport: cleanString(record.sport, 60)?.toLowerCase() ?? null, participantUnit: unit,
    participantCount: integer(record.participantCount, 2, 100_000), resourceCount: integer(record.resourceCount, 1, 10_000),
    resourceLabel: cleanString(record.resourceLabel, 40)?.toLowerCase() ?? null, format,
    poolSize: integer(record.poolSize, 2, 256), qualifiersPerPool: integer(record.qualifiersPerPool, 1, 256),
    minimumMatches: integer(record.minimumMatches, 1, 10_000), minimumRestMinutes: integer(record.minimumRestMinutes, 0, 1_440),
    matchDurationMinutes: integer(record.matchDurationMinutes, 1, 1_440), startsAt: timestamp(record.startsAt, timeZone),
    endsAt: timestamp(record.endsAt, timeZone), timezone: timeZone, priority,
    scoringPolicy, tiebreakPolicy, withdrawalPolicy, drawPolicy,
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
  if (record.timezone !== undefined && !blueprint.timezone) warnings.push("timezone must be a registered IANA timezone.");
  if (record.scoringPolicy !== undefined && !scoringPolicy) warnings.push("scoringPolicy is not registered for connected compilation.");
  if (record.tiebreakPolicy !== undefined && !tiebreakPolicy) warnings.push("tiebreakPolicy is not registered for connected compilation.");
  if (record.withdrawalPolicy !== undefined && !withdrawalPolicy) warnings.push("withdrawalPolicy is not registered for connected compilation.");
  if (record.drawPolicy !== undefined && !drawPolicy) warnings.push("drawPolicy is not registered for connected compilation.");
  return { blueprint, warnings };
}

function emptyBlueprint(): CompetitionBlueprint {
  return { name: null, sport: null, participantUnit: null, participantCount: null, resourceCount: null, resourceLabel: null,
    format: null, poolSize: null, qualifiersPerPool: null, minimumMatches: null, minimumRestMinutes: null,
    matchDurationMinutes: null, startsAt: null, endsAt: null, timezone: null, priority: null,
    scoringPolicy: null, tiebreakPolicy: null, withdrawalPolicy: null, drawPolicy: null };
}

function fromLanguage(text: string): { blueprint: CompetitionBlueprint; warnings: string[]; rejected?: string } {
  if (text.length > 48_000) return { blueprint: emptyBlueprint(), warnings: [], rejected: "Description exceeds the 48,000-character safe review boundary. Attach it as a source file when large-document intake is available; no text was applied." };
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
  const zone = text.match(/\btimezone\s+([A-Za-z_]+\/[A-Za-z_]+)\b/i); if (zone) value.timezone = zone[1];
  if (/\btotal[- ]score\b[^.!?\n]{0,32}\bno[- ]draws?\b/i.test(text))
    value.scoringPolicy = "head_to_head_total_score_no_draw";
  if (/\btie(?:break| break)s?\b[^.!?\n]{0,96}\bwins?\b[^.!?\n]{0,48}\bscore difference\b[^.!?\n]{0,48}\bscore for\b[^.!?\n]{0,48}\bmanual\b/i.test(text))
    value.tiebreakPolicy = "wins_score_difference_score_for_manual";
  if (/\bpreserve played\b[^.!?\n]{0,64}\bfuture\b[^.!?\n]{0,32}\bwalkovers?\b/i.test(text))
    value.withdrawalPolicy = "preserve_played_walkover_future";
  if (/\bseeded input order\b/i.test(text)) value.drawPolicy = "seeded_input_order";
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
  else if (source.mode === "json" || source.mode === "yaml") {
    if (source.mode === "yaml") {
      const ingestion = ingestCreationSource(source);
      parsed = ingestion.status === "ACCEPTED" ? fromObject(ingestion.normalized)
        : { blueprint: emptyBlueprint(), warnings: [], rejected: ingestion.findings.join(" ") };
    } else try { parsed = fromObject(JSON.parse(source.text)); }
    catch { parsed = { blueprint: emptyBlueprint(), warnings: [], rejected: "The JSON is not valid." }; }
  } else if (source.mode === "quick") parsed = fromObject(source.value);
  else parsed = { blueprint: emptyBlueprint(), warnings: [] };
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
  if (blueprint.format === "round_robin" || blueprint.format === "single_elimination") {
    if (!blueprint.timezone) questions.push(question("timezone", "Which IANA timezone governs this competition?", "Local reporting and hard-stop times need an explicit civil-time authority."));
    if (!blueprint.scoringPolicy) questions.push(question("scoringPolicy", "Which registered scoring policy decides a match?", "Scoring semantics cannot be inferred from the sport name."));
    if (!blueprint.tiebreakPolicy) questions.push(question("tiebreakPolicy", "How are tied standings or match outcomes resolved?", "A tied result cannot silently choose an advancing entrant."));
    if (!blueprint.withdrawalPolicy) questions.push(question("withdrawalPolicy", "What happens to played and future matches after withdrawal?", "Operational repair needs an explicit preservation policy."));
    if (!blueprint.drawPolicy) questions.push(question("drawPolicy", "How is the initial draw ordered?", "Entrant order and seeding cannot be random or implicit."));
  }
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
  if (record.mode === "yaml") return createCompetitionProposal({ mode: "yaml", text: typeof record.text === "string" ? record.text : "" });
  if (record.mode === "csv") return createCompetitionProposal({ mode: "csv", text: typeof record.text === "string" ? record.text : "" });
  if (record.mode === "xlsx") return createCompetitionProposal({ mode: "xlsx",
    fileName: typeof record.fileName === "string" ? record.fileName : "", base64: typeof record.base64 === "string" ? record.base64 : "" });
  if (record.mode === "quick") return createCompetitionProposal({ mode: "quick", value: record.value });
  return createCompetitionProposal({ mode: "quick", value: null });
}
