import { canonicalHash, deepFreeze, type PoolConfiguration, type RandomisationPolicy } from "@tournament-os/tournament-schema";
import { createRegisteredRandomSource, shuffle } from "./random.js";
import { constructPools } from "./pool-construction.js";
import type { Entrant } from "./types.js";

export interface PoolAllocationRequest {
  readonly stageId: string;
  readonly allocation: PoolConfiguration["allocation"];
  readonly sizes: readonly number[];
  readonly entrants: readonly Entrant[];
  readonly randomisation: RandomisationPolicy;
}

export interface PoolAllocationFinding { readonly code: string; readonly message: string; readonly evidence?: unknown; }

export interface PoolAllocationResult {
  readonly status: "ALLOCATED" | "REJECTED" | "UNKNOWN";
  readonly pools: readonly (readonly Entrant[])[];
  readonly findings: readonly PoolAllocationFinding[];
  readonly proof: Readonly<{
    allocation: PoolConfiguration["allocation"];
    entrantCoverage: boolean;
    sizeClosure: boolean;
    sourceProofHash: string | null;
    proofHash: string;
  }>;
}

function poolOrder(sizes: readonly number[]): number[] {
  const used = sizes.map(() => 0);
  const order: number[] = [];
  let forward = true;
  while (order.length < sizes.reduce((sum, size) => sum + size, 0)) {
    const indexes = sizes.map((_, index) => forward ? index : sizes.length - index - 1);
    for (const pool of indexes) if (used[pool]! < sizes[pool]!) {
      order.push(pool); used[pool] = used[pool]! + 1;
    }
    forward = !forward;
  }
  return order;
}

function hashable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(hashable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined).map(([key, entry]) => [key, hashable(entry)]));
  return value;
}

function finalize(request: PoolAllocationRequest, status: PoolAllocationResult["status"], pools: readonly (readonly Entrant[])[],
  findings: readonly PoolAllocationFinding[], sourceProofHash: string | null): PoolAllocationResult {
  const entrantIds = pools.flatMap((pool) => pool.map(({ id }) => id));
  const expectedIds = request.entrants.map(({ id }) => id).sort();
  const entrantCoverage = entrantIds.length === expectedIds.length && new Set(entrantIds).size === entrantIds.length &&
    entrantIds.slice().sort().every((id, index) => id === expectedIds[index]);
  const sizeClosure = pools.length === request.sizes.length && pools.every((pool, index) => pool.length === request.sizes[index]);
  const proofBase = { allocation: request.allocation, entrantCoverage, sizeClosure, sourceProofHash };
  return deepFreeze({ status, pools: structuredClone(pools), findings: [...findings], proof: { ...proofBase, proofHash: canonicalHash(hashable({ request, pools, proof: proofBase })) } });
}

export function allocateStagePools(request: PoolAllocationRequest): Readonly<PoolAllocationResult> {
  const findings: PoolAllocationFinding[] = [];
  if (!request.stageId.trim()) findings.push({ code: "POOL_STAGE_ID", message: "Stage id is required for pool allocation." });
  if (request.sizes.length < 1 || request.sizes.some((size) => !Number.isInteger(size) || size < 1) ||
    request.sizes.reduce((sum, size) => sum + size, 0) !== request.entrants.length) {
    findings.push({ code: "POOL_SIZE_CLOSURE", message: "Declared pool sizes must be positive integers covering every entrant exactly once." });
  }
  if (request.entrants.some(({ id }) => !id.trim()) || new Set(request.entrants.map(({ id }) => id)).size !== request.entrants.length) {
    findings.push({ code: "POOL_ENTRANT_IDENTITY", message: "Pool entrants require unique non-empty ids." });
  }
  if (findings.length > 0) return finalize(request, "REJECTED", [], findings, null);
  if (request.allocation === "random") {
    if (request.randomisation.mode !== "deterministic" || !request.randomisation.algorithm || !request.randomisation.seed?.trim()) {
      return finalize(request, "REJECTED", [], [{ code: "RANDOM_POLICY_REQUIRED", message: "Random pool allocation requires a pinned algorithm and seed." }], null);
    }
    const ordered = request.entrants.slice().sort((left, right) => left.id.localeCompare(right.id));
    const source = createRegisteredRandomSource({
      algorithm: request.randomisation.algorithm,
      seed: `pool-allocation@1:${request.stageId}:${request.randomisation.seed}`,
    });
    const shuffled = shuffle(ordered, source);
    let cursor = 0;
    const pools = request.sizes.map((size) => { const pool = shuffled.slice(cursor, cursor + size); cursor += size; return pool; });
    return finalize(request, "ALLOCATED", pools, [], canonicalHash({ randomSource: source.metadata, entrantIds: ordered.map(({ id }) => id) }));
  }
  if (request.allocation === "manual") {
    const expectedPoolIds = request.sizes.map((_, index) => `${request.stageId}.P${index + 1}`);
    const pools = request.sizes.map((): Entrant[] => []);
    for (const entrant of request.entrants) {
      const pool = entrant.poolId === undefined ? -1 : expectedPoolIds.indexOf(entrant.poolId);
      if (pool < 0) return finalize(request, "REJECTED", [], [{ code: "MANUAL_POOL_ASSIGNMENT", message: "Every entrant must name exactly one declared stage pool." }], null);
      pools[pool]!.push(entrant);
    }
    if (pools.some((pool, index) => pool.length !== request.sizes[index])) {
      return finalize(request, "REJECTED", [], [{ code: "MANUAL_POOL_SIZE", message: "Manual pool assignments must match every declared pool size." }], null);
    }
    return finalize(request, "ALLOCATED", pools, [], canonicalHash({ assignments: request.entrants.map(({ id, poolId }) => ({ id, poolId })) }));
  }
  if (request.allocation === "optimised") {
    const construction = constructPools({
      id: request.stageId, entrants: request.entrants.map(({ id, seed }) => ({ id, ...(seed === undefined ? {} : { seed }) })),
      poolCount: request.sizes.length, size: { minimum: Math.min(...request.sizes), maximum: Math.max(...request.sizes) },
      targetSizes: request.sizes, hardConstraints: [],
      objectives: [
        { kind: "BALANCE_SIZE", priority: 1, weight: 1 },
        { kind: "BALANCE_SEED_STRENGTH", priority: 2, weight: 1 },
      ],
      search: { maximumNodes: request.entrants.length <= 8 ? 1_000_000 : 10_000 },
    });
    if (construction.status !== "OPTIMAL" && construction.status !== "FEASIBLE") {
      return finalize(request, construction.status === "UNKNOWN" ? "UNKNOWN" : "REJECTED", [], [{
        code: `POOL_OPTIMISER_${construction.status}`, message: "The pool construction engine did not return a verified feasible allocation.", evidence: construction.findings,
      }], construction.proofHash);
    }
    const entrantsById = new Map(request.entrants.map((entrant) => [entrant.id, entrant]));
    const pools = construction.pools.map((pool) => pool.entrants.map(({ id }) => entrantsById.get(id)!));
    return finalize(request, "ALLOCATED", pools, [], construction.proofHash);
  }
  if (request.allocation !== "snake") return finalize(request, "REJECTED", [], [{
    code: "POOL_ALLOCATION_ADAPTER", message: "No registered adapter is available for this allocation mode.", evidence: { allocation: request.allocation },
  }], null);
  const ordered = request.entrants.map((entrant, index) => ({ entrant, index })).sort((left, right) =>
    (left.entrant.seed ?? left.index + 1) - (right.entrant.seed ?? right.index + 1) || left.entrant.id.localeCompare(right.entrant.id));
  const pools: Entrant[][] = request.sizes.map(() => []);
  poolOrder(request.sizes).forEach((pool, position) => pools[pool]!.push(ordered[position]!.entrant));
  return finalize(request, "ALLOCATED", pools, [], null);
}
