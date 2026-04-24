<!-- src/routes/shop/cart/+page.svelte
     The new DTF online-store cart. Replaces the legacy /shop/quote
     mailto-builder for actual online orders. /shop/quote stays around
     for B2B "Request a Quote" submissions that don't go through inline
     payment. -->
<script>
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { dtfCart, itemCount, isEmpty } from '$lib/stores/dtf-cart.js';
  import { customerApi } from '$lib/api/customer-client.js';
  import { customer } from '$lib/stores/customer-auth.js';

  let printLocations = [];      // [{ id, garment_category, name, max_width_in, max_height_in, tiers }]
  let customTiers    = [];
  let configError = '';

  let pricing = null;           // { items_subtotal, decorations_subtotal, ... }
  let pricingLoading = false;
  let pricingError = '';

  let designNameInput = '';
  let pendingFile = null;

  const money = (n) =>
    n == null ? '—' : new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(n);

  onMount(async () => {
    try {
      const [locs, ct] = await Promise.all([
        customerApi.getPrintLocations(),
        customerApi.getCustomTiers(),
      ]);
      printLocations = locs.print_locations || [];
      customTiers    = ct.tiers || [];
    } catch (e) {
      configError = e.message;
    }
  });

  function locationsForCategory(cat) {
    return printLocations.filter((l) => l.garment_category === (cat || 'apparel'));
  }

  // Re-quote whenever the cart changes. Debounced.
  let quoteHandle = null;
  $: if ($dtfCart) {
    clearTimeout(quoteHandle);
    quoteHandle = setTimeout(refreshQuote, 250);
  }

  async function refreshQuote() {
    if ($isEmpty) { pricing = null; return; }
    pricingLoading = true;
    pricingError = '';
    try {
      // Pickup pricing — checkout will re-quote with shipping.
      const res = await customerApi.quoteCart($dtfCart, {}, 'pickup', 0);
      pricing = res.breakdown;
    } catch (e) {
      pricingError = e.message;
    } finally {
      pricingLoading = false;
    }
  }

  function handleFile(e) {
    const f = e.target.files?.[0];
    pendingFile = f || null;
    if (f && !designNameInput) designNameInput = f.name.replace(/\.[^.]+$/, '');
  }

  function addDesign() {
    if (!pendingFile) { alert('Pick an artwork file first.'); return; }
    if (pendingFile.size > 50 * 1024 * 1024) { alert('Files must be 50 MB or less.'); return; }
    dtfCart.addDesign(designNameInput.trim() || pendingFile.name, pendingFile);
    pendingFile = null;
    designNameInput = '';
    const inp = document.getElementById('designFileInput');
    if (inp) inp.value = '';
  }

  function addDecoration(itemId, designId) {
    if (!designId) return;
    dtfCart.addDecoration(itemId, {
      design_id: designId,
      print_location_id: null,
      custom_location: '',
      width_in: null,
      height_in: null,
    });
  }

  function setLocation(itemId, decId, value) {
    if (value === 'custom') {
      dtfCart.updateDecoration(itemId, decId, { print_location_id: null });
    } else {
      const id = parseInt(value, 10);
      dtfCart.updateDecoration(itemId, decId, {
        print_location_id: id,
        custom_location: '',
        width_in: null,
        height_in: null,
      });
    }
  }

  async function goToCheckout() {
    if (!$customer) {
      goto(`/shop/login?return=${encodeURIComponent('/shop/checkout')}`);
      return;
    }
    goto('/shop/checkout');
  }

  async function requestQuote() {
    // B2B path. Stub for now — wire to /api/orders/quote-request later.
    alert('Quote requests coming soon. For now, please email darren@holmgraphics.ca with the cart contents.');
  }
</script>

<svelte:head><title>Cart — Holm Graphics</title></svelte:head>

<div class="cart-page">
  <h1>Your Cart {#if $itemCount}<small>({$itemCount} pcs)</small>{/if}</h1>

  {#if configError}<div class="alert error">Pricing config didn't load: {configError}</div>{/if}

  {#if $isEmpty}
    <div class="empty">
      <p>Your cart is empty.</p>
      <a href="/shop" class="btn">Browse the catalog</a>
    </div>
  {:else}
    <div class="cart-grid">
      <section class="items">
        <h2>Garments</h2>
        {#each $dtfCart.items as item (item.id)}
          <div class="item-card">
            <div class="item-head">
              <div>
                <strong>{item.product_name || `${item.style}`}</strong>
                <span class="muted">{item.color_name} / {item.size}</span>
              </div>
              <button class="link-btn danger" on:click={() => dtfCart.removeItem(item.id)}>Remove</button>
            </div>
            <div class="item-body">
              <label class="qty">
                Qty
                <input type="number" min="1" max="999" value={item.quantity}
                       on:input={(e) => dtfCart.setQuantity(item.id, e.target.value)} />
              </label>
              <div class="line-price">{money(item.unit_price * item.quantity)}</div>
            </div>

            <div class="decorations">
              <h3>Decorations</h3>
              {#each item.decorations as dec (dec.id)}
                <div class="dec-row">
                  <select on:change={(e) => {
                    const v = e.target.value;
                    if (v === '__design__') return;
                    if (v === '__remove__') { dtfCart.removeDecoration(item.id, dec.id); return; }
                    dtfCart.updateDecoration(item.id, dec.id, { design_id: v });
                  }}>
                    <option value="__design__">Design…</option>
                    {#each $dtfCart.designs as d}
                      <option value={d.id} selected={dec.design_id === d.id}>{d.name}</option>
                    {/each}
                  </select>

                  <select on:change={(e) => setLocation(item.id, dec.id, e.target.value)}>
                    <option value="">Location…</option>
                    {#each locationsForCategory(item.garment_category) as loc}
                      <option value={loc.id} selected={dec.print_location_id === loc.id}>
                        {loc.name} (max {loc.max_width_in}×{loc.max_height_in})
                      </option>
                    {/each}
                    <option value="custom" selected={dec.print_location_id == null}>Other (custom)…</option>
                  </select>

                  {#if dec.print_location_id == null}
                    <input class="dim" type="text" placeholder="Where on garment?"
                           value={dec.custom_location || ''}
                           on:input={(e) => dtfCart.updateDecoration(item.id, dec.id, { custom_location: e.target.value })} />
                    <input class="dim" type="number" placeholder="W (in)" step="0.25" min="0.5"
                           value={dec.width_in || ''}
                           on:input={(e) => dtfCart.updateDecoration(item.id, dec.id, { width_in: parseFloat(e.target.value) || null })} />
                    <input class="dim" type="number" placeholder="H (in)" step="0.25" min="0.5"
                           value={dec.height_in || ''}
                           on:input={(e) => dtfCart.updateDecoration(item.id, dec.id, { height_in: parseFloat(e.target.value) || null })} />
                  {/if}

                  <button class="link-btn danger" on:click={() => dtfCart.removeDecoration(item.id, dec.id)}>×</button>
                </div>
              {/each}

              <button class="link-btn" on:click={() => addDecoration(item.id, $dtfCart.designs[0]?.id)}>
                + Add decoration
              </button>
            </div>
          </div>
        {/each}
      </section>

      <section class="designs">
        <h2>Designs / Artwork</h2>
        <p class="hint">Upload your logos here, then drop them onto each garment above.</p>

        {#each $dtfCart.designs as d (d.id)}
          <div class="design-row">
            <span>🎨</span>
            <strong>{d.name}</strong>
            <span class="muted small">{d.filename} · {(d.size_bytes/1024).toFixed(0)} KB</span>
            {#if !d._file}
              <span class="warn">re-pick file</span>
            {/if}
            <button class="link-btn danger" on:click={() => dtfCart.removeDesign(d.id)}>×</button>
          </div>
        {/each}

        <div class="add-design">
          <input id="designFileInput" type="file"
                 accept=".png,.jpg,.jpeg,.pdf,.svg,.ai,.eps,.psd,.tif,.tiff,.webp,.gif"
                 on:change={handleFile} />
          <input type="text" placeholder="Name this design (e.g. Front logo)" bind:value={designNameInput} />
          <button class="btn" on:click={addDesign} disabled={!pendingFile}>Add design</button>
        </div>
      </section>

      <aside class="summary">
        <h2>Order summary</h2>
        {#if pricingLoading}
          <p class="muted">Calculating…</p>
        {:else if pricingError}
          <p class="alert error">{pricingError}</p>
        {:else if pricing}
          <div class="row"><span>Garments</span><span>{money(pricing.items_subtotal)}</span></div>
          <div class="row"><span>Decorations</span><span>{money(pricing.decorations_subtotal)}</span></div>
          {#if pricing.setup_total > 0}
            <div class="row"><span>Setup</span><span>{money(pricing.setup_total)}</span></div>
          {/if}
          <div class="row sub"><span>Subtotal</span><span>{money(pricing.subtotal)}</span></div>
          <p class="muted small">Shipping &amp; tax calculated at checkout.</p>
          {#if pricing.warnings?.length}
            {#each pricing.warnings as w}
              <p class="alert warn">{w}</p>
            {/each}
          {/if}
        {/if}

        <button class="btn primary" on:click={goToCheckout}
                disabled={$isEmpty || pricingLoading || $dtfCart.designs.length === 0}>
          Pay Now
        </button>
        <button class="btn ghost" on:click={requestQuote}>
          Request a Quote (B2B)
        </button>

        <p class="hint small">
          By clicking Pay Now you'll be charged immediately. We'll send a proof
          for your approval before printing — full refund if you cancel before
          production starts.
        </p>
      </aside>
    </div>
  {/if}
</div>

<style>
  .cart-page { max-width: 72rem; margin: 0 auto; padding: 2rem 1rem; }
  h1 { margin: 0 0 1.5rem; }
  h1 small { color: #888; font-weight: 400; font-size: 1rem; }
  h2 { font-size: 1.1rem; margin: 0 0 1rem; }
  h3 { font-size: 0.95rem; margin: 1rem 0 0.5rem; color: #555; }

  .empty { text-align: center; padding: 4rem 0; color: #555; }
  .btn { display: inline-block; padding: 0.7rem 1.25rem; background: #c01818; color: white; border: none; border-radius: 0.4rem; font-weight: 600; text-decoration: none; cursor: pointer; }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn.ghost { background: transparent; color: #c01818; border: 1px solid #c01818; }

  .cart-grid { display: grid; grid-template-columns: 1fr 1fr 22rem; gap: 1.5rem; }
  @media (max-width: 900px) { .cart-grid { grid-template-columns: 1fr; } }

  .item-card { background: white; border: 1px solid #e4e4e7; border-radius: 0.5rem; padding: 1rem; margin-bottom: 1rem; }
  .item-head { display: flex; justify-content: space-between; align-items: start; margin-bottom: 0.5rem; }
  .muted { color: #888; margin-left: 0.5rem; }
  .small { font-size: 0.85rem; }
  .item-body { display: flex; justify-content: space-between; align-items: center; gap: 1rem; padding: 0.5rem 0; border-bottom: 1px dashed #eee; }
  .qty { display: flex; align-items: center; gap: 0.5rem; font-weight: 500; }
  .qty input { width: 4rem; padding: 0.4rem; border: 1px solid #d4d4d8; border-radius: 0.3rem; }
  .line-price { font-weight: 600; }

  .dec-row { display: grid; grid-template-columns: 1fr 1fr auto; gap: 0.5rem; margin: 0.5rem 0; align-items: center; }
  .dec-row .dim { width: 7rem; }
  .dec-row select, .dec-row input { padding: 0.4rem 0.5rem; border: 1px solid #d4d4d8; border-radius: 0.3rem; }

  .designs { background: white; border: 1px solid #e4e4e7; border-radius: 0.5rem; padding: 1rem; }
  .design-row { display: flex; align-items: center; gap: 0.5rem; padding: 0.5rem 0; border-bottom: 1px dashed #eee; }
  .design-row strong { flex-grow: 0; }
  .add-design { display: flex; flex-direction: column; gap: 0.5rem; margin-top: 1rem; padding-top: 1rem; border-top: 1px solid #eee; }
  .add-design input { padding: 0.5rem; border: 1px solid #d4d4d8; border-radius: 0.3rem; }
  .hint { color: #666; font-size: 0.9rem; margin-bottom: 0.5rem; }
  .warn { color: #c80; font-size: 0.85rem; }

  .summary { background: #fafafa; border: 1px solid #e4e4e7; border-radius: 0.5rem; padding: 1.25rem; align-self: start; }
  .summary .row { display: flex; justify-content: space-between; padding: 0.3rem 0; }
  .summary .row.sub { padding-top: 0.6rem; margin-top: 0.5rem; border-top: 1px solid #ddd; font-weight: 700; font-size: 1.1rem; }
  .summary .btn { width: 100%; margin-top: 0.75rem; padding: 0.85rem; }
  .summary .primary { background: #c01818; }
  .summary .ghost { margin-top: 0.5rem; }

  .alert { padding: 0.5rem 0.75rem; border-radius: 0.3rem; margin: 0.5rem 0; font-size: 0.9rem; }
  .alert.error { background: #fee; color: #b00; }
  .alert.warn { background: #fff8e0; color: #885; }

  .link-btn { background: none; border: 0; color: #c01818; cursor: pointer; padding: 0; font-size: 0.9rem; }
  .link-btn.danger { color: #b00; }
</style>
