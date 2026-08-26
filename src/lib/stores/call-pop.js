// src/lib/stores/call-pop.js
// Client half of the inbound-call screen pop.
//
// Holds one long-lived connection to GET /api/telephony/stream and turns the
// events into a small stack of cards.
//
// WHY fetch() AND NOT EventSource: EventSource cannot set request headers, and
// staff auth here is a Bearer JWT. The alternatives were putting the token in
// the query string (where it lands in Railway's request logs and the browser's
// history) or minting a second short-lived ticket type. Reading the stream
// through fetch() keeps the existing token in the existing header and costs
// about thirty lines. The trade-off is that the browser's automatic
// EventSource reconnect is gone, so we do our own backoff below.

import { writable, get } from 'svelte/store';
import { API_BASE } from '$lib/api/client.js';

// Newest first. The UI renders at most MAX_VISIBLE.
export const calls = writable([]);

// 'idle' | 'connecting' | 'open' | 'retrying'
// Surfaced so the pop can show a quiet "phone link down" hint rather than
// just silently never popping — a screen pop that stops working invisibly is
// worse than one that says it's broken.
export const streamState = writable('idle');

const MAX_VISIBLE = 3;

// Spec: auto-dismiss 45s after the call ends.
const DISMISS_AFTER_ENDED_MS = 45_000;

// Backstop for a pop that never receives an 'ended' event — either the
// handset's Call Terminated Action URL isn't configured, or the event was
// lost. Without this the card sits on screen until the page reloads.
const MAX_POP_LIFETIME_MS = 5 * 60_000;

const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS  = 30_000;

let controller = null;   // AbortController for the in-flight stream
let retryTimer = null;
let attempt = 0;
let refCount = 0;        // components currently mounted
const timers = new Map(); // pop key → timeout id

function token() {
  try { return localStorage.getItem('hg_token'); } catch { return null; }
}

// ─── Card stack ──────────────────────────────────────────────────────────────

function clearTimer(key) {
  const t = timers.get(key);
  if (t) { clearTimeout(t); timers.delete(key); }
}

export function dismiss(key) {
  clearTimer(key);
  calls.update((list) => list.filter((c) => c.key !== key));
}

function scheduleDismiss(key, ms) {
  clearTimer(key);
  timers.set(key, setTimeout(() => dismiss(key), ms));
}

function applyEvent(payload) {
  if (!payload || !payload.key) return;

  calls.update((list) => {
    const idx = list.findIndex((c) => c.key === payload.key);

    if (payload.event === 'ringing') {
      if (idx >= 0) return list; // already on screen
      scheduleDismiss(payload.key, MAX_POP_LIFETIME_MS);
      // Newest on top, oldest falls off the bottom of the stack.
      const next = [{ ...payload, state: 'ringing' }, ...list];
      for (const dropped of next.slice(MAX_VISIBLE)) clearTimer(dropped.key);
      return next.slice(0, MAX_VISIBLE);
    }

    // answered / ended only update a card that's already up. A lifecycle
    // event with no matching card means the ring happened before this tab
    // connected; popping "call ended" out of nowhere would be noise.
    if (idx < 0) return list;

    const merged = { ...list[idx] };
    if (payload.event === 'answered') {
      merged.state = 'answered';
      merged.handledBy = payload.handledBy || merged.handledBy;
      merged.answeredAt = payload.at;
    } else if (payload.event === 'ended') {
      merged.state = 'ended';
      merged.endedAt = payload.at;
      scheduleDismiss(payload.key, DISMISS_AFTER_ENDED_MS);
    }
    const copy = [...list];
    copy[idx] = merged;
    return copy;
  });
}

// ─── Stream ──────────────────────────────────────────────────────────────────

// Parse the SSE wire format out of a raw text chunk stream. We only ever emit
// one event type ('call'), so this stays minimal: split on the blank-line
// frame separator, keep the data: lines, ignore comments (the heartbeat).
function parseFrames(buffer, onData) {
  let rest = buffer;
  let sep;
  while ((sep = rest.indexOf('\n\n')) !== -1) {
    const frame = rest.slice(0, sep);
    rest = rest.slice(sep + 2);
    const data = frame
      .split('\n')
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).trim())
      .join('\n');
    if (!data) continue; // comment frame — the heartbeat
    try { onData(JSON.parse(data)); } catch { /* malformed frame — skip it */ }
  }
  return rest;
}

// Returns 'stop' when there is no point retrying — no session, or a session
// the API rejects. Anything else means "the stream ended, reconnect".
async function run() {
  const jwt = token();
  if (!jwt) { streamState.set('idle'); return 'stop'; }

  controller = new AbortController();
  streamState.set(attempt === 0 ? 'connecting' : 'retrying');

  const res = await fetch(`${API_BASE}/telephony/stream`, {
    headers: { Authorization: `Bearer ${jwt}` },
    signal: controller.signal,
    // Never let a cache sit between us and an event stream.
    cache: 'no-store',
  });

  if (!res.ok || !res.body) {
    // 401/403 means the session is gone or isn't staff. Stop rather than
    // hammering the API with a token that will never work; the next page load
    // re-auths. Any other status is a server-side blip worth retrying.
    if (res.status === 401 || res.status === 403) {
      streamState.set('idle');
      return 'stop';
    }
    throw new Error(`stream ${res.status}`);
  }

  attempt = 0;
  streamState.set('open');

  const reader  = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  for (;;) {
    const { value, done } = await reader.read();
    if (done) throw new Error('stream closed');
    buffer = parseFrames(buffer + decoder.decode(value, { stream: true }), applyEvent);
  }
}

function scheduleReconnect() {
  if (refCount <= 0) return;
  // Exponential backoff with a little jitter so six shop browsers coming back
  // from the same network blip don't all retry on the same millisecond.
  const delay = Math.min(RECONNECT_BASE_MS * 2 ** attempt, RECONNECT_MAX_MS);
  attempt += 1;
  streamState.set('retrying');
  clearTimeout(retryTimer);
  retryTimer = setTimeout(loop, delay + Math.random() * 500);
}

async function loop() {
  if (refCount <= 0) return;
  let outcome;
  try {
    outcome = await run();
  } catch (e) {
    if (e?.name === 'AbortError') return; // we disconnected on purpose
    scheduleReconnect();
    return;
  }
  if (outcome === 'stop') return;
  scheduleReconnect();
}

// Mount/unmount aware: several components (or a re-mounting layout) share one
// connection, and it closes when the last of them goes away.
export function connect() {
  refCount += 1;
  if (refCount === 1) {
    attempt = 0;
    loop();
  }
  return disconnect;
}

export function disconnect() {
  refCount = Math.max(0, refCount - 1);
  if (refCount > 0) return;
  clearTimeout(retryTimer);
  retryTimer = null;
  try { controller?.abort(); } catch {}
  controller = null;
  streamState.set('idle');
}

// Test/debug seam: push a payload through the same path a real event takes.
// Handy for eyeballing the card without ringing the shop phone.
export function __injectForTesting(payload) {
  applyEvent(payload);
}

export function currentCalls() {
  return get(calls);
}
