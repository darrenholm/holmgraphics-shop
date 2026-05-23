<!--
  /advertise — public landing page for the LED ad-rental marketplace.
  Hero, value prop, Leaflet map of every rentable display, quote calculator.
  All data comes from led.holmgraphics.ca's /api/public/displays endpoint.
-->
<script>
  import { onMount, onDestroy } from 'svelte';
  import { advertiseApi, formatRateSummary, quoteCents, fmtMoney } from '$lib/advertise/api.js';

  let displays = null;
  let err = null;

  // Quote calculator state
  let calcDeviceId = '';
  let calcUnit = 'week';
  let calcCount = 1;

  let mapEl;
  let map;
  let mapModule;

  $: selected = displays?.find((d) => d.id === calcDeviceId) ?? null;
  $: quote = selected ? quoteCents(selected, calcUnit, calcCount) : null;

  onMount(async () => {
    try {
      displays = await advertiseApi.listDisplays();
    } catch (e) {
      err = e.message;
      return;
    }

    // Default the calculator to the first display.
    if (displays.length > 0) calcDeviceId = displays[0].id;

    // Lazy-load Leaflet on the client only.
    mapModule = await import('leaflet');
    await import('leaflet/dist/leaflet.css');
    initMap();
  });

  onDestroy(() => {
    if (map) {
      map.remove();
      map = null;
    }
  });

  function initMap() {
    if (!mapEl || !displays || displays.length === 0 || !mapModule) return;
    const withCoords = displays.filter(
      (d) => d.latitude != null && d.longitude != null,
    );
    if (withCoords.length === 0) {
      // Default to Walkerton if no displays have coords yet.
      map = mapModule.map(mapEl).setView([44.1252, -81.1500], 9);
    } else {
      const lats = withCoords.map((d) => parseFloat(d.latitude));
      const lngs = withCoords.map((d) => parseFloat(d.longitude));
      const bounds = [
        [Math.min(...lats), Math.min(...lngs)],
        [Math.max(...lats), Math.max(...lngs)],
      ];
      map = mapModule.map(mapEl).fitBounds(bounds, { padding: [40, 40], maxZoom: 12 });
    }
    mapModule
      .tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors',
        maxZoom: 19,
      })
      .addTo(map);

    for (const d of withCoords) {
      const lat = parseFloat(d.latitude);
      const lng = parseFloat(d.longitude);
      const marker = mapModule.marker([lat, lng]).addTo(map);
      const photo = d.photos?.[0]
        ? `<img src="${escapeHtml(d.photos[0])}" alt="" style="max-width:200px;border-radius:4px;display:block;margin-bottom:6px"/>`
        : '';
      marker.bindPopup(
        `<div style="min-width:200px">${photo}
          <div style="font-weight:600;font-family:'Barlow Condensed',sans-serif;font-size:1.1rem">${escapeHtml(d.name)}</div>
          ${d.location ? `<div style="color:#555;font-size:0.85rem">${escapeHtml(d.location)}</div>` : ''}
          <div style="margin-top:6px;font-size:0.85rem">${escapeHtml(formatRateSummary(d))}</div>
          <a href="/advertise/displays/${d.id}/" style="color:#c0392b;font-weight:600;font-size:0.9rem;display:inline-block;margin-top:6px">Book this display →</a>
         </div>`,
      );
    }
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
</script>

<svelte:head>
  <title>Advertise on our LED screens — Holm Graphics</title>
  <meta
    name="description"
    content="Rent ad space on Holm Graphics LED screens across southwestern Ontario. Daily, weekly, or monthly bookings. Upload your artwork online."
  />
</svelte:head>

<div class="hero">
  <div class="hero-inner">
    <h1>Put your message on our screens</h1>
    <p class="lede">
      Reach thousands of drivers and shoppers across southwestern Ontario.
      Book by the day, week, or month — pay online, upload your artwork,
      and we'll have your ad on screen within one business day.
    </p>
    <a href="/advertise/displays/" class="cta">Browse displays →</a>
  </div>
</div>

{#if err}
  <div class="container">
    <div class="error">{err}</div>
  </div>
{:else if !displays}
  <div class="container muted">Loading displays…</div>
{:else}
  <section class="container">
    <h2>Where our screens are</h2>
    <p class="muted">{displays.length} display{displays.length === 1 ? '' : 's'} currently available for advertising.</p>
    <div class="map" bind:this={mapEl}></div>
  </section>

  <section class="container">
    <h2>Get an instant quote</h2>
    <div class="calc card">
      <div class="row">
        <label>
          Display
          <select bind:value={calcDeviceId}>
            {#each displays as d}
              <option value={d.id}>{d.name}{d.location ? ` — ${d.location}` : ''}</option>
            {/each}
          </select>
        </label>
        <label>
          Duration
          <div class="row tight">
            <input
              type="number"
              min="1"
              max="52"
              bind:value={calcCount}
              style="width:80px"
            />
            <select bind:value={calcUnit}>
              <option value="day">day(s)</option>
              <option value="week">week(s)</option>
              <option value="month">month(s)</option>
            </select>
          </div>
        </label>
      </div>
      <div class="quote-result">
        {#if quote != null}
          <span class="quote-label">Total</span>
          <span class="quote-value">{fmtMoney(quote, selected.rental_currency)}</span>
          <a href={`/advertise/displays/${calcDeviceId}/`} class="cta small">Book this →</a>
        {:else if selected}
          <span class="muted">No rate set for the chosen duration — pick a different one.</span>
        {/if}
      </div>
    </div>
  </section>

  <section class="container">
    <h2>How it works</h2>
    <ol class="steps">
      <li><strong>Pick a display.</strong> Browse the map or list, see specs and reach.</li>
      <li><strong>Book a window.</strong> Days, weeks, or months — instant quote.</li>
      <li><strong>Upload your artwork.</strong> We check it fits the display correctly.</li>
      <li><strong>Pay online.</strong> Secure card payment.</li>
      <li><strong>Holm Graphics reviews & approves.</strong> On screen within one business day.</li>
    </ol>
  </section>
{/if}

<style>
  .hero {
    background: linear-gradient(135deg, var(--red) 0%, var(--red-dark) 100%);
    color: white;
    padding: 80px 20px 60px;
  }
  .hero-inner {
    max-width: 880px;
    margin: 0 auto;
  }
  .hero h1 {
    font-family: var(--font-display);
    font-size: clamp(2.2rem, 5vw, 3.6rem);
    font-weight: 800;
    margin: 0 0 16px;
    line-height: 1.05;
    letter-spacing: 0.01em;
  }
  .hero .lede {
    font-size: 1.15rem;
    max-width: 640px;
    line-height: 1.5;
    margin: 0 0 28px;
    opacity: 0.95;
  }
  .cta {
    display: inline-block;
    background: white;
    color: var(--red);
    padding: 14px 28px;
    border-radius: 6px;
    font-family: var(--font-display);
    font-weight: 700;
    text-decoration: none;
    font-size: 1.05rem;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    transition: transform 0.1s;
  }
  .cta:hover {
    transform: translateY(-1px);
  }
  .cta.small {
    padding: 8px 16px;
    font-size: 0.9rem;
  }

  .container {
    max-width: 1024px;
    margin: 0 auto;
    padding: 48px 20px;
  }
  .container h2 {
    font-family: var(--font-display);
    font-size: 1.8rem;
    margin: 0 0 12px;
    color: var(--text);
  }
  .muted {
    color: var(--text-muted);
  }
  .error {
    background: rgba(192, 57, 43, 0.1);
    border: 1px solid var(--red);
    color: var(--red);
    padding: 14px 16px;
    border-radius: 6px;
  }

  .map {
    width: 100%;
    height: 420px;
    border-radius: 8px;
    overflow: hidden;
    border: 1px solid var(--border);
    margin-top: 16px;
    background: var(--surface-2);
  }

  .card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 24px;
    margin-top: 12px;
  }
  .row {
    display: flex;
    gap: 16px;
    flex-wrap: wrap;
  }
  .row.tight {
    gap: 6px;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-family: var(--font-display);
    font-weight: 600;
    color: var(--text-muted);
    font-size: 0.85rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    flex: 1;
    min-width: 220px;
  }
  input, select {
    font-family: var(--font-body);
    background: var(--surface);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 10px 12px;
    font-size: 1rem;
    text-transform: none;
    letter-spacing: 0;
  }

  .quote-result {
    margin-top: 20px;
    padding-top: 20px;
    border-top: 1px solid var(--border);
    display: flex;
    align-items: center;
    gap: 16px;
    flex-wrap: wrap;
  }
  .quote-label {
    font-family: var(--font-display);
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-size: 0.9rem;
  }
  .quote-value {
    font-family: var(--font-display);
    font-weight: 700;
    font-size: 2rem;
    color: var(--text);
    flex: 1;
  }

  .steps {
    margin: 12px 0 0;
    padding-left: 20px;
    line-height: 1.8;
    font-size: 1.05rem;
    color: var(--text);
  }
  .steps li {
    margin-bottom: 4px;
  }
</style>
