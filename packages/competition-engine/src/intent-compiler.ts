import { createHash } from "node:crypto";

export interface PinnedDefaults {
  readonly id: string; readonly version: string; readonly source: string; readonly scoringRulesetId?: string;
  readonly minimumRestMinutes?: number;
}
export interface IntentCompilerConfig { readonly grammarVersion: "1.0.0"; readonly defaults?: PinnedDefaults; }
export interface SourceCitation { readonly sourceId: "prompt"; readonly start: number; readonly end: number; readonly text: string; }
interface CitedNode { readonly citation: SourceCitation; }
export type RegisteredIntentNode =
  | (CitedNode & { readonly kind: "PARTICIPANT_COUNT"; readonly count: number; readonly unit: string })
  | (CitedNode & { readonly kind: "RESOURCE_COUNT"; readonly resource: "court"; readonly count: number })
  | (CitedNode & { readonly kind: "DIVISION_COUNT"; readonly division: string; readonly count: number })
  | (CitedNode & { readonly kind: "MINIMUM_MATCHES"; readonly count: number; readonly scope: "GROUP" | "TOTAL" })
  | (CitedNode & { readonly kind: "CONTEST_DURATION"; readonly round: "STANDARD" | "SEMIFINAL" | "FINAL"; readonly minutes: number })
  | (CitedNode & { readonly kind: "QUALIFICATION_COUNT"; readonly count: number })
  | (CitedNode & { readonly kind: "OPTIMISE_POOL_SIZES"; readonly objective: "SENSIBLE_BALANCE" })
  | (CitedNode & { readonly kind: "USE_PINNED_SCORING_DEFAULT"; readonly rulesetId: string });
export interface IntentFacts {
  readonly participantCount?: number; readonly participantUnit?: string; readonly courtCount?: number;
  readonly divisionCounts?: Readonly<Record<string, number>>; readonly minimumMatches?: number;
}
export interface IntentAmbiguity {
  readonly code: string; readonly severity: "BLOCKING" | "SAFE_DEFAULT" | "OPTIMISABLE";
  readonly message: string; readonly citation: SourceCitation;
}
export interface AppliedDefault {
  readonly field: string; readonly value: string | number; readonly defaultSetId: string; readonly defaultSetVersion: string;
  readonly provenance: string; readonly citation: SourceCitation;
}
export interface UnresolvedIntent {
  readonly reason: "UNREGISTERED_GRAMMAR" | "MISSING_REQUIRED_VALUE" | "SECURITY_REJECTION";
  readonly message: string; readonly citation: SourceCitation;
}
export interface CompiledIntent {
  readonly status: "COMPILED" | "BLOCKED" | "REJECTED"; readonly grammarVersion: "1.0.0"; readonly source: string;
  readonly ast: readonly RegisteredIntentNode[]; readonly facts: IntentFacts; readonly ambiguities: readonly IntentAmbiguity[];
  readonly defaultsApplied: readonly AppliedDefault[]; readonly unresolved: readonly UnresolvedIntent[]; readonly semanticHash: string;
}

const NUMBER_WORDS: Readonly<Record<string, number>> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
  nineteen: 19, twenty: 20,
};
const NUMBER = "(?:\\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)";
function number(value: string): number { return /^\d+$/.test(value) ? Number(value) : NUMBER_WORDS[value.toLowerCase()]!; }
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(",")}}`;
  return JSON.stringify(value);
}
function hash(value: unknown): string { return createHash("sha256").update(canonical(value)).digest("hex"); }
function freeze<T>(value: T): Readonly<T> {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
function citation(source: string, start: number, text: string): SourceCitation {
  return { sourceId: "prompt", start, end: start + text.length, text };
}
function matches(source: string, expression: RegExp): RegExpMatchArray[] { return [...source.matchAll(expression)]; }

export function compileRegisteredIntent(source: string, config: IntentCompilerConfig): CompiledIntent {
  if (config.grammarVersion !== "1.0.0") throw new Error(`Unsupported grammar version: ${String(config.grammarVersion)}`);
  const injection = source.match(/\bignore\s+(?:all\s+)?(?:previous|prior|above|system|developer)\s+instructions?\b|\b(?:execute|eval(?:uate)?|run)\s+(?:this\s+)?(?:code|javascript|shell|command|sql)\b|\b(?:system|developer)\s+(?:prompt|message)\b|\bcall\s+(?:a\s+)?tool\b|\bbypass\s+(?:safety|authority|validation)\b|<script\b/i);
  if (injection) {
    const cited = citation(source, injection.index!, injection[0]);
    const ambiguity: IntentAmbiguity = { code: "UNTRUSTED_AUTHORITY_INSTRUCTION", severity: "BLOCKING",
      message: "The prompt attempts to change compiler authority or execute code.", citation: cited };
    const unresolved: UnresolvedIntent = { reason: "SECURITY_REJECTION",
      message: "Rejected without partial compilation; tournament text is data, never executable authority.", citation: cited };
    return freeze({ status: "REJECTED", grammarVersion: config.grammarVersion, source, ast: [], facts: {}, ambiguities: [ambiguity],
      defaultsApplied: [], unresolved: [unresolved], semanticHash: hash({ grammarVersion: config.grammarVersion, rejection: ambiguity.code }) });
  }
  const ast: RegisteredIntentNode[] = [];
  const ambiguities: IntentAmbiguity[] = [];
  const defaultsApplied: AppliedDefault[] = [];
  const unresolved: UnresolvedIntent[] = [];
  const add = (node: RegisteredIntentNode) => ast.push(node);
  for (const match of matches(source, new RegExp(`\\b(${NUMBER})\\s+(?:(?:padel|tennis|football)\\s+)?(pairs?|teams?|players?|athletes?|entrants?)\\b`, "gi"))) {
    add({ kind: "PARTICIPANT_COUNT", count: number(match[1]!), unit: match[2]!.toLowerCase(), citation: citation(source, match.index!, match[0]) });
  }
  for (const match of matches(source, new RegExp(`\\b(${NUMBER})\\s+courts?\\b`, "gi"))) {
    add({ kind: "RESOURCE_COUNT", resource: "court", count: number(match[1]!), citation: citation(source, match.index!, match[0]) });
  }
  for (const match of matches(source, new RegExp(`\\b(${NUMBER})\\s+(advanced|intermediate|beginner)\\b`, "gi"))) {
    add({ kind: "DIVISION_COUNT", division: match[2]!.toLowerCase(), count: number(match[1]!), citation: citation(source, match.index!, match[0]) });
  }
  for (const match of matches(source, new RegExp(`\\b(?:at least|minimum(?: of)?)\\s+(${NUMBER})\\s+(group\\s+)?(?:matches|games)\\b`, "gi"))) {
    add({ kind: "MINIMUM_MATCHES", count: number(match[1]!), scope: match[2] ? "GROUP" : "TOTAL", citation: citation(source, match.index!, match[0]) });
  }
  for (const match of matches(source, /\b(?:standard matches?|everything else)(?:\s+(?:are|is|at|lasts?))*\s+(\d+)\s+minutes?\b/gi)) {
    add({ kind: "CONTEST_DURATION", round: "STANDARD", minutes: Number(match[1]), citation: citation(source, match.index!, match[0]) });
  }
  for (const match of matches(source, /\b(semifinals?|semis?|finals?)(?:\s+(?:are|is|at|lasts?))*\s+(\d+)\s+minutes?\b/gi)) {
    add({ kind: "CONTEST_DURATION", round: /^f/i.test(match[1]!) ? "FINAL" : "SEMIFINAL", minutes: Number(match[2]), citation: citation(source, match.index!, match[0]) });
  }
  for (const match of matches(source, new RegExp(`\\btop\\s+(${NUMBER})\\s+(?:teams?|pairs?|players?|entrants?)\\s+qualif(?:y|ies)\\b`, "gi"))) {
    add({ kind: "QUALIFICATION_COUNT", count: number(match[1]!), citation: citation(source, match.index!, match[0]) });
  }
  for (const match of matches(source, /\b(?:split|arrange|organise|organize)(?:\s+(?:them|entrants|teams))?\s+into\s+sensible\s+pools?\b/gi)) {
    const cited = citation(source, match.index!, match[0]);
    add({ kind: "OPTIMISE_POOL_SIZES", objective: "SENSIBLE_BALANCE", citation: cited });
    ambiguities.push({ code: "OPTIMISABLE_POOL_BALANCE", severity: "OPTIMISABLE", message: "Pool sizing is delegated to the registered balance objective.", citation: cited });
  }
  for (const match of matches(source, /\bnormal\s+(?:padel|tennis|football)\s+scoring\b/gi)) {
    const cited = citation(source, match.index!, match[0]);
    if (config.defaults?.scoringRulesetId) {
      add({ kind: "USE_PINNED_SCORING_DEFAULT", rulesetId: config.defaults.scoringRulesetId, citation: cited });
      ambiguities.push({ code: "SAFE_SCORING_DEFAULT", severity: "SAFE_DEFAULT", message: "The pinned scoring ruleset resolves 'normal' scoring.", citation: cited });
      defaultsApplied.push({ field: "scoringRulesetId", value: config.defaults.scoringRulesetId, defaultSetId: config.defaults.id,
        defaultSetVersion: config.defaults.version, provenance: config.defaults.source, citation: cited });
    } else {
      ambiguities.push({ code: "MISSING_SCORING_DEFAULT", severity: "BLOCKING", message: "Normal scoring requires a pinned ruleset.", citation: cited });
      unresolved.push({ reason: "MISSING_REQUIRED_VALUE", message: "No pinned scoring ruleset is available.", citation: cited });
    }
  }
  for (const match of matches(source, /\btop\s+(?:teams?|pairs?|players?|entrants?)\s+qualif(?:y|ies)\b/gi)) {
    const cited = citation(source, match.index!, match[0]);
    ambiguities.push({ code: "MISSING_QUALIFICATION_COUNT", severity: "BLOCKING", message: "Qualification count is not defined.", citation: cited });
    unresolved.push({ reason: "MISSING_REQUIRED_VALUE", message: "Specify how many entrants qualify.", citation: cited });
  }
  ast.sort((a, b) => a.citation.start - b.citation.start || a.kind.localeCompare(b.kind));
  const participant = ast.find((node): node is Extract<RegisteredIntentNode, { kind: "PARTICIPANT_COUNT" }> => node.kind === "PARTICIPANT_COUNT");
  const court = ast.find((node): node is Extract<RegisteredIntentNode, { kind: "RESOURCE_COUNT" }> => node.kind === "RESOURCE_COUNT");
  const divisions = ast.filter((node): node is Extract<RegisteredIntentNode, { kind: "DIVISION_COUNT" }> => node.kind === "DIVISION_COUNT");
  const minimum = ast.find((node): node is Extract<RegisteredIntentNode, { kind: "MINIMUM_MATCHES" }> => node.kind === "MINIMUM_MATCHES");
  const facts: IntentFacts = {
    ...(participant ? { participantCount: participant.count, participantUnit: participant.unit } : {}),
    ...(court ? { courtCount: court.count } : {}),
    ...(divisions.length ? { divisionCounts: Object.fromEntries(divisions.map(({ division, count }) => [division, count])) } : {}),
    ...(minimum ? { minimumMatches: minimum.count } : {}),
  };
  for (const sentence of matches(source, /[^.!?\n]+[.!?]?/g)) {
    const text = sentence[0]; const start = sentence.index!; const end = start + text.length;
    const recognized = [...ast, ...ambiguities].some((entry) => entry.citation.start >= start && entry.citation.end <= end);
    if (!recognized && text.trim()) {
      const leading = text.length - text.trimStart().length; const trimmed = text.trim();
      unresolved.push({ reason: "UNREGISTERED_GRAMMAR", message: "No registered grammar production matched this text.",
        citation: citation(source, start + leading, trimmed) });
    }
  }
  const semantic = { grammarVersion: config.grammarVersion, ast: ast.map(({ citation: _citation, ...node }) => node), facts,
    ambiguities: ambiguities.map(({ citation: _citation, ...entry }) => entry),
    defaultsApplied: defaultsApplied.map(({ citation: _citation, ...entry }) => entry) };
  const status = ambiguities.some(({ severity }) => severity === "BLOCKING") || unresolved.length ? "BLOCKED" as const : "COMPILED" as const;
  return freeze({ status, grammarVersion: config.grammarVersion, source, ast, facts, ambiguities, defaultsApplied, unresolved,
    semanticHash: hash(semantic) });
}
