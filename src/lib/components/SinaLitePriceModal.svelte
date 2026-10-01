<!-- src/lib/components/SinaLitePriceModal.svelte
     SinaLite wholesale print price check, opened from the job page quote sheet.

     Staff pick a product and its options, see our cost from SinaLite plus a
     shipping estimate, set a markup, and add the result as one quote sheet
     row (qty 1 = the whole print run). Nothing is ordered from here.

     Dispatches 'add' with a quote-sheet row body, and 'close'.
-->
<script>
  import { createEventDispatcher } from 'svelte';
  import { api } from '$lib/api/client.js';

  export let open = false;
  export let saving = false;     // parent is writing the quote row
  export let saveError = '';     // parent's error writing the quote row

  const dispatch = createEventDispatcher();
  const SHOP_ZIP = 'N0G 2V0';
  const SHOP_STATE = 'ON';

  let status = null;         // { configured, env }
  let products = [];
  let loadingProducts = false;
  let error = '';

  let category = '';
  let search = '';
  let productId = '';
  let groups = [];           // [{ group, options: [{id, name}] }]
  let chosen = {};           // group → option id
  let loadingOptions = false;

  let price = null;          // { price, packageInfo, productOptions }
  let pricing = false;
  let priceError = '';

  let shipZip = SHOP_ZIP;
  let shipState = SHOP_STATE;
  let rates = [];
  let shipping = false;
  let shipError = '';
  let shipPick = '';         // rate.method, or '' = leave shipping out

  let markup = 2;
  let item = '';
  let itemTouched = false;
  let seq = 0;               // ignore out-of-order price replies

  $: if (open && !status) init();

  async function init() {
    error = '';
    loadingProducts = true;
    try {
      status = await api.sinaliteStatus();
      if (status.configured) {
        const r = await api.sinaliteProducts();
        // SinaLite flags products enabled/disabled per account. If none are
        // flagged enabled (sandbox does this), show everything.
        const all = r.products || [];
        products = all.some((p) => p.enabled) ? all.filter((p) => p.enabled) : all;
      }
    } catch (e) {
      error = e.message;
    } finally {
      loadingProducts = false;
    }
  }

  $: categories = [...new Set(products.map((p) => p.category))];
  $: shownProducts = products.filter((p) =>
    (!category || p.category === category) &&
    (!search || p.name.toLowerCase().includes(search.toLowerCase())));
  $: product = products.find((p) => String(p.id) === String(productId)) || null;

  async function pickProduct() {
    groups = []; chosen = {}; price = null; priceError = ''; rates = []; shipError = '';
    itemTouched = false;
    if (!productId) return;
    loadingOptions = true;
    try {
      const r = await api.sinaliteOptions(productId);
      groups = r.groups || [];
      // Start with the first choice in every group so a price shows right away.
      chosen = Object.fromEntries(groups.map((g) => [g.group, g.options[0]?.id]));
      await refreshPrice();
    } catch (e) {
      error = e.message;
    } finally {
      loadingOptions = false;
    }
  }

  function optionIds() {
    return groups.map((g) => chosen[g.group]).filter((v) => v != null).map(Number);
  }

  async function refreshPrice() {
    const mine = ++seq;
    price = null; priceError = ''; rates = []; shipError = '';
    if (!productId || optionIds().length !== groups.length) return;
    pricing = true;
    try {
      const p = await api.sinalitePrice(productId, optionIds());
      if (mine !== seq) return;
      price = p;
      if (!p.price) priceError = 'SinaLite has no price for that combination. Try different options.';
      if (!itemTouched) item = describe();
      if (p.price) await refreshShipping(mine);
    } catch (e) {
      if (mine === seq) priceError = `No price for that combination (${e.message})`;
    } finally {
      if (mine === seq) pricing = false;
    }
  }

  async function refreshShipping(mine = seq) {
    shipError = ''; rates = [];
    if (!price?.price) return;
    shipping = true;
    try {
      const r = await api.sinaliteShipping(productId, optionIds(), {
        zip: shipZip, state: shipState, country: 'CA'
      });
      if (mine !== seq) return;
      rates = r.rates || [];
      // Keep the staff member's carrier if it's still offered, else cheapest.
      if (!rates.some((x) => x.method === shipPick)) shipPick = rates[0]?.method || '';
    } catch (e) {
      if (mine === seq) shipError = e.message;
    } finally {
      if (mine === seq) shipping = false;
    }
  }

  function nameOf(group) {
    const g = groups.find((x) => x.group === group);
    return g?.options.find((o) => o.id === Number(chosen[group]))?.name || '';
  }

  // e.g. "500 × Business Cards 14pt + AQ – 2 x 3.5, 4/4, 2 - 3 Business Days"
  function describe() {
    if (!product) return '';
    const qtyGroup = groups.find((g) => /^qty$/i.test(g.group));
    const qty = qtyGroup ? nameOf(qtyGroup.group) : '';
    const rest = groups.filter((g) => g !== qtyGroup).map((g) => nameOf(g.group)).filter(Boolean);
    return `${qty ? qty + ' × ' : ''}${product.name}${rest.length ? ' – ' + rest.join(', ') : ''}`;
  }

  $: rate = rates.find((r) => r.method === shipPick) || null;
  $: printCost = price?.price || 0;
  $: shipCost = rate?.price || 0;
  $: totalCost = +(printCost + shipCost).toFixed(2);
  $: sale = +(totalCost * (parseFloat(markup) || 0)).toFixed(2);

  function groupLabel(g) { return /^qty$/i.test(g) ? 'Quantity' : g; }
  function money(n) { return `$${(parseFloat(n) || 0).toFixed(2)}`; }

  function add() {
    if (!price?.price) return;
    const when = new Date().toISOString().slice(0, 10);
    const notes = [
      `SinaLite product ${productId} options ${optionIds().join(',')}`,
      `print ${money(printCost)}` + (rate ? ` + ${rate.method} to ${shipZip} ${money(shipCost)}` : ' (shipping not included)'),
      `priced ${when}${status?.env === 'sandbox' ? ' (TEST prices)' : ''}`
    ].join(' · ');
    dispatch('add', {
      item: item || describe(),
      qty: 1,
      cost_per_unit: totalCost,
      markup: parseFloat(markup) || 0,
      sale_per_unit: sale,
      notes
    });
  }

  function close() { dispatch('close'); }
  function onKey(e) { if (open && e.key === 'Escape') close(); }
</script>

<svelte:window on:keydown={onKey} />

{#if open}
  <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
  <div class="modal-backdrop" on:click|self={close}>
    <div class="modal-panel" role="dialog" aria-modal="true" aria-label="SinaLite price check">
      <div class="modal-head">
        <div>
          <h2>SinaLite price check</h2>
          <div class="subhead">
            Our cost from SinaLite. Adds one line to the quote sheet. Nothing is ordered.
          </div>
        </div>
        <button class="close-x" on:click={close} aria-label="Close">×</button>
      </div>

      <div class="modal-body">
        {#if status?.env === 'sandbox'}
          <p class="banner">Test account: these are SinaLite's sandbox prices, not real ones.</p>
        {/if}
        {#if error}<p class="error-state">{error}</p>{/if}

        {#if loadingProducts}
          <p class="muted">Loading SinaLite products…</p>
        {:else if status && !status.configured}
          <p class="error-state">
            SinaLite isn't connected yet. Add <code>SINALITE_CLIENT_ID</code> and
            <code>SINALITE_CLIENT_SECRET</code> (from the SinaLite portal, Account tab) in Railway.
          </p>
        {:else if status}
          <div class="row2">
            <label>
              <span>Category</span>
              <select bind:value={category} on:change={() => { productId = ''; pickProduct(); }}>
                <option value="">All categories</option>
                {#each categories as c}<option value={c}>{c}</option>{/each}
              </select>
            </label>
            <label>
              <span>Search</span>
              <input type="text" bind:value={search} placeholder="e.g. flyer, 16pt" />
            </label>
          </div>
          <label>
            <span>Product ({shownProducts.length})</span>
            <select bind:value={productId} on:change={pickProduct}>
              <option value="">Pick a product…</option>
              {#each shownProducts as p (p.id)}
                <option value={String(p.id)}>{p.name}{category ? '' : ` — ${p.category}`}</option>
              {/each}
            </select>
          </label>

          {#if loadingOptions}
            <p class="muted">Loading options…</p>
          {:else if groups.length}
            <div class="options">
              {#each groups as g (g.group)}
                <label>
                  <span>{groupLabel(g.group)}</span>
                  <select bind:value={chosen[g.group]} on:change={refreshPrice}>
                    {#each g.options as o (o.id)}<option value={o.id}>{o.name}</option>{/each}
                  </select>
                </label>
              {/each}
            </div>

            <div class="ship-to">
              <label>
                <span>Ship to postal code</span>
                <input type="text" bind:value={shipZip} on:change={() => refreshShipping()} />
              </label>
              <label>
                <span>Province</span>
                <input type="text" maxlength="2" bind:value={shipState} on:change={() => refreshShipping()} />
              </label>
              {#if shipZip !== SHOP_ZIP}
                <button class="btn btn-ghost small" on:click={() => { shipZip = SHOP_ZIP; shipState = SHOP_STATE; refreshShipping(); }}>
                  Back to shop
                </button>
              {/if}
            </div>

            {#if pricing}
              <p class="muted">Getting price…</p>
            {:else if priceError}
              <p class="error-state">{priceError}</p>
            {:else if price?.price}
              <div class="result">
                <div class="line"><span>Print cost</span><strong>{money(printCost)}</strong></div>
                {#if price.packageInfo?.['total weight']}
                  <div class="line muted small-text">
                    <span>Weight</span><span>{price.packageInfo['total weight']} lb, {price.packageInfo['number of boxes'] || 1} box</span>
                  </div>
                {/if}

                <div class="ship-list">
                  <span class="label">Shipping</span>
                  {#if shipping}
                    <p class="muted">Getting shipping rates…</p>
                  {:else if shipError}
                    <p class="error-state">{shipError}</p>
                  {:else}
                    {#each rates as r (r.method)}
                      <label class="radio">
                        <input type="radio" bind:group={shipPick} value={r.method} />
                        <span>{r.method}{r.days != null ? ` · ${r.days} day${r.days === 1 ? '' : 's'}` : ''}</span>
                        <span class="amt">{money(r.price)}</span>
                      </label>
                    {/each}
                    <label class="radio">
                      <input type="radio" bind:group={shipPick} value="" />
                      <span>Leave shipping out</span><span class="amt"></span>
                    </label>
                  {/if}
                </div>

                <div class="line total"><span>Our cost</span><strong>{money(totalCost)}</strong></div>
                <div class="line">
                  <label class="inline">
                    <span>Markup</span>
                    <input class="num" type="number" min="0" step="0.05" bind:value={markup} />
                  </label>
                  <strong class="sale">{money(sale)}</strong>
                </div>
              </div>

              <label>
                <span>Quote line description</span>
                <input type="text" bind:value={item} on:input={() => (itemTouched = true)} />
              </label>
            {/if}
          {/if}
        {/if}
      </div>

      {#if saveError}<p class="error-state save-error">{saveError}</p>{/if}
      <div class="modal-foot">
        <button class="btn btn-ghost" on:click={close}>Cancel</button>
        <button class="btn btn-primary" on:click={add} disabled={!price?.price || pricing || shipping || saving}>
          {saving ? 'Adding…' : 'Add to quote sheet'}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .modal-backdrop {
    position: fixed; inset: 0; background: rgba(10, 12, 16, 0.55);
    display: flex; align-items: center; justify-content: center;
    z-index: 2000; padding: 24px;
  }
  .modal-panel {
    background: var(--surface);
    border-radius: var(--radius-lg, 10px);
    box-shadow: var(--shadow-lg, 0 10px 40px rgba(0,0,0,0.35));
    width: min(640px, 100%);
    max-height: 92vh;
    display: flex; flex-direction: column;
    overflow: hidden;
  }
  .modal-head {
    display: flex; align-items: flex-start; justify-content: space-between;
    padding: 14px 20px;
    border-bottom: 1px solid var(--border);
  }
  .modal-head h2 {
    font-family: var(--font-display);
    font-size: 1.2rem;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    margin: 0;
  }
  .subhead { font-size: 0.88rem; color: var(--text-muted); margin-top: 2px; }
  .close-x {
    background: transparent; border: none; cursor: pointer;
    color: var(--text-muted); font-size: 1.3rem; padding: 0 4px; line-height: 1;
  }
  .close-x:hover { color: var(--text); }

  .modal-body {
    padding: 16px 20px; overflow-y: auto;
    display: flex; flex-direction: column; gap: 12px;
  }
  .modal-foot {
    display: flex; justify-content: flex-end; gap: 8px;
    padding: 12px 20px; border-top: 1px solid var(--border);
  }

  label { display: flex; flex-direction: column; gap: 4px; font-size: 0.9rem; }
  label > span { color: var(--text-muted); font-size: 0.82rem; }
  select, input[type='text'], input[type='number'] {
    padding: 7px 9px; border: 1px solid var(--border); border-radius: 6px;
    background: var(--surface); color: var(--text); font: inherit;
  }
  .row2, .options { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .ship-to { display: grid; grid-template-columns: 1fr 90px auto; gap: 10px; align-items: end; }
  @media (max-width: 520px) {
    .row2, .options { grid-template-columns: 1fr; }
    .ship-to { grid-template-columns: 1fr 70px; }
  }

  .banner {
    margin: 0; padding: 8px 10px; border-radius: 6px;
    background: rgba(230, 160, 0, 0.14); color: var(--text); font-size: 0.88rem;
  }
  .muted { color: var(--text-muted); margin: 0; }
  .small-text { font-size: 0.85rem; }

  .result {
    border: 1px solid var(--border); border-radius: 8px; padding: 10px 12px;
    display: flex; flex-direction: column; gap: 6px;
  }
  .line { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
  .line.total { border-top: 1px solid var(--border); padding-top: 8px; }
  .ship-list { display: flex; flex-direction: column; gap: 2px; }
  .ship-list .label { color: var(--text-muted); font-size: 0.82rem; }
  .radio {
    flex-direction: row; align-items: center; gap: 8px; cursor: pointer;
    font-family: var(--font-body); font-weight: normal; letter-spacing: normal;
    text-transform: none; margin: 0;
  }
  .radio input { width: auto; flex: 0 0 auto; margin: 0; }
  .radio > span { color: var(--text); font-size: 0.9rem; }
  .radio .amt { margin-left: auto; font-variant-numeric: tabular-nums; }
  .inline { flex-direction: row; align-items: center; gap: 8px; margin: 0; }
  .inline .num { width: 80px; text-align: right; }
  .sale { font-size: 1.05rem; }
  strong { font-variant-numeric: tabular-nums; }
  .small { padding: 6px 10px; font-size: 0.85rem; }
  .save-error { margin: 0; padding: 8px 20px; border-top: 1px solid var(--border); }
</style>
