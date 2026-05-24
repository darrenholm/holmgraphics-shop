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
  // Default to the cheapest, shortest option so customers don't accidentally
  // book a longer window than intended. They can opt up to week or month.
  let durationUnit = 'day';
  let durationCount = 1;
  // Daily time window — defaults to all day so behavior matches the original
  // booking form. Quick-pick chips below offer common commute/lunch slots.
  let startTime = '00:00';
  let endTime   = '23:59';

  const DAYPART_PRESETS = [
    { label: 'All day',          start: '00:00', end: '23:59' },
    { label: 'Morning commute',  start: '07:00', end: '09:00' },
    { label: 'Lunch rush',       start: '11:00', end: '14:00' },
    { label: 'Evening commute',  start: '16:00', end: '18:00' },
    { label: 'Evening',          start: '18:00', end: '22:00' },
  ];
  function applyPreset(p) {
    startTime = p.start;
    endTime = p.end;
  }
  function fmt12(t) {
    if (!t) return '';
    const [hh, mm] = t.split(':').map(Number);
    const h12 = ((hh + 11) % 12) + 1;
    const ampm = hh >= 12 ? 'PM' : 'AM';
    return `${h12}:${String(mm).padStart(2, '0')} ${ampm}`;
  }

  let activePhoto = 0;

  $: id = $page.params.id;
  $: quote = display ? quoteCents(display, durationUnit, durationCount) : null;
  $: perUnitRate = display
    ? (durationUnit === 'day' ? display.daily_rate
      : durationUnit === 'week' ? display.weekly_rate
      : display.monthly_rate)
    : null;
  $: unitLabel = durationUnit === 'day' ? 'day' : durationUnit === 'week' ? 'week' : 'month';

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
        durationUnit,
        durationCount,
        startTime,
        endTime,
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

          <label>How long should the ad run?
            <div class="row tight">
              <input type="number" min="1" max="52" bind:value={durationCount} style="width:80px" />
              <select bind:value={durationUnit}>
                <option value="day">day(s)</option>
                <option value="week">week(s)</option>
                <option value="month">month(s)</option>
              </select>
            </div>
          </label>
          <div class="schedule-note">
            Your run window starts the day Holm Graphics approves your artwork — so the clock doesn't tick down while we're reviewing.
          </div>

          <fieldset class="daypart">
            <legend>When during the day should it play?</legend>
            <div class="presets">
              {#each DAYPART_PRESETS as p (p.label)}
                <button
                  type="button"
                  class="preset"
                  class:active={startTime === p.start && endTime === p.end}
                  on:click={() => applyPreset(p)}
                >
                  {p.label}
                </button>
              {/each}
            </div>
            <div class="row time-row">
              <label class="time-label">From
                <input type="time" bind:value={startTime} required />
              </label>
              <label class="time-label">To
                <input type="time" bind:value={endTime} required />
              </label>
            </div>
            <div class="daypart-summary">
              Ad plays daily from <strong>{fmt12(startTime)}</strong> to <strong>{fmt12(endTime)}</strong> for the run window.
            </div>
          </fieldset>

          <label>Notes (optional)
            <textarea rows="3" bind:value={advertiserNotes}></textarea>
          </label>

          {#if quote != null}
            <div class="quote-line">
              <div class="quote-breakdown">
                <span class="quote-formula">
                  {durationCount} {unitLabel}{durationCount === 1 ? '' : 's'}
                  {#if perUnitRate}
                    × {fmtMoney(parseFloat(perUnitRate) * 100, display.rental_currency)}/{unitLabel}
                  {/if}
                </span>
                <span class="quote-total-label">Total</span>
              </div>
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
  .quote-breakdown { display: flex; flex-direction: column; gap: 2px; }
  .quote-formula {
    font-family: var(--font-body);
    color: var(--text);
    text-transform: none;
    letter-spacing: 0;
    font-size: 0.92rem;
  }
  .quote-total-label { font-size: 0.78rem; }

  .schedule-note {
    background: rgba(192, 57, 43, 0.05);
    border-left: 3px solid var(--red);
    padding: 10px 12px;
    margin: 4px 0 12px;
    font-size: 0.88rem;
    color: var(--text-muted);
    border-radius: 0 4px 4px 0;
  }

  fieldset.daypart {
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 12px 14px 14px;
    margin: 0 0 16px;
  }
  fieldset.daypart legend {
    font-family: var(--font-display);
    font-weight: 600;
    font-size: 0.85rem;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    padding: 0 6px;
  }
  .presets {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-bottom: 12px;
  }
  .preset {
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 999px;
    padding: 6px 12px;
    font-family: var(--font-body);
    font-size: 0.85rem;
    color: var(--text);
    cursor: pointer;
    transition: background 0.1s, border-color 0.1s;
  }
  .preset:hover { background: var(--surface-3); }
  .preset.active {
    background: var(--red);
    border-color: var(--red);
    color: white;
  }
  .time-row { gap: 12px; }
  .time-label {
    flex: 1;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-size: 0.78rem;
  }
  .daypart-summary {
    margin-top: 10px;
    padding: 8px 10px;
    background: var(--surface-2);
    border-radius: 4px;
    font-size: 0.88rem;
    color: var(--text);
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
