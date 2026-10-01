import { existsSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { chromium, type Browser, type Page } from "playwright-core";
import type { CompetitionJourney } from "../../src/competition-journey.js";
import { createCompilerServer } from "../../src/server.js";

// Browser suites need a provisioned Chromium, so they run as `npm run test:browser`, outside `npm test`.
// CI installs one with `npx playwright-core install --with-deps chromium`; KRATEASY_CHROMIUM names any other build.

const localChromium = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const executablePath = process.env.KRATEASY_CHROMIUM ?? (existsSync(localChromium) ? localChromium : undefined);
const notProvisioned = "Chromium is not provisioned for the browser suite: run `npx playwright-core install --with-deps chromium` "
  + "or set KRATEASY_CHROMIUM to a Chromium executable, then `npm run test:browser`.";

export async function launchBrowser(): Promise<Browser> {
  if (executablePath === undefined && !existsSync(chromium.executablePath())) throw new Error(notProvisioned);
  return chromium.launch(executablePath ? { executablePath } : {});
}

/** Serves one journey on an ephemeral port; call the returned close when the suite ends. */
export function servers() {
  const open: Array<ReturnType<typeof createCompilerServer>> = [];
  return {
    async serve(journey: CompetitionJourney): Promise<string> {
      const server = createCompilerServer({ production: false, competitionJourney: journey, organizationId: "org.flexible" });
      open.push(server);
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    },
    close: () => Promise.all(open.map((server) => new Promise((resolve) => server.close(resolve)))),
  };
}

export const noHorizontalOverflow = (page: Page) => page.evaluate(() =>
  Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) <= document.documentElement.clientWidth);
