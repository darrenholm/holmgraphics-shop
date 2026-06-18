<!--
  /fleet-docs/locations — driver/admin live-ish fleet locations.

  Lists trucks with Smartcar links and their last-known coordinates. Each
  row has an "Update now" button that calls the on-demand fetch (60 s
  per-vehicle cache on the API), plus an "Update all" button that fans out
  with bounded concurrency.

  Map uses Leaflet + OpenStreetMap (free, no API key). Leaflet is dynamically
  imported in onMount because it touches window/document — incompatible
  with SvelteKit's SSR / prerender pass.

  Trailers are deliberately excluded: no modem, no telematics. If the
  driver is pulling a trailer, the truck detail page (Phase 1) shows that
  coupling — not this map.
-->
<script>
  import { onMount, onDestroy } from 'svelte';
  import 'leaflet/dist/leaflet.css';
  import { fleetApi } from '$lib/api/fleet-client.js';

  let vehicles = [];                     // [{ vehicle_id, unit_number, source, lat, lon, odometer_km, fuel_pct, ignition, location_at }]
  let loading = true;
  let loadError = '';

  let mapEl;
  let map = null;
  let L = null;
  const markers = new Map();             // vehicle_id → L.Marker

  let busyAll = false;
  let toast = '';
  let toastTimer = null;

  onMount(async () => {
    L = (await import('leaflet')).default;
    await initData();
    initMap();
    placeMarkers();
  });

  onDestroy(() => {
    clearTimeout(toastTimer);
    map?.remove();
  });

  async function initData() {
    loading = true; loadError = '';
    try {
      // Provider-agnostic: returns every telematics-linked vehicle (Ford Pro
      // today) with its latest cached position/odometer/fuel + a `source`.
      const data = await fleetApi.telematicsLocations();
      vehicles = (data.vehicles || []).sort((a, b) =>
        String(a.unit_number || '').localeCompare(String(b.unit_number || '')));
    } catch (e) {
      loadError = e.message;
    } finally {
      loading = false;
    }
  }

  function initMap() {
    if (!L || !mapEl) return;
    // Centre on Walkerton (Holm Graphics HQ) until we have at least one point.
    map = L.map(mapEl, { zoomControl: true }).setView([44.124, -81.149], 10);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);
  }

  function placeMarkers() {
    if (!L || !map) return;
    const pts = [];
    for (const v of vehicles) {
      const lat = Number(v.lat), lng = Number(v.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      let m = markers.get(v.vehicle_id);
      if (m) m.setLatLng([lat, lng]);
      else { m = L.marker([lat, lng]).addTo(map); markers.set(v.vehicle_id, m); }
      m.bindTooltip(`<strong>${v.unit_number}</strong><br>${relativeTime(v.location_at)}`, { direction: 'top' });
      pts.push([lat, lng]);
    }
    if (pts.length === 1)      map.setView(pts[0], 13);
    else if (pts.length > 1)   map.fitBounds(pts, { padding: [40, 40] });
  }

  // Re-poll the provider(s) (Ford Pro today) and reload the snapshot.
  async function updateAll() {
    if (busyAll) return;
    busyAll = true;
    try {
      await fleetApi.fordproSync();
      await initData();
      placeMarkers();
      showToast('Fleet updated');
    } catch (e) {
      showToast(e.message || 'Update failed');
    } finally {
      busyAll = false;
    }
  }

  function showToast(msg) {
    toast = msg;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toast = ''), 1800);
  }

  function relativeTime(iso) {
    if (!iso) return 'no data';
    const sec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
    if (sec < 60)   return `${sec}s ago`;
    if (sec < 3600) return `${Math.floor(sec/60)}m ago`;
    if (sec < 86400) return `${Math.floor(sec/3600)}h ago`;
    return `${Math.floor(sec/86400)}d ago`;
  }
</script>

<svelte:head>
  <title>Fleet locations · Holm Graphics</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
</svelte:head>

<div class="page">
  <header class="page-head">
    <p class="back"><a href="/fleet-docs">← All vehicles</a></p>
    <div class="head-row">
      <h1>Fleet locations</h1>
      <button class="btn outline" on:click={updateAll} disabled={busyAll || vehicles.length === 0}>
        {busyAll ? 'Updating…' : 'Update all'}
      </button>
    </div>
    <p class="hint small">Trucks only — trailers have no modem. Positions auto-update every 30 min; tap "Update all" to pull now.</p>
  </header>

  {#if loadError}<p class="alert error">{loadError}</p>{/if}

  <div class="map-wrap"><div bind:this={mapEl} class="map"></div></div>

  {#if loading}
    <p class="hint">Loading…</p>
  {:else if vehicles.length === 0}
    <p class="hint empty">No vehicles reporting telematics yet. Trucks on Ford Pro auto-appear here once they report.</p>
  {:else}
    <ul class="list">
      {#each vehicles as v (v.vehicle_id)}
        <li>
          <div class="row">
            <div class="row-main">
              <span class="unit">{v.unit_number}</span>
              <span class="meta">
                {#if v.lat != null && v.lon != null}
                  <span>{relativeTime(v.location_at)}</span>
                {:else}
                  <span class="muted">parked — no live fix</span>
                {/if}
                {#if v.fuel_pct != null}<span>· {Math.round(Number(v.fuel_pct))}% fuel</span>{/if}
                {#if v.odometer_km != null}<span>· {Number(v.odometer_km).toLocaleString('en-CA')} km</span>{/if}
                {#if v.source}<span class="muted">· {v.source}</span>{/if}
              </span>
            </div>
            {#if v.lat != null && v.lon != null}
              <a class="btn primary small" href={`https://www.openstreetmap.org/?mlat=${v.lat}&mlon=${v.lon}#map=15/${v.lat}/${v.lon}`} target="_blank" rel="noopener">Map</a>
            {/if}
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</div>

{#if toast}<div class="toast">{toast}</div>{/if}

<style>
  :global(.leaflet-container) { font-family: inherit; }

  .page { max-width: 40rem; margin: 0 auto; padding: 0.5rem 0.85rem 4rem; }
  .back { margin: 0 0 0.4rem; font-size: 0.9rem; }
  .back a { color: #555; text-decoration: none; }

  .head-row { display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; }
  .head-row h1 { margin: 0; font-size: 1.4rem; }
  .hint { color: #666; font-size: 0.9rem; margin: 0.25rem 0 0; }
  .small { font-size: 0.85rem; }
  .empty { padding: 2rem 0; text-align: center; }
  .muted { color: #888; }

  .alert { padding: 0.6rem 0.85rem; border-radius: 0.4rem; margin: 0.5rem 0; font-size: 0.9rem; }
  .alert.error { background: #fee; color: #b00; }

  .map-wrap { margin: 0.85rem 0; border: 1px solid #e4e4e7; border-radius: 0.5rem; overflow: hidden; background: #eee; }
  .map { width: 100%; height: 50vh; min-height: 18rem; }

  .list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 0.45rem; }
  .row {
    display: flex; align-items: center; justify-content: space-between; gap: 0.75rem;
    padding: 0.65rem 0.85rem;
    background: white;
    border: 1px solid #e4e4e7;
    border-radius: 0.55rem;
    min-height: 60px;
  }
  .row-main { display: flex; flex-direction: column; gap: 0.15rem; min-width: 0; }
  .unit { font-size: 1.15rem; font-weight: 700; }
  .meta { color: #666; font-size: 0.85rem; display: flex; gap: 0.4rem; flex-wrap: wrap; }

  .btn { padding: 0.55rem 1rem; background: #c01818; color: white; border: none; border-radius: 0.4rem; font-weight: 600; cursor: pointer; font-size: 0.92rem; }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn.outline { background: transparent; color: #c01818; border: 1px solid #c01818; }
  .btn.primary.small { padding: 0.45rem 0.85rem; font-size: 0.88rem; }

  .toast {
    position: fixed; bottom: 1.5rem; left: 50%; transform: translateX(-50%);
    background: #1a1a1a; color: white;
    padding: 0.6rem 1.1rem; border-radius: 999px;
    font-size: 0.9rem; z-index: 2000;
    box-shadow: 0 4px 12px rgba(0,0,0,0.25);
  }
</style>
