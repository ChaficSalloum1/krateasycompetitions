import { canonicalHash, deepFreeze } from "@tournament-os/tournament-schema";
import {
  verifyPublicationCertificate,
  verifyPublicationChangeSet,
  type CompetitionGuardReport,
  type PublicationCertificate,
  type PublicationChangeSet,
} from "@tournament-os/competition-engine";
import {
  verifyCompetitionEvidenceBundle,
  type CompetitionClosure,
  type CompetitionEvidenceBundle,
} from "./competition-lifecycle.js";

export type PilotAuthorityRole =
  | "PRODUCT_OWNER"
  | "COMPETITION_DOMAIN"
  | "GUARD_ASSURANCE"
  | "EVENT_OPERATIONS"
  | "ACCESSIBILITY"
  | "PLATFORM_SECURITY"
  | "VENUE_SAFETY";

export interface PilotAuthorityAcceptance {
  readonly gateId: PilotAuthorityGateId;
  readonly role: PilotAuthorityRole;
  readonly ownerId: string;
  readonly decision: "ACCEPTED" | "REJECTED";
  readonly acceptedAt: string;
  readonly evidenceRef: string;
  readonly scopeHash: string;
  readonly fallbackAcknowledged: boolean;
}

interface PilotAuthorityGate {
  readonly id: string;
  readonly role: PilotAuthorityRole;
  readonly requirement: string;
  readonly fallback: string;
}

export const PILOT_AUTHORITY_GATES = [
  {
    id: "DELIVERY_PROVIDER_AND_FALLBACK",
    role: "PLATFORM_SECURITY",
    requirement: "A production delivery provider, credentials, receipt semantics and declared non-urgent fallback are verified.",
    fallback: "Do not enable remote delivery; use the signed participant QR, venue display and controlled manual contact process.",
  },
  {
    id: "MANUAL_EMERGENCY_REHEARSAL",
    role: "EVENT_OPERATIONS",
    requirement: "Trained staff complete the disconnect, paper operation, reconciliation and separately authorised restart rehearsal.",
    fallback: "Pause digital commands, use the signed manual pack, retain every paper fact, and require controlled reconciliation before restart.",
  },
  {
    id: "VENUE_SAFETY_DETAILS",
    role: "VENUE_SAFETY",
    requirement: "Named responders, contacts, venue access and evacuation details are supplied and approved by the venue safety authority.",
    fallback: "Do not claim emergency readiness; use the venue's separately controlled printed safety plan and stop play when safety is uncertain.",
  },
  {
    id: "ACCESSIBILITY_FIELD_ACCEPTANCE",
    role: "ACCESSIBILITY",
    requirement: "Core tasks pass named VoiceOver/NVDA, printed-paper and representative outdoor/mobile inspection.",
    fallback: "Do not release until equivalent task completion is demonstrated; provide staffed assisted access without weakening privacy or authority.",
  },
  {
    id: "WEAK_NETWORK_RETRIEVAL",
    role: "EVENT_OPERATIONS",
    requirement: "The participant next-action journey meets the pilot retrieval target under representative venue network conditions.",
    fallback: "Use the signed QR/manual lookup and venue display; do not represent stale cached information as current truth.",
  },
  {
    id: "PRODUCTION_PERSISTENCE_AND_RESTORE",
    role: "PLATFORM_SECURITY",
    requirement: "Production identity, PostgreSQL persistence, backups and a staff-run restore are verified with deployment-owned credentials.",
    fallback: "Do not route pilot traffic; retain rehearsal-only status and the verified local closure bundle until production recovery is proven.",
  },
  {
    id: "SUPPORT_AND_ROLLBACK",
    role: "EVENT_OPERATIONS",
    requirement: "A named support owner accepts the operating limitations, escalation path and rollback procedure.",
    fallback: "Stop new digital writes, preserve the command journal, switch to the signed manual pack and restore only through the verified evidence bundle.",
  },
  {
    id: "PRODUCT_ENVELOPE_APPROVAL",
    role: "PRODUCT_OWNER",
    requirement: "The product owner accepts the named St Albans pilot envelope and its recorded limitations.",
    fallback: "Keep the product in rehearsal and do not present it as pilot-ready.",
  },
  {
    id: "COMPETITION_RULES_APPROVAL",
    role: "COMPETITION_DOMAIN",
    requirement: "The competition-domain owner accepts the explicit qualification, scoring, tiebreak, normalisation and withdrawal policies.",
    fallback: "Do not publish or operate the event until the competition authority resolves the disputed rule.",
  },
  {
    id: "ASSURANCE_EVIDENCE_APPROVAL",
    role: "GUARD_ASSURANCE",
    requirement: "The assurance owner accepts the independent Guard, adversarial, replay and recovery evidence for this exact scope.",
    fallback: "Block release and retain the last independently certified revision.",
  },
  {
    id: "EVENT_OPERATIONS_APPROVAL",
    role: "EVENT_OPERATIONS",
    requirement: "The event-operations owner accepts the command, disruption, communication, close and recovery operating model.",
    fallback: "Keep the event in rehearsal or run under the separately authorised manual operating plan.",
  },
] as const satisfies readonly PilotAuthorityGate[];

export type PilotAuthorityGateId = typeof PILOT_AUTHORITY_GATES[number]["id"];

export interface PilotReleaseBlocker {
  readonly code: string;
  readonly gateId?: PilotAuthorityGateId;
  readonly ownerRole: PilotAuthorityRole | "ENGINEERING";
  readonly message: string;
  readonly fallback: string;
}

export interface PilotReleaseManifest {
  readonly schemaVersion: "1.0.0";
  readonly status: "READY" | "BLOCKED_SOFTWARE" | "BLOCKED_EXTERNAL_AUTHORITY";
  readonly organizationId: string;
  readonly competitionId: string;
  readonly publishedRevision: number;
  readonly operationalRevision: number;
  readonly liveVersion: number;
  readonly closureHash: string;
  readonly evidenceBundleHash: string;
  readonly scopeHash: string;
  readonly assessedAt: string;
  readonly softwareEvidence: readonly {
    readonly id: string;
    readonly evidenceHash: string;
  }[];
  readonly authorityAcceptances: readonly PilotAuthorityAcceptance[];
  readonly blockers: readonly PilotReleaseBlocker[];
  readonly manifestHash: string;
}

function canonicalTime(value: string, label: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) throw new Error(`${label}_must_be_canonical`);
  return parsed;
}

function parseArtifact<T>(bundle: CompetitionEvidenceBundle, fileName: string): T {
  const artifact = bundle.artifacts.find((candidate) => candidate.fileName === fileName);
  if (!artifact) throw new Error("invalid_pilot_release_bundle");
  try { return JSON.parse(artifact.content) as T; }
  catch { throw new Error("invalid_pilot_release_bundle"); }
}

export function pilotReleaseScope(bundle: CompetitionEvidenceBundle): string {
  verifyCompetitionEvidenceBundle(bundle);
  const closure = parseArtifact<CompetitionClosure>(bundle, "closure.json");
  return canonicalHash({ schemaVersion: "pilot-release-scope/1.0.0", organizationId: bundle.organizationId,
    competitionId: bundle.competitionId, publishedRevision: closure.publishedRevision,
    operationalRevision: closure.operationalRevision, liveVersion: closure.liveVersion,
    closureHash: bundle.closureHash, evidenceBundleHash: bundle.bundleHash });
}

export function assessPilotRelease(input: {
  readonly bundle: CompetitionEvidenceBundle;
  readonly acceptances: readonly PilotAuthorityAcceptance[];
  readonly assessedAt: string;
  readonly maximumAcceptanceAgeMs: number;
}): Readonly<PilotReleaseManifest> {
  const assessedAtMs = canonicalTime(input.assessedAt, "assessedAt");
  if (!Number.isSafeInteger(input.maximumAcceptanceAgeMs) || input.maximumAcceptanceAgeMs <= 0)
    throw new Error("maximumAcceptanceAgeMs_must_be_positive");
  verifyCompetitionEvidenceBundle(input.bundle);
  const closure = parseArtifact<CompetitionClosure>(input.bundle, "closure.json");
  const guard = parseArtifact<CompetitionGuardReport>(input.bundle, "guard-report.json");
  const changeSet = parseArtifact<PublicationChangeSet>(input.bundle, "publication-change-set.json");
  const publicationArtifact = parseArtifact<{ readonly publication: {
    readonly changeSetHash: string; readonly certificateHash: string; readonly certificate: PublicationCertificate;
  } }>(input.bundle, "publication.json");
  const scopeHash = pilotReleaseScope(input.bundle);
  const softwareBlockers: PilotReleaseBlocker[] = [];
  const engineeringFallback = "Keep the pilot in rehearsal and retain the last independently verified evidence bundle.";
  if (closure.organizationId !== input.bundle.organizationId || closure.competitionId !== input.bundle.competitionId
    || closure.closureHash !== input.bundle.closureHash)
    softwareBlockers.push({ code: "RELEASE_IDENTITY_MISMATCH", ownerRole: "ENGINEERING",
      message: "The closure and evidence bundle do not identify the same authoritative competition.", fallback: engineeringFallback });
  if (closure.resultSummary.total !== 108 || closure.resultSummary.unresolved !== 0)
    softwareBlockers.push({ code: "ST_ALBANS_RESULT_ACCOUNTING_MISMATCH", ownerRole: "ENGINEERING",
      message: "The St Albans rehearsal must close exactly 108 results with none unresolved.", fallback: engineeringFallback });
  if (guard.status !== "PASSED" || guard.integrityGrade !== "CERTIFIED" || guard.guardVersion !== "1.2.0"
    || !guard.accounting.reconciled || guard.reportHash !== closure.authority.guardReportHash)
    softwareBlockers.push({ code: "INDEPENDENT_GUARD_EVIDENCE_MISMATCH", ownerRole: "ENGINEERING",
      message: "The closed revision is not bound to the current independently passing Guard report.", fallback: engineeringFallback });
  if (!verifyPublicationChangeSet(changeSet)
    || changeSet.changeSetHash !== closure.authority.publicationChangeSetHash
    || publicationArtifact.publication.changeSetHash !== changeSet.changeSetHash
    || publicationArtifact.publication.certificateHash !== publicationArtifact.publication.certificate.certificateHash
    || !verifyPublicationCertificate(publicationArtifact.publication.certificate, guard, changeSet)) {
    softwareBlockers.push({ code: "PUBLICATION_CHANGE_SET_MISMATCH", ownerRole: "ENGINEERING",
      message: "The reviewed definition and operational diff is not bound to the exact publication certificate.",
      fallback: engineeringFallback });
  }
  if (closure.publishedRevision < 1 || closure.operationalRevision < closure.publishedRevision || closure.liveVersion < 1)
    softwareBlockers.push({ code: "INVALID_REVISION_CHAIN", ownerRole: "ENGINEERING",
      message: "The published, operational and live revision chain is incomplete.", fallback: engineeringFallback });

  const authorityBlockers: PilotReleaseBlocker[] = [];
  const byGate = new Map<PilotAuthorityGateId, PilotAuthorityAcceptance>();
  for (const acceptance of input.acceptances) {
    const gate = PILOT_AUTHORITY_GATES.find(({ id }) => id === acceptance.gateId);
    if (!gate || byGate.has(acceptance.gateId)) {
      authorityBlockers.push({ code: "DUPLICATE_OR_UNKNOWN_AUTHORITY_GATE", ownerRole: gate?.role ?? "ENGINEERING",
        ...(gate ? { gateId: gate.id } : {}), message: "Authority evidence contains an unknown or duplicate gate.",
        fallback: gate?.fallback ?? engineeringFallback });
      continue;
    }
    byGate.set(acceptance.gateId, acceptance);
  }
  for (const gate of PILOT_AUTHORITY_GATES) {
    const acceptance = byGate.get(gate.id);
    if (!acceptance) {
      authorityBlockers.push({ code: "AUTHORITY_ACCEPTANCE_MISSING", gateId: gate.id, ownerRole: gate.role,
        message: gate.requirement, fallback: gate.fallback });
      continue;
    }
    let acceptedAtMs: number | undefined;
    try { acceptedAtMs = canonicalTime(acceptance.acceptedAt, `${gate.id}.acceptedAt`); }
    catch { /* represented as a fail-closed blocker below */ }
    const malformed = acceptance.role !== gate.role || !acceptance.ownerId.trim()
      || acceptance.evidenceRef.trim().length < 4 || acceptance.evidenceRef.length > 500
      || acceptance.scopeHash !== scopeHash || !acceptance.fallbackAcknowledged
      || acceptedAtMs === undefined || acceptedAtMs > assessedAtMs
      || assessedAtMs - acceptedAtMs > input.maximumAcceptanceAgeMs;
    if (malformed) authorityBlockers.push({ code: "AUTHORITY_ACCEPTANCE_INVALID", gateId: gate.id,
      ownerRole: gate.role, message: `${gate.requirement} The acceptance must be fresh, correctly scoped, evidence-backed and acknowledge the declared fallback.`,
      fallback: gate.fallback });
    else if (acceptance.decision !== "ACCEPTED") authorityBlockers.push({ code: "AUTHORITY_REJECTED",
      gateId: gate.id, ownerRole: gate.role, message: gate.requirement, fallback: gate.fallback });
  }

  const blockers = [...softwareBlockers, ...authorityBlockers].sort((left, right) =>
    `${left.gateId ?? ""}|${left.code}`.localeCompare(`${right.gateId ?? ""}|${right.code}`));
  const authorityAcceptances = [...input.acceptances].sort((left, right) => left.gateId.localeCompare(right.gateId));
  const softwareEvidence = [
    { id: "authoritative-closure", evidenceHash: closure.closureHash },
    { id: "evidence-bundle", evidenceHash: input.bundle.bundleHash },
    { id: "independent-guard", evidenceHash: guard.reportHash },
    { id: "publication-certificate", evidenceHash: closure.authority.publicationCertificateHash },
    { id: "actual-results", evidenceHash: closure.resultSummary.resultsHash },
    { id: "live-replay", evidenceHash: closure.authority.liveStateProofHash },
    { id: "operational-replay", evidenceHash: closure.authority.operationalStateProofHash },
  ].sort((left, right) => left.id.localeCompare(right.id));
  const status: PilotReleaseManifest["status"] = softwareBlockers.length ? "BLOCKED_SOFTWARE"
    : authorityBlockers.length ? "BLOCKED_EXTERNAL_AUTHORITY" : "READY";
  const body = { schemaVersion: "1.0.0" as const, status, organizationId: input.bundle.organizationId,
    competitionId: input.bundle.competitionId, publishedRevision: closure.publishedRevision,
    operationalRevision: closure.operationalRevision, liveVersion: closure.liveVersion,
    closureHash: closure.closureHash, evidenceBundleHash: input.bundle.bundleHash, scopeHash,
    assessedAt: input.assessedAt, softwareEvidence, authorityAcceptances, blockers };
  return deepFreeze({ ...body, manifestHash: canonicalHash(body) });
}
