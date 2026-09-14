import { canonicalHash, deepFreeze, type ValidationFinding } from "@tournament-os/tournament-schema";
import { compileStaticFormat, type CompiledStaticFormat, type StaticContest } from "./static-formats.js";
import { compileTopology, type CompiledTopology, type TopologyNode } from "./topology-compiler.js";
import type { ContestNode, Entrant, ProgressionEdge, SlotSource } from "./types.js";

interface StaticStagePlanBase {
  readonly id: string;
  readonly divisionId: string;
  readonly requiredResourceType: string;
  readonly entrants: readonly Entrant[];
}

export type StaticStagePlan =
  | (StaticStagePlanBase & { readonly primitive: "single_round_robin" | "double_round_robin" })
  | (StaticStagePlanBase & { readonly primitive: "single_elimination" | "consolation"; readonly thirdPlaceMatch?: boolean })
  | (StaticStagePlanBase & { readonly primitive: "double_elimination"; readonly resetFinalPolicy: "NEVER" | "IF_NECESSARY" })
  | (StaticStagePlanBase & { readonly primitive: "repechage" });

export interface ApprovedStaticStageRequest {
  readonly plan: StaticStagePlan;
  readonly approval: Readonly<{
    status: "APPROVED";
    authority: string;
    approvedPlanHash: string;
  }>;
}

export interface StaticStageScaleEnvelope {
  readonly profile: "TOURNAMENT_OS_STATIC_STAGE_V1";
  readonly testedEntrantRanges: Readonly<{
    singleRoundRobin: "2-64";
    doubleRoundRobin: "2-64";
    singleElimination: "2-64";
    consolation: "2-64";
    doubleElimination: "POWER_OF_TWO_2-64";
    repechage: "POWER_OF_TWO_8-64";
  }>;
  readonly qualification: "TESTED_ENVELOPE_NOT_ARBITRARY_FORMAT_SUPPORT";
}

export interface StaticStageProof {
  readonly valid: boolean;
  readonly approvedPlanHash: string;
  readonly sourceCompilerProofHash: string | null;
  readonly uniqueNodeIds: boolean;
  readonly allEntrantIdentitiesMapped: boolean;
  readonly allSlotSourcesResolved: boolean;
  readonly edgeSlotClosure: boolean;
  readonly noLoserFromBye: boolean;
  readonly conditionalSemanticsClosed: boolean;
  readonly acyclic: boolean;
  readonly scaleEnvelope: StaticStageScaleEnvelope;
  readonly proofHash: string;
}

export interface CompiledStaticStageGraph {
  readonly status: "COMPILED" | "REJECTED";
  readonly stageId: string;
  readonly nodes: readonly ContestNode[];
  readonly edges: readonly ProgressionEdge[];
  readonly expectedActualContestCount: number;
  readonly generatedActualContestCount: number;
  readonly minimumActualContestCount: number;
  readonly maximumActualContestCount: number;
  readonly conditionalContestCount: number;
  readonly findings: readonly ValidationFinding[];
  readonly proof: StaticStageProof;
}

const SCALE_ENVELOPE: StaticStageScaleEnvelope = {
  profile: "TOURNAMENT_OS_STATIC_STAGE_V1",
  testedEntrantRanges: {
    singleRoundRobin: "2-64",
    doubleRoundRobin: "2-64",
    singleElimination: "2-64",
    consolation: "2-64",
    doubleElimination: "POWER_OF_TWO_2-64",
    repechage: "POWER_OF_TWO_8-64",
  },
  qualification: "TESTED_ENVELOPE_NOT_ARBITRARY_FORMAT_SUPPORT",
};

export function hashStaticStagePlan(plan: StaticStagePlan): string {
  return canonicalHash(plan);
}

function finding(code: string, path: string, message: string, evidence?: Record<string, unknown>): ValidationFinding {
  return { code, severity: "ERROR", path, message, ...(evidence ? { evidence } : {}) };
}

function orderedEntrants(plan: StaticStagePlan): { entrants: Entrant[]; findings: ValidationFinding[] } {
  const findings: ValidationFinding[] = [];
  if (!plan.id.trim()) findings.push(finding("TSS001", "/stage/id", "Stage id is required."));
  if (!plan.divisionId.trim()) findings.push(finding("TSS001", "/stage/divisionId", "Division id is required."));
  if (!plan.requiredResourceType.trim()) findings.push(finding("TSS001", "/stage/requiredResourceType", "Required resource type is required."));
  if (plan.entrants.length < 2 || plan.entrants.length > 64) findings.push(finding(
    "TSS002", "/stage/entrants", "Static stage entrant count must be from 2 to 64.", { entrantCount: plan.entrants.length },
  ));
  const ids = plan.entrants.map(({ id }) => id);
  const duplicateIds = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))].sort();
  if (duplicateIds.length > 0 || ids.some((id) => !id.trim())) findings.push(finding(
    "TSS003", "/stage/entrants", "Entrant ids must be non-empty and unique.", { duplicateIds },
  ));
  const wrongDivisionEntrantIds = plan.entrants.filter(({ divisionId }) => divisionId !== plan.divisionId).map(({ id }) => id).sort();
  if (wrongDivisionEntrantIds.length > 0) findings.push(finding(
    "TSS004", "/stage/entrants", "Every entrant must belong to the stage division.", { wrongDivisionEntrantIds },
  ));
  const seeds = plan.entrants.map(({ seed }) => seed);
  const expectedSeeds = Array.from({ length: plan.entrants.length }, (_, index) => index + 1);
  const suppliedSeeds = seeds.filter((seed): seed is number => Number.isInteger(seed)).sort((left, right) => left - right);
  if (suppliedSeeds.length !== plan.entrants.length || suppliedSeeds.some((seed, index) => seed !== expectedSeeds[index])) findings.push(finding(
    "TSS005", "/stage/entrants", "Entrants require unique contiguous seed identities from 1 through entrant count.", { suppliedSeeds, expectedSeeds },
  ));
  return {
    entrants: [...plan.entrants].sort((left, right) => (left.seed ?? Number.MAX_SAFE_INTEGER) - (right.seed ?? Number.MAX_SAFE_INTEGER) || left.id.localeCompare(right.id)),
    findings,
  };
}

function slotFromStatic(slot: StaticContest["inputs"][number], entrantBySeed: ReadonlyMap<number, Entrant>): SlotSource {
  if (slot.type === "ENTRANT") return { type: "entrant", entrantId: entrantBySeed.get(slot.seed)!.id };
  return { type: slot.outcome === "WINNER" ? "winner" : "loser", contestId: slot.contestId };
}

function calculateDepths(nodes: readonly ContestNode[], edges: readonly ProgressionEdge[]): Map<string, number> {
  const depth = new Map(nodes.map(({ id }) => [id, 1]));
  const incoming = new Map(nodes.map(({ id }) => [id, [] as string[]]));
  for (const edge of edges) incoming.get(edge.toContestId)?.push(edge.fromContestId);
  const unresolved = new Set(nodes.map(({ id }) => id));
  while (unresolved.size > 0) {
    const ready = [...unresolved].filter((id) => (incoming.get(id) ?? []).every((source) => !unresolved.has(source))).sort();
    if (ready.length === 0) break;
    for (const id of ready) {
      depth.set(id, 1 + Math.max(0, ...(incoming.get(id) ?? []).map((source) => depth.get(source) ?? 0)));
      unresolved.delete(id);
    }
  }
  return depth;
}

function mapStatic(plan: StaticStagePlan, compiled: CompiledStaticFormat, entrants: readonly Entrant[]): { nodes: ContestNode[]; edges: ProgressionEdge[] } {
  const entrantBySeed = new Map(entrants.map((entrant) => [entrant.seed!, entrant]));
  const edges: ProgressionEdge[] = compiled.edges.map((edge) => ({
    fromContestId: edge.fromContestId,
    outcome: edge.outcome === "WINNER" ? "winner" : "loser",
    toContestId: edge.toContestId,
    toSlot: edge.inputIndex,
  }));
  const preliminary: ContestNode[] = compiled.contests.map((contest) => ({
    id: contest.id,
    stageId: plan.id,
    divisionId: plan.divisionId,
    ...(contest.bracket === "ROUND_ROBIN" ? { poolId: `${plan.id}.P1` } : {}),
    round: contest.label,
    roundIndex: contest.bracket === "ROUND_ROBIN" ? contest.round : 1,
    index: contest.sequence,
    kind: "contest",
    slots: [slotFromStatic(contest.inputs[0], entrantBySeed), slotFromStatic(contest.inputs[1], entrantBySeed)],
    requiredResourceType: plan.requiredResourceType,
    ...(contest.condition ? { condition: { ...contest.condition } } : {}),
  }));
  if (compiled.format !== "SINGLE_ROUND_ROBIN" && compiled.format !== "DOUBLE_ROUND_ROBIN") {
    const depths = calculateDepths(preliminary, edges);
    for (const node of preliminary) node.roundIndex = depths.get(node.id) ?? 1;
  }
  return { nodes: preliminary, edges };
}

function slotFromTopology(slot: TopologyNode["inputs"][number], entrantBySeed: ReadonlyMap<number, Entrant>): SlotSource {
  if (slot.type === "ENTRANT") return { type: "entrant", entrantId: entrantBySeed.get(slot.seed)!.id };
  return { type: slot.port === "WINNER" ? "winner" : "loser", contestId: slot.nodeId };
}

function mapTopology(plan: StaticStagePlan, compiled: CompiledTopology, entrants: readonly Entrant[]): { nodes: ContestNode[]; edges: ProgressionEdge[] } {
  const entrantBySeed = new Map(entrants.map((entrant) => [entrant.seed!, entrant]));
  const roundIndexes = new Map<string, number>();
  const nodes: ContestNode[] = compiled.nodes.map((node) => {
    const roundKey = `${node.phase}|${node.round}`;
    const index = (roundIndexes.get(roundKey) ?? 0) + 1;
    roundIndexes.set(roundKey, index);
    const first = slotFromTopology(node.inputs[0], entrantBySeed);
    const slots: [SlotSource, SlotSource] = node.kind === "BYE"
      ? [first, { type: "bye" }]
      : [first, slotFromTopology(node.inputs[1], entrantBySeed)];
    return {
      id: node.id,
      stageId: plan.id,
      divisionId: plan.divisionId,
      round: node.kind === "MATCH" && node.label ? node.label : `${node.phase.toLowerCase().replaceAll("_", " ")} round ${node.round}`,
      roundIndex: node.round,
      index,
      kind: node.kind === "BYE" ? "bye" : "contest",
      slots,
      requiredResourceType: plan.requiredResourceType,
    };
  });
  const edges: ProgressionEdge[] = nodes.flatMap((node) => node.slots.flatMap((slot, toSlot) =>
    slot.type === "winner" || slot.type === "loser" ? [{
      fromContestId: slot.contestId,
      outcome: slot.type,
      toContestId: node.id,
      toSlot: toSlot as 0 | 1,
    }] : []));
  return { nodes, edges };
}

function isAcyclic(nodes: readonly ContestNode[], edges: readonly ProgressionEdge[]): boolean {
  const incoming = new Map(nodes.map(({ id }) => [id, 0]));
  const outgoing = new Map(nodes.map(({ id }) => [id, [] as string[]]));
  for (const edge of edges) {
    if (!incoming.has(edge.fromContestId) || !incoming.has(edge.toContestId)) return false;
    incoming.set(edge.toContestId, incoming.get(edge.toContestId)! + 1);
    outgoing.get(edge.fromContestId)!.push(edge.toContestId);
  }
  const ready = [...incoming].filter(([, count]) => count === 0).map(([id]) => id).sort();
  let visited = 0;
  while (ready.length > 0) {
    const id = ready.shift()!;
    visited += 1;
    for (const target of outgoing.get(id)!.sort()) {
      const remaining = incoming.get(target)! - 1;
      incoming.set(target, remaining);
      if (remaining === 0) ready.push(target);
    }
    ready.sort();
  }
  return visited === nodes.length;
}

function closeProof(
  request: ApprovedStaticStageRequest,
  nodes: ContestNode[],
  edges: ProgressionEdge[],
  expectedActualContestCount: number,
  sourceCompilerProofHash: string,
  findings: ValidationFinding[],
  expectedConditionalContestCount = 0,
): CompiledStaticStageGraph {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const entrantIds = new Set(request.plan.entrants.map(({ id }) => id));
  const referencedEntrants = new Set(nodes.flatMap(({ slots }) => slots.flatMap((slot) => slot.type === "entrant" ? [slot.entrantId] : [])));
  const dynamicSlots = nodes.flatMap((node) => node.slots.flatMap((slot, toSlot) =>
    slot.type === "winner" || slot.type === "loser" ? [{ node, slot, toSlot: toSlot as 0 | 1 }] : []));
  const allSlotSourcesResolved = dynamicSlots.every(({ slot }) => nodeById.has(slot.contestId));
  const edgeSlotClosure = dynamicSlots.every(({ node, slot, toSlot }) => edges.filter((edge) =>
    edge.fromContestId === slot.contestId && edge.outcome === slot.type && edge.toContestId === node.id && edge.toSlot === toSlot).length === 1)
    && edges.length === dynamicSlots.length;
  const noLoserFromBye = dynamicSlots.filter(({ slot }) => slot.type === "loser")
    .every(({ slot }) => nodeById.get(slot.contestId)?.kind === "contest");
  const conditionalNodes = nodes.filter(({ condition }) => condition !== undefined);
  const conditionalSemanticsClosed = conditionalNodes.every((node) => {
    const condition = node.condition!;
    const source = nodeById.get(condition.sourceContestId);
    return condition.type === "SOURCE_SLOT_WON" && condition.sourceContestId !== node.id
      && source?.kind === "contest" && source.condition === undefined
      && (condition.sourceSlot === 0 || condition.sourceSlot === 1)
      && edges.some(({ fromContestId, toContestId }) => fromContestId === source.id && toContestId === node.id);
  });
  const proofBase = {
    valid: false,
    approvedPlanHash: request.approval.approvedPlanHash,
    sourceCompilerProofHash,
    uniqueNodeIds: nodeById.size === nodes.length,
    allEntrantIdentitiesMapped: entrantIds.size === referencedEntrants.size && [...entrantIds].every((id) => referencedEntrants.has(id)),
    allSlotSourcesResolved,
    edgeSlotClosure,
    noLoserFromBye,
    conditionalSemanticsClosed,
    acyclic: isAcyclic(nodes, edges),
    scaleEnvelope: SCALE_ENVELOPE,
  };
  const generatedActualContestCount = nodes.filter(({ kind }) => kind === "contest").length;
  const generatedRequiredContestCount = nodes.filter(({ kind, condition }) => kind === "contest" && condition === undefined).length;
  const valid = proofBase.uniqueNodeIds && proofBase.allEntrantIdentitiesMapped && proofBase.allSlotSourcesResolved
    && proofBase.edgeSlotClosure && proofBase.noLoserFromBye && proofBase.conditionalSemanticsClosed && proofBase.acyclic
    && generatedRequiredContestCount === expectedActualContestCount
    && conditionalNodes.length === expectedConditionalContestCount && findings.length === 0;
  if (!valid) findings.push(finding("TSS900", "/stageGraph", "Canonical graph failed independent proof closure."));
  const proofWithoutHash = { ...proofBase, valid };
  return deepFreeze({
    status: valid ? "COMPILED" as const : "REJECTED" as const,
    stageId: request.plan.id,
    nodes: valid ? nodes : [],
    edges: valid ? edges : [],
    expectedActualContestCount: expectedActualContestCount + expectedConditionalContestCount,
    generatedActualContestCount: valid ? generatedActualContestCount : 0,
    minimumActualContestCount: valid ? expectedActualContestCount : 0,
    maximumActualContestCount: valid ? expectedActualContestCount + expectedConditionalContestCount : 0,
    conditionalContestCount: valid ? conditionalNodes.length : 0,
    findings,
    proof: { ...proofWithoutHash, proofHash: canonicalHash({ request, nodes, edges, findings, proof: proofWithoutHash }) },
  });
}

function rejected(request: ApprovedStaticStageRequest, findings: ValidationFinding[]): CompiledStaticStageGraph {
  const proofBase = {
    valid: false,
    approvedPlanHash: request.approval.approvedPlanHash,
    sourceCompilerProofHash: null,
    uniqueNodeIds: false,
    allEntrantIdentitiesMapped: false,
    allSlotSourcesResolved: false,
    edgeSlotClosure: false,
    noLoserFromBye: false,
    conditionalSemanticsClosed: false,
    acyclic: false,
    scaleEnvelope: SCALE_ENVELOPE,
  };
  return deepFreeze({
    status: "REJECTED" as const,
    stageId: request.plan.id,
    nodes: [], edges: [], expectedActualContestCount: 0, generatedActualContestCount: 0,
    minimumActualContestCount: 0, maximumActualContestCount: 0, conditionalContestCount: 0,
    findings,
    proof: { ...proofBase, proofHash: canonicalHash({ request, findings, proof: proofBase }) },
  });
}

export function compileApprovedStaticStage(request: ApprovedStaticStageRequest): CompiledStaticStageGraph {
  const identity = orderedEntrants(request.plan);
  const findings = [...identity.findings];
  if (request.approval.status !== "APPROVED" || !request.approval.authority.trim()) findings.push(finding(
    "TSS006", "/approval", "Static stage execution requires an identified approving authority.",
  ));
  const planHash = hashStaticStagePlan(request.plan);
  if (request.approval.approvedPlanHash !== planHash) findings.push(finding(
    "TSS007", "/approval/approvedPlanHash", "Approval hash does not bind the supplied stage plan.",
    { approvedPlanHash: request.approval.approvedPlanHash, actualPlanHash: planHash },
  ));
  if (findings.length > 0) return rejected(request, findings);
  if (request.plan.primitive === "single_round_robin" || request.plan.primitive === "double_round_robin") {
    const compiled = compileStaticFormat({
      id: request.plan.id,
      format: request.plan.primitive === "single_round_robin" ? "SINGLE_ROUND_ROBIN" : "DOUBLE_ROUND_ROBIN",
      entrantCount: identity.entrants.length,
    });
    const graph = mapStatic(request.plan, compiled, identity.entrants);
    return closeProof(request, graph.nodes, graph.edges, compiled.proof.expectedRequiredContestCount, compiled.proof.proofHash, findings,
      compiled.proof.generatedConditionalContestCount);
  }
  if (request.plan.primitive === "single_elimination" || request.plan.primitive === "consolation") {
    try {
      const compiled = compileTopology({
        id: request.plan.id,
        entrantCount: identity.entrants.length,
        ...(request.plan.thirdPlaceMatch === undefined ? {} : { thirdPlaceMatch: request.plan.thirdPlaceMatch }),
      });
      const graph = mapTopology(request.plan, compiled, identity.entrants);
      return closeProof(request, graph.nodes, graph.edges, compiled.proof.expectedCompetitiveMatchCount, compiled.proof.proofHash, findings);
    } catch (error) {
      return rejected(request, [finding("TSS009", "/stage", "Approved elimination topology could not be compiled without inventing semantics.", {
        reason: error instanceof Error ? error.message : "UNKNOWN",
      })]);
    }
  }
  if (request.plan.primitive === "double_elimination") {
    try {
      const compiled = compileStaticFormat({
        id: request.plan.id,
        format: "DOUBLE_ELIMINATION",
        entrantCount: identity.entrants.length,
        resetFinalPolicy: request.plan.resetFinalPolicy,
      });
      const graph = mapStatic(request.plan, compiled, identity.entrants);
      return closeProof(request, graph.nodes, graph.edges, compiled.proof.expectedRequiredContestCount, compiled.proof.proofHash, findings,
        compiled.proof.generatedConditionalContestCount);
    } catch (error) {
      return rejected(request, [finding("TSS009", "/stage", "Approved double-elimination topology could not be compiled without inventing semantics.", {
        reason: error instanceof Error ? error.message : "UNKNOWN",
      })]);
    }
  }
  if (request.plan.primitive === "repechage") {
    try {
      const compiled = compileStaticFormat({
        id: request.plan.id,
        format: "REPECHAGE_CLASSIFICATION",
        entrantCount: identity.entrants.length,
      });
      const graph = mapStatic(request.plan, compiled, identity.entrants);
      return closeProof(request, graph.nodes, graph.edges, compiled.proof.expectedRequiredContestCount, compiled.proof.proofHash, findings,
        compiled.proof.generatedConditionalContestCount);
    } catch (error) {
      return rejected(request, [finding("TSS009", "/stage", "Approved repechage topology could not be compiled without inventing semantics.", {
        reason: error instanceof Error ? error.message : "UNKNOWN",
      })]);
    }
  }
  return rejected(request, [finding("TSS008", "/stage/primitive", "Approved static primitive has no unified graph adapter.", { primitive: request.plan.primitive })]);
}
