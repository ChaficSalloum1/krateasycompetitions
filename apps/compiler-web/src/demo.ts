import { compileDefinition } from "@tournament-os/tournament-schema";
import { playAndKonnectDefinition } from "@tournament-os/tournament-schema/example";
import { createEntrants, runScenario, simulateOperationalRisk } from "@tournament-os/competition-engine";

export function runReferenceDemo() {
  const spec = compileDefinition(structuredClone(playAndKonnectDefinition), {
    specId: "play-and-konnect.2026", revision: 1, schemaVersion: "1.0.0", compilerVersion: "0.1.0",
    rulesetVersions: { padel: "1.0.0", competition: "1.0.0" }, sourcePrompt: "Play & Konnect reference benchmark",
    createdAt: "2026-09-05T09:00:00Z",
  });
  const scenario = runScenario(spec as never, createEntrants(spec as never), "pk-reference-seed");
  const risk = simulateOperationalRisk(scenario.schedule, { iterations: 1000, seed: "pk-risk-seed", durationStdDevFraction: 0.2 });
  return { scenario, risk };
}

if (process.argv[1]?.endsWith("demo.ts") || process.argv[1]?.endsWith("demo.js")) {
  const { scenario, risk } = runReferenceDemo();
  console.log(JSON.stringify({
    certification: scenario.certification.status,
    contests: scenario.graph.generatedActualContestCount,
    scheduled: scenario.schedule.contests.length,
    solverStatus: scenario.schedule.audit.status,
    finishMinutes: scenario.schedule.audit.objectiveValueMinutes,
    findings: scenario.certification.findings,
    operationalRisk: risk,
  }, null, 2));
}
