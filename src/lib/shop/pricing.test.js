// src/lib/shop/pricing.test.js
//
// Run with:
//   node --test src/lib/shop/pricing.test.js
//
// No test runner / framework — Node's built-in node:test handles ESM
// directly. The shop repo doesn't (yet) have vitest installed; using the
// same pattern as the API repo's lib/*.test.js avoids adding a dep just
// to cover a 4-line pricing module.

import test from 'node:test';
import assert from 'node:assert/strict';
import { apparelPrice, variantRetail } from './pricing.js';

// ─── Sub-$5 inputs are flat $10 ─────────────────────────────────────────────

test('apparelPrice: $0 → flat $10', () => {
  assert.equal(apparelPrice(0), 10);
});

test('apparelPrice: $1 → flat $10 (no longer 3× cost)', () => {
  assert.equal(apparelPrice(1), 10);
});

test('apparelPrice: $4 → flat $10', () => {
  assert.equal(apparelPrice(4), 10);
});

test('apparelPrice: $4.99 → flat $10 (just under boundary)', () => {
  assert.equal(apparelPrice(4.99), 10);
});

// ─── Boundary at $5 ─────────────────────────────────────────────────────────
// $5 falls into the cost >= $5 branch (cost * 2 = $10) — same value as the
// flat-$10 branch directly below it, so the price is continuous across the
// boundary. Worth pinning so a future "< 5" → "<= 5" typo gets caught.

test('apparelPrice: $5 → $10 (boundary, cost * 2)', () => {
  assert.equal(apparelPrice(5), 10);
});

test('apparelPrice: $5.01 → $10.02 (just over boundary)', () => {
  assert.equal(apparelPrice(5.01), 10.02);
});

// ─── $5+ inputs are cost * 2, no minimum ────────────────────────────────────

test('apparelPrice: $7.50 → $15 (no longer pinned at $15 minimum)', () => {
  assert.equal(apparelPrice(7.50), 15);
});

test('apparelPrice: $25 → $50', () => {
  assert.equal(apparelPrice(25), 50);
});

test('apparelPrice: $100 → $200', () => {
  assert.equal(apparelPrice(100), 200);
});

// ─── Null / NaN handling preserved ──────────────────────────────────────────

test('apparelPrice: null → null', () => {
  assert.equal(apparelPrice(null), null);
});

test('apparelPrice: undefined → null', () => {
  assert.equal(apparelPrice(undefined), null);
});

test('apparelPrice: NaN → null', () => {
  assert.equal(apparelPrice(NaN), null);
});

// ─── variantRetail delegates correctly ──────────────────────────────────────
// sale_price wins over price; both null → null.

test('variantRetail: prefers sale_price over price', () => {
  assert.equal(variantRetail({ price: 25, sale_price: 6 }), 12);
});

test('variantRetail: falls back to price when sale_price is null', () => {
  assert.equal(variantRetail({ price: 25, sale_price: null }), 50);
});

test('variantRetail: null variant → null', () => {
  assert.equal(variantRetail(null), null);
});
