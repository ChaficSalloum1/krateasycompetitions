import { canonicalHash, type StageDefinition, type TournamentSpec, type ValidationFinding } from "@tournament-os/tournament-schema";
import type { CompetitionGraph, ContestNode, Entrant, ProgressionEdge, SlotSource } from "./types.js";
import { compileNativeStaticFormat } from "./native-static-format-adapter.js";
import { allocateStagePools } from "./pool-allocation.js";

const makeFinding = (code: string, message: string, evidence?: Record<string, unknown>): ValidationFinding => ({
  code, severity: "ERROR", path: "/competitionGraph", message, ...(evidence ? { evidence } : {}),
});

export function seedOrder(size: number): number[] {
  if (size < 2 || (size & (size - 1)) !== 0) throw new Error("Seed order size must be a power of two");
  let order = [1, 2];
  while (order.length < size) {
    const nextSize = order.length * 2;
    order = order.flatMap((seed) => [seed, nextSize + 1 - seed]);
  }
  return order;
}

function roundRobin(stage: StageDefinition, entrants: readonly Entrant[], resourceType: string): ContestNode[] {
  if (!stage.pool) return [];
  const nodes: ContestNode[] = [];
  let cursor = 0;
  stage.pool.sizes.forEach((size, poolIndex) => {
    const pool = entrants.slice(cursor, cursor + size);
    cursor += size;
    for (let repetition = 0; repetition < stage.pool!.rounds; repetition += 1) {
      let matchIndex = 0;
      for (let left = 0; left < pool.length; left += 1) for (let right = left + 1; right < pool.length; right += 1) {
        matchIndex += 1;
        nodes.push({
          id: `${stage.id}.P${poolIndex + 1}.R${repetition + 1}.M${matchIndex}`,
          stageId: stage.id, divisionId: stage.divisionId, poolId: `${stage.id}.P${poolIndex + 1}`,
          round: `pool-round-${repetition + 1}`, roundIndex: repetition + 1, index: matchIndex, kind: "contest",
          slots: [{ type: "entrant", entrantId: pool[left]!.id }, { type: "entrant", entrantId: pool[right]!.id }],
          requiredResourceType: resourceType,
        });
      }
    }
  });
  return nodes;
}

function elimination(stage: StageDefinition, entrants: readonly Entrant[], resourceType: string): { nodes: ContestNode[]; edges: ProgressionEdge[] } {
  const count = stage.bracket?.entrantCount ?? stage.expectedEntrants ?? entrants.length;
  const bracketSize = 2 ** Math.ceil(Math.log2(Math.max(2, count)));
  const ordered = [...entrants].sort((a, b) => (a.seed ?? Number.MAX_SAFE_INTEGER) - (b.seed ?? Number.MAX_SAFE_INTEGER) || a.id.localeCompare(b.id));
  while (ordered.length < count) ordered.push({ id: `${stage.id}.slot.${ordered.length + 1}`, divisionId: stage.divisionId, memberIds: [] });
  const positions = seedOrder(bracketSize).map((seed): SlotSource => seed <= ordered.length
    ? { type: "entrant", entrantId: ordered[seed - 1]!.id }
    : { type: "bye" });
  const nodes: ContestNode[] = [];
  const edges: ProgressionEdge[] = [];
  let previous: ContestNode[] = [];
  for (let index = 0; index < positions.length; index += 2) {
    const slots: [SlotSource, SlotSource] = [positions[index]!, positions[index + 1]!];
    const kind = slots.some(({ type }) => type === "bye") ? "bye" : "contest";
    previous.push({
      id: `${stage.id}.R1.M${index / 2 + 1}`, stageId: stage.id, divisionId: stage.divisionId,
      round: "round-1", roundIndex: 1, index: index / 2 + 1, kind, slots, requiredResourceType: resourceType,
    });
  }
  nodes.push(...previous);
  let roundIndex = 2;
  while (previous.length > 1) {
    const current: ContestNode[] = [];
    for (let index = 0; index < previous.length; index += 2) {
      const left = previous[index]!;
      const right = previous[index + 1]!;
      const node: ContestNode = {
        id: `${stage.id}.R${roundIndex}.M${index / 2 + 1}`, stageId: stage.id, divisionId: stage.divisionId,
        round: previous.length === 2 ? "final" : previous.length === 4 ? "semifinal" : `round-${roundIndex}`,
        roundIndex, index: index / 2 + 1, kind: "contest",
        slots: [{ type: "winner", contestId: left.id }, { type: "winner", contestId: right.id }], requiredResourceType: resourceType,
      };
      edges.push(
        { fromContestId: left.id, outcome: "winner", toContestId: node.id, toSlot: 0 },
        { fromContestId: right.id, outcome: "winner", toContestId: node.id, toSlot: 1 },
      );
      current.push(node);
    }
    nodes.push(...current);
    previous = current;
    roundIndex += 1;
  }
  return { nodes, edges };
}

export function independentlyExpectedContestCount(spec: TournamentSpec): number {
  return spec.stages.reduce((sum, stage) => {
    if (stage.pool) return sum + stage.pool.sizes.reduce((poolSum, size) => poolSum + (size * (size - 1) / 2) * stage.pool!.rounds, 0);
    if (stage.primitive === "double_elimination" && stage.bracket && stage.doubleElimination) {
      return sum + 2 * stage.bracket.entrantCount - 2 + (stage.doubleElimination.resetFinalPolicy === "IF_NECESSARY" ? 1 : 0);
    }
    if (stage.primitive === "repechage" && stage.bracket && stage.repechage) return sum + stage.bracket.entrantCount + 3;
    if (stage.primitive === "play_in" && stage.playIn && stage.expectedEntrants !== undefined) return sum + stage.expectedEntrants - stage.playIn.mainDrawSize;
    if (stage.primitive === "placement" && stage.classification) return sum + stage.classification.contests.length;
    if (stage.primitive === "custom_graph" && stage.customGraph) return sum + stage.customGraph.nodes.filter(({ kind }) => kind === "MATCH").length;
    if (stage.bracket) return sum + stage.bracket.entrantCount - 1 + (stage.bracket.thirdPlaceMatch ? 1 : 0);
    return sum;
  }, 0);
}

export function buildCompetitionGraph(
  spec: TournamentSpec,
  entrantsByDivision: Record<string, Entrant[]>,
  qualifiedByStructure: Record<string, Entrant[]> = {},
): CompetitionGraph {
  const nodes: ContestNode[] = [];
  const edges: ProgressionEdge[] = [];
  const findings: ValidationFinding[] = [];
  const stageProofs: NonNullable<CompetitionGraph["stageProofs"]> = [];
  for (const stage of spec.stages) {
    const structure = spec.competitionStructures.find(({ stageIds }) => stageIds.includes(stage.id));
    const entrants = structure ? (qualifiedByStructure[structure.id] ?? []) : (entrantsByDivision[stage.divisionId] ?? []);
    const nativeStatic = compileNativeStaticFormat(stage, entrants, spec.sport.defaultResourceType, nodes);
    if (nativeStatic) {
      if (nativeStatic.status === "COMPILED") {
        nodes.push(...nativeStatic.nodes); edges.push(...nativeStatic.edges);
        stageProofs.push({ stageId: stage.id, adapterId: "native-static-format@1", proofHash: nativeStatic.proofHash });
      } else findings.push(...nativeStatic.findings);
    } else if (stage.pool && ["groups", "single_round_robin", "double_round_robin", "league_table"].includes(stage.primitive)) {
      const requiredRounds = stage.primitive === "single_round_robin" ? 1 : stage.primitive === "double_round_robin" ? 2 : stage.pool.rounds;
      if (stage.pool.rounds !== requiredRounds) findings.push({
        code: "TSC706", severity: "ERROR", path: `/stages/${stage.id}/pool/rounds`,
        message: "Pool rounds do not match the declared round-robin primitive.",
        evidence: { primitive: stage.primitive, expectedRounds: requiredRounds, actualRounds: stage.pool.rounds },
      });
      else {
        const allocation = allocateStagePools({
          stageId: stage.id, allocation: stage.pool.allocation, sizes: stage.pool.sizes,
          entrants, randomisation: spec.randomisation,
        });
        if (allocation.status === "ALLOCATED") {
          nodes.push(...roundRobin(stage, allocation.pools.flat(), spec.sport.defaultResourceType));
          stageProofs.push({ stageId: stage.id, adapterId: `pool-allocation/${stage.pool.allocation}@1`, proofHash: allocation.proof.proofHash });
        } else allocation.findings.forEach(({ code, message, evidence }) => findings.push({
          code: `TSC707.${code}`, severity: "ERROR", path: `/stages/${stage.id}/pool/allocation`, message,
          ...(evidence === undefined ? {} : { evidence: { detail: evidence } }),
        }));
      }
    } else if (stage.bracket && ["single_elimination", "consolation"].includes(stage.primitive)) {
      const generated = elimination(stage, entrants, spec.sport.defaultResourceType);
      nodes.push(...generated.nodes); edges.push(...generated.edges);
    } else if (stage.pool || stage.bracket) {
      findings.push({
        code: "TSC705", severity: "ERROR", path: `/stages/${stage.id}/primitive`,
        message: "Stage configuration has no end-to-end executable adapter for its declared primitive.",
        evidence: { primitive: stage.primitive },
      });
    }
  }
  for (const policy of spec.qualificationPolicies) {
    const structure = spec.competitionStructures.find(({ id }) => id === policy.destinationStructureId);
    const destinationStageId = structure?.stageIds[0];
    if (!destinationStageId) continue;
    const sources = nodes.filter(({ stageId, kind }) => stageId === policy.sourceStageId && kind === "contest");
    const destinations = nodes.filter(({ stageId, roundIndex }) => stageId === destinationStageId && roundIndex === 1);
    for (const source of sources) for (const destination of destinations) edges.push({
      fromContestId: source.id, outcome: "complete", toContestId: destination.id, toSlot: 0,
    });
  }
  const expectedActualContestCount = independentlyExpectedContestCount(spec);
  const generatedActualContestCount = nodes.filter(({ kind }) => kind === "contest").length;
  for (const stage of spec.stages) {
    if (!nodes.some(({ stageId }) => stageId === stage.id)) findings.push({
      code: "TSC704",
      severity: "ERROR",
      path: `/stages/${stage.id}`,
      message: "Declared stage has no executable graph implementation and cannot be certified.",
      evidence: { primitive: stage.primitive },
    });
  }
  if (new Set(nodes.map(({ id }) => id)).size !== nodes.length) findings.push(makeFinding("TSC701", "Generated graph contains duplicate contest ids."));
  if (generatedActualContestCount !== expectedActualContestCount) findings.push(makeFinding("TSC702", "Generated and independently derived contest counts disagree.", { expectedActualContestCount, generatedActualContestCount }));
  const nodeIds = new Set(nodes.map(({ id }) => id));
  for (const edge of edges) if (!nodeIds.has(edge.fromContestId) || !nodeIds.has(edge.toContestId)) findings.push(makeFinding("TSC703", "Progression edge references a missing node.", { edge }));
  const graph: CompetitionGraph = { specHash: spec.metadata.compiledSpecHash, nodes, edges, expectedActualContestCount, generatedActualContestCount, findings, stageProofs };
  void canonicalHash(graph);
  return graph;
}

export function createEntrants(spec: TournamentSpec): Record<string, Entrant[]> {
  return Object.fromEntries(spec.divisions.map((division) => [division.id, Array.from({ length: division.participantCount }, (_, index) => ({
    id: `${division.id}.team.${index + 1}`, divisionId: division.id,
    memberIds: Array.from({ length: spec.sport.teamSize ?? 1 }, (__, member) => `${division.id}.player.${index + 1}.${member + 1}`),
    seed: index + 1,
  }))]));
}
