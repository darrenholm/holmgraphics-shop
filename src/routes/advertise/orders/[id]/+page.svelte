<script>
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { advertiseApi, fmtMoney } from '$lib/advertise/api.js';

  let order = null;
  let err = null;
  let uploading = false;
  let paying = false;

  // Card form
  let cardNumber = '';
  let cardExp = '';
  let cardCvc = '';
  let cardZip = '';
  let cardName = '';

  $: id = $page.params.id;

  const STATUS_COPY = {
    pending_payment: { label: 'Waiting for payment', tone: 'info' },
    pending_review:  { label: 'Pending review by Holm Graphics', tone: 'info' },
    approved:        { label: 'Approved — scheduled to run', tone: 'good' },
    active:          { label: 'Running on display', tone: 'good' },
    expired:         { label: 'Expired (run completed)', tone: 'info' },
    rejected:        { label: 'Not approved', tone: 'bad' },
    cancelled:       { label: 'Cancelled', tone: 'bad' },
  };

  onMount(refresh);

  async function refresh() {
    err = null;
    try {
      order = await advertiseApi.getRental(id);
    } catch (e) {
      err = e.message;
    }
  }

  async function onUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    uploading = true;
    err = null;
    try {
      await advertiseApi.uploadArtwork(id, file);
      await refresh();
    } catch (ex) {
      err = ex.message;
    } finally {
      uploading = false;
      e.target.value = '';
    }
  }

  async function onPay() {
    paying = true;
    err = null;
    try {
      await advertiseApi.payRental(id, {
        cardNumber,
        cardExp,
        cardCvc: cardCvc || undefined,
        cardZip,
        cardName: cardName || undefined,
      });
      cardNumber = cardExp = cardCvc = cardZip = cardName = '';
      await refresh();
    } catch (e) {
      err = e.message;
    } finally {
      paying = false;
    }
  }
</script>

<svelte:head>
  <title>Your booking — Advertise with Holm Graphics</title>
</svelte:head>

<div class="header">
  <div class="header-inner">
    <a href="/advertise/displays/" class="back">← All displays</a>
    {#if order}
      <h1>Your ad on {order.device_name}</h1>
      <div class="loc">{order.start_date} → {order.end_date}</div>
    {/if}
  </div>
</div>

<div class="container">
  {#if err && !order}
    <div class="error">{err}</div>
  {:else if !order}
    <div class="muted">Loading…</div>
  {:else}
    {@const tone = STATUS_COPY[order.status] ?? { label: order.status, tone: 'info' }}
    {@const allowUpload = ['pending_payment', 'pending_review'].includes(order.status)}
    {@const needsPayment = order.status === 'pending_payment'}

    <div class="card status">
      <div>
        <div class="label">Status</div>
        <div class={`val tone-${tone.tone}`}>{tone.label}</div>
      </div>
      <div>
        <div class="label">Total</div>
        <div class="val">{fmtMoney(order.amount_cents, order.currency)}</div>
      </div>
      {#if order.paid_at}
        <div>
          <div class="label">Paid</div>
          <div class="val">{new Date(order.paid_at).toLocaleDateString()}</div>
        </div>
      {/if}
    </div>

    {#if order.review_notes && order.status === 'rejected'}
      <div class="card">
        <strong>Reason:</strong> {order.review_notes}
      </div>
    {/if}

    <!-- Artwork upload -->
    {#if !order.storage_url && allowUpload}
      <div class="card">
        <h3>1. Upload your artwork</h3>
        <p class="muted">JPG, PNG, or MP4. Sized to match the display gives the best look.</p>
        <label class="cta-label">
          <input type="file" accept="image/*,video/*" on:change={onUpload} hidden />
          <span class="cta">{uploading ? 'Uploading…' : '+ Upload artwork'}</span>
        </label>
      </div>
    {/if}

    {#if order.storage_url}
      <div class="card">
        <h3>Your artwork</h3>
        <img src={order.storage_url} alt="Your artwork" class="artwork" />
        {#if order.artwork_warnings?.length > 0}
          <div class="warn">
            <strong>Heads up:</strong>
            <ul>
              {#each order.artwork_warnings as w, i (i)}<li>{w}</li>{/each}
            </ul>
            {#if allowUpload}
              <label class="cta-label small">
                <input type="file" accept="image/*,video/*" on:change={onUpload} hidden />
                <span class="link">Upload a replacement</span>
              </label>
            {/if}
          </div>
        {/if}
      </div>
    {/if}

    <!-- Payment -->
    {#if needsPayment}
      <div class="card">
        <h3>2. Payment</h3>
        <form on:submit|preventDefault={onPay}>
          <label>Card number
            <input bind:value={cardNumber} required placeholder="4111 1111 1111 1111" autocomplete="cc-number" />
          </label>
          <div class="row">
            <label>Expiry (MM/YY)
              <input bind:value={cardExp} required placeholder="12/27" autocomplete="cc-exp" />
            </label>
            <label>CVC
              <input bind:value={cardCvc} placeholder="123" autocomplete="cc-csc" />
            </label>
            <label>Postal/Zip
              <input bind:value={cardZip} required placeholder="N0G 2V0" autocomplete="postal-code" />
            </label>
          </div>
          <label>Name on card
            <input bind:value={cardName} autocomplete="cc-name" />
          </label>
          {#if err}
            <div class="error">{err}</div>
          {/if}
          <button type="submit" class="cta" disabled={paying}>
            {paying ? 'Processing…' : `Pay ${fmtMoney(order.amount_cents, order.currency)}`}
          </button>
          <div class="muted small">
            Card data is sent directly to our payment processor (Intuit/QuickBooks).
            Holm Graphics never sees the plaintext card.
          </div>
        </form>
      </div>
    {:else if order.paid_at}
      <div class="card">
        <h3>2. Payment</h3>
        <div class="paid">✓ Payment received {new Date(order.paid_at).toLocaleDateString()}</div>
      </div>
    {/if}

    <!-- Approval -->
    <div class="card">
      <h3>3. Approval</h3>
      {#if order.status === 'pending_review'}
        <div>Your submission is in our review queue. We'll email you when it's approved.</div>
      {:else if order.status === 'approved'}
        <div class="tone-good">✓ Approved! Your ad is scheduled to run on the dates above.</div>
      {:else if order.status === 'active'}
        <div class="tone-good">✓ Your ad is currently running.</div>
      {:else if order.status === 'rejected'}
        <div class="tone-bad">Your submission was not approved.</div>
      {:else if order.status === 'pending_payment'}
        <div class="muted">Waiting for payment before review can start.</div>
      {/if}
    </div>

    <p class="muted small center">Bookmark this page to check status. Questions? Reply to your confirmation email.</p>
  {/if}
</div>

<style>
  .header {
    background: var(--surface-2);
    border-bottom: 1px solid var(--border);
    padding: 24px 20px;
  }
  .header-inner { max-width: 760px; margin: 0 auto; }
  .back {
    color: var(--red);
    text-decoration: none;
    font-family: var(--font-display);
    font-weight: 600;
    font-size: 0.9rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  h1 {
    font-family: var(--font-display);
    margin: 8px 0 0;
    font-size: 1.8rem;
    color: var(--text);
  }
  .loc { color: var(--text-muted); margin-top: 4px; }

  .container { max-width: 760px; margin: 0 auto; padding: 28px 20px 80px; }
  .muted { color: var(--text-muted); }
  .small { font-size: 0.85rem; }
  .center { text-align: center; margin-top: 24px; }
  .error {
    background: rgba(192,57,43,0.1);
    border: 1px solid var(--red);
    color: var(--red);
    padding: 12px;
    border-radius: 6px;
    margin: 12px 0;
  }

  .card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 20px;
    margin-bottom: 16px;
  }
  .card h3 {
    margin: 0 0 12px;
    font-family: var(--font-display);
    font-size: 1.2rem;
    color: var(--text);
  }

  .status {
    display: flex;
    justify-content: space-between;
    gap: 24px;
    flex-wrap: wrap;
  }
  .label {
    font-family: var(--font-display);
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-size: 0.82rem;
  }
  .val {
    font-family: var(--font-display);
    font-weight: 600;
    font-size: 1.15rem;
    color: var(--text);
    margin-top: 2px;
  }
  .tone-good { color: #16a34a; }
  .tone-bad  { color: var(--red); }

  .artwork {
    max-width: 100%;
    border-radius: 6px;
    border: 1px solid var(--border);
    display: block;
  }
  .warn {
    margin-top: 12px;
    padding: 12px;
    background: rgba(230, 181, 74, 0.1);
    border-radius: 6px;
    font-size: 0.92rem;
  }
  .warn ul { margin: 6px 0 0 18px; padding: 0; }

  label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-bottom: 12px;
    font-family: var(--font-display);
    font-weight: 600;
    color: var(--text-muted);
    font-size: 0.82rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  input {
    font-family: var(--font-body);
    background: var(--surface);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 10px 12px;
    font-size: 0.95rem;
    text-transform: none;
    letter-spacing: 0;
  }
  .row {
    display: flex;
    gap: 12px;
  }
  .row label { flex: 1; }

  .cta-label { display: inline-block; cursor: pointer; }
  .cta-label.small .link {
    color: var(--red);
    text-decoration: underline;
    font-size: 0.85rem;
    font-family: var(--font-body);
    font-weight: 500;
    text-transform: none;
    letter-spacing: 0;
  }
  .cta {
    display: inline-block;
    background: var(--red);
    color: white;
    border: 0;
    border-radius: 6px;
    padding: 12px 20px;
    font-family: var(--font-display);
    font-weight: 700;
    font-size: 0.95rem;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    cursor: pointer;
    width: 100%;
    text-align: center;
  }
  button.cta { width: 100%; }
  .cta:hover:not(:disabled) { background: var(--red-dark); }
  .cta:disabled { opacity: 0.5; cursor: not-allowed; }

  .paid { color: #16a34a; font-family: var(--font-display); font-weight: 600; }
</style>
