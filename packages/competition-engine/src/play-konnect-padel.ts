import { canonicalHash, deepFreeze } from "@tournament-os/tournament-schema";
import { compileDeclarativeQualification, verifyDeclarativeQualification, type QualificationCandidate } from "./declarative-qualification.js";
import {
  createSportRulePackRegistry,
  sealSportRulePack,
  type GovernedEvaluationResult,
  type SportRulePack,
} from "./sport-rule-packs.js";
import type { SportPolicy } from "./sport-semantics.js";

export const PLAY_KONNECT_PADEL_SCALE_ENVELOPE = deepFreeze({
  maximumPools: 64,
  maximumEntrants: 1_024,
  maximumMatches: 8_192,
  konnectFieldSize: 4,
  assurance: "STRUCTURAL_LIMITS_ARE_NOT_A_PRODUCTION_CAPACITY_GUARANTEE",
} as const);

const SOURCE = "/Users/chaficsalloum/Downloads/PLAY_AND_KONNECT_TOURNAMENT_SPECIFICATION.md";
export const PLAY_KONNECT_REQUIREMENTS = deepFreeze([
  { id: "PK-R04", section: 4, source: SOURCE, lines: "94-106", assurance: "ILLUSTRATIVE_REQUIREMENT_INTERPRETATION",
    statement: "Within-pool order is match points, game difference, games won, applicable head-to-head, then an auditable deterministic tiebreak." },
  { id: "PK-R05", section: 5, source: SOURCE, lines: "110-139", assurance: "ILLUSTRATIVE_REQUIREMENT_INTERPRETATION",
    statement: "Cross-pool comparison preserves finishing-position tiers and uses per-match MP, GD, and GW rates." },
  { id: "PK-R06", section: 6, source: SOURCE, lines: "143-165", assurance: "ILLUSTRATIVE_REQUIREMENT_INTERPRETATION",
    statement: "Konnect always has four entrants: winners, runner-up wildcards below four pools, or the best four winners above four pools." },
  { id: "PK-R08", section: 8, source: SOURCE, lines: "205-232", assurance: "ILLUSTRATIVE_REQUIREMENT_INTERPRETATION",
    statement: "K1-K4 are immutable; seed integrity takes priority over avoiding a same-pool rematch." },
  { id: "PK-R11", section: 11, source: SOURCE, lines: "292-311", assurance: "ILLUSTRATIVE_REQUIREMENT_INTERPRETATION",
    statement: "Tower seeds preserve achievement tier before normalized comparisons." },
  { id: "PK-R13", section: 13, source: SOURCE, lines: "372-397", assurance: "ILLUSTRATIVE_REQUIREMENT_INTERPRETATION",
    statement: "Rematch avoidance may move only equivalent slots and must never silently distort seeds." },
] as const);

const timedPolicy = {
  id: "play-konnect-timed-games-v1", version: "1.0.0", adapter: "HEAD_TO_HEAD", resultShape: "TOTAL_SCORE",
  valueRule: { kind: "NON_NEGATIVE_INTEGER" }, draws: "ALLOWED", standingsPoints: { win: 3, draw: 1, loss: 0 },
  walkover: "OPPONENT_WINS",
} as const satisfies SportPolicy;

const standardPolicy = {
  id: "play-konnect-standard-best-of-three-v1", version: "1.0.0", adapter: "HEAD_TO_HEAD", resultShape: "BEST_OF_UNITS",
  valueRule: { kind: "NON_NEGATIVE_INTEGER" }, draws: "FORBIDDEN", standingsPoints: { win: 3, draw: 1, loss: 0 },
  walkover: "OPPONENT_WINS", bestOf: 3,
} as const satisfies SportPolicy;

export type PlayKonnectPadelRules = Readonly<{
  id: "play-konnect-padel-illustrative";
  version: "1.0.0";
  disclaimer: string;
  policies: readonly SportPolicy[];
  packs: readonly SportRulePack[];
  deterministicTiebreak: Readonly<{ algorithm: "SHA256_SEEDED_V1"; seed: string }>;
  proofHash: string;
}>;

export function createIllustrativePlayKonnectPadelRules(): PlayKonnectPadelRules {
  const owner = { id: "play-konnect-example-owner", name: "Play & Konnect illustrative organiser" };
  const authority = { id: "play-konnect-example-authority", name: "Play & Konnect illustrative rules authority", kind: "ORGANIZER" as const };
  const policies: readonly SportPolicy[] = [timedPolicy, standardPolicy];
  const packs = policies.map((policy) => sealSportRulePack({
    id: `${policy.id}-pack`, version: "1.0.0", title: `${policy.id} illustrative governed policy`, owner, authority,
    jurisdiction: "PLAY_AND_KONNECT/ILLUSTRATIVE", effectiveFrom: "2026-01-01T00:00:00.000Z",
    assurance: "ILLUSTRATIVE_CONFORMANCE_ONLY", semanticReference: {
      policyId: policy.id, policyVersion: policy.version, adapter: policy.adapter,
    }, compatibility: { sportSemanticsApiVersion: "1.0.0", engineVersion: "1.0.0" },
  }, { decision: "APPROVED", authorityId: authority.id, approverId: "illustrative-review-board",
    approvedAt: "2025-12-01T00:00:00.000Z", evidence: `${SOURCE}#illustrative-interpretation` }));
  const body = { id: "play-konnect-padel-illustrative" as const, version: "1.0.0" as const,
    disclaimer: "Illustrative Play & Konnect configuration; not official federation rules or certification.", policies, packs,
    deterministicTiebreak: { algorithm: "SHA256_SEEDED_V1" as const, seed: "play-konnect-spec-v1" } };
  return deepFreeze({ ...body, proofHash: canonicalHash(body) });
}

export type PlayKonnectMatchRequest = Readonly<{
  format: "TIMED" | "STANDARD";
  contestId: string;
  entrants: readonly string[];
  result: unknown;
  at: string;
}>;

export type PlayKonnectPoolRankingRequest = Readonly<{
  at: string;
  pools: readonly Readonly<{ id: string; entrantIds: readonly string[] }>[];
  matches: readonly Readonly<{ contestId: string; poolId: string; format: "TIMED" | "STANDARD";
    entrants: readonly [string, string]; result: unknown }>[];
}>;

export type PlayKonnectStanding = Readonly<{
  entrantId: string;
  poolId: string;
  poolRank: number;
  played: number;
  matchPoints: number;
  gamesWon: number;
  gamesLost: number;
  gameDifference: number;
  tieResolution: "RAW" | "HEAD_TO_HEAD" | "MINI_LEAGUE" | "DETERMINISTIC_FINAL";
  deterministicKey: string;
}>;

export type PlayKonnectPoolRanking = Readonly<{
  status: "CERTIFIED" | "REJECTED";
  standings: readonly PlayKonnectStanding[];
  findings: readonly Readonly<{ code: string; message: string; ids?: readonly string[] }>[];
  proofHash: string;
}>;

export type PlayKonnectSeed = Readonly<{
  seedId: `K${number}` | `T${number}`;
  entrantId: string;
  poolId: string;
  finishingPositionTier: number;
  matchPointsPerMatch: number;
  gameDifferencePerMatch: number;
  gamesWonPerMatch: number;
}>;

export type PlayKonnectCupSeedingRequest = Readonly<{
  rules: PlayKonnectPadelRules;
  standings: readonly PlayKonnectStanding[];
}>;

export type PlayKonnectCupSeeding = Readonly<{
  status: "CERTIFIED" | "REJECTED";
  konnectSeeds: readonly PlayKonnectSeed[];
  towerSeeds: readonly PlayKonnectSeed[];
  openingSemifinals: readonly Readonly<{ slotId: "SF1" | "SF2"; seedIds: readonly [`K${number}`, `K${number}`];
    entrantIds: readonly [string, string]; samePoolRematch: boolean }>[];
  rematchPolicy: Readonly<{ seedDistortion: "FORBIDDEN"; allowedAction: "EQUIVALENT_SLOT_SWAP_ONLY";
    forcedRematchesAreAudited: true }>;
  qualificationProofHash: string | null;
  findings: readonly Readonly<{ code: string; message: string; entrantIds?: readonly string[] }>[];
  proofHash: string;
}>;

function ratioCompare(leftNumerator: number, leftDenominator: number, rightNumerator: number, rightDenominator: number): number {
  const difference = BigInt(rightNumerator) * BigInt(leftDenominator) - BigInt(leftNumerator) * BigInt(rightDenominator);
  return difference > 0n ? 1 : difference < 0n ? -1 : 0;
}

function crossPoolComparator(rules: PlayKonnectPadelRules) {
  return (left: PlayKonnectStanding, right: PlayKonnectStanding): number => left.poolRank - right.poolRank ||
    ratioCompare(left.matchPoints, left.played, right.matchPoints, right.played) ||
    ratioCompare(left.gameDifference, left.played, right.gameDifference, right.played) ||
    ratioCompare(left.gamesWon, left.played, right.gamesWon, right.played) ||
    canonicalHash(`${rules.deterministicTiebreak.seed}:${left.entrantId}`).localeCompare(
      canonicalHash(`${rules.deterministicTiebreak.seed}:${right.entrantId}`)) || left.entrantId.localeCompare(right.entrantId);
}

/** Public seam consumed by bracket acceptance: qualification and seed identity are fixed before placement. */
export function compilePlayKonnectCupSeeds(request: PlayKonnectCupSeedingRequest): PlayKonnectCupSeeding {
  const reject = (code: string, message: string, entrantIds: readonly string[] = []): PlayKonnectCupSeeding => {
    const body = { status: "REJECTED" as const, konnectSeeds: [], towerSeeds: [], openingSemifinals: [],
      rematchPolicy: { seedDistortion: "FORBIDDEN" as const, allowedAction: "EQUIVALENT_SLOT_SWAP_ONLY" as const,
        forcedRematchesAreAudited: true as const }, qualificationProofHash: null,
      findings: [{ code, message, ...(entrantIds.length ? { entrantIds: [...entrantIds].sort() } : {}) }] };
    return deepFreeze({ ...body, proofHash: canonicalHash({ request, body }) });
  };
  const { proofHash: suppliedRulesProofHash, ...rulesBody } = request.rules;
  if (canonicalHash(rulesBody) !== suppliedRulesProofHash) {
    return reject("RULES_PROOF_MISMATCH", "The illustrative rules payload does not match its immutable proof hash.");
  }
  const standings = [...request.standings];
  const entrantIds = standings.map(({ entrantId }) => entrantId); const poolIds = [...new Set(standings.map(({ poolId }) => poolId))].sort();
  if (standings.length < 4 || standings.length > PLAY_KONNECT_PADEL_SCALE_ENVELOPE.maximumEntrants ||
    poolIds.length < 1 || poolIds.length > PLAY_KONNECT_PADEL_SCALE_ENVELOPE.maximumPools ||
    new Set(entrantIds).size !== entrantIds.length || standings.some((row) => !row.entrantId.trim() || !row.poolId.trim() ||
      !Number.isInteger(row.poolRank) || row.poolRank < 1 || !Number.isInteger(row.played) || row.played < 1 ||
      !Number.isFinite(row.matchPoints) || !Number.isFinite(row.gamesWon) || !Number.isFinite(row.gamesLost) ||
      row.gameDifference !== row.gamesWon - row.gamesLost)) {
    return reject("INVALID_STANDINGS", "Cup seeding requires bounded, complete, internally consistent standings.", entrantIds);
  }
  for (const poolId of poolIds) {
    const poolRows = standings.filter((row) => row.poolId === poolId);
    const ranks = poolRows.map(({ poolRank }) => poolRank).sort((a, b) => a - b);
    if (ranks.length < 3 || ranks.some((rank, index) => rank !== index + 1)) {
      return reject("INVALID_POOL_RANKS", "Each pool requires unique contiguous finishing positions and at least three entrants.");
    }
    if (poolRows.some(({ played }) => played !== poolRows.length - 1)) {
      return reject("INCOMPLETE_POOL_STANDINGS", "Every cup-seeding row must represent one complete single round robin.",
        poolRows.map(({ entrantId }) => entrantId));
    }
  }
  const ordered = [...standings].sort(crossPoolComparator(request.rules));
  const ordinal = new Map(ordered.map((row, index) => [row.entrantId, ordered.length - index]));
  const candidates: QualificationCandidate[] = standings.map((row) => ({ id: row.entrantId, groupId: row.poolId, rank: row.poolRank,
    metrics: { crossPoolOrdinal: ordinal.get(row.entrantId)! } }));
  const winnerCount = Math.min(poolIds.length, PLAY_KONNECT_PADEL_SCALE_ENVELOPE.konnectFieldSize);
  const selectors = [{ type: "BEST_N" as const, metric: { type: "VALUE" as const, key: "crossPoolOrdinal" }, count: winnerCount,
    direction: "HIGHER" as const, eligibleRank: 1, cutoffTiePolicy: "REJECT" as const }];
  if (poolIds.length < PLAY_KONNECT_PADEL_SCALE_ENVELOPE.konnectFieldSize) selectors.push({
    type: "BEST_N", metric: { type: "VALUE", key: "crossPoolOrdinal" },
    count: PLAY_KONNECT_PADEL_SCALE_ENVELOPE.konnectFieldSize - poolIds.length,
    direction: "HIGHER", eligibleRank: 2, cutoffTiePolicy: "REJECT",
  });
  const qualificationRequest = { policyId: "play-konnect-konnect-four-v1", outputCount: 4, candidates,
    alreadySelectedCandidateIds: [] as readonly string[], selectors };
  const qualification = compileDeclarativeQualification(qualificationRequest);
  const verification = verifyDeclarativeQualification(qualificationRequest, qualification);
  if (qualification.status !== "CERTIFIED" || verification.status !== "CERTIFIED") {
    return reject("QUALIFICATION_REJECTED", "Primary declarative qualification could not certify exactly four Konnect entrants.",
      qualification.findings.flatMap(({ candidateIds = [] }) => candidateIds));
  }
  const selected = new Set(qualification.selectedCandidateIds);
  const seedFor = (row: PlayKonnectStanding, seedId: `K${number}` | `T${number}`): PlayKonnectSeed => ({
    seedId, entrantId: row.entrantId, poolId: row.poolId, finishingPositionTier: row.poolRank,
    matchPointsPerMatch: row.matchPoints / row.played, gameDifferencePerMatch: row.gameDifference / row.played,
    gamesWonPerMatch: row.gamesWon / row.played,
  });
  const konnectSeeds = ordered.filter(({ entrantId }) => selected.has(entrantId)).map((row, index) => seedFor(row, `K${index + 1}`));
  const towerSeeds = ordered.filter(({ entrantId }) => !selected.has(entrantId)).map((row, index) => seedFor(row, `T${index + 1}`));
  const openingSemifinals = ([[0, 3, "SF1"], [1, 2, "SF2"]] as const).map(([left, right, slotId]) => {
    const first = konnectSeeds[left]!; const second = konnectSeeds[right]!;
    return { slotId, seedIds: [first.seedId as `K${number}`, second.seedId as `K${number}`] as const,
      entrantIds: [first.entrantId, second.entrantId] as const, samePoolRematch: first.poolId === second.poolId };
  });
  const body = { status: "CERTIFIED" as const, konnectSeeds, towerSeeds, openingSemifinals,
    rematchPolicy: { seedDistortion: "FORBIDDEN" as const, allowedAction: "EQUIVALENT_SLOT_SWAP_ONLY" as const,
      forcedRematchesAreAudited: true as const }, qualificationProofHash: qualification.proof.proofHash,
    findings: openingSemifinals.filter(({ samePoolRematch }) => samePoolRematch).map(({ entrantIds: ids }) => ({
      code: "FORCED_SAME_POOL_REMATCH", message: "Seed integrity preserved; same-pool opening rematch is explicitly audited.", entrantIds: [...ids].sort(),
    })) };
  return deepFreeze({ ...body, proofHash: canonicalHash({ rulesProofHash: request.rules.proofHash, standings, body, verificationHash: verification.verificationHash }) });
}

export interface PlayKonnectPadelConformance {
  evaluateMatch(request: PlayKonnectMatchRequest): GovernedEvaluationResult;
  rankPools(request: PlayKonnectPoolRankingRequest): PlayKonnectPoolRanking;
}

export function createPlayKonnectPadelConformance(rules: PlayKonnectPadelRules): PlayKonnectPadelConformance {
  const registry = createSportRulePackRegistry({ packs: rules.packs, policies: rules.policies,
    compatibility: { sportSemanticsApiVersion: "1.0.0", engineVersion: "1.0.0" } });
  function rejectedRanking(code: string, message: string, ids: readonly string[] = []): PlayKonnectPoolRanking {
    const body = { status: "REJECTED" as const, standings: [], findings: [{ code, message, ...(ids.length ? { ids: [...ids].sort() } : {}) }] };
    return deepFreeze({ ...body, proofHash: canonicalHash(body) });
  }
  function evaluateMatch(request: PlayKonnectMatchRequest): GovernedEvaluationResult {
    const policy = request.format === "TIMED" ? timedPolicy : standardPolicy;
    return registry.evaluate({ packId: `${policy.id}-pack`, version: "1.0.0", jurisdiction: "PLAY_AND_KONNECT/ILLUSTRATIVE",
      at: request.at, contestId: request.contestId, entrants: request.entrants, result: request.result });
  }
  function scoreFrom(result: unknown): readonly [number, number] | null {
    if (!result || typeof result !== "object") return null;
    const record = result as Record<string, unknown>;
    const validGameCount = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
    if (record.shape === "TOTAL_SCORE" && Array.isArray(record.score) && record.score.length === 2 &&
      record.score.every(validGameCount)) return record.score as [number, number];
    if (record.shape === "BEST_OF_UNITS" && Array.isArray(record.units)) {
      let left = 0; let right = 0;
      for (const unit of record.units) {
        if (!Array.isArray(unit) || unit.length !== 2 || unit.some((value) => !validGameCount(value))) return null;
        left += unit[0] as number; right += unit[1] as number;
        if (!Number.isSafeInteger(left) || !Number.isSafeInteger(right)) return null;
      }
      return [left, right];
    }
    return null;
  }
  function rankPools(request: PlayKonnectPoolRankingRequest): PlayKonnectPoolRanking {
    if (request.pools.length < 1 || request.pools.length > PLAY_KONNECT_PADEL_SCALE_ENVELOPE.maximumPools ||
      request.matches.length > PLAY_KONNECT_PADEL_SCALE_ENVELOPE.maximumMatches) {
      return rejectedRanking("SCALE_ENVELOPE_EXCEEDED", "Pools or matches exceed the published illustrative envelope.");
    }
    const pools = [...request.pools].map((pool) => ({ id: pool.id, entrantIds: [...pool.entrantIds].sort() }))
      .sort((left, right) => left.id.localeCompare(right.id));
    const poolIds = pools.map(({ id }) => id); const entrantIds = pools.flatMap(({ entrantIds }) => entrantIds);
    if (new Set(poolIds).size !== poolIds.length || poolIds.some((id) => !id.trim()) || entrantIds.length > PLAY_KONNECT_PADEL_SCALE_ENVELOPE.maximumEntrants ||
      new Set(entrantIds).size !== entrantIds.length || pools.some(({ entrantIds: ids }) => ids.length < 3 || new Set(ids).size !== ids.length)) {
      return rejectedRanking("INVALID_POOL_MEMBERSHIP", "Pools require unique ids, at least three unique entrants, and globally exclusive membership.");
    }
    const matches = [...request.matches].sort((left, right) => left.contestId.localeCompare(right.contestId));
    if (new Set(matches.map(({ contestId }) => contestId)).size !== matches.length) {
      return rejectedRanking("DUPLICATE_MATCH", "Every pool match requires a unique contest id.");
    }
    type Mutable<T> = { -readonly [Property in keyof T]: T[Property] };
    type MutableStanding = Mutable<Omit<PlayKonnectStanding, "poolRank" | "tieResolution">>;
    type RankedRow = {
      readonly row: MutableStanding;
      readonly tieResolution: PlayKonnectStanding["tieResolution"];
    };
    const rows = new Map<string, MutableStanding>();
    for (const pool of pools) for (const entrantId of pool.entrantIds) rows.set(entrantId, { entrantId, poolId: pool.id, played: 0,
      matchPoints: 0, gamesWon: 0, gamesLost: 0, gameDifference: 0,
      deterministicKey: canonicalHash(`${rules.deterministicTiebreak.seed}:${entrantId}`) });
    const seenPairs = new Set<string>();
    const matchResults = new Map<string, GovernedEvaluationResult>();
    const matchScores = new Map<string, readonly [number, number]>();
    for (const match of matches) {
      const pool = pools.find(({ id }) => id === match.poolId);
      if (!pool || match.entrants.length !== 2 || match.entrants[0] === match.entrants[1] ||
        match.entrants.some((id) => !pool.entrantIds.includes(id))) {
        return rejectedRanking("INVALID_POOL_MATCH", "A match must join two distinct members of its declared pool.", match.entrants);
      }
      const pairKey = `${pool.id}:${[...match.entrants].sort().join(":")}`;
      if (seenPairs.has(pairKey)) return rejectedRanking("DUPLICATE_PAIRING", "A pool cannot contain a repeated pairing.", match.entrants);
      seenPairs.add(pairKey);
      const governed = evaluateMatch({ ...match, at: request.at }); const score = scoreFrom(match.result);
      if (governed.status !== "CERTIFIED" || score === null || governed.semanticResult === null) {
        return rejectedRanking("UNCERTIFIED_MATCH", "Every standings match must have governed semantics and an explicit game score.", match.entrants);
      }
      matchResults.set(pairKey, governed);
      const orderedScore = match.entrants[0]! < match.entrants[1]! ? score : [score[1], score[0]] as const;
      matchScores.set(pairKey, orderedScore);
      for (const [index, entrantId] of match.entrants.entries()) {
        const row = rows.get(entrantId)!; const placement = governed.semanticResult.placements.find((entry) => entry.competitorId === entrantId)!;
        const nextMatchPoints = row.matchPoints + (placement.standingsPoints ?? 0);
        const nextGamesWon = row.gamesWon + score[index]!; const nextGamesLost = row.gamesLost + score[index === 0 ? 1 : 0]!;
        if (![nextMatchPoints, nextGamesWon, nextGamesLost].every(Number.isSafeInteger)) {
          return rejectedRanking("NUMERIC_ENVELOPE_EXCEEDED", "Standings totals exceed the exact integer arithmetic envelope.", [entrantId]);
        }
        row.played += 1; row.matchPoints = nextMatchPoints;
        row.gamesWon = nextGamesWon; row.gamesLost = nextGamesLost; row.gameDifference = row.gamesWon - row.gamesLost;
      }
    }
    for (const pool of pools) {
      const expectedPairs = pool.entrantIds.length * (pool.entrantIds.length - 1) / 2;
      const actualPairs = [...seenPairs].filter((key) => key.startsWith(`${pool.id}:`)).length;
      if (actualPairs !== expectedPairs) return rejectedRanking("INCOMPLETE_ROUND_ROBIN", "Every unordered pool pairing must appear exactly once.", pool.entrantIds);
    }
    const standings: PlayKonnectStanding[] = [];
    for (const pool of pools) {
      const rawRows = pool.entrantIds.map((id) => rows.get(id)!);
      const buckets = new Map<string, MutableStanding[]>();
      for (const row of rawRows) {
        const key = `${row.matchPoints}|${row.gameDifference}|${row.gamesWon}`;
        buckets.set(key, [...(buckets.get(key) ?? []), row]);
      }
      const orderedKeys = [...buckets.keys()].sort((left, right) => {
        const a = left.split("|").map(Number); const b = right.split("|").map(Number);
        return b[0]! - a[0]! || b[1]! - a[1]! || b[2]! - a[2]!;
      });
      const ranked: RankedRow[] = orderedKeys.flatMap((key): RankedRow[] => {
        const tied = buckets.get(key)!;
        if (tied.length === 2) {
          const pairKey = `${pool.id}:${tied.map(({ entrantId }) => entrantId).sort().join(":")}`;
          const governed = matchResults.get(pairKey)!; const winnerId = governed.semanticResult?.outcomePorts.winnerId;
          if (winnerId) return [...tied].sort((left, right) => left.entrantId === winnerId ? -1 : right.entrantId === winnerId ? 1 : 0)
            .map((row) => ({ row, tieResolution: "HEAD_TO_HEAD" as const }));
        }
        if (tied.length > 2) {
          const mini = tied.map((row) => {
            let matchPoints = 0; let gamesWon = 0; let gamesLost = 0;
            for (const opponent of tied) {
              if (opponent.entrantId === row.entrantId) continue;
              const ids = [row.entrantId, opponent.entrantId].sort(); const pairKey = `${pool.id}:${ids.join(":")}`;
              const governed = matchResults.get(pairKey)!; const score = matchScores.get(pairKey)!;
              const placement = governed.semanticResult!.placements.find(({ competitorId }) => competitorId === row.entrantId)!;
              matchPoints += placement.standingsPoints ?? 0;
              const rowIndex = ids[0] === row.entrantId ? 0 : 1; gamesWon += score[rowIndex]!; gamesLost += score[rowIndex === 0 ? 1 : 0]!;
            }
            return { row, matchPoints, gameDifference: gamesWon - gamesLost, gamesWon };
          }).sort((left, right) => right.matchPoints - left.matchPoints || right.gameDifference - left.gameDifference ||
            right.gamesWon - left.gamesWon || left.row.deterministicKey.localeCompare(right.row.deterministicKey) ||
            left.row.entrantId.localeCompare(right.row.entrantId));
          const miniKeys = mini.map(({ matchPoints, gameDifference, gamesWon }) => `${matchPoints}|${gameDifference}|${gamesWon}`);
          if (new Set(miniKeys).size > 1) return mini.map(({ row }, index) => ({ row,
            tieResolution: miniKeys.filter((value) => value === miniKeys[index]).length === 1 ? "MINI_LEAGUE" as const : "DETERMINISTIC_FINAL" as const }));
        }
        return [...tied].sort((left, right) => left.deterministicKey.localeCompare(right.deterministicKey) || left.entrantId.localeCompare(right.entrantId))
          .map((row) => ({ row, tieResolution: tied.length > 1 ? "DETERMINISTIC_FINAL" as const : "RAW" as const }));
      });
      ranked.forEach(({ row, tieResolution }, index) => {
        standings.push({ ...row, poolRank: index + 1, tieResolution });
      });
    }
    const body = { status: "CERTIFIED" as const, standings, findings: [] as const };
    return deepFreeze({ ...body, proofHash: canonicalHash({ rulesProofHash: rules.proofHash, request: { ...request, pools, matches }, body }) });
  }
  return deepFreeze({
    evaluateMatch(request: PlayKonnectMatchRequest): GovernedEvaluationResult {
      return evaluateMatch(request);
    },
    rankPools,
  });
}
