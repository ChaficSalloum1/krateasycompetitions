import { createHash } from "node:crypto";
import {
  InMemoryTransactionalOutbox,
  type OutboxPublication,
  type TransactionalOutboxStore,
} from "./outbox.js";

export type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue };
export interface ProposedEvent { readonly type: string; readonly payload: JsonValue; readonly metadata?: { readonly [key: string]: JsonValue }; }
export interface AppendRequest {
  readonly streamId: string; readonly expectedVersion: number; readonly commandId: string; readonly recordedAt: string;
  readonly events: readonly ProposedEvent[];
}
export interface EventEnvelope {
  readonly eventId: string; readonly streamId: string; readonly streamVersion: number; readonly globalPosition: number;
  readonly commandId: string; readonly recordedAt: string; readonly type: string; readonly payload: JsonValue;
  readonly metadata: { readonly [key: string]: JsonValue }; readonly previousHash: string | null; readonly eventHash: string;
}
export interface AppendResult {
  readonly status: "APPENDED" | "IDEMPOTENT_REPLAY"; readonly currentVersion: number; readonly events: readonly EventEnvelope[];
}
export interface Snapshot<T extends JsonValue = JsonValue> {
  readonly streamId: string; readonly streamVersion: number; readonly streamHash: string; readonly state: T; readonly snapshotHash: string;
}
export interface EventChainFinding { readonly code: "HASH_MISMATCH" | "BROKEN_CHAIN" | "VERSION_GAP"; readonly eventId: string; readonly message: string; }
export interface EventChainProof { readonly valid: boolean; readonly streamId: string | null; readonly eventCount: number; readonly headHash: string | null; readonly findings: readonly EventChainFinding[]; }
export interface EventStoreAdapter {
  append(request: AppendRequest): Promise<AppendResult>;
  appendTransaction(requests: readonly AppendRequest[]): Promise<readonly AppendResult[]>;
  readStream(streamId: string, fromVersion?: number): Promise<readonly EventEnvelope[]>;
  replay<T>(streamId: string, initialState: T, reducer: (state: T, event: Readonly<EventEnvelope>) => T): Promise<T>;
  saveSnapshot<T extends JsonValue>(snapshot: Omit<Snapshot<T>, "streamHash" | "snapshotHash">): Promise<Snapshot<T>>;
  loadSnapshot<T extends JsonValue>(streamId: string): Promise<Snapshot<T> | undefined>;
}
export interface TransactionalOutboxEventStore extends EventStoreAdapter {
  readonly outbox: TransactionalOutboxStore;
}

export class OptimisticConcurrencyError extends Error {
  constructor(readonly streamId: string, readonly expectedVersion: number, readonly actualVersion: number) {
    super(`Stale stream version for ${streamId}: expected ${expectedVersion}, actual ${actualVersion}`);
    this.name = "OptimisticConcurrencyError";
  }
}
export class IdempotencyConflictError extends Error {
  constructor(readonly streamId: string, readonly commandId: string) {
    super(`Idempotency key ${commandId} was reused with different content in ${streamId}`);
    this.name = "IdempotencyConflictError";
  }
}

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
function assertJson(value: unknown, path: string): void {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (Array.isArray(value)) { value.forEach((entry, index) => assertJson(entry, `${path}/${index}`)); return; }
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    for (const [key, entry] of Object.entries(value)) assertJson(entry, `${path}/${key}`);
    return;
  }
  throw new Error(`Non-JSON value at ${path}`);
}
function validateRequest(request: AppendRequest): void {
  if (!request.streamId.trim() || !request.commandId.trim() || !Number.isInteger(request.expectedVersion) || request.expectedVersion < 0
    || !Number.isFinite(Date.parse(request.recordedAt)) || request.events.length === 0) throw new Error("Invalid append request");
  if (request.events.some((event) => !event.type.trim())) throw new Error("Event type is required");
  request.events.forEach((event, index) => {
    assertJson(event.payload, `/events/${index}/payload`);
    assertJson(event.metadata ?? {}, `/events/${index}/metadata`);
  });
}

export function createInMemoryEventStore(): EventStoreAdapter {
  let streams = new Map<string, readonly EventEnvelope[]>();
  let globalPosition = 0;
  const snapshots = new Map<string, Snapshot>();
  let commands = new Map<string, { fingerprint: string; result: AppendResult }>();

  const appendCore = (request: AppendRequest): AppendResult => {
    validateRequest(request);
    const commandKey = `${request.streamId}\u0000${request.commandId}`;
    const fingerprint = hash(request);
    const priorCommand = commands.get(commandKey);
    if (priorCommand) {
      if (priorCommand.fingerprint !== fingerprint) throw new IdempotencyConflictError(request.streamId, request.commandId);
      return freeze({ ...priorCommand.result, status: "IDEMPOTENT_REPLAY" });
    }
    const current = streams.get(request.streamId) ?? [];
    if (current.length !== request.expectedVersion) throw new OptimisticConcurrencyError(request.streamId, request.expectedVersion, current.length);
    let priorHash = current.at(-1)?.eventHash ?? null;
    const envelopes: EventEnvelope[] = [];
    for (const proposed of request.events) {
      globalPosition += 1;
      const base = {
        streamId: request.streamId, streamVersion: current.length + envelopes.length + 1, globalPosition,
        commandId: request.commandId, recordedAt: request.recordedAt, type: proposed.type,
        payload: structuredClone(proposed.payload), metadata: structuredClone(proposed.metadata ?? {}), previousHash: priorHash,
      };
      const eventId = `evt_${hash(base).slice(0, 24)}`;
      const envelope: EventEnvelope = { ...base, eventId, eventHash: hash({ ...base, eventId }) };
      envelopes.push(freeze(envelope)); priorHash = envelope.eventHash;
    }
    streams = new Map(streams).set(request.streamId, freeze([...current, ...envelopes]));
    const result: AppendResult = freeze({ status: "APPENDED", currentVersion: current.length + envelopes.length, events: envelopes });
    commands.set(commandKey, { fingerprint, result });
    return result;
  };

  return {
    append: async (request) => appendCore(request),
    appendTransaction: async (requests) => {
      const priorStreams = streams; const priorCommands = commands; const priorGlobalPosition = globalPosition;
      streams = new Map(streams); commands = new Map(commands);
      try {
        return freeze(requests.map(appendCore));
      } catch (error) {
        streams = priorStreams; commands = priorCommands; globalPosition = priorGlobalPosition;
        throw error;
      }
    },
    readStream: async (streamId, fromVersion = 1) => freeze([...(streams.get(streamId) ?? [])].filter(({ streamVersion }) => streamVersion >= fromVersion)),
    replay: async (streamId, initialState, reducer) => {
      const events = streams.get(streamId) ?? [];
      if (!verifyEventChain(events).valid) throw new Error(`Cannot replay invalid event chain ${streamId}`);
      return events.reduce(reducer, initialState);
    },
    saveSnapshot: async (snapshot) => {
      const events = streams.get(snapshot.streamId) ?? [];
      if (!Number.isInteger(snapshot.streamVersion) || snapshot.streamVersion < 1 || snapshot.streamVersion > events.length) {
        throw new Error("Snapshot version must reference an existing stream event");
      }
      assertJson(snapshot.state, "/snapshot/state");
      const streamHash = events[snapshot.streamVersion - 1]!.eventHash;
      const saved = freeze({ ...structuredClone(snapshot), streamHash, snapshotHash: hash({ ...snapshot, streamHash }) });
      snapshots.set(snapshot.streamId, saved); return saved;
    },
    loadSnapshot: async <T extends JsonValue>(streamId: string) => snapshots.get(streamId) as Snapshot<T> | undefined,
  };
}

function outboxPublication(metadata: ProposedEvent["metadata"]): OutboxPublication | undefined {
  const candidate = metadata?.outbox;
  if (candidate === undefined) return undefined;
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) throw new Error("Outbox intent must be an object");
  const record = candidate as { readonly [key: string]: JsonValue };
  if (typeof record.topic !== "string" || !record.topic.trim() || typeof record.key !== "string" || !record.key.trim()) {
    throw new Error("Outbox intent requires a topic and publication key");
  }
  return { topic: record.topic, key: record.key, ...(record.payload === undefined ? {} : { payload: structuredClone(record.payload) }) };
}

/** Reference store whose event append and deterministic outbox enqueue share one public operation. */
export function createInMemoryTransactionalOutboxEventStore(): TransactionalOutboxEventStore {
  const events = createInMemoryEventStore();
  const outbox = new InMemoryTransactionalOutbox();
  const enqueue = (results: readonly AppendResult[]): void => {
    for (const result of results) for (const event of result.events) {
      const publication = outboxPublication(event.metadata);
      if (!publication) continue;
      outbox.enqueueFromCommittedEvent({ id: event.eventId, streamId: event.streamId, streamVersion: event.streamVersion,
        type: event.type, occurredAt: event.recordedAt, committedAt: event.recordedAt, payload: event.payload }, publication);
    }
  };
  return {
    outbox,
    append: async (request) => {
      request.events.forEach(({ metadata }) => { outboxPublication(metadata); });
      const result = await events.append(request); enqueue([result]); return result;
    },
    appendTransaction: async (requests) => {
      requests.flatMap(({ events }) => events).forEach(({ metadata }) => { outboxPublication(metadata); });
      const results = await events.appendTransaction(requests); enqueue(results); return results;
    },
    readStream: events.readStream,
    replay: events.replay,
    saveSnapshot: events.saveSnapshot,
    loadSnapshot: events.loadSnapshot,
  };
}

export function verifyEventChain(events: readonly EventEnvelope[]): EventChainProof {
  const findings: EventChainFinding[] = [];
  const streamId = events[0]?.streamId ?? null;
  events.forEach((event, index) => {
    const { eventHash, ...withoutHash } = event;
    if (hash(withoutHash) !== eventHash) findings.push({ code: "HASH_MISMATCH", eventId: event.eventId, message: "Envelope content does not match its canonical hash." });
    const expectedPrevious = index === 0 ? null : events[index - 1]!.eventHash;
    if (event.previousHash !== expectedPrevious || event.streamId !== streamId) findings.push({ code: "BROKEN_CHAIN", eventId: event.eventId, message: "Previous hash or stream identity breaks the chain." });
    if (event.streamVersion !== index + 1) findings.push({ code: "VERSION_GAP", eventId: event.eventId, message: "Aggregate versions must be contiguous from one." });
  });
  return freeze({ valid: findings.length === 0, streamId, eventCount: events.length,
    headHash: events.at(-1)?.eventHash ?? null, findings });
}
