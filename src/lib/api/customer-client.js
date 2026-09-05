// src/lib/api/customer-client.js
//
// Customer-facing API client. Distinct from $lib/api/client.js (staff) so
// the two auth realms can coexist. Uses the `hg_customer_token` localStorage
// key for its Authorization header, and on 401 sends users to /shop/login
// instead of the staff /login.

export const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';

async function request(path, options = {}) {
  const token = (typeof localStorage !== 'undefined') ? localStorage.getItem('hg_customer_token') : null;
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...options.headers,
  };
  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  // Handle 401 by clearing the customer session and bouncing to login.
  // Routes that explicitly handle their own 401 (e.g. login itself) can
  // catch and re-throw before this fires by setting `options.allow401`.
  if (res.status === 401 && !options.allow401) {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem('hg_customer_token');
      localStorage.removeItem('hg_customer');
    }
    if (typeof window !== 'undefined') {
      const here = window.location.pathname + window.location.search;
      window.location.href = `/shop/login?return=${encodeURIComponent(here)}`;
    }
    return;
  }
  // Multipart uploads need a different request shape (no JSON Content-Type,
  // pass FormData as body). Provide a separate uploadFile() below.
  let data;
  try { data = await res.json(); } catch { data = null; }
  if (!res.ok) {
    const err = new Error(data?.message || data?.error || `API error ${res.status}`);
    err.status = res.status;
    err.body   = data;
    throw err;
  }
  return data;
}

async function uploadFile(path, file, extraFields = {}) {
  const token = localStorage.getItem('hg_customer_token');
  const fd = new FormData();
  for (const [k, v] of Object.entries(extraFields)) fd.append(k, v);
  fd.append('file', file);
  const res = await fetch(`${API_BASE}${path}`, {
    method:  'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body:    fd,
  });
  let data;
  try { data = await res.json(); } catch { data = null; }
  if (!res.ok) {
    const err = new Error(data?.message || data?.error || `Upload error ${res.status}`);
    err.status = res.status;
    err.body   = data;
    throw err;
  }
  return data;
}

export const customerApi = {
  // ─── Auth ───────────────────────────────────────────────
  register: (body) =>
    request('/customer/register', { method: 'POST', body: JSON.stringify(body), allow401: true }),
  // login: optionally accepts returnPath so the activation email (sent if the
  // account is unactivated) can carry the URL the customer was trying to reach.
  login: (email, password, returnPath) =>
    request('/customer/login', {
      method: 'POST',
      body: JSON.stringify({ email, password, ...(returnPath ? { returnPath } : {}) }),
      allow401: true,
    }),
  requestActivation: (email, returnPath) =>
    request('/customer/request-activation', {
      method: 'POST',
      body: JSON.stringify({ email, ...(returnPath ? { returnPath } : {}) }),
    }),
  activate: (token, body) =>
    request(`/customer/activate/${encodeURIComponent(token)}`, { method: 'POST', body: JSON.stringify(body) }),
  forgotPassword: (email) =>
    request('/customer/forgot-password', { method: 'POST', body: JSON.stringify({ email }) }),
  resetPassword: (token, password) =>
    request('/customer/reset-password', { method: 'POST', body: JSON.stringify({ token, password }) }),
  me: () => request('/customer/me'),
  updateMe: (patch) => request('/customer/me', { method: 'PUT', body: JSON.stringify(patch) }),
  logout: () => request('/customer/logout', { method: 'POST' }),

  // ─── Election materials ─────────────────────────────────
  // Prices are public so a candidate can budget before making an account;
  // only creating the job needs a login.
  electionCatalogue: () => request('/election/catalogue'),
  electionQuote: (basket) =>
    request('/election/quote', { method: 'POST', body: JSON.stringify(basket) }),
  saveElectionDraft: (code, body) =>
    request(`/election/drafts/${encodeURIComponent(code)}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  getElectionDraft: (code) => request(`/election/drafts/${encodeURIComponent(code)}`),
  createElectionJob: (body) =>
    request('/election/jobs', { method: 'POST', body: JSON.stringify(body) }),
  placeElectionOrder: (jobId) =>
    request(`/election/jobs/${encodeURIComponent(jobId)}/order`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),

  // ─── Customer portal: "current jobs" ────────────────────
  getMyProjects: () => request('/customer/projects'),
  /** Full detail of one project (line items, photos, invoice link). */
  getProject: (projectId) => request(`/customer/projects/${encodeURIComponent(projectId)}`),
  /**
   * Direct URL to download the QBO invoice PDF for a project. The browser
   * fetches it directly (with the customer JWT in the header via fetch /
   * an <a download> with credentials wouldn't carry the bearer token,
   * so we use fetch + create a blob URL — see the detail page).
   */
  projectInvoicePdfUrl: (projectId) =>
    `${API_BASE}/customer/projects/${encodeURIComponent(projectId)}/invoice-pdf`,
  /**
   * Mint a 14-day upload link tied to this project and the logged-in
   * customer. Returns { url, token, expires_at, max_uploads } so the
   * caller can route the user straight to /upload/<token>.
   */
  requestProjectUploadLink: (projectId) =>
    request(`/customer/projects/${encodeURIComponent(projectId)}/upload-link`, { method: 'POST', body: JSON.stringify({}) }),
  getProjectMessages: (projectId) =>
    request(`/customer/projects/${encodeURIComponent(projectId)}/messages`),
  postProjectMessage: (projectId, body) =>
    request(`/customer/projects/${encodeURIComponent(projectId)}/messages`, { method: 'POST', body: JSON.stringify({ body }) }),
  /**
   * Pay an invoice for a project. token comes from tokenize-public; amount
   * is in dollars. Returns { ok, charge_id, applied_to_invoice }.
   */
  payProject: (projectId, { token, amount, cardBrand, cardLast4 }) =>
    request(`/customer/projects/${encodeURIComponent(projectId)}/pay`, {
      method: 'POST',
      body: JSON.stringify({ token, amount, cardBrand, cardLast4 }),
    }),
  /** Re-order: copies the source project's items into a new quote. */
  reorderProject: (projectId) =>
    request(`/customer/projects/${encodeURIComponent(projectId)}/reorder`, { method: 'POST', body: JSON.stringify({}) }),

  // ─── DTF config (no auth required) ──────────────────────
  getPrintLocations: (category) =>
    request(`/dtf/print-locations${category ? `?category=${encodeURIComponent(category)}` : ''}`),
  getCustomTiers: () => request('/dtf/custom-tiers'),
  getTaxRates:    () => request('/dtf/tax-rates'),

  // ─── Cart pricing (no auth required) ────────────────────
  quoteCart: (cart, ship_to, fulfillment_method = 'ship', shipping_total = 0) =>
    request('/orders/quote', {
      method: 'POST',
      body: JSON.stringify({ cart, ship_to, fulfillment_method, shipping_total }),
    }),

  // ─── Shipping rates ─────────────────────────────────────
  getShippingRates: (cart, ship_to) =>
    request('/orders/shipping-rates', {
      method: 'POST',
      body: JSON.stringify({ cart, ship_to }),
    }),

  // ─── Orders ─────────────────────────────────────────────
  createOrder: (body) =>
    request('/orders', { method: 'POST', body: JSON.stringify(body) }),
  getOrder: (orderNumber) => request(`/orders/${encodeURIComponent(orderNumber)}`),
  getOrders: () => request('/orders'),

  // ─── Card tokenization ──────────────────────────────────
  // Posts raw card data to /api/payment/tokenize, which proxies to
  // Intuit's tokens API. Returns { token, brand, last4 }. The token
  // is single-use and must be passed straight to createOrder().
  // Card data hits the API server only — never persisted, never logged.
  tokenizeCard: (body) =>
    request('/payment/tokenize', { method: 'POST', body: JSON.stringify(body) }),

  // ─── Designs / artwork upload ───────────────────────────
  uploadDesign: (designId, file) =>
    uploadFile(`/designs/${encodeURIComponent(designId)}/upload`, file),

  // ─── Proof actions (token-based, no JWT) ────────────────
  getProofByToken: (token) =>
    request(`/proofs/by-token/${encodeURIComponent(token)}`),
  approveProof: (token) =>
    request(`/proofs/by-token/${encodeURIComponent(token)}/approve`, { method: 'POST' }),
  requestProofChanges: (token, message) =>
    request(`/proofs/by-token/${encodeURIComponent(token)}/request-changes`, {
      method: 'POST', body: JSON.stringify({ message }),
    }),
  cancelProof: (token) =>
    request(`/proofs/by-token/${encodeURIComponent(token)}/cancel`, { method: 'POST' }),
};
