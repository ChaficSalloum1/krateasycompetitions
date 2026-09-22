import assert from "node:assert/strict";
import test from "node:test";
import type { AuthoritativePublicationArtifacts } from "@tournament-os/competition-engine";
import {
  artifactObjectKey,
  createR2PublicationArtifactStore,
  type PublicationArtifactObjectStore,
} from "../src/r2-publication-artifacts.js";

function fixture(overrides: Partial<AuthoritativePublicationArtifacts> = {}): AuthoritativePublicationArtifacts {
  return {
    organizationId: "org.st-albans", tournamentId: "encourt-padel-wellness-club-st-albans.4b6fcaa959",
    tournamentRevision: 1, definitionHash: "a".repeat(64), compiledBy: "organiser.author",
    compiledAt: "2026-09-20T13:00:00.000Z", spec: { kind: "SPEC" } as never, specHash: "b".repeat(64),
    graph: { kind: "GRAPH" } as never, graphHash: "c".repeat(64), schedule: { kind: "SCHEDULE" } as never,
    scheduleHash: "d".repeat(64), ...overrides,
  };
}

function memoryStore(): PublicationArtifactObjectStore & { objects: Map<string, string> } {
  const objects = new Map<string, string>();
  return {
    objects,
    async getObject(key) { return objects.has(key) ? objects.get(key)! : null; },
    async putObject(key, body) { objects.set(key, body); },
  };
}

test("artifactObjectKey rejects unsafe path segments and requires a positive revision", () => {
  assert.match(artifactObjectKey({ organizationId: "org.one", tournamentId: "tournament.one", tournamentRevision: 3 }),
    /^publication-artifacts\/org\.one\/tournament\.one\/v3\.json$/);
  assert.throws(() => artifactObjectKey({ organizationId: "../../etc", tournamentId: "t", tournamentRevision: 1 }));
  assert.throws(() => artifactObjectKey({ organizationId: "org.one", tournamentId: "t/../x", tournamentRevision: 1 }));
  assert.throws(() => artifactObjectKey({ organizationId: "org.one", tournamentId: "t", tournamentRevision: 0 }));
  assert.throws(() => artifactObjectKey({ organizationId: "org.one", tournamentId: "t", tournamentRevision: 1.5 }));
});

test("save then load round-trips the exact artifact set", async () => {
  const store = memoryStore();
  const resolver = createR2PublicationArtifactStore({ bucket: "b", accountId: "a", accessKeyId: "k", secretAccessKey: "s", store });
  const artifacts = fixture();
  await resolver.save(artifacts);
  assert.equal(store.objects.size, 1);
  const loaded = await resolver.load({ organizationId: artifacts.organizationId, tournamentId: artifacts.tournamentId,
    tournamentRevision: artifacts.tournamentRevision });
  assert.deepEqual(loaded, artifacts);
});

test("load returns undefined for a key that was never written", async () => {
  const store = memoryStore();
  const resolver = createR2PublicationArtifactStore({ bucket: "b", accountId: "a", accessKeyId: "k", secretAccessKey: "s", store });
  assert.equal(await resolver.load({ organizationId: "org.one", tournamentId: "missing", tournamentRevision: 1 }), undefined);
});

test("load fails closed when the stored object does not actually belong to the requested key", async () => {
  const store = memoryStore();
  const resolver = createR2PublicationArtifactStore({ bucket: "b", accountId: "a", accessKeyId: "k", secretAccessKey: "s", store });
  // Simulate a corrupted or misdirected object landing under the correct key.
  store.objects.set(artifactObjectKey({ organizationId: "org.one", tournamentId: "t", tournamentRevision: 1 }),
    JSON.stringify(fixture({ organizationId: "org.two" })));
  await assert.rejects(resolver.load({ organizationId: "org.one", tournamentId: "t", tournamentRevision: 1 }),
    /publication_artifact_binding_mismatch/);
});

test("load fails closed on corrupted JSON instead of silently treating it as missing", async () => {
  const store = memoryStore();
  const resolver = createR2PublicationArtifactStore({ bucket: "b", accountId: "a", accessKeyId: "k", secretAccessKey: "s", store });
  store.objects.set(artifactObjectKey({ organizationId: "org.one", tournamentId: "t", tournamentRevision: 1 }), "{not json");
  await assert.rejects(resolver.load({ organizationId: "org.one", tournamentId: "t", tournamentRevision: 1 }));
});

test("distinct organisations, tournaments and revisions never collide in storage", async () => {
  const store = memoryStore();
  const resolver = createR2PublicationArtifactStore({ bucket: "b", accountId: "a", accessKeyId: "k", secretAccessKey: "s", store });
  await resolver.save(fixture({ organizationId: "org.one", tournamentRevision: 1 }));
  await resolver.save(fixture({ organizationId: "org.one", tournamentRevision: 2 }));
  await resolver.save(fixture({ organizationId: "org.two", tournamentRevision: 1 }));
  assert.equal(store.objects.size, 3);
  assert.equal((await resolver.load({ organizationId: "org.one", tournamentId: "encourt-padel-wellness-club-st-albans.4b6fcaa959", tournamentRevision: 1 }))?.organizationId, "org.one");
  assert.equal((await resolver.load({ organizationId: "org.two", tournamentId: "encourt-padel-wellness-club-st-albans.4b6fcaa959", tournamentRevision: 1 }))?.organizationId, "org.two");
});
