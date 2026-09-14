import {
  createInMemoryEventStore,
  createOrganizationPlatform,
  createOrganizationPlatformApi,
  evaluateCompetitionGuard,
  type OrganizationPlatform,
  type OrganizationPlatformApi,
  type PlatformApiPrincipal,
} from "@tournament-os/competition-engine";
import { buildPilotScheduleDecision, type PilotScheduleDecision } from "./pilot-journey.js";
import { runReferenceDemo } from "./demo.js";

const organizationId = "org.demo";
const ownerUserId = "user.demo-owner";
const directorUserId = "user.demo-director";
const pilotTournamentId = "tournament.play-konnect-pilot";
const pilotProposalId = "change.play-konnect.court-outage";
const occurredAt = "2026-09-07T09:00:00.000Z";

export interface PilotJourneyView {
  readonly tournamentId: string;
  readonly tournamentName: string;
  readonly lifecycleStatus: string;
  readonly intent: {
    readonly source: string;
    readonly summary: string;
    readonly resolvedAssumptions: readonly string[];
    readonly unresolvedQuestions: readonly string[];
  };
  readonly scheduleDecision: Readonly<PilotScheduleDecision>;
  readonly publication: {
    readonly status: "READY_TO_PUBLISH" | "PUBLISHED" | "STALE";
    readonly guardStatus: "PASSED" | "BLOCKED";
    readonly requiredContestCount: number;
    readonly scheduledContestCount: number;
    readonly trueSpareCapacityMinutes: number;
    readonly guardReportHash: string;
    readonly certificateHash: string | null;
  };
  readonly liveChange: {
    readonly status: "NONE" | "READY_FOR_APPROVAL" | "BLOCKED" | "APPROVED" | "REJECTED";
    readonly title: string;
    readonly movedContestIds: readonly string[];
    readonly affectedEntrantIds: readonly string[];
    readonly resourceChangeCount: number;
    readonly finishDeltaMinutes: number;
    readonly notificationCount: number;
    readonly proofHash: string | null;
    readonly approvedBy: string | null;
  };
}

export interface PlatformDemo {
  readonly platform: OrganizationPlatform;
  readonly api: OrganizationPlatformApi;
  readonly principal: PlatformApiPrincipal;
  readonly directorPrincipal: PlatformApiPrincipal;
  pilotJourney(): Promise<Readonly<PilotJourneyView>>;
  publishPilot(): Promise<Readonly<PilotJourneyView>>;
  proposePilotOutage(): Promise<Readonly<PilotJourneyView>>;
  approvePilotOutage(): Promise<Readonly<PilotJourneyView>>;
  workspace(): Promise<Readonly<{
    dashboard: Awaited<ReturnType<OrganizationPlatform["dashboard"]>>;
    directory: {
      players: readonly unknown[]; teams: readonly unknown[]; venues: readonly unknown[]; courts: readonly unknown[];
      officials: readonly unknown[]; equipment: readonly unknown[];
    };
    creationGuides: readonly unknown[];
    clubDefaultFormats: Readonly<Record<string, unknown>>;
    governance: {
      memberships: readonly unknown[];
      invitations: readonly unknown[];
      accounts: readonly unknown[];
    };
  }>>;
}

export async function createPlatformDemo(): Promise<PlatformDemo> {
  const platform = createOrganizationPlatform(createInMemoryEventStore());
  const reference = runReferenceDemo().scenario;
  let sequence = 0;
  const commandId = () => `demo.${++sequence}`;
  await platform.execute({ kind: "CREATE_ORGANIZATION", organizationId, commandId: commandId(), occurredAt,
    ownerUserId, ownerEmail: "owner@tournamentos.example", name: "TournamentOS Demonstration", slug: "tournamentos-demo" });
  for (const [clubId, name] of [["club.harbour", "Harbour Padel Club"], ["club.hills", "Hills Racquet Club"]] as const) {
    await platform.execute({ kind: "CREATE_CLUB", organizationId, commandId: commandId(), occurredAt,
      actorUserId: ownerUserId, clubId, name, timezone: "Europe/Athens" });
  }
  await platform.execute({ kind: "INVITE_MEMBER", organizationId, commandId: commandId(), occurredAt, actorUserId: ownerUserId,
    invitationId: "invite.demo-director", email: "director@tournamentos.example", role: "TOURNAMENT_DIRECTOR",
    clubIds: ["club.harbour", "club.hills"], invitationToken: "demo-director-invitation-token", expiresAt: "2026-09-14T09:00:00.000Z" });
  await platform.execute({ kind: "ACCEPT_INVITATION", organizationId, commandId: commandId(), occurredAt,
    userId: "user.demo-director", invitationToken: "demo-director-invitation-token" });
  const players = [
    ["player.maya", "Maya Haddad", "club.harbour"], ["player.nora", "Nora Saleh", "club.harbour"],
    ["player.leila", "Leila Mansour", "club.hills"], ["player.rana", "Rana Nassar", "club.hills"],
  ] as const;
  for (const [id, displayName, clubId] of players) await platform.execute({ kind: "UPSERT_PLAYER", organizationId,
    commandId: commandId(), occurredAt, actorUserId: ownerUserId,
    player: { id, displayName, clubIds: [clubId], externalIds: {}, status: "ACTIVE" } });
  for (const [id, clubId, name, playerIds] of [
    ["team.harbour-1", "club.harbour", "Maya / Nora", ["player.maya", "player.nora"]],
    ["team.hills-1", "club.hills", "Leila / Rana", ["player.leila", "player.rana"]],
  ] as const) await platform.execute({ kind: "UPSERT_TEAM", organizationId, commandId: commandId(), occurredAt,
    actorUserId: ownerUserId, team: { id, clubId, name, playerIds, status: "ACTIVE" } });
  for (const [venueId, clubId, name] of [["venue.harbour", "club.harbour", "Harbour Courts"], ["venue.hills", "club.hills", "Hills Centre"]] as const) {
    await platform.execute({ kind: "UPSERT_VENUE", organizationId, commandId: commandId(), occurredAt, actorUserId: ownerUserId,
      venue: { id: venueId, clubId, name, timezone: "Europe/Athens", status: "ACTIVE" } });
    await platform.execute({ kind: "UPSERT_COURT", organizationId, commandId: commandId(), occurredAt, actorUserId: ownerUserId,
      court: { id: `${venueId}.court.1`, venueId, name: "Court 1", sportTags: ["padel"], status: "ACTIVE" } });
  }
  await platform.execute({ kind: "UPSERT_OFFICIAL", organizationId, commandId: commandId(), occurredAt, actorUserId: ownerUserId,
    official: { id: "official.rami", displayName: "Rami Daher", clubIds: ["club.harbour", "club.hills"], certifications: ["padel.referee"], status: "ACTIVE" } });
  await platform.execute({ kind: "UPSERT_EQUIPMENT", organizationId, commandId: commandId(), occurredAt, actorUserId: ownerUserId,
    equipment: { id: "equipment.scoreboard.1", venueId: "venue.harbour", name: "Scoreboard 1", kind: "SCOREBOARD", status: "ACTIVE" } });
  await platform.execute({ kind: "CREATE_FORMAT_TEMPLATE", organizationId, commandId: commandId(), occurredAt, actorUserId: ownerUserId,
    templateId: "format.padel-club-night", name: "Padel club night", sport: "padel", version: "1.0.0",
    summary: "Pools into a seeded knockout", definition: { stages: ["round_robin", "single_elimination"], minimumMatches: 3 } });
  await platform.execute({ kind: "APPROVE_FORMAT_VERSION", organizationId, commandId: commandId(), occurredAt,
    actorUserId: "user.demo-director", templateId: "format.padel-club-night", version: "1.0.0" });
  await platform.execute({ kind: "SET_CLUB_DEFAULT_FORMAT", organizationId, commandId: commandId(), occurredAt, actorUserId: ownerUserId,
    clubId: "club.harbour", templateId: "format.padel-club-night", version: "1.0.0" });
  await platform.execute({ kind: "CREATE_SEASON", organizationId, commandId: commandId(), occurredAt, actorUserId: ownerUserId,
    season: { id: "season.harbour.2026", clubId: "club.harbour", name: "Harbour 2026", startsOn: "2026-01-01", endsOn: "2026-12-31", status: "ACTIVE" } });
  for (const [tournamentId, clubId, name, startsAt] of [
    ["tournament.harbour-open", "club.harbour", "Harbour Open", "2026-10-10T08:00:00.000Z"],
    ["tournament.city-cup", "club.harbour", "City Cup", "2026-11-08T08:00:00.000Z"],
    ["tournament.hills-series", "club.hills", "Hills Series", "2026-10-24T08:00:00.000Z"],
  ] as const) await platform.execute({ kind: "CREATE_TOURNAMENT", organizationId, commandId: commandId(), occurredAt,
    actorUserId: ownerUserId, tournamentId, clubId, name, startsAt, definition: { formatTemplate: "format.padel-club-night@1.0.0" } });
  await platform.execute({ kind: "CREATE_TOURNAMENT", organizationId, commandId: commandId(), occurredAt,
    actorUserId: ownerUserId, tournamentId: pilotTournamentId, clubId: "club.harbour", name: "Play & Konnect Pilot",
    startsAt: "2026-10-10T08:00:00.000Z", definition: reference.spec as never });
  await platform.execute({ kind: "CHANGE_TOURNAMENT_STATUS", organizationId, commandId: commandId(), occurredAt,
    actorUserId: ownerUserId, tournamentId: pilotTournamentId, status: "UNDER_REVIEW" });
  await platform.execute({ kind: "CHANGE_TOURNAMENT_STATUS", organizationId, commandId: commandId(), occurredAt,
    actorUserId: directorUserId, tournamentId: pilotTournamentId, status: "APPROVED" });
  await platform.execute({ kind: "RAISE_OPERATIONAL_ALERT", organizationId, commandId: commandId(), occurredAt, actorUserId: ownerUserId,
    alert: { id: "alert.harbour", clubId: "club.harbour", tournamentId: "tournament.harbour-open", severity: "ACTION_REQUIRED",
      title: "Participant decision needed", detail: "Two imported entrants require eligibility review." } });

  const principal = { organizationId, userId: ownerUserId } as const;
  const directorPrincipal = { organizationId, userId: directorUserId } as const;
  let apiClock = Date.parse("2026-10-10T07:49:00.000Z");
  const api = createOrganizationPlatformApi({ platform, now: () => new Date(apiClock += 60_000).toISOString() });

  const pilotJourney = async (): Promise<Readonly<PilotJourneyView>> => {
    const state = await platform.read(organizationId);
    const tournament = state.tournaments[pilotTournamentId]!;
    const latest = tournament.revisions.at(-1)!;
    const publicationRecord = state.publicationRecords[pilotTournamentId]?.at(-1);
    const guard = publicationRecord?.report ?? evaluateCompetitionGuard({ sourceDefinitionHash: latest.definitionHash,
      spec: reference.spec, graph: reference.graph, schedule: reference.schedule,
      ...(reference.simulation ? { simulation: reference.simulation } : {}) });
    const liveChange = state.liveChangeProposals[pilotProposalId];
    return {
      tournamentId: pilotTournamentId,
      tournamentName: tournament.name,
      lifecycleStatus: tournament.status,
      intent: {
        source: "47 padel pairs across seven courts, split into beginner and intermediate divisions, with pools feeding placement brackets.",
        summary: "Every pair gets its promised pool pathway before seeded progression; the published plan contains 98 contests.",
        resolvedAssumptions: ["Seven courts are available in the declared windows", "Scoring uses the pinned Padel 1.0.0 rule pack", "Pool ties use the approved standings policy"],
        unresolvedQuestions: [],
      },
      scheduleDecision: buildPilotScheduleDecision(),
      publication: {
        status: tournament.status === "PUBLISHED" || tournament.status === "LIVE" || tournament.status === "COMPLETED" ? "PUBLISHED"
          : publicationRecord && publicationRecord.tournamentRevision !== latest.revision ? "STALE" : "READY_TO_PUBLISH",
        guardStatus: guard.status,
        requiredContestCount: guard.accounting.requiredContestCount,
        scheduledContestCount: guard.accounting.scheduledContestCount,
        trueSpareCapacityMinutes: guard.accounting.trueSpareCapacityMinutes,
        guardReportHash: guard.reportHash,
        certificateHash: publicationRecord?.certificate.certificateHash ?? null,
      },
      liveChange: liveChange ? {
        status: liveChange.status,
        title: "Centre Court is temporarily unavailable",
        movedContestIds: liveChange.proposal.impact.movedContestIds,
        affectedEntrantIds: liveChange.proposal.impact.affectedEntrantIds,
        resourceChangeCount: liveChange.proposal.impact.resourceChangeCount,
        finishDeltaMinutes: liveChange.proposal.impact.finishDeltaMinutes,
        notificationCount: liveChange.proposal.notificationDrafts.length,
        proofHash: liveChange.approved?.approvalHash ?? liveChange.proposal.proofHash,
        approvedBy: liveChange.approved?.approvedBy ?? null,
      } : {
        status: "NONE", title: "No live disruption has been proposed", movedContestIds: [], affectedEntrantIds: [],
        resourceChangeCount: 0, finishDeltaMinutes: 0, notificationCount: 0, proofHash: null, approvedBy: null,
      },
    };
  };

  const accepted = async (result: Awaited<ReturnType<OrganizationPlatformApi["handle"]>>): Promise<void> => {
    if (result.status !== 200) throw new Error(`Pilot command failed: ${JSON.stringify(result.body)}`);
  };

  const publishPilot = async (): Promise<Readonly<PilotJourneyView>> => {
    const current = await pilotJourney();
    if (current.publication.status === "PUBLISHED") return current;
    await accepted(await api.handle({ method: "POST", path: "/v1/organizations/org.demo/commands", principal,
      idempotencyKey: "pilot.publish.v1", body: { kind: "PUBLISH_TOURNAMENT", tournamentId: pilotTournamentId,
        guardInput: { spec: reference.spec, graph: reference.graph, schedule: reference.schedule,
          ...(reference.simulation ? { simulation: reference.simulation } : {}) },
        acknowledgedFindingCodes: current.publication.guardStatus === "PASSED"
          ? (evaluateCompetitionGuard({ sourceDefinitionHash: (await platform.read(organizationId)).tournaments[pilotTournamentId]!.revisions.at(-1)!.definitionHash,
            spec: reference.spec, graph: reference.graph, schedule: reference.schedule,
            ...(reference.simulation ? { simulation: reference.simulation } : {}) }).requiredAcknowledgementCodes) : [] } }));
    await accepted(await api.handle({ method: "POST", path: "/v1/organizations/org.demo/commands", principal,
      idempotencyKey: "pilot.live.initialize.v1", body: { kind: "INITIALIZE_LIVE_OPERATIONS", tournamentId: pilotTournamentId,
        definition: {
          tournamentId: pilotTournamentId,
          courts: ["Centre Court", "Harbour Court"],
          contests: [
            { contestId: "Opening match 1", entrantIds: ["pair.1", "pair.2"], courtId: "Centre Court",
              scheduledStart: "2026-10-10T08:00:00.000Z", scheduledEnd: "2026-10-10T08:20:00.000Z" },
            { contestId: "Opening match 2", entrantIds: ["pair.3", "pair.4"], courtId: "Centre Court",
              scheduledStart: "2026-10-10T08:30:00.000Z", scheduledEnd: "2026-10-10T08:50:00.000Z" },
          ],
        } } }));
    return pilotJourney();
  };

  const proposePilotOutage = async (): Promise<Readonly<PilotJourneyView>> => {
    const current = await pilotJourney();
    if (current.liveChange.status !== "NONE") return current;
    const state = await platform.read(organizationId);
    const live = state.liveOperations[pilotTournamentId]!;
    await accepted(await api.handle({ method: "POST", path: "/v1/organizations/org.demo/commands", principal,
      idempotencyKey: "pilot.outage.propose.v1", body: { kind: "PROPOSE_LIVE_CHANGE", tournamentId: pilotTournamentId,
        proposalId: pilotProposalId, liveCommand: { kind: "CLOSE_COURT", courtId: "Centre Court", reason: "Unsafe wet surface",
          expectedReopenAt: "2026-10-10T08:30:00.000Z", expectedVersion: live.version },
        repairRequest: { problem: { id: "pilot.outage.repair", minimumRestMinutes: 0, locks: [], tasks: [
          { id: "Opening match 1", durationMinutes: 20, eligibleResourceIds: ["Centre Court", "Harbour Court"], dependencyIds: [], participantIds: ["pair.1", "pair.2"] },
          { id: "Opening match 2", durationMinutes: 20, eligibleResourceIds: ["Centre Court", "Harbour Court"], dependencyIds: [], participantIds: ["pair.3", "pair.4"] },
        ], resources: [
          { id: "Centre Court", calendars: [{ startMinute: 0, endMinute: 60 }], closures: [{ startMinute: 0, endMinute: 30 }] },
          { id: "Harbour Court", calendars: [{ startMinute: 0, endMinute: 60 }], closures: [] },
        ] }, baseline: [
          { taskId: "Opening match 1", resourceId: "Centre Court", startMinute: 0, endMinute: 20, locked: false },
          { taskId: "Opening match 2", resourceId: "Centre Court", startMinute: 30, endMinute: 50, locked: false },
        ], freezeThroughMinute: 0 }, maxSearchNodes: 100_000 } }));
    return pilotJourney();
  };

  const approvePilotOutage = async (): Promise<Readonly<PilotJourneyView>> => {
    const current = await pilotJourney();
    if (current.liveChange.status === "APPROVED") return current;
    if (current.liveChange.status === "NONE") await proposePilotOutage();
    await accepted(await api.handle({ method: "POST", path: "/v1/organizations/org.demo/commands", principal: directorPrincipal,
      idempotencyKey: "pilot.outage.approve.v1", body: { kind: "DECIDE_LIVE_CHANGE", tournamentId: pilotTournamentId,
        proposalId: pilotProposalId, decision: "APPROVED" } }));
    return pilotJourney();
  };
  return {
    platform, api, principal, directorPrincipal, pilotJourney, publishPilot, proposePilotOutage, approvePilotOutage,
    workspace: async () => {
      const state = await platform.read(organizationId);
      return {
        dashboard: await platform.dashboard(organizationId, ownerUserId),
        directory: { players: Object.values(state.players), teams: Object.values(state.teams), venues: Object.values(state.venues),
          courts: Object.values(state.courts), officials: Object.values(state.officials), equipment: Object.values(state.equipment) },
        creationGuides: Object.values(state.creationGuides), clubDefaultFormats: state.clubDefaultFormats,
        governance: {
          memberships: Object.values(state.memberships),
          invitations: Object.values(state.invitations).map(({ tokenHash: _tokenHash, ...invitation }) => invitation),
          accounts: Object.values(state.accounts).map(({ userId, email, status }) => ({ userId, email, status })),
        },
      };
    },
  };
}
