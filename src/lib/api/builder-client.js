// src/lib/api/builder-client.js
//
// Thin wrapper for the decoration-builder API (routes/builder-orders.js in
// the API repo). Distinct from customer-client.js because the auth model is
// session-token, not JWT:
//
//   - POST /drafts                       — anonymous, returns id + session_token
//   - GET/PATCH /drafts/:id              — `X-Builder-Session` header
//   - POST /drafts/:id/submit-for-proof  — same header + contact fields
//
// The session token is stored in localStorage under `hg_builder_session` so
// a buyer can leave and resume the draft on the same browser. Multi-device
// resume is a JWT-tied future enhancement.

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';
const LS_KEY   = 'hg_builder_session';   // { draftId, sessionToken }

export function readSession() {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && parsed.draftId && parsed.sessionToken) return parsed;
  } catch {}
  return null;
}

export function writeSession(draftId, sessionToken) {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(LS_KEY, JSON.stringify({ draftId, sessionToken }));
}

export function clearSession() {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(LS_KEY);
}

async function request(path, { method = 'GET', body, sessionToken } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (sessionToken) headers['X-Builder-Session'] = sessionToken;
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {})
  });
  let data = null;
  try { data = await res.json(); } catch {}
  if (!res.ok) {
    const err = new Error(data?.error || data?.message || `HTTP ${res.status}`);
    err.status = res.status;
    err.body   = data;
    throw err;
  }
  return data;
}

// ─── Public surface ─────────────────────────────────────────────────────────

export async function createDraft(initialState = {}) {
  const data = await request('/builder/drafts', {
    method: 'POST',
    body:   { state: initialState }
  });
  writeSession(data.id, data.session_token);
  return data;
}

export async function loadDraft(draftId, sessionToken) {
  return request(`/builder/drafts/${encodeURIComponent(draftId)}`, { sessionToken });
}

export async function patchDraft(draftId, sessionToken, patch) {
  return request(`/builder/drafts/${encodeURIComponent(draftId)}`, {
    method: 'PATCH',
    sessionToken,
    body:   patch
  });
}

export async function submitDraft(draftId, sessionToken, contact) {
  return request(`/builder/drafts/${encodeURIComponent(draftId)}/submit-for-proof`, {
    method: 'POST',
    sessionToken,
    body:   contact
  });
}
