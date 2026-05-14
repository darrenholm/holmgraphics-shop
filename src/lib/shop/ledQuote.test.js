// src/lib/shop/ledQuote.test.js
//
// Run with:
//   node --test src/lib/shop/ledQuote.test.js
//
// Pins the Kincardine job's numbers (P8 320x160, 2560x1440 placement,
// double-sided, $4800/m²). The prototype generated $35,389.44 with 144
// modules and 5184W max draw — those values were inspected by hand. If
// a "small refactor" of computeQuote() ever shifts them, this catches it.

import test from 'node:test';
import assert from 'node:assert/strict';
import { computeQuote, buildDescription } from './ledQuote.js';

const P8 = {
  name:           'P8 Outdoor — 320x160',
  width_mm:       320,
  height_mm:      160,
  pitch_mm:       8,
  max_watts:      36,
  control_system: 'Novastar T-30',
};

// ─── Kincardine reference quote ─────────────────────────────────────────────

test('Kincardine: P8 320x160, 2560x1440mm, double-sided, $4800/m²', () => {
  const q = computeQuote({
    module: P8, targetW: 2560, targetH: 1440,
    unit: 'mm', fitMode: 'nearest', sides: 2, rate: 4800,
  });
  assert.equal(q.modsWide, 8);
  assert.equal(q.modsTall, 9);
  assert.equal(q.faceWmm,  2560);
  assert.equal(q.faceHmm,  1440);
  assert.equal(q.totalModules, 144);
  assert.equal(q.modulesPerSide, 72);
  // 320/8 = 40 px wide per module, 160/8 = 20 px tall per module
  assert.equal(q.pxWide, 320);
  assert.equal(q.pxTall, 180);
  // Area: 2.56 * 1.44 = 3.6864 m² per side, 7.3728 total
  assert.equal(q.areaPerSide, 3.6864);
  assert.equal(q.totalArea,   7.3728);
  // 144 modules × 36W = 5184W max
  assert.equal(q.maxW, 5184);
  assert.equal(q.ampsAt120, 43.2);
  assert.equal(q.ampsAt240, 21.6);
  // 7.3728 m² × $4800 = $35,389.44
  assert.equal(q.total, 35389.44);
  // Exact fit → zero delta vs requested opening
  assert.equal(q.dWmm, 0);
  assert.equal(q.dHmm, 0);
});

// ─── Inch input is converted to mm before fit math ──────────────────────────

test('inches input: 100.79" × 56.69" ≈ 2560 × 1440 mm', () => {
  const q = computeQuote({
    module: P8, targetW: 100.79, targetH: 56.69,
    unit: 'in', fitMode: 'nearest', sides: 2, rate: 4800,
  });
  // Same array as the mm test
  assert.equal(q.modsWide, 8);
  assert.equal(q.modsTall, 9);
});

// ─── Single-sided halves modules / area / power / price ─────────────────────

test('single-sided halves total area and power', () => {
  const dual = computeQuote({
    module: P8, targetW: 2560, targetH: 1440,
    unit: 'mm', fitMode: 'nearest', sides: 2, rate: 4800,
  });
  const solo = computeQuote({
    module: P8, targetW: 2560, targetH: 1440,
    unit: 'mm', fitMode: 'nearest', sides: 1, rate: 4800,
  });
  assert.equal(solo.totalArea,    dual.totalArea    / 2);
  assert.equal(solo.totalModules, dual.totalModules / 2);
  assert.equal(solo.maxW,         dual.maxW         / 2);
  assert.equal(solo.total,        dual.total        / 2);
  // Per-side numbers stay the same
  assert.equal(solo.areaPerSide,    dual.areaPerSide);
  assert.equal(solo.modulesPerSide, dual.modulesPerSide);
});

// ─── Round-down keeps the sign within the opening ──────────────────────────

test("fitMode 'down' rounds to fewer modules when not an exact fit", () => {
  // 2500mm wide opening, 320mm modules: nearest = 8 (2560), down = 7 (2240).
  const nearest = computeQuote({
    module: P8, targetW: 2500, targetH: 1440,
    unit: 'mm', fitMode: 'nearest', sides: 2, rate: 4800,
  });
  const down = computeQuote({
    module: P8, targetW: 2500, targetH: 1440,
    unit: 'mm', fitMode: 'down', sides: 2, rate: 4800,
  });
  assert.equal(nearest.modsWide, 8);
  assert.equal(down.modsWide,    7);
  assert.equal(nearest.faceWmm, 2560);  // 60mm wider than opening
  assert.equal(down.faceWmm,    2240);  // 260mm narrower than opening
  assert.equal(nearest.dWmm,  60);
  assert.equal(down.dWmm,    -260);
});

// ─── Fractional pitch — P3.91 — should still produce integer pixel counts ───

test('fractional pitch (P3.91) produces integer pixel counts', () => {
  const P391 = {
    name: 'P3.91 Indoor — 500x500',
    width_mm: 500, height_mm: 500, pitch_mm: 3.91, max_watts: 80,
    control_system: null,
  };
  const q = computeQuote({
    module: P391, targetW: 2000, targetH: 1000,
    unit: 'mm', fitMode: 'nearest', sides: 1, rate: 6000,
  });
  // round(500 / 3.91) = round(127.87) = 128 px/module
  assert.equal(q.pxWide, 128 * q.modsWide);
  assert.equal(q.pxTall, 128 * q.modsTall);
  // Integer pixel counts always
  assert.equal(Number.isInteger(q.pxWide), true);
  assert.equal(Number.isInteger(q.pxTall), true);
});

// ─── Guard clauses ──────────────────────────────────────────────────────────

test('returns null when module is missing', () => {
  assert.equal(computeQuote({ module: null, targetW: 100, targetH: 100 }), null);
});

test('returns null when target dimensions are blank or zero', () => {
  assert.equal(computeQuote({ module: P8, targetW: '', targetH: 100 }), null);
  assert.equal(computeQuote({ module: P8, targetW: 0,  targetH: 100 }), null);
  assert.equal(computeQuote({ module: P8, targetW: -1, targetH: 100 }), null);
});

// ─── Description string — canonical format pinned ───────────────────────────

test('buildDescription matches the prototype format (Kincardine)', () => {
  const q = computeQuote({
    module: P8, targetW: 2560, targetH: 1440,
    unit: 'mm', fitMode: 'nearest', sides: 2, rate: 4800,
  });
  const desc = buildDescription(q, P8, 2);
  assert.equal(
    desc,
    'LED Display — 2,560mm × 1,440mm (100.79" × 56.69"), '
    + '8×9 array of P8 Outdoor — 320x160 modules (320×160mm, P-8), '
    + 'double-sided, 7.3728 m², 320×180px per side, '
    + 'Novastar T-30 control system. '
    + 'Max power draw 5,184W (43.2A @ 120V).'
  );
});

test('buildDescription omits control system when not specified', () => {
  const mod = { ...P8, control_system: null };
  const q = computeQuote({
    module: mod, targetW: 2560, targetH: 1440,
    unit: 'mm', fitMode: 'nearest', sides: 1, rate: 4800,
  });
  const desc = buildDescription(q, mod, 1);
  // No " control system" substring
  assert.equal(desc.includes('control system'), false);
  assert.equal(desc.includes('single-sided'), true);
});
