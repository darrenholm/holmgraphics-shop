<!-- src/routes/admin/timesheets/export/+page.svelte
     Pay-period CSV export for QuickBooks Time Tracking import.
     Phase 1.6: pay-period dropdown is the primary control. The custom date
     range from Phase 1 is still here as an "Advanced" override for ad-hoc
     exports outside the regular pay cycle. Admin-gated. -->
<script>
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { auth, isAdmin } from '$lib/stores/auth.js';
  import { api } from '$lib/api/client.js';

  // ─── State ─────────────────────────────────────────────────────────
  let periods = [];                  // recent pay periods (newest first)
  let selectedPeriodId = '';         // dropdown value (pay_period_id) — '' = custom
  let useCustomRange = false;        // toggles between dropdown vs date pickers
  let from = '';                     // custom range start (YYYY-MM-DD)
  let to = '';                       // custom range end
  let includeOpen = false;
  let markExported = true;
  let busy = false;
  let loading = true;
  let error = '';
  let message = '';

  $: selectedPeriod = periods.find(p => String(p.id) === String(selectedPeriodId)) || null;

  onMount(async () => {
    if (!$auth || !$isAdmin) { goto('/login?return=/admin/timesheets/export'); return; }
    await loadPeriods();
  });

  async function loadPeriods() {
    loading = true; error = '';
    try {
      // Pull a generous window: last 6 months + future. Recent first.
      const res = await api.payPeriodsList();
      periods = res.periods || [];
      // Default selection: the most recent period that's NOT yet exported,
      // typically the one currently in progress or the previous one ready
      // for payroll. If none, fall back to the newest period overall.
      const ready = periods.find(p => p.status !== 'exported');
      selectedPeriodId = ready ? String(ready.id) : (periods[0] ? String(periods[0].id) : '');
    } catch (e) {
      error = e.message || String(e);
    } finally {
      loading = false;
    }
  }

  async function downloadCsv() {
    busy = true; error = ''; message = '';
    try {
      let result;
      if (useCustomRange) {
        if (!from || !to) {
          throw new Error('Pick a from and to date for custom range, or switch to pay-period mode.');
        }
        const fromISO = new Date(from + 'T00:00:00').toISOString();
        const toISO   = new Date(to   + 'T23:59:59').toISOString();
        result = await api.timeDownloadExport({
          from: fromISO,
          to:   toISO,
          includeOpen,
          markExported,
        });
      } else {
        if (!selectedPeriodId) {
          throw new Error('Pick a pay period first.');
        }
        result = await api.timeDownloadExport({
          payPeriodId: parseInt(selectedPeriodId, 10),
          includeOpen,
          markExported,
        });
      }
      message = `Downloaded "${result.filename}" with ${result.count} entries.`
        + (markExported ? ' Marked exported.' : ' Preview mode — entries left unmarked.');
      // Refresh period list so status flip shows up.
      await loadPeriods();
    } catch (e) {
      error = e.message || String(e);
    } finally {
      busy = false;
    }
  }

  // Display helpers
  function fmtDateRange(p) {
    if (!p) return '';
    const fmt = (iso) => new Date(iso).toLocaleDateString('en-CA', {
      month: 'short', day: 'numeric',
    });
    return `${fmt(p.start_date)} – ${fmt(p.end_date)}`;
  }
  function fmtPayDate(p) {
    if (!p) return '';
    return new Date(p.pay_date).toLocaleDateString('en-CA', {
      weekday: 'short', month: 'short', day: 'numeric',
    });
  }
  function periodLabel(p) {
    const range = fmtDateRange(p);
    const tag = p.status === 'exported' ? ' (exported)'
              : p.status === 'closed'   ? ' (closed)'
              : '';
    return `${range}${tag}`;
  }
</script>

<svelte:head><title>Export Hours — Holm Graphics Admin</title></svelte:head>

<div class="page">
  <a class="back-link" href="/admin/timesheets">← Back to Timesheets</a>
  <h1 class="page-title">Export Hours</h1>

  {#if loading}
    <div class="muted">Loading pay periods…</div>
  {:else}
    <div class="card">
      <p class="muted">
        Download a CSV of approved &amp; closed entries for a pay period in
        QuickBooks Time Tracking format. Marking the period as exported
        prevents double-counting on the next payroll run.
      </p>

      <!-- Mode switcher -->
      <div class="mode">
        <label class="check">
          <input type="checkbox" bind:checked={useCustomRange} />
          Use custom date range instead of pay-period dropdown
        </label>
      </div>

      {#if !useCustomRange}
        <!-- Pay period mode -->
        <div class="field">
          <label>Pay period</label>
          <select bind:value={selectedPeriodId} disabled={periods.length === 0}>
            {#each periods as p}
              <option value={String(p.id)}>{periodLabel(p)}</option>
            {/each}
          </select>
        </div>

        {#if selectedPeriod}
          <div class="period-summary">
            <div class="row"><span class="lbl">Period</span><span class="val">{fmtDateRange(selectedPeriod)}</span></div>
            <div class="row"><span class="lbl">Pay date</span><span class="val">{fmtPayDate(selectedPeriod)}</span></div>
            <div class="row"><span class="lbl">Entries</span><span class="val">{selectedPeriod.entry_count} ({selectedPeriod.closed_count} closed, {selectedPeriod.approved_count} approved, {selectedPeriod.exported_count_actual} already exported)</span></div>
            <div class="row"><span class="lbl">Status</span><span class="val status-{selectedPeriod.status}">{selectedPeriod.status}</span></div>
            {#if selectedPeriod.exported_at}
              <div class="row notice ok">
                Already exported {new Date(selectedPeriod.exported_at).toLocaleString('en-CA')}
                {selectedPeriod.exported_by_name ? `by ${selectedPeriod.exported_by_name}` : ''}.
                Re-exporting will only include entries that aren't already marked exported
                (use Reopen on the Pay Periods page if you need a clean re-run).
              </div>
            {/if}
          </div>
        {/if}
      {:else}
        <!-- Custom date range fallback -->
        <div class="grid">
          <div class="field">
            <label>From</label>
            <input type="date" bind:value={from} />
          </div>
          <div class="field">
            <label>To</label>
            <input type="date" bind:value={to} />
          </div>
        </div>
        <p class="muted hint">
          Custom range bypasses pay-period tracking. Use this for ad-hoc exports
          (e.g., a single employee's quarterly hours) — not for regular payroll.
        </p>
      {/if}

      <!-- Common toggles -->
      <div class="field flex">
        <label class="check">
          <input type="checkbox" bind:checked={includeOpen} />
          Include still-open entries (no clock_out — duration counts as 0)
        </label>
        <label class="check">
          <input type="checkbox" bind:checked={markExported} />
          Mark entries (and pay period) as exported after download
        </label>
      </div>

      <div class="actions">
        <button class="btn primary" on:click={downloadCsv} disabled={busy}>
          {busy ? 'Generating…' : 'Download CSV'}
        </button>
      </div>

      {#if message}<div class="notice ok">{message}</div>{/if}
      {#if error}<div class="notice error">{error}</div>{/if}
    </div>
  {/if}

  <div class="hint card">
    <h3>Importing into QuickBooks Online</h3>
    <ol>
      <li>Open QBO → Time → Time Entries → Import (or via the Apps tab if you use a connector).</li>
      <li>Select the downloaded file and confirm column mapping.</li>
      <li>If the importer prompts for "Service Item", leave blank for non-billable hours; map to your default if all entries are billable.</li>
      <li>Verify the totals match what's shown on <a href="/admin/timesheets">/admin/timesheets</a> before approving payroll.</li>
    </ol>
    <p class="muted">
      Phase 2 will replace this manual CSV step with direct QBO TimeActivity API
      sync. The pay-period concept stays the same; only the delivery mechanism
      changes.
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

  .mode { margin: 14px 0 6px; }

  .grid {
    display: grid; grid-template-columns: 1fr 1fr; gap: 14px;
    margin: 14px 0;
  }
  .field { display: flex; flex-direction: column; gap: 4px; margin: 14px 0; }
  .field.flex { gap: 8px; }
  .field label {
    font-size: 0.78rem; color: var(--text-muted);
    text-transform: uppercase; letter-spacing: 0.04em;
  }
  .field input, .field select {
    background: var(--input-bg, var(--surface));
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 8px 10px; font: inherit;
  }
  .check { display: flex; gap: 8px; align-items: center; font-size: 0.92rem; text-transform: none; letter-spacing: 0; color: var(--text); }
  .check input { margin: 0; }

  .period-summary {
    background: rgba(255,255,255,0.03);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 12px 14px; margin: 12px 0;
  }
  .period-summary .row {
    display: flex; gap: 12px; padding: 4px 0;
    border-bottom: 1px solid rgba(255,255,255,0.04);
    font-size: 0.92rem;
  }
  .period-summary .row:last-child { border-bottom: none; }
  .period-summary .lbl { width: 90px; color: var(--text-muted); text-transform: uppercase; font-size: 0.74rem; letter-spacing: 0.04em; }
  .period-summary .val { color: var(--text); }

  .status-open     { color: var(--green, #28a745); font-weight: 600; }
  .status-closed   { color: var(--text); font-weight: 600; }
  .status-exported { color: var(--text-dim); font-style: italic; }

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
