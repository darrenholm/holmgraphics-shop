// src/lib/printing/brotherLabel.test.js
//
// Run with:
//   node --test src/lib/printing/brotherLabel.test.js
//
// Pins the Brother page sizes and that every copy becomes its own page.
// The actual print dialog needs a browser.

import test from 'node:test';
import assert from 'node:assert/strict';
import { brotherGeometry, buildBrotherLabelsHtml } from './brotherLabel.js';

const data = { partNo: 'P10 <A&B>', detail: 'P10 outdoor', fits: 'Fits: C – S1', qrText: 'q1' };

test('die-cut 29x90 is drawn sideways on a 29mm-wide page', () => {
  const g = brotherGeometry('DK-1201');
  assert.deepEqual([g.pageW, g.pageH, g.rotate, g.boxW, g.boxH], [29, 90, true, 90, 29]);
  const html = buildBrotherLabelsHtml([{ data, copies: 1 }], 'DK-1201', { q1: 'data:image/png;base64,AA' });
  assert.match(html, /@page \{ size: 29mm 90mm; margin: 0; \}/);
  assert.match(html, /translateX\(29mm\) rotate\(90deg\)/);
  assert.match(html, /P10 &lt;A&amp;B&gt;/);
  assert.match(html, /<img class="qr" src="data:image\/png;base64,AA"/);
});

test('62mm continuous cut at 30mm is not rotated', () => {
  const g = brotherGeometry('DK-2205');
  assert.equal(g.rotate, false);
  const html = buildBrotherLabelsHtml([{ data, copies: 1 }], 'DK-2205');
  assert.match(html, /size: 62mm 30mm/);
  assert.doesNotMatch(html, /rotate\(90deg\)/);
});

test('one page per copy, zero copies skipped', () => {
  const html = buildBrotherLabelsHtml(
    [{ data, copies: 3 }, { data: { ...data, qrText: 'q2' }, copies: 0 }, { data, copies: 2 }],
    'DK-1201'
  );
  assert.equal(html.match(/<div class="page">/g).length, 5);
});

test('unknown roll falls back to DK-1201', () => {
  assert.equal(brotherGeometry('nope').size.id, 'DK-1201');
});
