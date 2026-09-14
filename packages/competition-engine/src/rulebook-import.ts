import { canonicalHash, deepFreeze } from "@tournament-os/tournament-schema";

export type RuleValueKind = "minutes" | "integer" | "boolean" | "text";

export interface RegisteredRulePrimitive {
  id: string;
  aliases: readonly string[];
  valueKind: RuleValueKind;
}

export interface RulePrimitiveRegistry {
  version: string;
  primitives: readonly RegisteredRulePrimitive[];
}

export interface RulebookPage {
  pageNumber: number;
  text: string;
}

export interface ImportedRulebookSource {
  documentId: string;
  version: string;
  pages: readonly RulebookPage[];
}

export interface RulebookCitation {
  documentId: string;
  documentVersion: string;
  pageNumber: number;
  segmentIndex: number;
  excerpt: string;
  segmentHash: string;
}

export type CandidateReviewState = "PENDING_APPROVAL" | "QUARANTINED" | "APPROVED" | "REJECTED";
export type CandidateQuarantineReason = "UNKNOWN_DIRECTIVE" | "AMBIGUOUS_PRIMITIVE" | "INVALID_VALUE" | "INJECTION_LIKE" | "CONFLICTING_DIRECTIVE";

export interface ImportedRuleCandidate {
  id: string;
  primitiveId: string | null;
  value: unknown;
  reviewState: CandidateReviewState;
  activationState: "CANDIDATE_ONLY";
  quarantineReasons: CandidateQuarantineReason[];
  citation: RulebookCitation;
  reviewedBy?: string;
  reviewedAt?: string;
}

export interface RulebookCandidateImport {
  importVersion: "1.0.0";
  documentId: string;
  documentVersion: string;
  registryVersion: string;
  documentHash: string;
  registryHash: string;
  candidates: ImportedRuleCandidate[];
  proofHash: string;
}

export interface RulebookCandidateReview {
  candidateId: string;
  decision: "APPROVE" | "REJECT";
  reviewerId: string;
  reviewedAt: string;
  expectedProofHash: string;
}

interface Segment {
  pageNumber: number;
  segmentIndex: number;
  text: string;
}

function segments(source: ImportedRulebookSource): Segment[] {
  return [...source.pages]
    .sort((left, right) => left.pageNumber - right.pageNumber)
    .flatMap(({ pageNumber, text }) => {
      const values = text.split(/\n+/u).flatMap((line) => line.match(/[^.!?]+[.!?]+|[^.!?]+$/gu) ?? []).map((value) => value.trim()).filter(Boolean);
      return values.map((value, index) => ({ pageNumber, segmentIndex: index + 1, text: value }));
    });
}

function parseValue(text: string, primitive: RegisteredRulePrimitive): unknown {
  switch (primitive.valueKind) {
    case "minutes": {
      const match = text.match(/:\s*(\d+)\s*minutes?\b/iu);
      return match ? Number(match[1]) : null;
    }
    case "integer": {
      const match = text.match(/:\s*(-?\d+)\b/u);
      return match ? Number(match[1]) : null;
    }
    case "boolean": {
      const match = text.match(/:\s*(true|false|yes|no)\b/iu);
      if (!match) return null;
      return ["true", "yes"].includes(match[1]!.toLowerCase());
    }
    case "text": return text.slice(text.indexOf(":") + 1).trim() || null;
  }
}

function looksLikeInjection(text: string): boolean {
  return /\b(ignore\s+(all\s+)?previous|system\s+prompt|developer\s+message|override\s+(safety|rules?)|do\s+not\s+follow|activate\s+(this|the|minimum|maximum|rule))\b/iu.test(text);
}

export function importRulebookCandidates(source: ImportedRulebookSource, registry: RulePrimitiveRegistry): Readonly<RulebookCandidateImport> {
  const documentHash = canonicalHash(source);
  const registryHash = canonicalHash(registry);
  const candidates = segments(source).map((segment): ImportedRuleCandidate => {
    const normalized = segment.text.toLocaleLowerCase("en-US");
    const matched = registry.primitives.filter(({ aliases }) => aliases.some((alias) => normalized.startsWith(`${alias.toLocaleLowerCase("en-US")}:`)));
    const injectionLike = looksLikeInjection(segment.text);
    const primitive = injectionLike || matched.length !== 1 ? undefined : matched[0];
    const value = primitive ? parseValue(segment.text, primitive) : null;
    const quarantineReasons: CandidateQuarantineReason[] = injectionLike
      ? ["INJECTION_LIKE"]
      : matched.length === 0
        ? ["UNKNOWN_DIRECTIVE"]
        : matched.length > 1
          ? ["AMBIGUOUS_PRIMITIVE"]
          : value === null
            ? ["INVALID_VALUE"]
            : [];
    const segmentHash = canonicalHash(segment.text);
    return {
      id: `rule-candidate.${canonicalHash({ documentHash, registryHash, ...segment })}`,
      primitiveId: primitive?.id ?? null,
      value,
      reviewState: quarantineReasons.length ? "QUARANTINED" : "PENDING_APPROVAL",
      activationState: "CANDIDATE_ONLY",
      quarantineReasons,
      citation: {
        documentId: source.documentId,
        documentVersion: source.version,
        pageNumber: segment.pageNumber,
        segmentIndex: segment.segmentIndex,
        excerpt: segment.text,
        segmentHash,
      },
    };
  });
  const byPrimitive = new Map<string, ImportedRuleCandidate[]>();
  for (const candidate of candidates) if (candidate.primitiveId && candidate.reviewState === "PENDING_APPROVAL") {
    byPrimitive.set(candidate.primitiveId, [...(byPrimitive.get(candidate.primitiveId) ?? []), candidate]);
  }
  for (const group of byPrimitive.values()) if (new Set(group.map(({ value }) => canonicalHash(value))).size > 1) {
    for (const candidate of group) {
      candidate.reviewState = "QUARANTINED";
      candidate.quarantineReasons = ["CONFLICTING_DIRECTIVE"];
    }
  }
  const partial = {
    importVersion: "1.0.0" as const,
    documentId: source.documentId,
    documentVersion: source.version,
    registryVersion: registry.version,
    documentHash,
    registryHash,
    candidates,
  };
  return deepFreeze({ ...partial, proofHash: canonicalHash(partial) });
}

export function reviewRulebookCandidate(
  imported: Readonly<RulebookCandidateImport>,
  review: RulebookCandidateReview,
): Readonly<RulebookCandidateImport> {
  if (review.expectedProofHash !== imported.proofHash) throw new Error("Cannot review against a stale import proof");
  if (!review.reviewerId || !Number.isFinite(Date.parse(review.reviewedAt))) throw new Error("Review requires a reviewer and valid timestamp");
  const candidates = structuredClone(imported.candidates);
  const candidate = candidates.find(({ id }) => id === review.candidateId);
  if (!candidate) throw new Error(`Unknown rulebook candidate: ${review.candidateId}`);
  if (candidate.reviewState === "QUARANTINED") throw new Error("A quarantined candidate cannot be approved or rejected through normal review");
  if (candidate.reviewState !== "PENDING_APPROVAL") throw new Error("A candidate can be reviewed only once");
  candidate.reviewState = review.decision === "APPROVE" ? "APPROVED" : "REJECTED";
  candidate.reviewedBy = review.reviewerId;
  candidate.reviewedAt = new Date(Date.parse(review.reviewedAt)).toISOString();
  const { proofHash: _priorProof, ...prior } = imported;
  void _priorProof;
  const partial: Omit<RulebookCandidateImport, "proofHash"> = { ...structuredClone(prior), candidates };
  return deepFreeze({ ...partial, proofHash: canonicalHash(partial) });
}
