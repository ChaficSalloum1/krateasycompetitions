import { createHash, createPrivateKey, createPublicKey, sign, timingSafeEqual, verify } from "node:crypto";
import type { ParticipantNextProjection, PublicLiveProjection } from "./participant-information.js";

export interface OfflineEventPackBody {
  readonly schemaVersion: "1.0.0";
  readonly organizationId: string;
  readonly competitionId: string;
  readonly competitionName: string;
  readonly publishedRevision: number;
  readonly operationalRevision: number;
  readonly liveVersion: number;
  readonly generatedAt: string;
  readonly expiresAt: string;
  readonly timezone: string;
  readonly authority: {
    readonly publicationCertificateHash: string;
    readonly definitionHash: string;
    readonly guardReportHash: string;
    readonly stateProofHash: string;
  };
  readonly publicProjection: PublicLiveProjection;
  readonly participantLookup: readonly {
    readonly participantId: string;
    readonly projection: ParticipantNextProjection;
  }[];
  readonly emergencyReadiness: {
    readonly status: "BLOCKED_MISSING_AUTHORITY_DATA";
    readonly missingDecisionCodes: readonly string[];
    readonly emergencyContacts: readonly never[];
    readonly instructions: readonly never[];
  };
}

export interface SignedOfflineEventPack {
  readonly apiVersion: "1.0";
  readonly algorithm: "Ed25519";
  readonly keyId: string;
  readonly publicKeyBase64: string;
  readonly payloadBase64: string;
  readonly signatureBase64: string;
}

const privateKeyPrefix = Buffer.from("302e020100300506032b657004220420", "hex");
const publicKeyPrefix = Buffer.from("302a300506032b6570032100", "hex");

function timestamp(value: string): boolean {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function rawPublicKeyFromSeed(seed: Buffer): { readonly privateKey: ReturnType<typeof createPrivateKey>;
  readonly rawPublicKey: Buffer } {
  const privateKey = createPrivateKey({ key: Buffer.concat([privateKeyPrefix, seed]), format: "der", type: "pkcs8" });
  const encodedPublicKey = createPublicKey(privateKey).export({ format: "der", type: "spki" });
  const rawPublicKey = Buffer.from(encodedPublicKey).subarray(publicKeyPrefix.length);
  if (rawPublicKey.length !== 32) throw new Error("offline_pack_signing_not_configured");
  return { privateKey, rawPublicKey };
}

export function signOfflineEventPack(body: OfflineEventPackBody, seedHex: string): SignedOfflineEventPack {
  if (!/^[a-f0-9]{64}$/i.test(seedHex)) throw new Error("offline_pack_signing_not_configured");
  const { privateKey, rawPublicKey } = rawPublicKeyFromSeed(Buffer.from(seedHex, "hex"));
  const payload = Buffer.from(JSON.stringify(body), "utf8");
  return {
    apiVersion: "1.0",
    algorithm: "Ed25519",
    keyId: `sha256:${createHash("sha256").update(rawPublicKey).digest("hex")}`,
    publicKeyBase64: rawPublicKey.toString("base64"),
    payloadBase64: payload.toString("base64"),
    signatureBase64: sign(null, payload, privateKey).toString("base64"),
  };
}

export function verifyOfflineEventPack(pack: SignedOfflineEventPack, trustedPublicKeyBase64: string,
  at: string): OfflineEventPackBody {
  if (pack.apiVersion !== "1.0" || pack.algorithm !== "Ed25519" || !timestamp(at))
    throw new Error("offline_pack_invalid");
  const supplied = Buffer.from(pack.publicKeyBase64, "base64");
  const trusted = Buffer.from(trustedPublicKeyBase64, "base64");
  if (supplied.length !== 32 || trusted.length !== 32 || !timingSafeEqual(supplied, trusted))
    throw new Error("offline_pack_trust_mismatch");
  const expectedKeyId = `sha256:${createHash("sha256").update(trusted).digest("hex")}`;
  if (pack.keyId !== expectedKeyId) throw new Error("offline_pack_trust_mismatch");
  const payload = Buffer.from(pack.payloadBase64, "base64");
  const signature = Buffer.from(pack.signatureBase64, "base64");
  const publicKey = createPublicKey({ key: Buffer.concat([publicKeyPrefix, trusted]), format: "der", type: "spki" });
  if (signature.length !== 64 || !verify(null, payload, publicKey, signature))
    throw new Error("offline_pack_signature_invalid");
  let body: OfflineEventPackBody;
  try { body = JSON.parse(payload.toString("utf8")) as OfflineEventPackBody; }
  catch { throw new Error("offline_pack_invalid"); }
  if (body.schemaVersion !== "1.0.0" || !timestamp(body.generatedAt) || !timestamp(body.expiresAt)
    || Date.parse(body.generatedAt) > Date.parse(at) || Date.parse(body.expiresAt) <= Date.parse(at))
    throw new Error(Date.parse(body.expiresAt) <= Date.parse(at) ? "offline_pack_expired" : "offline_pack_invalid");
  return body;
}
