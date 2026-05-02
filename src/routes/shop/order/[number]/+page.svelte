<!-- src/routes/shop/order/[number]/+page.svelte
     Customer-facing order status. Shows current state, line items,
     decorations, designs, tracking. Auth required (customer JWT). -->
<script>
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { customer } from '$lib/stores/customer-auth.js';
  import { customerApi } from '$lib/api/customer-client.js';

  let order = null;
  let items = [];
  let decorations = [];
  let designs = [];
  let loading = true;
  let error = '';

  $: orderNumber = $page.params.number;

  onMount(async () => {
    if (!$customer) { goto(`/shop/login?return=${encodeURIComponent($page.url.pathname)}`); return; }
    try {
      const res = await customerApi.getOrder(orderNumber);
      order = res.order;
      items = res.items;
      decorations = res.decorations;
      designs = res.designs;
    } catch (e) {
      error = e.message;
    } finally {
      loading = false;
    }
  });

  const money = (n) =>
    new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(n || 0);

  const STATUS_LABELS = {
    awaiting_artwork:  { label: 'Awaiting your artwork',     color: '#888' },
    awaiting_proof:    { label: 'Generating proof',          color: '#3a7' },
    awaiting_approval: { label: 'Awaiting your approval',    color: '#c80' },
    in_production:    { label: 'In production',              color: '#37c' },
    ready_to_ship:    { label: 'Ready to ship',              color: '#37c' },
    ready_for_pickup: { label: 'Ready for pickup',           color: '#3a7' },
    shipped:          { label: 'Shipped',                    color: '#3a7' },
    delivered:        { label: 'Delivered',                  color: '#3a7' },
    picked_up:        { label: 'Picked up',                  color: '#3a7' },
    complete:         { label: 'Complete',                   color: '#888' },
    cancelled:        { label: 'Cancelled',                  color: '#b00' },
    refunded:         { label: 'Refunded',                   color: '#b00' },
  };
</script>

<svelte:head><title>Order #{orderNumber} — Holm Graphics</title></svelte:head>

<div class="page">
  {#if loading}
    <p>Loading…</p>
  {:else if error}
    <p class="alert error">{error}</p>
  {:else if order}
    <div class="head">
      <h1>Order #{order.order_number}</h1>
      <span class="status-pill" style="background:{STATUS_LABELS[order.status]?.color || '#666'}">
        {STATUS_LABELS[order.status]?.label || order.status}
      </span>
    </div>
    <p class="meta">Placed {new Date(order.created_at).toLocaleString('en-CA')}</p>

    {#if order.status === 'awaiting_artwork'}
      <div class="alert warn">
        We need your artwork to start this order.
        <a href="/shop/order/{order.order_number}/upload" class="btn primary">Upload artwork →</a>
      </div>
    {/if}

    {#if order.payment_method === 'invoice_pending'}
      <div class="alert info">
        <span>
          <strong>Invoice forthcoming.</strong>
          {#if order.due_date}
            Payment of <strong>{money(order.grand_total)}</strong> is due
            <strong>{new Date(order.due_date).toLocaleDateString('en-CA', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</strong>.
          {:else}
            We'll email an invoice for <strong>{money(order.grand_total)}</strong> shortly.
          {/if}
        </span>
      </div>
    {/if}

    {#if order.status === 'shipped' && order.tracking_number}
      <div class="alert info">
        Shipped via {order.shipping_carrier} — tracking
        <strong>{order.tracking_number}</strong>
      </div>
    {/if}

    {#if order.status === 'ready_for_pickup'}
      <div class="alert info">
        Ready for pickup at <strong>2-43 Eastridge Rd, Walkerton ON</strong>.
        Bring your order number.
      </div>
    {/if}

    <div class="grid">
      <section>
        <h2>Items</h2>
        {#each items as it}
          <div class="row">
            <div>
              <strong>{it.product_name}</strong>
              <small>{it.color_name} · {it.size}</small>
            </div>
            <div>{it.quantity} × {money(it.unit_price)}</div>
            <div class="amt">{money(it.line_subtotal)}</div>
          </div>
        {/each}
      </section>

      <section>
        <h2>Designs</h2>
        {#each designs as d}
          <div class="design-row">
            🎨 <strong>{d.name}</strong>
            <small>{d.artwork_filename}</small>
          </div>
        {:else}
          <p class="muted">No designs uploaded yet.</p>
        {/each}
      </section>

      <aside class="totals">
        <div><span>Garments</span><span>{money(order.items_subtotal)}</span></div>
        <div><span>Shipping</span><span>{money(order.shipping_total)}</span></div>
        <div><span>Tax</span><span>{money(order.tax_total)}</span></div>
        <div class="grand"><span>Total</span><span>{money(order.grand_total)}</span></div>
      </aside>
    </div>

    {#if order.fulfillment_method === 'ship' && order.ship_to_addr1}
      <section class="ship-to">
        <h2>Ship to</h2>
        <p>
          {order.ship_to_name}<br>
          {order.ship_to_addr1}{#if order.ship_to_addr2}, {order.ship_to_addr2}{/if}<br>
          {order.ship_to_city}, {order.ship_to_province} {order.ship_to_postal}<br>
          {order.ship_to_country}
        </p>
      </section>
    {/if}

    <a href="/shop/account" class="back-link">← Back to all orders</a>
  {/if}
</div>

<style>
  .page { max-width: 60rem; margin: 0 auto; padding: 2rem 1rem; }
  .head { display: flex; justify-content: space-between; align-items: center; }
  h1 { margin: 0; }
  .status-pill { color: white; padding: 0.3rem 0.75rem; border-radius: 1rem; font-size: 0.85rem; font-weight: 500; }
  .meta { color: #777; margin: 0.25rem 0 1.5rem; }
  .alert { padding: 0.85rem 1rem; border-radius: 0.4rem; margin: 1rem 0; display: flex; justify-content: space-between; align-items: center; gap: 1rem; }
  .alert.warn { background: #fff8e0; color: #885; }
  .alert.info { background: #eef6ff; color: #225; }
  .alert.error { background: #fee; color: #b00; }
  .btn.primary { background: #c01818; color: white; padding: 0.5rem 1rem; border-radius: 0.3rem; text-decoration: none; font-weight: 600; }
  .grid { display: grid; grid-template-columns: 2fr 1fr 18rem; gap: 1.5rem; margin: 1.5rem 0; }
  @media (max-width: 850px) { .grid { grid-template-columns: 1fr; } }
  section h2 { font-size: 1rem; margin: 0 0 0.75rem; color: #555; }
  .row { display: grid; grid-template-columns: 1fr auto auto; gap: 1rem; padding: 0.5rem 0; border-bottom: 1px dashed #eee; }
  .row .amt { font-weight: 600; min-width: 5rem; text-align: right; }
  .row small { color: #888; margin-left: 0.5rem; }
  .design-row { display: flex; align-items: center; gap: 0.5rem; padding: 0.5rem 0; border-bottom: 1px dashed #eee; }
  .totals { background: #fafafa; padding: 1rem; border-radius: 0.4rem; align-self: start; }
  .totals div { display: flex; justify-content: space-between; padding: 0.25rem 0; }
  .totals .grand { padding-top: 0.6rem; margin-top: 0.5rem; border-top: 1px solid #ddd; font-weight: 700; }
  .ship-to { background: #fafafa; padding: 1rem 1.25rem; border-radius: 0.4rem; }
  .muted { color: #888; }
  .back-link { display: inline-block; margin-top: 1rem; color: #c01818; text-decoration: none; }
</style>
