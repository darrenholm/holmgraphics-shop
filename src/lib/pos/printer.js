// src/lib/pos/printer.js
//
// Receipt printing for the counter tablet: which printer, how wide, what
// letterhead — and the two-copy rule for signature-required credit sales.
//
// Settings are per-device in localStorage, not per-account on the server:
// the printer MAC belongs to the tablet sitting in front of it, and a second
// counter must not inherit the first one's.

import { writeToPrinter, probePrinter, listPairedDevices, isNative } from './native.js';
import { buildSaleReceipt, buildCashReceipt, buildDrawerKick, DEFAULT_SHOP } from './escpos.js';

const LS_KEY = 'hg_pos_printer';

const DEFAULTS = {
  address: '',          // Bluetooth MAC of the bonded SPP printer
  name:    '',
  width:   32,          // 32 cols = 58mm head, 48 = 80mm
  shop:    { ...DEFAULT_SHOP },
  enabled: true,
};

export function getPrinterConfig() {
  if (typeof localStorage === 'undefined') return { ...DEFAULTS };
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw);
    return { ...DEFAULTS, ...parsed, shop: { ...DEFAULTS.shop, ...(parsed.shop || {}) } };
  } catch {
    return { ...DEFAULTS };
  }
}

export function setPrinterConfig(patch) {
  const next = { ...getPrinterConfig(), ...patch };
  if (patch?.shop) next.shop = { ...getPrinterConfig().shop, ...patch.shop };
  localStorage.setItem(LS_KEY, JSON.stringify(next));
  return next;
}

export async function pairedDevices() {
  const { devices } = await listPairedDevices();
  return devices || [];
}

export async function testPrinter() {
  const cfg = getPrinterConfig();
  if (!cfg.address) throw new Error('No receipt printer selected. Pick one in POS settings.');
  return probePrinter(cfg.address);
}

async function send(bytes) {
  const cfg = getPrinterConfig();
  if (!cfg.enabled) return { skipped: 'printing disabled' };
  if (!isNative()) throw new Error('Receipt printing only works on the counter tablet.');
  if (!cfg.address) throw new Error('No receipt printer selected. Pick one in POS settings.');
  return writeToPrinter(cfg.address, bytes);
}

/**
 * Prints a card / debit sale.
 *
 * Two copies go out when the reader asked for a signature — the merchant one
 * carries the signature line and stays in the till. Everything else is one
 * copy; a customer buying a $12 decal does not need two.
 *
 * Never fires the drawer. There's no cash to put away on a card sale, and a
 * drawer that pops every time is a drawer that gets left open.
 */
export async function printSaleReceipt(payment, { emv = null, signatureRequired = false, jobDescription = '' } = {}) {
  const cfg = getPrinterConfig();
  const common = { payment, shop: cfg.shop, emv, width: cfg.width, signatureRequired, jobDescription };

  if (signatureRequired) {
    await send(buildSaleReceipt({ ...common, copy: 'merchant' }));
  }
  await send(buildSaleReceipt({ ...common, copy: 'customer' }));
  return { copies: signatureRequired ? 2 : 1 };
}

/** Cash or cheque — the only path that opens the drawer. */
export async function printCashReceipt(payment, { tenderedCents = null, method = 'CASH', jobDescription = '' } = {}) {
  const cfg = getPrinterConfig();
  return send(buildCashReceipt({
    payment, shop: cfg.shop, width: cfg.width, tenderedCents, method, jobDescription,
  }));
}

/** "No sale" — open the drawer to make change without printing anything. */
export async function openCashDrawer() {
  return send(buildDrawerKick());
}
