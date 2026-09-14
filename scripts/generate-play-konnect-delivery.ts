import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { compileDefinition, canonicalHash, type TournamentSpec } from "@tournament-os/tournament-schema";
import { playAndKonnectDefinition } from "@tournament-os/tournament-schema/example";
import {
  auditScheduleQuality,
  certify,
  createEntrants,
  runScenario,
  solveGraphWithCpSat,
} from "../packages/competition-engine/src/index.js";

const context = {
  specId: "play-and-konnect.delivery.v1", revision: 1, schemaVersion: "1.0.0", compilerVersion: "1.0.0",
  rulesetVersions: { padel: "1.0.0", competition: "1.0.0" }, sourcePrompt: "PLAY_AND_KONNECT_TOURNAMENT_SPECIFICATION.md",
  createdAt: "2026-09-05T09:00:00Z",
};
const spec = compileDefinition(structuredClone(playAndKonnectDefinition), context) as TournamentSpec;
const baseline = runScenario(spec, createEntrants(spec), "play-konnect-delivery-v1");
if (baseline.certification.status !== "CERTIFIED") throw new Error("Baseline reference scenario did not certify.");
const cpSat = solveGraphWithCpSat(spec, baseline.graph, { maxTimeSeconds: 30 });
if (!cpSat.solution || (cpSat.status !== "OPTIMAL" && cpSat.status !== "FEASIBLE")) {
  throw new Error(`CP-SAT did not return an independently valid schedule: ${cpSat.status}`);
}
const certification = certify(spec, baseline.graph, cpSat.solution, baseline.simulation);
if (certification.status !== "CERTIFIED") throw new Error("CP-SAT schedule failed full scenario certification.");
const quality = auditScheduleQuality(spec, baseline.graph, cpSat.solution);
if (quality.status !== "CERTIFIED") throw new Error("CP-SAT schedule failed quality audit.");

const nodeById = new Map(baseline.graph.nodes.map((node) => [node.id, node]));
const formatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: spec.scheduling.timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});
const local = (value: string): string => formatter.format(new Date(value)).replace(",", "");
const rows = [...cpSat.solution.contests]
  .sort((left, right) => Date.parse(left.start) - Date.parse(right.start) || left.resourceId.localeCompare(right.resourceId))
  .map((entry) => {
    const node = nodeById.get(entry.contestId)!;
    return {
      startLocal: local(entry.start), endLocal: local(entry.end), startUtc: entry.start, endUtc: entry.end,
      court: entry.resourceId, division: node.divisionId, stage: node.stageId, round: node.round,
      contestId: entry.contestId, possibleEntrantIds: [...entry.possibleEntrantIds],
    };
  });
const payload = {
  generatedAt: "2026-09-07T00:00:00.000Z",
  sourceSpecification: "/Users/chaficsalloum/Downloads/PLAY_AND_KONNECT_TOURNAMENT_SPECIFICATION.md",
  timezone: spec.scheduling.timezone,
  status: { scenario: certification.status, schedule: cpSat.status, quality: quality.status },
  counts: { entrants: spec.participants.count, contests: rows.length, courts: spec.resources[0]!.quantity, courtMinutes: 3_080 },
  timing: {
    opening: spec.scheduling.start, targetFinish: spec.scheduling.finishBy,
    actualFinish: rows.reduce((latest, row) => row.endUtc > latest ? row.endUtc : latest, rows[0]!.endUtc),
    makespanMinutes: quality.metrics.makespanMinutes,
    independentlyVerifiedLowerBoundMinutes: cpSat.solution.audit.lowerBoundMinutes,
    provenGapMinutes: quality.metrics.makespanMinutes - cpSat.solution.audit.lowerBoundMinutes,
  },
  quality: quality.metrics,
  proofs: {
    specHash: spec.metadata.compiledSpecHash, graphHash: certification.graphHash, scheduleHash: cpSat.solution.audit.scheduleHash,
    validationHash: cpSat.solution.audit.validationHash, certificationHash: certification.certificationHash,
    scheduleQualityHash: quality.proofHash, cpSatAdapterHash: cpSat.proofHash, backendProofHash: cpSat.cpSat!.proof.proofHash,
  },
  solver: { status: cpSat.status, backend: cpSat.cpSat!.proof.backendVersion, objective: cpSat.cpSat!.objective,
    independentlyValidatedFindings: cpSat.validationFindings },
  requirements: quality.requirementCoverage,
  schedule: rows,
};
const outputDirectory = join(process.cwd(), "outputs"); mkdirSync(outputDirectory, { recursive: true });
writeFileSync(join(outputDirectory, "play-and-konnect-certified-schedule.json"), `${JSON.stringify(payload, null, 2)}\n`);
const quote = (value: unknown): string => `"${String(value).replaceAll('"', '""')}"`;
const header = ["start_local", "end_local", "court", "division", "stage", "round", "contest_id", "possible_entrants"];
const csv = [header.map(quote).join(","), ...rows.map((row) => [row.startLocal, row.endLocal, row.court, row.division, row.stage,
  row.round, row.contestId, row.possibleEntrantIds.join("|")].map(quote).join(","))].join("\n");
writeFileSync(join(outputDirectory, "play-and-konnect-certified-schedule.csv"), `${csv}\n`);
writeFileSync(join(outputDirectory, "play-and-konnect-certified-schedule.sha256"), `${canonicalHash(payload)}\n`);
console.log(JSON.stringify({ status: payload.status, counts: payload.counts, timing: payload.timing, quality: payload.quality,
  proofs: payload.proofs, artifactHash: canonicalHash(payload) }, null, 2));
