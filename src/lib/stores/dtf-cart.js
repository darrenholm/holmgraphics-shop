// src/lib/stores/dtf-cart.js
//
// DTF online-store cart. Distinct from the legacy `cart.js` quote-builder
// store (which still backs the existing /shop/quote email-mailto flow).
// This one drives the new /shop/cart → /shop/checkout → /shop/order
// pipeline that creates real orders + charges cards.
//
// Persistence: items + designs metadata go to localStorage under
// `hg_dtf_cart`. The actual File objects on each design are NOT persisted
// (browsers don't let us); they live in-memory until the order is created
// and the customer is bounced to /shop/order/:n/upload.
//
// Cart shape:
//   {
//     items: [{
//       id,                             // client-side temp uuid
//       supplier, style, variant_id,
//       product_name, color_name, color_hex,
//       size, quantity,
//       unit_price,                     // garment retail (post-markup)
//       garment_category,               // 'apparel' | 'headwear' | 'aprons' | 'bags'
//       decorations: [{
//         id,                           // client-side temp id
//         design_id,                    // references designs[].id
//         print_location_id,            // null = custom
//         custom_location,
//         width_in, height_in
//       }]
//     }],
//     designs: [{
//       id,                             // client-side uuid
//       name,                           // "Logo A", customer-supplied
//       filename,                       // for display
//       size_bytes,
//       _file                           // File obj — NOT persisted
//     }]
//   }

import { writable, derived } from 'svelte/store';

const STORAGE_KEY = 'hg_dtf_cart';

function uuid() {
  // Crypto-quality if available, else random fallback. Designs reference
  // uuids that go straight to the backend, so they need to be unguessable.
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'd-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function emptyCart() {
  return { items: [], designs: [] };
}

function load() {
  if (typeof localStorage === 'undefined') return emptyCart();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyCart();
    const parsed = JSON.parse(raw);
    // Strip any stale _file refs (they can't survive a reload anyway).
    if (parsed.designs) parsed.designs.forEach((d) => { delete d._file; });
    return { items: parsed.items || [], designs: parsed.designs || [] };
  } catch {
    return emptyCart();
  }
}

function save(state) {
  if (typeof localStorage === 'undefined') return;
  // Only persist the JSON-safe shape. Files re-attach via setDesignFile().
  const persisted = {
    items: state.items,
    designs: state.designs.map(({ _file, ...rest }) => rest),
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
}

function createCart() {
  const { subscribe, update, set } = writable(load());

  function mutate(fn) {
    update((s) => {
      const next = fn(s);
      save(next);
      return next;
    });
  }

  return {
    subscribe,

    addItem(item) {
      mutate((s) => ({
        ...s,
        items: [...s.items, { id: uuid(), decorations: [], ...item }],
      }));
    },

    updateItem(itemId, patch) {
      mutate((s) => ({
        ...s,
        items: s.items.map((it) => (it.id === itemId ? { ...it, ...patch } : it)),
      }));
    },

    removeItem(itemId) {
      mutate((s) => ({
        ...s,
        items: s.items.filter((it) => it.id !== itemId),
      }));
    },

    setQuantity(itemId, quantity) {
      const q = Math.max(0, parseInt(quantity, 10) || 0);
      if (q === 0) this.removeItem(itemId);
      else this.updateItem(itemId, { quantity: q });
    },

    addDecoration(itemId, decoration) {
      mutate((s) => ({
        ...s,
        items: s.items.map((it) =>
          it.id === itemId
            ? { ...it, decorations: [...it.decorations, { id: uuid(), ...decoration }] }
            : it
        ),
      }));
    },

    updateDecoration(itemId, decorationId, patch) {
      mutate((s) => ({
        ...s,
        items: s.items.map((it) =>
          it.id === itemId
            ? {
                ...it,
                decorations: it.decorations.map((d) =>
                  d.id === decorationId ? { ...d, ...patch } : d
                ),
              }
            : it
        ),
      }));
    },

    removeDecoration(itemId, decorationId) {
      mutate((s) => ({
        ...s,
        items: s.items.map((it) =>
          it.id === itemId
            ? { ...it, decorations: it.decorations.filter((d) => d.id !== decorationId) }
            : it
        ),
      }));
    },

    addDesign(name, file) {
      const id = uuid();
      mutate((s) => ({
        ...s,
        designs: [...s.designs, {
          id,
          name: name || `Design ${s.designs.length + 1}`,
          filename: file?.name || 'untitled',
          size_bytes: file?.size || 0,
          mime: file?.type || 'application/octet-stream',
          _file: file || null,
        }],
      }));
      return id;
    },

    setDesignFile(designId, file) {
      // Re-attach a File object after page reload (user re-picks the file).
      mutate((s) => ({
        ...s,
        designs: s.designs.map((d) =>
          d.id === designId
            ? { ...d, filename: file.name, size_bytes: file.size, mime: file.type, _file: file }
            : d
        ),
      }));
    },

    removeDesign(designId) {
      mutate((s) => ({
        ...s,
        designs: s.designs.filter((d) => d.id !== designId),
        // Also remove any decorations referencing this design.
        items: s.items.map((it) => ({
          ...it,
          decorations: it.decorations.filter((d) => d.design_id !== designId),
        })),
      }));
    },

    clear() {
      set(emptyCart());
      if (typeof localStorage !== 'undefined') localStorage.removeItem(STORAGE_KEY);
    },
  };
}

export const dtfCart = createCart();

export const itemCount = derived(dtfCart, ($c) =>
  $c.items.reduce((n, it) => n + (it.quantity || 0), 0)
);

export const isEmpty = derived(dtfCart, ($c) => $c.items.length === 0);
