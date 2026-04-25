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
  login: (email, password) =>
    request('/customer/login', { method: 'POST', body: JSON.stringify({ email, password }), allow401: true }),
  requestActivation: (email) =>
    request('/customer/request-activation', { method: 'POST', body: JSON.stringify({ email }) }),
  activate: (token, body) =>
    request(`/customer/activate/${encodeURIComponent(token)}`, { method: 'POST', body: JSON.stringify(body) }),
  forgotPassword: (email) =>
    request('/customer/forgot-password', { method: 'POST', body: JSON.stringify({ email }) }),
  resetPassword: (token, password) =>
    request('/customer/reset-password', { method: 'POST', body: JSON.stringify({ token, password }) }),
  me: () => request('/customer/me'),
  updateMe: (patch) => request('/customer/me', { method: 'PUT', body: JSON.stringify(patch) }),
  logout: () => request('/customer/logout', { method: 'POST' }),

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
