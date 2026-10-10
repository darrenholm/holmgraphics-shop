// src/lib/shop/factoryImport.test.js
//
// Run with:
//   node --test src/lib/shop/factoryImport.test.js
//
// Rows copied from the factory's "Order list-Holm Graphics" sheet (Oct 2026):
// header, a two-row order, the shared-label pair (Ripley / Inline share a
// shipment, two orders share …0187), an order whose label is on its spare
// row, an Excel serial date, and the Total row that ends the list.

import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFactoryRows, planImport, partKey } from './factoryImport.js';

const H = ['Order date', 'PI number', 'Client', 'Cabinet size', 'Ccabinet quantity', 'Unit',
  'Sign name', 'Item Name', 'Description', 'Moudle lable'];
const rows = [
  H,
  ['2026-06-30', 'UNK290526234LC', 'Holm Graphics', 'IF19B-Outdoor-2240x800-P8', 1, 'PCS', 'the Riply fire Dept screen', 'x', 'y', 'UNKP8(5)2607A1J2628800199'],
  ['', '', '', 'Spare-Outdoor-P8-5S', 10, 'PCS', '', 'Spare moudles', '', ''],
  ['2026-06-30', 'UNK260626288LC', 'Holm Graphics', 'IF19B-Outdoor-1280x480-P8', 2, 'PCS', '', 'Outdoor P8', '', 'UNKP8(5)2607A1J2628800187'],
  ['', '', '', 'Spare-Outdoor-P8-5S', 10, 'PCS', '', 'Spare moudles', '', ''],
  ['2026-06-30', 'UNK240626280LC', 'Holm Graphics', 'Spare-Outdoor-P8-5S', 120, 'PCS', 'Inline Family Chiropractic sign', 'x', '', 'UNKP8(5)2607A1J2628800187'],
  ['2024-06-07', 'UNK070624280HZ', 'Holm Graphics', 'IF19B-OD-960x1120-P8', 4, '', '', 'Outdoor P8', '', ''],
  ['', '', '', 'Spare-Outdoor-P8-5S', 12, 'PCS', '', 'Spare moudles', '', 'UNKP8(5)2406A1J090400096'],
  [45409, 'UNK270424196HZ', 'Holm Graphics', 'IF19B-Outdoor-960x1120-P8', 4, 'PCS', '', 'Outdoor P8 front open screen single faced display/Cuneos Interiors', '', 'UNKP8(5)2404A1J085200156'],
  ['Total', '', '', '', 8094],
  ['2099-01-01', 'AFTER-TOTAL', '', 'x', 1, '', '', '', '', 'IGNORED'],
];

test('one part per module label, orders sharing a label merged', () => {
  const parts = parseFactoryRows(rows);
  assert.deepEqual(parts.map((p) => p.module_id_no), [
    'UNKP8(5)2607A1J2628800199', 'UNKP8(5)2607A1J2628800187',
    'UNKP8(5)2406A1J090400096', 'UNKP8(5)2404A1J085200156',
  ]);
  const p187 = parts[1];
  assert.equal(p187.orders.length, 2);
  assert.equal(p187.description, 'Outdoor-P8-5S');
  assert.match(p187.notes, /PI UNK240626280LC · Inline Family Chiropractic sign · 120 loose\/spare modules shipped/);
  assert.match(parts[0].notes, /^Factory order 2026-06-30 · PI UNK290526234LC · the Riply fire Dept screen · IF19B-Outdoor-2240x800-P8 · 10 loose/);
});

test('label on a continuation row, Excel serial dates, sign name after a slash', () => {
  const parts = parseFactoryRows(rows);
  assert.match(parts[2].notes, /PI UNK070624280HZ · IF19B-OD-960x1120-P8 ×4 · 12 loose/);
  assert.match(parts[3].notes, /^Factory order 2024-04-27 · PI UNK270424196HZ · Cuneos Interiors/);
});

test('import plan: new, add missing orders to existing, leave complete ones', () => {
  const parts = parseFactoryRows(rows);
  const plan = planImport(parts, [
    { id: 1, module_id_no: 'unkp8{5}2607a1j2628800199', description: '', notes: null },
    { id: 2, module_id_no: 'UNKP8(5)2607A1J2628800187', description: 'mine', notes: 'Factory order … PI UNK260626288LC …' },
    { id: 3, module_id_no: 'UNKP8(5)2406A1J090400096', notes: 'PI UNK070624280HZ' },
  ]);
  assert.deepEqual(plan.map((p) => p.action), ['update', 'update', 'unchanged', 'new']);
  assert.equal(plan[0].patch.description, 'Outdoor-P8-5S');            // blank description filled
  assert.equal(plan[1].patch.description, undefined);                 // staff's own description kept
  assert.match(plan[1].patch.notes, /^Factory order … PI UNK260626288LC …\nFactory order 2026-06-30 · PI UNK240626280LC/);
  assert.equal(partKey(' a{1} b '), 'A(1)B');
});

test('a sheet that is not the factory list is refused', () => {
  assert.throws(() => parseFactoryRows([['Name', 'Qty'], ['x', 1]]), /PI number/);
});
