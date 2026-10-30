<!-- src/routes/shop/checkout/complete/+page.svelte
     Stripe Checkout sends the buyer here (?session_id=cs_...). We ask the
     API to confirm the payment with Stripe and create the order, then
     point them at the artwork upload: the public upload link for guests,
     the account upload page for signed-in buyers. Reloading is safe — the
     API returns the same order every time.
-->
<script>
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { dtfCart } from '$lib/stores/dtf-cart.js';
  import { customerApi } from '$lib/api/customer-client.js';

  let state = 'loading';   // 'loading' | 'paid' | 'unpaid' | 'error'
  let order = null;
  let uploadUrl = null;
  let error = '';

  const money = (n) =>
    new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(n || 0);

  onMount(async () => {
    const sessionId = $page.url.searchParams.get('session_id');
    if (!sessionId) { goto('/shop/cart'); return; }
    try {
      const res = await customerApi.confirmCheckout(sessionId);
      if (res.status !== 'paid') { state = 'unpaid'; return; }
      order = res.order;
      uploadUrl = res.upload_url || res.next_step_url;
      // Paid — the cart has done its job.
      dtfCart.clear();
      state = 'paid';
    } catch (e) {
      error = e.body?.error || e.message;
      state = 'error';
    }
  });
</script>

<svelte:head><title>Order placed — Holm Graphics</title></svelte:head>

<div class="complete-page">
  {#if state === 'loading'}
    <p class="muted">Confirming your payment…</p>
  {:else if state === 'paid'}
    <h1>Thank you — order #{order.order_number} is in.</h1>
    <p>We've received your payment of <strong>{money(order.grand_total)}</strong>.
      A confirmation is on its way to <strong>{order.email}</strong>.</p>
    <h2>Next: send us your artwork</h2>
    <p>Upload your logo or design files now. If you'd rather do it later, the
      upload link is in your email too. We'll send a proof for your approval
      before anything is printed.</p>
    {#if uploadUrl}
      <a class="btn primary" href={uploadUrl}>Upload artwork →</a>
    {/if}
    <p class="muted small">Questions? Call 519-507-3001.</p>
  {:else if state === 'unpaid'}
    <h1>Payment not finished</h1>
    <p>Stripe hasn't confirmed a payment for this order, so nothing has been
      charged. Your cart is still saved.</p>
    <a class="btn primary" href="/shop/checkout">Back to checkout</a>
  {:else}
    <h1>Something went wrong</h1>
    <p class="alert error">{error}</p>
    <p>Please call us at 519-507-3001 and we'll sort it out.</p>
  {/if}
</div>

<style>
  .complete-page { max-width: 40rem; margin: 0 auto; padding: 3rem 1rem; }
  h1 { margin: 0 0 1rem; font-size: 1.6rem; }
  h2 { font-size: 1.1rem; margin: 2rem 0 0.5rem; }
  p { line-height: 1.5; }
  .muted { color: #666; }
  .small { font-size: 0.9rem; margin-top: 1.5rem; }
  .alert.error { background: #fee; color: #b00; padding: 0.5rem 0.75rem; border-radius: 0.3rem; }
  .btn { display: inline-block; padding: 0.85rem 1.25rem; background: #c01818; color: white; border-radius: 0.4rem; font-weight: 600; text-decoration: none; margin-top: 0.5rem; }
</style>
