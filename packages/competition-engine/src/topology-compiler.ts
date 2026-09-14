import { createHash } from "node:crypto";

export type TopologyPort = "WINNER" | "LOSER";
export type TopologySlot =
  | { readonly type: "ENTRANT"; readonly seed: number }
  | { readonly type: "PORT"; readonly nodeId: string; readonly port: TopologyPort };

export type TopologyNode =
  | { readonly id: string; readonly kind: "MATCH"; readonly phase: "PLAY_IN" | "MAIN" | "CLASSIFICATION"; readonly round: number;
      readonly label?: string; readonly inputs: readonly [TopologySlot, TopologySlot];
      readonly outputs: readonly [{ readonly port: "WINNER" }, { readonly port: "LOSER" }] }
  | { readonly id: string; readonly kind: "BYE"; readonly phase: "PLAY_IN"; readonly round: 1;
      readonly inputs: readonly [Extract<TopologySlot, { type: "ENTRANT" }>]; readonly outputs: readonly [{ readonly port: "WINNER" }] };

export interface PortReference { readonly nodeId: string; readonly port: TopologyPort; }
export interface ClassificationMatchSpec { readonly id: string; readonly label: string; readonly sources: readonly [PortReference, PortReference]; }
export interface TopologyRequest {
  readonly id: string;
  readonly entrantCount: number;
  readonly thirdPlaceMatch?: boolean;
  readonly classificationMatches?: readonly ClassificationMatchSpec[];
}
export interface TopologyProof {
  readonly valid: boolean; readonly entrantCount: number; readonly bracketSize: number; readonly playInMatchCount: number;
  readonly byeCount: number; readonly classificationMatchCount: number; readonly expectedCompetitiveMatchCount: number;
  readonly generatedCompetitiveMatchCount: number; readonly entrantSeedsPlacedExactlyOnce: boolean;
  readonly allInputPortsResolved: boolean; readonly acyclic: boolean; readonly proofHash: string;
}
export interface CompiledTopology { readonly id: string; readonly nodes: readonly TopologyNode[]; readonly champion: PortReference; readonly proof: TopologyProof; }

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(",")}}`;
  return JSON.stringify(value);
}
function hash(value: unknown): string { return createHash("sha256").update(canonical(value)).digest("hex"); }
function freeze<T>(value: T): Readonly<T> {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
function seedOrder(size: number): number[] {
  let order = [1, 2];
  while (order.length < size) {
    const nextSize = order.length * 2;
    order = order.flatMap((seed) => [seed, nextSize + 1 - seed]);
  }
  return order;
}

export function compileTopology(request: TopologyRequest): CompiledTopology {
  if (!request.id.trim()) throw new Error("Topology id is required");
  if (!Number.isInteger(request.entrantCount) || request.entrantCount < 2 || request.entrantCount > 64) {
    throw new Error("Entrant count must be an integer from 2 to 64");
  }
  const bracketSize = 2 ** Math.ceil(Math.log2(request.entrantCount));
  const positions = seedOrder(bracketSize).map((seed): TopologySlot | undefined => seed <= request.entrantCount ? { type: "ENTRANT", seed } : undefined);
  const nodes: TopologyNode[] = [];
  let previous: TopologyNode[] = [];
  for (let index = 0; index < positions.length; index += 2) {
    const left = positions[index]; const right = positions[index + 1]; const id = `${request.id}.R1.M${index / 2 + 1}`;
    if (left && right) previous.push({ id, kind: "MATCH", phase: bracketSize === request.entrantCount ? "MAIN" : "PLAY_IN", round: 1,
      inputs: [left, right], outputs: [{ port: "WINNER" }, { port: "LOSER" }] });
    else {
      const entrant = left ?? right;
      if (!entrant || entrant.type !== "ENTRANT") throw new Error("Internal topology error: a bye must advance exactly one entrant");
      previous.push({ id, kind: "BYE", phase: "PLAY_IN", round: 1, inputs: [entrant], outputs: [{ port: "WINNER" }] });
    }
  }
  nodes.push(...previous);
  let round = 2;
  while (previous.length > 1) {
    const current: TopologyNode[] = [];
    for (let index = 0; index < previous.length; index += 2) {
      const left = previous[index]!; const right = previous[index + 1]!;
      current.push({ id: `${request.id}.R${round}.M${index / 2 + 1}`, kind: "MATCH", phase: "MAIN", round,
        inputs: [{ type: "PORT", nodeId: left.id, port: "WINNER" }, { type: "PORT", nodeId: right.id, port: "WINNER" }],
        outputs: [{ port: "WINNER" }, { port: "LOSER" }] });
    }
    nodes.push(...current); previous = current; round += 1;
  }
  const final = previous[0]!;
  const requirePort = (reference: PortReference): Extract<TopologySlot, { type: "PORT" }> => {
    const source = nodes.find(({ id }) => id === reference.nodeId);
    if (!source) throw new Error(`Unresolved ${reference.port} port from unknown node ${reference.nodeId}`);
    if (!source.outputs.some(({ port }) => port === reference.port)) {
      if (source.kind === "BYE" && reference.port === "LOSER") throw new Error(`Undefined LOSER port from bye node ${source.id}`);
      throw new Error(`Undefined ${reference.port} port from node ${source.id}`);
    }
    return { type: "PORT", nodeId: reference.nodeId, port: reference.port };
  };
  const addClassification = (id: string, label: string, sources: readonly [PortReference, PortReference]): void => {
    if (nodes.some((node) => node.id === id)) throw new Error(`Duplicate topology node id ${id}`);
    nodes.push({ id, kind: "MATCH", phase: "CLASSIFICATION", round, label,
      inputs: [requirePort(sources[0]), requirePort(sources[1])], outputs: [{ port: "WINNER" }, { port: "LOSER" }] });
  };
  if (request.thirdPlaceMatch) {
    if (final.kind !== "MATCH" || final.inputs.some((slot) => slot.type !== "PORT")) {
      throw new Error("Third-place match requires two semifinal loser ports");
    }
    const sources = final.inputs.map((slot) => ({ nodeId: (slot as Extract<TopologySlot, { type: "PORT" }>).nodeId, port: "LOSER" as const }));
    addClassification(`${request.id}.third-place`, "Third place", sources as unknown as [PortReference, PortReference]);
  }
  for (const spec of request.classificationMatches ?? []) {
    if (!spec.id.trim() || !spec.label.trim()) throw new Error("Classification match id and label are required");
    addClassification(`${request.id}.C.${spec.id}`, spec.label, spec.sources);
  }
  const matches = nodes.filter((node) => node.kind === "MATCH").length;
  const byes = nodes.filter((node) => node.kind === "BYE").length;
  const classifications = nodes.filter((node) => node.phase === "CLASSIFICATION").length;
  const seeds: number[] = [];
  for (const node of nodes) for (const slot of node.inputs) if (slot.type === "ENTRANT") seeds.push(slot.seed);
  const proofBase = {
    valid: matches === request.entrantCount - 1 + classifications && new Set(seeds).size === request.entrantCount,
    entrantCount: request.entrantCount, bracketSize,
    playInMatchCount: nodes.filter((node) => node.kind === "MATCH" && node.phase === "PLAY_IN").length,
    byeCount: byes, classificationMatchCount: classifications,
    expectedCompetitiveMatchCount: request.entrantCount - 1 + classifications,
    generatedCompetitiveMatchCount: matches, entrantSeedsPlacedExactlyOnce: new Set(seeds).size === request.entrantCount && seeds.length === request.entrantCount,
    allInputPortsResolved: true, acyclic: true,
  };
  const proof = { ...proofBase, proofHash: hash({ request, nodes, proof: proofBase }) };
  return freeze({ id: request.id, nodes, champion: { nodeId: final.id, port: "WINNER" }, proof });
}
