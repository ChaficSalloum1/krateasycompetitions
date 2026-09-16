/**
 * Repository-level goal gate. This is intentionally orchestration rather than
 * product logic: each goal contributes focused rehearsal scripts while this
 * command records the repeatable shared checks and their exact seed/commit.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const value = (name: string): string | undefined => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const values = (name: string): string[] => args.flatMap((argument, index) => argument === name && args[index + 1] ? [args[index + 1]!] : []);
const goal = value("--goal");
const baseline = value("--baseline");
const seed = value("--seed") ?? "20260916";
const rehearsals = values("--rehearsal");
const evidencePath = value("--evidence") ?? resolve(root, "output/qa/goal-quality-gate.json");

if (!goal || !baseline) {
  console.error("Usage: npm run qa:goal-gate -- --goal <name> --baseline <commit> [--seed <seed>] [--rehearsal <npm-script>]...");
  process.exit(2);
}

type Result = { readonly label: string; readonly command: readonly string[]; readonly status: "PASSED" | "FAILED"; readonly output: string };

function run(label: string, command: string, commandArgs: readonly string[]): Promise<Result> {
  return new Promise((resolveResult) => {
    // Playwright CLI sessions can own and terminate their own process group.
    // Keep that lifecycle separate from the gate so a rehearsal cleanup cannot
    // terminate the parent before it writes the aggregate report.
    const rehearsal = label.startsWith("rehearsal:");
    const environment = { ...process.env, QA_SEED: seed };
    if (rehearsal) delete environment.EVIDENCE_PATH;
    const child = spawn(command, [...commandArgs], { cwd: root, env: environment, detached: false });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    child.on("error", (error) => resolveResult({ label, command: [command, ...commandArgs], status: "FAILED", output: `${output}${error.message}` }));
    child.on("exit", (code) => resolveResult({ label, command: [command, ...commandArgs], status: code === 0 ? "PASSED" : "FAILED", output }));
  });
}

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const checks: Array<[string, string, readonly string[]]> = [
  ["clean working tree", "git", ["status", "--short"]],
  ["diff whitespace", "git", ["diff", "--check", `${baseline}...HEAD`]],
  ["typescript", npm, ["run", "check"]],
  ["apple", npm, ["run", "check:apple"]],
  ["protocol model", npm, ["run", "stress:protocols"]],
  ...rehearsals.map((script) => [`rehearsal:${script}`, npm, ["run", script]] as [string, string, readonly string[]]),
];

const results: Result[] = [];
for (const [label, command, commandArgs] of checks) {
  const result = await run(label, command, commandArgs);
  results.push(result);
  if (label === "clean working tree" && result.status === "PASSED" && result.output.trim()) {
    results[results.length - 1] = { ...result, status: "FAILED", output: result.output };
  }
}
const head = await run("head", "git", ["rev-parse", "HEAD"]);
const report = {
  schemaVersion: "1.0",
  kind: "krateasy_goal_quality_gate",
  goal,
  baseline,
  commit: head.output.trim(),
  seed,
  rehearsals,
  status: results.every(({ status }) => status === "PASSED") ? "PASSED" : "FAILED",
  results: results.map(({ label, command, status, output }) => ({ label, command, status, output })),
};
await mkdir(dirname(evidencePath), { recursive: true });
await writeFile(evidencePath, JSON.stringify(report, null, 2) + "\n");
process.stdout.write(JSON.stringify({ ...report, evidencePath }, null, 2) + "\n");
if (report.status !== "PASSED") process.exitCode = 1;
