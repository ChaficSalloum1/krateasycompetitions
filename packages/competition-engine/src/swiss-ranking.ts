import { createHash } from "node:crypto";

export const SWISS_RANKING_SCALE_ENVELOPE = Object.freeze({ maximumEntrants: 256, maximumRounds: 32, maximumGames: 4_096 });
export type SwissRankingCriterion = "POINTS" | "BUCHHOLZ" | "MEDIAN_BUCHHOLZ" | "SONNEBORN_BERGER" | "HEAD_TO_HEAD" | "PROGRESSIVE_SCORE";
export interface SwissRankingPolicy {
  readonly id: string; readonly version: "1.0.0"; readonly criteria: readonly SwissRankingCriterion[];
  readonly points: Readonly<{ win: number; draw: number; loss: number; bye: number }>;
  readonly medianBuchholzDrop: number; readonly incompleteData: "REJECT" | "PROVISIONAL";
  readonly tieResolution: "REJECT" | "SHARED_RANK" | "COMPETITOR_ID";
}
export interface SwissRankingGame {
  readonly competitors: readonly [string, string]; readonly result: "LEFT_WIN" | "RIGHT_WIN" | "DRAW" | null;
}
export interface SwissRankingRound { readonly round: number; readonly games: readonly SwissRankingGame[]; readonly byes: readonly string[]; }
export interface SwissRankingRequest {
  readonly policyId: string; readonly tournamentId: string; readonly entrants: readonly string[]; readonly rounds: readonly SwissRankingRound[];
}
export interface SwissRankingMetrics {
  readonly points: number; readonly buchholz: number; readonly medianBuchholz: number | null;
  readonly sonnebornBerger: number; readonly progressiveScore: number; readonly headToHead: number | null;
}
export interface SwissRankingRow { readonly competitorId: string; readonly rank: number; readonly metrics: SwissRankingMetrics; }
export interface SwissRankingFinding { readonly code: string; readonly message: string; readonly competitorIds?: readonly string[]; }
export interface SwissRankingOutput {
  readonly status: "CERTIFIED" | "PROVISIONAL" | "REJECTED"; readonly policyId: string; readonly tournamentId: string;
  readonly rows: readonly SwissRankingRow[]; readonly findings: readonly SwissRankingFinding[];
  readonly proof: Readonly<{ policyHash: string | null; normalizedInputHash: string; criteriaApplied: readonly SwissRankingCriterion[];
    completeRounds: boolean; headToHeadGroupsEvaluated: number; headToHeadGroupsSkipped: number; scaleEnvelope: typeof SWISS_RANKING_SCALE_ENVELOPE }>;
  readonly proofHash: string;
}
export interface SwissRankingEngine { rank(request: SwissRankingRequest): SwissRankingOutput; }

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
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
function finalize(body: Omit<SwissRankingOutput, "proofHash">): SwissRankingOutput { return immutable({ ...body, proofHash: digest(body) }); }

function normalizedRequest(request: SwissRankingRequest): SwissRankingRequest {
  const rounds = request.rounds.map((round) => ({ round: round.round, byes: [...round.byes].sort(), games: round.games.map((game) => {
    const [left, right] = game.competitors;
    if (left.localeCompare(right) <= 0) return { competitors: [left, right] as const, result: game.result };
    const result: SwissRankingGame["result"] = game.result === "LEFT_WIN" ? "RIGHT_WIN" : game.result === "RIGHT_WIN" ? "LEFT_WIN" : game.result;
    return { competitors: [right, left] as const, result };
  }).sort((a, b) => a.competitors[0].localeCompare(b.competitors[0]) || a.competitors[1].localeCompare(b.competitors[1])) }))
    .sort((a, b) => a.round - b.round);
  return { policyId: request.policyId, tournamentId: request.tournamentId, entrants: [...request.entrants].sort(), rounds };
}

function rejected(request: SwissRankingRequest, policyHash: string | null, normalizedInputHash: string, code: string, message: string,
  competitorIds?: readonly string[]): SwissRankingOutput {
  const finding = competitorIds === undefined ? { code, message } : { code, message, competitorIds };
  return finalize({ status: "REJECTED", policyId: request.policyId, tournamentId: request.tournamentId, rows: [], findings: [finding],
    proof: { policyHash, normalizedInputHash, criteriaApplied: [], completeRounds: false, headToHeadGroupsEvaluated: 0,
      headToHeadGroupsSkipped: 0, scaleEnvelope: SWISS_RANKING_SCALE_ENVELOPE } });
}

interface PlayerWork {
  id: string; points: number; progressive: number; opponents: Array<{ id: string; factor: number | null }>;
  buchholz: number; median: number | null; sb: number; headToHead: number | null;
}

function policyValid(policy: SwissRankingPolicy): boolean {
  return Boolean(policy.id.trim()) && policy.version === "1.0.0" && policy.criteria.length > 0 && policy.criteria[0] === "POINTS" &&
    new Set(policy.criteria).size === policy.criteria.length && policy.criteria.every((criterion) =>
      (["POINTS", "BUCHHOLZ", "MEDIAN_BUCHHOLZ", "SONNEBORN_BERGER", "HEAD_TO_HEAD", "PROGRESSIVE_SCORE"] as string[]).includes(criterion)) &&
    Object.values(policy.points).every((point) => Number.isFinite(point) && point >= 0) && policy.points.win > policy.points.draw &&
    policy.points.draw >= policy.points.loss && Number.isInteger(policy.medianBuchholzDrop) && policy.medianBuchholzDrop >= 0;
}

function rankWithPolicy(policy: SwissRankingPolicy, source: SwissRankingRequest): SwissRankingOutput {
  const request = normalizedRequest(source); const normalizedInputHash = digest(request); const policyHash = digest(policy);
  if (!policyValid(policy)) return rejected(request, policyHash, normalizedInputHash, "INVALID_RANKING_POLICY", "Ranking policy is invalid or uses an unsupported version or criterion.");
  if (!request.tournamentId.trim() || request.entrants.length < 2 || request.entrants.length > SWISS_RANKING_SCALE_ENVELOPE.maximumEntrants ||
    new Set(request.entrants).size !== request.entrants.length || request.entrants.some((id) => !id.trim())) {
    return rejected(request, policyHash, normalizedInputHash, "INVALID_ENTRANTS", "Tournament and unique entrant ids are required within the scale envelope.");
  }
  const gameCount = request.rounds.reduce((sum, round) => sum + round.games.length, 0);
  if (request.rounds.length < 1 || request.rounds.length > SWISS_RANKING_SCALE_ENVELOPE.maximumRounds || gameCount > SWISS_RANKING_SCALE_ENVELOPE.maximumGames ||
    request.rounds.some((round, index) => round.round !== index + 1)) {
    return rejected(request, policyHash, normalizedInputHash, "INVALID_ROUND_SEQUENCE", "Rounds must be contiguous, unique, and within the scale envelope.");
  }
  const entrants = new Set(request.entrants); const players = new Map(request.entrants.map((id): [string, PlayerWork] => [id,
    { id, points: 0, progressive: 0, opponents: [], buchholz: 0, median: null, sb: 0, headToHead: null }]));
  const completedGames = new Map<string, Array<{ left: string; right: string; result: Exclude<SwissRankingGame["result"], null> }>>();
  const incomplete: SwissRankingFinding[] = [];
  for (const round of request.rounds) {
    const seen = new Set<string>(); const gained = new Map(request.entrants.map((id) => [id, 0]));
    for (const game of round.games) {
      const [left, right] = game.competitors;
      if (!entrants.has(left) || !entrants.has(right) || left === right || seen.has(left) || seen.has(right) ||
        !(["LEFT_WIN", "RIGHT_WIN", "DRAW", null] as const).includes(game.result)) {
        return rejected(request, policyHash, normalizedInputHash, "INVALID_ROUND_PAIRING", "A round must pair registered entrants at most once with a registered result shape.", [left, right].sort());
      }
      seen.add(left); seen.add(right);
      const leftFactor = game.result === "LEFT_WIN" ? 1 : game.result === "DRAW" ? 0.5 : game.result === "RIGHT_WIN" ? 0 : null;
      const rightFactor = leftFactor === null ? null : 1 - leftFactor;
      players.get(left)!.opponents.push({ id: right, factor: leftFactor }); players.get(right)!.opponents.push({ id: left, factor: rightFactor });
      if (game.result === null) incomplete.push({ code: "INCOMPLETE_RESULT", message: `Round ${round.round} has an unresolved game.`, competitorIds: [left, right] });
      else {
        const leftPoints = game.result === "LEFT_WIN" ? policy.points.win : game.result === "DRAW" ? policy.points.draw : policy.points.loss;
        const rightPoints = game.result === "RIGHT_WIN" ? policy.points.win : game.result === "DRAW" ? policy.points.draw : policy.points.loss;
        gained.set(left, leftPoints); gained.set(right, rightPoints);
        const key = [left, right].sort().join("|"); const values = completedGames.get(key) ?? [];
        values.push({ left, right, result: game.result }); completedGames.set(key, values);
      }
    }
    for (const bye of round.byes) {
      if (!entrants.has(bye) || seen.has(bye)) return rejected(request, policyHash, normalizedInputHash, "INVALID_BYE", "A bye must identify one otherwise-unpaired registered entrant.", [bye]);
      seen.add(bye); gained.set(bye, policy.points.bye);
    }
    const missing = request.entrants.filter((id) => !seen.has(id));
    if (missing.length > 0) incomplete.push({ code: "INCOMPLETE_ROUND", message: `Round ${round.round} omits registered entrants.`, competitorIds: missing });
    for (const id of request.entrants) { const player = players.get(id)!; player.points += gained.get(id)!; player.progressive += player.points; }
  }
  if (incomplete.length > 0 && policy.incompleteData === "REJECT") {
    const first = incomplete[0]!; return rejected(request, policyHash, normalizedInputHash, first.code, first.message, first.competitorIds);
  }
  for (const player of players.values()) {
    const opponentPoints = player.opponents.map(({ id }) => players.get(id)!.points);
    player.buchholz = opponentPoints.reduce((sum, value) => sum + value, 0);
    const drop = policy.medianBuchholzDrop;
    player.median = opponentPoints.length >= drop * 2 + 1
      ? opponentPoints.sort((a, b) => a - b).slice(drop, opponentPoints.length - drop).reduce((sum, value) => sum + value, 0) : null;
    player.sb = player.opponents.reduce((sum, opponent) => sum + (opponent.factor ?? 0) * players.get(opponent.id)!.points, 0);
  }
  const pointGroups = new Map<number, PlayerWork[]>();
  for (const player of players.values()) pointGroups.set(player.points, [...(pointGroups.get(player.points) ?? []), player]);
  let headToHeadGroupsEvaluated = 0; let headToHeadGroupsSkipped = 0;
  for (const group of pointGroups.values()) {
    if (group.length === 1) { group[0]!.headToHead = 0; continue; }
    const complete = group.every((left, index) => group.slice(index + 1).every((right) => (completedGames.get([left.id, right.id].sort().join("|")) ?? []).length === 1));
    if (!complete) { headToHeadGroupsSkipped += 1; continue; }
    headToHeadGroupsEvaluated += 1;
    for (const player of group) player.headToHead = group.filter(({ id }) => id !== player.id).reduce((score, opponent) => {
      const game = completedGames.get([player.id, opponent.id].sort().join("|"))![0]!;
      if (game.result === "DRAW") return score + policy.points.draw;
      const won = game.result === "LEFT_WIN" ? game.left === player.id : game.right === player.id;
      return score + (won ? policy.points.win : policy.points.loss);
    }, 0);
  }
  if (policy.criteria.includes("MEDIAN_BUCHHOLZ") && [...players.values()].some(({ median }) => median === null)) {
    const finding = { code: "INSUFFICIENT_OPPONENTS", message: "Median Buchholz needs at least 2 × drop + 1 completed opponents." };
    if (policy.incompleteData === "REJECT") return rejected(request, policyHash, normalizedInputHash, finding.code, finding.message);
    incomplete.push(finding);
  }
  const metric = (player: PlayerWork, criterion: SwissRankingCriterion): number | null => {
    if (criterion === "POINTS") return player.points;
    if (criterion === "BUCHHOLZ") return player.buchholz;
    if (criterion === "MEDIAN_BUCHHOLZ") return player.median;
    if (criterion === "SONNEBORN_BERGER") return player.sb;
    if (criterion === "HEAD_TO_HEAD") return player.headToHead;
    return player.progressive;
  };
  let groups: PlayerWork[][] = [[...players.values()].sort((a, b) => a.id.localeCompare(b.id))];
  for (const criterion of policy.criteria) {
    groups = groups.flatMap((group) => {
      const buckets = new Map<string, PlayerWork[]>();
      for (const player of group) { const value = metric(player, criterion); const key = value === null ? "UNRESOLVED" : String(value); buckets.set(key, [...(buckets.get(key) ?? []), player]); }
      return [...buckets].sort(([left], [right]) => left === "UNRESOLVED" ? 1 : right === "UNRESOLVED" ? -1 : Number(right) - Number(left))
        .map(([, bucket]) => bucket);
    });
  }
  const unresolved = groups.filter((group) => group.length > 1);
  if (unresolved.length > 0 && policy.tieResolution === "REJECT") return rejected(request, policyHash, normalizedInputHash, "UNRESOLVED_TIE",
    "Registered ranking criteria do not fully resolve the final order.", unresolved.flatMap((group) => group.map(({ id }) => id)).sort());
  if (policy.tieResolution === "COMPETITOR_ID") groups = groups.flatMap((group) => group.sort((a, b) => a.id.localeCompare(b.id)).map((player) => [player]));
  const rows: SwissRankingRow[] = []; let ordinal = 1;
  for (const group of groups) {
    for (const player of group) rows.push({ competitorId: player.id, rank: ordinal, metrics: { points: player.points, buchholz: player.buchholz,
      medianBuchholz: player.median, sonnebornBerger: player.sb, progressiveScore: player.progressive, headToHead: player.headToHead } });
    ordinal += group.length;
  }
  const proof = { policyHash, normalizedInputHash, criteriaApplied: [...policy.criteria], completeRounds: incomplete.length === 0,
    headToHeadGroupsEvaluated, headToHeadGroupsSkipped, scaleEnvelope: SWISS_RANKING_SCALE_ENVELOPE };
  return finalize({ status: incomplete.length === 0 ? "CERTIFIED" : "PROVISIONAL", policyId: policy.id, tournamentId: request.tournamentId,
    rows, findings: incomplete, proof });
}

export function createSwissRankingEngine(policies: readonly SwissRankingPolicy[]): SwissRankingEngine {
  const registry = new Map<string, SwissRankingPolicy>();
  for (const policy of policies) {
    if (!policy.id.trim() || registry.has(policy.id)) throw new Error("Swiss ranking policy ids must be non-empty and unique");
    registry.set(policy.id, structuredClone(policy));
  }
  return immutable({ rank(request: SwissRankingRequest): SwissRankingOutput {
    const normalizedInputHash = digest(normalizedRequest(request)); const policy = registry.get(request.policyId);
    if (!policy) return rejected(request, null, normalizedInputHash, "UNREGISTERED_RANKING_POLICY", "No registered Swiss ranking policy matches this request.");
    return rankWithPolicy(policy, request);
  } });
}
