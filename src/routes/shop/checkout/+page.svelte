<!-- src/routes/shop/checkout/+page.svelte
     Checkout page: ship-vs-pickup, address, ShipTime rates, card form,
     and the actual POST /api/orders that creates the order + charges.
     After success, redirects to /shop/order/<n>/upload to collect artwork.
-->
<script>
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { dtfCart, isEmpty } from '$lib/stores/dtf-cart.js';
  import { customer } from '$lib/stores/customer-auth.js';
  import { customerApi } from '$lib/api/customer-client.js';

  const PROVINCES = [
    'AB','BC','MB','NB','NL','NS','NT','NU','ON','PE','QC','SK','YT',
  ];

  let fulfillment = 'ship';      // 'ship' | 'pickup'

  let shipTo = {
    name: '', addr1: '', addr2: '',
    city: '', province: 'ON', postal: '', country: 'CA',
    phone: '', email: '',
  };

  let shippingRates = [];        // populated after Get Rates
  let chosenRate = null;
  let ratesLoading = false;
  let ratesError = '';

  let pricing = null;
  let pricingLoading = false;
  let pricingError = '';

  // Card form. For v1 we collect raw card details and pass to Intuit's
  // tokenize endpoint via the backend. The cleanest production path is to
  // load Intuit's hosted tokenizer JS, which renders an iframe and gives
  // us a card token client-side — see TODO at bottom of file. For now this
  // works against QB Payments sandbox using their published test card
  // numbers (e.g. 4111 1111 1111 1111).
  let cardNumber = '';
  let cardExp    = '';
  let cardCvc    = '';
  let cardZip    = '';

  let placing = false;
  let orderError = '';

  const money = (n) =>
    new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(n || 0);

  onMount(() => {
    if (!$customer) { goto(`/shop/login?return=${encodeURIComponent('/shop/checkout')}`); return; }
    if ($isEmpty)   { goto('/shop/cart'); return; }
    // Pre-fill ship-to with profile data.
    shipTo.name  = $customer.name || '';
    shipTo.email = $customer.email || '';
    shipTo.phone = $customer.phone || '';
  });

  // Re-quote pricing whenever fulfillment / chosen rate / cart changes.
  $: if ($dtfCart && fulfillment) refreshPricing();

  async function refreshPricing() {
    if ($isEmpty) return;
    pricingLoading = true;
    pricingError = '';
    const shippingTotal = fulfillment === 'pickup' ? 0 : (chosenRate?.total_charge || 0);
    try {
      const res = await customerApi.quoteCart($dtfCart, shipTo, fulfillment, shippingTotal);
      pricing = res.breakdown;
    } catch (e) {
      pricingError = e.message;
    } finally {
      pricingLoading = false;
    }
  }

  async function fetchRates() {
    if (!shipTo.addr1 || !shipTo.city || !shipTo.postal) {
      ratesError = 'Enter address, city, and postal code first.';
      return;
    }
    ratesLoading = true;
    ratesError = '';
    chosenRate  = null;
    try {
      const res = await customerApi.getShippingRates($dtfCart, shipTo);
      shippingRates = res.rates || [];
      if (!shippingRates.length) ratesError = 'No carriers available for this address.';
    } catch (e) {
      ratesError = e.message;
    } finally {
      ratesLoading = false;
    }
  }

  async function placeOrder() {
    orderError = '';
    if (fulfillment === 'ship' && !chosenRate) {
      orderError = 'Pick a shipping option first.';
      return;
    }
    if (!cardNumber || !cardExp || !cardCvc) {
      orderError = 'Enter complete card details.';
      return;
    }
    // Tokenize the card via /api/payment/tokenize, which proxies to
    // Intuit's tokens API. The raw PAN transits the API server briefly
    // and is never logged or stored. (A future enhancement could load
    // Intuit's hosted JS iframe to keep the PAN entirely client-side
    // for SAQ-A scope; the rest of this flow wouldn't change.)
    let cardToken;
    try {
      const tokenized = await tokenizeCard({
        number: cardNumber.replace(/\s+/g, ''),
        exp:    cardExp,
        cvc:    cardCvc,
        zip:    cardZip,
        name:   shipTo.name || undefined,
      });
      cardToken = tokenized?.token;
    } catch (e) {
      orderError = e.body?.error || e.message || 'Card tokenization failed.';
      return;
    }
    if (!cardToken) { orderError = 'Card tokenization failed.'; return; }

    placing = true;
    try {
      const res = await customerApi.createOrder({
        cart: $dtfCart,
        fulfillment_method: fulfillment,
        ship_to: fulfillment === 'ship' ? shipTo : undefined,
        shipping_quote_id:   chosenRate?.quote_id,
        shipping_carrier_id: chosenRate?.carrier_id,
        shipping_service_id: chosenRate?.service_id,
        payment: { card_token: cardToken },
        customer_notes: '',
      });
      // Carry the in-memory File objects to the upload page via sessionStorage.
      // (Files survive navigation but not full reloads — fine for happy path.)
      sessionStorage.setItem('hg_pending_designs', JSON.stringify(
        $dtfCart.designs.map(({ _file, ...rest }) => rest)
      ));
      // Don't clear cart yet — upload page may need design file refs.
      goto(`/shop/order/${res.order.order_number}/upload`);
    } catch (e) {
      orderError = e.body?.error || e.message;
    } finally {
      placing = false;
    }
  }

  // Forward to /api/payment/tokenize. Returns { token, brand, last4 }.
  // Throws on validation / Intuit failures; caller catches above.
  async function tokenizeCard(card) {
    return customerApi.tokenizeCard(card);
  }
</script>

<svelte:head><title>Checkout — Holm Graphics</title></svelte:head>

<div class="checkout-page">
  <h1>Checkout</h1>

  <div class="grid">
    <section class="left">
      <h2>1. Fulfillment</h2>
      <div class="fulfillment">
        <label class:active={fulfillment === 'ship'}>
          <input type="radio" bind:group={fulfillment} value="ship" />
          <span><strong>Ship to me</strong><small>Canada Post / Purolator / FedEx</small></span>
        </label>
        <label class:active={fulfillment === 'pickup'}>
          <input type="radio" bind:group={fulfillment} value="pickup" />
          <span><strong>Pick up at shop</strong><small>2-43 Eastridge Rd, Walkerton ON · Free</small></span>
        </label>
      </div>

      {#if fulfillment === 'ship'}
        <h2>2. Shipping address</h2>
        <div class="form-grid">
          <label class="full">Recipient name <input type="text" bind:value={shipTo.name} required /></label>
          <label class="full">Address line 1 <input type="text" bind:value={shipTo.addr1} required /></label>
          <label class="full">Address line 2 <input type="text" bind:value={shipTo.addr2} /></label>
          <label>City <input type="text" bind:value={shipTo.city} required /></label>
          <label>Province
            <select bind:value={shipTo.province}>
              {#each PROVINCES as p}<option value={p}>{p}</option>{/each}
            </select>
          </label>
          <label>Postal code <input type="text" bind:value={shipTo.postal} required /></label>
          <label>Phone <input type="tel" bind:value={shipTo.phone} required /></label>
        </div>

        <h2>3. Shipping method</h2>
        <button type="button" class="btn ghost" on:click={fetchRates} disabled={ratesLoading}>
          {ratesLoading ? 'Getting rates…' : (shippingRates.length ? 'Refresh rates' : 'Get shipping rates')}
        </button>
        {#if ratesError}<p class="alert error">{ratesError}</p>{/if}

        {#if shippingRates.length}
          <div class="rates">
            {#each shippingRates as rate}
              <label class="rate" class:active={chosenRate?.quote_id === rate.quote_id}>
                <input type="radio" bind:group={chosenRate} value={rate}
                       on:change={refreshPricing} />
                <span>
                  <strong>{rate.carrier_name} — {rate.service_name}</strong>
                  <small>{rate.transit_days ? `${rate.transit_days} days` : ''}</small>
                </span>
                <span class="price">{money(rate.total_charge)}</span>
              </label>
            {/each}
          </div>
        {/if}
      {:else}
        <h2>2. Pickup details</h2>
        <p class="info">
          You'll receive an email when your order is ready. Pickup at:<br>
          <strong>Holm Graphics, 2-43 Eastridge Rd, Walkerton ON N0G 2V0</strong>
        </p>
        <div class="form-grid">
          <label class="full">Phone (so we can reach you when ready)
            <input type="tel" bind:value={shipTo.phone} required />
          </label>
        </div>
      {/if}

      <h2>{fulfillment === 'ship' ? '4' : '3'}. Payment</h2>
      <p class="info">Your card is charged immediately. We'll send a proof
        for your approval before printing — full refund if you cancel before
        production starts.</p>
      <div class="form-grid">
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
          <input type="text" bind:value={cardZip} autocomplete="cc-csc" />
        </label>
      </div>
      <p class="hint small">⚠️ Sandbox mode — uses Intuit test cards. Production tokenizer integration TBD.</p>
    </section>

    <aside class="summary">
      <h2>Summary</h2>
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
        <div class="row"><span>Subtotal</span><span>{money(pricing.subtotal)}</span></div>
        {#if fulfillment === 'ship'}
          <div class="row"><span>Shipping</span><span>{money(pricing.shipping_total)}</span></div>
        {/if}
        <div class="row"><span>Tax ({((pricing.tax_rate || 0) * 100).toFixed(2)}%)</span><span>{money(pricing.tax_total)}</span></div>
        <div class="row total"><span>Total</span><span>{money(pricing.grand_total)}</span></div>
      {/if}

      {#if orderError}<p class="alert error">{orderError}</p>{/if}

      <button class="btn primary" on:click={placeOrder} disabled={placing || pricingLoading || !pricing}>
        {placing ? 'Placing order…' : `Pay ${money(pricing?.grand_total)}`}
      </button>
      <a href="/shop/cart" class="back-link">← Back to cart</a>
    </aside>
  </div>
</div>

<style>
  .checkout-page { max-width: 70rem; margin: 0 auto; padding: 2rem 1rem; }
  h1 { margin: 0 0 1.5rem; }
  h2 { font-size: 1.05rem; margin: 1.5rem 0 0.75rem; padding-bottom: 0.5rem; border-bottom: 1px solid #eee; }
  .grid { display: grid; grid-template-columns: 1fr 22rem; gap: 1.5rem; }
  @media (max-width: 850px) { .grid { grid-template-columns: 1fr; } }

  .left { background: white; border: 1px solid #e4e4e7; border-radius: 0.5rem; padding: 1.5rem; }
  .summary { background: #fafafa; border: 1px solid #e4e4e7; border-radius: 0.5rem; padding: 1.25rem; align-self: start; }

  .fulfillment { display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; margin-bottom: 0.5rem; }
  .fulfillment label { display: flex; gap: 0.6rem; padding: 0.85rem 1rem; border: 1px solid #d4d4d8; border-radius: 0.4rem; cursor: pointer; align-items: start; }
  .fulfillment label.active { border-color: #c01818; background: #fff5f5; }
  .fulfillment span { display: flex; flex-direction: column; }
  .fulfillment small { color: #777; font-size: 0.85rem; }

  .form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.85rem; }
  .form-grid .full { grid-column: 1 / -1; }
  .form-grid label { display: flex; flex-direction: column; gap: 0.3rem; font-size: 0.9rem; color: #333; }
  .form-grid input, .form-grid select { padding: 0.55rem 0.7rem; border: 1px solid #d4d4d8; border-radius: 0.3rem; font-size: 1rem; }
  .form-grid input:focus, .form-grid select:focus { outline: 2px solid #c01818; outline-offset: -1px; }

  .info { background: #eef6ff; padding: 0.75rem 1rem; border-radius: 0.3rem; color: #225; margin: 0.5rem 0; }
  .alert { padding: 0.5rem 0.75rem; border-radius: 0.3rem; }
  .alert.error { background: #fee; color: #b00; }
  .muted { color: #666; }
  .hint { color: #888; font-size: 0.85rem; margin-top: 0.5rem; }

  .rates { display: flex; flex-direction: column; gap: 0.5rem; margin-top: 0.75rem; }
  .rates .rate { display: grid; grid-template-columns: auto 1fr auto; gap: 0.6rem; padding: 0.75rem; border: 1px solid #d4d4d8; border-radius: 0.4rem; cursor: pointer; align-items: center; }
  .rates .rate.active { border-color: #c01818; background: #fff5f5; }
  .rates .rate small { color: #777; margin-left: 0.5rem; }
  .rates .rate .price { font-weight: 600; }

  .summary .row { display: flex; justify-content: space-between; padding: 0.3rem 0; }
  .summary .row.total { padding-top: 0.7rem; margin-top: 0.6rem; border-top: 1px solid #ddd; font-weight: 700; font-size: 1.1rem; }
  .btn { display: inline-block; padding: 0.85rem 1rem; background: #c01818; color: white; border: none; border-radius: 0.4rem; font-weight: 600; cursor: pointer; }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn.ghost { background: transparent; color: #c01818; border: 1px solid #c01818; padding: 0.5rem 0.85rem; font-size: 0.9rem; }
  .summary .btn { width: 100%; margin-top: 0.75rem; }
  .back-link { display: block; text-align: center; margin-top: 0.75rem; color: #555; font-size: 0.9rem; text-decoration: none; }
  .back-link:hover { color: #c01818; }
</style>
