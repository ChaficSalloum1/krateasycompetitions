import { createHash } from "node:crypto";

export interface AdjudicationPolicy { withdrawal?: "AWARD_WALKOVER" | "VOID_CONTEST"; }
interface DecidedOutcome {
  status: "COMPLETED" | "WALKOVER"; entrants: readonly [string, string]; winnerId: string; loserId: string;
  score: readonly [number, number] | null;
}
export interface VoidedOutcome { status: "VOIDED"; entrants: readonly [string, string]; }
export type AdjudicatedOutcome = DecidedOutcome | VoidedOutcome;

export interface AdjudicationEvent {
  readonly eventId: string; readonly sequence: number; readonly previousEventHash: string | null; readonly eventHash: string;
  readonly kind: "RESULT_RECORDED" | "WALKOVER_RECORDED" | "WITHDRAWAL_ADJUDICATED" | "RESULT_CORRECTED" | "RESULT_VOIDED";
  readonly contestId: string; readonly actorId: string; readonly recordedAt: string; readonly reason: string;
  readonly supersedesEventId?: string; readonly outcome: AdjudicatedOutcome; readonly evidence: readonly string[];
}
export interface AdjudicationLedger { readonly policy: Readonly<AdjudicationPolicy>; readonly events: readonly Readonly<AdjudicationEvent>[]; }

interface AuditFields { contestId: string; actorId: string; recordedAt: string; reason: string; }
interface ResultFields { entrants: readonly [string, string]; winnerId: string; score: readonly [number, number]; }
export type AdjudicationCommand =
  | (AuditFields & ResultFields & { kind: "RECORD_RESULT" })
  | (AuditFields & { kind: "RECORD_WALKOVER"; entrants: readonly [string, string]; absentEntrantId: string })
  | (AuditFields & { kind: "ADJUDICATE_WITHDRAWAL"; entrants: readonly [string, string]; withdrawnEntrantId: string })
  | (AuditFields & ResultFields & { kind: "CORRECT_RESULT"; supersedesEventId: string })
  | (AuditFields & { kind: "VOID_RESULT"; supersedesEventId: string });
export interface LedgerFinding { code: "HASH_MISMATCH" | "BROKEN_CHAIN" | "BROKEN_LINEAGE"; eventId: string; message: string; }
export interface LedgerProof { valid: boolean; eventCount: number; ledgerHash: string; findings: readonly LedgerFinding[]; }

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(",")}}`;
  return JSON.stringify(value);
}
function hash(value: unknown): string { return createHash("sha256").update(canonical(value)).digest("hex"); }
function deepFreeze<T>(value: T): Readonly<T> {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
function currentEvent(ledger: AdjudicationLedger, contestId: string): Readonly<AdjudicationEvent> | undefined {
  for (let index = ledger.events.length - 1; index >= 0; index -= 1) {
    const event = ledger.events[index];
    if (event?.contestId === contestId) return event;
  }
  return undefined;
}
function validateAudit(command: AdjudicationCommand): void {
  if (!command.actorId.trim() || !command.reason.trim() || !command.contestId.trim() || !Number.isFinite(Date.parse(command.recordedAt))) {
    throw new Error("Adjudication requires a contest, actor, reason, and valid timestamp");
  }
}
function resultOutcome(fields: ResultFields): DecidedOutcome {
  const [left, right] = fields.entrants;
  if (!left || !right || left === right || !fields.entrants.includes(fields.winnerId)) throw new Error("Result entrants and winner are invalid");
  if (fields.score.some((score) => !Number.isFinite(score) || score < 0)) throw new Error("Scores must be finite non-negative numbers");
  return { status: "COMPLETED", entrants: [left, right], winnerId: fields.winnerId,
    loserId: fields.winnerId === left ? right : left, score: [...fields.score] as [number, number] };
}
function opposingOutcome(entrants: readonly [string, string], unavailableId: string): DecidedOutcome {
  const [left, right] = entrants;
  if (!left || !right || left === right || !entrants.includes(unavailableId)) throw new Error("Unavailable entrant is not a valid contest entrant");
  const winnerId = unavailableId === left ? right : left;
  return { status: "WALKOVER", entrants: [left, right], winnerId, loserId: unavailableId, score: null };
}
function hashEvent(event: Omit<AdjudicationEvent, "eventHash">): string { return hash(event); }

export function createAdjudicationLedger(policy: AdjudicationPolicy): AdjudicationLedger {
  return deepFreeze({ policy: structuredClone(policy), events: [] });
}

export function appendAdjudication(ledger: AdjudicationLedger, command: AdjudicationCommand): AdjudicationLedger {
  validateAudit(command);
  const prior = currentEvent(ledger, command.contestId);
  const isRevision = command.kind === "CORRECT_RESULT" || command.kind === "VOID_RESULT";
  if (!isRevision && prior) throw new Error("Contest already has effective truth; append an audited correction instead");
  if (isRevision && (!prior || prior.eventId !== command.supersedesEventId)) throw new Error("Correction or void must supersede the current effective event");
  if (command.kind === "ADJUDICATE_WITHDRAWAL" && !ledger.policy.withdrawal) {
    throw new Error("Ambiguous withdrawal policy: explicitly choose AWARD_WALKOVER or VOID_CONTEST");
  }

  let kind: AdjudicationEvent["kind"]; let outcome: AdjudicatedOutcome; let evidence: string[];
  if (command.kind === "RECORD_RESULT" || command.kind === "CORRECT_RESULT") {
    kind = command.kind === "RECORD_RESULT" ? "RESULT_RECORDED" : "RESULT_CORRECTED";
    outcome = resultOutcome(command); evidence = ["winner-is-a-contest-entrant", "loser-derived-from-opposing-slot", "score-is-non-negative"];
  } else if (command.kind === "VOID_RESULT") {
    kind = "RESULT_VOIDED"; outcome = { status: "VOIDED", entrants: [...prior!.outcome.entrants] as [string, string] };
    evidence = ["superseded-event-was-current", "void-reason-recorded"];
  } else if (command.kind === "RECORD_WALKOVER") {
    kind = "WALKOVER_RECORDED"; outcome = opposingOutcome(command.entrants, command.absentEntrantId);
    evidence = ["absent-entrant-is-a-contest-entrant", "winner-derived-from-opposing-slot", "walkover-is-scoreless"];
  } else {
    kind = "WITHDRAWAL_ADJUDICATED";
    const walkover = opposingOutcome(command.entrants, command.withdrawnEntrantId);
    outcome = ledger.policy.withdrawal === "VOID_CONTEST" ? { status: "VOIDED", entrants: walkover.entrants } : walkover;
    evidence = [`withdrawal-policy:${ledger.policy.withdrawal}`, "withdrawn-entrant-is-a-contest-entrant", "outcome-derived-from-pinned-policy"];
  }
  const base = {
    sequence: ledger.events.length + 1, previousEventHash: ledger.events.at(-1)?.eventHash ?? null, kind,
    contestId: command.contestId, actorId: command.actorId, recordedAt: command.recordedAt, reason: command.reason,
    ...(isRevision ? { supersedesEventId: command.supersedesEventId } : {}), outcome, evidence,
  };
  const eventId = `adj_${hash(base).slice(0, 24)}`;
  const withoutHash = { ...base, eventId };
  const event: AdjudicationEvent = { ...withoutHash, eventHash: hashEvent(withoutHash) };
  return deepFreeze({ policy: structuredClone(ledger.policy), events: [...ledger.events, event] });
}

export function effectiveOutcome(ledger: AdjudicationLedger, contestId: string): AdjudicatedOutcome | undefined {
  return currentEvent(ledger, contestId)?.outcome;
}

export function verifyAdjudicationLedger(ledger: AdjudicationLedger): LedgerProof {
  const findings: LedgerFinding[] = []; const seen = new Set<string>();
  ledger.events.forEach((event, index) => {
    const { eventHash, ...withoutHash } = event;
    if (eventHash !== hashEvent(withoutHash)) findings.push({ code: "HASH_MISMATCH", eventId: event.eventId, message: "Event content does not match its proof hash." });
    const expectedPrevious = index === 0 ? null : ledger.events[index - 1]!.eventHash;
    if (event.sequence !== index + 1 || event.previousEventHash !== expectedPrevious) findings.push({ code: "BROKEN_CHAIN", eventId: event.eventId, message: "Event sequence or previous hash is invalid." });
    if (event.supersedesEventId && !seen.has(event.supersedesEventId)) findings.push({ code: "BROKEN_LINEAGE", eventId: event.eventId, message: "Superseded event is absent or occurs later in the ledger." });
    seen.add(event.eventId);
  });
  return deepFreeze({ valid: findings.length === 0, eventCount: ledger.events.length,
    ledgerHash: hash({ policy: ledger.policy, events: ledger.events }), findings });
}
