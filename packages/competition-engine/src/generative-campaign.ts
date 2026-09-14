import { canonicalHash, deepFreeze } from "@tournament-os/tournament-schema";
import { deterministicRandom, shuffle } from "./random.js";
import { compileStaticFormat, type StaticFormatRequest } from "./static-formats.js";

export interface FormatGenerativeCampaignOptions {
  readonly seed: string;
  readonly iterations: number;
}

export interface FormatGenerativeCampaignReport {
  readonly status: "CERTIFIED" | "REJECTED" | "UNKNOWN";
  readonly seed: string;
  readonly iterations: number;
  readonly catalogueCases: number;
  readonly uniqueCases: number;
  readonly deterministicReplayChecks: number;
  readonly invariantChecks: number;
  readonly violations: readonly string[];
  readonly scaleEnvelope: string;
  readonly proofHash: string;
}

function catalogue(): StaticFormatRequest[] {
  const roundRobin: StaticFormatRequest[] = (["SINGLE_ROUND_ROBIN", "DOUBLE_ROUND_ROBIN"] as const)
    .flatMap((format) => Array.from({ length: 63 }, (_, index): StaticFormatRequest => ({
      id: `${format.toLowerCase()}.${index + 2}`, format, entrantCount: index + 2,
    })));
  const doubleElimination: StaticFormatRequest[] = [2, 4, 8, 16, 32, 64].flatMap((entrantCount) =>
    (["NEVER", "IF_NECESSARY"] as const).map((resetFinalPolicy): StaticFormatRequest => ({
      id: `double-elimination.${entrantCount}.${resetFinalPolicy.toLowerCase()}`,
      format: "DOUBLE_ELIMINATION", entrantCount, resetFinalPolicy,
    })));
  const repechage: StaticFormatRequest[] = [8, 16, 32, 64].map((entrantCount) => ({
    id: `repechage.${entrantCount}`, format: "REPECHAGE_CLASSIFICATION", entrantCount,
  }));
  return [...roundRobin, ...doubleElimination, ...repechage];
}

function expectedRequiredContests(request: StaticFormatRequest): number {
  switch (request.format) {
    case "SINGLE_ROUND_ROBIN": return request.entrantCount * (request.entrantCount - 1) / 2;
    case "DOUBLE_ROUND_ROBIN": return request.entrantCount * (request.entrantCount - 1);
    case "DOUBLE_ELIMINATION": return 2 * request.entrantCount - 2;
    case "REPECHAGE_CLASSIFICATION": return request.entrantCount + 3;
  }
}

/**
 * Runs a reproducible high-volume campaign over the complete finite static-format
 * catalogue. Unique configurations are compiled and independently checked; later
 * seeded trials re-check their immutable proof evidence without manufacturing new
 * coverage claims.
 */
export function runFormatGenerativeCampaign(
  options: FormatGenerativeCampaignOptions,
): Readonly<FormatGenerativeCampaignReport> {
  if (!options.seed.trim()) throw new Error("Campaign seed is required");
  if (!Number.isSafeInteger(options.iterations) || options.iterations < 1 || options.iterations > 10_000_000) {
    throw new Error("Campaign iterations must be a positive safe integer no greater than 10,000,000");
  }
  const cases = catalogue();
  const random = deterministicRandom(options.seed);
  const initial = shuffle(cases, random);
  const compiled = new Map<string, ReturnType<typeof compileStaticFormat>>();
  const violations: string[] = [];
  let replayChecks = 0;
  let invariantChecks = 0;
  for (let iteration = 0; iteration < options.iterations; iteration += 1) {
    const request = iteration < initial.length ? initial[iteration]! : cases[random.int(cases.length)]!;
    let output = compiled.get(request.id);
    if (!output) {
      output = compileStaticFormat(request);
      const replay = compileStaticFormat(request);
      replayChecks += 1;
      if (replay.proof.proofHash !== output.proof.proofHash) violations.push(`${request.id}: deterministic replay hash differs`);
      compiled.set(request.id, output);
    }
    invariantChecks += 3;
    if (!output.proof.valid) violations.push(`${request.id}: structural proof is invalid`);
    if (output.proof.generatedRequiredContestCount !== expectedRequiredContests(request)) {
      violations.push(`${request.id}: required contest cardinality differs`);
    }
    if (!output.proof.acyclic || !output.proof.allEntrantsReachable) {
      violations.push(`${request.id}: topology is cyclic or an entrant is unreachable`);
    }
  }
  const complete = compiled.size === cases.length;
  const status = violations.length > 0 ? "REJECTED" as const : complete ? "CERTIFIED" as const : "UNKNOWN" as const;
  const base = {
    status, seed: options.seed, iterations: options.iterations, catalogueCases: cases.length,
    uniqueCases: compiled.size, deterministicReplayChecks: replayChecks, invariantChecks,
    violations: [...new Set(violations)].sort(),
    scaleEnvelope: "142 static format configurations: RR 2-64, power-of-two double elimination 2-64, quarterfinal repechage 8-64; seeded trials <=10,000,000.",
  };
  return deepFreeze({ ...base, proofHash: canonicalHash(base) });
}
