import { canonicalHash, deepFreeze } from "@tournament-os/tournament-schema";
import { validateTelemetryEvent, type ValidatedTelemetryEvent } from "./operations.js";

export type ProductionProbeStatus = "HEALTHY" | "DEGRADED" | "UNHEALTHY" | "UNKNOWN";

export interface ProductionProbe {
  readonly name: string;
  readonly required: boolean;
  readonly status: ProductionProbeStatus;
  readonly observedAt: string;
  readonly detail?: string;
}

export interface ProductionReadinessOptions {
  readonly checkedAt: string;
  readonly maximumEvidenceAgeMs: number;
}

export interface ProductionReadinessReport {
  readonly status: "READY" | "DEGRADED" | "UNREADY" | "UNKNOWN";
  readonly routeTraffic: boolean;
  readonly httpStatus: 200 | 503;
  readonly checkedAt: string;
  readonly checks: readonly Readonly<ProductionProbe>[];
  readonly reasons: readonly string[];
  readonly proofHash: string;
}

const mandatoryProbeNames = [
  "cp-sat-solver",
  "database",
  "event-ledger",
  "identity-provider",
  "kms-provider",
  "outbox-worker",
  "secret-provider",
] as const;

function canonicalTimestamp(value: string, label: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) throw new Error(`${label} must be a canonical ISO-8601 timestamp`);
  return parsed;
}

/** Converts freshness-bounded dependency evidence into a traffic-routing decision. */
export function assessProductionReadiness(
  input: readonly ProductionProbe[],
  options: ProductionReadinessOptions,
): Readonly<ProductionReadinessReport> {
  const checkedAtMs = canonicalTimestamp(options.checkedAt, "checkedAt");
  if (!Number.isSafeInteger(options.maximumEvidenceAgeMs) || options.maximumEvidenceAgeMs <= 0) {
    throw new Error("maximumEvidenceAgeMs must be a positive safe integer");
  }
  const byName = new Map<string, ProductionProbe>();
  for (const probe of input) {
    const name = probe.name.trim();
    if (!name || byName.has(name)) throw new Error("Production probes require unique non-empty names");
    canonicalTimestamp(probe.observedAt, `${name}.observedAt`);
    byName.set(name, { ...probe, name });
  }

  const checks: ProductionProbe[] = [...byName.values()];
  const reasons: string[] = [];
  for (const name of mandatoryProbeNames) {
    if (!byName.has(name)) reasons.push(`${name}: required probe is missing`);
  }
  for (const probe of checks) {
    const observedAtMs = Date.parse(probe.observedAt);
    if (observedAtMs > checkedAtMs) reasons.push(`${probe.name}: evidence is from the future`);
    else if (checkedAtMs - observedAtMs > options.maximumEvidenceAgeMs) reasons.push(`${probe.name}: evidence is stale`);
    if (probe.status !== "HEALTHY") reasons.push(`${probe.name}: ${probe.detail?.trim() || probe.status.toLowerCase()}`);
  }
  checks.sort((left, right) => left.name.localeCompare(right.name));
  reasons.sort();

  const requiredNames = new Set<string>(mandatoryProbeNames);
  const requiredUnhealthy = checks.some((probe) => (probe.required || requiredNames.has(probe.name)) && probe.status === "UNHEALTHY");
  const unknownEvidence = reasons.some((reason) => reason.endsWith("required probe is missing")
    || reason.endsWith("evidence is stale") || reason.endsWith("evidence is from the future"))
    || checks.some((probe) => (probe.required || requiredNames.has(probe.name)) && probe.status === "UNKNOWN");
  const optionalDamage = checks.some((probe) => !probe.required && !requiredNames.has(probe.name) && probe.status !== "HEALTHY");
  const requiredDegraded = checks.some((probe) => (probe.required || requiredNames.has(probe.name)) && probe.status === "DEGRADED");
  const status: ProductionReadinessReport["status"] = requiredUnhealthy ? "UNREADY"
    : unknownEvidence ? "UNKNOWN"
      : requiredDegraded || optionalDamage ? "DEGRADED" : "READY";
  const routeTraffic = status === "READY" || status === "DEGRADED";
  const base = { status, routeTraffic, httpStatus: routeTraffic ? 200 as const : 503 as const, checkedAt: options.checkedAt, checks, reasons };
  return deepFreeze({ ...base, proofHash: canonicalHash(base) });
}

export interface LivenessReport {
  readonly status: "LIVE";
  readonly startedAt: string;
  readonly observedAt: string;
  readonly uptimeSeconds: number;
  readonly proofHash: string;
}

/** Liveness intentionally says nothing about dependency readiness or routing safety. */
export function createLivenessReport(startedAt: string, observedAt: string): Readonly<LivenessReport> {
  const started = canonicalTimestamp(startedAt, "startedAt");
  const observed = canonicalTimestamp(observedAt, "observedAt");
  if (observed < started) throw new Error("observedAt must not precede startedAt");
  const base = { status: "LIVE" as const, startedAt, observedAt, uptimeSeconds: (observed - started) / 1_000 };
  return deepFreeze({ ...base, proofHash: canonicalHash(base) });
}

export type StructuredTelemetryWriter = (event: Readonly<ValidatedTelemetryEvent>) => void;

/** Creates a single validation and redaction boundary for structured operational events. */
export function createStructuredTelemetryEmitter(writer: StructuredTelemetryWriter): (input: unknown) => Readonly<ValidatedTelemetryEvent> {
  return (input) => {
    const validation = validateTelemetryEvent(input);
    if (!validation.accepted || !validation.event) throw new Error(`Unsafe telemetry event: ${validation.issues.join("; ")}`);
    writer(validation.event);
    return validation.event;
  };
}
