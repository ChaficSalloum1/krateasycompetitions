import assert from "node:assert/strict";
import test from "node:test";
import { createInMemoryEventStore, verifyEventChain } from "../src/event-store.js";

const firstAppend = {
  streamId: "tournament.1",
  expectedVersion: 0,
  commandId: "command.create.1",
  recordedAt: "2026-09-05T12:00:00.000Z",
  events: [{ type: "TournamentCreated", payload: { name: "Open" } }],
} as const;

test("appends immutable event envelopes with aggregate versions and a hash chain", async () => {
  const store = createInMemoryEventStore();
  const result = await store.append(firstAppend);
  const stream = await store.readStream("tournament.1");

  assert.equal(result.status, "APPENDED");
  assert.equal(result.currentVersion, 1);
  assert.equal(stream.length, 1);
  assert.equal(stream[0]!.streamVersion, 1);
  assert.equal(stream[0]!.previousHash, null);
  assert.match(stream[0]!.eventHash, /^[a-f0-9]{64}$/);
  assert.ok(Object.isFrozen(stream));
  assert.ok(Object.isFrozen(stream[0]));
  assert.ok(Object.isFrozen(stream[0]!.payload));
});

test("duplicate command replay is idempotent and conflicting key reuse fails closed", async () => {
  const store = createInMemoryEventStore();
  const first = await store.append(firstAppend);
  const replay = await store.append(firstAppend);

  assert.equal(replay.status, "IDEMPOTENT_REPLAY");
  assert.deepEqual(replay.events, first.events);
  assert.equal((await store.readStream("tournament.1")).length, 1);
  await assert.rejects(store.append({
    ...firstAppend,
    events: [{ type: "TournamentCreated", payload: { name: "Different" } }],
  }), /reused with different content/);
  assert.equal((await store.readStream("tournament.1")).length, 1);
});

test("rejects stale aggregate versions without partially appending", async () => {
  const store = createInMemoryEventStore();
  await store.append(firstAppend);
  await assert.rejects(store.append({
    streamId: "tournament.1", expectedVersion: 0, commandId: "command.rename.1",
    recordedAt: "2026-09-05T12:01:00.000Z",
    events: [{ type: "TournamentRenamed", payload: { name: "Autumn Open" } }],
  }), /expected 0, actual 1/);
  assert.equal((await store.readStream("tournament.1")).length, 1);
});

test("a failed multi-stream transaction commits no events or idempotency records", async () => {
  const store = createInMemoryEventStore();
  await store.append(firstAppend);
  const valid = {
    streamId: "tournament.1", expectedVersion: 1, commandId: "command.rename.2",
    recordedAt: "2026-09-05T12:02:00.000Z",
    events: [{ type: "TournamentRenamed", payload: { name: "Winter Open" } }],
  } as const;
  await assert.rejects(store.appendTransaction([
    valid,
    { streamId: "tournament.1", expectedVersion: 0, commandId: "command.publish.1",
      recordedAt: "2026-09-05T12:03:00.000Z", events: [{ type: "TournamentPublished", payload: {} }] },
  ]), /expected 0, actual 2/);

  assert.equal((await store.readStream("tournament.1")).length, 1);
  assert.equal((await store.append(valid)).status, "APPENDED");
});

test("independent chain verification detects payload tampering", async () => {
  const store = createInMemoryEventStore();
  await store.append(firstAppend);
  await store.append({
    streamId: "tournament.1", expectedVersion: 1, commandId: "command.rename.3",
    recordedAt: "2026-09-05T12:04:00.000Z",
    events: [{ type: "TournamentRenamed", payload: { name: "Spring Open" } }],
  });
  const stream = await store.readStream("tournament.1");
  assert.equal(verifyEventChain(stream).valid, true);

  const tampered = structuredClone(stream);
  (tampered[0]!.payload as { name: string }).name = "Tampered";
  const proof = verifyEventChain(tampered);
  assert.equal(proof.valid, false);
  assert.ok(proof.findings.some(({ code }) => code === "HASH_MISMATCH"));
});

test("replay reconstructs deterministically from events and never trusts snapshot state", async () => {
  const build = async () => {
    const store = createInMemoryEventStore();
    await store.append({ ...firstAppend, events: [{ type: "CountChanged", payload: { delta: 1 } }] });
    await store.append({
      streamId: "tournament.1", expectedVersion: 1, commandId: "command.count.2",
      recordedAt: "2026-09-05T12:05:00.000Z", events: [{ type: "CountChanged", payload: { delta: 2 } }],
    });
    return store;
  };
  const left = await build();
  const right = await build();
  await left.saveSnapshot({ streamId: "tournament.1", streamVersion: 1, state: { count: 999 } });
  assert.equal((await left.loadSnapshot<{ count: number }>("tournament.1"))?.state.count, 999);

  const reducer = (count: number, event: { payload: unknown }) =>
    count + (event.payload as { delta: number }).delta;
  assert.equal(await left.replay("tournament.1", 0, reducer), 3);
  assert.equal(await right.replay("tournament.1", 0, reducer), 3);
  assert.deepEqual(await left.readStream("tournament.1"), await right.readStream("tournament.1"));
});
