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

  // ── Ford Pro Telematics (fleet-grade M2M; refreshed by a server-side
  //    poller, so there's no connect/unlink — just status, manual sync,
  //    and the cached snapshot) ──
  fordproStatus: () =>
    request('/fleet/fordpro/status'),
  fordproVehicles: () =>
    request('/fleet/fordpro/vehicles'),
  fordproSync: () =>
    request('/fleet/fordpro/sync', { method: 'POST' }),

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

  // ── Telematics (provider-agnostic read layer; Ford Pro today) ──────────
  // The map + per-vehicle UI read these and don't care which provider supplied
  // the data. Smartcar's backend stays in place (dormant) for a future
  // non-Ford vehicle — it's just no longer wired into the UI.
  telematicsLocations: () =>
    request('/fleet/telematics/locations'),

  vehicleTelematics: (vehicleId) =>
    request(`/fleet/telematics/vehicle/${encodeURIComponent(vehicleId)}`),

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
  },

  // ── Daily inspections / circle checks (O. Reg. 199/07) ─────────────────
  // The API refuses anything that would weaken the legal record, so several
  // of these throw with a `code` the UI is expected to handle rather than
  // just surface: 'odometer_regression' needs an explicit acknowledgement,
  // 'declaration_required' means the driver hasn't signed yet.
  inspectionScope: () =>
    request('/fleet/inspections/scope'),

  inspectionPrefill: (vehicleId) =>
    request(`/fleet/inspections/prefill${vehicleId ? `?vehicle_id=${encodeURIComponent(vehicleId)}` : ''}`),

  startInspection: (vehicleId) =>
    request('/fleet/inspections', { method: 'POST', body: { vehicle_id: vehicleId } }),

  getInspection: (id) =>
    request(`/fleet/inspections/${encodeURIComponent(id)}`),

  listInspections: ({ vehicleId, status, mine, limit } = {}) => {
    const p = new URLSearchParams();
    if (vehicleId) p.set('vehicle_id', vehicleId);
    if (status)    p.set('status', status);
    if (mine)      p.set('mine', '1');
    if (limit)     p.set('limit', String(limit));
    const qs = p.toString();
    return request(`/fleet/inspections${qs ? `?${qs}` : ''}`);
  },

  saveInspection: (id, patch) =>
    request(`/fleet/inspections/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch }),

  flagDefect: (id, { schedule_item_id, severity, note }) =>
    request(`/fleet/inspections/${encodeURIComponent(id)}/defects`, {
      method: 'POST', body: { schedule_item_id, severity, note }
    }),

  updateDefect: (id, defectId, patch) =>
    request(`/fleet/inspections/${encodeURIComponent(id)}/defects/${encodeURIComponent(defectId)}`, {
      method: 'PATCH', body: patch
    }),

  clearDefect: (id, defectId) =>
    request(`/fleet/inspections/${encodeURIComponent(id)}/defects/${encodeURIComponent(defectId)}`, {
      method: 'DELETE'
    }),

  uploadDefectPhoto: (id, defectId, file) => {
    const fd = new FormData();
    fd.append('photo', file);
    return request(`/fleet/inspections/${encodeURIComponent(id)}/defects/${encodeURIComponent(defectId)}/photo`, {
      method: 'POST', body: fd
    });
  },

  // payload: { declaration_accepted, no_defects, odometer_km, odometer_source,
  //            location_text, location_source, odometer_regression_ack?, … }
  completeInspection: (id, payload) =>
    request(`/fleet/inspections/${encodeURIComponent(id)}/complete`, { method: 'POST', body: payload }),

  // ── Offline (see $lib/fleet/offline-store.js) ──
  // One call that pulls everything a phone needs to run a check with no
  // signal: schedules + items, the units, and the last signed report per
  // unit (the document the driver is legally carrying).
  inspectionOfflineBundle: () =>
    request('/fleet/inspections/offline-bundle'),

  // Replays a check captured offline. Idempotent on payload.client_uuid, so
  // a retry after a dropped response returns the existing report rather than
  // writing a second one.
  syncInspection: (payload) =>
    request('/fleet/inspections/sync', { method: 'POST', body: payload }),

  inspectionPrompt: () =>
    request('/fleet/inspections/prompt'),

  // 'daily' | 'on_demand'. Changes only what the system asks for — never
  // inspection_required, which is derived from the unit's registered gross
  // weight and records whether O. Reg. 199/07 applies at all.
  setInspectionPolicy: (vehicleId, policy) =>
    request(`/fleet/vehicles/${encodeURIComponent(vehicleId)}/inspection-policy`, {
      method: 'PATCH', body: { inspection_policy: policy }
    }),

  inspectionJobs: () =>
    request('/fleet/inspection-jobs'),

  runInspectionJob: (name) =>
    request(`/fleet/inspection-jobs/${encodeURIComponent(name)}/run`, { method: 'POST' }),

  inspectionSchedules: () =>
    request('/fleet/inspection-schedules'),

  verifySchedule: (id) =>
    request(`/fleet/inspection-schedules/${encodeURIComponent(id)}/verify`, { method: 'POST' }),

  openDefects: () =>
    request('/fleet/inspection-defects/open'),

  resolveDefect: (defectId, repairNote) =>
    request(`/fleet/inspection-defects/${encodeURIComponent(defectId)}/resolve`, {
      method: 'POST', body: { repair_note: repairNote }
    }),

  // Same blob dance as fleet documents — <img> can't carry an auth header.
  fetchDefectPhotoBlob: async (defectId) => {
    const token = localStorage.getItem('hg_token');
    const res = await fetch(`${API_BASE}/fleet/inspection-defects/${encodeURIComponent(defectId)}/photo`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) throw new Error(`photo fetch failed (${res.status})`);
    const blob = await res.blob();
    return { blob, url: URL.createObjectURL(blob), contentType: blob.type };
  }
};
