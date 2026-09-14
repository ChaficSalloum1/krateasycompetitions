import { createHash } from "node:crypto";
import type { PortReference, TopologyNode, TopologySlot } from "./topology-compiler.js";

export const CUSTOM_GRAPH_SCALE_ENVELOPE = Object.freeze({ maximumNodes: 4_096, maximumEntrants: 4_096, maximumPortsPerNode: 2 });

export interface PrimitiveFinding { readonly code: string; readonly message: string; readonly nodeIds?: readonly string[]; }
export interface PlayInRequest { readonly id: string; readonly entrantCount: number; readonly mainDrawSize: number; }
export interface PlayInCompilation {
  readonly status: "CERTIFIED" | "REJECTED"; readonly id: string; readonly nodes: readonly TopologyNode[];
  readonly qualifiers: readonly TopologySlot[]; readonly findings: readonly PrimitiveFinding[];
  readonly proof: Readonly<{ entrantCount: number; mainDrawSize: number; directEntrants: number; playInMatches: number;
    eliminatedEntrants: number; entrantCoverage: boolean; singleRound: true; scaleEnvelope: typeof CUSTOM_GRAPH_SCALE_ENVELOPE }>;
  readonly proofHash: string;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(",")}}`;
  return JSON.stringify(value) ?? "undefined";
}
function digest(value: unknown): string { return createHash("sha256").update(canonical(value)).digest("hex"); }
function immutable<T>(value: T): Readonly<T> {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) immutable(child);
    Object.freeze(value);
  }
  return value;
}
function finalize<T extends object>(body: T): Readonly<T & { proofHash: string }> { return immutable({ ...body, proofHash: digest(body) }); }
function validId(id: string): boolean { return /^[A-Za-z0-9](?:[A-Za-z0-9._:-]{0,127})$/.test(id); }

export function compilePlayInStage(request: PlayInRequest): PlayInCompilation {
  const proofBase = { entrantCount: request.entrantCount, mainDrawSize: request.mainDrawSize, directEntrants: 0, playInMatches: 0,
    eliminatedEntrants: 0, entrantCoverage: false, singleRound: true as const, scaleEnvelope: CUSTOM_GRAPH_SCALE_ENVELOPE };
  const reject = (code: string, message: string): PlayInCompilation => finalize({ status: "REJECTED" as const, id: request.id,
    nodes: [] as readonly TopologyNode[], qualifiers: [] as readonly TopologySlot[], findings: [{ code, message }], proof: proofBase });
  if (!validId(request.id)) return reject("INVALID_STAGE_ID", "Play-in stage id must use the portable graph identifier grammar.");
  if (!Number.isInteger(request.entrantCount) || !Number.isInteger(request.mainDrawSize) || request.mainDrawSize < 2 ||
    request.entrantCount <= request.mainDrawSize || request.entrantCount > CUSTOM_GRAPH_SCALE_ENVELOPE.maximumEntrants) {
    return reject("INVALID_PLAY_IN_CARDINALITY", "Entrant and main-draw counts must be bounded integers with entrants greater than draw size.");
  }
  const playInMatches = request.entrantCount - request.mainDrawSize;
  const directEntrants = request.entrantCount - playInMatches * 2;
  if (directEntrants < 0) return reject("MULTI_ROUND_PLAY_IN_REQUIRED", "This reduction cannot be achieved by one explicit play-in round.");
  const playInSeeds = Array.from({ length: request.entrantCount - directEntrants }, (_, index) => directEntrants + index + 1);
  const nodes: TopologyNode[] = [];
  for (let index = 0; index < playInMatches; index += 1) {
    nodes.push({ id: `${request.id}.M${index + 1}`, kind: "MATCH", phase: "PLAY_IN", round: 1,
      inputs: [{ type: "ENTRANT", seed: playInSeeds[index]! }, { type: "ENTRANT", seed: playInSeeds.at(-index - 1)! }],
      outputs: [{ port: "WINNER" }, { port: "LOSER" }] });
  }
  const qualifiers: TopologySlot[] = [
    ...Array.from({ length: directEntrants }, (_, index): TopologySlot => ({ type: "ENTRANT", seed: index + 1 })),
    ...nodes.map((node): TopologySlot => ({ type: "PORT", nodeId: node.id, port: "WINNER" })),
  ];
  const openingSeeds = nodes.flatMap(({ inputs }) => inputs.flatMap((input) => input.type === "ENTRANT" ? [input.seed] : []));
  const entrantCoverage = new Set([...Array.from({ length: directEntrants }, (_, i) => i + 1), ...openingSeeds]).size === request.entrantCount;
  const proof = { ...proofBase, directEntrants, playInMatches, eliminatedEntrants: playInMatches, entrantCoverage };
  return finalize({ status: "CERTIFIED" as const, id: request.id, nodes, qualifiers, findings: [] as readonly PrimitiveFinding[], proof });
}

// Reserved shared vocabulary for the chained classification and custom-graph slices.
export type PrimitivePortReference = PortReference;

export interface ClassificationSourceNode { readonly id: string; readonly kind: "MATCH" | "BYE"; }
export interface ClassificationContest {
  readonly id: string; readonly label: string; readonly places: readonly [number, number];
  readonly sources: readonly [PortReference, PortReference];
}
export interface ClassificationRequest {
  readonly id: string; readonly sourceNodes: readonly ClassificationSourceNode[]; readonly contests: readonly ClassificationContest[];
}
type ClassificationNode = Extract<TopologyNode, { kind: "MATCH" }>;
export interface ClassificationCompilation {
  readonly status: "CERTIFIED" | "REJECTED"; readonly id: string; readonly nodes: readonly ClassificationNode[];
  readonly places: readonly Readonly<{ place: number; source: PortReference }>[]; readonly findings: readonly PrimitiveFinding[];
  readonly proof: Readonly<{ contestCount: number; assignedPlaceCount: number; uniquePlaces: boolean; provenanceResolved: boolean;
    outcomeConsumedAtMostOnce: boolean; scaleEnvelope: typeof CUSTOM_GRAPH_SCALE_ENVELOPE }>;
  readonly proofHash: string;
}

export function compileClassificationStage(request: ClassificationRequest): ClassificationCompilation {
  const baseProof = { contestCount: 0, assignedPlaceCount: 0, uniquePlaces: false, provenanceResolved: false,
    outcomeConsumedAtMostOnce: false, scaleEnvelope: CUSTOM_GRAPH_SCALE_ENVELOPE };
  const reject = (code: string, message: string, nodeIds?: readonly string[]): ClassificationCompilation => finalize({
    status: "REJECTED" as const, id: request.id, nodes: [] as readonly ClassificationNode[], places: [] as readonly Readonly<{ place: number; source: PortReference }>[],
    findings: [nodeIds === undefined ? { code, message } : { code, message, nodeIds }], proof: baseProof,
  });
  if (!validId(request.id) || request.contests.length < 1 || request.contests.length > CUSTOM_GRAPH_SCALE_ENVELOPE.maximumNodes) {
    return reject("INVALID_CLASSIFICATION_STAGE", "Classification requires a portable id and a bounded non-empty contest set.");
  }
  const sourceIds = request.sourceNodes.map(({ id }) => id);
  if (new Set(sourceIds).size !== sourceIds.length || request.sourceNodes.some(({ id }) => !validId(id))) {
    return reject("INVALID_SOURCE_NODES", "Classification source nodes need unique portable ids.");
  }
  const sources = new Map(request.sourceNodes.map((source) => [source.id, source]));
  const nodeIds = new Set<string>(); const consumed = new Set<string>(); const assignedPlaces = new Set<number>();
  const nodes: ClassificationNode[] = []; const places: { place: number; source: PortReference }[] = [];
  for (const contest of request.contests) {
    const nodeId = `${request.id}.${contest.id}`;
    if (!validId(contest.id) || !contest.label.trim() || nodeIds.has(nodeId)) return reject("INVALID_CLASSIFICATION_CONTEST", "Contest ids and labels must be unique and portable.", [nodeId]);
    if (contest.places.some((place) => !Number.isInteger(place) || place < 1) || contest.places[0] >= contest.places[1] ||
      contest.places.some((place) => assignedPlaces.has(place))) {
      return reject("INVALID_PLACE_ASSIGNMENT", "Winner and loser need unique positive places ordered from better to worse.", [nodeId]);
    }
    for (const reference of contest.sources) {
      const source = sources.get(reference.nodeId);
      const key = `${reference.nodeId}:${reference.port}`;
      if (!source || !(["WINNER", "LOSER"] as const).includes(reference.port)) return reject("DANGLING_CLASSIFICATION_SOURCE", "Every classification input must resolve to a declared outcome port.", [reference.nodeId]);
      if (source.kind === "BYE" && reference.port === "LOSER") return reject("LOSER_FROM_BYE", "A bye cannot produce a loser for classification.", [reference.nodeId]);
      if (consumed.has(key)) return reject("OUTCOME_REUSED", "A source outcome cannot place the same competitor twice.", [reference.nodeId]);
      consumed.add(key);
    }
    if (`${contest.sources[0].nodeId}:${contest.sources[0].port}` === `${contest.sources[1].nodeId}:${contest.sources[1].port}`) {
      return reject("DUPLICATE_CONTEST_INPUT", "A classification contest needs two distinct outcome sources.", [nodeId]);
    }
    nodes.push({ id: nodeId, kind: "MATCH", phase: "CLASSIFICATION", round: 1, label: contest.label,
      inputs: contest.sources.map((source) => ({ type: "PORT", nodeId: source.nodeId, port: source.port })) as unknown as [TopologySlot, TopologySlot],
      outputs: [{ port: "WINNER" }, { port: "LOSER" }] });
    places.push({ place: contest.places[0], source: { nodeId, port: "WINNER" } }, { place: contest.places[1], source: { nodeId, port: "LOSER" } });
    assignedPlaces.add(contest.places[0]); assignedPlaces.add(contest.places[1]); nodeIds.add(nodeId);
  }
  places.sort((left, right) => left.place - right.place);
  const proof = { contestCount: nodes.length, assignedPlaceCount: places.length, uniquePlaces: assignedPlaces.size === places.length,
    provenanceResolved: true, outcomeConsumedAtMostOnce: true, scaleEnvelope: CUSTOM_GRAPH_SCALE_ENVELOPE };
  return finalize({ status: "CERTIFIED" as const, id: request.id, nodes, places, findings: [] as readonly PrimitiveFinding[], proof });
}

export type CustomGraphInput = Readonly<{ type: "ENTRANT"; seed: number } | { type: "PORT"; nodeId: string; port: "WINNER" | "LOSER" }>;
export interface CustomGraphNode {
  readonly id: string; readonly kind: "MATCH" | "BYE"; readonly inputs: readonly CustomGraphInput[];
  readonly outputs: readonly ("WINNER" | "LOSER")[];
}
export interface CustomGraphDefinition {
  readonly schemaVersion: string; readonly id: string; readonly entrantCount: number; readonly nodes: readonly CustomGraphNode[];
}
export interface CustomGraphCompilation {
  readonly status: "CERTIFIED" | "REJECTED"; readonly schemaVersion: string; readonly id: string;
  readonly nodes: readonly CustomGraphNode[]; readonly findings: readonly PrimitiveFinding[];
  readonly proof: Readonly<{ compilerVersion: "1.0.0"; definitionHash: string; nodeCount: number; entrantCoverage: boolean;
    outcomeProvenance: boolean; outcomesConsumedAtMostOnce: boolean; acyclic: boolean; scaleEnvelope: typeof CUSTOM_GRAPH_SCALE_ENVELOPE }>;
  readonly proofHash: string;
}

export function compileCustomGraph(definition: CustomGraphDefinition): CustomGraphCompilation {
  const findings: PrimitiveFinding[] = [];
  if (definition.schemaVersion !== "1.0.0") findings.push({ code: "UNSUPPORTED_GRAPH_VERSION", message: "Custom graph schemaVersion must be exactly 1.0.0." });
  if (!validId(definition.id)) findings.push({ code: "INVALID_GRAPH_ID", message: "Custom graph id does not satisfy the portable identifier grammar." });
  if (!Number.isInteger(definition.entrantCount) || definition.entrantCount < 2 || definition.entrantCount > CUSTOM_GRAPH_SCALE_ENVELOPE.maximumEntrants) {
    findings.push({ code: "GRAPH_ENTRANT_LIMIT", message: "Custom graph entrant count is outside the tested scale envelope." });
  }
  if (definition.nodes.length < 1 || definition.nodes.length > CUSTOM_GRAPH_SCALE_ENVELOPE.maximumNodes) {
    findings.push({ code: "GRAPH_NODE_LIMIT", message: "Custom graph node count is outside the tested scale envelope." });
  }
  const ids = definition.nodes.map(({ id }) => id); const duplicateIds = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))].sort();
  if (duplicateIds.length > 0 || definition.nodes.some(({ id }) => !validId(id))) {
    findings.push({ code: "INVALID_NODE_IDS", message: "Node ids must be unique and portable.", nodeIds: duplicateIds });
  }
  const byId = new Map(definition.nodes.map((node) => [node.id, node]));
  const dependencies = new Map<string, Set<string>>(); const consumers = new Map<string, string[]>(); const seeds: number[] = [];
  let outcomeProvenance = duplicateIds.length === 0; let portsUnique = true;
  for (const node of definition.nodes) {
    dependencies.set(node.id, new Set());
    const expectedInputCount = node.kind === "MATCH" ? 2 : 1;
    const expectedOutputs = node.kind === "MATCH" ? ["WINNER", "LOSER"] : ["WINNER"];
    if (node.inputs.length !== expectedInputCount) findings.push({ code: "INVALID_NODE_ARITY", message: `${node.kind} node ${node.id} has invalid input arity.`, nodeIds: [node.id] });
    if (node.outputs.length !== expectedOutputs.length || expectedOutputs.some((port) => !node.outputs.includes(port as "WINNER" | "LOSER")) ||
      new Set(node.outputs).size !== node.outputs.length) {
      findings.push({ code: "INVALID_OUTPUT_PORTS", message: `${node.kind} node ${node.id} does not declare its exact output ports.`, nodeIds: [node.id] });
      outcomeProvenance = false;
    }
    for (const input of node.inputs) {
      if (input.type === "ENTRANT") {
        seeds.push(input.seed);
        if (!Number.isInteger(input.seed) || input.seed < 1 || input.seed > definition.entrantCount) {
          findings.push({ code: "INVALID_ENTRANT_SEED", message: `Node ${node.id} references an out-of-range entrant seed.`, nodeIds: [node.id] });
        }
        continue;
      }
      const source = byId.get(input.nodeId);
      if (!source) {
        findings.push({ code: "DANGLING_PORT", message: `Node ${node.id} references missing source ${input.nodeId}.`, nodeIds: [input.nodeId, node.id] });
        outcomeProvenance = false; continue;
      }
      if (!source.outputs.includes(input.port)) {
        const code = source.kind === "BYE" && input.port === "LOSER" ? "LOSER_FROM_BYE" : "UNDECLARED_PORT";
        findings.push({ code, message: code === "LOSER_FROM_BYE" ? `Bye node ${source.id} cannot produce a loser.` : `Source ${source.id} does not declare ${input.port}.`,
          nodeIds: [source.id, node.id] });
        outcomeProvenance = false;
      }
      dependencies.get(node.id)!.add(source.id);
      const key = `${source.id}:${input.port}`; const uses = consumers.get(key) ?? []; uses.push(node.id); consumers.set(key, uses);
      if (uses.length > 1) portsUnique = false;
    }
  }
  for (const [port, uses] of consumers) if (uses.length > 1) {
    findings.push({ code: "OUTCOME_FAN_OUT", message: `Outcome ${port} is consumed by multiple nodes and would duplicate one competitor.`, nodeIds: [...uses].sort() });
  }
  const expectedSeeds = Array.from({ length: Math.max(0, definition.entrantCount) }, (_, index) => index + 1);
  const orderedSeeds = [...seeds].sort((left, right) => left - right);
  const entrantCoverage = orderedSeeds.length === expectedSeeds.length && orderedSeeds.every((seed, index) => seed === expectedSeeds[index]);
  if (!entrantCoverage) findings.push({ code: "ENTRANT_COVERAGE", message: "Entrant seeds must cover 1..entrantCount exactly once." });

  const inDegree = new Map(definition.nodes.map(({ id }) => [id, 0])); const downstream = new Map<string, string[]>();
  for (const [nodeId, sourceIds] of dependencies) for (const sourceId of sourceIds) {
    if (!inDegree.has(sourceId)) continue;
    inDegree.set(nodeId, (inDegree.get(nodeId) ?? 0) + 1); const targets = downstream.get(sourceId) ?? []; targets.push(nodeId); downstream.set(sourceId, targets);
  }
  const ready = [...inDegree].filter(([, degree]) => degree === 0).map(([id]) => id).sort(); const orderedIds: string[] = [];
  while (ready.length > 0) {
    const id = ready.shift()!; orderedIds.push(id);
    for (const target of [...(downstream.get(id) ?? [])].sort()) {
      const degree = (inDegree.get(target) ?? 0) - 1; inDegree.set(target, degree);
      if (degree === 0) { ready.push(target); ready.sort(); }
    }
  }
  const acyclic = orderedIds.length === definition.nodes.length;
  if (!acyclic) findings.push({ code: "CYCLIC_GRAPH", message: "Custom graph dependencies must be acyclic.",
    nodeIds: [...inDegree].filter(([, degree]) => degree > 0).map(([id]) => id).sort() });
  const nodes = acyclic ? orderedIds.map((id) => structuredClone(byId.get(id)!)) : [];
  const definitionHash = digest({ schemaVersion: definition.schemaVersion, id: definition.id, entrantCount: definition.entrantCount, nodes });
  const proof = { compilerVersion: "1.0.0" as const, definitionHash, nodeCount: definition.nodes.length, entrantCoverage,
    outcomeProvenance, outcomesConsumedAtMostOnce: portsUnique, acyclic, scaleEnvelope: CUSTOM_GRAPH_SCALE_ENVELOPE };
  const status = findings.length === 0 ? "CERTIFIED" as const : "REJECTED" as const;
  return finalize({ status, schemaVersion: definition.schemaVersion, id: definition.id, nodes: status === "CERTIFIED" ? nodes : [], findings, proof });
}
