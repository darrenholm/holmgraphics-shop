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
// the tape, then length along the feed. androidPaper is how Android's
// Brother Print Service Plugin names the matching paper size; picking any
// other size makes the printer refuse the job ("Roll type mismatch"). A die-cut 29×90 label comes out of
// the printer 29 mm wide and 90 mm long, so the content is drawn sideways
// (long side = reading direction) and rotated onto the page.

import { qrDataUrl } from './dymoLabel.js';

export const BROTHER_SIZES = {
  // What the shop puts on modules: small enough to sit on the back of a module.
  'DK-1204': { id: 'DK-1204', name: 'DK-1204 — Multi-purpose (17 × 54 mm)',    widthMm: 17, lengthMm: 54, androidPaper: '0.66" x 2.1"' },
  'DK-1201': { id: 'DK-1201', name: 'DK-1201 — Address (29 × 90 mm)',          widthMm: 29, lengthMm: 90, androidPaper: '1.1" x 3.5"' },
  'DK-1209': { id: 'DK-1209', name: 'DK-1209 — Small address (29 × 62 mm)',    widthMm: 29, lengthMm: 62, androidPaper: '2.4" x 1.1"' },
  'DK-1208': { id: 'DK-1208', name: 'DK-1208 — Large address (38 × 90 mm)',    widthMm: 38, lengthMm: 90, androidPaper: '1.4" x 3.5"' },
  'DK-1202': { id: 'DK-1202', name: 'DK-1202 — Shipping (62 × 100 mm)',        widthMm: 62, lengthMm: 100, androidPaper: '2.4" x 3.9"' },
  'DK-2210': { id: 'DK-2210', name: 'DK-2210 — 29 mm continuous (cut at 90 mm)', widthMm: 29, lengthMm: 90, androidPaper: '1.1" x 39"' },
  'DK-2205': { id: 'DK-2205', name: 'DK-2205 — 62 mm continuous (cut at 30 mm)', widthMm: 62, lengthMm: 30, androidPaper: '2.4" x 39"' }
};

export const DEFAULT_BROTHER_SIZE = 'DK-1204';

// Average bold-Arial character width for mixed-case names (node tests only;
// the browser measures the real text).
function estimateWidth(text, mm) {
  return text.length * 0.56 * mm;
}

// Exact width via canvas. Measured once at 100 px and scaled.
function canvasMeasure() {
  const ctx = document.createElement('canvas').getContext('2d');
  ctx.font = 'bold 100px Arial, Helvetica, sans-serif';
  const cache = new Map();
  return (text, mm) => {
    if (!cache.has(text)) cache.set(text, ctx.measureText(text).width / 100);
    return cache.get(text) * mm;
  };
}

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

// Builds the labels. `items` is [{ data, copies }] where data comes from
// buildModuleLabelData(); `qrs` maps data.qrText → PNG data URL.
// `measure(text, mm)` returns the width in mm of `text` in bold Arial at
// `mm` font size; the browser passes a canvas-based one (exact), node tests
// fall back to an average character width.
// Returns { pageCss, labelCss, pages }: the @page rule, the label styles
// (all classes prefixed hgl- so they can sit inside the app's own page),
// and the label markup. Pure (no DOM) so it can be tested in node.
export function buildBrotherLabelParts(items, sizeId, qrs = {}, measure = estimateWidth) {
  const g = brotherGeometry(sizeId);
  const pad = 1;                        // mm inside the label edge
  const qr  = g.boxH * 0.75;            // QR on the left; scans fine at 12 mm
  const gap = 1.5;

  // The client names are what staff read off the shelf, so they get the
  // whole text column. The part number is left off (the QR carries it and
  // the module's own sticker shows it); the shelf, if set, is one small line.
  // Each name starts its own line and may wrap; the font is the largest
  // (up to 28% of the label height) at which every wrapped line fits.
  const textW = g.boxW - pad * 2 - qr - gap;
  const small = g.boxH * 0.085;
  const fitsSize = (lines, hasFooter) => {
    const area = g.boxH - pad * 2 - (hasFooter ? small * 1.25 + g.boxH * 0.03 : 0);
    for (let mm = g.boxH * 0.28; mm > small; mm -= 0.05) {
      const rows = lines.reduce((n, l) => n + Math.max(1, Math.ceil(measure(String(l), mm) / textW)), 0);
      if (rows * mm * 1.1 <= area) return mm;
    }
    return small;
  };

  const label = (d) => {
    const lines = d.fitsLines && d.fitsLines.length ? d.fitsLines : [d.fits];
    const mm = fitsSize(lines, !!d.detail);
    return `
<div class="hgl-page"><div class="hgl-box">
  ${qrs[d.qrText] ? `<img class="hgl-qr" src="${qrs[d.qrText]}" alt="">` : '<div class="hgl-qr"></div>'}
  <div class="hgl-txt">
    <div class="hgl-fits" style="font-size: ${mm.toFixed(2)}mm">${lines.map((l) => `<div>${esc(l)}</div>`).join('')}</div>
    ${d.detail ? `<div class="hgl-detail">${esc(d.detail)}</div>` : ''}
  </div>
</div></div>`;
  };

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

  return {
    pageCss: `@page { size: ${g.pageW}mm ${g.pageH}mm; margin: 0; }`,
    labelCss: `
  .hgl-page, .hgl-page * { box-sizing: border-box; }
  .hgl-page {
    position: relative; overflow: hidden; margin: 0; padding: 0;
    width: ${g.pageW}mm; height: ${g.pageH}mm;
    font-family: Arial, Helvetica, sans-serif; color: #000; background: #fff;
    page-break-after: always; break-after: page;
  }
  .hgl-page:last-child { page-break-after: auto; break-after: auto; }
  .hgl-box {
    position: absolute; top: 0; left: 0;
    width: ${g.boxW}mm; height: ${g.boxH}mm;
    padding: ${pad}mm; display: flex; align-items: center; gap: ${gap}mm;
    ${turn}
  }
  .hgl-qr { width: ${qr}mm; height: ${qr}mm; flex: 0 0 auto; }
  .hgl-txt { flex: 1; min-width: 0; height: 100%; display: flex; flex-direction: column; justify-content: center; gap: ${(g.boxH * 0.03).toFixed(2)}mm; }
  .hgl-fits { font-weight: 700; line-height: 1.1; overflow: hidden; overflow-wrap: anywhere; }
  .hgl-detail { font-size: ${small.toFixed(2)}mm; line-height: 1.2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }`,
    pages: pages.join(''),
  };
}

// The same labels as a standalone document (tests, PDF previews).
export function buildBrotherLabelsHtml(items, sizeId, qrs = {}, measure = estimateWidth) {
  const { pageCss, labelCss, pages } = buildBrotherLabelParts(items, sizeId, qrs, measure);
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Module labels</title>
<style>
  ${pageCss}
  html, body { margin: 0; padding: 0; background: #fff; }
${labelCss}
</style></head>
<body>${pages}</body></html>`;
}

// Printing happens from the app's own page, not a hidden iframe: some
// Android Chrome builds (the shop's ZTE tablet) ignore the iframe and print
// the whole app page instead. The labels go into a container on <body>, and
// a print-only stylesheet hides everything else and sets the label size.
// It stays in place until the next job or clearBrotherPrint(): Android's
// print screen re-renders the page whenever the printer or paper changes,
// and removing it early made those re-renders blank.
const PRINT_ID = 'hgl-print';

export function clearBrotherPrint() {
  if (typeof document === 'undefined') return;
  document.getElementById(PRINT_ID)?.remove();
  document.getElementById(`${PRINT_ID}-style`)?.remove();
}

// Opens the print dialog with every label. Resolves once the dialog has been
// handed the page (the browser doesn't say whether it was printed).
export async function printModuleLabelsBrother(items, sizeId = DEFAULT_BROTHER_SIZE) {
  const qrs = {};
  for (const it of items) {
    const t = it.data.qrText;
    if (!qrs[t]) qrs[t] = await qrDataUrl(t, 300);
  }
  const { pageCss, labelCss, pages } = buildBrotherLabelParts(items, sizeId, qrs, canvasMeasure());

  clearBrotherPrint();
  const style = document.createElement('style');
  style.id = `${PRINT_ID}-style`;
  style.textContent = `
  ${pageCss}
  #${PRINT_ID} { display: none; }
  @media print {
    html, body { margin: 0 !important; padding: 0 !important; background: #fff !important;
                 width: auto !important; height: auto !important; overflow: visible !important; }
    body > *:not(#${PRINT_ID}) { display: none !important; }
    #${PRINT_ID} { display: block !important; }
  }
${labelCss}`;
  const box = document.createElement('div');
  box.id = PRINT_ID;
  box.innerHTML = pages;
  document.head.appendChild(style);
  document.body.appendChild(box);

  // Wait for the QR images (data URLs) to decode before printing.
  const imgs = Array.from(box.querySelectorAll('img'));
  await Promise.all(imgs.map((im) => (im.decode ? im.decode().catch(() => {}) : null)));

  window.print();
}
