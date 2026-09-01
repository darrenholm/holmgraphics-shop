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
  let cacheReason = '';
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
          cacheReason = e?.status === 401 ? 'session' : 'offline';
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

  // Items arrive ordered by sort_order (part * 100 + position), so insertion
  // order into the Map is already regulation order.
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
        {#if cacheReason === 'session'}
          Your session has expired — showing the last saved copy ({ageText(cachedAt)}).
          It is safe to show; sign in again to confirm it is current.
        {:else}
          Offline — showing the last saved copy ({ageText(cachedAt)}). Reconnect to confirm
          it is current.
        {/if}
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
            <strong>Not yet countersigned.</strong> This text was transcribed from Ontario
            e-Laws but has not yet been read back against the official source by whoever
            holds the CVOR file.
          </p>
        {/if}

        {#if openSchedule === s.id}
          {#if s.declaration_text}
            <div class="declaration">
              <h3>Declaration</h3>
              <p>{s.declaration_text}</p>
            </div>
          {/if}

          <!-- Laid out as the regulation prints it: one block per Part,
               with the minor and major columns side by side. -->
          {#each groupsOf(s) as g}
            {@const minor = g.items.filter((i) => i.severity === 'minor')}
            {@const major = g.items.filter((i) => i.severity === 'major')}
            <div class="group">
              <h3>{g.items[0]?.part_number ? `Part ${g.items[0].part_number}. ` : ''}{g.name}</h3>
              <div class="cols">
                <div class="col">
                  <h4 class="col-minor">Minor defects</h4>
                  {#if minor.length}
                    <ul>
                      {#each minor as it}
                        <li>
                          {#if it.condition_note}<em>{it.condition_note}:</em><br />{/if}
                          ({it.defect_letter}) {it.item_label}{#if it.footnote_refs?.length}<sup>{it.footnote_refs.join(',')}</sup>{/if}
                        </li>
                      {/each}
                    </ul>
                  {:else}<p class="none">—</p>{/if}
                </div>
                <div class="col">
                  <h4 class="col-major">Major defects</h4>
                  {#if major.length}
                    <ul>
                      {#each major as it}
                        <li>
                          {#if it.condition_note}<em>{it.condition_note}:</em><br />{/if}
                          ({it.defect_letter}) {it.item_label}{#if it.footnote_refs?.length}<sup>{it.footnote_refs.join(',')}</sup>{/if}
                        </li>
                      {/each}
                    </ul>
                  {:else}<p class="none">—</p>{/if}
                </div>
              </div>
            </div>
          {/each}

          {#if s.notes?.length}
            <div class="notes">
              <h3>Notes to the schedule</h3>
              <ol>
                {#each s.notes as n}
                  <li value={n.note_number}>{n.note_text}</li>
                {/each}
              </ol>
            </div>
          {/if}
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

  h3 { font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.04em; color: #666;
       margin: 1.3rem 0 0.4rem; border-bottom: 1px solid #eee; padding-bottom: 0.25rem; }
  h4 { font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.04em;
       margin: 0 0 0.3rem; font-weight: 700; }
  .col-minor { color: #6c5300; }
  .col-major { color: #8a2020; }

  /* Two columns on anything with room, stacked on a phone. Regulation text
     crushed into 40% of a 375px screen is unreadable, and this is the page
     a driver is holding at the roadside. */
  .cols { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
  @media (max-width: 34rem) { .cols { grid-template-columns: 1fr; gap: 0.6rem; } }

  .col ul { margin: 0; padding-left: 1.1rem; font-size: 0.85rem; line-height: 1.5; color: #444; }
  .col li { margin-bottom: 0.3rem; }
  .col li em { color: #777; font-size: 0.8rem; }
  .col sup { color: #1c4e8a; font-weight: 700; font-size: 0.65rem; }
  .none { margin: 0; color: #bbb; font-size: 0.85rem; }

  .notes { margin-top: 1.5rem; background: #f7f8fa; border-radius: 0.45rem; padding: 0.8rem 1rem; }
  .notes h3 { margin-top: 0; border: none; }
  .notes ol { margin: 0; padding-left: 1.4rem; font-size: 0.8rem; line-height: 1.5; color: #555; }
  .notes li { margin-bottom: 0.35rem; }
</style>
