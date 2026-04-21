<!-- src/routes/shop/+page.svelte -->
<!--
  Public catalog browse + search. Pulls from /api/catalog/search and
  /api/catalog/brands (both no-auth). Renders a responsive grid of
  product cards; clicking one opens /shop/[supplier]/[style].
-->
<script>
  import { onMount } from 'svelte';
  import { api } from '$lib/api/client.js';
  import { cartCount } from '$lib/stores/cart.js';
  import { labelFor, sortCategories } from '$lib/shop/categories.js';
  import { apparelPrice } from '$lib/shop/pricing.js';

  let q = '';
  let selectedBrand = '';
  let selectedSupplier = '';
  let selectedCategory = '';
  let inStockOnly = false;
  let sort = 'name';
  let page = 1;
  const limit = 24;

  let items = [];
  let total = 0;
  let brands = [];
  let categories = [];   // [{category, product_count}, ...] from API
  let loading = false;
  let error = '';
  let debounceHandle = null;

  // Formatters
  const money = (n) =>
    n == null
      ? '—'
      : new Intl.NumberFormat('en-CA', {
          style: 'currency',
          currency: 'CAD',
          minimumFractionDigits: 2
        }).format(n);

  const priceRange = (p) => {
    // Apply retail markup client-side. API still returns wholesale — see #69
    // for the planned move to server-computed retail.
    const minRetail = apparelPrice(p.min_price);
    const maxRetail = apparelPrice(p.max_price);
    if (minRetail == null) return 'Quote on request';
    if (maxRetail == null || maxRetail === minRetail) return `From ${money(minRetail)}`;
    return `${money(minRetail)} – ${money(maxRetail)}`;
  };

  async function loadBrands() {
    try {
      brands = await api.getCatalogBrands();
    } catch (e) {
      // Non-fatal — brand filter will just be empty.
      console.warn('brands load failed', e);
    }
  }

  async function loadCategories() {
    try {
      const rows = await api.getCatalogCategories();
      // Hide the __unclassified bucket from the pill bar once the backfill
      // has run — but show it while some rows are still NULL so we can see
      // progress at a glance during rollout.
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
        brand: selectedBrand || undefined,
        category: selectedCategory || undefined,
        supplier: selectedSupplier || undefined,
        in_stock: inStockOnly ? '1' : undefined,
        sort,
        page,
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

  function pickCategory(cat) {
    // Toggle: clicking the active pill clears it.
    selectedCategory = selectedCategory === cat ? '' : cat;
    page = 1;
    loadProducts();
  }

  function resetToFirstPage() {
    page = 1;
    loadProducts();
  }

  function onSearchInput() {
    clearTimeout(debounceHandle);
    debounceHandle = setTimeout(() => {
      page = 1;
      loadProducts();
    }, 300);
  }

  function goToPage(p) {
    page = p;
    loadProducts();
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  $: totalPages = Math.max(1, Math.ceil(total / limit));
  // "All" pill shows the full catalog count (sum of all categories).
  $: allCount = categories.reduce((sum, c) => sum + (c.product_count || 0), 0);

  onMount(() => {
    loadBrands();
    loadCategories();
    loadProducts();
  });
</script>

<svelte:head>
  <title>Shop — Holm Graphics</title>
  <meta name="description" content="Branded apparel, headwear, and bags. Request a quote for your next custom print or embroidery project." />
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

  <!-- Hero -->
  <section class="hero">
    <div class="hero-inner">
      <h1>Custom apparel &amp; decorated goods</h1>
      <p>
        Browse thousands of blanks from our suppliers, build a quote with your sizes, colours, and
        decoration options — we'll print or embroider and get it back to you fast.
      </p>
    </div>
  </section>

  <!-- Category pill bar -->
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

  <!-- Controls -->
  <section class="controls">
    <div class="search-wrap">
      <svg class="search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="11" cy="11" r="7" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
      <input
        type="search"
        placeholder="Search style, name or description…"
        bind:value={q}
        on:input={onSearchInput}
      />
    </div>

    <div class="filter-group">
      <select bind:value={selectedBrand} on:change={resetToFirstPage}>
        <option value="">All brands</option>
        {#each brands as b}
          <option value={b.brand}>{b.brand} ({b.product_count})</option>
        {/each}
      </select>

      <select bind:value={sort} on:change={resetToFirstPage}>
        <option value="name">Name (A–Z)</option>
        <option value="price_asc">Price: low to high</option>
        <option value="price_desc">Price: high to low</option>
        <option value="newest">Newest</option>
      </select>

      <label class="check">
        <input type="checkbox" bind:checked={inStockOnly} on:change={resetToFirstPage} />
        In stock only
      </label>
    </div>
  </section>

  <!-- Results meta -->
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

  <!-- Grid -->
  {#if !loading && items.length === 0 && !error}
    <div class="empty">
      <p>No products match those filters.</p>
      <button class="btn btn-ghost" on:click={() => { q = ''; selectedBrand = ''; selectedCategory = ''; inStockOnly = false; resetToFirstPage(); }}>
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

  <!-- Pagination -->
  {#if totalPages > 1}
    <nav class="pager">
      <button class="btn btn-ghost" disabled={page <= 1} on:click={() => goToPage(page - 1)}>
        ← Prev
      </button>
      <span class="page-indicator">Page {page} of {totalPages}</span>
      <button class="btn btn-ghost" disabled={page >= totalPages} on:click={() => goToPage(page + 1)}>
        Next →
      </button>
    </nav>
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
  .hero-inner { max-width: 820px; }
  .hero h1 {
    font-family: var(--font-display);
    font-size: 2.2rem; font-weight: 900; letter-spacing: 0.02em;
    margin-bottom: 10px;
  }
  .hero p { color: rgba(255,255,255,0.75); font-size: 1rem; max-width: 640px; line-height: 1.55; }

  /* ─── Category pill bar ─── */
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

  /* ─── Controls ─── */
  .controls {
    display: flex; flex-wrap: wrap; gap: 12px;
    padding: 20px 28px; background: var(--surface);
    border-bottom: 1px solid var(--border);
    align-items: center;
  }
  .search-wrap {
    position: relative; flex: 1 1 280px; min-width: 240px;
  }
  .search-wrap input { padding-left: 38px; }
  .search-icon {
    position: absolute; left: 12px; top: 50%; transform: translateY(-50%);
    color: var(--text-dim);
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

  /* ─── Grid ─── */
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
  .product-image img {
    width: 100%; height: 100%; object-fit: cover; display: block;
  }
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

  @media (max-width: 640px) {
    .public-header { padding: 12px 16px; gap: 12px; }
    .public-nav { display: none; }
    .hero { padding: 36px 16px 28px; }
    .hero h1 { font-size: 1.6rem; }
    .category-bar { padding: 12px 16px; }
    .controls { padding: 14px 16px; }
    .results-meta { padding: 14px 16px 0; }
    .grid { padding: 14px 16px 40px; gap: 12px; }
  }
</style>
