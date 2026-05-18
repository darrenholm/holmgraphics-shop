<!-- src/routes/tv-display/+page.svelte -->
<!-- TV-optimized job board display: fullscreen, all jobs visible without scrolling -->

<script>
  import { onMount } from 'svelte';
  import { api } from '$lib/api/client.js';

  let projects = [];
  let loading = true;
  let error = '';
  let lastUpdate = new Date().toLocaleTimeString();

  const STATUS_ORDER = ['new', 'active', 'pending', 'pickup'];
  const STATUS_CONFIG = {
    new: { label: 'Ready', color: '#3b82f6' },
    active: { label: 'Prepress', color: '#f97316' },
    pending: { label: 'Production', color: '#eab308' },
    pickup: { label: 'Complete', color: '#22c55e' },
  };

  onMount(() => {
    loadProjects();
    // Auto-refresh every 10 seconds
    const interval = setInterval(() => {
      loadProjects();
    }, 10000);

    return () => clearInterval(interval);
  });

  async function loadProjects() {
    try {
      const data = await api.getProjects();
      console.log('API Response:', data);
      console.log('First project:', data?.[0]);
      projects = data;
      lastUpdate = new Date().toLocaleTimeString();
      error = '';
    } catch (e) {
      error = e.message;
      console.error('Failed to load projects:', e);
    } finally {
      loading = false;
    }
  }

  // Group projects by status
  function groupByStatus(projectList) {
    const grouped = {};
    STATUS_ORDER.forEach(status => {
      grouped[status] = [];
    });

    projectList.forEach(p => {
      const status = getStatusKey(p);
      if (grouped[status]) {
        grouped[status].push(p);
      }
    });

    return grouped;
  }

  // Map project status_name to our status keys
  function getStatusKey(p) {
    if (!p.status_name) return 'new';
    const s = p.status_name.toLowerCase();
    if (s.includes('design') || s.includes('proof')) return 'active';
    if (s.includes('production') || s.includes('awaiting')) return 'pending';
    if (s.includes('pickup') || s.includes('complete') || s.includes('delivery')) return 'pickup';
    return 'new';
  }

  function formatDueDate(dateStr) {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
  }

  $: grouped = groupByStatus(projects);
</script>

<svelte:head>
  <title>Status Board</title>
</svelte:head>

<div class="tv-display">
  {#if error}
    <div class="error-banner">
      <strong>Error:</strong> {error}
    </div>
  {/if}

  <div class="header">
    <h1>STATUS BOARD</h1>
    <div class="header-info">
      <span class="last-update">{lastUpdate}</span>
      {#if loading}
        <span class="loading">⟳ Updating...</span>
      {/if}
    </div>
  </div>

  <div class="columns-container">
    {#each STATUS_ORDER as statusKey}
      {@const config = STATUS_CONFIG[statusKey]}
      {@const items = grouped[statusKey]}
      <div class="status-column">
        <div class="column-header" style="background-color: {config.color};">
          <h2>{config.label}</h2>
          <span class="count">{items.length}</span>
        </div>

        <div class="jobs-list">
          {#each items as project (project.id)}
            <div class="job-card" style="border-left-color: {config.color};">
              <div class="job-title">{project.name}</div>
              <div class="job-client">{project.client_name || '—'}</div>
              {#if project.assigned_to}
                <div class="job-info"><strong>👤</strong> {project.assigned_to}</div>
              {/if}
              {#if project.due_date}
                <div class="job-info"><strong>📅</strong> {formatDueDate(project.due_date)}</div>
              {/if}
            </div>
          {/each}

          {#if items.length === 0}
            <div class="empty-state">—</div>
          {/if}
        </div>
      </div>
    {/each}
  </div>
</div>

<style>
  :global(body), :global(html) {
    margin: 0;
    padding: 0;
    background: #1a1a1a;
    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
    color: #fff;
    overflow: hidden;
    width: 100%;
    height: 100%;
  }

  .tv-display {
    width: 100vw;
    height: 100vh;
    display: flex;
    flex-direction: column;
    background: #1a1a1a;
    padding: 12px;
    box-sizing: border-box;
    gap: 12px;
  }

  .error-banner {
    background: #dc2626;
    color: white;
    padding: 12px 16px;
    border-radius: 6px;
    font-size: 16px;
  }

  .header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 2px solid #3b82f6;
    padding-bottom: 8px;
    flex-shrink: 0;
  }

  .header h1 {
    margin: 0;
    font-size: 36px;
    font-weight: 700;
  }

  .header-info {
    display: flex;
    gap: 20px;
    font-size: 14px;
    align-items: center;
  }

  .last-update {
    color: #999;
  }

  .loading {
    color: #f97316;
    font-weight: bold;
    animation: pulse 1s infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
  }

  .columns-container {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 10px;
    flex: 1;
    overflow: hidden;
  }

  .status-column {
    display: flex;
    flex-direction: column;
    background: #242424;
    border-radius: 6px;
    overflow: hidden;
  }

  .column-header {
    padding: 10px 12px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-shrink: 0;
    color: white;
  }

  .column-header h2 {
    margin: 0;
    font-size: 20px;
    font-weight: 600;
  }

  .column-header .count {
    font-size: 18px;
    font-weight: bold;
    background: rgba(255, 255, 255, 0.2);
    padding: 4px 10px;
    border-radius: 4px;
  }

  .jobs-list {
    flex: 1;
    overflow: hidden;
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .job-card {
    background: #333;
    padding: 10px;
    border-radius: 4px;
    border-left: 4px solid;
    flex-shrink: 0;
    min-height: auto;
  }

  .job-title {
    font-size: 14px;
    font-weight: 600;
    color: #fff;
    margin: 0 0 4px 0;
    line-height: 1.2;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .job-client {
    font-size: 12px;
    color: #aaa;
    margin: 0 0 4px 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .job-info {
    font-size: 11px;
    color: #ccc;
    margin: 2px 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .empty-state {
    display: flex;
    align-items: center;
    justify-content: center;
    color: #555;
    font-size: 14px;
    flex: 1;
  }
</style>
