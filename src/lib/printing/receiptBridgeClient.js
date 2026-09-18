// src/lib/printing/receiptBridgeClient.js
//
// Thin client for the Holm Graphics RECEIPT bridge — the small service on
// Design Centre 1 that prints to the USB receipt printer. Mirrors
// src/lib/printing/bridgeClient.js (the DYMO label bridge) on purpose: same
// shape of config, same auth, so there is one thing to learn rather than two.
//
// Resolves base URL + API key from (in order):
//   1. localStorage overrides ('hg_receipt_bridge_url', 'hg_receipt_bridge_key')
//   2. Vite build env (VITE_RECEIPT_BRIDGE_URL / VITE_RECEIPT_BRIDGE_KEY)
//
// The bridge itself is documented in /receipt-bridge/README.md.

const LS_URL     = 'hg_receipt_bridge_url';
const LS_KEY     = 'hg_receipt_bridge_key';
const LS_PRINTER = 'hg_receipt_bridge_printer';

function env(name) {
  try { return import.meta.env?.[name] || ''; } catch { return ''; }
}
function ls(k) {
  try { return (typeof window !== 'undefined' && window.localStorage?.getItem(k)) || ''; }
  catch { return ''; }
}

export function getReceiptBridgeConfig() {
  return {
    url:     (ls(LS_URL) || env('VITE_RECEIPT_BRIDGE_URL') || '').replace(/\/$/, ''),
    key:     ls(LS_KEY) || env('VITE_RECEIPT_BRIDGE_KEY') || '',
    // Blank is fine: the bridge falls back to PRINTER_NAME in its own .env,
    // which is the sane default when there is one receipt printer in the shop.
    printer: ls(LS_PRINTER) || '',
  };
}

export function setReceiptBridgeConfig({ url, key, printer }) {
  if (typeof window === 'undefined') return;
  const put = (k, v) => {
    if (v === undefined) return;
    if (v) localStorage.setItem(k, k === LS_URL ? v.replace(/\/$/, '') : v);
    else   localStorage.removeItem(k);
  };
  put(LS_URL, url);
  put(LS_KEY, key);
  put(LS_PRINTER, printer);
}

export function receiptBridgeConfigured() {
  const { url, key } = getReceiptBridgeConfig();
  return !!(url && key);
}

async function call(path, options = {}) {
  const { url, key } = getReceiptBridgeConfig();
  if (!url) throw new Error('Receipt bridge URL is not configured.');
  if (!key) throw new Error('Receipt bridge API key is not configured.');
  const res = await fetch(`${url}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
      ...(options.headers || {}),
    },
  });
  let data = null;
  try { data = await res.json(); } catch { /* non-JSON body */ }
  if (!res.ok) throw new Error((data && data.error) || `Receipt bridge error ${res.status}`);
  return data;
}

export async function receiptBridgeHealth() {
  const { url } = getReceiptBridgeConfig();
  if (!url) throw new Error('Receipt bridge URL is not configured.');
  const res = await fetch(`${url}/health`);
  if (!res.ok) throw new Error(`Receipt bridge not reachable (HTTP ${res.status})`);
  return res.json();
}

export async function receiptBridgePrinters() {
  return call('/printers');
}

/**
 * Sends a finished ESC/POS byte stream to the USB printer.
 *
 * The bytes are exactly what the tablet sends over Bluetooth — including the
 * cut and, on a cash sale, the drawer pulse — so a receipt printed from a desk
 * is the same receipt, drawer behaviour and all.
 */
export async function receiptBridgePrint(bytes, { copies = 1 } = {}) {
  const { printer } = getReceiptBridgeConfig();
  return call('/print-raw', {
    method: 'POST',
    body: JSON.stringify({
      dataBase64: base64FromBytes(bytes),
      ...(printer ? { printerName: printer } : {}),
      copies,
    }),
  });
}

function base64FromBytes(bytes) {
  let binary = '';
  const chunk = 0x8000;          // keep the argument list within limits
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
