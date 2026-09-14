import { canonicalHash, type StandingsPolicy, type ValidationFinding } from "@tournament-os/tournament-schema";
import type { ContestNode, ContestResult, Standing } from "./types.js";

const REGISTERED_METRICS = new Set([
  "played", "wins", "losses", "draws", "score_for", "games_won", "points_for",
  "score_against", "games_lost", "points_against", "score_difference", "game_difference",
  "point_difference", "winning_percentage", "win_percentage", "head_to_head",
]);

const metric = (standing: Standing, name: string): number => {
  switch (name) {
    case "played": return standing.played;
    case "wins": return standing.wins;
    case "losses": return standing.losses;
    case "draws": return standing.draws;
    case "score_for": case "games_won": case "points_for": return standing.scoreFor;
    case "score_against": case "games_lost": case "points_against": return standing.scoreAgainst;
    case "score_difference": case "game_difference": case "point_difference": return standing.scoreDifference;
    case "winning_percentage": case "win_percentage": return standing.winningPercentage;
    default: throw new Error(`Unregistered standings metric: ${name}`);
  }
};

export interface StandingsResult { standings: Standing[]; findings: ValidationFinding[]; }

export function calculateStandings(
  nodes: readonly ContestNode[],
  results: readonly ContestResult[],
  policy: StandingsPolicy,
  options: { randomSeed?: string } = {},
): StandingsResult {
  const unsupportedMetricIndex = policy.metricOrder.findIndex(({ metric: name }) => !REGISTERED_METRICS.has(name));
  if (unsupportedMetricIndex >= 0) {
    const unsupportedMetric = policy.metricOrder[unsupportedMetricIndex]!.metric;
    return {
      standings: [],
      findings: [{
        code: "TSC713", severity: "ERROR",
        path: `/standingsPolicies/${policy.id}/metricOrder/${unsupportedMetricIndex}`,
        message: "Standings policy references an unregistered metric and cannot be evaluated.",
        evidence: { metric: unsupportedMetric, registeredMetrics: [...REGISTERED_METRICS].sort() },
      }],
    };
  }
  const relevantNodes = nodes.filter(({ stageId }) => policy.stageIds.includes(stageId));
  const resultMap = new Map(results.map((result) => [result.contestId, result]));
  const rows = new Map<string, Standing>();
  const ensure = (entrantId: string, poolId?: string): Standing => {
    const key = `${poolId ?? ""}:${entrantId}`;
    let row = rows.get(key);
    if (!row) {
      row = { entrantId, ...(poolId ? { poolId } : {}), rank: 0, played: 0, wins: 0, losses: 0, draws: 0, scoreFor: 0, scoreAgainst: 0, scoreDifference: 0, winningPercentage: 0, tieResolution: [] };
      rows.set(key, row);
    }
    return row;
  };
  for (const node of relevantNodes) {
    for (const slot of node.slots) if (slot.type === "entrant") ensure(slot.entrantId, node.poolId);
    const result = resultMap.get(node.id);
    if (!result) continue;
    const [leftId, rightId] = result.entrants;
    const left = ensure(leftId, node.poolId); const right = ensure(rightId, node.poolId);
    left.played += 1; right.played += 1;
    left.scoreFor += result.scoreFor[0]; left.scoreAgainst += result.scoreFor[1];
    right.scoreFor += result.scoreFor[1]; right.scoreAgainst += result.scoreFor[0];
    if (result.winnerId === leftId) { left.wins += 1; right.losses += 1; }
    else { right.wins += 1; left.losses += 1; }
  }
  for (const row of rows.values()) {
    row.scoreDifference = row.scoreFor - row.scoreAgainst;
    row.winningPercentage = row.played === 0 ? 0 : row.wins / row.played;
  }
  const pools = new Map<string, Standing[]>();
  for (const row of rows.values()) pools.set(row.poolId ?? "all", [...(pools.get(row.poolId ?? "all") ?? []), row]);
  const findings: ValidationFinding[] = [];
  const ordered: Standing[] = [];
  const resolve = (group: Standing[], criterionIndex: number, poolId: string): Standing[] => {
    if (group.length <= 1) return group;
    const criterion = policy.metricOrder[criterionIndex];
    if (!criterion) {
      if (policy.tieFallback === "deterministic_draw") {
        if (!options.randomSeed) findings.push({ code: "TSC711", severity: "ERROR", path: `/standingsPolicies/${policy.id}/tieFallback`, message: "Deterministic tie draw requires an injected, versioned random seed.", evidence: { poolId, entrants: group.map(({ entrantId }) => entrantId) } });
        else return [...group].sort((a, b) => canonicalHash(`${options.randomSeed}:${a.entrantId}`).localeCompare(canonicalHash(`${options.randomSeed}:${b.entrantId}`))).map((row) => ({ ...row, tieResolution: [...row.tieResolution, `deterministic_draw:${options.randomSeed}`] }));
      } else if (policy.tieFallback === "manual_decision") findings.push({ code: "TSC712", severity: "ERROR", path: `/standingsPolicies/${policy.id}`, message: "Standings remain tied after every registered tiebreak and require a manual decision.", evidence: { poolId, entrants: group.map(({ entrantId }) => entrantId) } });
      else group.forEach((row) => row.tieResolution.push("shared_rank"));
      return [...group].sort((a, b) => a.entrantId.localeCompare(b.entrantId));
    }
    const buckets = new Map<string, Standing[]>();
    const numericKeys = new Map<string, number[]>();
    if (criterion.metric === "head_to_head") {
      const ids = new Set(group.map(({ entrantId }) => entrantId));
      const mini = new Map(group.map(({ entrantId }) => [entrantId, [0, 0, 0]]));
      for (const result of results.filter(({ entrants }) => entrants.every((id) => ids.has(id)))) {
        const left = mini.get(result.entrants[0])!; const right = mini.get(result.entrants[1])!;
        if (result.winnerId === result.entrants[0]) left[0]! += 1; else right[0]! += 1;
        left[1]! += result.scoreFor[0] - result.scoreFor[1]; right[1]! += result.scoreFor[1] - result.scoreFor[0];
        left[2]! += result.scoreFor[0]; right[2]! += result.scoreFor[1];
      }
      for (const row of group) {
        const values = mini.get(row.entrantId)!; const key = values.join("|"); numericKeys.set(key, values);
        buckets.set(key, [...(buckets.get(key) ?? []), row]); row.tieResolution.push(`head_to_head=${key}`);
      }
    } else {
      for (const row of group) {
        const value = metric(row, criterion.metric); const key = String(value); numericKeys.set(key, [value]);
        buckets.set(key, [...(buckets.get(key) ?? []), row]); row.tieResolution.push(`${criterion.metric}=${value}`);
      }
    }
    const keys = [...buckets.keys()].sort((left, right) => {
      const a = numericKeys.get(left)!; const b = numericKeys.get(right)!;
      for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
        const delta = (a[index] ?? 0) - (b[index] ?? 0); if (delta) return criterion.direction === "ASC" ? delta : -delta;
      }
      return left.localeCompare(right);
    });
    return keys.flatMap((key) => resolve(buckets.get(key)!, criterionIndex + 1, poolId));
  };
  for (const [poolId, poolRows] of pools) {
    const resolved = resolve(poolRows, 0, poolId);
    resolved.forEach((row, index) => {
      row.rank = index + 1;
      ordered.push(row);
    });
  }
  const missing = relevantNodes.filter(({ kind, id }) => kind === "contest" && !resultMap.has(id));
  if (missing.length) findings.push({ code: "TSW701", severity: "WARNING", path: "/standings", message: "Standings are provisional because contests are incomplete.", evidence: { missingContestIds: missing.map(({ id }) => id) } });
  return { standings: ordered, findings };
}

export function normalizedStandingScore(standing: Standing, normalization: string | undefined): number[] {
  switch (normalization) {
    case "per_match": case "percentage": return [standing.winningPercentage, standing.played ? standing.scoreDifference / standing.played : 0, standing.played ? standing.scoreFor / standing.played : 0];
    case undefined: return [standing.wins, standing.scoreDifference, standing.scoreFor];
    default: throw new Error(`Unimplemented standings normalization: ${normalization}`);
  }
}
