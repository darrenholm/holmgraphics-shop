<!--
  /fleet-admin/access-log — admin audit-log viewer.

  Every GET /api/fleet/documents/:id/file writes a row here (set up in
  Step 2). This page is the read side: filterable by user, vehicle, action,
  and date range. Useful for "did the driver actually look at the doc?"
  CVOR-style audit questions.
-->
<script>
  import { onMount } from 'svelte';
  import { fleetApi } from '$lib/api/fleet-client.js';

  let entries = [];
  let loading = true;
  let loadError = '';

  let vehicles = [];                  // for the vehicle dropdown

  // Filters
  let userId = '';                    // free-text id (no employee picker yet)
  let vehicleId = '';
  let action = '';
  let since = '';
  let until = '';

  const PAGE_SIZE = 100;
  let offset = 0;
  let hasMore = false;

  onMount(async () => {
    try {
      const list = await fleetApi.listVehicles({ includeInactive: true });
      vehicles = list.vehicles || [];
    } catch (e) {
      console.warn('vehicle list for filter failed', e.message);
    }
    await load();
  });

  async function load({ append = false } = {}) {
    loading = true; loadError = '';
    try {
      const params = {
        limit: PAGE_SIZE,
        offset: append ? offset + PAGE_SIZE : 0,
        user_id: userId || undefined,
        vehicle_id: vehicleId || undefined,
        action: action || undefined,
        since: since || undefined,
        until: until || undefined
      };
      const data = await fleetApi.getAccessLog(params);
      const next = data.entries || [];
      entries = append ? [...entries, ...next] : next;
      offset = data.offset;
      hasMore = next.length >= PAGE_SIZE;
    } catch (e) {
      loadError = e.message;
    } finally {
      loading = false;
    }
  }

  function applyFilters() { offset = 0; load(); }
  function clearFilters() {
    userId = ''; vehicleId = ''; action = ''; since = ''; until = '';
    offset = 0; load();
  }
  function loadMore() { load({ append: true }); }

  function formatTS(s) {
    return s ? new Date(s).toLocaleString('en-CA') : '—';
  }
  const DOC_LABEL = { ownership: 'Ownership', insurance: 'Insurance', cvor: 'CVOR' };
</script>

<svelte:head><title>Fleet — Access log · Holm Graphics</title></svelte:head>

<div class="page">
  <header class="page-head">
    <p class="back"><a href="/fleet-admin">← Dashboard</a></p>
    <h1>Access log</h1>
    <p class="hint">Every document view and download is recorded here.</p>
  </header>

  <section class="filters">
    <label>
      <span>Vehicle</span>
      <select bind:value={vehicleId}>
        <option value="">All vehicles</option>
        {#each vehicles as v (v.id)}
          <option value={v.id}>{v.unit_number}{v.active === false ? ' (inactive)' : ''}</option>
        {/each}
      </select>
    </label>
    <label>
      <span>Action</span>
      <select bind:value={action}>
        <option value="">Any</option>
        <option value="view">View</option>
        <option value="download">Download</option>
      </select>
    </label>
    <label>
      <span>User ID</span>
      <input type="text" bind:value={userId} placeholder="employee id" inputmode="numeric" />
    </label>
    <label>
      <span>Since</span>
      <input type="date" bind:value={since} />
    </label>
    <label>
      <span>Until</span>
      <input type="date" bind:value={until} />
    </label>
    <div class="filter-actions">
      <button class="btn primary" on:click={applyFilters} disabled={loading}>Apply</button>
      <button class="link-btn" on:click={clearFilters} disabled={loading}>Clear</button>
    </div>
  </section>

  {#if loadError}<p class="alert error">{loadError}</p>{/if}

  {#if loading && entries.length === 0}
    <p class="hint">Loading…</p>
  {:else if entries.length === 0}
    <p class="hint empty">No log entries match the current filters.</p>
  {:else}
    <table class="log">
      <thead>
        <tr>
          <th>When</th>
          <th>User</th>
          <th>Vehicle</th>
          <th>Document</th>
          <th>Action</th>
          <th>IP</th>
        </tr>
      </thead>
      <tbody>
        {#each entries as e (e.id)}
          <tr>
            <td class="ts">{formatTS(e.created_at)}</td>
            <td>{e.user_name || '—'}{#if e.user_email} <span class="muted small">({e.user_email})</span>{/if}</td>
            <td>{e.unit_number || '—'}</td>
            <td>{DOC_LABEL[e.doc_type] || e.doc_type || '—'}{#if e.is_current === false}<span class="muted small"> (history)</span>{/if}</td>
            <td><span class="action action-{e.action}">{e.action}</span></td>
            <td class="ip">{e.ip_address || '—'}</td>
          </tr>
        {/each}
      </tbody>
    </table>
    {#if hasMore}
      <div class="more">
        <button class="btn outline" on:click={loadMore} disabled={loading}>{loading ? 'Loading…' : 'Load more'}</button>
      </div>
    {/if}
  {/if}
</div>

<style>
  .page { max-width: 64rem; margin: 0 auto; padding: 1.5rem 1rem 4rem; }
  .back { margin: 0 0 0.5rem; font-size: 0.9rem; }
  .back a { color: #666; text-decoration: none; }
  .back a:hover { text-decoration: underline; }
  .page-head h1 { margin: 0 0 0.25rem; }
  .hint { color: #666; font-size: 0.92rem; margin: 0; }
  .muted { color: #888; }
  .small { font-size: 0.82rem; }
  .empty { padding: 1.5rem 0; text-align: center; }

  .filters {
    display: grid; grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr)); gap: 0.75rem;
    background: white; border: 1px solid #e4e4e7; border-radius: 0.5rem;
    padding: 1rem; margin: 1rem 0;
    align-items: end;
  }
  .filters label { display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.88rem; color: #444; }
  .filters input, .filters select {
    padding: 0.5rem 0.6rem; border: 1px solid #d4d4d8; border-radius: 0.35rem; font-size: 0.9rem;
  }
  .filter-actions { display: flex; align-items: center; gap: 0.75rem; }

  .alert { padding: 0.5rem 0.75rem; border-radius: 0.3rem; margin: 0.5rem 0; font-size: 0.9rem; }
  .alert.error { background: #fee; color: #b00; }

  table.log { width: 100%; border-collapse: collapse; background: white; border: 1px solid #e4e4e7; border-radius: 0.5rem; overflow: hidden; font-size: 0.9rem; }
  thead th { background: #f7f7f8; padding: 0.55rem 0.7rem; text-align: left; font-size: 0.82rem; color: #444; border-bottom: 1px solid #e4e4e7; }
  tbody td { padding: 0.5rem 0.7rem; border-bottom: 1px dashed #f0f0f0; }
  .ts { white-space: nowrap; color: #444; }
  .ip { font-family: ui-monospace, monospace; font-size: 0.82rem; color: #555; }

  .action { font-size: 0.78rem; padding: 0.15rem 0.5rem; border-radius: 999px; background: #eee; color: #444; }
  .action.action-view     { background: #e8f1fa; color: #21557d; }
  .action.action-download { background: #f3e8fa; color: #5a2a7a; }

  .more { display: flex; justify-content: center; margin: 1rem 0; }

  .btn { padding: 0.55rem 1rem; background: #c01818; color: white; border: none; border-radius: 0.4rem; font-weight: 600; cursor: pointer; font-size: 0.92rem; }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn.outline { background: transparent; color: #c01818; border: 1px solid #c01818; }
  .link-btn { background: none; border: 0; color: #c01818; cursor: pointer; font-size: 0.9rem; }
</style>
