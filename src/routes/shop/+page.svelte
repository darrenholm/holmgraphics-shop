<!-- src/routes/shop/+page.svelte -->
<!--
  Public catalog: category-first home + URL-driven browse.

  Two modes, switched via the URL (no client routing logic — the URL is
  the source of truth so back/forward and shareable links Just Work):

    /shop/                    HOME — hero, search, big category cards.
    /shop/?category=t-shirts  BROWSE — filters + product grid for that bucket.
    /shop/?q=ATC1000          BROWSE — search results across the whole catalog.
    /shop/?category=...&q=... BROWSE — both filters applied.

  Brand / sort / in-stock filters live on the browse view (with the
  existing pill bar so customers can switch laterally between buckets).
-->
<script>
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { api } from '$lib/api/client.js';
  import { itemCount as dtfItemCount } from '$lib/stores/dtf-cart.js';
  import { labelFor, sortCategories } from '$lib/shop/categories.js';
  import { apparelPrice } from '$lib/shop/pricing.js';

  // ─── URL-driven state ──────────────────────────────────────────────────────
  // Read everything off the URL so back/forward navigation, shareable links,
  // and the home<->browse transition all flow through the same code path.
  $: searchParams    = $page.url.searchParams;
  $: selectedCategory = searchParams.get('category') || '';
  $: q                = searchParams.get('q') || '';
  $: selectedBrand    = searchParams.get('brand') || '';
  $: sort             = searchParams.get('sort') || 'name';
  $: inStockOnly      = searchParams.get('in_stock') === '1';
  $: pageNum          = Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1);
  // Home mode = nothing's narrowing. Brand-only counts as browse so a brand
  // filter alone shows results too.
  $: isHome = !selectedCategory && !q && !selectedBrand;

  // Local mirror of the search box so debounced typing doesn't fight the URL
  // sync. We only push qInput → URL after the debounce fires.
  let qInput = '';
  let lastUrlQ = null;
  $: if (q !== lastUrlQ) { qInput = q; lastUrlQ = q; }

  let items = [];
  let total = 0;
  let brands = [];
  let categories = [];          // [{category, product_count}, ...] from API
  let imgFailed = {};           // category slug -> true once /categories/<slug>.jpg 404s
  let loading = false;
  let error = '';
  let debounceHandle = null;
  const limit = 24;

  // ─── Curated category hero images ──────────────────────────────────────────
  // One static JPG per category bucket lives in static/categories/. Filenames
  // mirror the canonical category slug from suppliers/sanmar/category-map.js
  // so adding a new bucket is a one-step change: drop the file and it shows
  // up automatically. No DB or API calls.
  //
  // TODO(images): drop these files into static/categories/ — names match the
  // canonical slugs used in supplier_product.category, NOT the user-facing
  // labels:
  //
  //     t-shirts.jpg     polos.jpg        woven-shirts.jpg
  //     fleece.jpg       outerwear.jpg    headwear.jpg
  //     activewear.jpg   bottoms.jpg      bags.jpg
  //     workwear.jpg     accessories.jpg  youth.jpg
  //     ladies.jpg       other.jpg
  //
  // (Spec listed `fleece-hoodies.jpg` and omitted polos/bottoms/ladies — but
  // the helper below derives the filename deterministically from the slug,
  // so name your files to match the slugs. Recommended size: 800×600 (4:3),
  // ~80% JPEG quality, sRGB. Cards are content-cropped via object-fit:cover.)
  //
  // Until the files land, every img will 404 and the on:error handler swaps
  // each card to the placeholder SVG. Self-recovering -- no broken UI in
  // the interim.
  function categoryImage(cat) {
    return `/categories/${cat}.jpg`;
  }

  // ─── Formatters (unchanged from before) ────────────────────────────────────
  const money = (n) =>
    n == null
      ? '—'
      : new Intl.NumberFormat('en-CA', {
          style: 'currency',
          currency: 'CAD',
          minimumFractionDigits: 2
        }).format(n);

  const priceRange = (p) => {
    const minRetail = apparelPrice(p.min_price);
    const maxRetail = apparelPrice(p.max_price);
    if (minRetail == null) return 'Quote on request';
    if (maxRetail == null || maxRetail === minRetail) return `From ${money(minRetail)}`;
    return `${money(minRetail)} – ${money(maxRetail)}`;
  };

  // ─── Loaders ───────────────────────────────────────────────────────────────
  async function loadBrands() {
    try { brands = await api.getCatalogBrands(); }
    catch (e) { console.warn('brands load failed', e); }
  }

  async function loadCategories() {
    try {
      const rows = await api.getCatalogCategories();
      categories = sortCategories(rows || []).filter((r) => r.product_count > 0);
    } catch (e) {
      console.warn('categories load failed', e);
    }
  }

  async function loadProducts() {
    loading = true;
    error = '';
    try {
      const res = await api.getCatalogSearch({
        q,
        brand:    selectedBrand || undefined,
        category: selectedCategory || undefined,
        in_stock: inStockOnly ? '1' : undefined,
        sort,
        page:     pageNum,
        limit
      });
      items = res.items || [];
      total = res.total || 0;
    } catch (e) {
      error = e.message || 'Could not load products.';
      items = [];
      total = 0;
    } finally {
      loading = false;
    }
  }

  // ─── Navigation helpers ────────────────────────────────────────────────────
  // All state changes go through navTo() so the URL stays the source of truth.
  // replace=true skips a history entry — used for live-typed search so the
  // back button doesn't have to walk through every keystroke.
  function navTo({ category, q: nq, brand, sort: nsort, in_stock, page: np, replace = false } = {}) {
    const sp = new URLSearchParams();
    if (category)             sp.set('category', category);
    if (nq)                   sp.set('q', nq);
    if (brand)                sp.set('brand', brand);
    if (nsort && nsort !== 'name') sp.set('sort', nsort);
    if (in_stock)             sp.set('in_stock', '1');
    if (np && np > 1)         sp.set('page', String(np));
    const url = '/shop/' + (sp.toString() ? '?' + sp.toString() : '');
    goto(url, { replaceState: replace, keepFocus: true, noScroll: true });
  }

  function pickCategory(cat) {
    navTo({ category: cat, q, brand: selectedBrand, sort, in_stock: inStockOnly });
  }

  function clearAll() {
    qInput = '';
    goto('/shop/');
  }

  function onSearchInput() {
    clearTimeout(debounceHandle);
    debounceHandle = setTimeout(() => {
      // Don't churn URL if nothing changed.
      if (qInput === q) return;
      navTo({
        category: selectedCategory,
        q: qInput,
        brand: selectedBrand,
        sort,
        in_stock: inStockOnly,
        replace: true
      });
    }, 300);
  }

  function changeBrand() {
    navTo({ category: selectedCategory, q, brand: selectedBrand, sort, in_stock: inStockOnly });
  }
  function changeSort() {
    navTo({ category: selectedCategory, q, brand: selectedBrand, sort, in_stock: inStockOnly });
  }
  function toggleInStock() {
    navTo({ category: selectedCategory, q, brand: selectedBrand, sort, in_stock: inStockOnly });
  }

  function goToPage(p) {
    navTo({ category: selectedCategory, q, brand: selectedBrand, sort, in_stock: inStockOnly, page: p });
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ─── Reactive product loading ──────────────────────────────────────────────
  // Watch URL state. On any change to the filtering set, reload — but ONLY
  // in browse mode. Home mode skips the products call entirely and just
  // shows the cards.
  let lastQueryKey = '';
  $: {
    const key = JSON.stringify({ selectedCategory, q, selectedBrand, sort, inStockOnly, pageNum });
    if (!isHome && key !== lastQueryKey) {
      lastQueryKey = key;
      loadProducts();
    }
  }

  $: totalPages = Math.max(1, Math.ceil(total / limit));
  $: allCount = categories.reduce((sum, c) => sum + (c.product_count || 0), 0);

  // ─── Mount ─────────────────────────────────────────────────────────────────
  onMount(async () => {
    qInput = q;
    await Promise.all([loadCategories(), loadBrands()]);
    // Hero images are static now (see categoryImage()). No per-bucket API
    // call -- saves ~13 round trips on home-page load vs the previous
    // sample-fetch implementation.
  });

  // Categories that get a card on the home page. __unclassified is shown
  // as a small footer link instead, per the spec.
  $: cardCategories = categories.filter(
    (c) => c.category !== '__unclassified' && c.product_count > 0
  );
  $: unclassified = categories.find((c) => c.category === '__unclassified');
</script>

<svelte:head>
  <title>{isHome ? 'Shop' : labelFor(selectedCategory) || 'Shop'} — Holm Graphics</title>
  <meta name="description" content="Branded apparel, headwear, and bags. Browse by category or request a quote for your next custom print or embroidery project." />
</svelte:head>

<div class="shop-shell">
  <!-- Public top bar -->
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
    <a href="/shop/cart" class="quote-btn">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M6 2l1 18a2 2 0 002 2h6a2 2 0 002-2l1-18" />
        <path d="M3 6h18" />
      </svg>
      Cart
      {#if $dtfItemCount > 0}
        <span class="quote-pill">{$dtfItemCount}</span>
      {/if}
    </a>
  </header>

  <!-- Hero (slimmer on browse mode) -->
  <section class="hero" class:hero-compact={!isHome}>
    <div class="hero-inner">
      {#if isHome}
        <h1>Custom apparel &amp; decorated goods</h1>
        <p>
          Browse by category, or jump straight to a style if you know the number.
          Build a quote with your sizes, colours, and decoration options — we'll
          print or embroider and get it back to you fast.
        </p>
      {:else}
        <h1>{labelFor(selectedCategory) || 'Search results'}</h1>
        {#if q}
          <p>Showing matches for "<strong>{q}</strong>"{selectedCategory ? ` in ${labelFor(selectedCategory)}` : ''}.</p>
        {/if}
      {/if}
    </div>
  </section>

  <!-- Search bar — visible in both modes so power users can jump straight in. -->
  <section class="search-row">
    <div class="search-wrap">
      <svg class="search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="11" cy="11" r="7" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
      <input
        type="search"
        placeholder="Search style number, name, or description (e.g. ATC1000)…"
        bind:value={qInput}
        on:input={onSearchInput}
        aria-label="Search products"
      />
    </div>
    {#if !isHome}
      <button type="button" class="btn-text-link" on:click={clearAll}>← Back to all categories</button>
    {/if}
  </section>

  {#if isHome}
    <!-- ════════ HOME: category-first grid ════════ -->
    {#if categories.length === 0}
      <div class="empty">
        <p>Loading categories…</p>
      </div>
    {:else}
      <section class="category-grid-section">
        <h2 class="section-heading">Shop by category</h2>
        <div class="category-grid">
          {#each cardCategories as c (c.category)}
            <a class="category-card" href={`/shop/?category=${encodeURIComponent(c.category)}`}>
              <div class="category-card-image">
                {#if !imgFailed[c.category]}
                  <!-- on:error fires once per image; flipping imgFailed[cat]
                       swaps to the placeholder for that card without
                       affecting siblings or triggering a re-fetch. -->
                  <img
                    src={categoryImage(c.category)}
                    alt=""
                    loading="lazy"
                    on:error={() => imgFailed = { ...imgFailed, [c.category]: true }}
                  />
                {:else}
                  <div class="category-card-placeholder" aria-hidden="true">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2">
                      <rect x="3" y="3" width="18" height="18" rx="2" />
                      <circle cx="8.5" cy="8.5" r="1.5" />
                      <polyline points="21 15 16 10 5 21" />
                    </svg>
                  </div>
                {/if}
              </div>
              <div class="category-card-body">
                <div class="category-card-name">{labelFor(c.category)}</div>
                <div class="category-card-count">{c.product_count.toLocaleString()} {c.product_count === 1 ? 'style' : 'styles'}</div>
              </div>
            </a>
          {/each}
        </div>
        {#if unclassified && unclassified.product_count > 0}
          <p class="unclassified-link">
            Looking for something not in a category?
            <a href="/shop/?category=__unclassified">Browse {unclassified.product_count.toLocaleString()} unclassified item{unclassified.product_count === 1 ? '' : 's'} →</a>
          </p>
        {/if}
      </section>
    {/if}
  {:else}
    <!-- ════════ BROWSE: pill bar + filters + grid + pagination ════════ -->
    {#if categories.length > 0}
      <nav class="category-bar" aria-label="Filter by category">
        <button
          type="button"
          class="category-pill"
          class:active={!selectedCategory}
          on:click={() => pickCategory('')}
        >
          All <span class="count">{(allCount || total).toLocaleString()}</span>
        </button>
        {#each categories as c (c.category)}
          <button
            type="button"
            class="category-pill"
            class:active={selectedCategory === c.category}
            on:click={() => pickCategory(c.category)}
          >
            {labelFor(c.category)} <span class="count">{c.product_count.toLocaleString()}</span>
          </button>
        {/each}
      </nav>
    {/if}

    <section class="controls">
      <div class="filter-group">
        <select bind:value={selectedBrand} on:change={changeBrand}>
          <option value="">All brands</option>
          {#each brands as b}
            <option value={b.brand}>{b.brand} ({b.product_count})</option>
          {/each}
        </select>

        <select bind:value={sort} on:change={changeSort}>
          <option value="name">Name (A–Z)</option>
          <option value="price_asc">Price: low to high</option>
          <option value="price_desc">Price: high to low</option>
          <option value="newest">Newest</option>
        </select>

        <label class="check">
          <input type="checkbox" bind:checked={inStockOnly} on:change={toggleInStock} />
          In stock only
        </label>
      </div>
    </section>

    <div class="results-meta">
      {#if loading}
        Loading…
      {:else if error}
        <span class="error">{error}</span>
      {:else}
        {total.toLocaleString()} {total === 1 ? 'product' : 'products'}
        {#if q}for "{q}"{/if}
      {/if}
    </div>

    {#if !loading && items.length === 0 && !error}
      <div class="empty">
        <p>No products match those filters.</p>
        <button class="btn btn-ghost" on:click={clearAll}>
          Clear filters
        </button>
      </div>
    {/if}

    <div class="grid" class:dim={loading}>
      {#each items as p (p.id)}
        <a class="product-card" href={`/shop/${p.supplier}/${encodeURIComponent(p.style)}/`}>
          <div class="product-image">
            {#if p.image_url}
              <img src={p.image_url} alt={p.product_name || p.style} loading="lazy" referrerpolicy="no-referrer" />
            {:else}
              <div class="no-image">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <circle cx="8.5" cy="8.5" r="1.5" />
                  <polyline points="21 15 16 10 5 21" />
                </svg>
                <span>No image</span>
              </div>
            {/if}
            {#if p.is_blocked_from_blank_sale}
              <span class="badge-decorate">Decoration required</span>
            {/if}
            {#if !p.has_stock}
              <span class="badge-oos">Low / out of stock</span>
            {/if}
          </div>
          <div class="product-body">
            <div class="product-brand">{p.brand || p.supplier_name}</div>
            <div class="product-name">{p.product_name || p.style}</div>
            <div class="product-meta">
              <span class="style">#{p.style}</span>
              {#if p.color_count > 0}
                <span class="dot">•</span>
                <span>{p.color_count} {p.color_count === 1 ? 'colour' : 'colours'}</span>
              {/if}
            </div>
            <div class="product-price">{priceRange(p)}</div>
          </div>
        </a>
      {/each}
    </div>

    {#if totalPages > 1}
      <nav class="pager">
        <button class="btn btn-ghost" disabled={pageNum <= 1} on:click={() => goToPage(pageNum - 1)}>
          ← Prev
        </button>
        <span class="page-indicator">Page {pageNum} of {totalPages}</span>
        <button class="btn btn-ghost" disabled={pageNum >= totalPages} on:click={() => goToPage(pageNum + 1)}>
          Next →
        </button>
      </nav>
    {/if}
  {/if}

  <footer class="public-footer">
    <p>Holm Graphics Inc. · Walkerton, Ontario · <a href="tel:5195073001">519-507-3001</a> · <a href="mailto:brady@holmgraphics.ca">brady@holmgraphics.ca</a></p>
    <p class="fine">Prices shown are supplier blank pricing in CAD. Decoration, setup, and applicable taxes quoted separately.</p>
  </footer>
</div>

<style>
  .shop-shell {
    min-height: 100vh;
    background: var(--black);
    color: var(--text);
  }

  /* ─── Header ─── */
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
    font-family: var(--font-display);
    font-size: 0.82rem; font-weight: 600; letter-spacing: 0.08em;
    color: var(--text-muted); text-transform: uppercase; text-decoration: none;
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
  .quote-pill {
    background: #fff; color: var(--red);
    border-radius: 999px; padding: 1px 8px;
    font-size: 0.72rem; font-weight: 900;
  }

  /* ─── Hero ─── */
  .hero {
    background: linear-gradient(135deg, #1a1a1a 0%, #2b2b2b 100%);
    color: #fff;
    padding: 56px 28px 44px;
  }
  .hero-compact { padding: 32px 28px 24px; }
  .hero-inner { max-width: 820px; }
  .hero h1 {
    font-family: var(--font-display);
    font-size: 2.2rem; font-weight: 900; letter-spacing: 0.02em;
    margin-bottom: 10px;
  }
  .hero-compact h1 { font-size: 1.6rem; margin-bottom: 4px; }
  .hero p { color: rgba(255,255,255,0.75); font-size: 1rem; max-width: 640px; line-height: 1.55; }

  /* ─── Search row ─── */
  .search-row {
    display: flex; gap: 16px; align-items: center;
    padding: 18px 28px;
    background: var(--surface);
    border-bottom: 1px solid var(--border);
    flex-wrap: wrap;
  }
  .search-wrap {
    position: relative; flex: 1 1 320px; min-width: 240px;
  }
  .search-wrap input { padding-left: 38px; width: 100%; }
  .search-icon {
    position: absolute; left: 12px; top: 50%; transform: translateY(-50%);
    color: var(--text-dim);
  }
  .btn-text-link {
    background: none; border: none;
    color: var(--text-muted); cursor: pointer;
    font-family: var(--font-display); font-size: 0.82rem;
    text-transform: uppercase; letter-spacing: 0.06em;
  }
  .btn-text-link:hover { color: var(--red); }

  /* ─── Category cards (HOME) ─── */
  .category-grid-section {
    padding: 32px 28px 48px;
  }
  .section-heading {
    font-family: var(--font-display);
    font-size: 1.1rem;
    font-weight: 700;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--text-muted);
    margin: 0 0 20px;
  }
  .category-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 18px;
  }
  .category-card {
    display: flex;
    flex-direction: column;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    overflow: hidden;
    text-decoration: none;
    color: inherit;
    transition: transform 0.15s, box-shadow 0.15s, border-color 0.15s;
  }
  .category-card:hover {
    border-color: var(--red);
    box-shadow: var(--shadow-lg);
    transform: translateY(-2px);
  }
  .category-card-image {
    aspect-ratio: 4/3;
    background: var(--surface-3);
    overflow: hidden;
  }
  .category-card-image img {
    width: 100%; height: 100%; object-fit: cover; display: block;
  }
  .category-card-placeholder {
    width: 100%; height: 100%;
    display: flex; align-items: center; justify-content: center;
    color: var(--text-dim);
  }
  .category-card-body {
    padding: 16px 18px 18px;
    display: flex; flex-direction: column; gap: 4px;
  }
  .category-card-name {
    font-family: var(--font-display);
    font-size: 1.15rem;
    font-weight: 800;
    letter-spacing: 0.02em;
    color: var(--text);
  }
  .category-card-count {
    font-family: var(--font-display);
    font-size: 0.78rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-muted);
  }
  .unclassified-link {
    margin-top: 28px;
    text-align: center;
    color: var(--text-dim);
    font-size: 0.85rem;
  }
  .unclassified-link a {
    color: var(--text-muted);
    text-decoration: underline;
    text-decoration-color: var(--border);
    text-underline-offset: 3px;
  }
  .unclassified-link a:hover { color: var(--red); text-decoration-color: var(--red); }

  /* ─── Category pill bar (BROWSE) ─── */
  .category-bar {
    display: flex;
    gap: 8px;
    padding: 16px 28px;
    background: var(--surface);
    border-bottom: 1px solid var(--border);
    overflow-x: auto;
    scrollbar-width: thin;
    -webkit-overflow-scrolling: touch;
  }
  .category-bar::-webkit-scrollbar { height: 6px; }
  .category-bar::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }

  .category-pill {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 7px 14px;
    background: transparent;
    border: 1px solid var(--border);
    border-radius: 999px;
    color: var(--text-muted);
    font-family: var(--font-display);
    font-size: 0.78rem;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    cursor: pointer;
    white-space: nowrap;
    transition: background 0.12s, color 0.12s, border-color 0.12s;
  }
  .category-pill:hover { color: var(--text); border-color: var(--text-muted); }
  .category-pill.active {
    background: var(--red);
    border-color: var(--red);
    color: #fff;
  }
  .category-pill .count {
    font-size: 0.7rem;
    opacity: 0.75;
    font-weight: 500;
  }
  .category-pill.active .count { opacity: 0.95; }

  /* ─── Filter controls (BROWSE) ─── */
  .controls {
    display: flex; flex-wrap: wrap; gap: 12px;
    padding: 16px 28px; background: var(--surface);
    border-bottom: 1px solid var(--border);
    align-items: center;
  }
  .filter-group { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
  .filter-group select { width: auto; min-width: 160px; }
  .check {
    display: inline-flex; align-items: center; gap: 6px;
    font-family: var(--font-display); font-size: 0.82rem;
    text-transform: uppercase; letter-spacing: 0.06em;
    color: var(--text-muted); margin: 0; white-space: nowrap;
  }
  .check input { width: auto; margin: 0; }

  .results-meta {
    padding: 16px 28px 0;
    font-family: var(--font-display);
    font-size: 0.85rem; letter-spacing: 0.05em;
    text-transform: uppercase; color: var(--text-muted);
  }
  .results-meta .error { color: var(--red); }

  /* ─── Product grid (BROWSE) ─── */
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 18px;
    padding: 18px 28px 48px;
    transition: opacity 0.2s;
  }
  .grid.dim { opacity: 0.5; }

  .product-card {
    display: flex; flex-direction: column;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    overflow: hidden; text-decoration: none; color: inherit;
    transition: transform 0.15s, box-shadow 0.15s, border-color 0.15s;
  }
  .product-card:hover {
    border-color: var(--red);
    box-shadow: var(--shadow-lg);
    transform: translateY(-2px);
  }
  .product-image {
    aspect-ratio: 1/1;
    background: var(--surface-3);
    position: relative;
    overflow: hidden;
  }
  .product-image img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .no-image {
    width: 100%; height: 100%;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    color: var(--text-dim); gap: 8px;
    font-family: var(--font-display); font-size: 0.75rem; letter-spacing: 0.1em;
    text-transform: uppercase;
  }
  .badge-decorate,
  .badge-oos {
    position: absolute; top: 10px; left: 10px;
    background: #1a1a1a; color: #fff;
    padding: 3px 10px; border-radius: 999px;
    font-family: var(--font-display); font-size: 0.68rem;
    font-weight: 700; letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .badge-oos { background: var(--amber); top: auto; bottom: 10px; left: 10px; }

  .product-body { padding: 12px 14px 14px; display: flex; flex-direction: column; gap: 4px; }
  .product-brand {
    font-family: var(--font-display);
    font-size: 0.72rem; font-weight: 700; letter-spacing: 0.12em;
    text-transform: uppercase; color: var(--red);
  }
  .product-name {
    font-family: var(--font-display); font-weight: 700;
    font-size: 1rem; line-height: 1.25; color: var(--text);
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .product-meta {
    font-size: 0.8rem; color: var(--text-muted);
    display: flex; gap: 8px; align-items: center;
  }
  .style { font-variant-numeric: tabular-nums; }
  .dot { opacity: 0.5; }
  .product-price {
    margin-top: 4px;
    font-family: var(--font-display); font-weight: 700;
    font-size: 0.95rem; color: var(--text);
  }

  /* ─── Pager ─── */
  .pager {
    display: flex; align-items: center; gap: 16px;
    justify-content: center; padding: 0 28px 40px;
  }
  .page-indicator {
    font-family: var(--font-display); font-size: 0.85rem;
    letter-spacing: 0.05em; color: var(--text-muted);
    text-transform: uppercase;
  }

  /* ─── Empty ─── */
  .empty {
    padding: 60px 28px;
    text-align: center;
    color: var(--text-muted);
    display: flex; flex-direction: column; align-items: center; gap: 14px;
  }

  /* ─── Footer ─── */
  .public-footer {
    padding: 24px 28px 36px;
    text-align: center;
    color: var(--text-muted);
    font-size: 0.85rem;
    border-top: 1px solid var(--border);
    background: var(--surface);
  }
  .public-footer .fine { font-size: 0.75rem; color: var(--text-dim); margin-top: 6px; }

  /* ─── Responsive ─── */
  /* Tablets: 2 across */
  @media (max-width: 980px) {
    .category-grid { grid-template-columns: repeat(3, 1fr); }
  }
  @media (max-width: 760px) {
    .category-grid { grid-template-columns: repeat(2, 1fr); }
  }
  /* Phones: stack 1 across */
  @media (max-width: 480px) {
    .category-grid { grid-template-columns: 1fr; }
  }

  @media (max-width: 640px) {
    .public-header { padding: 12px 16px; gap: 12px; }
    .public-nav { display: none; }
    .hero { padding: 36px 16px 28px; }
    .hero h1 { font-size: 1.6rem; }
    .hero-compact { padding: 24px 16px 18px; }
    .hero-compact h1 { font-size: 1.3rem; }
    .search-row { padding: 14px 16px; }
    .category-grid-section { padding: 24px 16px 36px; }
    .category-bar { padding: 12px 16px; }
    .controls { padding: 14px 16px; }
    .results-meta { padding: 14px 16px 0; }
    .grid { padding: 14px 16px 40px; gap: 12px; }
  }
</style>
