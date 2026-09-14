import { canonicalHash } from "@tournament-os/tournament-schema";
import type { ParticipantNextProjection, PublicLiveProjection } from "./participant-information.js";

interface ManualFixture {
  readonly contestId: string;
  readonly participantNames: readonly string[];
  readonly court: string;
  readonly startsAt: string;
  readonly status: string;
  readonly revision: number;
  readonly projectionHash: string;
}

export interface ManualFallbackPack {
  readonly schemaVersion: "1.0.0";
  readonly status: "OPERATIONAL_MATERIALS_READY_SAFETY_AUTHORITY_BLOCKED";
  readonly classification: "ORGANISER_CONTROLLED_EVENT_DAY_MATERIAL";
  readonly competitionId: string;
  readonly publishedRevision: number;
  readonly operationalRevision: number;
  readonly generatedAt: string;
  readonly expiresAt: string;
  readonly schedule: {
    readonly fixtureCount: number;
    readonly fixtures: readonly ManualFixture[];
    readonly scheduleProjectionHash: string;
  };
  readonly courtSheets: readonly {
    readonly court: string;
    readonly fixtures: readonly ManualFixture[];
    readonly sheetHash: string;
  }[];
  readonly scoreSheets: readonly {
    readonly contestId: string;
    readonly participantNames: readonly string[];
    readonly court: string;
    readonly startsAt: string;
    readonly fields: readonly ["OUTCOME", "SCORE", "OFFICIAL", "RECORDED_AT", "CORRECTION_OF"];
    readonly sheetHash: string;
  }[];
  readonly participantQrIndex: {
    readonly status: "READY" | "BLOCKED_PARTICIPANT_SIGNING_NOT_CONFIGURED";
    readonly classification: "INDIVIDUAL_EXPIRING_ACCESS_DISTRIBUTE_SEPARATELY";
    readonly entries: readonly {
      readonly participantId: string;
      readonly displayName: string;
      readonly accessPath: string;
      readonly expiresAt: string;
      readonly entryHash: string;
    }[];
    readonly indexHash: string;
  };
  readonly restoration: {
    readonly steps: readonly string[];
    readonly evidenceFields: readonly string[];
    readonly truthReferenceHash: string;
  };
  readonly packHash: string;
}

export interface ManualParticipantAccess {
  readonly participantId: string;
  readonly accessPath: string;
  readonly expiresAt: string;
}

function validParticipantAccess(access: ManualParticipantAccess, input: {
  readonly competitionId: string; readonly operationalRevision: number; readonly expiresAt: string;
}): boolean {
  try {
    const parsed = new URL(access.accessPath, "https://offline.invalid");
    return access.expiresAt === input.expiresAt && parsed.origin === "https://offline.invalid"
      && parsed.pathname === "/next" && parsed.hash === ""
      && [...parsed.searchParams.keys()].sort().join(",") === "competition,revision,token"
      && parsed.searchParams.get("competition") === input.competitionId
      && parsed.searchParams.get("revision") === String(input.operationalRevision)
      && /^kp1_[a-f0-9]{64}$/.test(parsed.searchParams.get("token") ?? "");
  } catch { return false; }
}

function sortedFixtures(publicProjection: PublicLiveProjection): readonly ManualFixture[] {
  return [...publicProjection.contests].map(({ contestId, participantNames, court, startsAt, status, revision,
    projectionHash }) => ({ contestId, participantNames: [...participantNames], court, startsAt, status, revision,
    projectionHash })).sort((left, right) => left.startsAt.localeCompare(right.startsAt)
      || left.court.localeCompare(right.court) || left.contestId.localeCompare(right.contestId));
}

export function deriveManualFallbackPack(input: {
  readonly competitionId: string;
  readonly publishedRevision: number;
  readonly operationalRevision: number;
  readonly generatedAt: string;
  readonly expiresAt: string;
  readonly publicProjection: PublicLiveProjection;
  readonly participantLookup: readonly { readonly participantId: string; readonly projection: ParticipantNextProjection }[];
  readonly participantAccess: readonly ManualParticipantAccess[];
  readonly truthReferences: Readonly<Record<string, string>>;
}): ManualFallbackPack {
  const fixtures = sortedFixtures(input.publicProjection);
  const courts = [...new Set(fixtures.map(({ court }) => court))].sort();
  const courtSheets = courts.map((court) => {
    const courtFixtures = fixtures.filter((fixture) => fixture.court === court);
    const body = { court, fixtures: courtFixtures };
    return { ...body, sheetHash: canonicalHash(body) };
  });
  const scoreSheets = fixtures.map(({ contestId, participantNames, court, startsAt }) => {
    const body = { contestId, participantNames, court, startsAt,
      fields: ["OUTCOME", "SCORE", "OFFICIAL", "RECORDED_AT", "CORRECTION_OF"] as const };
    return { ...body, sheetHash: canonicalHash(body) };
  });
  const participantById = new Map(input.participantLookup.map(({ participantId, projection }) =>
    [participantId, projection.participant.displayName]));
  const accessById = new Map(input.participantAccess.map((access) => [access.participantId, access]));
  const qrReady = participantById.size === input.participantLookup.length && participantById.size > 0
    && accessById.size === participantById.size && [...participantById.keys()].every((id) => accessById.has(id))
    && input.participantAccess.every((access) => validParticipantAccess(access, input));
  const qrEntries = qrReady ? [...participantById.entries()].sort(([left], [right]) => left.localeCompare(right))
    .map(([participantId, displayName]) => {
      const access = accessById.get(participantId)!;
      const body = { participantId, displayName, accessPath: access.accessPath, expiresAt: access.expiresAt };
      return { ...body, entryHash: canonicalHash(body) };
    }) : [];
  const participantQrBody = {
    status: qrReady ? "READY" as const : "BLOCKED_PARTICIPANT_SIGNING_NOT_CONFIGURED" as const,
    classification: "INDIVIDUAL_EXPIRING_ACCESS_DISTRIBUTE_SEPARATELY" as const,
    entries: qrEntries,
  };
  const participantQrIndex = { ...participantQrBody, indexHash: canonicalHash(participantQrBody) };
  const restoration = {
    steps: [
      "Keep the latest signed pack and all numbered court sheets under organiser control.",
      "Record every manual outcome, score, official, time and correction reference without erasing prior entries.",
      "When service returns, refresh authoritative truth before entering any manual record.",
      "Submit manual records in sheet order with new idempotency keys and the observed authoritative head.",
      "Treat stale commands as conflicts; compare them with server truth and reconcile explicitly.",
      "Confirm every acknowledged command and participant/public revision before ending manual operation.",
      "Retain the signed pack and completed sheets with the final evidence bundle.",
    ],
    evidenceFields: ["SHEET_ID", "COMMAND_ID", "EXPECTED_VERSION", "SERVER_VERSION", "ACKNOWLEDGED_AT", "RECONCILED_BY"],
    truthReferenceHash: canonicalHash(input.truthReferences),
  };
  const body = { schemaVersion: "1.0.0" as const,
    status: "OPERATIONAL_MATERIALS_READY_SAFETY_AUTHORITY_BLOCKED" as const,
    classification: "ORGANISER_CONTROLLED_EVENT_DAY_MATERIAL" as const,
    competitionId: input.competitionId, publishedRevision: input.publishedRevision,
    operationalRevision: input.operationalRevision, generatedAt: input.generatedAt, expiresAt: input.expiresAt,
    schedule: { fixtureCount: fixtures.length, fixtures,
      scheduleProjectionHash: canonicalHash(input.publicProjection.contests) }, courtSheets, scoreSheets,
    participantQrIndex, restoration };
  return { ...body, packHash: canonicalHash(body) };
}

export function verifyManualFallbackPack(pack: ManualFallbackPack, input: {
  readonly publicProjection: PublicLiveProjection;
  readonly participantLookup: readonly { readonly participantId: string; readonly projection: ParticipantNextProjection }[];
  readonly truthReferences: Readonly<Record<string, string>>;
}): boolean {
  try {
    const rebuilt = deriveManualFallbackPack({ competitionId: pack.competitionId,
      publishedRevision: pack.publishedRevision, operationalRevision: pack.operationalRevision,
      generatedAt: pack.generatedAt, expiresAt: pack.expiresAt, publicProjection: input.publicProjection,
      participantLookup: input.participantLookup, participantAccess: pack.participantQrIndex.entries.map((entry) =>
        ({ participantId: entry.participantId, accessPath: entry.accessPath, expiresAt: entry.expiresAt })),
      truthReferences: input.truthReferences });
    return canonicalHash(rebuilt) === canonicalHash(pack);
  } catch { return false; }
}
