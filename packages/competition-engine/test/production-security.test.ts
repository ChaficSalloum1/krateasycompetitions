import assert from "node:assert/strict";
import test from "node:test";
import {
  assessSecurityProviderReadiness,
  createManagedProofSignature,
  parseProductionSecurityConfig,
  verifyManagedProofSignature,
  type KeyManagementProvider,
  type SecretProvider,
} from "../src/production-security.js";

test("production security configuration accepts references and never embeds secret material", () => {
  const result = parseProductionSecurityConfig({
    runtimeEnvironment: "production",
    databaseUrlSecretRef: "secret://krateasy/production/database-url",
    sessionSecretRef: "secret://krateasy/production/session-signing",
    auditSigningKeyRef: "kms://krateasy/production/audit-signing",
    webhookSigningKeyRef: "kms://krateasy/production/webhook-signing",
  });

  assert.equal(result.status, "READY");
  assert.deepEqual(result.issues, []);
  assert.match(result.config?.configurationHash ?? "", /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(result).includes("postgres://"), false);
});

test("production security configuration fails closed for missing or inline credentials", () => {
  const result = parseProductionSecurityConfig({
    runtimeEnvironment: "production",
    databaseUrlSecretRef: "postgres://admin:password@database.example/competitions",
    sessionSecretRef: "",
    auditSigningKeyRef: "kms://krateasy/production/shared",
    webhookSigningKeyRef: "kms://krateasy/production/shared",
  });

  assert.equal(result.status, "UNREADY");
  assert.equal(result.config, undefined);
  assert.deepEqual(result.issues, [
    "auditSigningKeyRef and webhookSigningKeyRef must use distinct keys",
    "databaseUrlSecretRef must be an opaque secret:// reference",
    "sessionSecretRef must be an opaque secret:// reference",
  ]);
  assert.equal(JSON.stringify(result).includes("password"), false);
});

test("security readiness requires enabled, versioned, unexpired secrets and signing keys", async () => {
  const config = parseProductionSecurityConfig({
    runtimeEnvironment: "production",
    databaseUrlSecretRef: "secret://krateasy/production/database-url",
    sessionSecretRef: "secret://krateasy/production/session-signing",
    auditSigningKeyRef: "kms://krateasy/production/audit-signing",
    webhookSigningKeyRef: "kms://krateasy/production/webhook-signing",
  }).config!;
  const secretProvider: SecretProvider = {
    describe: async (reference) => ({ reference, version: "7", status: "ENABLED", expiresAt: "2026-12-01T00:00:00.000Z" }),
    withSecret: async (_reference, use) => use(new Uint8Array([1, 2, 3])),
  };
  const keyProvider: KeyManagementProvider = {
    describeKey: async (reference) => ({ reference, version: "4", status: "ENABLED", purposes: ["SIGN", "VERIFY"] }),
    signDigest: async () => "managed-signature",
    verifyDigest: async (_reference, _digest, signature) => signature === "managed-signature",
  };

  const ready = await assessSecurityProviderReadiness(config, secretProvider, keyProvider, "2026-09-12T12:00:00.000Z");
  assert.equal(ready.status, "READY");
  assert.equal(ready.checks.every(({ status }) => status === "HEALTHY"), true);
  assert.match(ready.proofHash, /^[a-f0-9]{64}$/);

  const expiredProvider: SecretProvider = {
    ...secretProvider,
    describe: async (reference) => ({ reference, version: "7", status: "ENABLED", expiresAt: "2026-09-01T00:00:00.000Z" }),
  };
  const expired = await assessSecurityProviderReadiness(config, expiredProvider, keyProvider, "2026-09-12T12:00:00.000Z");
  assert.equal(expired.status, "UNREADY");
  assert.match(expired.reasons.join("\n"), /expired/);
});

test("managed proof signatures bind a canonical digest and key version", async () => {
  const keyProvider: KeyManagementProvider = {
    describeKey: async (reference) => ({ reference, version: "42", status: "ENABLED", purposes: ["SIGN", "VERIFY"] }),
    signDigest: async (reference, digest) => `${reference}:${digest}:signature`,
    verifyDigest: async (reference, digest, signature) => signature === `${reference}:${digest}:signature`,
  };
  const proof = await createManagedProofSignature(keyProvider, "kms://krateasy/production/audit-signing", { tournamentId: "t.1", version: 9 });

  assert.equal(proof.keyVersion, "42");
  assert.equal(await verifyManagedProofSignature(keyProvider, proof, { tournamentId: "t.1", version: 9 }), true);
  assert.equal(await verifyManagedProofSignature(keyProvider, proof, { tournamentId: "t.1", version: 10 }), false);
  assert.equal(await verifyManagedProofSignature(keyProvider, proof, { tournamentId: undefined }), false);
  assert.equal(JSON.stringify(proof).includes("private"), false);
});
