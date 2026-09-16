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

  await evaluate(`JSON.stringify((()=>{const button=[...document.querySelectorAll('[data-context-action="INCIDENT"]')].find(x=>x.dataset.rootKey?.startsWith('ENTRANT_NO_SHOW:'));if(!button)throw Error('no_show_action_missing');button.focus();return true})())`);
  await invoke(["press", "Enter"]);
  const incidentBinding = await evaluate<{ kind: string; contestId: string; entrantId: string; activeId: string; notice: string }>(
    `JSON.stringify({kind:document.querySelector('#change-kind')?.value||'',contestId:document.querySelector('#change-contest')?.value||'',entrantId:document.querySelector('#change-entrant')?.value||'',activeId:document.activeElement?.id||'',notice:document.querySelector('#change-status')?.textContent||''})`);
  if (incidentBinding.kind !== "NO_SHOW" || incidentBinding.entrantId !== fixture.noShowEntrantId
    || !incidentBinding.contestId || incidentBinding.activeId !== "change-reason"
    || !incidentBinding.notice.includes("Exact incident context"))
    throw new Error(`no_show_context_not_exact:${JSON.stringify(incidentBinding)}`);

  const versionBeforeEvidence = await evaluate<number>(`Number((document.querySelector('#status')?.textContent||'').match(/live head (\\d+)/)?.[1]||0)`);
  await evaluate(`JSON.stringify((()=>{const button=[...document.querySelectorAll('[data-context-action="EVIDENCE"]')].find(x=>x.dataset.rootKey?.startsWith('ENTRANT_WITHDRAWN:'));if(!button)throw Error('withdrawal_evidence_action_missing');button.focus();return true})())`);
  await invoke(["press", "Enter"]);
  const evidenceFallback = await evaluate<{ detailsOpen: boolean; activeTag: string; notice: string; liveVersion: number }>(
    `JSON.stringify((()=>{const article=[...document.querySelectorAll('.triage')].find(x=>x.dataset.rootCause?.startsWith('ENTRANT_WITHDRAWN:'));return {detailsOpen:Boolean(article?.querySelector('details')?.open),activeTag:document.activeElement?.tagName||'',notice:document.querySelector('#command-status')?.textContent||'',liveVersion:Number((document.querySelector('#status')?.textContent||'').match(/live head (\\d+)/)?.[1]||0)}})())`);
  if (!evidenceFallback.detailsOpen || evidenceFallback.activeTag !== "SUMMARY"
    || !evidenceFallback.notice.includes("No matching guarded control")
    || !evidenceFallback.notice.includes("nothing changed")
    || evidenceFallback.liveVersion !== versionBeforeEvidence)
    throw new Error(`unsupported_cause_did_not_fail_safe:${JSON.stringify(evidenceFallback)}`);

  await invoke(["open", fixture.runControlUrl]);
  await invoke(["snapshot"]);

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

  await evaluate(`JSON.stringify((()=>{const button=[...document.querySelectorAll('[data-context-action="RECORD_RESULT_RECEIPT"]')].find(x=>x.dataset.rootKey?.startsWith('NEEDS_ATTENTION:'));if(!button)throw Error('result_receipt_action_missing');button.focus();return true})())`);
  await invoke(["press", "Enter"]);
  const receiptPrefilled = await evaluate<{ activeId: string; commandKind: string; contestId: string; source: string; notice: string }>(
    `JSON.stringify({activeId:document.activeElement?.id||'',commandKind:document.querySelector('#command-kind')?.value||'',contestId:document.querySelector('#contest')?.value||'',source:document.querySelector('#result-source')?.value||'',notice:document.querySelector('#command-status')?.textContent||''})`);
  if (receiptPrefilled.activeId !== "command-submit" || receiptPrefilled.commandKind !== "RECORD_RESULT_RECEIPT"
    || receiptPrefilled.contestId !== fixture.receiptContestId || !receiptPrefilled.source.trim()
    || !receiptPrefilled.notice.includes("Review"))
    throw new Error(`receipt_context_did_not_prefill_existing_command:${JSON.stringify(receiptPrefilled)}`);
  await invoke(["press", "Enter"]);

  let receiptAfter: { liveVersion: number; status: string; receiptActions: number } = {
    liveVersion: 0, status: "", receiptActions: -1,
  };
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    receiptAfter = await evaluate(`JSON.stringify({liveVersion:Number((document.querySelector('#status')?.textContent||'').match(/live head (\\d+)/)?.[1]||0),status:document.querySelector('#command-status')?.textContent||'',receiptActions:document.querySelectorAll('[data-context-action="RECORD_RESULT_RECEIPT"]').length})`);
    if (receiptAfter.liveVersion === fixture.seededLiveVersion + 2) break;
  }
  if (receiptAfter.liveVersion !== fixture.seededLiveVersion + 2 || receiptAfter.receiptActions !== 0)
    throw new Error(`result_receipt_did_not_advance_and_clear:${JSON.stringify(receiptAfter)}`);

  const requests = cliResult(await invoke(["--json", "requests"]));
  const requestIndexes = [...requests.matchAll(/(\d+)\. \[POST\].*live-command/g)].map((match) => match[1]!);
  if (requestIndexes.length !== 2) throw new Error(`live_command_requests_not_observed:${requestIndexes.length}`);
  const checkInRequest = decodedCliResult<Record<string, any>>(await invoke(["--json", "request-body", requestIndexes[0]!]));
  const receiptRequest = decodedCliResult<Record<string, any>>(await invoke(["--json", "request-body", requestIndexes[1]!]));
  if (checkInRequest.expectedRevision !== 1 || checkInRequest.command?.kind !== "CHECK_IN"
    || checkInRequest.command?.entrantId !== fixture.missingEntrantId
    || checkInRequest.command?.expectedVersion !== fixture.seededLiveVersion)
    throw new Error(`keyboard_command_not_bound_to_authoritative_head:${JSON.stringify(checkInRequest)}`);
  if (receiptRequest.expectedRevision !== 1 || receiptRequest.command?.kind !== "RECORD_RESULT_RECEIPT"
    || receiptRequest.command?.contestId !== fixture.receiptContestId
    || receiptRequest.command?.source !== receiptPrefilled.source
    || receiptRequest.command?.expectedVersion !== fixture.seededLiveVersion + 1)
    throw new Error(`result_receipt_not_bound_to_authoritative_head:${JSON.stringify(receiptRequest)}`);

  const evidence = {
    schemaVersion: "1.0",
    kind: "run_control_operational_triage_browser_rehearsal",
    fixture: "scripts/serve-operational-triage-routes.ts",
    localOnly: true,
    seed: { at: "2026-09-20T00:00:00.000Z", missingEntrantId: fixture.missingEntrantId,
      closedCourtId: fixture.closedCourtId, noShowEntrantId: fixture.noShowEntrantId,
      noShowContestId: fixture.noShowContestId, withdrawnEntrantId: fixture.withdrawnEntrantId,
      receiptContestId: fixture.receiptContestId },
    denseEvent: { fixtureCount: fixture.fixtureCount, attentionRowsBefore: projection.attention.length,
      seededLiveVersion: fixture.seededLiveVersion },
    prioritisation: before,
    incidentBinding,
    unsupportedCause: evidenceFallback,
    keyboard: { tabCount: tabCount + 1, focusedAction: keyboardFocus, prefilled,
      request: { expectedRevision: checkInRequest.expectedRevision, kind: checkInRequest.command.kind,
        entrantId: checkInRequest.command.entrantId, expectedLiveVersion: checkInRequest.command.expectedVersion },
      resultingLiveVersion: after.liveVersion },
    resultReceipt: { prefilled: receiptPrefilled,
      request: { expectedRevision: receiptRequest.expectedRevision, kind: receiptRequest.command.kind,
        contestId: receiptRequest.command.contestId, source: receiptRequest.command.source,
        expectedLiveVersion: receiptRequest.command.expectedVersion },
      resultingLiveVersion: receiptAfter.liveVersion, actionCleared: receiptAfter.receiptActions === 0 },
  };
  await mkdir(dirname(evidencePath), { recursive: true });
  await writeFile(evidencePath, JSON.stringify(evidence, null, 2) + "\n");
  process.stdout.write(JSON.stringify(evidence) + "\n");
} finally {
  await run(cli, ["--session", session, "close"]).catch(() => undefined);
  fixture.stop();
}
