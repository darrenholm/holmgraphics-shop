// Client for the LED server's public marketplace API.
// CORS on the LED side allows holmgraphics.ca + localhost dev origins.

const FALLBACK_BASE = 'https://led.holmgraphics.ca';
const FALLBACK_SHOP_API_BASE = 'https://holmgraphics-shop-api-production.up.railway.app';

/** Resolve the LED API base URL from Vite env, falling back to production. */
export function ledApiBase() {
  // SvelteKit exposes import.meta.env for VITE_-prefixed vars.
  const fromEnv = import.meta?.env?.VITE_LED_API_BASE_URL;
  return (fromEnv || FALLBACK_BASE).replace(/\/$/, '');
}

/** Resolve the shop-api base URL for direct card tokenization. */
export function shopApiBase() {
  const fromEnv = import.meta?.env?.VITE_SHOP_API_BASE_URL;
  return (fromEnv || FALLBACK_SHOP_API_BASE).replace(/\/$/, '');
}

/**
 * Tokenize a card by calling shop-api's public tokenize endpoint directly.
 * Card details NEVER touch the LED server — they go straight from the
 * browser to shop-api, which forwards to Intuit and drops the plaintext.
 * Returns { token, brand?, last4? }.
 */
export async function tokenizeCard({ number, exp, cvc, zip, name }) {
  const res = await fetch(`${shopApiBase()}/api/internal/tokenize-public`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ number, exp, cvc, zip, name }),
  });
  const text = await res.text();
  const data = text ? safeJson(text) : {};
  if (!res.ok) {
    throw new Error(data?.error || `Tokenize failed (${res.status})`);
  }
  return data;
}

async function req(path, opts = {}) {
  const url = `${ledApiBase()}${path}`;
  const headers = { ...(opts.headers || {}) };
  // Attach the customer JWT (minted on /login by shop-api) when present.
  // The LED app's optionalAdvertiser middleware reads it and grants the
  // self-serve mid-rental swap path; without it the endpoint falls back
  // to the legacy "rental id is the secret" pre-approval rules.
  if (typeof localStorage !== 'undefined') {
    const token = localStorage.getItem('hg_token');
    if (token) headers['Authorization'] = `Bearer ${token}`;
  }
  let body;
  if (opts.formData) {
    body = opts.formData;
  } else if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  const res = await fetch(url, {
    method: opts.method || (body ? 'POST' : 'GET'),
    headers,
    body,
  });
  if (res.status === 204) return undefined;
  const text = await res.text();
  const data = text ? safeJson(text) : undefined;
  if (!res.ok) {
    const msg = data?.message
      ? `${data.error ?? ''}${data.code ? ` (${data.code})` : ''}: ${data.message}`.replace(/^: /, '')
      : data?.error || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

function safeJson(s) {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

export const advertiseApi = {
  listDisplays: () => req('/api/public/displays'),
  getDisplay: (id) => req(`/api/public/displays/${encodeURIComponent(id)}`),
  createRental: (data) => req('/api/public/rentals', { body: data }),
  uploadArtwork: (rentalId, file) => {
    const fd = new FormData();
    fd.append('file', file);
    return req(`/api/public/rentals/${encodeURIComponent(rentalId)}/artwork`, { formData: fd });
  },
  /**
   * Render a text-only ad (server makes the PNG at the display's native
   * resolution and stores it like an upload). Passes through { text,
   * textColor, bgColor, fontFamily }.
   */
  createTextArtwork: (rentalId, opts) =>
    req(`/api/public/rentals/${encodeURIComponent(rentalId)}/text-artwork`, { body: opts }),
  /** Pay a rental given an already-tokenized card. Returns { ok, chargeId, status }. */
  payRental: (rentalId, { token, cardBrand, cardLast4 }) =>
    req(`/api/public/rentals/${encodeURIComponent(rentalId)}/pay`, {
      body: { token, cardBrand, cardLast4 },
    }),
  getRental: (id) => req(`/api/public/rentals/${encodeURIComponent(id)}`),
  /**
   * Self-serve advertiser portal: list rentals belonging to the logged-in
   * client, pre-grouped into { running, upcoming, past }. Auth comes from
   * the hg_token in localStorage (set by the shared shop login flow).
   */
  getMyRentals: () => req('/api/public/my-rentals'),
  /**
   * Switch a rental between "fit as-is" (letterbox, preserve aspect) and
   * "stretch to fill" (cover the whole screen, crop if needed).
   * Only allowed before approval — returns 409 otherwise.
   */
  setFitMode: (rentalId, fitMode) =>
    req(`/api/public/rentals/${encodeURIComponent(rentalId)}/fit-mode`, {
      method: 'PATCH',
      body: { fitMode },
    }),
  /**
   * Check slot availability for a display in a given window. Pass startTime
   * + endTime to count only ads whose daypart overlaps yours.
   * Returns { maxSlots, slotSeconds, slotsBooked, slotsAvailable }.
   */
  getAvailability: (displayId, { startDate, endDate, startTime, endTime } = {}) => {
    const params = new URLSearchParams();
    if (startDate) params.set('startDate', startDate);
    if (endDate)   params.set('endDate', endDate);
    if (startTime) params.set('startTime', startTime);
    if (endTime)   params.set('endTime', endTime);
    const qs = params.toString();
    return req(`/api/public/displays/${encodeURIComponent(displayId)}/availability${qs ? `?${qs}` : ''}`);
  },
};

/** Format a money amount given cents + currency. */
export function fmtMoney(cents, currency) {
  if (cents == null) return '—';
  return new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency: currency || 'CAD',
  }).format(cents / 100);
}

/** Compute the booking total in cents for a chosen unit/count, given a display. */
export function quoteCents(display, unit, count) {
  const rate =
    unit === 'day'
      ? display?.daily_rate
      : unit === 'week'
        ? display?.weekly_rate
        : display?.monthly_rate;
  if (rate == null) return null;
  const n = parseFloat(rate);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100) * count;
}

/** Friendly summary of rates for a display, e.g. "$50/day · $300/week". */
export function formatRateSummary(display) {
  const fmt = (n) =>
    n
      ? new Intl.NumberFormat('en-CA', {
          style: 'currency',
          currency: display.rental_currency || 'CAD',
        }).format(parseFloat(n))
      : null;
  const day = fmt(display.daily_rate);
  const week = fmt(display.weekly_rate);
  const month = fmt(display.monthly_rate);
  const parts = [];
  if (day) parts.push(`${day}/day`);
  if (week) parts.push(`${week}/week`);
  if (month) parts.push(`${month}/month`);
  return parts.join(' · ') || 'Contact for pricing';
}
