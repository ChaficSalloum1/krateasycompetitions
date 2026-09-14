import { createHmac, timingSafeEqual } from "node:crypto";
import type { OrganizationPlatformApi, PlatformApiPrincipal } from "@tournament-os/competition-engine";

export interface ProductionPilotRequest {
  readonly method: "GET" | "POST";
  readonly path: string;
  readonly headers: Readonly<Record<string, string | undefined>>;
  readonly body?: string | Uint8Array;
  /** Supplied only by the trusted authentication middleware, never decoded from the body. */
  readonly principal: PlatformApiPrincipal | null;
}

export interface ProductionPilotResponse {
  readonly status: number;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body: unknown;
}

export interface CoordinationStoreCapabilities {
  readonly scope: "PROCESS_LOCAL" | "DISTRIBUTED";
  readonly atomic: boolean;
  readonly durable: boolean;
}

export interface RateLimitStore {
  readonly capabilities: CoordinationStoreCapabilities;
  consume(input: { readonly key: string; readonly limit: number; readonly windowMs: number; readonly nowMs: number }):
    Promise<{ readonly allowed: boolean; readonly retryAfterSeconds: number }>;
}

export interface WebhookReplayStore {
  readonly capabilities: CoordinationStoreCapabilities;
  claim(input: { readonly key: string; readonly nowMs: number; readonly expiresAtMs: number }): Promise<boolean>;
  complete(input: { readonly key: string; readonly expiresAtMs: number }): Promise<void>;
  release(input: { readonly key: string; readonly expiresAtMs: number }): Promise<void>;
}

export interface VerifiedWebhook {
  readonly tenantId: string;
  readonly provider: string;
  readonly eventId: string;
  readonly eventType: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly receivedAt: string;
}

export interface ProductionPilotApiOptions {
  readonly tenantId: string;
  readonly delegate: OrganizationPlatformApi;
  readonly now: () => Date;
  readonly rateLimitStore: RateLimitStore;
  readonly webhookReplayStore: WebhookReplayStore;
  readonly resolveWebhookSecret: (provider: string) => Promise<string | null>;
  readonly receiveWebhook: (event: VerifiedWebhook) => Promise<void>;
  readonly maxBodyBytes?: number;
  readonly maxJsonDepth?: number;
  readonly maxArrayItems?: number;
  readonly maxObjectFields?: number;
  readonly maxStringBytes?: number;
  readonly principalLimit?: number;
  readonly principalWindowMs?: number;
  readonly webhookMaxSkewMs?: number;
  readonly webhookReplayTtlMs?: number;
  /** Fail fast unless both coordination stores are safe across replicas and restarts. */
  readonly requireDistributedStores?: boolean;
}

export interface ProductionPilotApi { handle(request: ProductionPilotRequest): Promise<ProductionPilotResponse> }

export function createInMemoryRateLimitStore(): RateLimitStore {
  const buckets = new Map<string, { count: number; startsAt: number }>();
  return { capabilities: { scope: "PROCESS_LOCAL", atomic: true, durable: false }, consume: async ({ key, limit, windowMs, nowMs }) => {
    const current = buckets.get(key);
    const bucket = !current || nowMs - current.startsAt >= windowMs ? { count: 0, startsAt: nowMs } : current;
    bucket.count += 1;
    buckets.set(key, bucket);
    const remainingMs = Math.max(0, windowMs - (nowMs - bucket.startsAt));
    return { allowed: bucket.count <= limit, retryAfterSeconds: Math.max(1, Math.ceil(remainingMs / 1000)) };
  } };
}

export function createInMemoryWebhookReplayStore(): WebhookReplayStore {
  const entries = new Map<string, number>();
  return {
    capabilities: { scope: "PROCESS_LOCAL", atomic: true, durable: false },
    claim: async ({ key, nowMs, expiresAtMs }) => {
      const existing = entries.get(key);
      if (existing !== undefined && existing > nowMs) return false;
      entries.set(key, expiresAtMs);
      return true;
    },
    complete: async ({ key, expiresAtMs }) => {
      if (entries.get(key) !== expiresAtMs) throw new Error("Webhook replay claim was lost");
      entries.set(key, expiresAtMs);
    },
    release: async ({ key, expiresAtMs }) => { if (entries.get(key) === expiresAtMs) entries.delete(key); },
  };
}

export function assertProductionPilotCoordinationStores(options: Pick<ProductionPilotApiOptions, "rateLimitStore" | "webhookReplayStore">): void {
  for (const [name, capabilities] of [["rateLimitStore", options.rateLimitStore.capabilities],
    ["webhookReplayStore", options.webhookReplayStore.capabilities]] as const) {
    if (capabilities.scope !== "DISTRIBUTED" || !capabilities.atomic || !capabilities.durable) {
      throw new Error(`${name} must be distributed, atomic, durable for production`);
    }
  }
}

const authorityFields = new Set(["organizationId", "tenantId", "actorUserId", "commandId", "occurredAt"]);
const idempotencyPattern = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{2,199}$/;
const identifierPattern = /^[a-z0-9][a-z0-9._-]{1,99}$/;
const jsonContentType = /^application\/json(?:\s*;\s*charset=utf-8)?$/i;

type CommandRule = { readonly required: readonly string[]; readonly optional?: readonly string[] };
const commandRules: Readonly<Record<string, CommandRule>> = {
  CHANGE_TOURNAMENT_STATUS: { required: ["kind", "tournamentId", "status"] },
  PUBLISH_TOURNAMENT: { required: ["kind", "tournamentId", "guardInput", "acknowledgedFindingCodes"] },
  CERTIFY_TOURNAMENT_PUBLICATION: { required: ["kind", "tournamentId", "guardInput", "acknowledgedFindingCodes"] },
  PROPOSE_LIVE_CHANGE: { required: ["kind", "tournamentId", "proposalId", "liveCommand", "repairRequest", "maxSearchNodes"] },
  DECIDE_LIVE_CHANGE: { required: ["kind", "tournamentId", "proposalId", "decision"] },
  APPLY_LIVE_OPERATION: { required: ["kind", "tournamentId", "liveCommand"] },
  RECORD_SCORE: { required: ["kind", "tournamentId", "contestId", "expectedScoreRevision", "winnerEntrantId", "score", "source"], optional: ["correctionReason"] },
};
const liveRules: Readonly<Record<string, CommandRule>> = {
  CHECK_IN: { required: ["kind", "expectedVersion", "entrantId"] },
  MARK_LATE: { required: ["kind", "expectedVersion", "entrantId", "reason"] },
  WITHDRAW_ENTRANT: { required: ["kind", "expectedVersion", "entrantId", "reason"] },
  DECLARE_NO_SHOW: { required: ["kind", "expectedVersion", "contestId", "entrantId", "reason"] },
  AWARD_WALKOVER: { required: ["kind", "expectedVersion", "contestId", "winnerEntrantId", "absentEntrantId", "reason"] },
  START_CONTEST: { required: ["kind", "expectedVersion", "contestId", "courtId", "startedAt"] },
  COMPLETE_CONTEST: { required: ["kind", "expectedVersion", "contestId", "endedAt"] },
  RECORD_RETIREMENT: { required: ["kind", "expectedVersion", "contestId", "retiredEntrantId", "winnerEntrantId", "endedAt", "reason"] },
  RECORD_RESULT_RECEIPT: { required: ["kind", "expectedVersion", "contestId", "source"] },
  FILE_PROTEST: { required: ["kind", "expectedVersion", "protestId", "contestId", "filedById", "reason"] },
  RESOLVE_PROTEST: { required: ["kind", "expectedVersion", "protestId", "outcome", "reason"] },
  FILE_APPEAL: { required: ["kind", "expectedVersion", "appealId", "protestId", "filedById", "reason"] },
  RESOLVE_APPEAL: { required: ["kind", "expectedVersion", "appealId", "outcome", "reason"] },
  CORRECT_OPERATION: { required: ["kind", "expectedVersion", "supersedesEventId", "replacement", "reason"] },
  CLOSE_COURT: { required: ["kind", "expectedVersion", "courtId", "reason"], optional: ["expectedReopenAt"] },
  REOPEN_COURT: { required: ["kind", "expectedVersion", "courtId", "reason"] },
  MARK_OFFICIAL_ABSENT: { required: ["kind", "expectedVersion", "officialId", "reason"] },
  RESTORE_OFFICIAL: { required: ["kind", "expectedVersion", "officialId", "reason"] },
  REPORT_EQUIPMENT_FAILURE: { required: ["kind", "expectedVersion", "equipmentId", "reason"] },
  RESTORE_EQUIPMENT: { required: ["kind", "expectedVersion", "equipmentId", "reason"] },
};

function jsonError(message: string): ProductionPilotResponse {
  return { status: 400, body: { apiVersion: "1.0", error: "invalid_request", message } };
}

function header(headers: Readonly<Record<string, string | undefined>>, name: string): string | undefined {
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) if (key.toLowerCase() === target) return value;
  return undefined;
}

function parseObjectBody(body: string | Uint8Array | undefined): Record<string, unknown> | undefined {
  if (body === undefined) return undefined;
  try {
    const parsed = JSON.parse(typeof body === "string" ? body : new TextDecoder().decode(body));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined;
  } catch { return undefined; }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactObject(value: unknown, required: readonly string[], optional: readonly string[] = []): boolean {
  if (!isObject(value)) return false;
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => key in value) && Object.keys(value).every((key) => allowed.has(key));
}

function identifier(value: unknown): value is string {
  return typeof value === "string" && identifierPattern.test(value);
}

function validateCommand(body: Record<string, unknown>): string | undefined {
  if (typeof body.kind !== "string" || !(body.kind in commandRules)) return "Command kind is not enabled for the production pilot API.";
  const rule = commandRules[body.kind]!;
  if (!exactObject(body, rule.required, rule.optional)) return `Command ${body.kind} contains missing or unknown fields.`;
  if (!identifier(body.tournamentId)) return "tournamentId is invalid.";
  if (body.kind === "CHANGE_TOURNAMENT_STATUS"
    && !["UNDER_REVIEW", "APPROVED", "ARCHIVED", "LIVE", "COMPLETED"].includes(body.status as string)) return "Tournament status is invalid.";
  if (body.kind === "PUBLISH_TOURNAMENT" || body.kind === "CERTIFY_TOURNAMENT_PUBLICATION") {
    if (!exactObject(body.guardInput, ["spec", "graph", "schedule"], ["simulation"])) return "guardInput has an invalid schema.";
    if (!Array.isArray(body.acknowledgedFindingCodes) || body.acknowledgedFindingCodes.length > 100
      || body.acknowledgedFindingCodes.some((entry) => typeof entry !== "string" || entry.length < 1 || entry.length > 100)) {
      return "acknowledgedFindingCodes is invalid.";
    }
  }
  if (body.kind === "PROPOSE_LIVE_CHANGE" || body.kind === "APPLY_LIVE_OPERATION") {
    const live = body.liveCommand;
    if (!isObject(live) || typeof live.kind !== "string" || !(live.kind in liveRules)
      || !Number.isSafeInteger(live.expectedVersion) || (live.expectedVersion as number) < 0
      || !exactObject(live, liveRules[live.kind]!.required, liveRules[live.kind]!.optional)
      || ["actorId", "commandId", "occurredAt"].some((key) => key in live)) return "liveCommand has an invalid schema or contains server-controlled audit fields.";
    for (const [key, value] of Object.entries(live)) {
      if (/^(?:entrantId|contestId|courtId|winnerEntrantId|absentEntrantId|retiredEntrantId|protestId|appealId|filedById|officialId|equipmentId|supersedesEventId)$/.test(key)
        && !identifier(value)) return `liveCommand ${key} is invalid.`;
      if ((key === "reason" || key === "source") && (typeof value !== "string" || value.length < 1 || value.length > 500)) {
        return `liveCommand ${key} is invalid.`;
      }
      if (/^(?:startedAt|endedAt|expectedReopenAt)$/.test(key)
        && (typeof value !== "string" || !Number.isFinite(Date.parse(value)))) return `liveCommand ${key} is invalid.`;
    }
    if ((live.kind === "RESOLVE_PROTEST" || live.kind === "RESOLVE_APPEAL") && !["UPHELD", "DENIED"].includes(live.outcome as string)) {
      return "liveCommand outcome is invalid.";
    }
    if (live.kind === "CORRECT_OPERATION" && !isObject(live.replacement)) return "liveCommand replacement is invalid.";
  }
  if (body.kind === "PROPOSE_LIVE_CHANGE") {
    if (!identifier(body.proposalId) || !exactObject(body.repairRequest, ["problem", "baseline"], ["freezeThroughMinute", "pinnedTaskIds"])
      || !Number.isSafeInteger(body.maxSearchNodes) || (body.maxSearchNodes as number) < 1 || (body.maxSearchNodes as number) > 1_000_000) {
      return "Live-change repair request is invalid.";
    }
  }
  if (body.kind === "DECIDE_LIVE_CHANGE" && (!identifier(body.proposalId) || !["APPROVED", "REJECTED"].includes(body.decision as string))) {
    return "Live-change decision is invalid.";
  }
  if (body.kind === "RECORD_SCORE" && (!identifier(body.contestId) || !identifier(body.winnerEntrantId)
    || !Number.isSafeInteger(body.expectedScoreRevision) || (body.expectedScoreRevision as number) < 0
    || typeof body.source !== "string" || body.source.length < 1 || body.source.length > 100
    || (body.correctionReason !== undefined && (typeof body.correctionReason !== "string" || body.correctionReason.length > 500)))) {
    return "Score command is invalid.";
  }
  return undefined;
}

function byteLength(body: string | Uint8Array | undefined): number {
  if (body === undefined) return 0;
  return typeof body === "string" ? Buffer.byteLength(body, "utf8") : body.byteLength;
}

function rawBody(body: string | Uint8Array | undefined): string | undefined {
  return body === undefined ? undefined : typeof body === "string" ? body : new TextDecoder().decode(body);
}

function verifiedSignature(signature: string | undefined, secret: string, signedContent: string): boolean {
  if (!signature || !/^v1=[a-f0-9]{64}$/.test(signature)) return false;
  const received = Buffer.from(signature.slice(3), "hex");
  const expected = createHmac("sha256", secret).update(signedContent).digest();
  return received.length === expected.length && timingSafeEqual(received, expected);
}

function jsonBudgetError(value: unknown, limits: { readonly depth: number; readonly arrays: number; readonly fields: number; readonly stringBytes: number }, depth = 0): string | undefined {
  if (depth > limits.depth) return "JSON nesting is too deep.";
  if (typeof value === "string") return Buffer.byteLength(value, "utf8") > limits.stringBytes ? "A string field exceeds the byte limit." : undefined;
  if (Array.isArray(value)) {
    if (value.length > limits.arrays) return "An array field exceeds the item limit.";
    for (const entry of value) { const error = jsonBudgetError(entry, limits, depth + 1); if (error) return error; }
  } else if (isObject(value)) {
    const entries = Object.entries(value);
    if (entries.length > limits.fields) return "An object exceeds the field limit.";
    for (const [key, entry] of entries) {
      if (Buffer.byteLength(key, "utf8") > 100) return "An object key exceeds the byte limit.";
      const error = jsonBudgetError(entry, limits, depth + 1); if (error) return error;
    }
  }
  return undefined;
}

export function createProductionPilotApi(options: ProductionPilotApiOptions): ProductionPilotApi {
  if (options.requireDistributedStores) assertProductionPilotCoordinationStores(options);
  return { handle: async (request) => {
    const webhookMatch = /^\/v1\/webhooks\/([a-z0-9][a-z0-9._-]{1,99})$/.exec(request.path);
    if (webhookMatch) {
      if (request.method !== "POST") return { status: 404, body: { apiVersion: "1.0", error: "not_found" } };
      if (!jsonContentType.test(header(request.headers, "content-type") ?? "")) {
        return { status: 415, body: { apiVersion: "1.0", error: "unsupported_media_type" } };
      }
      if (byteLength(request.body) > (options.maxBodyBytes ?? 2_097_152)) {
        return { status: 413, body: { apiVersion: "1.0", error: "payload_too_large" } };
      }
      const timestampHeader = header(request.headers, "x-webhook-timestamp");
      const eventId = header(request.headers, "x-webhook-id");
      const provider = webhookMatch[1]!;
      const now = options.now();
      if (!timestampHeader || !/^\d{1,12}$/.test(timestampHeader) || !eventId || !idempotencyPattern.test(eventId)) {
        return { status: 401, body: { apiVersion: "1.0", error: "invalid_webhook_authentication" } };
      }
      const timestampMs = Number(timestampHeader) * 1000;
      if (!Number.isSafeInteger(timestampMs) || Math.abs(now.getTime() - timestampMs) > (options.webhookMaxSkewMs ?? 300_000)) {
        return { status: 401, body: { apiVersion: "1.0", error: "stale_webhook" } };
      }
      const content = rawBody(request.body);
      const secret = await options.resolveWebhookSecret(provider);
      if (!content || !secret || !verifiedSignature(header(request.headers, "x-webhook-signature"), secret, `${timestampHeader}.${content}`)) {
        return { status: 401, body: { apiVersion: "1.0", error: "invalid_webhook_signature" } };
      }
      const body = parseObjectBody(content);
      if (!body || !exactObject(body, ["eventType", "payload"]) || typeof body.eventType !== "string" || body.eventType.length < 1
        || body.eventType.length > 100 || !isObject(body.payload)) return jsonError("Webhook envelope is invalid.");
      const budgetError = jsonBudgetError(body, { depth: options.maxJsonDepth ?? 32, arrays: options.maxArrayItems ?? 10_000,
        fields: options.maxObjectFields ?? 1_000, stringBytes: options.maxStringBytes ?? 65_536 });
      if (budgetError) return jsonError(budgetError);
      const replayKey = `${options.tenantId}:${provider}:${eventId}`;
      const expiresAtMs = now.getTime() + (options.webhookReplayTtlMs ?? 86_400_000);
      if (!await options.webhookReplayStore.claim({ key: replayKey, nowMs: now.getTime(), expiresAtMs })) {
        return { status: 409, body: { apiVersion: "1.0", error: "webhook_replay" } };
      }
      try {
        await options.receiveWebhook({ tenantId: options.tenantId, provider, eventId, eventType: body.eventType,
          payload: body.payload, receivedAt: now.toISOString() });
        await options.webhookReplayStore.complete({ key: replayKey, expiresAtMs });
        return { status: 202, body: { apiVersion: "1.0", status: "ACCEPTED", eventId } };
      } catch {
        await options.webhookReplayStore.release({ key: replayKey, expiresAtMs });
        return { status: 503, body: { apiVersion: "1.0", error: "webhook_delivery_unavailable" } };
      }
    }
    const match = /^\/v1\/organizations\/([^/]+)\/(dashboard|commands)$/.exec(request.path);
    if (!match) return { status: 404, body: { apiVersion: "1.0", error: "not_found" } };
    if (!request.principal) return { status: 401, body: { apiVersion: "1.0", error: "unauthenticated" } };
    const pathTenant = decodeURIComponent(match[1]!);
    if (pathTenant !== options.tenantId || request.principal.organizationId !== options.tenantId) {
      return { status: 403, body: { apiVersion: "1.0", error: "tenant_mismatch" } };
    }
    if (!identifier(request.principal.userId)) return { status: 401, body: { apiVersion: "1.0", error: "invalid_principal" } };
    const rate = await options.rateLimitStore.consume({ key: `${options.tenantId}:${request.principal.userId}`,
      limit: options.principalLimit ?? 120, windowMs: options.principalWindowMs ?? 60_000, nowMs: options.now().getTime() });
    if (!rate.allowed) return { status: 429, headers: { "retry-after": String(rate.retryAfterSeconds) },
      body: { apiVersion: "1.0", error: "rate_limited" } };
    if (request.method === "POST") {
      if (!jsonContentType.test(header(request.headers, "content-type") ?? "")) {
        return { status: 415, body: { apiVersion: "1.0", error: "unsupported_media_type" } };
      }
      if (byteLength(request.body) > (options.maxBodyBytes ?? 2_097_152)) {
        return { status: 413, body: { apiVersion: "1.0", error: "payload_too_large" } };
      }
      const idempotencyKey = header(request.headers, "idempotency-key");
      if (!idempotencyKey || !idempotencyPattern.test(idempotencyKey)) return jsonError("A valid Idempotency-Key is required.");
      const body = parseObjectBody(request.body);
      if (!body) return jsonError("A JSON object body is required.");
      const budgetError = jsonBudgetError(body, { depth: options.maxJsonDepth ?? 32, arrays: options.maxArrayItems ?? 10_000,
        fields: options.maxObjectFields ?? 1_000, stringBytes: options.maxStringBytes ?? 65_536 });
      if (budgetError) return jsonError(budgetError);
      if (Object.keys(body).some((key) => authorityFields.has(key))) return jsonError("Identity, tenancy, and audit fields are server controlled.");
      const validationError = validateCommand(body);
      if (validationError) return jsonError(validationError);
      return options.delegate.handle({ method: "POST", path: request.path, principal: request.principal,
        idempotencyKey, body });
    }
    return options.delegate.handle({ method: "GET", path: request.path, principal: request.principal });
  } };
}
