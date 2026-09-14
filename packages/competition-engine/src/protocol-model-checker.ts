import { canonicalHash, deepFreeze } from "@tournament-os/tournament-schema";

export interface ProtocolInvariant<State> {
  readonly id: string;
  readonly evaluate: (state: Readonly<State>) => boolean;
}

export interface ProtocolModel<State, Action> {
  readonly modelId: string;
  readonly initialState: State;
  readonly actions: readonly Action[];
  readonly stateKey: (state: Readonly<State>) => string;
  readonly actionKey: (action: Action) => string;
  /** Null means the action is disabled in this state. */
  readonly transition: (state: Readonly<State>, action: Action) => State | null;
  readonly invariants: readonly ProtocolInvariant<State>[];
}

export interface ProtocolViolation<State = unknown> {
  readonly invariantId: string;
  readonly depth: number;
  readonly actionTrace: readonly string[];
  readonly state: Readonly<State>;
}

export interface ProtocolModelCheckResult<State = unknown> {
  readonly modelId: string;
  readonly status: "VERIFIED" | "VIOLATED";
  readonly maxDepth: number;
  readonly exploredStateCount: number;
  readonly exploredTransitionCount: number;
  readonly violations: readonly ProtocolViolation<State>[];
  readonly proofHash: string;
}

export interface CriticalProtocolReport {
  readonly schemaVersion: "1.0.0";
  readonly status: "VERIFIED" | "VIOLATED";
  readonly models: readonly ProtocolModelCheckResult[];
  readonly proofHash: string;
}

export function boundedModelCheck<State, Action>(model: ProtocolModel<State, Action>,
  options: { readonly maxDepth: number }): Readonly<ProtocolModelCheckResult<State>> {
  if (!model.modelId.trim() || !Number.isInteger(options.maxDepth) || options.maxDepth < 0
    || !model.actions.length || !model.invariants.length || new Set(model.invariants.map(({ id }) => id)).size !== model.invariants.length) {
    throw new Error("A bounded protocol model requires identity, actions, unique invariants and a non-negative depth");
  }
  const actions = [...model.actions].sort((left, right) => model.actionKey(left).localeCompare(model.actionKey(right)));
  const initial = structuredClone(model.initialState);
  const queue: { state: State; trace: string[]; depth: number }[] = [{ state: initial, trace: [], depth: 0 }];
  const visited = new Set([model.stateKey(initial)]);
  const violations = new Map<string, ProtocolViolation<State>>();
  let exploredTransitionCount = 0;
  const inspect = (state: State, trace: readonly string[], depth: number): void => {
    for (const invariant of model.invariants) if (!invariant.evaluate(state) && !violations.has(invariant.id)) {
      violations.set(invariant.id, { invariantId: invariant.id, depth, actionTrace: [...trace], state: structuredClone(state) });
    }
  };
  inspect(initial, [], 0);
  while (queue.length) {
    const current = queue.shift()!;
    if (current.depth >= options.maxDepth) continue;
    for (const action of actions) {
      const next = model.transition(current.state, action);
      if (next === null) continue;
      exploredTransitionCount += 1;
      const trace = [...current.trace, model.actionKey(action)];
      inspect(next, trace, current.depth + 1);
      const key = model.stateKey(next);
      if (visited.has(key)) continue;
      visited.add(key);
      queue.push({ state: structuredClone(next), trace, depth: current.depth + 1 });
    }
  }
  const orderedViolations = [...violations.values()].sort((left, right) => left.depth - right.depth
    || left.invariantId.localeCompare(right.invariantId) || left.actionTrace.join("|").localeCompare(right.actionTrace.join("|")));
  const body = { modelId: model.modelId, status: orderedViolations.length ? "VIOLATED" as const : "VERIFIED" as const,
    maxDepth: options.maxDepth, exploredStateCount: visited.size, exploredTransitionCount, violations: orderedViolations };
  return deepFreeze({ ...body, proofHash: canonicalHash(body) });
}

interface PublicationState {
  currentRevision: 1 | 2;
  approvedRevision: 0 | 1 | 2;
  certificateRevision: 0 | 1 | 2;
  publishedRevision: 0 | 1 | 2;
}

function publicationModel(): ProtocolModel<PublicationState, "APPROVE" | "CERTIFY" | "EDIT" | "PUBLISH"> {
  return {
    modelId: "publication",
    initialState: { currentRevision: 1, approvedRevision: 0, certificateRevision: 0, publishedRevision: 0 },
    actions: ["EDIT", "APPROVE", "CERTIFY", "PUBLISH"],
    stateKey: (state) => canonicalHash(state),
    actionKey: (action) => action,
    transition: (state, action) => {
      if (action === "EDIT") return state.publishedRevision === 0 && state.currentRevision === 1
        ? { currentRevision: 2, approvedRevision: 0, certificateRevision: 0, publishedRevision: 0 } : null;
      if (action === "APPROVE") return state.publishedRevision === 0
        ? { ...state, approvedRevision: state.currentRevision, certificateRevision: 0 } : null;
      if (action === "CERTIFY") return state.publishedRevision === 0 && state.approvedRevision === state.currentRevision
        ? { ...state, certificateRevision: state.currentRevision } : null;
      return state.publishedRevision === 0 && state.approvedRevision === state.currentRevision
        && state.certificateRevision === state.currentRevision ? { ...state, publishedRevision: state.currentRevision } : null;
    },
    invariants: [
      { id: "PUBLISHED_REVISION_IS_CURRENT", evaluate: (state) => state.publishedRevision === 0 || state.publishedRevision === state.currentRevision },
      { id: "PUBLISHED_REVISION_IS_APPROVED", evaluate: (state) => state.publishedRevision === 0 || state.publishedRevision === state.approvedRevision },
      { id: "PUBLISHED_REVISION_IS_CERTIFIED", evaluate: (state) => state.publishedRevision === 0 || state.publishedRevision === state.certificateRevision },
    ],
  };
}

interface IdempotencyState {
  fingerprints: Record<"command.1" | "command.2", "NONE" | "A" | "B">;
  effects: Record<"command.1" | "command.2", 0 | 1>;
  conflicts: Record<"command.1" | "command.2", boolean>;
}
interface SubmitAction { kind: "SUBMIT"; key: "command.1" | "command.2"; fingerprint: "A" | "B" }

function idempotencyModel(): ProtocolModel<IdempotencyState, SubmitAction> {
  const actions: SubmitAction[] = ["command.1", "command.2"].flatMap((key) => ["A", "B"].map((fingerprint) =>
    ({ kind: "SUBMIT" as const, key: key as SubmitAction["key"], fingerprint: fingerprint as SubmitAction["fingerprint"] })));
  return {
    modelId: "idempotent-command",
    initialState: { fingerprints: { "command.1": "NONE", "command.2": "NONE" }, effects: { "command.1": 0, "command.2": 0 },
      conflicts: { "command.1": false, "command.2": false } },
    actions,
    stateKey: (state) => canonicalHash(state),
    actionKey: ({ key, fingerprint }) => `${key}:${fingerprint}`,
    transition: (state, action) => {
      const prior = state.fingerprints[action.key];
      if (prior === "NONE") return { fingerprints: { ...state.fingerprints, [action.key]: action.fingerprint },
        effects: { ...state.effects, [action.key]: 1 }, conflicts: { ...state.conflicts } };
      if (prior === action.fingerprint) return structuredClone(state);
      return { fingerprints: { ...state.fingerprints }, effects: { ...state.effects },
        conflicts: { ...state.conflicts, [action.key]: true } };
    },
    invariants: [
      { id: "COMMAND_EFFECT_AT_MOST_ONCE", evaluate: (state) => Object.values(state.effects).every((count) => count <= 1) },
      { id: "EFFECT_REQUIRES_FINGERPRINT", evaluate: (state) => (Object.keys(state.effects) as SubmitAction["key"][])
        .every((key) => state.effects[key] === 0 || state.fingerprints[key] !== "NONE") },
    ],
  };
}

interface LiveChangeState {
  liveVersion: 0 | 1 | 2;
  proposal: "NONE" | "READY" | "APPROVED" | "REJECTED";
  baseVersion: 0 | 1;
  proposer: "operator";
  approver: "NONE" | "operator" | "director";
  appliedCount: 0 | 1;
  appliedFromVersion: 0 | 1;
}

function liveChangeModel(): ProtocolModel<LiveChangeState, "APPROVE_DIRECTOR" | "APPROVE_SELF" | "MUTATE" | "PROPOSE" | "REJECT"> {
  return {
    modelId: "live-change-approval",
    initialState: { liveVersion: 0, proposal: "NONE", baseVersion: 0, proposer: "operator", approver: "NONE", appliedCount: 0, appliedFromVersion: 0 },
    actions: ["PROPOSE", "MUTATE", "APPROVE_SELF", "APPROVE_DIRECTOR", "REJECT"],
    stateKey: (state) => canonicalHash(state),
    actionKey: (action) => action,
    transition: (state, action) => {
      if (action === "PROPOSE") return state.proposal === "NONE" && state.liveVersion < 2
        ? { ...state, proposal: "READY", baseVersion: state.liveVersion as 0 | 1 } : null;
      if (action === "MUTATE") return state.liveVersion < 2 ? { ...state, liveVersion: (state.liveVersion + 1) as 1 | 2 } : null;
      if (action === "REJECT") return state.proposal === "READY" ? { ...state, proposal: "REJECTED", approver: "director" } : null;
      if (action === "APPROVE_SELF") return null;
      return state.proposal === "READY" && state.baseVersion === state.liveVersion
        ? { ...state, proposal: "APPROVED", approver: "director", appliedCount: 1,
          appliedFromVersion: state.liveVersion as 0 | 1, liveVersion: (state.liveVersion + 1) as 1 | 2 } : null;
    },
    invariants: [
      { id: "APPROVAL_REQUIRES_DISTINCT_ACTOR", evaluate: (state) => state.proposal !== "APPROVED" || state.approver !== state.proposer },
      { id: "APPROVAL_APPLIES_EXACTLY_ONCE", evaluate: (state) => state.proposal !== "APPROVED" || state.appliedCount === 1 },
      { id: "APPROVAL_USES_CURRENT_BASE", evaluate: (state) => state.proposal !== "APPROVED" || state.appliedFromVersion === state.baseVersion },
    ],
  };
}

export function modelCheckCriticalProtocols(): Readonly<CriticalProtocolReport> {
  const models: ProtocolModelCheckResult[] = [
    boundedModelCheck(idempotencyModel(), { maxDepth: 6 }),
    boundedModelCheck(liveChangeModel(), { maxDepth: 6 }),
    boundedModelCheck(publicationModel(), { maxDepth: 6 }),
  ];
  const body = { schemaVersion: "1.0.0" as const,
    status: models.every(({ status }) => status === "VERIFIED") ? "VERIFIED" as const : "VIOLATED" as const, models };
  return deepFreeze({ ...body, proofHash: canonicalHash(body) });
}
