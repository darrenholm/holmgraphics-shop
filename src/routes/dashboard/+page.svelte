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

  // Client search
  let clientSearch = '';
  let clientResults = [];
  let clientSearching = false;
  let clientSearchDone = false;

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
    if (s.includes('order') || s.includes('hold') || s.includes('service')) return 'new';
  return null;
}

  $: filtered = projects.filter(p => {
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
        <span class="overdue-pill">⚠ {overdueCount} overdue</span>
      {/if}
      <div class="toggle-group">
        <button class="toggle-btn" class:active={!myJobsOnly} on:click={() => myJobsOnly = false}>All Jobs</button>
        <button class="toggle-btn" class:active={myJobsOnly} on:click={() => myJobsOnly = true}>My Jobs</button>
      </div>
    </div>
    <div class="top-bar-right">
      <div class="search-wrap">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="search-icon"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input class="search-input" placeholder="Search active jobs…" bind:value={searchQuery} />
      </div>
      {#if $isStaff}
        <a href="/jobs/new" class="btn btn-primary">+ New Job</a>
      {/if}
    </div>
  </header>

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

    <!-- Client Job Search -->
    <div class="client-search-section">
      <h2 class="client-search-title">Search All Jobs by Client</h2>
      <div class="client-search-bar">
        <div class="search-wrap">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="search-icon"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input
            class="search-input search-input-lg"
            placeholder="Type client name…"
            bind:value={clientSearch}
            on:keydown={(e) => e.key === 'Enter' && searchByClient()}
          />
        </div>
        <button class="btn btn-primary" on:click={searchByClient} disabled={clientSearching || !clientSearch.trim()}>
          {clientSearching ? 'Searching…' : 'Search'}
        </button>
        {#if clientSearchDone}
          <button class="btn btn-ghost" on:click={clearClientSearch}>Clear</button>
        {/if}
      </div>

      {#if clientSearchDone}
        <div class="client-results">
          {#if clientResults.length === 0}
            <p class="empty-msg">No jobs found for "{clientSearch}"</p>
          {:else}
            <p class="results-count">{clientResults.length} job{clientResults.length !== 1 ? 's' : ''} found</p>
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
