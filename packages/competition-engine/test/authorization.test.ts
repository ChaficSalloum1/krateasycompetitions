import assert from "node:assert/strict";
import test from "node:test";
import {
  ROLE_CAPABILITIES,
  authorize,
  redactSensitiveValue,
  type AuthorizationAuditRecord,
  type Principal,
} from "../src/authorization.js";

const principal = (actorId: string, tenantId: string, roles: Principal["roles"]): Principal => ({
  actorId,
  tenantId,
  roles,
});

test("publishes an explicit least-privilege role-to-capability policy", () => {
  assert.deepEqual(ROLE_CAPABILITIES.viewer, ["tournament:view"]);
  assert.deepEqual(ROLE_CAPABILITIES.compiler, ["tournament:view", "tournament:compile"]);
  assert.deepEqual(ROLE_CAPABILITIES.director, ["tournament:view", "tournament:certify", "tournament:override"]);
  assert.deepEqual(ROLE_CAPABILITIES.operator, ["tournament:view", "tournament:operate", "tournament:publish"]);
  assert.deepEqual(ROLE_CAPABILITIES.auditor, ["tournament:view", "audit:view"]);
});

test("denies unknown capabilities and role escalation by default", () => {
  const audit: AuthorizationAuditRecord[] = [];
  const viewer = principal("actor.viewer", "tenant.alpha", ["viewer"]);

  const result = authorize({
    principal: viewer,
    capability: "tournament:compile",
    resource: { type: "tournament", id: "open-2026", tenantId: "tenant.alpha" },
    correlationId: "corr-denied-capability",
    audit: (record) => audit.push(record),
  });

  assert.equal(result.allowed, false);
  assert.equal(result.reason, "CAPABILITY_NOT_GRANTED");
  assert.equal(audit.length, 1);
  assert.deepEqual(audit[0], result.audit);
});

test("fails closed across tenants even when the role grants the capability", () => {
  const result = authorize({
    principal: principal("actor.compiler", "tenant.alpha", ["compiler"]),
    capability: "tournament:compile",
    resource: { type: "tournament", id: "cup-2026", tenantId: "tenant.beta" },
    correlationId: "corr-cross-tenant",
    audit: () => undefined,
  });

  assert.equal(result.allowed, false);
  assert.equal(result.reason, "TENANT_MISMATCH");
});

test("permits a granted capability only within the principal tenant and audits the decision", () => {
  const audit: AuthorizationAuditRecord[] = [];
  const result = authorize({
    principal: principal("actor.compiler", "tenant.alpha", ["compiler"]),
    capability: "tournament:compile",
    resource: { type: "tournament", id: "cup-2026", tenantId: "tenant.alpha" },
    correlationId: "corr-allowed",
    audit: (record) => audit.push(record),
  });

  assert.equal(result.allowed, true);
  assert.equal(result.reason, "AUTHORIZED");
  assert.deepEqual(audit[0], {
    correlationId: "corr-allowed",
    actorId: "actor.compiler",
    tenantId: "tenant.alpha",
    resource: { type: "tournament", id: "cup-2026", tenantId: "tenant.alpha" },
    capability: "tournament:compile",
    allowed: true,
    reason: "AUTHORIZED",
  });
});

test("requires distinct actors across compile, certify, publish, and override", () => {
  const resource = { type: "tournament" as const, id: "cup-2026", tenantId: "tenant.alpha" };
  const audit = () => undefined;

  const selfCertification = authorize({
    principal: principal("actor.compiler-director", "tenant.alpha", ["compiler", "director"]),
    capability: "tournament:certify",
    resource,
    correlationId: "corr-self-certify",
    workflow: { compiledBy: "actor.compiler-director" },
    audit,
  });
  assert.equal(selfCertification.allowed, false);
  assert.equal(selfCertification.reason, "SEPARATION_OF_DUTIES");

  const selfPublication = authorize({
    principal: principal("actor.director-operator", "tenant.alpha", ["director", "operator"]),
    capability: "tournament:publish",
    resource,
    correlationId: "corr-self-publish",
    workflow: { compiledBy: "actor.compiler", certifiedBy: "actor.director-operator" },
    audit,
  });
  assert.equal(selfPublication.allowed, false);
  assert.equal(selfPublication.reason, "SEPARATION_OF_DUTIES");

  const selfOverride = authorize({
    principal: principal("actor.director", "tenant.alpha", ["director"]),
    capability: "tournament:override",
    resource,
    correlationId: "corr-self-override",
    workflow: {
      compiledBy: "actor.compiler",
      certifiedBy: "actor.director",
      publishedBy: "actor.operator",
    },
    audit,
  });
  assert.equal(selfOverride.allowed, false);
  assert.equal(selfOverride.reason, "SEPARATION_OF_DUTIES");

  const separated = authorize({
    principal: principal("actor.second-director", "tenant.alpha", ["director"]),
    capability: "tournament:override",
    resource,
    correlationId: "corr-separated",
    workflow: {
      compiledBy: "actor.compiler",
      certifiedBy: "actor.first-director",
      publishedBy: "actor.operator",
    },
    audit,
  });
  assert.equal(separated.allowed, true);
});

test("denies privileged workflow actions when required provenance is absent", () => {
  const result = authorize({
    principal: principal("actor.operator", "tenant.alpha", ["operator"]),
    capability: "tournament:publish",
    resource: { type: "tournament", id: "cup-2026", tenantId: "tenant.alpha" },
    correlationId: "corr-missing-provenance",
    audit: () => undefined,
  });

  assert.equal(result.allowed, false);
  assert.equal(result.reason, "WORKFLOW_PROVENANCE_REQUIRED");
});

test("redacts nested credentials and credential-shaped strings without mutating input", () => {
  const input = {
    authorization: "Bearer live-secret-token",
    profile: {
      displayName: "Director",
      apiKey: "sk-live-secret",
      note: "Bearer another-secret",
      customCredential: "private-value",
    },
    sessions: [{ sessionToken: "session-secret", status: "active" }],
  };

  const redacted = redactSensitiveValue(input, ["customCredential"]);

  assert.deepEqual(redacted, {
    authorization: "[REDACTED]",
    profile: {
      displayName: "Director",
      apiKey: "[REDACTED]",
      note: "[REDACTED]",
      customCredential: "[REDACTED]",
    },
    sessions: [{ sessionToken: "[REDACTED]", status: "active" }],
  });
  assert.equal(input.profile.apiKey, "sk-live-secret");
});
