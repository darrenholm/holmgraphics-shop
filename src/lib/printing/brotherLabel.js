// src/lib/printing/brotherLabel.js
//
// Brother QL label printing (QL-810W) for LED module shelf labels.
//
// Unlike the DYMO, the Brother is a normal Windows printer with its own
// driver, so there's no bridge: we build one page per label, sized exactly
// to the loaded DK roll, in a hidden iframe and open the browser's print
// dialog. Pick the Brother there once; Chrome remembers it.
//
// Page sizes are given the way the Brother driver lists them: width across
// the tape, then length along the feed. A die-cut 29×90 label comes out of
// the printer 29 mm wide and 90 mm long, so the content is drawn sideways
// (long side = reading direction) and rotated onto the page.

import { qrDataUrl } from './dymoLabel.js';

export const BROTHER_SIZES = {
  'DK-1201': { id: 'DK-1201', name: 'DK-1201 — Address (29 × 90 mm)',          widthMm: 29, lengthMm: 90 },
  'DK-1209': { id: 'DK-1209', name: 'DK-1209 — Small address (29 × 62 mm)',    widthMm: 29, lengthMm: 62 },
  'DK-1208': { id: 'DK-1208', name: 'DK-1208 — Large address (38 × 90 mm)',    widthMm: 38, lengthMm: 90 },
  'DK-1202': { id: 'DK-1202', name: 'DK-1202 — Shipping (62 × 100 mm)',        widthMm: 62, lengthMm: 100 },
  'DK-2210': { id: 'DK-2210', name: 'DK-2210 — 29 mm continuous (cut at 90 mm)', widthMm: 29, lengthMm: 90 },
  'DK-2205': { id: 'DK-2205', name: 'DK-2205 — 62 mm continuous (cut at 30 mm)', widthMm: 62, lengthMm: 30 }
};

export const DEFAULT_BROTHER_SIZE = 'DK-1201';

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

// Label geometry: the page as the driver sees it, plus the readable
// (landscape) box the content is laid out in.
export function brotherGeometry(sizeId) {
  const size = BROTHER_SIZES[sizeId] || BROTHER_SIZES[DEFAULT_BROTHER_SIZE];
  const long  = Math.max(size.widthMm, size.lengthMm);
  const short = Math.min(size.widthMm, size.lengthMm);
  return {
    size,
    pageW: size.widthMm,
    pageH: size.lengthMm,
    rotate: size.lengthMm > size.widthMm, // tape runs the long way → turn content
    boxW: long,
    boxH: short
  };
}

// Builds the print document. `items` is [{ data, copies }] where data comes
// from buildModuleLabelData(); `qrs` maps data.qrText → PNG data URL.
// Pure (no DOM) so it can be tested in node.
export function buildBrotherLabelsHtml(items, sizeId, qrs = {}) {
  const g = brotherGeometry(sizeId);
  const pad = 1.5;                      // mm inside the label edge
  const qr  = g.boxH - pad * 2;         // square QR on the left
  const f   = (k) => `${(g.boxH * k).toFixed(2)}mm`;

  const label = (d) => `
<div class="page"><div class="box">
  ${qrs[d.qrText] ? `<img class="qr" src="${qrs[d.qrText]}" alt="">` : '<div class="qr"></div>'}
  <div class="txt">
    <div class="part">${esc(d.partNo)}</div>
    ${d.detail ? `<div class="detail">${esc(d.detail)}</div>` : ''}
    <div class="fits">${esc(d.fits)}</div>
  </div>
</div></div>`;

  const pages = [];
  for (const it of items) {
    const n = Math.max(0, Math.floor(Number(it.copies) || 0));
    for (let i = 0; i < n; i++) pages.push(label(it.data));
  }

  // rotate(90deg) about the top-left corner, then shift right by the page
  // width, puts the landscape box exactly on the portrait page.
  const turn = g.rotate
    ? `transform-origin: 0 0; transform: translateX(${g.pageW}mm) rotate(90deg);`
    : '';

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Module labels</title>
<style>
  @page { size: ${g.pageW}mm ${g.pageH}mm; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body { font-family: Arial, Helvetica, sans-serif; color: #000; background: #fff; }
  .page {
    position: relative; overflow: hidden;
    width: ${g.pageW}mm; height: ${g.pageH}mm;
    page-break-after: always; break-after: page;
  }
  .page:last-child { page-break-after: auto; break-after: auto; }
  .box {
    position: absolute; top: 0; left: 0;
    width: ${g.boxW}mm; height: ${g.boxH}mm;
    padding: ${pad}mm; display: flex; align-items: center; gap: ${pad * 1.5}mm;
    ${turn}
  }
  .qr { width: ${qr}mm; height: ${qr}mm; flex: 0 0 auto; }
  .txt { flex: 1; min-width: 0; display: flex; flex-direction: column; justify-content: center; gap: ${f(0.03)}; }
  .part { font-weight: 700; font-size: ${f(0.2)}; line-height: 1.05; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .detail { font-size: ${f(0.09)}; line-height: 1.15; max-height: 2.3em; overflow: hidden; }
  .fits { font-size: ${f(0.08)}; line-height: 1.15; max-height: 3.45em; overflow: hidden; }
</style></head>
<body>${pages.join('')}</body></html>`;
}

// Opens the print dialog with every label. Resolves once the dialog has been
// handed the document (the browser doesn't say whether it was printed).
export async function printModuleLabelsBrother(items, sizeId = DEFAULT_BROTHER_SIZE) {
  const qrs = {};
  for (const it of items) {
    const t = it.data.qrText;
    if (!qrs[t]) qrs[t] = await qrDataUrl(t, 300);
  }
  const html = buildBrotherLabelsHtml(items, sizeId, qrs);

  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  document.body.appendChild(frame);

  await new Promise((resolve) => {
    frame.onload = resolve;
    frame.srcdoc = html;
  });
  // Images are data URLs, but give them a beat to decode before printing.
  const imgs = Array.from(frame.contentDocument.images);
  await Promise.all(imgs.map((im) => (im.complete ? null : new Promise((r) => { im.onload = im.onerror = r; }))));

  frame.contentWindow.focus();
  frame.contentWindow.print();
  // print() blocks until the dialog closes in Chrome; remove afterwards.
  setTimeout(() => frame.remove(), 1000);
}
