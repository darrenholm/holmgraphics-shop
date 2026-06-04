<!--
  /schedule — install calendar.

  Two-week swimlane view. Rows = install crews / vehicles / facilities
  (resource_type IN ('crew','vehicle','facility')). Columns = days.
  Each cell holds the install entries for that (resource, date), with
  a red border when the cell is overbooked relative to the resource's
  daily_capacity_hours.

  Interactions:
    Click empty cell  → open "add install" mini-form picking a job
    Click install     → open edit popover (date/crew/duration/notes)
    Drag install      → reschedule (date + crew via drop target)
    Weather toggle    → flips weather_blocked + paints bar yellow

  Phase 1 (this file) doesn't model job_tasks — that's per-job and
  lives on the job page's new Schedule tab.
-->
<script>
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { api } from '$lib/api/client.js';
  import { isStaff } from '$lib/stores/auth.js';

  // Two weeks visible by default.
  let weeksVisible = 2;
  // Start of the visible window — a Monday. Default = the current week's
  // Monday so the calendar opens on "this week" not last Wednesday.
  let windowStart = mondayOf(new Date());
  $: windowEnd = addDays(windowStart, weeksVisible * 7 - 1);

  let resources = [];
  let installs  = [];
  let tasks     = [];      // job_tasks overlapping the window (per-person + machine swimlanes)
  let load      = [];      // resource-load grid (Phase 4 overlay)
  let projects  = [];      // for the "schedule a job" picker
  let loading   = true;
  let err       = '';

  // Modal state for create / edit
  let editingInstall = null;       // null | install row | { _new: true, ... }

  // Helper: format Date → YYYY-MM-DD (UTC noon to dodge DST).
  function isoDate(d) {
    return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), 12)).toISOString().slice(0, 10);
  }
  function mondayOf(d) {
    const x = new Date(d);
    x.setHours(12, 0, 0, 0);
    const wd = (x.getDay() + 6) % 7;  // 0 = Monday
    x.setDate(x.getDate() - wd);
    return x;
  }
  function addDays(d, n) {
    const x = new Date(d);
    x.setDate(x.getDate() + n);
    return x;
  }
  function dayLabel(d) {
    return d.toLocaleDateString('en-CA', { weekday: 'short', month: 'numeric', day: 'numeric' });
  }
  $: dayCells = Array.from({ length: weeksVisible * 7 }, (_, i) => addDays(windowStart, i));

  async function refresh() {
    if (!$isStaff) return;
    loading = true; err = '';
    try {
      const from = isoDate(windowStart);
      const to   = isoDate(windowEnd);
      const [resp1, resp2, resp3, resp4] = await Promise.all([
        api.listResources(),
        api.listInstalls({ from, to }),
        api.resourceLoad({ from, to }),
        api.listCalendarTasks({ from, to }),
      ]);
      resources = resp1.resources || [];
      installs  = resp2.installs  || [];
      load      = resp3.load      || [];
      tasks     = resp4.tasks     || [];
    } catch (e) {
      err = e.message || 'Failed to load schedule.';
    } finally {
      loading = false;
    }
  }
  onMount(refresh);

  // Group resources by type for the swimlanes — installer crews + crane
  // + install bay first (the scheduling-critical ones), machines below.
  const TYPE_ORDER = ['crew', 'vehicle', 'facility', 'machine', 'person'];
  $: groupedResources = TYPE_ORDER
    .map((t) => ({ type: t, items: resources.filter((r) => r.resource_type === t) }))
    .filter((g) => g.items.length > 0);

  // Index installs by (resource_id, install_date) for O(1) cell lookup.
  $: installsByCell = (() => {
    const map = new Map();
    for (const i of installs) {
      const key = `${i.crew_resource_id ?? 'none'}|${i.install_date}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(i);
    }
    return map;
  })();

  // Same but for the resource-load overlay.
  $: loadByCell = (() => {
    const map = new Map();
    for (const l of load) {
      map.set(`${l.resource_id}|${l.day}`, l);
    }
    return map;
  })();

  function cellInstalls(resourceId, day) {
    return installsByCell.get(`${resourceId}|${isoDate(day)}`) || [];
  }
  function cellLoad(resourceId, day) {
    return loadByCell.get(`${resourceId}|${isoDate(day)}`);
  }

  // Tasks bucketed by (effective_resource_id, day). Tasks span a date
  // range (planned_start..planned_end), so a task appears in every cell
  // that overlaps the range. We tag the first day with `isStart=true`
  // so the bar can show its label once instead of repeating across days.
  $: tasksByCell = (() => {
    const map = new Map();
    for (const t of tasks) {
      if (!t.effective_resource_id || !t.planned_start || !t.planned_end) continue;
      const start = new Date(t.planned_start + 'T12:00:00Z');
      const end   = new Date(t.planned_end   + 'T12:00:00Z');
      for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
        const key = `${t.effective_resource_id}|${isoDate(d)}`;
        if (!map.has(key)) map.set(key, []);
        map.get(key).push({ ...t, _isStart: d.getTime() === start.getTime() });
      }
    }
    return map;
  })();
  function cellTasks(resourceId, day) {
    return tasksByCell.get(`${resourceId}|${isoDate(day)}`) || [];
  }

  function taskBarColor(kind) {
    switch (kind) {
      case 'customer_wait': return '#ca8a04';
      case 'vendor_wait':   return '#7c3aed';
      case 'permit':        return '#0e7490';
      case 'milestone':     return '#be123c';
      default:              return '#1e40af';     // labor
    }
  }
  function taskKindIcon(kind) {
    switch (kind) {
      case 'customer_wait': return '⏳';
      case 'vendor_wait':   return '📦';
      case 'permit':        return '🏛';
      case 'milestone':     return '🚩';
      default:              return '🔨';
    }
  }

  // Installs with no crew assigned, rendered in their own swimlane.
  $: unassignedInstalls = installs.filter((i) => !i.crew_resource_id);
  function unassignedOn(day) {
    const d = isoDate(day);
    return unassignedInstalls.filter((i) => i.install_date === d);
  }

  // ─── Window navigation ─────────────────────────────────────────────
  function jumpWeeks(n) {
    windowStart = addDays(windowStart, n * 7);
    refresh();
  }
  function jumpToday() {
    windowStart = mondayOf(new Date());
    refresh();
  }

  // ─── Add install modal ─────────────────────────────────────────────
  async function openAddInstall(resource, day) {
    editingInstall = {
      _new: true,
      project_id: null,
      install_date: isoDate(day),
      start_time: '08:00',
      duration_hours: 8,
      crew_resource_id: resource?.id || null,
      notes: '',
      weather_blocked: false,
      status: 'scheduled',
    };
    if (projects.length === 0) {
      try { projects = (await api.getProjects({ limit: 500 })).projects || []; }
      catch { projects = []; }
    }
  }

  function openEditInstall(install) {
    editingInstall = { ...install };
  }

  async function saveInstall() {
    if (!editingInstall?.project_id) {
      alert('Pick a job first.');
      return;
    }
    try {
      if (editingInstall._new) {
        await api.createInstall({
          project_id:       editingInstall.project_id,
          install_date:     editingInstall.install_date,
          start_time:       editingInstall.start_time,
          duration_hours:   editingInstall.duration_hours,
          crew_resource_id: editingInstall.crew_resource_id,
          notes:            editingInstall.notes,
          weather_blocked:  editingInstall.weather_blocked,
        });
      } else {
        await api.updateInstall(editingInstall.id, {
          install_date:     editingInstall.install_date,
          start_time:       editingInstall.start_time,
          duration_hours:   editingInstall.duration_hours,
          crew_resource_id: editingInstall.crew_resource_id,
          notes:            editingInstall.notes,
          weather_blocked:  editingInstall.weather_blocked,
          status:           editingInstall.status,
        });
      }
      editingInstall = null;
      await refresh();
    } catch (e) { alert(e.message); }
  }

  async function removeInstall() {
    if (!editingInstall?.id) return;
    if (!confirm(`Remove this install for ${editingInstall.project_name || `job #${editingInstall.project_id}`}?`)) return;
    try {
      await api.deleteInstall(editingInstall.id);
      editingInstall = null;
      await refresh();
    } catch (e) { alert(e.message); }
  }

  // ─── Drag + drop to reschedule ─────────────────────────────────────
  // Stores the install being dragged. We use DataTransfer for browsers
  // that gate getData() outside dragover, but the variable is the
  // authoritative state for the drop handler.
  let dragInstall = null;

  function onDragStart(install, e) {
    dragInstall = install;
    e.dataTransfer?.setData('text/plain', String(install.id));
    e.dataTransfer && (e.dataTransfer.effectAllowed = 'move');
  }
  function onDragOver(e) { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'; }
  async function onDrop(resource, day, e) {
    e.preventDefault();
    if (!dragInstall) return;
    const newDate = isoDate(day);
    const newCrew = resource?.id ?? null;
    if (dragInstall.install_date === newDate && dragInstall.crew_resource_id === newCrew) {
      dragInstall = null;
      return;
    }
    try {
      await api.updateInstall(dragInstall.id, { install_date: newDate, crew_resource_id: newCrew });
      dragInstall = null;
      await refresh();
    } catch (err) {
      alert(err.message);
      dragInstall = null;
    }
  }

  function statusColor(s) {
    return s === 'completed'   ? '#16a34a'
         : s === 'in_progress' ? '#0ea5e9'
         : s === 'postponed'   ? '#a16207'
         : s === 'cancelled'   ? '#94a3b8'
         : '#1f2937';
  }
</script>

<svelte:head><title>Install Schedule — Holm Graphics</title></svelte:head>

<div class="schedule-page">
  <header class="sched-header">
    <h1>Install Schedule</h1>
    <div class="window-nav">
      <button class="btn btn-ghost" on:click={() => jumpWeeks(-1)}>← Prev week</button>
      <button class="btn btn-ghost" on:click={jumpToday}>This week</button>
      <button class="btn btn-ghost" on:click={() => jumpWeeks(1)}>Next week →</button>
      <select bind:value={weeksVisible} on:change={refresh}>
        <option value={1}>1 week</option>
        <option value={2}>2 weeks</option>
        <option value={4}>4 weeks</option>
        <option value={6}>6 weeks</option>
      </select>
      <span class="window-range">
        {windowStart.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })}
        — {windowEnd.toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' })}
      </span>
    </div>
    <div class="legend">
      <span class="legend-dot" style="background:#1f2937"></span> Scheduled
      <span class="legend-dot" style="background:#0ea5e9"></span> In progress
      <span class="legend-dot" style="background:#16a34a"></span> Completed
      <span class="legend-dot" style="background:#a16207"></span> Postponed
      <span class="legend-dot" style="background:#facc15;border:2px solid #f59e0b"></span> Weather block
      <span class="legend-dot overbooked"></span> Overbooked
    </div>
  </header>

  {#if err}<div class="error">{err}</div>{/if}
  {#if loading}<p class="muted">Loading…</p>{/if}

  <div class="grid-wrap">
    <table class="cal-grid">
      <thead>
        <tr>
          <th class="row-label">Resource</th>
          {#each dayCells as d}
            {@const isWeekend = d.getDay() === 0 || d.getDay() === 6}
            <th class:weekend={isWeekend}>{dayLabel(d)}</th>
          {/each}
        </tr>
      </thead>
      <tbody>
        {#each groupedResources as group (group.type)}
          <tr class="type-divider">
            <td colspan={dayCells.length + 1}>{group.type === 'crew' ? 'Install crews' : group.type === 'vehicle' ? 'Vehicles' : group.type === 'facility' ? 'Facilities' : group.type === 'machine' ? 'Machines' : 'Staff'}</td>
          </tr>
          {#each group.items as r (r.id)}
            <tr>
              <th class="row-label" style="border-left:6px solid {r.color || '#94a3b8'}">
                <a href={`/schedule/resources/${r.id}`} class="resource-link">{r.name}</a>
              </th>
              {#each dayCells as d}
                {@const items = cellInstalls(r.id, d)}
                {@const lcell = cellLoad(r.id, d)}
                {@const over  = lcell?.overbooked}
                {@const isWeekend = d.getDay() === 0 || d.getDay() === 6}
                <td
                  class="cal-cell"
                  class:weekend={isWeekend}
                  class:overbooked={over}
                  on:dragover={onDragOver}
                  on:drop={(e) => onDrop(r, d, e)}
                  on:click={() => items.length === 0 && openAddInstall(r, d)}
                >
                  {#each items as i (i.id)}
                    <div
                      class="install-bar"
                      class:weather-blocked={i.weather_blocked}
                      style="background:{statusColor(i.status)}; border-left-color:{r.color || '#94a3b8'}"
                      draggable="true"
                      on:dragstart={(e) => onDragStart(i, e)}
                      on:click|stopPropagation={() => openEditInstall(i)}
                      title={`${i.client_name || ''} — ${i.project_name || ''}\n${i.notes || ''}`}
                    >
                      <div class="install-job">📍 #{i.project_id} {i.project_name || ''}</div>
                      <div class="install-client">{i.client_name || ''}</div>
                      {#if i.start_time}<div class="install-time">{i.start_time.slice(0, 5)}{i.duration_hours ? ` · ${i.duration_hours}h` : ''}</div>{/if}
                    </div>
                  {/each}

                  <!-- Task bars (job_tasks scheduled to this resource via
                       resource_id OR via assigned_emp_id when r is a
                       person-resource). Continuation days render a thin
                       continuation chip instead of the full label so the
                       cell isn't cluttered. -->
                  {#each cellTasks(r.id, d) as t (t.id + '-' + isoDate(d))}
                    {#if t._isStart}
                      <a
                        class="task-bar"
                        style="background:{taskBarColor(t.task_kind)}"
                        href={`/jobs/${t.project_id}`}
                        on:click|stopPropagation
                        title={`${t.project_name || ''} — ${t.name}\nAssigned: ${t.assigned_name || '—'}\n${t.planned_start} → ${t.planned_end}`}>
                        <span class="task-kind-icon">{taskKindIcon(t.task_kind)}</span>
                        <span class="task-job">#{t.project_id} {t.name}</span>
                      </a>
                    {:else}
                      <div class="task-bar-cont" style="background:{taskBarColor(t.task_kind)}" title={`${t.name} (continues)`}></div>
                    {/if}
                  {/each}

                  {#if lcell && (items.length > 0 || cellTasks(r.id, d).length > 0)}
                    <div class="load-tag" class:over>{Number(lcell.hours_allocated).toFixed(1)}h / {Number(lcell.daily_capacity_hours).toFixed(0)}h</div>
                  {/if}
                </td>
              {/each}
            </tr>
          {/each}
        {/each}

        <!-- Unassigned bucket: any install with no crew_resource_id. -->
        {#if unassignedInstalls.length}
          <tr class="type-divider"><td colspan={dayCells.length + 1}>Unassigned</td></tr>
          <tr>
            <th class="row-label" style="border-left:6px solid #94a3b8">— no crew —</th>
            {#each dayCells as d}
              {@const items = unassignedOn(d)}
              <td class="cal-cell"
                  on:dragover={onDragOver}
                  on:drop={(e) => onDrop(null, d, e)}
                  on:click={() => items.length === 0 && openAddInstall(null, d)}>
                {#each items as i (i.id)}
                  <div class="install-bar"
                       style="background:{statusColor(i.status)}; border-left-color:#94a3b8"
                       draggable="true"
                       on:dragstart={(e) => onDragStart(i, e)}
                       on:click|stopPropagation={() => openEditInstall(i)}>
                    <div class="install-job">#{i.project_id} {i.project_name || ''}</div>
                    <div class="install-client">{i.client_name || ''}</div>
                  </div>
                {/each}
              </td>
            {/each}
          </tr>
        {/if}
      </tbody>
    </table>
  </div>
</div>

{#if editingInstall}
  <div class="modal-backdrop" on:click={() => editingInstall = null}>
    <div class="modal" on:click|stopPropagation>
      <h2>{editingInstall._new ? 'Schedule install' : `Edit install · #${editingInstall.project_id}`}</h2>

      {#if editingInstall._new}
        <label>
          Job
          <select bind:value={editingInstall.project_id}>
            <option value={null}>— pick a job —</option>
            {#each projects as p}
              <option value={p.id}>#{p.id} — {p.description || p.project_name} ({p.client_name})</option>
            {/each}
          </select>
        </label>
      {:else}
        <div class="readonly">
          <strong>Job:</strong> <a href={`/jobs/${editingInstall.project_id}`}>#{editingInstall.project_id} — {editingInstall.project_name || ''}</a>
          {#if editingInstall.client_name}<br /><strong>Client:</strong> {editingInstall.client_name}{/if}
        </div>
      {/if}

      <div class="row">
        <label style="flex:1">
          Date
          <input type="date" bind:value={editingInstall.install_date} />
        </label>
        <label style="width:120px">
          Start
          <input type="time" bind:value={editingInstall.start_time} />
        </label>
        <label style="width:100px">
          Hours
          <input type="number" min="0.5" step="0.5" bind:value={editingInstall.duration_hours} />
        </label>
      </div>

      <label>
        Crew / resource
        <select bind:value={editingInstall.crew_resource_id}>
          <option value={null}>— unassigned —</option>
          {#each resources.filter(r => ['crew','vehicle','facility','person'].includes(r.resource_type)) as r}
            <option value={r.id}>{r.name}</option>
          {/each}
        </select>
      </label>

      {#if !editingInstall._new}
        <label>
          Status
          <select bind:value={editingInstall.status}>
            <option value="scheduled">Scheduled</option>
            <option value="in_progress">In progress</option>
            <option value="completed">Completed</option>
            <option value="postponed">Postponed</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </label>
      {/if}

      <label class="checkbox">
        <input type="checkbox" bind:checked={editingInstall.weather_blocked} />
        Weather-blocked (paints bar yellow)
      </label>

      <label>
        Notes
        <textarea rows="2" bind:value={editingInstall.notes} placeholder="Crew notes, site access, etc."></textarea>
      </label>

      <div class="modal-actions">
        {#if !editingInstall._new}
          <button class="btn btn-danger-ghost" on:click={removeInstall}>Delete</button>
        {/if}
        <span style="flex:1"></span>
        <button class="btn btn-ghost" on:click={() => editingInstall = null}>Cancel</button>
        <button class="btn btn-primary" on:click={saveInstall}>Save</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .schedule-page { padding: 16px; }
  .sched-header { display: flex; flex-direction: column; gap: 8px; margin-bottom: 12px; }
  .sched-header h1 { margin: 0; font-size: 1.4rem; }
  .window-nav { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
  .window-range { color: #475569; font-weight: 500; margin-left: 8px; }
  .legend { display: flex; gap: 14px; flex-wrap: wrap; font-size: 0.85rem; color: #475569; align-items: center; }
  .legend-dot { display: inline-block; width: 14px; height: 14px; border-radius: 3px; margin-right: 4px; vertical-align: middle; }
  .legend-dot.overbooked { background: #fee2e2; border: 2px solid #dc2626; }
  .error { color: #991b1b; background: #fef2f2; border: 1px solid #fecaca; padding: 8px 12px; border-radius: 4px; margin-bottom: 8px; }
  .muted { color: #64748b; }

  .grid-wrap { overflow-x: auto; border: 1px solid #e2e8f0; border-radius: 6px; background: #fff; }
  .cal-grid { width: 100%; border-collapse: collapse; font-size: 0.85rem; min-width: 800px; }
  .cal-grid th, .cal-grid td { border: 1px solid #e2e8f0; padding: 6px; vertical-align: top; text-align: left; }
  .cal-grid thead th { background: #f8fafc; position: sticky; top: 0; z-index: 2; font-weight: 600; }
  .row-label {
    background: #f8fafc;
    position: sticky; left: 0; z-index: 1;
    min-width: 140px;
    font-weight: 600;
  }
  .resource-link { color: inherit; text-decoration: none; }
  .resource-link:hover { color: #0ea5e9; text-decoration: underline; }
  .type-divider td {
    background: #f1f5f9;
    color: #475569;
    font-weight: 700;
    text-transform: uppercase;
    font-size: 0.75rem;
    letter-spacing: 0.04em;
    border-top: 2px solid #cbd5e1;
  }
  .cal-cell {
    min-width: 110px;
    min-height: 60px;
    cursor: pointer;
    position: relative;
  }
  .cal-cell.weekend { background: #fafafa; }
  .cal-cell.overbooked {
    background: linear-gradient(135deg, transparent 49%, #fecaca 50%, transparent 51%) #fff5f5;
    background-size: 8px 8px;
    border: 2px solid #dc2626;
  }
  .install-bar {
    color: #fff;
    padding: 4px 6px;
    border-radius: 3px;
    border-left: 4px solid #94a3b8;
    margin-bottom: 3px;
    line-height: 1.2;
    cursor: grab;
  }
  .install-bar:active { cursor: grabbing; }
  .install-bar.weather-blocked {
    background: #facc15 !important;
    color: #422006;
    border-left-color: #f59e0b !important;
  }
  .install-job { font-weight: 600; font-size: 0.82rem; }
  .install-client { font-size: 0.75rem; opacity: 0.85; }
  .install-time { font-size: 0.7rem; opacity: 0.7; }

  /* Task bars — thinner than install bars so a cell can hold several. */
  .task-bar {
    display: flex;
    align-items: center;
    gap: 3px;
    color: #fff;
    padding: 2px 5px;
    border-radius: 2px;
    font-size: 0.72rem;
    line-height: 1.1;
    margin-bottom: 2px;
    text-decoration: none;
    cursor: pointer;
  }
  .task-bar:hover { filter: brightness(1.08); }
  .task-kind-icon { font-size: 0.78rem; }
  .task-job {
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    flex: 1;
  }
  /* Continuation chip: a thin colored stripe so the user can SEE the
     task spans multiple days, without re-listing the name in every cell. */
  .task-bar-cont {
    height: 4px;
    border-radius: 2px;
    margin-bottom: 2px;
    opacity: 0.55;
  }
  .load-tag {
    position: absolute;
    bottom: 2px; right: 4px;
    font-size: 0.65rem;
    color: #475569;
    background: rgba(255,255,255,0.85);
    border-radius: 2px;
    padding: 0 4px;
  }
  .load-tag.over { color: #fff; background: #dc2626; }

  .modal-backdrop {
    position: fixed; inset: 0; background: rgba(15,23,42,0.5);
    display: flex; align-items: center; justify-content: center; z-index: 50;
  }
  .modal {
    background: #fff;
    border-radius: 8px;
    padding: 20px;
    width: min(520px, calc(100vw - 32px));
    max-height: 90vh;
    overflow-y: auto;
    display: flex; flex-direction: column; gap: 10px;
  }
  .modal h2 { margin: 0 0 8px; font-size: 1.1rem; }
  .modal label { display: flex; flex-direction: column; gap: 3px; font-size: 0.85rem; color: #475569; }
  .modal label.checkbox { flex-direction: row; align-items: center; gap: 8px; color: #1a1a1a; }
  .modal input, .modal select, .modal textarea {
    padding: 7px 9px; border: 1px solid #cbd5e1; border-radius: 4px;
    font: inherit; box-sizing: border-box;
  }
  .modal .row { display: flex; gap: 8px; }
  .modal .readonly { background: #f8fafc; padding: 8px 10px; border-radius: 4px; font-size: 0.9rem; }
  .modal-actions { display: flex; gap: 8px; align-items: center; margin-top: 6px; }

  .btn { padding: 8px 14px; border: 1px solid #cbd5e1; border-radius: 4px; background: #fff; cursor: pointer; font: inherit; }
  .btn-primary { background: #c01818; color: #fff; border-color: #c01818; }
  .btn-ghost { background: transparent; }
  .btn-danger-ghost { background: transparent; color: #b91c1c; border-color: #fecaca; }
</style>
