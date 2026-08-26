// src/lib/api/client.js
export const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';

async function request(path, options = {}) {
  const token = localStorage.getItem('hg_token');
  // Don't force Content-Type when the body is FormData — the browser must
  // be free to set `multipart/form-data; boundary=…` itself. Setting it
  // to application/json here breaks the server's body parser AND the
  // express.json() global middleware then tries to parse the multipart
  // body (which is why proof uploads were 500'ing with parse errors).
  const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
  const headers = {
    ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
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
  // 204 No Content has no body — short-circuit so JSON.parse('') doesn't throw.
  if (res.status === 204) return null;
  const data = await res.json();
  // Different routes use different error-key conventions: `message` is
  // the older shape (auth/projects/clients), `error` is the newer one
  // (orders/uploads/upload-links). Honour both so callers don't have to
  // care which endpoint they hit.
  if (!res.ok) throw new Error(data.message || data.error || data.detail || `API error ${res.status}`);
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
  // Staff job-board stat strip: active pipeline count, quoted value, unpriced count.
  getProjectsSummary: () => request('/projects/summary'),
  getProject: (id) => request(`/projects/${id}`),
  createProject: (data) =>
    request('/projects', { method: 'POST', body: JSON.stringify(data) }),
  updateProject: (id, data) =>
    request(`/projects/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  // Email a generated quote PDF to the customer server-side (via Resend).
  emailQuote: (id, payload) =>
    request(`/projects/${id}/email-quote`, { method: 'POST', body: JSON.stringify(payload) }),

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

  // ─── Telephony (inbound call screen pop) ──────────────────────────
  // One client's pop card — jobs, recent quotes, unpaid total. Same shape
  // the SSE payload carries. Used when a staffer links a number to a
  // customer mid-call and the pop needs to become that customer's card.
  getTelephonyCard: (clientId) => request(`/telephony/card/${clientId}`),

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
  // Email/text the client that their job is ready for pickup. Both channels
  // default on; the backend sends over whichever the client has on file and
  // returns a per-channel result. Backend: routes/projects.js.
  notifyProjectReady: (projectId, { email = true, sms = true } = {}) =>
    request(`/projects/${projectId}/notify-ready`, {
      method: 'POST',
      body: JSON.stringify({ email, sms }),
    }),
  // Email the employee assigned to the job a staff-composed message (pass
  // channel:'sms' to text instead, once SkySwitch outbound works). Backend
  // adds job #/title context + the job link. Backend: routes/projects.js.
  messageAssignedEmployee: (projectId, message) =>
    request(`/projects/${projectId}/message-employee`, {
      method: 'POST',
      body: JSON.stringify({ message }),
    }),

  // Notes
  getNotes: (projectId) => request(`/projects/${projectId}/notes`),
  addNote: (projectId, text) =>
    request(`/projects/${projectId}/notes`, {
      method: 'POST',
      body: JSON.stringify({ text })
    }),

  // Customer ↔ staff chat (shared with the /portal/jobs/[id] page).
  getProjectMessages: (projectId) => request(`/projects/${projectId}/messages`),
  postProjectMessage: (projectId, body) =>
    request(`/projects/${projectId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ body })
    }),

  // Quote sheet — internal worksheet that builds rows at cost × markup,
  // optionally promoted into the customer-facing items table below.
  getQuoteSheet: (projectId) =>
    request(`/projects/${projectId}/quote-sheet`),
  addQuoteRow: (projectId, row) =>
    request(`/projects/${projectId}/quote-sheet`, {
      method: 'POST',
      body: JSON.stringify(row)
    }),
  updateQuoteRow: (projectId, rowId, patch) =>
    request(`/projects/${projectId}/quote-sheet/${rowId}`, {
      method: 'PATCH',
      body: JSON.stringify(patch)
    }),
  deleteQuoteRow: (projectId, rowId) =>
    request(`/projects/${projectId}/quote-sheet/${rowId}`, { method: 'DELETE' }),
  promoteQuoteSheet: (projectId) =>
    request(`/projects/${projectId}/quote-sheet/promote`, { method: 'POST' }),

  // Project proofs — staff side
  listProjectProofs: (projectId) =>
    request(`/projects/${projectId}/proofs`),
  uploadProjectProof: async (projectId, { file, recipientEmail, approveStatusId, note }) => {
    const fd = new FormData();
    fd.append('file', file);
    if (recipientEmail)  fd.append('recipient_email', recipientEmail);
    if (approveStatusId) fd.append('approve_status_id', String(approveStatusId));
    if (note)            fd.append('note', note);
    return request(`/projects/${projectId}/proofs`, { method: 'POST', body: fd });
  },
  saveProofAnnotations: (projectId, proofId, annotations) =>
    request(`/projects/${projectId}/proofs/${proofId}/annotations`, {
      method: 'PATCH',
      body: JSON.stringify({ annotations }),
    }),
  deleteProjectProof: (projectId, proofId) =>
    request(`/projects/${projectId}/proofs/${proofId}`, { method: 'DELETE' }),

  // ─── Scheduling system ─────────────────────────────────────────────
  // Resources (crews, machines, vehicles, facilities)
  listResources: (includeInactive = false) =>
    request(`/scheduling/resources${includeInactive ? '?include_inactive=true' : ''}`),
  createResource: (data) =>
    request(`/scheduling/resources`, { method: 'POST', body: JSON.stringify(data) }),
  updateResource: (id, patch) =>
    request(`/scheduling/resources/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),

  // Install calendar (Phase 1)
  listInstalls: ({ from, to } = {}) => {
    const qs = new URLSearchParams();
    if (from) qs.set('from', from);
    if (to)   qs.set('to', to);
    return request(`/scheduling/installs${qs.toString() ? '?' + qs : ''}`);
  },
  listCalendarTasks: ({ from, to } = {}) => {
    const qs = new URLSearchParams();
    if (from) qs.set('from', from);
    if (to)   qs.set('to', to);
    return request(`/scheduling/calendar-tasks${qs.toString() ? '?' + qs : ''}`);
  },
  listInstallsByProject: (projectId) =>
    request(`/scheduling/installs/by-project/${projectId}`),
  createInstall: (data) =>
    request(`/scheduling/installs`, { method: 'POST', body: JSON.stringify(data) }),
  updateInstall: (id, patch) =>
    request(`/scheduling/installs/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteInstall: (id) =>
    request(`/scheduling/installs/${id}`, { method: 'DELETE' }),

  // Job tasks (Phase 2)
  listJobTasks: (projectId) =>
    request(`/scheduling/job-tasks/${projectId}`),
  createJobTask: (data) =>
    request(`/scheduling/job-tasks`, { method: 'POST', body: JSON.stringify(data) }),
  updateJobTask: (id, patch) =>
    request(`/scheduling/job-tasks/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteJobTask: (id) =>
    request(`/scheduling/job-tasks/${id}`, { method: 'DELETE' }),
  addJobTaskAssignee: (taskId, employeeId, role = 'assist') =>
    request(`/scheduling/job-tasks/${taskId}/assignees`, {
      method: 'POST',
      body: JSON.stringify({ employee_id: employeeId, role }),
    }),
  removeJobTaskAssignee: (taskId, employeeId) =>
    request(`/scheduling/job-tasks/${taskId}/assignees/${employeeId}`, { method: 'DELETE' }),

  // Templates (Phase 3)
  listTemplates: (includeInactive = false) =>
    request(`/scheduling/templates${includeInactive ? '?include_inactive=true' : ''}`),
  getTemplate: (id) =>
    request(`/scheduling/templates/${id}`),
  createTemplate: (data) =>
    request(`/scheduling/templates`, { method: 'POST', body: JSON.stringify(data) }),
  updateTemplate: (id, patch) =>
    request(`/scheduling/templates/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  addTemplateStep: (templateId, step) =>
    request(`/scheduling/templates/${templateId}/steps`, { method: 'POST', body: JSON.stringify(step) }),
  updateTemplateStep: (stepId, patch) =>
    request(`/scheduling/template-steps/${stepId}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteTemplateStep: (stepId) =>
    request(`/scheduling/template-steps/${stepId}`, { method: 'DELETE' }),
  applyTemplate: ({ project_id, template_id, anchor, target_date }) =>
    request(`/scheduling/apply-template`, {
      method: 'POST',
      body: JSON.stringify({ project_id, template_id, anchor, target_date }),
    }),

  // Resource load (Phase 4)
  resourceLoad: ({ from, to } = {}) => {
    const qs = new URLSearchParams();
    if (from) qs.set('from', from);
    if (to)   qs.set('to', to);
    return request(`/scheduling/resource-load${qs.toString() ? '?' + qs : ''}`);
  },
  // Job phases (event-driven checklist)
  listPhaseTemplates: () =>
    request(`/scheduling/phase-templates`),
  listJobPhases: (projectId) =>
    request(`/scheduling/phases/${projectId}`),
  applyPhaseTemplate: ({ project_id, template_id, force, start_first }) =>
    request(`/scheduling/phases/apply-template`, {
      method: 'POST',
      body: JSON.stringify({ project_id, template_id, force, start_first }),
    }),
  completePhase: (phaseId, nextExpectedDays) =>
    request(`/scheduling/phases/${phaseId}/complete`, {
      method: 'POST',
      body: JSON.stringify({ next_expected_days: nextExpectedDays }),
    }),
  updatePhase: (id, patch) =>
    request(`/scheduling/phases/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  addPhase: (data) =>
    request(`/scheduling/phases`, { method: 'POST', body: JSON.stringify(data) }),
  deletePhase: (id) =>
    request(`/scheduling/phases/${id}`, { method: 'DELETE' }),
  listActivePhases: () =>
    request(`/scheduling/phases-active`),

  // Staff absences (days off, partial-day appointments)
  listAbsences: ({ from, to } = {}) => {
    const qs = new URLSearchParams();
    if (from) qs.set('from', from);
    if (to)   qs.set('to', to);
    return request(`/scheduling/absences${qs.toString() ? '?' + qs : ''}`);
  },
  createAbsence: (data) =>
    request(`/scheduling/absences`, { method: 'POST', body: JSON.stringify(data) }),
  updateAbsence: (id, patch) =>
    request(`/scheduling/absences/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteAbsence: (id) =>
    request(`/scheduling/absences/${id}`, { method: 'DELETE' }),
  // Holidays
  listHolidays: ({ from, to } = {}) => {
    const qs = new URLSearchParams();
    if (from) qs.set('from', from);
    if (to)   qs.set('to', to);
    return request(`/scheduling/holidays${qs.toString() ? '?' + qs : ''}`);
  },
  createHoliday: (data) =>
    request(`/scheduling/holidays`, { method: 'POST', body: JSON.stringify(data) }),
  deleteHoliday: (id) =>
    request(`/scheduling/holidays/${id}`, { method: 'DELETE' }),

  // ─── Inventory: media (Phase 1 — vinyl rolls) ─────────────────────
  listMediaProducts: (includeInactive = false) =>
    request(`/inventory/media/products${includeInactive ? '?include_inactive=true' : ''}`),
  getMediaProduct: (id) =>
    request(`/inventory/media/products/${id}`),
  createMediaProduct: (data) =>
    request(`/inventory/media/products`, { method: 'POST', body: JSON.stringify(data) }),
  updateMediaProduct: (id, patch) =>
    request(`/inventory/media/products/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  listMediaRolls: ({ product_id, include_retired } = {}) => {
    const qs = new URLSearchParams();
    if (product_id) qs.set('product_id', product_id);
    if (include_retired) qs.set('include_retired', 'true');
    return request(`/inventory/media/rolls${qs.toString() ? '?' + qs : ''}`);
  },
  createMediaRoll: (data) =>
    request(`/inventory/media/rolls`, { method: 'POST', body: JSON.stringify(data) }),
  updateMediaRoll: (id, patch) =>
    request(`/inventory/media/rolls/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  measureMediaRoll: (id, measured_dia_in, notes) =>
    request(`/inventory/media/rolls/${id}/measure`, {
      method: 'POST',
      body: JSON.stringify({ measured_dia_in, notes }),
    }),
  listMediaRollMeasurements: (id) =>
    request(`/inventory/media/rolls/${id}/measurements`),
  retireMediaRoll: (id) =>
    request(`/inventory/media/rolls/${id}`, { method: 'DELETE' }),

  listByResource: (resourceId, { from, to } = {}) => {
    const qs = new URLSearchParams();
    if (from) qs.set('from', from);
    if (to)   qs.set('to', to);
    return request(`/scheduling/by-resource/${resourceId}${qs.toString() ? '?' + qs : ''}`);
  },

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
  //   updatePhoto(42, 1234, { fb_post_enabled: true, fb_caption: '...' })
  updatePhoto: (projectId, photoId, patch) =>
    request(`/projects/${projectId}/photos/${photoId}`, {
      method: 'PATCH',
      body: JSON.stringify(patch)
    }),
  // Admin-only. Retry a Facebook post that previously failed for this photo.
  fbRetryPhoto: (projectId, photoId) =>
    request(`/projects/${projectId}/photos/${photoId}/fb-retry`, {
      method: 'POST'
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
  // Admin: create a manual time entry (for backfilling forgotten punches).
  // Body: { employee_id, clock_in (ISO), clock_out (ISO),
  //         project_id?, notes?, status? }  ('closed' | 'approved')
  timeAdminCreate: (body) =>
    request('/time/admin', { method: 'POST', body: JSON.stringify(body) }),
  timeAdminEdit: (id, patch) =>
    request(`/time/admin/${id}`, { method: 'PUT', body: JSON.stringify(patch) }),
  // Hard-delete an entry (blocked server-side if already synced to QBO).
  timeAdminDelete: (id) =>
    request(`/time/admin/${id}`, { method: 'DELETE' }),
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

  // ─── QBO integration ───────────────────────────────────────────────
  // Backend in routes/quickbooks.js (mounted at /api/quickbooks).
  // Used by /admin/qbo-employees for the mapping setup, and by the
  // (upcoming) Send-to-QuickBooks button on /admin/pay-periods.
  qboEmployeesList: () => request('/quickbooks/employees'),
  // Set or clear the QBO Employee link for one local employee.
  // Backend lives in routes/lookup.js (mounted at /api).
  employeeSetQboMapping: (id, qbo_employee_id) =>
    request(`/employees/${id}/qbo-mapping`, {
      method: 'PUT',
      body: JSON.stringify({ qbo_employee_id: qbo_employee_id || null }),
    }),
  // Full active-employee list (includes phone_number + phone_extension).
  // Backend in routes/lookup.js (mounted at /api). Used by /admin/staff.
  employeesList: () => request('/employees'),
  // Set an employee's email (job-page "Email assignee" messages), mobile
  // (job-assignment texts) + SkySwitch extension. Empty string clears a
  // field. Backend in routes/lookup.js.
  employeeSetContact: (id, { email, phone_number, phone_extension }) =>
    request(`/employees/${id}/contact`, {
      method: 'PUT',
      body: JSON.stringify({
        email: email ?? null,
        phone_number: phone_number ?? null,
        phone_extension: phone_extension ?? null,
      }),
    }),
  // Create a new employee (admin only). Login stays disabled until a
  // password is set; the row is immediately assignable + notifiable.
  employeeCreate: (payload) =>
    request('/employees', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  // Driver's license image (admin only, PII — streamed through the API,
  // never a public URL). Upload expects an already-cropped image Blob.
  employeeLicenseUpload: (id, blob, filename = 'license.jpg') => {
    const fd = new FormData();
    fd.append('file', blob, filename);
    return request(`/employees/${id}/license`, { method: 'POST', body: fd });
  },
  employeeLicenseDelete: (id) =>
    request(`/employees/${id}/license`, { method: 'DELETE' }),
  // Returns a short-lived object URL for viewing; caller revokes it.
  employeeLicenseBlobUrl: async (id) => {
    const token = localStorage.getItem('hg_token');
    const res = await fetch(`${API_BASE}/employees/${id}/license`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) {
      let msg = `API error ${res.status}`;
      try { const j = await res.json(); msg = j.message || j.error || msg; } catch { /* */ }
      throw new Error(msg);
    }
    return URL.createObjectURL(await res.blob());
  },
  // Push a pay period's time entries to QBO TimeActivity. Idempotent —
  // already-synced rows are skipped via qbo_time_activity_id. Returns
  // { synced, skipped_no_mapping, skipped_already_synced, errors[] }.
  qboSyncTimePeriod: (payPeriodId) =>
    request(`/quickbooks/sync-time-period/${payPeriodId}`, { method: 'POST' }),

  // ─── LED Modules (spec catalog for the quoting tool) ───────────────
  // Distinct from getAllModules() above — that endpoint is per-client
  // inventory counts. This one is the shared catalog of module *types*
  // (320x160 P8, 192x192 P10, etc.) consumed by /admin/led-quote.
  // Backend: routes/led-modules.js, schema: migration 019.
  getLedModules: ({ includeInactive = false } = {}) => {
    const qs = includeInactive ? '?include_inactive=1' : '';
    return request(`/led-modules${qs}`);
  },
  getLedModule: (id) => request(`/led-modules/${id}`),
  createLedModule: (mod) =>
    request('/led-modules', { method: 'POST', body: JSON.stringify(mod) }),
  updateLedModule: (id, patch) =>
    request(`/led-modules/${id}`, { method: 'PUT', body: JSON.stringify(patch) }),
  // Soft delete — flips is_active=false. Historic quote descriptions
  // that reference the module by id still resolve.
  deleteLedModule: (id) =>
    request(`/led-modules/${id}`, { method: 'DELETE' }),
};
