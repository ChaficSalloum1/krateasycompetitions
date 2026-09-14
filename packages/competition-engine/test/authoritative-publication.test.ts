import assert from "node:assert/strict";
import test from "node:test";
import { canonicalHash, compileDefinition, type TournamentSpec } from "@tournament-os/tournament-schema";
import { playAndKonnectDefinition } from "@tournament-os/tournament-schema/example";
import { createInMemoryTransactionalOutboxEventStore } from "../src/event-store.js";
import { evaluateCompetitionGuard } from "../src/competition-guard.js";
import { createEntrants } from "../src/graph.js";
import {
  createOrganizationPlatform,
  type AuthoritativePublicationArtifacts,
  type OrganizationPlatform,
} from "../src/platform.js";
import { createOrganizationPlatformApi } from "../src/platform-api.js";
import { runScenario } from "../src/scenario.js";

const at = "2026-09-14T12:00:00.000Z";
const organizationId = "org.authoritative";
const tournamentId = "tournament.authoritative";

function evidence(): AuthoritativePublicationArtifacts {
  const spec = compileDefinition(structuredClone(playAndKonnectDefinition), {
    specId: tournamentId, revision: 1, schemaVersion: "1.0.0", compilerVersion: "0.1.0",
    rulesetVersions: { padel: "1.0.0", competition: "1.0.0" }, sourcePrompt: "authoritative test", createdAt: at,
  }) as TournamentSpec;
  const scenario = runScenario(spec, createEntrants(spec), "authoritative-publication-test");
  return {
    organizationId, tournamentId, tournamentRevision: 1, definitionHash: canonicalHash(spec),
    compiledBy: "server.compiler", compiledAt: at,
    spec, specHash: canonicalHash(spec), graph: scenario.graph, graphHash: canonicalHash(scenario.graph),
    schedule: scenario.schedule, scheduleHash: canonicalHash(scenario.schedule),
    ...(scenario.simulation ? { simulation: scenario.simulation, simulationHash: canonicalHash(scenario.simulation) } : {}),
  };
}

async function fixture(resolve: () => AuthoritativePublicationArtifacts = evidence): Promise<{
  platform: OrganizationPlatform;
  artifacts: AuthoritativePublicationArtifacts;
  store: ReturnType<typeof createInMemoryTransactionalOutboxEventStore>;
}> {
  const store = createInMemoryTransactionalOutboxEventStore();
  const artifacts = evidence();
  const platform = createOrganizationPlatform(store, { publicationArtifacts: { load: async () => resolve() } });
  await platform.execute({ kind: "CREATE_ORGANIZATION", organizationId, commandId: "setup.1", occurredAt: at,
    ownerUserId: "user.author", name: "Authoritative Org", slug: "authoritative-org" });
  await platform.execute({ kind: "CREATE_CLUB", organizationId, commandId: "setup.2", occurredAt: at,
    actorUserId: "user.author", clubId: "club.main", name: "Main Club", timezone: "Europe/London" });
  for (const [userId, suffix] of [["user.approver", "approver"], ["user.publisher", "publisher"]] as const) {
    await platform.execute({ kind: "INVITE_MEMBER", organizationId, commandId: `setup.invite.${suffix}`, occurredAt: at,
      actorUserId: "user.author", invitationId: `invite.${suffix}`, email: `${suffix}@example.test`, role: "TOURNAMENT_DIRECTOR",
      clubIds: ["club.main"], invitationToken: `invitation-secret-${suffix}`, expiresAt: "2026-09-21T12:00:00.000Z" });
    await platform.execute({ kind: "ACCEPT_INVITATION", organizationId, commandId: `setup.accept.${suffix}`, occurredAt: at,
      userId, invitationToken: `invitation-secret-${suffix}` });
  }
  await platform.execute({ kind: "CREATE_TOURNAMENT", organizationId, commandId: "setup.tournament", occurredAt: at,
    actorUserId: "user.author", tournamentId, clubId: "club.main", name: "Authoritative Open",
    startsAt: "2026-10-10T08:00:00.000Z", definition: structuredClone(artifacts.spec) as never });
  await platform.execute({ kind: "CHANGE_TOURNAMENT_STATUS", organizationId, commandId: "setup.review", occurredAt: at,
    actorUserId: "user.author", tournamentId, status: "UNDER_REVIEW" });
  await platform.execute({ kind: "CHANGE_TOURNAMENT_STATUS", organizationId, commandId: "setup.approve", occurredAt: at,
    actorUserId: "user.approver", tournamentId, status: "APPROVED" });
  return { platform, artifacts, store };
}

function requiredAcknowledgements(artifacts: AuthoritativePublicationArtifacts): readonly string[] {
  return evaluateCompetitionGuard({ sourceDefinitionHash: artifacts.definitionHash, spec: artifacts.spec,
    graph: artifacts.graph, schedule: artifacts.schedule,
    ...(artifacts.simulation ? { simulation: artifacts.simulation } : {}) }).requiredAcknowledgementCodes;
}

function publish(platform: OrganizationPlatform, codes: readonly string[], overrides: Partial<{
  organizationId: string; commandId: string; actorUserId: string; tournamentId: string; expectedTournamentRevision: number;
}> = {}) {
  return platform.execute({ kind: "PUBLISH_TOURNAMENT", organizationId: overrides.organizationId ?? organizationId,
    commandId: overrides.commandId ?? "publish.1", occurredAt: at, actorUserId: overrides.actorUserId ?? "user.publisher",
    tournamentId: overrides.tournamentId ?? tournamentId,
    expectedTournamentRevision: overrides.expectedTournamentRevision ?? 1, acknowledgedFindingCodes: codes });
}

test("the public publication command rejects every client-provided artifact field", async () => {
  const { platform } = await fixture();
  const api = createOrganizationPlatformApi({ platform, now: () => at });
  for (const field of ["guardInput", "spec", "graph", "schedule", "simulation", "guardReport"] as const) {
    const response = await api.handle({ method: "POST", path: `/v1/organizations/${organizationId}/commands`,
      principal: { organizationId, userId: "user.publisher" }, idempotencyKey: `forged.${field}`,
      body: { kind: "PUBLISH_TOURNAMENT", tournamentId, expectedTournamentRevision: 1,
        acknowledgedFindingCodes: [], [field]: {} } });
    assert.equal(response.status, 400, field);
  }
  await assert.rejects(platform.execute({ kind: "PUBLISH_TOURNAMENT", organizationId, commandId: "forged.direct",
    occurredAt: at, actorUserId: "user.publisher", tournamentId, expectedTournamentRevision: 1,
    acknowledgedFindingCodes: [], guardInput: { spec: {}, graph: {}, schedule: {} } } as never), /only identity, revision, and acknowledgements/);
  assert.equal((await platform.read(organizationId)).tournaments[tournamentId]?.status, "APPROVED");
});

test("server-owned artifacts with a coordinated missing contest are blocked by an independent Guard run before approval", async () => {
  const forged = evidence();
  const graph = structuredClone(forged.graph);
  const omitted = graph.nodes.find(({ kind }) => kind === "contest");
  assert.ok(omitted);
  graph.nodes = graph.nodes.filter(({ id }) => id !== omitted.id);
  graph.edges = graph.edges.filter(({ fromContestId, toContestId }) => fromContestId !== omitted.id && toContestId !== omitted.id);
  graph.expectedActualContestCount -= 1;
  graph.generatedActualContestCount -= 1;
  graph.findings = [];
  const schedule = structuredClone(forged.schedule);
  schedule.contests = schedule.contests.filter(({ contestId }) => contestId !== omitted.id);
  const { simulation: _simulation, simulationHash: _simulationHash, ...withoutSimulation } = forged;
  await assert.rejects(fixture(() => ({ ...withoutSimulation, graph, graphHash: canonicalHash(graph),
    schedule, scheduleHash: canonicalHash(schedule) })), /Competition Guard blocked approval.*KCG003.*KCG004/);
});

test("stale revisions and mismatched artifact hashes fail before publication", async () => {
  let current = evidence();
  const { platform } = await fixture(() => current);
  await assert.rejects(publish(platform, [], { commandId: "publish.stale", expectedTournamentRevision: 2 }), /stale/);
  current = { ...current, scheduleHash: "0".repeat(64) };
  await assert.rejects(publish(platform, [], { commandId: "publish.hash" }), /artifact hash mismatch/);
});

test("a valid artifact set changed after approval is stale until the exact set is approved again", async () => {
  let current = evidence();
  const { platform, artifacts } = await fixture(() => current);
  current = { ...current, compiledBy: "server.recompiler" };
  await assert.rejects(publish(platform, requiredAcknowledgements(artifacts), { commandId: "publish.recompiled" }),
    /exact approved artifact set/);
});

test("cross-organisation artifacts and self-approval fail closed", async () => {
  let current = evidence();
  const { platform } = await fixture(() => current);
  current = { ...current, organizationId: "org.other" };
  await assert.rejects(publish(platform, [], { commandId: "publish.cross-org" }), /do not belong/);
  current = evidence();
  await assert.rejects(publish(platform, [], { commandId: "publish.self", actorUserId: "user.approver" }), /different active member/);
  current = { ...current, compiledBy: "user.approver" };
  await assert.rejects(publish(platform, [], { commandId: "publish.compiler-self" }), /different active member from the compiler/);
});

test("acknowledgements must match exactly and a duplicate command replays once across platform restarts", async () => {
  const { platform, artifacts, store } = await fixture();
  const codes = requiredAcknowledgements(artifacts);
  await assert.rejects(publish(platform, [...codes, "NOT_REQUIRED"], { commandId: "publish.bad-acks" }), /Every and only required/);
  const published = await publish(platform, codes);
  const restarted = createOrganizationPlatform(store, { publicationArtifacts: { load: async () => {
    throw new Error("idempotent replay must not reload artifacts");
  } } });
  const replayed = await publish(restarted, codes);
  assert.deepEqual(replayed, published);
  assert.equal(store.outbox.list().length, 1);
  assert.equal(store.outbox.list()[0]?.publicationKey, `${tournamentId}:v1`);
  assert.equal((await store.readStream(`organization:${organizationId}`)).filter(({ commandId }) => commandId === "publish.1").length, 2);
});
