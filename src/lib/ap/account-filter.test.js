// src/lib/ap/account-filter.test.js
//
// Run with:
//   node --test src/lib/ap/account-filter.test.js
//
// The case that prompted this: typing "shipping" found nothing, because the
// native <select> matched only from the first character and the account is
// called "Cost of Goods Sold:Shipping".

import test from 'node:test';
import assert from 'node:assert/strict';
import { filterAccounts, scoreAccount, leafOf } from './account-filter.js';

const CHART = [
  { id: '1', name: 'Advertising' },
  { id: '2', name: 'Cost of Goods Sold:Shipping' },
  { id: '3', name: 'Cost of Goods Sold:Materials' },
  { id: '4', name: 'Shipping Supplies Expense' },
  { id: '5', name: 'Freight & Shipping' },
  { id: '6', name: 'Office Expenses' },
  { id: '7', name: 'Uncategorized Expense' },
];

const names = (rows) => rows.map((r) => r.name);

// ─── leafOf ──────────────────────────────────────────────────────────────

test('leafOf: strips the parent path', () => {
  assert.equal(leafOf('Cost of Goods Sold:Shipping'), 'shipping');
  assert.equal(leafOf('Advertising'), 'advertising');
  assert.equal(leafOf('A:B:C'), 'c');
  assert.equal(leafOf(''), '');
  assert.equal(leafOf(null), '');
});

// ─── The actual complaint ────────────────────────────────────────────────

test('finds a sub-account by its own name, not the parent prefix', () => {
  const found = names(filterAccounts(CHART, 'shipping'));
  assert.ok(found.includes('Cost of Goods Sold:Shipping'),
    'typing the leaf name must find the account');
});

test('the account actually named "Shipping" ranks first', () => {
  const found = names(filterAccounts(CHART, 'shipping'));
  assert.equal(found[0], 'Cost of Goods Sold:Shipping');
  // The other two still appear — they are plausible answers, just less likely.
  assert.ok(found.includes('Shipping Supplies Expense'));
  assert.ok(found.includes('Freight & Shipping'));
});

test('matches mid-word and mid-name, not just from the start', () => {
  assert.ok(names(filterAccounts(CHART, 'freight')).includes('Freight & Shipping'));
  assert.ok(names(filterAccounts(CHART, 'supplies')).includes('Shipping Supplies Expense'));
  assert.ok(names(filterAccounts(CHART, 'categor')).includes('Uncategorized Expense'));
});

test('search is case-insensitive and ignores surrounding space', () => {
  assert.deepEqual(names(filterAccounts(CHART, 'SHIPPING')), names(filterAccounts(CHART, 'shipping')));
  assert.deepEqual(names(filterAccounts(CHART, '  shipping  ')), names(filterAccounts(CHART, 'shipping')));
});

// A parent-only hit is still offered, but below every leaf match — someone
// typing "goods" probably wants to see what is under it.
test('a parent-segment match ranks below every leaf match', () => {
  const found = names(filterAccounts(CHART, 'cost of goods'));
  assert.deepEqual(found, ['Cost of Goods Sold:Materials', 'Cost of Goods Sold:Shipping']);
});

test('an empty query lists everything', () => {
  assert.equal(filterAccounts(CHART, '').length, CHART.length);
  assert.equal(filterAccounts(CHART, '   ').length, CHART.length);
  assert.equal(filterAccounts(CHART, null).length, CHART.length);
});

test('no match returns empty rather than everything', () => {
  assert.deepEqual(filterAccounts(CHART, 'zzzz'), []);
});

test('handles an empty or missing chart of accounts', () => {
  assert.deepEqual(filterAccounts([], 'shipping'), []);
  assert.deepEqual(filterAccounts(null, 'shipping'), []);
});

// ─── scoreAccount ────────────────────────────────────────────────────────

test('scoreAccount: exact leaf beats prefix beats substring beats parent-only', () => {
  assert.equal(scoreAccount('Cost of Goods Sold:Shipping', 'shipping'), 0);
  assert.equal(scoreAccount('Shipping Supplies Expense',   'shipping'), 1);
  assert.equal(scoreAccount('Freight & Shipping',          'shipping'), 2);
  assert.equal(scoreAccount('Shipping:Courier',            'courier'),  0);
  assert.equal(scoreAccount('Shipping:Courier',            'shipping'), 3);
  assert.equal(scoreAccount('Advertising',                 'shipping'), -1);
});
