/**
 * Vehicle types for the fleet roster.
 *
 * Three types share the `vehicles` table: trucks, trailers, and — since
 * migration 071 — equipment (the scissor lifts). They are one roster
 * because they are one set of shop assets, but they differ in what
 * identifies them and what paperwork they carry, and every fleet page had
 * been hard-coding `type === 'truck' ? 'Truck' : 'Trailer'`. That ternary
 * silently labels a lift as a trailer, so the mapping lives here instead.
 *
 * Kept in step with routes/fleet.js in holmgraphics-shop-api, which is the
 * enforcing copy — the server rejects a doc type a vehicle type can't hold.
 * This file decides what to draw, not what is allowed.
 */

export const VEHICLE_TYPES = ['truck', 'trailer', 'equipment'];

const META = {
  truck:     { label: 'Truck',     icon: '🚚', docTypes: ['ownership', 'insurance', 'inspection'] },
  trailer:   { label: 'Trailer',   icon: '🚛', docTypes: ['ownership', 'insurance', 'inspection'] },
  equipment: { label: 'Equipment', icon: '🏗️', docTypes: ['ownership', 'insurance'] }
};

const FALLBACK = { label: 'Vehicle', icon: '🚚', docTypes: ['ownership', 'insurance', 'inspection'] };

function meta(type) {
  return META[type] || FALLBACK;
}

/** "Truck" / "Trailer" / "Equipment" — for headings and table cells. */
export function typeLabel(type) {
  return meta(type).label;
}

export function typeIcon(type) {
  return meta(type).icon;
}

/**
 * Document sections that apply to a type. Equipment has no annual PMVI
 * sticker — that is a road-vehicle inspection — so it gets no inspection
 * slot rather than one that reads "Not on file" for the rest of its life.
 */
export function docTypesFor(type) {
  return meta(type).docTypes;
}

export function hasDocType(type, docType) {
  return docTypesFor(type).includes(docType);
}

/** Equipment is identified by a serial plate; road vehicles by plate + VIN. */
export function isEquipment(type) {
  return type === 'equipment';
}

/**
 * Hour-meter reading with the date it was taken, e.g. "412.5 h · read 19 Sep
 * 2026". The date is not decoration: an hour count with no date looks
 * current forever, and service intervals get planned off it.
 */
export function formatHours(hours, hoursAt) {
  if (hours == null || hours === '') return '';
  const n = Number(hours);
  const shown = Number.isFinite(n)
    ? `${n.toLocaleString('en-CA', { maximumFractionDigits: 1 })} h`
    : `${hours} h`;
  if (!hoursAt) return shown;
  const d = new Date(hoursAt);
  if (Number.isNaN(d.getTime())) return shown;
  return `${shown} · read ${d.toLocaleDateString('en-CA', { day: 'numeric', month: 'short', year: 'numeric' })}`;
}
