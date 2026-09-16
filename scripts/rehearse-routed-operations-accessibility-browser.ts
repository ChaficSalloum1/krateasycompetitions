/** Local-only keyboard-route and 200–400% reflow rehearsal for shipped organiser pages. */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  cli, decodedCliResult, root, run, startOperationalRouteFixture,
} from "./operational-browser-rehearsal-support.js";

const evidencePath = process.env.EVIDENCE_PATH
  ?? join(root, "output/playwright/routed-operations-accessibility.json");
const fixture = await startOperationalRouteFixture();
let closedFixture: Awaited<ReturnType<typeof startOperationalRouteFixture>> | undefined;
const session = `routed-operations-a11y-${process.pid}`;
const invoke = (args: string[]) => run(cli, ["--session", session, ...args]);
const evaluate = async <T>(expression: string): Promise<T> =>
  decodedCliResult<T>(await invoke(["--json", "eval", expression]));

interface ReflowResult {
  readonly zoomEquivalentPercent: 200 | 400;
  readonly viewportWidth: number;
  readonly documentScrollWidth: number;
  readonly bodyScrollWidth: number;
  readonly noPageOverflow: boolean;
  readonly firstKeyboardTarget: string;
  readonly focusVisible: boolean;
}

async function reflow(route: string): Promise<{ route: string; url: string; title: string; mainPresent: boolean;
  results: readonly ReflowResult[] }> {
  const results: ReflowResult[] = [];
  for (const item of [{ width: 640, zoom: 200 as const }, { width: 320, zoom: 400 as const }]) {
    await invoke(["resize", String(item.width), "900"]);
    await evaluate("JSON.stringify((()=>{document.activeElement?.blur();return true})())");
    await invoke(["press", "Tab"]);
    const result = await evaluate<Omit<ReflowResult, "zoomEquivalentPercent" | "viewportWidth">>(
      `JSON.stringify({documentScrollWidth:document.documentElement.scrollWidth,bodyScrollWidth:document.body.scrollWidth,noPageOverflow:Math.max(document.documentElement.scrollWidth,document.body.scrollWidth)<=document.documentElement.clientWidth,firstKeyboardTarget:(document.activeElement?.textContent||document.activeElement?.getAttribute('aria-label')||'').trim(),focusVisible:Boolean(document.activeElement?.matches(':focus-visible'))})`);
    results.push({ zoomEquivalentPercent: item.zoom, viewportWidth: item.width, ...result });
  }
  const page = await evaluate<{ url: string; title: string; mainPresent: boolean }>(
    "JSON.stringify({url:location.href,title:document.title,mainPresent:Boolean(document.querySelector('main#main'))})");
  if (!page.mainPresent || results.some((result) => !result.noPageOverflow || !result.focusVisible))
    throw new Error(`route_accessibility_failed:${route}:${JSON.stringify({ page, results })}`);
  return { route, ...page, results };
}

async function keyboardNavigate(label: string): Promise<{ label: string; tabCount: number; from: string; to: string;
  focusVisible: boolean }> {
  const from = await evaluate<string>("JSON.stringify(location.href)");
  let focused: { text: string; focusVisible: boolean } = { text: "", focusVisible: false };
  let tabCount = 0;
  for (; tabCount < 120; tabCount += 1) {
    await invoke(["press", "Tab"]);
    focused = await evaluate(`JSON.stringify({text:(document.activeElement?.textContent||'').trim(),focusVisible:Boolean(document.activeElement?.matches(':focus-visible'))})`);
    if (focused.text.includes(label)) break;
  }
  if (!focused.text.includes(label) || !focused.focusVisible)
    throw new Error(`keyboard_route_unreachable:${label}:${JSON.stringify(focused)}`);
  await invoke(["press", "Enter"]);
  await invoke(["snapshot"]);
  const to = await evaluate<string>("JSON.stringify(location.href)");
  if (to === from) throw new Error(`keyboard_route_did_not_navigate:${label}`);
  return { label, tabCount: tabCount + 1, from, to, focusVisible: focused.focusVisible };
}

try {
  await invoke(["open", fixture.portfolioUrl]);
  await invoke(["snapshot"]);
  const routes = [await reflow("Portfolio")];
  const transitions = [await keyboardNavigate("Open Organiser Studio")];

  const studioEvidence = await evaluate<{
    canonicalText: string; canonicalBeforeHistory: boolean; historicalSections: number;
    historicalSectionsCollapsed: boolean; heroContainsCompetitionId: boolean; technicalRevisionCollapsed: boolean;
  }>(`JSON.stringify((()=>{const canonical=document.querySelector('[data-canonical-truth]'),history=[...document.querySelectorAll('#design details')].filter(x=>(x.querySelector('summary')?.textContent||'').startsWith('Historical provenance')),technical=document.querySelector('.canonical-evidence');return {canonicalText:canonical?.textContent||'',canonicalBeforeHistory:Boolean(canonical&&history[0]&&(canonical.compareDocumentPosition(history[0])&Node.DOCUMENT_POSITION_FOLLOWING)),historicalSections:history.length,historicalSectionsCollapsed:history.every(x=>!x.open),heroContainsCompetitionId:(document.querySelector('.hero p')?.textContent||'').includes(${JSON.stringify(fixture.competitionId)}),technicalRevisionCollapsed:Boolean(technical&&!technical.open)}})())`);
  if (!studioEvidence.canonicalText.includes("Published revision 1") || !studioEvidence.canonicalBeforeHistory
    || studioEvidence.historicalSections !== 2 || !studioEvidence.historicalSectionsCollapsed
    || studioEvidence.heroContainsCompetitionId || !studioEvidence.technicalRevisionCollapsed)
    throw new Error(`published_studio_truth_not_proven:${JSON.stringify(studioEvidence)}`);
  routes.push(await reflow("Organiser Studio"));
  transitions.push(await keyboardNavigate("Open Run Control"));

  const runControlEvidence = await evaluate<{ rootCauses: number; hasContextualAction: boolean; technicalEvidenceCollapsed: boolean }>(
    "JSON.stringify({rootCauses:document.querySelectorAll('.triage-list .triage').length,hasContextualAction:Boolean(document.querySelector('[data-context-action]')),technicalEvidenceCollapsed:[...document.querySelectorAll('.triage details')].every(x=>!x.open)})");
  if (runControlEvidence.rootCauses < 1 || !runControlEvidence.hasContextualAction || !runControlEvidence.technicalEvidenceCollapsed)
    throw new Error(`routed_run_control_not_proven:${JSON.stringify(runControlEvidence)}`);
  routes.push(await reflow("Run Control"));
  transitions.push(await keyboardNavigate("Close Receipt"));

  const receiptEvidence = await evaluate<{ heading: string; closeReadiness: string; returnToStudio: boolean }>(
    "JSON.stringify({heading:document.querySelector('h1')?.textContent||'',closeReadiness:document.querySelector('#receipt h2')?.textContent||'',returnToStudio:Boolean([...document.querySelectorAll('a')].find(x=>(x.textContent||'').includes('Return to Organiser Studio')))})");
  if (!receiptEvidence.heading || !receiptEvidence.closeReadiness || !receiptEvidence.returnToStudio)
    throw new Error(`routed_receipt_not_proven:${JSON.stringify(receiptEvidence)}`);
  routes.push(await reflow("Close Receipt"));

  closedFixture = await startOperationalRouteFixture({ closed: true });
  await invoke(["open", closedFixture.studioUrl]);
  await invoke(["snapshot"]);
  const closedStudioEvidence = await evaluate<{
    canonicalText: string; heroText: string; historicalSections: number;
    historicalSectionsCollapsed: boolean; technicalRevisionCollapsed: boolean;
  }>(`JSON.stringify((()=>{const history=[...document.querySelectorAll('#design details')].filter(x=>(x.querySelector('summary')?.textContent||'').startsWith('Historical provenance')),technical=document.querySelector('.canonical-evidence');return {canonicalText:document.querySelector('[data-canonical-truth]')?.textContent||'',heroText:document.querySelector('.hero p')?.textContent||'',historicalSections:history.length,historicalSectionsCollapsed:history.every(x=>!x.open),technicalRevisionCollapsed:Boolean(technical&&!technical.open)}})())`);
  if (!closedStudioEvidence.canonicalText.includes("closed record is settled")
    || !closedStudioEvidence.heroText.includes("Closed record · published revision 1")
    || closedStudioEvidence.historicalSections !== 2 || !closedStudioEvidence.historicalSectionsCollapsed
    || !closedStudioEvidence.technicalRevisionCollapsed)
    throw new Error(`closed_studio_truth_not_proven:${JSON.stringify(closedStudioEvidence)}`);
  routes.push(await reflow("Closed Organiser Studio"));

  const evidence = {
    schemaVersion: "1.0",
    kind: "routed_operations_accessibility_browser_rehearsal",
    fixture: "scripts/serve-operational-triage-routes.ts",
    localOnly: true,
    reflowMethod: "1280 CSS-pixel reference viewport represented at 200% by 640 CSS pixels and at 400% by 320 CSS pixels",
    routeOrder: routes.map(({ route }) => route),
    transitions,
    routes,
    publishedStudio: studioEvidence,
    closedStudio: closedStudioEvidence,
    runControl: runControlEvidence,
    closeReceipt: receiptEvidence,
  };
  await mkdir(dirname(evidencePath), { recursive: true });
  await writeFile(evidencePath, JSON.stringify(evidence, null, 2) + "\n");
  process.stdout.write(JSON.stringify(evidence) + "\n");
} finally {
  await run(cli, ["--session", session, "close"]).catch(() => undefined);
  fixture.stop();
  closedFixture?.stop();
}
