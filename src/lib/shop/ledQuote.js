// src/lib/shop/ledQuote.js
//
// LED Sign Quoting math + description-string builder. Pure functions —
// no DOM, no storage, no side effects. Called from /admin/led-quote and
// covered by ledQuote.test.js (the Kincardine P8 320x160 numbers are
// pinned there so future "small refactor" can't silently shift a quote).
//
// All internal math is in millimetres. The single `unit: 'in' | 'mm'`
// flag on computeQuote() controls how the *target* dimensions are
// interpreted. Module dims always come in as mm because that's how
// led_modules stores them.

export const MM_PER_INCH = 25.4;

export const round = (n, d = 2) => {
  const f = Math.pow(10, d);
  return Math.round((n + Number.EPSILON) * f) / f;
};

export const fmt = (n, d = 2) =>
  Number.isFinite(n)
    ? round(n, d).toLocaleString('en-CA', {
        minimumFractionDigits: d,
        maximumFractionDigits: d,
      })
    : '—';

export const money = (n) =>
  Number.isFinite(n)
    ? n.toLocaleString('en-CA', { style: 'currency', currency: 'CAD' })
    : '—';

// computeQuote
// -----------
// module     { width_mm, height_mm, pitch_mm, max_watts, ... }
// targetW    requested placement width  (number, in `unit`s)
// targetH    requested placement height (number, in `unit`s)
// unit       'mm' | 'in'
// fitMode    'nearest' — round modules to closest fit
//            'down'    — round down so sign stays within the opening
// sides      1 | 2
// rate       $ per m²
//
// Returns null if inputs are insufficient or the module is missing,
// otherwise an object with every value the UI needs to render.
export function computeQuote({
  module,
  targetW,
  targetH,
  unit = 'mm',
  fitMode = 'nearest',
  sides = 2,
  rate = 0,
}) {
  if (!module) return null;
  const tW = Number(targetW);
  const tH = Number(targetH);
  if (!(tW > 0) || !(tH > 0)) return null;

  const reqWmm = unit === 'in' ? tW * MM_PER_INCH : tW;
  const reqHmm = unit === 'in' ? tH * MM_PER_INCH : tH;

  const widthMm  = Number(module.width_mm);
  const heightMm = Number(module.height_mm);
  const pitchMm  = Number(module.pitch_mm);
  const maxWatts = Number(module.max_watts);

  const fit = (req, mod) => {
    const exact = req / mod;
    if (fitMode === 'down') return Math.max(1, Math.floor(exact));
    return Math.max(1, Math.round(exact));
  };
  const modsWide = fit(reqWmm, widthMm);
  const modsTall = fit(reqHmm, heightMm);

  const faceWmm = modsWide * widthMm;
  const faceHmm = modsTall * heightMm;
  const faceWin = faceWmm / MM_PER_INCH;
  const faceHin = faceHmm / MM_PER_INCH;

  const areaPerSide = (faceWmm / 1000) * (faceHmm / 1000); // m²
  const totalArea   = areaPerSide * sides;

  const modulesPerSide = modsWide * modsTall;
  const totalModules   = modulesPerSide * sides;

  // Pixel count per side. pitch_mm is the spacing between pixel centres,
  // so a 320mm module at P8 = 40px wide. round() handles fractional
  // pitches (P3.91 etc.) without producing fractional pixel counts.
  const pxWide = Math.round(widthMm  / pitchMm) * modsWide;
  const pxTall = Math.round(heightMm / pitchMm) * modsTall;

  const maxW = totalModules * maxWatts;
  const ampsAt120 = maxW / 120;
  const ampsAt240 = maxW / 240;

  const r = Number(rate) || 0;
  const total = totalArea * r;

  // Delta vs requested placement — for the UI's "+/- 4mm vs opening"
  // readout. Positive = sign is larger than the opening (only possible
  // in 'nearest' mode).
  const dWmm = faceWmm - reqWmm;
  const dHmm = faceHmm - reqHmm;

  return {
    reqWmm, reqHmm,
    modsWide, modsTall,
    faceWmm, faceHmm, faceWin, faceHin,
    areaPerSide, totalArea,
    modulesPerSide, totalModules,
    pxWide, pxTall,
    maxW, ampsAt120, ampsAt240,
    total,
    dWmm, dHmm,
  };
}

// buildDescription
// ----------------
// Produces the canonical line-item description string written to the
// job's items table. Format is the same as the prototype's so quotes
// generated before and after this port read identically.
export function buildDescription(calc, module, sides = 2) {
  if (!calc || !module) return '';
  const sideTxt = Number(sides) === 2 ? 'double-sided' : 'single-sided';
  const control = module.control_system ? `, ${module.control_system} control system` : '';
  return (
    `LED Display — ${fmt(calc.faceWmm, 0)}mm × ${fmt(calc.faceHmm, 0)}mm ` +
    `(${fmt(calc.faceWin, 2)}" × ${fmt(calc.faceHin, 2)}"), ` +
    `${calc.modsWide}×${calc.modsTall} array of ${module.name} modules ` +
    `(${module.width_mm}×${module.height_mm}mm, P-${module.pitch_mm}), ` +
    `${sideTxt}, ${fmt(calc.totalArea, 4)} m², ` +
    `${calc.pxWide}×${calc.pxTall}px per side` +
    control +
    `. Max power draw ${fmt(calc.maxW, 0)}W ` +
    `(${fmt(calc.ampsAt120, 1)}A @ 120V).`
  );
}
