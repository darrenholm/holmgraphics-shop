<!--
  /advertise/my-ads — the self-serve dashboard for ad-rental customers.

  Three sections (Currently running / Upcoming / Past), sourced from the
  LED app's /api/public/my-rentals endpoint. That endpoint requires a
  customer JWT, which lives in localStorage under hg_token after the
  customer signs in at /login.

  If the customer isn't logged in, we redirect to /login with a next= so
  they come back here after auth. No data is fetched without the token.
-->
<script>
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { customer, isCustomerLoggedIn } from '$lib/stores/customer-auth.js';
  import { advertiseApi, fmtMoney } from '$lib/advertise/api.js';

  let loading = true;
  let err = null;
  let running = [];
  let upcoming = [];
  let past = [];
  let advertiser = null;

  /** "14:30" / "14:30:00" → "2:30 PM" */
  function fmt12(t) {
    if (!t) return '';
    const [h, m] = t.split(':');
    const hh = Number(h);
    const ampm = hh < 12 ? 'AM' : 'PM';
    const h12 = hh % 12 === 0 ? 12 : hh % 12;
    return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
  }

  function isAllDay(s, e) {
    if (!s || !e) return false;
    const a = s.slice(0, 5), b = e.slice(0, 5);
    return a === '00:00' && (b === '23:59' || b === '23:58');
  }

  function daypartSummary(r) {
    if (!r.start_time || !r.end_time) return '';
    return isAllDay(r.start_time, r.end_time)
      ? 'Plays all day'
      : `Plays daily ${fmt12(r.start_time)} – ${fmt12(r.end_time)}`;
  }

  function windowSummary(r) {
    if (r.start_date && r.end_date) return `${r.start_date} → ${r.end_date}`;
    if (r.status === 'pending_payment')  return 'Awaiting payment';
    if (r.status === 'pending_review')   return 'Awaiting review';
    return 'Window scheduled on approval';
  }

  onMount(async () => {
    if (!$isCustomerLoggedIn) {
      goto(`/shop/login?return=${encodeURIComponent('/advertise/my-ads')}`);
      return;
    }
    try {
      const data = await advertiseApi.getMyRentals();
      running   = data.running   || [];
      upcoming  = data.upcoming  || [];
      past      = data.past      || [];
      advertiser = data.advertiser || null;
    } catch (e) {
      // 401 from a stale/missing token: kick to customer login.
      if (/401|sign in|missing bearer|invalid customer token/i.test(e.message || '')) {
        customer.logout();
        goto(`/shop/login?return=${encodeURIComponent('/advertise/my-ads')}`);
        return;
      }
      err = e.message;
    } finally {
      loading = false;
    }
  });
</script>

<svelte:head>
  <title>My ads — Holm Graphics</title>
</svelte:head>

<div class="header">
  <div class="header-inner">
    <a href="/advertise/" class="back">← Advertise home</a>
    <h1>My ads</h1>
    {#if advertiser}
      <div class="loc">{advertiser.company || advertiser.name || advertiser.email}</div>
    {:else if $customer}
      <div class="loc">{$customer.company || $customer.name || $customer.email}</div>
    {/if}
  </div>
</div>

<div class="container">
  {#if loading}
    <div class="muted">Loading…</div>
  {:else if err}
    <div class="error">{err}</div>
  {:else}
    {#if running.length === 0 && upcoming.length === 0 && past.length === 0}
      <div class="card empty">
        <h3>No ads yet</h3>
        <p class="muted">You haven't booked an ad rental yet. <a href="/advertise/displays/">Browse available displays</a> to get started.</p>
      </div>
    {/if}

    {#if running.length > 0}
      <section class="card">
        <h3 class="section-title">
          <span class="dot dot-good"></span>
          Currently running
        </h3>
        <div class="rental-list">
          {#each running as r (r.id)}
            <a class="rental" href="/advertise/my-ads/{r.id}/">
              <div class="rental-thumb">
                {#if r.storage_url && r.media_mime?.startsWith('image/')}
                  <img src={r.storage_url} alt="" />
                {:else if r.storage_url && r.media_mime?.startsWith('video/')}
                  <video src={r.storage_url} muted></video>
                {:else}
                  <div class="thumb-empty">No art yet</div>
                {/if}
              </div>
              <div class="rental-body">
                <div class="rental-title">{r.device_name}</div>
                <div class="rental-meta muted">{windowSummary(r)}</div>
                {#if daypartSummary(r)}<div class="rental-meta muted">{daypartSummary(r)}</div>{/if}
                {#if r.publish_error}
                  <div class="rental-warn">⚠ Last publish failed — open to retry</div>
                {/if}
              </div>
              <div class="rental-cta">Change ad →</div>
            </a>
          {/each}
        </div>
      </section>
    {/if}

    {#if upcoming.length > 0}
      <section class="card">
        <h3 class="section-title">
          <span class="dot dot-info"></span>
          Upcoming
        </h3>
        <div class="rental-list">
          {#each upcoming as r (r.id)}
            <a class="rental" href="/advertise/my-ads/{r.id}/">
              <div class="rental-thumb">
                {#if r.storage_url && r.media_mime?.startsWith('image/')}
                  <img src={r.storage_url} alt="" />
                {:else if r.storage_url && r.media_mime?.startsWith('video/')}
                  <video src={r.storage_url} muted></video>
                {:else}
                  <div class="thumb-empty">No art yet</div>
                {/if}
              </div>
              <div class="rental-body">
                <div class="rental-title">{r.device_name}</div>
                <div class="rental-meta muted">{windowSummary(r)}</div>
                {#if daypartSummary(r)}<div class="rental-meta muted">{daypartSummary(r)}</div>{/if}
                <div class="rental-status status-{r.status}">{r.status.replace(/_/g, ' ')}</div>
              </div>
              <div class="rental-cta">View →</div>
            </a>
          {/each}
        </div>
      </section>
    {/if}

    {#if past.length > 0}
      <section class="card">
        <h3 class="section-title">
          <span class="dot dot-muted"></span>
          Past
        </h3>
        <div class="rental-list">
          {#each past as r (r.id)}
            <a class="rental rental-past" href="/advertise/my-ads/{r.id}/">
              <div class="rental-thumb">
                {#if r.storage_url && r.media_mime?.startsWith('image/')}
                  <img src={r.storage_url} alt="" />
                {:else}
                  <div class="thumb-empty">—</div>
                {/if}
              </div>
              <div class="rental-body">
                <div class="rental-title">{r.device_name}</div>
                <div class="rental-meta muted">{windowSummary(r)}</div>
                <div class="rental-status status-{r.status}">{r.status.replace(/_/g, ' ')}</div>
              </div>
              <div class="rental-cta">View →</div>
            </a>
          {/each}
        </div>
      </section>
    {/if}
  {/if}
</div>

<style>
  .header {
    background: var(--surface-2);
    border-bottom: 1px solid var(--border);
    padding: 24px 20px;
  }
  .header-inner { max-width: 880px; margin: 0 auto; }
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

  .container { max-width: 880px; margin: 0 auto; padding: 28px 20px 80px; }
  .muted { color: var(--text-muted); }
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
  .card.empty { text-align: center; padding: 36px 20px; }
  .card.empty h3 { margin: 0 0 8px; font-family: var(--font-display); }

  .section-title {
    margin: 0 0 12px;
    font-family: var(--font-display);
    font-size: 1.1rem;
    color: var(--text);
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }
  .dot-good  { background: #16a34a; }
  .dot-info  { background: #d97706; }
  .dot-muted { background: var(--text-muted); }

  .rental-list { display: flex; flex-direction: column; gap: 8px; }
  .rental {
    display: grid;
    grid-template-columns: 80px 1fr auto;
    gap: 16px;
    align-items: center;
    padding: 10px;
    border: 1px solid var(--border);
    border-radius: 6px;
    text-decoration: none;
    color: var(--text);
    background: var(--surface-2);
    transition: background 0.1s;
  }
  .rental:hover { background: rgba(192,57,43,0.05); }
  .rental-past { opacity: 0.75; }

  .rental-thumb {
    width: 80px;
    height: 60px;
    background: #000;
    border-radius: 4px;
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .rental-thumb img,
  .rental-thumb video {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .thumb-empty {
    color: var(--text-muted);
    font-size: 0.75rem;
    font-family: var(--font-display);
    text-transform: uppercase;
    text-align: center;
  }

  .rental-body { min-width: 0; }
  .rental-title {
    font-family: var(--font-display);
    font-weight: 600;
    font-size: 1rem;
    color: var(--text);
  }
  .rental-meta { font-size: 0.85rem; margin-top: 2px; }
  .rental-warn {
    color: #b45309;
    font-size: 0.82rem;
    margin-top: 4px;
  }
  .rental-status {
    display: inline-block;
    margin-top: 4px;
    padding: 2px 8px;
    border-radius: 3px;
    font-size: 0.75rem;
    font-family: var(--font-display);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    background: rgba(154,161,173,0.15);
    color: var(--text-muted);
  }
  .status-approved      { background: rgba(63,191,111,0.15); color: #16a34a; }
  .status-active        { background: rgba(63,191,111,0.15); color: #16a34a; }
  .status-pending_review,
  .status-pending_payment { background: rgba(230,181,74,0.15); color: #b45309; }
  .status-rejected,
  .status-cancelled     { background: rgba(192,57,43,0.12); color: var(--red); }

  .rental-cta {
    color: var(--red);
    font-family: var(--font-display);
    font-weight: 600;
    font-size: 0.9rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    white-space: nowrap;
  }
</style>
