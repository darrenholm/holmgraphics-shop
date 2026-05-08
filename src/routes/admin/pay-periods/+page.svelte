<!-- src/routes/admin/pay-periods/+page.svelte
     Admin view of all pay periods. Shows status, dates, entry counts, and
     when/by whom each was exported. "Generate next periods" extends the
     calendar forward when the seeded windows run out. Admin-gated. -->
<script>
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { auth, isAdmin } from '$lib/stores/auth.js';
  import { api } from '$lib/api/client.js';

  let periods = [];
  let loading = true;
  let busy = false;
  let error = '';
  let message = '';
  let extendCount = 4;

  onMount(async () => {
    if (!$auth || !$isAdmin) { goto('/login?return=/admin/pay-periods'); return; }
    await load();
  });

  async function load() {
    loading = true; error = '';
    try {
      const res = await api.payPeriodsList();
      periods = res.periods || [];
    } catch (e) {
      error = e.message || String(e);
    } finally {
      loading = false;
    }
  }

  async function extend() {
    busy = true; error = ''; message = '';
    try {
      const res = await api.payPeriodExtend(extendCount);
      message = res.created_count > 0
        ? `Generated ${res.created_count} new period${res.created_count === 1 ? '' : 's'}.`
        : `No new periods needed — calendar already extends ${extendCount} period${extendCount === 1 ? '' : 's'} ahead.`;
      await load();
    } catch (e) {
      error = e.message || String(e);
    } finally {
      busy = false;
    }
  }

  async function closePeriod(id) {
    if (!confirm('Close this pay period? No further edits to its entries should be made after this.')) return;
    busy = true; error = ''; message = '';
    try {
      await api.payPeriodClose(id);
      message = `Period ${id} closed.`;
      await load();
    } catch (e) {
      error = e.message || String(e);
    } finally {
      busy = false;
    }
  }

  // Send-to-QuickBooks state. The result modal lives at the bottom of
  // the page and renders synced/skipped/errors after a sync run.
  let syncBusy = null;       // pay_period_id currently syncing, or null
  let syncResult = null;     // { period, synced, skipped_no_mapping, skipped_already_synced, errors[] }

  async function sendToQbo(p) {
    const label = `${fmtDate(p.start_date)} – ${fmtDate(p.end_date)}`;
    if (!confirm(
      `Send pay period ${p.id} (${label}) to QuickBooks?\n\n` +
      `This pushes each entry to QBO TimeActivity. Already-synced entries are ` +
      `skipped automatically — safe to retry if anything fails.`
    )) return;
    syncBusy = p.id; error = ''; message = '';
    try {
      const result = await api.qboSyncTimePeriod(p.id);
      syncResult = { period: p, ...result };
      const counts = [];
      if (result.synced) counts.push(`${result.synced} synced`);
      if (result.skipped_already_synced) counts.push(`${result.skipped_already_synced} already synced`);
      if (result.skipped_no_mapping) counts.push(`${result.skipped_no_mapping} unmapped employee`);
      if (result.errors?.length) counts.push(`${result.errors.length} error${result.errors.length === 1 ? '' : 's'}`);
      message = `Period ${p.id}: ${counts.join(', ') || 'nothing to do'}.`;
      await load();
    } catch (e) {
      error = e.message || String(e);
    } finally {
      syncBusy = null;
    }
  }

  async function reopenPeriod(id) {
    if (!confirm('Reopen this pay period? This clears the exported flag — use only for recovery from a bad export. QBO/payroll on the receiving side is not undone.')) return;
    busy = true; error = ''; message = '';
    try {
      await api.payPeriodReopen(id);
      message = `Period ${id} reopened.`;
      await load();
    } catch (e) {
      error = e.message || String(e);
    } finally {
      busy = false;
    }
  }

  // PG DATE columns get serialized as full ISO datetime strings
  // ("2026-04-30T00:00:00.000Z"), which `new Date()` parses as UTC —
  // leaving the display one day earlier in any timezone west of UTC.
  // Slice the date part and construct a local Date to avoid the shift.
  function dateOnly(s) { return (s || '').slice(0, 10); }
  function localDate(s) {
    const [y, m, d] = dateOnly(s).split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  function fmtDate(iso) {
    if (!iso) return '—';
    return localDate(iso).toLocaleDateString('en-CA', {
      weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
    });
  }
  function fmtDateTime(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('en-CA');
  }
  function isCurrent(p) {
    const today = new Date().toISOString().slice(0, 10);
    return dateOnly(p.start_date) <= today && dateOnly(p.end_date) >= today;
  }
</script>

<svelte:head><title>Pay Periods — Holm Graphics Admin</title></svelte:head>

<div class="page">
  <h1 class="page-title">Pay Periods</h1>

  <div class="card actions-bar">
    <p class="muted" style="margin: 0; flex: 1;">
      14-day pay periods, Thursday-to-Wednesday, with payday on the following Monday.
      Anchor: Apr 30, 2026.
    </p>
    <div class="extend-form">
      <input type="number" min="1" max="26" bind:value={extendCount} title="How many future periods to add" />
      <button class="btn primary" on:click={extend} disabled={busy}>
        {busy ? '…' : 'Generate next'}
      </button>
    </div>
  </div>

  {#if message}<div class="notice ok">{message}</div>{/if}
  {#if error}<div class="notice error">{error}</div>{/if}

  {#if loading}
    <div class="muted">Loading…</div>
  {:else if periods.length === 0}
    <div class="muted">No pay periods exist yet — something is wrong with migration 017.</div>
  {:else}
    <table class="periods">
      <thead>
        <tr>
          <th>#</th>
          <th>Start (Thu)</th>
          <th>End (Wed)</th>
          <th>Pay (Mon)</th>
          <th>Status</th>
          <th>Entries</th>
          <th>Exported</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {#each periods as p (p.id)}
          <tr class:current={isCurrent(p)}>
            <td>{p.id}{#if isCurrent(p)} <span class="now">now</span>{/if}</td>
            <td>{fmtDate(p.start_date)}</td>
            <td>{fmtDate(p.end_date)}</td>
            <td>{fmtDate(p.pay_date)}</td>
            <td><span class="status status-{p.status}">{p.status}</span></td>
            <td class="counts">
              {p.entry_count}
              <span class="sub">({p.open_count} open, {p.closed_count} closed, {p.approved_count} approved, {p.exported_count_actual} exported)</span>
            </td>
            <td class="exp">
              {#if p.exported_at}
                <div>{fmtDateTime(p.exported_at)}</div>
                {#if p.exported_by_name}<div class="sub">by {p.exported_by_name}</div>{/if}
                {#if p.csv_filename}<div class="sub mono">{p.csv_filename}</div>{/if}
              {:else}
                —
              {/if}
            </td>
            <td class="actions-cell">
              {#if p.status === 'open'}
                <button class="btn small ghost" on:click={() => closePeriod(p.id)}>Close</button>
              {:else if p.status === 'closed' || p.status === 'exported'}
                <button class="btn small ghost" on:click={() => reopenPeriod(p.id)}>Reopen</button>
              {/if}
              {#if p.entry_count > 0}
                <button class="btn small primary"
                        disabled={syncBusy === p.id}
                        title="Push this period's entries to QBO TimeActivity"
                        on:click={() => sendToQbo(p)}>
                  {syncBusy === p.id ? 'Sending…' : 'Send to QuickBooks'}
                </button>
              {/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</div>


{#if syncResult}
  <div class="modal-backdrop" on:click|self={() => (syncResult = null)}>
    <div class="modal" role="dialog" aria-modal="true" aria-label="QuickBooks sync result">
      <div class="modal-head">
        <h2>QuickBooks sync</h2>
        <button class="modal-close" on:click={() => (syncResult = null)} aria-label="Close">×</button>
      </div>
      <div class="modal-body">
        <p class="muted" style="margin-top:0;">
          Period {syncResult.period.id}:
          {fmtDate(syncResult.period.start_date)} – {fmtDate(syncResult.period.end_date)}
        </p>

        <ul class="result-counts">
          <li><strong>{syncResult.synced}</strong> entries synced to QBO</li>
          {#if syncResult.skipped_already_synced > 0}
            <li><strong>{syncResult.skipped_already_synced}</strong> already-synced (skipped)</li>
          {/if}
          {#if syncResult.skipped_no_mapping > 0}
            <li class="warn"><strong>{syncResult.skipped_no_mapping}</strong> unmapped employee — fix at <a href="/admin/qbo-employees">/admin/qbo-employees</a></li>
          {/if}
          {#if syncResult.errors?.length > 0}
            <li class="err"><strong>{syncResult.errors.length}</strong> error{syncResult.errors.length === 1 ? '' : 's'}</li>
          {/if}
        </ul>

        {#if syncResult.errors?.length > 0}
          <h3 class="errors-heading">Errors</h3>
          <ul class="errors-list">
            {#each syncResult.errors as err}
              <li>
                <strong>{err.employee_name || 'Unknown'}</strong>
                <span class="muted">(entry #{err.entry_id})</span>:
                <span class="err-msg">{err.message}</span>
                {#if err.qbCode}<span class="muted"> [QBO {err.qbCode}]</span>{/if}
              </li>
            {/each}
          </ul>
          <p class="muted">Fix the listed issues, then click <em>Send to QuickBooks</em> again — already-synced entries will be skipped.</p>
        {/if}
      </div>
      <div class="modal-foot">
        <button class="btn primary" on:click={() => (syncResult = null)}>Close</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .page { padding: 24px; max-width: 1300px; margin: 0 auto; }
  .page-title {
    font-family: var(--font-display); font-size: 1.6rem;
    letter-spacing: 0.04em; text-transform: uppercase;
    margin: 0 0 18px;
  }
  .card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    padding: 14px 18px;
    margin-bottom: 14px;
  }
  .actions-bar { display: flex; align-items: center; gap: 16px; }
  .extend-form { display: flex; gap: 6px; align-items: center; }
  .extend-form input {
    background: var(--input-bg, var(--surface));
    color: var(--text); border: 1px solid var(--border);
    border-radius: var(--radius); padding: 6px 8px; width: 60px;
    font: inherit;
  }
  .muted { color: var(--text-muted); font-size: 0.92rem; }

  .periods { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
  .periods th, .periods td { padding: 9px 10px; text-align: left; vertical-align: top; }
  .periods th {
    color: var(--text-muted); font-weight: 600;
    font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.04em;
    border-bottom: 1px solid var(--border);
  }
  .periods tbody tr { border-bottom: 1px solid rgba(255,255,255,0.05); }
  .periods tr.current { background: rgba(40,167,69,0.06); }
  .periods .now {
    background: var(--green, #28a745); color: white;
    padding: 1px 6px; border-radius: 999px; font-size: 0.65rem;
    text-transform: uppercase; letter-spacing: 0.04em; margin-left: 4px;
  }
  .periods .counts .sub,
  .periods .exp .sub {
    display: block; color: var(--text-muted); font-size: 0.78rem; margin-top: 2px;
  }
  .periods .mono { font-family: ui-monospace, "Cascadia Code", monospace; }

  .status {
    padding: 2px 8px; border-radius: 999px; font-size: 0.78rem;
    text-transform: uppercase; letter-spacing: 0.04em; font-weight: 600;
  }
  .status-open     { background: rgba(40,167,69,0.18);  color: var(--green, #28a745); }
  .status-closed   { background: rgba(255,255,255,0.08); color: var(--text); }
  .status-exported { background: rgba(0,123,255,0.18);  color: #4ea0ff; }

  .actions-cell { white-space: nowrap; }
  .btn {
    padding: 6px 12px; border-radius: var(--radius);
    border: 1px solid var(--border); background: var(--surface);
    color: var(--text); cursor: pointer; font: inherit;
  }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn.primary { background: var(--accent, #c0392b); color: white; border-color: transparent; }
  .btn.primary:hover:not(:disabled) { filter: brightness(1.1); }
  .btn.ghost { background: transparent; }
  .btn.small { padding: 3px 9px; font-size: 0.85rem; }

  .notice { padding: 10px 12px; border-radius: var(--radius); margin: 8px 0; font-size: 0.92rem; }
  .notice.ok    { background: rgba(40,167,69,0.12); color: var(--green, #28a745); border: 1px solid rgba(40,167,69,0.3); }
  .notice.error { background: rgba(220,53,69,0.12); color: var(--red,   #dc3545); border: 1px solid rgba(220,53,69,0.3); }

  /* ─── Send-to-QuickBooks result modal ─────────────────────────────── */
  .modal-backdrop {
    position: fixed; inset: 0;
    background: rgba(0,0,0,0.55);
    display: flex; align-items: flex-start; justify-content: center;
    padding: 6vh 1rem; z-index: 1000;
  }
  .modal {
    background: var(--surface);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    width: 100%; max-width: 560px;
    box-shadow: 0 20px 50px rgba(0,0,0,0.5);
    display: flex; flex-direction: column;
    max-height: 88vh;
  }
  .modal-head {
    display: flex; align-items: center; justify-content: space-between;
    padding: 14px 18px; border-bottom: 1px solid var(--border);
  }
  .modal-head h2 {
    margin: 0;
    font-family: var(--font-display);
    font-size: 1.1rem;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  .modal-close {
    background: none; border: 0; color: var(--text-muted);
    font-size: 1.6rem; line-height: 1; cursor: pointer; padding: 0 4px;
  }
  .modal-body {
    padding: 14px 18px;
    overflow-y: auto;
  }
  .modal-foot {
    display: flex; justify-content: flex-end; gap: 8px;
    padding: 12px 18px; border-top: 1px solid var(--border);
  }

  .result-counts { list-style: none; padding: 0; margin: 6px 0 14px; }
  .result-counts li { padding: 4px 0; }
  .result-counts li.warn { color: #d39e00; }
  .result-counts li.err  { color: var(--red, #dc3545); }

  .errors-heading {
    font-family: var(--font-display);
    font-size: 0.95rem; letter-spacing: 0.04em; text-transform: uppercase;
    margin: 14px 0 6px;
  }
  .errors-list { padding-left: 1.1em; margin: 0 0 12px; }
  .errors-list li { padding: 4px 0; font-size: 0.92rem; }
  .err-msg { color: var(--red, #dc3545); }
</style>
