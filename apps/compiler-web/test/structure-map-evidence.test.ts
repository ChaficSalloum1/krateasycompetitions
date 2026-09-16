import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { playAndKonnectDefinition } from "@tournament-os/tournament-schema/example";
import type { TournamentDefinition } from "@tournament-os/tournament-schema";
import { projectCompetitionStructureMap } from "../src/competition-journey.js";
import { renderStructureMapEvidence } from "../src/organiser-studio-view.js";

type WarningCode = "INVALID_EDGE" | "INCOMPLETE_EDGE" | "CONSEQUENTIAL_EDGE";
type WarningFixture = {
  readonly code: WarningCode;
  readonly edgeId: string;
  readonly mutation: "OUTPUT_COUNT_MISMATCH" | "REMOVE_NORMALIZATION" | "NONE";
};

const warningFixtures = JSON.parse(readFileSync(new URL("./fixtures/structure-edge-warning-cases.json", import.meta.url), "utf8")) as WarningFixture[];

function definitionFor(fixture: WarningFixture): TournamentDefinition {
  const definition = structuredClone(playAndKonnectDefinition);
  const index = definition.qualificationPolicies.findIndex(({ id }) => id === fixture.edgeId);
  assert.notEqual(index, -1, `fixture edge ${fixture.edgeId} must exist`);
  const edge = definition.qualificationPolicies[index]!;
  if (fixture.mutation === "OUTPUT_COUNT_MISMATCH") {
    definition.qualificationPolicies[index] = { ...edge, outputCount: edge.outputCount + 1 };
  } else if (fixture.mutation === "REMOVE_NORMALIZATION") {
    const { normalization: _normalization, ...withoutNormalization } = edge;
    definition.qualificationPolicies[index] = withoutNormalization;
  }
  return definition;
}

for (const fixture of warningFixtures) test(`${fixture.code} stays attached to stable edge ${fixture.edgeId} and renders in Organiser Studio`, () => {
  const map = projectCompetitionStructureMap(definitionFor(fixture), null);
  const affected = map.edges.find(({ id }) => id === fixture.edgeId);
  assert.ok(affected);
  assert.ok(affected.warnings.some(({ code }) => code === fixture.code));

  const markup = renderStructureMapEvidence(map);
  const edgeStart = markup.indexOf(`data-edge-id="${fixture.edgeId}"`);
  const nextEdge = markup.indexOf('data-edge-id="', edgeStart + 1);
  const affectedMarkup = markup.slice(edgeStart, nextEdge < 0 ? undefined : nextEdge);
  assert.notEqual(edgeStart, -1);
  assert.match(affectedMarkup, new RegExp(`data-warning-code="${fixture.code}"`));
  assert.match(affectedMarkup, new RegExp(`<code>${fixture.edgeId}</code>`));
});

test("a complete structure with no qualification edges is not labelled incomplete", () => {
  const definition = structuredClone(playAndKonnectDefinition);
  definition.qualificationPolicies = [];
  definition.competitionStructures = [];
  const markup = renderStructureMapEvidence(projectCompetitionStructureMap(definition, null));
  assert.match(markup, /This canonical structure has no qualification edges\./);
  assert.doesNotMatch(markup, /until the canonical definition is complete/);
});
