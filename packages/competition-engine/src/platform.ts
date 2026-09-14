import { createHash } from "node:crypto";
import { canonicalHash, deepFreeze } from "@tournament-os/tournament-schema";
import { IdempotencyConflictError, type EventEnvelope, type EventStoreAdapter, type JsonValue, type ProposedEvent } from "./event-store.js";
import { createLiveOperationsState, submitLiveOperationsCommand,
  type LiveOperationsCommand, type LiveOperationsDefinition, type LiveOperationsState } from "./live-operations.js";
import { approveLiveChange, proposeLiveChange,
  type ApprovedLiveChange, type LiveChangeProposal } from "./live-change.js";
import { planMinimalChangeScheduleRepair,
  type MinimalChangeScheduleRepairResult, type ScheduleRepairRequest } from "./schedule-repair.js";
import {
  createPublicationCertificate,
  evaluateCompetitionGuard,
  verifyPublicationCertificate,
  type CompetitionGuardInput,
  type CompetitionGuardReport,
  type PublicationCertificate,
} from "./competition-guard.js";

export type PlatformRole = "OWNER" | "CLUB_ADMIN" | "TOURNAMENT_DIRECTOR" | "OPERATOR" | "OFFICIAL" | "VIEWER";

export interface PlatformOrganization {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly status: "ACTIVE" | "SUSPENDED";
  readonly createdAt: string;
}

export interface PlatformClub {
  readonly id: string;
  readonly name: string;
  readonly timezone: string;
  readonly status: "ACTIVE" | "ARCHIVED";
}

export interface PlatformMembership {
  readonly userId: string;
  readonly role: PlatformRole;
  readonly clubIds: readonly string[];
  readonly status: "ACTIVE" | "SUSPENDED";
}

export interface PlatformInvitation {
  readonly id: string;
  readonly email: string;
  readonly role: PlatformRole;
  readonly clubIds: readonly string[];
  readonly tokenHash: string;
  readonly expiresAt: string;
  readonly status: "PENDING" | "ACCEPTED" | "REVOKED" | "EXPIRED";
  readonly acceptedByUserId?: string;
}

export type DirectoryStatus = "ACTIVE" | "ARCHIVED";
export interface PlatformPlayer { readonly id: string; readonly displayName: string; readonly clubIds: readonly string[];
  readonly externalIds: Readonly<Record<string, string>>; readonly status: DirectoryStatus; readonly email?: string; readonly linkedUserId?: string }
export interface PlatformTeam { readonly id: string; readonly clubId: string; readonly name: string; readonly playerIds: readonly string[]; readonly status: DirectoryStatus }
export interface PlatformVenue { readonly id: string; readonly clubId: string; readonly name: string; readonly timezone: string; readonly status: DirectoryStatus; readonly address?: string }
export interface PlatformCourt { readonly id: string; readonly venueId: string; readonly name: string; readonly sportTags: readonly string[]; readonly status: DirectoryStatus }
export interface PlatformOfficial { readonly id: string; readonly displayName: string; readonly clubIds: readonly string[]; readonly certifications: readonly string[]; readonly status: DirectoryStatus }
export interface PlatformEquipment { readonly id: string; readonly venueId: string; readonly name: string; readonly kind: string; readonly status: DirectoryStatus }
export type TournamentLifecycleStatus = "DRAFT" | "UNDER_REVIEW" | "APPROVED" | "PUBLISHED" | "LIVE" | "COMPLETED" | "ARCHIVED";
export interface PlatformTournamentRevision { readonly revision: number; readonly definition: JsonValue; readonly definitionHash: string;
  readonly summary: string; readonly createdBy: string; readonly createdAt: string }
export interface PlatformTournament { readonly id: string; readonly clubId: string; readonly name: string; readonly startsAt: string;
  readonly status: TournamentLifecycleStatus; readonly revisions: readonly PlatformTournamentRevision[]; readonly createdAt: string;
  readonly updatedAt: string; readonly approvedBy?: string; readonly approvedAt?: string; readonly approvedRevision?: number;
  readonly approvedDefinitionHash?: string; readonly approvedArtifactSetHash?: string; readonly approvedGuardReportHash?: string;
  readonly publishedBy?: string; readonly publishedCertificateHash?: string;
  readonly duplicatedFromTournamentId?: string }
export type FormatVersionStatus = "DRAFT" | "APPROVED" | "DEPRECATED";
export interface PlatformFormatVersion { readonly version: string; readonly basedOnVersion: string | null; readonly definition: JsonValue;
  readonly definitionHash: string; readonly summary: string; readonly status: FormatVersionStatus; readonly createdBy: string;
  readonly createdAt: string; readonly approvedBy?: string }
export interface PlatformFormatTemplate { readonly id: string; readonly name: string; readonly sport: string; readonly status: "ACTIVE" | "DEPRECATED";
  readonly versions: readonly PlatformFormatVersion[]; readonly createdAt: string; readonly updatedAt: string }
export interface PlatformFormatReference { readonly templateId: string; readonly version: string }
export type GuidedCreationStep = "PARTICIPANTS" | "FORMAT" | "RULES" | "RESOURCES" | "PRIORITIES" | "REVIEW";
export interface PlatformCreationGuide { readonly tournamentId: string; readonly status: "IN_PROGRESS" | "COMPLETE";
  readonly currentStep: GuidedCreationStep | null; readonly completedSteps: readonly GuidedCreationStep[];
  readonly inputs: Readonly<Partial<Record<GuidedCreationStep, JsonValue>>>; readonly reviewHash?: string }
export interface PlatformSeason { readonly id: string; readonly clubId: string; readonly name: string; readonly startsOn: string;
  readonly endsOn: string; readonly status: "PLANNED" | "ACTIVE" | "COMPLETE" | "ARCHIVED" }
export type OperationalAlertSeverity = "INFORMATION" | "WARNING" | "ACTION_REQUIRED";
export interface PlatformOperationalAlert { readonly id: string; readonly clubId: string; readonly tournamentId: string;
  readonly severity: OperationalAlertSeverity; readonly title: string; readonly detail: string; readonly status: "OPEN" | "ACKNOWLEDGED";
  readonly createdAt: string; readonly acknowledgedBy?: string; readonly acknowledgedAt?: string }
export interface PlatformPublicationReadiness { readonly tournamentId: string; readonly tournamentRevision: number;
  readonly status: "UNCERTIFIED" | "CERTIFIED" | "PUBLISHED" | "STALE"; readonly certificateHash?: string;
  readonly guardReportHash?: string; readonly assessedAt?: string }
export interface PlatformDashboard {
  readonly organization: PlatformOrganization;
  readonly clubs: readonly PlatformClub[];
  readonly seasons: readonly PlatformSeason[];
  readonly tournaments: readonly PlatformTournament[];
  readonly alerts: readonly PlatformOperationalAlert[];
  readonly liveChangeProposals: readonly PlatformLiveChangeProposal[];
  readonly publicationReadiness: readonly PlatformPublicationReadiness[];
  readonly formatTemplates: readonly PlatformFormatTemplate[];
  readonly tournamentCounts: Readonly<Record<TournamentLifecycleStatus, number>>;
  readonly directoryCounts: Readonly<{ players: number; teams: number; venues: number; courts: number; officials: number; equipment: number }>;
}
export interface PlatformAccount { readonly userId: string; readonly email: string | null; readonly status: "ACTIVE" | "ANONYMIZED";
  readonly credentialVersion: number; readonly deletedAt?: string; readonly deletionReason?: string }
export interface PlatformRecoveryRequest { readonly id: string; readonly userId: string; readonly tokenHash: string; readonly expiresAt: string;
  readonly status: "PENDING" | "COMPLETED"; readonly requestedAt: string; readonly completedAt?: string }
export type NotificationChannel = "EMAIL" | "SMS" | "PUSH" | "IN_APP";
export interface PlatformNotification { readonly id: string; readonly clubId: string; readonly channel: NotificationChannel;
  readonly recipientPlayerIds: readonly string[]; readonly templateKey: string; readonly data: JsonValue;
  readonly status: "QUEUED" | "DELIVERED" | "FAILED"; readonly attempts: number; readonly createdAt: string; readonly deliveredAt?: string; readonly lastError?: string }
export interface PlatformPrivacyExport { readonly schemaVersion: "1.0.0"; readonly organizationId: string; readonly subjectUserId: string;
  readonly account: PlatformAccount; readonly membership: PlatformMembership; readonly players: readonly PlatformPlayer[];
  readonly notifications: readonly PlatformNotification[]; readonly exportHash: string }
export interface OrganizationBackup { readonly schemaVersion: "1.0.0"; readonly organizationId: string; readonly sourceVersion: number;
  readonly state: OrganizationPlatformState; readonly stateHash: string }
export interface PlatformScoreRevision { readonly revision: number; readonly winnerEntrantId: string; readonly score: JsonValue;
  readonly source: string; readonly recordedBy: string; readonly recordedAt: string; readonly proofHash: string; readonly correctionReason?: string }
export interface PlatformScoreRecord { readonly tournamentId: string; readonly contestId: string; readonly revisions: readonly PlatformScoreRevision[] }
export interface PlatformRepairProposal { readonly id: string; readonly tournamentId: string; readonly status: "PROPOSED" | "APPROVED" | "REJECTED";
  readonly result: MinimalChangeScheduleRepairResult; readonly createdBy: string; readonly createdAt: string;
  readonly decidedBy?: string; readonly decidedAt?: string }
export interface PlatformLiveChangeProposal { readonly id: string; readonly tournamentId: string;
  readonly status: "READY_FOR_APPROVAL" | "BLOCKED" | "APPROVED" | "REJECTED"; readonly proposal: LiveChangeProposal;
  readonly createdBy: string; readonly createdAt: string; readonly approved?: ApprovedLiveChange;
  readonly decidedBy?: string; readonly decidedAt?: string }
export interface PlatformPublicationRecord { readonly tournamentId: string; readonly tournamentRevision: number;
  readonly definitionHash: string; readonly report: CompetitionGuardReport; readonly certificate: PublicationCertificate;
  readonly assessedBy: string; readonly assessedAt: string }

export interface AuthoritativePublicationArtifacts {
  readonly organizationId: string;
  readonly tournamentId: string;
  readonly tournamentRevision: number;
  readonly definitionHash: string;
  readonly compiledBy: string;
  readonly compiledAt: string;
  readonly spec: CompetitionGuardInput["spec"];
  readonly specHash: string;
  readonly graph: CompetitionGuardInput["graph"];
  readonly graphHash: string;
  readonly schedule: CompetitionGuardInput["schedule"];
  readonly scheduleHash: string;
  readonly simulation?: CompetitionGuardInput["simulation"];
  readonly simulationHash?: string;
}

export interface AuthoritativePublicationArtifactResolver {
  load(input: { readonly organizationId: string; readonly tournamentId: string; readonly tournamentRevision: number }):
    Promise<Readonly<AuthoritativePublicationArtifacts> | undefined>;
}

export interface OrganizationPlatformOptions {
  readonly publicationArtifacts?: AuthoritativePublicationArtifactResolver;
}

export interface OrganizationPlatformState {
  readonly organization: PlatformOrganization | null;
  readonly clubs: Readonly<Record<string, PlatformClub>>;
  readonly memberships: Readonly<Record<string, PlatformMembership>>;
  readonly invitations: Readonly<Record<string, PlatformInvitation>>;
  readonly players: Readonly<Record<string, PlatformPlayer>>;
  readonly teams: Readonly<Record<string, PlatformTeam>>;
  readonly venues: Readonly<Record<string, PlatformVenue>>;
  readonly courts: Readonly<Record<string, PlatformCourt>>;
  readonly officials: Readonly<Record<string, PlatformOfficial>>;
  readonly equipment: Readonly<Record<string, PlatformEquipment>>;
  readonly tournaments: Readonly<Record<string, PlatformTournament>>;
  readonly formatTemplates: Readonly<Record<string, PlatformFormatTemplate>>;
  readonly clubDefaultFormats: Readonly<Record<string, PlatformFormatReference>>;
  readonly creationGuides: Readonly<Record<string, PlatformCreationGuide>>;
  readonly seasons: Readonly<Record<string, PlatformSeason>>;
  readonly operationalAlerts: Readonly<Record<string, PlatformOperationalAlert>>;
  readonly accounts: Readonly<Record<string, PlatformAccount>>;
  readonly recoveryRequests: Readonly<Record<string, PlatformRecoveryRequest>>;
  readonly notifications: Readonly<Record<string, PlatformNotification>>;
  readonly liveOperations: Readonly<Record<string, LiveOperationsState>>;
  readonly scores: Readonly<Record<string, PlatformScoreRecord>>;
  readonly repairProposals: Readonly<Record<string, PlatformRepairProposal>>;
  readonly liveChangeProposals: Readonly<Record<string, PlatformLiveChangeProposal>>;
  readonly publicationRecords: Readonly<Record<string, readonly PlatformPublicationRecord[]>>;
  readonly version: number;
}

export type OrganizationPlatformCommand =
  | { readonly kind: "CREATE_ORGANIZATION"; readonly organizationId: string; readonly commandId: string; readonly occurredAt: string;
      readonly ownerUserId: string; readonly ownerEmail?: string; readonly name: string; readonly slug: string }
  | { readonly kind: "UPDATE_ORGANIZATION"; readonly organizationId: string; readonly commandId: string; readonly occurredAt: string;
      readonly actorUserId: string; readonly name: string; readonly slug: string; readonly status: PlatformOrganization["status"] }
  | { readonly kind: "CREATE_CLUB"; readonly organizationId: string; readonly commandId: string; readonly occurredAt: string;
      readonly actorUserId: string; readonly clubId: string; readonly name: string; readonly timezone: string }
  | { readonly kind: "UPDATE_CLUB"; readonly organizationId: string; readonly commandId: string; readonly occurredAt: string;
      readonly actorUserId: string; readonly clubId: string; readonly name: string; readonly timezone: string; readonly status: PlatformClub["status"] }
  | { readonly kind: "INVITE_MEMBER"; readonly organizationId: string; readonly commandId: string; readonly occurredAt: string;
      readonly actorUserId: string; readonly invitationId: string; readonly email: string; readonly role: PlatformRole;
      readonly clubIds: readonly string[]; readonly invitationToken: string; readonly expiresAt: string }
  | { readonly kind: "REVOKE_INVITATION"; readonly organizationId: string; readonly commandId: string; readonly occurredAt: string;
      readonly actorUserId: string; readonly invitationId: string }
  | { readonly kind: "ACCEPT_INVITATION"; readonly organizationId: string; readonly commandId: string; readonly occurredAt: string;
      readonly userId: string; readonly invitationToken: string }
  | { readonly kind: "CHANGE_MEMBERSHIP"; readonly organizationId: string; readonly commandId: string; readonly occurredAt: string;
      readonly actorUserId: string; readonly userId: string; readonly role: PlatformRole; readonly clubIds: readonly string[];
      readonly status: PlatformMembership["status"] }
  | { readonly kind: "UPSERT_PLAYER"; readonly organizationId: string; readonly commandId: string; readonly occurredAt: string;
      readonly actorUserId: string; readonly player: PlatformPlayer }
  | { readonly kind: "UPSERT_TEAM"; readonly organizationId: string; readonly commandId: string; readonly occurredAt: string;
      readonly actorUserId: string; readonly team: PlatformTeam }
  | { readonly kind: "UPSERT_VENUE"; readonly organizationId: string; readonly commandId: string; readonly occurredAt: string;
      readonly actorUserId: string; readonly venue: PlatformVenue }
  | { readonly kind: "UPSERT_COURT"; readonly organizationId: string; readonly commandId: string; readonly occurredAt: string;
      readonly actorUserId: string; readonly court: PlatformCourt }
  | { readonly kind: "UPSERT_OFFICIAL"; readonly organizationId: string; readonly commandId: string; readonly occurredAt: string;
      readonly actorUserId: string; readonly official: PlatformOfficial }
  | { readonly kind: "UPSERT_EQUIPMENT"; readonly organizationId: string; readonly commandId: string; readonly occurredAt: string;
      readonly actorUserId: string; readonly equipment: PlatformEquipment }
  | { readonly kind: "CREATE_TOURNAMENT"; readonly organizationId: string; readonly commandId: string; readonly occurredAt: string;
      readonly actorUserId: string; readonly tournamentId: string; readonly clubId: string; readonly name: string;
      readonly startsAt: string; readonly definition: JsonValue }
  | { readonly kind: "REVISE_TOURNAMENT"; readonly organizationId: string; readonly commandId: string; readonly occurredAt: string;
      readonly actorUserId: string; readonly tournamentId: string; readonly expectedTournamentRevision: number;
      readonly summary: string; readonly definition: JsonValue }
  | { readonly kind: "CHANGE_TOURNAMENT_STATUS"; readonly organizationId: string; readonly commandId: string; readonly occurredAt: string;
      readonly actorUserId: string; readonly tournamentId: string; readonly status: TournamentLifecycleStatus }
  | { readonly kind: "DUPLICATE_TOURNAMENT"; readonly organizationId: string; readonly commandId: string; readonly occurredAt: string;
      readonly actorUserId: string; readonly sourceTournamentId: string; readonly tournamentId: string; readonly name: string; readonly startsAt: string }
  | { readonly kind: "CREATE_FORMAT_TEMPLATE"; readonly organizationId: string; readonly commandId: string; readonly occurredAt: string;
      readonly actorUserId: string; readonly templateId: string; readonly name: string; readonly sport: string; readonly version: string;
      readonly summary: string; readonly definition: JsonValue }
  | { readonly kind: "ADD_FORMAT_VERSION"; readonly organizationId: string; readonly commandId: string; readonly occurredAt: string;
      readonly actorUserId: string; readonly templateId: string; readonly basedOnVersion: string; readonly version: string;
      readonly summary: string; readonly definition: JsonValue }
  | { readonly kind: "APPROVE_FORMAT_VERSION"; readonly organizationId: string; readonly commandId: string; readonly occurredAt: string;
      readonly actorUserId: string; readonly templateId: string; readonly version: string }
  | { readonly kind: "SET_CLUB_DEFAULT_FORMAT"; readonly organizationId: string; readonly commandId: string; readonly occurredAt: string;
      readonly actorUserId: string; readonly clubId: string; readonly templateId: string; readonly version: string }
  | { readonly kind: "START_GUIDED_TOURNAMENT"; readonly organizationId: string; readonly commandId: string; readonly occurredAt: string;
      readonly actorUserId: string; readonly tournamentId: string; readonly clubId: string; readonly name: string; readonly startsAt: string }
  | { readonly kind: "SAVE_GUIDED_STEP"; readonly organizationId: string; readonly commandId: string; readonly occurredAt: string;
      readonly actorUserId: string; readonly tournamentId: string; readonly step: GuidedCreationStep; readonly data: JsonValue }
  | { readonly kind: "CREATE_SEASON"; readonly organizationId: string; readonly commandId: string; readonly occurredAt: string;
      readonly actorUserId: string; readonly season: PlatformSeason }
  | { readonly kind: "RAISE_OPERATIONAL_ALERT"; readonly organizationId: string; readonly commandId: string; readonly occurredAt: string;
      readonly actorUserId: string; readonly alert: Omit<PlatformOperationalAlert, "status" | "createdAt" | "acknowledgedBy" | "acknowledgedAt"> }
  | { readonly kind: "ACKNOWLEDGE_OPERATIONAL_ALERT"; readonly organizationId: string; readonly commandId: string; readonly occurredAt: string;
      readonly actorUserId: string; readonly alertId: string }
  | { readonly kind: "REQUEST_ACCOUNT_RECOVERY"; readonly organizationId: string; readonly commandId: string; readonly occurredAt: string;
      readonly email: string; readonly recoveryId: string; readonly recoveryToken: string; readonly expiresAt: string }
  | { readonly kind: "COMPLETE_ACCOUNT_RECOVERY"; readonly organizationId: string; readonly commandId: string; readonly occurredAt: string;
      readonly userId: string; readonly recoveryToken: string }
  | { readonly kind: "QUEUE_NOTIFICATION"; readonly organizationId: string; readonly commandId: string; readonly occurredAt: string;
      readonly actorUserId: string; readonly notification: Omit<PlatformNotification, "status" | "attempts" | "createdAt" | "deliveredAt" | "lastError"> }
  | { readonly kind: "MARK_NOTIFICATION_DELIVERED"; readonly organizationId: string; readonly commandId: string; readonly occurredAt: string;
      readonly actorUserId: string; readonly notificationId: string }
  | { readonly kind: "DELETE_ACCOUNT"; readonly organizationId: string; readonly commandId: string; readonly occurredAt: string;
      readonly actorUserId: string; readonly userId: string; readonly reason: string }
  | { readonly kind: "INITIALIZE_LIVE_OPERATIONS"; readonly organizationId: string; readonly commandId: string; readonly occurredAt: string;
      readonly actorUserId: string; readonly tournamentId: string; readonly definition: LiveOperationsDefinition }
  | { readonly kind: "APPLY_LIVE_OPERATION"; readonly organizationId: string; readonly commandId: string; readonly occurredAt: string;
      readonly actorUserId: string; readonly tournamentId: string; readonly liveCommand: LiveOperationsCommand }
  | { readonly kind: "RECORD_SCORE"; readonly organizationId: string; readonly commandId: string; readonly occurredAt: string;
      readonly actorUserId: string; readonly tournamentId: string; readonly contestId: string; readonly expectedScoreRevision: number;
      readonly winnerEntrantId: string; readonly score: JsonValue; readonly source: string; readonly correctionReason?: string }
  | { readonly kind: "PROPOSE_SCHEDULE_REPAIR"; readonly organizationId: string; readonly commandId: string; readonly occurredAt: string;
      readonly actorUserId: string; readonly tournamentId: string; readonly proposalId: string; readonly request: ScheduleRepairRequest; readonly maxSearchNodes: number }
  | { readonly kind: "DECIDE_REPAIR_PROPOSAL"; readonly organizationId: string; readonly commandId: string; readonly occurredAt: string;
      readonly actorUserId: string; readonly tournamentId: string; readonly proposalId: string; readonly decision: "APPROVED" | "REJECTED" }
  | { readonly kind: "PROPOSE_LIVE_CHANGE"; readonly organizationId: string; readonly commandId: string; readonly occurredAt: string;
      readonly actorUserId: string; readonly tournamentId: string; readonly proposalId: string; readonly liveCommand: LiveOperationsCommand;
      readonly repairRequest: ScheduleRepairRequest; readonly maxSearchNodes: number }
  | { readonly kind: "DECIDE_LIVE_CHANGE"; readonly organizationId: string; readonly commandId: string; readonly occurredAt: string;
      readonly actorUserId: string; readonly tournamentId: string; readonly proposalId: string; readonly decision: "APPROVED" | "REJECTED" }
  | { readonly kind: "PUBLISH_TOURNAMENT"; readonly organizationId: string; readonly commandId: string; readonly occurredAt: string;
      readonly actorUserId: string; readonly tournamentId: string; readonly expectedTournamentRevision: number;
      readonly acknowledgedFindingCodes: readonly string[] };

export interface OrganizationPlatform {
  execute(command: OrganizationPlatformCommand): Promise<Readonly<OrganizationPlatformState>>;
  read(organizationId: string): Promise<Readonly<OrganizationPlatformState>>;
  dashboard(organizationId: string, actorUserId: string): Promise<Readonly<PlatformDashboard>>;
  exportPrivacy(organizationId: string, actorUserId: string, subjectUserId: string): Promise<Readonly<PlatformPrivacyExport>>;
  exportBackup(organizationId: string, actorUserId: string): Promise<Readonly<OrganizationBackup>>;
}

const emptyState = (): OrganizationPlatformState => ({ organization: null, clubs: {}, memberships: {}, invitations: {},
  players: {}, teams: {}, venues: {}, courts: {}, officials: {}, equipment: {}, tournaments: {}, formatTemplates: {}, clubDefaultFormats: {},
  creationGuides: {}, seasons: {}, operationalAlerts: {}, accounts: {}, recoveryRequests: {}, notifications: {},
  liveOperations: {}, scores: {}, repairProposals: {}, liveChangeProposals: {}, publicationRecords: {}, version: 0 });
const hashSecret = (value: string): string => createHash("sha256").update(value).digest("hex");
const streamId = (organizationId: string): string => `organization:${organizationId}`;
const identifier = /^[a-z0-9][a-z0-9._-]{1,99}$/;

function assertIdentifier(value: string, name: string): void {
  if (!identifier.test(value)) throw new Error(`${name} is invalid`);
}

function assertTimestamp(value: string, name: string): void {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) throw new Error(`${name} must be a canonical timestamp`);
}

function objectPayload(event: Readonly<EventEnvelope>): Record<string, JsonValue> {
  if (!event.payload || Array.isArray(event.payload) || typeof event.payload !== "object") throw new Error(`Invalid ${event.type} payload`);
  return event.payload as Record<string, JsonValue>;
}

function replayPlatform(state: OrganizationPlatformState, event: Readonly<EventEnvelope>): OrganizationPlatformState {
  const payload = objectPayload(event);
  const nextVersion = event.streamVersion;
  if (event.type === "ORGANIZATION_CREATED") {
    const organization = payload.organization as unknown as PlatformOrganization;
    const owner = payload.owner as unknown as PlatformMembership;
    const account = payload.account as unknown as PlatformAccount;
    return { ...state, organization, memberships: { [owner.userId]: owner }, accounts: { [account.userId]: account }, version: nextVersion };
  }
  if (event.type === "ORGANIZATION_CHANGED") {
    return { ...state, organization: payload.organization as unknown as PlatformOrganization, version: nextVersion };
  }
  if (event.type === "CLUB_CREATED") {
    const club = payload.club as unknown as PlatformClub;
    return { ...state, clubs: { ...state.clubs, [club.id]: club }, version: nextVersion };
  }
  if (event.type === "CLUB_CHANGED") {
    const club = payload.club as unknown as PlatformClub;
    return { ...state, clubs: { ...state.clubs, [club.id]: club }, version: nextVersion };
  }
  if (event.type === "MEMBER_INVITED") {
    const invitation = payload.invitation as unknown as PlatformInvitation;
    return { ...state, invitations: { ...state.invitations, [invitation.id]: invitation }, version: nextVersion };
  }
  if (event.type === "INVITATION_ACCEPTED") {
    const invitation = payload.invitation as unknown as PlatformInvitation;
    const membership = payload.membership as unknown as PlatformMembership;
    const account = payload.account as unknown as PlatformAccount;
    return { ...state, invitations: { ...state.invitations, [invitation.id]: invitation },
      memberships: { ...state.memberships, [membership.userId]: membership }, accounts: { ...state.accounts, [account.userId]: account }, version: nextVersion };
  }
  if (event.type === "INVITATION_CHANGED") {
    const invitation = payload.invitation as unknown as PlatformInvitation;
    return { ...state, invitations: { ...state.invitations, [invitation.id]: invitation }, version: nextVersion };
  }
  if (event.type === "MEMBERSHIP_CHANGED") {
    const membership = payload.membership as unknown as PlatformMembership;
    return { ...state, memberships: { ...state.memberships, [membership.userId]: membership }, version: nextVersion };
  }
  const directoryEvents = {
    PLAYER_UPSERTED: "players", TEAM_UPSERTED: "teams", VENUE_UPSERTED: "venues", COURT_UPSERTED: "courts",
    OFFICIAL_UPSERTED: "officials", EQUIPMENT_UPSERTED: "equipment",
  } as const;
  const directory = directoryEvents[event.type as keyof typeof directoryEvents];
  if (directory) {
    const entry = payload.entry as unknown as { readonly id: string };
    return { ...state, [directory]: { ...state[directory], [entry.id]: entry }, version: nextVersion } as OrganizationPlatformState;
  }
  if (event.type.startsWith("TOURNAMENT_")) {
    const tournament = payload.tournament as unknown as PlatformTournament;
    return { ...state, tournaments: { ...state.tournaments, [tournament.id]: tournament }, version: nextVersion };
  }
  if (event.type === "FORMAT_TEMPLATE_CHANGED") {
    const template = payload.template as unknown as PlatformFormatTemplate;
    return { ...state, formatTemplates: { ...state.formatTemplates, [template.id]: template }, version: nextVersion };
  }
  if (event.type === "CLUB_DEFAULT_FORMAT_SET") {
    const clubId = payload.clubId as string; const reference = payload.reference as unknown as PlatformFormatReference;
    return { ...state, clubDefaultFormats: { ...state.clubDefaultFormats, [clubId]: reference }, version: nextVersion };
  }
  if (event.type === "GUIDED_CREATION_CHANGED") {
    const guide = payload.guide as unknown as PlatformCreationGuide;
    return { ...state, creationGuides: { ...state.creationGuides, [guide.tournamentId]: guide }, version: nextVersion };
  }
  if (event.type === "SEASON_UPSERTED") {
    const season = payload.season as unknown as PlatformSeason;
    return { ...state, seasons: { ...state.seasons, [season.id]: season }, version: nextVersion };
  }
  if (event.type === "OPERATIONAL_ALERT_CHANGED") {
    const alert = payload.alert as unknown as PlatformOperationalAlert;
    return { ...state, operationalAlerts: { ...state.operationalAlerts, [alert.id]: alert }, version: nextVersion };
  }
  if (event.type === "ACCOUNT_RECOVERY_CHANGED") {
    const recovery = payload.recovery as unknown as PlatformRecoveryRequest;
    const account = payload.account as unknown as PlatformAccount | undefined;
    return { ...state, recoveryRequests: { ...state.recoveryRequests, [recovery.id]: recovery },
      ...(account ? { accounts: { ...state.accounts, [account.userId]: account } } : {}), version: nextVersion };
  }
  if (event.type === "NOTIFICATION_CHANGED") {
    const notification = payload.notification as unknown as PlatformNotification;
    return { ...state, notifications: { ...state.notifications, [notification.id]: notification }, version: nextVersion };
  }
  if (event.type === "ACCOUNT_ANONYMIZED") {
    const account = payload.account as unknown as PlatformAccount; const membership = payload.membership as unknown as PlatformMembership;
    const players = payload.players as unknown as readonly PlatformPlayer[];
    return { ...state, accounts: { ...state.accounts, [account.userId]: account },
      memberships: { ...state.memberships, [membership.userId]: membership },
      players: players.reduce((result, player) => ({ ...result, [player.id]: player }), { ...state.players }), version: nextVersion };
  }
  if (event.type === "ORGANIZATION_RESTORED") {
    const restored = structuredClone(payload.state as unknown as OrganizationPlatformState);
    return { ...restored, publicationRecords: restored.publicationRecords ?? {},
      liveChangeProposals: restored.liveChangeProposals ?? {}, version: nextVersion };
  }
  if (event.type === "LIVE_OPERATIONS_CHANGED") {
    const live = payload.live as unknown as LiveOperationsState;
    return { ...state, liveOperations: { ...state.liveOperations, [live.definition.tournamentId]: live }, version: nextVersion };
  }
  if (event.type === "SCORE_RECORDED") {
    const score = payload.score as unknown as PlatformScoreRecord;
    return { ...state, scores: { ...state.scores, [`${score.tournamentId}:${score.contestId}`]: score }, version: nextVersion };
  }
  if (event.type === "SCHEDULE_REPAIR_CHANGED") {
    const proposal = payload.proposal as unknown as PlatformRepairProposal;
    return { ...state, repairProposals: { ...state.repairProposals, [proposal.id]: proposal }, version: nextVersion };
  }
  if (event.type === "LIVE_CHANGE_CHANGED") {
    const proposal = payload.proposal as unknown as PlatformLiveChangeProposal;
    return { ...state, liveChangeProposals: { ...state.liveChangeProposals, [proposal.id]: proposal }, version: nextVersion };
  }
  if (event.type === "PUBLICATION_CERTIFIED") {
    const record = payload.record as unknown as PlatformPublicationRecord;
    return { ...state, publicationRecords: { ...state.publicationRecords,
      [record.tournamentId]: [...(state.publicationRecords[record.tournamentId] ?? []), record] }, version: nextVersion };
  }
  throw new Error(`Unsupported organization platform event: ${event.type}`);
}

function requireOwner(state: OrganizationPlatformState, actorUserId: string): void {
  const membership = state.memberships[actorUserId];
  if (!membership || membership.status !== "ACTIVE" || membership.role !== "OWNER") throw new Error("Owner authority is required");
}

function requireClubManager(state: OrganizationPlatformState, actorUserId: string, clubIds: readonly string[]): void {
  const membership = state.memberships[actorUserId];
  const managesAll = membership?.status === "ACTIVE" && (membership.role === "OWNER"
    || (membership.role === "CLUB_ADMIN" && clubIds.every((clubId) => membership.clubIds.includes(clubId))));
  if (!managesAll) throw new Error("Club directory management authority is required");
}

function requireTournamentManager(state: OrganizationPlatformState, actorUserId: string, clubId: string): PlatformMembership {
  const membership = state.memberships[actorUserId];
  const authorized = membership?.status === "ACTIVE" && (membership.role === "OWNER"
    || (["CLUB_ADMIN", "TOURNAMENT_DIRECTOR"] as PlatformRole[]).includes(membership.role) && membership.clubIds.includes(clubId));
  if (!authorized) throw new Error("Tournament management authority is required");
  return membership;
}

function requireFormatManager(state: OrganizationPlatformState, actorUserId: string): PlatformMembership {
  const membership = state.memberships[actorUserId];
  if (!membership || membership.status !== "ACTIVE" || !(["OWNER", "CLUB_ADMIN", "TOURNAMENT_DIRECTOR"] as PlatformRole[]).includes(membership.role)) {
    throw new Error("Format management authority is required");
  }
  return membership;
}

function requireOperator(state: OrganizationPlatformState, actorUserId: string, clubId: string): PlatformMembership {
  const membership = state.memberships[actorUserId];
  const authorized = membership?.status === "ACTIVE" && (membership.role === "OWNER"
    || (["CLUB_ADMIN", "TOURNAMENT_DIRECTOR", "OPERATOR"] as PlatformRole[]).includes(membership.role) && membership.clubIds.includes(clubId));
  if (!authorized) throw new Error("Tournament operations authority is required");
  return membership;
}

const semanticVersion = /^\d+\.\d+\.\d+$/;
const guidedSteps: readonly GuidedCreationStep[] = ["PARTICIPANTS", "FORMAT", "RULES", "RESOURCES", "PRIORITIES", "REVIEW"];

function plainObject(value: JsonValue): Record<string, JsonValue> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, JsonValue> : undefined;
}

function stringList(value: JsonValue | undefined): readonly string[] | undefined {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string") ? value as readonly string[] : undefined;
}

function validTimezone(value: string): boolean {
  try { Intl.DateTimeFormat(undefined, { timeZone: value }); return true; } catch { return false; }
}

function assertUnique(values: readonly string[], name: string): void {
  if (new Set(values).size !== values.length) throw new Error(`${name} must not contain duplicates`);
}

function assertClubs(state: OrganizationPlatformState, clubIds: readonly string[]): void {
  if (!clubIds.length || clubIds.some((id) => state.clubs[id]?.status !== "ACTIVE")) throw new Error("Every directory club must be active and registered");
}

function publicationOutboxMetadata(record: PlatformPublicationRecord): NonNullable<ProposedEvent["metadata"]> {
  return { outbox: { topic: "competition.publication.v1", key: `${record.tournamentId}:v${record.tournamentRevision}`, payload: {
    tournamentId: record.tournamentId,
    tournamentRevision: record.tournamentRevision,
    definitionHash: record.definitionHash,
    guardReportHash: record.report.reportHash,
    certificateHash: record.certificate.certificateHash,
  } } as unknown as JsonValue };
}

function independentlyEvaluateAuthoritativeArtifacts(
  artifacts: Readonly<AuthoritativePublicationArtifacts>,
  expected: { readonly organizationId: string; readonly tournamentId: string; readonly tournamentRevision: number; readonly definitionHash: string },
): CompetitionGuardReport {
  if (artifacts.organizationId !== expected.organizationId || artifacts.tournamentId !== expected.tournamentId) {
    throw new Error("Authoritative publication artifacts do not belong to this organization and tournament");
  }
  if (artifacts.tournamentRevision !== expected.tournamentRevision || artifacts.definitionHash !== expected.definitionHash) {
    throw new Error("Authoritative publication artifacts are stale or do not match the approved revision");
  }
  assertTimestamp(artifacts.compiledAt, "publicationArtifacts.compiledAt");
  if (!artifacts.compiledBy.trim()) throw new Error("Authoritative publication artifacts require a compiler identity");
  const hashesMatch = artifacts.specHash === canonicalHash(artifacts.spec)
    && artifacts.graphHash === canonicalHash(artifacts.graph)
    && artifacts.scheduleHash === canonicalHash(artifacts.schedule)
    && (artifacts.simulation === undefined
      ? artifacts.simulationHash === undefined
      : artifacts.simulationHash === canonicalHash(artifacts.simulation));
  if (!hashesMatch) throw new Error("Authoritative publication artifact hash mismatch");
  return evaluateCompetitionGuard({ sourceDefinitionHash: expected.definitionHash, spec: artifacts.spec,
    graph: artifacts.graph, schedule: artifacts.schedule,
    ...(artifacts.simulation === undefined ? {} : { simulation: artifacts.simulation }) });
}

function authoritativeArtifactSetHash(artifacts: Readonly<AuthoritativePublicationArtifacts>): string {
  return canonicalHash({ organizationId: artifacts.organizationId, tournamentId: artifacts.tournamentId,
    tournamentRevision: artifacts.tournamentRevision, definitionHash: artifacts.definitionHash,
    compiledBy: artifacts.compiledBy, compiledAt: artifacts.compiledAt, specHash: artifacts.specHash,
    graphHash: artifacts.graphHash, scheduleHash: artifacts.scheduleHash,
    ...(artifacts.simulationHash === undefined ? {} : { simulationHash: artifacts.simulationHash }) });
}

function liveChangeOutboxMetadata(record: PlatformLiveChangeProposal): NonNullable<ProposedEvent["metadata"]> {
  return { outbox: { topic: "competition.live-change.approved.v1", key: record.tournamentId, payload: {
    tournamentId: record.tournamentId,
    proposalId: record.id,
    approvalHash: record.approved?.approvalHash ?? null,
    impact: record.proposal.impact,
    notificationDrafts: record.proposal.notificationDrafts,
  } } as unknown as JsonValue };
}

function eventsFor(state: OrganizationPlatformState, command: OrganizationPlatformCommand,
  publicationArtifacts?: Readonly<AuthoritativePublicationArtifacts>): readonly ProposedEvent[] {
  assertIdentifier(command.organizationId, "organizationId");
  assertIdentifier(command.commandId, "commandId");
  assertTimestamp(command.occurredAt, "occurredAt");
  if (command.kind === "CREATE_ORGANIZATION") {
    if (state.organization) throw new Error("Organization already exists");
    assertIdentifier(command.ownerUserId, "ownerUserId");
    if (!command.name.trim() || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(command.slug)
      || (command.ownerEmail !== undefined && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(command.ownerEmail))) throw new Error("Organization name, slug, and owner identity are invalid");
    return [{ type: "ORGANIZATION_CREATED", payload: {
      organization: { id: command.organizationId, name: command.name.trim(), slug: command.slug, status: "ACTIVE", createdAt: command.occurredAt },
      owner: { userId: command.ownerUserId, role: "OWNER", clubIds: [], status: "ACTIVE" },
      account: { userId: command.ownerUserId, email: command.ownerEmail?.toLocaleLowerCase() ?? null, status: "ACTIVE", credentialVersion: 1 },
    } }];
  }
  if (!state.organization || state.organization.id !== command.organizationId) throw new Error("Organization does not exist");
  if (command.kind === "UPDATE_ORGANIZATION") {
    requireOwner(state, command.actorUserId);
    if (!command.name.trim() || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(command.slug)) throw new Error("Organization name and slug are invalid");
    const organization: PlatformOrganization = { ...state.organization, name: command.name.trim(), slug: command.slug, status: command.status };
    return [{ type: "ORGANIZATION_CHANGED", payload: { organization } as unknown as JsonValue }];
  }
  if (state.organization.status !== "ACTIVE") throw new Error("Organization is suspended");
  if (command.kind === "CREATE_CLUB") {
    requireOwner(state, command.actorUserId); assertIdentifier(command.clubId, "clubId");
    if (state.clubs[command.clubId] || !command.name.trim() || !validTimezone(command.timezone)) {
      throw new Error("Club must have a unique identity, name, and valid timezone");
    }
    return [{ type: "CLUB_CREATED", payload: { club: { id: command.clubId, name: command.name.trim(), timezone: command.timezone, status: "ACTIVE" } } }];
  }
  if (command.kind === "UPDATE_CLUB") {
    requireOwner(state, command.actorUserId); const current = state.clubs[command.clubId];
    if (!current || !command.name.trim() || !validTimezone(command.timezone)) throw new Error("Club update is invalid");
    if (command.status === "ARCHIVED" && Object.values(state.tournaments).some(({ clubId, status }) => clubId === command.clubId && status !== "ARCHIVED")) {
      throw new Error("A club with active tournament history cannot be archived");
    }
    const club: PlatformClub = { ...current, name: command.name.trim(), timezone: command.timezone, status: command.status };
    return [{ type: "CLUB_CHANGED", payload: { club } as unknown as JsonValue }];
  }
  if (command.kind === "INVITE_MEMBER") {
    requireOwner(state, command.actorUserId); assertIdentifier(command.invitationId, "invitationId"); assertTimestamp(command.expiresAt, "expiresAt");
    if (Date.parse(command.expiresAt) <= Date.parse(command.occurredAt) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(command.email)
      || command.invitationToken.length < 16 || state.invitations[command.invitationId]
      || (command.role === "OWNER" ? command.clubIds.length !== 0 : command.clubIds.length === 0)
      || command.clubIds.some((id) => state.clubs[id]?.status !== "ACTIVE")) throw new Error("Invitation is invalid");
    const invitation: PlatformInvitation = { id: command.invitationId, email: command.email.toLocaleLowerCase(), role: command.role,
      clubIds: [...new Set(command.clubIds)].sort(), tokenHash: hashSecret(command.invitationToken), expiresAt: command.expiresAt, status: "PENDING" };
    return [{ type: "MEMBER_INVITED", payload: { invitation } as unknown as JsonValue }];
  }
  if (command.kind === "REVOKE_INVITATION") {
    requireOwner(state, command.actorUserId); const invitation = state.invitations[command.invitationId];
    if (!invitation || invitation.status !== "PENDING") throw new Error("Only a pending invitation can be revoked");
    return [{ type: "INVITATION_CHANGED", payload: { invitation: { ...invitation, status: "REVOKED" } } as unknown as JsonValue }];
  }
  if (command.kind === "ACCEPT_INVITATION") {
    assertIdentifier(command.userId, "userId");
    const invitation = Object.values(state.invitations).find(({ tokenHash }) => tokenHash === hashSecret(command.invitationToken));
    if (!invitation || invitation.status !== "PENDING" || Date.parse(invitation.expiresAt) < Date.parse(command.occurredAt)
      || state.memberships[command.userId]) throw new Error("Invitation is invalid, expired, or already accepted");
    const accepted: PlatformInvitation = { ...invitation, status: "ACCEPTED", acceptedByUserId: command.userId };
    const membership: PlatformMembership = { userId: command.userId, role: invitation.role, clubIds: invitation.clubIds, status: "ACTIVE" };
    const account: PlatformAccount = { userId: command.userId, email: invitation.email, status: "ACTIVE", credentialVersion: 1 };
    return [{ type: "INVITATION_ACCEPTED", payload: { invitation: accepted, membership, account } as unknown as JsonValue }];
  }
  if (command.kind === "CHANGE_MEMBERSHIP") {
    requireOwner(state, command.actorUserId); const current = state.memberships[command.userId];
    if (!current || !state.accounts[command.userId]) throw new Error("Membership does not exist");
    assertUnique(command.clubIds, "membership.clubIds");
    if (command.role === "OWNER" ? command.clubIds.length !== 0 : command.clubIds.length === 0 || command.clubIds.some((id) => state.clubs[id]?.status !== "ACTIVE")) {
      throw new Error("Membership role and club scope are invalid");
    }
    const otherActiveOwner = Object.values(state.memberships).some(({ userId, role, status }) => userId !== command.userId && role === "OWNER" && status === "ACTIVE");
    if (current.role === "OWNER" && current.status === "ACTIVE" && (command.role !== "OWNER" || command.status !== "ACTIVE") && !otherActiveOwner) {
      throw new Error("The organization must retain an active owner");
    }
    const membership: PlatformMembership = { userId: command.userId, role: command.role,
      clubIds: command.role === "OWNER" ? [] : [...command.clubIds].sort(), status: command.status };
    return [{ type: "MEMBERSHIP_CHANGED", payload: { membership } as unknown as JsonValue }];
  }
  if (command.kind === "UPSERT_PLAYER") {
    const entry = command.player; assertIdentifier(entry.id, "player.id"); assertUnique(entry.clubIds, "player.clubIds");
    assertClubs(state, entry.clubIds); requireClubManager(state, command.actorUserId, entry.clubIds);
    if (!entry.displayName.trim() || (entry.email !== undefined && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(entry.email))
      || (entry.linkedUserId !== undefined && state.accounts[entry.linkedUserId]?.status !== "ACTIVE")
      || Object.values(entry.externalIds).some((value) => !value.trim())) throw new Error("Player directory entry is invalid");
    return [{ type: "PLAYER_UPSERTED", payload: { entry: { ...entry, displayName: entry.displayName.trim(), clubIds: [...entry.clubIds].sort(),
      externalIds: Object.fromEntries(Object.entries(entry.externalIds).sort(([left], [right]) => left.localeCompare(right))) } } as unknown as JsonValue }];
  }
  if (command.kind === "UPSERT_TEAM") {
    const entry = command.team; assertIdentifier(entry.id, "team.id"); assertIdentifier(entry.clubId, "team.clubId");
    requireClubManager(state, command.actorUserId, [entry.clubId]); assertUnique(entry.playerIds, "team.playerIds");
    if (!entry.name.trim() || !entry.playerIds.length || entry.playerIds.some((id) => state.players[id]?.status !== "ACTIVE"
      || !state.players[id]?.clubIds.includes(entry.clubId))) throw new Error("Every team member must be a registered active player in the club");
    return [{ type: "TEAM_UPSERTED", payload: { entry: { ...entry, name: entry.name.trim(), playerIds: [...entry.playerIds] } } as unknown as JsonValue }];
  }
  if (command.kind === "UPSERT_VENUE") {
    const entry = command.venue; assertIdentifier(entry.id, "venue.id"); assertIdentifier(entry.clubId, "venue.clubId");
    requireClubManager(state, command.actorUserId, [entry.clubId]);
    if (!entry.name.trim() || state.clubs[entry.clubId]?.status !== "ACTIVE" || !validTimezone(entry.timezone)) throw new Error("Venue directory entry is invalid");
    return [{ type: "VENUE_UPSERTED", payload: { entry: { ...entry, name: entry.name.trim() } } as unknown as JsonValue }];
  }
  if (command.kind === "UPSERT_COURT") {
    const entry = command.court; assertIdentifier(entry.id, "court.id"); assertIdentifier(entry.venueId, "court.venueId");
    const venue = state.venues[entry.venueId]; if (!venue || venue.status !== "ACTIVE") throw new Error("Court requires a registered active venue");
    requireClubManager(state, command.actorUserId, [venue.clubId]); assertUnique(entry.sportTags, "court.sportTags");
    if (!entry.name.trim() || !entry.sportTags.length || entry.sportTags.some((tag) => !tag.trim())) throw new Error("Court directory entry is invalid");
    return [{ type: "COURT_UPSERTED", payload: { entry: { ...entry, name: entry.name.trim(), sportTags: [...entry.sportTags].sort() } } as unknown as JsonValue }];
  }
  if (command.kind === "UPSERT_OFFICIAL") {
    const entry = command.official; assertIdentifier(entry.id, "official.id"); assertUnique(entry.clubIds, "official.clubIds");
    assertClubs(state, entry.clubIds); requireClubManager(state, command.actorUserId, entry.clubIds); assertUnique(entry.certifications, "official.certifications");
    if (!entry.displayName.trim() || entry.certifications.some((value) => !value.trim())) throw new Error("Official directory entry is invalid");
    return [{ type: "OFFICIAL_UPSERTED", payload: { entry: { ...entry, displayName: entry.displayName.trim(), clubIds: [...entry.clubIds].sort(), certifications: [...entry.certifications].sort() } } as unknown as JsonValue }];
  }
  if (command.kind === "UPSERT_EQUIPMENT") {
    const entry = command.equipment; assertIdentifier(entry.id, "equipment.id"); assertIdentifier(entry.venueId, "equipment.venueId");
    const venue = state.venues[entry.venueId]; if (!venue || venue.status !== "ACTIVE") throw new Error("Equipment requires a registered active venue");
    requireClubManager(state, command.actorUserId, [venue.clubId]);
    if (!entry.name.trim() || !entry.kind.trim()) throw new Error("Equipment directory entry is invalid");
    return [{ type: "EQUIPMENT_UPSERTED", payload: { entry: { ...entry, name: entry.name.trim(), kind: entry.kind.trim() } } as unknown as JsonValue }];
  }
  if (command.kind === "CREATE_TOURNAMENT") {
    assertIdentifier(command.tournamentId, "tournamentId"); assertIdentifier(command.clubId, "clubId"); assertTimestamp(command.startsAt, "startsAt");
    requireTournamentManager(state, command.actorUserId, command.clubId);
    if (state.tournaments[command.tournamentId] || state.clubs[command.clubId]?.status !== "ACTIVE" || !command.name.trim()
      || !command.definition || Array.isArray(command.definition) || typeof command.definition !== "object") throw new Error("Tournament draft is invalid");
    const definition = structuredClone(command.definition);
    const revision: PlatformTournamentRevision = { revision: 1, definition, definitionHash: canonicalHash(definition), summary: "Tournament created",
      createdBy: command.actorUserId, createdAt: command.occurredAt };
    const tournament: PlatformTournament = { id: command.tournamentId, clubId: command.clubId, name: command.name.trim(), startsAt: command.startsAt,
      status: "DRAFT", revisions: [revision], createdAt: command.occurredAt, updatedAt: command.occurredAt };
    return [{ type: "TOURNAMENT_CREATED", payload: { tournament } as unknown as JsonValue }];
  }
  if (command.kind === "REVISE_TOURNAMENT") {
    const current = state.tournaments[command.tournamentId];
    if (!current) throw new Error("Tournament does not exist"); requireTournamentManager(state, command.actorUserId, current.clubId);
    if (current.status !== "DRAFT" || current.revisions.length !== command.expectedTournamentRevision || !command.summary.trim()
      || !command.definition || Array.isArray(command.definition) || typeof command.definition !== "object") throw new Error("Only the current draft revision can be changed");
    const definition = structuredClone(command.definition);
    const revision: PlatformTournamentRevision = { revision: current.revisions.length + 1, definition, definitionHash: canonicalHash(definition),
      summary: command.summary.trim(), createdBy: command.actorUserId, createdAt: command.occurredAt };
    const tournament: PlatformTournament = { ...current, revisions: [...current.revisions, revision], updatedAt: command.occurredAt };
    return [{ type: "TOURNAMENT_REVISED", payload: { tournament } as unknown as JsonValue }];
  }
  if (command.kind === "DUPLICATE_TOURNAMENT") {
    const source = state.tournaments[command.sourceTournamentId];
    if (!source) throw new Error("Source tournament does not exist"); requireTournamentManager(state, command.actorUserId, source.clubId);
    assertIdentifier(command.tournamentId, "tournamentId"); assertTimestamp(command.startsAt, "startsAt");
    if (state.tournaments[command.tournamentId] || !command.name.trim()) throw new Error("Duplicate tournament identity and name must be unique");
    const sourceRevision = source.revisions.at(-1)!; const definition = structuredClone(sourceRevision.definition);
    const revision: PlatformTournamentRevision = { revision: 1, definition, definitionHash: sourceRevision.definitionHash,
      summary: `Duplicated from ${source.id} revision ${sourceRevision.revision}`, createdBy: command.actorUserId, createdAt: command.occurredAt };
    const tournament: PlatformTournament = { id: command.tournamentId, clubId: source.clubId, name: command.name.trim(), startsAt: command.startsAt,
      status: "DRAFT", revisions: [revision], createdAt: command.occurredAt, updatedAt: command.occurredAt, duplicatedFromTournamentId: source.id };
    return [{ type: "TOURNAMENT_DUPLICATED", payload: { tournament } as unknown as JsonValue }];
  }
  if (command.kind === "CREATE_FORMAT_TEMPLATE") {
    requireFormatManager(state, command.actorUserId); assertIdentifier(command.templateId, "templateId");
    if (state.formatTemplates[command.templateId] || !command.name.trim() || !command.sport.trim() || !semanticVersion.test(command.version)
      || !command.summary.trim() || !command.definition || Array.isArray(command.definition) || typeof command.definition !== "object") {
      throw new Error("Format template is invalid");
    }
    const definition = structuredClone(command.definition);
    const version: PlatformFormatVersion = { version: command.version, basedOnVersion: null, definition, definitionHash: canonicalHash(definition),
      summary: command.summary.trim(), status: "DRAFT", createdBy: command.actorUserId, createdAt: command.occurredAt };
    const template: PlatformFormatTemplate = { id: command.templateId, name: command.name.trim(), sport: command.sport.trim(), status: "ACTIVE",
      versions: [version], createdAt: command.occurredAt, updatedAt: command.occurredAt };
    return [{ type: "FORMAT_TEMPLATE_CHANGED", payload: { template } as unknown as JsonValue }];
  }
  if (command.kind === "ADD_FORMAT_VERSION") {
    requireFormatManager(state, command.actorUserId); const current = state.formatTemplates[command.templateId];
    if (!current || current.status !== "ACTIVE" || !semanticVersion.test(command.version) || current.versions.some(({ version }) => version === command.version)
      || current.versions.at(-1)?.version !== command.basedOnVersion || !command.summary.trim()
      || !command.definition || Array.isArray(command.definition) || typeof command.definition !== "object") throw new Error("Format version is invalid or not based on the latest version");
    const definition = structuredClone(command.definition);
    const version: PlatformFormatVersion = { version: command.version, basedOnVersion: command.basedOnVersion, definition,
      definitionHash: canonicalHash(definition), summary: command.summary.trim(), status: "DRAFT", createdBy: command.actorUserId, createdAt: command.occurredAt };
    const template: PlatformFormatTemplate = { ...current, versions: [...current.versions, version], updatedAt: command.occurredAt };
    return [{ type: "FORMAT_TEMPLATE_CHANGED", payload: { template } as unknown as JsonValue }];
  }
  if (command.kind === "APPROVE_FORMAT_VERSION") {
    requireFormatManager(state, command.actorUserId); const current = state.formatTemplates[command.templateId];
    const target = current?.versions.find(({ version }) => version === command.version);
    if (!current || !target || target.status !== "DRAFT") throw new Error("Only a draft format version can be approved");
    if (target.createdBy === command.actorUserId) throw new Error("Format approval requires a different active member from the version author");
    const versions = current.versions.map((version) => version.version === command.version
      ? { ...version, status: "APPROVED" as const, approvedBy: command.actorUserId } : version);
    const template: PlatformFormatTemplate = { ...current, versions, updatedAt: command.occurredAt };
    return [{ type: "FORMAT_TEMPLATE_CHANGED", payload: { template } as unknown as JsonValue }];
  }
  if (command.kind === "SET_CLUB_DEFAULT_FORMAT") {
    requireTournamentManager(state, command.actorUserId, command.clubId); const template = state.formatTemplates[command.templateId];
    if (state.clubs[command.clubId]?.status !== "ACTIVE" || !template || template.status !== "ACTIVE"
      || template.versions.find(({ version }) => version === command.version)?.status !== "APPROVED") throw new Error("Club default must reference an approved active format version");
    return [{ type: "CLUB_DEFAULT_FORMAT_SET", payload: { clubId: command.clubId,
      reference: { templateId: command.templateId, version: command.version } } }];
  }
  if (command.kind === "START_GUIDED_TOURNAMENT") {
    assertIdentifier(command.tournamentId, "tournamentId"); assertIdentifier(command.clubId, "clubId"); assertTimestamp(command.startsAt, "startsAt");
    requireTournamentManager(state, command.actorUserId, command.clubId);
    if (state.tournaments[command.tournamentId] || state.creationGuides[command.tournamentId] || !command.name.trim()
      || state.clubs[command.clubId]?.status !== "ACTIVE") throw new Error("Guided tournament identity, club, and name must be valid");
    const definition: JsonValue = { creationMode: "GUIDED", status: "INCOMPLETE" };
    const revision: PlatformTournamentRevision = { revision: 1, definition, definitionHash: canonicalHash(definition), summary: "Guided creation started",
      createdBy: command.actorUserId, createdAt: command.occurredAt };
    const tournament: PlatformTournament = { id: command.tournamentId, clubId: command.clubId, name: command.name.trim(), startsAt: command.startsAt,
      status: "DRAFT", revisions: [revision], createdAt: command.occurredAt, updatedAt: command.occurredAt };
    const guide: PlatformCreationGuide = { tournamentId: command.tournamentId, status: "IN_PROGRESS", currentStep: "PARTICIPANTS", completedSteps: [], inputs: {} };
    return [{ type: "TOURNAMENT_CREATED", payload: { tournament } as unknown as JsonValue },
      { type: "GUIDED_CREATION_CHANGED", payload: { guide } as unknown as JsonValue }];
  }
  if (command.kind === "SAVE_GUIDED_STEP") {
    const guide = state.creationGuides[command.tournamentId]; const tournament = state.tournaments[command.tournamentId];
    if (!guide || !tournament || guide.status !== "IN_PROGRESS" || tournament.status !== "DRAFT") throw new Error("Guided creation is not active");
    requireTournamentManager(state, command.actorUserId, tournament.clubId);
    if (guide.currentStep !== command.step) throw new Error(`Expected guided step ${guide.currentStep ?? "COMPLETE"}`);
    const data = plainObject(command.data); if (!data) throw new Error("Guided step data must be an object");
    if (command.step === "PARTICIPANTS") {
      const entrantIds = stringList(data.entrantIds);
      if (!entrantIds?.length || new Set(entrantIds).size !== entrantIds.length || entrantIds.some((id) => {
        const player = state.players[id]; const team = state.teams[id];
        return !(player?.status === "ACTIVE" && player.clubIds.includes(tournament.clubId))
          && !(team?.status === "ACTIVE" && team.clubId === tournament.clubId);
      })) throw new Error("Participants must reference unique active players or teams in the tournament club");
    }
    if (command.step === "FORMAT") {
      if (data.kind === "TEMPLATE") {
        const templateId = data.templateId; const version = data.version; const template = typeof templateId === "string" ? state.formatTemplates[templateId] : undefined;
        if (typeof version !== "string" || template?.versions.find((candidate) => candidate.version === version)?.status !== "APPROVED") {
          throw new Error("Guided format must reference an approved template version");
        }
      } else if (data.kind !== "CUSTOM" || !stringList(data.stageKinds)?.length) throw new Error("Guided format must be an approved template or explicit custom stages");
    }
    if (command.step === "RESOURCES") {
      const resourceIds = stringList(data.resourceIds);
      if (!resourceIds?.length || resourceIds.some((id) => state.courts[id]?.status !== "ACTIVE"
        && state.officials[id]?.status !== "ACTIVE" && state.equipment[id]?.status !== "ACTIVE")) {
        throw new Error("Resources must reference active directory entries");
      }
    }
    if (command.step === "PRIORITIES" && !stringList(data.objectives)?.length) throw new Error("At least one scheduling priority is required");
    if (command.step === "REVIEW") {
      if (data.accepted !== true || guidedSteps.slice(0, -1).some((step) => guide.inputs[step] === undefined)) throw new Error("Review requires every prior step and explicit acceptance");
      const definition: JsonValue = { creationMode: "GUIDED", participants: guide.inputs.PARTICIPANTS!, format: guide.inputs.FORMAT!,
        rules: guide.inputs.RULES!, resources: guide.inputs.RESOURCES!, priorities: guide.inputs.PRIORITIES! };
      const definitionHash = canonicalHash(definition);
      const revision: PlatformTournamentRevision = { revision: tournament.revisions.length + 1, definition, definitionHash,
        summary: "Guided creation review accepted", createdBy: command.actorUserId, createdAt: command.occurredAt };
      const revised: PlatformTournament = { ...tournament, revisions: [...tournament.revisions, revision], updatedAt: command.occurredAt };
      const completed: PlatformCreationGuide = { ...guide, status: "COMPLETE", currentStep: null,
        completedSteps: [...guide.completedSteps, "REVIEW"], inputs: { ...guide.inputs, REVIEW: structuredClone(command.data) }, reviewHash: definitionHash };
      return [{ type: "TOURNAMENT_REVISED", payload: { tournament: revised } as unknown as JsonValue },
        { type: "GUIDED_CREATION_CHANGED", payload: { guide: completed } as unknown as JsonValue }];
    }
    const nextStep = guidedSteps[guidedSteps.indexOf(command.step) + 1]!;
    const changed: PlatformCreationGuide = { ...guide, currentStep: nextStep, completedSteps: [...guide.completedSteps, command.step],
      inputs: { ...guide.inputs, [command.step]: structuredClone(command.data) } };
    return [{ type: "GUIDED_CREATION_CHANGED", payload: { guide: changed } as unknown as JsonValue }];
  }
  if (command.kind === "CREATE_SEASON") {
    const season = command.season; assertIdentifier(season.id, "season.id"); assertIdentifier(season.clubId, "season.clubId");
    requireClubManager(state, command.actorUserId, [season.clubId]);
    if (state.seasons[season.id] || state.clubs[season.clubId]?.status !== "ACTIVE" || !season.name.trim()
      || !/^\d{4}-\d{2}-\d{2}$/.test(season.startsOn) || !/^\d{4}-\d{2}-\d{2}$/.test(season.endsOn) || season.endsOn < season.startsOn) {
      throw new Error("Season is invalid");
    }
    return [{ type: "SEASON_UPSERTED", payload: { season: { ...season, name: season.name.trim() } } as unknown as JsonValue }];
  }
  if (command.kind === "RAISE_OPERATIONAL_ALERT") {
    const alert = command.alert; assertIdentifier(alert.id, "alert.id"); assertIdentifier(alert.clubId, "alert.clubId"); assertIdentifier(alert.tournamentId, "alert.tournamentId");
    requireOperator(state, command.actorUserId, alert.clubId);
    if (state.operationalAlerts[alert.id] || state.tournaments[alert.tournamentId]?.clubId !== alert.clubId || !alert.title.trim() || !alert.detail.trim()) {
      throw new Error("Operational alert is invalid");
    }
    const created: PlatformOperationalAlert = { ...alert, title: alert.title.trim(), detail: alert.detail.trim(), status: "OPEN", createdAt: command.occurredAt };
    return [{ type: "OPERATIONAL_ALERT_CHANGED", payload: { alert: created } as unknown as JsonValue }];
  }
  if (command.kind === "ACKNOWLEDGE_OPERATIONAL_ALERT") {
    const alert = state.operationalAlerts[command.alertId]; if (!alert || alert.status !== "OPEN") throw new Error("Open operational alert does not exist");
    requireOperator(state, command.actorUserId, alert.clubId);
    const acknowledged: PlatformOperationalAlert = { ...alert, status: "ACKNOWLEDGED", acknowledgedBy: command.actorUserId, acknowledgedAt: command.occurredAt };
    return [{ type: "OPERATIONAL_ALERT_CHANGED", payload: { alert: acknowledged } as unknown as JsonValue }];
  }
  if (command.kind === "REQUEST_ACCOUNT_RECOVERY") {
    assertIdentifier(command.recoveryId, "recoveryId"); assertTimestamp(command.expiresAt, "expiresAt");
    const account = Object.values(state.accounts).find((candidate) => candidate.status === "ACTIVE" && candidate.email === command.email.toLocaleLowerCase());
    if (!account || state.recoveryRequests[command.recoveryId] || command.recoveryToken.length < 16
      || Date.parse(command.expiresAt) <= Date.parse(command.occurredAt)) throw new Error("Account recovery request is invalid");
    const recovery: PlatformRecoveryRequest = { id: command.recoveryId, userId: account.userId, tokenHash: hashSecret(command.recoveryToken),
      expiresAt: command.expiresAt, status: "PENDING", requestedAt: command.occurredAt };
    return [{ type: "ACCOUNT_RECOVERY_CHANGED", payload: { recovery } as unknown as JsonValue }];
  }
  if (command.kind === "COMPLETE_ACCOUNT_RECOVERY") {
    const recovery = Object.values(state.recoveryRequests).find((candidate) => candidate.status === "PENDING"
      && candidate.userId === command.userId && candidate.tokenHash === hashSecret(command.recoveryToken));
    const account = state.accounts[command.userId];
    if (!recovery || !account || account.status !== "ACTIVE" || Date.parse(recovery.expiresAt) < Date.parse(command.occurredAt)) {
      throw new Error("Account recovery token is invalid or expired");
    }
    const completed: PlatformRecoveryRequest = { ...recovery, status: "COMPLETED", completedAt: command.occurredAt };
    const recovered: PlatformAccount = { ...account, credentialVersion: account.credentialVersion + 1 };
    return [{ type: "ACCOUNT_RECOVERY_CHANGED", payload: { recovery: completed, account: recovered } as unknown as JsonValue }];
  }
  if (command.kind === "QUEUE_NOTIFICATION") {
    const notification = command.notification; assertIdentifier(notification.id, "notification.id"); assertIdentifier(notification.clubId, "notification.clubId");
    requireOperator(state, command.actorUserId, notification.clubId); assertUnique(notification.recipientPlayerIds, "notification.recipientPlayerIds");
    if (state.notifications[notification.id] || !notification.recipientPlayerIds.length || !notification.templateKey.trim()
      || notification.recipientPlayerIds.some((id) => state.players[id]?.status !== "ACTIVE" || !state.players[id]?.clubIds.includes(notification.clubId))) {
      throw new Error("Notification recipients and template must be active and scoped to the club");
    }
    const queued: PlatformNotification = { ...notification, recipientPlayerIds: [...notification.recipientPlayerIds].sort(),
      templateKey: notification.templateKey.trim(), data: structuredClone(notification.data), status: "QUEUED", attempts: 0, createdAt: command.occurredAt };
    return [{ type: "NOTIFICATION_CHANGED", payload: { notification: queued } as unknown as JsonValue }];
  }
  if (command.kind === "MARK_NOTIFICATION_DELIVERED") {
    const notification = state.notifications[command.notificationId];
    if (!notification || notification.status !== "QUEUED") throw new Error("Queued notification does not exist");
    requireOperator(state, command.actorUserId, notification.clubId);
    const delivered: PlatformNotification = { ...notification, status: "DELIVERED", attempts: notification.attempts + 1, deliveredAt: command.occurredAt };
    return [{ type: "NOTIFICATION_CHANGED", payload: { notification: delivered } as unknown as JsonValue }];
  }
  if (command.kind === "DELETE_ACCOUNT") {
    const actor = state.memberships[command.actorUserId]; const targetMembership = state.memberships[command.userId]; const account = state.accounts[command.userId];
    if (!actor || actor.status !== "ACTIVE" || !targetMembership || !account || account.status !== "ACTIVE"
      || (command.actorUserId !== command.userId && actor.role !== "OWNER") || !command.reason.trim()) throw new Error("Account deletion is not authorized");
    const activeOwners = Object.values(state.memberships).filter(({ role, status }) => role === "OWNER" && status === "ACTIVE");
    if (targetMembership.role === "OWNER" && activeOwners.length === 1) throw new Error("The sole active owner must transfer ownership before deletion");
    const anonymized: PlatformAccount = { userId: account.userId, email: null, status: "ANONYMIZED", credentialVersion: account.credentialVersion,
      deletedAt: command.occurredAt, deletionReason: command.reason.trim() };
    const membership: PlatformMembership = { ...targetMembership, status: "SUSPENDED" };
    const players = Object.values(state.players).filter(({ linkedUserId }) => linkedUserId === command.userId).map((player) => {
      const { email: _email, linkedUserId: _linkedUserId, ...retained } = player;
      return { ...retained, displayName: "Deleted player", externalIds: {}, status: "ARCHIVED" as const };
    });
    return [{ type: "ACCOUNT_ANONYMIZED", payload: { account: anonymized, membership, players } as unknown as JsonValue }];
  }
  if (command.kind === "INITIALIZE_LIVE_OPERATIONS") {
    const tournament = state.tournaments[command.tournamentId]; if (!tournament || !["PUBLISHED", "LIVE"].includes(tournament.status)) throw new Error("Published tournament is required for live operations");
    requireOperator(state, command.actorUserId, tournament.clubId);
    if (command.definition.tournamentId !== command.tournamentId || state.liveOperations[command.tournamentId]) throw new Error("Live operations definition must match an uninitialized tournament");
    const live = createLiveOperationsState(command.definition);
    return [{ type: "LIVE_OPERATIONS_CHANGED", payload: { live } as unknown as JsonValue }];
  }
  if (command.kind === "APPLY_LIVE_OPERATION") {
    const tournament = state.tournaments[command.tournamentId]; const live = state.liveOperations[command.tournamentId];
    if (!tournament || !live) throw new Error("Live tournament is not initialized"); requireOperator(state, command.actorUserId, tournament.clubId);
    if (command.liveCommand.actorId !== command.actorUserId || command.liveCommand.occurredAt !== command.occurredAt) throw new Error("Live command audit identity must match the authenticated command");
    const result = submitLiveOperationsCommand(live, command.liveCommand);
    if (!result.accepted) throw new Error(`Live operation rejected: ${result.findings.map(({ code, message }) => `${code} ${message}`).join("; ")}`);
    return [{ type: "LIVE_OPERATIONS_CHANGED", payload: { live: result.state } as unknown as JsonValue }];
  }
  if (command.kind === "RECORD_SCORE") {
    const tournament = state.tournaments[command.tournamentId]; const live = state.liveOperations[command.tournamentId];
    if (!tournament || !live) throw new Error("Live tournament is not initialized"); requireOperator(state, command.actorUserId, tournament.clubId);
    const definition = live.definition.contests.find(({ contestId }) => contestId === command.contestId); const contest = live.contests[command.contestId];
    if (!definition || !contest || !["COMPLETED", "WALKOVER", "RETIRED"].includes(contest.status)
      || !definition.entrantIds.includes(command.winnerEntrantId) || !command.source.trim()) throw new Error("Score requires a settled contest, registered winner, and source");
    const key = `${command.tournamentId}:${command.contestId}`; const current = state.scores[key];
    if ((current?.revisions.length ?? 0) !== command.expectedScoreRevision || (current && !command.correctionReason?.trim())) {
      throw new Error("Score revision is stale or correction reason is missing");
    }
    const proofBody = { tournamentId: command.tournamentId, contestId: command.contestId, revision: (current?.revisions.length ?? 0) + 1,
      winnerEntrantId: command.winnerEntrantId, score: structuredClone(command.score), source: command.source.trim(), recordedBy: command.actorUserId,
      recordedAt: command.occurredAt, ...(command.correctionReason ? { correctionReason: command.correctionReason.trim() } : {}) };
    const revision: PlatformScoreRevision = { ...proofBody, proofHash: canonicalHash(proofBody) };
    const score: PlatformScoreRecord = { tournamentId: command.tournamentId, contestId: command.contestId,
      revisions: [...(current?.revisions ?? []), revision] };
    return [{ type: "SCORE_RECORDED", payload: { score } as unknown as JsonValue }];
  }
  if (command.kind === "PROPOSE_SCHEDULE_REPAIR") {
    const tournament = state.tournaments[command.tournamentId]; if (!tournament) throw new Error("Tournament does not exist");
    requireOperator(state, command.actorUserId, tournament.clubId); assertIdentifier(command.proposalId, "proposalId");
    if (state.repairProposals[command.proposalId]) throw new Error("Repair proposal identity already exists");
    const result = planMinimalChangeScheduleRepair(command.request, { maxSearchNodes: command.maxSearchNodes });
    const proposal: PlatformRepairProposal = { id: command.proposalId, tournamentId: command.tournamentId, status: "PROPOSED",
      result, createdBy: command.actorUserId, createdAt: command.occurredAt };
    return [{ type: "SCHEDULE_REPAIR_CHANGED", payload: { proposal } as unknown as JsonValue }];
  }
  if (command.kind === "DECIDE_REPAIR_PROPOSAL") {
    const tournament = state.tournaments[command.tournamentId]; const proposal = state.repairProposals[command.proposalId];
    if (!tournament || !proposal || proposal.tournamentId !== command.tournamentId || proposal.status !== "PROPOSED") throw new Error("Open repair proposal does not exist");
    requireTournamentManager(state, command.actorUserId, tournament.clubId);
    if (proposal.createdBy === command.actorUserId) throw new Error("Repair approval requires a different active member from the proposal author");
    if (command.decision === "APPROVED" && (!proposal.result.proof.optimalityProven || !["REPAIRED", "UNCHANGED"].includes(proposal.result.status))) {
      throw new Error("Only an independently proven repair can be approved");
    }
    const decided: PlatformRepairProposal = { ...proposal, status: command.decision, decidedBy: command.actorUserId, decidedAt: command.occurredAt };
    return [{ type: "SCHEDULE_REPAIR_CHANGED", payload: { proposal: decided } as unknown as JsonValue }];
  }
  if (command.kind === "PROPOSE_LIVE_CHANGE") {
    const tournament = state.tournaments[command.tournamentId];
    const live = state.liveOperations[command.tournamentId];
    if (!tournament || !live || !["PUBLISHED", "LIVE"].includes(tournament.status)) throw new Error("An initialized published tournament is required for a live-change proposal");
    requireOperator(state, command.actorUserId, tournament.clubId); assertIdentifier(command.proposalId, "proposalId");
    if (state.liveChangeProposals[command.proposalId]) throw new Error("Live-change proposal identity already exists");
    if (command.liveCommand.actorId !== command.actorUserId || command.liveCommand.occurredAt !== command.occurredAt) {
      throw new Error("Live-change command audit identity must match the authenticated command");
    }
    const proposal = proposeLiveChange({ proposalId: command.proposalId, proposedBy: command.actorUserId,
      proposedAt: command.occurredAt, liveState: live, liveCommand: command.liveCommand,
      repairRequest: command.repairRequest, maxSearchNodes: command.maxSearchNodes });
    const record: PlatformLiveChangeProposal = { id: command.proposalId, tournamentId: command.tournamentId,
      status: proposal.status, proposal, createdBy: command.actorUserId, createdAt: command.occurredAt };
    return [{ type: "LIVE_CHANGE_CHANGED", payload: { proposal: record } as unknown as JsonValue }];
  }
  if (command.kind === "DECIDE_LIVE_CHANGE") {
    const tournament = state.tournaments[command.tournamentId];
    const live = state.liveOperations[command.tournamentId];
    const current = state.liveChangeProposals[command.proposalId];
    if (!tournament || !live || !current || current.tournamentId !== command.tournamentId
      || current.status !== "READY_FOR_APPROVAL") throw new Error("An approval-ready current live-change proposal is required");
    requireTournamentManager(state, command.actorUserId, tournament.clubId);
    if (live.proofHash !== current.proposal.baseLiveStateProofHash) throw new Error("Live-change proposal is stale against current operational truth");
    if (command.decision === "REJECTED") {
      const rejected: PlatformLiveChangeProposal = { ...current, status: "REJECTED", decidedBy: command.actorUserId, decidedAt: command.occurredAt };
      return [{ type: "LIVE_CHANGE_CHANGED", payload: { proposal: rejected } as unknown as JsonValue }];
    }
    const approved = approveLiveChange(current.proposal, { approvedBy: command.actorUserId, approvedAt: command.occurredAt });
    const accepted: PlatformLiveChangeProposal = { ...current, status: "APPROVED", approved,
      decidedBy: command.actorUserId, decidedAt: command.occurredAt };
    return [
      { type: "LIVE_CHANGE_CHANGED", payload: { proposal: accepted } as unknown as JsonValue,
        metadata: liveChangeOutboxMetadata(accepted) },
      { type: "LIVE_OPERATIONS_CHANGED", payload: { live: approved.liveState } as unknown as JsonValue },
    ];
  }
  if (command.kind === "PUBLISH_TOURNAMENT") {
    const tournament = state.tournaments[command.tournamentId];
    if (!tournament || tournament.status !== "APPROVED") throw new Error("An approved tournament is required for publication");
    requireTournamentManager(state, command.actorUserId, tournament.clubId);
    if (tournament.approvedBy === command.actorUserId) {
      throw new Error("Publication requires a different active member from the approver");
    }
    const latest = tournament.revisions.at(-1)!;
    if (command.expectedTournamentRevision !== latest.revision
      || tournament.approvedRevision !== latest.revision
      || tournament.approvedDefinitionHash !== latest.definitionHash
      || !tournament.approvedAt) throw new Error("Publication expected revision is stale or is not the exact approved revision");
    if (!publicationArtifacts) throw new Error("Authoritative publication artifacts are unavailable");
    if (publicationArtifacts.compiledBy === tournament.approvedBy) {
      throw new Error("Approval requires a different active member from the compiler");
    }
    const report = independentlyEvaluateAuthoritativeArtifacts(publicationArtifacts, {
      organizationId: command.organizationId, tournamentId: tournament.id,
      tournamentRevision: latest.revision, definitionHash: latest.definitionHash,
    });
    if (tournament.approvedArtifactSetHash !== authoritativeArtifactSetHash(publicationArtifacts)
      || tournament.approvedGuardReportHash !== report.reportHash) {
      throw new Error("Publication requires the exact approved artifact set and Guard report");
    }
    if (report.status !== "PASSED") {
      throw new Error(`Competition Guard blocked publication: ${report.findings.filter(({ severity }) => severity === "CRITICAL" || severity === "INTEGRITY")
        .map(({ sourceCode, message }) => `${sourceCode} ${message}`).join("; ")}`);
    }
    const certificate = createPublicationCertificate({ tournamentId: tournament.id, tournamentRevision: latest.revision, report,
      acknowledgedFindingCodes: command.acknowledgedFindingCodes, issuedBy: command.actorUserId, issuedAt: command.occurredAt });
    const record: PlatformPublicationRecord = { tournamentId: tournament.id, tournamentRevision: latest.revision,
      definitionHash: latest.definitionHash, report, certificate, assessedBy: command.actorUserId, assessedAt: command.occurredAt };
    const published: PlatformTournament = { ...tournament, status: "PUBLISHED", updatedAt: command.occurredAt,
      publishedBy: command.actorUserId, publishedCertificateHash: certificate.certificateHash };
    return [
      { type: "PUBLICATION_CERTIFIED", payload: { record } as unknown as JsonValue },
      { type: "TOURNAMENT_STATUS_CHANGED", payload: { tournament: published } as unknown as JsonValue,
        metadata: publicationOutboxMetadata(record) },
    ];
  }
  const current = state.tournaments[command.tournamentId];
  if (!current) throw new Error("Tournament does not exist"); requireTournamentManager(state, command.actorUserId, current.clubId);
  const allowed: Readonly<Record<TournamentLifecycleStatus, readonly TournamentLifecycleStatus[]>> = {
    DRAFT: ["UNDER_REVIEW", "ARCHIVED"], UNDER_REVIEW: ["DRAFT", "APPROVED", "ARCHIVED"], APPROVED: ["ARCHIVED"],
    PUBLISHED: ["LIVE", "ARCHIVED"], LIVE: ["COMPLETED"], COMPLETED: ["ARCHIVED"], ARCHIVED: [],
  };
  if (command.status === "PUBLISHED") throw new Error("Use PUBLISH_TOURNAMENT for atomic server-owned publication");
  if (!allowed[current.status].includes(command.status)) throw new Error(`Invalid tournament lifecycle transition ${current.status} -> ${command.status}`);
  const latest = current.revisions.at(-1)!;
  if (command.status === "APPROVED" && latest.createdBy === command.actorUserId) throw new Error("Approval requires a different active member from the latest revision author");
  let approvalEvidence: { readonly artifactSetHash: string; readonly guardReportHash: string } | undefined;
  if (command.status === "APPROVED") {
    if (!publicationArtifacts) throw new Error("Authoritative publication artifacts are unavailable for approval");
    if (publicationArtifacts.compiledBy === command.actorUserId) throw new Error("Approval requires a different active member from the compiler");
    const report = independentlyEvaluateAuthoritativeArtifacts(publicationArtifacts, { organizationId: command.organizationId,
      tournamentId: current.id, tournamentRevision: latest.revision, definitionHash: latest.definitionHash });
    if (report.status !== "PASSED") throw new Error(`Competition Guard blocked approval: ${report.findings
      .filter(({ severity }) => severity === "CRITICAL" || severity === "INTEGRITY")
      .map(({ sourceCode, message }) => `${sourceCode} ${message}`).join("; ")}`);
    approvalEvidence = { artifactSetHash: authoritativeArtifactSetHash(publicationArtifacts), guardReportHash: report.reportHash };
  }
  const tournament: PlatformTournament = { ...current, status: command.status, updatedAt: command.occurredAt,
    ...(command.status === "APPROVED" ? { approvedBy: command.actorUserId, approvedAt: command.occurredAt,
      approvedRevision: latest.revision, approvedDefinitionHash: latest.definitionHash,
      approvedArtifactSetHash: approvalEvidence!.artifactSetHash, approvedGuardReportHash: approvalEvidence!.guardReportHash } : {}) };
  return [{ type: "TOURNAMENT_STATUS_CHANGED", payload: { tournament } as unknown as JsonValue }];
}

function platformCommandContentHash(command: OrganizationPlatformCommand): string {
  const { occurredAt: _occurredAt, ...content } = command;
  if (content.kind !== "APPLY_LIVE_OPERATION" && content.kind !== "PROPOSE_LIVE_CHANGE") return canonicalHash(content);
  const { occurredAt: _liveOccurredAt, ...liveCommand } = content.liveCommand;
  return canonicalHash({ ...content, liveCommand });
}

function assertServerOwnedPublicationCommand(command: Extract<OrganizationPlatformCommand, { readonly kind: "PUBLISH_TOURNAMENT" }>): void {
  const allowed = new Set(["kind", "organizationId", "commandId", "occurredAt", "actorUserId", "tournamentId",
    "expectedTournamentRevision", "acknowledgedFindingCodes"]);
  if (Object.keys(command).some((key) => !allowed.has(key))) {
    throw new Error("PUBLISH_TOURNAMENT accepts only identity, revision, and acknowledgements");
  }
  assertIdentifier(command.organizationId, "organizationId");
  assertIdentifier(command.commandId, "commandId");
  assertIdentifier(command.actorUserId, "actorUserId");
  assertIdentifier(command.tournamentId, "tournamentId");
  assertTimestamp(command.occurredAt, "occurredAt");
  if (!Number.isSafeInteger(command.expectedTournamentRevision) || command.expectedTournamentRevision < 1
    || !Array.isArray(command.acknowledgedFindingCodes)
    || command.acknowledgedFindingCodes.some((code) => typeof code !== "string" || !code.trim() || code.length > 100)
    || new Set(command.acknowledgedFindingCodes).size !== command.acknowledgedFindingCodes.length) {
    throw new Error("PUBLISH_TOURNAMENT identity, revision, or acknowledgements are invalid");
  }
}

export function createOrganizationPlatform(store: EventStoreAdapter, options: OrganizationPlatformOptions = {}): OrganizationPlatform {
  const read = async (organizationId: string): Promise<Readonly<OrganizationPlatformState>> => {
    assertIdentifier(organizationId, "organizationId");
    const state = await store.replay(streamId(organizationId), emptyState(), replayPlatform);
    return deepFreeze(state);
  };
  return {
    read,
    dashboard: async (organizationId, actorUserId) => {
      const state = await read(organizationId); if (!state.organization) throw new Error("Organization does not exist");
      const membership = state.memberships[actorUserId]; if (!membership || membership.status !== "ACTIVE") throw new Error("Active membership is required");
      const visibleClubIds = new Set(membership.role === "OWNER" ? Object.keys(state.clubs) : membership.clubIds);
      const clubs = Object.values(state.clubs).filter(({ id }) => visibleClubIds.has(id)).sort((left, right) => left.name.localeCompare(right.name));
      const seasons = Object.values(state.seasons).filter(({ clubId }) => visibleClubIds.has(clubId)).sort((left, right) => left.startsOn.localeCompare(right.startsOn));
      const tournaments = Object.values(state.tournaments).filter(({ clubId }) => visibleClubIds.has(clubId)).sort((left, right) => left.startsAt.localeCompare(right.startsAt) || left.id.localeCompare(right.id));
      const alerts = Object.values(state.operationalAlerts).filter(({ clubId, status }) => visibleClubIds.has(clubId) && status === "OPEN")
        .sort((left, right) => left.severity.localeCompare(right.severity) || left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
      const liveChangeProposals = Object.values(state.liveChangeProposals).filter(({ tournamentId }) => {
        const tournament = state.tournaments[tournamentId]; return Boolean(tournament && visibleClubIds.has(tournament.clubId));
      }).sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
      const publicationReadiness = tournaments.map((tournament): PlatformPublicationReadiness => {
        const latest = tournament.revisions.at(-1)!;
        const record = state.publicationRecords[tournament.id]?.at(-1);
        if (!record) return { tournamentId: tournament.id, tournamentRevision: latest.revision, status: "UNCERTIFIED" };
        const current = record.tournamentRevision === latest.revision && record.definitionHash === latest.definitionHash
          && verifyPublicationCertificate(record.certificate, record.report);
        if (!current) return { tournamentId: tournament.id, tournamentRevision: latest.revision, status: "STALE",
          certificateHash: record.certificate.certificateHash, guardReportHash: record.report.reportHash, assessedAt: record.assessedAt };
        return { tournamentId: tournament.id, tournamentRevision: latest.revision,
          status: tournament.publishedCertificateHash === record.certificate.certificateHash ? "PUBLISHED" : "CERTIFIED",
          certificateHash: record.certificate.certificateHash, guardReportHash: record.report.reportHash, assessedAt: record.assessedAt };
      });
      const tournamentCounts: Record<TournamentLifecycleStatus, number> = { DRAFT: 0, UNDER_REVIEW: 0, APPROVED: 0, PUBLISHED: 0, LIVE: 0, COMPLETED: 0, ARCHIVED: 0 };
      tournaments.forEach(({ status }) => { tournamentCounts[status] += 1; });
      const activeAndVisible = <T extends { readonly status: string }>(entries: readonly T[], visible: (entry: T) => boolean) => entries.filter((entry) => entry.status === "ACTIVE" && visible(entry)).length;
      const directoryCounts = {
        players: activeAndVisible(Object.values(state.players), (entry) => entry.clubIds.some((id) => visibleClubIds.has(id))),
        teams: activeAndVisible(Object.values(state.teams), (entry) => visibleClubIds.has(entry.clubId)),
        venues: activeAndVisible(Object.values(state.venues), (entry) => visibleClubIds.has(entry.clubId)),
        courts: activeAndVisible(Object.values(state.courts), (entry) => visibleClubIds.has(state.venues[entry.venueId]?.clubId ?? "")),
        officials: activeAndVisible(Object.values(state.officials), (entry) => entry.clubIds.some((id) => visibleClubIds.has(id))),
        equipment: activeAndVisible(Object.values(state.equipment), (entry) => visibleClubIds.has(state.venues[entry.venueId]?.clubId ?? "")),
      };
      return deepFreeze({ organization: state.organization, clubs, seasons, tournaments, alerts, liveChangeProposals, publicationReadiness,
        formatTemplates: Object.values(state.formatTemplates).filter(({ status }) => status === "ACTIVE").sort((left, right) => left.name.localeCompare(right.name)),
        tournamentCounts, directoryCounts });
    },
    exportPrivacy: async (organizationId, actorUserId, subjectUserId) => {
      const state = await read(organizationId); const actor = state.memberships[actorUserId]; const membership = state.memberships[subjectUserId];
      const account = state.accounts[subjectUserId];
      if (!actor || actor.status !== "ACTIVE" || (!membership || !account) || (actorUserId !== subjectUserId && actor.role !== "OWNER")) {
        throw new Error("Privacy export is not authorized");
      }
      const players = Object.values(state.players).filter(({ linkedUserId }) => linkedUserId === subjectUserId).sort((left, right) => left.id.localeCompare(right.id));
      const playerIds = new Set(players.map(({ id }) => id));
      const notifications = Object.values(state.notifications).filter(({ recipientPlayerIds }) => recipientPlayerIds.some((id) => playerIds.has(id)))
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
      const body = { schemaVersion: "1.0.0" as const, organizationId, subjectUserId, account: structuredClone(account),
        membership: structuredClone(membership), players: structuredClone(players), notifications: structuredClone(notifications) };
      return deepFreeze({ ...body, exportHash: canonicalHash(body) });
    },
    exportBackup: async (organizationId, actorUserId) => {
      const state = await read(organizationId); requireOwner(state, actorUserId);
      const body = { schemaVersion: "1.0.0" as const, organizationId, sourceVersion: state.version, state: structuredClone(state) };
      return deepFreeze({ ...body, stateHash: canonicalHash(body) });
    },
    execute: async (command) => {
      if (command.kind === "PUBLISH_TOURNAMENT") assertServerOwnedPublicationCommand(command);
      const state = await read(command.organizationId);
      const commandHash = platformCommandContentHash(command);
      const prior = (await store.readStream(streamId(command.organizationId))).find(({ commandId }) => commandId === command.commandId);
      if (prior) {
        if (prior.metadata.platformCommandHash !== commandHash) throw new IdempotencyConflictError(streamId(command.organizationId), command.commandId);
        return state;
      }
      const publicationIdentity = command.kind === "PUBLISH_TOURNAMENT"
        ? { organizationId: command.organizationId, tournamentId: command.tournamentId,
          tournamentRevision: command.expectedTournamentRevision }
        : command.kind === "CHANGE_TOURNAMENT_STATUS" && command.status === "APPROVED"
          ? (() => { const tournament = state.tournaments[command.tournamentId]; return tournament ? {
            organizationId: command.organizationId, tournamentId: command.tournamentId,
            tournamentRevision: tournament.revisions.at(-1)!.revision } : undefined; })()
          : undefined;
      const publicationArtifacts = publicationIdentity
        ? await options.publicationArtifacts?.load(publicationIdentity)
        : undefined;
      const events = eventsFor(state, command, publicationArtifacts);
      await store.append({ streamId: streamId(command.organizationId), expectedVersion: state.version,
        commandId: command.commandId, recordedAt: command.occurredAt,
        events: events.map((event) => ({ ...event, metadata: { ...event.metadata, platformCommandHash: commandHash } })) });
      return read(command.organizationId);
    },
  };
}

export async function restoreOrganizationBackup(
  store: EventStoreAdapter,
  backup: OrganizationBackup,
  commandId: string,
  occurredAt: string,
): Promise<OrganizationPlatform> {
  assertIdentifier(backup.organizationId, "organizationId"); assertIdentifier(commandId, "commandId"); assertTimestamp(occurredAt, "occurredAt");
  const { stateHash, ...body } = backup;
  if (backup.schemaVersion !== "1.0.0" || canonicalHash(body) !== stateHash || backup.state.organization?.id !== backup.organizationId
    || backup.sourceVersion !== backup.state.version) throw new Error("Organization backup hash, version, or identity is invalid");
  if ((await store.readStream(streamId(backup.organizationId))).length) throw new Error("Backup restore target must be empty");
  await store.append({ streamId: streamId(backup.organizationId), expectedVersion: 0, commandId, recordedAt: occurredAt,
    events: [{ type: "ORGANIZATION_RESTORED", payload: { state: structuredClone(backup.state) } as unknown as JsonValue }] });
  return createOrganizationPlatform(store);
}
