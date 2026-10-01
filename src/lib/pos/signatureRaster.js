// src/lib/pos/signatureRaster.js
//
// Turns the signature SVG from the card reader into an ESC/POS raster
// (GS v 0) so it prints on the 58mm receipt, the same way logoRaster.js
// carries the wordmark. Done in the browser: a canvas is the one SVG renderer
// every machine in the shop already has.
//
// Any pixel darker than mid-grey becomes ink. Signature strokes are thin, so
// the image is drawn a touch heavier than it arrives to survive a thermal
// head.

const DOTS = 384;          // full print width of a 58mm head
const MAX_HEIGHT = 200;    // keep a wild scribble from printing a metre of paper

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not draw the signature'));
    img.src = src;
  });
}

// Data URL for showing the signature on screen as an <img>.
export function svgDataUrl(svg) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function wrapText(ctx, text, maxWidth) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(next).width > maxWidth && cur) { lines.push(cur); cur = w; }
    else cur = next;
  }
  if (cur) lines.push(cur);
  return lines;
}

/**
 * The shop's copy for the job folder on L: — a PNG of the pickup slip, so
 * anyone opening the folder sees who signed and when without the app.
 */
export async function pickupSlipPng({
  projectId, clientName = '', description = '', signerName = '', signedAt = null, svg,
}) {
  const W = 1200, PAD = 60;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = 900;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, W, canvas.height);
  ctx.fillStyle = '#000';

  let y = PAD + 30;
  ctx.font = 'bold 40px Arial, sans-serif';
  ctx.fillText('Holm Graphics — Pickup Receipt', PAD, y);
  y += 60;
  ctx.font = 'bold 34px Arial, sans-serif';
  ctx.fillText(`Job #${projectId}`, PAD, y);
  y += 50;
  ctx.font = '28px Arial, sans-serif';
  const when = (signedAt ? new Date(signedAt) : new Date())
    .toLocaleString('en-CA', { timeZone: 'America/Toronto', dateStyle: 'long', timeStyle: 'short' });
  if (clientName) { ctx.fillText(`Customer: ${clientName}`, PAD, y); y += 42; }
  for (const l of wrapText(ctx, description, W - PAD * 2).slice(0, 3)) { ctx.fillText(l, PAD, y); y += 38; }
  y += 10;
  ctx.fillText(`Picked up by: ${signerName || '(name not given)'}`, PAD, y); y += 42;
  ctx.fillText(`Signed: ${when}`, PAD, y); y += 30;

  const img = await loadImage(svgDataUrl(svg));
  const w0 = img.naturalWidth || 600, h0 = img.naturalHeight || 200;
  const s = Math.min((W - PAD * 2) / w0, 300 / h0);
  ctx.drawImage(img, PAD, y, w0 * s, h0 * s);
  y += h0 * s + 10;
  ctx.fillRect(PAD, y, W - PAD * 2, 2);
  y += 40;
  ctx.font = '24px Arial, sans-serif';
  ctx.fillText('I have received the above order in good condition.', PAD, y);

  // Trim the unused bottom.
  const out = document.createElement('canvas');
  out.width = W;
  out.height = Math.min(canvas.height, Math.ceil(y + PAD));
  const octx = out.getContext('2d');
  octx.fillStyle = '#fff';
  octx.fillRect(0, 0, W, out.height);
  octx.drawImage(canvas, 0, 0);
  return new Promise((resolve, reject) =>
    out.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not make the image'))), 'image/png'));
}

/** SVG text → Uint8Array of a complete GS v 0 command. */
export async function signatureRaster(svg) {
  const img = await loadImage(svgDataUrl(svg));
  const w0 = img.naturalWidth || img.width || DOTS;
  const h0 = img.naturalHeight || img.height || DOTS / 3;
  const scale = Math.min(DOTS / w0, MAX_HEIGHT / h0);
  const w = DOTS;                                  // always full width; image centred
  const h = Math.max(8, Math.round(h0 * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  const dw = Math.round(w0 * scale);
  const dx = Math.round((w - dw) / 2);
  // Drawn twice, one dot apart, to thicken hairline strokes.
  ctx.drawImage(img, dx, 0, dw, h);
  ctx.drawImage(img, dx + 1, 1, dw, h);

  const px = ctx.getImageData(0, 0, w, h).data;
  const bytesPerRow = w / 8;
  const out = new Uint8Array(8 + bytesPerRow * h);
  // GS v 0 m xL xH yL yH
  out.set([0x1d, 0x76, 0x30, 0x00, bytesPerRow & 0xff, bytesPerRow >> 8, h & 0xff, h >> 8]);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      // Transparent counts as paper.
      const a = px[i + 3] / 255;
      const lum = (0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]) * a + 255 * (1 - a);
      if (lum < 128) out[8 + y * bytesPerRow + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return out;
}
