<!--
  /fleet/schedule-1 — the inspection schedule itself.

  O. Reg. 199/07 requires the driver to carry the applicable schedule in the
  vehicle alongside the report, which means this page has to render in a yard
  with no signal. Full offline support (IndexedDB, queued drafts) is a later
  phase, but the schedule is small and static, so it is cached in
  localStorage on every successful load and served from that cache when the
  fetch fails. A cached copy is stamped with its age so nobody mistakes a
  three-month-old cache for a current one.
-->
<script>
  import { onMount } from 'svelte';
  import { fleetApi } from '$lib/api/fleet-client.js';

  const CACHE_KEY = 'hg_inspection_schedules_v1';

  let loading = true;
  let error = '';
  let schedules = [];
  let fromCache = false;
  let cachedAt = null;
  let openSchedule = null;

  onMount(async () => {
    try {
      const data = await fleetApi.inspectionSchedules();
      schedules = data.schedules || [];
      openSchedule = schedules[0]?.id ?? null;
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), schedules }));
      } catch {
        // Private mode or a full quota. Not worth failing the page over.
      }
    } catch (e) {
      // Offline, or the API is down. Fall back to whatever was last cached —
      // this is the page a driver is legally required to have on hand.
      try {
        const raw = localStorage.getItem(CACHE_KEY);
        if (raw) {
          const cached = JSON.parse(raw);
          schedules = cached.schedules || [];
          openSchedule = schedules[0]?.id ?? null;
          fromCache = true;
          cachedAt = cached.at;
        } else {
          error = e.message;
        }
      } catch {
        error = e.message;
      }
    } finally {
      loading = false;
    }
  });

  function groupsOf(schedule) {
    const map = new Map();
    for (const it of schedule.items || []) {
      if (!map.has(it.group_name)) map.set(it.group_name, []);
      map.get(it.group_name).push(it);
    }
    return [...map.entries()].map(([name, items]) => ({ name, items }));
  }

  function ageText(ts) {
    const days = Math.floor((Date.now() - ts) / 86400000);
    if (days === 0) return 'cached today';
    return `cached ${days} day${days === 1 ? '' : 's'} ago`;
  }
</script>

<svelte:head><title>Inspection schedule · Holm Graphics</title></svelte:head>

<div class="page">
  <header class="head">
    <a class="back" href="/fleet/check">← Check</a>
    <h1>Inspection schedule</h1>
  </header>

  {#if loading}
    <p class="hint">Loading…</p>
  {:else if error}
    <p class="alert error">{error}</p>
  {:else}
    {#if fromCache}
      <p class="alert warn">
        Offline — showing the last saved copy ({ageText(cachedAt)}). Reconnect to confirm
        it is current.
      </p>
    {/if}

    {#each schedules as s}
      <section class="schedule">
        <button class="sched-head" on:click={() => (openSchedule = openSchedule === s.id ? null : s.id)}>
          <div>
            <h2>{s.name}</h2>
            <p class="reg">{s.reg_reference} · version {s.version} · {s.unit_type}</p>
          </div>
          <span class="chev">{openSchedule === s.id ? '▾' : '▸'}</span>
        </button>

        {#if !s.source_verified}
          <p class="alert warn">
            <strong>Not yet verified.</strong> These item labels and defect descriptions are
            placeholders and have not been checked against the official MTO source. Do not
            rely on this text at a roadside inspection.
          </p>
        {/if}

        {#if openSchedule === s.id}
          {#if s.declaration_text}
            <div class="declaration">
              <h3>Declaration</h3>
              <p>{s.declaration_text}</p>
            </div>
          {/if}

          {#each groupsOf(s) as g}
            <div class="group">
              <h3>{g.name}</h3>
              <table>
                <thead>
                  <tr><th>Item</th><th>Minor defect</th><th>Major defect</th></tr>
                </thead>
                <tbody>
                  {#each g.items as it}
                    <tr>
                      <td class="item">{it.item_label}</td>
                      <td>{it.minor_defect_text || '—'}</td>
                      <td class="major">{it.major_defect_text || 'No major class'}</td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          {/each}
        {/if}
      </section>
    {/each}
  {/if}
</div>

<style>
  .page { max-width: 48rem; margin: 0 auto; padding: 1rem 1rem 4rem; }
  .head { display: flex; align-items: baseline; gap: 0.9rem; margin-bottom: 1rem; }
  .back { color: #666; text-decoration: none; font-size: 0.9rem; }
  h1 { margin: 0; font-size: 1.25rem; }
  .hint { color: #666; text-align: center; padding: 2rem; }
  .alert { padding: 0.7rem 0.85rem; border-radius: 0.4rem; margin: 0.7rem 0; font-size: 0.88rem; }
  .alert.error { background: #fee; color: #a10000; }
  .alert.warn  { background: #fdf5d3; color: #6c5300; }

  .schedule { border: 1px solid #e4e4e7; border-radius: 0.55rem; background: white; padding: 0.5rem 0.9rem 0.9rem; margin-bottom: 1rem; }
  .sched-head { display: flex; justify-content: space-between; align-items: center; width: 100%;
                background: none; border: none; padding: 0.6rem 0; font: inherit; text-align: left; cursor: pointer; }
  h2 { margin: 0; font-size: 1.05rem; }
  .reg { margin: 0.1rem 0 0; color: #777; font-size: 0.82rem; }
  .chev { color: #999; font-size: 1.1rem; }

  .declaration { background: #f7f8fa; border-radius: 0.4rem; padding: 0.7rem 0.85rem; margin-bottom: 1rem; }
  .declaration p { margin: 0; font-size: 0.88rem; line-height: 1.5; }

  h3 { font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.04em; color: #666; margin: 1.1rem 0 0.4rem; }
  table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
  th { text-align: left; color: #888; font-weight: 600; font-size: 0.75rem; text-transform: uppercase;
       border-bottom: 1px solid #ddd; padding: 0.3rem 0.5rem 0.3rem 0; }
  td { padding: 0.45rem 0.5rem 0.45rem 0; border-bottom: 1px solid #f2f2f2; vertical-align: top; color: #444; }
  td.item { font-weight: 600; color: #1a1a1a; width: 28%; }
  td.major { color: #8a2020; }

  /* Three columns of regulation text do not fit a phone; let the table
     scroll rather than crushing the words. */
  .group { overflow-x: auto; }
  @media (max-width: 34rem) {
    table { min-width: 30rem; }
  }
</style>
