<script>
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { advertiseApi, fmtMoney, quoteCents } from '$lib/advertise/api.js';

  let display = null;
  let err = null;
  let busy = false;

  // Form state
  let advertiserName = '';
  let advertiserEmail = '';
  let advertiserPhone = '';
  let advertiserBusiness = '';
  let advertiserNotes = '';
  let startDate = new Date().toISOString().slice(0, 10);
  let durationUnit = 'week';
  let durationCount = 1;

  let activePhoto = 0;

  $: id = $page.params.id;
  $: quote = display ? quoteCents(display, durationUnit, durationCount) : null;

  onMount(async () => {
    try {
      display = await advertiseApi.getDisplay(id);
    } catch (e) {
      err = e.message;
    }
  });

  async function onSubmit() {
    busy = true;
    err = null;
    try {
      const res = await advertiseApi.createRental({
        deviceId: display.id,
        advertiserName,
        advertiserEmail,
        advertiserPhone: advertiserPhone || undefined,
        advertiserBusiness: advertiserBusiness || undefined,
        advertiserNotes: advertiserNotes || undefined,
        startDate,
        durationUnit,
        durationCount,
      });
      goto(`/advertise/orders/${res.id}/`);
    } catch (e) {
      err = e.message;
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head>
  <title>{display?.name ?? 'Display'} — Advertise with Holm Graphics</title>
</svelte:head>

<div class="header">
  <div class="header-inner">
    <a href="/advertise/displays/" class="back">← All displays</a>
    {#if display}
      <h1>{display.name}</h1>
      {#if display.location}
        <div class="loc">{display.location}</div>
      {/if}
    {/if}
  </div>
</div>

<div class="container">
  {#if err && !display}
    <div class="error">{err}</div>
  {:else if !display}
    <div class="muted">Loading…</div>
  {:else}
    <div class="layout">
      <div class="left">
        {#if display.photos?.length > 0}
          <div class="hero-photo">
            <img src={display.photos[activePhoto]} alt={display.name} />
          </div>
          {#if display.photos.length > 1}
            <div class="thumbs">
              {#each display.photos as p, i (p)}
                <button
                  type="button"
                  class="thumb"
                  class:active={i === activePhoto}
                  on:click={() => (activePhoto = i)}
                >
                  <img src={p} alt="" />
                </button>
              {/each}
            </div>
          {/if}
        {/if}

        {#if display.description}
          <div class="card">
            <h3>About this location</h3>
            <p>{display.description}</p>
          </div>
        {/if}

        <div class="card">
          <h3>Specs</h3>
          <dl>
            {#if display.width_px && display.height_px}
              <dt>Resolution</dt>
              <dd>{display.width_px} × {display.height_px} px</dd>
            {/if}
            {#if display.traffic_stat}
              <dt>Reach</dt>
              <dd>{display.traffic_stat}</dd>
            {/if}
            {#if display.location}
              <dt>Location</dt>
              <dd>{display.location}</dd>
            {/if}
          </dl>
        </div>

        {#if display.bookedWindows?.length > 0}
          <div class="card">
            <h3>Already booked</h3>
            <ul class="booked">
              {#each display.bookedWindows as b, i (i)}
                <li>{b.start_date} → {b.end_date}</li>
              {/each}
            </ul>
            <div class="muted small">Pick a different window if yours overlaps any of these.</div>
          </div>
        {/if}
      </div>

      <div class="right">
        <form on:submit|preventDefault={onSubmit} class="card book">
          <h3>Book this display</h3>

          <label>Your name
            <input bind:value={advertiserName} required />
          </label>
          <label>Business
            <input bind:value={advertiserBusiness} />
          </label>
          <label>Email
            <input type="email" bind:value={advertiserEmail} required />
          </label>
          <label>Phone
            <input bind:value={advertiserPhone} />
          </label>

          <label>Start date
            <input type="date" min={new Date().toISOString().slice(0, 10)} bind:value={startDate} required />
          </label>
          <label>Duration
            <div class="row tight">
              <input type="number" min="1" max="52" bind:value={durationCount} style="width:80px" />
              <select bind:value={durationUnit}>
                <option value="day">day(s)</option>
                <option value="week">week(s)</option>
                <option value="month">month(s)</option>
              </select>
            </div>
          </label>

          <label>Notes (optional)
            <textarea rows="3" bind:value={advertiserNotes}></textarea>
          </label>

          {#if quote != null}
            <div class="quote-line">
              <span>Estimated total</span>
              <strong>{fmtMoney(quote, display.rental_currency)}</strong>
            </div>
          {/if}

          {#if err}
            <div class="error">{err}</div>
          {/if}

          <button type="submit" class="cta" disabled={busy}>
            {busy ? 'Submitting…' : 'Continue → upload artwork'}
          </button>
        </form>
      </div>
    </div>
  {/if}
</div>

<style>
  .header {
    background: var(--surface-2);
    border-bottom: 1px solid var(--border);
    padding: 24px 20px;
  }
  .header-inner { max-width: 1024px; margin: 0 auto; }
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
    font-size: 2rem;
    color: var(--text);
  }
  .loc { color: var(--text-muted); margin-top: 4px; }

  .container { max-width: 1024px; margin: 0 auto; padding: 32px 20px 80px; }
  .muted { color: var(--text-muted); }
  .small { font-size: 0.85rem; }
  .error {
    background: rgba(192,57,43,0.1);
    border: 1px solid var(--red);
    color: var(--red);
    padding: 12px;
    border-radius: 6px;
    margin: 12px 0;
  }

  .layout {
    display: grid;
    grid-template-columns: 1fr 380px;
    gap: 32px;
    align-items: start;
  }
  @media (max-width: 880px) {
    .layout { grid-template-columns: 1fr; }
  }

  .card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 20px;
    margin-bottom: 20px;
  }
  .card h3 {
    margin: 0 0 12px;
    font-family: var(--font-display);
    font-size: 1.2rem;
    color: var(--text);
  }

  .hero-photo {
    aspect-ratio: 4 / 3;
    background: var(--surface-2);
    border-radius: 8px;
    overflow: hidden;
    margin-bottom: 12px;
    border: 1px solid var(--border);
  }
  .hero-photo img { width: 100%; height: 100%; object-fit: cover; display: block; }

  .thumbs { display: flex; gap: 8px; margin-bottom: 20px; }
  .thumb {
    width: 80px;
    height: 60px;
    padding: 0;
    border: 2px solid transparent;
    border-radius: 4px;
    overflow: hidden;
    background: var(--surface-2);
    cursor: pointer;
  }
  .thumb.active { border-color: var(--red); }
  .thumb img { width: 100%; height: 100%; object-fit: cover; }

  dl { margin: 0; }
  dt {
    font-family: var(--font-display);
    color: var(--text-muted);
    font-size: 0.8rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    margin-top: 8px;
  }
  dt:first-child { margin-top: 0; }
  dd { margin: 4px 0 0; color: var(--text); }

  .booked { margin: 0; padding-left: 18px; font-size: 0.95rem; }
  .booked li { margin-bottom: 4px; }

  .book label {
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
  input, select, textarea {
    font-family: var(--font-body);
    background: var(--surface);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 9px 11px;
    font-size: 0.95rem;
    text-transform: none;
    letter-spacing: 0;
  }
  textarea { resize: vertical; }
  .row { display: flex; gap: 16px; }
  .row.tight { gap: 6px; }

  .quote-line {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin: 12px 0;
    padding: 12px;
    background: var(--surface-2);
    border-radius: 6px;
  }
  .quote-line strong {
    font-family: var(--font-display);
    font-size: 1.4rem;
    color: var(--text);
  }
  .quote-line span {
    font-family: var(--font-display);
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-size: 0.85rem;
  }

  .cta {
    background: var(--red);
    color: white;
    border: 0;
    border-radius: 6px;
    padding: 14px 20px;
    font-family: var(--font-display);
    font-weight: 700;
    font-size: 1rem;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    cursor: pointer;
    width: 100%;
    margin-top: 8px;
  }
  .cta:hover:not(:disabled) { background: var(--red-dark); }
  .cta:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
