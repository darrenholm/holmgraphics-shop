// src/lib/pos/readerlog.js
//
// The card reader's diary.
//
// Every round of diagnosing the WisePad's disconnects so far has been someone
// looking at the tablet AFTER it happened and reasoning from a snapshot.
// Three separate causes have been found and fixed that way, at about a
// morning each, and it is still dropping. Nobody knows whether a daytime drop
// heals itself in thirty seconds or stays down until it's noticed, because
// nothing writes it down.
//
// So this writes it down. Fire-and-forget, queued through a WiFi outage, and
// incapable of interfering with the thing it is observing: every path
// swallows its own errors, and nothing here is ever awaited by the payment
// flow.

import { api } from '$lib/api/client.js';
import { isNative } from './native.js';

const LS_QUEUE = 'hg_pos_readerlog_queue';
// Bigger than a normal backlog, small enough that a tablet left offline over
// a long weekend doesn't fill localStorage. Oldest go first when it overflows
// — a drop from eight days ago matters less than the one an hour ago.
const MAX_QUEUED = 300;
// Events are posted in small batches rather than one at a time: a disconnect
// typically fires three or four of these within a second, and four round
// trips while the reader is down is four chances to make things worse.
const FLUSH_MS = 4000;

let queue = load();
let flushTimer = null;
let flushing = false;

function load() {
  try {
    const raw = localStorage.getItem(LS_QUEUE);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function save() {
  try { localStorage.setItem(LS_QUEUE, JSON.stringify(queue)); } catch { /* full or private */ }
}

/**
 * Records one thing the reader did.
 *
 * Never throws and never returns anything worth waiting for. Call it and
 * carry on — at a counter with a customer standing there, the diary is the
 * least important thing the tablet is doing.
 *
 * @param {string} event    see migration 069 for the values in use
 * @param {object} [fields] { reason, readerSerial, batteryPct, detail }
 */
export function logReaderEvent(event, fields = {}) {
  try {
    if (!isNative()) return;          // the office browser is not the counter
    queue.push({
      event,
      reason:       fields.reason ?? null,
      readerSerial: fields.readerSerial ?? null,
      batteryPct:   fields.batteryPct ?? null,
      detail:       fields.detail ?? null,
      occurredAt:   new Date().toISOString(),
    });
    if (queue.length > MAX_QUEUED) queue = queue.slice(-MAX_QUEUED);
    save();
    scheduleFlush();
  } catch { /* diagnostics must never break the till */ }
}

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => { flushTimer = null; flush(); }, FLUSH_MS);
}

export async function flush() {
  if (flushing || !queue.length) return;
  flushing = true;
  // Take a copy and leave the queue in place until the POST succeeds. A
  // failed flush must not lose the very events that explain the failure.
  const batch = queue.slice(0, 200);
  try {
    await api.terminalReaderEvents(batch);
    queue = queue.slice(batch.length);
    save();
  } catch {
    // Offline, or the server is down. Keep them and try on the next event.
  } finally {
    flushing = false;
  }
}
