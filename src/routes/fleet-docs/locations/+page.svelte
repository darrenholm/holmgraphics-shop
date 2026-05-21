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

  let vehicles = [];                     // trucks with smartcar link
  let lastKnown = new Map();             // vehicle_id → last location
  let loading = true;
  let loadError = '';

  let mapEl;
  let map = null;
  let L = null;
  const markers = new Map();             // vehicle_id → L.Marker

  let busyId = null;
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
      const data = await fleetApi.listVehicles();
      const trucks = (data.vehicles || []).filter((v) => v.type === 'truck' && v.active);
      // Resolve smartcar link status for each truck in parallel; only show linked ones.
      const linked = [];
      await Promise.all(trucks.map(async (t) => {
        try {
          const sc = await fleetApi.getVehicleSmartcar(t.id);
          if (sc.linked && sc.link?.status !== 'revoked') linked.push({ ...t, smartcar: sc.link });
        } catch {}
      }));
      vehicles = linked.sort((a, b) => a.unit_number.localeCompare(b.unit_number));
      // Try to pull the most recent snapshot for each (no fresh fetch).
      await Promise.all(vehicles.map(async (v) => {
        try {
          const r = await fleetApi.getVehicleLocations(v.id, { limit: 1 });
          if (r.snapshots?.[0]) lastKnown.set(v.id, r.snapshots[0]);
        } catch {}
      }));
      lastKnown = lastKnown;            // trigger reactivity
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
      const s = lastKnown.get(v.id);
      if (!s) continue;
      const lat = Number(s.latitude), lng = Number(s.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      let m = markers.get(v.id);
      if (m) {
        m.setLatLng([lat, lng]);
      } else {
        m = L.marker([lat, lng]).addTo(map);
        markers.set(v.id, m);
      }
      m.bindTooltip(`<strong>${v.unit_number}</strong><br>${relativeTime(s.fetched_at)}`, { direction: 'top' });
      pts.push([lat, lng]);
    }
    if (pts.length === 1)      map.setView(pts[0], 13);
    else if (pts.length > 1)   map.fitBounds(pts, { padding: [40, 40] });
  }

  async function updateOne(v) {
    if (busyId) return;
    busyId = v.id;
    try {
      const r = await fleetApi.getVehicleLocation(v.id, { refresh: true });
      lastKnown.set(v.id, {
        latitude: r.latitude, longitude: r.longitude,
        odometer_km: r.odometer_km, fuel_percent_remaining: r.fuel_percent,
        smartcar_timestamp: r.smartcar_timestamp, fetched_at: r.fetched_at,
        id: r.snapshot_id
      });
      lastKnown = lastKnown;
      placeMarkers();
      showToast(`${v.unit_number} updated`);
    } catch (e) {
      showToast(`${v.unit_number}: ${e.message}`);
    } finally {
      busyId = null;
    }
  }

  async function updateAll() {
    if (busyAll) return;
    busyAll = true;
    const queue = [...vehicles];
    const concurrency = 5;
    const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
      while (queue.length) {
        const v = queue.shift();
        try {
          const r = await fleetApi.getVehicleLocation(v.id, { refresh: true });
          lastKnown.set(v.id, {
            latitude: r.latitude, longitude: r.longitude,
            odometer_km: r.odometer_km, fuel_percent_remaining: r.fuel_percent,
            smartcar_timestamp: r.smartcar_timestamp, fetched_at: r.fetched_at,
            id: r.snapshot_id
          });
        } catch {}
      }
    });
    await Promise.all(workers);
    lastKnown = lastKnown;
    placeMarkers();
    busyAll = false;
    showToast('Fleet updated');
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
    <p class="hint small">Trucks only. Trailers don't have telematics. Each fetch is logged.</p>
  </header>

  {#if loadError}<p class="alert error">{loadError}</p>{/if}

  <div class="map-wrap"><div bind:this={mapEl} class="map"></div></div>

  {#if loading}
    <p class="hint">Loading…</p>
  {:else if vehicles.length === 0}
    <p class="hint empty">No trucks connected to Smartcar yet. Connect from <a href="/fleet-admin/vehicles">the admin page</a>.</p>
  {:else}
    <ul class="list">
      {#each vehicles as v (v.id)}
        {@const s = lastKnown.get(v.id)}
        <li>
          <div class="row">
            <div class="row-main">
              <span class="unit">{v.unit_number}</span>
              <span class="meta">
                {#if s}
                  <span>{relativeTime(s.fetched_at)}</span>
                  {#if s.fuel_percent_remaining != null}<span>· {Number(s.fuel_percent_remaining).toFixed(0)}% fuel</span>{/if}
                  {#if s.odometer_km != null}<span>· {Number(s.odometer_km).toFixed(0)} km</span>{/if}
                {:else}
                  <span class="muted">no data — tap update</span>
                {/if}
              </span>
            </div>
            <button class="btn primary small" on:click={() => updateOne(v)} disabled={busyId === v.id || busyAll}>
              {busyId === v.id ? '…' : 'Update'}
            </button>
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
