// src/lib/fleet/offline-store.test.js
//
// Run with:
//   node --test src/lib/fleet/offline-store.test.js
//
// Covers the queue's retry classification. This is a small function guarding
// an expensive mistake in both directions:
//
//   * a permanent rejection treated as retryable churns forever while the UI
//     shows "pending" — the report never lands and nobody notices
//   * a transient failure treated as permanent parks a signed legal record
//     as `failed` because the yard had one bad minute
//
// The IndexedDB paths are not covered here — Node has no indexedDB and the
// shop repo has no test runner that shims one. They are straightforward
// put/get/delete; this is the logic worth pinning.

import test from 'node:test';
import assert from 'node:assert/strict';
import { classifySyncFailure, newClientUuid } from './offline-store.js';

const withStatus = (status) => Object.assign(new Error('boom'), { status });

// ─── The one that matters ───────────────────────────────────────────────────

test('a request that never got an answer is retried, not failed', () => {
  // fetch() rejects with a TypeError carrying no status when the network is
  // gone. That is the entire reason the queue exists; classifying it as a
  // server verdict would discard checks captured in a yard.
  assert.equal(classifySyncFailure(new TypeError('Failed to fetch')), 'retry');
  assert.equal(classifySyncFailure(new Error('network error')), 'retry');
  assert.equal(classifySyncFailure(undefined), 'retry');
  assert.equal(classifySyncFailure(null), 'retry');
});

test('a validation rejection is permanent — retrying it forever would hide it', () => {
  // These are the codes the sync endpoint returns for a report it will never
  // accept: bad clock, missing declaration, defect not on the schedule.
  for (const status of [400, 403, 404, 409, 422]) {
    assert.equal(classifySyncFailure(withStatus(status)), 'permanent', `status ${status}`);
  }
});

test('a server fault is retried — it is our bug, not the report\'s', () => {
  for (const status of [500, 502, 503, 504]) {
    assert.equal(classifySyncFailure(withStatus(status)), 'retry', `status ${status}`);
  }
});

test('408 and 429 are the server asking us to come back, not refusing', () => {
  assert.equal(classifySyncFailure(withStatus(408)), 'retry');
  assert.equal(classifySyncFailure(withStatus(429)), 'retry');
});

test('401 is permanent so the queue stops, since the client redirects to login', () => {
  // The API client clears the token and navigates away on a 401. Retrying in
  // a loop behind that would spin against an endpoint that cannot succeed.
  assert.equal(classifySyncFailure(withStatus(401)), 'permanent');
});

test('a non-numeric status is not mistaken for a verdict', () => {
  assert.equal(classifySyncFailure({ status: '400' }), 'retry');
  assert.equal(classifySyncFailure({ status: NaN }), 'retry');
});

// ─── idempotency keys ───────────────────────────────────────────────────────

test('client uuids are unique and well-formed', () => {
  const seen = new Set();
  for (let i = 0; i < 500; i++) {
    const id = newClientUuid();
    assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      `not a v4 uuid: ${id}`);
    assert.ok(!seen.has(id), `duplicate uuid: ${id}`);
    seen.add(id);
  }
});

test('the uuid matches what the sync endpoint accepts', () => {
  // routes/fleet-inspections.js validates /^[0-9a-fA-F-]{16,64}$/ before it
  // will touch the write path. A generator drifting out of that shape would
  // reject every queued check with a 400 — i.e. permanently.
  assert.match(newClientUuid(), /^[0-9a-fA-F-]{16,64}$/);
});
