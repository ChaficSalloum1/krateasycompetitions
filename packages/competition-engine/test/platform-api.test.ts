import assert from "node:assert/strict";
import test from "node:test";
import { canonicalHash, compileDefinition, type TournamentSpec } from "@tournament-os/tournament-schema";
import { playAndKonnectDefinition } from "@tournament-os/tournament-schema/example";
import { createInMemoryEventStore } from "../src/event-store.js";
import { evaluateCompetitionGuard } from "../src/competition-guard.js";
import { createEntrants } from "../src/graph.js";
import { createOrganizationPlatform } from "../src/platform.js";
import { createOrganizationPlatformApi } from "../src/platform-api.js";
import { runScenario } from "../src/scenario.js";

test("the versioned operator API injects trusted identity and idempotency into dashboard and write workflows", async () => {
  const platform = createOrganizationPlatform(createInMemoryEventStore());
  const at = "2026-09-07T09:00:00.000Z";
  await platform.execute({ kind: "CREATE_ORGANIZATION", organizationId: "org.api", commandId: "setup.1", occurredAt: at,
    ownerUserId: "user.owner", name: "API Organisation", slug: "api-organisation" });
  await platform.execute({ kind: "CREATE_CLUB", organizationId: "org.api", commandId: "setup.2", occurredAt: at,
    actorUserId: "user.owner", clubId: "club.main", name: "Main Club", timezone: "Europe/Athens" });
  await platform.execute({ kind: "CREATE_TOURNAMENT", organizationId: "org.api", commandId: "setup.3", occurredAt: at,
    actorUserId: "user.owner", tournamentId: "tournament.api", clubId: "club.main", name: "API Open",
    startsAt: "2026-10-10T08:00:00.000Z", definition: { format: "round_robin" } });
  const api = createOrganizationPlatformApi({ platform, now: () => at });
  const principal = { organizationId: "org.api", userId: "user.owner" };

  const dashboard = await api.handle({ method: "GET", path: "/v1/organizations/org.api/dashboard", principal });
  assert.equal(dashboard.status, 200);
  assert.equal((dashboard.body as { apiVersion: string }).apiVersion, "1.0");
  const changed = await api.handle({ method: "POST", path: "/v1/organizations/org.api/commands", principal,
    idempotencyKey: "api.command.1", body: { kind: "CHANGE_TOURNAMENT_STATUS", tournamentId: "tournament.api", status: "UNDER_REVIEW" } });
  assert.equal(changed.status, 200);
  assert.equal((changed.body as { organizationVersion: number }).organizationVersion, 4);
  const replay = await api.handle({ method: "POST", path: "/v1/organizations/org.api/commands", principal,
    idempotencyKey: "api.command.1", body: { kind: "CHANGE_TOURNAMENT_STATUS", tournamentId: "tournament.api", status: "UNDER_REVIEW" } });
  assert.equal(replay.status, 200);
  assert.equal((await platform.read("org.api")).version, 4);
  const injection = await api.handle({ method: "POST", path: "/v1/organizations/org.api/commands", principal,
    idempotencyKey: "api.command.2", body: { kind: "CHANGE_TOURNAMENT_STATUS", actorUserId: "user.attacker",
      tournamentId: "tournament.api", status: "ARCHIVED" } });
  assert.equal(injection.status, 400);
  const crossTenant = await api.handle({ method: "GET", path: "/v1/organizations/org.other/dashboard", principal });
  assert.equal(crossTenant.status, 403);
});

test("the operator API atomically publishes only the exact server-bound approved revision", async () => {
  const at = "2026-09-07T09:00:00.000Z";
  const spec = compileDefinition(structuredClone(playAndKonnectDefinition), {
    specId: "platform.api.publication", revision: 1, schemaVersion: "1.0.0", compilerVersion: "0.1.0",
    rulesetVersions: { padel: "1.0.0", competition: "1.0.0" }, sourcePrompt: "api publication", createdAt: at,
  }) as TournamentSpec;
  const scenario = runScenario(spec, createEntrants(spec), "platform-api-publication");
  const guardReport = evaluateCompetitionGuard({ sourceDefinitionHash: canonicalHash(spec), spec, graph: scenario.graph,
    schedule: scenario.schedule, ...(scenario.simulation ? { simulation: scenario.simulation } : {}) });
  const definitionHash = canonicalHash(spec);
  const authoritativeArtifacts = {
    organizationId: "org.publish-api", tournamentId: "tournament.api", tournamentRevision: 1,
    definitionHash, compiledBy: "server.compiler", compiledAt: at,
    spec, specHash: canonicalHash(spec), graph: scenario.graph, graphHash: canonicalHash(scenario.graph),
    schedule: scenario.schedule, scheduleHash: canonicalHash(scenario.schedule),
    ...(scenario.simulation ? { simulation: scenario.simulation, simulationHash: canonicalHash(scenario.simulation) } : {}),
  };
  const platform = createOrganizationPlatform(createInMemoryEventStore(), {
    publicationArtifacts: { load: async () => authoritativeArtifacts },
  });
  await platform.execute({ kind: "CREATE_ORGANIZATION", organizationId: "org.publish-api", commandId: "setup.1", occurredAt: at,
    ownerUserId: "user.owner", name: "Publication API", slug: "publication-api" });
  await platform.execute({ kind: "CREATE_CLUB", organizationId: "org.publish-api", commandId: "setup.2", occurredAt: at,
    actorUserId: "user.owner", clubId: "club.main", name: "Main Club", timezone: "Europe/Athens" });
  await platform.execute({ kind: "INVITE_MEMBER", organizationId: "org.publish-api", commandId: "setup.3", occurredAt: at,
    actorUserId: "user.owner", invitationId: "invite.director", email: "director@example.test", role: "TOURNAMENT_DIRECTOR",
    clubIds: ["club.main"], invitationToken: "api-publication-director-token", expiresAt: "2026-09-14T09:00:00.000Z" });
  await platform.execute({ kind: "ACCEPT_INVITATION", organizationId: "org.publish-api", commandId: "setup.4", occurredAt: at,
    userId: "user.director", invitationToken: "api-publication-director-token" });
  await platform.execute({ kind: "CREATE_TOURNAMENT", organizationId: "org.publish-api", commandId: "setup.5", occurredAt: at,
    actorUserId: "user.owner", tournamentId: "tournament.api", clubId: "club.main", name: "API Open",
    startsAt: "2026-10-10T08:00:00.000Z", definition: structuredClone(spec) as never });
  await platform.execute({ kind: "CHANGE_TOURNAMENT_STATUS", organizationId: "org.publish-api", commandId: "setup.6", occurredAt: at,
    actorUserId: "user.owner", tournamentId: "tournament.api", status: "UNDER_REVIEW" });
  await platform.execute({ kind: "CHANGE_TOURNAMENT_STATUS", organizationId: "org.publish-api", commandId: "setup.7", occurredAt: at,
    actorUserId: "user.director", tournamentId: "tournament.api", status: "APPROVED" });
  const api = createOrganizationPlatformApi({ platform, now: () => at });
  const invalid = await api.handle({ method: "POST", path: "/v1/organizations/org.publish-api/commands",
    principal: { organizationId: "org.publish-api", userId: "user.owner" }, idempotencyKey: "publish.invalid",
    body: { kind: "PUBLISH_TOURNAMENT", tournamentId: "tournament.api",
      expectedTournamentRevision: 1, guardInput: { spec, graph: scenario.graph, schedule: scenario.schedule },
      acknowledgedFindingCodes: guardReport.requiredAcknowledgementCodes } });
  assert.equal(invalid.status, 400);
  assert.equal((await platform.read("org.publish-api")).tournaments["tournament.api"]?.status, "APPROVED");
  const response = await api.handle({ method: "POST", path: "/v1/organizations/org.publish-api/commands",
    principal: { organizationId: "org.publish-api", userId: "user.owner" }, idempotencyKey: "publish.1",
    body: { kind: "PUBLISH_TOURNAMENT", tournamentId: "tournament.api",
      expectedTournamentRevision: 1,
      acknowledgedFindingCodes: guardReport.requiredAcknowledgementCodes } });

  assert.equal(response.status, 200);
  const state = await platform.read("org.publish-api");
  assert.equal(state.tournaments["tournament.api"]?.status, "PUBLISHED");
  assert.equal(state.publicationRecords["tournament.api"]?.at(-1)?.definitionHash, definitionHash);
  assert.equal(state.publicationRecords["tournament.api"]?.at(-1)?.report.binding.sourceDefinitionHash, definitionHash);
});
