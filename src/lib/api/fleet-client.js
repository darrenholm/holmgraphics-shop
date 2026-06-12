// src/lib/api/fleet-client.js
//
// Fleet document portal API wrapper. Uses staff JWT (hg_token) — same
// realm as the rest of the admin/jobs surface. See $lib/api/client.js for
// the equivalent staff client used by jobs/projects.

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';

async function request(path, { method = 'GET', body, headers: extraHeaders } = {}) {
  const token = typeof localStorage !== 'undefined' ? localStorage.getItem('hg_token') : null;
  const headers = {
    ...(body !== undefined && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...extraHeaders
  };
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    ...(body !== undefined ? { body: body instanceof FormData ? body : JSON.stringify(body) } : {})
  });
  if (res.status === 401 && typeof window !== 'undefined') {
    localStorage.removeItem('hg_token');
    localStorage.removeItem('hg_user');
    window.location.href = '/login';
    return;
  }
  let data = null;
  try { data = await res.json(); } catch {}
  if (!res.ok) {
    const err = new Error(data?.message || data?.error || `API error ${res.status}`);
    err.status = res.status;
    err.body = data;
    throw err;
  }
  return data;
}

export const fleetApi = {
  listVehicles: ({ includeInactive = false } = {}) =>
    request(`/fleet/vehicles${includeInactive ? '?include_inactive=1' : ''}`),

  createVehicle: (payload) =>
    request('/fleet/vehicles', { method: 'POST', body: payload }),

  getVehicle: (id) =>
    request(`/fleet/vehicles/${encodeURIComponent(id)}`),

  getVehicleByUnit: (unitNumber) =>
    request(`/fleet/vehicles/by-unit/${encodeURIComponent(unitNumber)}`),

  updateVehicle: (id, patch) =>
    request(`/fleet/vehicles/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch }),

  // ── Finance / lease details (1:1 sidecar on the vehicle) ─────────
  getVehicleFinance: (id) =>
    request(`/fleet/vehicles/${encodeURIComponent(id)}/finance`),
  saveVehicleFinance: (id, payload) =>
    request(`/fleet/vehicles/${encodeURIComponent(id)}/finance`, { method: 'PUT', body: payload }),
  clearVehicleFinance: (id) =>
    request(`/fleet/vehicles/${encodeURIComponent(id)}/finance`, { method: 'DELETE' }),

  uploadDocument: (vehicleId, { file, doc_type, issued_date, expiry_date, notes }) => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('doc_type', doc_type);
    if (issued_date) fd.append('issued_date', issued_date);
    if (expiry_date) fd.append('expiry_date', expiry_date);
    if (notes)       fd.append('notes', notes);
    return request(`/fleet/vehicles/${encodeURIComponent(vehicleId)}/documents`, {
      method: 'POST',
      body:   fd
    });
  },

  getExpirySummary: () =>
    request('/fleet/expiry-summary'),

  // ── Operator-level documents (CVOR etc) ────────────────────────────────
  getOperatorDocuments: () =>
    request('/fleet/operator-documents'),

  uploadOperatorDocument: ({ file, doc_type, issued_date, expiry_date, notes }) => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('doc_type', doc_type);
    if (issued_date) fd.append('issued_date', issued_date);
    if (expiry_date) fd.append('expiry_date', expiry_date);
    if (notes)       fd.append('notes', notes);
    return request('/fleet/operator-documents', { method: 'POST', body: fd });
  },

  fetchOperatorFileBlob: async (documentId, { download = false } = {}) => {
    const token = localStorage.getItem('hg_token');
    const res = await fetch(
      `${API_BASE}/fleet/operator-documents/${encodeURIComponent(documentId)}/file${download ? '?download=1' : ''}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) throw new Error(`operator document fetch failed (${res.status})`);
    const blob = await res.blob();
    return { blob, url: URL.createObjectURL(blob), contentType: blob.type };
  },

  getAccessLog: (params = {}) => {
    const qs = new URLSearchParams(
      Object.entries(params).filter(([_, v]) => v != null && v !== '')
    ).toString();
    return request(`/fleet/access-log${qs ? '?' + qs : ''}`);
  },

  // ── Smartcar telematics (Phase 2) ──────────────────────────────────────
  smartcarStatus: () =>
    request('/fleet/smartcar/status'),

  smartcarConnectUrl: (vehicleId) =>
    request(`/fleet/smartcar/connect-url?vehicle_id=${encodeURIComponent(vehicleId)}`),

  getVehicleSmartcar: (vehicleId) =>
    request(`/fleet/vehicles/${encodeURIComponent(vehicleId)}/smartcar`),

  disconnectVehicleSmartcar: (vehicleId) =>
    request(`/fleet/vehicles/${encodeURIComponent(vehicleId)}/smartcar/disconnect`, { method: 'POST' }),

  getVehicleLocation: (vehicleId, { refresh = false } = {}) =>
    request(`/fleet/vehicles/${encodeURIComponent(vehicleId)}/location${refresh ? '?refresh=1' : ''}`),

  getVehicleLocations: (vehicleId, { limit = 50 } = {}) =>
    request(`/fleet/vehicles/${encodeURIComponent(vehicleId)}/locations?limit=${limit}`),

  // URL helpers — the streaming endpoint is fetched directly via <img> or
  // <iframe> src, so callers need the absolute URL (with token in query if
  // we ever add header-less variant; for now relies on cookies if behind
  // the same origin, OR fetch + blob URL on the client side).
  fileUrl: (documentId, { download = false } = {}) =>
    `${API_BASE}/fleet/documents/${encodeURIComponent(documentId)}/file${download ? '?download=1' : ''}`,

  // For <img>/<iframe> tags we can't add Authorization headers — fetch the
  // file as a blob and create an object URL the consumer can use.
  fetchFileBlob: async (documentId, { download = false } = {}) => {
    const token = localStorage.getItem('hg_token');
    const res = await fetch(`${API_BASE}/fleet/documents/${encodeURIComponent(documentId)}/file${download ? '?download=1' : ''}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) throw new Error(`document fetch failed (${res.status})`);
    const blob = await res.blob();
    return { blob, url: URL.createObjectURL(blob), contentType: blob.type };
  }
};
