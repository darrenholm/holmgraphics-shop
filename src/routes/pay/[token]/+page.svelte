<!--
  Customer-facing card payment page.

  URL: /pay/<token>

  No login — the token IS the auth, like /proofs/<token>. Staff make the link
  from Take Payment → Pay link on the job page. The card box is Stripe's own
  (the number goes straight to Stripe); the payment is recorded and posted to
  QuickBooks by the Stripe webhook, not by this page.
-->
<script>
  import { onMount, onDestroy, tick } from 'svelte';
  import { page } from '$app/stores';
  import { mountCardBox } from '$lib/pos/stripeCard.js';

  // Hit the API directly — this endpoint has no auth header.
  const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';
  const PHONE = '519-507-3001';

  let loading = true;
  let loadError = '';
  let link = null;         // { status, amountCents, jobId, description, clientName, clientSecret?, publishableKey? }
  let boxEl;
  let box = null;
  let paying = false;
  let payError = '';
  let paid = false;

  $: token = $page.params.token;

  function money(c) { return `$${((c || 0) / 100).toFixed(2)}`; }

  onMount(load);
  onDestroy(() => box?.destroy());

  async function load() {
    loading = true; loadError = '';
    try {
      const r = await fetch(`${API_URL}/pay/${encodeURIComponent(token)}`);
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`);
      link = body;
      paid = link.status === 'paid';
      if (link.status === 'open') {
        loading = false;
        await tick();
        box = await mountCardBox(boxEl, { ...link, wallets: true });
      }
    } catch (e) {
      loadError = e.message || 'Unable to load this payment link.';
    } finally {
      loading = false;
    }
  }

  async function pay() {
    if (!box || paying) return;
    paying = true; payError = '';
    try {
      await box.confirm();
      box.destroy(); box = null;
      paid = true;
    } catch (e) {
      payError = e.message || String(e);
    } finally {
      paying = false;
    }
  }
</script>

<svelte:head>
  <title>Pay Holm Graphics</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<div class="pay-page">
  <header class="ph-header">
    <img src="/logo.png" alt="Holm Graphics" class="ph-logo" on:error={(e) => (e.target.style.display = 'none')} />
    <h1>Card payment</h1>
    <p class="tagline">Holm Graphics • Walkerton</p>
  </header>

  {#if loading}
    <div class="ph-card center">Loading…</div>
  {:else if loadError}
    <div class="ph-card error">
      <strong>Couldn't open this payment link.</strong>
      <p>{loadError}</p>
      <p>Please call us at {PHONE}.</p>
    </div>
  {:else if link}
    <div class="ph-card summary">
      <div class="amount">{money(link.amountCents)}</div>
      {#if link.jobId}<div>Job #{link.jobId}{link.description ? ` — ${link.description}` : ''}</div>{/if}
      {#if link.clientName}<div class="muted">{link.clientName}</div>{/if}
    </div>

    {#if paid}
      <div class="ph-card ok">
        <strong>Paid — thank you.</strong>
        <p>Your payment of {money(link.amountCents)} has been received. You can close this page.</p>
      </div>
    {:else if link.status === 'canceled'}
      <div class="ph-card error">
        <strong>This payment link is no longer active.</strong>
        <p>It may have been replaced by a newer one. Please check your email or call us at {PHONE}.</p>
      </div>
    {:else}
      <div class="ph-card">
        <div bind:this={boxEl}></div>
        {#if payError}<p class="err">{payError}</p>{/if}
        <button class="pay-btn" on:click={pay} disabled={!box || paying}>
          {paying ? 'Paying…' : `Pay ${money(link.amountCents)}`}
        </button>
        <p class="muted small">
          Your card details go directly to our payment processor, Stripe. Holm Graphics never
          sees your card number.
        </p>
      </div>
    {/if}
  {/if}
</div>

<style>
  .pay-page { max-width: 520px; margin: 0 auto; padding: 16px; color: #1a1a1a; }
  .ph-header { text-align: center; padding: 16px 0; }
  .ph-logo { height: 48px; }
  .ph-header h1 { margin: 8px 0 0; font-size: 1.6rem; }
  .tagline { margin: 4px 0 0; color: #64748b; font-size: 0.9rem; }
  .ph-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 6px; padding: 16px; margin-top: 12px; }
  .center { text-align: center; }
  .error { border-color: #fecaca; background: #fef2f2; }
  .ok { border-color: #bbf7d0; background: #f0fdf4; }
  .summary { text-align: center; }
  .amount { font-size: 2rem; font-weight: 700; margin-bottom: 4px; }
  .muted { color: #64748b; }
  .small { font-size: 0.8rem; margin: 12px 0 0; }
  .err { color: #b91c1c; margin: 10px 0 0; }
  .pay-btn {
    display: block; width: 100%; margin-top: 16px; padding: 14px;
    font-size: 1.1rem; font-weight: 700; color: #fff; background: #c8102e;
    border: 0; border-radius: 6px; cursor: pointer;
  }
  .pay-btn:disabled { opacity: 0.5; cursor: default; }
</style>
