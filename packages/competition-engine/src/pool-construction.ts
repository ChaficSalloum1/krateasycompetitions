import { canonicalHash, deepFreeze } from "@tournament-os/tournament-schema";

export const POOL_CONSTRUCTION_SCALE_ENVELOPE = deepFreeze({
  maximumEntrants: 64,
  maximumPools: 16,
  maximumSearchNodes: 10_000_000,
});

export interface PoolEntrant {
  readonly id: string;
  readonly seed?: number;
  readonly attributes?: Readonly<Record<string, string>>;
}

export type PoolHardConstraint =
  | { readonly kind: "FIXED_POOL"; readonly entrantId: string; readonly poolIndex: number }
  | { readonly kind: "SEPARATE"; readonly entrantIds: readonly string[] }
  | { readonly kind: "TOGETHER"; readonly entrantIds: readonly string[] }
  | { readonly kind: "ATTRIBUTE_LIMIT"; readonly attribute: string; readonly value: string; readonly maximumPerPool: number };

export type PoolObjective =
  | { readonly kind: "BALANCE_SIZE"; readonly priority: number; readonly weight: number }
  | { readonly kind: "BALANCE_SEED_STRENGTH"; readonly priority: number; readonly weight: number }
  | { readonly kind: "MINIMIZE_SAME_ATTRIBUTE"; readonly attribute: string; readonly priority: number; readonly weight: number };

export interface PoolConstructionRequest {
  readonly id: string;
  readonly entrants: readonly PoolEntrant[];
  readonly poolCount: number;
  readonly size: Readonly<{ minimum: number; maximum: number }>;
  readonly targetSizes?: readonly number[];
  readonly hardConstraints: readonly PoolHardConstraint[];
  readonly objectives: readonly PoolObjective[];
  readonly search: Readonly<{ maximumNodes: number }>;
}

export interface ConstructedPool {
  readonly id: string;
  readonly index: number;
  readonly entrants: readonly PoolEntrant[];
  readonly seedTotal: number;
}

export interface PoolConstructionFinding { readonly code: string; readonly message: string; readonly evidence?: unknown; }

export interface PoolConstructionResult {
  readonly status: "OPTIMAL" | "FEASIBLE" | "INFEASIBLE" | "UNKNOWN" | "REJECTED";
  readonly requestId: string;
  readonly pools: readonly ConstructedPool[];
  readonly objective: readonly number[] | null;
  readonly findings: readonly PoolConstructionFinding[];
  readonly audit: Readonly<{ nodesVisited: number; searchExhausted: boolean; maximumNodes: number; scaleEnvelope: typeof POOL_CONSTRUCTION_SCALE_ENVELOPE }>;
  readonly proofHash: string;
}

export interface PoolConstructionVerification {
  readonly valid: boolean;
  readonly violations: readonly string[];
  readonly proofHash: string;
}

function compareTuple(left: readonly number[], right: readonly number[]): number {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const delta = (left[index] ?? 0) - (right[index] ?? 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

function validateRequest(request: PoolConstructionRequest): PoolConstructionFinding[] {
  const findings: PoolConstructionFinding[] = [];
  const ids = request.entrants.map(({ id }) => id);
  if (!request.id.trim()) findings.push({ code: "POOL_ID_REQUIRED", message: "Pool construction id is required." });
  if (ids.some((id) => !id.trim()) || new Set(ids).size !== ids.length) findings.push({ code: "ENTRANT_IDENTITY", message: "Entrant ids must be non-empty and unique." });
  if (!Number.isInteger(request.poolCount) || request.poolCount < 1) findings.push({ code: "POOL_COUNT", message: "Pool count must be a positive integer." });
  else if (request.poolCount > POOL_CONSTRUCTION_SCALE_ENVELOPE.maximumPools) findings.push({ code: "POOL_COUNT_LIMIT", message: "Pool count exceeds the published scale envelope." });
  if (request.entrants.length > POOL_CONSTRUCTION_SCALE_ENVELOPE.maximumEntrants) findings.push({ code: "ENTRANT_LIMIT", message: "Entrant count exceeds the published scale envelope." });
  if (!Number.isInteger(request.size.minimum) || !Number.isInteger(request.size.maximum) || request.size.minimum < 1 || request.size.maximum < request.size.minimum) {
    findings.push({ code: "POOL_SIZE", message: "Pool size bounds must be positive ordered integers." });
  }
  if (request.entrants.length < request.poolCount * request.size.minimum || request.entrants.length > request.poolCount * request.size.maximum) {
    findings.push({ code: "POOL_CAPACITY", message: "Entrant count cannot fit the declared pool size bounds." });
  }
  if (request.targetSizes !== undefined && (request.targetSizes.length !== request.poolCount ||
    request.targetSizes.some((size) => !Number.isInteger(size) || size < request.size.minimum || size > request.size.maximum) ||
    request.targetSizes.reduce((sum, size) => sum + size, 0) !== request.entrants.length)) {
    findings.push({ code: "POOL_TARGET_SIZES", message: "Target sizes must cover every pool and entrant within the declared bounds." });
  }
  if (!Number.isSafeInteger(request.search.maximumNodes) || request.search.maximumNodes < 1 || request.search.maximumNodes > POOL_CONSTRUCTION_SCALE_ENVELOPE.maximumSearchNodes) findings.push({ code: "SEARCH_BOUND", message: "Search maximumNodes must be a positive safe integer inside the published scale envelope." });
  const priorities = request.objectives.map(({ priority }) => priority);
  if (request.objectives.some(({ priority, weight }) => !Number.isInteger(priority) || priority < 1 || !Number.isFinite(weight) || weight <= 0) || new Set(priorities).size !== priorities.length) {
    findings.push({ code: "OBJECTIVE_PRIORITY", message: "Objectives require unique positive priorities and positive finite weights." });
  }
  const entrantIds = new Set(ids);
  for (const constraint of request.hardConstraints) {
    if (constraint.kind === "FIXED_POOL" && (!entrantIds.has(constraint.entrantId) || !Number.isInteger(constraint.poolIndex) || constraint.poolIndex < 0 || constraint.poolIndex >= request.poolCount)) {
      findings.push({ code: "FIXED_POOL_REFERENCE", message: "Fixed-pool constraints must reference a known entrant and pool." });
    } else if ((constraint.kind === "SEPARATE" || constraint.kind === "TOGETHER") &&
      (constraint.entrantIds.length < 2 || new Set(constraint.entrantIds).size !== constraint.entrantIds.length || constraint.entrantIds.some((id) => !entrantIds.has(id)))) {
      findings.push({ code: "GROUP_CONSTRAINT_REFERENCE", message: "Together/separate constraints require at least two unique known entrants." });
    } else if (constraint.kind === "ATTRIBUTE_LIMIT" && (!constraint.attribute.trim() || !constraint.value.trim() || !Number.isInteger(constraint.maximumPerPool) || constraint.maximumPerPool < 0)) {
      findings.push({ code: "ATTRIBUTE_LIMIT", message: "Attribute limits require a named attribute/value and a non-negative integer limit." });
    }
  }
  return findings;
}

function objectiveTuple(request: PoolConstructionRequest, assignments: readonly number[]): number[] {
  const sizes = Array.from({ length: request.poolCount }, () => 0);
  const seedTotals = Array.from({ length: request.poolCount }, () => 0);
  request.entrants.forEach((entrant, index) => {
    const pool = assignments[index]!;
    sizes[pool] = sizes[pool]! + 1;
    seedTotals[pool] = seedTotals[pool]! + (entrant.seed ?? index + 1);
  });
  return [...request.objectives].sort((a, b) => a.priority - b.priority).map((objective) => {
    if (objective.kind === "BALANCE_SIZE") return (Math.max(...sizes) - Math.min(...sizes)) * objective.weight;
    if (objective.kind === "BALANCE_SEED_STRENGTH") {
      const averages = seedTotals.map((total, index) => total / sizes[index]!);
      return (Math.max(...averages) - Math.min(...averages)) * objective.weight;
    }
    let penalty = 0;
    for (let pool = 0; pool < request.poolCount; pool += 1) {
      const counts = new Map<string, number>();
      request.entrants.forEach((entrant, index) => {
        if (assignments[index] !== pool) return;
        const value = entrant.attributes?.[objective.attribute];
        if (value !== undefined) counts.set(value, (counts.get(value) ?? 0) + 1);
      });
      for (const count of counts.values()) penalty += count * (count - 1) / 2;
    }
    return penalty * objective.weight;
  });
}

function hardViolations(request: PoolConstructionRequest, assignments: readonly number[], complete: boolean): string[] {
  const violations: string[] = [];
  const indexById = new Map(request.entrants.map(({ id }, index) => [id, index]));
  const sizes = Array.from({ length: request.poolCount }, () => 0);
  assignments.forEach((pool) => { if (pool >= 0) sizes[pool] = sizes[pool]! + 1; });
  if (sizes.some((size) => size > request.size.maximum)) violations.push("pool maximum size exceeded");
  if (complete && sizes.some((size) => size < request.size.minimum)) violations.push("pool minimum size not met");
  if (complete && request.targetSizes !== undefined && sizes.some((size, index) => size !== request.targetSizes![index])) violations.push("pool target sizes not met");
  for (const constraint of request.hardConstraints) {
    const indexes = "entrantIds" in constraint ? constraint.entrantIds.map((id) => indexById.get(id)) : [];
    if (constraint.kind === "FIXED_POOL") {
      const index = indexById.get(constraint.entrantId);
      if (index === undefined || constraint.poolIndex < 0 || constraint.poolIndex >= request.poolCount) violations.push("fixed-pool constraint references unknown entrant or pool");
      else {
        const assignedPool = assignments[index];
        if (assignedPool !== undefined && assignedPool >= 0 && assignedPool !== constraint.poolIndex) violations.push(`entrant ${constraint.entrantId} is outside its fixed pool`);
      }
    } else if (indexes.some((index) => index === undefined)) violations.push(`${constraint.kind.toLowerCase()} constraint references an unknown entrant`);
    else if (constraint.kind === "SEPARATE") {
      const placed = indexes.map((index) => assignments[index!]).filter((pool): pool is number => pool !== undefined && pool >= 0);
      if (new Set(placed).size !== placed.length) violations.push("separate entrants share a pool");
    } else if (constraint.kind === "TOGETHER") {
      const placed = indexes.map((index) => assignments[index!]).filter((pool): pool is number => pool !== undefined && pool >= 0);
      if (placed.length > 1 && new Set(placed).size > 1) violations.push("together entrants are split across pools");
    } else if (constraint.kind === "ATTRIBUTE_LIMIT") {
      if (!constraint.attribute.trim() || !constraint.value.trim() || !Number.isInteger(constraint.maximumPerPool) || constraint.maximumPerPool < 0) {
        violations.push("attribute-limit constraint is invalid");
      } else for (let pool = 0; pool < request.poolCount; pool += 1) {
        const count = request.entrants.filter((entrant, index) => assignments[index] === pool && entrant.attributes?.[constraint.attribute] === constraint.value).length;
        if (count > constraint.maximumPerPool) violations.push(`attribute limit exceeded in pool ${pool}`);
      }
    }
  }
  return [...new Set(violations)].sort();
}

function result(request: PoolConstructionRequest, body: Omit<PoolConstructionResult, "requestId" | "proofHash">): PoolConstructionResult {
  const base = { ...body, requestId: request.id };
  return deepFreeze({ ...base, proofHash: canonicalHash({ request, result: base }) });
}

export function constructPools(request: PoolConstructionRequest): Readonly<PoolConstructionResult> {
  const findings = validateRequest(request);
  if (findings.length > 0) return result(request, { status: "REJECTED", pools: [], objective: null, findings, audit: { nodesVisited: 0, searchExhausted: true, maximumNodes: request.search.maximumNodes, scaleEnvelope: POOL_CONSTRUCTION_SCALE_ENVELOPE } });
  const assignments = Array.from({ length: request.entrants.length }, () => -1);
  let best: number[] | null = null;
  let bestObjective: number[] | null = null;
  let nodesVisited = 0;
  let exhausted = true;
  if (request.hardConstraints.length === 0) {
    const targetSizes = request.targetSizes === undefined ? Array.from({ length: request.poolCount }, () => request.size.minimum) : [...request.targetSizes];
    for (let remaining = request.targetSizes === undefined ? request.entrants.length - request.poolCount * request.size.minimum : 0, pool = 0; remaining > 0; pool = (pool + 1) % request.poolCount) {
      if (targetSizes[pool]! >= request.size.maximum) continue;
      targetSizes[pool] = targetSizes[pool]! + 1;
      remaining -= 1;
    }
    const poolOrder: number[] = [];
    const used = Array.from({ length: request.poolCount }, () => 0);
    let forward = true;
    while (poolOrder.length < request.entrants.length) {
      const indexes = Array.from({ length: request.poolCount }, (_, index) => forward ? index : request.poolCount - index - 1);
      for (const pool of indexes) if (used[pool]! < targetSizes[pool]!) {
        poolOrder.push(pool); used[pool] = used[pool]! + 1;
      }
      forward = !forward;
    }
    const entrantOrder = request.entrants.map((entrant, index) => ({ entrant, index })).sort((left, right) =>
      (left.entrant.seed ?? left.index + 1) - (right.entrant.seed ?? right.index + 1) || left.entrant.id.localeCompare(right.entrant.id));
    entrantOrder.forEach(({ index }, position) => { assignments[index] = poolOrder[position]!; });
    best = [...assignments];
    bestObjective = objectiveTuple(request, assignments);
    assignments.fill(-1);
  }
  const visit = (index: number): void => {
    if (!exhausted) return;
    nodesVisited += 1;
    if (nodesVisited > request.search.maximumNodes) { exhausted = false; return; }
    if (index === assignments.length) {
      if (hardViolations(request, assignments, true).length > 0) return;
      const candidate = objectiveTuple(request, assignments);
      if (bestObjective === null || compareTuple(candidate, bestObjective) < 0 || compareTuple(candidate, bestObjective) === 0 && assignments.join(",") < best!.join(",")) {
        best = [...assignments]; bestObjective = candidate;
      }
      return;
    }
    const fixed = request.hardConstraints.find((constraint): constraint is Extract<PoolHardConstraint, { kind: "FIXED_POOL" }> => constraint.kind === "FIXED_POOL" && constraint.entrantId === request.entrants[index]!.id);
    const pools = fixed ? [fixed.poolIndex] : Array.from({ length: request.poolCount }, (_, pool) => pool);
    for (const pool of pools) {
      assignments[index] = pool;
      if (hardViolations(request, assignments, false).length === 0) visit(index + 1);
      assignments[index] = -1;
      if (!exhausted) return;
    }
  };
  visit(0);
  if (best === null) return result(request, { status: exhausted ? "INFEASIBLE" : "UNKNOWN", pools: [], objective: null, findings: [], audit: { nodesVisited, searchExhausted: exhausted, maximumNodes: request.search.maximumNodes, scaleEnvelope: POOL_CONSTRUCTION_SCALE_ENVELOPE } });
  const pools: ConstructedPool[] = Array.from({ length: request.poolCount }, (_, index) => {
    const entrants = request.entrants.filter((_, entrantIndex) => best![entrantIndex] === index).map((entrant) => structuredClone(entrant));
    const fallbackSeed = new Map(request.entrants.map(({ id }, entrantIndex) => [id, entrantIndex + 1]));
    return { id: `${request.id}.P${index + 1}`, index, entrants, seedTotal: entrants.reduce((sum, entrant) => sum + (entrant.seed ?? fallbackSeed.get(entrant.id)!), 0) };
  });
  return result(request, { status: exhausted ? "OPTIMAL" : "FEASIBLE", pools, objective: bestObjective, findings: [], audit: { nodesVisited, searchExhausted: exhausted, maximumNodes: request.search.maximumNodes, scaleEnvelope: POOL_CONSTRUCTION_SCALE_ENVELOPE } });
}

export function verifyPoolConstruction(request: PoolConstructionRequest, candidate: PoolConstructionResult): Readonly<PoolConstructionVerification> {
  const violations = validateRequest(request).map(({ message }) => message);
  const poolIndexes = candidate.pools.map(({ index }) => index);
  if (new Set(poolIndexes).size !== poolIndexes.length || poolIndexes.some((index) => !Number.isInteger(index) || index < 0 || index >= request.poolCount)) {
    violations.push("pool indexes must be unique and inside the request range");
  }
  const assignmentById = new Map<string, number>();
  candidate.pools.forEach((pool) => pool.entrants.forEach(({ id }) => {
    if (assignmentById.has(id)) violations.push(`entrant ${id} occurs more than once`);
    assignmentById.set(id, pool.index);
  }));
  for (const { id } of request.entrants) if (!assignmentById.has(id)) violations.push(`entrant ${id} is missing`);
  for (const id of assignmentById.keys()) if (!request.entrants.some((entrant) => entrant.id === id)) violations.push(`unknown entrant ${id} is present`);
  const assignments = request.entrants.map(({ id }) => assignmentById.get(id) ?? -1);
  violations.push(...hardViolations(request, assignments, true));
  const recomputedObjective = assignments.every((pool) => pool >= 0) ? objectiveTuple(request, assignments) : null;
  if (canonicalHash(recomputedObjective) !== canonicalHash(candidate.objective)) violations.push("reported objective does not match the assignment");
  if (candidate.status === "OPTIMAL" && !candidate.audit.searchExhausted) violations.push("optimal status requires exhausted search");
  const { proofHash, ...candidateBase } = candidate;
  if (proofHash !== canonicalHash({ request, result: candidateBase })) violations.push("pool construction proof hash does not match its content");
  const unique = [...new Set(violations)].sort();
  const base = { valid: unique.length === 0, violations: unique };
  return deepFreeze({ ...base, proofHash: canonicalHash({ request, candidate, verification: base }) });
}
