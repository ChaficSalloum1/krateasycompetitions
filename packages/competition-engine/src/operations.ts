import { canonicalHash, deepFreeze } from "@tournament-os/tournament-schema";

export type OperationalStatus = "READY" | "DEGRADED" | "UNREADY" | "UNKNOWN";
export type HealthCheckStatus = "HEALTHY" | "DEGRADED" | "UNHEALTHY" | "UNKNOWN";

export interface HealthCheck {
  name: string;
  critical: boolean;
  status: HealthCheckStatus;
  detail?: string;
}

export interface ReadinessReport {
  status: OperationalStatus;
  checks: ReadonlyArray<Readonly<HealthCheck>>;
  reasons: ReadonlyArray<string>;
  summary: string;
}

const checkStatuses = new Set<HealthCheckStatus>(["HEALTHY", "DEGRADED", "UNHEALTHY", "UNKNOWN"]);

export function aggregateReadiness(input: ReadonlyArray<HealthCheck>): Readonly<ReadinessReport> {
  if (input.length === 0) {
    return deepFreeze({ status: "UNKNOWN", checks: [], reasons: ["No readiness checks were supplied"], summary: "0/0 checks healthy" });
  }
  const names = new Set<string>();
  for (const check of input) {
    const normalizedName = check.name.trim();
    if (!normalizedName || !checkStatuses.has(check.status)) throw new Error("Readiness checks require a name and valid status");
    if (names.has(normalizedName)) throw new Error("Readiness checks require unique names");
    names.add(normalizedName);
  }
  const checks = input
    .map((check) => ({ ...check, name: check.name.trim() }))
    .sort((left, right) => left.name.localeCompare(right.name));
  const reasons = checks
    .filter(({ status }) => status !== "HEALTHY")
    .map(({ name, status, detail }) => `${name}: ${detail?.trim() || status.toLowerCase()}`);
  let status: OperationalStatus = "READY";
  if (checks.some((check) => check.critical && check.status === "UNHEALTHY")) status = "UNREADY";
  else if (checks.some((check) => check.status === "UNKNOWN")) status = "UNKNOWN";
  else if (checks.some((check) => check.status !== "HEALTHY")) status = "DEGRADED";
  const healthy = checks.filter(({ status: checkStatus }) => checkStatus === "HEALTHY").length;
  return deepFreeze({ status, checks, reasons, summary: `${healthy}/${checks.length} checks healthy` });
}

export type TelemetrySeverity = "DEBUG" | "INFO" | "WARN" | "ERROR";
export type TelemetryValue = null | string | number | boolean | ReadonlyArray<TelemetryValue> | { readonly [key: string]: TelemetryValue };

export interface TelemetryEventInput {
  name: string;
  service: string;
  severity: TelemetrySeverity;
  occurredAt: string;
  traceId?: string;
  attributes?: unknown;
}

export interface ValidatedTelemetryEvent extends Omit<TelemetryEventInput, "attributes"> {
  attributes: { readonly [key: string]: TelemetryValue };
}

export interface TelemetryValidationResult {
  accepted: boolean;
  issues: ReadonlyArray<string>;
  event?: Readonly<ValidatedTelemetryEvent>;
}

const telemetryNamePattern = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const redactedKeyPattern = /(authorization|password|passwd|token|secret|api[_-]?key|cookie|e[-_]?mail|phone|ip[_-]?(address)?|session)/i;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function sanitizeTelemetryValue(
  value: unknown,
  path: string,
  issues: string[],
  seen: WeakSet<object>,
  depth: number,
): TelemetryValue | undefined {
  if (depth > 6) {
    issues.push(`${path} exceeds the maximum nesting depth of 6`);
    return undefined;
  }
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value.length > 4_096) issues.push(`${path} exceeds 4096 characters`);
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) issues.push(`${path} must be finite`);
    return value;
  }
  if (typeof value !== "object") {
    issues.push(`${path} contains an unsupported value`);
    return undefined;
  }
  if (seen.has(value)) {
    issues.push(`${path} contains a cycle`);
    return undefined;
  }
  seen.add(value);
  if (Array.isArray(value)) {
    const result = value.map((item, index) => sanitizeTelemetryValue(item, `${path}[${index}]`, issues, seen, depth + 1) ?? null);
    seen.delete(value);
    return result;
  }
  if (!isPlainObject(value)) {
    issues.push(`${path} must contain only plain objects`);
    seen.delete(value);
    return undefined;
  }
  const result: Record<string, TelemetryValue> = {};
  for (const key of Object.keys(value).sort()) {
    if (redactedKeyPattern.test(key)) {
      result[key] = "[REDACTED]";
      continue;
    }
    const sanitized = sanitizeTelemetryValue(value[key], `${path}.${key}`, issues, seen, depth + 1);
    if (sanitized !== undefined) result[key] = sanitized;
  }
  seen.delete(value);
  return result;
}

export function validateTelemetryEvent(input: unknown): Readonly<TelemetryValidationResult> {
  const raw = isPlainObject(input) ? input : {};
  const issues: string[] = [];
  const name = raw.name;
  const service = raw.service;
  const severity = raw.severity;
  const occurredAtValue = raw.occurredAt;
  const traceId = raw.traceId;
  if (typeof name !== "string" || !telemetryNamePattern.test(name)) issues.push("Telemetry name must be a lowercase structured name");
  if (typeof service !== "string" || !telemetryNamePattern.test(service)) issues.push("Telemetry service must be a lowercase structured name");
  if (typeof severity !== "string" || !new Set<TelemetrySeverity>(["DEBUG", "INFO", "WARN", "ERROR"]).has(severity as TelemetrySeverity)) issues.push("Telemetry severity is invalid");
  const occurredAt = typeof occurredAtValue === "string" ? Date.parse(occurredAtValue) : Number.NaN;
  if (!Number.isFinite(occurredAt) || new Date(occurredAt).toISOString() !== occurredAtValue) issues.push("Telemetry occurredAt must be a canonical ISO-8601 timestamp");
  if (traceId !== undefined && (typeof traceId !== "string" || !/^[a-f0-9]{16,64}$/i.test(traceId))) issues.push("Telemetry traceId must contain 16 to 64 hexadecimal characters");
  if (raw.attributes !== undefined && !isPlainObject(raw.attributes)) issues.push("Telemetry attributes must be a plain object");
  const attributes = isPlainObject(raw.attributes)
    ? sanitizeTelemetryValue(raw.attributes, "attributes", issues, new WeakSet(), 0) as Record<string, TelemetryValue>
    : {};
  if (issues.length > 0) return deepFreeze({ accepted: false, issues: [...issues].sort() });
  const event: ValidatedTelemetryEvent = {
    name: name as string,
    service: service as string,
    severity: severity as TelemetrySeverity,
    occurredAt: occurredAtValue as string,
    ...(traceId === undefined ? {} : { traceId: (traceId as string).toLowerCase() }),
    attributes,
  };
  return deepFreeze({ accepted: true, issues: [], event });
}

export interface BackupArtifact {
  path: string;
  bytes: number;
  sha256: string;
}

export interface BackupManifestInput {
  backupId: string;
  createdAt: string;
  schemaVersion: string;
  artifacts: ReadonlyArray<BackupArtifact>;
}

export interface BackupManifest extends BackupManifestInput {
  artifacts: ReadonlyArray<Readonly<BackupArtifact>>;
  totalBytes: number;
  manifestHash: string;
}

function validateArtifact(artifact: BackupArtifact): void {
  if (!artifact.path.trim() || artifact.path.startsWith("/") || artifact.path.includes("..")) throw new Error("Backup artifact paths must be safe and relative");
  if (!Number.isSafeInteger(artifact.bytes) || artifact.bytes < 0) throw new Error("Backup artifact bytes must be a non-negative safe integer");
  if (!/^[a-f0-9]{64}$/i.test(artifact.sha256)) throw new Error("Backup artifact checksums must be SHA-256 hex strings");
}

export function createBackupManifest(input: BackupManifestInput): Readonly<BackupManifest> {
  const createdAt = Date.parse(input.createdAt);
  if (!input.backupId.trim() || !input.schemaVersion.trim() || !Number.isFinite(createdAt) || new Date(createdAt).toISOString() !== input.createdAt) {
    throw new Error("Backup manifests require an id, schema version, and canonical timestamp");
  }
  const paths = new Set<string>();
  for (const artifact of input.artifacts) {
    validateArtifact(artifact);
    if (paths.has(artifact.path)) throw new Error("Backup artifacts require unique paths");
    paths.add(artifact.path);
  }
  const artifacts = input.artifacts
    .map((artifact) => ({ ...artifact, sha256: artifact.sha256.toLowerCase() }))
    .sort((left, right) => left.path.localeCompare(right.path));
  const totalBytes = artifacts.reduce((total, { bytes }) => total + bytes, 0);
  if (!Number.isSafeInteger(totalBytes)) throw new Error("Backup total size exceeds the safe integer range");
  const content = { backupId: input.backupId, createdAt: input.createdAt, schemaVersion: input.schemaVersion, artifacts, totalBytes };
  return deepFreeze({ ...content, manifestHash: canonicalHash(content) });
}

export interface RestoreVerificationOptions {
  expectedSchemaVersion: string;
}

export interface RestoreVerification {
  status: "VERIFIED" | "FAILED" | "UNKNOWN";
  issues: ReadonlyArray<string>;
  verifiedArtifacts: number;
}

export function verifyRestore(
  manifest: BackupManifest,
  restoredArtifacts: ReadonlyArray<BackupArtifact>,
  options: RestoreVerificationOptions,
): Readonly<RestoreVerification> {
  if (restoredArtifacts.length === 0) {
    return deepFreeze({ status: "UNKNOWN", issues: ["No restored artifacts were supplied"], verifiedArtifacts: 0 });
  }
  const restored = new Map<string, BackupArtifact>();
  const duplicatePaths = new Set<string>();
  for (const artifact of restoredArtifacts) {
    validateArtifact(artifact);
    if (restored.has(artifact.path)) duplicatePaths.add(artifact.path);
    restored.set(artifact.path, artifact);
  }
  const issues: string[] = [];
  let verifiedArtifacts = 0;
  const manifestContent = {
    backupId: manifest.backupId,
    createdAt: manifest.createdAt,
    schemaVersion: manifest.schemaVersion,
    artifacts: manifest.artifacts,
    totalBytes: manifest.totalBytes,
  };
  if (canonicalHash(manifestContent) !== manifest.manifestHash) issues.push("Manifest hash does not match its content");
  for (const expected of manifest.artifacts) {
    const actual = restored.get(expected.path);
    if (!actual) {
      issues.push(`Artifact ${expected.path} is missing`);
      continue;
    }
    let matches = true;
    if (actual.bytes !== expected.bytes) {
      issues.push(`Artifact ${expected.path} has ${actual.bytes} bytes; expected ${expected.bytes}`);
      matches = false;
    }
    if (actual.sha256.toLowerCase() !== expected.sha256.toLowerCase()) {
      issues.push(`Artifact ${expected.path} checksum does not match`);
      matches = false;
    }
    if (duplicatePaths.has(expected.path)) {
      issues.push(`Artifact ${expected.path} was restored more than once`);
      matches = false;
    }
    if (matches) verifiedArtifacts += 1;
  }
  const expectedPaths = new Set(manifest.artifacts.map(({ path }) => path));
  for (const path of [...restored.keys()].filter((path) => !expectedPaths.has(path)).sort()) {
    issues.push(`Artifact ${path} is not present in the manifest`);
  }
  if (manifest.schemaVersion !== options.expectedSchemaVersion) {
    issues.push(`Schema version ${manifest.schemaVersion} does not match expected version ${options.expectedSchemaVersion}`);
  }
  return deepFreeze({ status: issues.length === 0 ? "VERIFIED" : "FAILED", issues, verifiedArtifacts });
}

export interface SloEvaluationInput {
  objective: number;
  totalEvents: number;
  badEvents: number;
  warningBudgetFraction?: number;
}

export interface SloEvaluation {
  status: OperationalStatus;
  objective: number;
  achieved?: number;
  allowedBadEvents: number;
  remainingBadEvents: number;
  budgetConsumedFraction?: number;
}

const stableNumber = (value: number): number => Number(value.toFixed(12));

export function evaluateSlo(input: SloEvaluationInput): Readonly<SloEvaluation> {
  const warning = input.warningBudgetFraction ?? 0.8;
  if (!Number.isFinite(input.objective) || input.objective <= 0 || input.objective >= 1
    || !Number.isSafeInteger(input.totalEvents) || input.totalEvents < 0
    || !Number.isSafeInteger(input.badEvents) || input.badEvents < 0 || input.badEvents > input.totalEvents
    || !Number.isFinite(warning) || warning <= 0 || warning >= 1) {
    throw new Error("SLO evaluation requires a fractional objective, valid event counts, and a warning fraction between zero and one");
  }
  const allowedBadEvents = stableNumber((1 - input.objective) * input.totalEvents);
  const remainingBadEvents = stableNumber(Math.max(0, allowedBadEvents - input.badEvents));
  if (input.totalEvents === 0) {
    return deepFreeze({ status: "UNKNOWN", objective: input.objective, allowedBadEvents, remainingBadEvents });
  }
  const achieved = stableNumber((input.totalEvents - input.badEvents) / input.totalEvents);
  const budgetConsumedFraction = allowedBadEvents === 0 ? Number.POSITIVE_INFINITY : stableNumber(input.badEvents / allowedBadEvents);
  const status: OperationalStatus = budgetConsumedFraction >= 1
    ? "UNREADY"
    : budgetConsumedFraction >= warning ? "DEGRADED" : "READY";
  return deepFreeze({ status, objective: input.objective, achieved, allowedBadEvents, remainingBadEvents, budgetConsumedFraction });
}
