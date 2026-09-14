import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  defineDynamicStage,
  replayDynamicStage,
  transitionDynamicStage,
  verifyDynamicStage,
  type DynamicStageCommand,
  type DynamicStageDefinition,
  type DynamicStageState,
  type LifecycleEvent,
  type LifecycleFinding,
} from "./dynamic-stage-lifecycle.js";

export interface PersistedDynamicStageStream {
  readonly stageId: string; readonly definition: DynamicStageDefinition; readonly definitionHash: string; readonly events: readonly LifecycleEvent[];
}
export interface DynamicStageSnapshot {
  readonly stageId: string; readonly version: number; readonly stateHash: string; readonly state: DynamicStageState; readonly snapshotHash: string;
}
export interface DynamicStagePersistenceCapabilities {
  readonly durability: "PROCESS_MEMORY" | "SINGLE_PROCESS_FILESYSTEM" | "TRANSACTIONAL_SQLITE";
  readonly multiProcessAtomicity: boolean; readonly externalDatabase: false;
  readonly journalMode?: "WAL"; readonly encryption?: "NOT_PROVIDED"; readonly fsyncGuarantee?: "NOT_CLAIMED";
}
export interface PortCreateResult { readonly status: "CREATED" | "IDEMPOTENT_REPLAY" | "DEFINITION_CONFLICT"; readonly definitionHash: string; }
export interface PortAppendResult {
  readonly status: "APPENDED" | "IDEMPOTENT_REPLAY" | "VERSION_CONFLICT" | "IDEMPOTENCY_CONFLICT" | "REJECTED";
  readonly currentVersion: number; readonly finding?: LifecycleFinding;
}
export interface DynamicStagePersistencePort {
  readonly capabilities: DynamicStagePersistenceCapabilities;
  create(definition: DynamicStageDefinition): Promise<PortCreateResult>;
  load(stageId: string): Promise<PersistedDynamicStageStream | undefined>;
  append(stageId: string, expectedVersion: number, event: LifecycleEvent): Promise<PortAppendResult>;
  saveSnapshot(stageId: string, state: DynamicStageState): Promise<DynamicStageSnapshot>;
  loadSnapshot(stageId: string): Promise<DynamicStageSnapshot | undefined>;
}
export interface SQLiteDynamicStagePersistencePort extends DynamicStagePersistencePort { close(): void; }
export interface PersistedStreamProof {
  readonly valid: boolean; readonly eventCount: number; readonly headHash: string | null; readonly streamHash: string; readonly findings: readonly LifecycleFinding[];
}
export interface DurableCreateResult { readonly status: PortCreateResult["status"]; readonly definitionHash: string; }
export interface DurableLoadResult {
  readonly status: "LOADED" | "NOT_FOUND" | "REJECTED"; readonly state: DynamicStageState | null;
  readonly snapshotStatus: "ABSENT" | "HIT_VALID" | "DISCARDED_STALE" | "DISCARDED_INVALID";
  readonly findings: readonly LifecycleFinding[]; readonly proof: { readonly streamValid: boolean; readonly streamHash: string } | null;
}
export interface DurableExecutionResult {
  readonly status: "APPLIED" | "REPLAYED" | "REJECTED" | "NOT_FOUND" | "VERSION_CONFLICT" | "IDEMPOTENCY_CONFLICT";
  readonly state: DynamicStageState | null; readonly findings: readonly LifecycleFinding[]; readonly persistenceHash: string | null;
}
export interface DynamicStageRepository {
  readonly capabilities: DynamicStagePersistenceCapabilities;
  create(definition: DynamicStageDefinition): Promise<DurableCreateResult>;
  load(stageId: string): Promise<DurableLoadResult>;
  execute(stageId: string, command: DynamicStageCommand): Promise<DurableExecutionResult>;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(",")}}`;
  return JSON.stringify(value) ?? "undefined";
}
function hash(value: unknown): string { return createHash("sha256").update(canonical(value)).digest("hex"); }
function freeze<T>(value: T): Readonly<T> {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
function streamHash(stream: PersistedDynamicStageStream): string {
  return hash({ stageId: stream.stageId, definitionHash: stream.definitionHash, eventCount: stream.events.length,
    headHash: stream.events.at(-1)?.eventHash ?? null });
}
function snapshotContent(snapshot: Omit<DynamicStageSnapshot, "snapshotHash">): string { return hash(snapshot); }

export function verifyPersistedDynamicStageStream(stream: PersistedDynamicStageStream): PersistedStreamProof {
  const findings: LifecycleFinding[] = [];
  if (stream.stageId !== stream.definition.id || stream.definitionHash !== hash(stream.definition)) {
    findings.push({ code: "DEFINITION_HASH_MISMATCH", message: "Persisted definition identity or hash is invalid." });
  }
  const replay = replayDynamicStage(stream.definition, stream.events);
  if (replay.status !== "REPLAYED") findings.push({ code: "LIFECYCLE_REPLAY_REJECTED", message: "Lifecycle events could not be deterministically replayed.",
    causes: replay.findings.map(({ code }) => code) });
  if (replay.status === "REPLAYED" && replay.state.events.length !== stream.events.length) {
    findings.push({ code: "EVENT_CHAIN_INVALID", message: "Replayed lifecycle event count differs from persisted history." });
  }
  return freeze({ valid: findings.length === 0, eventCount: stream.events.length, headHash: stream.events.at(-1)?.eventHash ?? null,
    streamHash: streamHash(stream), findings });
}

function createMemoryPort(capabilities: DynamicStagePersistenceCapabilities): DynamicStagePersistencePort {
  const streams = new Map<string, PersistedDynamicStageStream>();
  const snapshots = new Map<string, DynamicStageSnapshot>();
  const create = async (definition: DynamicStageDefinition): Promise<PortCreateResult> => {
    const definitionHash = hash(definition); const existing = streams.get(definition.id);
    if (existing) return freeze({ status: existing.definitionHash === definitionHash ? "IDEMPOTENT_REPLAY" : "DEFINITION_CONFLICT", definitionHash: existing.definitionHash });
    streams.set(definition.id, freeze({ stageId: definition.id, definition: structuredClone(definition), definitionHash, events: [] }));
    return freeze({ status: "CREATED", definitionHash });
  };
  const append = async (stageId: string, expectedVersion: number, event: LifecycleEvent): Promise<PortAppendResult> => {
    const stream = streams.get(stageId);
    if (!stream) return freeze({ status: "REJECTED", currentVersion: 0, finding: { code: "STAGE_NOT_FOUND", message: "Dynamic stage stream does not exist." } });
    const prior = stream.events.find(({ idempotencyKey }) => idempotencyKey === event.idempotencyKey);
    if (prior) return freeze({ status: prior.commandHash === event.commandHash ? "IDEMPOTENT_REPLAY" : "IDEMPOTENCY_CONFLICT", currentVersion: stream.events.length });
    if (stream.events.length !== expectedVersion) return freeze({ status: "VERSION_CONFLICT", currentVersion: stream.events.length });
    const candidate = freeze({ ...stream, events: [...stream.events, structuredClone(event)] });
    const proof = verifyPersistedDynamicStageStream(candidate);
    if (!proof.valid) return freeze({ status: "REJECTED", currentVersion: stream.events.length,
      finding: { code: "INVALID_EVENT_APPEND", message: "Candidate append failed lifecycle replay verification.", causes: proof.findings.map(({ code }) => code) } });
    streams.set(stageId, candidate);
    return freeze({ status: "APPENDED", currentVersion: candidate.events.length });
  };
  return {
    capabilities,
    create,
    load: async (stageId) => streams.get(stageId),
    append,
    saveSnapshot: async (stageId, state) => {
      const base = { stageId, version: state.version, stateHash: state.stateHash, state: structuredClone(state) };
      const snapshot = freeze({ ...base, snapshotHash: snapshotContent(base) }); snapshots.set(stageId, snapshot); return snapshot;
    },
    loadSnapshot: async (stageId) => snapshots.get(stageId),
  };
}

export function createInMemoryDynamicStagePort(): DynamicStagePersistencePort {
  return createMemoryPort({ durability: "PROCESS_MEMORY", multiProcessAtomicity: false, externalDatabase: false });
}

interface FileData { readonly stream?: PersistedDynamicStageStream; readonly snapshot?: DynamicStageSnapshot; }
function isMissing(error: unknown): boolean { return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT"); }

export function createFileDynamicStagePort(directory: string): DynamicStagePersistencePort {
  if (!directory.trim()) throw new Error("Filesystem persistence directory is required");
  const capabilities = freeze({ durability: "SINGLE_PROCESS_FILESYSTEM" as const, multiProcessAtomicity: false as const, externalDatabase: false as const });
  let queue: Promise<void> = Promise.resolve(); let temporarySequence = 0;
  const runExclusive = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = queue.then(operation, operation); queue = result.then(() => undefined, () => undefined); return result;
  };
  const key = (stageId: string) => hash(stageId);
  const pathFor = (stageId: string, suffix: "stream" | "snapshot") => join(directory, `${key(stageId)}.${suffix}.json`);
  const read = async <T>(path: string): Promise<T | undefined> => {
    try { return freeze(JSON.parse(await readFile(path, "utf8")) as T); } catch (error) { if (isMissing(error)) return undefined; throw error; }
  };
  const atomicWrite = async (path: string, value: unknown): Promise<void> => {
    await mkdir(directory, { recursive: true }); temporarySequence += 1;
    const temporary = `${path}.tmp-${process.pid}-${temporarySequence}`;
    await writeFile(temporary, JSON.stringify(value), { encoding: "utf8", mode: 0o600 }); await rename(temporary, path);
  };
  const loadStream = (stageId: string) => read<PersistedDynamicStageStream>(pathFor(stageId, "stream"));
  return {
    capabilities,
    create: (definition) => runExclusive(async () => {
      const definitionHash = hash(definition); const existing = await loadStream(definition.id);
      if (existing) return freeze({ status: existing.definitionHash === definitionHash ? "IDEMPOTENT_REPLAY" as const : "DEFINITION_CONFLICT" as const,
        definitionHash: existing.definitionHash });
      await atomicWrite(pathFor(definition.id, "stream"), { stageId: definition.id, definition: structuredClone(definition), definitionHash, events: [] });
      return freeze({ status: "CREATED" as const, definitionHash });
    }),
    load: (stageId) => runExclusive(() => loadStream(stageId)),
    append: (stageId, expectedVersion, event) => runExclusive(async () => {
      const stream = await loadStream(stageId);
      if (!stream) return freeze({ status: "REJECTED" as const, currentVersion: 0,
        finding: { code: "STAGE_NOT_FOUND", message: "Dynamic stage stream does not exist." } });
      const prior = stream.events.find(({ idempotencyKey }) => idempotencyKey === event.idempotencyKey);
      if (prior) return freeze({ status: prior.commandHash === event.commandHash ? "IDEMPOTENT_REPLAY" as const : "IDEMPOTENCY_CONFLICT" as const,
        currentVersion: stream.events.length });
      if (stream.events.length !== expectedVersion) return freeze({ status: "VERSION_CONFLICT" as const, currentVersion: stream.events.length });
      const candidate = freeze({ ...stream, events: [...stream.events, structuredClone(event)] });
      const proof = verifyPersistedDynamicStageStream(candidate);
      if (!proof.valid) return freeze({ status: "REJECTED" as const, currentVersion: stream.events.length,
        finding: { code: "INVALID_EVENT_APPEND", message: "Candidate append failed lifecycle replay verification.", causes: proof.findings.map(({ code }) => code) } });
      await atomicWrite(pathFor(stageId, "stream"), candidate);
      return freeze({ status: "APPENDED" as const, currentVersion: candidate.events.length });
    }),
    saveSnapshot: (stageId, state) => runExclusive(async () => {
      const base = { stageId, version: state.version, stateHash: state.stateHash, state: structuredClone(state) };
      const snapshot = freeze({ ...base, snapshotHash: snapshotContent(base) }); await atomicWrite(pathFor(stageId, "snapshot"), snapshot); return snapshot;
    }),
    loadSnapshot: (stageId) => runExclusive(() => read<DynamicStageSnapshot>(pathFor(stageId, "snapshot"))),
  };
}

export function createSQLiteDynamicStagePort(databasePath: string): SQLiteDynamicStagePersistencePort {
  if (!databasePath.trim()) throw new Error("SQLite database path is required");
  const database = new DatabaseSync(databasePath);
  database.exec("PRAGMA journal_mode = WAL");
  database.exec("PRAGMA busy_timeout = 5000");
  database.exec("PRAGMA foreign_keys = ON");
  database.exec("PRAGMA synchronous = NORMAL");
  database.exec(`
    CREATE TABLE IF NOT EXISTS dynamic_stage_streams (
      stage_id TEXT PRIMARY KEY NOT NULL,
      definition_json TEXT NOT NULL,
      definition_hash TEXT NOT NULL CHECK(length(definition_hash) = 64)
    ) WITHOUT ROWID;
    CREATE TABLE IF NOT EXISTS dynamic_stage_events (
      stage_id TEXT NOT NULL,
      stream_version INTEGER NOT NULL CHECK(stream_version > 0),
      idempotency_key TEXT NOT NULL,
      command_hash TEXT NOT NULL CHECK(length(command_hash) = 64),
      event_hash TEXT NOT NULL CHECK(length(event_hash) = 64),
      event_json TEXT NOT NULL,
      PRIMARY KEY(stage_id, stream_version),
      UNIQUE(stage_id, idempotency_key),
      FOREIGN KEY(stage_id) REFERENCES dynamic_stage_streams(stage_id)
    ) WITHOUT ROWID;
    CREATE TABLE IF NOT EXISTS dynamic_stage_snapshots (
      stage_id TEXT PRIMARY KEY NOT NULL,
      stream_version INTEGER NOT NULL CHECK(stream_version >= 0),
      state_hash TEXT NOT NULL CHECK(length(state_hash) = 64),
      snapshot_hash TEXT NOT NULL CHECK(length(snapshot_hash) = 64),
      snapshot_json TEXT NOT NULL,
      FOREIGN KEY(stage_id) REFERENCES dynamic_stage_streams(stage_id)
    ) WITHOUT ROWID;
  `);
  const capabilities = freeze({ durability: "TRANSACTIONAL_SQLITE" as const, multiProcessAtomicity: true,
    externalDatabase: false as const, journalMode: "WAL" as const, encryption: "NOT_PROVIDED" as const, fsyncGuarantee: "NOT_CLAIMED" as const });
  let closed = false;
  const transaction = <T>(operation: () => T): T => {
    database.exec("BEGIN IMMEDIATE");
    try { const result = operation(); database.exec("COMMIT"); return result; }
    catch (error) { try { database.exec("ROLLBACK"); } catch { /* retain the original transactional error */ } throw error; }
  };
  const loadSync = (stageId: string): PersistedDynamicStageStream | undefined => {
    const row = database.prepare("SELECT definition_json, definition_hash FROM dynamic_stage_streams WHERE stage_id = ?").get(stageId) as
      { definition_json: string; definition_hash: string } | undefined;
    if (!row) return undefined;
    const eventRows = database.prepare(`SELECT stream_version, idempotency_key, command_hash, event_hash, event_json
      FROM dynamic_stage_events WHERE stage_id = ? ORDER BY stream_version ASC`).all(stageId) as
      Array<{ stream_version: number; idempotency_key: string; command_hash: string; event_hash: string; event_json: string }>;
    const events = eventRows.map((stored) => {
      const event = JSON.parse(stored.event_json) as LifecycleEvent;
      if (event.sequence !== stored.stream_version || event.idempotencyKey !== stored.idempotency_key || event.commandHash !== stored.command_hash ||
        event.eventHash !== stored.event_hash) throw new Error(`SQLite event envelope columns disagree at version ${stored.stream_version}`);
      return event;
    });
    return freeze({ stageId, definition: JSON.parse(row.definition_json) as DynamicStageDefinition, definitionHash: row.definition_hash, events });
  };
  return {
    capabilities,
    create: async (definition) => transaction(() => {
      const definitionHash = hash(definition);
      const existing = database.prepare("SELECT definition_hash FROM dynamic_stage_streams WHERE stage_id = ?").get(definition.id) as
        { definition_hash: string } | undefined;
      if (existing) return freeze({ status: existing.definition_hash === definitionHash ? "IDEMPOTENT_REPLAY" as const : "DEFINITION_CONFLICT" as const,
        definitionHash: existing.definition_hash });
      database.prepare("INSERT INTO dynamic_stage_streams(stage_id, definition_json, definition_hash) VALUES (?, ?, ?)")
        .run(definition.id, JSON.stringify(definition), definitionHash);
      return freeze({ status: "CREATED" as const, definitionHash });
    }),
    load: async (stageId) => loadSync(stageId),
    append: async (stageId, expectedVersion, event) => transaction(() => {
      const stream = loadSync(stageId);
      if (!stream) return freeze({ status: "REJECTED" as const, currentVersion: 0,
        finding: { code: "STAGE_NOT_FOUND", message: "Dynamic stage stream does not exist." } });
      const prior = database.prepare("SELECT command_hash FROM dynamic_stage_events WHERE stage_id = ? AND idempotency_key = ?")
        .get(stageId, event.idempotencyKey) as { command_hash: string } | undefined;
      if (prior) return freeze({ status: prior.command_hash === event.commandHash ? "IDEMPOTENT_REPLAY" as const : "IDEMPOTENCY_CONFLICT" as const,
        currentVersion: stream.events.length });
      if (stream.events.length !== expectedVersion) return freeze({ status: "VERSION_CONFLICT" as const, currentVersion: stream.events.length });
      const candidate = freeze({ ...stream, events: [...stream.events, structuredClone(event)] });
      const proof = verifyPersistedDynamicStageStream(candidate);
      if (!proof.valid) return freeze({ status: "REJECTED" as const, currentVersion: stream.events.length,
        finding: { code: "INVALID_EVENT_APPEND", message: "Candidate append failed lifecycle replay verification.", causes: proof.findings.map(({ code }) => code) } });
      database.prepare(`INSERT INTO dynamic_stage_events
        (stage_id, stream_version, idempotency_key, command_hash, event_hash, event_json) VALUES (?, ?, ?, ?, ?, ?)`)
        .run(stageId, event.sequence, event.idempotencyKey, event.commandHash, event.eventHash, JSON.stringify(event));
      return freeze({ status: "APPENDED" as const, currentVersion: candidate.events.length });
    }),
    saveSnapshot: async (stageId, state) => transaction(() => {
      const exists = database.prepare("SELECT 1 AS present FROM dynamic_stage_streams WHERE stage_id = ?").get(stageId);
      if (!exists) throw new Error("Cannot snapshot a missing dynamic stage stream");
      const base = { stageId, version: state.version, stateHash: state.stateHash, state: structuredClone(state) };
      const snapshot = freeze({ ...base, snapshotHash: snapshotContent(base) });
      database.prepare(`INSERT INTO dynamic_stage_snapshots
        (stage_id, stream_version, state_hash, snapshot_hash, snapshot_json) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(stage_id) DO UPDATE SET stream_version=excluded.stream_version, state_hash=excluded.state_hash,
          snapshot_hash=excluded.snapshot_hash, snapshot_json=excluded.snapshot_json`)
        .run(stageId, state.version, state.stateHash, snapshot.snapshotHash, JSON.stringify(snapshot));
      return snapshot;
    }),
    loadSnapshot: async (stageId) => {
      const row = database.prepare(`SELECT stream_version, state_hash, snapshot_hash, snapshot_json
        FROM dynamic_stage_snapshots WHERE stage_id = ?`).get(stageId) as
        { stream_version: number; state_hash: string; snapshot_hash: string; snapshot_json: string } | undefined;
      if (!row) return undefined;
      const snapshot = JSON.parse(row.snapshot_json) as DynamicStageSnapshot;
      if (snapshot.version !== row.stream_version || snapshot.stateHash !== row.state_hash || snapshot.snapshotHash !== row.snapshot_hash) {
        throw new Error("SQLite snapshot columns disagree with cached envelope");
      }
      return freeze(snapshot);
    },
    close: () => { if (!closed) { database.close(); closed = true; } },
  };
}

export function createDynamicStageRepository(port: DynamicStagePersistencePort, options: { readonly snapshotEvery?: number } = {}): DynamicStageRepository {
  const snapshotEvery = options.snapshotEvery ?? 10;
  if (!Number.isInteger(snapshotEvery) || snapshotEvery < 1) throw new Error("snapshotEvery must be a positive integer");
  const load = async (stageId: string): Promise<DurableLoadResult> => {
    let stream: PersistedDynamicStageStream | undefined;
    try { stream = await port.load(stageId); } catch (error) {
      return freeze({ status: "REJECTED", state: null, snapshotStatus: "ABSENT",
        findings: [{ code: "STREAM_READ_FAILED", message: error instanceof Error ? error.message : "Authoritative stream could not be read." }], proof: null });
    }
    if (!stream) return freeze({ status: "NOT_FOUND", state: null, snapshotStatus: "ABSENT", findings: [], proof: null });
    const proof = verifyPersistedDynamicStageStream(stream);
    if (!proof.valid) return freeze({ status: "REJECTED", state: null, snapshotStatus: "DISCARDED_INVALID", findings: proof.findings,
      proof: { streamValid: false, streamHash: proof.streamHash } });
    const replay = replayDynamicStage(stream.definition, stream.events);
    if (replay.status !== "REPLAYED") return freeze({ status: "REJECTED", state: null, snapshotStatus: "DISCARDED_INVALID", findings: replay.findings,
      proof: { streamValid: false, streamHash: proof.streamHash } });
    let snapshot: DynamicStageSnapshot | undefined; const cacheFindings: LifecycleFinding[] = [];
    try { snapshot = await port.loadSnapshot(stageId); } catch (error) {
      cacheFindings.push({ code: "SNAPSHOT_READ_FAILED", message: error instanceof Error ? error.message : "Disposable snapshot could not be read." });
    }
    let snapshotStatus: DurableLoadResult["snapshotStatus"] = "ABSENT";
    if (cacheFindings.length > 0) snapshotStatus = "DISCARDED_INVALID";
    else if (snapshot) {
      const { snapshotHash, ...content } = snapshot;
      if (snapshotContent(content) !== snapshotHash || snapshot.stageId !== stageId || snapshot.version > replay.state.version ||
        !verifyDynamicStage(snapshot.state).valid || snapshot.version === replay.state.version &&
          (snapshot.stateHash !== replay.state.stateHash || snapshot.state.stateHash !== snapshot.stateHash || hash(snapshot.state) !== hash(replay.state))) {
        snapshotStatus = "DISCARDED_INVALID";
      } else if (snapshot.version < replay.state.version) snapshotStatus = "DISCARDED_STALE";
      else snapshotStatus = "HIT_VALID";
    }
    return freeze({ status: "LOADED", state: replay.state, snapshotStatus, findings: cacheFindings, proof: { streamValid: true, streamHash: proof.streamHash } });
  };
  return {
    capabilities: port.capabilities,
    create: async (definition) => port.create(definition),
    load,
    execute: async (stageId, command) => {
      const current = await load(stageId);
      if (current.status === "NOT_FOUND") return freeze({ status: "NOT_FOUND" as const, state: null, findings: [{ code: "STAGE_NOT_FOUND", message: "Dynamic stage stream does not exist." }], persistenceHash: null });
      if (current.status !== "LOADED" || !current.state) return freeze({ status: "REJECTED" as const, state: null, findings: current.findings,
        persistenceHash: current.proof?.streamHash ?? null });
      const transition = transitionDynamicStage(current.state, command);
      if (transition.status !== "APPLIED") return freeze({ status: transition.status, state: transition.state, findings: transition.findings,
        persistenceHash: current.proof!.streamHash });
      const event = transition.state.events.at(-1)!;
      let appended: PortAppendResult;
      try { appended = await port.append(stageId, command.expectedVersion, event); } catch (error) {
        return freeze({ status: "REJECTED" as const, state: current.state,
          findings: [{ code: "PERSISTENCE_APPEND_FAILED", message: error instanceof Error ? error.message : "Atomic persistence append failed." }],
          persistenceHash: current.proof!.streamHash });
      }
      if (appended.status === "APPENDED") {
        if (transition.state.version % snapshotEvery === 0) {
          try { await port.saveSnapshot(stageId, transition.state); } catch { /* snapshots are disposable; authoritative append succeeded */ }
        }
        const persisted = await port.load(stageId);
        return freeze({ status: "APPLIED" as const, state: transition.state, findings: [], persistenceHash: persisted ? streamHash(persisted) : null });
      }
      const latest = await load(stageId);
      if (appended.status === "IDEMPOTENT_REPLAY") return freeze({ status: "REPLAYED" as const, state: latest.state, findings: [], persistenceHash: latest.proof?.streamHash ?? null });
      const finding = appended.finding ?? { code: appended.status, message: appended.status === "VERSION_CONFLICT"
        ? `Atomic append expected version ${command.expectedVersion}, current version is ${appended.currentVersion}.`
        : "Persistence rejected the append." };
      return freeze({ status: appended.status, state: latest.state, findings: [finding], persistenceHash: latest.proof?.streamHash ?? null });
    },
  };
}
