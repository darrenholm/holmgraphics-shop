// src/lib/stores/cart.js
//
// Quote builder. Customer selects a product, picks a matrix of
// colors × sizes with quantities, picks a decoration spec, and adds
// the whole thing as ONE bundle. They can add multiple bundles
// (different products, different decorations) before requesting a
// quote. Persisted to localStorage.
//
// Bundle shape:
//   {
//     bundleId:    'b_1729384738123_xyz',     // stable id for remove
//     supplier:    'sanmar_ca',
//     supplierName:'SanMar Canada',
//     style:       'ATC1000',
//     productName: 'Everyday Cotton Tee',
//     brand:       'ATC',
//     imageUrl:    '...',
//     lines: [
//       { variantId, colorName, colorHex, size, qty, unitPrice }
//     ],
//     decoration: {
//       type:  'left_chest' | 'full_chest_or_back' | 'other',
//       notes: 'free-text for "other" or extra instructions'
//     },
//     addedAt: ISO timestamp
//   }

import { writable, derived } from 'svelte/store';

const STORAGE_KEY = 'hg_quote_cart_v2';
// Bump to v2 so any single-variant v1 data from an earlier build
// doesn't confuse the new bundle shape.

function loadInitial() {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persist(bundles) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(bundles));
  } catch {}
}

function newBundleId() {
  return 'b_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
}

function createCart() {
  const { subscribe, set, update } = writable(loadInitial());

  return {
    subscribe,

    /**
     * Add a fully-formed bundle. The caller is responsible for
     * stripping out any zero-qty lines before calling.
     */
    addBundle(bundle) {
      update((bundles) => {
        const next = [
          ...bundles,
          {
            ...bundle,
            bundleId: bundle.bundleId || newBundleId(),
            addedAt: bundle.addedAt || new Date().toISOString()
          }
        ];
        persist(next);
        return next;
      });
    },

    /** Replace the lines/decoration of an existing bundle (edit flow). */
    updateBundle(bundleId, patch) {
      update((bundles) => {
        const next = bundles.map((b) =>
          b.bundleId === bundleId ? { ...b, ...patch } : b
        );
        persist(next);
        return next;
      });
    },

    remove(bundleId) {
      update((bundles) => {
        const next = bundles.filter((b) => b.bundleId !== bundleId);
        persist(next);
        return next;
      });
    },

    clear() {
      persist([]);
      set([]);
    }
  };
}

export const cart = createCart();

// Total pieces across all bundles (sum of every line qty).
export const cartCount = derived(cart, ($cart) =>
  $cart.reduce(
    (n, b) => n + b.lines.reduce((m, l) => m + (l.qty || 0), 0),
    0
  )
);

// Subtotal ignoring null prices. Lines without a unit price mean
// "quote on request" and won't contribute until staff prices them.
export const cartSubtotal = derived(cart, ($cart) =>
  $cart.reduce(
    (sum, b) =>
      sum +
      b.lines.reduce(
        (s, l) => s + (l.unitPrice != null ? l.unitPrice * l.qty : 0),
        0
      ),
    0
  )
);

export const cartHasUnknownPrice = derived(cart, ($cart) =>
  $cart.some((b) => b.lines.some((l) => l.unitPrice == null))
);

export const cartBundleCount = derived(cart, ($cart) => $cart.length);
