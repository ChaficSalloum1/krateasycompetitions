import { IdempotencyConflictError, OptimisticConcurrencyError } from "./event-store.js";
import type { OrganizationPlatform, OrganizationPlatformCommand } from "./platform.js";

export interface PlatformApiPrincipal { readonly organizationId: string; readonly userId: string }
export interface PlatformApiRequest { readonly method: "GET" | "POST"; readonly path: string; readonly principal: PlatformApiPrincipal | null;
  readonly idempotencyKey?: string; readonly body?: unknown }
export interface PlatformApiResponse { readonly status: 200 | 400 | 401 | 403 | 404 | 409 | 422 | 500;
  readonly body: unknown }
export interface OrganizationPlatformApi { handle(request: PlatformApiRequest): Promise<PlatformApiResponse> }

const API_VERSION = "1.0" as const;
const commandKey = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{2,199}$/;

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return keys.every((key) => key in value) && Object.keys(value).every((key) => allowed.has(key));
}

function failure(error: unknown): PlatformApiResponse {
  const message = error instanceof Error ? error.message : "Unknown platform error";
  if (error instanceof IdempotencyConflictError || error instanceof OptimisticConcurrencyError || /stale|already|transition|different active member/.test(message)) {
    return { status: 409, body: { apiVersion: API_VERSION, error: "conflict", message } };
  }
  if (/authority is required|not authorized|Active membership is required/.test(message)) {
    return { status: 403, body: { apiVersion: API_VERSION, error: "forbidden", message } };
  }
  return { status: 422, body: { apiVersion: API_VERSION, error: "invalid_command", message } };
}

export function createOrganizationPlatformApi(options: { readonly platform: OrganizationPlatform; readonly now: () => string }): OrganizationPlatformApi {
  return {
    handle: async (request) => {
      if (!request.principal) return { status: 401, body: { apiVersion: API_VERSION, error: "unauthenticated" } };
      const match = /^\/v1\/organizations\/([^/]+)\/(dashboard|commands|privacy\/([^/]+)|backup)$/.exec(request.path);
      if (!match) return { status: 404, body: { apiVersion: API_VERSION, error: "not_found" } };
      const organizationId = decodeURIComponent(match[1]!);
      if (organizationId !== request.principal.organizationId) return { status: 403, body: { apiVersion: API_VERSION, error: "tenant_mismatch" } };
      try {
        if (request.method === "GET" && match[2] === "dashboard") {
          return { status: 200, body: { apiVersion: API_VERSION, ...(await options.platform.dashboard(organizationId, request.principal.userId)) } };
        }
        if (request.method === "GET" && match[2]?.startsWith("privacy/")) {
          return { status: 200, body: { apiVersion: API_VERSION, ...(await options.platform.exportPrivacy(organizationId, request.principal.userId, decodeURIComponent(match[3]!))) } };
        }
        if (request.method === "GET" && match[2] === "backup") {
          return { status: 200, body: { apiVersion: API_VERSION, ...(await options.platform.exportBackup(organizationId, request.principal.userId)) } };
        }
        if (request.method !== "POST" || match[2] !== "commands") return { status: 404, body: { apiVersion: API_VERSION, error: "not_found" } };
        const body = record(request.body);
        if (!body || typeof body.kind !== "string" || !request.idempotencyKey || !commandKey.test(request.idempotencyKey)) {
          return { status: 400, body: { apiVersion: API_VERSION, error: "invalid_request", message: "Command body and Idempotency-Key are required." } };
        }
        if (["organizationId", "actorUserId", "commandId", "occurredAt"].some((key) => key in body)
          || ["CREATE_ORGANIZATION", "ACCEPT_INVITATION", "REQUEST_ACCOUNT_RECOVERY", "COMPLETE_ACCOUNT_RECOVERY"].includes(body.kind)) {
          return { status: 400, body: { apiVersion: API_VERSION, error: "authority_injection", message: "Identity and audit fields are server controlled." } };
        }
        if (body.kind === "CERTIFY_TOURNAMENT_PUBLICATION") {
          return { status: 400, body: { apiVersion: API_VERSION, error: "retired_command",
            message: "Publication certification is server-owned and atomic with PUBLISH_TOURNAMENT." } };
        }
        if (body.kind === "PUBLISH_TOURNAMENT" && (!exactKeys(body,
          ["kind", "tournamentId", "expectedTournamentRevision", "acknowledgedFindingCodes"])
          || typeof body.tournamentId !== "string"
          || !Number.isSafeInteger(body.expectedTournamentRevision)
          || (body.expectedTournamentRevision as number) < 1
          || !Array.isArray(body.acknowledgedFindingCodes)
          || body.acknowledgedFindingCodes.some((code) => typeof code !== "string"))) {
          return { status: 400, body: { apiVersion: API_VERSION, error: "invalid_request",
            message: "Publication accepts only tournamentId, expectedTournamentRevision, and acknowledgedFindingCodes." } };
        }
        const occurredAt = options.now();
        const supplied = structuredClone(body);
        if (body.kind === "APPLY_LIVE_OPERATION" || body.kind === "PROPOSE_LIVE_CHANGE") {
          const live = record(body.liveCommand);
          if (!live || ["actorId", "commandId", "occurredAt"].some((key) => key in live)) {
            return { status: 400, body: { apiVersion: API_VERSION, error: "authority_injection", message: "Live audit fields are server controlled." } };
          }
          supplied.liveCommand = { ...live, actorId: request.principal.userId,
            commandId: `${request.idempotencyKey}:${body.kind === "APPLY_LIVE_OPERATION" ? "live" : "live-change"}`, occurredAt };
        }
        const command = { ...supplied, organizationId, actorUserId: request.principal.userId,
          commandId: request.idempotencyKey, occurredAt } as unknown as OrganizationPlatformCommand;
        const state = await options.platform.execute(command);
        return { status: 200, body: { apiVersion: API_VERSION, organizationId, organizationVersion: state.version,
          commandId: request.idempotencyKey, status: "ACCEPTED" } };
      } catch (error) { return failure(error); }
    },
  };
}
