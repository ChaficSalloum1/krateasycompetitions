import assert from "node:assert/strict";
import test from "node:test";
import { allocateStagePools } from "../src/pool-allocation.js";
import { buildCompetitionGraph, createEntrants } from "../src/graph.js";
import type { Entrant } from "../src/types.js";
import { compileDefinition } from "@tournament-os/tournament-schema";
import { playAndKonnectDefinition } from "@tournament-os/tournament-schema/example";

const entrants = (count: number): Entrant[] => Array.from({ length: count }, (_, index) => ({
  id: `E${index + 1}`, divisionId: "open", memberIds: [`P${index + 1}`], seed: index + 1,
}));

test("snake allocation balances seed bands across the declared pool sizes", () => {
  const result = allocateStagePools({
    stageId: "groups", allocation: "snake", sizes: [4, 4, 4], entrants: entrants(12),
    randomisation: { mode: "none" },
  });

  assert.equal(result.status, "ALLOCATED");
  assert.deepEqual(result.pools.map((pool) => pool.map(({ seed }) => seed)), [
    [1, 6, 7, 12], [2, 5, 8, 11], [3, 4, 9, 10],
  ]);
  assert.equal(result.proof.entrantCoverage, true);
  assert.equal(result.proof.sizeClosure, true);
});

test("random allocation requires and replays a pinned deterministic random policy", () => {
  const request = {
    stageId: "random-groups", allocation: "random" as const, sizes: [4, 4], entrants: entrants(8),
    randomisation: { mode: "deterministic" as const, algorithm: "xoshiro128ss" as const, seed: "draw-17" },
  };

  const first = allocateStagePools(request);
  const replay = allocateStagePools(request);
  const unpinned = allocateStagePools({ ...request, randomisation: { mode: "none" as const } });

  assert.equal(first.status, "ALLOCATED");
  assert.deepEqual(replay, first);
  assert.equal(unpinned.status, "REJECTED");
  assert.match(unpinned.findings[0]?.code ?? "", /RANDOM/);
});

test("manual allocation is accepted only when every entrant names one declared pool with exact sizes", () => {
  const assigned = entrants(6).map((entrant, index) => ({ ...entrant, poolId: `manual.P${index % 2 + 1}` }));
  const request = { stageId: "manual", allocation: "manual" as const, sizes: [3, 3], entrants: assigned, randomisation: { mode: "none" as const } };

  const valid = allocateStagePools(request);
  const missingEntrants: Entrant[] = assigned.map((entrant, index) => {
    if (index !== 0) return entrant;
    const { poolId: _poolId, ...withoutPool } = entrant;
    return withoutPool;
  });
  const missing = allocateStagePools({ ...request, entrants: missingEntrants });

  assert.equal(valid.status, "ALLOCATED");
  assert.deepEqual(valid.pools.map((pool) => pool.map(({ id }) => id)), [["E1", "E3", "E5"], ["E2", "E4", "E6"]]);
  assert.equal(missing.status, "REJECTED");
  assert.match(missing.findings[0]?.code ?? "", /MANUAL/);
});

test("optimised allocation delegates to the proof-bounded pool construction engine", () => {
  const result = allocateStagePools({
    stageId: "optimised", allocation: "optimised", sizes: [4, 4, 4], entrants: entrants(12),
    randomisation: { mode: "none" },
  });

  assert.equal(result.status, "ALLOCATED");
  assert.match(result.proof.sourceProofHash ?? "", /^[a-f0-9]{64}$/);
  const totals = result.pools.map((pool) => pool.reduce((sum, entrant) => sum + entrant.seed!, 0));
  assert.ok(Math.max(...totals) - Math.min(...totals) <= 2);
});

test("the primary competition graph executes the declared pool-allocation adapter", () => {
  const spec = compileDefinition(playAndKonnectDefinition, {
    specId: "pool-allocation-integration", revision: 1, schemaVersion: "1.0.0", compilerVersion: "1.0.0",
    rulesetVersions: { padel: "1.0.0" }, sourcePrompt: "integration", createdAt: "2026-01-01T00:00:00Z",
  });

  const graph = buildCompetitionGraph(spec, createEntrants(spec));
  const firstPoolEntrants = graph.nodes.filter(({ poolId }) => poolId === "advanced.pools.P1")
    .flatMap(({ slots }) => slots.flatMap((slot) => slot.type === "entrant" ? [slot.entrantId] : []));
  const uniqueFirstPoolEntrants = [...new Set(firstPoolEntrants)].sort();

  assert.ok(firstPoolEntrants.includes("advanced.team.1"));
  assert.equal(uniqueFirstPoolEntrants.length, 4);
  assert.notDeepEqual(uniqueFirstPoolEntrants, ["advanced.team.1", "advanced.team.2", "advanced.team.3"]);
  assert.ok(graph.stageProofs?.some(({ stageId, adapterId }) => stageId === "advanced.pools" && adapterId === "pool-allocation/optimised@1"));
});

test("every allocation must satisfy the organiser's keep-together and keep-apart rules", () => {
  const roster = Array.from({ length: 12 }, (_, i) => ({ id: `r${i + 1}`, divisionId: "open", memberIds: [], seed: i + 1 }));
  const request = { stageId: "rules", sizes: [4, 4, 4], entrants: roster, randomisation: { mode: "none" as const } };
  // The seeded snake draw puts r1, r6, r7 and r12 together, and r1, r2 and r3 apart.
  const together = [{ kind: "TOGETHER" as const, entrantIds: ["r1", "r2"] }];
  const snake = allocateStagePools({ ...request, allocation: "snake", membershipConstraints: together });
  assert.equal(snake.status, "REJECTED", "a draw that breaks a rule is refused, whatever made it");
  assert.ok(snake.findings.some(({ code }) => code === "POOL_MEMBERSHIP_RULE"));
  const rules = [...together, { kind: "SEPARATE" as const, entrantIds: ["r6", "r7", "r12"] }];
  const optimised = allocateStagePools({ ...request, allocation: "optimised", membershipConstraints: rules });
  assert.equal(optimised.status, "ALLOCATED");
  const poolOf = (id: string) => optimised.pools.findIndex((pool) => pool.some((entrant) => entrant.id === id));
  assert.equal(poolOf("r1"), poolOf("r2"));
  assert.equal(new Set(["r6", "r7", "r12"].map(poolOf)).size, 3);
  assert.deepEqual(optimised.pools.map((pool) => pool.length), [4, 4, 4]);
});
