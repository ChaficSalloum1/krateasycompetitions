import { canonicalHash, type DrawPolicy, type RandomisationPolicy } from "@tournament-os/tournament-schema";
import { createRegisteredRandomSource, shuffle } from "./random.js";
import type { DrawPlacement, Entrant } from "./types.js";

function openingPairs(values: readonly Entrant[]): Array<[Entrant, Entrant]> {
  const result: Array<[Entrant, Entrant]> = [];
  for (let index = 0; index + 1 < values.length; index += 2) result.push([values[index]!, values[index + 1]!]);
  return result;
}

export function placeDraw(
  entrants: readonly Entrant[],
  policy: DrawPolicy,
  priorMeetings: ReadonlySet<string>,
  randomisation: RandomisationPolicy,
): DrawPlacement {
  const seeded = [...entrants].sort((a, b) => (a.seed ?? Number.MAX_SAFE_INTEGER) - (b.seed ?? Number.MAX_SAFE_INTEGER) || a.id.localeCompare(b.id));
  const needsRandom = policy.placement === "random" || policy.placement === "optimised";
  if (needsRandom && (randomisation.mode !== "deterministic" || !randomisation.algorithm || !randomisation.seed?.trim())) {
    throw new Error("Random and optimised draws require a pinned deterministic algorithm and seed");
  }
  const random = needsRandom ? createRegisteredRandomSource({ algorithm: randomisation.algorithm!, seed: randomisation.seed! }) : undefined;
  const candidates: Entrant[][] = [seeded];
  if (policy.placement === "random") candidates[0] = shuffle(seeded, random!);
  else if (policy.placement === "optimised") {
    for (let index = 0; index < Math.min(64, Math.max(8, entrants.length * 4)); index += 1) candidates.push(shuffle(seeded, random!));
  }
  const evaluate = (candidate: Entrant[]) => {
    const violations: DrawPlacement["violations"] = [];
    for (const [left, right] of openingPairs(candidate)) for (const rule of policy.priorities) {
      const priorKey = [left.id, right.id].sort().join("|");
      if (rule.rule.includes("rematch") && priorMeetings.has(priorKey)) violations.push({ rule: rule.rule, entrants: [left.id, right.id], strength: rule.strength });
      if (rule.rule.includes("same_pool") && left.poolId && left.poolId === right.poolId) violations.push({ rule: rule.rule, entrants: [left.id, right.id], strength: rule.strength });
    }
    const score = violations.reduce((sum, violation) => sum + (violation.strength === "HARD" ? 1_000_000 : (policy.priorities.find(({ rule }) => rule === violation.rule)?.weight ?? 1)), 0);
    return { candidate, violations, score };
  };
  const selected = candidates.map(evaluate).sort((a, b) => a.score - b.score || a.candidate.map(({ id }) => id).join("|").localeCompare(b.candidate.map(({ id }) => id).join("|")))[0]!;
  const seedPositions = Object.fromEntries(selected.candidate.map((entrant, index) => [entrant.id, index + 1]));
  const randomisationProofHash = random ? canonicalHash(random.metadata) : null;
  const partial = { structureId: policy.structureId, orderedEntrantIds: selected.candidate.map(({ id }) => id), seedPositions, violations: selected.violations, candidatesEvaluated: candidates.length, randomisationProofHash };
  return { ...partial, proofHash: canonicalHash(partial) };
}
