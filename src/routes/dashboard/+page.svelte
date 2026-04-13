<!-- src/routes/dashboard/+page.svelte -->
<script>
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { api } from '$lib/api/client.js';
  import { isStaff, auth } from '$lib/stores/auth.js';

  let projects = [];
  let loading = true;
  let error = '';
  let searchQuery = '';
  let myJobsOnly = false;

  let clientSearch = '';
  let clientResults = [];
  let clientSearching = false;
  let clientSearchDone = false;
  let showClientSearch = false;

  const STATUS_COLUMNS = [
    { key: 'new',     label: 'New',        cls: 'badge-new' },
    { key: 'active',  label: 'Prepress',   cls: 'badge-active' },
    { key: 'pending', label: 'Production', cls: 'badge-pending' },
    { key: 'pickup',  label: 'Complete',   cls: 'badge-complete' },
  ];

  onMount(loadProjects);

  async function loadProjects() {
    loading = true; error = '';
    try { projects = await api.getProjects(); }
    catch (e) { error = e.message; }
    finally { loading = false; }
  }

  async function searchByClient() {
    if (!clientSearch.trim()) return;
    clientSearching = true;
    clientSearchDone = false;
    try {
      const all = await api.getProjects({ search: clientSearch.trim() });
      clientResults = all;
      clientSearchDone = true;
    } catch (e) { alert(e.message); }
    finally { clientSearching = false; }
  }

  function clearClientSearch() {
    clientSearch = '';
    clientResults = [];
    clientSearchDone = false;
    showClientSearch = false;
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

  function columnFor(p) {
    const s = (p.status_name || '').toLowerCase();
    if (s === 'quote') return null;
    if (s.includes('complete') || s.includes('done')) return null;
    if (isOverdue(p)) return 'active';
    if (s.includes('pickup') || s.includes('delivery') || s.includes('billing')) return 'pickup';
    if (s.includes('awaiting production') || s.includes('production') || s.includes('finish')) return 'pending';
    if (s.includes('design') || s.includes('proof') || s.includes('order material')) return 'active';
    if (s.includes('order') || s.includes('service')) return 'new';
    return null;
  }

  let showOverdueOnly = false;
  $: filtered = projects.filter(p => {
    if (showOverdueOnly) return isOverdue(p);
    const q = searchQuery.toLowerCase();
    if (q && !p.project_name?.toLowerCase().includes(q) && !p.client_name?.toLowerCase().includes(q)) return false;
    if (myJobsOnly && (p.assigned_to || '').trim() !== ($auth?.name || '').trim()) return false;
    return true;
  });

  $: columns = STATUS_COLUMNS.map(col => ({
    ...col,
    jobs: filtered.filter(p => columnFor(p) === col.key)
  }));

  $: overdueCount = projects.filter(isOverdue).length;

  function formatDate(d) {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' });
  }
</script>

<svelte:head><title>Job Board — Holm Graphics</title></svelte:head>

<div class="page">
  <header class="top-bar">
    <div class="top-bar-left">
      <h1 class="page-title">Job Board</h1>
      {#if overdueCount > 0}
        <button class="overdue-pill" on:click={() => showOverdueOnly = !showOverdueOnly}>⚠ {overdueCount} overdue</button>
      {/if}
      <div class="toggle-group">
        <button class="toggle-btn" class:active={!myJobsOnly} on:click={() => myJobsOnly = false}>All Jobs</button>
        <button class="toggle-btn" class:active={myJobsOnly} on:click={() => myJobsOnly = true}>My Jobs</button>
      </div>
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
                  <span class="job-id">#{job.id}</span>
                  <span class="badge {statusClass(job)}" style="font-size:0.7rem;padding:2px 7px">{statusLabel(job)}</span>
                </div>
                <div class="job-name">{job.project_name || 'Untitled Job'}</div>
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

  .job-card-top { display: flex; justify-content: space-between; align-items: center; }
  .job-id { font-family: var(--font-display); font-size: 0.72rem; color: var(--text-dim); letter-spacing: 0.05em; }
  .job-name { font-family: var(--font-display); font-weight: 700; font-size: 0.95rem; color: var(--text); line-height: 1.2; }
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
    .job-id { font-size: 0.85rem; }
    .job-name { font-size: 1.1rem; }
    .job-client { font-size: 0.95rem; }
    .job-type { font-size: 0.85rem; }
    .job-assigned { font-size: 0.85rem; }
    .job-due { font-size: 0.85rem; }
    .badge { font-size: 0.8rem !important; padding: 3px 9px !important; }
    .page-title { font-size: 1.4rem; }
  }
</style>
