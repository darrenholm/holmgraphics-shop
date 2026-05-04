<!-- src/routes/time/+page.svelte
     Employee time-clock page. One big Clock In / Clock Out button + this
     week's running total + recent entries. Per-job picker is wired but
     marked "coming soon" for Phase 1; Phase 1.5 will enable it. -->
<script>
  import { onMount, onDestroy } from 'svelte';
  import { goto } from '$app/navigation';
  import { auth, isStaff } from '$lib/stores/auth.js';
  import { api } from '$lib/api/client.js';

  // ─── State ─────────────────────────────────────────────────────────
  let current = null;          // open entry, or null if not clocked in
  let entries = [];            // last 14 days of my entries
  let totalHours = 0;          // total hours in the displayed range
  let loading = true;
  let busy = false;            // disables buttons during clock in/out fetch
  let error = '';
  let message = '';

  // Refresh ticker so the live "elapsed" counter on the open entry updates.
  let now = new Date();
  let tickHandle;

  onMount(async () => {
    if (!$auth || !$isStaff) { goto('/login?return=/time'); return; }
    await loadAll();
    tickHandle = setInterval(() => { now = new Date(); }, 30_000); // 30s tick
  });
  onDestroy(() => { if (tickHandle) clearInterval(tickHandle); });

  async function loadAll() {
    loading = true; error = '';
    try {
      const [cur, mine] = await Promise.all([
        api.timeGetCurrent(),
        api.timeGetMine(),
      ]);
      current = cur;
      entries = mine.entries || [];
      totalHours = mine.total_hours || 0;
    } catch (e) {
      error = e.message || String(e);
    } finally {
      loading = false;
    }
  }

  async function clockIn() {
    busy = true; error = ''; message = '';
    try {
      current = await api.timeClockIn({});
      message = 'Clocked in.';
      await refreshList();
    } catch (e) {
      error = e.message || String(e);
    } finally {
      busy = false;
    }
  }

  async function clockOut() {
    busy = true; error = ''; message = '';
    try {
      const closed = await api.timeClockOut({});
      current = null;
      message = `Clocked out. Worked ${formatDuration(closed.duration_minutes)}.`;
      await refreshList();
    } catch (e) {
      error = e.message || String(e);
    } finally {
      busy = false;
    }
  }

  async function refreshList() {
    try {
      const mine = await api.timeGetMine();
      entries = mine.entries || [];
      totalHours = mine.total_hours || 0;
    } catch { /* ignore: header still shows latest current */ }
  }

  // ─── Formatting helpers ────────────────────────────────────────────
  function formatDuration(minutes) {
    if (minutes == null) return '—';
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    if (h === 0) return `${m}m`;
    if (m === 0) return `${h}h`;
    return `${h}h ${m}m`;
  }
  function formatTime(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' });
  }
  function formatDate(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' });
  }
  function elapsedFromOpen(entry) {
    if (!entry) return 0;
    return Math.floor((now - new Date(entry.clock_in)) / 60_000);
  }

  // Group entries by date for the recent-entries list.
  $: entriesByDate = entries.reduce((acc, e) => {
    const day = new Date(e.clock_in).toLocaleDateString('en-CA');
    (acc[day] ||= []).push(e);
    return acc;
  }, {});
  $: dateKeys = Object.keys(entriesByDate);
</script>

<svelte:head><title>Time Clock — Holm Graphics</title></svelte:head>

<div class="page">
  <h1 class="page-title">Time Clock</h1>

  {#if loading}
    <div class="muted">Loading…</div>
  {:else}
    <!-- Clock card -->
    <div class="clock-card card" class:on={!!current}>
      <div class="clock-status">
        {#if current}
          <span class="dot on" />
          <span>Clocked in at <strong>{formatTime(current.clock_in)}</strong></span>
          <span class="elapsed">({formatDuration(elapsedFromOpen(current))} elapsed)</span>
        {:else}
          <span class="dot off" />
          <span>Not clocked in</span>
        {/if}
      </div>

      {#if current}
        <button class="btn btn-clock-out" on:click={clockOut} disabled={busy}>
          {busy ? 'Working…' : 'Clock Out'}
        </button>
      {:else}
        <button class="btn btn-clock-in" on:click={clockIn} disabled={busy}>
          {busy ? 'Working…' : 'Clock In'}
        </button>
      {/if}

      <div class="job-picker-stub muted">
        Per-job tracking — coming soon. (Phase 1.5)
      </div>

      {#if message}<div class="notice ok">{message}</div>{/if}
      {#if error}<div class="notice error">{error}</div>{/if}
    </div>

    <!-- Range summary -->
    <div class="summary card">
      <div class="summary-label">Last 14 days</div>
      <div class="summary-hours">{totalHours.toFixed(2)} <span>hrs</span></div>
    </div>

    <!-- Recent entries grouped by day -->
    <h2 class="section-title">Recent entries</h2>
    {#if entries.length === 0}
      <div class="muted">No entries in this range.</div>
    {:else}
      {#each dateKeys as day}
        {@const dayEntries = entriesByDate[day]}
        {@const dayMinutes = dayEntries.reduce((s, e) => s + (e.duration_minutes || 0), 0)}
        <div class="day-block">
          <div class="day-head">
            <span>{formatDate(dayEntries[0].clock_in)}</span>
            <span class="day-total">{formatDuration(dayMinutes)}</span>
          </div>
          <table class="entries">
            <thead>
              <tr><th>In</th><th>Out</th><th>Duration</th><th>Status</th><th>Notes</th></tr>
            </thead>
            <tbody>
              {#each dayEntries as e}
                <tr>
                  <td>{formatTime(e.clock_in)}</td>
                  <td>{e.clock_out ? formatTime(e.clock_out) : '—'}</td>
                  <td>{formatDuration(e.duration_minutes)}</td>
                  <td><span class="status-{e.status}">{e.status}</span></td>
                  <td class="notes">{e.notes || ''}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/each}
    {/if}
  {/if}
</div>

<style>
  .page { padding: 24px; max-width: 800px; margin: 0 auto; }
  .page-title {
    font-family: var(--font-display); font-size: 1.6rem;
    letter-spacing: 0.04em; text-transform: uppercase;
    margin: 0 0 18px;
  }
  .section-title {
    font-family: var(--font-display); font-size: 1rem;
    letter-spacing: 0.06em; text-transform: uppercase;
    color: var(--text-muted); margin: 24px 0 10px;
  }
  .card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    padding: 20px;
  }
  .muted { color: var(--text-muted); font-size: 0.9rem; }

  /* ── Clock card ── */
  .clock-card { display: flex; flex-direction: column; gap: 14px; align-items: stretch; }
  .clock-card.on { border-color: var(--green, #28a745); }
  .clock-status {
    display: flex; align-items: center; gap: 10px;
    font-size: 1.05rem;
  }
  .clock-status .elapsed { color: var(--text-muted); font-size: 0.92rem; margin-left: 4px; }
  .dot { width: 12px; height: 12px; border-radius: 50%; display: inline-block; }
  .dot.on  { background: var(--green, #28a745); box-shadow: 0 0 8px var(--green, #28a745); }
  .dot.off { background: var(--text-dim); }

  .btn {
    border: none; border-radius: var(--radius); cursor: pointer;
    font: inherit; font-weight: 700; letter-spacing: 0.04em;
    padding: 18px 24px; font-size: 1.1rem; text-transform: uppercase;
    transition: filter 0.15s;
  }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn-clock-in  { background: var(--green, #28a745); color: white; }
  .btn-clock-out { background: var(--red,   #c0392b); color: white; }
  .btn:hover:not(:disabled) { filter: brightness(1.1); }

  .job-picker-stub {
    text-align: center;
    padding: 8px;
    border: 1px dashed var(--border);
    border-radius: var(--radius);
    font-size: 0.85rem;
  }

  .notice { padding: 10px 12px; border-radius: var(--radius); font-size: 0.9rem; text-align: center; }
  .notice.ok    { background: rgba(40,167,69,0.12); color: var(--green, #28a745); border: 1px solid rgba(40,167,69,0.3); }
  .notice.error { background: rgba(220,53,69,0.12); color: var(--red,   #dc3545); border: 1px solid rgba(220,53,69,0.3); }

  /* ── Summary card ── */
  .summary { margin-top: 16px; display: flex; align-items: baseline; justify-content: space-between; }
  .summary-label {
    font-family: var(--font-display); font-size: 0.85rem;
    text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-muted);
  }
  .summary-hours {
    font-family: var(--font-display); font-size: 2rem; font-weight: 800; color: var(--text);
  }
  .summary-hours span { font-size: 1rem; color: var(--text-muted); margin-left: 4px; }

  /* ── Day blocks + entries table ── */
  .day-block { margin-bottom: 18px; }
  .day-head {
    display: flex; justify-content: space-between; align-items: center;
    padding: 6px 4px; font-weight: 600;
    border-bottom: 1px solid var(--border);
    margin-bottom: 6px;
  }
  .day-total { color: var(--text-muted); font-size: 0.92rem; }

  .entries { width: 100%; border-collapse: collapse; font-size: 0.92rem; }
  .entries th, .entries td { padding: 8px 10px; text-align: left; }
  .entries th { color: var(--text-muted); font-weight: 600; font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.04em; }
  .entries tbody tr:nth-child(even) { background: rgba(255,255,255,0.02); }
  .entries .notes { color: var(--text-muted); }

  .status-open     { color: var(--green, #28a745); font-weight: 600; }
  .status-closed   { color: var(--text-muted); }
  .status-approved { color: var(--text); }
  .status-exported { color: var(--text-dim); font-style: italic; }
</style>
