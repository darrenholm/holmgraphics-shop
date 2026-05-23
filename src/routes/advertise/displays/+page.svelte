<script>
  import { onMount } from 'svelte';
  import { advertiseApi, formatRateSummary } from '$lib/advertise/api.js';

  let displays = null;
  let err = null;

  onMount(async () => {
    try {
      displays = await advertiseApi.listDisplays();
    } catch (e) {
      err = e.message;
    }
  });
</script>

<svelte:head>
  <title>Available displays — Advertise with Holm Graphics</title>
</svelte:head>

<div class="header">
  <div class="header-inner">
    <a href="/advertise/" class="back">← Back to overview</a>
    <h1>Available displays</h1>
  </div>
</div>

<div class="container">
  {#if err}
    <div class="error">{err}</div>
  {:else if !displays}
    <div class="muted">Loading displays…</div>
  {:else if displays.length === 0}
    <div class="card empty">
      <h2>No displays available right now</h2>
      <p class="muted">Check back soon, or <a href="mailto:darren@holmgraphics.ca">get in touch</a> directly.</p>
    </div>
  {:else}
    <div class="grid">
      {#each displays as d (d.id)}
        <a href={`/advertise/displays/${d.id}/`} class="display-card">
          <div class="photo">
            {#if d.photos?.[0]}
              <img src={d.photos[0]} alt={d.name} />
            {:else}
              <div class="photo-placeholder">No photo yet</div>
            {/if}
          </div>
          <div class="body">
            <h3>{d.name}</h3>
            {#if d.location}
              <div class="location">{d.location}</div>
            {/if}
            {#if d.width_px && d.height_px}
              <div class="specs">{d.width_px} × {d.height_px} px</div>
            {/if}
            {#if d.traffic_stat}
              <div class="traffic">{d.traffic_stat}</div>
            {/if}
            <div class="rate">{formatRateSummary(d)}</div>
          </div>
        </a>
      {/each}
    </div>
  {/if}
</div>

<style>
  .header {
    background: var(--surface-2);
    border-bottom: 1px solid var(--border);
    padding: 24px 20px;
  }
  .header-inner {
    max-width: 1024px;
    margin: 0 auto;
  }
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
  .container {
    max-width: 1024px;
    margin: 0 auto;
    padding: 32px 20px 80px;
  }
  .muted { color: var(--text-muted); }
  .error {
    background: rgba(192,57,43,0.1);
    border: 1px solid var(--red);
    color: var(--red);
    padding: 14px;
    border-radius: 6px;
  }
  .card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 24px;
  }
  .empty h2 {
    margin-top: 0;
    font-family: var(--font-display);
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 20px;
  }
  .display-card {
    display: block;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    overflow: hidden;
    text-decoration: none;
    color: inherit;
    transition: transform 0.1s, box-shadow 0.1s;
  }
  .display-card:hover {
    transform: translateY(-2px);
    box-shadow: 0 6px 20px rgba(0,0,0,0.08);
  }
  .photo {
    aspect-ratio: 4 / 3;
    background: var(--surface-2);
    overflow: hidden;
  }
  .photo img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .photo-placeholder {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-dim);
    font-family: var(--font-display);
    font-size: 0.9rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .body {
    padding: 16px 18px 18px;
  }
  h3 {
    margin: 0 0 4px;
    font-family: var(--font-display);
    font-size: 1.3rem;
    color: var(--text);
  }
  .location { color: var(--text-muted); font-size: 0.9rem; margin-bottom: 8px; }
  .specs { color: var(--text-dim); font-size: 0.85rem; }
  .traffic { color: var(--text); font-size: 0.9rem; margin-top: 6px; font-weight: 500; }
  .rate { color: var(--red); font-weight: 600; font-size: 1rem; margin-top: 12px; }
</style>
