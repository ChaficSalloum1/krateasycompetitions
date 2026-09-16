import { createHmac, timingSafeEqual } from "node:crypto";
import { canonicalHash } from "@tournament-os/tournament-schema";
import type { LiveOperationsEvent, LiveOperationsState } from "@tournament-os/competition-engine";
import type { OperationalAssignment } from "./no-show-journey.js";
import type {
  OperationalAuthorityAssignments,
  OperationalIncident,
  OperationalPublicStatus,
  OperationalRestartClearance,
} from "./operational-safety.js";

export interface ParticipantAccessGrant {
  readonly tokenHash: string;
  readonly organizationId: string;
  readonly competitionId: string;
  readonly publishedRevision: number;
  readonly participantId: string;
  readonly expiresAt: string;
  readonly keyVersion: string;
  readonly issuedAt?: string;
  readonly issuedByCommandId?: string;
  readonly revokedAt?: string;
  readonly revokedBy?: string;
  readonly revocationReason?: string;
  readonly revokedByCommandId?: string;
}

export interface ParticipantRecoveryGrant {
  readonly codeHash: string;
  readonly organizationId: string;
  readonly competitionId: string;
  readonly publishedRevision: number;
  readonly operationalRevision: number;
  readonly participantId: string;
  readonly codeExpiresAt: string;
  readonly accessExpiresAt: string;
  readonly keyVersion: string;
  readonly issuedAt: string;
  readonly issuedBy: string;
  readonly issuedByCommandId: string;
  readonly requestHash: string;
  readonly revokedAt?: string;
  readonly revokedByCommandId?: string;
}

export interface ParticipantRecoveryCode {
  readonly code: string;
  readonly eventPath: string;
  readonly expiresAt: string;
}

export interface ParticipantAccess {
  readonly token: string;
  readonly path: string;
  readonly expiresAt: string;
}

export interface ParticipantNextProjection {
  readonly apiVersion: "1.0";
  readonly competition: { readonly id: string; readonly name: string };
  readonly participant: {
    readonly displayName: string;
    readonly status: "EXPECTED" | "CHECKED_IN" | "LATE" | "WITHDRAWN";
  };
  readonly operation: OperationalPublicStatus;
  readonly revision: number;
  readonly next: null | {
    readonly contestId: string;
    readonly opponent: string | null;
    readonly court: string;
    readonly reportingTime: string;
    readonly startsAt: string;
    readonly status: "SCHEDULED" | "CALLED" | "IN_PROGRESS";
  };
  readonly freshness: {
    readonly relevantEventSequence: number;
    readonly relevantEventHash: string | null;
  };
  readonly projectionHash: string;
}

export interface PublicLiveContestProjection {
  readonly contestId: string;
  readonly participantNames: readonly string[];
  readonly court: string;
  readonly startsAt: string;
  readonly status: "SCHEDULED" | "CALLED" | "IN_PROGRESS" | "COMPLETED" | "WALKOVER" | "RETIRED";
  readonly scores?: readonly { readonly entrantId: string; readonly value: number }[];
  readonly revision: number;
  readonly projectionHash: string;
}

export interface PublicLiveProjection {
  readonly apiVersion: "1.0";
  readonly competition: { readonly id: string; readonly name: string };
  readonly publishedRevision: number;
  readonly operationalRevision: number;
  readonly operation: OperationalPublicStatus;
  readonly contests: readonly PublicLiveContestProjection[];
  readonly projectionHash: string;
}

export interface OrganiserLiveProjection {
  readonly apiVersion: "1.0";
  readonly organizationId: string;
  readonly public: PublicLiveProjection;
  readonly liveVersion: number;
  readonly stateProofHash: string;
  readonly authorityAssignments: OperationalAuthorityAssignments;
  readonly incidents: readonly OperationalIncident[];
  readonly restartClearances: {
    readonly safety?: OperationalRestartClearance;
    readonly competition?: OperationalRestartClearance;
  };
  readonly participants: readonly {
    readonly participantId: string;
    readonly displayName: string;
    readonly status: ParticipantNextProjection["participant"]["status"];
    readonly revision: number;
    readonly projectionHash: string;
  }[];
  /** Staff-only control data. These IDs are the live runtime's fixture sides, never a name lookup. */
  readonly controlContests: readonly {
    readonly contestId: string;
    readonly courtId: string;
    readonly scheduledStart: string;
    readonly status: PublicLiveContestProjection["status"];
    readonly sidesResolved: boolean;
    readonly sides: readonly { readonly entrantId: string; readonly displayName: string }[];
  }[];
  /** Existing runtime control-room queues, projected for the Run Control surface. */
  readonly attention: readonly {
    readonly kind: "NOW" | "NEXT" | "LATE" | "BLOCKED" | "NEEDS_ATTENTION";
    readonly contestId: string;
    readonly courtId: string;
    readonly scheduledStart: string;
    readonly reasons: readonly string[];
  }[];
  readonly deliveryEvidence: readonly {
    readonly messageId: string;
    readonly recipientParticipantId: string;
    readonly status: "PENDING" | "LEASED" | "DELIVERED" | "DEAD_LETTER";
    readonly attempts: number;
    readonly providerId?: string;
    readonly providerMessageId?: string;
    readonly deliveredAt?: string;
  }[];
  readonly accessEvidence: readonly {
    readonly commandId: string;
    readonly kind: "ROTATED" | "REVOKED" | "RECOVERY_ISSUED";
    readonly participantId: string;
    readonly actorId: string;
    readonly occurredAt: string;
    readonly affectedCredentialCount: number;
    readonly replacementIssued: boolean;
  }[];
  readonly projectionHash: string;
}

function canonicalTimestamp(value: string): boolean {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function participantAccessClaims(grant: Omit<ParticipantAccessGrant, "tokenHash"> | ParticipantAccessGrant) {
  return { organizationId: grant.organizationId, competitionId: grant.competitionId,
    publishedRevision: grant.publishedRevision, participantId: grant.participantId,
    expiresAt: grant.expiresAt, keyVersion: grant.keyVersion,
    ...(grant.issuedByCommandId ? { issuedByCommandId: grant.issuedByCommandId } : {}) };
}

function tokenFor(grant: Omit<ParticipantAccessGrant, "tokenHash"> | ParticipantAccessGrant, secret: string): string {
  return `kp1_${createHmac("sha256", secret).update(canonicalHash(participantAccessClaims(grant))).digest("hex")}`;
}

export function createParticipantAccessGrant(input: Omit<ParticipantAccessGrant, "tokenHash">,
  secret: string, projectionRevision = input.publishedRevision): {
    readonly grant: ParticipantAccessGrant; readonly access: ParticipantAccess;
  } {
  if (secret.length < 32) throw new Error("participant_signing_not_configured");
  if (!input.organizationId.trim() || !input.competitionId.trim() || !input.participantId.trim()
    || !input.keyVersion.trim() || !Number.isSafeInteger(input.publishedRevision) || input.publishedRevision < 1
    || !Number.isSafeInteger(projectionRevision) || projectionRevision < input.publishedRevision
    || !canonicalTimestamp(input.expiresAt)) throw new Error("invalid_participant_access_grant");
  const token = tokenFor(input, secret);
  const grant = { ...input, tokenHash: canonicalHash(token) };
  return { grant, access: { token,
    path: `/next?competition=${encodeURIComponent(input.competitionId)}&revision=${projectionRevision}&token=${encodeURIComponent(token)}`,
    expiresAt: input.expiresAt } };
}

export function resolveParticipantAccess(grants: readonly ParticipantAccessGrant[], token: string,
  secrets: string | Readonly<Record<string, string>>, organizationId: string, competitionId: string,
  at: string): ParticipantAccessGrant {
  if (!canonicalTimestamp(at) || !/^kp1_[a-f0-9]{64}$/.test(token)) throw new Error("participant_access_denied");
  const suppliedHash = Buffer.from(canonicalHash(token), "hex");
  const grant = grants.find((candidate) => {
    const candidateHash = Buffer.from(candidate.tokenHash, "hex");
    return candidateHash.length === suppliedHash.length && timingSafeEqual(candidateHash, suppliedHash);
  });
  if (!grant || grant.organizationId !== organizationId || grant.competitionId !== competitionId || grant.revokedAt
    || Date.parse(grant.expiresAt) <= Date.parse(at)) throw new Error("participant_access_denied");
  const secret = typeof secrets === "string" ? secrets : secrets[grant.keyVersion];
  if (!secret || secret.length < 32) throw new Error("participant_access_denied");
  const expected = tokenFor(grant, secret);
  if (!timingSafeEqual(Buffer.from(expected), Buffer.from(token))) throw new Error("participant_access_denied");
  return grant;
}

function recoveryClaims(grant: Omit<ParticipantRecoveryGrant, "codeHash"> | ParticipantRecoveryGrant) {
  return { organizationId: grant.organizationId, competitionId: grant.competitionId,
    publishedRevision: grant.publishedRevision, operationalRevision: grant.operationalRevision,
    participantId: grant.participantId,
    codeExpiresAt: grant.codeExpiresAt, accessExpiresAt: grant.accessExpiresAt,
    keyVersion: grant.keyVersion, issuedByCommandId: grant.issuedByCommandId };
}

function recoveryCodeFor(grant: Omit<ParticipantRecoveryGrant, "codeHash"> | ParticipantRecoveryGrant,
  secret: string): string {
  return `kpr1_${createHmac("sha256", secret).update(canonicalHash(recoveryClaims(grant))).digest("hex").slice(0, 32)}`;
}

export function createParticipantRecoveryGrant(input: Omit<ParticipantRecoveryGrant, "codeHash">,
  secret: string): { readonly grant: ParticipantRecoveryGrant;
    readonly recovery: ParticipantRecoveryCode } {
  if (secret.length < 32) throw new Error("participant_signing_not_configured");
  if (!input.organizationId.trim() || !input.competitionId.trim() || !input.participantId.trim()
    || !input.keyVersion.trim() || !input.issuedBy.trim() || !input.issuedByCommandId.trim()
    || !Number.isSafeInteger(input.publishedRevision) || input.publishedRevision < 1
    || !Number.isSafeInteger(input.operationalRevision) || input.operationalRevision < input.publishedRevision
    || !canonicalTimestamp(input.codeExpiresAt) || !canonicalTimestamp(input.accessExpiresAt)
    || !canonicalTimestamp(input.issuedAt) || Date.parse(input.codeExpiresAt) <= Date.parse(input.issuedAt)
    || Date.parse(input.accessExpiresAt) <= Date.parse(input.issuedAt)) throw new Error("invalid_participant_recovery_grant");
  const code = recoveryCodeFor(input, secret);
  return { grant: { ...input, codeHash: canonicalHash(code) }, recovery: { code,
    eventPath: `/next/recover?competition=${encodeURIComponent(input.competitionId)}&revision=${input.operationalRevision}`,
    expiresAt: input.codeExpiresAt } };
}

export function resolveParticipantRecovery(grants: readonly ParticipantRecoveryGrant[], code: string,
  secrets: Readonly<Record<string, string>>, organizationId: string, competitionId: string,
  at: string): ParticipantRecoveryGrant {
  if (!canonicalTimestamp(at) || !/^kpr1_[a-f0-9]{32}$/.test(code)) throw new Error("participant_recovery_denied");
  const suppliedHash = Buffer.from(canonicalHash(code), "hex");
  const grant = grants.find((candidate) => {
    const candidateHash = Buffer.from(candidate.codeHash, "hex");
    return candidateHash.length === suppliedHash.length && timingSafeEqual(candidateHash, suppliedHash);
  });
  if (!grant || grant.organizationId !== organizationId || grant.competitionId !== competitionId || grant.revokedAt
    || Date.parse(grant.codeExpiresAt) <= Date.parse(at)) throw new Error("participant_recovery_denied");
  const secret = secrets[grant.keyVersion];
  if (!secret || secret.length < 32) throw new Error("participant_recovery_denied");
  const expected = recoveryCodeFor(grant, secret);
  if (!timingSafeEqual(Buffer.from(expected), Buffer.from(code))) throw new Error("participant_recovery_denied");
  return grant;
}

function eventTouchesParticipant(event: LiveOperationsEvent, participantId: string,
  participantContestIds: ReadonlySet<string>): boolean {
  if ("entrantId" in event && event.entrantId === participantId) return true;
  if ("winnerEntrantId" in event && event.winnerEntrantId === participantId) return true;
  if ("absentEntrantId" in event && event.absentEntrantId === participantId) return true;
  if ("retiredEntrantId" in event && event.retiredEntrantId === participantId) return true;
  return "contestId" in event && participantContestIds.has(event.contestId);
}

export function deriveParticipantNext(input: {
  readonly competitionId: string;
  readonly competitionName: string;
  readonly publishedRevision: number;
  readonly operationalRevision: number;
  readonly affectedParticipantIds: readonly string[];
  readonly participantRevisions?: Readonly<Record<string, number>>;
  readonly participantId: string;
  readonly participantNames: Readonly<Record<string, string>>;
  readonly state: LiveOperationsState;
  readonly assignments: readonly OperationalAssignment[];
  readonly operation: OperationalPublicStatus;
}): ParticipantNextProjection {
  const entrantsFor = (definition: LiveOperationsState["definition"]["contests"][number]): readonly string[] | null =>
    input.state.resolvedEntrants[definition.contestId] ?? null;
  const participantContests = input.state.definition.contests.filter((definition) =>
    entrantsFor(definition)?.includes(input.participantId));
  const participantContestIds = new Set(participantContests.map(({ contestId }) => contestId));
  const assignmentByContest = new Map(input.assignments.map((assignment) => [assignment.contestId, assignment]));
  const candidates = participantContests.flatMap((definition) => {
    const assignment = assignmentByContest.get(definition.contestId);
    const state = input.state.contests[definition.contestId];
    if (!assignment || !state || !new Set(["SCHEDULED", "IN_PROGRESS"]).has(state.status)) return [];
    return [{ definition, assignment, state }];
  }).sort((left, right) => {
    const leftRank = left.state.status === "IN_PROGRESS" ? 0 : 1;
    const rightRank = right.state.status === "IN_PROGRESS" ? 0 : 1;
    return leftRank - rightRank || left.assignment.start.localeCompare(right.assignment.start)
      || left.definition.contestId.localeCompare(right.definition.contestId);
  });
  const presence = input.state.entrantPresence[input.participantId];
  const participantStatus: ParticipantNextProjection["participant"]["status"] = presence === "WITHDRAWN" || presence === "NO_SHOW" ? "WITHDRAWN"
    : presence === "CHECKED_IN" ? "CHECKED_IN" : presence === "LATE" ? "LATE" : "EXPECTED";
  const selected = participantStatus === "WITHDRAWN" ? undefined : candidates[0];
  const relevantEvents = input.state.events.filter((event) => eventTouchesParticipant(event, input.participantId, participantContestIds));
  const revision = input.participantRevisions?.[input.participantId]
    ?? (input.affectedParticipantIds.includes(input.participantId) ? input.operationalRevision : input.publishedRevision);
  const body = {
    apiVersion: "1.0" as const,
    competition: { id: input.competitionId, name: input.competitionName },
    participant: { displayName: input.participantNames[input.participantId] ?? input.participantId,
      status: participantStatus },
    operation: input.operation,
    revision,
    next: selected ? {
      contestId: selected.definition.contestId,
      opponent: entrantsFor(selected.definition)?.length === 2
        ? input.participantNames[entrantsFor(selected.definition)!.find((id) => id !== input.participantId)!]
          ?? entrantsFor(selected.definition)!.find((id) => id !== input.participantId)! : null,
      court: selected.state.actualCourtId ?? selected.assignment.resourceId,
      reportingTime: new Date(Date.parse(selected.assignment.start) - 10 * 60_000).toISOString(),
      startsAt: selected.assignment.start,
      status: selected.state.status === "IN_PROGRESS" ? "IN_PROGRESS" as const
        : selected.state.calledAt ? "CALLED" as const : "SCHEDULED" as const,
    } : null,
    freshness: { relevantEventSequence: relevantEvents.at(-1)?.sequence ?? 0,
      relevantEventHash: relevantEvents.at(-1)?.eventHash ?? null },
  };
  return { ...body, projectionHash: canonicalHash(body) };
}

export function derivePublicLive(input: {
  readonly competitionId: string;
  readonly competitionName: string;
  readonly publishedRevision: number;
  readonly operationalRevision: number;
  readonly affectedContestIds: readonly string[];
  readonly contestRevisions?: Readonly<Record<string, number>>;
  readonly participantNames: Readonly<Record<string, string>>;
  readonly state: LiveOperationsState;
  readonly assignments: readonly OperationalAssignment[];
  readonly operation: OperationalPublicStatus;
}): PublicLiveProjection {
  const assignments = new Map(input.assignments.map((assignment) => [assignment.contestId, assignment]));
  const contests = input.state.definition.contests.flatMap((definition) => {
    const entrantIds = input.state.resolvedEntrants[definition.contestId] ?? [];
    const assignment = assignments.get(definition.contestId);
    if (!assignment) {
      if (!input.affectedContestIds.includes(definition.contestId)) return [];
      const original = definition;
      const status = input.state.contests[definition.contestId]?.status;
      if (status !== "WALKOVER") return [];
      const body = { contestId: definition.contestId,
        participantNames: entrantIds.map((id) => input.participantNames[id] ?? id),
        court: original.courtId, startsAt: original.scheduledStart, status,
        revision: input.contestRevisions?.[definition.contestId] ?? input.operationalRevision };
      return [{ ...body, projectionHash: canonicalHash(body) }];
    }
    const body = { contestId: definition.contestId,
      participantNames: entrantIds.map((id) => input.participantNames[id] ?? id),
      court: input.state.contests[definition.contestId]?.actualCourtId ?? assignment.resourceId,
      startsAt: assignment.start,
      status: input.state.contests[definition.contestId]?.status === "SCHEDULED"
        && input.state.contests[definition.contestId]?.calledAt ? "CALLED" as const
        : input.state.contests[definition.contestId]?.status ?? "SCHEDULED" as const,
      ...(input.state.contests[definition.contestId]?.scores
        ? { scores: input.state.contests[definition.contestId]!.scores } : {}),
      revision: input.contestRevisions?.[definition.contestId]
        ?? (input.affectedContestIds.includes(definition.contestId) ? input.operationalRevision : input.publishedRevision) };
    return [{ ...body, projectionHash: canonicalHash(body) }];
  }).sort((left, right) => left.startsAt.localeCompare(right.startsAt) || left.contestId.localeCompare(right.contestId));
  const body = { apiVersion: "1.0" as const, competition: { id: input.competitionId, name: input.competitionName },
    publishedRevision: input.publishedRevision, operationalRevision: input.operationalRevision,
    operation: input.operation, contests };
  return { ...body, projectionHash: canonicalHash(body) };
}
