import { pathToFileURL } from "node:url";
import type { IncomingMessage } from "node:http";
import type { AuthoritativePublicationArtifactResolver, PlatformApiPrincipal, PostgresEventStore,
  ProductionReadinessReport } from "@tournament-os/competition-engine";
import type { ProductionPilotApiOptions } from "./production-pilot-api.js";
import { createProductionRuntime, type ProductionRuntime } from "./production-runtime.js";

export interface ProductionHostConfiguration {
  readonly tenantId: string;
  readonly adapterModule: string;
  readonly port: number;
  readonly host: string;
}

export interface ProductionAdapters {
  readonly store?: PostgresEventStore;
  readonly connectionString?: string;
  readonly authenticate: (request: IncomingMessage) => PlatformApiPrincipal | null | Promise<PlatformApiPrincipal | null>;
  readonly publicationArtifacts: AuthoritativePublicationArtifactResolver;
  readonly pilotApi: Omit<ProductionPilotApiOptions, "tenantId" | "delegate">;
  readonly readiness: () => Readonly<ProductionReadinessReport> | Promise<Readonly<ProductionReadinessReport>>;
  close?(): Promise<void>;
}

export interface ProductionAdapterModule {
  createProductionAdapters(input: { readonly tenantId: string }): ProductionAdapters | Promise<ProductionAdapters>;
}

export interface ProductionHost {
  readonly configuration: Readonly<ProductionHostConfiguration>;
  readonly runtime: ProductionRuntime;
  close(): Promise<void>;
}

const tenantPattern = /^[a-z0-9][a-z0-9._-]{1,99}$/;
const boundedText = (value: string | undefined, maximum: number): value is string =>
  Boolean(value && value.length <= maximum && !/[\s\u0000-\u001f]/.test(value));

/** Parses non-secret bootstrap configuration. Provider credentials belong inside the adapter's secret-manager boundary. */
export function parseProductionHostConfiguration(env: Readonly<Record<string, string | undefined>>): Readonly<ProductionHostConfiguration> {
  if (env.NODE_ENV !== "production") throw new Error("NODE_ENV must be production");
  if (!tenantPattern.test(env.KREATEASY_TENANT_ID ?? "")) throw new Error("KREATEASY_TENANT_ID is invalid");
  if (!boundedText(env.KREATEASY_ADAPTER_MODULE, 1_024)) throw new Error("KREATEASY_ADAPTER_MODULE is required and invalid");
  if (env.KREATEASY_AUTO_MIGRATE && env.KREATEASY_AUTO_MIGRATE !== "false") {
    throw new Error("KREATEASY_AUTO_MIGRATE is forbidden; run forward migrations with the release identity");
  }
  const port = Number(env.PORT ?? "4173");
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) throw new Error("PORT is invalid");
  const host = env.HOST ?? "0.0.0.0";
  if (!host.trim() || host.length > 253 || /[\u0000-\u001f]/.test(host)) throw new Error("HOST is invalid");
  return Object.freeze({ tenantId: env.KREATEASY_TENANT_ID!, adapterModule: env.KREATEASY_ADAPTER_MODULE!, port, host });
}

export async function loadProductionHost(options: {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly importAdapter?: (specifier: string) => Promise<unknown>;
} = {}): Promise<ProductionHost> {
  const configuration = parseProductionHostConfiguration(options.env ?? process.env);
  const imported = await (options.importAdapter ?? ((specifier: string) => import(specifier)))(configuration.adapterModule);
  const factory = imported && typeof imported === "object"
    ? (imported as { createProductionAdapters?: unknown }).createProductionAdapters : undefined;
  if (typeof factory !== "function") throw new Error("Production adapter module must export createProductionAdapters");
  const adapters = await (factory as ProductionAdapterModule["createProductionAdapters"])({ tenantId: configuration.tenantId });
  if (!adapters || typeof adapters !== "object" || typeof adapters.authenticate !== "function") {
    throw new Error("Production adapter must provide an authenticate function");
  }
  if (typeof adapters.readiness !== "function") throw new Error("Production adapter must provide a readiness function");
  if (!adapters.pilotApi || typeof adapters.pilotApi !== "object") throw new Error("Production adapter must provide pilot API dependencies");
  if (!adapters.publicationArtifacts || typeof adapters.publicationArtifacts.load !== "function") {
    throw new Error("Production adapter must provide an authoritative publication artifact resolver");
  }
  if (adapters.close !== undefined && typeof adapters.close !== "function") throw new Error("Production adapter close hook is invalid");
  if (adapters.connectionString !== undefined && !adapters.connectionString.trim()) {
    throw new Error("Production adapter connection string is invalid");
  }
  if (!adapters.store && !adapters.connectionString) {
    throw new Error("Production adapter must provide an explicit PostgreSQL store or connection string");
  }
  const runtime = createProductionRuntime({ tenantId: configuration.tenantId, authenticate: adapters.authenticate,
    pilotApi: adapters.pilotApi, publicationArtifacts: adapters.publicationArtifacts, readiness: adapters.readiness,
    ...(adapters.store ? { store: adapters.store } : { connectionString: adapters.connectionString! }) });
  let closePromise: Promise<void> | undefined;
  const close = (): Promise<void> => closePromise ??= (async () => {
    try { await runtime.close(); } finally { await adapters.close?.(); }
  })();
  return Object.freeze({ configuration, runtime, close });
}

export async function startProductionHost(env: Readonly<Record<string, string | undefined>> = process.env): Promise<ProductionHost> {
  const host = await loadProductionHost({ env });
  await new Promise<void>((resolve, reject) => {
    host.runtime.server.once("error", reject);
    host.runtime.server.listen(host.configuration.port, host.configuration.host, () => {
      host.runtime.server.off("error", reject);
      resolve();
    });
  });
  const shutdown = (signal: string) => {
    void host.close().then(() => {
      process.stdout.write(`${JSON.stringify({ event: "production_host_stopped", signal })}\n`);
      process.exitCode = 0;
    }, () => { process.exitCode = 1; });
  };
  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.once("SIGINT", () => shutdown("SIGINT"));
  process.stdout.write(`${JSON.stringify({ event: "production_host_started", host: host.configuration.host,
    port: host.configuration.port, tenantId: host.configuration.tenantId })}\n`);
  return host;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startProductionHost().catch((error: unknown) => {
    const code = error instanceof Error && /configuration|NODE_ENV|KREATEASY_|adapter|PostgreSQL/.test(error.message)
      ? "PRODUCTION_CONFIGURATION_INVALID" : "PRODUCTION_START_FAILED";
    process.stderr.write(`${JSON.stringify({ event: "production_host_failed", code })}\n`);
    process.exitCode = 1;
  });
}
