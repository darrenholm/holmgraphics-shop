// src/lib/pos/smartReader.js
//
// The WiFi reader (WisePOS E), and deliberately nothing like terminal.js.
//
// terminal.js drives the Bluetooth WisePad: the tablet holds the connection,
// runs the Stripe SDK, and is the only machine in the shop that can take a
// payment. That connection is what kept failing — the tablet's own Bluetooth
// service crashes and no amount of reconnecting brings it back.
//
// A WisePOS E has no connection to us at all. The server tells Stripe which
// sale the reader should collect, the reader talks to Stripe over the shop
// WiFi and runs the whole card interaction itself, and we watch for the
// answer. So:
//
//   * there is no Bluetooth link to drop,
//   * no SDK, so this runs in ANY browser — the office PC can send a sale to
//     the counter reader, which is the thing Bluetooth could never do,
//   * the outcome still arrives on the webhook, so QuickBooks write-back, job
//     completion and refunds are untouched.
//
// Which reader a machine uses is remembered per-device, same as the printer:
// the counter tablet and the office PC may well point at different ones.

import { writable, get } from 'svelte/store';
import { api } from '$lib/api/client.js';

const LS_READER = 'hg_pos_smart_reader';

export const smartReader = writable({
  id:      null,      // tmr_…  the reader this device sends sales to
  label:   null,
  status:  null,      // online | offline
  checkedAt: null,
  error:   null,
});

// ─── Which reader this device uses ───────────────────────────────────────────

export function savedSmartReaderId() {
  try { return localStorage.getItem(LS_READER); } catch { return null; }
}

export function useSmartReader(reader) {
  try { localStorage.setItem(LS_READER, reader.id); } catch { /* */ }
  smartReader.set({
    id: reader.id, label: reader.label, status: reader.status,
    checkedAt: Date.now(), error: null,
  });
}

export function forgetSmartReader() {
  try { localStorage.removeItem(LS_READER); } catch { /* */ }
  smartReader.set({ id: null, label: null, status: null, checkedAt: null, error: null });
}

export async function listReaders() {
  return api.terminalReaders();
}

export async function registerReader(registrationCode, label) {
  const reader = await api.terminalRegisterReader(registrationCode, label);
  useSmartReader(reader);
  return reader;
}

// Cheap health check for the settings screen. A reader that says "offline"
// here is unplugged, asleep or off the WiFi — worth knowing BEFORE a customer
// is standing at the counter.
export async function refreshStatus() {
  const id = get(smartReader).id || savedSmartReaderId();
  if (!id) return null;
  try {
    const r = await api.terminalReader(id);
    smartReader.set({
      id: r.id, label: r.label, status: r.status, checkedAt: Date.now(), error: null,
    });
    return r;
  } catch (e) {
    smartReader.update((s) => ({ ...s, error: e.message, checkedAt: Date.now() }));
    return null;
  }
}

// ─── Taking a payment ────────────────────────────────────────────────────────

// How long to let the customer take before giving up on them. The reader's own
// screen shows the amount the whole time; this is only our patience, not
// theirs, and cancelling releases the reader for the next sale.
const COLLECT_TIMEOUT_MS = 3 * 60_000;
const POLL_MS = 1500;

/**
 * Runs one sale on the WiFi reader.
 *
 * @param {object}   opts
 * @param {number}   opts.paymentId   the terminal_payments row from /payment-intent
 * @param {string}  [opts.readerId]   defaults to this device's saved reader
 * @param {Function}[opts.onStage]    ('sending'|'waiting'|'done')
 *
 * Resolves when the reader reports the payment succeeded. Throws with a
 * counter-readable message on decline, cancellation or timeout.
 *
 * Nothing here decides where money goes. The PaymentIntent was created and
 * written to terminal_payments before this runs, and the webhook is what
 * books it — so a browser closed mid-sale loses the screen, not the sale.
 */
export async function collectOnReader({ paymentId, readerId = null, onStage = () => {} }) {
  const id = readerId || savedSmartReaderId();
  if (!id) throw new Error('No WiFi reader chosen on this device. Pick one in POS settings.');

  onStage('sending');
  let reader = await api.terminalReaderCollect(id, paymentId);

  onStage('waiting');
  const deadline = Date.now() + COLLECT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const action = reader?.action;
    if (action && action.status !== 'in_progress') {
      if (action.status === 'succeeded') { onStage('done'); return reader; }
      throw new Error(declineMessage(action));
    }
    await sleep(POLL_MS);
    try {
      reader = await api.terminalReader(id);
    } catch {
      // A blip on our own network must not abandon a sale the reader is still
      // running. Keep polling until the deadline.
    }
  }

  // Out of patience. Clear the reader's screen so the next customer doesn't
  // walk up to a stale amount.
  try { await api.terminalReaderCancel(id); } catch { /* */ }
  throw new Error('The customer did not finish at the reader. Nothing was charged.');
}

/** Staff backed out, or the customer walked. */
export async function cancelOnReader(readerId = null) {
  const id = readerId || savedSmartReaderId();
  if (!id) return;
  try { await api.terminalReaderCancel(id); } catch { /* */ }
}

// The reader reports failures as a code plus Stripe's own wording, which is
// written for developers. Say it the way the person at the counter would.
function declineMessage(action) {
  const code = action?.failureCode || '';
  const friendly = {
    canceled:                        'Cancelled at the reader. Nothing was charged.',
    insufficient_funds:              'Declined — insufficient funds.',
    card_declined:                   'Declined by the bank.',
    expired_card:                    'Declined — card expired.',
    incorrect_pin:                   'Wrong PIN. Try again.',
    pin_try_exceeded:                'Too many PIN attempts — the card is locked.',
    withdrawal_count_limit_exceeded: 'Declined — daily limit reached.',
    reader_timeout:                  'The reader timed out waiting for the card.',
  }[code];
  return friendly || action?.failureMessage || 'The payment did not go through.';
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
