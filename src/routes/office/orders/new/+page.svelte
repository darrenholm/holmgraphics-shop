<!-- src/routes/office/orders/new/+page.svelte
     Office order entry. Staff-side counterpart to the public
     /shop/checkout flow. Pairs with POST /api/orders/office on the API.

     Differences from /shop/checkout:
       * Picks an existing client (from /api/clients?search=) rather than
         using the customer's own JWT.
       * Payment is a radio: card / cash / e-transfer / invoice later.
         Only 'card' triggers a tokenize+charge; the rest skip charging.
       * No customer-email-required gate (office walk-ins often don't have
         one). Notification email defaults to whatever the client has on
         file.
       * Source = 'office' on the resulting order.

     Cart editing happens on /shop/cart (existing UI). Staff browse the
     catalog at /shop, add items there, click "Build office order" or
     navigate back here to finalise. The dtfCart store persists in
     localStorage so the round-trip works.
-->
<script>
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { api } from '$lib/api/client.js';
  import { isStaff } from '$lib/stores/auth.js';
  import { dtfCart, isEmpty } from '$lib/stores/dtf-cart.js';

  // ─── Client picker ─────────────────────────────────────────────────
  let selectedClient = null;
  let showClientPicker = false;
  let clientSearchQuery = '';
  let clientSearchResults = [];
  let clientSearchLoading = false;
  let clientSearchDebounce = null;

  function openClientPicker() {
    clientSearchQuery = '';
    clientSearchResults = [];
    showClientPicker = true;
  }
  function closeClientPicker() {
    showClientPicker = false;
  }

  // Debounced search whenever the picker is open.
  $: if (showClientPicker) {
    clearTimeout(clientSearchDebounce);
    clientSearchDebounce = setTimeout(runClientSearch, 200);
  }

  async function runClientSearch() {
    const q = (clientSearchQuery || '').trim();
    clientSearchLoading = true;
    try {
      const opts = q ? { search: q, limit: 50 } : { limit: 50 };
      clientSearchResults = await api.getClients(opts);
    } catch (e) {
      submitError = e.message || String(e);
      clientSearchResults = [];
    } finally {
      clientSearchLoading = false;
    }
  }

  function pickClient(c) {
    selectedClient = c;
    showClientPicker = false;
  }

  function clientLabel(c) {
    if (!c) return '';
    return c.company_name
      || [c.first_name, c.last_name].filter(Boolean).join(' ').trim()
      || `Client #${c.id}`;
  }

  // ─── Cart (read-only summary) ──────────────────────────────────────
  // Re-quote against the office endpoint so the totals reflect the
  // SELLER_PROVINCE pickup tax + any unit_price overrides we apply.
  // The store carries items + designs already; this just adds tax/total.
  let pricing = null;
  let pricingLoading = false;
  let pricingError = '';

  $: if ($dtfCart && !$isEmpty) refreshPricing();

  async function refreshPricing() {
    pricingLoading = true;
    pricingError = '';
    try {
      // Reuse the public /quote endpoint -- same tax math as the office
      // submit will use, no auth required (it's stateless pricing).
      const cartWithOverrides = applyOverridesLocally($dtfCart);
      const res = await fetch(
        `${import.meta.env.VITE_API_URL || 'http://localhost:3000/api'}/orders/quote`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            cart: cartWithOverrides,
            fulfillment_method: 'pickup',
            shipping_total: 0,
          }),
        }
      );
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || `quote failed (${res.status})`);
      pricing = body.breakdown;
    } catch (e) {
      pricingError = e.message;
    } finally {
      pricingLoading = false;
    }
  }

  function applyOverridesLocally(cart) {
    if (!cart || !Array.isArray(cart.items)) return cart;
    return {
      ...cart,
      items: cart.items.map((it) => {
        if (Object.prototype.hasOwnProperty.call(unitPriceOverrides, it.id)) {
          const v = Number(unitPriceOverrides[it.id]);
          if (Number.isFinite(v) && v >= 0) return { ...it, unit_price: v };
        }
        return it;
      }),
    };
  }

  // Per-line price override map: { [item_id]: number-or-null }. Only
  // entries that differ from the cart's stock unit_price get sent to
  // the server.
  let unitPriceOverrides = {};

  function setOverride(itemId, value) {
    if (value === '' || value == null) {
      const next = { ...unitPriceOverrides };
      delete next[itemId];
      unitPriceOverrides = next;
      return;
    }
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) return;
    unitPriceOverrides = { ...unitPriceOverrides, [itemId]: n };
  }

  // ─── Payment ──────────────────────────────────────────────────────
  let paymentMethod = 'invoice_pending';   // safest default
  // Card form (only used when paymentMethod === 'card')
  let cardNumber = '';
  let cardExp    = '';
  let cardCvc    = '';
  let cardZip    = '';

  // ─── Submit ───────────────────────────────────────────────────────
  let customerNotes = '';
  let submitting = false;
  let submitError = '';

  async function submit() {
    submitError = '';
    if (!selectedClient) {
      submitError = 'Pick a client first.';
      return;
    }
    if ($isEmpty) {
      submitError = 'Cart is empty -- add items via /shop before submitting.';
      return;
    }

    let cardToken = null;
    if (paymentMethod === 'card') {
      if (!cardNumber || !cardExp || !cardCvc || !cardZip) {
        submitError = 'Card requires number, expiry, CVC, and postal code.';
        return;
      }
      try {
        const tokenized = await api.tokenizeCardStaff({
          number: cardNumber.replace(/\s+/g, ''),
          exp:    cardExp,
          cvc:    cardCvc,
          zip:    cardZip,
          name:   clientLabel(selectedClient) || undefined,
        });
        cardToken = tokenized?.token;
      } catch (e) {
        submitError = e.message || 'Card tokenization failed.';
        return;
      }
      if (!cardToken) {
        submitError = 'Card tokenization returned no token.';
        return;
      }
    }

    submitting = true;
    try {
      const res = await api.createOfficeOrder({
        client_id:           selectedClient.id,
        cart:                $dtfCart,
        payment: paymentMethod === 'card'
          ? { method: 'card', card_token: cardToken }
          : { method: paymentMethod },
        unit_price_overrides: Object.keys(unitPriceOverrides).length
          ? unitPriceOverrides
          : undefined,
        fulfillment_method:  'pickup',
        customer_notes:      customerNotes.trim() || undefined,
      });
      // Clear the cart and bounce to the resulting job.
      dtfCart.clear();
      goto(`/jobs/${res.order.job_id}`);
    } catch (e) {
      submitError = e.message || 'Order creation failed.';
    } finally {
      submitting = false;
    }
  }

  // ─── Auth gate ────────────────────────────────────────────────────
  // The /api/orders/office endpoint enforces requireStaff on the server,
  // but bouncing non-staff away client-side avoids a confusing 401 dance.
  onMount(() => {
    if (!$isStaff) goto('/login?return=' + encodeURIComponent('/office/orders/new'));
  });

  const money = (n) =>
    n == null ? '—' :
    new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(n);

  // Group cart items by product so identical (color × size) variants
  // collapse into one row in the summary -- mirrors the /shop/cart
  // display style.
  $: cartGroups = (() => {
    if (!$dtfCart?.items) return [];
    const map = new Map();
    for (const it of $dtfCart.items) {
      const key = `${it.supplier}|${it.style}`;
      if (!map.has(key)) {
        map.set(key, {
          key,
          product_name: it.product_name,
          style:        it.style,
          items:        [],
          total_qty:    0,
        });
      }
      const g = map.get(key);
      g.items.push(it);
      g.total_qty += Number(it.quantity) || 0;
    }
    return [...map.values()];
  })();
</script>

<svelte:head><title>Office order — Holm Graphics</title></svelte:head>

{#if !$isStaff}
  <p style="padding:2rem">Redirecting to login…</p>
{:else}
  <div class="page">
    <header class="page-head">
      <h1>Office order</h1>
      <a href="/jobs" class="back-link">← Jobs</a>
    </header>

    {#if submitError}
      <div class="alert error">⚠ {submitError}</div>
    {/if}

    <!-- ─── Client section ─────────────────────────────────────── -->
    <section class="card">
      <h2 class="card-title">1. Client</h2>
      {#if selectedClient}
        <div class="picked-client">
          <div>
            <strong>{clientLabel(selectedClient)}</strong>
            <span class="muted">#{selectedClient.id}</span>
            {#if selectedClient.email}<div class="muted">{selectedClient.email}</div>{/if}
          </div>
          <button class="btn-text" on:click={openClientPicker}>Change</button>
        </div>
      {:else}
        <button class="btn btn-primary" on:click={openClientPicker}>
          Pick existing client
        </button>
        <p class="muted small">
          New client? Create them in <a href="/clients">/clients</a> first
          (inline create lands in Phase O3).
        </p>
      {/if}
    </section>

    <!-- ─── Cart section ──────────────────────────────────────── -->
    <section class="card">
      <h2 class="card-title">
        2. Cart
        <span class="card-actions">
          <a class="btn-text" href="/shop">Browse catalog</a>
          <a class="btn-text" href="/shop/cart">Edit cart</a>
        </span>
      </h2>

      {#if $isEmpty}
        <p class="muted">
          Cart is empty. Browse the catalog and add items, then come back here
          to finalise. The cart persists across pages.
        </p>
      {:else}
        <table class="cart-table">
          <thead>
            <tr><th>Product</th><th>Color / Size</th><th>Qty</th><th>Unit</th><th>Override</th><th>Line</th></tr>
          </thead>
          <tbody>
            {#each cartGroups as g (g.key)}
              {#each g.items as it (it.id)}
                <tr>
                  <td>
                    <div class="prod-name">{g.product_name}</div>
                    <div class="muted small">{it.style}</div>
                  </td>
                  <td>
                    <span class="swatch" style="background:{it.color_hex || '#ccc'};"></span>
                    {it.color_name || '—'} / {it.size || '—'}
                  </td>
                  <td>{it.quantity}</td>
                  <td>{money(it.unit_price)}</td>
                  <td>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="(none)"
                      value={unitPriceOverrides[it.id] ?? ''}
                      on:input={(e) => setOverride(it.id, e.target.value)}
                    />
                  </td>
                  <td class="num">
                    {money(
                      (unitPriceOverrides[it.id] != null ? unitPriceOverrides[it.id] : it.unit_price)
                      * it.quantity
                    )}
                  </td>
                </tr>
              {/each}
            {/each}
          </tbody>
        </table>

        <div class="totals">
          {#if pricingLoading}
            <span class="muted">Calculating…</span>
          {:else if pricingError}
            <span class="alert error">{pricingError}</span>
          {:else if pricing}
            <div class="row"><span>Items</span><span>{money(pricing.items_subtotal)}</span></div>
            <div class="row"><span>Decorations</span><span>{money(pricing.decorations_subtotal)}</span></div>
            <div class="row"><span>Tax ({(pricing.tax_rate * 100).toFixed(2)}%)</span><span>{money(pricing.tax_total)}</span></div>
            <div class="row total"><span>Grand total</span><span>{money(pricing.grand_total)}</span></div>
          {/if}
        </div>
      {/if}
    </section>

    <!-- ─── Payment section ──────────────────────────────────── -->
    <section class="card">
      <h2 class="card-title">3. Payment</h2>
      <div class="pay-radios">
        <label class:active={paymentMethod === 'card'}>
          <input type="radio" bind:group={paymentMethod} value="card" />
          <strong>Charge card</strong>
          <small>Tokenize + charge through QB Payments now.</small>
        </label>
        <label class:active={paymentMethod === 'cash'}>
          <input type="radio" bind:group={paymentMethod} value="cash" />
          <strong>Cash received</strong>
          <small>Mark paid, no charge processed.</small>
        </label>
        <label class:active={paymentMethod === 'etransfer'}>
          <input type="radio" bind:group={paymentMethod} value="etransfer" />
          <strong>E-transfer received</strong>
          <small>Mark paid, no charge processed.</small>
        </label>
        <label class:active={paymentMethod === 'invoice_pending'}>
          <input type="radio" bind:group={paymentMethod} value="invoice_pending" />
          <strong>Invoice later</strong>
          <small>Order created without payment; invoice goes out separately.</small>
        </label>
      </div>

      {#if paymentMethod === 'card'}
        <div class="card-form">
          <label class="full">Card number
            <input type="text" inputmode="numeric" placeholder="1234 5678 9012 3456" bind:value={cardNumber} autocomplete="cc-number" />
          </label>
          <label>Expiry
            <input type="text" placeholder="MM/YY" bind:value={cardExp} autocomplete="cc-exp" />
          </label>
          <label>CVC
            <input type="text" inputmode="numeric" placeholder="123" bind:value={cardCvc} autocomplete="cc-csc" />
          </label>
          <label>Postal code
            <input type="text" bind:value={cardZip} />
          </label>
        </div>
      {:else}
        <p class="muted small">No charge will be processed.</p>
      {/if}
    </section>

    <!-- ─── Notes ────────────────────────────────────────────── -->
    <section class="card">
      <h2 class="card-title">4. Notes (optional)</h2>
      <textarea bind:value={customerNotes} rows="3" placeholder="Internal notes — staff only. Goes to orders.customer_notes."></textarea>
    </section>

    <!-- ─── Submit ───────────────────────────────────────────── -->
    <div class="submit-row">
      <button
        class="btn btn-primary big"
        on:click={submit}
        disabled={submitting || !selectedClient || $isEmpty}>
        {submitting ? 'Creating order…' : 'Create order'}
      </button>
    </div>
  </div>
{/if}

<!-- ─── Client picker modal ────────────────────────────────── -->
{#if showClientPicker}
  <div class="modal-backdrop" on:click|self={closeClientPicker}>
    <div class="modal" role="dialog" aria-modal="true">
      <header class="modal-header">
        <h3>Pick client</h3>
        <button class="modal-close" on:click={closeClientPicker} aria-label="Close">×</button>
      </header>
      <input
        type="search"
        class="picker-search"
        placeholder="Search by company, name, or email…"
        bind:value={clientSearchQuery}
        autocomplete="off"
        autofocus />
      {#if clientSearchLoading}
        <p class="muted picker-empty">Searching…</p>
      {:else if clientSearchResults.length === 0}
        <p class="muted picker-empty">
          {clientSearchQuery.trim() ? `No matches for "${clientSearchQuery}".` : 'Type to search.'}
        </p>
      {:else}
        <ul class="picker-results">
          {#each clientSearchResults as r (r.id)}
            <li>
              <button class="picker-pick" on:click={() => pickClient(r)}>
                <span class="picker-name">{clientLabel(r)}</span>
                <span class="picker-meta">
                  #{r.id}{#if r.email} · {r.email}{/if}{#if r.phone} · {r.phone}{/if}
                </span>
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  </div>
{/if}

<style>
  .page { max-width: 920px; margin: 0 auto; padding: 24px; color: var(--text); }
  .page-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 18px; }
  .page-head h1 { margin: 0; font-size: 1.6rem; }
  .back-link { color: var(--text-muted); font-size: 0.85rem; text-decoration: none; }
  .back-link:hover { color: var(--red); }

  .card {
    background: var(--surface, #fff);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 16px 20px;
    margin-bottom: 14px;
  }
  .card-title {
    margin: 0 0 12px;
    font-family: var(--font-display);
    font-size: 0.85rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-muted);
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .card-actions { display: flex; gap: 12px; }

  .picked-client {
    display: flex; justify-content: space-between; align-items: flex-start;
    gap: 12px;
  }

  .alert.error { background: #fee; color: #b00; padding: 10px 14px; border-radius: 6px; margin-bottom: 14px; }

  .muted { color: var(--text-muted); }
  .small { font-size: 0.85rem; }

  /* Cart table */
  .cart-table { width: 100%; border-collapse: collapse; font-size: 0.92rem; }
  .cart-table th { text-align: left; font-weight: 500; color: var(--text-muted); border-bottom: 1px solid var(--border); padding: 6px 8px; }
  .cart-table td { padding: 8px; border-bottom: 1px dotted var(--border); vertical-align: middle; }
  .cart-table td.num { text-align: right; font-variant-numeric: tabular-nums; }
  .cart-table input[type="number"] { width: 100px; padding: 4px 6px; border: 1px solid var(--border); border-radius: 4px; }
  .prod-name { font-weight: 600; }
  .swatch { display: inline-block; width: 12px; height: 12px; border-radius: 2px; border: 1px solid #ccc; margin-right: 6px; vertical-align: middle; }

  .totals { margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--border); display: flex; flex-direction: column; gap: 4px; max-width: 280px; margin-left: auto; }
  .totals .row { display: flex; justify-content: space-between; font-size: 0.92rem; }
  .totals .row.total { padding-top: 8px; border-top: 1px solid var(--border); font-weight: 700; font-size: 1.05rem; }

  /* Payment radios */
  .pay-radios { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }
  .pay-radios label {
    display: flex; flex-direction: column;
    padding: 12px;
    border: 1px solid var(--border);
    border-radius: 6px;
    cursor: pointer;
  }
  .pay-radios label input { margin-bottom: 6px; }
  .pay-radios label.active { border-color: var(--red); background: #fff5f5; }
  .pay-radios small { color: var(--text-muted); font-size: 0.82rem; }

  .card-form { margin-top: 12px; display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .card-form .full { grid-column: 1 / -1; }
  .card-form label { display: flex; flex-direction: column; gap: 3px; font-size: 0.85rem; color: var(--text-muted); }
  .card-form input { padding: 6px 10px; border: 1px solid var(--border); border-radius: 4px; font-size: 0.95rem; }

  textarea { width: 100%; padding: 8px 10px; border: 1px solid var(--border); border-radius: 4px; font-family: inherit; font-size: 0.95rem; }

  .submit-row { display: flex; justify-content: flex-end; margin-top: 8px; }
  .btn { padding: 6px 14px; border-radius: 5px; border: none; cursor: pointer; font-weight: 500; }
  .btn.btn-primary { background: var(--red); color: #fff; }
  .btn.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn.big { padding: 10px 24px; font-size: 1rem; }
  .btn-text { background: none; border: none; color: var(--text-muted); cursor: pointer; font-size: 0.85rem; text-decoration: underline; }
  .btn-text:hover { color: var(--red); }

  /* Modal */
  .modal-backdrop { position: fixed; inset: 0; z-index: 100; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; padding: 20px; }
  .modal { background: var(--surface, #fff); border: 1px solid var(--border); border-radius: 8px; padding: 18px 22px; max-width: 540px; width: 100%; box-shadow: 0 20px 50px rgba(0,0,0,0.2); display: flex; flex-direction: column; gap: 12px; }
  .modal-header { display: flex; justify-content: space-between; align-items: center; }
  .modal-header h3 { margin: 0; font-size: 1.1rem; }
  .modal-close { background: none; border: none; color: var(--text-muted); font-size: 1.5rem; line-height: 1; cursor: pointer; padding: 0 4px; }
  .picker-search { padding: 8px 12px; border: 1px solid var(--border); border-radius: 6px; font-size: 0.95rem; }
  .picker-results { list-style: none; margin: 0; padding: 0; border: 1px solid var(--border); border-radius: 6px; max-height: 320px; overflow-y: auto; }
  .picker-results li { border-bottom: 1px solid var(--border); }
  .picker-results li:last-child { border-bottom: none; }
  .picker-pick { display: flex; flex-direction: column; gap: 2px; width: 100%; text-align: left; padding: 10px 12px; background: none; border: none; cursor: pointer; color: var(--text); }
  .picker-pick:hover { background: var(--surface-2, #f7f7f9); }
  .picker-name { font-weight: 600; }
  .picker-meta { font-size: 0.8rem; color: var(--text-muted); }
  .picker-empty { padding: 16px; text-align: center; }
</style>
