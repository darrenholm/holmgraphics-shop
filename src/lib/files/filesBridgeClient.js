// src/lib/files/filesBridgeClient.js
//
// Thin client for the Holm Graphics FILES bridge running on the RIP
// computer. Exposes the L: drive (client artwork storage) to the web app
// over HTTP. Mirrors src/lib/printing/bridgeClient.js.
//
// Resolution order for URL + key:
//   1. localStorage overrides ('hg_files_url', 'hg_files_key') — per-browser
//   2. Vite build env (VITE_FILES_BRIDGE_URL / VITE_FILES_BRIDGE_KEY)
//
// The bridge itself lives in /files-bridge/ and documents its endpoints
// in /files-bridge/README.md.

const LS_URL = 'hg_files_url';
const LS_KEY = 'hg_files_key';

function env(name) {
  try { return import.meta.env?.[name] || ''; } catch { return ''; }
}

function ls(k) {
  try { return (typeof window !== 'undefined' && window.localStorage?.getItem(k)) || ''; }
  catch { return ''; }
}

export function getFilesBridgeConfig() {
  const url = ls(LS_URL) || env('VITE_FILES_BRIDGE_URL') || '';
  const key = ls(LS_KEY) || env('VITE_FILES_BRIDGE_KEY') || '';
  return {
    url: (url || '').replace(/\/$/, ''),
    key,
    hasOverride: !!(ls(LS_URL) || ls(LS_KEY))
  };
}

export function setFilesBridgeConfig({ url, key }) {
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
  const { url, key } = getFilesBridgeConfig();
  if (!url) throw new Error('Files bridge URL is not configured.');
  if (!key) throw new Error('Files bridge API key is not configured.');
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
    throw new Error((data && data.error) || `Files bridge error ${res.status}`);
  }
  return data;
}

export async function filesBridgeHealth() {
  const { url } = getFilesBridgeConfig();
  if (!url) throw new Error('Files bridge URL is not configured.');
  const res = await fetch(`${url}/health`);
  if (!res.ok) throw new Error(`Files bridge unreachable (HTTP ${res.status})`);
  return await res.json();
}

export async function listClientFiles(clientName) {
  const n = encodeURIComponent(clientName);
  return await call(`/clients/${n}/tree`);
}

export async function listJobFiles(clientName, jobNumber) {
  const n = encodeURIComponent(clientName);
  const j = encodeURIComponent(jobNumber);
  return await call(`/clients/${n}/jobs/${j}/tree`);
}

export async function ensureJobFolder(clientName, jobNumber) {
  const n = encodeURIComponent(clientName);
  const j = encodeURIComponent(jobNumber);
  return await call(`/clients/${n}/jobs/${j}/ensure`, { method: 'POST' });
}

// List every top-level folder under both buckets — for the manual folder
// picker. Response shape: { folders: [{ bucket, name, mtime }...], count }.
export async function listAllFolders() {
  return await call('/folders');
}

// Create a brand-new top-level client folder. Bucket (A-K vs L-Z) is
// picked server-side from the first letter. Response:
//   { ok, bucket, folder, path, created }
// `created: false` means a folder with that name already existed.
export async function createFolder(name) {
  return await call('/folders', {
    method: 'POST',
    body: JSON.stringify({ name })
  });
}

// Builds an authenticated URL for opening a file in a new tab. Because the
// API key needs to be in the Authorization header, we have to fetch the
// file ourselves and create an object URL — <a href="..."> can't carry
// custom headers. Returns a short-lived blob URL; caller is responsible
// for URL.revokeObjectURL when they're done.
export async function fetchFileBlob(serverPath) {
  const { url, key } = getFilesBridgeConfig();
  if (!url) throw new Error('Files bridge URL is not configured.');
  if (!key) throw new Error('Files bridge API key is not configured.');
  const res = await fetch(`${url}/file?path=${encodeURIComponent(serverPath)}`, {
    headers: { Authorization: `Bearer ${key}` }
  });
  if (!res.ok) {
    let msg = `Files bridge error ${res.status}`;
    try { const j = await res.json(); if (j.error) msg = j.error; } catch { /* */ }
    throw new Error(msg);
  }
  const contentType = res.headers.get('Content-Type') || 'application/octet-stream';
  const blob = await res.blob();
  return { blob, contentType, url: URL.createObjectURL(blob) };
}

// Convenience: open a file in a new browser tab. Revokes the object URL
// after a safe delay so the browser has time to load it.
export async function openFile(serverPath) {
  const { url } = await fetchFileBlob(serverPath);
  const win = window.open(url, '_blank', 'noopener');
  // If the popup was blocked, fall back to same-window navigation.
  if (!win) window.location.href = url;
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

// Convenience: trigger a browser download with the correct filename.
export async function downloadFile(serverPath, filename) {
  const { url } = await fetchFileBlob(serverPath);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || 'download';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
