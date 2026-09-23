// Starts the built production host with no configuration and requires the intended fail-closed
// outcome. A missing runtime dependency (e.g. ERR_MODULE_NOT_FOUND after `npm prune --omit=dev`)
// crashes before the host can report, so it fails this check instead of passing silently.
//
// Plain JavaScript on purpose: it must run against a pruned install where tsx is absent.
//   node scripts/smoke-production-host.mjs                 # built, pruned working tree
//   SMOKE_IMAGE=krateasy:ci node scripts/smoke-production-host.mjs   # built container image
import { spawnSync } from "node:child_process";

const image = process.env.SMOKE_IMAGE;
const [command, args] = image
  ? ["docker", ["run", "--rm", "-e", "NODE_ENV=production", image]]
  : [process.execPath, ["apps/compiler-web/dist/src/production-host.js"]];
const env = { PATH: process.env.PATH ?? "", NODE_ENV: "production" };
const result = spawnSync(command, args, { env, encoding: "utf8", timeout: 60_000 });

const expected = { event: "production_host_failed", code: "PRODUCTION_CONFIGURATION_INVALID" };
const reported = (result.stderr ?? "").split("\n").flatMap((line) => {
  try { return [JSON.parse(line)]; } catch { return []; }
});
const failedClosed = result.status === 1
  && reported.some((line) => line.event === expected.event && line.code === expected.code);

if (!failedClosed) {
  process.stderr.write(`production host smoke failed (exit ${result.status}${result.error ? `, ${result.error.message}` : ""})\n`);
  process.stderr.write(`expected stderr line ${JSON.stringify(expected)}\n--- stderr ---\n${result.stderr ?? ""}\n`);
  process.exit(1);
}
process.stdout.write(`production host failed closed as intended${image ? ` in ${image}` : ""}\n`);
