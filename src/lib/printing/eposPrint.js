// src/lib/printing/eposPrint.js
//
// Prints raw ESC/POS bytes to an Epson network receipt printer (TM-m30III,
// "BarTix1" at 10.10.1.19) through the printer's own ePOS-Print service.
// No bridge PC, no driver: the page talks to the printer directly.
//
// Browser: HTTPS, because the page is HTTPS. The printer's certificate is
//   self-signed, so each browser must open https://<printer> once and click
//   Advanced > Proceed before printing works there.
// Tablet app: plain HTTP. CapacitorHttp sends it natively, which skips the
//   certificate problem; the printer's address must be in
//   android/app/src/main/res/xml/network_security_config.xml.

import { Capacitor } from '@capacitor/core';

export const DEFAULT_NETWORK_PRINTER = '10.10.1.19';

const NS = 'http://www.epson-pos.com/schemas/2011/03/epos-print';

function serviceUrl(host, timeoutMs) {
  const scheme = Capacitor.isNativePlatform() ? 'http' : 'https';
  return `${scheme}://${host}/cgi-bin/epos/service.cgi?devid=local_printer&timeout=${timeoutMs}`;
}

function envelope(inner) {
  return '<?xml version="1.0" encoding="utf-8"?>' +
    '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body>' +
    `<epos-print xmlns="${NS}">${inner}</epos-print></s:Body></s:Envelope>`;
}

function toHex(bytes) {
  let hex = '';
  for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, '0');
  return hex;
}

// ePOS-Print status bits worth telling staff about.
function statusProblem(status) {
  const s = Number(status) || 0;
  if (s & 0x00000020) return 'cover is open';
  if (s & 0x00080000) return 'out of paper';
  if (s & 0x00000008) return 'printer is offline';
  if (s & 0x00020000) return 'paper is running low';
  return '';
}

async function post(host, inner, timeoutMs) {
  if (!host) throw new Error('No network printer address set.');
  let res;
  try {
    res = await fetch(serviceUrl(host, timeoutMs), {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml; charset=utf-8' },
      body: envelope(inner),
    });
  } catch {
    throw new Error(Capacitor.isNativePlatform()
      ? `Can't reach the printer at ${host}. Is it on and on the shop network?`
      : `Can't reach the printer at ${host}. Open https://${host} in this browser once and click Advanced > Proceed, then try again.`);
  }
  const text = await res.text();
  const ok = /success="true"/.test(text);
  const code = (text.match(/code="([^"]*)"/) || [])[1] || '';
  const status = (text.match(/status="([^"]*)"/) || [])[1] || '';
  if (!res.ok || !ok) {
    const why = statusProblem(status) || code || `HTTP ${res.status}`;
    throw new Error(`Printer problem: ${why}.`);
  }
  return { ok: true, status: Number(status) || 0 };
}

/** Sends a finished ESC/POS byte stream (cuts and drawer pulse included). */
export function eposPrint(host, bytes, { timeoutMs = 20000 } = {}) {
  return post(host, `<command>${toHex(bytes)}</command>`, timeoutMs);
}

/** Asks the printer for its status without printing anything. */
export async function eposStatus(host) {
  const r = await post(host, '', 5000);
  return { ...r, problem: statusProblem(r.status) };
}
