import { setTimeout as delay } from "node:timers/promises";
import { Pool } from "pg";
import { createOutboxDeliveryWorker, createPostgresEventStore, type DeliveryRunSummary } from "@tournament-os/competition-engine";
import { createResendDeliveryProvider } from "./resend-delivery-provider.js";

interface MinimalPool {
  connect(): Promise<{ query(text: string, values?: readonly unknown[]): Promise<unknown>; release(): void }>;
  end(): Promise<void>;
}

export interface OutboxWorkerDependencies {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly resolveRecipientEmail?: (payload: unknown) => Promise<string | null>;
  readonly pool?: MinimalPool;
}

function requireEnv(env: Readonly<Record<string, string | undefined>>, name: string): string {
  const value = env[name];
  if (!value || !value.trim()) throw new Error(`${name} is required`);
  return value;
}

/**
 * Boots the delivery worker this deployment's `outbox-worker` readiness
 * probe (see production-adapter.ts) refers to. It is a separate process
 * from the API server: outbox messages are queued transactionally by the
 * same Postgres event store the API writes to, and this worker drains them
 * against real providers on its own schedule.
 */
export async function createOutboxWorkerHost(
  input: { readonly tenantId: string; readonly workerId: string },
  dependencies: OutboxWorkerDependencies = {},
): Promise<{ runOnce(): Promise<Readonly<DeliveryRunSummary>>; close(): Promise<void> }> {
  const env = dependencies.env ?? process.env;
  const connectionString = requireEnv(env, "DATABASE_URL");
  const resendApiKey = requireEnv(env, "RESEND_API_KEY");
  const resendFromAddress = requireEnv(env, "RESEND_FROM_ADDRESS");

  const pool = dependencies.pool ?? new Pool({ connectionString, application_name: "krateasy-outbox-worker" });
  const store = createPostgresEventStore({ tenantId: input.tenantId, pool: pool as never });
  const emailProvider = createResendDeliveryProvider({
    apiKey: resendApiKey, fromAddress: resendFromAddress, topics: ["competition.participant-next.v1"],
    // No participant contact directory exists yet -- every delivery fails
    // closed with RECIPIENT_EMAIL_UNAVAILABLE (retryable: false) until one is
    // built. That is correct: it must never guess or fabricate an address.
    resolveRecipientEmail: dependencies.resolveRecipientEmail ?? (async () => null),
    renderEmail: (request) => ({ subject: "Krateasy Competitions update",
      text: `An update is available for competition ${request.tenantId}. Payload: ${JSON.stringify(request.payload)}` }),
  });
  const worker = createOutboxDeliveryWorker({ tenantId: input.tenantId, workerId: input.workerId,
    outbox: store.outbox, providers: [emailProvider],
    telemetry: { emit: (event) => { process.stdout.write(`${JSON.stringify({ event: "outbox_delivery_event", ...event })}\n`); } } });

  return { runOnce: () => worker.runOnce(), close: () => pool.end() };
}

if (process.argv[1]?.endsWith("outbox-worker-host.ts") || process.argv[1]?.endsWith("outbox-worker-host.js")) {
  const tenantId = process.env.KREATEASY_TENANT_ID;
  if (!tenantId) throw new Error("KREATEASY_TENANT_ID is required");
  const pollIntervalMs = Number(process.env.OUTBOX_WORKER_POLL_INTERVAL_MS ?? 5_000);
  const workerId = `outbox-worker-${process.pid}`;
  let stopping = false;
  process.once("SIGTERM", () => { stopping = true; });
  process.once("SIGINT", () => { stopping = true; });
  const host = await createOutboxWorkerHost({ tenantId, workerId });
  process.stdout.write(`${JSON.stringify({ event: "outbox_worker_started", tenantId, workerId })}\n`);
  while (!stopping) {
    const summary = await host.runOnce();
    if (summary.claimed > 0) process.stdout.write(`${JSON.stringify({ event: "outbox_worker_run", ...summary })}\n`);
    await delay(pollIntervalMs);
  }
  await host.close();
  process.stdout.write(`${JSON.stringify({ event: "outbox_worker_stopped" })}\n`);
}
