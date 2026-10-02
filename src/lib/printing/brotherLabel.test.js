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

const data = { partNo: 'P10 <A&B>', detail: 'Shelf: B', fits: 'Fits: C <&> S1', qrText: 'q1' };

test('die-cut 29x90 is drawn sideways on a 29mm-wide page', () => {
  const g = brotherGeometry('DK-1201');
  assert.deepEqual([g.pageW, g.pageH, g.rotate, g.boxW, g.boxH], [29, 90, true, 90, 29]);
  const html = buildBrotherLabelsHtml([{ data, copies: 1 }], 'DK-1201', { q1: 'data:image/png;base64,AA' });
  assert.match(html, /@page \{ size: 29mm 90mm; margin: 0; \}/);
  assert.match(html, /translateX\(29mm\) rotate\(90deg\)/);
  assert.match(html, /Fits: C &lt;&amp;&gt; S1/);           // names are escaped
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

test('unknown roll falls back to DK-1204', () => {
  assert.equal(brotherGeometry('nope').size.id, 'DK-1204');
});

test('names fill the label; no part number; shelf only when set', () => {
  const names = ['Inline Family Chiropractic', 'Ken Jackson Construction', 'Midwest Co-op', 'Ripley Fire Dept'];
  const mk = (fitsLines, detail = '') => buildBrotherLabelsHtml([{ data: { ...data, fitsLines, detail }, copies: 1 }], 'DK-1204');
  const size = (html) => Number(html.match(/class="fits" style="font-size: ([\d.]+)mm"/)[1]);
  const four = mk(names);
  const one = mk(['Ripley Fire Department']);
  assert.ok(size(four) >= 2.6, `four names ${size(four)}`);   // was 2.2 mm before
  assert.ok(size(one) > size(four));
  assert.equal((four.match(/<div>[^<]+<\/div>/g) || []).length, 4);
  assert.doesNotMatch(four, /P10 &lt;A&amp;B&gt;/);             // part number left off
  assert.doesNotMatch(four, /class="detail"/);
  const withShelf = mk(names, 'Shelf: Rack B');
  assert.match(withShelf, /<div class="detail">Shelf: Rack B<\/div>/);
  assert.ok(size(withShelf) < size(four));                       // footer takes a little room
});

test('every roll names its Android paper size', () => {
  assert.equal(BROTHER_SIZES['DK-1201'].androidPaper, '1.1" x 3.5"');
  for (const s of Object.values(BROTHER_SIZES)) assert.match(s.androidPaper, /^[\d.]+" x [\d.]+"$/);
});

test('DK-1204 is a 17x54 die-cut label drawn sideways', () => {
  const g = brotherGeometry('DK-1204');
  assert.deepEqual([g.pageW, g.pageH, g.rotate, g.boxW, g.boxH], [17, 54, true, 54, 17]);
  assert.equal(g.size.androidPaper, '0.66" x 2.1"');
});
