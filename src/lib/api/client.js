// src/lib/api/client.js
export const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';

async function request(path, options = {}) {
  const token = localStorage.getItem('hg_token');
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...options.headers
  };
  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  if (res.status === 401) {
    localStorage.removeItem('hg_token');
    localStorage.removeItem('hg_user');
    window.location.href = '/login';
    return;
  }
  const data = await res.json();
  // Different routes use different error-key conventions: `message` is
  // the older shape (auth/projects/clients), `error` is the newer one
  // (orders/uploads/upload-links). Honour both so callers don't have to
  // care which endpoint they hit.
  if (!res.ok) throw new Error(data.message || data.error || `API error ${res.status}`);
  return data;
}

export const api = {
  // Auth
  login: (email, password) =>
    request('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),

  // Projects (Jobs)
  getProjects: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/projects${qs ? '?' + qs : ''}`);
  },
  getProject: (id) => request(`/projects/${id}`),
  createProject: (data) =>
    request('/projects', { method: 'POST', body: JSON.stringify(data) }),
  updateProject: (id, data) =>
    request(`/projects/${id}`, { method: 'PUT', body: JSON.stringify(data) }),

  // Clients
  // Accepts either a plain search string (back-compat with existing call sites
  // that pass getClients('smith')) or an object { search, limit } for the
  // new clients list page that wants more than 50 rows.
  getClients: (opts = '') => {
    const params = {};
    if (typeof opts === 'string') {
      if (opts) params.search = opts;
    } else if (opts && typeof opts === 'object') {
      if (opts.search) params.search = opts.search;
      if (opts.limit)  params.limit  = opts.limit;
    }
    const qs = new URLSearchParams(params).toString();
    return request(`/clients${qs ? '?' + qs : ''}`);
  },
  getClient: (id) => request(`/clients/${id}`),
  createClient: (data) =>
    request('/clients', { method: 'POST', body: JSON.stringify(data) }),
  updateClient: (id, patch) =>
    request(`/clients/${id}`, { method: 'PUT', body: JSON.stringify(patch) }),

  // ─── Addresses ────────────────────────────────────────────────────
  createClientAddress: (clientId, addr) =>
    request(`/clients/${clientId}/addresses`, {
      method: 'POST',
      body: JSON.stringify(addr)
    }),
  updateClientAddress: (addressId, patch) =>
    request(`/clients/addresses/${addressId}`, {
      method: 'PUT',
      body: JSON.stringify(patch)
    }),
  deleteClientAddress: (addressId) =>
    request(`/clients/addresses/${addressId}`, { method: 'DELETE' }),

  // ─── Phones ───────────────────────────────────────────────────────
  createClientPhone: (clientId, phone) =>
    request(`/clients/${clientId}/phones`, {
      method: 'POST',
      body: JSON.stringify(phone)
    }),
  updateClientPhone: (phoneId, patch) =>
    request(`/clients/phones/${phoneId}`, {
      method: 'PUT',
      body: JSON.stringify(patch)
    }),
  deleteClientPhone: (phoneId) =>
    request(`/clients/phones/${phoneId}`, { method: 'DELETE' }),

  // Status
  getStatuses: () => request('/statuses'),
  updateStatus: (projectId, statusId, note) =>
    request(`/projects/${projectId}/status`, {
      method: 'POST',
      body: JSON.stringify({ statusId, note })
    }),

  // Notes
  getNotes: (projectId) => request(`/projects/${projectId}/notes`),
  addNote: (projectId, text) =>
    request(`/projects/${projectId}/notes`, {
      method: 'POST',
      body: JSON.stringify({ text })
    }),

  // Items
  getItems: (projectId) => request(`/projects/${projectId}/items`),
  addItem: (projectId, item) =>
  request(`/projects/${projectId}/items`, {
    method: 'POST',
    body: JSON.stringify({
      description:  item.description,
      qty:          item.qty,
      price:        item.price,
      total:        item.total,
      qb_item_name: item.qb_item_name || null
    })
  }),
  updateItem: (projectId, itemId, item) =>
  request(`/projects/${projectId}/items/${itemId}`, {
    method: 'PUT',
    body: JSON.stringify({
      description:  item.description,
      qty:          item.qty,
      price:        item.price,
      total:        item.total,
      qb_item_name: item.qb_item_name || null
    })
  }),

  deleteItem: (projectId, itemId) =>
    request(`/projects/${projectId}/items/${itemId}`, { method: 'DELETE' }),
  // Measurements
  addMeasurement: (projectId, m) =>
    request(`/projects/${projectId}/measurements`, {
      method: 'POST',
      body: JSON.stringify({
        item:   m.item,
        width:  m.width,
        height: m.height,
        notes:  m.notes
      })
    }),
  updateMeasurement: (projectId, mId, m) =>
    request(`/projects/${projectId}/measurements/${mId}`, {
      method: 'PUT',
      body: JSON.stringify({
        item:   m.item,
        width:  m.width,
        height: m.height,
        notes:  m.notes
      })
    }),
  deleteMeasurement: (projectId, mId) =>
    request(`/projects/${projectId}/measurements/${mId}`, { method: 'DELETE' }),

  // Photos
  //
  // Photo objects from the API look like:
  //   { id, filename, category, show_in_gallery, uploaded, uploaded_by, url }
  // where `category` is one of: signs_led | vehicle_wraps | apparel | printing | other
  //
  getPhotos: (projectId) => request(`/projects/${projectId}/photos`),
  uploadPhotos: async (projectId, files, category) => {
    const token = localStorage.getItem('hg_token');
    const formData = new FormData();
    for (const file of files) formData.append('photos', file);
    if (category) formData.append('category', category);
    const res = await fetch(`${API_BASE}/projects/${projectId}/photos`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: formData
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message);
    return data;
  },
  // Accepts either a numeric photo id (preferred) or a legacy filename.
  deletePhoto: (projectId, idOrFilename) =>
    request(`/projects/${projectId}/photos/${encodeURIComponent(idOrFilename)}`, {
      method: 'DELETE'
    }),
  // Admin-only curation. Pass whichever fields you want to change.
  //   updatePhoto(42, 1234, { show_in_gallery: true, category: 'signs_led' })
  updatePhoto: (projectId, photoId, patch) =>
    request(`/projects/${projectId}/photos/${photoId}`, {
      method: 'PATCH',
      body: JSON.stringify(patch)
    }),
  // Public — no auth required.
  getGallery: (category) => {
    const qs = category ? `?category=${encodeURIComponent(category)}` : '';
    return request(`/projects/gallery${qs}`);
  },

  // Admin-only. Every photo in the system, with project description + client
  // name, for the bulk curation page. Pass { unpublished: true } to narrow to
  // photos not yet flagged show_in_gallery.
  getAllPhotos: ({ unpublished = false } = {}) => {
    const qs = unpublished ? '?unpublished=1' : '';
    return request(`/projects/photos/all${qs}`);
  },

  // Folder path
  updateFolderPath: (projectId, folder_path) =>
    request(`/projects/${projectId}/folder`, {
      method: 'PUT',
      body: JSON.stringify({ folder_path })
    }),

  // Client folder-override (files-bridge manual match).
  //   getFolderMappings() → [{ id, client_name, files_folder, effective_folder }...]
  //   setClientFolder(id, 'Huron Bay Coop') → save override
  //   setClientFolder(id, null)             → clear override (revert to auto)
  getFolderMappings: () => request('/clients/folder-mappings'),
  setClientFolder: (clientId, folder) =>
    request(`/clients/${clientId}/folder`, {
      method: 'PATCH',
      body: JSON.stringify({ folder })
    }),

  // LED signs for a client, each with its service_history[] array nested.
  // Used by the "LED Signs" tab on the job detail screen.
  getClientLedSigns: (clientId) => request(`/clients/${clientId}/led-signs`),

  // WiFi credentials for a client's site(s). Used by the "WiFi" tab.
  getClientWifi: (clientId) => request(`/clients/${clientId}/wifi`),

  // Modules inventory rows linked to this client's LED signs, each with
  // a `signs` array listing which of the client's signs share the module.
  // Used by the "Modules" tab on the job detail screen.
  getClientModules: (clientId) => request(`/clients/${clientId}/modules`),

  // ─── LED Signs — writes ──────────────────────────────────────────
  // All mounted under /api/clients/… because that's where the read
  // endpoint lives too. A bit of a grab-bag namespace but it keeps
  // client-scoped data in one router.
  createLedSign: (clientId, sign) =>
    request(`/clients/${clientId}/led-signs`, {
      method: 'POST',
      body: JSON.stringify(sign)
    }),
  updateLedSign: (signId, patch) =>
    request(`/clients/led-signs/${signId}`, {
      method: 'PUT',
      body: JSON.stringify(patch)
    }),
  deleteLedSign: (signId) =>
    request(`/clients/led-signs/${signId}`, { method: 'DELETE' }),

  // Log a service call against a sign. Body: { issue, solution, serviced_by, service_date }
  logLedService: (signId, entry) =>
    request(`/clients/led-signs/${signId}/service`, {
      method: 'POST',
      body: JSON.stringify(entry)
    }),
  updateLedService: (serviceId, entry) =>
    request(`/clients/led-service/${serviceId}`, {
      method: 'PUT',
      body: JSON.stringify(entry)
    }),
  deleteLedService: (serviceId) =>
    request(`/clients/led-service/${serviceId}`, { method: 'DELETE' }),

  // Link (or unlink) a sign to a module inventory row.
  //   setSignModule(12, 3)    → link sign 12 to module 3
  //   setSignModule(12, null) → clear the link
  setSignModule: (signId, moduleId) =>
    request(`/clients/led-signs/${signId}/module`, {
      method: 'PATCH',
      body: JSON.stringify({ module_id: moduleId })
    }),

  // ─── WiFi — writes ───────────────────────────────────────────────
  createWifi: (clientId, entry) =>
    request(`/clients/${clientId}/wifi`, {
      method: 'POST',
      body: JSON.stringify(entry)
    }),
  updateWifi: (wifiId, entry) =>
    request(`/clients/wifi/${wifiId}`, {
      method: 'PUT',
      body: JSON.stringify(entry)
    }),
  deleteWifi: (wifiId) =>
    request(`/clients/wifi/${wifiId}`, { method: 'DELETE' }),

  // ─── Modules — writes + full list ────────────────────────────────
  // Full inventory — used by the sign→module picker. Returns every row
  // in modules, not just ones linked to a specific client.
  getAllModules: () => request('/clients/modules/all'),
  createModule: (mod) =>
    request('/clients/modules', {
      method: 'POST',
      body: JSON.stringify(mod)
    }),
  updateModule: (moduleId, patch) =>
    request(`/clients/modules/${moduleId}`, {
      method: 'PUT',
      body: JSON.stringify(patch)
    }),
  deleteModule: (moduleId) =>
    request(`/clients/modules/${moduleId}`, { method: 'DELETE' }),
  // Auth — change password
changePassword: (current_password, new_password) =>
  request('/auth/change-password', {
    method: 'POST',
    body: JSON.stringify({ current_password, new_password })
  }),
  // Employees
  getEmployees: () => request('/employees'),

  // Project Types
  getProjectTypes: () => request('/project-types'),

  // ─── Catalog (public — no auth) ──────────────────────────────
  // Uses the same request() helper; token header will be ignored
  // server-side on these routes.
  getCatalogSearch: (params = {}) => {
    const clean = Object.fromEntries(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')
    );
    const qs = new URLSearchParams(clean).toString();
    return request(`/catalog/search${qs ? '?' + qs : ''}`);
  },
  getCatalogBrands: () => request('/catalog/brands'),
  getCatalogCategories: () => request('/catalog/categories'),
  getCatalogProduct: (supplier, style) =>
    request(`/catalog/${encodeURIComponent(supplier)}/${encodeURIComponent(style)}`),

  // Public client-upload portal: staff-side mint endpoint. The matching
  // public endpoints (GET /upload-links/:token, POST /:token/upload) are
  // hit directly from the public /upload/[token] page without auth, so
  // they don't have api-client wrappers.
  createUploadLink: (jobId, data) =>
    request(`/jobs/${jobId}/upload-links`, {
      method: 'POST',
      body:   JSON.stringify(data),
    }),

  // Office order entry (Phase O1+O2). Staff-side counterpart to the
  // public /shop/checkout flow. Body shape documented at the route
  // handler in routes/orders.js POST /office.
  createOfficeOrder: (data) =>
    request('/orders/office', {
      method: 'POST',
      body:   JSON.stringify(data),
    }),

  // Staff-side card tokenisation for office orders (mirrors the
  // customer-side /payment/tokenize). Body: { number, exp, cvc, zip, name }
  tokenizeCardStaff: (card) =>
    request('/payment/staff-tokenize', {
      method: 'POST',
      body:   JSON.stringify(card),
    }),

  // ─── Time tracking ─────────────────────────────────────────────────
  // Phase 1: clock in/out, list my entries, admin review/approve/export.
  // Schema in db/migrations/016_time_tracking.sql; routes in routes/time.js.
  // The DB enforces "one open entry per employee" so /clock-in returns 409
  // if you try to start a second one without closing the first.
  timeClockIn: (body = {}) =>
    request('/time/clock-in', { method: 'POST', body: JSON.stringify(body) }),
  timeClockOut: (body = {}) =>
    request('/time/clock-out', { method: 'POST', body: JSON.stringify(body) }),
  timeSwitchJob: (body) =>
    request('/time/switch-job', { method: 'POST', body: JSON.stringify(body) }),
  // Lightweight "am I clocked in right now?" — drives the UI button state.
  timeGetCurrent: () => request('/time/me/current'),
  // My entries in a date range. Both ?from and ?to are ISO timestamps.
  timeGetMine: (from, to) => {
    const qs = new URLSearchParams();
    if (from) qs.set('from', from);
    if (to)   qs.set('to', to);
    return request(`/time/me${qs.toString() ? '?' + qs.toString() : ''}`);
  },
  // Admin: list all employees' entries.
  timeAdminList: ({ from, to, employee_id, status } = {}) => {
    const qs = new URLSearchParams();
    if (from)        qs.set('from', from);
    if (to)          qs.set('to', to);
    if (employee_id) qs.set('employee_id', employee_id);
    if (status)      qs.set('status', status);
    return request(`/time/admin${qs.toString() ? '?' + qs.toString() : ''}`);
  },
  timeAdminEdit: (id, patch) =>
    request(`/time/admin/${id}`, { method: 'PUT', body: JSON.stringify(patch) }),
  timeAdminApprove: (id) =>
    request(`/time/admin/${id}/approve`, { method: 'POST' }),
  timeAdminBulkApprove: (ids) =>
    request('/time/admin/bulk-approve', {
      method: 'POST',
      body:   JSON.stringify({ ids }),
    }),
  // CSV export. The endpoint requires Bearer auth, so we can't put the URL
  // in a plain <a href> — fetch the blob with the auth header and trigger
  // a download from a blob URL. Returns { filename, count } once the
  // browser's been handed the file.
  //
  // Two modes (mutually exclusive):
  //   { payPeriodId } — Phase 1.6 preferred path. Marks the pay_periods row
  //                     as exported on success.
  //   { from, to }    — Date-range fallback for ad-hoc exports.
  timeDownloadExport: async ({ payPeriodId, from, to, includeOpen = false, markExported = true } = {}) => {
    const token = localStorage.getItem('hg_token');
    const qs = new URLSearchParams();
    if (payPeriodId) qs.set('pay_period_id', payPeriodId);
    if (from)        qs.set('from', from);
    if (to)          qs.set('to', to);
    qs.set('include_open',  String(includeOpen));
    qs.set('mark_exported', String(markExported));
    const res = await fetch(`${API_BASE}/time/admin/export?${qs.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      let msg = `Export failed (${res.status})`;
      try { const j = await res.json(); if (j.message) msg = j.message; } catch {}
      throw new Error(msg);
    }
    const blob = await res.blob();
    const cd = res.headers.get('Content-Disposition') || '';
    const m  = cd.match(/filename="([^"]+)"/);
    const filename = m ? m[1] : 'timesheet.csv';
    const count = parseInt(res.headers.get('X-Exported-Count') || '0', 10);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return { filename, count };
  },

  // ─── Pay periods (Phase 1.6) ───────────────────────────────────────
  // Backend in routes/pay-periods.js, mounted at /api/pay-periods.
  // Schema in db/migrations/017_pay_periods.sql.
  payPeriodsList: ({ status, from, to } = {}) => {
    const qs = new URLSearchParams();
    if (status) qs.set('status', status);
    if (from)   qs.set('from', from);
    if (to)     qs.set('to', to);
    return request(`/pay-periods${qs.toString() ? '?' + qs.toString() : ''}`);
  },
  // Lightweight "what period is today in?" — drives the export page's default.
  payPeriodCurrent: () => request('/pay-periods/current'),
  payPeriodGet: (id) => request(`/pay-periods/${id}`),
  // Generate the next N pay periods (default 2). Idempotent.
  payPeriodExtend: (n = 2) =>
    request('/pay-periods/admin/extend', {
      method: 'POST',
      body: JSON.stringify({ n }),
    }),
  payPeriodClose: (id) =>
    request(`/pay-periods/admin/${id}/close`, { method: 'POST' }),
  payPeriodReopen: (id) =>
    request(`/pay-periods/admin/${id}/reopen`, { method: 'POST' }),
};
