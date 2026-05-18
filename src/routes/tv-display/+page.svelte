<!-- src/routes/tv-display/+page.svelte -->
<!-- TV-optimized job board display: fullscreen, large fonts, auto-refresh every 10 seconds -->

<script>
  import { onMount } from 'svelte';
  import { api } from '$lib/api/client.js';

  let projects = [];
  let loading = true;
  let error = '';
  let lastUpdate = new Date().toLocaleTimeString();

  const STATUS_ORDER = ['new', 'active', 'pending', 'pickup'];
  const STATUS_CONFIG = {
    new: { label: 'Ready', color: '#3b82f6', bgColor: 'rgba(59, 130, 246, 0.1)' },
    active: { label: 'Prepress', color: '#f97316', bgColor: 'rgba(249, 115, 22, 0.1)' },
    pending: { label: 'Production', color: '#eab308', bgColor: 'rgba(234, 179, 8, 0.1)' },
    pickup: { label: 'Complete', color: '#22c55e', bgColor: 'rgba(34, 197, 87, 0.1)' },
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
      projects = await api.getProjects();
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
      <strong>Error loading projects:</strong> {error}
    </div>
  {/if}

  <div class="header">
    <h1>STATUS BOARD</h1>
    <div class="header-info">
      <span class="last-update">Updated: {lastUpdate}</span>
      {#if loading}
        <span class="loading">Loading...</span>
      {/if}
    </div>
  </div>

  <div class="columns-container">
    {#each STATUS_ORDER as statusKey}
      {@const config = STATUS_CONFIG[statusKey]}
      {@const items = grouped[statusKey]}
      <div class="status-column">
        <div class="column-header" style="background-color: {config.color}; color: white;">
          <h2>{config.label}</h2>
          <span class="count">{items.length}</span>
        </div>

        <div class="jobs-list">
          {#each items as project (project.id)}
            <div class="job-card" style="border-left: 5px solid {config.color};">
              <div class="job-title">{project.name}</div>
              <div class="job-client">{project.client_name || 'No client'}</div>

              <div class="job-meta">
                {#if project.assigned_to}
                  <div class="assigned">
                    <span class="label">Assigned:</span>
                    <span class="value">{project.assigned_to}</span>
                  </div>
                {/if}
                {#if project.due_date}
                  <div class="due-date">
                    <span class="label">Due:</span>
                    <span class="value">{formatDueDate(project.due_date)}</span>
                  </div>
                {/if}
              </div>

              {#if project.status_name}
                <div class="status-note">{project.status_name}</div>
              {/if}
            </div>
          {/each}

          {#if items.length === 0}
            <div class="empty-state">No projects</div>
          {/if}
        </div>
      </div>
    {/each}
  </div>
</div>

<style>
  :global(body) {
    margin: 0;
    padding: 0;
    background: #1a1a1a;
    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
    color: #fff;
    overflow: hidden;
  }

  .tv-display {
    width: 100vw;
    height: 100vh;
    display: flex;
    flex-direction: column;
    background: #1a1a1a;
    padding: 20px;
    box-sizing: border-box;
  }

  .error-banner {
    background: #dc2626;
    color: white;
    padding: 20px;
    border-radius: 8px;
    margin-bottom: 20px;
    font-size: 20px;
  }

  .header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 30px;
    border-bottom: 3px solid #3b82f6;
    padding-bottom: 20px;
  }

  .header h1 {
    margin: 0;
    font-size: 48px;
    font-weight: 700;
    color: #fff;
  }

  .header-info {
    display: flex;
    gap: 30px;
    font-size: 18px;
    align-items: center;
  }

  .last-update {
    color: #aaa;
  }

  .loading {
    color: #f97316;
    font-weight: bold;
    animation: pulse 1.5s infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
  }

  .columns-container {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 20px;
    flex: 1;
    overflow: hidden;
  }

  .status-column {
    display: flex;
    flex-direction: column;
    background: #242424;
    border-radius: 8px;
    overflow: hidden;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  }

  .column-header {
    padding: 20px;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .column-header h2 {
    margin: 0;
    font-size: 32px;
    font-weight: 600;
  }

  .column-header .count {
    font-size: 28px;
    font-weight: bold;
    background: rgba(255, 255, 255, 0.2);
    padding: 8px 16px;
    border-radius: 6px;
  }

  .jobs-list {
    flex: 1;
    overflow-y: auto;
    padding: 15px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .job-card {
    background: #333;
    padding: 16px;
    border-radius: 6px;
    border-left: 5px solid;
    min-height: 120px;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
  }

  .job-title {
    font-size: 20px;
    font-weight: 600;
    color: #fff;
    margin-bottom: 6px;
  }

  .job-client {
    font-size: 16px;
    color: #bbb;
    margin-bottom: 12px;
  }

  .job-meta {
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: 14px;
    color: #999;
  }

  .job-meta > div {
    display: flex;
    gap: 8px;
  }

  .assigned, .due-date {
    font-size: 14px;
  }

  .assigned .label, .due-date .label {
    font-weight: 600;
    color: #aaa;
    min-width: 70px;
  }

  .assigned .value, .due-date .value {
    color: #ddd;
  }

  .status-note {
    font-size: 13px;
    color: #88ccff;
    margin-top: 8px;
    font-style: italic;
  }

  .empty-state {
    display: flex;
    align-items: center;
    justify-content: center;
    color: #666;
    font-size: 18px;
    flex: 1;
    opacity: 0.6;
  }

  /* Scrollbar styling for better visibility on TV */
  .jobs-list::-webkit-scrollbar {
    width: 8px;
  }

  .jobs-list::-webkit-scrollbar-track {
    background: #2a2a2a;
  }

  .jobs-list::-webkit-scrollbar-thumb {
    background: #555;
    border-radius: 4px;
  }

  .jobs-list::-webkit-scrollbar-thumb:hover {
    background: #777;
  }
</style>
