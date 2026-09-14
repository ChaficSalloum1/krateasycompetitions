import { createHash } from "node:crypto";

export type AttentionChannel = "WHATSAPP" | "EMAIL";
export type AttentionDeliveryStatus = "READY" | "SIMULATED_SENT" | "SIMULATED_FAILED" | "NO_CHANNEL";

export interface AttentionScheduleContest {
  readonly contestId: string;
  readonly resourceId: string;
  readonly start: string;
  readonly end: string;
  readonly possibleEntrantIds: readonly string[];
}

export interface AttentionParticipant {
  readonly id: string;
  readonly displayName: string;
  readonly token: string;
  readonly nextContestId: string | null;
  readonly matchCount: number;
  readonly delivery: {
    readonly channel: AttentionChannel | null;
    readonly status: AttentionDeliveryStatus;
    readonly lastAttemptAt: string | null;
    readonly message: string | null;
  };
}

export interface AttentionContest {
  readonly id: string;
  readonly title: string;
  readonly start: string;
  readonly end: string;
  readonly court: string;
  readonly participantIds: readonly string[];
  readonly participantNames: readonly string[];
  readonly state: "UP_NEXT" | "LATER" | "CALLED";
}

export interface ParticipantAttentionSnapshot {
  readonly apiVersion: "1.0";
  readonly mode: "DELIVERY_REHEARSAL";
  readonly competition: {
    readonly id: string;
    readonly name: string;
    readonly revision: number;
    readonly proofHash: string;
    readonly updatedAt: string;
  };
  readonly participants: readonly AttentionParticipant[];
  readonly contests: readonly AttentionContest[];
  readonly communicationSummary: {
    readonly ready: number;
    readonly simulatedSent: number;
    readonly simulatedFailed: number;
    readonly noChannel: number;
  };
  readonly rehearsalNotice: string;
}

export type ParticipantAttentionAction =
  | { readonly kind: "PREVIEW_NEXT"; readonly participantId: string; readonly channel: AttentionChannel }
  | { readonly kind: "SIMULATE_SUCCESS"; readonly participantId: string; readonly channel: AttentionChannel }
  | { readonly kind: "SIMULATE_FAILURE"; readonly participantId: string; readonly channel: AttentionChannel }
  | { readonly kind: "CALL_CONTEST"; readonly contestId: string }
  | { readonly kind: "RESET_REHEARSAL" };

interface MutableDelivery {
  channel: AttentionChannel | null;
  status: AttentionDeliveryStatus;
  lastAttemptAt: string | null;
  message: string | null;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(",")}}`;
  return JSON.stringify(value) ?? "undefined";
}

function proof(value: unknown): string {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

function words(value: string): string {
  return value.replaceAll("_", " ").replaceAll("-", " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function participantName(id: string): string {
  const pair = /^([^.]+)\.team\.(\d+)$/.exec(id);
  return pair ? `${words(pair[1]!)} Pair ${pair[2]}` : words(id.split(".").at(-1) ?? id);
}

function courtName(id: string): string {
  const court = /(?:court|courts)[. -]?(\d+)$/i.exec(id);
  return court ? `Court ${court[1]}` : words(id.split(".").at(-1) ?? id);
}

function contestName(id: string): string {
  const parts = id.split(".");
  const pool = parts.find((part) => /^P\d+$/i.test(part));
  const round = parts.find((part) => /^R\d+$/i.test(part));
  return pool && round
    ? `${words(parts[0]!)} · Pool ${pool.slice(1)} · Round ${round.slice(1)}`
    : parts.map(words).join(" · ");
}

function clock(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" })
    .format(new Date(iso));
}

function messageFor(participantId: string, contest: AttentionContest | undefined): string | null {
  if (!contest) return null;
  const opponent = contest.participantIds.find((id) => id !== participantId);
  const opponentName = opponent ? participantName(opponent) : "opponent to be confirmed";
  return `Play & Konnect: ${participantName(participantId)}, your next match is at ${clock(contest.start)} on ${contest.court} against ${opponentName}. Please be courtside 10 minutes early. Live details: /next`;
}

function exactIdentifier(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9][a-z0-9._-]{1,99}$/i.test(value);
}

export function parseParticipantAttentionAction(value: unknown): ParticipantAttentionAction | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (input.kind === "RESET_REHEARSAL" && Object.keys(input).length === 1) return { kind: input.kind };
  if (input.kind === "CALL_CONTEST" && Object.keys(input).length === 2 && exactIdentifier(input.contestId)) {
    return { kind: input.kind, contestId: input.contestId };
  }
  if (["PREVIEW_NEXT", "SIMULATE_SUCCESS", "SIMULATE_FAILURE"].includes(String(input.kind))
    && Object.keys(input).length === 3 && exactIdentifier(input.participantId)
    && (input.channel === "WHATSAPP" || input.channel === "EMAIL")) {
    return { kind: input.kind as "PREVIEW_NEXT" | "SIMULATE_SUCCESS" | "SIMULATE_FAILURE",
      participantId: input.participantId, channel: input.channel };
  }
  return null;
}

export interface ParticipantAttentionDemo {
  snapshot(): ParticipantAttentionSnapshot;
  perform(action: ParticipantAttentionAction): ParticipantAttentionSnapshot;
}

export function createParticipantAttentionDemo(input: {
  readonly competitionId: string;
  readonly competitionName: string;
  readonly revision: number;
  readonly certificationHash: string;
  readonly updatedAt: string;
  readonly contests: readonly AttentionScheduleContest[];
}): ParticipantAttentionDemo {
  const confirmed = input.contests
    .filter(({ possibleEntrantIds }) => possibleEntrantIds.length === 2)
    .sort((left, right) => Date.parse(left.start) - Date.parse(right.start)
      || left.resourceId.localeCompare(right.resourceId) || left.contestId.localeCompare(right.contestId));
  const participantIds = [...new Set(confirmed.flatMap(({ possibleEntrantIds }) => possibleEntrantIds))].sort();
  const delivery = new Map<string, MutableDelivery>();
  const calledContestIds = new Set<string>();

  const reset = (): void => {
    delivery.clear();
    calledContestIds.clear();
    participantIds.forEach((id, index) => delivery.set(id, {
      channel: index % 5 === 4 ? null : index % 4 === 3 ? "EMAIL" : "WHATSAPP",
      status: index % 5 === 4 ? "NO_CHANNEL" : index % 4 === 2 ? "SIMULATED_FAILED" : index % 4 === 1 ? "SIMULATED_SENT" : "READY",
      lastAttemptAt: index % 4 === 1 || index % 4 === 2 ? input.updatedAt : null,
      message: null,
    }));
  };

  const contests = (): AttentionContest[] => confirmed.map((contest, index) => ({
    id: contest.contestId,
    title: contestName(contest.contestId),
    start: contest.start,
    end: contest.end,
    court: courtName(contest.resourceId),
    participantIds: [...contest.possibleEntrantIds].sort(),
    participantNames: [...contest.possibleEntrantIds].sort().map(participantName),
    state: calledContestIds.has(contest.contestId) ? "CALLED" : index < 7 ? "UP_NEXT" : "LATER",
  }));

  const snapshot = (): ParticipantAttentionSnapshot => {
    const contestList = contests();
    const participants = participantIds.map((id): AttentionParticipant => {
      const participantContests = contestList.filter(({ participantIds: ids }) => ids.includes(id));
      const currentDelivery = delivery.get(id)!;
      return {
        id,
        displayName: participantName(id),
        token: proof({ competitionId: input.competitionId, participantId: id, purpose: "demo-participant-route" }).slice(0, 24),
        nextContestId: participantContests[0]?.id ?? null,
        matchCount: participantContests.length,
        delivery: { ...currentDelivery, message: currentDelivery.message ?? messageFor(id, participantContests[0]) },
      };
    });
    const summary = {
      ready: participants.filter(({ delivery: item }) => item.status === "READY").length,
      simulatedSent: participants.filter(({ delivery: item }) => item.status === "SIMULATED_SENT").length,
      simulatedFailed: participants.filter(({ delivery: item }) => item.status === "SIMULATED_FAILED").length,
      noChannel: participants.filter(({ delivery: item }) => item.status === "NO_CHANNEL").length,
    };
    return Object.freeze({
      apiVersion: "1.0" as const,
      mode: "DELIVERY_REHEARSAL" as const,
      competition: { id: input.competitionId, name: input.competitionName, revision: input.revision,
        proofHash: input.certificationHash, updatedAt: input.updatedAt },
      participants: Object.freeze(participants),
      contests: Object.freeze(contestList),
      communicationSummary: Object.freeze(summary),
      rehearsalNotice: "Delivery states are simulated. No WhatsApp, email or SMS is sent from this local rehearsal.",
    });
  };

  reset();
  return {
    snapshot,
    perform: (action) => {
      if (action.kind === "RESET_REHEARSAL") reset();
      else if (action.kind === "CALL_CONTEST") {
        if (!confirmed.some(({ contestId }) => contestId === action.contestId)) throw new Error("Unknown confirmed contest");
        calledContestIds.add(action.contestId);
      } else {
        const current = delivery.get(action.participantId);
        if (!current) throw new Error("Unknown participant");
        current.channel = action.channel;
        current.status = action.kind === "SIMULATE_SUCCESS" ? "SIMULATED_SENT"
          : action.kind === "SIMULATE_FAILURE" ? "SIMULATED_FAILED" : "READY";
        current.lastAttemptAt = action.kind === "PREVIEW_NEXT" ? null : input.updatedAt;
        current.message = messageFor(action.participantId, contests().find(({ participantIds: ids }) => ids.includes(action.participantId)));
      }
      return snapshot();
    },
  };
}
