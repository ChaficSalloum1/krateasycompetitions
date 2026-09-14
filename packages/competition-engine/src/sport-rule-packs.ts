import { createHash } from "node:crypto";
import {
  createSportSemantics,
  type EvaluationResult,
  type SportPolicy,
} from "./sport-semantics.js";

export const SPORT_RULE_PACK_SCALE_ENVELOPE = Object.freeze({ maximumPacks: 10_000, maximumVersionsPerPack: 100 });
export const ILLUSTRATIVE_RULE_PACK_DISCLAIMER =
  "Example rule packs demonstrate software conformance only and are not official federation rules or certification.";

export type SportRulePackContent = Readonly<{
  id: string;
  version: string;
  title: string;
  owner: Readonly<{ id: string; name: string }>;
  authority: Readonly<{ id: string; name: string; kind: "ORGANIZER" | "GOVERNING_BODY" | "VENDOR" }>;
  jurisdiction: string;
  effectiveFrom: string;
  expiresAt?: string;
  assurance: "ILLUSTRATIVE_CONFORMANCE_ONLY";
  semanticReference: Readonly<{ policyId: string; policyVersion: string; adapter: SportPolicy["adapter"] }>;
  compatibility: Readonly<{ sportSemanticsApiVersion: string; engineVersion: string }>;
}>;

export type SportRulePackApprovalInput = Readonly<{
  decision: "APPROVED" | "REJECTED" | "PENDING";
  authorityId: string;
  approverId: string;
  approvedAt: string;
  evidence: string;
}>;

export type SportRulePack = Readonly<{
  content: SportRulePackContent;
  contentHash: string;
  approval: SportRulePackApprovalInput & Readonly<{ contentHash: string; evidenceHash: string }>;
  proofHash: string;
}>;

export type RulePackFinding = Readonly<{ code: string; message: string }>;
export type RulePackLookup = Readonly<{ packId: string; version?: string; jurisdiction: string; at: string }>;
export type RulePackResolution = Readonly<{
  status: "RESOLVED" | "REJECTED";
  pack: SportRulePack | null;
  findings: readonly RulePackFinding[];
  proofHash: string;
}>;
export type GovernedEvaluationRequest = RulePackLookup & Readonly<{
  contestId: string;
  entrants: readonly string[];
  result: unknown;
}>;
export type GovernedEvaluationResult = Readonly<{
  status: "CERTIFIED" | "REJECTED";
  pack: SportRulePack | null;
  semanticResult: EvaluationResult | null;
  findings: readonly RulePackFinding[];
  governanceProofHash: string;
  proofHash: string;
}>;

export interface SportRulePackRegistry {
  resolve(lookup: RulePackLookup): RulePackResolution;
  evaluate(request: GovernedEvaluationRequest): GovernedEvaluationResult;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(",")}}`;
  return JSON.stringify(value) ?? "undefined";
}

function digest(value: unknown): string {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

function immutable<T>(value: T): Readonly<T> {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) immutable(child);
    Object.freeze(value);
  }
  return value;
}

export function sealSportRulePack(content: SportRulePackContent, approval: SportRulePackApprovalInput): SportRulePack {
  const clonedContent = structuredClone(content);
  const contentHash = digest(clonedContent);
  const boundApproval = { ...structuredClone(approval), contentHash,
    evidenceHash: digest({ ...approval, contentHash }) };
  return immutable({ content: clonedContent, contentHash, approval: boundApproval,
    proofHash: digest({ contentHash, approval: boundApproval }) });
}

export type SportRulePackRegistryOptions = Readonly<{
  packs: readonly SportRulePack[];
  policies: readonly SportPolicy[];
  compatibility: Readonly<{ sportSemanticsApiVersion: string; engineVersion: string }>;
}>;

function resultHash(value: unknown): string {
  return digest(value);
}

export function createSportRulePackRegistry(options: SportRulePackRegistryOptions): SportRulePackRegistry {
  const packs = structuredClone(options.packs);
  const policies = structuredClone(options.policies);
  const compatibility = structuredClone(options.compatibility);
  const semantics = createSportSemantics(policies);
  const countsById = new Map<string, number>();
  for (const pack of packs) countsById.set(pack.content.id, (countsById.get(pack.content.id) ?? 0) + 1);
  const scaleExceeded = packs.length > SPORT_RULE_PACK_SCALE_ENVELOPE.maximumPacks ||
    [...countsById.values()].some((count) => count > SPORT_RULE_PACK_SCALE_ENVELOPE.maximumVersionsPerPack);
  function reject(lookup: RulePackLookup, code: string, message: string, pack: SportRulePack | null = null): RulePackResolution {
    const body = { status: "REJECTED" as const, pack, findings: [{ code, message }] };
    return immutable({ ...body, proofHash: resultHash({ lookup, ...body }) });
  }
  function versionParts(version: string): readonly [number, number, number] | null {
    const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(version);
    return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
  }
  function compareVersions(left: SportRulePack, right: SportRulePack): number {
    const leftParts = versionParts(left.content.version) ?? [-1, -1, -1];
    const rightParts = versionParts(right.content.version) ?? [-1, -1, -1];
    for (let index = 0; index < 3; index += 1) {
      const difference = rightParts[index]! - leftParts[index]!;
      if (difference !== 0) return difference;
    }
    return left.proofHash.localeCompare(right.proofHash);
  }
  function validTimestamp(value: string): boolean {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) || !Number.isFinite(Date.parse(value))) return false;
    return new Date(value).toISOString() === value;
  }
  function governanceFinding(pack: SportRulePack, lookup: RulePackLookup): RulePackFinding | null {
    const { evidenceHash, contentHash: approvalContentHash, ...approvalInput } = pack.approval;
    if (pack.contentHash !== digest(pack.content) || approvalContentHash !== pack.contentHash ||
      evidenceHash !== digest({ ...approvalInput, contentHash: approvalContentHash }) ||
      pack.proofHash !== digest({ contentHash: pack.contentHash, approval: pack.approval })) {
      return { code: "TAMPERED_RULE_PACK", message: "Content, approval evidence, or proof hash does not verify." };
    }
    if (!pack.content.id.trim() || !versionParts(pack.content.version) || !pack.content.title.trim() || !pack.content.owner.id.trim() ||
      !pack.content.owner.name.trim() || !pack.content.authority.id.trim() || !pack.content.authority.name.trim() ||
      !(["ORGANIZER", "GOVERNING_BODY", "VENDOR"] as const).includes(pack.content.authority.kind) ||
      !pack.content.jurisdiction.trim() || pack.content.assurance !== "ILLUSTRATIVE_CONFORMANCE_ONLY" ||
      !pack.content.semanticReference.policyId.trim() || !pack.content.semanticReference.policyVersion.trim() ||
      !validTimestamp(pack.content.effectiveFrom) || (pack.content.expiresAt !== undefined &&
        (!validTimestamp(pack.content.expiresAt) || Date.parse(pack.content.expiresAt) <= Date.parse(pack.content.effectiveFrom))) ||
      !validTimestamp(pack.approval.approvedAt) || !pack.approval.approverId.trim() || !pack.approval.evidence.trim()) {
      return { code: "MALFORMED_RULE_PACK", message: "Rule-pack identity, authority, version, jurisdiction, and dates must be canonical." };
    }
    if (pack.approval.decision !== "APPROVED") {
      return { code: "UNAPPROVED_RULE_PACK", message: "Only an explicitly approved pack may govern a result." };
    }
    if (pack.approval.authorityId !== pack.content.authority.id) {
      return { code: "APPROVAL_AUTHORITY_MISMATCH", message: "Approval evidence is not issued by the pack's declared authority." };
    }
    if (pack.content.compatibility.sportSemanticsApiVersion !== compatibility.sportSemanticsApiVersion ||
      pack.content.compatibility.engineVersion !== compatibility.engineVersion) {
      return { code: "INCOMPATIBLE_RULE_PACK", message: "The pack targets a different semantics API or engine version." };
    }
    const referencedPolicy = policies.find(({ id }) => id === pack.content.semanticReference.policyId);
    if (!referencedPolicy || referencedPolicy.version !== pack.content.semanticReference.policyVersion ||
      referencedPolicy.adapter !== pack.content.semanticReference.adapter) {
      return { code: "INCOMPATIBLE_SEMANTIC_REFERENCE", message: "The exact referenced semantic adapter policy is not registered." };
    }
    if (lookup.jurisdiction !== pack.content.jurisdiction) {
      return { code: "JURISDICTION_MISMATCH", message: "The pack cannot govern outside its declared jurisdiction." };
    }
    if (!validTimestamp(lookup.at)) return { code: "INVALID_LOOKUP_TIME", message: "Lookup time must be a canonical UTC timestamp." };
    const at = Date.parse(lookup.at);
    if (Date.parse(pack.approval.approvedAt) > at) return { code: "APPROVAL_NOT_YET_EFFECTIVE", message: "Approval evidence post-dates this lookup." };
    if (Date.parse(pack.content.effectiveFrom) > at) return { code: "RULE_PACK_NOT_YET_EFFECTIVE", message: "The rule pack is not effective yet." };
    if (pack.content.expiresAt !== undefined && at >= Date.parse(pack.content.expiresAt)) {
      return { code: "EXPIRED_RULE_PACK", message: "The rule pack has expired." };
    }
    return null;
  }
  function resolve(lookup: RulePackLookup): RulePackResolution {
    if (scaleExceeded) return reject(lookup, "RULE_PACK_SCALE_EXCEEDED", "The registry exceeds its published pack or version envelope.");
    const candidates = packs.filter(({ content }) => content.id === lookup.packId &&
      (lookup.version === undefined || content.version === lookup.version)).sort(compareVersions);
    if (candidates.length === 0) return reject(lookup, "UNKNOWN_RULE_PACK", "No rule pack matches the requested id and version.");
    const pack = candidates[0]!;
    if (candidates.some((candidate, index) => index > 0 && candidate.content.version === pack.content.version)) {
      return reject(lookup, "AMBIGUOUS_RULE_PACK", "The requested rule pack identity and version are not unique.");
    }
    const finding = governanceFinding(pack, lookup);
    if (finding) return reject(lookup, finding.code, finding.message, pack);
    const body = { status: "RESOLVED" as const, pack, findings: [] as readonly RulePackFinding[] };
    return immutable({ ...body, proofHash: resultHash({ lookup, ...body }) });
  }
  return immutable({
    resolve,
    evaluate(request: GovernedEvaluationRequest): GovernedEvaluationResult {
      const resolution = resolve(request);
      if (resolution.status === "REJECTED" || resolution.pack === null) return immutable({ status: "REJECTED", pack: resolution.pack,
        semanticResult: null, findings: resolution.findings, governanceProofHash: resolution.proofHash, proofHash: resolution.proofHash });
      const semanticResult = semantics.evaluate({ policyId: resolution.pack.content.semanticReference.policyId,
        contestId: request.contestId, entrants: request.entrants, result: request.result });
      const body = { status: semanticResult.status, pack: resolution.pack, semanticResult, governanceProofHash: resolution.proofHash,
        findings: semanticResult.status === "REJECTED" ? [{ code: "SEMANTIC_EVALUATION_REJECTED", message: "The governed result failed its referenced semantics." }] : [] };
      return immutable({ ...body, proofHash: resultHash(body) });
    },
  });
}
