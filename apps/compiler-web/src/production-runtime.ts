import type { IncomingMessage, Server } from "node:http";
import {
  createOrganizationPlatform,
  createOrganizationPlatformApi,
  createPostgresEventStore,
  createLivenessReport,
  POSTGRES_EVENT_STORE_SCHEMA_VERSION,
  type OrganizationPlatform,
  type OrganizationPlatformApi,
  type PlatformApiPrincipal,
  type PostgresEventStore,
  type ProductionReadinessReport,
} from "@tournament-os/competition-engine";
import { createProductionPilotApi, type ProductionPilotApiOptions } from "./production-pilot-api.js";
import { createCompilerServer } from "./server.js";

export interface ProductionRuntimeOptions {
  readonly tenantId: string;
  readonly authenticate: (request: IncomingMessage) => PlatformApiPrincipal | null | Promise<PlatformApiPrincipal | null>;
  readonly store?: PostgresEventStore;
  readonly connectionString?: string;
  readonly applicationName?: string;
  readonly now?: () => string;
  readonly pilotApi: Omit<ProductionPilotApiOptions, "tenantId" | "delegate">;
  readonly readiness: () => Readonly<ProductionReadinessReport> | Promise<Readonly<ProductionReadinessReport>>;
  readonly http?: {
    readonly requestTimeoutMs?: number;
    readonly headersTimeoutMs?: number;
    readonly keepAliveTimeoutMs?: number;
    readonly maxRequestsPerSocket?: number;
  };
}

export interface ProductionRuntime {
  readonly server: Server;
  readonly store: PostgresEventStore;
  readonly platform: OrganizationPlatform;
  readonly api: OrganizationPlatformApi;
  readonly authenticate: (request: IncomingMessage) => Promise<PlatformApiPrincipal | null>;
  migrate(): Promise<void>;
  close(): Promise<void>;
}

const tenantPattern = /^[a-z0-9][a-z0-9._-]{1,99}$/;

function boundedInteger(name: string, value: number, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

/**
 * Composes the production persistence, identity and HTTP boundaries without
 * owning deployment credentials or silently applying schema migrations.
 */
export function createProductionRuntime(options: ProductionRuntimeOptions): ProductionRuntime {
  if (!tenantPattern.test(options.tenantId)) throw new Error("tenantId is invalid");
  if (!options.store && !options.connectionString) throw new Error("Production requires an explicit PostgreSQL store or connection string");
  const store = options.store ?? createPostgresEventStore({ tenantId: options.tenantId,
    ...(options.connectionString ? { connectionString: options.connectionString } : {}),
    ...(options.applicationName ? { applicationName: options.applicationName } : {}) });
  if (!store.capabilities || store.capabilities.durability !== "TRANSACTIONAL_POSTGRES" || store.capabilities.tenantIsolation !== "FORCED_RLS"
    || !store.capabilities.multiProcessAtomicity) throw new Error("Production requires a transactional PostgreSQL store with forced tenant RLS");
  if (store.capabilities.schemaVersion !== POSTGRES_EVENT_STORE_SCHEMA_VERSION) {
    throw new Error(`Production requires PostgreSQL schema ${POSTGRES_EVENT_STORE_SCHEMA_VERSION}`);
  }
  const authenticate = async (request: IncomingMessage): Promise<PlatformApiPrincipal | null> => {
    const principal = await options.authenticate(request);
    if (!principal || principal.organizationId !== options.tenantId || !principal.userId.trim()) return null;
    return principal;
  };
  const now = options.now ?? (() => new Date().toISOString());
  const startedAt = now();
  const platform = createOrganizationPlatform(store);
  const api = createOrganizationPlatformApi({ platform, now });
  const productionPilotApi = createProductionPilotApi({ ...options.pilotApi, tenantId: options.tenantId, delegate: api,
    requireDistributedStores: true });
  const server = createCompilerServer({ production: true, platformApi: api, productionPilotApi,
    ...(options.pilotApi.maxBodyBytes === undefined ? {} : { maximumRequestBodyBytes: options.pilotApi.maxBodyBytes }),
    productionReadiness: options.readiness, productionLiveness: () => createLivenessReport(startedAt, now()),
    authenticatePlatform: authenticate,
    authorize: async (request) => (await authenticate(request)) !== null });
  const requestTimeout = boundedInteger("requestTimeoutMs", options.http?.requestTimeoutMs ?? 30_000, 1_000, 300_000);
  const headersTimeout = boundedInteger("headersTimeoutMs", options.http?.headersTimeoutMs ?? 15_000, 1_000, requestTimeout);
  server.requestTimeout = requestTimeout;
  server.headersTimeout = headersTimeout;
  server.keepAliveTimeout = boundedInteger("keepAliveTimeoutMs", options.http?.keepAliveTimeoutMs ?? 5_000, 500, 60_000);
  server.maxRequestsPerSocket = boundedInteger("maxRequestsPerSocket", options.http?.maxRequestsPerSocket ?? 1_000, 1, 10_000);

  let closePromise: Promise<void> | undefined;
  const close = (): Promise<void> => closePromise ??= (async () => {
    if (server.listening) {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
    await store.close();
  })();
  return { server, store, platform, api, authenticate, migrate: () => store.migrate(), close };
}
