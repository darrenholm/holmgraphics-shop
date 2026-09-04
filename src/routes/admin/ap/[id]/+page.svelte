<!-- src/routes/admin/ap/[id]/+page.svelte
     Review one supplier document: the PDF on the left, what was read out of
     it on the right, editable. Nothing here touches QuickBooks until
     someone approves and posts.

     Money is edited in dollars and stored in cents; the conversion happens
     at save time in centsFrom()/dollarsFrom() so no float ever round-trips
     through the form. -->
<script>
  import { onMount, onDestroy } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { auth, isAdmin } from '$lib/stores/auth.js';
  import { api, apDocumentFileUrl } from '$lib/api/client.js';
  import AccountPicker from '$lib/components/AccountPicker.svelte';

  $: id = $page.params.id;

  let doc = null;
  let lines = [];
  let statement = null;
  let loading = true;
  let error = '';
  let message = '';
  let busy = '';           // name of the action in flight

  let fileUrl = '';
  let fileError = '';

  // Vendor picker
  let vendorQuery = '';
  let vendorResults = [];
  let vendorSearching = false;
  let vendorSearchError = '';

  // Expense accounts for coding lines. Loaded once; a failure here is not
  // fatal, it just means the dropdown falls back to showing the stored value.
  let accounts = [];
  let accountsError = '';

  onMount(async () => {
    if (!$auth) { goto(`/login?next=/admin/ap/${id}`); return; }
    await load();
    await loadFile();
    try {
      const res = await api.apAccounts();
      accounts = res.accounts || [];
    } catch (e) {
      accountsError = e.message || String(e);
    }
  });

  // Applies whatever the first coded line uses to every other line. Most
  // invoices are one account end to end — a freight bill is all Shipping —
  // and coding six lines by hand to say the same thing is just friction.
  function applyAccountToAll() {
    const first = lines.find((l) => l.account_qbo_id);
    if (!first) return;
    lines = lines.map((l) => ({
      ...l,
      account_qbo_id: first.account_qbo_id,
      account_name:   first.account_name,
    }));
  }

  onDestroy(() => { if (fileUrl) URL.revokeObjectURL(fileUrl); });

  async function load() {
    loading = true; error = '';
    try {
      const res = await api.apDocument(id);
      doc = res.document;
      statement = res.statement;
      // Lines are edited as dollar strings so a half-typed "12." doesn't
      // become NaN mid-keystroke.
      lines = (res.lines || []).map((l) => ({
        ...l,
        amount_dollars: l.amount_cents === null ? '' : (l.amount_cents / 100).toFixed(2),
        taxable: !!l.tax_code,
      }));
      vendorQuery = doc.vendor_name || '';
    } catch (e) {
      error = e.message || String(e);
    } finally {
      loading = false;
    }
  }

  async function loadFile() {
    fileError = '';
    try {
      fileUrl = await apDocumentFileUrl(id);
    } catch (e) {
      fileError = e.message || String(e);
    }
  }

  // ─── Money helpers ─────────────────────────────────────────────────────
  function centsFrom(dollarString) {
    const s = String(dollarString ?? '').trim();
    if (!s) return null;
    const cleaned = s.replace(/[$,\s]/g, '');
    if (!/^-?\d*\.?\d*$/.test(cleaned) || !/\d/.test(cleaned)) return null;
    const negative = cleaned.startsWith('-');
    const [whole, frac = ''] = cleaned.replace(/^-/, '').split('.');
    const cents = Number(whole || '0') * 100 + Number((frac + '00').slice(0, 2));
    return negative ? -cents : cents;
  }

  function dollarsFrom(cents) {
    if (cents === null || cents === undefined) return '';
    return (cents / 100).toFixed(2);
  }

  function money(cents) {
    if (cents === null || cents === undefined) return '—';
    return (cents / 100).toLocaleString('en-CA', { style: 'currency', currency: 'CAD' });
  }

  // ─── Arithmetic check ──────────────────────────────────────────────────
  // Lines + tax should reach the total printed on the document. When they
  // don't, something was misread — and posting it would put a bill in
  // QuickBooks that can never match the supplier's statement.
  $: lineTotal = lines.reduce((sum, l) => sum + (centsFrom(l.amount_dollars) ?? 0), 0);
  $: taxCents = doc ? centsFrom(taxField) : null;
  $: totalCents = doc ? centsFrom(totalField) : null;
  $: computed = lineTotal + (taxCents ?? 0);
  $: totalsAgree = totalCents === null || Math.abs(computed - totalCents) <= 1;

  // Header form fields, seeded from the document once it loads.
  let docKindField = '';
  let docNumberField = '';
  let txnDateField = '';
  let dueDateField = '';
  let termsField = '';
  let subtotalField = '';
  let taxField = '';
  let totalField = '';
  let memoField = '';
  let seededFor = null;

  $: if (doc && seededFor !== doc.id) {
    seededFor      = doc.id;
    docKindField   = doc.doc_kind || 'unknown';
    docNumberField = doc.doc_number || '';
    txnDateField   = doc.txn_date ? String(doc.txn_date).slice(0, 10) : '';
    dueDateField   = doc.due_date ? String(doc.due_date).slice(0, 10) : '';
    termsField     = doc.terms || '';
    subtotalField  = dollarsFrom(doc.subtotal_cents);
    taxField       = dollarsFrom(doc.tax_cents);
    totalField     = dollarsFrom(doc.total_cents);
    memoField      = doc.memo || '';
  }

  // ─── Actions ───────────────────────────────────────────────────────────
  async function save() {
    busy = 'save'; error = ''; message = '';
    try {
      const res = await api.apUpdateDocument(id, {
        doc_kind:       docKindField,
        doc_number:     docNumberField,
        txn_date:       txnDateField || null,
        due_date:       dueDateField || null,
        terms:          termsField,
        subtotal_cents: centsFrom(subtotalField),
        tax_cents:      centsFrom(taxField),
        total_cents:    centsFrom(totalField),
        memo:           memoField,
        lines: lines.map((l) => ({
          description:    l.description,
          quantity:       l.quantity,
          unit_cents:     l.unit_cents,
          amount_cents:   centsFrom(l.amount_dollars) ?? 0,
          account_qbo_id: l.account_qbo_id,
          account_name:   l.account_name,
          tax_code:       l.taxable ? '7' : null,
        })),
      });
      doc = { ...doc, ...res.document };
      message = 'Saved.';
    } catch (e) {
      error = e.message || String(e);
    } finally {
      busy = '';
    }
  }

  async function searchVendors() {
    if (!vendorQuery.trim()) return;
    vendorSearching = true; vendorSearchError = ''; vendorResults = [];
    try {
      const res = await api.apVendorSearch(vendorQuery.trim());
      vendorResults = res.vendors || [];
      if (vendorResults.length === 0) {
        vendorSearchError = 'No matching vendor in QuickBooks. Create it there first — this screen deliberately will not.';
      }
    } catch (e) {
      vendorSearchError = e.message || String(e);
    } finally {
      vendorSearching = false;
    }
  }

  async function assignVendor(vendor) {
    busy = 'vendor'; error = ''; message = '';
    try {
      await api.apAssignVendor(id, {
        vendor_qbo_id: vendor.id,
        vendor_name:   vendor.name,
        learn:         true,
      });
      vendorResults = [];
      message = `Vendor set to ${vendor.name}. Future documents from this supplier will match on their own.`;
      await load();
    } catch (e) {
      error = e.message || String(e);
    } finally {
      busy = '';
    }
  }

  async function reExtract() {
    busy = 'extract'; error = ''; message = '';
    try {
      const res = await api.apExtract(id);
      message = res.ok ? 'Read again.' : `Could not read it: ${res.error}`;
      await load();
    } catch (e) {
      error = e.message || String(e);
    } finally {
      busy = '';
    }
  }

  async function approve() {
    busy = 'approve'; error = ''; message = '';
    try {
      await api.apApprove(id);
      message = 'Approved. Ready to post to QuickBooks.';
      await load();
    } catch (e) {
      error = e.message || String(e);
    } finally {
      busy = '';
    }
  }

  async function reject() {
    const reason = prompt('Why is this being rejected? (optional)');
    if (reason === null) return;
    busy = 'reject'; error = ''; message = '';
    try {
      await api.apReject(id, reason);
      goto('/admin/ap');
    } catch (e) {
      error = e.message || String(e);
      busy = '';
    }
  }

  async function postToQbo() {
    if (!confirm('Create this bill in QuickBooks? This is the step that puts it on the books.')) return;
    busy = 'post'; error = ''; message = '';
    try {
      const res = await api.apPost(id);
      message = res.created
        ? `Posted to QuickBooks as bill ${res.billId}.`
        : `Already in QuickBooks as bill ${res.billId} (${res.reason}).`;
      if (res.warning) message += ` Note: ${res.warning}`;
      await load();
    } catch (e) {
      error = e.message || String(e);
    } finally {
      busy = '';
    }
  }

  function addLine() {
    lines = [...lines, {
      line_no: lines.length + 1, description: '', quantity: null,
      unit_cents: null, amount_cents: 0, amount_dollars: '',
      account_qbo_id: null, account_name: null, taxable: true,
    }];
  }

  function removeLine(index) {
    lines = lines.filter((_, i) => i !== index);
  }

  $: locked = !!(doc && doc.posted_at);
</script>

<svelte:head><title>{doc?.vendor_name || 'Bill'} · Accounts Payable</title></svelte:head>

<div class="page">
  <a class="back" href="/admin/ap">← Back to the queue</a>

  {#if loading}
    <div class="card"><p class="muted">Loading…</p></div>
  {:else if !doc}
    <div class="card"><p class="muted">Not found.</p></div>
  {:else}

    <div class="head">
      <h1 class="page-title">{doc.vendor_name || doc.original_filename || `Document ${doc.id}`}</h1>
      <div class="badges">
        {#if doc.posted_at}<span class="state ok">Posted</span>
        {:else if doc.review_status === 'approved'}<span class="state ok">Approved</span>
        {:else}<span class="state neutral">{doc.review_status.replace('_', ' ')}</span>{/if}
        {#if doc.extract_confidence}
          <span class="state {doc.extract_confidence === 'low' ? 'warn' : 'neutral'}">
            Read confidence: {doc.extract_confidence}
          </span>
        {/if}
      </div>
    </div>

    {#if error}<div class="notice error">{error}</div>{/if}
    {#if message}<div class="notice ok">{message}</div>{/if}

    {#if doc.extract_status === 'failed'}
      <div class="notice error">
        Could not read this document: {doc.extract_error}
        <button class="btn small" on:click={reExtract} disabled={busy === 'extract'}>
          {busy === 'extract' ? 'Reading…' : 'Try again'}
        </button>
      </div>
    {/if}

    {#if doc.post_error}
      <div class="notice warn">{doc.post_error}</div>
    {/if}

    {#if locked}
      <div class="notice warn">
        This is already in QuickBooks. Edit it there — changing it here would
        leave the two disagreeing.
      </div>
    {/if}

    <div class="split">
      <!-- ─── The document itself ─────────────────────────────────── -->
      <div class="pane">
        {#if fileUrl}
          <object class="viewer" data={fileUrl} type={doc.mime_type || 'application/pdf'} title="Source document">
            <p class="muted">
              Your browser will not display this inline.
              <a href={fileUrl} target="_blank" rel="noopener">Open it in a new tab</a>.
            </p>
          </object>
        {:else if fileError}
          <div class="card"><p class="muted">{fileError}</p></div>
        {:else}
          <div class="card"><p class="muted">Loading the document…</p></div>
        {/if}
      </div>

      <!-- ─── What was read out of it ─────────────────────────────── -->
      <div class="pane">
        <div class="card">
          <h2 class="section">Vendor</h2>
          {#if doc.vendor_qbo_id}
            <p class="strong">{doc.vendor_name}</p>
            <p class="sub">Linked to QuickBooks vendor {doc.vendor_qbo_id}</p>
          {:else}
            <p class="sub warn-text">
              Not matched to a QuickBooks vendor yet. The document says
              “{doc.vendor_name || 'nothing readable'}”.
            </p>
          {/if}

          {#if !locked}
            <div class="vendor-search">
              <input
                type="text" bind:value={vendorQuery} placeholder="Search QuickBooks vendors…"
                on:keydown={(e) => e.key === 'Enter' && searchVendors()}
              />
              <button class="btn small" on:click={searchVendors} disabled={vendorSearching}>
                {vendorSearching ? 'Searching…' : 'Search'}
              </button>
            </div>
            {#if vendorSearchError}<p class="sub warn-text">{vendorSearchError}</p>{/if}
            {#if vendorResults.length}
              <ul class="vendor-list">
                {#each vendorResults as v (v.id)}
                  <li>
                    <span>{v.name}</span>
                    <button class="btn xs" on:click={() => assignVendor(v)} disabled={busy === 'vendor'}>Use this</button>
                  </li>
                {/each}
              </ul>
            {/if}
          {/if}
        </div>

        <div class="card">
          <h2 class="section">Details</h2>
          <div class="fields">
            <label>Kind
              <select bind:value={docKindField} disabled={locked}>
                <option value="invoice">Invoice</option>
                <option value="credit_note">Credit note</option>
                <option value="statement">Statement</option>
                <option value="unknown">Unknown</option>
              </select>
            </label>
            <label>Invoice number<input type="text" bind:value={docNumberField} disabled={locked} /></label>
            <label>Date<input type="date" bind:value={txnDateField} disabled={locked} /></label>
            <label>Due<input type="date" bind:value={dueDateField} disabled={locked} /></label>
            <label>Terms<input type="text" bind:value={termsField} placeholder="Net 30" disabled={locked} /></label>
            <label>Subtotal<input type="text" inputmode="decimal" bind:value={subtotalField} disabled={locked} /></label>
            <label>Tax (HST)<input type="text" inputmode="decimal" bind:value={taxField} disabled={locked} /></label>
            <label>Total<input type="text" inputmode="decimal" bind:value={totalField} disabled={locked} /></label>
          </div>
          <label class="wide">Memo<input type="text" bind:value={memoField} disabled={locked} /></label>
        </div>

        {#if docKindField !== 'statement'}
          <div class="card">
            <h2 class="section">Lines</h2>
            <table class="grid">
              <thead>
                <tr>
                  <th>Description</th><th class="acct">Account</th>
                  <th class="num">Amount</th><th class="tax">HST</th><th></th>
                </tr>
              </thead>
              <tbody>
                {#each lines as line, i (i)}
                  <tr>
                    <td><input type="text" bind:value={line.description} disabled={locked} /></td>
                    <td class="acct">
                      <AccountPicker
                        {accounts}
                        bind:accountId={line.account_qbo_id}
                        bind:accountName={line.account_name}
                        disabled={locked}
                        on:change={() => (lines = lines)}
                      />
                    </td>
                    <td class="num"><input class="amount" type="text" inputmode="decimal" bind:value={line.amount_dollars} disabled={locked} /></td>
                    <td class="tax"><input type="checkbox" bind:checked={line.taxable} disabled={locked} /></td>
                    <td>{#if !locked}<button class="btn xs ghost" on:click={() => removeLine(i)} title="Remove line">×</button>{/if}</td>
                  </tr>
                {/each}
              </tbody>
            </table>

            {#if accountsError}
              <p class="sub warn-text">Could not load the chart of accounts: {accountsError}</p>
            {/if}

            {#if !locked}
              <div class="line-actions">
                <button class="btn small ghost" on:click={addLine}>Add line</button>
                {#if lines.length > 1}
                  <button class="btn small ghost" on:click={applyAccountToAll}>Same account for all lines</button>
                {/if}
              </div>
              <p class="sub">
                Uncoded lines fall through to the default expense account. Once
                you approve a bill, later invoices from this supplier arrive
                coded the same way.
              </p>
            {/if}

            <div class="totals" class:mismatch={!totalsAgree}>
              <span>Lines {money(lineTotal)} + tax {money(taxCents)} = {money(computed)}</span>
              <span>Document says {money(totalCents)}</span>
            </div>
            {#if !totalsAgree}
              <p class="sub warn-text">
                These don't add up. Something was misread — fix it before
                posting, or this bill will never match the supplier's statement.
              </p>
            {/if}
          </div>
        {/if}

        {#if statement}
          <div class="card">
            <h2 class="section">Statement</h2>
            <p class="sub">This document was read as a statement.</p>
            <a class="btn small" href={`/admin/ap/statements/${statement.id}`}>Open reconciliation</a>
          </div>
        {/if}

        <!-- ─── Actions ──────────────────────────────────────────── -->
        <div class="card actions">
          {#if !locked}
            <button class="btn" on:click={save} disabled={busy === 'save'}>
              {busy === 'save' ? 'Saving…' : 'Save changes'}
            </button>

            {#if doc.review_status !== 'approved'}
              <button
                class="btn primary" on:click={approve}
                disabled={busy === 'approve' || !doc.vendor_qbo_id}
                title={!doc.vendor_qbo_id ? 'Assign a QuickBooks vendor first' : ''}
              >
                {busy === 'approve' ? 'Approving…' : 'Approve'}
              </button>
            {:else if $isAdmin}
              <button class="btn primary" on:click={postToQbo} disabled={busy === 'post'}>
                {busy === 'post' ? 'Posting…' : 'Post to QuickBooks'}
              </button>
            {:else}
              <span class="sub">Approved. An admin posts it to QuickBooks.</span>
            {/if}

            <button class="btn ghost" on:click={reject} disabled={busy === 'reject'}>Reject</button>
            <button class="btn ghost" on:click={reExtract} disabled={busy === 'extract'}>
              {busy === 'extract' ? 'Reading…' : 'Read again'}
            </button>
          {:else}
            <span class="sub">
              QuickBooks bill {doc.qbo_bill_id}{doc.qbo_attachable_id ? ' · PDF attached' : ' · no PDF attached'}
            </span>
          {/if}
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .page { padding: 24px; max-width: 1500px; margin: 0 auto; }
  .back { color: var(--text-muted); text-decoration: none; font-size: 0.9rem; }
  .back:hover { color: var(--text); }

  .head { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; margin: 10px 0 4px; flex-wrap: wrap; }
  .page-title {
    font-family: var(--font-display); font-size: 1.5rem;
    letter-spacing: 0.04em; text-transform: uppercase; margin: 0;
  }
  .badges { display: flex; gap: 6px; flex-wrap: wrap; }

  .split { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 16px; align-items: start; }
  @media (max-width: 1000px) { .split { grid-template-columns: 1fr; } }
  .pane { min-width: 0; }

  .viewer {
    width: 100%; height: calc(100vh - 190px); min-height: 460px;
    border: 1px solid var(--border); border-radius: var(--radius-lg);
    background: var(--surface);
  }

  .card {
    background: var(--surface); border: 1px solid var(--border);
    border-radius: var(--radius-lg); padding: 14px 16px; margin-bottom: 14px;
  }
  .card p { margin: 0 0 6px; }
  .card p:last-child { margin-bottom: 0; }
  .section {
    font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.06em;
    color: var(--text-muted); margin: 0 0 10px; font-weight: 600;
  }
  .muted { color: var(--text-muted); font-size: 0.92rem; }
  .strong { font-weight: 600; }
  .sub { color: var(--text-muted); font-size: 0.85rem; }
  .warn-text { color: var(--amber, #e0a458); }

  .notice { padding: 10px 12px; border-radius: var(--radius); margin: 8px 0; font-size: 0.92rem; }
  .notice.ok    { background: rgba(40,167,69,0.12); color: var(--green, #28a745); border: 1px solid rgba(40,167,69,0.3); }
  .notice.error { background: rgba(220,53,69,0.12); color: var(--red, #dc3545); border: 1px solid rgba(220,53,69,0.3); }
  .notice.warn  { background: rgba(224,164,88,0.12); color: var(--amber, #e0a458); border: 1px solid rgba(224,164,88,0.3); }

  .fields { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 12px; }
  label { display: flex; flex-direction: column; gap: 4px; font-size: 0.8rem; color: var(--text-muted); }
  label.wide { margin-top: 10px; }
  input, select {
    background: var(--input-bg, rgba(0,0,0,0.2)); color: var(--text);
    border: 1px solid var(--border); border-radius: var(--radius);
    padding: 7px 9px; font: inherit; width: 100%; box-sizing: border-box;
  }
  input:disabled, select:disabled { opacity: 0.6; }
  input[type="checkbox"] { width: auto; }

  .vendor-search { display: flex; gap: 8px; margin-top: 10px; }
  .vendor-search input { flex: 1; }
  .vendor-list { list-style: none; padding: 0; margin: 10px 0 0; }
  .vendor-list li {
    display: flex; align-items: center; justify-content: space-between; gap: 10px;
    padding: 6px 0; border-bottom: 1px solid rgba(255,255,255,0.05);
  }

  .grid { width: 100%; border-collapse: collapse; }
  .grid th, .grid td { padding: 5px 6px; text-align: left; vertical-align: middle; }
  .grid th {
    color: var(--text-muted); font-weight: 600; font-size: 0.7rem;
    text-transform: uppercase; letter-spacing: 0.04em;
    border-bottom: 1px solid var(--border);
  }
  .grid th.num, .grid td.num { text-align: right; width: 96px; }
  .grid th.tax, .grid td.tax { text-align: center; width: 44px; }
  /* The account cell needs room for a dropdown that overflows the row, so
     the cell itself must not clip it. */
  .grid th.acct, .grid td.acct { width: 34%; overflow: visible; }
  .amount { text-align: right; font-variant-numeric: tabular-nums; }
  .line-actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 6px; }

  .totals {
    display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap;
    margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--border);
    font-size: 0.88rem; font-variant-numeric: tabular-nums; color: var(--text-muted);
  }
  .totals.mismatch { color: var(--amber, #e0a458); font-weight: 600; }

  .actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }

  .state {
    padding: 2px 8px; border-radius: 999px; font-size: 0.75rem;
    text-transform: uppercase; letter-spacing: 0.04em; font-weight: 600;
  }
  .state.ok      { background: rgba(40,167,69,0.18);  color: var(--green, #28a745); }
  .state.warn    { background: rgba(224,164,88,0.18); color: var(--amber, #e0a458); }
  .state.neutral { background: rgba(255,255,255,0.08); color: var(--text-muted); }

  .btn {
    padding: 7px 13px; border-radius: var(--radius);
    border: 1px solid var(--border); background: var(--surface);
    color: var(--text); cursor: pointer; font: inherit;
  }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn.primary { background: var(--accent, #c0392b); color: white; border-color: transparent; }
  .btn.primary:hover:not(:disabled) { filter: brightness(1.1); }
  .btn.ghost { background: transparent; }
  .btn.small { padding: 5px 11px; font-size: 0.86rem; }
  .btn.xs { padding: 2px 8px; font-size: 0.8rem; }
</style>
