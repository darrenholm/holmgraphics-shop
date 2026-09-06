<!-- src/routes/dashboard/+page.svelte -->
<script>
  import { onMount, onDestroy } from 'svelte';
  import { goto } from '$app/navigation';
  import { api } from '$lib/api/client.js';
  import { isStaff, isAdmin, auth } from '$lib/stores/auth.js';

  let projects = [];
  let employees = [];
  let loading = true;
  let error = '';
  let searchQuery = '';
  let myJobsOnly = false;
  // Empty string = no override; a non-empty staff name overrides the
  // All Jobs / My Jobs toggle and filters projects to that person's jobs.
  let selectedStaff = '';

  let clientSearch = '';
  let clientResults = [];
  let clientSearching = false;
  let clientSearchDone = false;
  let showClientSearch = false;

  // Persist client search across job-detail navigations so staff can hop
  // into several results without losing the list. Cleared by the Clear
  // button (clearClientSearch) — tab close also clears it.
  const SEARCH_STORAGE_KEY = 'hg.dashboard.clientSearch';

  const STATUS_COLUMNS = [
    { key: 'new',     label: 'New',        cls: 'badge-new' },
    { key: 'active',  label: 'Prepress',   cls: 'badge-active' },
    { key: 'pending', label: 'Production', cls: 'badge-pending' },
    { key: 'pickup',  label: 'Complete',   cls: 'badge-complete' },
  ];

  // ─── Time clock widget ─────────────────────────────────────────────
  // Tiny inline clock so staff can punch in/out without leaving the
  // dashboard. Calls the existing /api/time endpoints — no new schema.
  let clockEntry = null;          // null = not clocked in, otherwise the open entry
  let clockBusy = false;
  let clockTickHandle;
  let nowTick = new Date();
  async function loadClockState() {
    try { clockEntry = await api.timeGetCurrent(); }
    catch { clockEntry = null; }
  }
  async function quickClockIn() {
    if (clockBusy) return;
    clockBusy = true;
    try {
      clockEntry = await api.timeClockIn({});
    } catch (e) { alert(e.message); }
    finally { clockBusy = false; }
  }
  async function quickClockOut() {
    if (clockBusy || !clockEntry) return;
    clockBusy = true;
    try {
      await api.timeClockOut({});
      clockEntry = null;
    } catch (e) { alert(e.message); }
    finally { clockBusy = false; }
  }
  // Pretty-print elapsed time since clock_in, updated every 30s by the
  // ticker. Uses h:mm with leading zero on the minute.
  function elapsedSince(iso) {
    if (!iso) return '0:00';
    const ms = nowTick.getTime() - new Date(iso).getTime();
    if (ms < 0) return '0:00';
    const totalMin = Math.floor(ms / 60000);
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    return `${h}:${String(m).padStart(2, '0')}`;
  }

  onMount(() => {
    loadProjects();
    loadEmployees();
    restoreClientSearch();
    if ($isAdmin) loadSummary();
    if ($isStaff) {
      loadClockState();
      clockTickHandle = setInterval(() => { nowTick = new Date(); }, 30_000);
    }
  });
  onDestroy(() => { if (clockTickHandle) clearInterval(clockTickHandle); });

  function restoreClientSearch() {
    try {
      const raw = sessionStorage.getItem(SEARCH_STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (!saved || !saved.query) return;
      clientSearch = saved.query;
      clientResults = Array.isArray(saved.results) ? saved.results : [];
      clientSearchDone = true;
      showClientSearch = true;
    } catch {
      sessionStorage.removeItem(SEARCH_STORAGE_KEY);
    }
  }

  async function loadProjects() {
    loading = true; error = '';
    try { projects = await api.getProjects(); }
    catch (e) { error = e.message; }
    finally { loading = false; }
  }

  // ─── Stat strip ────────────────────────────────────────────────────
  // Staff-only snapshot of the active pipeline (Ordered → Billing):
  // jobs on the floor, their total quoted value, and how many still
  // have no pricing entered. Quiet failure — the strip just hides if
  // the summary call errors rather than blocking the board.
  let summary = null;
  async function loadSummary() {
    try { summary = await api.getProjectsSummary(); }
    catch (e) { console.warn('Failed to load job-board summary:', e); summary = null; }
  }
  const money = new Intl.NumberFormat('en-CA', {
    style: 'currency', currency: 'CAD', maximumFractionDigits: 0
  });

  // Active employees, used to populate the staff filter dropdown. Built
  // as { value, label } where value is the assigned_to string we filter
  // on (display name, matching the projects table). Quiet failure — if
  // the call errors, the dropdown is just empty rather than blocking
  // the whole board.
  async function loadEmployees() {
    try {
      const rows = await api.getEmployees();
      employees = rows
        .map((e) => `${e.first_name || ''} ${e.last_name || ''}`.trim())
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b));
    } catch (e) {
      console.warn('Failed to load employee list for filter:', e);
      employees = [];
    }
  }

  async function searchByClient() {
    if (!clientSearch.trim()) return;
    clientSearching = true;
    clientSearchDone = false;
    try {
      const all = await api.getProjects({ search: clientSearch.trim() });
      clientResults = all;
      clientSearchDone = true;
      sessionStorage.setItem(SEARCH_STORAGE_KEY, JSON.stringify({
        query: clientSearch.trim(),
        results: clientResults
      }));
    } catch (e) { alert(e.message); }
    finally { clientSearching = false; }
  }

  function clearClientSearch() {
    clientSearch = '';
    clientResults = [];
    clientSearchDone = false;
    showClientSearch = false;
    sessionStorage.removeItem(SEARCH_STORAGE_KEY);
  }

  function isOverdue(p) {
    if (!p.due_date) return false;
    const s = (p.status_name || '').toLowerCase();
    if (s.includes('complete') || s.includes('pickup') || s.includes('delivery') || s.includes('billing')) return false;
    return new Date(p.due_date) < new Date();
  }

  function statusClass(p) {
    if (isOverdue(p)) return 'badge-overdue';
    const s = (p.status_name || '').toLowerCase();
    if (s.includes('design') || s.includes('proof') || s.includes('order material')) return 'badge-active';
    if (s.includes('awaiting production') || s.includes('production') || s.includes('finish')) return 'badge-pending';
    if (s.includes('pickup') || s.includes('delivery') || s.includes('billing')) return 'badge-complete';
    return 'badge-new';
  }

  function statusLabel(p) {
    if (isOverdue(p)) return '⚠ Overdue';
    return p.status_name || 'Unknown';
  }

  // Show quotes in the "New" column only for QUOTE_VISIBLE_DAYS after creation,
  // then drop off — staff still find old quotes via client search.
  const QUOTE_VISIBLE_DAYS = 10;
  function isFreshQuote(p) {
    if (!p.date_created) return false;
    const ageMs = Date.now() - new Date(p.date_created).getTime();
    return ageMs >= 0 && ageMs < QUOTE_VISIBLE_DAYS * 24 * 60 * 60 * 1000;
  }

  function columnFor(p) {
    const s = (p.status_name || '').toLowerCase();
    if (s === 'quote') return isFreshQuote(p) ? 'new' : null;
    if (s.includes('complete') || s.includes('done')) return null;
    if (isOverdue(p)) return 'active';
    if (s.includes('pickup') || s.includes('delivery') || s.includes('billing')) return 'pickup';
    if (s.includes('awaiting production') || s.includes('production') || s.includes('finish')) return 'pending';
    if (s.includes('design') || s.includes('proof') || s.includes('order material')) return 'active';
    if (s.includes('order') || s.includes('service')) return 'new';
    return null;
  }

  // ─── Job age in the shop ─────────────────────────────────────────────
  // "In the shop" = days since the job was created. date_created (the DB's
  // created_date) is the only intake-style timestamp the list payload
  // carries, and it's set when the job is first entered — so it doubles as
  // the intake date. Drives a small age flag on the card.
  function daysInShop(p) {
    if (!p.date_created) return 0;
    const ms = Date.now() - new Date(p.date_created).getTime();
    if (ms < 0) return 0;
    return Math.floor(ms / 86_400_000);
  }
  // Age flag level (renders as a colored ★): 'yellow' at 16–30 days,
  // 'red' past 30, '' for fresh jobs. Both use the same star glyph so the
  // red and yellow flags match — only the color differs.
  function ageLevel(p) {
    const d = daysInShop(p);
    if (d > 30) return 'red';
    if (d > 15) return 'yellow';
    return '';
  }

  // quoted_value arrives from the API as a Postgres numeric (a string like
  // "3000.00"), so parse before comparing. High-value jobs (> $2,500) get a
  // green description line.
  function isHighValue(p) {
    return (Number(p.quoted_value) || 0) > 2500;
  }

  // "Unpriced" = no dollar value entered yet. quoted_value arrives as a
  // Postgres numeric string, so coerce before testing.
  function isUnpriced(p) {
    return !(Number(p.quoted_value) > 0);
  }

  let showOverdueOnly = false;
  let showUnpricedOnly = false;
  // The two quick filters are mutually exclusive — turning one on
  // turns the other off.
  function toggleOverdueFilter() {
    showOverdueOnly = !showOverdueOnly;
    if (showOverdueOnly) showUnpricedOnly = false;
  }
  function toggleUnpricedFilter() {
    showUnpricedOnly = !showUnpricedOnly;
    if (showUnpricedOnly) showOverdueOnly = false;
  }
  $: filtered = projects.filter(p => {
    if (showOverdueOnly) return isOverdue(p);
    if (showUnpricedOnly && !isUnpriced(p)) return false;
    const q = searchQuery.toLowerCase();
    if (q && !p.project_name?.toLowerCase().includes(q) && !p.client_name?.toLowerCase().includes(q)) return false;
    // Staff dropdown overrides the All/My toggle: if a name is picked,
    // filter to just that person's jobs and ignore myJobsOnly.
    if (selectedStaff) {
      if ((p.assigned_to || '').trim() !== selectedStaff.trim()) return false;
    } else if (myJobsOnly && (p.assigned_to || '').trim() !== ($auth?.name || '').trim()) {
      return false;
    }
    return true;
  });

  $: columns = STATUS_COLUMNS.map(col => ({
    ...col,
    jobs: filtered.filter(p => columnFor(p) === col.key)
  }));

  // Both pills must count only jobs that actually appear on the board.
  // columnFor() returns null for completed jobs, stale quotes and anything on
  // Hold, so counting raw matches produced a pill you could click and get an
  // empty board from — an overdue stale quote has nowhere to be shown.
  $: overdueCount  = projects.filter(p => isOverdue(p)  && columnFor(p)).length;
  $: unpricedCount = projects.filter(p => isUnpriced(p) && columnFor(p)).length;

  function formatDate(d) {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' });
  }
</script>

<svelte:head><title>Job Board — Holm Graphics</title></svelte:head>

<div class="page">
  <!-- Time clock widget. Compact strip above the top bar so staff can
       punch in/out without leaving the Job Board. On mobile it stacks
       full-width and the button gets bigger touch target. Hidden for
       customer-realm sessions (no $isStaff). -->
  {#if $isStaff}
    <div class="clock-widget" class:in={clockEntry}>
      <div class="clock-status">
        {#if clockEntry}
          <span class="clock-dot live"></span>
          <span class="clock-label">Clocked in</span>
          <strong class="clock-elapsed">{elapsedSince(clockEntry.clock_in)}</strong>
        {:else}
          <span class="clock-dot"></span>
          <span class="clock-label">Not clocked in</span>
        {/if}
      </div>
      {#if clockEntry}
        <button class="clock-btn out" on:click={quickClockOut} disabled={clockBusy}>
          {clockBusy ? '…' : 'Clock out'}
        </button>
      {:else}
        <button class="clock-btn in" on:click={quickClockIn} disabled={clockBusy}>
          {clockBusy ? '…' : '▶ Clock in'}
        </button>
      {/if}
      <a class="clock-link" href="/time">Time log →</a>
    </div>
  {/if}

  <!-- Stat strip: active-pipeline snapshot (Ordered → Billing). Admin only. -->
  {#if $isAdmin && summary}
    <div class="stat-strip">
      <div class="stat-tile">
        <span class="stat-value">{summary.active_count}</span>
        <span class="stat-label">Active Jobs</span>
        <span class="stat-sub">Ordered → Billing</span>
      </div>
      <div class="stat-tile">
        <span class="stat-value">{money.format(summary.quoted_value)}</span>
        <span class="stat-label">Quoted Value</span>
        <span class="stat-sub">in the shop</span>
      </div>
      <button
        class="stat-tile stat-tile-btn"
        class:warn={summary.unpriced_count > 0}
        class:filtering={showUnpricedOnly}
        on:click={toggleUnpricedFilter}
        title={showUnpricedOnly ? 'Show all jobs' : 'Show only unpriced jobs'}
      >
        <span class="stat-value">{summary.unpriced_count}</span>
        <span class="stat-label">Unpriced Jobs</span>
        <span class="stat-sub">{showUnpricedOnly ? 'filtering — click to clear' : 'no pricing entered'}</span>
      </button>
    </div>
  {/if}

  <header class="top-bar">
    <div class="top-bar-left">
      <h1 class="page-title">Job Board</h1>
      {#if overdueCount > 0}
        <button class="overdue-pill" class:on={showOverdueOnly} on:click={toggleOverdueFilter}>⚠ {overdueCount} overdue</button>
      {/if}
      {#if unpricedCount > 0}
        <button class="unpriced-pill" class:on={showUnpricedOnly} on:click={toggleUnpricedFilter} title={showUnpricedOnly ? 'Show all jobs' : 'Show only jobs with no pricing entered'}>
          $ {unpricedCount} unpriced
        </button>
      {/if}
      <div class="toggle-group">
        <button class="toggle-btn" class:active={!myJobsOnly && !selectedStaff} on:click={() => { myJobsOnly = false; selectedStaff = ''; }}>All Jobs</button>
        <button class="toggle-btn" class:active={myJobsOnly && !selectedStaff} on:click={() => { myJobsOnly = true; selectedStaff = ''; }}>My Jobs</button>
      </div>
      <select class="staff-filter" class:active={selectedStaff} bind:value={selectedStaff} title="Filter by assigned staff">
        <option value="">— Anyone —</option>
        {#each employees as name}
          <option value={name}>{name}</option>
        {/each}
      </select>
    </div>
    <div class="top-bar-right">
      <!-- Client search -->
      {#if showClientSearch}
        <div class="client-search-inline">
          <div class="search-wrap">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="search-icon"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input
              class="search-input search-input-client"
              placeholder="Search by client…"
              bind:value={clientSearch}
              on:keydown={(e) => e.key === 'Enter' && searchByClient()}
              autofocus
            />
          </div>
          <button class="btn btn-primary btn-sm" on:click={searchByClient} disabled={clientSearching || !clientSearch.trim()}>
            {clientSearching ? '…' : 'Go'}
          </button>
          <button class="btn btn-ghost btn-sm" on:click={clearClientSearch}>✕</button>
        </div>
      {:else}
        <button class="btn btn-ghost btn-sm" on:click={() => showClientSearch = true} title="Search all jobs by client">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          Client Search
        </button>
      {/if}

      <div class="search-wrap">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="search-icon"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input class="search-input" placeholder="Search active jobs…" bind:value={searchQuery} />
      </div>
      {#if $isStaff}
        <!-- For the phone: a candidate part way through an election order is
             not on the board yet, so there is nowhere else to find them. -->
        <a href="/jobs/election-drafts" class="btn btn-ghost" title="Open an election order somebody is still filling in">🗳️ Election Drafts</a>
        <a href="/jobs/from-email" class="btn btn-ghost" title="Create a job from a pasted quote-request email">📧 From Email</a>
        <a href="/jobs/new" class="btn btn-primary">+ New Job</a>
      {/if}
    </div>
  </header>

  <!-- Client search results dropdown -->
  {#if clientSearchDone}
    <div class="client-results-bar">
      <div class="client-results-header">
        <span class="results-count">{clientResults.length} job{clientResults.length !== 1 ? 's' : ''} found for "<strong>{clientSearch}</strong>"</span>
        <button class="btn btn-ghost btn-sm" on:click={clearClientSearch}>Clear</button>
      </div>
      {#if clientResults.length === 0}
        <p class="empty-msg">No jobs found.</p>
      {:else}
        <table class="results-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Job Description</th>
              <th>Client</th>
              <th>Status</th>
              <th>Type</th>
              <th>Due Date</th>
              <th>Assigned</th>
            </tr>
          </thead>
          <tbody>
            {#each clientResults as job}
              <tr class="result-row" on:click={() => goto(`/jobs/${job.id}`)}>
                <td class="job-id-cell">#{job.id}</td>
                <td class="job-name-cell">{job.project_name || 'Untitled'}</td>
                <td>{job.client_name || '—'}</td>
                <td><span class="badge {statusClass(job)}">{statusLabel(job)}</span></td>
                <td class="text-muted">{job.project_type || '—'}</td>
                <td class="text-muted" class:due-hot={isOverdue(job)}>{formatDate(job.due_date)}</td>
                <td class="text-muted">{job.assigned_to || '—'}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    </div>
  {/if}

  {#if loading}
    <div class="loading-state"><div class="loading-spinner"></div><span>Loading jobs…</span></div>
  {:else if error}
    <div class="error-state"><strong>Error:</strong> {error} <button class="btn btn-ghost" on:click={loadProjects}>Retry</button></div>
  {:else}
    <div class="board">
      {#each columns as col}
        <div class="column">
          <div class="column-header">
            <span class="badge {col.cls}">{col.label}</span>
            <span class="col-count">{col.jobs.length}</span>
          </div>
          <div class="job-list">
            {#each col.jobs as job (job.id)}
              <button
                class="job-card"
                class:is-overdue={isOverdue(job)}
                on:click={() => goto(`/jobs/${job.id}`)}
              >
                <div class="job-card-top">
                  <span class="job-id">
                    #{job.id}
                    {#if ageLevel(job)}
                      <span class="age-star age-{ageLevel(job)}" title="{daysInShop(job)} days in shop">★</span>
                    {/if}
                  </span>
                  <span class="badge {statusClass(job)}" style="font-size:0.7rem;padding:2px 7px">{statusLabel(job)}</span>
                </div>
                <div class="job-name" class:high-value={isHighValue(job)}>{job.project_name || 'Untitled Job'}</div>
                <div class="job-client">{job.client_name || '—'}</div>
                <div class="job-footer">
                  <span class="job-type">{job.project_type || ''}</span>
                  {#if job.assigned_to && job.assigned_to.trim()}
                    <span class="job-assigned">👤 {job.assigned_to}</span>
                  {/if}
                </div>
                {#if job.due_date}
                  <div class="job-due" class:due-hot={isOverdue(job)}>Due {formatDate(job.due_date)}</div>
                {/if}
              </button>
            {/each}
            {#if col.jobs.length === 0}
              <div class="empty-col">No jobs</div>
            {/if}
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .page { padding: 28px 32px; min-height: 100vh; }

  /* Stat strip ---------------------------------------------------------- */
  .stat-strip {
    display: grid; grid-template-columns: repeat(3, 1fr);
    gap: 14px; margin-bottom: 22px;
  }
  .stat-tile {
    background: var(--surface); border: 1px solid var(--border);
    border-radius: var(--radius-lg); padding: 16px 20px;
    display: flex; flex-direction: column; gap: 2px;
    position: relative; overflow: hidden;
  }
  .stat-tile::before {
    content: ''; position: absolute; left: 0; top: 0; bottom: 0;
    width: 3px; background: var(--border-mid);
  }
  .stat-tile.warn::before { background: var(--red); }
  .stat-value {
    font-family: var(--font-display); font-size: 1.9rem; font-weight: 900;
    line-height: 1.05; color: var(--text); font-variant-numeric: tabular-nums;
  }
  .stat-tile.warn .stat-value { color: var(--red); }
  .stat-label {
    font-family: var(--font-display); font-size: 0.8rem; font-weight: 700;
    letter-spacing: 0.06em; text-transform: uppercase; color: var(--text-muted);
    margin-top: 4px;
  }
  .stat-sub { font-size: 0.74rem; color: var(--text-dim); }

  /* Clickable unpriced tile — same look as the plain tiles, plus hover
     and an inverted "filtering" state while the board is filtered. */
  .stat-tile-btn {
    font: inherit; text-align: left; cursor: pointer;
    transition: border-color 0.15s, box-shadow 0.15s;
  }
  .stat-tile-btn:hover { border-color: var(--red); box-shadow: var(--shadow); }
  .stat-tile-btn.filtering { border-color: var(--red); background: rgba(192,57,43,0.08); }
  .stat-tile-btn.filtering .stat-sub { color: var(--red); font-weight: 600; }

  @media (max-width: 600px) {
    .stat-strip { grid-template-columns: 1fr; gap: 10px; }
    .stat-value { font-size: 1.6rem; }
  }

  .top-bar {
    display: flex; align-items: center; justify-content: space-between;
    margin-bottom: 24px; gap: 16px; flex-wrap: wrap;
  }
  .top-bar-left { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
  .top-bar-right { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }

  .page-title {
    font-family: var(--font-display); font-size: 1.8rem; font-weight: 900;
    letter-spacing: 0.04em; text-transform: uppercase; color: var(--text);
  }

  .overdue-pill {
    background: rgba(192,57,43,0.15); border: 1px solid rgba(192,57,43,0.4);
    color: #dc2626; font-family: var(--font-display); font-size: 0.78rem;
    font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase;
    padding: 4px 10px; border-radius: 20px; cursor: pointer;
    animation: pulse 2s ease-in-out infinite;
  }
  @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.65; } }
  .overdue-pill.on { background: #dc2626; color: #fff; animation: none; }

  .unpriced-pill {
    background: rgba(192,57,43,0.08); border: 1px solid rgba(192,57,43,0.4);
    color: #dc2626; font-family: var(--font-display); font-size: 0.78rem;
    font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase;
    padding: 4px 10px; border-radius: 20px; cursor: pointer;
    transition: background 0.15s, color 0.15s;
  }
  .unpriced-pill:hover { background: rgba(192,57,43,0.18); }
  .unpriced-pill.on { background: #dc2626; color: #fff; }

  .toggle-group {
    display: flex; background: var(--surface-2);
    border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden;
  }
  .toggle-btn {
    padding: 7px 16px; background: none; border: none; cursor: pointer;
    font-family: var(--font-display); font-size: 0.85rem; font-weight: 600;
    letter-spacing: 0.04em; text-transform: uppercase;
    color: var(--text-muted); transition: all 0.15s;
  }
  .toggle-btn.active { background: var(--red); color: #fff; }

  .staff-filter {
    padding: 7px 28px 7px 12px;
    background: var(--surface-2); border: 1px solid var(--border);
    border-radius: var(--radius); color: var(--text);
    font-family: var(--font-display); font-size: 0.85rem; font-weight: 600;
    letter-spacing: 0.04em; text-transform: uppercase;
    cursor: pointer;
    appearance: none;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6' fill='none'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%23888' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right 10px center;
  }
  .staff-filter:focus { outline: none; border-color: var(--red); }
  .staff-filter.active { border-color: var(--red); color: var(--red); }

  .search-wrap { position: relative; }
  .search-icon {
    position: absolute; left: 10px; top: 50%; transform: translateY(-50%);
    color: var(--text-dim); pointer-events: none;
  }
  .search-input {
    width: 220px; padding: 8px 12px 8px 32px;
    background: var(--surface-2); border: 1px solid var(--border);
    border-radius: var(--radius); color: var(--text); font-size: 0.88rem;
  }
  .search-input-client { width: 200px; }

  .btn-sm { padding: 7px 12px; font-size: 0.82rem; }

  .client-search-inline { display: flex; align-items: center; gap: 6px; }

  /* Client results bar — sits below header, above board */
  .client-results-bar {
    background: var(--surface); border: 1px solid var(--border);
    border-radius: var(--radius-lg); padding: 16px 20px;
    margin-bottom: 20px;
  }
  .client-results-header {
    display: flex; align-items: center; justify-content: space-between;
    margin-bottom: 12px;
  }
  .results-count {
    font-size: 0.85rem; color: var(--text-muted);
    font-family: var(--font-display); letter-spacing: 0.04em;
  }

  .board {
    display: grid; grid-template-columns: repeat(4, 1fr);
    gap: 16px; align-items: start;
  }

  .column {
    background: var(--surface); border: 1px solid var(--border);
    border-radius: var(--radius-lg); overflow: hidden;
  }
  .column-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 12px 14px; border-bottom: 1px solid var(--border);
    background: var(--surface-2);
  }
  .col-count {
    font-family: var(--font-display); font-size: 0.85rem;
    color: var(--text-muted); font-weight: 700;
  }

  .job-list {
    padding: 10px; display: flex; flex-direction: column;
    gap: 8px; min-height: 60px;
  }

  .job-card {
    background: var(--surface); border: 1px solid var(--border);
    border-radius: var(--radius); padding: 12px 14px;
    cursor: pointer; text-align: left; width: 100%;
    transition: all 0.15s; display: flex; flex-direction: column;
    gap: 4px; position: relative; overflow: hidden;
  }
  .job-card::before {
    content: ''; position: absolute; left: 0; top: 0; bottom: 0;
    width: 3px; background: var(--border-mid); transition: background 0.15s;
  }
  .job-card:hover { border-color: var(--red); transform: translateY(-1px); box-shadow: var(--shadow); }
  .job-card:hover::before { background: var(--red); }
  .job-card.is-overdue { border-color: rgba(192,57,43,0.4); }
  .job-card.is-overdue::before { background: var(--red); }

  .job-card-top { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
  .job-id {
    font-family: var(--font-display); font-size: 1.2rem; font-weight: 600;
    color: var(--text); letter-spacing: 0.01em; line-height: 1;
    display: inline-flex; align-items: center; gap: 6px;
  }
  .age-star { font-size: 1.05rem; line-height: 1; }
  .age-star.age-yellow { color: #f5b301; }
  .age-star.age-red { color: #dc2626; }
  .job-name { font-family: var(--font-display); font-weight: 700; font-size: 0.95rem; color: var(--text); line-height: 1.2; }
  .job-name.high-value { color: #16a34a; }
  .job-client { font-size: 0.8rem; color: var(--text-muted); }

  .job-footer {
    display: flex; justify-content: space-between; align-items: center; margin-top: 2px;
  }
  .job-type { font-size: 0.72rem; color: var(--text-dim); font-style: italic; }
  .job-assigned { font-size: 0.72rem; color: var(--text-muted); }
  .job-due { font-family: var(--font-display); font-size: 0.72rem; color: var(--text-dim); }
  .job-due.due-hot { color: #dc2626; font-weight: 700; }

  .empty-col {
    text-align: center; padding: 24px 0;
    color: var(--text-dim); font-size: 0.82rem; font-style: italic;
  }

  .results-table { width: 100%; border-collapse: collapse; }
  .results-table th {
    text-align: left; padding: 8px 12px;
    font-family: var(--font-display); font-size: 0.75rem;
    letter-spacing: 0.1em; text-transform: uppercase;
    color: var(--text-muted); border-bottom: 2px solid var(--border);
    background: var(--surface-2);
  }
  .results-table td {
    padding: 10px 12px; border-bottom: 1px solid var(--border);
    font-size: 0.9rem; color: var(--text);
  }
  .result-row { cursor: pointer; transition: background 0.12s; }
  .result-row:hover td { background: var(--surface-2); }
  .job-id-cell { font-family: var(--font-display); font-size: 0.8rem; color: var(--text-dim); }
  .job-name-cell { font-weight: 600; }
  .text-muted { color: var(--text-muted) !important; }
  .due-hot { color: #dc2626 !important; font-weight: 600; }
  .empty-msg { color: var(--text-dim); font-style: italic; padding: 16px 0; }

  .loading-state, .error-state {
    display: flex; align-items: center; gap: 12px;
    padding: 48px; color: var(--text-muted); font-size: 0.9rem;
  }
  .loading-spinner {
    width: 20px; height: 20px; border: 2px solid var(--border);
    border-top-color: var(--red); border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  @media (max-width: 900px) { .board { grid-template-columns: repeat(2, 1fr); } }
  @media (max-width: 600px) {
    .page { padding: 12px; }
    .board { grid-template-columns: 1fr; }
    .search-input { width: 160px; }
    .search-input-client { width: 150px; }
    .job-card { padding: 14px 16px; }
    .job-id { font-size: 1.15rem; }
    .job-name { font-size: 1.1rem; }
    .job-client { font-size: 0.95rem; }
    .job-type { font-size: 0.85rem; }
    .job-assigned { font-size: 0.85rem; }
    .job-due { font-size: 0.85rem; }
    .badge { font-size: 0.8rem !important; padding: 3px 9px !important; }
    .page-title { font-size: 1.4rem; }
  }

  /* Time clock widget --------------------------------------------------- */
  .clock-widget {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 10px 16px;
    background: #fff;
    border: 1px solid var(--border, #e2e8f0);
    border-radius: 8px;
    margin-bottom: 12px;
  }
  .clock-widget.in {
    background: #f0fdf4;
    border-color: #86efac;
  }
  .clock-status {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 1;
  }
  .clock-dot {
    width: 10px; height: 10px;
    border-radius: 50%;
    background: #94a3b8;
    flex-shrink: 0;
  }
  .clock-dot.live {
    background: #16a34a;
    animation: clock-pulse 2s ease-in-out infinite;
  }
  @keyframes clock-pulse {
    0%, 100% { box-shadow: 0 0 0 0 rgba(22,163,74,0.45); }
    50%      { box-shadow: 0 0 0 6px rgba(22,163,74,0); }
  }
  .clock-label { color: #475569; font-size: 0.92rem; }
  .clock-elapsed {
    color: #166534;
    font-size: 1.1rem;
    font-variant-numeric: tabular-nums;
    margin-left: 4px;
  }
  .clock-btn {
    border: 0;
    border-radius: 6px;
    padding: 10px 18px;
    font: inherit;
    font-weight: 600;
    cursor: pointer;
    min-width: 110px;
  }
  .clock-btn.in  { background: #16a34a; color: #fff; }
  .clock-btn.in:hover:not(:disabled)  { background: #15803d; }
  .clock-btn.out { background: #dc2626; color: #fff; }
  .clock-btn.out:hover:not(:disabled) { background: #b91c1c; }
  .clock-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .clock-link {
    color: #64748b;
    text-decoration: none;
    font-size: 0.85rem;
    white-space: nowrap;
  }
  .clock-link:hover { color: #1e293b; text-decoration: underline; }

  @media (max-width: 640px) {
    .clock-widget {
      flex-wrap: wrap;
      gap: 8px;
    }
    .clock-status { width: 100%; }
    .clock-btn { flex: 1; padding: 14px 18px; font-size: 1rem; }
    .clock-link { width: 100%; text-align: center; padding-top: 4px; }
  }
</style>
