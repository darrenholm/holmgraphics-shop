// src/lib/fleet/offline-store.js
//
// Offline storage for daily inspections (build spec §6). IndexedDB rather
// than localStorage because the schedule bundle plus a queued check with
// notes runs past what localStorage is comfortable holding, and because
// losing a completed inspection to a quota error is not an acceptable
// failure mode.
//
// Two stores:
//   bundle  one record. Schedules + items, the units this driver can check,
//           and the last signed report per unit — the document the driver is
//           legally required to be carrying.
//   queue   completed checks captured with no signal, waiting to sync.
//
// The queue is the part that needs care. A completed circle check is a legal
// record the driver has already signed; dropping it because the POST failed
// would be the worst bug in this feature. So:
//
//   * every entry gets a client_uuid at capture time, not at sync time, so a
//     retry after a dropped response cannot create a second report
//   * a network or 5xx failure leaves the entry queued to try again
//   * a 4xx failure marks the entry `failed` and STOPS retrying — a report
//     the server has refused will be refused identically forever, and a
//     silent infinite retry looks exactly like a working sync
//   * nothing is deleted until the server has confirmed it holds the record

const DB_NAME = 'hg_fleet_inspections';
const DB_VERSION = 1;
const STORE_BUNDLE = 'bundle';
const STORE_QUEUE = 'queue';

function supported() {
  return typeof indexedDB !== 'undefined';
}

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_BUNDLE)) {
        db.createObjectStore(STORE_BUNDLE, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(STORE_QUEUE)) {
        db.createObjectStore(STORE_QUEUE, { keyPath: 'client_uuid' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(db, storeName, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(storeName, mode);
    const store = t.objectStore(storeName);
    let result;
    try {
      result = fn(store);
    } catch (e) {
      reject(e);
      return;
    }
    t.oncomplete = () => resolve(result && result.result !== undefined ? result.result : result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

// ─── bundle ────────────────────────────────────────────────────────────

export async function saveBundle(bundle) {
  if (!supported()) return false;
  try {
    const db = await openDb();
    await tx(db, STORE_BUNDLE, 'readwrite', (s) =>
      s.put({ key: 'current', saved_at: Date.now(), bundle })
    );
    db.close();
    return true;
  } catch {
    return false;
  }
}

export async function loadBundle() {
  if (!supported()) return null;
  try {
    const db = await openDb();
    const row = await tx(db, STORE_BUNDLE, 'readonly', (s) => s.get('current'));
    db.close();
    if (!row) return null;
    return { ...row.bundle, _saved_at: row.saved_at };
  } catch {
    return null;
  }
}

// ─── queue ─────────────────────────────────────────────────────────────

// Returns the stored entry. `payload` is exactly what POST
// /fleet/inspections/sync expects, so a flush is a straight replay.
export async function queueInspection(payload) {
  if (!supported()) throw new Error('This device cannot store the check offline.');
  const db = await openDb();
  const entry = {
    client_uuid: payload.client_uuid,
    payload,
    queued_at: Date.now(),
    attempts: 0,
    status: 'pending',
    error: null,
  };
  await tx(db, STORE_QUEUE, 'readwrite', (s) => s.put(entry));
  db.close();
  return entry;
}

export async function listQueued() {
  if (!supported()) return [];
  try {
    const db = await openDb();
    const rows = await tx(db, STORE_QUEUE, 'readonly', (s) => s.getAll());
    db.close();
    return rows || [];
  } catch {
    return [];
  }
}

async function putEntry(entry) {
  const db = await openDb();
  await tx(db, STORE_QUEUE, 'readwrite', (s) => s.put(entry));
  db.close();
}

async function dropEntry(clientUuid) {
  const db = await openDb();
  await tx(db, STORE_QUEUE, 'readwrite', (s) => s.delete(clientUuid));
  db.close();
}

// Discards an entry the server has permanently refused. Separate from
// dropEntry so the caller has to mean it — this is the only path that
// destroys a signed check, and it exists because leaving a permanently
// rejected report in the queue makes every future flush look broken.
export async function discardQueued(clientUuid) {
  if (!supported()) return;
  await dropEntry(clientUuid);
}

// Is this failure worth retrying, or has the server made up its mind?
//
// Getting this backwards is the expensive bug in either direction. Treat a
// permanent rejection as retryable and the queue churns forever while the
// driver's UI insists a sync is "pending" — the report never lands and
// nobody finds out. Treat a transient failure as permanent and a signed
// legal record is parked as `failed` because the yard had one bad minute.
//
// So: only a 4xx counts as the server deciding. 408 and 429 are the server
// asking us to come back, and a missing status means the request never got
// an answer at all — that is a dead network, not a verdict.
export function classifySyncFailure(error) {
  const status = error?.status;
  if (typeof status !== 'number') return 'retry';
  if (status === 408 || status === 429) return 'retry';
  if (status >= 400 && status < 500) return 'permanent';
  return 'retry';
}

// Replays every pending entry. `syncFn(payload)` should POST to
// /fleet/inspections/sync and throw an error carrying `.status` on failure.
//
// Returns { synced, failed, pending } — never throws, because this runs from
// an `online` event handler where a throw goes nowhere useful.
export async function flushQueue(syncFn) {
  const out = { synced: 0, failed: 0, pending: 0, results: [] };
  if (!supported()) return out;

  const entries = await listQueued();
  for (const entry of entries) {
    if (entry.status === 'failed') { out.failed++; continue; }
    try {
      const res = await syncFn(entry.payload);
      // A duplicate is a success: the server already holds this record, which
      // is the outcome the queue exists to guarantee.
      await dropEntry(entry.client_uuid);
      out.synced++;
      out.results.push({ client_uuid: entry.client_uuid, inspection: res?.inspection || null });
    } catch (e) {
      if (classifySyncFailure(e) === 'permanent') {
        await putEntry({
          ...entry,
          attempts: entry.attempts + 1,
          status: 'failed',
          error: e.message || 'The server refused this report.',
        });
        out.failed++;
      } else {
        await putEntry({ ...entry, attempts: entry.attempts + 1, error: e.message || 'Sync failed.' });
        out.pending++;
      }
    }
  }
  return out;
}

// ─── reading the carried report offline ────────────────────────────────

export async function cachedReportForVehicle(vehicleId) {
  const bundle = await loadBundle();
  if (!bundle?.last_reports) return null;
  return bundle.last_reports.find((r) => r.vehicle_id === vehicleId) || null;
}

export async function cachedReportById(id) {
  const bundle = await loadBundle();
  if (!bundle?.last_reports) return null;
  return bundle.last_reports.find((r) => String(r.id) === String(id)) || null;
}

export function newClientUuid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  // Older WebViews in the Capacitor build may not have randomUUID.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}
