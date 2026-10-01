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
