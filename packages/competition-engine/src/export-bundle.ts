import { canonicalHash, canonicalStringify, deepFreeze, sha256, verifyCompiledHash } from "@tournament-os/tournament-schema";
import { analyzeParticipantPaths, type ParticipantPathProof } from "./analytics.js";
import { certify } from "./certification.js";
import { validateSchedule } from "./scheduler.js";
import type { ScenarioResult } from "./types.js";

export interface CertificationBundleOptions {
  baseName: string;
  generatedAt?: string;
}

export interface CertificationAuditPayload {
  formatVersion: "1.0.0";
  generatedAt: string;
  identity: {
    status: "CERTIFIED";
    specHash: string;
    graphHash: string;
    scheduleHash: string;
    simulationHash: string;
    certificationHash: string;
  };
  versions: {
    schema: string;
    compiler: string;
    rulesets: Record<string, string>;
    sportAdapter: string;
    solver: string;
    solverVersion: string;
  };
  certificationStatement: string;
  requirements: ScenarioResult["spec"]["requirements"];
  findings: ScenarioResult["certification"]["findings"];
  participantPaths: ParticipantPathProof[];
  scheduleAudit: ScenarioResult["schedule"]["audit"];
  replay: {
    sourcePromptHash: string;
    specId: string;
    specRevision: number;
    specCreatedAt: string;
    randomisation: ScenarioResult["spec"]["randomisation"];
    simulationSeed: string;
  };
}

export interface CertificationBundleArtifact {
  fileName: string;
  mediaType: string;
  content: string;
  sha256: string;
}

export interface CertificationAuditBundle {
  formatVersion: "1.0.0";
  baseName: string;
  generatedAt: string;
  markdown: CertificationBundleArtifact;
  json: CertificationBundleArtifact;
  bundleHash: string;
}

function markdownText(value: unknown): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("|", "\\|")
    .replace(/[\r\n]+/gu, " ");
}

function markdown(payload: CertificationAuditPayload): string {
  const lines = [
    "# TournamentOS Certification Audit Bundle",
    "",
    `Generated: ${markdownText(payload.generatedAt)}`,
    `Certification: ${payload.identity.status}`,
    `Certification hash: \`${payload.identity.certificationHash}\``,
    `Specification hash: \`${payload.identity.specHash}\``,
    `Graph hash: \`${payload.identity.graphHash}\``,
    `Schedule hash: \`${payload.identity.scheduleHash}\``,
    `Simulation hash: \`${payload.identity.simulationHash}\``,
    "",
    "## Versions",
    "",
    `- Schema: ${markdownText(payload.versions.schema)}`,
    `- Compiler: ${markdownText(payload.versions.compiler)}`,
    `- Sport adapter: ${markdownText(payload.versions.sportAdapter)}`,
    `- Solver: ${markdownText(payload.versions.solver)} ${markdownText(payload.versions.solverVersion)}`,
    ...Object.entries(payload.versions.rulesets).sort(([left], [right]) => left.localeCompare(right)).map(([name, version]) => `- Ruleset ${markdownText(name)}: ${markdownText(version)}`),
    "",
    "## Certification statement",
    "",
    markdownText(payload.certificationStatement),
    "",
    "## Requirements",
    "",
    "| ID | Strength | Status | Source requirement |",
    "| --- | --- | --- | --- |",
    ...payload.requirements.map((requirement) => `| ${markdownText(requirement.id)} | ${requirement.strength} | ${requirement.status} | ${markdownText(requirement.sourceText)} |`),
    "",
    "## Findings",
    "",
    ...(payload.findings.length
      ? ["| Code | Severity | Path | Message |", "| --- | --- | --- | --- |", ...payload.findings.map((finding) => `| ${finding.code} | ${finding.severity} | ${markdownText(finding.path)} | ${markdownText(finding.message)} |`)]
      : ["No certification findings."]),
    "",
    "## Participant paths",
    "",
    "| Entrant | Minimum contests | Maximum contests | Minimum group contests |",
    "| --- | ---: | ---: | ---: |",
    ...payload.participantPaths.map((path) => `| ${markdownText(path.entrantId)} | ${path.minimumContestCount} | ${path.maximumContestCount} | ${path.minimumGroupContestCount} |`),
    "",
    "## Replay metadata",
    "",
    `- Specification: ${markdownText(payload.replay.specId)} revision ${payload.replay.specRevision}`,
    `- Source prompt hash: \`${payload.replay.sourcePromptHash}\``,
    `- Simulation seed: \`${markdownText(payload.replay.simulationSeed)}\``,
    `- Solver status: ${payload.scheduleAudit.status}`,
    "",
  ];
  return lines.join("\n");
}

function assertScenarioProofs(scenario: ScenarioResult): void {
  if (!verifyCompiledHash(scenario.spec) || scenario.certification.specHash !== scenario.spec.metadata.compiledSpecHash) {
    throw new Error("Certified export rejected: specification hash is invalid");
  }
  if (scenario.certification.graphHash !== canonicalHash(scenario.graph)) {
    throw new Error("Certified export rejected: graph hash is invalid");
  }
  const { scheduleHash, validationHash: _validationHash, ...solverAudit } = scenario.schedule.audit;
  void _validationHash;
  const derivedScheduleHash = canonicalHash({ scheduled: scenario.schedule.contests, audit: solverAudit });
  if (!scheduleHash || scenario.certification.scheduleHash !== scheduleHash || scheduleHash !== derivedScheduleHash) {
    throw new Error("Certified export rejected: schedule hash is invalid");
  }
  if (!scenario.schedule.audit.validationHash
    || scenario.schedule.audit.validationHash !== canonicalHash(validateSchedule(scenario.spec, scenario.graph, scenario.schedule))) {
    throw new Error("Certified export rejected: validation hash is invalid");
  }
  if (!scenario.simulation) throw new Error("Certified export rejected: simulation hash is missing");
  const { hash: simulationHash, ...simulationProof } = scenario.simulation;
  if (scenario.certification.simulationHash !== simulationHash || simulationHash !== canonicalHash(simulationProof)) {
    throw new Error("Certified export rejected: simulation hash is invalid");
  }
  const { certificationHash, ...certificationProof } = scenario.certification;
  if (certificationHash !== canonicalHash(certificationProof)) {
    throw new Error("Certified export rejected: certification hash is invalid");
  }
  const independentlyCertified = certify(scenario.spec, scenario.graph, scenario.schedule, scenario.simulation);
  if (independentlyCertified.status !== "CERTIFIED" || independentlyCertified.certificationHash !== certificationHash) {
    throw new Error("Certified export rejected: independent certification did not reproduce the supplied proof");
  }
}

export function exportCertificationBundle(
  scenario: ScenarioResult,
  options: CertificationBundleOptions,
): Readonly<CertificationAuditBundle> {
  const safeBaseName = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,78}[A-Za-z0-9])?$/u.test(options.baseName)
    && !options.baseName.includes("..")
    && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/iu.test(options.baseName);
  if (!safeBaseName) throw new Error("Certification export requires a safe base name");
  if (scenario.certification.status !== "CERTIFIED") throw new Error("Only certified scenarios may be exported");
  if (!scenario.certification.scheduleHash || !scenario.certification.simulationHash || !scenario.simulation) {
    throw new Error("Certified export requires schedule and simulation proof hashes");
  }
  assertScenarioProofs(scenario);
  const generatedInstant = Date.parse(options.generatedAt ?? scenario.spec.metadata.createdAt);
  if (!Number.isFinite(generatedInstant)) throw new Error("Certification export generatedAt must be a valid timestamp");
  const generatedAt = new Date(generatedInstant).toISOString();
  const payload: CertificationAuditPayload = {
    formatVersion: "1.0.0",
    generatedAt,
    identity: {
      status: "CERTIFIED",
      specHash: scenario.certification.specHash,
      graphHash: scenario.certification.graphHash,
      scheduleHash: scenario.certification.scheduleHash,
      simulationHash: scenario.certification.simulationHash,
      certificationHash: scenario.certification.certificationHash,
    },
    versions: {
      schema: scenario.spec.metadata.schemaVersion,
      compiler: scenario.spec.metadata.compilerVersion,
      rulesets: structuredClone(scenario.spec.metadata.rulesetVersions),
      sportAdapter: scenario.spec.sport.adapterVersion,
      solver: scenario.schedule.audit.solver,
      solverVersion: scenario.schedule.audit.version,
    },
    certificationStatement: scenario.certification.statement,
    requirements: structuredClone(scenario.spec.requirements),
    findings: structuredClone(scenario.certification.findings),
    participantPaths: analyzeParticipantPaths(scenario.graph),
    scheduleAudit: structuredClone(scenario.schedule.audit),
    replay: {
      sourcePromptHash: scenario.spec.metadata.sourcePromptHash,
      specId: scenario.spec.metadata.specId,
      specRevision: scenario.spec.metadata.revision,
      specCreatedAt: scenario.spec.metadata.createdAt,
      randomisation: structuredClone(scenario.spec.randomisation),
      simulationSeed: scenario.simulation.seed,
    },
  };
  const jsonContent = canonicalStringify(payload);
  const markdownContent = markdown(payload);
  const partial: Omit<CertificationAuditBundle, "bundleHash"> = {
    formatVersion: "1.0.0",
    baseName: options.baseName,
    generatedAt,
    markdown: {
      fileName: `${options.baseName}.certification.md`, mediaType: "text/markdown; charset=utf-8",
      content: markdownContent, sha256: sha256(markdownContent),
    },
    json: {
      fileName: `${options.baseName}.certification.json`, mediaType: "application/json",
      content: jsonContent, sha256: sha256(jsonContent),
    },
  };
  return deepFreeze({ ...partial, bundleHash: canonicalHash(partial) });
}
