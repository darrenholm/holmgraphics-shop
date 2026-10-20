// src/lib/printing/moduleLabel.test.js
//
// Run with:
//   node --test src/lib/printing/moduleLabel.test.js
//
// Pins what goes on an LED module shelf label. The XML itself needs a
// browser (QR is drawn on a canvas), so only the text is checked here.

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildModuleLabelData } from './dymoLabel.js';

const origin = 'https://shop.holmgraphics.ca';

test('part number, description, shelf and signs', () => {
  const d = buildModuleLabelData({
    id: 7,
    module_id_no: 'P10-2024A',
    description: 'P10 outdoor 320x160',
    shelf_location: 'Rack B / 3',
    signs: [
      { id: 1, sign_name: 'Main St', client_name: 'Town of Kincardine' },
      { id: 2, sign_name: null, client_name: null },
    ],
  }, { origin });
  assert.equal(d.partNo, 'P10-2024A');
  assert.equal(d.detail, 'Shelf: Rack B / 3');            // no board spec on the label
  assert.equal(d.fits, 'Fits: Town of Kincardine – Main St, Sign #2');
  assert.deepEqual(d.fitsLines, ['Town of Kincardine – Main St', 'Sign #2']);
  assert.equal(d.qrText, 'https://shop.holmgraphics.ca/modules/7');
});

test('specs stripped from sign names; one line per sign, summarised past four', () => {
  const signs = [1, 2, 3, 4].map((i) => ({ id: i, sign_name: `P8 (Job ${i})`, client_name: `C${i}` }));
  signs.push({ id: 5, sign_name: 'P8 (Job 5)', client_name: 'C1' });   // same line twice → once
  signs.push({ id: 6, sign_name: 'Wiarton P6 1346x940 (Job 4965)', client_name: 'C5', location: 'Wiarton' });
  const d = buildModuleLabelData({ id: 1, module_id_no: 'X', signs }, { origin });
  assert.equal(d.fits, 'Fits: C1, C2, C3 +2 more');
  assert.deepEqual(d.fitsLines, ['C1', 'C2', 'C3', '+2 more']);
});

test('face of the sign shows on the label', () => {
  const d = buildModuleLabelData({ id: 2, module_id_no: 'X', signs: [
    { id: 120, sign_name: 'Mount Forest P5 North Face', client_name: 'Midwest Co-op', location: 'Mount Forest' },
    { id: 55, sign_name: 'Hanover P8 (Job 7373)', client_name: 'Midwest Co-op', location: 'Hanover' },
  ] }, { origin });
  assert.deepEqual(d.fitsLines, ['Midwest Co-op – Mount Forest North Face', 'Midwest Co-op – Hanover']);
});

test('unlinked module with no extras', () => {
  const d = buildModuleLabelData({ id: 3, module_id_no: null }, { origin });
  assert.equal(d.partNo, 'Module #3');
  assert.equal(d.detail, '');
  assert.equal(d.fits, 'Fits: (no sign linked)');
  assert.deepEqual(d.fitsLines, ['(no sign linked)']);
});
