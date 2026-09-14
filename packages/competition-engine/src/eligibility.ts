import type { TournamentSpec, ValidationFinding, ValidationResult } from "@tournament-os/tournament-schema";
import type { Entrant } from "./types.js";

export type EntrantsByDivision = Readonly<Record<string, readonly Entrant[]>>;

const error = (
  code: string,
  path: string,
  message: string,
  evidence: Record<string, unknown>,
): ValidationFinding => ({ code, severity: "ERROR", path, message, evidence });

export function validateEligibility(
  spec: TournamentSpec,
  entrantsByDivision: EntrantsByDivision,
): ValidationResult {
  const findings: ValidationFinding[] = [];
  const divisionById = new Map(spec.divisions.map((division) => [division.id, division]));
  const divisionsByParticipant = new Map<string, Set<string>>();
  const expectedFixedRosterSize = spec.participants.rosterSize ?? spec.sport.teamSize;

  if (spec.participants.shape === "fixed_team") {
    const declaredSizes = [spec.participants.rosterSize, spec.sport.teamSize]
      .filter((size): size is number => size !== undefined);
    if (expectedFixedRosterSize === undefined || new Set(declaredSizes).size > 1) {
      findings.push(error(
        "TSC141",
        "/participants/rosterSize",
        "Fixed-team roster size must be explicit and agree with the sport adapter.",
        { participantRosterSize: spec.participants.rosterSize ?? null, sportTeamSize: spec.sport.teamSize ?? null },
      ));
    }
  }

  for (const divisionId of Object.keys(entrantsByDivision).sort()) {
    const entrants = [...(entrantsByDivision[divisionId] ?? [])].sort((left, right) => left.id.localeCompare(right.id));
    if (!divisionById.has(divisionId)) {
      findings.push(error(
        "TSC142",
        `/entrants/${divisionId}`,
        `Entrants were supplied for unknown division '${divisionId}'.`,
        { divisionId, knownDivisionIds: [...divisionById.keys()].sort() },
      ));
    }
    const entrantIdsByParticipant = new Map<string, string[]>();
    for (const entrant of entrants) {
      if (entrant.divisionId !== divisionId || !divisionById.has(entrant.divisionId)) {
        findings.push(error(
          "TSC142",
          `/entrants/${divisionId}/${entrant.id}/divisionId`,
          `Entrant '${entrant.id}' does not belong to its containing division '${divisionId}'.`,
          { entrantId: entrant.id, containingDivisionId: divisionId, declaredDivisionId: entrant.divisionId },
        ));
      }
      if (spec.participants.shape === "fixed_team" && expectedFixedRosterSize !== undefined && entrant.memberIds.length !== expectedFixedRosterSize) {
        findings.push(error(
          "TSC141",
          `/entrants/${divisionId}/${entrant.id}/memberIds`,
          `Fixed-team entrant '${entrant.id}' has ${entrant.memberIds.length} members; expected ${expectedFixedRosterSize}.`,
          { entrantId: entrant.id, divisionId, expectedRosterSize: expectedFixedRosterSize, actualRosterSize: entrant.memberIds.length },
        ));
      }
      const membershipIndexes = new Map<string, number[]>();
      entrant.memberIds.forEach((participantId, index) => {
        const indexes = membershipIndexes.get(participantId) ?? [];
        indexes.push(index);
        membershipIndexes.set(participantId, indexes);
      });
      for (const [participantId, indexes] of [...membershipIndexes].sort(([left], [right]) => left.localeCompare(right))) {
        if (indexes.length > 1) {
          findings.push(error(
            "TSC140",
            `/entrants/${divisionId}/${entrant.id}/memberIds`,
            `Participant '${participantId}' occupies multiple roster slots in entrant '${entrant.id}'.`,
            { participantId, divisionId, entrantId: entrant.id, membershipIndexes: indexes },
          ));
        }
      }
      for (const participantId of [...new Set(entrant.memberIds)].sort()) {
        const divisions = divisionsByParticipant.get(participantId) ?? new Set<string>();
        divisions.add(divisionId);
        divisionsByParticipant.set(participantId, divisions);
        const entrantIds = entrantIdsByParticipant.get(participantId) ?? [];
        entrantIds.push(entrant.id);
        entrantIdsByParticipant.set(participantId, entrantIds);
      }
    }
    for (const [participantId, entrantIds] of [...entrantIdsByParticipant].sort(([left], [right]) => left.localeCompare(right))) {
      if (entrantIds.length > 1) {
        findings.push(error(
          "TSC140",
          `/entrants/${divisionId}`,
          `Participant '${participantId}' belongs to multiple entrants in division '${divisionId}'.`,
          { participantId, divisionId, entrantIds },
        ));
      }
    }
  }

  for (const [participantId, divisions] of [...divisionsByParticipant].sort(([left], [right]) => left.localeCompare(right))) {
    const divisionIds = [...divisions].sort();
    if (divisionIds.length > 1) {
      findings.push(error(
        "TSC143",
        "/entrants",
        `Participant '${participantId}' is registered in multiple divisions without an explicit compatibility rule.`,
        { participantId, divisionIds },
      ));
    }
  }

  for (const stage of [...spec.stages].sort((left, right) => left.id.localeCompare(right.id))) {
    const division = divisionById.get(stage.divisionId);
    const expectedInputShapes = [...new Set([
      spec.participants.shape,
      spec.sport.participantUnit,
      ...(division ? [division.participantShape] : []),
    ])].sort();
    if (!division || expectedInputShapes.length !== 1 || stage.inputShape !== expectedInputShapes[0]) {
      findings.push(error(
        "TSC144",
        `/stages/${stage.id}/inputShape`,
        `Stage '${stage.id}' input is not compatible with its division and sport participant contracts.`,
        {
          stageId: stage.id,
          divisionId: stage.divisionId,
          actualInputShape: stage.inputShape,
          expectedInputShapes,
          divisionExists: division !== undefined,
        },
      ));
    }
  }

  return { valid: findings.length === 0, findings };
}
