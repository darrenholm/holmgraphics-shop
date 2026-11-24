// src/lib/nametags/render.js
//
// Staff nametags for the Seaory S25 card printer (CR80 NFC cards, NTAG215).
// One renderer draws the shop's template preview, the client's proofs and the
// print PDF, so what the client approves is what prints.
//
// Printer notes (from the shop):
//   - Card is CR80: 3.375 x 2.125 in, 1/8 in corner radius. Only size it takes.
//   - No full bleed: edge-to-edge prints break the S25 ribbon. Everything stays
//     inside an unprinted white edge (default 1/16 in; registration is tight).
//     The print area's corners are rounded to match the card so the white
//     border reads as an even line.
//
// A "design" is plain JSON (stored in nametag_templates.design):
//   { orient, w, h, edge, font, bg, bgImg, band:{pos,size,color},
//     logo:{src,x,y,w}, photo:{on,x,y,size,shape,ring},
//     fields:[{key,label,on,x,y,size,bold,color,align,upper}] }
// x/y are fractions of the card (0..1), sizes are inches, text size is points.
// A "card" (person) is { first, last, title, dept, extra, photo }.

export const CARD = { long: 3.375, short: 2.125, radius: 0.125 };
export const DEFAULT_EDGE = 0.0625;
export const FONTS = ['Montserrat', 'Oswald', 'Lato', 'Merriweather', 'Roboto Condensed'];
export const FONT_CSS =
  'https://fonts.googleapis.com/css2?family=Montserrat:wght@400;700&family=Oswald:wght@400;700&family=Lato:wght@400;700&family=Merriweather:wght@400;700&family=Roboto+Condensed:wght@400;700&display=swap';

export const FIELD_KEYS = ['first', 'last', 'title', 'dept', 'extra'];

function layoutFor(orient) {
  if (orient === 'portrait') return {
    w: CARD.short, h: CARD.long,
    band: { size: 0.3 }, logo: { x: 0.5, y: 0.1, w: 1.55 }, photo: { x: 0.5, y: 0.37, size: 1.2 },
    pos: { first: [0.5, 0.64, 20, 'center'], last: [0.5, 0.73, 11, 'center'], title: [0.5, 0.81, 8, 'center'],
           extra: [0.5, 0.87, 6.5, 'center'], dept: [0.5, 0.955, 7, 'center'] },
  };
  return {
    w: CARD.long, h: CARD.short,
    band: { size: 0.28 }, logo: { x: 0.72, y: 0.16, w: 1.2 }, photo: { x: 0.19, y: 0.47, size: 1.05 },
    pos: { first: [0.38, 0.45, 22, 'left'], last: [0.38, 0.6, 11, 'left'], title: [0.38, 0.73, 8, 'left'],
           extra: [0.38, 0.33, 6.5, 'left'], dept: [0.5, 0.935, 7, 'center'] },
  };
}

/** Reset positions/sizes to the starting layout for an orientation. */
export function applyLayout(design, orient) {
  const L = layoutFor(orient);
  design.orient = orient; design.w = L.w; design.h = L.h;
  design.band.size = L.band.size;
  Object.assign(design.logo, L.logo);
  Object.assign(design.photo, L.photo);
  for (const f of design.fields) {
    const p = L.pos[f.key];
    if (p) { f.x = p[0]; f.y = p[1]; f.size = p[2]; f.align = p[3]; }
  }
  return design;
}

export function defaultDesign() {
  const d = {
    orient: 'landscape', w: CARD.long, h: CARD.short, edge: DEFAULT_EDGE,
    font: 'Montserrat', bg: '#ffffff', bgImg: null,
    band: { pos: 'bottom', size: 0.28, color: '#1a1a1a' },
    logo: { src: null, x: 0.72, y: 0.16, w: 1.2 },
    photo: { on: true, x: 0.19, y: 0.47, size: 1.05, shape: 'circle', ring: '#1a1a1a' },
    fields: [
      { key: 'first', label: 'First name', on: true,  bold: true,  color: '#1a1a1a', upper: false },
      { key: 'last',  label: 'Last name',  on: true,  bold: false, color: '#1a1a1a', upper: false },
      { key: 'title', label: 'Title',      on: true,  bold: true,  color: '#c0392b', upper: true },
      { key: 'dept',  label: 'Department', on: true,  bold: true,  color: '#ffffff', upper: true },
      { key: 'extra', label: 'Extra line', on: false, bold: false, color: '#555555', upper: false },
    ],
  };
  return applyLayout(d, 'landscape');
}

/** Fill in anything an older saved design is missing. */
export function normalizeDesign(d) {
  const base = defaultDesign();
  if (!d || typeof d !== 'object') return base;
  const out = { ...base, ...d,
    band: { ...base.band, ...(d.band || {}) },
    logo: { ...base.logo, ...(d.logo || {}) },
    photo: { ...base.photo, ...(d.photo || {}) },
  };
  out.fields = base.fields.map((bf) => ({ ...bf, ...((d.fields || []).find((f) => f.key === bf.key) || {}) }));
  if (typeof out.edge !== 'number' || out.edge < 0.0625) out.edge = DEFAULT_EDGE;
  return out;
}

/* ---------- images ---------- */

const imgCache = new Map();
/** Returns a loaded HTMLImageElement or null; calls onLoad once it finishes. */
export function getImg(src, onLoad) {
  if (!src) return null;
  let rec = imgCache.get(src);
  if (!rec) {
    const im = new Image();
    rec = { im, ok: false, waiters: new Set() };
    im.onload = () => { rec.ok = true; rec.waiters.forEach((fn) => fn()); rec.waiters.clear(); };
    im.src = src;
    imgCache.set(src, rec);
  }
  if (!rec.ok && onLoad) rec.waiters.add(onLoad);
  return rec.ok ? rec.im : null;
}

/** Wait until every image a set of cards needs has loaded (for the PDF). */
export function preloadImages(design, cards) {
  const srcs = new Set([design.logo?.src, design.bgImg, ...cards.map((c) => c.photo)].filter(Boolean));
  return Promise.all([...srcs].map((src) => new Promise((resolve) => {
    if (getImg(src)) return resolve();
    getImg(src, resolve);
    setTimeout(resolve, 8000); // never hang the PDF on one bad image
  })));
}

/**
 * Read an uploaded file as a data URL, downsized to maxPx on the long side.
 * Photos come back as JPEG; logos keep PNG transparency; SVG logos pass through.
 */
export function readImage(file, { maxPx = 700, keepTransparency = false } = {}) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(new Error('Could not read that file.'));
    r.onload = () => {
      const src = r.result;
      if (keepTransparency && file.type === 'image/svg+xml') return resolve(src);
      const im = new Image();
      im.onload = () => {
        const k = Math.min(1, maxPx / Math.max(im.width, im.height));
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(im.width * k));
        c.height = Math.max(1, Math.round(im.height * k));
        const ctx = c.getContext('2d');
        if (!keepTransparency) { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, c.width, c.height); }
        ctx.drawImage(im, 0, 0, c.width, c.height);
        resolve(keepTransparency ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', 0.85));
      };
      im.onerror = () => reject(new Error('That file is not an image this browser can open.'));
      im.src = src;
    };
    r.readAsDataURL(file);
  });
}

export async function loadFonts(family) {
  if (typeof document === 'undefined' || !document.fonts) return;
  const fams = family ? [family] : FONTS;
  await Promise.all(fams.flatMap((f) => [
    document.fonts.load(`400 20px '${f}'`), document.fonts.load(`700 20px '${f}'`),
  ])).catch(() => {});
}

/* ---------- drawing ---------- */

function coverDraw(ctx, im, x, y, w, h) {
  const iw = im.naturalWidth || im.width, ih = im.naturalHeight || im.height;
  const k = Math.max(w / iw, h / ih), sw = w / k, sh = h / k;
  ctx.drawImage(im, (iw - sw) / 2, (ih - sh) / 2, sw, sh, x, y, w, h);
}

/**
 * Draw one card at `ppi` pixels per inch into ctx (origin at the card's corner).
 * opts.boxes: array to collect hit boxes (template editor drag).
 * opts.showLabels: draw field labels where a card has no text (template editor).
 * opts.onImageLoad: called when a not-yet-loaded image finishes (re-render).
 */
export function renderCard(ctx, design, card, ppi, opts = {}) {
  const { boxes = null, showLabels = false, onImageLoad } = opts;
  const t = design;
  const W = t.w * ppi, H = t.h * ppi, E = (t.edge ?? DEFAULT_EDGE) * ppi;
  ctx.save();
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);
  // Print area: inset by the unprinted edge, corners rounded to match the card.
  const R = Math.max(0, CARD.radius * ppi - E);
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(E, E, W - 2 * E, H - 2 * E, R); else ctx.rect(E, E, W - 2 * E, H - 2 * E);
  ctx.clip();

  ctx.fillStyle = t.bg; ctx.fillRect(0, 0, W, H);
  const bgi = getImg(t.bgImg, onImageLoad);
  if (bgi) coverDraw(ctx, bgi, 0, 0, W, H);

  const b = t.band;
  if (b.pos !== 'none' && b.size > 0) {
    ctx.fillStyle = b.color; const s = b.size * ppi;
    if (b.pos === 'top') ctx.fillRect(0, 0, W, s);
    if (b.pos === 'bottom') ctx.fillRect(0, H - s, W, s);
    if (b.pos === 'left') ctx.fillRect(0, 0, s, H);
  }

  const lg = getImg(t.logo.src, onImageLoad);
  if (lg) {
    const lw = t.logo.w * ppi;
    const lh = lw * (lg.naturalHeight || lg.height) / (lg.naturalWidth || lg.width || 1);
    const lx = t.logo.x * W - lw / 2, ly = t.logo.y * H - lh / 2;
    ctx.drawImage(lg, lx, ly, lw, lh);
    if (boxes) boxes.push({ key: 'logo', x: lx, y: ly, w: lw, h: lh });
  }

  const ph = t.photo;
  if (ph.on) {
    const s = ph.size * ppi, px = ph.x * W - s / 2, py = ph.y * H - s / 2;
    const shape = () => {
      ctx.beginPath();
      if (ph.shape === 'circle') ctx.arc(px + s / 2, py + s / 2, s / 2, 0, Math.PI * 2); else ctx.rect(px, py, s, s);
    };
    ctx.save(); shape(); ctx.clip();
    const pi = getImg(card.photo, onImageLoad);
    if (pi) coverDraw(ctx, pi, px, py, s, s);
    else {
      ctx.fillStyle = '#d9e0e5'; ctx.fillRect(px, py, s, s);
      ctx.fillStyle = '#a9b5be';
      ctx.beginPath(); ctx.arc(px + s / 2, py + s * 0.4, s * 0.19, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(px + s / 2, py + s * 0.95, s * 0.36, s * 0.3, 0, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
    if (ph.ring) {
      ctx.lineWidth = Math.max(1, 0.025 * ppi); ctx.strokeStyle = ph.ring; shape(); ctx.stroke();
    }
    if (boxes) boxes.push({ key: 'photo', x: px, y: py, w: s, h: s });
  }

  for (const f of t.fields) {
    if (!f.on) continue;
    let text = (card[f.key] || '').trim();
    const sample = !text && showLabels;
    if (sample) text = f.label;
    if (!text) continue;
    if (f.upper) text = text.toUpperCase();
    let px = f.size / 72 * ppi;
    const x = f.x * W, y = f.y * H, pad = 0.06 * ppi + E;
    const maxW = f.align === 'center' ? 2 * Math.min(x, W - x) - 2 * pad
      : f.align === 'left' ? W - x - pad : x - pad;
    const setFont = () => { ctx.font = `${f.bold ? 700 : 400} ${px}px '${t.font}', sans-serif`; };
    setFont();
    let tw = ctx.measureText(text).width;
    if (tw > maxW && maxW > 0) { px *= maxW / tw; setFont(); tw = ctx.measureText(text).width; } // long names shrink to fit
    ctx.fillStyle = f.color; ctx.textAlign = f.align; ctx.textBaseline = 'middle';
    ctx.globalAlpha = sample ? 0.45 : 1;
    ctx.fillText(text, x, y);
    ctx.globalAlpha = 1;
    if (boxes) {
      const bx = f.align === 'center' ? x - tw / 2 : f.align === 'left' ? x : x - tw;
      boxes.push({ key: f.key, x: bx, y: y - px * 0.6, w: tw, h: px * 1.2 });
    }
  }
  ctx.restore();
}

/** Repeat each card by its qty, in order. */
export function expandCards(cards) {
  const out = [];
  for (const c of cards) for (let i = 0; i < Math.max(0, c.qty | 0); i++) out.push(c);
  return out;
}

/* ---------- print PDF: one CR80 card per page, actual size ---------- */

function dataUrlToBytes(dataUrl) {
  const bin = atob(dataUrl.slice(dataUrl.indexOf(',') + 1));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Minimal PDF writer: each page is one full-page JPEG. */
function writePdf(pages, wPt, hPt) {
  const enc = new TextEncoder();
  const chunks = []; const offsets = []; let pos = 0;
  const push = (data) => { const b = typeof data === 'string' ? enc.encode(data) : data; chunks.push(b); pos += b.length; };
  const startObj = (n) => { offsets[n] = pos; push(`${n} 0 obj\n`); };
  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  const n = pages.length;
  const kids = pages.map((_, i) => `${3 + i * 3} 0 R`).join(' ');
  startObj(1); push('<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  startObj(2); push(`<< /Type /Pages /Kids [${kids}] /Count ${n} >>\nendobj\n`);
  pages.forEach((p, i) => {
    const pageN = 3 + i * 3, contentN = pageN + 1, imgN = pageN + 2;
    const content = `q ${wPt} 0 0 ${hPt} 0 0 cm /Im0 Do Q`;
    startObj(pageN);
    push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${wPt} ${hPt}] /Resources << /XObject << /Im0 ${imgN} 0 R >> >> /Contents ${contentN} 0 R >>\nendobj\n`);
    startObj(contentN); push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`);
    startObj(imgN);
    push(`<< /Type /XObject /Subtype /Image /Width ${p.pxW} /Height ${p.pxH} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`);
    push(p.jpeg); push('\nendstream\nendobj\n');
  });
  const total = 2 + n * 3;
  const xref = pos;
  let x = `xref\n0 ${total + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= total; i++) x += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
  push(x + `trailer\n<< /Size ${total + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(chunks, { type: 'application/pdf' });
}

/**
 * Build the print PDF for the Seaory S25: one card per page at actual size
 * (3.375 x 2.125 in, or portrait), 300 ppi, white edge built in.
 */
export async function buildCardPdf(design, cards) {
  const d = normalizeDesign(design);
  const list = expandCards(cards);
  if (!list.length) throw new Error('There are no cards to print.');
  await loadFonts(d.font);
  await preloadImages(d, list);
  const ppi = 300;
  const c = document.createElement('canvas');
  c.width = Math.round(d.w * ppi); c.height = Math.round(d.h * ppi);
  const ctx = c.getContext('2d');
  const pages = list.map((card) => {
    ctx.clearRect(0, 0, c.width, c.height);
    renderCard(ctx, d, card, ppi);
    return { jpeg: dataUrlToBytes(c.toDataURL('image/jpeg', 0.95)), pxW: c.width, pxH: c.height };
  });
  return writePdf(pages, +(d.w * 72).toFixed(3), +(d.h * 72).toFixed(3));
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
