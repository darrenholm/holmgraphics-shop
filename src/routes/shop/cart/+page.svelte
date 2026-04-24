<!-- src/routes/shop/cart/+page.svelte
     DTF online-store cart. Two-step layout to keep things scannable when
     a customer has many items (e.g. ATC1000 with 30+ colour/size combos):

       Step 1: Items (grouped by product, expandable per-product to show
               size/qty rows + the decoration editor for each item).
       Step 2: Designs (just names and brief notes — no file upload here).
               Customer uploads actual artwork files AFTER checkout, on
               /shop/order/<n>/upload — keeps the cart focused on garment
               + decoration choices.

     Login is NOT required to use the cart. Only the "Pay Now" CTA bounces
     to /shop/login if the user isn't signed in.
-->
<script>
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { dtfCart, itemCount, isEmpty } from '$lib/stores/dtf-cart.js';
  import { customerApi } from '$lib/api/customer-client.js';
  import { customer } from '$lib/stores/customer-auth.js';

  let printLocations = [];
  let configError = '';

  let pricing = null;
  let pricingLoading = false;
  let pricingError = '';

  // Group items by (supplier + style + product_name) so 30 size/colour rows
  // for one ATC1000 collapse into one expandable card.
  let expanded = {};   // key -> bool

  $: groups = groupCartItems($dtfCart.items);

  function groupCartItems(items) {
    const map = new Map();
    for (const it of items) {
      const key = `${it.supplier}|${it.style}`;
      if (!map.has(key)) {
        map.set(key, {
          key,
          supplier:     it.supplier,
          style:        it.style,
          product_name: it.product_name,
          garment_category: it.garment_category,
          items:        [],
          total_qty:    0,
          total_price:  0,
        });
      }
      const g = map.get(key);
      g.items.push(it);
      g.total_qty   += Number(it.quantity) || 0;
      g.total_price += (Number(it.quantity) || 0) * (Number(it.unit_price) || 0);
    }
    // Default expand the first group; everything else collapsed.
    return [...map.values()];
  }

  function toggle(key) { expanded = { ...expanded, [key]: !expanded[key] }; }

  const money = (n) =>
    n == null ? '—' : new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(n);

  onMount(async () => {
    try {
      const locs = await customerApi.getPrintLocations();
      printLocations = locs.print_locations || [];
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
      const res = await customerApi.quoteCart($dtfCart, {}, 'pickup', 0);
      pricing = res.breakdown;
    } catch (e) {
      pricingError = e.message;
    } finally {
      pricingLoading = false;
    }
  }

  function setLocation(itemId, decId, value) {
    if (value === 'custom') {
      dtfCart.updateDecoration(itemId, decId, { print_location_id: null });
    } else if (value === '') {
      // do nothing
    } else {
      dtfCart.updateDecoration(itemId, decId, {
        print_location_id: parseInt(value, 10),
        custom_location: '',
        width_in: null,
        height_in: null,
      });
    }
  }

  function addNewDesign() {
    // Designs at cart stage are just NAMES. Files upload after checkout.
    const name = prompt('Name this design (e.g. "Front logo", "Back name"):');
    if (!name || !name.trim()) return;
    const id = dtfCart.addDesign(name.trim(), null);
    return id;
  }

  function addDecoration(itemId) {
    if ($dtfCart.designs.length === 0) {
      const id = addNewDesign();
      if (!id) return;
      dtfCart.addDecoration(itemId, {
        design_id: id, print_location_id: null,
        custom_location: '', width_in: null, height_in: null,
      });
    } else {
      dtfCart.addDecoration(itemId, {
        design_id: $dtfCart.designs[0].id,
        print_location_id: null,
        custom_location: '', width_in: null, height_in: null,
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

  function requestQuote() {
    alert('B2B quote requests coming soon. For now, please email darren@holmgraphics.ca with the cart contents.');
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
        <div class="step">
          <h2>1. Garments &amp; decoration</h2>
          <p class="hint">Click a product to expand sizes and add decoration locations.</p>
        </div>

        {#each groups as g (g.key)}
          <div class="group">
            <button class="group-head" type="button" on:click={() => toggle(g.key)}>
              <span class="chev">{expanded[g.key] ? '▾' : '▸'}</span>
              <strong>{g.product_name || g.style}</strong>
              <span class="muted">· {g.items.length} variant{g.items.length === 1 ? '' : 's'} · {g.total_qty} pcs</span>
              <span class="price">{money(g.total_price)}</span>
            </button>

            {#if expanded[g.key]}
              <div class="group-body">
                {#each g.items as item (item.id)}
                  <div class="item">
                    <div class="item-head">
                      <span class="swatch" style="background:{item.color_hex || '#ccc'}"></span>
                      <span class="item-name">{item.color_name} · {item.size}</span>
                      <input class="qty" type="number" min="0" max="999" value={item.quantity}
                             on:input={(e) => dtfCart.setQuantity(item.id, e.target.value)} />
                      <span class="muted">@ {money(item.unit_price)}</span>
                      <span class="line-price">{money(item.unit_price * item.quantity)}</span>
                      <button class="link-btn danger" on:click={() => dtfCart.removeItem(item.id)} title="Remove">×</button>
                    </div>

                    <div class="decorations">
                      {#each item.decorations as dec (dec.id)}
                        <div class="dec-row">
                          <select on:change={(e) => dtfCart.updateDecoration(item.id, dec.id, { design_id: e.target.value })}>
                            {#each $dtfCart.designs as d}
                              <option value={d.id} selected={dec.design_id === d.id}>{d.name}</option>
                            {/each}
                          </select>
                          <select on:change={(e) => setLocation(item.id, dec.id, e.target.value)}>
                            <option value="">Location…</option>
                            {#each locationsForCategory(item.garment_category) as loc}
                              <option value={loc.id} selected={dec.print_location_id === loc.id}>
                                {loc.name} (max {loc.max_width_in}″×{loc.max_height_in}″)
                              </option>
                            {/each}
                            <option value="custom" selected={dec.print_location_id == null}>Other (custom)…</option>
                          </select>

                          {#if dec.print_location_id == null}
                            <input class="dim" type="text" placeholder="Where on garment?"
                                   value={dec.custom_location || ''}
                                   on:input={(e) => dtfCart.updateDecoration(item.id, dec.id, { custom_location: e.target.value })} />
                            <input class="dim" type="number" placeholder="W″" step="0.25" min="0.5"
                                   value={dec.width_in || ''}
                                   on:input={(e) => dtfCart.updateDecoration(item.id, dec.id, { width_in: parseFloat(e.target.value) || null })} />
                            <input class="dim" type="number" placeholder="H″" step="0.25" min="0.5"
                                   value={dec.height_in || ''}
                                   on:input={(e) => dtfCart.updateDecoration(item.id, dec.id, { height_in: parseFloat(e.target.value) || null })} />
                          {/if}

                          <button class="link-btn danger" on:click={() => dtfCart.removeDecoration(item.id, dec.id)}>×</button>
                        </div>
                      {/each}

                      <button class="link-btn" on:click={() => addDecoration(item.id)}>+ Add decoration</button>
                    </div>
                  </div>
                {/each}
              </div>
            {/if}
          </div>
        {/each}

        <a href="/shop" class="link-btn keep-shopping">← Keep shopping</a>
      </section>

      <section class="designs">
        <div class="step">
          <h2>2. Designs</h2>
          <p class="hint">
            Just name your designs here (e.g. "Front logo"). You'll upload
            the actual artwork files <strong>after</strong> checkout, on the
            order page.
          </p>
        </div>

        {#each $dtfCart.designs as d (d.id)}
          <div class="design-row">
            🎨 <strong>{d.name}</strong>
            <button class="link-btn danger" on:click={() => dtfCart.removeDesign(d.id)} title="Remove">×</button>
          </div>
        {:else}
          <p class="muted small">No designs yet. Add one below or click "+ Add decoration" on a product.</p>
        {/each}

        <button class="btn outline" on:click={addNewDesign}>+ Add design</button>
      </section>

      <aside class="summary">
        <h2>Order summary</h2>
        {#if pricingLoading}
          <p class="muted">Calculating…</p>
        {:else if pricingError}
          <p class="alert error">{pricingError}</p>
        {:else if pricing}
          <div class="row"><span>Garments</span><span>{money(pricing.items_subtotal)}</span></div>
          <div class="row"><span>Decoration</span><span>{money(pricing.decorations_subtotal)}</span></div>
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
                disabled={$isEmpty || pricingLoading}>
          Continue to Checkout →
        </button>
        <button class="btn ghost" on:click={requestQuote}>Request a Quote (B2B)</button>

        <p class="hint small">
          You'll sign in (or create an account) on the next step. By placing
          an order, your card is charged immediately. We'll send a proof for
          your approval before printing — full refund if you cancel before
          production starts.
        </p>
      </aside>
    </div>
  {/if}
</div>

<style>
  .cart-page { max-width: 76rem; margin: 0 auto; padding: 2rem 1rem; }
  h1 { margin: 0 0 1.5rem; }
  h1 small { color: #888; font-weight: 400; font-size: 1rem; }
  h2 { font-size: 1.05rem; margin: 0 0 0.25rem; }
  .step { margin-bottom: 1rem; }
  .hint { color: #666; font-size: 0.9rem; margin: 0; }
  .small { font-size: 0.85rem; }
  .muted { color: #888; }

  .empty { text-align: center; padding: 4rem 0; color: #555; }
  .btn { display: inline-block; padding: 0.7rem 1.25rem; background: #c01818; color: white; border: none; border-radius: 0.4rem; font-weight: 600; text-decoration: none; cursor: pointer; }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn.outline { background: transparent; color: #c01818; border: 1px solid #c01818; padding: 0.5rem 1rem; }
  .btn.ghost { background: transparent; color: #c01818; border: none; }

  .cart-grid { display: grid; grid-template-columns: 1fr 22rem; gap: 1.5rem; }
  @media (max-width: 900px) { .cart-grid { grid-template-columns: 1fr; } }
  .items { display: flex; flex-direction: column; gap: 0.75rem; }
  .designs { background: white; border: 1px solid #e4e4e7; border-radius: 0.5rem; padding: 1.25rem; }

  .group { background: white; border: 1px solid #e4e4e7; border-radius: 0.5rem; }
  .group-head { display: grid; grid-template-columns: auto 1fr auto; gap: 0.5rem; align-items: center; width: 100%; padding: 0.85rem 1rem; background: none; border: 0; cursor: pointer; text-align: left; font-size: 0.95rem; }
  .group-head .chev { color: #888; font-size: 1rem; }
  .group-head strong { font-weight: 600; }
  .group-head .price { font-weight: 700; }

  .group-body { padding: 0 1rem 1rem; border-top: 1px dashed #eee; }
  .item { padding: 0.75rem 0; border-bottom: 1px dashed #f0f0f0; }
  .item:last-child { border-bottom: 0; }
  .item-head { display: grid; grid-template-columns: 1.25rem 1fr 5rem auto auto auto; gap: 0.5rem; align-items: center; }
  .swatch { display: inline-block; width: 1rem; height: 1rem; border-radius: 0.2rem; border: 1px solid #ddd; }
  .item-name { font-weight: 500; }
  .qty { width: 4rem; padding: 0.35rem; border: 1px solid #d4d4d8; border-radius: 0.3rem; font-size: 0.95rem; }
  .line-price { font-weight: 600; min-width: 4rem; text-align: right; }

  .decorations { margin-top: 0.5rem; padding-left: 1.5rem; }
  .dec-row { display: grid; grid-template-columns: 8rem 1fr auto; gap: 0.4rem; margin: 0.4rem 0; align-items: center; }
  .dec-row .dim { width: 6rem; }
  .dec-row select, .dec-row input { padding: 0.35rem 0.5rem; border: 1px solid #d4d4d8; border-radius: 0.3rem; font-size: 0.9rem; }

  .design-row { display: flex; align-items: center; gap: 0.5rem; padding: 0.5rem 0; border-bottom: 1px dashed #eee; }
  .design-row strong { flex-grow: 1; }

  .summary { background: #fafafa; border: 1px solid #e4e4e7; border-radius: 0.5rem; padding: 1.25rem; align-self: start; }
  .summary .row { display: flex; justify-content: space-between; padding: 0.3rem 0; }
  .summary .row.sub { padding-top: 0.6rem; margin-top: 0.5rem; border-top: 1px solid #ddd; font-weight: 700; font-size: 1.1rem; }
  .summary .btn { width: 100%; margin-top: 0.75rem; padding: 0.85rem; }
  .summary .ghost { margin-top: 0.5rem; }

  .alert { padding: 0.5rem 0.75rem; border-radius: 0.3rem; margin: 0.5rem 0; font-size: 0.9rem; }
  .alert.error { background: #fee; color: #b00; }
  .alert.warn { background: #fff8e0; color: #885; }

  .link-btn { background: none; border: 0; color: #c01818; cursor: pointer; padding: 0; font-size: 0.9rem; }
  .link-btn.danger { color: #b00; }
  .keep-shopping { margin-top: 1rem; }
</style>
