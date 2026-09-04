<!-- src/routes/admin/ap/+page.svelte
     Accounts-payable review queue. Supplier invoices and statements land
     here from email or upload, get read by Claude, and wait for a human
     before anything reaches QuickBooks.

     Staff-gated for review; the Post to QuickBooks button on the detail
     page is admin-only (enforced by the API, not just hidden here). -->
<script>
  import { onMount, onDestroy } from 'svelte';
  import { goto } from '$app/navigation';
  import { auth } from '$lib/stores/auth.js';
  import { api } from '$lib/api/client.js';

  let documents = [];
  let statements = [];
  let loading = true;
  let error = '';
  let message = '';

  let tab = 'needs_review';   // needs_review | approved | posted | statements
  let uploading = false;
  let fileInput;

  // Extraction runs in the background, so a freshly uploaded row shows as
  // "reading…" until the model comes back. Poll only while something is
  // actually pending — an idle queue makes no requests.
  let pollTimer = null;
  $: anyPending = documents.some((d) => d.extract_status === 'pending');

  onMount(async () => {
    if (!$auth) { goto('/login?next=/admin/ap'); return; }
    await load();
  });

  onDestroy(() => { if (pollTimer) clearInterval(pollTimer); });

  $: {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    if (anyPending && typeof window !== 'undefined') {
      pollTimer = setInterval(() => load({ quiet: true }), 5000);
    }
  }

  async function load({ quiet = false } = {}) {
    if (!quiet) { loading = true; error = ''; }
    try {
      if (tab === 'statements') {
        const res = await api.apStatements();
        statements = res.statements || [];
      } else {
        const params = tab === 'posted'
          ? { posted: 'true' }
          : { review_status: tab, posted: 'false' };
        const res = await api.apDocuments({ ...params, limit: 200 });
        documents = res.documents || [];
      }
    } catch (e) {
      error = e.message || String(e);
    } finally {
      loading = false;
    }
  }

  async function switchTab(next) {
    tab = next;
    message = '';
    await load();
  }

  async function onFiles(event) {
    const files = Array.from(event.target.files || []);
    if (files.length === 0) return;

    uploading = true; error = ''; message = '';
    try {
      const fd = new FormData();
      for (const f of files) fd.append('files', f);
      const res = await api.apUpload(fd);

      const ok   = (res.documents || []).filter((d) => !d.error && !d.duplicate).length;
      const dupe = (res.documents || []).filter((d) => d.duplicate).length;
      const bad  = (res.documents || []).filter((d) => d.error);

      const parts = [];
      if (ok)   parts.push(`${ok} uploaded, reading now`);
      // A duplicate is the dedupe working, not a failure — the same PDF
      // forwarded twice is one bill.
      if (dupe) parts.push(`${dupe} already on file`);
      if (bad.length) parts.push(`${bad.length} rejected: ${bad.map((b) => b.error).join('; ')}`);
      message = parts.join(' · ');

      if (tab !== 'needs_review') { tab = 'needs_review'; }
      await load();
    } catch (e) {
      error = e.message || String(e);
    } finally {
      uploading = false;
      if (fileInput) fileInput.value = '';
    }
  }

  function money(cents) {
    if (cents === null || cents === undefined) return '—';
    return (cents / 100).toLocaleString('en-CA', { style: 'currency', currency: 'CAD' });
  }

  function shortDate(value) {
    if (!value) return '—';
    return String(value).slice(0, 10);
  }

  // What the row is waiting on, in the order a reviewer cares about.
  function rowState(d) {
    if (d.extract_status === 'pending') return { label: 'Reading…',   cls: 'pending' };
    if (d.extract_status === 'failed')  return { label: 'Read failed', cls: 'failed' };
    if (!d.vendor_qbo_id)               return { label: 'No vendor',   cls: 'warn' };
    if (d.post_error)                   return { label: 'Check',       cls: 'warn' };
    if (d.posted_at)                    return { label: 'Posted',      cls: 'ok' };
    if (d.review_status === 'approved') return { label: 'Ready',       cls: 'ok' };
    return { label: 'Review', cls: 'neutral' };
  }

  function summaryChip(summary) {
    if (!summary) return null;
    const missing = summary.missing || 0;
    const mismatch = summary.amount_mismatch || 0;
    if (missing || mismatch) {
      return { label: `${missing} missing · ${mismatch} off`, cls: 'failed' };
    }
    return { label: 'Clean', cls: 'ok' };
  }
</script>

<svelte:head><title>Accounts Payable · Holm Graphics</title></svelte:head>

<div class="page">
  <div class="head">
    <h1 class="page-title">Accounts Payable</h1>
    <div class="head-actions">
      <input
        type="file" multiple accept="application/pdf,image/jpeg,image/png"
        bind:this={fileInput} on:change={onFiles} id="ap-files" hidden
      />
      <label class="btn primary" for="ap-files" class:disabled={uploading}>
        {uploading ? 'Uploading…' : 'Upload bills'}
      </label>
    </div>
  </div>

  <p class="muted intro">
    Drop supplier invoices and month-end statements here. Each one is read
    automatically, then waits for you to check it before anything is written
    to QuickBooks.
  </p>

  {#if error}<div class="notice error">{error}</div>{/if}
  {#if message}<div class="notice ok">{message}</div>{/if}

  <div class="tabs">
    <button class="tab" class:active={tab === 'needs_review'} on:click={() => switchTab('needs_review')}>Needs review</button>
    <button class="tab" class:active={tab === 'approved'}     on:click={() => switchTab('approved')}>Ready to post</button>
    <button class="tab" class:active={tab === 'posted'}       on:click={() => switchTab('posted')}>Posted</button>
    <button class="tab" class:active={tab === 'statements'}   on:click={() => switchTab('statements')}>Statements</button>
  </div>

  {#if loading}
    <div class="card"><p class="muted">Loading…</p></div>

  {:else if tab === 'statements'}
    {#if statements.length === 0}
      <div class="card">
        <p class="muted">
          No statements yet. Upload a supplier's month-end statement and it
          will be read the same way an invoice is — then you can reconcile it
          against what's actually in the books.
        </p>
      </div>
    {:else}
      <div class="card no-pad">
        <table class="grid">
          <thead>
            <tr><th>Vendor</th><th>Statement date</th><th class="num">Closing balance</th><th>Reconciled</th><th>Result</th></tr>
          </thead>
          <tbody>
            {#each statements as s (s.id)}
              {@const chip = summaryChip(s.summary)}
              <tr class="clickable" on:click={() => goto(`/admin/ap/statements/${s.id}`)}>
                <td>
                  <div class="strong">{s.vendor_name || 'Unknown vendor'}</div>
                  {#if !s.vendor_qbo_id}<div class="sub warn-text">No QuickBooks vendor assigned</div>{/if}
                </td>
                <td>{shortDate(s.statement_date)}</td>
                <td class="num">{money(s.closing_balance_cents)}</td>
                <td>{s.reconciled_at ? shortDate(s.reconciled_at) : '—'}</td>
                <td>{#if chip}<span class="state {chip.cls}">{chip.label}</span>{:else}<span class="muted">—</span>{/if}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}

  {:else if documents.length === 0}
    <div class="card">
      <p class="muted">
        {#if tab === 'needs_review'}Nothing waiting. Upload a bill to get started.
        {:else if tab === 'approved'}Nothing approved and waiting to post.
        {:else}Nothing posted yet.{/if}
      </p>
    </div>

  {:else}
    <div class="card no-pad">
      <table class="grid">
        <thead>
          <tr>
            <th>Vendor</th><th>Number</th><th>Date</th>
            <th class="num">Total</th><th>Kind</th><th>Status</th>
          </tr>
        </thead>
        <tbody>
          {#each documents as d (d.id)}
            {@const state = rowState(d)}
            <tr class="clickable" on:click={() => goto(`/admin/ap/${d.id}`)}>
              <td>
                <div class="strong">{d.vendor_name || d.original_filename || `Document ${d.id}`}</div>
                {#if d.extract_confidence === 'low'}
                  <div class="sub warn-text">Hard to read — check every field</div>
                {:else if d.extract_error}
                  <div class="sub warn-text">{d.extract_error}</div>
                {:else if d.post_error}
                  <div class="sub warn-text">{d.post_error}</div>
                {/if}
              </td>
              <td>{d.doc_number || '—'}</td>
              <td>{shortDate(d.txn_date)}</td>
              <td class="num">{money(d.total_cents)}</td>
              <td class="kind">{d.doc_kind === 'unknown' ? '—' : d.doc_kind.replace('_', ' ')}</td>
              <td><span class="state {state.cls}">{state.label}</span></td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>

<style>
  .page { padding: 24px; max-width: 1100px; margin: 0 auto; }
  .head { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
  .page-title {
    font-family: var(--font-display); font-size: 1.6rem;
    letter-spacing: 0.04em; text-transform: uppercase; margin: 0;
  }
  .intro { margin: 6px 0 16px; max-width: 62ch; }

  .card {
    background: var(--surface); border: 1px solid var(--border);
    border-radius: var(--radius-lg); padding: 16px 18px; margin-bottom: 14px;
  }
  .card.no-pad { padding: 0; overflow: hidden; }
  .card p { margin: 0; }
  .muted { color: var(--text-muted); font-size: 0.92rem; }

  .notice { padding: 10px 12px; border-radius: var(--radius); margin: 8px 0; font-size: 0.92rem; }
  .notice.ok    { background: rgba(40,167,69,0.12); color: var(--green, #28a745); border: 1px solid rgba(40,167,69,0.3); }
  .notice.error { background: rgba(220,53,69,0.12); color: var(--red, #dc3545); border: 1px solid rgba(220,53,69,0.3); }

  .tabs { display: flex; gap: 6px; margin: 4px 0 14px; flex-wrap: wrap; }
  .tab {
    padding: 7px 14px; border-radius: 999px; font: inherit; cursor: pointer;
    background: transparent; color: var(--text-muted);
    border: 1px solid var(--border);
  }
  .tab.active { background: var(--surface); color: var(--text); border-color: var(--text-muted); }

  .grid { width: 100%; border-collapse: collapse; }
  .grid th, .grid td {
    padding: 10px 14px; text-align: left; vertical-align: top;
    border-bottom: 1px solid rgba(255,255,255,0.05);
  }
  .grid th {
    color: var(--text-muted); font-weight: 600; font-size: 0.72rem;
    text-transform: uppercase; letter-spacing: 0.04em;
    border-bottom: 1px solid var(--border);
  }
  .grid td.num, .grid th.num { text-align: right; font-variant-numeric: tabular-nums; }
  .grid tr.clickable { cursor: pointer; }
  .grid tr.clickable:hover { background: rgba(255,255,255,0.03); }
  .strong { font-weight: 600; }
  .sub { color: var(--text-muted); font-size: 0.82rem; margin-top: 2px; }
  .warn-text { color: var(--amber, #e0a458); }
  .kind { text-transform: capitalize; color: var(--text-muted); }

  .state {
    padding: 2px 8px; border-radius: 999px; font-size: 0.78rem;
    text-transform: uppercase; letter-spacing: 0.04em; font-weight: 600;
    white-space: nowrap;
  }
  .state.ok      { background: rgba(40,167,69,0.18);  color: var(--green, #28a745); }
  .state.warn    { background: rgba(224,164,88,0.18); color: var(--amber, #e0a458); }
  .state.failed  { background: rgba(220,53,69,0.18);  color: var(--red, #dc3545); }
  .state.pending { background: rgba(255,255,255,0.08); color: var(--text-muted); }
  .state.neutral { background: rgba(255,255,255,0.08); color: var(--text-muted); }

  .btn {
    padding: 8px 14px; border-radius: var(--radius);
    border: 1px solid var(--border); background: var(--surface);
    color: var(--text); cursor: pointer; font: inherit; display: inline-block;
  }
  .btn.primary { background: var(--accent, #c0392b); color: white; border-color: transparent; }
  .btn.primary:hover { filter: brightness(1.1); }
  .btn.disabled { opacity: 0.5; pointer-events: none; }
</style>
