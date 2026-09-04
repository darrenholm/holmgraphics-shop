<!-- src/routes/admin/ap/statements/[id]/+page.svelte
     Supplier statement reconciliation — the thing QuickBooks cannot do.

     Diffs the supplier's month-end statement against what is actually on
     the books and sorts the answer by how much it should worry you:
     missing first, then amounts that disagree, then everything fine. -->
<script>
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { auth } from '$lib/stores/auth.js';
  import { api } from '$lib/api/client.js';

  $: id = $page.params.id;

  let statement = null;
  let lines = [];
  let extras = [];
  let loading = true;
  let reconciling = false;
  let error = '';
  let message = '';

  // Missing money is the reason this screen exists, so it sorts to the top.
  const ORDER = { missing: 0, amount_mismatch: 1, unposted: 2, matched: 3, ignored: 4 };

  const LABEL = {
    missing:         'Missing',
    amount_mismatch: 'Amount differs',
    unposted:        'Not yet posted',
    matched:         'Matched',
    ignored:         'Payment',
  };

  const CLS = {
    missing:         'bad',
    amount_mismatch: 'warn',
    unposted:        'info',
    matched:         'ok',
    ignored:         'neutral',
  };

  onMount(async () => {
    if (!$auth) { goto(`/login?next=/admin/ap/statements/${id}`); return; }
    await load();
  });

  async function load() {
    loading = true; error = '';
    try {
      const res = await api.apStatement(id);
      statement = res.statement;
      lines = sortLines(res.lines || []);
      extras = statement?.summary?.extras || [];
    } catch (e) {
      error = e.message || String(e);
    } finally {
      loading = false;
    }
  }

  function sortLines(rows) {
    return [...rows].sort((a, b) => {
      const rank = (ORDER[a.match_status] ?? 9) - (ORDER[b.match_status] ?? 9);
      return rank !== 0 ? rank : (a.line_no - b.line_no);
    });
  }

  async function reconcile() {
    reconciling = true; error = ''; message = '';
    try {
      const res = await api.apReconcile(id);
      lines = sortLines(res.lines || []);
      extras = res.extras || [];
      const s = res.summary || {};
      message = (s.missing || s.amount_mismatch)
        ? `${s.missing || 0} missing, ${s.amount_mismatch || 0} with a different amount.`
        : 'Everything on this statement is accounted for.';
      await load();
    } catch (e) {
      error = e.message || String(e);
    } finally {
      reconciling = false;
    }
  }

  function money(cents) {
    if (cents === null || cents === undefined) return '—';
    return (cents / 100).toLocaleString('en-CA', { style: 'currency', currency: 'CAD' });
  }

  function shortDate(value) {
    return value ? String(value).slice(0, 10) : '—';
  }

  $: summary = statement?.summary || null;
  $: missingCents = lines
    .filter((l) => l.match_status === 'missing')
    .reduce((sum, l) => sum + (l.amount_cents || 0), 0);
</script>

<svelte:head><title>Statement reconciliation · Accounts Payable</title></svelte:head>

<div class="page">
  <a class="back" href="/admin/ap">← Back to the queue</a>

  {#if loading}
    <div class="card"><p class="muted">Loading…</p></div>
  {:else if !statement}
    <div class="card"><p class="muted">Not found.</p></div>
  {:else}

    <div class="head">
      <div>
        <h1 class="page-title">{statement.vendor_name || 'Statement'}</h1>
        <p class="muted">
          Statement dated {shortDate(statement.statement_date)} ·
          closing balance {money(statement.closing_balance_cents)}
          {#if statement.reconciled_at} · last checked {shortDate(statement.reconciled_at)}{/if}
        </p>
      </div>
      <button class="btn primary" on:click={reconcile} disabled={reconciling || !statement.vendor_qbo_id}>
        {reconciling ? 'Checking…' : statement.reconciled_at ? 'Check again' : 'Reconcile'}
      </button>
    </div>

    {#if error}<div class="notice error">{error}</div>{/if}
    {#if message}<div class="notice ok">{message}</div>{/if}

    {#if !statement.vendor_qbo_id}
      <div class="notice warn">
        This statement has no QuickBooks vendor assigned, so there is nothing
        to compare it against.
        <a href={`/admin/ap/${statement.document_id}`}>Assign one on the document</a>.
      </div>
    {/if}

    {#if summary}
      <div class="tiles">
        <div class="tile" class:alarm={summary.missing > 0}>
          <div class="tile-n">{summary.missing || 0}</div>
          <div class="tile-l">Missing</div>
          {#if missingCents}<div class="tile-s">{money(missingCents)}</div>{/if}
        </div>
        <div class="tile" class:caution={summary.amount_mismatch > 0}>
          <div class="tile-n">{summary.amount_mismatch || 0}</div>
          <div class="tile-l">Amount differs</div>
        </div>
        <div class="tile">
          <div class="tile-n">{summary.unposted || 0}</div>
          <div class="tile-l">Held, not posted</div>
        </div>
        <div class="tile">
          <div class="tile-n">{summary.matched || 0}</div>
          <div class="tile-l">Matched</div>
        </div>
      </div>

      {#if summary.closing_balance_agrees === false}
        <div class="notice warn">
          The lines we read add up to {money(summary.statement_charges_cents)}, but the
          statement's own closing balance is {money(summary.closing_balance_cents)}.
          A line was probably misread — check the statement itself before
          trusting anything below.
        </div>
      {/if}
    {:else}
      <div class="card">
        <p class="muted">Not reconciled yet. Press Reconcile to compare this statement against the books.</p>
      </div>
    {/if}

    {#if lines.length}
      <div class="card no-pad">
        <table class="grid">
          <thead>
            <tr>
              <th>Status</th><th>Number</th><th>Date</th>
              <th class="num">Statement</th><th class="num">Our books</th><th>Note</th>
            </tr>
          </thead>
          <tbody>
            {#each lines as l (l.id)}
              <tr class:dim={l.match_status === 'ignored' || l.match_status === 'matched'}>
                <td>
                  <span class="state {CLS[l.match_status] || 'neutral'}">
                    {LABEL[l.match_status] || l.match_status || 'unchecked'}
                  </span>
                </td>
                <td class="mono">{l.doc_number || '—'}</td>
                <td>{shortDate(l.txn_date)}</td>
                <td class="num">{money(l.amount_cents)}</td>
                <td class="num">
                  {#if l.match_status === 'unposted' && l.matched_document_id}
                    <a href={`/admin/ap/${l.matched_document_id}`}>{money(l.our_amount_cents)}</a>
                  {:else}
                    {money(l.our_amount_cents)}
                  {/if}
                </td>
                <td class="note">{l.note || ''}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}

    {#if extras.length}
      <div class="card">
        <h2 class="section">In our books, not on this statement</h2>
        <p class="sub">
          Usually a double entry on our side, though a supplier leaving one
          off their statement is not unusual either.
        </p>
        <table class="grid">
          <thead><tr><th>Number</th><th>Date</th><th class="num">Amount</th></tr></thead>
          <tbody>
            {#each extras as e (e.qbo_bill_id)}
              <tr>
                <td class="mono">{e.doc_number || '—'}</td>
                <td>{shortDate(e.txn_date)}</td>
                <td class="num">{money(e.amount_cents)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  {/if}
</div>

<style>
  .page { padding: 24px; max-width: 1150px; margin: 0 auto; }
  .back { color: var(--text-muted); text-decoration: none; font-size: 0.9rem; }
  .back:hover { color: var(--text); }

  .head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin: 10px 0 14px; flex-wrap: wrap; }
  .page-title {
    font-family: var(--font-display); font-size: 1.5rem;
    letter-spacing: 0.04em; text-transform: uppercase; margin: 0 0 4px;
  }
  .muted { color: var(--text-muted); font-size: 0.9rem; margin: 0; }
  .sub { color: var(--text-muted); font-size: 0.85rem; margin: 0 0 10px; }

  .card {
    background: var(--surface); border: 1px solid var(--border);
    border-radius: var(--radius-lg); padding: 14px 16px; margin-bottom: 14px;
  }
  .card.no-pad { padding: 0; overflow: hidden; }
  .card p { margin: 0; }
  .section {
    font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.06em;
    color: var(--text-muted); margin: 0 0 6px; font-weight: 600;
  }

  .notice { padding: 10px 12px; border-radius: var(--radius); margin: 8px 0; font-size: 0.92rem; }
  .notice.ok    { background: rgba(40,167,69,0.12); color: var(--green, #28a745); border: 1px solid rgba(40,167,69,0.3); }
  .notice.error { background: rgba(220,53,69,0.12); color: var(--red, #dc3545); border: 1px solid rgba(220,53,69,0.3); }
  .notice.warn  { background: rgba(224,164,88,0.12); color: var(--amber, #e0a458); border: 1px solid rgba(224,164,88,0.3); }
  .notice a { color: inherit; }

  .tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin-bottom: 14px; }
  .tile {
    background: var(--surface); border: 1px solid var(--border);
    border-radius: var(--radius-lg); padding: 14px 16px;
  }
  .tile.alarm   { border-color: rgba(220,53,69,0.5);  background: rgba(220,53,69,0.08); }
  .tile.caution { border-color: rgba(224,164,88,0.5); background: rgba(224,164,88,0.08); }
  .tile-n { font-size: 1.8rem; font-weight: 700; line-height: 1; font-variant-numeric: tabular-nums; }
  .tile-l { color: var(--text-muted); font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.04em; margin-top: 5px; }
  .tile-s { color: var(--text-muted); font-size: 0.85rem; margin-top: 3px; font-variant-numeric: tabular-nums; }

  .grid { width: 100%; border-collapse: collapse; }
  .grid th, .grid td {
    padding: 9px 14px; text-align: left; vertical-align: top;
    border-bottom: 1px solid rgba(255,255,255,0.05);
  }
  .grid th {
    color: var(--text-muted); font-weight: 600; font-size: 0.72rem;
    text-transform: uppercase; letter-spacing: 0.04em;
    border-bottom: 1px solid var(--border);
  }
  .grid td.num, .grid th.num { text-align: right; font-variant-numeric: tabular-nums; }
  .grid tr.dim { opacity: 0.6; }
  .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.88rem; }
  .note { color: var(--text-muted); font-size: 0.85rem; }

  .state {
    padding: 2px 8px; border-radius: 999px; font-size: 0.75rem;
    text-transform: uppercase; letter-spacing: 0.04em; font-weight: 600;
    white-space: nowrap;
  }
  .state.ok      { background: rgba(40,167,69,0.18);  color: var(--green, #28a745); }
  .state.warn    { background: rgba(224,164,88,0.18); color: var(--amber, #e0a458); }
  .state.bad     { background: rgba(220,53,69,0.2);   color: var(--red, #dc3545); }
  .state.info    { background: rgba(90,150,220,0.18); color: #7fb0e8; }
  .state.neutral { background: rgba(255,255,255,0.08); color: var(--text-muted); }

  .btn {
    padding: 8px 14px; border-radius: var(--radius);
    border: 1px solid var(--border); background: var(--surface);
    color: var(--text); cursor: pointer; font: inherit; white-space: nowrap;
  }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn.primary { background: var(--accent, #c0392b); color: white; border-color: transparent; }
  .btn.primary:hover:not(:disabled) { filter: brightness(1.1); }
</style>
