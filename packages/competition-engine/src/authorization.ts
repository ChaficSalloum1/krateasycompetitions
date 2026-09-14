export const ROLE_CAPABILITIES = {
  viewer: ["tournament:view"],
  compiler: ["tournament:view", "tournament:compile"],
  director: ["tournament:view", "tournament:certify", "tournament:override"],
  operator: ["tournament:view", "tournament:operate", "tournament:publish"],
  auditor: ["tournament:view", "audit:view"],
} as const;

export type Role = keyof typeof ROLE_CAPABILITIES;
export type Capability = (typeof ROLE_CAPABILITIES)[Role][number];

export interface Principal {
  actorId: string;
  tenantId: string;
  roles: readonly Role[];
}

export interface AuthorizationResource {
  type: string;
  id: string;
  tenantId: string;
}

export interface WorkflowProvenance {
  compiledBy?: string;
  certifiedBy?: string;
  publishedBy?: string;
}

export type AuthorizationReason =
  | "AUTHORIZED"
  | "INVALID_AUTHORIZATION_CONTEXT"
  | "TENANT_MISMATCH"
  | "CAPABILITY_NOT_GRANTED"
  | "WORKFLOW_PROVENANCE_REQUIRED"
  | "SEPARATION_OF_DUTIES";

export interface AuthorizationAuditRecord {
  correlationId: string;
  actorId: string;
  tenantId: string;
  resource: AuthorizationResource;
  capability: Capability;
  allowed: boolean;
  reason: AuthorizationReason;
}

export interface AuthorizationRequest {
  principal: Principal;
  capability: Capability;
  resource: AuthorizationResource;
  correlationId: string;
  workflow?: WorkflowProvenance;
  audit: (record: AuthorizationAuditRecord) => void;
}

export interface AuthorizationDecision {
  allowed: boolean;
  reason: AuthorizationReason;
  audit: AuthorizationAuditRecord;
}

const PRIVILEGED_PROVENANCE: Readonly<Partial<Record<Capability, readonly (keyof WorkflowProvenance)[]>>> = {
  "tournament:certify": ["compiledBy"],
  "tournament:publish": ["compiledBy", "certifiedBy"],
  "tournament:override": ["compiledBy", "certifiedBy", "publishedBy"],
};

function grantedCapabilities(roles: readonly Role[]): ReadonlySet<Capability> {
  const granted = new Set<Capability>();
  for (const role of roles) {
    for (const capability of ROLE_CAPABILITIES[role]) granted.add(capability);
  }
  return granted;
}

function privilegedWorkflowReason(
  actorId: string,
  capability: Capability,
  workflow: WorkflowProvenance | undefined,
): AuthorizationReason | undefined {
  const requiredFields = PRIVILEGED_PROVENANCE[capability];
  if (!requiredFields) return undefined;
  if (!workflow || requiredFields.some((field) => !workflow[field])) return "WORKFLOW_PROVENANCE_REQUIRED";
  if (requiredFields.some((field) => workflow[field] === actorId)) return "SEPARATION_OF_DUTIES";
  return undefined;
}

/**
 * Makes one fail-closed authorization decision. Identity verification belongs to
 * an adapter outside the competition engine; this boundary accepts only a
 * tenant-scoped principal and records every decision through the required sink.
 */
export function authorize(request: AuthorizationRequest): AuthorizationDecision {
  const { principal, resource, capability } = request;
  let reason: AuthorizationReason = "AUTHORIZED";

  if (!principal.actorId || !principal.tenantId || !resource.id || !resource.tenantId || !request.correlationId) {
    reason = "INVALID_AUTHORIZATION_CONTEXT";
  } else if (principal.tenantId !== resource.tenantId) {
    reason = "TENANT_MISMATCH";
  } else if (!grantedCapabilities(principal.roles).has(capability)) {
    reason = "CAPABILITY_NOT_GRANTED";
  } else {
    reason = privilegedWorkflowReason(principal.actorId, capability, request.workflow) ?? "AUTHORIZED";
  }

  const audit: AuthorizationAuditRecord = {
    correlationId: request.correlationId,
    actorId: principal.actorId,
    tenantId: principal.tenantId,
    resource: { ...resource },
    capability,
    allowed: reason === "AUTHORIZED",
    reason,
  };
  request.audit(audit);
  return { allowed: audit.allowed, reason, audit };
}

const CREDENTIAL_SHAPED_STRING = /^(?:bearer|basic)\s+\S+/i;

function isBuiltInSensitiveKey(key: string): boolean {
  const normalized = key.replace(/[_-]/g, "").toLocaleLowerCase();
  return /(?:authorization|cookie|secret|password|passphrase|token|apikey|privatekey)$/.test(normalized);
}

/** Returns a recursively redacted copy suitable for structured logs and audits. */
export function redactSensitiveValue(value: unknown, additionalSensitiveKeys: readonly string[] = []): unknown {
  const customKeys = new Set(additionalSensitiveKeys.map((key) => key.toLocaleLowerCase()));
  const redact = (candidate: unknown, seen: WeakMap<object, unknown>): unknown => {
    if (typeof candidate === "string") return CREDENTIAL_SHAPED_STRING.test(candidate) ? "[REDACTED]" : candidate;
    if (candidate === null || typeof candidate !== "object") return candidate;
    const existing = seen.get(candidate);
    if (existing) return existing;
    if (Array.isArray(candidate)) {
      const copy: unknown[] = [];
      seen.set(candidate, copy);
      for (const item of candidate) copy.push(redact(item, seen));
      return copy;
    }
    const copy: Record<string, unknown> = {};
    seen.set(candidate, copy);
    for (const [key, item] of Object.entries(candidate)) {
      copy[key] = isBuiltInSensitiveKey(key) || customKeys.has(key.toLocaleLowerCase())
        ? "[REDACTED]"
        : redact(item, seen);
    }
    return copy;
  };
  return redact(value, new WeakMap());
}
