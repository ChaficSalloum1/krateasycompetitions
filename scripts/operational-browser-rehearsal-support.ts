import { spawn, type ChildProcess } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const root = dirname(dirname(fileURLToPath(import.meta.url)));
export const cli = process.env.KRATEASY_PLAYWRIGHT_CLI
  ?? join(process.env.CODEX_HOME ?? join(process.env.HOME ?? "", ".codex"), "skills/playwright/scripts/playwright_cli.sh");

export interface OperationalRouteFixture {
  readonly origin: string;
  readonly portfolioUrl: string;
  readonly studioUrl: string;
  readonly runControlUrl: string;
  readonly receiptUrl: string;
  readonly competitionId: string;
  readonly missingEntrantId: string;
  readonly closedCourtId: string;
  readonly noShowEntrantId: string;
  readonly noShowContestId: string;
  readonly withdrawnEntrantId: string;
  readonly receiptContestId: string;
  readonly fixtureCount: number;
  readonly seededLiveVersion: number;
  readonly closed: boolean;
}

export function run(command: string, args: string[], environment: NodeJS.ProcessEnv = process.env): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, env: environment });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 && !output.includes("### Error")
      ? resolve(output) : reject(new Error(output || `command failed (${code})`)));
  });
}

export async function startOperationalRouteFixture(options: { readonly closed?: boolean } = {}): Promise<OperationalRouteFixture & { readonly stop: () => void }> {
  const child: ChildProcess = spawn(process.execPath, ["--import", "tsx", "scripts/serve-operational-triage-routes.ts"], {
    cwd: root, env: { ...process.env, PORT: "0", ...(options.closed ? { CLOSED_STUDIO: "1" } : {}) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  const fixture = await new Promise<OperationalRouteFixture>((resolve, reject) => {
    const accept = (chunk: Buffer) => {
      output += chunk.toString();
      const line = output.split("\n").find((candidate) => candidate.startsWith("{"));
      if (line) {
        try { resolve(JSON.parse(line) as OperationalRouteFixture); } catch { /* wait for a complete line */ }
      }
    };
    child.stdout!.on("data", accept);
    child.stderr!.on("data", (chunk) => { output += chunk.toString(); });
    child.on("error", reject);
    child.on("exit", (code) => reject(new Error(output || `fixture exited (${code})`)));
  });
  return { ...fixture, stop: () => child.kill("SIGTERM") };
}

export function cliResult(output: string): string {
  const parsed = JSON.parse(output) as { result?: string };
  if (typeof parsed.result !== "string") throw new Error(`missing_cli_result:${output}`);
  return parsed.result;
}

export function decodedCliResult<T>(output: string): T {
  const first = JSON.parse(cliResult(output)) as unknown;
  return (typeof first === "string" ? JSON.parse(first) : first) as T;
}

export function ref(snapshot: string, text: string): string {
  const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = snapshot.match(new RegExp(`${escaped}[^\\n]*\\[ref=(e\\d+)\\]`));
  if (!match) throw new Error(`missing_browser_ref:${text}`);
  return match[1]!;
}
