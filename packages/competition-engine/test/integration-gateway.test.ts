import assert from "node:assert/strict";
import test from "node:test";
import { canonicalHash } from "@tournament-os/tournament-schema";
import {
  IntegrationBoundaryError,
  IntegrationGateway,
  type InboundResultEnvelope,
  type TransportSigner,
  type TransportVerifier,
} from "../src/integration-gateway.js";
import type { Certification, ContestResult, Entrant } from "../src/types.js";

const certification: Certification = {
  status: "CERTIFIED",
  specHash: "spec-123",
  graphHash: "graph-123",
  scheduleHash: "schedule-123",
  findings: [],
  requirementCoverage: [{ id: "req-1", status: "SATISFIED" }],
  statement: "Certified tournament truth.",
  certificationHash: "cert-123",
};

const entrants: Entrant[] = [
  { id: "entrant-a", divisionId: "open", memberIds: ["member-a"] },
  { id: "entrant-b", divisionId: "open", memberIds: ["member-b"] },
];

const result: ContestResult = {
  contestId: "match-1",
  entrants: ["entrant-a", "entrant-b"],
  winnerId: "entrant-a",
  loserId: "entrant-b",
  scoreFor: [11, 7],
  status: "completed",
};

const signer: TransportSigner = {
  keyId: "test-key",
  sign: (payloadHash) => `signed:${payloadHash}`,
};

const verifier: TransportVerifier = {
  verify: ({ payloadHash, signature }) => signature === `signed:${payloadHash}`,
};

const options = () => ({
  provider: "krateasy",
  tournamentId: "tournament-42",
  identities: [
    { kind: "ENTRANT" as const, internalId: "entrant-a", externalId: "ka-entrant-a" },
    { kind: "ENTRANT" as const, internalId: "entrant-b", externalId: "ka-entrant-b" },
    { kind: "MEMBER" as const, internalId: "member-a", externalId: "ka-player-a" },
    { kind: "MEMBER" as const, internalId: "member-b", externalId: "ka-player-b" },
  ],
  signer,
  verifier,
});

function inbound(overrides: Partial<InboundResultEnvelope> = {}): InboundResultEnvelope {
  const unsigned = {
    schemaVersion: "1.0" as const,
    type: "RESULT_REPORTED" as const,
    messageId: "message-1",
    idempotencyKey: "result-match-1-v1",
    provider: "krateasy",
    tournamentId: "tournament-42",
    occurredAt: "2026-09-05T12:00:00.000Z",
    payload: {
      contestId: "match-1",
      entrants: ["ka-entrant-a", "ka-entrant-b"] as [string, string],
      winnerId: "ka-entrant-a",
      loserId: "ka-entrant-b",
      scoreFor: [11, 7] as [number, number],
      status: "COMPLETED" as const,
    },
    ...overrides,
  };
  const { signature: _ignored, ...signable } = unsigned as InboundResultEnvelope;
  return {
    ...unsigned,
    signature: overrides.signature ?? {
      keyId: "test-key",
      value: `signed:${canonicalHash(signable)}`,
    },
  };
}

test("publishes certified truth in a signed, versioned envelope with mapped identities", () => {
  const gateway = new IntegrationGateway(options());
  const envelope = gateway.createCertifiedPublication({
    certification,
    entrants,
    results: [result],
    createdAt: "2026-09-05T11:00:00.000Z",
  });

  assert.equal(envelope.schemaVersion, "1.0");
  assert.equal(envelope.type, "CERTIFIED_TOURNAMENT_PUBLICATION");
  assert.equal(envelope.provider, "krateasy");
  assert.equal(envelope.certification.certificationHash, "cert-123");
  assert.deepEqual(envelope.payload.participants, [
    { internalEntrantId: "entrant-a", externalEntrantId: "ka-entrant-a", externalMemberIds: ["ka-player-a"] },
    { internalEntrantId: "entrant-b", externalEntrantId: "ka-entrant-b", externalMemberIds: ["ka-player-b"] },
  ]);
  assert.deepEqual(envelope.payload.results[0], {
    contestId: "match-1",
    entrants: ["ka-entrant-a", "ka-entrant-b"],
    winnerId: "ka-entrant-a",
    loserId: "ka-entrant-b",
    scoreFor: [11, 7],
    status: "COMPLETED",
  });
  assert.match(envelope.publicationId, /^publication\.[a-f0-9]{64}$/);
  assert.match(envelope.idempotencyKey, /^[a-f0-9]{64}$/);
  assert.equal(envelope.signature.keyId, "test-key");
  assert.equal(envelope.signature.value, `signed:${envelope.contentHash}`);
});

test("publication idempotency is deterministic and excludes delivery time", () => {
  const gateway = new IntegrationGateway(options());
  const first = gateway.createCertifiedPublication({ certification, entrants, results: [result], createdAt: "2026-09-05T11:00:00.000Z" });
  const retry = gateway.createCertifiedPublication({ certification, entrants, results: [structuredClone(result)], createdAt: "2026-09-05T11:05:00.000Z" });

  assert.equal(retry.idempotencyKey, first.idempotencyKey);
  assert.equal(retry.publicationId, first.publicationId);
  assert.notEqual(retry.contentHash, first.contentHash);
});

test("publication identity is stable when unordered participant input is replayed in another order", () => {
  const gateway = new IntegrationGateway(options());
  const first = gateway.createCertifiedPublication({ certification, entrants, results: [result], createdAt: "2026-09-05T11:00:00.000Z" });
  const reordered = gateway.createCertifiedPublication({ certification, entrants: [...entrants].reverse(), results: [result], createdAt: "2026-09-05T11:00:00.000Z" });

  assert.equal(reordered.idempotencyKey, first.idempotencyKey);
  assert.equal(reordered.contentHash, first.contentHash);
  assert.deepEqual(reordered.payload, first.payload);
});

test("publication fails closed for uncertified truth or incomplete identity mapping", () => {
  const gateway = new IntegrationGateway(options());
  assert.throws(() => gateway.createCertifiedPublication({
    certification: { ...certification, status: "REJECTED" }, entrants, results: [result], createdAt: "2026-09-05T11:00:00.000Z",
  }), (error: unknown) => error instanceof IntegrationBoundaryError && error.code === "NOT_CERTIFIED");

  const missingMember = new IntegrationGateway({
    ...options(),
    identities: options().identities.filter(({ internalId }) => internalId !== "member-b"),
  });
  assert.throws(() => missingMember.createCertifiedPublication({
    certification, entrants, results: [result], createdAt: "2026-09-05T11:00:00.000Z",
  }), (error: unknown) => error instanceof IntegrationBoundaryError && error.code === "IDENTITY_MISSING");
});

test("identity mappings reject internal and external ambiguity", () => {
  assert.throws(() => new IntegrationGateway({
    ...options(),
    identities: [...options().identities, { kind: "ENTRANT", internalId: "entrant-a", externalId: "different" }],
  }), (error: unknown) => error instanceof IntegrationBoundaryError && error.code === "IDENTITY_CONFLICT");
  assert.throws(() => new IntegrationGateway({
    ...options(),
    identities: [...options().identities, { kind: "ENTRANT", internalId: "entrant-c", externalId: "ka-entrant-a" }],
  }), (error: unknown) => error instanceof IntegrationBoundaryError && error.code === "IDENTITY_CONFLICT");
});

test("accepts a verified inbound result and maps it back to internal tournament truth", () => {
  const gateway = new IntegrationGateway(options());
  assert.deepEqual(gateway.acceptInboundResult(inbound()), result);
});

test("rejects bad signatures, provider drift, unknown identities, and closed-enum drift", () => {
  const cases: Array<[unknown, string]> = [
    [inbound({ signature: { keyId: "test-key", value: "tampered" } }), "SIGNATURE_INVALID"],
    [inbound({ provider: "other-provider" }), "ROUTE_MISMATCH"],
    [inbound({ payload: { ...inbound().payload, entrants: ["unknown-external-id", "ka-entrant-b"], winnerId: "unknown-external-id" } }), "IDENTITY_MISSING"],
    [inbound({ schemaVersion: "2.0" as "1.0" }), "SCHEMA_UNSUPPORTED"],
    [inbound({ payload: { ...inbound().payload, status: "ABANDONED" as "COMPLETED" } }), "STATUS_UNSUPPORTED"],
  ];
  for (const [message, code] of cases) {
    const gateway = new IntegrationGateway(options());
    assert.throws(() => gateway.acceptInboundResult(message), (error: unknown) =>
      error instanceof IntegrationBoundaryError && error.code === code, code);
  }
});

test("rejects malformed or semantically contradictory inbound results", () => {
  const badCases: unknown[] = [
    null,
    {},
    inbound({ occurredAt: "not-a-timestamp" }),
    inbound({ payload: { ...inbound().payload, entrants: ["ka-entrant-a", "ka-entrant-a"] } }),
    inbound({ payload: { ...inbound().payload, winnerId: "ka-entrant-b", loserId: "ka-entrant-b" } }),
    inbound({ payload: { ...inbound().payload, scoreFor: [11, -1] } }),
  ];
  for (const message of badCases) {
    const gateway = new IntegrationGateway(options());
    assert.throws(() => gateway.acceptInboundResult(message), IntegrationBoundaryError);
  }
});

test("walkovers remain scoreless on both sides of the integration boundary", () => {
  const gateway = new IntegrationGateway(options());
  assert.throws(() => gateway.createCertifiedPublication({
    certification,
    entrants,
    results: [{ ...result, status: "walkover", scoreFor: [1, 0] }],
    createdAt: "2026-09-05T11:00:00.000Z",
  }), (error: unknown) => error instanceof IntegrationBoundaryError && error.code === "PUBLICATION_INVALID");
  assert.throws(() => gateway.acceptInboundResult(inbound({
    payload: { ...inbound().payload, status: "WALKOVER", scoreFor: [1, 0] },
  })), (error: unknown) => error instanceof IntegrationBoundaryError && error.code === "SCHEMA_INVALID");
});

test("rejects exact replay and conflicting reuse of an idempotency key or message id", () => {
  const gateway = new IntegrationGateway(options());
  gateway.acceptInboundResult(inbound());

  assert.throws(() => gateway.acceptInboundResult(inbound()), (error: unknown) =>
    error instanceof IntegrationBoundaryError && error.code === "REPLAY");
  assert.throws(() => gateway.acceptInboundResult(inbound({
    messageId: "message-2",
    payload: { ...inbound().payload, scoreFor: [11, 8] },
  })), (error: unknown) => error instanceof IntegrationBoundaryError && error.code === "IDEMPOTENCY_CONFLICT");
  assert.throws(() => gateway.acceptInboundResult(inbound({
    idempotencyKey: "result-match-1-v2",
    payload: { ...inbound().payload, scoreFor: [11, 9] },
  })), (error: unknown) => error instanceof IntegrationBoundaryError && error.code === "MESSAGE_CONFLICT");
});
