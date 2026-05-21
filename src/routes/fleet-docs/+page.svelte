<!--
  /fleet-docs — driver-facing vehicle search.

  Optimized for one-handed, in-the-dark, cop-waiting use:
  - Search bar pinned at the top, autofocus on load, matches unit / plate / VIN
  - Big tap-target rows (≥ 56px), sorted by unit_number
  - Three status pills per row (CVOR hidden for trailers)
  - No chrome — the staff sidebar from the global layout collapses on mobile
-->
<script>
  import { onMount } from 'svelte';
  import { fleetApi } from '$lib/api/fleet-client.js';

  let vehicles = [];
  let loading = true;
  let loadError = '';

  let q = '';
  let searchInput;

  onMount(async () => {
    try {
      const data = await fleetApi.listVehicles();
      vehicles = (data.vehicles || []).filter((v) => v.active);
    } catch (e) {
      loadError = e.message;
    } finally {
      loading = false;
    }
    // Autofocus the search box once we have something to search.
    requestAnimationFrame(() => searchInput?.focus());
  });

  $: filtered = (() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return vehicles;
    return vehicles.filter((v) => {
      const hay = `${v.unit_number} ${v.license_plate || ''} ${v.vin || ''} ${v.make || ''} ${v.model || ''}`.toLowerCase();
      return hay.includes(needle);
    });
  })();

  const STATUS_LABEL = {
    valid: 'OK', expiring_soon: 'Soon', expired: 'Exp', missing: '—'
  };
  function statusOf(doc) { return doc?.status || 'missing'; }
</script>

<svelte:head><title>Fleet docs · Holm Graphics</title></svelte:head>

<div class="page">
  <header class="page-head">
    <h1>Fleet documents</h1>
    <input
      type="search"
      placeholder="Search unit, plate, or VIN…"
      bind:value={q}
      bind:this={searchInput}
      class="search"
      autocomplete="off"
      enterkeyhint="search" />
  </header>

  {#if loading}
    <p class="hint">Loading…</p>
  {:else if loadError}
    <p class="alert error">{loadError}</p>
  {:else if filtered.length === 0}
    <p class="hint">{q ? `No matches for "${q}".` : 'No vehicles on file.'}</p>
  {:else}
    <ul class="vehicle-list">
      {#each filtered as v (v.id)}
        <li>
          <a class="row" href={`/fleet-docs/${encodeURIComponent(v.unit_number)}`}>
            <div class="row-main">
              <span class="unit">{v.unit_number}</span>
              <span class="meta">
                <span class="type">{v.type === 'truck' ? '🚚' : '🚛'} {v.type}</span>
                {#if v.license_plate}<span class="plate">{v.license_plate}</span>{/if}
              </span>
            </div>
            <div class="pills">
              <span class="pill pill-{statusOf(v.documents.ownership)}" title="Ownership">O · {STATUS_LABEL[statusOf(v.documents.ownership)]}</span>
              <span class="pill pill-{statusOf(v.documents.insurance)}" title="Insurance">I · {STATUS_LABEL[statusOf(v.documents.insurance)]}</span>
              {#if v.documents.cvor}
                <span class="pill pill-{statusOf(v.documents.cvor)}" title="CVOR">C · {STATUS_LABEL[statusOf(v.documents.cvor)]}</span>
              {/if}
            </div>
          </a>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .page { max-width: 36rem; margin: 0 auto; padding: 0.85rem 0.85rem 4rem; }
  .page-head { position: sticky; top: 0; background: #fafafa; padding: 0.5rem 0 0.85rem; z-index: 5; }
  .page-head h1 { margin: 0 0 0.6rem; font-size: 1.1rem; color: #444; font-weight: 600; }

  .search {
    width: 100%;
    padding: 0.95rem 1rem;
    font-size: 1.1rem;
    border: 1px solid #c4c4c8;
    border-radius: 0.5rem;
    box-sizing: border-box;
    background: white;
  }
  .search:focus { outline: 2px solid #c01818; outline-offset: 1px; border-color: transparent; }

  .hint { color: #666; text-align: center; padding: 2rem 1rem; }
  .alert { padding: 0.85rem 1rem; border-radius: 0.4rem; }
  .alert.error { background: #fee; color: #b00; }

  .vehicle-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 0.5rem; }
  .row {
    display: flex; align-items: center; justify-content: space-between;
    gap: 0.75rem;
    min-height: 64px;
    padding: 0.65rem 0.85rem;
    background: white;
    border: 1px solid #e4e4e7;
    border-radius: 0.55rem;
    text-decoration: none;
    color: inherit;
  }
  .row:active { background: #f5f5f5; }

  .row-main { display: flex; flex-direction: column; gap: 0.2rem; min-width: 0; flex-grow: 1; }
  .unit { font-size: 1.25rem; font-weight: 700; line-height: 1.1; }
  .meta { display: flex; gap: 0.6rem; color: #666; font-size: 0.85rem; flex-wrap: wrap; }
  .plate { font-family: ui-monospace, monospace; }

  .pills { display: flex; flex-direction: column; gap: 0.25rem; align-items: flex-end; }
  .pill {
    font-size: 0.78rem; font-weight: 600;
    padding: 0.18rem 0.55rem;
    border-radius: 999px;
    background: #eee; color: #555;
    min-width: 4rem; text-align: center;
    font-variant-numeric: tabular-nums;
  }
  .pill-valid         { background: #e8f6ec; color: #1f6b34; }
  .pill-expiring_soon { background: #fdf5d3; color: #6c5300; }
  .pill-expired       { background: #fee; color: #b91c1c; }
  .pill-missing       { background: #f0f0f0; color: #888; }
</style>
