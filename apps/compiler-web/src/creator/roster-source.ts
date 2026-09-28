import { canonicalHash } from "@tournament-os/tournament-schema";
import { ingestCreationSource } from "../creation-source-ingestion.js";
import type { CreationSource } from "../creation-proposal.js";
import type { DivisionDraft, Interpretation } from "./interpretation.js";

export type RosterSource = Extract<CreationSource, { mode: "csv" | "xlsx" }>;

export function readRosterSource(source: RosterSource) {
  const imported = ingestCreationSource(source);
  if (imported.status !== "ACCEPTED" || !imported.entrants.length)
    throw new Error(imported.findings.join(" ") || "Roster has no accepted entrants.");
  return imported.entrants;
}

export function projectRosterSource(source: RosterSource, divisions: readonly DivisionDraft[], firstFactNumber: number) {
  const rows = readRosterSource(source);
  const sourceHash = canonicalHash(source);
  const labels = divisions.map(d => d.label.trim().toLowerCase());
  const failures: string[] = [], roster: Interpretation["roster"] = [], facts: Interpretation["facts"] = [];
  if (new Set(labels).size !== labels.length) {
    failures.push("ROSTER_DIVISION: Format divisions have ambiguous names; name them distinctly before attaching a roster.");
    return { roster, facts, failures };
  }
  for (const row of rows) {
    const index = labels.indexOf(row.divisionId.trim().toLowerCase());
    if (index < 0) {
      failures.push(`ROSTER_DIVISION: ${row.divisionId} has no named division in the format source.`);
      continue;
    }
    roster.push({ ...row, divisionId: divisions[index]!.id, memberIds: [...row.memberIds] });
    facts.push({
      id: `fact-${firstFactNumber + facts.length}`, path: `roster.${row.id}`, value: JSON.stringify(row),
      sourceHash, locator: `table:entrant_id=${row.id}`, quote: row.displayName, origin: "source",
    });
  }
  return { roster, facts, failures };
}
