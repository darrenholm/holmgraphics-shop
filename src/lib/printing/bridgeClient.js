// src/lib/printing/bridgeClient.js
//
// Thin client for the Holm Graphics print bridge running on the RIP computer.
// Resolves base URL + API key from (in order):
//   1. localStorage overrides ('hg_bridge_url', 'hg_bridge_key') — per-browser
//   2. Vite build env (VITE_PRINT_BRIDGE_URL / VITE_PRINT_BRIDGE_KEY)
//
// The bridge itself is documented in /print-bridge/README.md.

const LS_URL = 'hg_bridge_url';
const LS_KEY = 'hg_bridge_key';

function env(name) {
  try { return import.meta.env?.[name] || ''; } catch { return ''; }
}

export function getBridgeConfig() {
  const ls = (k) => {
    try { return (typeof window !== 'undefined' && window.localStorage?.getItem(k)) || ''; }
    catch { return ''; }
  };
  const url = ls(LS_URL) || env('VITE_PRINT_BRIDGE_URL') || '';
  const key = ls(LS_KEY) || env('VITE_PRINT_BRIDGE_KEY') || '';
  return {
    url: (url || '').replace(/\/$/, ''),
    key,
    hasOverride: !!(ls(LS_URL) || ls(LS_KEY))
  };
}

export function setBridgeConfig({ url, key }) {
  if (typeof window === 'undefined') return;
  if (url !== undefined) {
    if (url) localStorage.setItem(LS_URL, url.replace(/\/$/, ''));
    else     localStorage.removeItem(LS_URL);
  }
  if (key !== undefined) {
    if (key) localStorage.setItem(LS_KEY, key);
    else     localStorage.removeItem(LS_KEY);
  }
}

async function call(path, options = {}) {
  const { url, key } = getBridgeConfig();
  if (!url) throw new Error('Print bridge URL is not configured.');
  if (!key) throw new Error('Print bridge API key is not configured.');
  const res = await fetch(`${url}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
      ...(options.headers || {})
    }
  });
  let data = null;
  try { data = await res.json(); } catch { /* non-JSON body */ }
  if (!res.ok) {
    throw new Error((data && data.error) || `Bridge error ${res.status}`);
  }
  return data;
}

export async function bridgeHealth() {
  const { url } = getBridgeConfig();
  if (!url) throw new Error('Print bridge URL is not configured.');
  const res = await fetch(`${url}/health`);
  if (!res.ok) throw new Error(`Bridge unreachable (HTTP ${res.status})`);
  return await res.json();
}

export async function bridgeGetPrinters() {
  const data = await call('/printers');
  return (data && data.printers) || [];
}

export async function bridgePrint({ printerName, labelXml, copies = 1 }) {
  return await call('/print', {
    method: 'POST',
    body: JSON.stringify({ printerName, labelXml, copies })
  });
}
