import { canonicalHash } from "@tournament-os/tournament-schema";
import { deterministicRandom, shuffle } from "./random.js";

export interface DynamicRoundContest { id: string; teamA: [string, string]; teamB: [string, string]; }
export interface DynamicRound { round: number; contests: DynamicRoundContest[]; hash: string; }
export interface DynamicResult { contestId: string; scores: [number, number]; }
export interface AmericanoState { players: string[]; round: number; totalRounds: number; scores: Record<string, number>; history: DynamicRound[]; seed: string; }

export interface DynamicFormatEngine<State> {
  initialise(input: { players: string[]; rounds: number; seed: string }): State;
  generateNextRound(state: State): DynamicRound;
  validateRound(state: State, round: DynamicRound): string[];
  applyResults(state: State, results: DynamicResult[]): State;
  isComplete(state: State): boolean;
  finalStandings(state: State): Array<{ playerId: string; score: number; rank: number }>;
}

export const americanoEngine: DynamicFormatEngine<AmericanoState> = {
  initialise: ({ players, rounds, seed }) => {
    if (players.length < 4 || players.length % 4 !== 0) throw new Error("Americano requires a player count divisible by four");
    return { players: [...players], round: 0, totalRounds: rounds, scores: Object.fromEntries(players.map((id) => [id, 0])), history: [], seed };
  },
  generateNextRound: (state) => {
    if (state.round >= state.totalRounds) throw new Error("Dynamic format is complete");
    const ordered = shuffle(state.players, deterministicRandom(`${state.seed}:${state.round + 1}`));
    const contests: DynamicRoundContest[] = [];
    for (let index = 0; index < ordered.length; index += 4) contests.push({
      id: `americano.R${state.round + 1}.M${index / 4 + 1}`,
      teamA: [ordered[index]!, ordered[index + 1]!], teamB: [ordered[index + 2]!, ordered[index + 3]!],
    });
    const partial = { round: state.round + 1, contests };
    return { ...partial, hash: canonicalHash(partial) };
  },
  validateRound: (state, round) => {
    const errors: string[] = []; const appearances = new Map<string, number>();
    for (const contest of round.contests) for (const id of [...contest.teamA, ...contest.teamB]) appearances.set(id, (appearances.get(id) ?? 0) + 1);
    for (const player of state.players) if (appearances.get(player) !== 1) errors.push(`${player} appears ${appearances.get(player) ?? 0} times`);
    if (round.round !== state.round + 1) errors.push("round number is not the next state transition");
    return errors;
  },
  applyResults: (state, results) => {
    const round = americanoEngine.generateNextRound(state);
    const errors = americanoEngine.validateRound(state, round); if (errors.length) throw new Error(errors.join("; "));
    const scores = { ...state.scores };
    for (const result of results) {
      const contest = round.contests.find(({ id }) => id === result.contestId); if (!contest) throw new Error(`Unknown result ${result.contestId}`);
      for (const id of contest.teamA) scores[id] = (scores[id] ?? 0) + result.scores[0];
      for (const id of contest.teamB) scores[id] = (scores[id] ?? 0) + result.scores[1];
    }
    if (results.length !== round.contests.length) throw new Error("All round results are required atomically");
    return { ...state, round: state.round + 1, scores, history: [...state.history, round] };
  },
  isComplete: (state) => state.round >= state.totalRounds,
  finalStandings: (state) => Object.entries(state.scores).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([playerId, score], index) => ({ playerId, score, rank: index + 1 })),
};
