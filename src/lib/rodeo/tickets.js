// src/lib/rodeo/tickets.js
//
// Holmdale Pro Rodeo bar drink tickets, as ESC/POS bytes for the receipt
// printer. One ticket per drink: a partial cut between tickets so they tear
// apart at the bar, and a full cut after the last one.
//
// Reuses the counter receipt encoder (text clean-up, bold, double size) and
// adds the two things a ticket needs that a receipt doesn't: a QR code and
// partial cuts.

import { Receipt } from '$lib/pos/escpos.js';
import { rodeoLogoBytes } from './rodeoLogo.js';

const GS = 0x1d, ESC = 0x1b;

// GS ( k — QR model 2, error level M. `dot` is module size in printer dots.
function qr(r, data, dot = 5) {
  const d = Array.from(data, (c) => c.charCodeAt(0) & 0x7f);
  const len = d.length + 3;
  r.raw([ESC, 0x61, 0x01]);
  r.raw([GS, 0x28, 0x6b, 4, 0, 0x31, 0x41, 0x32, 0]);
  r.raw([GS, 0x28, 0x6b, 3, 0, 0x31, 0x43, dot]);
  r.raw([GS, 0x28, 0x6b, 3, 0, 0x31, 0x45, 0x31]);
  r.raw([GS, 0x28, 0x6b, len & 0xff, len >> 8, 0x31, 0x50, 0x30]).raw(d);
  r.raw([GS, 0x28, 0x6b, 3, 0, 0x31, 0x51, 0x30]);
  return r.raw([ESC, 0x61, 0x00]);
}

// GS V 66 n / GS V 65 n — feed n, then partial / full cut.
const partialCut = (r) => r.raw([GS, 0x56, 66, 3]);
const fullCut = (r) => r.raw([GS, 0x56, 65, 3]);

function shortCode(id) {
  return String(id).replace(/^[a-z]+_/, '').slice(-6).toUpperCase();
}

export function newSaleId(prefix = 'sim') {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * sale = { id, beer, premium, test }
 * width = printer columns (32 for 58mm, 48 for 80mm)
 */
export function buildTickets({ id, beer = 0, premium = 0, test = true }, { width = 32, logo = true } = {}) {
  const r = new Receipt(width);
  const code = shortCode(id);
  const when = new Date().toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' });
  const kinds = [...Array(beer).fill('B'), ...Array(premium).fill('P')];

  kinds.forEach((kind, i) => {
    const n = i + 1;
    if (logo) {
      try { r.raw([ESC, 0x61, 0x01]).raw(Array.from(rodeoLogoBytes())).raw([ESC, 0x61, 0x00]); }
      catch { r.center('HOLMDALE PRO RODEO'); }
    } else {
      r.raw([ESC, 0x45, 1]).center('HOLMDALE PRO RODEO').raw([ESC, 0x45, 0]);
    }
    // Triple size for the drink type — it's what the bartender reads.
    r.raw([ESC, 0x61, 0x01, ESC, 0x45, 1, GS, 0x21, 0x22])
      .line(kind === 'P' ? 'PREMIUM' : 'BEER')
      .raw([GS, 0x21, 0x00, ESC, 0x45, 0]);
    r.line('1 DRINK');
    qr(r, `HPR1|${id}|${kind}|${n}`, width >= 48 ? 6 : 5);
    r.center(`${code}-${kind}${n}   ${n} of ${kinds.length}`);
    r.center(when);
    r.raw([ESC, 0x45, 1]).center('19+ wristband required').raw([ESC, 0x45, 0]);
    if (test) r.center('*** TEST - NOT VALID ***');
    r.raw([ESC, 0x61, 0x00]);
    if (n < kinds.length) partialCut(r); else fullCut(r);
  });
  return r.toBytes();
}

export function buildCutTest({ width = 32 } = {}) {
  const r = new Receipt(width);
  r.raw([ESC, 0x61, 0x01]);
  r.raw([ESC, 0x45, 1, GS, 0x21, 0x11]).line('RODEO TEST BED').raw([GS, 0x21, 0x00, ESC, 0x45, 0]);
  r.line(new Date().toLocaleString('en-CA'));
  r.line('Partial cut next');
  partialCut(r);
  r.line('Full cut next');
  fullCut(r);
  return r.toBytes();
}
