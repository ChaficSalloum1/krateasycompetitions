import {
  planRevision,
  type CompilationContext,
  type RevisionPlan,
  type TournamentDefinition,
  type TournamentSpec,
} from "@tournament-os/tournament-schema";

export interface IntentAst {
  source: string;
  facts: {
    participantCount?: number;
    participantUnit?: string;
    courtCount?: number;
    divisionCounts?: Record<string, number>;
    minimumMatches?: number;
    semifinalMinutes?: number;
    finalMinutes?: number;
    standardMinutes?: number;
    turnaroundMinutes?: number;
  };
  requirements: Array<{ id: string; sourceText: string; status: "EXTRACTED" | "UNRESOLVED" }>;
  ambiguities: Array<{ code: string; severity: "BLOCKING" | "DEFAULTABLE" | "OPTIMISABLE"; message: string }>;
}

const wordNumber = (value: string): number | undefined => {
  const table: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
  return /^\d+$/.test(value) ? Number(value) : table[value.toLowerCase()];
};

export function interpretEnglish(source: string): IntentAst {
  const facts: IntentAst["facts"] = {};
  const participant = source.match(/(\d+)\s+(?:[a-z-]+\s+)?(pairs?|teams?|players?|athletes?)/i);
  if (participant) { facts.participantCount = Number(participant[1]); facts.participantUnit = participant[2]!.toLowerCase(); }
  const courts = source.match(/(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+courts?/i);
  if (courts) { const count = wordNumber(courts[1]!); if (count !== undefined) facts.courtCount = count; }
  const divisionMatches = [...source.matchAll(/(\d+)\s+(Advanced|Intermediate|Beginner)/gi)];
  if (divisionMatches.length) facts.divisionCounts = Object.fromEntries(divisionMatches.map((match) => [match[2]!.toLowerCase(), Number(match[1])]));
  const minimum = source.match(/at least\s+(\d+|one|two|three|four|five|six)\s+(?:group\s+)?matches/i);
  if (minimum) { const count = wordNumber(minimum[1]!); if (count !== undefined) facts.minimumMatches = count; }
  const featured = source.match(/semis?\s+(?:are\s+)?(\d+)\s+minutes?.*?finals?\s+(\d+)/i);
  if (featured) { facts.semifinalMinutes = Number(featured[1]); facts.finalMinutes = Number(featured[2]); }
  const standard = source.match(/(?:everything else|standard matches?).*?(\d+)\s+minutes?.*?(\d+)\s+minutes?\s+turnaround/i);
  if (standard) { facts.standardMinutes = Number(standard[1]); facts.turnaroundMinutes = Number(standard[2]); }
  const sentences = source.split(/(?<=[.!?])\s+|\n+/).map((value) => value.trim()).filter(Boolean);
  const requirements = sentences.map((sourceText, index) => ({ id: `R${index + 1}`, sourceText, status: "EXTRACTED" as const }));
  const ambiguities: IntentAst["ambiguities"] = [];
  if (/top teams qualify/i.test(source) && !/top\s+(\d+|one|two|three|four|five|six|seven|eight)/i.test(source)) ambiguities.push({ code: "TSC001", severity: "BLOCKING", message: "Qualification size is not defined." });
  if (/normal (?:padel|tennis|football) scoring/i.test(source)) ambiguities.push({ code: "TSA101", severity: "DEFAULTABLE", message: "A versioned sport or organisation scoring default must be selected." });
  if (/sensible pools?/i.test(source)) ambiguities.push({ code: "TSA201", severity: "OPTIMISABLE", message: "Pool construction is explicitly delegated to an optimiser." });
  return { source, facts, requirements, ambiguities };
}

export function applyIntentToTemplate(template: TournamentDefinition, intent: IntentAst): TournamentDefinition {
  if (intent.ambiguities.some(({ severity }) => severity === "BLOCKING")) throw new Error("Blocking ambiguity prevents compilation");
  const next = structuredClone(template);
  if (intent.facts.participantCount !== undefined) next.participants.count = intent.facts.participantCount;
  if (intent.facts.divisionCounts) for (const division of next.divisions) {
    const count = intent.facts.divisionCounts[division.id.toLowerCase()]; if (count !== undefined) division.participantCount = count;
  }
  if (intent.facts.courtCount !== undefined) {
    const courts = next.resources.find(({ type }) => type === "court"); if (courts) courts.quantity = intent.facts.courtCount;
  }
  if (intent.facts.minimumMatches !== undefined) {
    const minimum = next.operationalPolicies.find(({ rule }) => rule === "minimum_group_matches"); if (minimum) minimum.value = intent.facts.minimumMatches;
  }
  if (intent.facts.standardMinutes !== undefined) for (const duration of next.scheduling.durations.filter(({ round }) => round === undefined)) duration.contestMinutes = intent.facts.standardMinutes;
  if (intent.facts.turnaroundMinutes !== undefined) for (const duration of next.scheduling.durations.filter(({ round }) => round === undefined)) duration.turnaroundMinutes = intent.facts.turnaroundMinutes;
  if (intent.facts.semifinalMinutes !== undefined) for (const duration of next.scheduling.durations.filter(({ round }) => round === "semifinal")) duration.contestMinutes = intent.facts.semifinalMinutes;
  if (intent.facts.finalMinutes !== undefined) for (const duration of next.scheduling.durations.filter(({ round }) => round === "final")) duration.contestMinutes = intent.facts.finalMinutes;
  return next;
}

export function planEnglishModification(
  current: TournamentSpec,
  instruction: string,
  context: CompilationContext,
): { plan?: Readonly<RevisionPlan>; unresolved: string[] } {
  const { metadata: _metadata, ...definition } = current;
  const proposed = structuredClone(definition);
  const unresolved: string[] = [];
  let understood = false;
  const courts = instruction.match(/(?:only\s+)?(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+courts?/i);
  if (courts) { const resource = proposed.resources.find(({ type }) => type === "court"); if (resource) { resource.quantity = wordNumber(courts[1]!)!; understood = true; } }
  const finals = instruction.match(/finals?.*?(\d+)\s+minutes?|make\s+finals?.*?(\d+)/i);
  if (finals) { const value = Number(finals[1] ?? finals[2]); for (const duration of proposed.scheduling.durations.filter(({ round }) => round === "final")) duration.contestMinutes = value; understood = true; }
  const rest = instruction.match(/minimum rest.*?(\d+)\s+minutes?/i);
  if (rest) { const rule = proposed.scheduling.constraints.find(({ rule }) => rule === "minimum_rest"); if (rule) { rule.value = Number(rest[1]); understood = true; } }
  if (!understood) unresolved.push("No registered modification primitive matched the instruction; no change was applied.");
  return { ...(understood ? { plan: planRevision(current, proposed, context) } : {}), unresolved };
}
