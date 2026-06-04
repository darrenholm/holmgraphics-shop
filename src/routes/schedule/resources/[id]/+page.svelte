<!--
  /schedule/resources/[id] — single-resource view ("what's Brady doing
  this week"). Lists every task + install that depends on this resource
  in the visible window, plus a daily-allocation bar at the top showing
  capacity vs. allocated hours.

  Phase 4's conflict detection already lights up the cells red on the
  main /schedule page; this view is for clicking through to investigate
  WHY a resource is overbooked.
-->
<script>
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { api } from '$lib/api/client.js';

  $: resourceId = Number($page.params.id);

  let from = '';
  let to   = '';
  let resource = null;
  let tasks    = [];
  let installs = [];
  let load     = [];        // daily allocation for this resource
  let err = '';
  let loading = true;

  function isoDate(d) { return d.toISOString().slice(0, 10); }

  onMount(() => {
    const today = new Date();
    today.setUTCDate(today.getUTCDate() - today.getUTCDay() + 1);   // Monday
    from = isoDate(today);
    const end = new Date(today); end.setUTCDate(end.getUTCDate() + 27);
    to = isoDate(end);
    refresh();
  });

  async function refresh() {
    if (!resourceId) return;
    loading = true; err = '';
    try {
      const [byRes, allRes, allLoad] = await Promise.all([
        api.listByResource(resourceId, { from, to }),
        api.listResources(true),
        api.resourceLoad({ from, to }),
      ]);
      tasks    = byRes.tasks    || [];
      installs = byRes.installs || [];
      resource = (allRes.resources || []).find((r) => r.id === resourceId) || null;
      load     = (allLoad.load    || []).filter((l) => l.resource_id === resourceId);
    } catch (e) { err = e.message; }
    finally { loading = false; }
  }

  function daySpan() {
    if (!from || !to) return [];
    const out = [];
    const d = new Date(from + 'T12:00:00Z');
    const end = new Date(to + 'T12:00:00Z');
    while (d <= end) { out.push(new Date(d)); d.setUTCDate(d.getUTCDate() + 1); }
    return out;
  }
  function loadFor(day) {
    return load.find((l) => l.day && l.day.slice(0,10) === isoDate(day));
  }
</script>

<svelte:head><title>{resource ? resource.name : 'Resource'} — Schedule</title></svelte:head>

<div class="page">
  <header>
    <a href="/schedule" class="back">← Back to calendar</a>
    {#if resource}
      <h1><span class="swatch" style="background:{resource.color || '#94a3b8'}"></span>{resource.name}</h1>
      <p class="muted small">{resource.resource_type} · {resource.daily_capacity_hours}h/day capacity</p>
    {:else if !loading}
      <h1>Resource #{resourceId}</h1>
    {/if}
    <div class="window">
      <label>From <input type="date" bind:value={from} on:change={refresh} /></label>
      <label>To <input type="date" bind:value={to} on:change={refresh} /></label>
    </div>
  </header>

  {#if err}<div class="error">{err}</div>{/if}
  {#if loading}<p class="muted">Loading…</p>{/if}

  {#if resource}
    <section class="card">
      <h2>Daily allocation</h2>
      <div class="alloc-bars">
        {#each daySpan() as d}
          {@const l = loadFor(d)}
          {@const hours = l ? Number(l.hours_allocated) : 0}
          {@const cap = resource.daily_capacity_hours}
          {@const pct = Math.min(100, (hours / cap) * 100)}
          {@const over = hours > cap}
          <div class="alloc-day" title={`${isoDate(d)}: ${hours}h / ${cap}h`}>
            <div class="alloc-fill" class:over style={`height:${pct}%`}></div>
            <div class="alloc-label">{d.toLocaleDateString('en-CA', { month: 'numeric', day: 'numeric' })}</div>
            {#if over}<div class="alloc-overflow">+{(hours - cap).toFixed(1)}</div>{/if}
          </div>
        {/each}
      </div>
    </section>

    <section class="card">
      <h2>Tasks ({tasks.length})</h2>
      {#if tasks.length === 0}
        <p class="muted">No tasks on this resource in the window.</p>
      {:else}
        <table>
          <thead><tr><th>Project</th><th>Task</th><th>Planned</th><th>Hours</th><th>Status</th></tr></thead>
          <tbody>
            {#each tasks as t (t.id)}
              <tr>
                <td><a href={`/jobs/${t.project_id}`}>#{t.project_id} — {t.project_name || ''}</a><br /><span class="muted small">{t.client_name || ''}</span></td>
                <td>{t.name}</td>
                <td>{t.planned_start || '?'} → {t.planned_end || '?'}</td>
                <td>{t.duration_hours || '—'}</td>
                <td>{t.status}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    </section>

    <section class="card">
      <h2>Installs ({installs.length})</h2>
      {#if installs.length === 0}
        <p class="muted">No installs in the window.</p>
      {:else}
        <table>
          <thead><tr><th>Date</th><th>Project</th><th>Time</th><th>Hours</th><th>Status</th><th>Notes</th></tr></thead>
          <tbody>
            {#each installs as i (i.id)}
              <tr>
                <td>{i.install_date}</td>
                <td><a href={`/jobs/${i.project_id}`}>#{i.project_id} — {i.project_name || ''}</a><br /><span class="muted small">{i.client_name || ''}</span></td>
                <td>{i.start_time ? i.start_time.slice(0,5) : '—'}</td>
                <td>{i.duration_hours || '—'}</td>
                <td>{i.status}</td>
                <td class="muted small">{i.notes || ''}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    </section>
  {/if}
</div>

<style>
  .page { padding: 16px; max-width: 1100px; margin: 0 auto; }
  header { margin-bottom: 12px; }
  .back { color: #475569; text-decoration: none; font-size: 0.9rem; }
  header h1 { margin: 6px 0; display: flex; align-items: center; gap: 10px; }
  .swatch { width: 18px; height: 18px; border-radius: 3px; }
  .window { display: flex; gap: 12px; margin-top: 6px; }
  .window label { display: flex; flex-direction: column; gap: 2px; font-size: 0.8rem; color: #475569; }
  .window input { padding: 5px 7px; border: 1px solid #cbd5e1; border-radius: 3px; }
  .muted { color: #64748b; }
  .small { font-size: 0.85rem; }
  .error { background: #fef2f2; color: #991b1b; padding: 8px 12px; border-radius: 4px; }
  .card { background: #fff; border: 1px solid #e2e8f0; border-radius: 6px; padding: 16px; margin-bottom: 12px; }
  .card h2 { margin: 0 0 10px; font-size: 1.05rem; }

  .alloc-bars {
    display: grid;
    grid-template-columns: repeat(28, 1fr);
    gap: 2px;
    align-items: end;
    height: 90px;
  }
  .alloc-day {
    position: relative;
    height: 100%;
    background: #f1f5f9;
    border-radius: 2px 2px 0 0;
    display: flex; flex-direction: column-reverse;
  }
  .alloc-fill { background: #38bdf8; transition: height 0.2s; }
  .alloc-fill.over { background: #dc2626; }
  .alloc-label {
    position: absolute; bottom: -16px; left: 0; right: 0;
    text-align: center; font-size: 0.55rem; color: #64748b;
  }
  .alloc-overflow {
    position: absolute; top: -14px; left: 0; right: 0;
    text-align: center; font-size: 0.65rem; color: #dc2626; font-weight: 700;
  }

  table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
  th, td { padding: 6px 8px; border-bottom: 1px solid #e2e8f0; text-align: left; }
</style>
