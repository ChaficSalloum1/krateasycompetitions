import { canonicalHash, deepFreeze, type StageDefinition, type ValidationFinding } from "@tournament-os/tournament-schema";
import { compileApprovedStaticStage, hashStaticStagePlan, type StaticStagePlan } from "./static-stage-compiler.js";
import { compileClassificationStage, compileCustomGraph, compilePlayInStage, type CustomGraphNode } from "./primitive-engines.js";
import type { TopologyNode } from "./topology-compiler.js";
import type { ContestNode, Entrant, ProgressionEdge } from "./types.js";

export interface NativeStaticFormatAdapterResult {
  readonly status: "COMPILED" | "REJECTED";
  readonly nodes: readonly ContestNode[];
  readonly edges: readonly ProgressionEdge[];
  readonly expectedContestCount: number;
  readonly findings: readonly ValidationFinding[];
  readonly proofHash: string;
}

function mapTopologyNodes(
  stage: StageDefinition,
  entrants: readonly Entrant[],
  requiredResourceType: string,
  topologyNodes: readonly TopologyNode[],
): { nodes: ContestNode[]; edges: ProgressionEdge[] } {
  const bySeed = new Map(entrants.map((entrant) => [entrant.seed, entrant]));
  const nodes: ContestNode[] = topologyNodes.map((node, sequence) => {
    const slot = (input: TopologyNode["inputs"][number]) => input.type === "ENTRANT"
      ? { type: "entrant" as const, entrantId: bySeed.get(input.seed)!.id }
      : { type: input.port === "WINNER" ? "winner" as const : "loser" as const, contestId: input.nodeId };
    const first = slot(node.inputs[0]);
    return {
      id: node.id, stageId: stage.id, divisionId: stage.divisionId,
      round: node.kind === "MATCH" && node.label ? node.label : `${node.phase.toLowerCase().replaceAll("_", " ")} round ${node.round}`,
      roundIndex: node.round, index: sequence + 1, kind: node.kind === "BYE" ? "bye" : "contest",
      slots: node.kind === "BYE" ? [first, { type: "bye" }] : [first, slot(node.inputs[1])],
      requiredResourceType,
    };
  });
  const edges: ProgressionEdge[] = nodes.flatMap((node) => node.slots.flatMap((slot, toSlot) =>
    slot.type === "winner" || slot.type === "loser" ? [{
      fromContestId: slot.contestId, outcome: slot.type, toContestId: node.id, toSlot: toSlot as 0 | 1,
    }] : []));
  return { nodes, edges };
}

function mapCustomGraphNodes(
  stage: StageDefinition,
  entrants: readonly Entrant[],
  requiredResourceType: string,
  customNodes: readonly CustomGraphNode[],
): { nodes: ContestNode[]; edges: ProgressionEdge[] } {
  const bySeed = new Map(entrants.map((entrant) => [entrant.seed, entrant]));
  const namespaced = (id: string) => `${stage.id}.${id}`;
  const depth = new Map<string, number>();
  for (const node of customNodes) depth.set(node.id, 1 + Math.max(0, ...node.inputs.flatMap((input) => input.type === "PORT" ? [depth.get(input.nodeId) ?? 0] : [])));
  const nodes: ContestNode[] = customNodes.map((node, sequence) => {
    const slot = (input: CustomGraphNode["inputs"][number]) => input.type === "ENTRANT"
      ? { type: "entrant" as const, entrantId: bySeed.get(input.seed)!.id }
      : { type: input.port === "WINNER" ? "winner" as const : "loser" as const, contestId: namespaced(input.nodeId) };
    const first = slot(node.inputs[0]!);
    return {
      id: namespaced(node.id), stageId: stage.id, divisionId: stage.divisionId,
      round: `custom round ${depth.get(node.id) ?? 1}`, roundIndex: depth.get(node.id) ?? 1,
      index: sequence + 1, kind: node.kind === "BYE" ? "bye" : "contest",
      slots: node.kind === "BYE" ? [first, { type: "bye" }] : [first, slot(node.inputs[1]!)],
      requiredResourceType,
    };
  });
  const edges: ProgressionEdge[] = nodes.flatMap((node) => node.slots.flatMap((slot, toSlot) =>
    slot.type === "winner" || slot.type === "loser" ? [{
      fromContestId: slot.contestId, outcome: slot.type, toContestId: node.id, toSlot: toSlot as 0 | 1,
    }] : []));
  return { nodes, edges };
}

const reject = (stage: StageDefinition, reason: string): NativeStaticFormatAdapterResult => {
  const findings: ValidationFinding[] = [{
    code: "TSC705", severity: "ERROR", path: `/stages/${stage.id}/primitive`,
    message: "Stage configuration has no closed native execution plan for its declared primitive.",
    evidence: { primitive: stage.primitive, reason },
  }];
  const base = { status: "REJECTED" as const, nodes: [], edges: [], expectedContestCount: 0, findings };
  return deepFreeze({ ...base, proofHash: canonicalHash({ stage, base }) });
};

export function compileNativeStaticFormat(
  stage: StageDefinition,
  entrants: readonly Entrant[],
  requiredResourceType: string,
  availableNodes: readonly ContestNode[] = [],
): NativeStaticFormatAdapterResult | undefined {
  if (!["double_elimination", "repechage", "play_in", "placement", "custom_graph"].includes(stage.primitive)) return undefined;
  const deterministicEntrants = [...entrants].sort((left, right) =>
    (left.seed ?? Number.MAX_SAFE_INTEGER) - (right.seed ?? Number.MAX_SAFE_INTEGER) || left.id.localeCompare(right.id));
  const expectedSeeds = deterministicEntrants.map((_, index) => index + 1);
  const suppliedSeeds = deterministicEntrants.map(({ seed }) => seed);
  const entrantIds = deterministicEntrants.map(({ id }) => id);
  if (new Set(entrantIds).size !== entrantIds.length || entrantIds.some((id) => !id.trim())
    || suppliedSeeds.some((seed, index) => seed !== expectedSeeds[index])
    || deterministicEntrants.some(({ divisionId }) => divisionId !== stage.divisionId)) {
    return reject(stage, "INVALID_ENTRANT_SEED_IDENTITY");
  }
  if (stage.primitive === "play_in") {
    if (!stage.playIn) return reject(stage, "MISSING_PLAY_IN_CONFIGURATION");
    if (stage.expectedEntrants !== entrants.length) return reject(stage, "PLAY_IN_ENTRANT_COUNT_MISMATCH");
    const compiled = compilePlayInStage({ id: stage.id, entrantCount: entrants.length, mainDrawSize: stage.playIn.mainDrawSize });
    if (compiled.status === "REJECTED") return reject(stage, compiled.findings.map(({ code }) => code).join(",") || "PLAY_IN_REJECTED");
    const mapped = mapTopologyNodes(stage, deterministicEntrants, requiredResourceType, compiled.nodes);
    const base = { status: "COMPILED" as const, ...mapped, expectedContestCount: compiled.proof.playInMatches, findings: [] as ValidationFinding[] };
    return deepFreeze({ ...base, proofHash: canonicalHash({ stage, compiledProofHash: compiled.proofHash, base }) });
  }
  if (stage.primitive === "placement") {
    if (!stage.classification) return reject(stage, "MISSING_CLASSIFICATION_CONFIGURATION");
    const availableById = new Map(availableNodes.map((node) => [node.id, node]));
    const invalidSources = stage.classification.sourceNodes.filter((source) => {
      const available = availableById.get(source.id);
      return !available || (source.kind === "MATCH" ? available.kind !== "contest" : available.kind !== "bye");
    }).map(({ id }) => id).sort();
    if (invalidSources.length > 0) return reject(stage, `UNRESOLVED_CLASSIFICATION_SOURCES:${invalidSources.join(",")}`);
    const compiled = compileClassificationStage({
      id: stage.id,
      sourceNodes: stage.classification.sourceNodes,
      contests: stage.classification.contests,
    });
    if (compiled.status === "REJECTED") return reject(stage, compiled.findings.map(({ code }) => code).join(",") || "CLASSIFICATION_REJECTED");
    const mapped = mapTopologyNodes(stage, deterministicEntrants, requiredResourceType, compiled.nodes);
    const base = { status: "COMPILED" as const, ...mapped, expectedContestCount: compiled.proof.contestCount, findings: [] as ValidationFinding[] };
    return deepFreeze({ ...base, proofHash: canonicalHash({ stage, compiledProofHash: compiled.proofHash, base }) });
  }
  if (stage.primitive === "custom_graph") {
    if (!stage.customGraph) return reject(stage, "MISSING_CUSTOM_GRAPH_CONFIGURATION");
    if (stage.customGraph.entrantCount !== entrants.length || stage.expectedEntrants !== entrants.length) return reject(stage, "CUSTOM_GRAPH_ENTRANT_COUNT_MISMATCH");
    const compiled = compileCustomGraph({ id: stage.id, ...stage.customGraph });
    if (compiled.status === "REJECTED") return reject(stage, compiled.findings.map(({ code }) => code).join(",") || "CUSTOM_GRAPH_REJECTED");
    const mapped = mapCustomGraphNodes(stage, deterministicEntrants, requiredResourceType, compiled.nodes);
    const expectedContestCount = compiled.nodes.filter(({ kind }) => kind === "MATCH").length;
    const base = { status: "COMPILED" as const, ...mapped, expectedContestCount, findings: [] as ValidationFinding[] };
    const stageIdentity = {
      id: stage.id, label: stage.label, divisionId: stage.divisionId, primitive: stage.primitive,
      inputShape: stage.inputShape, outputShape: stage.outputShape, expectedEntrants: stage.expectedEntrants,
    };
    return deepFreeze({ ...base, proofHash: canonicalHash({ stageIdentity, compiledProofHash: compiled.proofHash, base }) });
  }
  if (!stage.bracket) return reject(stage, "MISSING_BRACKET_CONFIGURATION");
  if (stage.bracket.entrantCount !== entrants.length) return reject(stage, "BRACKET_ENTRANT_COUNT_MISMATCH");
  if (stage.bracket.topology !== "power_of_two" || stage.bracket.thirdPlaceMatch) return reject(stage, "UNSUPPORTED_BRACKET_CONFIGURATION");
  let plan: StaticStagePlan;
  if (stage.primitive === "double_elimination") {
    if (!stage.doubleElimination) return reject(stage, "MISSING_RESET_FINAL_POLICY");
    plan = {
      id: stage.id, divisionId: stage.divisionId, primitive: "double_elimination",
      resetFinalPolicy: stage.doubleElimination.resetFinalPolicy,
      requiredResourceType, entrants: deterministicEntrants,
    };
  } else {
    if (!stage.repechage) return reject(stage, "MISSING_REPECHAGE_MODEL");
    if (stage.repechage.model !== "QUARTERFINAL_LOSERS_TO_SEMIFINAL_LOSERS") return reject(stage, "UNREGISTERED_REPECHAGE_MODEL");
    plan = { id: stage.id, divisionId: stage.divisionId, primitive: "repechage", requiredResourceType, entrants: deterministicEntrants };
  }
  const approvedPlanHash = hashStaticStagePlan(plan);
  const compiled = compileApprovedStaticStage({
    plan,
    approval: { status: "APPROVED", authority: "compiled-tournament-spec", approvedPlanHash },
  });
  if (compiled.status === "REJECTED") return reject(stage, compiled.findings.map(({ code }) => code).join(",") || "STATIC_STAGE_REJECTED");
  const base = {
    status: "COMPILED" as const,
    nodes: compiled.nodes,
    edges: compiled.edges,
    expectedContestCount: compiled.maximumActualContestCount,
    findings: [] as ValidationFinding[],
  };
  return deepFreeze({ ...base, proofHash: canonicalHash({ stage, entrantIds: entrants.map(({ id }) => id).sort(), compiledProofHash: compiled.proof.proofHash, base }) });
}
