// src/lib/shop/categories.js
//
// Category display labels + ordering for the storefront pill bar.
// Canonical values come from the API (supplier_product.category); the
// canonical→raw mapping lives on the API side in
// suppliers/sanmar/category-map.js. Keep the two files in sync when
// you add or rename a bucket.

export const CATEGORY_LABELS = {
  't-shirts':       'T-Shirts',
  'polos':          'Polos',
  'woven-shirts':   'Woven Shirts',
  'fleece':         'Fleece & Hoodies',
  'outerwear':      'Outerwear',
  'headwear':       'Headwear',
  'activewear':     'Activewear',
  'bottoms':        'Bottoms',
  'bags':           'Bags',
  'workwear':       'Workwear',
  'accessories':    'Accessories',
  'youth':          'Youth',
  'ladies':         'Ladies',
  'other':          'Other',
  '__unclassified': 'Unclassified'
};

// Display order for the pill bar. Categories returned by the API but
// missing from this list are appended alphabetically after the ordered
// set (so a new bucket still shows up without a UI redeploy).
export const CATEGORY_ORDER = [
  't-shirts',
  'polos',
  'woven-shirts',
  'fleece',
  'outerwear',
  'headwear',
  'activewear',
  'bottoms',
  'bags',
  'workwear',
  'accessories',
  'youth',
  'ladies',
  'other',
  '__unclassified'
];

export function labelFor(cat) {
  return CATEGORY_LABELS[cat] || cat;
}

/**
 * Sort a [{category, product_count}, ...] array by CATEGORY_ORDER.
 * Unknown categories land at the end, sorted alphabetically.
 */
export function sortCategories(rows) {
  const idx = new Map(CATEGORY_ORDER.map((c, i) => [c, i]));
  return [...rows].sort((a, b) => {
    const ai = idx.has(a.category) ? idx.get(a.category) : 999;
    const bi = idx.has(b.category) ? idx.get(b.category) : 999;
    if (ai !== bi) return ai - bi;
    return a.category.localeCompare(b.category);
  });
}
