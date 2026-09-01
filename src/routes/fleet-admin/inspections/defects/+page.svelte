<!--
  /fleet-admin/inspections/defects — the open defect queue.

  This page is the only way a unit comes back into service. A driver cannot
  clear a defect, and running a fresh check on the truck does not clear one
  either — the API keeps returning out_of_service while any major defect is
  open, no matter how many clean inspections are recorded after it.

  So the repair note is mandatory, and it is worth writing properly: a defect
  with a repair attached turns the inspection into a maintenance record, and
  maintenance records are kept two years rather than six months.
-->
<script>
  import { onMount } from 'svelte';
  import { fleetApi } from '$lib/api/fleet-client.js';
  import { isAdmin } from '$lib/stores/auth.js';

  let loading = true;
  let error = '';
  let defects = [];
  let notes = {};        // defect id → repair note being typed
  let busyId = null;
  let photoUrls = {};
  let message = '';

  onMount(load);

  async function load() {
    loading = true; error = '';
    try {
      const data = await fleetApi.openDefects();
      defects = data.defects || [];
      for (const d of defects) {
        if (!d.has_photo || photoUrls[d.id]) continue;
        fleetApi.fetchDefectPhotoBlob(d.id)
          .then((r) => { photoUrls = { ...photoUrls, [d.id]: r.url }; })
          .catch(() => {});
      }
    } catch (e) {
      error = e.message;
    } finally {
      loading = false;
    }
  }

  async function resolve(d) {
    const note = (notes[d.id] || '').trim();
    if (!note) { error = 'A repair note is required to close a defect.'; return; }
    busyId = d.id; error = '';
    try {
      const r = await fleetApi.resolveDefect(d.id, note);
      notes = { ...notes, [d.id]: '' };
      await load();
      if (r.vehicle_back_in_service) {
        message = `${d.unit_number} is back in service.`;
        setTimeout(() => (message = ''), 6000);
      }
    } catch (e) {
      error = e.message;
    } finally {
      busyId = null;
    }
  }

  function fmt(ts) {
    return ts ? new Date(ts).toLocaleString('en-CA', { dateStyle: 'short', timeStyle: 'short' }) : '—';
  }

  $: majors = defects.filter((d) => d.severity === 'major');
  $: minors = defects.filter((d) => d.severity === 'minor');
</script>

<svelte:head><title>Open defects · Fleet admin</title></svelte:head>

<div class="page">
  <header class="head">
    <h1>Open defects</h1>
    <nav>
      <a href="/fleet-admin/inspections">Inspections</a>
      <a href="/fleet-admin">Fleet</a>
    </nav>
  </header>

  {#if message}<p class="alert ok">{message}</p>{/if}
  {#if error}<p class="alert error">{error}</p>{/if}

  {#if !$isAdmin}
    <p class="alert warn">
      You can see the queue, but closing a defect is admin-only — a repair record is what
      returns a unit to service.
    </p>
  {/if}

  {#if loading}
    <p class="hint">Loading…</p>
  {:else if defects.length === 0}
    <p class="empty">Nothing open. Every recorded defect has a repair against it.</p>
  {:else}
    {#each [{ label: 'Major — units are out of service', list: majors, kind: 'major' }, { label: 'Minor', list: minors, kind: 'minor' }] as section}
      {#if section.list.length}
        <h2 class="sec sec-{section.kind}">{section.label}</h2>
        <ul class="defect-list">
          {#each section.list as d (d.id)}
            <li class="defect defect-{d.severity}">
              <div class="d-head">
                <div>
                  <span class="unit">{d.unit_number}</span>
                  <span class="mono">{d.plate}</span>
                </div>
                <span class="sev sev-{d.severity}">{d.severity}</span>
              </div>

              <p class="item"><strong>{d.part_number ? `Part ${d.part_number}. ` : ''}{d.group_name}</strong></p>
              <p class="reg-text">
                {#if d.condition_note}<em>{d.condition_note}:</em> {/if}
                {#if d.item_label}{d.item_label}{:else}{d.severity === 'major' ? d.major_defect_text : d.minor_defect_text}{/if}
              </p>
              {#if d.note}<p class="note">Driver note: {d.note}</p>{/if}
              {#if d.carried_from_id}
                <p class="carried">Carried forward — this has now appeared on more than one report.</p>
              {/if}

              <p class="prov">
                Reported {fmt(d.completed_at)} by {d.inspector_name} ·
                <a href={`/fleet/check/${d.inspection_id}`}>report {d.inspection_id}</a>
              </p>

              {#if photoUrls[d.id]}
                <img class="photo" src={photoUrls[d.id]} alt={`Defect: ${d.item_label}`} />
              {/if}

              <div class="resolve">
                <input type="text" placeholder="What was repaired, by whom, and when"
                       bind:value={notes[d.id]} disabled={!$isAdmin || busyId === d.id} />
                <button on:click={() => resolve(d)}
                        disabled={!$isAdmin || busyId === d.id || !(notes[d.id] || '').trim()}>
                  {busyId === d.id ? 'Saving…' : 'Record repair'}
                </button>
              </div>
            </li>
          {/each}
        </ul>
      {/if}
    {/each}
  {/if}
</div>

<style>
  .page { max-width: 48rem; margin: 0 auto; padding: 1rem 1rem 4rem; }
  .head { display: flex; justify-content: space-between; align-items: baseline; gap: 1rem; flex-wrap: wrap; }
  h1 { margin: 0; font-size: 1.3rem; }
  .head nav { display: flex; gap: 1rem; }
  .head nav a { color: #c01818; text-decoration: none; font-size: 0.9rem; font-weight: 600; }
  .hint, .empty { color: #666; text-align: center; padding: 2.5rem 1rem; }
  .mono { font-family: ui-monospace, monospace; color: #666; font-size: 0.85rem; }

  .alert { padding: 0.75rem 0.9rem; border-radius: 0.45rem; margin: 0.9rem 0; font-size: 0.9rem; }
  .alert.error { background: #fee; color: #a10000; }
  .alert.warn  { background: #fdf5d3; color: #6c5300; }
  .alert.ok    { background: #e8f6ec; color: #1f6b34; }

  .sec { font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.04em; margin: 1.8rem 0 0.6rem; }
  .sec-major { color: #a10000; }
  .sec-minor { color: #6c5300; }

  .defect-list { list-style: none; margin: 0; padding: 0; }
  .defect { background: white; border: 1px solid #e4e4e7; border-left-width: 4px;
            border-radius: 0.5rem; padding: 0.85rem 1rem; margin-bottom: 0.7rem; }
  .defect-major { border-left-color: #a10000; }
  .defect-minor { border-left-color: #e0b400; }

  .d-head { display: flex; justify-content: space-between; align-items: baseline; gap: 0.8rem; margin-bottom: 0.4rem; }
  .unit { font-weight: 700; font-size: 1.1rem; margin-right: 0.5rem; }
  .sev { font-size: 0.7rem; font-weight: 700; text-transform: uppercase; padding: 0.15rem 0.5rem; border-radius: 999px; }
  .sev-major { background: #fee; color: #a10000; }
  .sev-minor { background: #fdf5d3; color: #6c5300; }

  .item { margin: 0 0 0.2rem; font-size: 0.95rem; }
  .reg-text { margin: 0 0 0.35rem; font-size: 0.87rem; color: #555; }
  .note { margin: 0 0 0.3rem; font-size: 0.87rem; }
  .carried { margin: 0 0 0.3rem; font-size: 0.85rem; color: #6c5300; font-weight: 600; }
  .prov { margin: 0.4rem 0 0; font-size: 0.8rem; color: #888; }
  .prov a { color: #1c4e8a; }
  .photo { display: block; max-width: 100%; margin-top: 0.6rem; border-radius: 0.35rem; border: 1px solid #ddd; }

  .resolve { display: flex; gap: 0.5rem; margin-top: 0.8rem; flex-wrap: wrap; }
  .resolve input { flex: 1 1 16rem; padding: 0.6rem 0.75rem; font: inherit; font-size: 0.9rem;
                   border: 1px solid #c4c4c8; border-radius: 0.4rem; }
  .resolve button { padding: 0.6rem 1.1rem; font: inherit; font-size: 0.9rem; font-weight: 600;
                    color: white; background: #1f6b34; border: none; border-radius: 0.4rem; cursor: pointer; }
  .resolve button:disabled { background: #c9c9c9; cursor: default; }
</style>
