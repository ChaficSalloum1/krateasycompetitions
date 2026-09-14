import { canonicalHash, deepFreeze } from "@tournament-os/tournament-schema";
import type { Certification, ContestResult, Entrant } from "./types.js";

export type IntegrationBoundaryErrorCode =
  | "CONFIGURATION_INVALID"
  | "IDENTITY_CONFLICT"
  | "IDENTITY_MISSING"
  | "NOT_CERTIFIED"
  | "PUBLICATION_INVALID"
  | "SCHEMA_INVALID"
  | "SCHEMA_UNSUPPORTED"
  | "TYPE_UNSUPPORTED"
  | "STATUS_UNSUPPORTED"
  | "ROUTE_MISMATCH"
  | "SIGNATURE_INVALID"
  | "REPLAY"
  | "IDEMPOTENCY_CONFLICT"
  | "MESSAGE_CONFLICT";

export class IntegrationBoundaryError extends Error {
  constructor(readonly code: IntegrationBoundaryErrorCode, message: string) {
    super(message);
    this.name = "IntegrationBoundaryError";
  }
}

export interface ExternalIdentityMapping {
  kind: "ENTRANT" | "MEMBER";
  internalId: string;
  externalId: string;
}

export interface TransportSigner {
  keyId: string;
  sign(payloadHash: string): string;
}

export interface TransportVerifier {
  verify(input: { keyId: string; payloadHash: string; signature: string }): boolean;
}

export interface ExternalContestResult {
  contestId: string;
  entrants: [string, string];
  winnerId: string;
  loserId: string;
  scoreFor: [number, number];
  status: "COMPLETED" | "WALKOVER";
}

export interface CertifiedPublicationEnvelope {
  schemaVersion: "1.0";
  type: "CERTIFIED_TOURNAMENT_PUBLICATION";
  publicationId: string;
  idempotencyKey: string;
  provider: string;
  tournamentId: string;
  createdAt: string;
  certification: {
    specHash: string;
    certificationHash: string;
  };
  payload: {
    participants: Array<{
      internalEntrantId: string;
      externalEntrantId: string;
      externalMemberIds: string[];
    }>;
    results: ExternalContestResult[];
  };
  contentHash: string;
  signature: { keyId: string; value: string };
}

export interface InboundResultEnvelope {
  schemaVersion: "1.0";
  type: "RESULT_REPORTED";
  messageId: string;
  idempotencyKey: string;
  provider: string;
  tournamentId: string;
  occurredAt: string;
  payload: ExternalContestResult;
  signature: { keyId: string; value: string };
}

export interface IntegrationGatewayOptions {
  provider: string;
  tournamentId: string;
  identities: ExternalIdentityMapping[];
  signer: TransportSigner;
  verifier: TransportVerifier;
}

export interface CertifiedPublicationInput {
  certification: Certification;
  entrants: Entrant[];
  results: ContestResult[];
  createdAt: string;
}

const requiredString = (value: unknown, name: string, code: IntegrationBoundaryErrorCode = "SCHEMA_INVALID"): string => {
  if (typeof value !== "string" || value.trim().length === 0) throw new IntegrationBoundaryError(code, `${name} must be a non-empty string`);
  return value;
};

const record = (value: unknown, name: string): Record<string, unknown> => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new IntegrationBoundaryError("SCHEMA_INVALID", `${name} must be an object`);
  return value as Record<string, unknown>;
};

const exactKeys = (value: Record<string, unknown>, expected: readonly string[], name: string): void => {
  const actual = Object.keys(value).sort();
  const required = [...expected].sort();
  if (actual.length !== required.length || actual.some((key, index) => key !== required[index])) {
    throw new IntegrationBoundaryError("SCHEMA_INVALID", `${name} must contain exactly: ${required.join(", ")}`);
  }
};

const validTimestamp = (value: unknown, name: string, code: IntegrationBoundaryErrorCode): string => {
  const timestamp = requiredString(value, name, code);
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== timestamp) throw new IntegrationBoundaryError(code, `${name} must be a canonical ISO-8601 timestamp`);
  return timestamp;
};

const validScore = (value: unknown, code: IntegrationBoundaryErrorCode): [number, number] => {
  if (!Array.isArray(value) || value.length !== 2 || value.some((score) => !Number.isSafeInteger(score) || score < 0)) {
    throw new IntegrationBoundaryError(code, "scoreFor must contain exactly two non-negative safe integers");
  }
  return [value[0] as number, value[1] as number];
};

const validPair = (value: unknown, name: string, code: IntegrationBoundaryErrorCode): [string, string] => {
  if (!Array.isArray(value) || value.length !== 2) throw new IntegrationBoundaryError(code, `${name} must contain exactly two identifiers`);
  const pair: [string, string] = [requiredString(value[0], `${name}[0]`, code), requiredString(value[1], `${name}[1]`, code)];
  if (pair[0] === pair[1]) throw new IntegrationBoundaryError(code, `${name} must contain two distinct identifiers`);
  return pair;
};

const transportStatus = (status: unknown): "COMPLETED" | "WALKOVER" => {
  if (status !== "COMPLETED" && status !== "WALKOVER") throw new IntegrationBoundaryError("STATUS_UNSUPPORTED", `Unsupported result status: ${String(status)}`);
  return status;
};

const domainStatus = (status: unknown): "completed" | "walkover" => {
  if (status !== "completed" && status !== "walkover") throw new IntegrationBoundaryError("PUBLICATION_INVALID", `Unsupported result status: ${String(status)}`);
  return status;
};

function withoutSignature(envelope: InboundResultEnvelope): Omit<InboundResultEnvelope, "signature"> {
  const { signature: _signature, ...signable } = envelope;
  return signable;
}

export class IntegrationGateway {
  readonly #provider: string;
  readonly #tournamentId: string;
  readonly #signer: TransportSigner;
  readonly #verifier: TransportVerifier;
  readonly #internalIdentities = new Map<string, string>();
  readonly #externalIdentities = new Map<string, string>();
  readonly #acceptedIdempotency = new Map<string, string>();
  readonly #acceptedMessages = new Map<string, string>();

  constructor(options: IntegrationGatewayOptions) {
    this.#provider = requiredString(options.provider, "provider", "CONFIGURATION_INVALID");
    this.#tournamentId = requiredString(options.tournamentId, "tournamentId", "CONFIGURATION_INVALID");
    if (!options.signer || typeof options.signer.sign !== "function" || !options.signer.keyId) {
      throw new IntegrationBoundaryError("CONFIGURATION_INVALID", "A signer with a non-empty keyId is required");
    }
    if (!options.verifier || typeof options.verifier.verify !== "function") {
      throw new IntegrationBoundaryError("CONFIGURATION_INVALID", "A transport verifier is required");
    }
    this.#signer = options.signer;
    this.#verifier = options.verifier;
    if (!Array.isArray(options.identities)) throw new IntegrationBoundaryError("CONFIGURATION_INVALID", "identities must be an array");
    for (const mapping of options.identities) this.#registerIdentity(mapping);
  }

  #registerIdentity(mapping: ExternalIdentityMapping): void {
    if (!mapping || (mapping.kind !== "ENTRANT" && mapping.kind !== "MEMBER")) {
      throw new IntegrationBoundaryError("CONFIGURATION_INVALID", "Identity kind must be ENTRANT or MEMBER");
    }
    const internalId = requiredString(mapping.internalId, "identity.internalId", "CONFIGURATION_INVALID");
    const externalId = requiredString(mapping.externalId, "identity.externalId", "CONFIGURATION_INVALID");
    const internalKey = `${mapping.kind}:${internalId}`;
    const externalKey = `${mapping.kind}:${externalId}`;
    if (this.#internalIdentities.has(internalKey) || this.#externalIdentities.has(externalKey)) {
      throw new IntegrationBoundaryError("IDENTITY_CONFLICT", `Ambiguous ${mapping.kind.toLowerCase()} identity mapping`);
    }
    this.#internalIdentities.set(internalKey, externalId);
    this.#externalIdentities.set(externalKey, internalId);
  }

  #toExternal(kind: ExternalIdentityMapping["kind"], internalId: string): string {
    const mapped = this.#internalIdentities.get(`${kind}:${internalId}`);
    if (!mapped) throw new IntegrationBoundaryError("IDENTITY_MISSING", `No ${kind.toLowerCase()} mapping for internal identity ${internalId}`);
    return mapped;
  }

  #toInternal(kind: ExternalIdentityMapping["kind"], externalId: string): string {
    const mapped = this.#externalIdentities.get(`${kind}:${externalId}`);
    if (!mapped) throw new IntegrationBoundaryError("IDENTITY_MISSING", `No ${kind.toLowerCase()} mapping for external identity ${externalId}`);
    return mapped;
  }

  #externalResult(resultValue: ContestResult, knownEntrants: Set<string>): ExternalContestResult {
    const source = resultValue as ContestResult;
    const contestId = requiredString(source?.contestId, "result.contestId", "PUBLICATION_INVALID");
    const entrants = validPair(source?.entrants, "result.entrants", "PUBLICATION_INVALID");
    if (entrants.some((entrantId) => !knownEntrants.has(entrantId))) throw new IntegrationBoundaryError("PUBLICATION_INVALID", `${contestId} references an entrant outside the publication`);
    const winnerId = requiredString(source?.winnerId, "result.winnerId", "PUBLICATION_INVALID");
    const loserId = requiredString(source?.loserId, "result.loserId", "PUBLICATION_INVALID");
    if (winnerId === loserId || !entrants.includes(winnerId) || !entrants.includes(loserId)) {
      throw new IntegrationBoundaryError("PUBLICATION_INVALID", `${contestId} winner and loser must be the two distinct result entrants`);
    }
    const scoreFor = validScore(source?.scoreFor, "PUBLICATION_INVALID");
    const status = domainStatus(source?.status);
    if (status === "walkover" && scoreFor.some((score) => score !== 0)) {
      throw new IntegrationBoundaryError("PUBLICATION_INVALID", `${contestId} walkover must be scoreless`);
    }
    return {
      contestId,
      entrants: [this.#toExternal("ENTRANT", entrants[0]), this.#toExternal("ENTRANT", entrants[1])],
      winnerId: this.#toExternal("ENTRANT", winnerId),
      loserId: this.#toExternal("ENTRANT", loserId),
      scoreFor,
      status: status === "completed" ? "COMPLETED" : "WALKOVER",
    };
  }

  createCertifiedPublication(input: CertifiedPublicationInput): Readonly<CertifiedPublicationEnvelope> {
    if (input.certification?.status !== "CERTIFIED") throw new IntegrationBoundaryError("NOT_CERTIFIED", "Only certified tournament truth may be published");
    const specHash = requiredString(input.certification.specHash, "certification.specHash", "PUBLICATION_INVALID");
    const certificationHash = requiredString(input.certification.certificationHash, "certification.certificationHash", "PUBLICATION_INVALID");
    const createdAt = validTimestamp(input.createdAt, "createdAt", "PUBLICATION_INVALID");
    if (!Array.isArray(input.entrants) || !Array.isArray(input.results)) throw new IntegrationBoundaryError("PUBLICATION_INVALID", "Publication entrants and results must be arrays");
    const knownEntrants = new Set<string>();
    const participants = input.entrants.map((entrant) => {
      const internalEntrantId = requiredString(entrant?.id, "entrant.id", "PUBLICATION_INVALID");
      if (knownEntrants.has(internalEntrantId)) throw new IntegrationBoundaryError("PUBLICATION_INVALID", `Duplicate entrant ${internalEntrantId}`);
      knownEntrants.add(internalEntrantId);
      if (!Array.isArray(entrant.memberIds) || entrant.memberIds.length === 0) throw new IntegrationBoundaryError("PUBLICATION_INVALID", `${internalEntrantId} must have members`);
      return {
        internalEntrantId,
        externalEntrantId: this.#toExternal("ENTRANT", internalEntrantId),
        externalMemberIds: entrant.memberIds.map((memberId) => this.#toExternal("MEMBER", memberId)).sort(),
      };
    }).sort((left, right) => left.internalEntrantId.localeCompare(right.internalEntrantId));
    const results = input.results.map((result) => this.#externalResult(result, knownEntrants))
      .sort((left, right) => left.contestId.localeCompare(right.contestId));
    const payload = { participants, results };
    const idempotencyKey = canonicalHash({
      schemaVersion: "1.0", type: "CERTIFIED_TOURNAMENT_PUBLICATION", provider: this.#provider,
      tournamentId: this.#tournamentId, certification: { specHash, certificationHash }, payload,
    });
    const publicationId = `publication.${idempotencyKey}`;
    const signable = {
      schemaVersion: "1.0" as const,
      type: "CERTIFIED_TOURNAMENT_PUBLICATION" as const,
      publicationId,
      idempotencyKey,
      provider: this.#provider,
      tournamentId: this.#tournamentId,
      createdAt,
      certification: { specHash, certificationHash },
      payload,
    };
    const contentHash = canonicalHash(signable);
    const signatureValue = this.#signer.sign(contentHash);
    if (typeof signatureValue !== "string" || signatureValue.length === 0) throw new IntegrationBoundaryError("SIGNATURE_INVALID", "Signer returned an empty signature");
    return deepFreeze(structuredClone({
      ...signable,
      contentHash,
      signature: { keyId: this.#signer.keyId, value: signatureValue },
    }));
  }

  acceptInboundResult(value: unknown): Readonly<ContestResult> {
    const envelopeRecord = record(value, "inbound result envelope");
    exactKeys(envelopeRecord, ["schemaVersion", "type", "messageId", "idempotencyKey", "provider", "tournamentId", "occurredAt", "payload", "signature"], "inbound result envelope");
    if (envelopeRecord.schemaVersion !== "1.0") throw new IntegrationBoundaryError("SCHEMA_UNSUPPORTED", `Unsupported schema version: ${String(envelopeRecord.schemaVersion)}`);
    if (envelopeRecord.type !== "RESULT_REPORTED") throw new IntegrationBoundaryError("TYPE_UNSUPPORTED", `Unsupported message type: ${String(envelopeRecord.type)}`);
    const messageId = requiredString(envelopeRecord.messageId, "messageId");
    const idempotencyKey = requiredString(envelopeRecord.idempotencyKey, "idempotencyKey");
    const provider = requiredString(envelopeRecord.provider, "provider");
    const tournamentId = requiredString(envelopeRecord.tournamentId, "tournamentId");
    const occurredAt = validTimestamp(envelopeRecord.occurredAt, "occurredAt", "SCHEMA_INVALID");
    if (provider !== this.#provider || tournamentId !== this.#tournamentId) throw new IntegrationBoundaryError("ROUTE_MISMATCH", "Inbound result does not match the configured provider and tournament route");

    const payloadRecord = record(envelopeRecord.payload, "payload");
    exactKeys(payloadRecord, ["contestId", "entrants", "winnerId", "loserId", "scoreFor", "status"], "payload");
    const externalResult: ExternalContestResult = {
      contestId: requiredString(payloadRecord.contestId, "payload.contestId"),
      entrants: validPair(payloadRecord.entrants, "payload.entrants", "SCHEMA_INVALID"),
      winnerId: requiredString(payloadRecord.winnerId, "payload.winnerId"),
      loserId: requiredString(payloadRecord.loserId, "payload.loserId"),
      scoreFor: validScore(payloadRecord.scoreFor, "SCHEMA_INVALID"),
      status: transportStatus(payloadRecord.status),
    };
    if (externalResult.winnerId === externalResult.loserId
      || !externalResult.entrants.includes(externalResult.winnerId)
      || !externalResult.entrants.includes(externalResult.loserId)) {
      throw new IntegrationBoundaryError("SCHEMA_INVALID", "winnerId and loserId must be the two distinct result entrants");
    }
    if (externalResult.status === "WALKOVER" && externalResult.scoreFor.some((score) => score !== 0)) {
      throw new IntegrationBoundaryError("SCHEMA_INVALID", "A walkover result must be scoreless");
    }

    const signatureRecord = record(envelopeRecord.signature, "signature");
    exactKeys(signatureRecord, ["keyId", "value"], "signature");
    const signature = {
      keyId: requiredString(signatureRecord.keyId, "signature.keyId"),
      value: requiredString(signatureRecord.value, "signature.value"),
    };
    const envelope: InboundResultEnvelope = {
      schemaVersion: "1.0", type: "RESULT_REPORTED", messageId, idempotencyKey, provider, tournamentId,
      occurredAt, payload: externalResult, signature,
    };
    const payloadHash = canonicalHash(withoutSignature(envelope));
    let verified = false;
    try {
      verified = this.#verifier.verify({ keyId: signature.keyId, payloadHash, signature: signature.value });
    } catch {
      verified = false;
    }
    if (!verified) throw new IntegrationBoundaryError("SIGNATURE_INVALID", "Inbound transport signature could not be verified");

    const priorIdempotencyHash = this.#acceptedIdempotency.get(idempotencyKey);
    if (priorIdempotencyHash === payloadHash) throw new IntegrationBoundaryError("REPLAY", `Inbound idempotency key ${idempotencyKey} has already been accepted`);
    if (priorIdempotencyHash !== undefined) throw new IntegrationBoundaryError("IDEMPOTENCY_CONFLICT", `Inbound idempotency key ${idempotencyKey} was reused with different content`);
    const priorMessageHash = this.#acceptedMessages.get(messageId);
    if (priorMessageHash !== undefined) throw new IntegrationBoundaryError("MESSAGE_CONFLICT", `Inbound message id ${messageId} was reused`);

    const entrants: [string, string] = [
      this.#toInternal("ENTRANT", externalResult.entrants[0]),
      this.#toInternal("ENTRANT", externalResult.entrants[1]),
    ];
    const winnerId = this.#toInternal("ENTRANT", externalResult.winnerId);
    const loserId = this.#toInternal("ENTRANT", externalResult.loserId);
    const result: ContestResult = {
      contestId: externalResult.contestId,
      entrants,
      winnerId,
      loserId,
      scoreFor: externalResult.scoreFor,
      status: externalResult.status === "COMPLETED" ? "completed" : "walkover",
    };
    this.#acceptedIdempotency.set(idempotencyKey, payloadHash);
    this.#acceptedMessages.set(messageId, payloadHash);
    return deepFreeze(structuredClone(result));
  }
}
