import { canonicalHash, type RuleStrength, type ValidationFinding } from "@tournament-os/tournament-schema";
import type { Entrant } from "./types.js";

export type DrawConstraintName =
  | "structural_validity"
  | "protected_byes"
  | "protected_seed_separation"
  | "avoid_same_pool_rematch"
  | "avoid_any_rematch";

export interface DrawConstraintOverride {
  enabled?: boolean;
  strength?: RuleStrength;
  priority?: number;
}

export interface ConstraintDrawInput {
  structureId: string;
  entrants: readonly Entrant[];
  priorMeetings: readonly (readonly [string, string])[];
  constraints?: Partial<Record<Exclude<DrawConstraintName, "structural_validity">, DrawConstraintOverride>>;
  protectedSeedCount?: number;
  candidateLimit?: number;
  alternativeLimit?: number;
}

export interface DrawConstraintViolation {
  rule: DrawConstraintName;
  strength: RuleStrength;
  priority: number;
  entrantIds: string[];
  slotIndexes: number[];
  message: string;
}

export interface ConstraintDrawAlternative {
  orderedSlotIds: Array<string | null>;
  violations: DrawConstraintViolation[];
}

export interface ConstraintDrawResult {
  status: "PLACED" | "INFEASIBLE";
  structureId: string;
  orderedSlotIds: Array<string | null>;
  violations: DrawConstraintViolation[];
  unavoidableViolations: DrawConstraintViolation[];
  alternatives: ConstraintDrawAlternative[];
  candidatesEvaluated: number;
  searchComplete: boolean;
  findings: ValidationFinding[];
  proofHash: string;
}

interface ResolvedConstraint {
  name: DrawConstraintName;
  enabled: boolean;
  strength: RuleStrength;
  priority: number;
}

interface Evaluation {
  slots: Array<string | null>;
  violations: DrawConstraintViolation[];
  counts: Map<DrawConstraintName, number>;
  hardViolationCount: number;
  key: string;
}

const defaults: readonly ResolvedConstraint[] = [
  { name: "structural_validity", enabled: true, strength: "HARD", priority: 1 },
  { name: "protected_byes", enabled: true, strength: "HARD", priority: 2 },
  { name: "protected_seed_separation", enabled: true, strength: "HARD", priority: 3 },
  { name: "avoid_same_pool_rematch", enabled: true, strength: "SOFT", priority: 4 },
  { name: "avoid_any_rematch", enabled: true, strength: "SOFT", priority: 5 },
];

const finding = (code: string, message: string, evidence: Record<string, unknown>): ValidationFinding => ({
  code,
  severity: "ERROR",
  path: "/draw",
  message,
  evidence,
});

const pairKey = (left: string, right: string): string => [left, right].sort().join("|");

function resolveConstraints(input: ConstraintDrawInput): ResolvedConstraint[] {
  return defaults.map((constraint) => {
    if (constraint.name === "structural_validity") return constraint;
    const override = input.constraints?.[constraint.name];
    return {
      ...constraint,
      ...(override?.enabled !== undefined ? { enabled: override.enabled } : {}),
      ...(override?.strength ? { strength: override.strength } : {}),
      ...(override?.priority !== undefined ? { priority: override.priority } : {}),
    };
  }).sort((left, right) => left.priority - right.priority || left.name.localeCompare(right.name));
}

function seedOrder(size: number): number[] {
  let order = [1, 2];
  while (order.length < size) {
    const nextSize = order.length * 2;
    order = order.flatMap((seed) => [seed, nextSize + 1 - seed]);
  }
  return order;
}

function bracketSizeFor(entrantCount: number): number {
  return 2 ** Math.ceil(Math.log2(Math.max(2, entrantCount)));
}

function canonicalSlots(entrants: readonly Entrant[], bracketSize: number): Array<string | null> {
  const seeded = [...entrants].sort((left, right) =>
    (left.seed ?? Number.MAX_SAFE_INTEGER) - (right.seed ?? Number.MAX_SAFE_INTEGER)
      || left.id.localeCompare(right.id));
  return seedOrder(bracketSize).map((seed) => seeded[seed - 1]?.id ?? null);
}

function exhaustiveCandidates(values: readonly (string | null)[]): Array<Array<string | null>> {
  const candidates: Array<Array<string | null>> = [];
  const counts = new Map<string, { value: string | null; count: number }>();
  for (const value of values) {
    const key = value ?? "\u0000BYE";
    const entry = counts.get(key);
    if (entry) entry.count += 1;
    else counts.set(key, { value, count: 1 });
  }
  const entries = [...counts.entries()].sort(([left], [right]) => left.localeCompare(right));
  const candidate: Array<string | null> = [];
  const visit = (): void => {
    if (candidate.length === values.length) {
      candidates.push([...candidate]);
      return;
    }
    for (const [, entry] of entries) {
      if (entry.count === 0) continue;
      entry.count -= 1;
      candidate.push(entry.value);
      visit();
      candidate.pop();
      entry.count += 1;
    }
  };
  visit();
  return candidates;
}

function boundedCandidates(baseline: readonly (string | null)[], limit: number): Array<Array<string | null>> {
  const result: Array<Array<string | null>> = [[...baseline]];
  const seen = new Set([baseline.map((value) => value ?? "-").join("|")]);
  for (let cursor = 0; cursor < result.length && result.length < limit; cursor += 1) {
    const current = result[cursor]!;
    for (let left = 0; left < current.length && result.length < limit; left += 1) {
      for (let right = left + 1; right < current.length && result.length < limit; right += 1) {
        if (current[left] === current[right]) continue;
        const next = [...current];
        [next[left], next[right]] = [next[right]!, next[left]!];
        const key = next.map((value) => value ?? "-").join("|");
        if (seen.has(key)) continue;
        seen.add(key);
        result.push(next);
      }
    }
  }
  return result;
}

function evaluate(
  slots: Array<string | null>,
  entrants: readonly Entrant[],
  constraints: readonly ResolvedConstraint[],
  protectedSeedCount: number,
  priorMeetings: ReadonlySet<string>,
): Evaluation {
  const violations: DrawConstraintViolation[] = [];
  const byId = new Map(entrants.map((entrant) => [entrant.id, entrant]));
  const rule = (name: DrawConstraintName): ResolvedConstraint | undefined => constraints.find((entry) => entry.name === name && entry.enabled);
  const add = (name: DrawConstraintName, entrantIds: string[], slotIndexes: number[], message: string): void => {
    const constraint = rule(name);
    if (constraint) violations.push({ rule: name, strength: constraint.strength, priority: constraint.priority, entrantIds, slotIndexes, message });
  };

  for (let index = 0; index < slots.length; index += 2) {
    if (slots[index] === null && slots[index + 1] === null) {
      add("structural_validity", [], [index, index + 1], "An opening match cannot contain two byes.");
    }
  }

  const byeCount = slots.filter((value) => value === null).length;
  const seeded = [...entrants].sort((left, right) =>
    (left.seed ?? Number.MAX_SAFE_INTEGER) - (right.seed ?? Number.MAX_SAFE_INTEGER)
      || left.id.localeCompare(right.id));
  for (const entrant of seeded.slice(0, byeCount)) {
    const index = slots.indexOf(entrant.id);
    const opponentIndex = index % 2 === 0 ? index + 1 : index - 1;
    if (index < 0 || slots[opponentIndex] !== null) {
      add("protected_byes", [entrant.id], index < 0 ? [] : [index, opponentIndex], `Protected seed '${entrant.id}' did not receive a bye.`);
    }
  }

  const protectedSeeds = seeded.slice(0, protectedSeedCount);
  const sectionSize = slots.length / Math.max(1, protectedSeeds.length);
  const occupantsBySection = new Map<number, string[]>();
  for (const entrant of protectedSeeds) {
    const index = slots.indexOf(entrant.id);
    const section = index < 0 ? -1 : Math.floor(index / sectionSize);
    const occupants = occupantsBySection.get(section) ?? [];
    occupants.push(entrant.id);
    occupantsBySection.set(section, occupants);
  }
  for (const [section, occupantIds] of [...occupantsBySection].sort(([left], [right]) => left - right)) {
    if (section >= 0 && occupantIds.length > 1) {
      add(
        "protected_seed_separation",
        occupantIds.sort(),
        occupantIds.map((id) => slots.indexOf(id)).sort((left, right) => left - right),
        `Protected seeds share draw section ${section + 1}.`,
      );
    }
  }

  for (let index = 0; index < slots.length; index += 2) {
    const leftId = slots[index];
    const rightId = slots[index + 1];
    if (leftId == null || rightId == null) continue;
    const left = byId.get(leftId)!;
    const right = byId.get(rightId)!;
    const ids = [leftId, rightId].sort();
    if (left.poolId && left.poolId === right.poolId) {
      add("avoid_same_pool_rematch", ids, [index, index + 1], `Opening opponents '${ids.join("' and '")}' came from the same pool.`);
    }
    if (priorMeetings.has(pairKey(leftId, rightId))) {
      add("avoid_any_rematch", ids, [index, index + 1], `Opening opponents '${ids.join("' and '")}' have met previously.`);
    }
  }

  violations.sort((left, right) => left.priority - right.priority
    || left.rule.localeCompare(right.rule)
    || left.entrantIds.join("|").localeCompare(right.entrantIds.join("|")));
  const counts = new Map<DrawConstraintName, number>();
  for (const violation of violations) counts.set(violation.rule, (counts.get(violation.rule) ?? 0) + 1);
  return {
    slots,
    violations,
    counts,
    hardViolationCount: violations.filter(({ strength }) => strength === "HARD").length,
    key: slots.map((value) => value ?? "-").join("|"),
  };
}

function compareEvaluations(left: Evaluation, right: Evaluation, constraints: readonly ResolvedConstraint[]): number {
  if (left.hardViolationCount !== right.hardViolationCount) return left.hardViolationCount - right.hardViolationCount;
  for (const constraint of constraints) {
    const difference = (left.counts.get(constraint.name) ?? 0) - (right.counts.get(constraint.name) ?? 0);
    if (difference !== 0) return difference;
  }
  return left.key.localeCompare(right.key);
}

function highestPowerOfTwoAtMost(value: number): number {
  if (value < 2) return value;
  return 2 ** Math.floor(Math.log2(value));
}

function finishResult(partial: Omit<ConstraintDrawResult, "proofHash">, input: ConstraintDrawInput): ConstraintDrawResult {
  const proofInput = {
    ...partial,
    input: {
      structureId: input.structureId,
      entrants: [...input.entrants].map(({ id, seed, poolId }) => ({ id, seed: seed ?? null, poolId: poolId ?? null }))
        .sort((left, right) => left.id.localeCompare(right.id)),
      priorMeetings: input.priorMeetings.map(([left, right]) => [left, right].sort()).sort((left, right) => left.join("|").localeCompare(right.join("|"))),
      constraints: resolveConstraints(input),
      protectedSeedCount: input.protectedSeedCount ?? null,
      candidateLimit: input.candidateLimit ?? null,
      alternativeLimit: input.alternativeLimit ?? null,
    },
  };
  return { ...partial, proofHash: canonicalHash(proofInput) };
}

export function placeConstraintDraw(input: ConstraintDrawInput): ConstraintDrawResult {
  const duplicateIds = [...new Set(input.entrants.map(({ id }) => id).filter((id, index, ids) => ids.indexOf(id) !== index))].sort();
  if (input.entrants.length < 2 || duplicateIds.length > 0) {
    const findings = [finding("TSC510", "Draw input is structurally invalid.", { entrantCount: input.entrants.length, duplicateIds })];
    return finishResult({
      status: "INFEASIBLE", structureId: input.structureId, orderedSlotIds: [], violations: [], unavoidableViolations: [],
      alternatives: [], candidatesEvaluated: 0, searchComplete: true, findings,
    }, input);
  }

  const constraints = resolveConstraints(input);
  const bracketSize = bracketSizeFor(input.entrants.length);
  const baseline = canonicalSlots(input.entrants, bracketSize);
  const searchComplete = bracketSize <= 8;
  const candidateLimit = Math.max(1, input.candidateLimit ?? 4096);
  const candidates = searchComplete ? exhaustiveCandidates(baseline) : boundedCandidates(baseline, candidateLimit);
  const protectedSeedCount = Math.min(
    input.protectedSeedCount ?? highestPowerOfTwoAtMost(Math.min(4, input.entrants.length)),
    input.entrants.length,
  );
  const priorMeetings = new Set(input.priorMeetings.map(([left, right]) => pairKey(left, right)));
  const evaluations = candidates.map((slots) => evaluate(slots, input.entrants, constraints, protectedSeedCount, priorMeetings))
    .sort((left, right) => compareEvaluations(left, right, constraints));
  const best = evaluations[0]!;
  const feasible = evaluations.filter(({ hardViolationCount }) => hardViolationCount === 0);
  const selected = feasible[0];
  const representative = selected ?? best;
  const unavoidableRules = new Set<DrawConstraintName>();
  if (searchComplete) {
    const minimumHardCount = Math.min(...evaluations.map(({ hardViolationCount }) => hardViolationCount));
    let frontier = evaluations.filter(({ hardViolationCount }) => hardViolationCount === minimumHardCount);
    for (const constraint of constraints) {
      const selectedCount = representative.counts.get(constraint.name) ?? 0;
      const minimumCount = Math.min(...frontier.map(({ counts }) => counts.get(constraint.name) ?? 0));
      if (selectedCount > 0 && selectedCount === minimumCount) unavoidableRules.add(constraint.name);
      frontier = frontier.filter(({ counts }) => (counts.get(constraint.name) ?? 0) === selectedCount);
    }
  }
  const unavoidableViolations = searchComplete
    ? representative.violations.filter(({ rule }) => unavoidableRules.has(rule))
    : [];
  const alternativeLimit = Math.max(0, input.alternativeLimit ?? 3);
  const alternativePool = selected ? feasible.slice(1) : evaluations;
  const alternatives = alternativePool.slice(0, alternativeLimit).map(({ slots, violations }) => ({
    orderedSlotIds: [...slots],
    violations,
  }));
  const findings = selected ? [] : [finding(
    "TSC511",
    "No evaluated draw placement satisfies every HARD constraint.",
    {
      candidatesEvaluated: evaluations.length,
      searchComplete,
      residualHardViolations: best.violations.filter(({ strength }) => strength === "HARD"),
    },
  )];
  return finishResult({
    status: selected ? "PLACED" : "INFEASIBLE",
    structureId: input.structureId,
    orderedSlotIds: selected ? [...selected.slots] : [],
    violations: representative.violations,
    unavoidableViolations,
    alternatives,
    candidatesEvaluated: evaluations.length,
    searchComplete,
    findings,
  }, input);
}
