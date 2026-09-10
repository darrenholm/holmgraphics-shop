// src/lib/pos/native.js
//
// Bridge to HgPos — the small native plugin in
// android/app/src/main/java/ca/holmgraphics/shop/HgPosPlugin.java.
//
// Two jobs that no maintained Capacitor 8 plugin covers:
//
//   1. Runtime ACCESS_FINE_LOCATION + a "are location services actually on"
//      check. The Stripe Terminal SDK refuses to take payments if it can't
//      place the device, and @capgo/capacitor-stripe-terminal exposes no
//      permission API at all — discoverReaders just rejects with a raw
//      permission string.
//   2. Raw byte writes to a Bluetooth CLASSIC (SPP) printer. The counter
//      printer is SPP, not BLE, so @capacitor-community/bluetooth-le cannot
//      see it; the two SPP plugins on npm peer-depend on Capacitor 6/7 and
//      this app is on 8.
//
// Everything here is a no-op that reports "unavailable" in a browser, so the
// same build still serves the storefront and the office dashboard.

import { Capacitor, registerPlugin } from '@capacitor/core';

const HgPos = registerPlugin('HgPos');

export function isNative() {
  return Capacitor.isNativePlatform();
}

function unavailable(what) {
  const err = new Error(`${what} is only available on the counter tablet.`);
  err.code = 'NOT_NATIVE';
  return err;
}

// ─── Location ────────────────────────────────────────────────────────────────

// Prompts if it hasn't been granted yet. Returns { granted }.
export async function ensureLocationPermission() {
  if (!isNative()) throw unavailable('Location permission');
  return HgPos.ensureLocationPermission();
}

// Permission granted is NOT enough — the SDK also needs the device's location
// services switched on, and a tablet with the toggle off fails discovery with
// an error that reads like a Bluetooth fault. Returns { enabled }.
export async function locationServicesEnabled() {
  if (!isNative()) return { enabled: false };
  return HgPos.locationServicesEnabled();
}

// Opens Android's location settings screen so staff can fix it without
// hunting through Settings.
export async function openLocationSettings() {
  if (!isNative()) throw unavailable('Location settings');
  return HgPos.openLocationSettings();
}

// ─── Screen ──────────────────────────────────────────────────────────────────

// Holds the tablet's screen on while a reader is connected. The WisePad has no
// sleep setting of its own — it stays awake because something is holding a
// connection to it — so keeping the screen up is what keeps the reader up.
// No-op off the tablet.
export async function keepAwake(on) {
  if (!isNative()) return { on: false };
  try { return await HgPos.keepAwake({ on: !!on }); } catch { return { on: false }; }
}

// ─── In-person refunds ──────────────────────────────────────────────────────────────────

// An Interac refund cannot be issued from the Stripe API or the Dashboard at
// all — the network wants the original card back at the reader. The SDK can
// do it, but @capgo/capacitor-stripe-terminal never exposed the calls, so
// HgPos bridges them against the same Terminal singleton that plugin set up.
//
// Two steps on purpose, like a sale: collect waits for the card, confirm
// moves the money. Nothing is refunded until confirmRefund resolves.

// Waits for the customer to present the original card. Resolves once the card
// is read; rejects if they walk away or staff cancel.
export async function collectRefund({ chargeId, amountCents, currency = 'cad' }) {
  if (!isNative()) throw unavailable('Refunds at the reader');
  return HgPos.collectRefund({ chargeId, amountCents, currency });
}

// Actually issues it. Returns the Stripe Refund.
export async function confirmRefund() {
  if (!isNative()) throw unavailable('Refunds at the reader');
  return HgPos.confirmRefund();
}

// Staff backed out, or the customer walked, before the card was presented.
export async function cancelCollectRefund() {
  if (!isNative()) return {};
  try { return await HgPos.cancelCollectRefund(); } catch { return {}; }
}

// ─── Bluetooth Classic (SPP) printer ─────────────────────────────────────────

// Devices already bonded in Android's Bluetooth settings. The printer is
// paired by hand once; the reader deliberately is NOT (see terminal.js).
export async function listPairedDevices() {
  if (!isNative()) return { devices: [] };
  return HgPos.listPairedDevices();
}

// Writes raw bytes to the SPP device. `bytes` is a Uint8Array; the bridge
// takes base64 because Capacitor's JSON bridge mangles binary otherwise.
export async function writeToPrinter(address, bytes) {
  if (!isNative()) throw unavailable('Receipt printing');
  return HgPos.printRaw({ address, data: base64FromBytes(bytes) });
}

// Round-trips a connect/disconnect without printing, so the settings screen
// can prove the printer is reachable before anyone needs a receipt.
export async function probePrinter(address) {
  if (!isNative()) throw unavailable('Receipt printing');
  return HgPos.probePrinter({ address });
}

function base64FromBytes(bytes) {
  let binary = '';
  const chunk = 0x8000;   // avoid blowing the argument limit on long receipts
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export { HgPos };
