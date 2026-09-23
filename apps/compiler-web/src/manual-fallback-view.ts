import { sharedStyles } from "./design-system.js";
import QRCode from "qrcode";
import type { OfflineEventPackBody, SignedOfflineEventPack } from "./offline-event-pack.js";

function escape(value: unknown): string {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function fixtureRows(fixtures: OfflineEventPackBody["manualFallback"]["schedule"]["fixtures"]): string {
  return fixtures.map((fixture) => `<tr><td>${escape(fixture.startsAt)}</td><td>${escape(fixture.court)}</td>`
    + `<td>${escape(fixture.contestId)}</td><td>${escape(fixture.participantNames.join(" v "))}</td>`
    + `<td>${escape(fixture.status)}</td></tr>`).join("");
}

export async function renderPrintableManualFallback(input: {
  readonly body: OfflineEventPackBody;
  readonly envelope: SignedOfflineEventPack;
  readonly origin: string;
}): Promise<string> {
  const { body, envelope } = input;
  const manual = body.manualFallback;
  const qrCards = await Promise.all(manual.participantQrIndex.entries.map(async (entry) => {
    const target = new URL(entry.accessPath, input.origin).toString();
    const svg = (await QRCode.toString(target, { type: "svg", margin: 1, errorCorrectionLevel: "M",
      color: { dark: "#17201d", light: "#ffffff" } })).replace("<svg ",
      `<svg role="img" aria-label="Private participant QR code for ${escape(entry.displayName)}" `);
    return `<article class="qr-card page"><h2>${escape(entry.displayName)}</h2>${svg}`
      + `<p class="mono">${escape(entry.participantId)}</p><p>Expires ${escape(entry.expiresAt)}</p>`
      + `<p class="warning">Distribute this participant's card only. Do not display the full index publicly.</p></article>`;
  }));
  const courtSheets = manual.courtSheets.map((sheet) => `<section class="page"><h2>${escape(sheet.court)} court sheet</h2>`
    + `<p class="mono">Sheet proof ${escape(sheet.sheetHash)}</p><table><caption>${escape(sheet.court)} assignments</caption>`
    + `<thead><tr><th scope="col">Time</th><th scope="col">Court</th><th scope="col">Contest</th>`
    + `<th scope="col">Participants</th><th scope="col">Status</th></tr></thead><tbody>${fixtureRows(sheet.fixtures)}</tbody></table></section>`).join("");
  const scoreSheets = manual.scoreSheets.map((sheet) => `<section class="page score"><h2>Manual score sheet</h2>`
    + `<p><strong>${escape(sheet.participantNames.join(" v "))}</strong></p><p>${escape(sheet.startsAt)} · ${escape(sheet.court)}</p>`
    + `<p class="mono">${escape(sheet.contestId)} · ${escape(sheet.sheetHash)}</p>`
    + sheet.fields.map((field) => `<div class="write-line"><span>${escape(field.replaceAll("_", " "))}</span></div>`).join("")
    + `<p class="warning">Never erase an earlier entry. Record corrections with the prior sheet or command reference.</p></section>`).join("");
  const restore = manual.restoration.steps.map((step, index) => `<li>${index + 1}. ${escape(step)}</li>`).join("");
  const blockers = body.emergencyReadiness.missingDecisionCodes.map((code) => `<li>${escape(code)}</li>`).join("");
  const machineEnvelope = escape(JSON.stringify(envelope));
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">`
    + `<title>${escape(body.competitionName)} · manual fallback</title><style>
      ${sharedStyles}*{box-sizing:border-box;min-width:0}html{font-size:100%;scroll-behavior:smooth}body{margin:0;overflow-wrap:anywhere}main{max-width:1120px;margin:auto;padding:32px}
      .skip{position:absolute;left:-9999px;top:8px;z-index:100;background:white;color:#17201d;padding:12px 16px;border:2px solid currentColor;border-radius:8px}.skip:focus{left:8px}:focus-visible{outline:3px solid var(--accent);outline-offset:3px}
      h1{font-size:2rem;margin-bottom:.25rem}h2{margin-top:0}.meta,.mono{font-family:ui-monospace,monospace;font-size:.875rem;overflow-wrap:anywhere}
      .banner{padding:16px;border:2px solid #9a5b00;background:#fff2d8}.warning{font-weight:700;color:#7a3100}table{width:100%;border-collapse:collapse;font-size:.875rem}caption{text-align:left;font-weight:800;padding:0 0 8px}
      th,td{border:1px solid #9ca39f;padding:5px;text-align:left;vertical-align:top}.page{background:white;padding:24px;margin:24px 0;break-after:page}
      .score{min-height:88vh}.write-line{height:72px;border-bottom:1px solid #17201d;padding-top:8px}.qr-card svg{width:260px;height:260px}.machine{display:none}
      @media(max-width:600px){main{padding:12px}.page{padding:14px;margin:12px 0}.qr-card svg{width:min(260px,100%);height:auto}table{display:block;overflow-x:auto}}
      @media(prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important;scroll-behavior:auto!important}}
      @media(prefers-contrast:more){.page,.banner,th,td{border-color:#17201d;border-width:2px}.warning{color:#5b2100}}
      @media(forced-colors:active){.page,.banner,th,td,.skip{border:2px solid CanvasText}}
      @media print{body{background:white}.skip{display:none}main{max-width:none;padding:0}.no-print{display:none}.page{margin:0;box-shadow:none}.machine{display:block;break-before:page}}
    </style></head><body><a class="skip" href="#main">Skip to manual fallback materials</a><main id="main" tabindex="-1"><header class="page"><p>KRATEASY CONTROLLED MANUAL FALLBACK</p><h1>${escape(body.competitionName)}</h1>`
    + `<p>Published ${body.publishedRevision} · operational ${body.operationalRevision} · live ${body.liveVersion}</p>`
    + `<p>Generated ${escape(body.generatedAt)} · expires ${escape(body.expiresAt)} · ${escape(body.timezone)}</p>`
    + `<p class="mono">Manual pack ${escape(manual.packHash)}<br>Signing key ${escape(envelope.keyId)}<br>Publication certificate ${escape(body.authority.publicationCertificateHash)}</p>`
    + `<div class="banner"><strong>Operational materials are ready; emergency authority data is blocked.</strong>`
    + `<p>This pack does not replace the venue's separately controlled safety plan.</p><ul>${blockers}</ul></div></header>`
    + `<section class="page"><h2>Restoration steps</h2><ol>${restore}</ol><p class="mono">Truth reference ${escape(manual.restoration.truthReferenceHash)}</p></section>`
    + `<section class="page"><h2>Order of play · ${manual.schedule.fixtureCount} fixtures</h2><table><caption>Order of play</caption>`
    + `<thead><tr><th scope="col">Time</th><th scope="col">Court</th><th scope="col">Contest</th>`
    + `<th scope="col">Participants</th><th scope="col">Status</th></tr></thead><tbody>${fixtureRows(manual.schedule.fixtures)}</tbody></table></section>`
    + courtSheets + (qrCards.length ? qrCards.join("") : `<section class="page"><h2>Participant QR index blocked</h2>`
      + `<p>Configure the participant signing key before generating individually expiring access cards.</p></section>`)
    + scoreSheets + `<section class="machine"><h2>Signed machine envelope</h2><p class="mono">${machineEnvelope}</p></section>`
    + `</main></body></html>`;
}
