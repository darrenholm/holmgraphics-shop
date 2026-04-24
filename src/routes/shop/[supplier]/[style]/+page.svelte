<!-- src/routes/shop/[supplier]/[style]/+page.svelte -->
<!--
  Product detail. Flow:
    1. Customer picks colours (can tick multiple)
    2. For each picked colour, enters qty per size
    3. Picks decoration: Left chest / Full chest or back / Other
    4. (optional) Decoration notes
    5. "Add to Quote" bundles it all and pushes into $cart,
       then offers to keep shopping or review quote.

  All sizes for all picked colours render as a single vertical stack —
  easier on mobile than a full matrix.
-->
<script>
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { api } from '$lib/api/client.js';
  import { cart, cartCount } from '$lib/stores/cart.js';
  import { dtfCart } from '$lib/stores/dtf-cart.js';
  import { apparelPrice } from '$lib/shop/pricing.js';
  import { variantRetail } from '$lib/shop/pricing.js';

  let product = null;
  let loading = true;
  let error = '';

  // Selection state
  let expanded = {};      // colorName -> bool (expand/collapse)
  let qtyMap = {};        // variantId -> number
  let decoration = 'left_chest'; // 'left_chest' | 'full_chest_or_back' | 'other'
  let decorationNotes = '';
  let justAdded = false;
  let activeColorName = null;  // which colour's image is shown in the hero

  // Reactive hero image. No IIFE — keep static so Svelte's dep-tracking works.
  $: activeColorGroup = activeColorName
    ? colorGroups.find((c) => c.colorName === activeColorName)
    : null;
  $: firstVariantImage = product?.variants?.find((v) => v.image_url)?.image_url || null;
  $: heroImage = activeColorGroup?.imageUrl || firstVariantImage;

  const money = (n) =>
    n == null
      ? '—'
      : new Intl.NumberFormat('en-CA', {
          style: 'currency',
          currency: 'CAD',
          minimumFractionDigits: 2
        }).format(n);

  // Group variants by colour for the picker.
  //   [{colorName, colorHex, imageUrl, sizes:[{id,size,price,qty,image_url,...}]}]
  $: colorGroups = groupByColor(product?.variants || []);

  function groupByColor(variants) {
    const map = new Map();
    for (const v of variants) {
      const key = v.color_name || '—';
      if (!map.has(key)) {
        map.set(key, {
          colorName: key,
          colorHex: v.color_hex || null,
          imageUrl: v.image_url || null,
          sizes: []
        });
      }
      const g = map.get(key);
      if (!g.imageUrl && v.image_url) g.imageUrl = v.image_url;
      if (!g.colorHex && v.color_hex) g.colorHex = v.color_hex;
      g.sizes.push(v);
    }
    // Sort sizes within each group by size_order if we have it
    for (const g of map.values()) {
      g.sizes.sort((a, b) => {
        if (a.size_order != null && b.size_order != null) return a.size_order - b.size_order;
        return String(a.size || '').localeCompare(String(b.size || ''));
      });
    }
    return Array.from(map.values());
  }

  // Running totals reactive to qtyMap — all retail prices, not wholesale.
  $: totalQty = Object.values(qtyMap).reduce((n, q) => n + (Number(q) || 0), 0);
  $: totalSubtotal = (product?.variants || []).reduce((sum, v) => {
    const q = Number(qtyMap[v.id]) || 0;
    const retail = variantRetail(v);
    return sum + (retail != null ? retail * q : 0);
  }, 0);
  $: anyUnpriced = (product?.variants || []).some(
    (v) => (Number(qtyMap[v.id]) || 0) > 0 && variantRetail(v) == null
  );

  // ─── Actions ───────────────────────────────────────────────
  function toggleColor(name) {
    expanded = { ...expanded, [name]: !expanded[name] };
    activeColorName = name;  // always preview the clicked colour in the hero
  }

  function previewColor(name) {
    activeColorName = name;
  }

  function clearColor(name) {
    const g = colorGroups.find((c) => c.colorName === name);
    if (!g) return;
    const next = { ...qtyMap };
    for (const v of g.sizes) delete next[v.id];
    qtyMap = next;
  }

  function colorQtyTotal(name) {
    const g = colorGroups.find((c) => c.colorName === name);
    if (!g) return 0;
    return g.sizes.reduce((n, v) => n + (Number(qtyMap[v.id]) || 0), 0);
  }

  function addToQuote() {
    if (totalQty === 0) {
      error = 'Please enter at least one quantity.';
      return;
    }
    error = '';

    // Build lines from qtyMap, keeping only qty > 0
    const lines = [];
    for (const v of product.variants) {
      const qty = Number(qtyMap[v.id]) || 0;
      if (qty <= 0) continue;
      const unit = v.sale_price ?? v.price ?? null;
      lines.push({
        variantId: v.id,
        colorName: v.color_name || null,
        colorHex: v.color_hex || null,
        size: v.size || null,
        qty,
        unitPrice: unit
      });
    }

    cart.addBundle({
      supplier: product.supplier,
      supplierName: product.supplier_name,
      style: product.style,
      productName: product.product_name || product.style,
      brand: product.brand || null,
      imageUrl: product.variants.find((v) => v.image_url)?.image_url || null,
      lines,
      decoration: {
        type: decoration,
        notes: decorationNotes.trim()
      }
    });

    // Also add to the new DTF cart so customers can check out online for
    // each variant+size combination. The legacy cart is still used for the
    // "Request a Quote" mailto path; the DTF cart drives /shop/cart →
    // /shop/checkout. Cart UI on /shop/cart lets the customer attach
    // designs and edit decorations before paying.
    for (const v of product.variants) {
      const qty = Number(qtyMap[v.id]) || 0;
      if (qty <= 0) continue;
      const wholesale = v.sale_price ?? v.price ?? null;
      const retail = wholesale != null ? apparelPrice(wholesale) : null;
      dtfCart.addItem({
        supplier:        product.supplier,
        style:           product.style,
        variant_id:      String(v.id),
        product_name:    product.product_name || product.style,
        color_name:      v.color_name || '',
        color_hex:       v.color_hex || null,
        size:            v.size || '',
        quantity:        qty,
        unit_price:      retail || 0,
        garment_category: product.garment_category || 'apparel',
      });
    }

    // Reset selection state so customer can add another round cleanly
    qtyMap = {};
    decorationNotes = '';
    decoration = 'left_chest';
    expanded = {};
    justAdded = true;
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
    setTimeout(() => (justAdded = false), 4000);
  }

  async function load() {
    loading = true;
    error = '';
    try {
      product = await api.getCatalogProduct($page.params.supplier, $page.params.style);
    } catch (e) {
      error = e.message || 'Could not load product.';
    } finally {
      loading = false;
    }
  }

  onMount(load);
</script>

<svelte:head>
  <title>{product?.product_name || product?.style || 'Product'} — Holm Graphics Shop</title>
</svelte:head>

<div class="shop-shell">
  <header class="public-header">
    <a href="/shop/" class="brand">
      <span class="brand-logo">HOLM</span>
      <span class="brand-sub">GRAPHICS</span>
    </a>
    <nav class="public-nav">
      <a href="/shop/">Shop</a>
      <a href="https://holmgraphics.ca/about.html">About</a>
      <a href="https://holmgraphics.ca/#contact">Contact</a>
    </nav>
    <a href="/shop/quote/" class="quote-btn">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M6 2l1 18a2 2 0 002 2h6a2 2 0 002-2l1-18" />
        <path d="M3 6h18" />
      </svg>
      Quote
      {#if $cartCount > 0}
        <span class="quote-pill">{$cartCount}</span>
      {/if}
    </a>
  </header>

  <div class="container">
    <a class="breadcrumb" href="/shop/">← Back to catalog</a>

    {#if loading}
      <div class="state"><span class="spinner"></span> Loading product…</div>
    {:else if error && !product}
      <div class="state error">{error}</div>
    {:else if product}

      {#if justAdded}
        <div class="flash">
          ✓ Added to your quote. <a href="/shop/quote/">Review quote →</a> or keep shopping below.
        </div>
      {/if}

      <div class="detail-grid">
        <!-- Gallery -->
        <div class="gallery">
          {#if heroImage}
            <img
              src={heroImage}
              alt={`${product.product_name || product.style}${activeColorName ? ' — ' + activeColorName : ''}`}
              referrerpolicy="no-referrer"
            />
            {#if activeColorName}
              <div class="hero-caption">{activeColorName}</div>
            {/if}
          {:else}
            <div class="no-image">
              <svg width="60" height="60" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <polyline points="21 15 16 10 5 21" />
              </svg>
              <span>No image available</span>
            </div>
          {/if}

          <!-- Colour thumbnail strip: click to preview in hero, no expand. -->
          {#if colorGroups.length > 1}
            <div class="thumb-strip">
              {#each colorGroups as g}
                <button
                  type="button"
                  class="thumb"
                  class:active={activeColorName === g.colorName}
                  title={g.colorName}
                  on:click={() => previewColor(g.colorName)}
                >
                  {#if g.imageUrl}
                    <img src={g.imageUrl} alt={g.colorName} referrerpolicy="no-referrer" loading="lazy" />
                  {:else}
                    <span class="thumb-swatch" style="background:{g.colorHex || '#ccc'};"></span>
                  {/if}
                </button>
              {/each}
            </div>
          {/if}
        </div>

        <!-- Info -->
        <div class="info">
          <div class="product-brand">{product.brand || product.supplier_name}</div>
          <h1>{product.product_name || product.style}</h1>
          <div class="meta">
            <span class="style">Style #{product.style}</span>
            <span class="dot">•</span>
            <span>{product.supplier_name}</span>
            {#if product.is_discontinued}
              <span class="dot">•</span>
              <span class="warn">Discontinued</span>
            {/if}
          </div>

          {#if product.description}
            <p class="description">{product.description}</p>
          {/if}

          {#if product.is_blocked_from_blank_sale}
            <div class="notice">
              <strong>Decoration required.</strong> This brand can only be sold with a print or
              embroidery job — we'll quote it together with your decoration.
            </div>
          {/if}

          <!-- Colour picker -->
          <section class="section">
            <h2>1. Pick colours &amp; sizes</h2>
            <p class="hint">Tap a colour to enter quantities per size. Add as many colours as you need.</p>

            <div class="color-list">
              {#each colorGroups as g}
                {@const picked = colorQtyTotal(g.colorName)}
                <div class="color-row" class:open={expanded[g.colorName]} class:has-qty={picked > 0}>
                  <button type="button" class="color-head" on:click={() => toggleColor(g.colorName)}>
                    <span class="swatch" style="background:{g.colorHex || '#ccc'};"></span>
                    <span class="color-name">{g.colorName}</span>
                    {#if picked > 0}
                      <span class="qty-chip">{picked} pc</span>
                    {/if}
                    <span class="chev" aria-hidden="true">{expanded[g.colorName] ? '▴' : '▾'}</span>
                  </button>

                  {#if expanded[g.colorName]}
                    <div class="size-grid">
                      {#each g.sizes as v}
                        {@const unit = variantRetail(v)}
                        <div class="size-cell" class:oos={v.quantity === 0}>
                          <label>
                            <span class="size-label">{v.size || '—'}</span>
                            <input
                              type="number"
                              min="0"
                              step="1"
                              inputmode="numeric"
                              placeholder="0"
                              bind:value={qtyMap[v.id]}
                            />
                          </label>
                          <div class="size-meta">
                            <span>{money(unit)}</span>
                            {#if v.quantity === 0}
                              <span class="oos-tag">Low stock</span>
                            {/if}
                          </div>
                        </div>
                      {/each}
                    </div>
                    {#if picked > 0}
                      <div class="color-actions">
                        <button type="button" class="text-btn" on:click={() => clearColor(g.colorName)}>Clear colour</button>
                      </div>
                    {/if}
                  {/if}
                </div>
              {/each}
            </div>
          </section>

          <!-- Decoration -->
          <section class="section">
            <h2>2. Decoration</h2>
            <p class="hint">Where should the print or embroidery go? (Art files can be uploaded after we confirm the quote.)</p>

            <div class="deco-options">
              <label class="deco-opt" class:selected={decoration === 'left_chest'}>
                <input type="radio" bind:group={decoration} value="left_chest" />
                <div>
                  <div class="deco-title">Small — left chest</div>
                  <div class="deco-sub">~4" logo, most common for polos, jackets, caps</div>
                </div>
              </label>

              <label class="deco-opt" class:selected={decoration === 'full_chest_or_back'}>
                <input type="radio" bind:group={decoration} value="full_chest_or_back" />
                <div>
                  <div class="deco-title">Large — full chest or back</div>
                  <div class="deco-sub">~11–12" wide, for tees, hoodies, team wear</div>
                </div>
              </label>

              <label class="deco-opt" class:selected={decoration === 'other'}>
                <input type="radio" bind:group={decoration} value="other" />
                <div>
                  <div class="deco-title">Other / multiple locations</div>
                  <div class="deco-sub">Sleeves, leg, cap side, multi-location — describe below</div>
                </div>
              </label>
            </div>

            <label class="notes-label" for="deco-notes">Notes (optional)</label>
            <textarea
              id="deco-notes"
              rows="3"
              placeholder={decoration === 'other'
                ? 'Please describe decoration location and approximate size…'
                : 'Anything else we should know (colours, thread count, deadline)?'}
              bind:value={decorationNotes}
            ></textarea>
          </section>

          <!-- Summary + CTA -->
          <section class="summary">
            <div class="summary-line">
              <span>Total pieces</span>
              <strong>{totalQty}</strong>
            </div>
            <div class="summary-line">
              <span>Blank subtotal</span>
              <strong>{anyUnpriced ? 'Quote on request' : money(totalSubtotal)}</strong>
            </div>
            <p class="fine">
              Decoration, setup fees, shipping and HST are quoted separately. Prices shown are
              supplier blank pricing in CAD — final pricing confirmed on the quote we send back.
            </p>

            {#if error}<div class="err">{error}</div>{/if}

            <div class="cta-row">
              <button class="btn btn-primary big" on:click={addToQuote} disabled={totalQty === 0}>
                Add to Quote →
              </button>
              {#if $cartCount > 0}
                <a class="btn btn-ghost big" href="/shop/quote/">Review quote ({$cartCount})</a>
              {/if}
            </div>
          </section>
        </div>
      </div>
    {/if}
  </div>

  <footer class="public-footer">
    <p>Holm Graphics Inc. · Walkerton, Ontario · <a href="tel:5195073001">519-507-3001</a> · <a href="mailto:brady@holmgraphics.ca">brady@holmgraphics.ca</a></p>
  </footer>
</div>

<style>
  .shop-shell { min-height: 100vh; background: var(--black); color: var(--text); }

  /* ─── Shared header (same as /shop) ─── */
  .public-header {
    position: sticky; top: 0; z-index: 50;
    display: flex; align-items: center; gap: 24px;
    padding: 14px 28px;
    background: var(--surface);
    border-bottom: 1px solid var(--border);
  }
  .brand { display: flex; flex-direction: column; line-height: 1; text-decoration: none; }
  .brand-logo {
    font-family: Impact, 'Arial Black', sans-serif;
    font-size: 1.4rem; letter-spacing: 0.08em; color: var(--red);
  }
  .brand-sub {
    font-family: var(--font-display); font-size: 0.62rem;
    letter-spacing: 0.3em; color: var(--text-muted);
    text-transform: uppercase; margin-top: 2px;
  }
  .public-nav { margin-left: auto; display: flex; gap: 22px; }
  .public-nav a {
    font-family: var(--font-display); font-size: 0.82rem;
    font-weight: 600; letter-spacing: 0.08em; color: var(--text-muted);
    text-transform: uppercase; text-decoration: none;
  }
  .public-nav a:hover { color: var(--red); }
  .quote-btn {
    display: inline-flex; align-items: center; gap: 8px;
    padding: 8px 16px; border-radius: var(--radius);
    background: var(--red); color: #fff; text-decoration: none;
    font-family: var(--font-display); font-weight: 700; font-size: 0.85rem;
    letter-spacing: 0.06em; text-transform: uppercase; position: relative;
  }
  .quote-btn:hover { background: var(--red-dark); color: #fff; }
  .quote-pill { background: #fff; color: var(--red); border-radius: 999px; padding: 1px 8px; font-size: 0.72rem; font-weight: 900; }

  .container { max-width: 1200px; margin: 0 auto; padding: 20px 28px 56px; }
  .breadcrumb {
    display: inline-block; font-family: var(--font-display); font-size: 0.8rem;
    text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted);
    margin-bottom: 12px;
  }

  .state { padding: 60px 20px; text-align: center; color: var(--text-muted); }
  .state.error { color: var(--red); }

  .flash {
    background: #ecfdf5; border: 1px solid #a7f3d0; color: #065f46;
    padding: 10px 14px; border-radius: var(--radius-lg); margin-bottom: 14px;
    font-size: 0.92rem;
  }
  .flash a { color: #065f46; text-decoration: underline; font-weight: 700; }

  .detail-grid {
    display: grid;
    grid-template-columns: minmax(280px, 420px) 1fr;
    gap: 36px;
    align-items: start;
  }

  /* ─── Gallery ─── */
  .gallery {
    position: sticky; top: 88px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    overflow: hidden;
  }
  .gallery > img {
    width: 100%;
    aspect-ratio: 1/1;
    object-fit: cover;
    display: block;
  }
  .hero-caption {
    position: absolute;
    bottom: 0; left: 0; right: 0;
    padding: 8px 12px;
    background: linear-gradient(to top, rgba(0,0,0,0.55), rgba(0,0,0,0));
    color: #fff;
    font-family: var(--font-display);
    font-size: 0.8rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    font-weight: 700;
    pointer-events: none;
  }
  .no-image {
    width: 100%; aspect-ratio: 1/1;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    color: var(--text-dim); gap: 10px;
    font-family: var(--font-display); font-size: 0.8rem; letter-spacing: 0.1em;
    text-transform: uppercase;
  }

  /* Colour thumbnail strip under the hero */
  .thumb-strip {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    padding: 10px;
    border-top: 1px solid var(--border);
    max-height: 220px;
    overflow-y: auto;
  }
  .thumb {
    width: 48px; height: 48px;
    border: 2px solid var(--border);
    border-radius: 6px;
    background: #fff;
    padding: 0;
    cursor: pointer;
    overflow: hidden;
    flex-shrink: 0;
    transition: border-color 0.12s, transform 0.12s;
  }
  .thumb:hover { border-color: var(--red); transform: translateY(-1px); }
  .thumb.active { border-color: var(--red); box-shadow: 0 0 0 2px rgba(192,57,43,0.25); }
  .thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .thumb-swatch {
    display: block; width: 100%; height: 100%;
    border: 1px solid rgba(0,0,0,0.08);
  }

  /* ─── Info ─── */
  .info { min-width: 0; }
  .product-brand {
    font-family: var(--font-display); font-size: 0.78rem;
    font-weight: 700; letter-spacing: 0.14em;
    color: var(--red); text-transform: uppercase;
  }
  .info h1 {
    font-family: var(--font-display);
    font-size: 1.8rem; font-weight: 900; letter-spacing: 0.01em;
    margin: 4px 0 8px; line-height: 1.2;
  }
  .meta {
    display: flex; gap: 8px; align-items: center; flex-wrap: wrap;
    font-size: 0.88rem; color: var(--text-muted);
  }
  .meta .dot { opacity: 0.5; }
  .meta .warn { color: var(--amber); font-weight: 600; }
  .description {
    margin: 14px 0 8px;
    color: var(--text-muted);
    line-height: 1.6;
    font-size: 0.95rem;
  }
  .notice {
    background: #fff7ed; border: 1px solid #fed7aa; color: #9a3412;
    padding: 10px 14px; border-radius: var(--radius-lg);
    font-size: 0.9rem; margin: 12px 0 0;
  }

  /* ─── Sections ─── */
  .section { margin-top: 32px; }
  .section h2 {
    font-family: var(--font-display);
    font-size: 1.1rem; font-weight: 900;
    text-transform: uppercase; letter-spacing: 0.06em;
    color: var(--text);
    margin-bottom: 6px;
  }
  .hint { color: var(--text-muted); font-size: 0.88rem; margin-bottom: 14px; }

  /* ─── Colour rows ─── */
  .color-list { display: flex; flex-direction: column; gap: 8px; }
  .color-row {
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--surface);
    transition: border-color 0.15s;
  }
  .color-row.has-qty { border-color: var(--red); }
  .color-row.open { box-shadow: var(--shadow); }
  .color-head {
    display: flex; align-items: center; gap: 12px;
    width: 100%;
    padding: 12px 14px;
    background: none; border: none; cursor: pointer;
    text-align: left; font: inherit; color: inherit;
  }
  .swatch {
    width: 28px; height: 28px; border-radius: 50%;
    border: 1px solid rgba(0,0,0,0.12);
    flex-shrink: 0;
  }
  .color-name { font-weight: 600; flex: 1; font-size: 0.95rem; }
  .qty-chip {
    background: var(--red); color: #fff;
    padding: 2px 10px; border-radius: 999px;
    font-family: var(--font-display); font-size: 0.72rem;
    font-weight: 800; letter-spacing: 0.06em;
  }
  .chev { color: var(--text-dim); font-size: 0.9rem; }

  .size-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
    gap: 10px;
    padding: 4px 14px 16px;
    border-top: 1px solid var(--border);
  }
  .size-cell label {
    margin: 0;
    display: flex; flex-direction: column; gap: 4px;
    text-transform: none;
  }
  .size-label {
    font-family: var(--font-display); font-weight: 700;
    font-size: 0.85rem; letter-spacing: 0.08em;
    text-transform: uppercase; color: var(--text);
  }
  .size-cell input { padding: 6px 8px; }
  .size-meta {
    margin-top: 4px;
    font-size: 0.78rem;
    color: var(--text-muted);
    display: flex; gap: 6px; align-items: center;
    font-variant-numeric: tabular-nums;
  }
  .oos-tag {
    background: #fef3c7; color: #92400e;
    padding: 1px 6px; border-radius: 999px;
    font-size: 0.7rem; font-weight: 600;
  }

  .color-actions { padding: 0 14px 14px; }
  .text-btn {
    background: none; border: none;
    color: var(--red); cursor: pointer;
    font-family: var(--font-display); font-weight: 700;
    font-size: 0.8rem; letter-spacing: 0.06em;
    text-transform: uppercase; padding: 0;
  }
  .text-btn:hover { color: var(--red-dark); text-decoration: underline; }

  /* ─── Decoration ─── */
  .deco-options {
    display: grid; gap: 10px;
    grid-template-columns: 1fr;
  }
  .deco-opt {
    display: flex; align-items: flex-start; gap: 12px;
    padding: 12px 14px;
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    cursor: pointer;
    background: var(--surface);
    margin: 0; text-transform: none; color: var(--text);
    font-family: var(--font-body); letter-spacing: normal;
    font-weight: normal; font-size: 1rem;
    transition: border-color 0.15s, background 0.15s;
  }
  .deco-opt:hover { border-color: var(--red); }
  .deco-opt.selected { border-color: var(--red); background: var(--red-glow); }
  .deco-opt input { width: auto; margin: 3px 0 0; accent-color: var(--red); }
  .deco-title { font-family: var(--font-display); font-weight: 700; font-size: 0.95rem; }
  .deco-sub { font-size: 0.82rem; color: var(--text-muted); margin-top: 2px; }

  .notes-label { margin-top: 14px; margin-bottom: 6px; }
  textarea { resize: vertical; min-height: 70px; font-family: var(--font-body); }

  /* ─── Summary ─── */
  .summary {
    margin-top: 28px;
    padding: 18px 20px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow);
  }
  .summary-line {
    display: flex; justify-content: space-between; align-items: baseline;
    font-size: 0.95rem; padding: 4px 0;
  }
  .summary-line strong { font-family: var(--font-display); font-size: 1.15rem; font-variant-numeric: tabular-nums; }
  .fine {
    font-size: 0.78rem; color: var(--text-dim);
    margin: 10px 0 14px; line-height: 1.45;
  }
  .err {
    background: rgba(192,57,43,0.1); border: 1px solid rgba(192,57,43,0.3);
    color: var(--red); padding: 8px 12px; border-radius: var(--radius);
    font-size: 0.88rem; margin-bottom: 10px;
  }
  .cta-row { display: flex; gap: 10px; flex-wrap: wrap; }
  .btn.big { padding: 12px 22px; font-size: 0.95rem; }
  .btn.big:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }

  .spinner {
    width: 14px; height: 14px;
    border: 2px solid rgba(0,0,0,0.2);
    border-top-color: var(--red);
    border-radius: 50%;
    display: inline-block; vertical-align: -2px;
    margin-right: 6px;
    animation: spin 0.7s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  .public-footer {
    padding: 24px 28px 36px; text-align: center;
    color: var(--text-muted); font-size: 0.85rem;
    border-top: 1px solid var(--border); background: var(--surface);
  }

  @media (max-width: 820px) {
    .detail-grid { grid-template-columns: 1fr; gap: 18px; }
    .gallery { position: static; aspect-ratio: 1/1; max-width: 480px; }
  }
  @media (max-width: 640px) {
    .public-header { padding: 12px 16px; gap: 12px; }
    .public-nav { display: none; }
    .container { padding: 16px; }
    .info h1 { font-size: 1.4rem; }
  }
</style>
