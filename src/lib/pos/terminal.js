// src/lib/pos/terminal.js
//
// Stripe Terminal driver for the counter tablet: connection token supply,
// reader discovery and reconnect, and the collect → confirm payment flow.
//
// Wraps @capgo/capacitor-stripe-terminal 8.x. Three things about that plugin
// shape the code below and are easy to get wrong from its README:
//
//   1. `initialize({ tokenProviderEndpoint })` fetches the connection token
//      with a bare, header-less Volley POST — no Authorization header, and it
//      logs the returned secret to logcat. A connection token is the ability
//      to take payments on the account, so this file leaves that option unset
//      and instead answers the SDK's RequestedConnectionToken event with an
//      authenticated fetch followed by setConnectionToken().
//
//   2. `collectPaymentMethod({ paymentIntent })` passes its argument straight
//      to Terminal.retrievePaymentIntent(), which takes the CLIENT SECRET,
//      not the PaymentIntent id. Passing the id fails at the reader.
//
//   3. `discoverReaders()` resolves on the FIRST discovery callback, which on
//      Bluetooth often fires before the WisePad has answered. Waiting on the
//      DiscoveredReaders event until our serial shows up is what makes
//      auto-reconnect reliable rather than a coin flip.
//
// The reader must NOT be paired in Android's Bluetooth settings. The SDK
// discovers and bonds it itself, and a manual system pairing interferes.

import { writable, get, derived } from 'svelte/store';
import {
  StripeTerminal, TerminalConnectTypes, TerminalEventsEnum,
} from '@capgo/capacitor-stripe-terminal';
import { api } from '$lib/api/client.js';
import {
  isNative, ensureLocationPermission, locationServicesEnabled, keepAwake,
} from './native.js';

const LS_READER = 'hg_pos_reader_serial';

// ─── State ───────────────────────────────────────────────────────────────────
// Silence is what makes a POS feel broken. Every one of these is rendered
// somewhere on the counter screen: staff should never be looking at a spinner
// wondering whether the reader died or is mid-firmware-update.
export const pos = writable({
  supported:      false,     // running on the tablet at all
  configured:     false,     // server has a Stripe key + Location
  isTest:         true,
  locationId:     null,
  initialized:    false,
  status:         'idle',    // idle|initializing|discovering|connecting|connected|updating|error
  reader:         null,      // { serialNumber, label, deviceType, ... }
  batteryLevel:   null,      // 0..1
  batteryCharging: null,
  updateProgress: null,      // 0..1 while firmware installs
  updateRunning:  false,
  displayMessage: null,      // "insert card" etc, mirrored from the reader
  inputPrompt:    null,      // "Swipe / Insert / Tap"
  paymentStatus:  null,
  reconnecting:   false,
  error:          null,
  blocker:        null,      // a specific, actionable reason payments are off
});

// Firmware updates will not install below this. Warn early: the reader
// blocks on a required update and there is nothing staff can do about it
// mid-queue except plug it in and wait.
const LOW_BATTERY = 0.5;

export const canTakePayment = derived(pos, ($p) =>
  $p.initialized && $p.status === 'connected' && !$p.updateRunning && !$p.blocker
);

function patch(fields) { pos.update((s) => ({ ...s, ...fields })); }

// ─── Saved reader ────────────────────────────────────────────────────────────
export function savedReaderSerial() {
  try { return localStorage.getItem(LS_READER) || null; } catch { return null; }
}
export function rememberReader(serial) {
  try { if (serial) localStorage.setItem(LS_READER, serial); } catch { /* private mode */ }
}
export function forgetReader() {
  try { localStorage.removeItem(LS_READER); } catch { /* */ }
}

// ─── Initialisation ──────────────────────────────────────────────────────────
let listenersBound = false;
let initPromise = null;

/**
 * Idempotent. Safe to call on every mount of the payment UI.
 *
 * Returns the current pos state. Failures land in `blocker` rather than
 * throwing, because every one of them is something a person at the counter
 * has to go fix, and a stack trace doesn't tell them which.
 */
export async function initTerminal() {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    if (!isNative()) {
      patch({ supported: false, blocker: 'The card reader only works on the counter tablet.' });
      return get(pos);
    }
    patch({ supported: true, status: 'initializing', error: null, blocker: null });

    // Server config first — isTest is derived from the shape of the key the
    // server actually holds, so the SDK can't be initialised into the wrong
    // mode and then fail discovery with "no readers found".
    let cfg;
    try {
      cfg = await api.terminalConfig();
    } catch (e) {
      patch({ status: 'error', blocker: `Can't reach the server: ${e.message}` });
      return get(pos);
    }
    patch({ configured: cfg.configured, isTest: cfg.isTest, locationId: cfg.locationId });
    if (!cfg.configured) {
      patch({ status: 'error', blocker: 'Stripe is not configured on the server (STRIPE_SECRET_KEY).' });
      return get(pos);
    }
    if (!cfg.locationId) {
      patch({ status: 'error', blocker: 'No Stripe Terminal Location is set (STRIPE_TERMINAL_LOCATION_ID).' });
      return get(pos);
    }

    // The SDK refuses to take payments if it can't place the device, and the
    // failure mode is opaque — a permission string thrown out of
    // discoverReaders. Check both halves and say which one is wrong.
    const blocker = await locationBlocker();
    if (blocker) {
      patch({ status: 'error', blocker });
      return get(pos);
    }

    bindListeners();

    try {
      // tokenProviderEndpoint deliberately omitted — see the header comment.
      await StripeTerminal.initialize({ isTest: cfg.isTest });
      patch({ initialized: true, status: 'idle' });
    } catch (e) {
      patch({ status: 'error', blocker: `Card reader SDK failed to start: ${e.message}` });
    }
    return get(pos);
  })();

  try { return await initPromise; }
  finally {
    // Let a failed init be retried; a successful one is cheap to re-enter
    // because the SDK's own initialize() is idempotent.
    if (get(pos).status === 'error') initPromise = null;
  }
}

async function locationBlocker() {
  try {
    const { granted } = await ensureLocationPermission();
    if (!granted) {
      return 'Location permission is denied. Stripe will not process payments without it — ' +
             'grant it in Android Settings > Apps > Holm Graphics > Permissions.';
    }
  } catch (e) {
    return `Could not check location permission: ${e.message}`;
  }
  try {
    const { enabled } = await locationServicesEnabled();
    if (!enabled) {
      return 'Device location is switched off. Turn Location on in Android settings — ' +
             'Stripe disables payments when it cannot place the device.';
    }
  } catch { /* non-fatal: the permission check is the load-bearing one */ }
  return null;
}

// ─── Events ──────────────────────────────────────────────────────────────────
function bindListeners() {
  if (listenersBound) return;
  listenersBound = true;
  const on = (evt, fn) => StripeTerminal.addListener(evt, fn);

  // The SDK asks for a token whenever it needs one and manages the lifecycle
  // itself. Nothing is cached here — a stale token is worse than a round-trip.
  on(TerminalEventsEnum.RequestedConnectionToken, async () => {
    try {
      const { secret } = await api.terminalConnectionToken();
      await StripeTerminal.setConnectionToken({ token: secret });
    } catch (e) {
      // Handing back an empty token is how the SDK is told the fetch failed;
      // it surfaces as a connection error rather than hanging forever.
      console.error('[pos] connection token failed:', e);
      patch({ error: `Could not get a Stripe connection token: ${e.message}` });
      try { await StripeTerminal.setConnectionToken({ token: '' }); } catch { /* */ }
    }
  });

  // Keep the screen up for exactly as long as a reader is connected. The
  // WisePad has no sleep setting; it stays awake because something holds a
  // connection to it, and a tablet whose screen has slept suspends the WebView
  // and drops that connection — turning the next sale into a 30-second
  // rediscovery. Released on disconnect so an idle counter still dims.
  on(TerminalEventsEnum.ConnectedReader, () => {
    patch({ status: 'connected', reconnecting: false, error: null });
    keepAwake(true);
    refreshConnectedReader();
  });
  on(TerminalEventsEnum.DisconnectedReader, ({ reason } = {}) => {
    keepAwake(false);
    patch({ status: 'idle', reader: null, displayMessage: null, inputPrompt: null,
            error: reason ? `Reader disconnected (${reason})` : null });
  });
  on(TerminalEventsEnum.UnexpectedReaderDisconnect, () => {
    patch({ status: 'idle', error: 'The reader dropped its connection.' });
  });

  // The WisePad 3 reboots itself every 24 hours. Without these three the
  // reboot looks exactly like a fault.
  on(TerminalEventsEnum.ReaderReconnectStarted, () =>
    patch({ reconnecting: true, error: 'Reconnecting to the reader...' }));
  on(TerminalEventsEnum.ReaderReconnectSucceeded, () =>
    patch({ reconnecting: false, status: 'connected', error: null }));
  on(TerminalEventsEnum.ReaderReconnectFailed, () =>
    patch({ reconnecting: false, status: 'idle',
            error: 'Could not reconnect to the reader. Tap Connect to try again.' }));

  // A required firmware update blocks the reader and can run for minutes.
  // Staff WILL assume it's frozen unless the progress is on screen.
  on(TerminalEventsEnum.StartInstallingUpdate, () =>
    patch({ updateRunning: true, updateProgress: 0, status: 'updating' }));
  on(TerminalEventsEnum.ReaderSoftwareUpdateProgress, ({ progress } = {}) =>
    patch({ updateProgress: Number(progress) || 0 }));
  on(TerminalEventsEnum.FinishInstallingUpdate, () =>
    patch({ updateRunning: false, updateProgress: null, status: 'connected' }));

  on(TerminalEventsEnum.BatteryLevel, ({ level, charging } = {}) =>
    patch({ batteryLevel: level ?? null, batteryCharging: charging ?? null }));

  // Mirror the reader's own prompts so staff can see "insert card" / "enter
  // PIN" without leaning over the customer's hands.
  on(TerminalEventsEnum.RequestDisplayMessage, ({ message, messageType } = {}) =>
    patch({ displayMessage: message || messageType || null }));
  on(TerminalEventsEnum.RequestReaderInput, ({ message, options } = {}) =>
    patch({ inputPrompt: message || (Array.isArray(options) ? options.join(' / ') : options) || null }));
  on(TerminalEventsEnum.PaymentStatusChange, ({ status } = {}) =>
    patch({ paymentStatus: status || null }));
  on(TerminalEventsEnum.ConnectionStatusChange, ({ status } = {}) => {
    if (status === 'NOT_CONNECTED') patch({ reader: null });
  });
}

async function refreshConnectedReader() {
  try {
    const { reader } = await StripeTerminal.getConnectedReader();
    if (reader) {
      patch({ reader, batteryLevel: reader.batteryLevel ?? get(pos).batteryLevel });
      rememberReader(reader.serialNumber);
    }
  } catch { /* the ConnectedReader event already moved us to connected */ }
}

// ─── Discovery + connect ─────────────────────────────────────────────────────

/**
 * Discovers Bluetooth readers and returns the list.
 *
 * `discoverReaders()` resolves on the first discovery callback, which is
 * frequently empty or partial for Bluetooth. This listens to the
 * DiscoveredReaders event too and keeps the best list seen, optionally
 * short-circuiting the moment `wantSerial` turns up.
 */
export async function discover({ timeoutMs = 30_000, wantSerial = null, simulated = false } = {}) {
  patch({ status: 'discovering', error: null });

  // Tear down any discovery still running before starting a new one. This is
  // load-bearing, not hygiene: the plugin's discovery failure callback only
  // logs (`Log.d`) and never rejects the PluginCall, so asking for a second
  // concurrent discovery produces a promise that NEVER settles — it looks
  // exactly like a reader that isn't there. Cancelling first is the whole
  // difference between "no readers found" after 30s and finding one in 2.
  try { await StripeTerminal.cancelDiscoverReaders(); } catch { /* none running */ }

  let best = [];
  let handle = null;
  let settle;
  const found = new Promise((resolve) => { settle = resolve; });

  try {
    handle = await StripeTerminal.addListener(
      TerminalEventsEnum.DiscoveredReaders,
      ({ readers } = {}) => {
        if (Array.isArray(readers) && readers.length >= best.length) best = readers;
        if (best.length && (!wantSerial || best.some((r) => r.serialNumber === wantSerial))) settle();
      }
    );

    // NOTE: the discoverReaders() promise is deliberately NOT part of the race
    // below. It settles almost immediately — before the native scan has even
    // started — and racing against it meant the finally block cancelled the
    // discovery 2ms after kicking it off. The scan was killing itself and
    // reporting "no readers found". Only actual readers, or the timeout, end
    // the wait now.
    StripeTerminal.discoverReaders({
      type: simulated ? TerminalConnectTypes.Simulated : TerminalConnectTypes.Bluetooth,
      locationId: get(pos).locationId,
    }).then(({ readers }) => {
      if (Array.isArray(readers) && readers.length >= best.length) best = readers;
      if (best.length && (!wantSerial || best.some((r) => r.serialNumber === wantSerial))) settle();
    }).catch((e) => {
      // Record it, but let the timeout decide when to stop — a rejection here
      // does not reliably mean the scan is dead.
      patch({ error: discoveryError(e) });
    });

    await Promise.race([found, sleep(timeoutMs)]);
    return best;
  } finally {
    try { await handle?.remove(); } catch { /* */ }
    // Deliberately does NOT cancel discovery here. The reader objects handed
    // back are only valid while their discovery session is alive — cancelling
    // on the way out invalidated them, and connectReader() then died with
    // "ConnectAndUpdateStateMachine: CANCELLED / DiscoverReaders was canceled
    // by the user" partway through the firmware handshake. Discovery is torn
    // down by connect() once it has what it needs, and by the cancel at the
    // top of this function before any new scan.
    if (get(pos).status === 'discovering') patch({ status: 'idle' });
  }
}

function discoveryError(e) {
  const msg = String(e?.message || e);
  if (msg.includes('ACCESS_FINE_LOCATION')) {
    return 'Location permission is denied — Stripe cannot find the reader without it.';
  }
  return `Could not find the card reader: ${msg}`;
}

/**
 * Connects to a specific reader and remembers it.
 *
 * autoReconnectOnUnexpectedDisconnect is on because the WisePad 3 reboots
 * itself daily; without it that reboot presents as a hard failure.
 */
export async function connect(reader) {
  if (!reader) throw new Error('No reader to connect to.');
  patch({ status: 'connecting', error: null });
  try {
    await StripeTerminal.connectReader({
      reader,
      autoReconnectOnUnexpectedDisconnect: true,
    });
    rememberReader(reader.serialNumber);
    // Safe to stop scanning only now that the reader is actually connected.
    try { await StripeTerminal.cancelDiscoverReaders(); } catch { /* */ }
    patch({ status: 'connected', reader });
    if ((reader.batteryLevel ?? 1) < LOW_BATTERY) {
      patch({ error: 'Reader battery is under 50% — firmware updates will not install. Put it on the charger.' });
    }
    return reader;
  } catch (e) {
    patch({ status: 'error', error: `Could not connect to the reader: ${e.message}` });
    throw e;
  }
}

/**
 * The launch path: reconnect to the reader this tablet used last, with no
 * picker. Counter staff should never be choosing a reader from a list.
 *
 * Falls back to returning the discovered list so the settings screen can
 * offer a picker the first time, or after the reader is replaced.
 */
export async function connectSavedReader({ simulated = false } = {}) {
  const state = await initTerminal();
  if (!state.initialized) return { connected: false, readers: [], blocker: state.blocker };

  const want = simulated ? null : savedReaderSerial();
  const readers = await discover({ wantSerial: want, simulated });
  if (!readers.length) {
    return { connected: false, readers: [], blocker: get(pos).error || 'No card reader found.' };
  }

  const target = want ? readers.find((r) => r.serialNumber === want) : null;
  if (!target && want) {
    // The remembered reader isn't here. Don't silently connect to a
    // different one — at a counter that could mean binding to the reader on
    // someone else's desk.
    return { connected: false, readers, blocker: `Reader ${want} wasn't found.` };
  }
  await connect(target || readers[0]);
  return { connected: true, readers, blocker: null };
}

export async function disconnect() {
  try { await StripeTerminal.disconnectReader(); } catch { /* */ }
  patch({ status: 'idle', reader: null });
}

// ─── Taking a payment ────────────────────────────────────────────────────────

/**
 * Runs one counter sale end to end.
 *
 * @param {object}   opts
 * @param {number}   opts.jobId
 * @param {number}   opts.amountCents        tax-INCLUSIVE total
 * @param {number}  [opts.subtotalCents]     printed on the receipt, and used
 *                                           by the QBO SalesReceipt path
 * @param {number}  [opts.taxCents]
 * @param {string}  [opts.description]
 * @param {Function}[opts.onStage]           ('creating'|'collecting'|'confirming'|'done')
 *
 * Returns { paymentId, paymentIntentId, card, signatureRequired }.
 *
 * On a decline this throws with `.paymentIntentId` set. Call it again with
 * the same job and amount and the server hands back the SAME PaymentIntent —
 * that reuse is Stripe's explicit guidance for Interac and is what stops a
 * customer being charged twice after a failed tap.
 */
export async function takePayment({
  jobId, amountCents, subtotalCents = null, taxCents = null,
  description = '', onStage = () => {},
}) {
  const state = get(pos);
  if (!state.initialized || state.status !== 'connected') {
    throw new Error('The card reader is not connected.');
  }

  onStage('creating');
  const intent = await api.terminalPaymentIntent({
    jobId, amountCents, description,
    ...(Number.isInteger(subtotalCents) ? { subtotalCents } : {}),
    ...(Number.isInteger(taxCents) ? { taxCents } : {}),
    readerSerial: state.reader?.serialNumber || null,
  });

  // Show the itemised cart on the reader's own screen where the hardware can
  // do it. The WisePad 3 CANNOT — it rejects this with "Reader does not
  // support setting display" — so this is best-effort and deliberately not
  // fatal. The customer still sees the AMOUNT on the reader during
  // collection, because that comes from the PaymentIntent itself; it's only
  // the line-item breakdown that a WisePad can't render.
  try {
    await StripeTerminal.setReaderDisplay({
      currency: 'cad',
      tax: Number.isInteger(taxCents) ? taxCents : 0,
      total: amountCents,
      lineItems: [{
        displayName: jobId ? `Job #${jobId}` : (description || 'Counter sale'),
        quantity: 1,
        amount: Number.isInteger(subtotalCents) ? subtotalCents : amountCents,
      }],
    });
  } catch (e) {
    // Cosmetic, and expected on a WisePad 3.
    console.warn('[pos] setReaderDisplay unavailable:', e?.message);
  }

  let card = null;
  try {
    onStage('collecting');
    patch({ displayMessage: 'Present card', error: null });

    // The CLIENT SECRET, not the id — the plugin feeds this straight into
    // Terminal.retrievePaymentIntent().
    card = await StripeTerminal.collectPaymentMethod({ paymentIntent: intent.clientSecret });

    onStage('confirming');
    // No capture step, ever. Interac cannot be authorised and captured
    // separately, and the PaymentIntent is created capture_method:'automatic'
    // precisely so nobody needs one.
    await StripeTerminal.confirmPaymentIntent();
  } catch (e) {
    const err = new Error(declineMessage(e));
    err.paymentIntentId = intent.paymentIntentId;
    err.paymentId = intent.id;
    err.declineCode = e?.declineCode || e?.data?.declineCode || null;
    err.cause = e;
    patch({ displayMessage: null, inputPrompt: null });
    try { await StripeTerminal.clearReaderDisplay(); } catch { /* */ }
    throw err;
  }

  patch({ displayMessage: null, inputPrompt: null });
  try { await StripeTerminal.clearReaderDisplay(); } catch { /* */ }
  onStage('done');

  return {
    paymentId:       intent.id,
    paymentIntentId: intent.paymentIntentId,
    amountCents,
    // brand / last4 / readMethod, straight off the reader. Enough to print a
    // receipt immediately without waiting on the webhook.
    card: card || null,
  };
}

// Whether this sale needs a signed merchant copy.
//
// The Terminal SDK has no "signature required" event — the WisePad's display
// messages cover card handling only. The answer lives in the EMV receipt's
// cardholder_verification_method, which arrives with the webhook, so this
// takes the settled row from awaitSettlement(). Unknown means no: Interac is
// always PIN-verified, and printing a spare signature slip on every tap
// wastes a roll a month.
export function signatureRequired(settled) {
  const cvm = settled?.emv_receipt?.cardholder_verification_method;
  return /signature/i.test(String(cvm || ''));
}

// Turns the SDK's error shapes into something a person at a counter can act
// on. The plugin rejects with { message, code, declineCode } in the data
// payload for card errors and a bare message for everything else.
function declineMessage(e) {
  const code = e?.declineCode || e?.data?.declineCode;
  const raw  = e?.message || e?.data?.message || String(e);
  if (code) {
    const friendly = {
      insufficient_funds:  'Declined — insufficient funds.',
      card_declined:       'Declined by the bank.',
      expired_card:        'Declined — card expired.',
      incorrect_pin:       'Wrong PIN. Try again.',
      pin_try_exceeded:    'Too many PIN attempts — the card is locked.',
      withdrawal_count_limit_exceeded: 'Declined — daily limit reached.',
    }[code];
    return friendly || `Declined (${code}).`;
  }
  if (/canceled|cancelled/i.test(raw)) return 'Payment cancelled.';
  return raw;
}

/** Staff backed out mid-collection, or the customer walked. */
export async function cancelCollect(paymentIntentId) {
  try { await StripeTerminal.cancelCollectPaymentMethod(); } catch { /* */ }
  try { await StripeTerminal.clearReaderDisplay(); } catch { /* */ }
  patch({ displayMessage: null, inputPrompt: null });
  if (paymentIntentId) {
    try { await api.terminalCancelPaymentIntent(paymentIntentId); } catch { /* */ }
  }
}

/**
 * Waits briefly for the webhook to enrich the row with the Stripe fee and the
 * EMV receipt block, which land a second or two after the reader approves.
 *
 * The receipt prints either way — a customer does not stand at the counter
 * waiting on our bookkeeping. Returns whatever the row looks like when the
 * time runs out.
 */
export async function awaitSettlement(paymentId, { timeoutMs = 5000, intervalMs = 700 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    try {
      last = await api.terminalPayment(paymentId);
      if (last?.status === 'succeeded' && last?.charge_id) return last;
    } catch { /* keep trying until the deadline */ }
    await sleep(intervalMs);
  }
  return last;
}

// ─── Simulated reader (testing step 1) ───────────────────────────────────────
// Proves token → PaymentIntent → collect → confirm → webhook → QBO with no
// hardware at all. `card` accepts Stripe's simulated card names, e.g.
// 'VISA', 'INTERAC', 'CHARGE_DECLINED'.
export async function useSimulator({ card = 'VISA', update = 'NONE' } = {}) {
  await initTerminal();
  await StripeTerminal.setSimulatorConfiguration({ simulatedCard: card, update });
  return connectSavedReader({ simulated: true });
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
