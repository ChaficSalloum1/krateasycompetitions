import { createHash } from "node:crypto";

export type ClosedStatus = "CERTIFIED" | "REJECTED";
export interface FormatFinding { readonly code: string; readonly message: string; readonly competitorIds?: readonly string[]; }

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(",")}}`;
  return JSON.stringify(value) ?? "undefined";
}

function digest(value: unknown): string { return createHash("sha256").update(canonical(value)).digest("hex"); }

function immutable<T>(value: T): Readonly<T> {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) immutable(child);
    Object.freeze(value);
  }
  return value;
}

function findingsHash<T extends object>(body: T): Readonly<T & { replayHash: string }> {
  return immutable({ ...body, replayHash: digest(body) });
}

function duplicateIds(ids: readonly string[]): string[] {
  const seen = new Set<string>(); const duplicates = new Set<string>();
  for (const id of ids) seen.has(id) ? duplicates.add(id) : seen.add(id);
  return [...duplicates].sort();
}

// Swiss ---------------------------------------------------------------------

export interface SwissCompetitor {
  readonly id: string; readonly points: number; readonly opponents: readonly string[]; readonly byeCount: number; readonly withdrawn?: boolean;
}
export interface SwissPairingPolicy {
  readonly rematches: "FORBIDDEN" | "MINIMIZE";
  readonly bye?: "LOWEST_RANKED_WITHOUT_BYE" | "LOWEST_RANKED";
  readonly searchNodeLimit?: number;
}
export interface SwissPairingRequest { readonly round: number; readonly competitors: readonly SwissCompetitor[]; readonly policy: SwissPairingPolicy; }
export interface SwissPairing { readonly board: number; readonly competitors: readonly [string, string]; readonly scoreGap: number; readonly rematch: boolean; }
export interface SwissBye { readonly competitorId: string; readonly reason: string; }
export interface SwissPairingProof {
  readonly completeCoverage: boolean; readonly activeCompetitorCount: number; readonly pairedCompetitorCount: number;
  readonly excludedCompetitorIds: readonly string[]; readonly rematchCount: number; readonly scoreGap: number;
  readonly searchNodes: number; readonly searchNodeLimit: number; readonly constraints: readonly string[];
}
export interface SwissPairingOutput {
  readonly status: ClosedStatus; readonly round: number; readonly pairings: readonly SwissPairing[]; readonly bye: SwissBye | null;
  readonly proof: SwissPairingProof; readonly findings: readonly FormatFinding[]; readonly replayHash: string;
}

interface PairingCandidate { pairs: readonly (readonly [SwissCompetitor, SwissCompetitor])[]; rematches: number; gap: number; key: string; }

function swissRejected(request: SwissPairingRequest, findings: readonly FormatFinding[], excluded: readonly string[]): SwissPairingOutput {
  const searchNodeLimit = request.policy.searchNodeLimit ?? 250_000;
  return findingsHash({ status: "REJECTED" as const, round: request.round, pairings: [] as readonly SwissPairing[], bye: null,
    proof: { completeCoverage: false, activeCompetitorCount: request.competitors.length - excluded.length, pairedCompetitorCount: 0,
      excludedCompetitorIds: [...excluded], rematchCount: 0, scoreGap: 0, searchNodes: 0, searchNodeLimit,
      constraints: [`rematches:${request.policy.rematches}`, `bye:${request.policy.bye ?? "UNSPECIFIED"}`] },
    findings: [...findings] });
}

export function pairSwissRound(request: SwissPairingRequest): SwissPairingOutput {
  const excluded = request.competitors.filter(({ withdrawn }) => withdrawn).map(({ id }) => id).sort();
  const active = request.competitors.filter(({ withdrawn }) => !withdrawn)
    .slice().sort((left, right) => right.points - left.points || left.id.localeCompare(right.id));
  const duplicates = duplicateIds(request.competitors.map(({ id }) => id));
  if (!Number.isInteger(request.round) || request.round < 1) return swissRejected(request, [{ code: "INVALID_ROUND", message: "Swiss round must be a positive integer." }], excluded);
  if (request.policy.searchNodeLimit !== undefined && (!Number.isInteger(request.policy.searchNodeLimit) || request.policy.searchNodeLimit < 1)) {
    return swissRejected(request, [{ code: "INVALID_SEARCH_LIMIT", message: "Swiss search node limit must be a positive integer." }], excluded);
  }
  if (duplicates.length > 0 || request.competitors.some(({ id, points, byeCount }) => !id.trim() || !Number.isFinite(points) || !Number.isInteger(byeCount) || byeCount < 0)) {
    return swissRejected(request, [{ code: "INVALID_COMPETITOR_SET", message: "Competitors require unique ids, finite points, and non-negative integer bye counts.", competitorIds: duplicates }], excluded);
  }
  if (active.length < 2) return swissRejected(request, [{ code: "INSUFFICIENT_ACTIVE_COMPETITORS", message: "At least two active competitors are required." }], excluded);

  let bye: SwissBye | null = null;
  if (active.length % 2 === 1) {
    if (!request.policy.bye) return swissRejected(request, [{ code: "BYE_POLICY_REQUIRED", message: "An odd active field requires an explicit bye policy." }], excluded);
    const eligible = request.policy.bye === "LOWEST_RANKED_WITHOUT_BYE" ? active.filter(({ byeCount }) => byeCount === 0) : active;
    if (eligible.length === 0) {
      return swissRejected(request, [{ code: "BYE_INFEASIBLE", message: "No competitor satisfies the pinned no-repeat-bye policy." }], excluded);
    }
    const selected = eligible.at(-1)!;
    active.splice(active.findIndex(({ id }) => id === selected.id), 1);
    bye = { competitorId: selected.id, reason: request.policy.bye === "LOWEST_RANKED_WITHOUT_BYE"
      ? "lowest-ranked-active-competitor-without-prior-bye" : "lowest-ranked-active-competitor" };
  }

  let best: PairingCandidate | undefined;
  const searchNodeLimit = request.policy.searchNodeLimit ?? 250_000;
  let searchNodes = 0; let searchLimitReached = false;
  const search = (remaining: readonly SwissCompetitor[], pairs: readonly (readonly [SwissCompetitor, SwissCompetitor])[], rematches: number, gap: number): void => {
    searchNodes += 1;
    if (searchNodes > searchNodeLimit) { searchLimitReached = true; return; }
    if (remaining.length === 0) {
      const key = pairs.map(([left, right]) => `${left.id}:${right.id}`).join("|");
      const candidate = { pairs, rematches, gap, key };
      if (!best || candidate.rematches < best.rematches ||
        (candidate.rematches === best.rematches && (candidate.gap < best.gap || candidate.gap === best.gap && candidate.key < best.key))) best = candidate;
      return;
    }
    const left = remaining[0]!;
    for (let index = 1; index < remaining.length; index += 1) {
      if (searchLimitReached) return;
      const right = remaining[index]!;
      const isRematch = left.opponents.includes(right.id) || right.opponents.includes(left.id);
      if (isRematch && request.policy.rematches === "FORBIDDEN") continue;
      const nextRematches = rematches + Number(isRematch); const nextGap = gap + Math.abs(left.points - right.points);
      if (best && (nextRematches > best.rematches || nextRematches === best.rematches && nextGap > best.gap)) continue;
      search(remaining.slice(1, index).concat(remaining.slice(index + 1)), [...pairs, [left, right]], nextRematches, nextGap);
    }
  };
  search(active, [], 0, 0);
  if (searchLimitReached) return findingsHash({ status: "REJECTED" as const, round: request.round, pairings: [] as readonly SwissPairing[], bye: null,
    proof: { completeCoverage: false, activeCompetitorCount: active.length + Number(bye !== null), pairedCompetitorCount: 0,
      excludedCompetitorIds: excluded, rematchCount: 0, scoreGap: 0, searchNodes, searchNodeLimit,
      constraints: [`rematches:${request.policy.rematches}`, `bye:${request.policy.bye ?? "NOT_REQUIRED"}`, "exact-search-required"] },
    findings: [{ code: "PAIRING_SEARCH_LIMIT", message: "The exact pairing search reached its explicit node limit before optimality could be proven." }] });
  const selected: PairingCandidate | undefined = best;
  if (!selected) return swissRejected(request, [{ code: "PAIRING_INFEASIBLE", message: "No complete pairing satisfies the pinned rematch policy." }], excluded);
  const pairings = selected.pairs.map(([left, right], index): SwissPairing => ({ board: index + 1, competitors: [left.id, right.id],
    scoreGap: Math.abs(left.points - right.points), rematch: left.opponents.includes(right.id) || right.opponents.includes(left.id) }));
  const covered = new Set(pairings.flatMap(({ competitors }) => competitors));
  const completeCoverage = covered.size === active.length && pairings.length * 2 === active.length;
  const body = { status: "CERTIFIED" as const, round: request.round, pairings, bye,
    proof: { completeCoverage, activeCompetitorCount: active.length + Number(bye !== null), pairedCompetitorCount: covered.size,
      excludedCompetitorIds: excluded, rematchCount: selected.rematches, scoreGap: selected.gap,
      searchNodes, searchNodeLimit,
      constraints: [`rematches:${request.policy.rematches}`, `bye:${request.policy.bye ?? "NOT_REQUIRED"}`, "minimum-rematches", "minimum-total-score-gap", "lexical-tie-break"] },
    findings: [] as readonly FormatFinding[] };
  return findingsHash(body);
}

// Ladder --------------------------------------------------------------------

export interface LadderAuditEvent {
  readonly sequence: number; readonly challengerId: string; readonly defenderId: string; readonly winnerId: string;
  readonly actorId: string; readonly occurredAt: string; readonly reason: string; readonly previousEventHash: string | null; readonly eventHash: string;
}
export interface LadderState { readonly id: string; readonly version: number; readonly order: readonly string[]; readonly audit: readonly LadderAuditEvent[]; readonly stateHash: string; }
export interface LadderChallenge {
  readonly challengerId: string; readonly defenderId: string; readonly winnerId: string; readonly maxChallengeDistance: number;
  readonly actorId: string; readonly occurredAt: string; readonly reason: string;
}
export interface LadderTransitionProof { readonly previousStateHash: string; readonly nextStateHash: string; readonly changed: boolean; readonly eventHash: string | null; }
export interface LadderTransition {
  readonly status: ClosedStatus; readonly ladder: LadderState; readonly proof: LadderTransitionProof; readonly findings: readonly FormatFinding[]; readonly replayHash: string;
}

function ladderStateHash(state: Omit<LadderState, "stateHash">): string { return digest(state); }

export function createLadder(id: string, order: readonly string[]): LadderState {
  const duplicates = duplicateIds(order);
  if (!id.trim() || order.length < 2 || order.some((entrant) => !entrant.trim()) || duplicates.length > 0) {
    throw new Error("Ladder requires an id and at least two uniquely identified competitors");
  }
  const base = { id, version: 0, order: [...order], audit: [] as readonly LadderAuditEvent[] };
  return immutable({ ...base, stateHash: ladderStateHash(base) });
}

function ladderRejected(ladder: LadderState, code: string, message: string): LadderTransition {
  return findingsHash({ status: "REJECTED" as const, ladder,
    proof: { previousStateHash: ladder.stateHash, nextStateHash: ladder.stateHash, changed: false, eventHash: null },
    findings: [{ code, message }] });
}

export function applyLadderChallenge(ladder: LadderState, command: LadderChallenge): LadderTransition {
  const verification = verifyLadder(ladder);
  if (!verification.valid) return ladderRejected(ladder, "INVALID_LADDER_PROOF", "The ladder audit or state hash is invalid.");
  if (!command.actorId.trim() || !command.reason.trim() || !Number.isFinite(Date.parse(command.occurredAt))) {
    return ladderRejected(ladder, "AUDIT_FIELDS_REQUIRED", "Actor, reason, and valid occurrence time are required.");
  }
  const challengerRank = ladder.order.indexOf(command.challengerId); const defenderRank = ladder.order.indexOf(command.defenderId);
  if (challengerRank < 0 || defenderRank < 0 || ![command.challengerId, command.defenderId].includes(command.winnerId)) {
    return ladderRejected(ladder, "INVALID_CHALLENGE_PARTICIPANTS", "Challenge participants and winner must belong to this ladder contest.");
  }
  if (!Number.isInteger(command.maxChallengeDistance) || command.maxChallengeDistance < 1 || challengerRank <= defenderRank || challengerRank - defenderRank > command.maxChallengeDistance) {
    return ladderRejected(ladder, "CHALLENGE_OUT_OF_RANGE", "Challenger must be below and within the pinned maximum distance of the defender.");
  }
  const order = [...ladder.order];
  if (command.winnerId === command.challengerId) {
    order.splice(challengerRank, 1); order.splice(defenderRank, 0, command.challengerId);
  }
  const eventBase = { sequence: ladder.audit.length + 1, challengerId: command.challengerId, defenderId: command.defenderId,
    winnerId: command.winnerId, actorId: command.actorId, occurredAt: command.occurredAt, reason: command.reason,
    previousEventHash: ladder.audit.at(-1)?.eventHash ?? null };
  const event: LadderAuditEvent = { ...eventBase, eventHash: digest(eventBase) };
  const nextBase = { id: ladder.id, version: ladder.version + 1, order, audit: [...ladder.audit, event] };
  const next = immutable({ ...nextBase, stateHash: ladderStateHash(nextBase) });
  return findingsHash({ status: "CERTIFIED" as const, ladder: next,
    proof: { previousStateHash: ladder.stateHash, nextStateHash: next.stateHash, changed: command.winnerId === command.challengerId, eventHash: event.eventHash },
    findings: [] as readonly FormatFinding[] });
}

export function verifyLadder(ladder: LadderState): Readonly<{ valid: boolean; findings: readonly FormatFinding[]; proofHash: string }> {
  const findings: FormatFinding[] = [];
  let previous: string | null = null;
  ladder.audit.forEach((event, index) => {
    const { eventHash, ...base } = event;
    if (event.sequence !== index + 1 || event.previousEventHash !== previous) findings.push({ code: "BROKEN_AUDIT_CHAIN", message: `Audit event ${index + 1} has invalid lineage.` });
    if (digest(base) !== eventHash) findings.push({ code: "AUDIT_HASH_MISMATCH", message: `Audit event ${index + 1} content was modified.` });
    previous = event.eventHash;
  });
  const { stateHash, ...base } = ladder;
  if (ladderStateHash(base) !== stateHash) findings.push({ code: "STATE_HASH_MISMATCH", message: "Ladder content does not match its state hash." });
  if (ladder.version !== ladder.audit.length || duplicateIds(ladder.order).length > 0) findings.push({ code: "INVALID_LADDER_STATE", message: "Ladder version or competitor order is invalid." });
  return immutable({ valid: findings.length === 0, findings, proofHash: digest({ ladder, findings }) });
}

// Qualifying heats ----------------------------------------------------------

export interface SeededEntrant { readonly id: string; readonly seedMark: number; readonly withdrawn?: boolean; }
export interface HeatAssignmentRequest {
  readonly stageId: string; readonly entrants: readonly SeededEntrant[]; readonly heatCount: number; readonly lanesPerHeat: number;
  readonly lanePriority: readonly number[]; readonly betterMark: "LOWER" | "HIGHER";
  readonly seedTiePolicy?: "UNRESOLVED" | "COMPETITOR_ID";
}
export interface HeatLaneAssignment { readonly competitorId: string; readonly lane: number; readonly seedRank: number; readonly seedMark: number; }
export interface QualifyingHeat { readonly heat: number; readonly assignments: readonly HeatLaneAssignment[]; }
export interface HeatAssignmentOutput {
  readonly status: ClosedStatus; readonly heats: readonly QualifyingHeat[];
  readonly proof: { readonly everyActiveEntrantAssignedExactlyOnce: boolean; readonly activeEntrantCount: number; readonly capacity: number;
    readonly excludedCompetitorIds: readonly string[]; readonly distribution: "SERPENTINE"; readonly lanePolicyExplicit: boolean };
  readonly findings: readonly FormatFinding[]; readonly replayHash: string;
}

function heatRejected(request: HeatAssignmentRequest, code: string, message: string, excluded: readonly string[]): HeatAssignmentOutput {
  return findingsHash({ status: "REJECTED" as const, heats: [] as readonly QualifyingHeat[],
    proof: { everyActiveEntrantAssignedExactlyOnce: false, activeEntrantCount: request.entrants.length - excluded.length,
      capacity: request.heatCount * request.lanesPerHeat, excludedCompetitorIds: [...excluded], distribution: "SERPENTINE" as const, lanePolicyExplicit: false },
    findings: [{ code, message }] });
}

export function assignQualifyingHeats(request: HeatAssignmentRequest): HeatAssignmentOutput {
  const excluded = request.entrants.filter(({ withdrawn }) => withdrawn).map(({ id }) => id).sort();
  const active = request.entrants.filter(({ withdrawn }) => !withdrawn);
  if (!request.stageId.trim() || duplicateIds(request.entrants.map(({ id }) => id)).length > 0 || request.entrants.some(({ id, seedMark }) => !id.trim() || !Number.isFinite(seedMark))) {
    return heatRejected(request, "INVALID_ENTRANTS", "Heat entrants require unique ids and finite seed marks.", excluded);
  }
  if (!Number.isInteger(request.heatCount) || request.heatCount < 1 || !Number.isInteger(request.lanesPerHeat) || request.lanesPerHeat < 1) {
    return heatRejected(request, "INVALID_HEAT_SHAPE", "Heat and lane counts must be positive integers.", excluded);
  }
  if (active.length > request.heatCount * request.lanesPerHeat) return heatRejected(request, "INSUFFICIENT_CAPACITY", "Active entrants exceed declared heat capacity.", excluded);
  const laneSet = new Set(request.lanePriority);
  if (request.lanePriority.length !== request.lanesPerHeat || laneSet.size !== request.lanesPerHeat ||
    request.lanePriority.some((lane) => !Number.isInteger(lane) || lane < 1 || lane > request.lanesPerHeat)) {
    return heatRejected(request, "INVALID_LANE_POLICY", "Lane priority must explicitly list every available lane exactly once.", excluded);
  }
  const tiedSeedMarks = new Map<number, string[]>();
  for (const entrant of active) tiedSeedMarks.set(entrant.seedMark, [...(tiedSeedMarks.get(entrant.seedMark) ?? []), entrant.id]);
  const tiedCompetitors = [...tiedSeedMarks.values()].filter((ids) => ids.length > 1).flat().sort();
  if (tiedCompetitors.length > 0 && request.seedTiePolicy !== "COMPETITOR_ID") {
    return heatRejected(request, "SEED_TIE_UNRESOLVED", "Equal seed marks require an explicit deterministic seed tie policy.", excluded);
  }
  const seeded = active.slice().sort((left, right) => (request.betterMark === "LOWER" ? left.seedMark - right.seedMark : right.seedMark - left.seedMark) || left.id.localeCompare(right.id));
  const buckets: Array<Array<{ entrant: SeededEntrant; seedRank: number }>> = Array.from({ length: request.heatCount }, () => []);
  seeded.forEach((entrant, index) => {
    const row = Math.floor(index / request.heatCount); const offset = index % request.heatCount;
    const heat = row % 2 === 0 ? offset : request.heatCount - 1 - offset;
    buckets[heat]!.push({ entrant, seedRank: index + 1 });
  });
  const heats = buckets.map((bucket, heat): QualifyingHeat => ({ heat: heat + 1,
    assignments: bucket.sort((left, right) => left.seedRank - right.seedRank).map(({ entrant, seedRank }, index) => ({
      competitorId: entrant.id, lane: request.lanePriority[index]!, seedRank, seedMark: entrant.seedMark })) }));
  const assigned = heats.flatMap(({ assignments }) => assignments.map(({ competitorId }) => competitorId));
  const exact = assigned.length === active.length && new Set(assigned).size === active.length;
  return findingsHash({ status: "CERTIFIED" as const, heats,
    proof: { everyActiveEntrantAssignedExactlyOnce: exact, activeEntrantCount: active.length,
      capacity: request.heatCount * request.lanesPerHeat, excludedCompetitorIds: excluded, distribution: "SERPENTINE" as const, lanePolicyExplicit: true },
    findings: [] as readonly FormatFinding[] });
}

// Time trials and ranking qualification ------------------------------------

export type TrialStatus = "VALID" | "DNS" | "DNF" | "DQ";
export interface TimeTrialResult { readonly competitorId: string; readonly status: TrialStatus; readonly timeMilliseconds?: number; }
export interface TimeTrialRequest {
  readonly stageId: string; readonly results: readonly TimeTrialResult[]; readonly tiePolicy: "UNRESOLVED" | "SHARED_RANK" | "SEED_ORDER";
  readonly seedOrder?: readonly string[];
}
export interface RankedTrialResult { readonly competitorId: string; readonly status: TrialStatus; readonly timeMilliseconds: number | null; readonly rank: number | null; }
export interface TimeTrialOutput {
  readonly status: ClosedStatus; readonly ranking: readonly RankedTrialResult[];
  readonly proof: { readonly validResultsRanked: number; readonly nonFinishersRanked: number; readonly tieGroups: readonly (readonly string[])[]; readonly tiePolicy: string };
  readonly findings: readonly FormatFinding[]; readonly replayHash: string;
}

export function rankTimeTrial(request: TimeTrialRequest): TimeTrialOutput {
  const duplicates = duplicateIds(request.results.map(({ competitorId }) => competitorId));
  const invalid = request.results.some((result) => !result.competitorId.trim() ||
    (result.status === "VALID" ? !Number.isFinite(result.timeMilliseconds) || result.timeMilliseconds! < 0 : result.timeMilliseconds !== undefined));
  if (!request.stageId.trim() || duplicates.length > 0 || invalid) {
    return findingsHash({ status: "REJECTED" as const, ranking: [] as readonly RankedTrialResult[],
      proof: { validResultsRanked: 0, nonFinishersRanked: 0, tieGroups: [] as readonly (readonly string[])[], tiePolicy: request.tiePolicy },
      findings: [{ code: "INVALID_TRIAL_RESULTS", message: "Trial results require unique ids, valid non-negative times, and no time for non-finishers.", competitorIds: duplicates }] });
  }
  const seedRanks = new Map((request.seedOrder ?? []).map((id, index) => [id, index]));
  const valid = request.results.filter((result) => result.status === "VALID").slice().sort((left, right) =>
    left.timeMilliseconds! - right.timeMilliseconds! ||
    (request.tiePolicy === "SEED_ORDER" ? (seedRanks.get(left.competitorId) ?? Number.MAX_SAFE_INTEGER) - (seedRanks.get(right.competitorId) ?? Number.MAX_SAFE_INTEGER) : left.competitorId.localeCompare(right.competitorId)));
  const tieGroups: string[][] = [];
  for (let index = 0; index < valid.length;) {
    let end = index + 1;
    while (end < valid.length && valid[end]!.timeMilliseconds === valid[index]!.timeMilliseconds) end += 1;
    if (end - index > 1) tieGroups.push(valid.slice(index, end).map(({ competitorId }) => competitorId).sort());
    index = end;
  }
  if (tieGroups.length > 0 && request.tiePolicy === "UNRESOLVED") {
    return findingsHash({ status: "REJECTED" as const, ranking: [] as readonly RankedTrialResult[],
      proof: { validResultsRanked: 0, nonFinishersRanked: 0, tieGroups, tiePolicy: request.tiePolicy },
      findings: [{ code: "UNRESOLVED_TIE", message: "Equal valid times require an explicit shared-rank or seed-order policy.", competitorIds: tieGroups.flat() }] });
  }
  if (tieGroups.length > 0 && request.tiePolicy === "SEED_ORDER" && tieGroups.some((group) => group.some((id) => !seedRanks.has(id)))) {
    return findingsHash({ status: "REJECTED" as const, ranking: [] as readonly RankedTrialResult[],
      proof: { validResultsRanked: 0, nonFinishersRanked: 0, tieGroups, tiePolicy: request.tiePolicy },
      findings: [{ code: "INCOMPLETE_SEED_ORDER", message: "Seed-order tie resolution must cover every tied competitor.", competitorIds: tieGroups.flat() }] });
  }
  const ranking: RankedTrialResult[] = valid.map((result, index) => {
    const firstEqual = request.tiePolicy === "SHARED_RANK" ? valid.findIndex(({ timeMilliseconds }) => timeMilliseconds === result.timeMilliseconds) : index;
    return { competitorId: result.competitorId, status: "VALID", timeMilliseconds: result.timeMilliseconds!, rank: firstEqual + 1 };
  });
  const statusOrder: Record<Exclude<TrialStatus, "VALID">, number> = { DNF: 0, DNS: 1, DQ: 2 };
  const nonFinishers = request.results.filter((result): result is TimeTrialResult & { status: Exclude<TrialStatus, "VALID"> } => result.status !== "VALID")
    .slice().sort((left, right) => statusOrder[left.status] - statusOrder[right.status] || left.competitorId.localeCompare(right.competitorId));
  ranking.push(...nonFinishers.map((result) => ({ competitorId: result.competitorId, status: result.status, timeMilliseconds: null, rank: null })));
  return findingsHash({ status: "CERTIFIED" as const, ranking,
    proof: { validResultsRanked: valid.length, nonFinishersRanked: 0, tieGroups, tiePolicy: request.tiePolicy }, findings: [] as readonly FormatFinding[] });
}

export interface RankingResult { readonly competitorId: string; readonly score: number; readonly withdrawn?: boolean; }
export interface RankingQualificationRequest {
  readonly stageId: string; readonly results: readonly RankingResult[]; readonly qualificationPlaces: number; readonly betterScore: "LOWER" | "HIGHER";
  readonly cutoffTiePolicy: "UNRESOLVED" | "SEED_ORDER" | "ADVANCE_ALL"; readonly seedOrder?: readonly string[];
}
export interface RankingQualificationOutput {
  readonly status: ClosedStatus; readonly qualifiedCompetitorIds: readonly string[]; readonly orderedResults: readonly RankingResult[];
  readonly proof: { readonly qualificationCountExact: boolean; readonly requestedPlaces: number; readonly awardedPlaces: number;
    readonly cutoffTieCompetitorIds: readonly string[]; readonly excludedCompetitorIds: readonly string[]; readonly tiePolicy: string };
  readonly findings: readonly FormatFinding[]; readonly replayHash: string;
}

export function qualifyRankingStage(request: RankingQualificationRequest): RankingQualificationOutput {
  const excluded = request.results.filter(({ withdrawn }) => withdrawn).map(({ competitorId }) => competitorId).sort();
  const active = request.results.filter(({ withdrawn }) => !withdrawn);
  const duplicates = duplicateIds(request.results.map(({ competitorId }) => competitorId));
  const emptyProof = (ties: readonly string[] = []) => ({ qualificationCountExact: false, requestedPlaces: request.qualificationPlaces,
    awardedPlaces: 0, cutoffTieCompetitorIds: [...ties], excludedCompetitorIds: excluded, tiePolicy: request.cutoffTiePolicy });
  const rejected = (code: string, message: string, ties: readonly string[] = []): RankingQualificationOutput => findingsHash({
    status: "REJECTED" as const, qualifiedCompetitorIds: [] as readonly string[], orderedResults: [] as readonly RankingResult[], proof: emptyProof(ties),
    findings: [{ code, message, ...(ties.length > 0 ? { competitorIds: [...ties] } : {}) }] });
  if (!request.stageId.trim() || duplicates.length > 0 || request.results.some(({ competitorId, score }) => !competitorId.trim() || !Number.isFinite(score))) {
    return rejected("INVALID_RANKING_RESULTS", "Ranking results require unique ids and finite scores.", duplicates);
  }
  if (!Number.isInteger(request.qualificationPlaces) || request.qualificationPlaces < 1 || request.qualificationPlaces > active.length) {
    return rejected("INVALID_QUALIFICATION_PLACES", "Qualification places must be a positive integer within the active field.");
  }
  const seedRank = new Map((request.seedOrder ?? []).map((id, index) => [id, index]));
  const ordered = active.slice().sort((left, right) =>
    (request.betterScore === "LOWER" ? left.score - right.score : right.score - left.score) ||
    (request.cutoffTiePolicy === "SEED_ORDER" ? (seedRank.get(left.competitorId) ?? Number.MAX_SAFE_INTEGER) - (seedRank.get(right.competitorId) ?? Number.MAX_SAFE_INTEGER) : left.competitorId.localeCompare(right.competitorId)));
  const cutoff = ordered[request.qualificationPlaces - 1]!.score;
  const tiedAtCutoff = ordered.filter(({ score }) => score === cutoff).map(({ competitorId }) => competitorId).sort();
  const strictlyAhead = ordered.filter(({ score }) => request.betterScore === "LOWER" ? score < cutoff : score > cutoff).length;
  const tieCrossesCut = tiedAtCutoff.length > request.qualificationPlaces - strictlyAhead;
  if (tieCrossesCut && request.cutoffTiePolicy === "UNRESOLVED") return rejected("CUTOFF_TIE_UNRESOLVED", "A score tie crosses the qualification boundary and no resolution policy is pinned.", tiedAtCutoff);
  if (tieCrossesCut && request.cutoffTiePolicy === "SEED_ORDER" && tiedAtCutoff.some((id) => !seedRank.has(id))) {
    return rejected("INCOMPLETE_SEED_ORDER", "Seed-order cutoff resolution must cover every tied competitor.", tiedAtCutoff);
  }
  const qualified = request.cutoffTiePolicy === "ADVANCE_ALL" && tieCrossesCut
    ? ordered.filter(({ score }) => request.betterScore === "LOWER" ? score <= cutoff : score >= cutoff).map(({ competitorId }) => competitorId)
    : ordered.slice(0, request.qualificationPlaces).map(({ competitorId }) => competitorId);
  return findingsHash({ status: "CERTIFIED" as const, qualifiedCompetitorIds: qualified, orderedResults: ordered,
    proof: { qualificationCountExact: qualified.length === request.qualificationPlaces, requestedPlaces: request.qualificationPlaces,
      awardedPlaces: qualified.length, cutoffTieCompetitorIds: tieCrossesCut ? tiedAtCutoff : [], excludedCompetitorIds: excluded, tiePolicy: request.cutoffTiePolicy },
    findings: [] as readonly FormatFinding[] });
}
