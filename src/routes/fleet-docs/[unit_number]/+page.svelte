<!--
  /fleet-docs/[unit_number] — driver-facing vehicle page.

  Big touch-friendly cards for each document. Tapping a card opens a
  full-viewport viewer that uses native browser rendering (PDFs in
  <iframe>, images in <img> with native pinch-zoom). No PDF.js or other
  heavy library — modern mobile browsers handle inline PDFs fine when the
  Content-Disposition is `inline` (which our streaming endpoint sets).

  Truck pages include a "Pulling a trailer?" coupler. The last selection
  per (driver, truck) is remembered in localStorage so the next time the
  same combo is hooked, both vehicles' docs are one tap away again.
-->
<script>
  import { onMount, onDestroy } from 'svelte';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { fleetApi } from '$lib/api/fleet-client.js';
  import { auth } from '$lib/stores/auth.js';

  let unit = '';
  $: unit = $page.params.unit_number;

  let loading = true;
  let loadError = '';
  let vehicle = null;
  let documents = null;

  // Coupled trailer state
  let trailers = [];                          // list of active trailers for the picker
  let coupledUnit = '';                       // selected trailer's unit_number
  let coupledVehicle = null;                  // its details
  let coupledDocuments = null;
  let coupledLoading = false;

  // Viewer state
  let viewerDoc = null;                       // { id, file_mime, label }
  let viewerUrl = null;                       // blob: URL
  let viewerLoading = false;
  let viewerError = '';

  // Toast for tap-to-copy
  let toast = '';
  let toastTimer = null;

  // Track blob URLs for cleanup
  const blobUrls = new Set();

  onMount(load);
  $: if (unit) load();

  async function load() {
    loading = true; loadError = '';
    vehicle = null; documents = null;
    try {
      const data = await fleetApi.getVehicleByUnit(unit);
      vehicle = data.vehicle;
      documents = data.documents;
    } catch (e) {
      loadError = e.message;
      loading = false;
      return;
    }
    loading = false;

    // Background: load trailer roster for the coupler (trucks only)
    if (vehicle?.type === 'truck') {
      try {
        const list = await fleetApi.listVehicles();
        trailers = (list.vehicles || []).filter((v) => v.type === 'trailer' && v.active);
        const savedKey = coupledStorageKey();
        const saved = savedKey ? localStorage.getItem(savedKey) : null;
        if (saved && trailers.find((t) => t.unit_number === saved)) {
          coupledUnit = saved;
          await loadCoupled();
        }
      } catch (e) {
        console.warn('trailer roster failed', e.message);
      }
    }
  }

  function coupledStorageKey() {
    const uid = ($auth?.id) || 'anon';
    return vehicle ? `hg_fleet_coupled:${uid}:${vehicle.unit_number}` : null;
  }

  async function onCoupleChange() {
    const key = coupledStorageKey();
    if (!coupledUnit) {
      coupledVehicle = null; coupledDocuments = null;
      if (key) localStorage.removeItem(key);
      return;
    }
    if (key) localStorage.setItem(key, coupledUnit);
    await loadCoupled();
  }

  async function loadCoupled() {
    coupledLoading = true;
    try {
      const data = await fleetApi.getVehicleByUnit(coupledUnit);
      coupledVehicle = data.vehicle;
      coupledDocuments = data.documents;
    } catch (e) {
      console.warn('coupled load failed', e.message);
      coupledVehicle = null; coupledDocuments = null;
    } finally {
      coupledLoading = false;
    }
  }

  async function openViewer(doc, label) {
    if (!doc?.id) return;
    viewerDoc = { id: doc.id, file_mime: doc.file_mime, label };
    viewerUrl = null;
    viewerError = '';
    viewerLoading = true;
    try {
      const { url } = await fleetApi.fetchFileBlob(doc.id);
      blobUrls.add(url);
      viewerUrl = url;
    } catch (e) {
      viewerError = e.message;
    } finally {
      viewerLoading = false;
    }
  }

  function closeViewer() {
    viewerDoc = null;
    viewerUrl = null;
    viewerError = '';
  }

  function onViewerKey(e) {
    if (e.key === 'Escape') closeViewer();
  }

  async function copy(value, label) {
    try {
      await navigator.clipboard.writeText(value);
      showToast(`${label} copied`);
    } catch {
      showToast(`Couldn't copy ${label}`);
    }
  }
  function showToast(msg) {
    toast = msg;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toast = ''), 1500);
  }

  onDestroy(() => {
    clearTimeout(toastTimer);
    for (const u of blobUrls) URL.revokeObjectURL(u);
  });

  // ── Helpers ─────────────────────────────────────────────────────────────
  const STATUS_LABEL = { valid: 'Current', expiring_soon: 'Expires soon', expired: 'EXPIRED', missing: 'Not on file' };
  function formatDate(s) {
    return s ? new Date(s).toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric' }) : '';
  }
  function relTime(s) {
    if (!s) return '';
    const then = new Date(s);
    const days = Math.floor((Date.now() - then.getTime()) / 86400000);
    if (days <= 0) return 'today';
    if (days === 1) return 'yesterday';
    if (days < 7)   return `${days} days ago`;
    if (days < 30)  { const w = Math.floor(days / 7); return `${w} week${w === 1 ? '' : 's'} ago`; }
    if (days < 365) { const m = Math.floor(days / 30); return `${m} month${m === 1 ? '' : 's'} ago`; }
    const y = Math.floor(days / 365); return `${y} year${y === 1 ? '' : 's'} ago`;
  }
  function sectionsFor(v) {
    if (!v) return [];
    const base = ['ownership', 'insurance'];
    if (v.type !== 'trailer') base.push('cvor');
    return base;
  }
  function sectionLabel(t) {
    return { ownership: 'Ownership / Registration', insurance: 'Insurance', cvor: 'CVOR' }[t];
  }
  function isImage(mime) { return typeof mime === 'string' && mime.startsWith('image/'); }
  function isPdf(mime)   { return mime === 'application/pdf'; }
</script>

<svelte:head>
  <title>{vehicle?.unit_number || 'Vehicle'} — Fleet docs</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
</svelte:head>

<svelte:window on:keydown={onViewerKey} />

<div class="page" class:has-viewer={!!viewerDoc}>
  <header class="page-head">
    <a href="/fleet-docs" class="back">← All vehicles</a>
  </header>

  {#if loading}
    <p class="hint">Loading…</p>
  {:else if loadError}
    <p class="alert error">{loadError}</p>
  {:else if vehicle}
    <section class="vehicle-card">
      <h1 class="unit-big">{vehicle.unit_number}</h1>
      <p class="vehicle-sub">{[vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ') || vehicle.type}</p>

      <div class="copy-row">
        {#if vehicle.license_plate}
          <button class="copy" on:click={() => copy(vehicle.license_plate, 'Plate')}>
            <span class="copy-label">Plate</span>
            <span class="copy-val">{vehicle.license_plate}</span>
            <span class="copy-icon">⧉</span>
          </button>
        {/if}
        {#if vehicle.vin}
          <button class="copy" on:click={() => copy(vehicle.vin, 'VIN')}>
            <span class="copy-label">VIN</span>
            <span class="copy-val mono">{vehicle.vin}</span>
            <span class="copy-icon">⧉</span>
          </button>
        {/if}
      </div>
    </section>

    <section class="docs">
      {#each sectionsFor(vehicle) as t (t)}
        {@const cur = documents?.[t]?.current}
        {@const status = cur?.status || 'missing'}
        <button
          type="button"
          class="doc-card status-{status}"
          on:click={() => cur && openViewer(cur, `${vehicle.unit_number} · ${sectionLabel(t)}`)}
          disabled={!cur}>
          <span class="doc-stripe" aria-hidden="true"></span>
          <div class="doc-body">
            <span class="doc-type">{sectionLabel(t)}</span>
            <span class="doc-status">{STATUS_LABEL[status]}</span>
            {#if cur?.expiry_date}
              <span class="doc-expiry">Expires {formatDate(cur.expiry_date)}</span>
            {/if}
            {#if cur?.uploaded_at}
              <span class="doc-updated">Last updated {relTime(cur.uploaded_at)} · {formatDate(cur.uploaded_at)}</span>
            {/if}
          </div>
          {#if cur}
            <span class="doc-chev" aria-hidden="true">›</span>
          {/if}
        </button>
      {/each}
    </section>

    {#if vehicle.type === 'truck'}
      <section class="coupler">
        <h2>Pulling a trailer?</h2>
        <select bind:value={coupledUnit} on:change={onCoupleChange}>
          <option value="">— no trailer —</option>
          {#each trailers as t (t.id)}
            <option value={t.unit_number}>{t.unit_number}{t.make ? ' · ' + t.make : ''}{t.license_plate ? ' · ' + t.license_plate : ''}</option>
          {/each}
        </select>

        {#if coupledLoading}
          <p class="hint small">Loading trailer docs…</p>
        {:else if coupledVehicle}
          <p class="coupled-head">Trailer <strong>{coupledVehicle.unit_number}</strong> — {[coupledVehicle.year, coupledVehicle.make, coupledVehicle.model].filter(Boolean).join(' ') || 'trailer'}</p>
          <div class="docs">
            {#each sectionsFor(coupledVehicle) as t (t)}
              {@const cur = coupledDocuments?.[t]?.current}
              {@const status = cur?.status || 'missing'}
              <button
                type="button"
                class="doc-card status-{status}"
                on:click={() => cur && openViewer(cur, `${coupledVehicle.unit_number} · ${sectionLabel(t)}`)}
                disabled={!cur}>
                <span class="doc-stripe" aria-hidden="true"></span>
                <div class="doc-body">
                  <span class="doc-type">{sectionLabel(t)}</span>
                  <span class="doc-status">{STATUS_LABEL[status]}</span>
                  {#if cur?.expiry_date}
                    <span class="doc-expiry">Expires {formatDate(cur.expiry_date)}</span>
                  {/if}
                </div>
                {#if cur}<span class="doc-chev" aria-hidden="true">›</span>{/if}
              </button>
            {/each}
          </div>
        {/if}
      </section>
    {/if}
  {/if}
</div>

{#if viewerDoc}
  <div class="viewer" role="dialog" aria-modal="true" aria-label={viewerDoc.label}>
    <header class="viewer-bar">
      <span class="viewer-title">{viewerDoc.label}</span>
      <button class="viewer-close" on:click={closeViewer} aria-label="Close">✕</button>
    </header>
    <div class="viewer-body">
      {#if viewerLoading}
        <p class="hint">Loading document…</p>
      {:else if viewerError}
        <p class="alert error">Couldn't load: {viewerError}</p>
      {:else if viewerUrl && isPdf(viewerDoc.file_mime)}
        <iframe src={viewerUrl} title={viewerDoc.label} class="viewer-pdf"></iframe>
      {:else if viewerUrl && isImage(viewerDoc.file_mime)}
        <img src={viewerUrl} alt={viewerDoc.label} class="viewer-img" />
      {:else if viewerUrl}
        <a href={viewerUrl} target="_blank" rel="noopener" class="link-btn">Open document</a>
      {/if}
    </div>
  </div>
{/if}

{#if toast}
  <div class="toast" role="status">{toast}</div>
{/if}

<style>
  :global(html, body) { background: #fafafa; }
  .page { max-width: 36rem; margin: 0 auto; padding: 0.5rem 0.85rem 4rem; }
  .page.has-viewer { overflow: hidden; max-height: 100vh; }

  .page-head { padding: 0.4rem 0 0.8rem; }
  .back { color: #555; text-decoration: none; font-size: 0.95rem; }
  .back:active { color: #c01818; }

  .hint { color: #666; padding: 1rem 0; text-align: center; }
  .small { font-size: 0.85rem; }

  .alert { padding: 0.85rem 1rem; border-radius: 0.4rem; margin: 0.5rem 0; }
  .alert.error { background: #fee; color: #b00; }

  .vehicle-card { padding: 0.85rem 0.25rem 0.5rem; }
  .unit-big { margin: 0 0 0.15rem; font-size: 2.4rem; font-weight: 800; line-height: 1; letter-spacing: -0.01em; }
  .vehicle-sub { margin: 0 0 1rem; color: #666; font-size: 1rem; }

  .copy-row { display: flex; flex-direction: column; gap: 0.4rem; margin-bottom: 1.25rem; }
  .copy {
    display: grid; grid-template-columns: 4.5rem 1fr auto; gap: 0.6rem; align-items: center;
    padding: 0.65rem 0.85rem;
    min-height: 56px;
    background: white;
    border: 1px solid #e4e4e7; border-radius: 0.55rem;
    font: inherit; color: inherit; text-align: left; cursor: pointer;
  }
  .copy:active { background: #f5f5f5; }
  .copy-label { color: #888; font-size: 0.8rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; }
  .copy-val { font-size: 1.05rem; font-weight: 600; min-width: 0; overflow-wrap: anywhere; }
  .copy-val.mono { font-family: ui-monospace, monospace; font-size: 0.95rem; }
  .copy-icon { color: #888; font-size: 1.1rem; }

  .docs { display: flex; flex-direction: column; gap: 0.6rem; }
  .doc-card {
    display: grid; grid-template-columns: 0.45rem 1fr 1.5rem; gap: 0.85rem; align-items: center;
    padding: 0;
    min-height: 84px;
    background: white;
    border: 1px solid #e4e4e7; border-radius: 0.65rem;
    cursor: pointer;
    color: inherit;
    overflow: hidden;
    text-align: left;
    font: inherit;
  }
  .doc-card:disabled { cursor: not-allowed; opacity: 0.8; }
  .doc-card:not(:disabled):active { background: #f5f5f5; }
  .doc-stripe { width: 0.45rem; height: 100%; background: #ccc; align-self: stretch; }
  .doc-card.status-valid         .doc-stripe { background: #1f6b34; }
  .doc-card.status-expiring_soon .doc-stripe { background: #d9a401; }
  .doc-card.status-expired       .doc-stripe { background: #b91c1c; }
  .doc-card.status-missing       .doc-stripe { background: #c4c4c8; }

  .doc-body { display: flex; flex-direction: column; gap: 0.25rem; padding: 0.85rem 0; }
  .doc-type { font-size: 0.85rem; color: #666; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; }
  .doc-status { font-size: 1.4rem; font-weight: 700; line-height: 1.1; }
  .doc-card.status-expired .doc-status { color: #b91c1c; }
  .doc-card.status-valid   .doc-status { color: #1f6b34; }
  .doc-card.status-expiring_soon .doc-status { color: #6c5300; }
  .doc-expiry { font-size: 0.95rem; color: #555; }
  .doc-updated { font-size: 0.78rem; color: #888; margin-top: 0.1rem; }
  .doc-chev { padding-right: 0.85rem; font-size: 1.5rem; color: #c0c0c4; }

  .coupler { margin-top: 1.6rem; padding-top: 1rem; border-top: 1px dashed #d4d4d8; }
  .coupler h2 { font-size: 0.92rem; margin: 0 0 0.5rem; color: #444; }
  .coupler select { width: 100%; padding: 0.85rem 0.9rem; font-size: 1rem; border: 1px solid #c4c4c8; border-radius: 0.5rem; background: white; box-sizing: border-box; }
  .coupled-head { margin: 0.9rem 0 0.6rem; color: #444; font-size: 0.95rem; }

  /* ── Fullscreen viewer ────────────────────────────────────────────────── */
  .viewer {
    position: fixed; inset: 0;
    background: #000;
    z-index: 1000;
    display: flex; flex-direction: column;
  }
  .viewer-bar {
    display: flex; align-items: center; justify-content: space-between; gap: 0.5rem;
    padding: 0.6rem 0.85rem;
    background: #1a1a1a; color: white;
    flex: 0 0 auto;
  }
  .viewer-title { font-size: 0.95rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .viewer-close {
    background: transparent; color: white; border: 1px solid #444;
    width: 2.5rem; height: 2.5rem;
    border-radius: 50%; font-size: 1.15rem; cursor: pointer; line-height: 1;
    flex: 0 0 auto;
  }
  .viewer-close:active { background: #333; }
  .viewer-body { flex: 1 1 auto; display: flex; align-items: center; justify-content: center; overflow: auto; }
  .viewer-pdf { width: 100%; height: 100%; border: 0; background: white; }
  .viewer-img { max-width: 100%; max-height: 100%; object-fit: contain; }

  .toast {
    position: fixed; bottom: 1.5rem; left: 50%; transform: translateX(-50%);
    background: #1a1a1a; color: white;
    padding: 0.65rem 1.25rem; border-radius: 999px;
    font-size: 0.9rem; z-index: 2000;
    box-shadow: 0 4px 12px rgba(0,0,0,0.25);
  }
</style>
