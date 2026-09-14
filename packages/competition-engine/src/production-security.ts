import { canonicalHash, deepFreeze } from "@tournament-os/tournament-schema";

export interface ProductionSecurityConfigInput {
  readonly runtimeEnvironment: string | undefined;
  readonly databaseUrlSecretRef: string | undefined;
  readonly sessionSecretRef: string | undefined;
  readonly auditSigningKeyRef: string | undefined;
  readonly webhookSigningKeyRef: string | undefined;
}

export interface ProductionSecurityConfig {
  readonly runtimeEnvironment: "production";
  readonly databaseUrlSecretRef: string;
  readonly sessionSecretRef: string;
  readonly auditSigningKeyRef: string;
  readonly webhookSigningKeyRef: string;
  readonly configurationHash: string;
}

export interface ProductionSecurityConfigResult {
  readonly status: "READY" | "UNREADY";
  readonly issues: readonly string[];
  readonly config?: Readonly<ProductionSecurityConfig>;
}

export interface SecretDescriptor {
  readonly reference: string;
  readonly version: string;
  readonly status: "ENABLED" | "DISABLED";
  readonly expiresAt?: string;
}

export interface SecretProvider {
  describe(reference: string): Promise<Readonly<SecretDescriptor>>;
  /** Keeps material inside a narrow callback so callers cannot accidentally serialize a runtime config containing it. */
  withSecret<T>(reference: string, use: (material: Uint8Array) => Promise<T> | T): Promise<T>;
}

export interface ManagedKeyDescriptor {
  readonly reference: string;
  readonly version: string;
  readonly status: "ENABLED" | "DISABLED";
  readonly purposes: readonly ("SIGN" | "VERIFY")[];
  readonly expiresAt?: string;
}

export interface KeyManagementProvider {
  describeKey(reference: string, version?: string): Promise<Readonly<ManagedKeyDescriptor>>;
  signDigest(reference: string, digest: string, keyVersion: string): Promise<string>;
  verifyDigest(reference: string, digest: string, signature: string, keyVersion: string): Promise<boolean>;
}

export interface SecurityReadinessCheck {
  readonly name: "audit-signing-key" | "database-secret" | "session-secret" | "webhook-signing-key";
  readonly status: "HEALTHY" | "UNHEALTHY";
  readonly version?: string;
  readonly detail?: string;
}

export interface SecurityProviderReadiness {
  readonly status: "READY" | "UNREADY";
  readonly checkedAt: string;
  readonly checks: readonly Readonly<SecurityReadinessCheck>[];
  readonly reasons: readonly string[];
  readonly proofHash: string;
}

export interface ManagedProofSignature {
  readonly algorithm: "PROVIDER_MANAGED";
  readonly keyReference: string;
  readonly keyVersion: string;
  readonly payloadDigest: string;
  readonly signature: string;
}

const secretReferencePattern = /^secret:\/\/[a-z0-9][a-z0-9._/-]{2,254}$/;
const keyReferencePattern = /^kms:\/\/[a-z0-9][a-z0-9._/-]{2,254}$/;

/** Parses reference-only production configuration. It deliberately never returns rejected values. */
export function parseProductionSecurityConfig(input: ProductionSecurityConfigInput): Readonly<ProductionSecurityConfigResult> {
  const issues: string[] = [];
  if (input.runtimeEnvironment !== "production") issues.push("runtimeEnvironment must be production");
  if (!secretReferencePattern.test(input.databaseUrlSecretRef ?? "")) {
    issues.push("databaseUrlSecretRef must be an opaque secret:// reference");
  }
  if (!secretReferencePattern.test(input.sessionSecretRef ?? "")) {
    issues.push("sessionSecretRef must be an opaque secret:// reference");
  }
  if (!keyReferencePattern.test(input.auditSigningKeyRef ?? "")) {
    issues.push("auditSigningKeyRef must be an opaque kms:// reference");
  }
  if (!keyReferencePattern.test(input.webhookSigningKeyRef ?? "")) {
    issues.push("webhookSigningKeyRef must be an opaque kms:// reference");
  }
  if (input.auditSigningKeyRef && input.auditSigningKeyRef === input.webhookSigningKeyRef) {
    issues.push("auditSigningKeyRef and webhookSigningKeyRef must use distinct keys");
  }
  if (issues.length > 0) return deepFreeze({ status: "UNREADY", issues: [...issues].sort() });

  const references = {
    runtimeEnvironment: "production" as const,
    databaseUrlSecretRef: input.databaseUrlSecretRef!,
    sessionSecretRef: input.sessionSecretRef!,
    auditSigningKeyRef: input.auditSigningKeyRef!,
    webhookSigningKeyRef: input.webhookSigningKeyRef!,
  };
  return deepFreeze({ status: "READY", issues: [], config: { ...references, configurationHash: canonicalHash(references) } });
}

function validTimestamp(value: string): number | undefined {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value ? parsed : undefined;
}

/** Checks metadata only. Secret values are never retrieved, logged, hashed, or returned. */
export async function assessSecurityProviderReadiness(
  config: ProductionSecurityConfig,
  secrets: SecretProvider,
  keys: KeyManagementProvider,
  checkedAt: string,
): Promise<Readonly<SecurityProviderReadiness>> {
  const now = validTimestamp(checkedAt);
  if (now === undefined) throw new Error("Security readiness requires a canonical checkedAt timestamp");
  const checks: SecurityReadinessCheck[] = [];
  for (const [name, reference] of [
    ["database-secret", config.databaseUrlSecretRef],
    ["session-secret", config.sessionSecretRef],
  ] as const) {
    try {
      const descriptor = await secrets.describe(reference);
      let detail: string | undefined;
      if (descriptor.reference !== reference) detail = "provider returned a different reference";
      else if (!descriptor.version.trim()) detail = "provider did not report a version";
      else if (descriptor.status !== "ENABLED") detail = "secret is disabled";
      else if (descriptor.expiresAt !== undefined) {
        const expiry = validTimestamp(descriptor.expiresAt);
        if (expiry === undefined) detail = "provider returned an invalid expiry";
        else if (expiry <= now) detail = "secret is expired";
      }
      checks.push({ name, status: detail ? "UNHEALTHY" : "HEALTHY", ...(descriptor.version ? { version: descriptor.version } : {}), ...(detail ? { detail } : {}) });
    } catch {
      checks.push({ name, status: "UNHEALTHY", detail: "provider metadata lookup failed" });
    }
  }
  for (const [name, reference] of [
    ["audit-signing-key", config.auditSigningKeyRef],
    ["webhook-signing-key", config.webhookSigningKeyRef],
  ] as const) {
    try {
      const descriptor = await keys.describeKey(reference);
      let detail: string | undefined;
      if (descriptor.reference !== reference) detail = "provider returned a different reference";
      else if (!descriptor.version.trim()) detail = "provider did not report a version";
      else if (descriptor.status !== "ENABLED") detail = "key is disabled";
      else if (!descriptor.purposes.includes("SIGN") || !descriptor.purposes.includes("VERIFY")) detail = "key cannot sign and verify";
      else if (descriptor.expiresAt !== undefined) {
        const expiry = validTimestamp(descriptor.expiresAt);
        if (expiry === undefined) detail = "provider returned an invalid expiry";
        else if (expiry <= now) detail = "key is expired";
      }
      checks.push({ name, status: detail ? "UNHEALTHY" : "HEALTHY", ...(descriptor.version ? { version: descriptor.version } : {}), ...(detail ? { detail } : {}) });
    } catch {
      checks.push({ name, status: "UNHEALTHY", detail: "provider metadata lookup failed" });
    }
  }
  checks.sort((left, right) => left.name.localeCompare(right.name));
  const reasons = checks.filter(({ status }) => status !== "HEALTHY").map(({ name, detail }) => `${name}: ${detail ?? "unhealthy"}`);
  const base = { status: reasons.length ? "UNREADY" as const : "READY" as const, checkedAt, checks, reasons };
  return deepFreeze({ ...base, proofHash: canonicalHash(base) });
}

export async function createManagedProofSignature(
  provider: KeyManagementProvider,
  keyReference: string,
  payload: unknown,
): Promise<Readonly<ManagedProofSignature>> {
  if (!keyReferencePattern.test(keyReference)) throw new Error("Proof signatures require an opaque kms:// reference");
  const descriptor = await provider.describeKey(keyReference);
  if (descriptor.reference !== keyReference || descriptor.status !== "ENABLED" || !descriptor.version.trim()
    || !descriptor.purposes.includes("SIGN")) throw new Error("Managed signing key is not ready");
  const payloadDigest = canonicalHash(payload);
  const signature = await provider.signDigest(keyReference, payloadDigest, descriptor.version);
  if (!signature.trim()) throw new Error("Managed key provider returned an empty signature");
  return deepFreeze({ algorithm: "PROVIDER_MANAGED", keyReference, keyVersion: descriptor.version, payloadDigest, signature });
}

export async function verifyManagedProofSignature(
  provider: KeyManagementProvider,
  proof: ManagedProofSignature,
  payload: unknown,
): Promise<boolean> {
  try {
    if (proof.algorithm !== "PROVIDER_MANAGED" || canonicalHash(payload) !== proof.payloadDigest) return false;
    const descriptor = await provider.describeKey(proof.keyReference, proof.keyVersion);
    if (descriptor.reference !== proof.keyReference || descriptor.status !== "ENABLED"
      || descriptor.version !== proof.keyVersion || !descriptor.purposes.includes("VERIFY")) return false;
    return provider.verifyDigest(proof.keyReference, proof.payloadDigest, proof.signature, proof.keyVersion);
  } catch {
    return false;
  }
}
