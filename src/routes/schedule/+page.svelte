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
  let absences  = [];      // staff_absences overlapping the window
  let holidays  = [];      // observed holidays overlapping the window
  let weatherByDay = new Map();   // ISO date → { code, hi, lo, precip, wind }
  let loading   = true;
  let err       = '';

  // Modal state for editing tasks + absences from the calendar.
  let editingTask    = null;
  let editingAbsence = null;

  // Walkerton, Ontario — hard-coded shop location for the weather strip.
  // If the shop ever moves these are the only two numbers to change.
  const SHOP_LAT = 44.13;
  const SHOP_LON = -81.15;

  // Free Open-Meteo daily forecast. No API key. CORS-friendly. We grab
  // 16 days forward (their max) and best-effort 5 days back so the
  // calendar still shows past-week weather when staff scrub back.
  async function fetchWeather(fromIso, toIso) {
    try {
      const url = new URL('https://api.open-meteo.com/v1/forecast');
      url.searchParams.set('latitude',  String(SHOP_LAT));
      url.searchParams.set('longitude', String(SHOP_LON));
      url.searchParams.set('daily', [
        'weather_code',
        'temperature_2m_max',
        'temperature_2m_min',
        'precipitation_sum',
        'wind_speed_10m_max',
      ].join(','));
      url.searchParams.set('timezone', 'America/Toronto');
      url.searchParams.set('temperature_unit', 'celsius');
      url.searchParams.set('wind_speed_unit', 'kmh');
      url.searchParams.set('precipitation_unit', 'mm');
      // Past 5 days + forward 16 days (the cap). Calendar windows
      // larger than that just show missing-cells on the strip — non-fatal.
      url.searchParams.set('past_days', '5');
      url.searchParams.set('forecast_days', '16');
      const r = await fetch(url);
      if (!r.ok) throw new Error(`weather HTTP ${r.status}`);
      const j = await r.json();
      const days = j?.daily?.time || [];
      const map = new Map();
      for (let i = 0; i < days.length; i++) {
        map.set(days[i], {
          code:   j.daily.weather_code?.[i],
          hi:     j.daily.temperature_2m_max?.[i],
          lo:     j.daily.temperature_2m_min?.[i],
          precip: j.daily.precipitation_sum?.[i],
          wind:   j.daily.wind_speed_10m_max?.[i],
        });
      }
      weatherByDay = map;
    } catch (e) {
      // Forecast is a nice-to-have; never block the calendar render.
      console.warn('Weather fetch failed:', e.message || e);
      weatherByDay = new Map();
    }
  }

  // WMO weather code → emoji icon + short label.
  // https://open-meteo.com/en/docs (weather_code section)
  function weatherIcon(code) {
    if (code == null) return { icon: '·',  label: '' };
    if (code === 0) return { icon: '☀️',  label: 'Clear' };
    if (code <= 2)  return { icon: '🌤️',  label: 'Partly cloudy' };
    if (code === 3) return { icon: '☁️',  label: 'Overcast' };
    if (code <= 48) return { icon: '🌫️',  label: 'Fog' };
    if (code <= 57) return { icon: '🌦️',  label: 'Drizzle' };
    if (code <= 65) return { icon: '🌧️',  label: 'Rain' };
    if (code <= 67) return { icon: '🌧️',  label: 'Freezing rain' };
    if (code <= 77) return { icon: '❄️',  label: 'Snow' };
    if (code <= 82) return { icon: '🌧️',  label: 'Showers' };
    if (code <= 86) return { icon: '🌨️',  label: 'Snow showers' };
    if (code <= 99) return { icon: '⛈️',  label: 'Thunderstorm' };
    return { icon: '·', label: '' };
  }

  function weatherForDay(day) {
    return weatherByDay.get(isoDate(day));
  }
  // Days with high wind (>40 km/h) or heavy rain (>10 mm) get a warning
  // halo — these are the conditions that block exterior installs.
  function weatherIsRisky(w) {
    if (!w) return false;
    if (w.wind   != null && Number(w.wind)   > 40) return true;
    if (w.precip != null && Number(w.precip) > 10) return true;
    if (w.code   != null && [65, 67, 75, 82, 86, 95, 96, 99].includes(w.code)) return true;
    return false;
  }

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

  // Counts upcoming activity in the next 90 days OUTSIDE the visible
  // window — surfaced as a banner so the user knows there's work
  // scheduled they're not seeing right now.
  let upcomingOutsideWindow = 0;
  let earliestOutsideDate   = null;

  async function refresh() {
    if (!$isStaff) return;
    loading = true; err = '';
    try {
      const from = isoDate(windowStart);
      // Compute `to` directly from windowStart + weeksVisible instead of
      // reading the reactive `windowEnd` — Svelte batches reactive
      // updates, so a jumpWeeks → refresh() chain would otherwise read
      // the PRE-jump windowEnd and produce a 1-week window the first
      // time after navigation. Cost: one extra date-math call. Benefit:
      // bars always render in the requested window.
      const to   = isoDate(addDays(windowStart, weeksVisible * 7 - 1));
      const [resp1, resp2, resp3, resp4, resp5, resp6] = await Promise.all([
        api.listResources(),
        api.listInstalls({ from, to }),
        api.resourceLoad({ from, to }),
        api.listCalendarTasks({ from, to }),
        api.listAbsences({ from, to }),
        api.listHolidays({ from, to }),
      ]);
      resources = resp1.resources || [];
      installs  = resp2.installs  || [];
      load      = resp3.load      || [];
      tasks     = resp4.tasks     || [];
      absences  = resp5.absences  || [];
      holidays  = resp6.holidays  || [];
      // Weather is a separate, lower-priority fetch — don't let it
      // block the calendar render if Open-Meteo is slow / down.
      fetchWeather(from, to);

      // Side-by-side: count work in the next 90 days that's NOT in the
      // visible window, so we can prompt the user to navigate if they
      // think the calendar is empty when it's just zoomed wrong.
      countUpcomingOutsideWindow().catch(() => {});
    } catch (e) {
      err = e.message || 'Failed to load schedule.';
    } finally {
      loading = false;
    }
  }

  async function countUpcomingOutsideWindow() {
    upcomingOutsideWindow = 0;
    earliestOutsideDate = null;
    try {
      // Compute end-of-window inline (same reason as in refresh — Svelte
      // batches reactive updates, so windowEnd may be stale here).
      const calcEnd = addDays(windowStart, weeksVisible * 7 - 1);
      const peekFrom = isoDate(addDays(calcEnd, 1));
      const peekTo   = isoDate(addDays(calcEnd, 90));
      const [t, i] = await Promise.all([
        api.listCalendarTasks({ from: peekFrom, to: peekTo }),
        api.listInstalls({ from: peekFrom, to: peekTo }),
      ]);
      const seenTasks = new Set();
      for (const row of (t.tasks || [])) {
        if (!seenTasks.has(row.id)) { seenTasks.add(row.id); upcomingOutsideWindow++; }
      }
      upcomingOutsideWindow += (i.installs || []).length;
      // Earliest upcoming date.
      const dates = [
        ...(t.tasks || []).map(r => r.planned_start),
        ...(i.installs || []).map(r => r.install_date),
      ].filter(Boolean).sort();
      earliestOutsideDate = dates[0] || null;
    } catch { /* silent */ }
  }

  function jumpToUpcoming() {
    if (!earliestOutsideDate) return;
    windowStart = mondayOf(new Date(earliestOutsideDate + 'T12:00:00Z'));
    refresh();
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

  // Tasks bucketed by (effective_resource_id, day). A task spans
  // planned_start..planned_end, so it appears in every cell that
  // overlaps. Each cell gets a full bar (not a thin chip) so the user
  // can scan a row and instantly see "this person is booked these 4
  // days" without squinting. We tag start/middle/end positions so the
  // bar can show continuation arrows and only print the label once.
  $: tasksByCell = (() => {
    const map = new Map();
    for (const t of tasks) {
      if (!t.effective_resource_id || !t.planned_start || !t.planned_end) continue;
      const start = new Date(t.planned_start + 'T12:00:00Z');
      const end   = new Date(t.planned_end   + 'T12:00:00Z');
      const startTs = start.getTime();
      const endTs   = end.getTime();
      for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
        const ts = d.getTime();
        const key = `${t.effective_resource_id}|${isoDate(d)}`;
        if (!map.has(key)) map.set(key, []);
        map.get(key).push({
          ...t,
          _isStart: ts === startTs,
          _isEnd:   ts === endTs,
        });
      }
    }
    return map;
  })();
  function cellTasks(resourceId, day) {
    return tasksByCell.get(`${resourceId}|${isoDate(day)}`) || [];
  }

  // Absences bucketed by (person-resource-id, day). One row per overlap
  // day. Partial-day absences carry start/end times so the cell can
  // render them differently than full-day blocks.
  $: absencesByCell = (() => {
    const map = new Map();
    for (const a of absences) {
      if (!a.resource_id || !a.start_date || !a.end_date) continue;
      const start = new Date(a.start_date + 'T12:00:00Z');
      const end   = new Date(a.end_date   + 'T12:00:00Z');
      for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
        const key = `${a.resource_id}|${isoDate(d)}`;
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(a);
      }
    }
    return map;
  })();
  function cellAbsences(resourceId, day) {
    return absencesByCell.get(`${resourceId}|${isoDate(day)}`) || [];
  }
  function absenceColor(kind) {
    switch (kind) {
      case 'vacation':    return '#fb923c';
      case 'sick':        return '#f87171';
      case 'personal':    return '#a78bfa';
      case 'appointment': return '#60a5fa';
      case 'training':    return '#34d399';
      default:            return '#94a3b8';
    }
  }
  function absenceLabel(a) {
    if (a.start_time && a.end_time) {
      return `${a.start_time.slice(0,5)}-${a.end_time.slice(0,5)} ${a.kind}`;
    }
    return a.kind;
  }
  // Holidays bucketed by ISO date for fast lookup in the calendar header.
  $: holidaysByDay = new Map(holidays.map((h) => [h.date, h]));
  function holidayOn(day) { return holidaysByDay.get(isoDate(day)); }

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
      // api.getProjects returns the array directly, not `{ projects: [...] }`.
      try {
        const resp = await api.getProjects();
        projects = Array.isArray(resp) ? resp : (resp.projects || []);
      } catch { projects = []; }
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

  // ─── Task quick-edit modal (status + dates) ─────────────────────────
  function openEditTask(t) {
    editingTask = {
      id: t.id,
      project_id: t.project_id,
      project_name: t.project_name,
      name: t.name,
      status: t.status,
      planned_start: t.planned_start || '',
      planned_end:   t.planned_end   || '',
    };
  }
  async function saveTask() {
    if (!editingTask?.id) return;
    try {
      await api.updateJobTask(editingTask.id, {
        status:        editingTask.status,
        planned_start: editingTask.planned_start || null,
        planned_end:   editingTask.planned_end   || null,
      });
      editingTask = null;
      await refresh();
    } catch (e) { alert(e.message); }
  }

  // ─── Absence quick-add / edit modal ─────────────────────────────────
  // Triggered by clicking an empty staff cell, or an existing absence pill.
  function openAddAbsence(resource, day) {
    if (resource?.resource_type !== 'person' || !resource.employee_id) return;
    editingAbsence = {
      _new: true,
      employee_id: resource.employee_id,
      employee_name: resource.name,
      start_date: isoDate(day),
      end_date:   isoDate(day),
      start_time: '',
      end_time:   '',
      kind: 'personal',
      notes: '',
    };
  }
  function openEditAbsence(a) {
    editingAbsence = { ...a };
  }
  async function saveAbsence() {
    if (!editingAbsence?.employee_id) return;
    try {
      const payload = {
        employee_id: editingAbsence.employee_id,
        start_date:  editingAbsence.start_date,
        end_date:    editingAbsence.end_date || editingAbsence.start_date,
        start_time:  editingAbsence.start_time || null,
        end_time:    editingAbsence.end_time   || null,
        kind:        editingAbsence.kind,
        notes:       editingAbsence.notes || null,
      };
      if (editingAbsence._new) await api.createAbsence(payload);
      else                     await api.updateAbsence(editingAbsence.id, payload);
      editingAbsence = null;
      await refresh();
    } catch (e) { alert(e.message); }
  }
  async function removeAbsence() {
    if (!editingAbsence?.id) return;
    if (!confirm('Remove this absence?')) return;
    try {
      await api.deleteAbsence(editingAbsence.id);
      editingAbsence = null;
      await refresh();
    } catch (e) { alert(e.message); }
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

  {#if upcomingOutsideWindow > 0 && earliestOutsideDate}
    <!-- Parse the YYYY-MM-DD as noon UTC so toLocaleDateString doesn't
         roll the day BACK when the user's tz is west of UTC. Naive
         new Date('2026-06-15') is midnight-UTC, which in Toronto
         (UTC-4 summer) lands at 20:00 the previous day and formats as
         "Jun 14". -->
    {@const dispDate = new Date(earliestOutsideDate + 'T12:00:00Z').toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })}
    <div class="upcoming-banner">
      <span><strong>{upcomingOutsideWindow}</strong> upcoming item{upcomingOutsideWindow === 1 ? '' : 's'} scheduled after {dispDate} — not in this window.</span>
      <button class="btn btn-ghost" on:click={jumpToUpcoming}>Jump to {dispDate} →</button>
    </div>
  {/if}

  <div class="grid-wrap">
    <table class="cal-grid">
      <thead>
        <tr>
          <th class="row-label">Resource</th>
          {#each dayCells as d}
            {@const isWeekend = d.getDay() === 0 || d.getDay() === 6}
            {@const hol = holidayOn(d)}
            <th class:weekend={isWeekend} class:holiday-header={!!hol}>
              {dayLabel(d)}
              {#if hol}<div class="holiday-name" title={hol.name}>🎌 {hol.name}</div>{/if}
            </th>
          {/each}
        </tr>
      </thead>
      <tbody>
        <!-- Weather strip — one cell per day with icon + hi/lo + a
             warning halo when conditions threaten exterior installs.
             Hidden gracefully (cells just show "·") if Open-Meteo
             doesn't have data for a date (older than 5 days back,
             further than 16 days ahead, or service down). -->
        <tr class="weather-row">
          <th class="row-label">🌦️ Weather</th>
          {#each dayCells as d}
            {@const w = weatherForDay(d)}
            {@const wi = weatherIcon(w?.code)}
            <td class="weather-cell" class:risky={weatherIsRisky(w)} title={`${wi.label}${w ? ` · hi ${Math.round(w.hi)}° / lo ${Math.round(w.lo)}°${w.precip > 0 ? ` · ${w.precip}mm` : ''}${w.wind ? ` · wind ${Math.round(w.wind)}km/h` : ''}` : ''}`}>
              <div class="weather-icon">{wi.icon}</div>
              {#if w}
                <div class="weather-temp">{Math.round(w.hi)}° <span class="weather-lo">{Math.round(w.lo)}°</span></div>
                {#if w.precip > 1}
                  <div class="weather-precip">{Math.round(w.precip)}mm</div>
                {/if}
              {/if}
            </td>
          {/each}
        </tr>
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
                  class:holiday-cell={!!holidayOn(d)}
                  on:dragover={onDragOver}
                  on:drop={(e) => onDrop(r, d, e)}
                  on:click={() => {
                    if (items.length > 0 || cellAbsences(r.id, d).length > 0) return;
                    // Empty cell — for person resources, default to
                    // adding an absence; everything else schedules an
                    // install. Saves a context-menu and matches the
                    // most-likely intent per row type.
                    if (r.resource_type === 'person') openAddAbsence(r, d);
                    else                              openAddInstall(r, d);
                  }}
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
                       person-resource). Every overlapping day gets a
                       full-height bar; the start day shows the label,
                       middle days show a continuation arrow, end day
                       shows a stop bracket. -->
                  {#each cellTasks(r.id, d) as t (t.id + '-' + isoDate(d))}
                    <!-- Click → quick-edit (status + planned dates).
                         Shift-click → jump to the job (parent stops
                         propagation on the cell, so click won't bubble
                         to the empty-cell handler). -->
                    <a
                      class="task-bar"
                      class:task-cont={!t._isStart}
                      class:task-end={t._isEnd && !t._isStart}
                      style="background:{taskBarColor(t.task_kind)}"
                      href={`/jobs/${t.project_id}`}
                      on:click={(e) => {
                        e.stopPropagation();
                        if (e.shiftKey) return;          // let the link navigate
                        e.preventDefault();              // otherwise open the edit modal
                        openEditTask(t);
                      }}
                      title={`${t.project_name || ''} — ${t.name}\nStatus: ${t.status}\nAssigned: ${t.assigned_names || t.assigned_name || '—'}\n${t.planned_start} → ${t.planned_end}\n\nClick: edit status / dates\nShift+click: open job`}>
                      {#if t._isStart}
                        <span class="task-kind-icon">{taskKindIcon(t.task_kind)}</span>
                        <span class="task-job">#{t.project_id} {t.name}</span>
                        {#if !t._isEnd}<span class="task-arrow">›</span>{/if}
                      {:else if t._isEnd}
                        <span class="task-cont-label">‹ {t.name}</span>
                      {:else}
                        <span class="task-cont-label">‹ {t.name} ›</span>
                      {/if}
                    </a>
                  {/each}

                  {#if lcell && (items.length > 0 || cellTasks(r.id, d).length > 0)}
                    <div class="load-tag" class:over>{Number(lcell.hours_allocated).toFixed(1)}h / {Number(lcell.daily_capacity_hours).toFixed(0)}h</div>
                  {/if}

                  <!-- Absences on staff swimlanes: full-day blocks paint
                       a coloured chip; partial-day appointments show the
                       time range. Click to edit/remove. -->
                  {#each cellAbsences(r.id, d) as a (a.id)}
                    <button
                      class="absence-chip"
                      class:partial={a.start_time}
                      style="background:{absenceColor(a.kind)}"
                      on:click|stopPropagation={() => openEditAbsence(a)}
                      title={`${a.employee_name} — ${a.kind}${a.notes ? `\n${a.notes}` : ''}`}>
                      {absenceLabel(a)}
                    </button>
                  {/each}
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

{#if editingTask}
  <div class="modal-backdrop" on:click={() => editingTask = null}>
    <div class="modal" on:click|stopPropagation>
      <h2>Edit task — {editingTask.name}</h2>
      <div class="readonly">
        <a href={`/jobs/${editingTask.project_id}`}>Open job #{editingTask.project_id}{editingTask.project_name ? ` — ${editingTask.project_name}` : ''}</a>
      </div>
      <label>
        Status
        <select bind:value={editingTask.status}>
          <option value="pending">Pending</option>
          <option value="in_progress">In progress</option>
          <option value="completed">Completed</option>
          <option value="blocked">Blocked</option>
          <option value="skipped">Skipped</option>
        </select>
      </label>
      <div class="row">
        <label style="flex:1">Planned start<input type="date" bind:value={editingTask.planned_start} /></label>
        <label style="flex:1">Planned end<input type="date" bind:value={editingTask.planned_end} /></label>
      </div>
      <div class="modal-actions">
        <span style="flex:1"></span>
        <button class="btn btn-ghost" on:click={() => editingTask = null}>Cancel</button>
        <button class="btn btn-primary" on:click={saveTask}>Save</button>
      </div>
    </div>
  </div>
{/if}

{#if editingAbsence}
  <div class="modal-backdrop" on:click={() => editingAbsence = null}>
    <div class="modal" on:click|stopPropagation>
      <h2>{editingAbsence._new ? `Add absence — ${editingAbsence.employee_name || ''}` : `Edit absence — ${editingAbsence.employee_name || ''}`}</h2>
      <label>
        Kind
        <select bind:value={editingAbsence.kind}>
          <option value="vacation">Vacation</option>
          <option value="sick">Sick</option>
          <option value="personal">Personal day</option>
          <option value="appointment">Appointment</option>
          <option value="training">Training</option>
          <option value="other">Other</option>
        </select>
      </label>
      <div class="row">
        <label style="flex:1">Start date<input type="date" bind:value={editingAbsence.start_date} /></label>
        <label style="flex:1">End date<input type="date" bind:value={editingAbsence.end_date} /></label>
      </div>
      <p class="muted small" style="margin:0">Leave times blank for a full day off. Partial-day absences must be on a single date.</p>
      <div class="row">
        <label style="flex:1">Start time<input type="time" bind:value={editingAbsence.start_time} /></label>
        <label style="flex:1">End time<input type="time" bind:value={editingAbsence.end_time} /></label>
      </div>
      <label>
        Notes
        <textarea rows="2" bind:value={editingAbsence.notes} placeholder="Optional — e.g. dentist appt"></textarea>
      </label>
      <div class="modal-actions">
        {#if !editingAbsence._new}
          <button class="btn btn-danger-ghost" on:click={removeAbsence}>Delete</button>
        {/if}
        <span style="flex:1"></span>
        <button class="btn btn-ghost" on:click={() => editingAbsence = null}>Cancel</button>
        <button class="btn btn-primary" on:click={saveAbsence}>Save</button>
      </div>
    </div>
  </div>
{/if}

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
              <option value={p.id}>#{p.id} — {p.project_name || p.description || 'Untitled'} ({p.client_name || '—'})</option>
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
  .upcoming-banner {
    display: flex; align-items: center; gap: 12px; justify-content: space-between;
    background: #eff6ff; border: 1px solid #bfdbfe; color: #1e40af;
    padding: 8px 14px; border-radius: 6px; margin-bottom: 8px;
    font-size: 0.9rem;
  }
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

  /* Weather strip ----------------------------------------------------- */
  .weather-row .row-label { background: #f8fafc; font-size: 0.85rem; }
  .weather-cell {
    text-align: center;
    padding: 4px 2px !important;
    background: #fafafa;
    line-height: 1.15;
  }
  .weather-cell.risky {
    background: #fff7ed;
    box-shadow: inset 0 0 0 2px #f59e0b;
  }
  .weather-icon { font-size: 1.1rem; line-height: 1; }
  .weather-temp { font-size: 0.72rem; color: #1a1a1a; font-weight: 600; }
  .weather-lo   { color: #64748b; font-weight: 400; }
  .weather-precip { font-size: 0.65rem; color: #0369a1; }

  /* Holidays + absences ------------------------------------------------ */
  .holiday-header {
    background: #fef3c7 !important;
  }
  .holiday-name {
    font-size: 0.65rem;
    color: #92400e;
    font-weight: 600;
    margin-top: 2px;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .cal-cell.holiday-cell {
    background-image: repeating-linear-gradient(
      45deg,
      rgba(254, 243, 199, 0.5),
      rgba(254, 243, 199, 0.5) 6px,
      transparent 6px,
      transparent 12px
    );
  }
  .absence-chip {
    display: block;
    width: 100%;
    text-align: left;
    color: #fff;
    border: 0;
    border-radius: 3px;
    padding: 3px 6px;
    font-size: 0.72rem;
    font-weight: 600;
    text-transform: capitalize;
    cursor: pointer;
    margin-bottom: 2px;
  }
  .absence-chip.partial {
    font-weight: 500;
    text-transform: none;
  }
  .absence-chip:hover { filter: brightness(1.1); }
  .btn-danger-ghost {
    background: transparent;
    color: #b91c1c;
    border: 1px solid #fecaca;
  }
  .btn-danger-ghost:hover { background: #fef2f2; }
  .readonly { background: #f8fafc; padding: 8px 10px; border-radius: 4px; font-size: 0.9rem; }
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

  /* Task bars — every overlapping day gets a full bar so multi-day
     spans are obvious. Start day has rounded left + label; middle days
     are flat-left; end day is rounded-right. */
  .task-bar {
    display: flex;
    align-items: center;
    gap: 3px;
    color: #fff;
    padding: 3px 6px;
    border-radius: 3px;
    font-size: 0.72rem;
    line-height: 1.15;
    margin-bottom: 2px;
    text-decoration: none;
    cursor: pointer;
    min-height: 18px;
  }
  .task-bar:hover { filter: brightness(1.08); }
  /* Continuation cells: square-off the left edge so adjacent days
     visually merge into one continuous bar. */
  .task-bar.task-cont { border-radius: 0 3px 3px 0; padding-left: 4px; opacity: 0.92; }
  .task-bar.task-cont.task-end { border-radius: 0 3px 3px 0; }
  .task-kind-icon { font-size: 0.78rem; }
  .task-job {
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    flex: 1;
  }
  .task-arrow {
    font-weight: 700; opacity: 0.7;
  }
  .task-cont-label {
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    flex: 1;
    opacity: 0.85;
    font-size: 0.68rem;
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
