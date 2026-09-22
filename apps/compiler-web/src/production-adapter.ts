import { Pool } from "pg";
import {
  assessProductionReadiness,
  createPostgresEventStore,
  type ProductionProbe,
  type ProductionReadinessReport,
} from "@tournament-os/competition-engine";
import type { ProductionAdapters } from "./production-host.js";
import { createClerkPlatformAuthenticator } from "./clerk-authentication.js";
import { createPostgresProductionCoordination } from "./postgres-production-coordination.js";
import { createR2PublicationArtifactStore } from "./r2-publication-artifacts.js";

interface MinimalPool {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(text: string, values?: readonly unknown[]):
    Promise<{ rows: Row[]; rowCount: number | null }>;
  connect(): Promise<{ query(text: string, values?: readonly unknown[]): Promise<unknown>; release(): void }>;
  end(): Promise<void>;
}

export interface ProductionAdapterDependencies {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly pool?: MinimalPool;
  readonly now?: () => Date;
}

function requireEnv(env: Readonly<Record<string, string | undefined>>, name: string): string {
  const value = env[name];
  if (!value || !value.trim()) throw new Error(`${name} is required`);
  return value;
}

/**
 * The real deployment adapter for the API server: wires the Postgres event
 * store + RLS coordination, Clerk identity and R2 publication artifacts
 * this codebase actually implements behind the `ProductionAdapters`
 * contract `production-host.ts` requires. Delivery (Resend) runs in a
 * separate worker process against the same database -- see
 * outbox-worker-host.ts -- because `ProductionAdapters` has no slot for
 * per-topic delivery providers; they belong to the outbox worker, not the
 * request-serving API.
 *
 * Two mandatory readiness probes -- `kms-provider` and `secret-provider` --
 * are honestly reported UNHEALTHY: secrets are read from the process
 * environment, not a managed key/secret store, and no such integration
 * exists yet. `outbox-worker` is also reported UNHEALTHY because this
 * factory does not start a delivery-worker process; one must be run
 * separately (see createOutboxDeliveryWorker) and its own liveness wired
 * into a real probe before this can honestly report READY. Reporting these
 * as HEALTHY without the underlying capability would be exactly the kind
 * of unearned claim this codebase's own design principles forbid.
 */
export async function createProductionAdapters(
  input: { readonly tenantId: string },
  dependencies: ProductionAdapterDependencies = {},
): Promise<ProductionAdapters> {
  const env = dependencies.env ?? process.env;
  const now = dependencies.now ?? (() => new Date());
  const connectionString = requireEnv(env, "DATABASE_URL");
  const coordinationKeyHashSecret = requireEnv(env, "COORDINATION_KEY_HASH_SECRET");
  const clerkSecretKey = requireEnv(env, "CLERK_SECRET_KEY");
  const r2AccountId = requireEnv(env, "R2_ACCOUNT_ID");
  const r2AccessKeyId = requireEnv(env, "R2_ACCESS_KEY_ID");
  const r2SecretAccessKey = requireEnv(env, "R2_SECRET_ACCESS_KEY");
  const r2Bucket = requireEnv(env, "R2_PUBLICATION_ARTIFACTS_BUCKET");

  const pool = dependencies.pool ?? (new Pool({ connectionString, application_name: "krateasy-production" }) as unknown as MinimalPool);
  const store = createPostgresEventStore({ tenantId: input.tenantId, pool: pool as never });
  const coordination = createPostgresProductionCoordination({ tenantId: input.tenantId, pool: pool as never,
    keyHashSecret: coordinationKeyHashSecret });
  const authenticate = createClerkPlatformAuthenticator({ secretKey: clerkSecretKey });
  const publicationArtifacts = createR2PublicationArtifactStore({ bucket: r2Bucket, accountId: r2AccountId,
    accessKeyId: r2AccessKeyId, secretAccessKey: r2SecretAccessKey });
  // Delivery (Resend) is a separate worker process against the same
  // database, not an API-server dependency -- see outbox-worker-host.ts.

  const readiness = async (): Promise<Readonly<ProductionReadinessReport>> => {
    const observedAt = now().toISOString();
    const checks: ProductionProbe[] = [];
    try {
      await pool.query("SELECT 1");
      checks.push({ name: "database", required: true, status: "HEALTHY", observedAt });
      checks.push({ name: "event-ledger", required: true, status: "HEALTHY", observedAt });
    } catch (error) {
      const detail = error instanceof Error ? error.message : "database is unreachable";
      checks.push({ name: "database", required: true, status: "UNHEALTHY", observedAt, detail });
      checks.push({ name: "event-ledger", required: true, status: "UNHEALTHY", observedAt, detail: "database is unreachable" });
    }
    checks.push({ name: "identity-provider", required: true, status: "HEALTHY", observedAt,
      detail: "Clerk secret key is configured" });
    checks.push({ name: "kms-provider", required: true, status: "UNHEALTHY", observedAt,
      detail: "No key-management/secrets-manager integration exists; secrets are read from the process environment" });
    checks.push({ name: "secret-provider", required: true, status: "UNHEALTHY", observedAt,
      detail: "No managed secret provider is wired; this is the same gap as kms-provider" });
    checks.push({ name: "outbox-worker", required: true, status: "UNHEALTHY", observedAt,
      detail: "No outbox delivery worker process is running for this deployment" });
    return assessProductionReadiness(checks, { checkedAt: observedAt, maximumEvidenceAgeMs: 5_000 });
  };

  return {
    store,
    authenticate,
    publicationArtifacts,
    pilotApi: {
      now,
      rateLimitStore: coordination.rateLimitStore,
      webhookReplayStore: coordination.webhookReplayStore,
      // No inbound webhook provider is configured yet, so every provider name
      // resolves to no secret and production-pilot-api rejects the request
      // (401) before receiveWebhook could ever run -- see its webhook branch.
      resolveWebhookSecret: async () => null,
      receiveWebhook: async () => { throw new Error("receiveWebhook is unreachable while resolveWebhookSecret always returns null"); },
      requireDistributedStores: true,
    },
    readiness,
    close: async () => { await store.close(); await coordination.close(); await pool.end(); },
  };
}
