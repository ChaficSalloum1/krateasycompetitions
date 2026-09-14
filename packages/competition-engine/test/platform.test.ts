import assert from "node:assert/strict";
import test from "node:test";
import { canonicalHash, compileDefinition, type TournamentSpec } from "@tournament-os/tournament-schema";
import { playAndKonnectDefinition } from "@tournament-os/tournament-schema/example";
import { evaluateCompetitionGuard } from "../src/competition-guard.js";
import { createInMemoryEventStore, createInMemoryTransactionalOutboxEventStore, type JsonValue } from "../src/event-store.js";
import { createEntrants } from "../src/graph.js";
import { createOrganizationPlatform, restoreOrganizationBackup } from "../src/platform.js";
import { runScenario } from "../src/scenario.js";

const at = "2026-09-07T09:00:00.000Z";

function publicationEvidence(specId: string) {
  const spec = compileDefinition(structuredClone(playAndKonnectDefinition), {
    specId, revision: 1, schemaVersion: "1.0.0", compilerVersion: "0.1.0",
    rulesetVersions: { padel: "1.0.0", competition: "1.0.0" }, sourcePrompt: specId, createdAt: at,
  }) as TournamentSpec;
  const scenario = runScenario(spec, createEntrants(spec), `${specId}:publication`);
  const report = evaluateCompetitionGuard({ sourceDefinitionHash: canonicalHash(spec), spec, graph: scenario.graph,
    schedule: scenario.schedule, ...(scenario.simulation ? { simulation: scenario.simulation } : {}) });
  return { spec, definition: structuredClone(spec) as unknown as JsonValue, scenario, report };
}

test("an owner creates an isolated club universe and a replayable scoped membership", async () => {
  const store = createInMemoryEventStore();
  const platform = createOrganizationPlatform(store);
  await platform.execute({ kind: "CREATE_ORGANIZATION", organizationId: "org.athens-padel", commandId: "c1", occurredAt: at,
    ownerUserId: "user.owner", name: "Athens Padel Collective", slug: "athens-padel" });
  await platform.execute({ kind: "CREATE_CLUB", organizationId: "org.athens-padel", commandId: "c2", occurredAt: at,
    actorUserId: "user.owner", clubId: "club.north", name: "North Club", timezone: "Europe/Athens" });
  await platform.execute({ kind: "INVITE_MEMBER", organizationId: "org.athens-padel", commandId: "c3", occurredAt: at,
    actorUserId: "user.owner", invitationId: "invite.director", email: "director@example.test", role: "TOURNAMENT_DIRECTOR",
    clubIds: ["club.north"], invitationToken: "correct-horse-battery-staple", expiresAt: "2026-09-14T09:00:00.000Z" });
  await platform.execute({ kind: "ACCEPT_INVITATION", organizationId: "org.athens-padel", commandId: "c4", occurredAt: at,
    userId: "user.director", invitationToken: "correct-horse-battery-staple" });
  await platform.execute({ kind: "UPDATE_ORGANIZATION", organizationId: "org.athens-padel", commandId: "c5", occurredAt: at,
    actorUserId: "user.owner", name: "Athens Padel Universe", slug: "athens-padel-universe", status: "ACTIVE" });
  await platform.execute({ kind: "UPDATE_CLUB", organizationId: "org.athens-padel", commandId: "c6", occurredAt: at,
    actorUserId: "user.owner", clubId: "club.north", name: "North Padel Club", timezone: "Europe/Athens", status: "ACTIVE" });
  await platform.execute({ kind: "CHANGE_MEMBERSHIP", organizationId: "org.athens-padel", commandId: "c7", occurredAt: at,
    actorUserId: "user.owner", userId: "user.director", role: "OPERATOR", clubIds: ["club.north"], status: "SUSPENDED" });
  await platform.execute({ kind: "INVITE_MEMBER", organizationId: "org.athens-padel", commandId: "c8", occurredAt: at,
    actorUserId: "user.owner", invitationId: "invite.revoked", email: "revoked@example.test", role: "VIEWER",
    clubIds: ["club.north"], invitationToken: "revoked-invitation-token", expiresAt: "2026-09-14T09:00:00.000Z" });
  await platform.execute({ kind: "REVOKE_INVITATION", organizationId: "org.athens-padel", commandId: "c9", occurredAt: at,
    actorUserId: "user.owner", invitationId: "invite.revoked" });

  const replayed = await createOrganizationPlatform(store).read("org.athens-padel");
  assert.equal(replayed.organization?.name, "Athens Padel Universe");
  assert.equal(replayed.organization?.slug, "athens-padel-universe");
  assert.equal(replayed.clubs["club.north"]?.timezone, "Europe/Athens");
  assert.deepEqual(replayed.memberships["user.director"], {
    userId: "user.director", role: "OPERATOR", clubIds: ["club.north"], status: "SUSPENDED",
  });
  assert.equal(replayed.invitations["invite.director"]?.status, "ACCEPTED");
  assert.equal(replayed.invitations["invite.revoked"]?.status, "REVOKED");
  assert.equal(JSON.stringify(await store.readStream("organization:org.athens-padel")).includes("correct-horse-battery-staple"), false);
});

test("club directories persist people, teams, places, officials, and equipment with referential integrity", async () => {
  const store = createInMemoryEventStore();
  const platform = createOrganizationPlatform(store);
  await platform.execute({ kind: "CREATE_ORGANIZATION", organizationId: "org.directory", commandId: "d1", occurredAt: at,
    ownerUserId: "user.owner", name: "Directory Organisation", slug: "directory-organisation" });
  await platform.execute({ kind: "CREATE_CLUB", organizationId: "org.directory", commandId: "d2", occurredAt: at,
    actorUserId: "user.owner", clubId: "club.main", name: "Main Club", timezone: "Europe/Athens" });
  for (const [id, name, commandId] of [["player.1", "Maya Haddad", "d3"], ["player.2", "Nora Saleh", "d4"]] as const) {
    await platform.execute({ kind: "UPSERT_PLAYER", organizationId: "org.directory", commandId, occurredAt: at,
      actorUserId: "user.owner", player: { id, displayName: name, clubIds: ["club.main"], externalIds: {}, status: "ACTIVE" } });
  }
  await platform.execute({ kind: "UPSERT_TEAM", organizationId: "org.directory", commandId: "d5", occurredAt: at,
    actorUserId: "user.owner", team: { id: "team.1", clubId: "club.main", name: "Maya / Nora", playerIds: ["player.1", "player.2"], status: "ACTIVE" } });
  await platform.execute({ kind: "UPSERT_VENUE", organizationId: "org.directory", commandId: "d6", occurredAt: at,
    actorUserId: "user.owner", venue: { id: "venue.1", clubId: "club.main", name: "North Padel Centre", timezone: "Europe/Athens", status: "ACTIVE" } });
  await platform.execute({ kind: "UPSERT_COURT", organizationId: "org.directory", commandId: "d7", occurredAt: at,
    actorUserId: "user.owner", court: { id: "court.1", venueId: "venue.1", name: "Court 1", sportTags: ["padel"], status: "ACTIVE" } });
  await platform.execute({ kind: "UPSERT_OFFICIAL", organizationId: "org.directory", commandId: "d8", occurredAt: at,
    actorUserId: "user.owner", official: { id: "official.1", displayName: "Rami Daher", clubIds: ["club.main"], certifications: ["padel.referee"], status: "ACTIVE" } });
  await platform.execute({ kind: "UPSERT_EQUIPMENT", organizationId: "org.directory", commandId: "d9", occurredAt: at,
    actorUserId: "user.owner", equipment: { id: "equipment.1", venueId: "venue.1", name: "Scoreboard 1", kind: "SCOREBOARD", status: "ACTIVE" } });

  const state = await createOrganizationPlatform(store).read("org.directory");
  assert.deepEqual(state.teams["team.1"]?.playerIds, ["player.1", "player.2"]);
  assert.equal(state.courts["court.1"]?.venueId, "venue.1");
  assert.deepEqual(state.officials["official.1"]?.certifications, ["padel.referee"]);
  assert.equal(state.equipment["equipment.1"]?.kind, "SCOREBOARD");
  await assert.rejects(platform.execute({ kind: "UPSERT_TEAM", organizationId: "org.directory", commandId: "d10", occurredAt: at,
    actorUserId: "user.owner", team: { id: "team.bad", clubId: "club.main", name: "Invalid", playerIds: ["player.missing"], status: "ACTIVE" } }),
  /registered active player/);
});

test("tournaments retain immutable draft revisions, guarded lifecycle transitions, duplication, and archive history", async () => {
  const store = createInMemoryTransactionalOutboxEventStore();
  const platform = createOrganizationPlatform(store);
  const evidence = publicationEvidence("platform.lifecycle");
  await platform.execute({ kind: "CREATE_ORGANIZATION", organizationId: "org.lifecycle", commandId: "t1", occurredAt: at,
    ownerUserId: "user.owner", name: "Lifecycle Organisation", slug: "lifecycle-organisation" });
  await platform.execute({ kind: "CREATE_CLUB", organizationId: "org.lifecycle", commandId: "t2", occurredAt: at,
    actorUserId: "user.owner", clubId: "club.main", name: "Main Club", timezone: "Europe/Athens" });
  await platform.execute({ kind: "INVITE_MEMBER", organizationId: "org.lifecycle", commandId: "t3", occurredAt: at,
    actorUserId: "user.owner", invitationId: "invite.director", email: "director@example.test", role: "TOURNAMENT_DIRECTOR",
    clubIds: ["club.main"], invitationToken: "director-invitation-token", expiresAt: "2026-09-14T09:00:00.000Z" });
  await platform.execute({ kind: "ACCEPT_INVITATION", organizationId: "org.lifecycle", commandId: "t4", occurredAt: at,
    userId: "user.director", invitationToken: "director-invitation-token" });
  await platform.execute({ kind: "CREATE_TOURNAMENT", organizationId: "org.lifecycle", commandId: "t5", occurredAt: at,
    actorUserId: "user.owner", tournamentId: "tournament.autumn", clubId: "club.main", name: "Autumn Open",
    startsAt: "2026-10-10T08:00:00.000Z", definition: { participants: [], format: null } });
  await platform.execute({ kind: "REVISE_TOURNAMENT", organizationId: "org.lifecycle", commandId: "t6", occurredAt: at,
    actorUserId: "user.owner", tournamentId: "tournament.autumn", expectedTournamentRevision: 1,
    summary: "Add the approved divisions", definition: evidence.definition });
  await platform.execute({ kind: "CHANGE_TOURNAMENT_STATUS", organizationId: "org.lifecycle", commandId: "t7", occurredAt: at,
    actorUserId: "user.owner", tournamentId: "tournament.autumn", status: "UNDER_REVIEW" });
  await assert.rejects(platform.execute({ kind: "CHANGE_TOURNAMENT_STATUS", organizationId: "org.lifecycle", commandId: "t8", occurredAt: at,
    actorUserId: "user.owner", tournamentId: "tournament.autumn", status: "APPROVED" }), /different active member/);
  await platform.execute({ kind: "CHANGE_TOURNAMENT_STATUS", organizationId: "org.lifecycle", commandId: "t9", occurredAt: at,
    actorUserId: "user.director", tournamentId: "tournament.autumn", status: "APPROVED" });
  await assert.rejects(platform.execute({ kind: "CHANGE_TOURNAMENT_STATUS", organizationId: "org.lifecycle", commandId: "t10", occurredAt: at,
    actorUserId: "user.owner", tournamentId: "tournament.autumn", status: "PUBLISHED" }), /current Competition Guard publication certificate/);
  const versionBeforeBlockedPublication = (await platform.read("org.lifecycle")).version;
  const foreignGraph = structuredClone(evidence.scenario.graph);
  foreignGraph.specHash = "0".repeat(64);
  await assert.rejects(platform.execute({ kind: "PUBLISH_TOURNAMENT", organizationId: "org.lifecycle", commandId: "t10.blocked", occurredAt: at,
    actorUserId: "user.owner", tournamentId: "tournament.autumn",
    guardInput: { spec: evidence.spec, graph: foreignGraph, schedule: evidence.scenario.schedule,
      ...(evidence.scenario.simulation ? { simulation: evidence.scenario.simulation } : {}) },
    acknowledgedFindingCodes: [] }), /Competition Guard blocked publication/);
  assert.equal((await platform.read("org.lifecycle")).version, versionBeforeBlockedPublication);
  assert.equal((await platform.read("org.lifecycle")).tournaments["tournament.autumn"]?.status, "APPROVED");
  await platform.execute({ kind: "PUBLISH_TOURNAMENT", organizationId: "org.lifecycle", commandId: "t11", occurredAt: at,
    actorUserId: "user.owner", tournamentId: "tournament.autumn",
    guardInput: { spec: evidence.spec, graph: evidence.scenario.graph, schedule: evidence.scenario.schedule,
      ...(evidence.scenario.simulation ? { simulation: evidence.scenario.simulation } : {}) },
    acknowledgedFindingCodes: evidence.report.requiredAcknowledgementCodes });
  await platform.execute({ kind: "DUPLICATE_TOURNAMENT", organizationId: "org.lifecycle", commandId: "t12", occurredAt: at,
    actorUserId: "user.owner", sourceTournamentId: "tournament.autumn", tournamentId: "tournament.spring", name: "Spring Open",
    startsAt: "2027-03-20T08:00:00.000Z" });
  await platform.execute({ kind: "CHANGE_TOURNAMENT_STATUS", organizationId: "org.lifecycle", commandId: "t13", occurredAt: at,
    actorUserId: "user.owner", tournamentId: "tournament.autumn", status: "ARCHIVED" });

  const state = await createOrganizationPlatform(store).read("org.lifecycle");
  assert.equal(state.tournaments["tournament.autumn"]?.status, "ARCHIVED");
  assert.equal(state.tournaments["tournament.autumn"]?.revisions.length, 2);
  assert.equal(state.tournaments["tournament.spring"]?.status, "DRAFT");
  assert.equal(state.tournaments["tournament.spring"]?.duplicatedFromTournamentId, "tournament.autumn");
  assert.equal(state.tournaments["tournament.spring"]?.revisions[0]?.definitionHash,
    state.tournaments["tournament.autumn"]?.revisions[1]?.definitionHash);
  assert.equal(state.tournaments["tournament.autumn"]?.publishedCertificateHash,
    state.publicationRecords["tournament.autumn"]?.at(-1)?.certificate.certificateHash);
  const dashboard = await platform.dashboard("org.lifecycle", "user.owner");
  assert.deepEqual(dashboard.publicationReadiness.find(({ tournamentId }) => tournamentId === "tournament.autumn"), {
    tournamentId: "tournament.autumn", tournamentRevision: 2, status: "PUBLISHED",
    certificateHash: state.publicationRecords["tournament.autumn"]?.at(-1)?.certificate.certificateHash,
    guardReportHash: state.publicationRecords["tournament.autumn"]?.at(-1)?.report.reportHash,
    assessedAt: at,
  });
  const publicationEvents = (await store.readStream("organization:org.lifecycle")).filter(({ commandId }) => commandId === "t11");
  assert.deepEqual(publicationEvents.map(({ type }) => type), ["PUBLICATION_CERTIFIED", "TOURNAMENT_STATUS_CHANGED"]);
  assert.equal(new Set(publicationEvents.map(({ commandId }) => commandId)).size, 1);
  const publicationMessages = store.outbox.list();
  assert.equal(publicationMessages.length, 1);
  assert.equal(publicationMessages[0]?.topic, "competition.publication.v1");
  assert.equal(publicationMessages[0]?.publicationKey, "tournament.autumn");
  assert.equal((publicationMessages[0]?.payload as { certificateHash: string }).certificateHash,
    state.tournaments["tournament.autumn"]?.publishedCertificateHash);
});

test("the format library versions reusable formats and pins approved club defaults without overwriting history", async () => {
  const store = createInMemoryEventStore();
  const platform = createOrganizationPlatform(store);
  await platform.execute({ kind: "CREATE_ORGANIZATION", organizationId: "org.formats", commandId: "f1", occurredAt: at,
    ownerUserId: "user.owner", name: "Format Organisation", slug: "format-organisation" });
  await platform.execute({ kind: "CREATE_CLUB", organizationId: "org.formats", commandId: "f2", occurredAt: at,
    actorUserId: "user.owner", clubId: "club.main", name: "Main Club", timezone: "Europe/Athens" });
  await platform.execute({ kind: "INVITE_MEMBER", organizationId: "org.formats", commandId: "f3", occurredAt: at,
    actorUserId: "user.owner", invitationId: "invite.director", email: "director@example.test", role: "TOURNAMENT_DIRECTOR",
    clubIds: ["club.main"], invitationToken: "format-director-token", expiresAt: "2026-09-14T09:00:00.000Z" });
  await platform.execute({ kind: "ACCEPT_INVITATION", organizationId: "org.formats", commandId: "f4", occurredAt: at,
    userId: "user.director", invitationToken: "format-director-token" });
  await platform.execute({ kind: "CREATE_FORMAT_TEMPLATE", organizationId: "org.formats", commandId: "f5", occurredAt: at,
    actorUserId: "user.owner", templateId: "format.padel-club-night", name: "Padel club night", sport: "padel", version: "1.0.0",
    summary: "Initial governed format", definition: { stages: ["pools", "single_elimination"], minimumMatches: 3 } });
  await assert.rejects(platform.execute({ kind: "APPROVE_FORMAT_VERSION", organizationId: "org.formats", commandId: "f6", occurredAt: at,
    actorUserId: "user.owner", templateId: "format.padel-club-night", version: "1.0.0" }), /different active member/);
  await platform.execute({ kind: "APPROVE_FORMAT_VERSION", organizationId: "org.formats", commandId: "f7", occurredAt: at,
    actorUserId: "user.director", templateId: "format.padel-club-night", version: "1.0.0" });
  await platform.execute({ kind: "SET_CLUB_DEFAULT_FORMAT", organizationId: "org.formats", commandId: "f8", occurredAt: at,
    actorUserId: "user.owner", clubId: "club.main", templateId: "format.padel-club-night", version: "1.0.0" });
  await platform.execute({ kind: "ADD_FORMAT_VERSION", organizationId: "org.formats", commandId: "f9", occurredAt: at,
    actorUserId: "user.director", templateId: "format.padel-club-night", basedOnVersion: "1.0.0", version: "1.1.0",
    summary: "Add a consolation path", definition: { stages: ["pools", "single_elimination", "consolation"], minimumMatches: 3 } });

  const state = await createOrganizationPlatform(store).read("org.formats");
  assert.deepEqual(state.clubDefaultFormats["club.main"], { templateId: "format.padel-club-night", version: "1.0.0" });
  assert.deepEqual(state.formatTemplates["format.padel-club-night"]?.versions.map(({ version, status }) => [version, status]),
    [["1.0.0", "APPROVED"], ["1.1.0", "DRAFT"]]);
  assert.notEqual(state.formatTemplates["format.padel-club-night"]?.versions[0]?.definitionHash,
    state.formatTemplates["format.padel-club-night"]?.versions[1]?.definitionHash);
});

test("guided creation enforces participants to review order and seals one reviewable tournament definition", async () => {
  const store = createInMemoryEventStore();
  const platform = createOrganizationPlatform(store);
  await platform.execute({ kind: "CREATE_ORGANIZATION", organizationId: "org.guide", commandId: "g1", occurredAt: at,
    ownerUserId: "user.owner", name: "Guided Organisation", slug: "guided-organisation" });
  await platform.execute({ kind: "CREATE_CLUB", organizationId: "org.guide", commandId: "g2", occurredAt: at,
    actorUserId: "user.owner", clubId: "club.main", name: "Main Club", timezone: "Europe/Athens" });
  await platform.execute({ kind: "UPSERT_PLAYER", organizationId: "org.guide", commandId: "g3", occurredAt: at,
    actorUserId: "user.owner", player: { id: "player.1", displayName: "Leila Mansour", clubIds: ["club.main"], externalIds: {}, status: "ACTIVE" } });
  await platform.execute({ kind: "UPSERT_VENUE", organizationId: "org.guide", commandId: "g4", occurredAt: at,
    actorUserId: "user.owner", venue: { id: "venue.1", clubId: "club.main", name: "Padel House", timezone: "Europe/Athens", status: "ACTIVE" } });
  await platform.execute({ kind: "UPSERT_COURT", organizationId: "org.guide", commandId: "g5", occurredAt: at,
    actorUserId: "user.owner", court: { id: "court.1", venueId: "venue.1", name: "Court 1", sportTags: ["padel"], status: "ACTIVE" } });
  await platform.execute({ kind: "START_GUIDED_TOURNAMENT", organizationId: "org.guide", commandId: "g6", occurredAt: at,
    actorUserId: "user.owner", tournamentId: "tournament.guided", clubId: "club.main", name: "Guided Open", startsAt: "2026-10-10T08:00:00.000Z" });
  await assert.rejects(platform.execute({ kind: "SAVE_GUIDED_STEP", organizationId: "org.guide", commandId: "g7", occurredAt: at,
    actorUserId: "user.owner", tournamentId: "tournament.guided", step: "FORMAT", data: { kind: "CUSTOM" } }), /Expected guided step PARTICIPANTS/);
  const steps = [
    ["PARTICIPANTS", { entrantIds: ["player.1"] }],
    ["FORMAT", { kind: "CUSTOM", stageKinds: ["round_robin"] }],
    ["RULES", { cutoffTies: "REJECT" }],
    ["RESOURCES", { resourceIds: ["court.1"] }],
    ["PRIORITIES", { objectives: ["makespan", "preferred_rest"] }],
    ["REVIEW", { accepted: true }],
  ] as const;
  let command = 8;
  for (const [step, data] of steps) {
    await platform.execute({ kind: "SAVE_GUIDED_STEP", organizationId: "org.guide", commandId: `g${command}`, occurredAt: at,
      actorUserId: "user.owner", tournamentId: "tournament.guided", step, data });
    command += 1;
  }

  const state = await createOrganizationPlatform(store).read("org.guide");
  assert.equal(state.creationGuides["tournament.guided"]?.status, "COMPLETE");
  assert.equal(state.creationGuides["tournament.guided"]?.currentStep, null);
  assert.equal(state.tournaments["tournament.guided"]?.revisions.length, 2);
  assert.equal(state.creationGuides["tournament.guided"]?.reviewHash,
    state.tournaments["tournament.guided"]?.revisions[1]?.definitionHash);
});

test("the dashboard gives each organiser only their clubs, seasons, tournaments, directories, and actionable alerts", async () => {
  const store = createInMemoryEventStore(); const platform = createOrganizationPlatform(store);
  await platform.execute({ kind: "CREATE_ORGANIZATION", organizationId: "org.dashboard", commandId: "b1", occurredAt: at,
    ownerUserId: "user.owner", name: "Dashboard Organisation", slug: "dashboard-organisation" });
  for (const [clubId, name, commandId] of [["club.north", "North Club", "b2"], ["club.south", "South Club", "b3"]] as const) {
    await platform.execute({ kind: "CREATE_CLUB", organizationId: "org.dashboard", commandId, occurredAt: at,
      actorUserId: "user.owner", clubId, name, timezone: "Europe/Athens" });
  }
  await platform.execute({ kind: "INVITE_MEMBER", organizationId: "org.dashboard", commandId: "b4", occurredAt: at,
    actorUserId: "user.owner", invitationId: "invite.admin", email: "admin@example.test", role: "CLUB_ADMIN",
    clubIds: ["club.north"], invitationToken: "dashboard-admin-token", expiresAt: "2026-09-14T09:00:00.000Z" });
  await platform.execute({ kind: "ACCEPT_INVITATION", organizationId: "org.dashboard", commandId: "b5", occurredAt: at,
    userId: "user.admin", invitationToken: "dashboard-admin-token" });
  await platform.execute({ kind: "CREATE_SEASON", organizationId: "org.dashboard", commandId: "b6", occurredAt: at,
    actorUserId: "user.owner", season: { id: "season.2026", clubId: "club.north", name: "2026 League",
      startsOn: "2026-01-01", endsOn: "2026-12-31", status: "ACTIVE" } });
  for (const [tournamentId, clubId, commandId] of [["tournament.north", "club.north", "b7"], ["tournament.south", "club.south", "b8"]] as const) {
    await platform.execute({ kind: "CREATE_TOURNAMENT", organizationId: "org.dashboard", commandId, occurredAt: at,
      actorUserId: "user.owner", tournamentId, clubId, name: tournamentId, startsAt: "2026-10-10T08:00:00.000Z", definition: { format: "round_robin" } });
  }
  await platform.execute({ kind: "RAISE_OPERATIONAL_ALERT", organizationId: "org.dashboard", commandId: "b9", occurredAt: at,
    actorUserId: "user.owner", alert: { id: "alert.north", clubId: "club.north", tournamentId: "tournament.north",
      severity: "ACTION_REQUIRED", title: "Court unavailable", detail: "Court 2 is closed." } });
  await platform.execute({ kind: "RAISE_OPERATIONAL_ALERT", organizationId: "org.dashboard", commandId: "b10", occurredAt: at,
    actorUserId: "user.owner", alert: { id: "alert.south", clubId: "club.south", tournamentId: "tournament.south",
      severity: "INFORMATION", title: "Schedule ready", detail: "Draft schedule is ready." } });

  const owner = await platform.dashboard("org.dashboard", "user.owner");
  const northAdmin = await platform.dashboard("org.dashboard", "user.admin");
  assert.equal(owner.clubs.length, 2);
  assert.equal(owner.tournamentCounts.DRAFT, 2);
  assert.deepEqual(northAdmin.clubs.map(({ id }) => id), ["club.north"]);
  assert.deepEqual(northAdmin.seasons.map(({ id }) => id), ["season.2026"]);
  assert.deepEqual(northAdmin.tournaments.map(({ id }) => id), ["tournament.north"]);
  assert.deepEqual(northAdmin.alerts.map(({ id }) => id), ["alert.north"]);
  assert.deepEqual(northAdmin.publicationReadiness, [{ tournamentId: "tournament.north", tournamentRevision: 1, status: "UNCERTIFIED" }]);
});

test("recovery, privacy export and erasure, notifications, and verified backup restore preserve governed truth", async () => {
  const store = createInMemoryEventStore(); const platform = createOrganizationPlatform(store);
  await platform.execute({ kind: "CREATE_ORGANIZATION", organizationId: "org.governance", commandId: "p1", occurredAt: at,
    ownerUserId: "user.owner", ownerEmail: "owner@example.test", name: "Governance Organisation", slug: "governance-organisation" });
  await platform.execute({ kind: "CREATE_CLUB", organizationId: "org.governance", commandId: "p2", occurredAt: at,
    actorUserId: "user.owner", clubId: "club.main", name: "Main Club", timezone: "Europe/Athens" });
  await platform.execute({ kind: "INVITE_MEMBER", organizationId: "org.governance", commandId: "p3", occurredAt: at,
    actorUserId: "user.owner", invitationId: "invite.director", email: "director@example.test", role: "TOURNAMENT_DIRECTOR",
    clubIds: ["club.main"], invitationToken: "governance-invite-token", expiresAt: "2026-09-14T09:00:00.000Z" });
  await platform.execute({ kind: "ACCEPT_INVITATION", organizationId: "org.governance", commandId: "p4", occurredAt: at,
    userId: "user.director", invitationToken: "governance-invite-token" });
  await platform.execute({ kind: "UPSERT_PLAYER", organizationId: "org.governance", commandId: "p5", occurredAt: at,
    actorUserId: "user.owner", player: { id: "player.director", linkedUserId: "user.director", displayName: "Samira Khalil",
      email: "director@example.test", clubIds: ["club.main"], externalIds: {}, status: "ACTIVE" } });
  await platform.execute({ kind: "REQUEST_ACCOUNT_RECOVERY", organizationId: "org.governance", commandId: "p6", occurredAt: at,
    email: "director@example.test", recoveryId: "recovery.1", recoveryToken: "account-recovery-secret", expiresAt: "2026-09-07T10:00:00.000Z" });
  await platform.execute({ kind: "COMPLETE_ACCOUNT_RECOVERY", organizationId: "org.governance", commandId: "p7", occurredAt: at,
    userId: "user.director", recoveryToken: "account-recovery-secret" });
  await platform.execute({ kind: "QUEUE_NOTIFICATION", organizationId: "org.governance", commandId: "p8", occurredAt: at,
    actorUserId: "user.owner", notification: { id: "notification.1", clubId: "club.main", channel: "EMAIL",
      recipientPlayerIds: ["player.director"], templateKey: "schedule.changed", data: { tournamentId: "tournament.1" } } });

  const privacy = await platform.exportPrivacy("org.governance", "user.director", "user.director");
  assert.equal(privacy.account.email, "director@example.test");
  assert.deepEqual(privacy.players.map(({ id }) => id), ["player.director"]);
  assert.match(privacy.exportHash, /^[a-f0-9]{64}$/);
  await platform.execute({ kind: "DELETE_ACCOUNT", organizationId: "org.governance", commandId: "p9", occurredAt: at,
    actorUserId: "user.director", userId: "user.director", reason: "User requested erasure" });

  const deleted = await platform.read("org.governance");
  assert.equal(deleted.accounts["user.director"]?.status, "ANONYMIZED");
  assert.equal(deleted.accounts["user.director"]?.email, null);
  assert.equal(deleted.players["player.director"]?.status, "ARCHIVED");
  assert.equal(deleted.notifications["notification.1"]?.status, "QUEUED");
  const serializedEvents = JSON.stringify(await store.readStream("organization:org.governance"));
  assert.equal(serializedEvents.includes("account-recovery-secret"), false);

  const backup = await platform.exportBackup("org.governance", "user.owner");
  const restoredStore = createInMemoryEventStore();
  const restored = await restoreOrganizationBackup(restoredStore, backup, "restore.1", "2026-09-07T11:00:00.000Z");
  assert.equal((await restored.read("org.governance")).accounts["user.director"]?.status, "ANONYMIZED");
  await assert.rejects(restoreOrganizationBackup(createInMemoryEventStore(), { ...backup, stateHash: "0".repeat(64) }, "restore.bad", at), /backup hash/);
});

test("operators persist live actions and scores while independently approved repair proposals remain explicit", async () => {
  const store = createInMemoryTransactionalOutboxEventStore(); const platform = createOrganizationPlatform(store);
  const evidence = publicationEvidence("platform.operations");
  await platform.execute({ kind: "CREATE_ORGANIZATION", organizationId: "org.operations", commandId: "o1", occurredAt: at,
    ownerUserId: "user.owner", name: "Operations Organisation", slug: "operations-organisation" });
  await platform.execute({ kind: "CREATE_CLUB", organizationId: "org.operations", commandId: "o2", occurredAt: at,
    actorUserId: "user.owner", clubId: "club.main", name: "Main Club", timezone: "Europe/Athens" });
  await platform.execute({ kind: "INVITE_MEMBER", organizationId: "org.operations", commandId: "o3", occurredAt: at,
    actorUserId: "user.owner", invitationId: "invite.director", email: "director@example.test", role: "TOURNAMENT_DIRECTOR",
    clubIds: ["club.main"], invitationToken: "operations-director-token", expiresAt: "2026-09-14T09:00:00.000Z" });
  await platform.execute({ kind: "ACCEPT_INVITATION", organizationId: "org.operations", commandId: "o4", occurredAt: at,
    userId: "user.director", invitationToken: "operations-director-token" });
  await platform.execute({ kind: "CREATE_TOURNAMENT", organizationId: "org.operations", commandId: "o5", occurredAt: at,
    actorUserId: "user.owner", tournamentId: "tournament.live", clubId: "club.main", name: "Live Open",
    startsAt: "2026-09-07T09:00:00.000Z", definition: evidence.definition });
  await platform.execute({ kind: "CHANGE_TOURNAMENT_STATUS", organizationId: "org.operations", commandId: "o6", occurredAt: at,
    actorUserId: "user.owner", tournamentId: "tournament.live", status: "UNDER_REVIEW" });
  await platform.execute({ kind: "CHANGE_TOURNAMENT_STATUS", organizationId: "org.operations", commandId: "o7", occurredAt: at,
    actorUserId: "user.director", tournamentId: "tournament.live", status: "APPROVED" });
  await platform.execute({ kind: "CERTIFY_TOURNAMENT_PUBLICATION", organizationId: "org.operations", commandId: "o8", occurredAt: at,
    actorUserId: "user.owner", tournamentId: "tournament.live",
    guardInput: { spec: evidence.spec, graph: evidence.scenario.graph, schedule: evidence.scenario.schedule,
      ...(evidence.scenario.simulation ? { simulation: evidence.scenario.simulation } : {}) },
    acknowledgedFindingCodes: evidence.report.requiredAcknowledgementCodes });
  await platform.execute({ kind: "CHANGE_TOURNAMENT_STATUS", organizationId: "org.operations", commandId: "o9", occurredAt: at,
    actorUserId: "user.owner", tournamentId: "tournament.live", status: "PUBLISHED" });
  await platform.execute({ kind: "INITIALIZE_LIVE_OPERATIONS", organizationId: "org.operations", commandId: "o10", occurredAt: at,
    actorUserId: "user.owner", tournamentId: "tournament.live", definition: { tournamentId: "tournament.live", courts: ["court.1", "court.2"], contests: [
      { contestId: "match.1", entrantIds: ["entrant.1", "entrant.2"], courtId: "court.1",
        scheduledStart: "2026-09-07T09:00:00.000Z", scheduledEnd: "2026-09-07T09:30:00.000Z" },
      { contestId: "match.2", entrantIds: ["entrant.3", "entrant.4"], courtId: "court.1",
        scheduledStart: "2026-09-07T09:30:00.000Z", scheduledEnd: "2026-09-07T10:00:00.000Z" },
    ] } });
  let liveVersion = 0;
  for (const liveCommand of [
    { kind: "CHECK_IN", entrantId: "entrant.1" }, { kind: "CHECK_IN", entrantId: "entrant.2" },
    { kind: "START_CONTEST", contestId: "match.1", courtId: "court.1", startedAt: "2026-09-07T09:00:00.000Z" },
    { kind: "COMPLETE_CONTEST", contestId: "match.1", endedAt: "2026-09-07T09:28:00.000Z" },
  ] as const) {
    await platform.execute({ kind: "APPLY_LIVE_OPERATION", organizationId: "org.operations", commandId: `o${11 + liveVersion}`, occurredAt: at,
      actorUserId: "user.owner", tournamentId: "tournament.live", liveCommand: { ...liveCommand, commandId: `live.${liveVersion + 1}`,
        expectedVersion: liveVersion, actorId: "user.owner", occurredAt: at } });
    liveVersion += 1;
  }
  await platform.execute({ kind: "RECORD_SCORE", organizationId: "org.operations", commandId: "o15", occurredAt: at,
    actorUserId: "user.owner", tournamentId: "tournament.live", contestId: "match.1", expectedScoreRevision: 0,
    winnerEntrantId: "entrant.1", score: { sets: [[6, 4], [6, 3]] }, source: "operator:user.owner" });
  await platform.execute({ kind: "PROPOSE_SCHEDULE_REPAIR", organizationId: "org.operations", commandId: "o16", occurredAt: at,
    actorUserId: "user.owner", tournamentId: "tournament.live", proposalId: "repair.1", maxSearchNodes: 10000,
    request: { problem: { id: "repair", minimumRestMinutes: 0, locks: [], tasks: [
      { id: "A", durationMinutes: 20, eligibleResourceIds: ["court.1", "court.2"], dependencyIds: [], participantIds: ["entrant.1", "entrant.2"] },
    ], resources: [
      { id: "court.1", calendars: [{ startMinute: 0, endMinute: 60 }], closures: [{ startMinute: 0, endMinute: 30 }] },
      { id: "court.2", calendars: [{ startMinute: 0, endMinute: 60 }], closures: [] },
    ] }, baseline: [{ taskId: "A", resourceId: "court.1", startMinute: 0, endMinute: 20, locked: false }] } });
  await platform.execute({ kind: "DECIDE_REPAIR_PROPOSAL", organizationId: "org.operations", commandId: "o17", occurredAt: at,
    actorUserId: "user.director", tournamentId: "tournament.live", proposalId: "repair.1", decision: "APPROVED" });
  await platform.execute({ kind: "PROPOSE_LIVE_CHANGE", organizationId: "org.operations", commandId: "o18", occurredAt: at,
    actorUserId: "user.owner", tournamentId: "tournament.live", proposalId: "change.court-outage",
    liveCommand: { kind: "CLOSE_COURT", courtId: "court.1", reason: "Unsafe surface", expectedReopenAt: "2026-09-07T10:00:00.000Z",
      commandId: "live.change.1", expectedVersion: 4, actorId: "user.owner", occurredAt: at }, maxSearchNodes: 10000,
    repairRequest: { problem: { id: "live-change-repair", minimumRestMinutes: 0, locks: [], tasks: [
      { id: "match.2", durationMinutes: 30, eligibleResourceIds: ["court.1", "court.2"], dependencyIds: [], participantIds: ["entrant.3", "entrant.4"] },
    ], resources: [
      { id: "court.1", calendars: [{ startMinute: 0, endMinute: 90 }], closures: [{ startMinute: 30, endMinute: 60 }] },
      { id: "court.2", calendars: [{ startMinute: 0, endMinute: 90 }], closures: [] },
    ] }, baseline: [{ taskId: "match.2", resourceId: "court.1", startMinute: 30, endMinute: 60, locked: false }], freezeThroughMinute: 30 } });
  await platform.execute({ kind: "DECIDE_LIVE_CHANGE", organizationId: "org.operations", commandId: "o19", occurredAt: at,
    actorUserId: "user.director", tournamentId: "tournament.live", proposalId: "change.court-outage", decision: "APPROVED" });

  const state = await createOrganizationPlatform(store).read("org.operations");
  assert.equal(state.liveOperations["tournament.live"]?.version, 5);
  assert.equal(state.liveOperations["tournament.live"]?.resources.courts["court.1"]?.available, false);
  assert.equal(state.scores["tournament.live:match.1"]?.revisions[0]?.winnerEntrantId, "entrant.1");
  assert.equal(state.repairProposals["repair.1"]?.status, "APPROVED");
  assert.deepEqual(state.repairProposals["repair.1"]?.result.diff.map(({ taskId }) => taskId), ["A"]);
  assert.equal(state.liveChangeProposals["change.court-outage"]?.status, "APPROVED");
  assert.deepEqual(state.liveChangeProposals["change.court-outage"]?.proposal.impact.movedContestIds, ["match.2"]);
  assert.deepEqual(store.outbox.list().map(({ topic }) => topic), ["competition.publication.v1", "competition.live-change.approved.v1"]);
  assert.deepEqual((await platform.dashboard("org.operations", "user.director")).liveChangeProposals.map(({ id, status }) => ({ id, status })),
    [{ id: "change.court-outage", status: "APPROVED" }]);
});
