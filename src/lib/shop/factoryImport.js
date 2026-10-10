// src/lib/shop/factoryImport.js
//
// Reads the LED factory's "Order list" spreadsheet into module part numbers
// for the /modules page Import button.
//
// The sheet has one block per order: the first row carries the order date
// and PI number, continuation rows (date/PI blank, cells merged) carry more
// cabinet sizes and the "Spare-…" module line. The module label (the batch
// number printed on every module's sticker) sits in the "Moudle lable"
// column on any row of the block. Several orders can share one label.
//
// Nothing here touches the database: planImport() compares against the
// current inventory and the page shows the plan before anything is saved.
// Counts are deliberately NOT imported — a "Spare-…" line can include the
// modules that went into the sign (Inline's 120), so the factory figure
// goes into the notes and the shelf count stays what staff count.

const SHEETJS = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';

// Same comparison the server uses: case, spaces and bracket shape don't count.
export const partKey = (v) => String(v ?? '')
  .toUpperCase().replace(/[{[]/g, '(').replace(/[}\]]/g, ')').replace(/\s+/g, '');

const clean = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();

// Excel stores some dates as day serials (45409 = 2024-04-27).
function toDate(v) {
  const s = clean(v);
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(Number(s)) * 86400000);
    return d.toISOString().slice(0, 10);
  }
  return s;
}

function findColumns(header) {
  const at = (re) => header.findIndex((h) => re.test(clean(h)));
  return {
    date:    at(/order\s*date/i),
    pi:      at(/^pi\b|pi\s*number/i),
    cabinet: at(/cabinet\s*size/i),
    qty:     at(/quantity/i),
    sign:    at(/sign\s*name/i),
    item:    at(/item/i),
    label:   at(/lable|label/i),
  };
}

// rows: array of row arrays (first sheet, header included).
// Returns [{ module_id_no, description, orders: [...], notes }]
export function parseFactoryRows(rows) {
  const headerAt = rows.findIndex((r) => r.some((c) => /pi\s*number/i.test(clean(c))));
  if (headerAt < 0) throw new Error('This doesn’t look like the factory order list (no “PI number” column).');
  const col = findColumns(rows[headerAt]);
  if (col.label < 0) throw new Error('No “Module label” column found in this sheet.');
  const get = (r, k) => (col[k] >= 0 ? r[col[k]] : '');

  const orders = [];
  let cur = null;
  for (const r of rows.slice(headerAt + 1)) {
    if (/^total$/i.test(clean(r[0]))) break;
    const pi = clean(get(r, 'pi'));
    if (pi) {
      cur = { date: toDate(get(r, 'date')), pi, sign: clean(get(r, 'sign')),
              item: clean(get(r, 'item')), cabinets: [], spares: 0, spareType: '', label: '' };
      orders.push(cur);
    }
    if (!cur) continue;
    const cab = clean(get(r, 'cabinet'));
    const qty = Number(clean(get(r, 'qty'))) || 0;
    if (/^spare/i.test(cab)) {
      cur.spares += qty;
      if (!cur.spareType) cur.spareType = cab.replace(/^spare-?/i, '');
    } else if (cab) {
      cur.cabinets.push(qty > 1 ? `${cab} ×${qty}` : cab);
    }
    const label = clean(get(r, 'label'));
    if (label && !cur.label) cur.label = label;
  }

  const parts = new Map();
  for (const o of orders) {
    if (!o.label) continue;
    // A sign name sometimes only appears after a "/" in the item name
    // ("…single faced display/Cuneos Interiors").
    if (!o.sign && o.item.includes('/')) o.sign = clean(o.item.split('/').pop());
    const key = partKey(o.label);
    if (!parts.has(key)) parts.set(key, { module_id_no: o.label, description: '', orders: [] });
    const p = parts.get(key);
    p.orders.push(o);
    if (!p.description) p.description = o.spareType || o.cabinets[0] || '';
  }
  for (const p of parts.values()) p.notes = p.orders.map(orderNote).join('\n');
  return [...parts.values()];
}

export function orderNote(o) {
  return [
    `Factory order ${o.date}`,
    `PI ${o.pi}`,
    o.sign,
    o.cabinets.join(', '),
    o.spares ? `${o.spares} loose/spare modules shipped` : '',
  ].filter(Boolean).join(' · ');
}

// Compare parsed parts with the current inventory.
//   new       → create with description + notes
//   update    → existing part: add the order notes it doesn't have yet
//               (matched by PI number), fill a blank description
//   unchanged → already has every order
export function planImport(parts, inventory) {
  const byKey = new Map(inventory.map((m) => [partKey(m.module_id_no), m]));
  return parts.map((p) => {
    const m = byKey.get(partKey(p.module_id_no));
    if (!m) return { ...p, action: 'new', existing: null, patch: null };
    const have = m.notes || '';
    const missing = p.orders.filter((o) => !have.includes(o.pi));
    if (!missing.length) return { ...p, action: 'unchanged', existing: m, patch: null };
    const patch = { notes: [have, ...missing.map(orderNote)].filter(Boolean).join('\n') };
    if (!m.description && p.description) patch.description = p.description;
    return { ...p, action: 'update', existing: m, patch };
  });
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Could not load the spreadsheet reader.'));
    document.head.appendChild(s);
  });
}

// Browser only: File → rows of the first sheet.
export async function readSpreadsheet(file) {
  if (!window.XLSX) await loadScript(SHEETJS);
  const wb = window.XLSX.read(await file.arrayBuffer(), { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return window.XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
}
