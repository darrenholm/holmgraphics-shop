// src/lib/shop/pricing.js
//
// Customer-facing pricing for apparel. Applied client-side for now so we can
// stop leaking wholesale prices on the storefront. Long term this should move
// into the catalog API so prices are never sent to the browser as wholesale.
//
// Rules (agreed 2026-04-21):
//   cost < $5   →  price = max(cost * 3, $10)
//   cost >= $5  →  price = max(cost * 2, $15)

export function apparelPrice(cost) {
  if (cost == null || isNaN(cost)) return null;
  const c = Number(cost);
  if (c < 5) return Math.max(c * 3, 10);
  return Math.max(c * 2, 15);
}

// Apply markup to a variant's effective price (sale_price preferred).
// Returns a retail CAD number or null.
export function variantRetail(v) {
  if (!v) return null;
  const wholesale = v.sale_price ?? v.price ?? null;
  return apparelPrice(wholesale);
}
