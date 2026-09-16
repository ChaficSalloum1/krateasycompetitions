/** Checked-in browser evidence for one material, hash-bound Structure Map change. */
import { mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const evidencePath = process.env.EVIDENCE_PATH ?? join(root, "output/playwright/organiser-structure-map-browser.json");
const cli = process.env.KRATEASY_PLAYWRIGHT_CLI
  ?? join(process.env.CODEX_HOME ?? join(process.env.HOME ?? "", ".codex"), "skills/playwright/scripts/playwright_cli.sh");

function run(command: string, args: string[]) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, env: process.env });
    let output = "";
    child.stdout.on("data", (chunk) => output += chunk);
    child.stderr.on("data", (chunk) => output += chunk);
    child.on("exit", (code) => code === 0 && !output.includes("### Error")
      ? setTimeout(() => resolve(output), 500) : reject(Error(output)));
  });
}

function ref(snapshot: string, label: string) {
  const line = snapshot.split("\n").find((candidate) => candidate.includes(label));
  const match = line?.match(/\[ref=([A-Za-z0-9]+)\]/);
  if (!match) throw Error(`missing_ref:${label}:${line ?? "line_not_found"}`);
  return match[1]!;
}

const fixture = spawn(process.execPath, ["--import", "tsx", "scripts/serve-organiser-structure-map.ts"], {
  cwd: root, env: { ...process.env, PORT: "0" }, stdio: ["ignore", "pipe", "pipe"],
});
let boot = "";
const organiserUrl = await new Promise<string>((resolve, reject) => {
  fixture.stdout.on("data", (chunk) => {
    boot += chunk;
    const line = boot.split("\n").find((value) => value.startsWith("{"));
    if (line) resolve((JSON.parse(line) as { organiserUrl: string }).organiserUrl);
  });
  fixture.stderr.on("data", (chunk) => boot += chunk);
  fixture.on("exit", () => reject(Error(boot)));
});
const session = `structure-map-${process.pid}`;
const invoke = (args: string[]) => run(cli, ["--session", session, ...args]);
const evaluate = async <T>(expression: string): Promise<T> => {
  const result = JSON.parse((await invoke(["--json", "eval", expression])).trim()) as { result: unknown };
  let value = result.result;
  while (typeof value === "string") {
    try { value = JSON.parse(value) as unknown; } catch { break; }
  }
  return value as T;
};
const numberOrNull = (value: string): number | null => value === "unavailable" ? null : Number(value.replace(/^\+/, ""));

try {
  await invoke(["open", organiserUrl]);
  let snapshot = await invoke(["snapshot"]);
  if (!snapshot.includes("Structure Map")) throw Error("map_not_rendered");

  await invoke(["click", ref(snapshot, "Preview authoritative structure change")]);
  snapshot = await invoke(["snapshot"]);
  if (!snapshot.includes("Review proposed structure change")
    || !snapshot.includes("Before unavailable → After 108 · Delta unavailable")
    || !snapshot.includes("Before unavailable → After 6 · Delta unavailable")) throw Error("derived_review_missing");
  const previewHash = await evaluate<string>("JSON.stringify(document.querySelector('[data-preview-hash]').textContent)");
  const renderedCounts = await evaluate<Array<{ kind: string; before: string; after: string; delta: string; unavailableReason: string }>>(
    "JSON.stringify([...document.querySelectorAll('[data-count-kind]')].map(element=>({kind:element.dataset.countKind,before:element.dataset.before,after:element.dataset.after,delta:element.dataset.delta,unavailableReason:element.dataset.unavailableReason})))");
  const countValues = Object.fromEntries(renderedCounts.map(({ kind, before, after, delta, unavailableReason }) => [kind, {
    before: numberOrNull(before), after: numberOrNull(after), delta: numberOrNull(delta),
    deltaStatus: delta === "unavailable" ? "UNAVAILABLE" : "AVAILABLE", unavailableReason: unavailableReason || null,
  }])) as Record<string, { before: number | null; after: number | null; delta: number | null;
    deltaStatus: "AVAILABLE" | "UNAVAILABLE"; unavailableReason: string | null }>;

  await invoke(["click", ref(snapshot, "Record exact reviewed proposal")]);
  await invoke(["reload"]);
  snapshot = await invoke(["snapshot"]);
  const rendered = await evaluate<{ nodeIds: string[]; edgeIds: string[]; warningCodes: string[] }>(
    "JSON.stringify({nodeIds:[...document.querySelectorAll('[data-node-id]')].map(element=>element.dataset.nodeId),edgeIds:[...document.querySelectorAll('[data-edge-id]')].map(element=>element.dataset.edgeId),warningCodes:[...new Set([...document.querySelectorAll('[data-warning-code]')].map(element=>element.dataset.warningCode))].sort()})");
  if (!rendered.nodeIds.length || !rendered.edgeIds.length || !rendered.warningCodes.includes("CONSEQUENTIAL_EDGE"))
    throw Error("stable_structure_evidence_missing");
  if (!snapshot.includes("Create certified plan")) throw Error(`certified_plan_action_missing:\n${snapshot}`);

  await invoke(["click", ref(snapshot, "Create certified plan")]);
  await invoke(["reload"]);
  snapshot = await invoke(["snapshot"]);
  if (!snapshot.includes("Publish Review")) throw Error("guarded_publish_review_missing");
  const publishReview = await evaluate<string>("JSON.stringify(document.querySelector('#publish .state').textContent.trim())");
  if (!/READY[ _]FOR[ _]APPROVAL/i.test(publishReview)) throw Error("guarded_publish_review_missing");
  const revisionText = await evaluate<string>("JSON.stringify(document.querySelector('.hero p').textContent)");
  const resultingRevision = Number(revisionText.match(/revision (\d+)/)?.[1]);
  if (!Number.isSafeInteger(resultingRevision) || resultingRevision < 1) throw Error("resulting_revision_missing");

  const evidence = {
    schemaVersion: "1.1",
    kind: "organiser_structure_map_browser_rehearsal",
    localOnly: true,
    rendered,
    review: { matchCount: countValues.matches, qualificationCount: countValues.qualifications },
    previewHash,
    resultingRevision,
    publishReview: "READY_FOR_APPROVAL",
  };
  await mkdir(dirname(evidencePath), { recursive: true });
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(evidence)}\n`);
} finally {
  await run(cli, ["--session", session, "close"]).catch(() => undefined);
  fixture.kill("SIGTERM");
}
