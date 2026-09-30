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
  assert.equal(d.detail, 'P10 outdoor 320x160 · Shelf: Rack B / 3');
  assert.equal(d.fits, 'Fits: Town of Kincardine – Main St, Sign #2');
  assert.equal(d.qrText, 'https://shop.holmgraphics.ca/modules/7');
});

test('more than three signs are summarised', () => {
  const signs = [1, 2, 3, 4, 5].map((i) => ({ id: i, sign_name: `S${i}`, client_name: 'C' }));
  const d = buildModuleLabelData({ id: 1, module_id_no: 'X', signs }, { origin });
  assert.equal(d.fits, 'Fits: C – S1, C – S2, C – S3 +2 more');
});

test('unlinked module with no extras', () => {
  const d = buildModuleLabelData({ id: 3, module_id_no: null }, { origin });
  assert.equal(d.partNo, 'Module #3');
  assert.equal(d.detail, '');
  assert.equal(d.fits, 'Fits: (no sign linked)');
});
