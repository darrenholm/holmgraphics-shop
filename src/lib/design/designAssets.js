// src/lib/design/designAssets.js
//
// Browser-side helpers for the Design Assistant: shrinking attached images
// before they go to Claude, swapping the `asset:<name>` placeholders in a
// layout for the real image data, rendering a PNG proof, and naming files.

export const IMAGE_RE = /\.(png|jpe?g|webp|gif)$/i;

// Claude downsizes anything bigger than ~1568px on the long edge anyway, so
// sending more only costs upload time and request size. WEBP keeps logo
// transparency, which JPEG would flatten to black.
const MAX_EDGE = 1568;

export function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error || new Error('Could not read file'));
    r.readAsDataURL(blob);
  });
}

// Returns { media_type, base64, dataUrl } ready for a Claude image block and
// for the on-screen preview.
export async function prepareImage(blob) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch {
    throw new Error('That file is not an image the browser can open.');
  }
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  const out = await new Promise((res) => canvas.toBlob(res, 'image/webp', 0.9));
  if (!out) throw new Error('Could not process that image.');
  const dataUrl = await blobToDataUrl(out);
  return {
    media_type: 'image/webp',
    base64: dataUrl.slice(dataUrl.indexOf(',') + 1),
    dataUrl
  };
}

// Replace href="asset:<name>" with data URLs from `lookup(name)`. Unknown
// names are left alone (the image just won't show).
export async function inlineAssets(svg, lookup) {
  const names = [...new Set([...svg.matchAll(/href\s*=\s*["']asset:([^"']+)["']/gi)].map((m) => m[1]))];
  let out = svg;
  for (const name of names) {
    const dataUrl = await lookup(name);
    if (!dataUrl) continue;
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(`href\\s*=\\s*["']asset:${esc}["']`, 'g'), `href="${dataUrl}"`);
  }
  return out;
}

export function svgBlob(svg) {
  return new Blob([svg], { type: 'image/svg+xml' });
}

// Render at `dpi`, capped so a 20-ft banner doesn't try to allocate a canvas
// the browser refuses. A proof only needs to be readable on screen / email.
export async function svgToPngBlob(svg, widthIn, heightIn, dpi = 100, maxPx = 6000) {
  let w = widthIn * dpi;
  let h = heightIn * dpi;
  const shrink = Math.min(1, maxPx / Math.max(w, h));
  w = Math.round(w * shrink);
  h = Math.round(h * shrink);
  const url = URL.createObjectURL(svgBlob(svg));
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('Could not render the layout.'));
      i.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
    if (!blob) throw new Error('Could not render the layout.');
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Layout-<jobid>-<slug>-YYYYMMDD-HHmm.<ext> — timestamped like the Quote PDF
// so a second save never overwrites the first.
export function layoutFilename(jobId, title, ext, now = new Date()) {
  const slug = String(title || 'layout')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'layout';
  const pad = (n) => String(n).padStart(2, '0');
  const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
  return `Layout-${jobId}-${slug}-${ts}.${ext}`;
}
