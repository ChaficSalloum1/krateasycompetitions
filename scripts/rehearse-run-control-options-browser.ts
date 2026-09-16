/**
 * Checked-in, local-only browser rehearsal for the two authoritative no-show
 * options. It uses the Playwright CLI so the browser remains outside product
 * code, writes machine-readable evidence, and never contacts a provider.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const evidencePath = process.env.EVIDENCE_PATH ?? join(root, "output/playwright/run-control-no-show-option-hash-rehearsal.json");
const cli = process.env.KRATEASY_PLAYWRIGHT_CLI
  ?? join(process.env.CODEX_HOME ?? join(process.env.HOME ?? "", ".codex"), "skills/playwright/scripts/playwright_cli.sh");

function run(command: string, args: string[], environment: NodeJS.ProcessEnv = process.env): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, env: environment });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 && !output.includes("### Error") ? resolve(output) : reject(new Error(output || `command failed (${code})`)));
  });
}

function firstJsonLine(output: string): { organiserUrl: string } {
  const line = output.split("\n").find((candidate) => candidate.startsWith("{"));
  if (!line) throw new Error(`fixture_did_not_emit_url:${output}`);
  return JSON.parse(line) as { organiserUrl: string };
}

async function startFixture(): Promise<{ organiserUrl: string; stop: () => void }> {
  const child = spawn(process.execPath, ["--import", "tsx", "scripts/serve-run-control-options.ts"], {
    cwd: root, env: { ...process.env, PORT: "0" }, stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  const organiserUrl = await new Promise<string>((resolve, reject) => {
    const accept = (chunk: Buffer) => {
      output += chunk.toString();
      try { resolve(firstJsonLine(output).organiserUrl); } catch { /* wait for complete line */ }
    };
    child.stdout.on("data", accept);
    child.stderr.on("data", (chunk) => { output += chunk.toString(); });
    child.on("error", reject);
    child.on("exit", (code) => reject(new Error(output || `fixture exited (${code})`)));
  });
  return { organiserUrl, stop: () => child.kill("SIGTERM") };
}

function ref(snapshot: string, text: string): string {
  const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = snapshot.match(new RegExp(`${escaped}[^\\n]*\\[ref=(e\\d+)\\]`));
  if (!match) throw new Error(`missing_browser_ref:${text}`);
  return match[1]!;
}

function cliResult(output: string): string {
  const parsed = JSON.parse(output) as { result?: string };
  if (typeof parsed.result !== "string") throw new Error(`missing_cli_result:${output}`);
  return parsed.result;
}

async function runOption(strategy: "KEEP_ANNOUNCED_SLOTS" | "RELEASE_WALKOVER_SLOTS", index: number) {
  const fixture = await startFixture();
  const session = `run-control-option-${index}-${process.pid}`;
  const invoke = (args: string[]) => run(cli, ["--session", session, ...args]);
  try {
    await invoke(["open", fixture.organiserUrl]);
    await invoke(["press", "End"]);
    const initial = await invoke(["snapshot"]);
    await invoke(["click", ref(initial, "Generate Guarded consequence review")]);
    const review = await invoke(["snapshot"]);
    const approveRef = ref(review, "Approve selected exact Guarded change");
    const approvalDisabledBeforeSelection = review.includes(`button \"Approve selected exact Guarded change\" [disabled] [ref=${approveRef}]`);
    if (!approvalDisabledBeforeSelection) throw new Error("approval_was_not_disabled_before_selection");
    const optionRef = ref(review, `Option ${index + 1} · ${strategy}`);
    const radioValues = cliResult(await invoke(["--json", "eval", "JSON.stringify([...document.querySelectorAll('[name=guarded-option]')].map(input=>input.value))"]));
    const optionHashes = JSON.parse(JSON.parse(radioValues) as string) as string[];
    const selectedOptionHash = optionHashes[index];
    if (!selectedOptionHash || optionHashes.length !== 2) throw new Error("missing_authoritative_option_hashes");
    await invoke(["click", optionRef]);
    const selected = await invoke(["snapshot"]);
    if (selected.includes(`button \"Approve selected exact Guarded change\" [disabled]`)) throw new Error("approval_remained_disabled_after_selection");
    await invoke(["click", approveRef]);
    const published = await invoke(["snapshot"]);
    const url = JSON.parse(cliResult(await invoke(["--json", "eval", "document.location.href"]))) as string;
    if (!url.includes("revision=2") || !published.includes("operational revision 2")) throw new Error("approval_did_not_publish_operational_revision_2");
    const requests = cliResult(await invoke(["--json", "requests"]));
    const requestIndex = requests.match(/(\d+)\. \[POST\].*no-show-approve/)?.[1];
    if (!requestIndex) throw new Error("approval_request_not_observed");
    const requestBody = JSON.parse(cliResult(await invoke(["--json", "request-body", requestIndex]))) as Record<string, unknown>;
    if (requestBody.expectedOptionHash !== selectedOptionHash || requestBody.strategy !== strategy)
      throw new Error("approval_request_not_bound_to_selected_hash");
    return { strategy, selectedOptionHash, approvalDisabledBeforeSelection, approvalRequestBoundToSelectedHash: true,
      publishedOperationalRevision: 2, url };
  } finally {
    await run(cli, ["--session", session, "close"]).catch(() => undefined);
    fixture.stop();
  }
}

const runs = [await runOption("KEEP_ANNOUNCED_SLOTS", 0), await runOption("RELEASE_WALKOVER_SLOTS", 1)];
const evidence = {
  schemaVersion: "1.0", kind: "run_control_no_show_option_hash_browser_rehearsal",
  fixture: "scripts/serve-run-control-options.ts", localOnly: true, runs,
};
await mkdir(dirname(evidencePath), { recursive: true });
await writeFile(evidencePath, JSON.stringify(evidence, null, 2) + "\n");
process.stdout.write(JSON.stringify(evidence) + "\n");
