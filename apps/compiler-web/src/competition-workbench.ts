import { createHash } from "node:crypto";
import { canonicalHash, semanticDiff, type SemanticChange } from "@tournament-os/tournament-schema";
import type { CreationSource } from "./creation-proposal.js";

export interface WorkbenchSourceDocument {
  readonly id: string;
  readonly kind: CreationSource["mode"];
  readonly mediaType: "application/json" | "text/plain";
  readonly original: unknown;
  readonly sourceHash: string;
  readonly receivedAt: string;
}

export interface WorkbenchFact {
  readonly id: string;
  readonly path: string;
  readonly value: unknown;
  readonly provenance: readonly { sourceId: string; sourceHash: string; sourcePath: string }[];
}

export interface WorkbenchRule extends WorkbenchFact {
  readonly kind: "EXPLICIT_SOURCE_RULE" | "ORGANISER_DECISION";
}

export interface WorkbenchDecision {
  readonly id: string;
  readonly path: string;
  readonly prompt: string;
  readonly critical: true;
}

export interface CompetitionWorkbenchProjection {
  readonly sources: readonly WorkbenchSourceDocument[];
  readonly understoodFacts: readonly WorkbenchFact[];
  readonly rules: readonly WorkbenchRule[];
  readonly assumptions: readonly WorkbenchRule[];
  readonly conflicts: readonly { id: string; paths: readonly string[]; description: string }[];
  readonly missingDecisions: readonly WorkbenchDecision[];
  readonly unsupportedSemantics: readonly { id: string; path: string; description: string; blocking: boolean }[];
  readonly untrustedClaims: readonly {
    id: string;
    sourceId: string;
    sourcePath: string;
    claim: unknown;
    authority: "SOURCE_ASSERTION_ONLY";
  }[];
  readonly definitionVersion: number;
  readonly pendingImpact: null | {
    readonly previewHash: string;
    readonly semantic: readonly SemanticChange[];
    readonly operational: readonly string[];
  };
}

export interface StructuredWorkbenchEdit { readonly id: string; readonly value: string; }
export interface StructuredWorkbenchEditPreview {
  readonly expectedDraftVersion: number;
  readonly editedBy: string;
  readonly edits: readonly StructuredWorkbenchEdit[];
  readonly semanticDiff: readonly SemanticChange[];
  readonly operationalImpact: readonly string[];
  readonly previewHash: string;
}

const registeredDecisionValues: Readonly<Record<string, (value: string) => boolean>> = {
  "event-name": (value) => value.trim().length >= 2 && value.trim().length <= 120,
  qualification: (value) => value === "top_four_konnect_remainder_tower",
  scoring: (value) => value === "padel.timed.standard@1.0.0",
  tiebreak: (value) => value === "wins_game_difference_games_won_head_to_head_manual",
  normalisation: (value) => value === "percentage",
  withdrawal: (value) => value === "preserve_played_walkover_future",
  "approval-authority": (value) => value === "separate_compiler_approver_publisher",
  "event-date": (value) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)),
  timezone: (value) => value === "Europe/London",
};

const optionalDecisionPaths: Readonly<Record<string, string>> = {
  "event-name": "/identity/name",
};

const requiredDecisions: readonly WorkbenchDecision[] = [
  { id: "qualification", path: "/qualificationPolicies", prompt: "Who enters Konnect and Tower from each pool?", critical: true },
  { id: "scoring", path: "/scoringSystems", prompt: "Which scoring rules apply to each match type?", critical: true },
  { id: "tiebreak", path: "/standingsPolicies/*/metricOrder", prompt: "How are tied pool standings resolved?", critical: true },
  { id: "normalisation", path: "/qualificationPolicies/*/normalization", prompt: "How are unequal pool sizes compared?", critical: true },
  { id: "withdrawal", path: "/operationalPolicies/withdrawal", prompt: "How should a no-show or withdrawal affect played and future matches?", critical: true },
  { id: "approval-authority", path: "/authority/publication", prompt: "Which separate roles may compile, approve, and publish?", critical: true },
  { id: "event-date", path: "/scheduling/start", prompt: "On which date does this competition run?", critical: true },
  { id: "timezone", path: "/scheduling/timezone", prompt: "Which IANA timezone governs the schedule?", critical: true },
] as const;

function sourceOriginal(source: CreationSource): unknown {
  return source.mode === "quick" ? structuredClone(source.value) : source.text;
}

function hashOriginal(source: CreationSource): string {
  if (source.mode === "quick") return canonicalHash(source.value);
  return createHash("sha256").update(source.text, "utf8").digest("hex");
}

function documentFor(source: CreationSource, receivedAt: string): WorkbenchSourceDocument {
  const sourceHash = hashOriginal(source);
  return {
    id: `source.${sourceHash.slice(0, 16)}`,
    kind: source.mode,
    mediaType: source.mode === "json" ? "application/json" : "text/plain",
    original: sourceOriginal(source),
    sourceHash,
    receivedAt,
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function jsonValue(source: CreationSource): unknown {
  if (source.mode === "quick") return source.value;
  if (source.mode !== "json") return null;
  try { return JSON.parse(source.text); } catch { return null; }
}

function stAlbansShape(value: unknown): null | {
  event: string;
  rules: Record<string, unknown>;
  pools: Record<string, unknown>;
  schedule: readonly Record<string, unknown>[];
  finalCourtAssignments: Record<string, unknown>;
  audit: readonly unknown[];
} {
  const root = record(value); if (!root || typeof root.event !== "string") return null;
  const rules = record(root.rules); const pools = record(root.pools); const finals = record(root.finalCourtAssignments);
  if (!rules || !pools || !finals || !Array.isArray(root.schedule) || !Array.isArray(root.audit)) return null;
  const schedule = root.schedule.map(record);
  if (schedule.some((entry) => entry === null)) return null;
  if (!Array.isArray(rules.courts_11_12)) return null;
  return { event: root.event, rules, pools, schedule: schedule as Record<string, unknown>[], finalCourtAssignments: finals, audit: root.audit };
}

function provenance(source: WorkbenchSourceDocument, sourcePath: string) {
  return [{ sourceId: source.id, sourceHash: source.sourceHash, sourcePath }];
}

function fact(source: WorkbenchSourceDocument, id: string, path: string, value: unknown, sourcePath: string): WorkbenchFact {
  return { id, path, value, provenance: provenance(source, sourcePath) };
}

function rule(source: WorkbenchSourceDocument, id: string, path: string, value: unknown, sourcePath: string): WorkbenchRule {
  return { ...fact(source, id, path, value, sourcePath), kind: "EXPLICIT_SOURCE_RULE" };
}

function analyseStAlbans(source: WorkbenchSourceDocument, shaped: NonNullable<ReturnType<typeof stAlbansShape>>): CompetitionWorkbenchProjection {
  const poolSizes = Object.values(shaped.pools).flatMap((division) => {
    const pools = record(division);
    return pools ? Object.values(pools).map((entrants) => Array.isArray(entrants) ? entrants.length : 0) : [];
  });
  const groupFixtures = shaped.schedule.filter(({ stage }) => stage === "Group").length;
  const knockoutFixtures = shaped.schedule.length - groupFixtures;
  const expectedGroupFixtures = poolSizes.reduce((sum, size) => sum + size * (size - 1) / 2, 0);
  const expectedKnockoutFixtures = poolSizes.reduce((sum, size) => sum + size, 0) - Object.keys(shaped.pools).length * 2;
  const earlyCourts = Array.isArray(shaped.rules.courts_11_12) ? shaped.rules.courts_11_12 : [];
  const mainCourts = Array.isArray(shaped.rules.courts_12_20) ? shaped.rules.courts_12_20 : [];
  const paths = [...new Set(shaped.schedule.map(({ stage }) => stage).filter((stage): stage is string =>
    typeof stage === "string" && stage !== "Group"))].sort();
  const understoodFacts = [
    fact(source, "entrants.total", "/participants/count", poolSizes.reduce((sum, size) => sum + size, 0), "/pools"),
    fact(source, "fixtures.group", "/derived/fixtureCounts/group", groupFixtures, "/schedule/*/stage"),
    fact(source, "fixtures.knockout", "/derived/fixtureCounts/knockout", knockoutFixtures, "/schedule/*/stage"),
    fact(source, "fixtures.total", "/derived/fixtureCounts/total", shaped.schedule.length, "/schedule"),
    fact(source, "pools.total", "/derived/poolCount", poolSizes.length, "/pools"),
  ];
  const rules = [
    rule(source, "resource.availability", "/resources", [
      { courts: earlyCourts, from: "11:00", to: "12:00" },
      { courts: mainCourts, from: "12:00", to: String(shaped.rules.hardStop ?? "") },
    ], "/rules/courts_11_12,/rules/courts_12_20,/rules/hardStop"),
    rule(source, "progression.paths", "/competitionStructures", paths, "/schedule/*/stage"),
    rule(source, "match.durations", "/scheduling/durations", {
      regular: shaped.rules.regularMatchMinutes,
      konnectSemi: shaped.rules.AIKonnectSemiMinutes,
      konnectFinal: shaped.rules.AIKonnectFinalMinutes,
      towerSemi: shaped.rules.AITowerSemiFinalMinutes,
      towerFinal: shaped.rules.AITowerFinalMinutes,
      beginnerKnockout: shaped.rules.beginnerKnockoutMinutes,
    }, "/rules"),
    rule(source, "final.courts", "/scheduling/finalCourtRequirements", shaped.finalCourtAssignments, "/finalCourtAssignments"),
    rule(source, "schedule.hard-stop", "/scheduling/finishBy", shaped.rules.hardStop, "/rules/hardStop"),
  ];
  const conflicts: CompetitionWorkbenchProjection["conflicts"][number][] = [];
  if (groupFixtures !== expectedGroupFixtures) conflicts.push({ id: "conflict.fixture-count.group", paths: ["/pools", "/schedule"],
    description: `The pools require ${expectedGroupFixtures} group fixtures but the supplied schedule contains ${groupFixtures}.` });
  if (knockoutFixtures !== expectedKnockoutFixtures) conflicts.push({ id: "conflict.fixture-count.knockout", paths: ["/pools", "/schedule"],
    description: `The Konnect/Tower paths require ${expectedKnockoutFixtures} fixtures but the supplied schedule contains ${knockoutFixtures}.` });
  for (const [label, requiredCourt] of Object.entries(shaped.finalCourtAssignments)) {
    const [division, path] = label.split(" ");
    const supplied = shaped.schedule.find(({ division: suppliedDivision, stage, id }) =>
      String(suppliedDivision).toLowerCase().startsWith(String(division).toLowerCase().replace(/s$/, ""))
      && stage === path && typeof id === "string" && id.endsWith("-F"));
    if (!supplied || `C${supplied.court}` !== String(requiredCourt)) conflicts.push({ id: `conflict.final-court.${label}`,
      paths: ["/finalCourtAssignments", "/schedule"], description: `${label} is not scheduled on required court ${String(requiredCourt)}.` });
  }
  return {
    sources: [source], understoodFacts, rules, assumptions: [], conflicts,
    missingDecisions: requiredDecisions,
    unsupportedSemantics: [],
    untrustedClaims: shaped.audit.map((claim, index) => ({ id: `source-claim.${index + 1}`, sourceId: source.id,
      sourcePath: `/audit/${index}`, claim, authority: "SOURCE_ASSERTION_ONLY" as const })),
    definitionVersion: 1, pendingImpact: null,
  };
}

export function analyseCompetitionSources(sources: readonly CreationSource[], receivedAt: string): CompetitionWorkbenchProjection {
  const documents = sources.map((source, index) => {
    const document = documentFor(source, receivedAt);
    return { ...document, id: `${document.id}.${index + 1}` };
  });
  const primarySource = sources[0]; const primaryDocument = documents[0];
  if (primarySource && primaryDocument) {
    const shaped = stAlbansShape(jsonValue(primarySource));
    if (shaped) {
      const primary = analyseStAlbans(primaryDocument, shaped);
      const facts = primary.understoodFacts.map((entry) => ({ ...entry, provenance: [...entry.provenance] }));
      const rules = primary.rules.map((entry) => ({ ...entry, provenance: [...entry.provenance] }));
      const conflicts: CompetitionWorkbenchProjection["conflicts"][number][] = [...primary.conflicts];
      const claims = [...primary.untrustedClaims];
      for (let index = 1; index < sources.length; index += 1) {
        const candidateShape = stAlbansShape(jsonValue(sources[index]!)); if (!candidateShape) continue;
        const candidate = analyseStAlbans(documents[index]!, candidateShape);
        for (const current of [...facts, ...rules]) {
          const incoming = [...candidate.understoodFacts, ...candidate.rules].find(({ id }) => id === current.id);
          if (!incoming) continue;
          if (canonicalHash(current.value) === canonicalHash(incoming.value)) current.provenance.push(...incoming.provenance);
          else conflicts.push({ id: `conflict.${current.id}.${index + 1}`, paths: [current.path],
            description: `Source ${documents[index]!.id} disagrees with ${primaryDocument.id} about ${current.id}.` });
        }
        claims.push(...candidate.untrustedClaims);
      }
      return { ...primary, sources: documents, understoodFacts: facts, rules, conflicts, untrustedClaims: claims };
    }
  }
  return { sources: documents, understoodFacts: [], rules: [], assumptions: [], conflicts: [], missingDecisions: [],
    unsupportedSemantics: [], untrustedClaims: [], definitionVersion: 1, pendingImpact: null };
}

function decisionMap(projection: CompetitionWorkbenchProjection): Record<string, string> {
  return Object.fromEntries(projection.assumptions.map(({ id, value }) => [id, String(value)]));
}

function operationalImpact(edits: readonly StructuredWorkbenchEdit[]): string[] {
  const ids = new Set(edits.map(({ id }) => id));
  const impacts: string[] = [];
  if (["qualification", "normalisation", "scoring", "tiebreak"].some((id) => ids.has(id)))
    impacts.push("Changes competition semantics and requires graph, schedule, simulation and Guard regeneration.");
  if (["event-date", "timezone"].some((id) => ids.has(id)))
    impacts.push("Changes the operating calendar and requires a 108-fixture recompilation against court availability and the hard stop.");
  if (ids.has("event-name")) impacts.push("Changes the edition label while retaining the source competition memory and immutable prior event.");
  if (ids.has("withdrawal")) impacts.push("Changes live disruption adjudication and repair behaviour; completed results remain immutable.");
  if (ids.has("approval-authority")) impacts.push("Changes who may approve and publish; proposer self-approval remains prohibited.");
  return impacts;
}

export function planWorkbenchEdit(projection: CompetitionWorkbenchProjection, expectedDraftVersion: number,
  edits: readonly StructuredWorkbenchEdit[], editedBy: string): StructuredWorkbenchEditPreview {
  if (!editedBy.trim() || edits.length === 0) throw new Error("invalid_structured_edit");
  if (new Set(edits.map(({ id }) => id)).size !== edits.length) throw new Error("duplicate_structured_decision");
  for (const edit of edits) if (!registeredDecisionValues[edit.id]?.(edit.value))
    throw new Error(`unsupported_structured_decision:${edit.id}`);
  const before = decisionMap(projection);
  const after = { ...before, ...Object.fromEntries(edits.map(({ id, value }) => [id, value])) };
  const semantic = semanticDiff(before, after).map((change) => {
    const key = change.path.slice(1);
    const registered = requiredDecisions.find(({ id }) => id === key);
    const path = registered?.path ?? optionalDecisionPaths[key];
    return path ? { ...change, path } : change;
  });
  const body = { expectedDraftVersion, editedBy, edits: [...edits].sort((a, b) => a.id.localeCompare(b.id)),
    semanticDiff: semantic, operationalImpact: operationalImpact(edits) };
  return { ...body, previewHash: canonicalHash(body) };
}

export function applyWorkbenchEdit(projection: CompetitionWorkbenchProjection, preview: StructuredWorkbenchEditPreview,
  source: WorkbenchSourceDocument): CompetitionWorkbenchProjection {
  const indexedSource = { ...source, id: `${source.id}.${projection.sources.length + 1}` };
  const decisions = { ...decisionMap(projection), ...Object.fromEntries(preview.edits.map(({ id, value }) => [id, value])) };
  const assumptions = Object.entries(decisions).sort(([left], [right]) => left.localeCompare(right)).map(([id, value]) => {
    const path = requiredDecisions.find((decision) => decision.id === id)?.path ?? optionalDecisionPaths[id];
    if (!path) throw new Error(`unsupported_structured_decision:${id}`);
    return { id, path, value, provenance: provenance(indexedSource, `/edits/${id}`), kind: "ORGANISER_DECISION" as const };
  });
  return { ...projection, sources: [...projection.sources, indexedSource], assumptions,
    missingDecisions: requiredDecisions.filter(({ id }) => !(id in decisions)),
    definitionVersion: projection.definitionVersion + 1, pendingImpact: null };
}

export function workbenchSourceDocument(source: CreationSource, receivedAt: string): WorkbenchSourceDocument {
  return documentFor(source, receivedAt);
}

export function workbenchDecisionValues(projection: CompetitionWorkbenchProjection): Readonly<Record<string, string>> {
  return decisionMap(projection);
}

export function rebaseWorkbenchSources(projection: CompetitionWorkbenchProjection, sources: readonly CreationSource[],
  receivedAt: string): CompetitionWorkbenchProjection {
  const rebased = analyseCompetitionSources(sources, receivedAt);
  const decisions = decisionMap(projection);
  const preservedSources = rebased.sources.map((source, index) => projection.sources[index] ?? source);
  return { ...rebased, sources: preservedSources, assumptions: projection.assumptions,
    missingDecisions: requiredDecisions.filter(({ id }) => !(id in decisions)),
    definitionVersion: projection.definitionVersion + 1 };
}

export function recognisedCompetitionName(projection: CompetitionWorkbenchProjection): string | null {
  const editedName = decisionMap(projection)["event-name"];
  if (editedName) return editedName;
  const source = projection.sources[0];
  if (!source || source.kind !== "json" || typeof source.original !== "string") return null;
  try { const root = record(JSON.parse(source.original)); return typeof root?.event === "string" ? root.event : null; }
  catch { return null; }
}
