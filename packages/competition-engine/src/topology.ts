export interface BracketTopologySummary { entrantCount: number; bracketSize: number; byeCount: number; actualContestCount: number; rounds: number; }

export function describeBracketTopology(entrantCount: number): BracketTopologySummary {
  if (!Number.isInteger(entrantCount) || entrantCount < 2 || entrantCount > 1024) throw new Error("Entrant count must be an integer from 2 to 1024");
  const bracketSize = 2 ** Math.ceil(Math.log2(entrantCount));
  return { entrantCount, bracketSize, byeCount: bracketSize - entrantCount, actualContestCount: entrantCount - 1, rounds: Math.log2(bracketSize) };
}
