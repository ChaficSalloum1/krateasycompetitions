import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { promisify } from "node:util";
import {
  createDynamicStageRepository,
  createFileDynamicStagePort,
  createInMemoryDynamicStagePort,
  createSQLiteDynamicStagePort,
  verifyPersistedDynamicStageStream,
} from "../src/dynamic-stage-store.js";
import type { DynamicStageCommand, SwissStageDefinition } from "../src/dynamic-stage-lifecycle.js";
import { defineDynamicStage, transitionDynamicStage } from "../src/dynamic-stage-lifecycle.js";

const execFileAsync = promisify(execFile);

const definition: SwissStageDefinition = {
  id: "durable-open", revision: 1, kind: "SWISS", entrants: ["a", "b", "c", "d"], totalRounds: 1,
  pairingPolicy: { rematches: "FORBIDDEN" }, points: { win: 2, draw: 1, bye: 2 },
  finalRankingPolicy: { id: "points-id", version: "1", criteria: ["POINTS", "COMPETITOR_ID"] },
};
const command = (kind: "PREPARE" | "START", expectedVersion: number, idempotencyKey: string): DynamicStageCommand => ({
  kind, expectedVersion, idempotencyKey, actorId: "director", occurredAt: `2026-09-06T12:0${expectedVersion}:00.000Z`,
});

test("repository atomically appends lifecycle commands with OCC and content-bound idempotency", async () => {
  const port = createInMemoryDynamicStagePort();
  const repository = createDynamicStageRepository(port, { snapshotEvery: 10 });
  assert.equal((await repository.create(definition)).status, "CREATED");
  assert.equal((await repository.create(definition)).status, "IDEMPOTENT_REPLAY");
  assert.equal((await repository.create({ ...definition, entrants: ["a", "b"] })).status, "DEFINITION_CONFLICT");

  const prepare = command("PREPARE", 0, "prepare");
  assert.equal((await repository.execute(definition.id, prepare)).status, "APPLIED");
  assert.equal((await repository.execute(definition.id, prepare)).status, "REPLAYED");
  const conflictingKey = await repository.execute(definition.id, command("START", 1, "prepare"));
  assert.equal(conflictingKey.status, "REJECTED");
  assert.equal(conflictingKey.findings[0]?.code, "IDEMPOTENCY_CONFLICT");

  const [left, right] = await Promise.all([
    repository.execute(definition.id, command("START", 1, "start-left")),
    repository.execute(definition.id, command("START", 1, "start-right")),
  ]);
  assert.deepEqual([left.status, right.status].sort(), ["APPLIED", "VERSION_CONFLICT"]);
  const loaded = await repository.load(definition.id);
  assert.equal(loaded.status, "LOADED");
  assert.equal(loaded.state?.version, 2);
  assert.equal(loaded.state?.phase, "RUNNING");
  assert.equal(loaded.proof?.streamValid, true);
});

test("authoritative event replay discards stale or divergent snapshots instead of trusting cache state", async () => {
  const port = createInMemoryDynamicStagePort();
  const repository = createDynamicStageRepository(port, { snapshotEvery: 50 });
  await repository.create(definition);
  const prepared = await repository.execute(definition.id, command("PREPARE", 0, "prepare"));
  assert.ok(prepared.state);
  await repository.execute(definition.id, command("START", 1, "start"));

  await port.saveSnapshot(definition.id, prepared.state!);
  const stale = await repository.load(definition.id);
  assert.equal(stale.status, "LOADED");
  assert.equal(stale.snapshotStatus, "DISCARDED_STALE");
  assert.equal(stale.state?.phase, "RUNNING");

  const divergent = structuredClone(stale.state!);
  (divergent as { phase: string }).phase = "COMPLETE";
  await port.saveSnapshot(definition.id, divergent);
  const recovered = await repository.load(definition.id);
  assert.equal(recovered.status, "LOADED");
  assert.equal(recovered.snapshotStatus, "DISCARDED_INVALID");
  assert.equal(recovered.state?.stateHash, stale.state?.stateHash);
});

test("filesystem adapter durably reconstructs a lifecycle from another adapter instance", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "tournamentos-dynamic-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const first = createDynamicStageRepository(createFileDynamicStagePort(directory), { snapshotEvery: 1 });
  await first.create(definition);
  await first.execute(definition.id, command("PREPARE", 0, "prepare"));
  const started = await first.execute(definition.id, command("START", 1, "start"));
  assert.equal(started.status, "APPLIED");

  const second = createDynamicStageRepository(createFileDynamicStagePort(directory), { snapshotEvery: 1 });
  const loaded = await second.load(definition.id);
  assert.equal(loaded.status, "LOADED");
  assert.equal(loaded.state?.stateHash, started.state?.stateHash);
  assert.equal(loaded.state?.phase, "RUNNING");
  assert.equal(loaded.snapshotStatus, "HIT_VALID");
  assert.equal(second.capabilities.durability, "SINGLE_PROCESS_FILESYSTEM");
});

test("persisted stream verification rejects event or definition tampering", async () => {
  const port = createInMemoryDynamicStagePort();
  const repository = createDynamicStageRepository(port);
  await repository.create(definition);
  await repository.execute(definition.id, command("PREPARE", 0, "prepare"));
  const stream = await port.load(definition.id);
  assert.ok(stream);
  assert.equal(verifyPersistedDynamicStageStream(stream!).valid, true);

  const tampered = structuredClone(stream!);
  (tampered.events[0]!.command as { actorId: string }).actorId = "attacker";
  const proof = verifyPersistedDynamicStageStream(tampered);
  assert.equal(proof.valid, false);
  assert.ok(proof.findings.some(({ code }) => code === "LIFECYCLE_REPLAY_REJECTED" || code === "EVENT_CHAIN_INVALID"));
});

test("snapshot read failure degrades the disposable cache without blocking authoritative replay", async () => {
  const base = createInMemoryDynamicStagePort();
  const writer = createDynamicStageRepository(base);
  await writer.create(definition);
  await writer.execute(definition.id, command("PREPARE", 0, "prepare"));
  const reader = createDynamicStageRepository({ ...base, loadSnapshot: async () => { throw new Error("cache unavailable"); } });

  const loaded = await reader.load(definition.id);
  assert.equal(loaded.status, "LOADED");
  assert.equal(loaded.state?.phase, "READY");
  assert.equal(loaded.snapshotStatus, "DISCARDED_INVALID");
  assert.equal(loaded.findings[0]?.code, "SNAPSHOT_READ_FAILED");
});

test("SQLite initializes a WAL schema and atomically arbitrates expected-version appends across connections", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "tournamentos-sqlite-"));
  const databasePath = join(directory, "dynamic-stages.sqlite");
  const leftPort = createSQLiteDynamicStagePort(databasePath);
  const rightPort = createSQLiteDynamicStagePort(databasePath);
  context.after(async () => { leftPort.close(); rightPort.close(); await rm(directory, { recursive: true, force: true }); });
  const left = createDynamicStageRepository(leftPort, { snapshotEvery: 10 });
  const right = createDynamicStageRepository(rightPort, { snapshotEvery: 10 });

  assert.equal((await left.create(definition)).status, "CREATED");
  assert.equal((await right.create(definition)).status, "IDEMPOTENT_REPLAY");
  const [first, second] = await Promise.all([
    left.execute(definition.id, command("PREPARE", 0, "sqlite-left")),
    right.execute(definition.id, command("PREPARE", 0, "sqlite-right")),
  ]);
  assert.deepEqual([first.status, second.status].sort(), ["APPLIED", "VERSION_CONFLICT"]);
  const stream = await rightPort.load(definition.id);
  assert.deepEqual(stream?.events.map(({ sequence }) => sequence), [1]);
  assert.equal(verifyPersistedDynamicStageStream(stream!).valid, true);
  const replayed = await right.execute(definition.id, stream!.events[0]!.command);
  assert.equal(replayed.status, "REPLAYED");
  const conflict = await right.execute(definition.id, {
    ...stream!.events[0]!.command, kind: "START", expectedVersion: 1,
  } as DynamicStageCommand);
  assert.equal(conflict.status, "REJECTED");
  assert.equal(conflict.findings[0]?.code, "IDEMPOTENCY_CONFLICT");
  assert.equal((await right.execute(definition.id, command("START", 1, "sqlite-start"))).status, "APPLIED");
  assert.deepEqual((await leftPort.load(definition.id))?.events.map(({ sequence }) => sequence), [1, 2]);
  assert.deepEqual(leftPort.capabilities, {
    durability: "TRANSACTIONAL_SQLITE", multiProcessAtomicity: true, externalDatabase: false,
    journalMode: "WAL", encryption: "NOT_PROVIDED", fsyncGuarantee: "NOT_CLAIMED",
  });

  const inspection = new DatabaseSync(databasePath, { readOnly: true });
  assert.equal(inspection.prepare("PRAGMA journal_mode").get()!.journal_mode, "wal");
  const tables = inspection.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(({ name }) => name);
  inspection.close();
  assert.deepEqual(tables, ["dynamic_stage_events", "dynamic_stage_snapshots", "dynamic_stage_streams"]);
});

test("SQLite snapshots stay disposable while event corruption fails authoritative replay closed", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "tournamentos-sqlite-integrity-"));
  const databasePath = join(directory, "dynamic-stages.sqlite");
  const port = createSQLiteDynamicStagePort(databasePath);
  context.after(async () => { port.close(); await rm(directory, { recursive: true, force: true }); });
  const repository = createDynamicStageRepository(port, { snapshotEvery: 50 });
  await repository.create(definition);
  const prepared = await repository.execute(definition.id, command("PREPARE", 0, "prepare"));
  await port.saveSnapshot(definition.id, prepared.state!);
  await repository.execute(definition.id, command("START", 1, "start"));
  assert.equal((await repository.load(definition.id)).snapshotStatus, "DISCARDED_STALE");

  const raw = new DatabaseSync(databasePath);
  raw.prepare("UPDATE dynamic_stage_snapshots SET snapshot_json = ? WHERE stage_id = ?").run("not-json", definition.id);
  assert.equal((await repository.load(definition.id)).status, "LOADED");
  assert.equal((await repository.load(definition.id)).snapshotStatus, "DISCARDED_INVALID");

  const stream = await port.load(definition.id); const tampered = structuredClone(stream!.events[0]!);
  (tampered.command as { actorId: string }).actorId = "attacker";
  raw.prepare("UPDATE dynamic_stage_events SET event_json = ? WHERE stage_id = ? AND stream_version = 1")
    .run(JSON.stringify(tampered), definition.id);
  raw.close();
  const rejected = await repository.load(definition.id);
  assert.equal(rejected.status, "REJECTED");
  assert.ok(rejected.findings.some(({ code }) => code === "LIFECYCLE_REPLAY_REJECTED"));
});

test("SQLite BEGIN IMMEDIATE arbitrates the same expected version across separate processes", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "tournamentos-sqlite-process-"));
  const databasePath = join(directory, "dynamic-stages.sqlite");
  context.after(() => rm(directory, { recursive: true, force: true }));
  const setup = createSQLiteDynamicStagePort(databasePath);
  await setup.create(definition); setup.close();
  const initial = defineDynamicStage(definition);
  const commands = [command("PREPARE", 0, "process-a"), command("PREPARE", 0, "process-b")];
  const events = commands.map((next) => transitionDynamicStage(initial, next).state.events[0]!);
  const moduleUrl = new URL("../src/dynamic-stage-store.ts", import.meta.url).href;
  const script = `const m=await import(process.argv[1]);const p=m.createSQLiteDynamicStagePort(process.argv[2]);const r=await p.append(process.argv[3],Number(process.argv[4]),JSON.parse(Buffer.from(process.argv[5],'base64').toString('utf8')));process.stdout.write(JSON.stringify(r));p.close();`;
  const results = await Promise.all(events.map((event) => execFileAsync(process.execPath,
    ["--import", "tsx", "--input-type=module", "-e", script, moduleUrl, databasePath, definition.id, "0", Buffer.from(JSON.stringify(event)).toString("base64")])));
  const statuses = results.map(({ stdout }) => (JSON.parse(stdout) as { status: string }).status).sort();
  assert.deepEqual(statuses, ["APPENDED", "VERSION_CONFLICT"]);
  const inspection = createSQLiteDynamicStagePort(databasePath);
  assert.equal((await inspection.load(definition.id))?.events.length, 1);
  inspection.close();
});
