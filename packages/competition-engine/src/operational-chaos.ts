import { canonicalHash, deepFreeze } from "@tournament-os/tournament-schema";
import type { ClaimOutboxOptions, LeaseMutationOptions, OutboxMessage } from "./outbox.js";

export interface OperationalOutboxStore {
  claim(options: ClaimOutboxOptions): readonly Readonly<OutboxMessage>[] | Promise<readonly Readonly<OutboxMessage>[]>;
  acknowledge(options: LeaseMutationOptions): Readonly<OutboxMessage> | Promise<Readonly<OutboxMessage>>;
  recoverExpiredLeases(now: string): number | Promise<number>;
  list(): readonly Readonly<OutboxMessage>[] | Promise<readonly Readonly<OutboxMessage>[]>;
}

export interface DeliveryAttempt {
  readonly idempotencyKey: string;
  readonly topic: string;
  readonly publicationKey: string;
  readonly payload: unknown;
}

export interface DeliveryReceipt {
  readonly status: "ACCEPTED" | "DUPLICATE";
  readonly providerDeliveryId: string;
}

export interface IdempotentDeliveryProvider {
  deliver(attempt: DeliveryAttempt): Promise<Readonly<DeliveryReceipt>>;
}

export interface OutboxCrashRecoveryDrillInput {
  readonly store: OperationalOutboxStore;
  readonly provider: IdempotentDeliveryProvider;
  readonly firstWorkerId: string;
  readonly recoveryWorkerId: string;
  readonly claimedAt: string;
  readonly recoveredAt: string;
  readonly leaseMs: number;
}

export interface OutboxCrashRecoveryDrillReport {
  readonly status: "VERIFIED" | "FAILED";
  readonly messageId: string | null;
  readonly attempts: number;
  readonly providerEffects: number;
  readonly finalOutboxStatus: OutboxMessage["status"] | null;
  readonly issues: readonly string[];
  readonly qualification: "CONTROLLED_CRASH_DRILL_NOT_PROVIDER_SLA_EVIDENCE";
  readonly proofHash: string;
}

function time(value: string, label: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) throw new Error(`${label} must be a canonical timestamp`);
  return parsed;
}

/**
 * Simulates the hardest outbox boundary: the provider accepted a delivery but the
 * worker crashed before acknowledgement. A pass requires provider-level idempotency.
 */
export async function runOutboxCrashRecoveryDrill(input: OutboxCrashRecoveryDrillInput): Promise<Readonly<OutboxCrashRecoveryDrillReport>> {
  const claimedAt = time(input.claimedAt, "claimedAt");
  const recoveredAt = time(input.recoveredAt, "recoveredAt");
  if (!input.firstWorkerId.trim() || !input.recoveryWorkerId.trim() || input.firstWorkerId === input.recoveryWorkerId) {
    throw new Error("Crash drills require two distinct worker identities");
  }
  if (!Number.isSafeInteger(input.leaseMs) || input.leaseMs <= 0 || recoveredAt < claimedAt + input.leaseMs) {
    throw new Error("Crash recovery must occur at or after a positive lease expiry");
  }
  const issues: string[] = [];
  const firstClaim = await input.store.claim({ workerId: input.firstWorkerId, now: input.claimedAt, leaseMs: input.leaseMs, limit: 1 });
  const message = firstClaim[0];
  if (!message) return finish(null, 0, 0, null, ["No pending outbox message was available for the drill"]);
  const attempt = { idempotencyKey: message.dedupeKey, topic: message.topic, publicationKey: message.publicationKey, payload: message.payload };
  const firstReceipt = await input.provider.deliver(attempt);

  const recovered = await input.store.recoverExpiredLeases(input.recoveredAt);
  if (recovered !== 1) issues.push(`Expected one expired lease; recovered ${recovered}`);
  const secondClaim = await input.store.claim({ workerId: input.recoveryWorkerId, now: input.recoveredAt, leaseMs: input.leaseMs, limit: 1 });
  const replay = secondClaim[0];
  let secondReceipt: DeliveryReceipt | undefined;
  if (!replay || replay.id !== message.id) issues.push("Recovered worker did not reclaim the original message");
  else {
    secondReceipt = await input.provider.deliver({ idempotencyKey: replay.dedupeKey, topic: replay.topic, publicationKey: replay.publicationKey, payload: replay.payload });
    if (secondReceipt.status !== "DUPLICATE" || secondReceipt.providerDeliveryId !== firstReceipt.providerDeliveryId) {
      issues.push("Provider did not idempotently suppress the replayed external effect");
    }
    await input.store.acknowledge({ messageId: replay.id, workerId: input.recoveryWorkerId, now: input.recoveredAt });
  }
  const final = (await input.store.list()).find(({ id }) => id === message.id);
  if (final?.status !== "DELIVERED") issues.push("Recovered delivery was not acknowledged");
  const providerEffects = new Set([firstReceipt.providerDeliveryId, ...(secondReceipt ? [secondReceipt.providerDeliveryId] : [])]).size;
  return finish(message.id, final?.attempts ?? message.attempts, providerEffects, final?.status ?? null, issues);
}

function finish(
  messageId: string | null,
  attempts: number,
  providerEffects: number,
  finalOutboxStatus: OutboxMessage["status"] | null,
  issues: readonly string[],
): Readonly<OutboxCrashRecoveryDrillReport> {
  const base = {
    status: issues.length ? "FAILED" as const : "VERIFIED" as const,
    messageId,
    attempts,
    providerEffects,
    finalOutboxStatus,
    issues: [...issues].sort(),
    qualification: "CONTROLLED_CRASH_DRILL_NOT_PROVIDER_SLA_EVIDENCE" as const,
  };
  return deepFreeze({ ...base, proofHash: canonicalHash(base) });
}
