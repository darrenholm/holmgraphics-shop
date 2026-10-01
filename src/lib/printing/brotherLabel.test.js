// src/lib/printing/brotherLabel.test.js
//
// Run with:
//   node --test src/lib/printing/brotherLabel.test.js
//
// Pins the Brother page sizes and that every copy becomes its own page.
// The actual print dialog needs a browser.

import test from 'node:test';
import assert from 'node:assert/strict';
import { BROTHER_SIZES, brotherGeometry, buildBrotherLabelsHtml } from './brotherLabel.js';

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

test('signs are the big text; part number is a small footer', () => {
  const one = buildBrotherLabelsHtml([{ data: { ...data, fitsLines: ['Ripley Fire Department – Hall'] }, copies: 1 }], 'DK-1201');
  const four = buildBrotherLabelsHtml([{ data: { ...data, fitsLines: [
    'Inline Family Chiropractic – P8 (Job 3300)', 'Mount Forest Midwest Coop – Front',
    'Ripley Fire Department – Hall', 'Ken Jackson Construction – P10 320x160 (Job 3236)',
  ] }, copies: 1 }], 'DK-1201');
  const size = (html) => Number(html.match(/class="fits" style="font-size: ([\d.]+)mm"/)[1]);
  assert.ok(size(one) >= 3.5, `one sign ${size(one)}`);      // big on a 29 mm label
  assert.ok(size(four) < size(one));                          // more signs → smaller, still fits
  assert.ok(size(four) >= 2.46, `four signs ${size(four)}`);  // never below the footer text
  assert.equal((four.match(/<div>[^<]*–[^<]*<\/div>/g) || []).length, 4);
  assert.match(one, /<div class="part">P10 &lt;A&amp;B&gt;<\/div>/);
  assert.match(one, /\.part, \.detail \{ font-size: 2\.47mm/);
});

test('every roll names its Android paper size', () => {
  assert.equal(BROTHER_SIZES['DK-1201'].androidPaper, '1.1" x 3.5"');
  for (const s of Object.values(BROTHER_SIZES)) assert.match(s.androidPaper, /^[\d.]+" x [\d.]+"$/);
});
