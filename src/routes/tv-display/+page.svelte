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
    new: { label: 'Ordered', color: '#3b82f6' },
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

      if (!Array.isArray(data)) {
        console.error('Invalid response format:', data);
        error = 'Invalid data format from API';
        loading = false;
        return;
      }

      if (data.length === 0) {
        console.warn('No projects returned from API');
      } else {
        console.log('First project:', data[0]);
        console.log('Available keys:', Object.keys(data[0]));
      }

      // Debug: show status breakdown
      const statusBreakdown = {};
      data.forEach(p => {
        const status = p.status_name || 'null';
        statusBreakdown[status] = (statusBreakdown[status] || 0) + 1;
      });
      console.log('Raw status names and counts:', statusBreakdown);

      projects = data;
      lastUpdate = new Date().toLocaleTimeString();
      error = '';
    } catch (e) {
      error = `Failed to load: ${e.message}`;
      console.error('Load error:', e);
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

  // Map project status_name to our status keys (matches dashboard columnFor logic)
  function getStatusKey(p) {
    if (!p.status_name) return null;
    const s = p.status_name.toLowerCase();

    // Filter out (don't display)
    if (s === 'quote') return null;
    if (s.includes('complete') || s.includes('done')) return null;

    // Map to columns
    if (s.includes('pickup') || s.includes('delivery') || s.includes('billing')) return 'pickup';
    if (s.includes('awaiting production') || s.includes('production') || s.includes('finish')) return 'pending';
    if (s.includes('design') || s.includes('proof') || s.includes('order material')) return 'active';
    if (s.includes('order') || s.includes('service')) return 'new';

    // Everything else filtered out
    return null;
  }

  function getProjectName(p) {
    return p.project_name || 'Unnamed Project';
  }

  function getClientName(p) {
    return p.client_name || p.client || 'No Client';
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
      <strong>⚠ Error:</strong> {error}
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

  <div class="headers-row">
    {#each STATUS_ORDER as statusKey}
      {@const config = STATUS_CONFIG[statusKey]}
      {@const items = grouped[statusKey]}
      <div class="status-header" style="background-color: {config.color};">
        <h2>{config.label}</h2>
        <span class="count">{items.length}</span>
      </div>
    {/each}
  </div>

  <div class="columns-container">
    {#each STATUS_ORDER as statusKey}
      {@const config = STATUS_CONFIG[statusKey]}
      {@const items = grouped[statusKey]}
      {@const mid = Math.ceil(items.length / 2)}
      {@const col1 = items.slice(0, mid)}
      {@const col2 = items.slice(mid)}

      <!-- First sub-column -->
      <div class="job-column">
        <div class="jobs-list">
          {#each col1 as project (project.id)}
            <div class="job-card" style="border-left-color: {config.color};">
              <div class="job-title">{getProjectName(project)}</div>
              <div class="job-client">{getClientName(project)}</div>
            </div>
          {/each}
          {#if col1.length === 0}
            <div class="empty-state">—</div>
          {/if}
        </div>
      </div>

      <!-- Second sub-column -->
      <div class="job-column">
        <div class="jobs-list">
          {#each col2 as project (project.id)}
            <div class="job-card" style="border-left-color: {config.color};">
              <div class="job-title">{getProjectName(project)}</div>
              <div class="job-client">{getClientName(project)}</div>
            </div>
          {/each}
          {#if col2.length === 0}
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
    padding: 8px 0;
    margin: 0;
    box-sizing: border-box;
    gap: 4px;
    overflow: hidden;
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

  .headers-row {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 4px;
    flex-shrink: 0;
    margin: 0;
    padding: 0 2px;
  }

  .status-header {
    padding: 8px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    color: white;
    border-radius: 4px;
  }

  .status-header h2 {
    margin: 0;
    font-size: 18px;
    font-weight: 600;
  }

  .status-header .count {
    font-size: 18px;
    font-weight: bold;
    background: rgba(255, 255, 255, 0.2);
    padding: 6px 12px;
    border-radius: 4px;
  }

  .columns-container {
    display: grid;
    grid-template-columns: repeat(8, 1fr);
    gap: 4px;
    flex: 1;
    overflow: hidden;
    margin: 0;
    padding: 0 2px;
  }

  .job-column {
    display: flex;
    flex-direction: column;
    background: #242424;
    border-radius: 4px;
    overflow: hidden;
  }

  .jobs-list {
    flex: 1;
    overflow: hidden;
    padding: 4px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .job-card {
    background: #333;
    padding: 6px 8px;
    border-radius: 3px;
    border-left: 3px solid;
    flex-shrink: 0;
    min-height: auto;
  }

  .job-title {
    font-size: 12px;
    font-weight: 600;
    color: #fff;
    margin: 0 0 2px 0;
    line-height: 1.1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .job-client {
    font-size: 10px;
    color: #aaa;
    margin: 0;
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
