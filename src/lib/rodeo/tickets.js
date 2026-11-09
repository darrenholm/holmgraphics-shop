// src/lib/rodeo/tickets.js
//
// Holmdale Pro Rodeo bar drink tickets, as ESC/POS bytes for the receipt
// printer. One ticket per drink: a partial cut between tickets so they tear
// apart at the bar, and a full cut after the last one.
//
// Ticket layout (top to bottom):
//   [ rodeo logo | QR code ]     one raster image, side by side
//   [■■■ BEER / PREMIUM ■■■]     white letters knocked out of a black bar,
//                                so the bartender can tell them apart at a glance
//   1 DRINK, ticket number, date, "19+ wristband required"
//
// The header is drawn on a canvas and sent as one bitmap (GS v 0), so it
// prints the same on any ESC/POS printer: no reliance on a printer's own QR
// or reverse-text support. Without a canvas (server-side), it falls back to
// a plain text layout with the printer's own QR command.

import qrcode from 'qrcode-generator';
import { Receipt } from '$lib/pos/escpos.js';
import { rodeoLogoBytes } from './rodeoLogo.js';

const GS = 0x1d, ESC = 0x1b;
const CENTER = [ESC, 0x61, 0x01];
const LEFT = [ESC, 0x61, 0x00];
const BOLD_ON = [ESC, 0x45, 1];
const BOLD_OFF = [ESC, 0x45, 0];

// GS V 66 n / GS V 65 n: feed n, then partial / full cut.
const partialCut = (r) => r.raw([GS, 0x56, 66, 3]);
const fullCut = (r) => r.raw([GS, 0x56, 65, 3]);

function shortCode(id) {
  return String(id).replace(/^[a-z]+_/, '').slice(-6).toUpperCase();
}

export function newSaleId(prefix = 'sim') {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

const kindLabel = (kind) => (kind === 'P' ? 'PREMIUM' : 'BEER');

// ─── Bitmap header ───────────────────────────────────────────────────────────

// The logo raster is a finished GS v 0 command: 8-byte header, then 1-bit rows.
function logoBits() {
  const b = rodeoLogoBytes();
  const wBytes = b[4] | (b[5] << 8);
  const h = b[6] | (b[7] << 8);
  return { w: wBytes * 8, h, wBytes, data: b.subarray(8) };
}

function drawHeader(kind, qrData, headWidth) {
  const W = headWidth;                      // printer dots across (360 = 58mm, 576 = 80mm)
  const boxH = W >= 576 ? 220 : 170;        // logo/QR row height
  const barH = W >= 576 ? 110 : 84;         // black BEER/PREMIUM bar
  const gap = 10;
  const H = boxH + gap + barH;

  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#000';

  // Left half: logo, scaled to fit, centred in its box.
  const half = Math.floor(W / 2);
  const logo = logoBits();
  const ls = Math.min((half - 8) / logo.w, boxH / logo.h);
  const lw = Math.floor(logo.w * ls), lh = Math.floor(logo.h * ls);
  const lx = Math.floor((half - lw) / 2), ly = Math.floor((boxH - lh) / 2);
  for (let y = 0; y < lh; y++) {
    const sy = Math.min(logo.h - 1, Math.floor(y / ls));
    for (let x = 0; x < lw; x++) {
      const sx = Math.min(logo.w - 1, Math.floor(x / ls));
      if (logo.data[sy * logo.wBytes + (sx >> 3)] & (0x80 >> (sx & 7))) ctx.fillRect(lx + x, ly + y, 1, 1);
    }
  }

  // Right half: QR, whole-dot modules so it stays sharp.
  const qr = qrcode(0, 'M');
  qr.addData(qrData);
  qr.make();
  const n = qr.getModuleCount();
  const cell = Math.max(2, Math.floor(Math.min(half - 16, boxH - 8) / n));
  const qs = n * cell;
  const qx = half + Math.floor((half - qs) / 2), qy = Math.floor((boxH - qs) / 2);
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) if (qr.isDark(r, c)) ctx.fillRect(qx + c * cell, qy + r * cell, cell, cell);
  }

  // Bar: solid black, label knocked out in white, as big as fits.
  const by = boxH + gap;
  ctx.fillRect(0, by, W, barH);
  const label = kindLabel(kind);
  let size = Math.floor(barH * 0.82);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  do {
    ctx.font = `900 ${size}px Arial Black, Arial, Helvetica, sans-serif`;
    size -= 2;
  } while (ctx.measureText(label).width > W - 24 && size > 20);
  ctx.fillStyle = '#fff';
  ctx.fillText(label, W / 2, by + barH / 2 + 2);

  return canvasToRaster(ctx, W, H);
}

// Canvas pixels -> GS v 0 raster command (1 = black dot).
function canvasToRaster(ctx, W, H) {
  const px = ctx.getImageData(0, 0, W, H).data;
  const wBytes = Math.ceil(W / 8);
  const out = new Uint8Array(8 + wBytes * H);
  out.set([GS, 0x76, 0x30, 0, wBytes & 0xff, wBytes >> 8, H & 0xff, H >> 8]);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      if (px[i] + px[i + 1] + px[i + 2] < 384) out[8 + y * wBytes + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return out;
}

// ─── Text-only fallback (no canvas) ──────────────────────────────────────────

function qrCommand(r, data, dot = 5) {
  const d = Array.from(data, (c) => c.charCodeAt(0) & 0x7f);
  const len = d.length + 3;
  r.raw(CENTER);
  r.raw([GS, 0x28, 0x6b, 4, 0, 0x31, 0x41, 0x32, 0]);
  r.raw([GS, 0x28, 0x6b, 3, 0, 0x31, 0x43, dot]);
  r.raw([GS, 0x28, 0x6b, 3, 0, 0x31, 0x45, 0x31]);
  r.raw([GS, 0x28, 0x6b, len & 0xff, len >> 8, 0x31, 0x50, 0x30]).raw(d);
  r.raw([GS, 0x28, 0x6b, 3, 0, 0x31, 0x51, 0x30]);
  return r.raw(LEFT);
}

function textHeader(r, kind, qrData, width, logo) {
  if (logo) {
    try { r.raw(CENTER).raw(Array.from(rodeoLogoBytes())).raw(LEFT); }
    catch { r.center('HOLMDALE PRO RODEO'); }
  }
  // GS B 1 = reverse (white on black), triple size.
  r.raw(CENTER).raw(BOLD_ON).raw([GS, 0x42, 1, GS, 0x21, 0x22])
    .line(` ${kindLabel(kind)} `)
    .raw([GS, 0x21, 0x00, GS, 0x42, 0]).raw(BOLD_OFF).raw(LEFT);
  qrCommand(r, qrData, width >= 48 ? 6 : 5);
}

// ─── Tickets ─────────────────────────────────────────────────────────────────

/**
 * sale = { id, beer, premium, test }
 * width = printer columns (32 for 58mm, 48 for 80mm)
 */
export function buildTickets({ id, beer = 0, premium = 0, test = true }, { width = 32, logo = true } = {}) {
  const r = new Receipt(width);
  const code = shortCode(id);
  const when = new Date().toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' });
  const kinds = [...Array(beer).fill('B'), ...Array(premium).fill('P')];
  const headDots = width >= 48 ? 576 : 360; // Epson 58mm mode prints 360 dots; fits 384-dot heads too
  const canDraw = typeof document !== 'undefined';

  kinds.forEach((kind, i) => {
    const n = i + 1;
    const qrData = `HPR1|${id}|${kind}|${n}`;
    if (canDraw) r.raw(CENTER).raw(Array.from(drawHeader(kind, qrData, headDots))).raw(LEFT);
    else textHeader(r, kind, qrData, width, logo);
    r.raw(CENTER);
    r.raw(BOLD_ON).line('1 DRINK').raw(BOLD_OFF);
    r.line(`${code}-${kind}${n}   ${n} of ${kinds.length}`);
    r.line(when);
    r.line('19+ wristband required');
    if (test) r.line('*** TEST - NOT VALID ***');
    r.raw(LEFT);
    if (n < kinds.length) partialCut(r); else fullCut(r);
  });
  return r.toBytes();
}

export function buildCutTest({ width = 32 } = {}) {
  const r = new Receipt(width);
  r.raw(CENTER);
  r.raw([ESC, 0x45, 1, GS, 0x21, 0x11]).line('RODEO TEST BED').raw([GS, 0x21, 0x00, ESC, 0x45, 0]);
  r.line(new Date().toLocaleString('en-CA'));
  r.line('Partial cut next');
  partialCut(r);
  r.line('Full cut next');
  fullCut(r);
  return r.toBytes();
}
