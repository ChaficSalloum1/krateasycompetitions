/** Local-only dense Run Control triage and keyboard command rehearsal. */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  cli, cliResult, decodedCliResult, root, run, startOperationalRouteFixture,
} from "./operational-browser-rehearsal-support.js";

const evidencePath = process.env.EVIDENCE_PATH
  ?? join(root, "output/playwright/run-control-operational-triage.json");
const fixture = await startOperationalRouteFixture();
const session = `run-control-triage-${process.pid}`;
const invoke = (args: string[]) => run(cli, ["--session", session, ...args]);
const evaluate = async <T>(expression: string): Promise<T> =>
  decodedCliResult<T>(await invoke(["--json", "eval", expression]));

try {
  const projectionResponse = await fetch(`${fixture.origin}/v1/competition-journey/${encodeURIComponent(fixture.competitionId)}/organiser-live?revision=1`);
  const projection = await projectionResponse.json() as { liveVersion: number; attention: readonly unknown[] };
  if (!projectionResponse.ok || fixture.fixtureCount !== 108 || projection.attention.length !== 108)
    throw new Error(`dense_fixture_not_proven:${fixture.fixtureCount}:${projection.attention.length}`);

  await invoke(["open", fixture.runControlUrl]);
  await invoke(["snapshot"]);
  const before = await evaluate<{
    urgentRootCauseCount: number; renderedGroupCount: number; topKey: string | null;
    topUrgency: number; topAffectedCount: number; collapsedDerivedCount: number;
    primaryContainsStableId: boolean; technicalContainsStableId: boolean; technicalInitiallyCollapsed: boolean;
  }>(`JSON.stringify((()=>{const urgent=[...document.querySelectorAll('.triage-list .triage')],all=[...document.querySelectorAll('.triage')],top=urgent[0],primary=urgent.map(x=>x.querySelector(':scope > div')?.textContent||'').join(' '),technical=urgent.map(x=>x.querySelector('details')?.textContent||'').join(' ');return {urgentRootCauseCount:urgent.length,renderedGroupCount:all.length,topKey:top?.dataset.rootCause||null,topUrgency:Number(top?.dataset.urgency||0),topAffectedCount:Number(top?.dataset.affectedCount||0),collapsedDerivedCount:urgent.reduce((sum,x)=>sum+(x.querySelector('.derived-count')?Number((x.querySelector('.derived-count')?.textContent||'0').match(/\\d+/)?.[0]||0):0),0),primaryContainsStableId:primary.includes(${JSON.stringify(fixture.missingEntrantId)}),technicalContainsStableId:technical.includes(${JSON.stringify(fixture.missingEntrantId)}),technicalInitiallyCollapsed:urgent.every(x=>!x.querySelector('details')?.open)}})())`);
  if (before.urgentRootCauseCount < 1 || before.urgentRootCauseCount >= 108
    || before.topUrgency < 62 || before.topAffectedCount < 1
    || before.primaryContainsStableId || !before.technicalContainsStableId || !before.technicalInitiallyCollapsed)
    throw new Error(`triage_rendering_not_proven:${JSON.stringify(before)}`);

  let keyboardFocus: { action: string | null; visible: boolean; label: string } | undefined;
  let tabCount = 0;
  for (; tabCount < 80; tabCount += 1) {
    await invoke(["press", "Tab"]);
    keyboardFocus = await evaluate(`JSON.stringify({action:document.activeElement?.dataset?.contextAction||null,visible:Boolean(document.activeElement?.matches(':focus-visible')),label:(document.activeElement?.textContent||'').trim()})`);
    if (keyboardFocus.action === "CHECK_IN") break;
  }
  if (keyboardFocus?.action !== "CHECK_IN" || !keyboardFocus.visible)
    throw new Error(`keyboard_context_action_unreachable:${JSON.stringify(keyboardFocus)}`);
  await invoke(["press", "Enter"]);
  const prefilled = await evaluate<{ activeId: string; commandKind: string; entrantId: string; notice: string }>(
    `JSON.stringify({activeId:document.activeElement?.id||'',commandKind:document.querySelector('#command-kind')?.value||'',entrantId:document.querySelector('#entrant')?.value||'',notice:document.querySelector('#command-status')?.textContent||''})`);
  if (prefilled.activeId !== "command-submit" || prefilled.commandKind !== "CHECK_IN"
    || prefilled.entrantId !== fixture.missingEntrantId || !prefilled.notice.includes("Review"))
    throw new Error(`context_did_not_prefill_existing_command:${JSON.stringify(prefilled)}`);
  await invoke(["press", "Enter"]);

  let after: { liveVersion: number; status: string } = { liveVersion: 0, status: "" };
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    after = await evaluate(`JSON.stringify({liveVersion:Number((document.querySelector('#status')?.textContent||'').match(/live head (\\d+)/)?.[1]||0),status:document.querySelector('#command-status')?.textContent||''})`);
    if (after.liveVersion === fixture.seededLiveVersion + 1) break;
  }
  if (after.liveVersion !== fixture.seededLiveVersion + 1)
    throw new Error(`keyboard_command_did_not_advance_live_head:${JSON.stringify(after)}`);

  const requests = cliResult(await invoke(["--json", "requests"]));
  const requestIndex = requests.match(/(\d+)\. \[POST\].*live-command/)?.[1];
  if (!requestIndex) throw new Error("live_command_request_not_observed");
  const requestBody = decodedCliResult<Record<string, any>>(await invoke(["--json", "request-body", requestIndex]));
  if (requestBody.expectedRevision !== 1 || requestBody.command?.kind !== "CHECK_IN"
    || requestBody.command?.entrantId !== fixture.missingEntrantId
    || requestBody.command?.expectedVersion !== fixture.seededLiveVersion)
    throw new Error(`keyboard_command_not_bound_to_authoritative_head:${JSON.stringify(requestBody)}`);

  const evidence = {
    schemaVersion: "1.0",
    kind: "run_control_operational_triage_browser_rehearsal",
    fixture: "scripts/serve-operational-triage-routes.ts",
    localOnly: true,
    seed: { at: "2026-09-20T00:00:00.000Z", missingEntrantId: fixture.missingEntrantId,
      closedCourtId: fixture.closedCourtId },
    denseEvent: { fixtureCount: fixture.fixtureCount, attentionRowsBefore: projection.attention.length,
      seededLiveVersion: fixture.seededLiveVersion },
    prioritisation: before,
    keyboard: { tabCount: tabCount + 1, focusedAction: keyboardFocus, prefilled,
      request: { expectedRevision: requestBody.expectedRevision, kind: requestBody.command.kind,
        entrantId: requestBody.command.entrantId, expectedLiveVersion: requestBody.command.expectedVersion },
      resultingLiveVersion: after.liveVersion },
  };
  await mkdir(dirname(evidencePath), { recursive: true });
  await writeFile(evidencePath, JSON.stringify(evidence, null, 2) + "\n");
  process.stdout.write(JSON.stringify(evidence) + "\n");
} finally {
  await run(cli, ["--session", session, "close"]).catch(() => undefined);
  fixture.stop();
}
