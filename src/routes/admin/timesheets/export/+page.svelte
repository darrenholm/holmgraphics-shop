<!-- src/routes/admin/timesheets/export/+page.svelte
     Biweekly CSV export for QuickBooks Time Tracking import.
     Defaults to the most recent biweekly period (Sunday-to-Saturday).
     Marks downloaded entries as 'exported' so they don't double-count next run.
     Admin-gated. -->
<script>
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { auth, isAdmin } from '$lib/stores/auth.js';
  import { api } from '$lib/api/client.js';

  let from = '';
  let to = '';
  let includeOpen = false;
  let markExported = true;     // default ON; uncheck for a "preview" download
  let busy = false;
  let error = '';
  let message = '';
  // Preview pane: fetch a count of what *would* export without actually doing it.
  let previewCount = null;
  let previewLoading = false;

  function currentBiweeklyRange() {
    const now = new Date();
    const dow = now.getDay();
    const daysSinceSat = (dow + 1) % 7;
    const lastSat = new Date(now);
    lastSat.setDate(now.getDate() - daysSinceSat);
    lastSat.setHours(23, 59, 59, 999);
    const fromDate = new Date(lastSat);
    fromDate.setDate(lastSat.getDate() - 13);
    fromDate.setHours(0, 0, 0, 0);
    return { from: fromDate, to: lastSat };
  }
  function fmtDateInput(d) { return d.toISOString().slice(0, 10); }

  onMount(() => {
    if (!$auth || !$isAdmin) { goto('/login?return=/admin/timesheets/export'); return; }
    const r = currentBiweeklyRange();
    from = fmtDateInput(r.from);
    to   = fmtDateInput(r.to);
    refreshPreview();
  });

  async function refreshPreview() {
    previewLoading = true; previewCount = null;
    try {
      const fromISO = new Date(from + 'T00:00:00').toISOString();
      const toISO   = new Date(to   + 'T23:59:59').toISOString();
      const res = await api.timeAdminList({
        from: fromISO, to: toISO, status: 'closed',
      });
      // approved entries also export by default; include in preview count
      const approvedRes = await api.timeAdminList({
        from: fromISO, to: toISO, status: 'approved',
      });
      previewCount = (res.entries?.length || 0) + (approvedRes.entries?.length || 0);
    } catch (e) {
      previewCount = '?';
      error = e.message || String(e);
    } finally {
      previewLoading = false;
    }
  }

  async function downloadCsv() {
    busy = true; error = ''; message = '';
    try {
      const fromISO = new Date(from + 'T00:00:00').toISOString();
      const toISO   = new Date(to   + 'T23:59:59').toISOString();
      const result = await api.timeDownloadExport({
        from: fromISO,
        to:   toISO,
        includeOpen,
        markExported,
      });
      message = `Downloaded "${result.filename}" with ${result.count} entries.`
        + (markExported ? ' Entries marked as exported.' : ' Entries left unmarked (preview mode).');
      // Refresh count so the user sees it updated post-mark
      await refreshPreview();
    } catch (e) {
      error = e.message || String(e);
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head><title>Export Hours — Holm Graphics Admin</title></svelte:head>

<div class="page">
  <a class="back-link" href="/admin/timesheets">← Back to Timesheets</a>
  <h1 class="page-title">Export Hours</h1>

  <div class="card">
    <p class="muted">
      Download a CSV of approved &amp; closed entries for the selected pay period in
      QuickBooks Time Tracking format. By default, downloaded entries are marked
      <strong>exported</strong> so they don't appear in subsequent exports.
    </p>

    <div class="grid">
      <div class="field">
        <label>From</label>
        <input type="date" bind:value={from} on:change={refreshPreview} />
      </div>
      <div class="field">
        <label>To</label>
        <input type="date" bind:value={to} on:change={refreshPreview} />
      </div>
      <div class="field flex">
        <label class="check">
          <input type="checkbox" bind:checked={includeOpen} />
          Include still-open entries (no clock_out — duration counts as 0)
        </label>
        <label class="check">
          <input type="checkbox" bind:checked={markExported} />
          Mark entries as exported after download
        </label>
      </div>
    </div>

    <div class="preview">
      {#if previewLoading}
        <span class="muted">Counting…</span>
      {:else if previewCount != null}
        <span><strong>{previewCount}</strong> entries will be exported.</span>
      {/if}
    </div>

    <div class="actions">
      <button class="btn primary" on:click={downloadCsv} disabled={busy}>
        {busy ? 'Generating…' : 'Download CSV'}
      </button>
    </div>

    {#if message}<div class="notice ok">{message}</div>{/if}
    {#if error}<div class="notice error">{error}</div>{/if}
  </div>

  <div class="hint card">
    <h3>Importing into QuickBooks Online</h3>
    <ol>
      <li>Open QBO → Time → Time Entries → Import (or via the Apps tab if you use a connector).</li>
      <li>Select the downloaded file and confirm column mapping.</li>
      <li>If the importer prompts for "Service Item", leave blank for non-billable hours; map to your default if all entries are billable.</li>
      <li>Verify the totals match what's shown in <a href="/admin/timesheets">/admin/timesheets</a> before approving payroll.</li>
    </ol>
    <p class="muted">
      Phase 2 will replace this manual CSV step with direct QBO TimeActivity API
      sync, eliminating the import step entirely. Today's CSV approach also lets
      you paste into other payroll tools if you ever switch off QBO.
    </p>
  </div>
</div>

<style>
  .page { padding: 24px; max-width: 800px; margin: 0 auto; }
  .back-link {
    color: var(--text-muted); font-size: 0.9rem;
    text-decoration: none; display: inline-block; margin-bottom: 8px;
  }
  .back-link:hover { color: var(--text); }
  .page-title {
    font-family: var(--font-display); font-size: 1.6rem;
    letter-spacing: 0.04em; text-transform: uppercase;
    margin: 0 0 18px;
  }
  .card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    padding: 20px;
    margin-bottom: 16px;
  }
  .muted { color: var(--text-muted); font-size: 0.92rem; }

  .grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 14px;
    margin: 16px 0;
  }
  .field { display: flex; flex-direction: column; gap: 4px; }
  .field.flex { grid-column: 1 / -1; gap: 8px; }
  .field label {
    font-size: 0.78rem; color: var(--text-muted);
    text-transform: uppercase; letter-spacing: 0.04em;
  }
  .field input[type="date"] {
    background: var(--input-bg, var(--surface));
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 8px 10px; font: inherit;
  }
  .check { display: flex; gap: 8px; align-items: center; font-size: 0.92rem; text-transform: none; letter-spacing: 0; color: var(--text); }
  .check input { margin: 0; }

  .preview { padding: 10px 0; font-size: 1rem; }
  .actions { margin-top: 8px; }

  .btn {
    padding: 10px 18px; border-radius: var(--radius);
    border: 1px solid var(--border); background: var(--surface);
    color: var(--text); cursor: pointer; font: inherit; font-weight: 600;
  }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn.primary { background: var(--accent, #c0392b); color: white; border-color: transparent; }
  .btn.primary:hover:not(:disabled) { filter: brightness(1.1); }

  .notice { padding: 10px 12px; border-radius: var(--radius); margin-top: 12px; font-size: 0.92rem; }
  .notice.ok    { background: rgba(40,167,69,0.12); color: var(--green, #28a745); border: 1px solid rgba(40,167,69,0.3); }
  .notice.error { background: rgba(220,53,69,0.12); color: var(--red,   #dc3545); border: 1px solid rgba(220,53,69,0.3); }

  .hint h3 {
    font-family: var(--font-display);
    font-size: 1rem; text-transform: uppercase; letter-spacing: 0.04em;
    margin: 0 0 10px; color: var(--text);
  }
  .hint ol { margin: 0 0 12px 18px; padding: 0; }
  .hint li { margin: 4px 0; font-size: 0.92rem; }
</style>
