<!--
  /portal/jobs/[id] — Customer-facing detail for a single project.

  Shows:
    - Status pill + due date + assigned staff (with mailto)
    - Line items (manual + online-order, merged server-side)
    - Photo gallery (gallery-flagged photos only)
    - Upload-files action (auto-mints a 14-day link)
    - Download invoice PDF (when project has a linked QBO invoice)

  Auth: customer realm. Backend returns 404 for anyone other than the
  project's client_id, so this page just shows "Project not found" for
  cross-customer probing.
-->
<script>
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { customer, isCustomerLoggedIn } from '$lib/stores/customer-auth.js';
  import { customerApi, API_BASE } from '$lib/api/customer-client.js';

  let loading = true;
  let err = null;
  let project = null;
  let items = [];
  let photos = [];
  let order = null;
  let itemsTotal = 0;
  let uploading = false;
  let downloadingInvoice = false;

  // Messaging — thread between this customer and Holm Graphics staff.
  let messages = [];
  let newMessage = '';
  let sendingMessage = false;
  let messageErr = null;
  /** Interval ID for the 30-second poll so we can clear it on destroy. */
  let pollTimer = null;

  $: id = $page.params.id;

  onMount(async () => {
    if (!$isCustomerLoggedIn) {
      goto(`/shop/login?return=/portal/jobs/${id}`);
      return;
    }
    await refresh();
    await loadMessages();
    // Poll for new messages every 30s so staff replies show up
    // without the customer having to refresh. Cheap query (a single
    // table) and the page is bounded to one job at a time.
    pollTimer = setInterval(() => { void loadMessages(); }, 30_000);
    return () => { if (pollTimer) clearInterval(pollTimer); };
  });

  async function loadMessages() {
    try {
      const data = await customerApi.getProjectMessages(id);
      messages = data.messages || [];
    } catch (e) {
      // Silently swallow polling errors — the user can still see the
      // page and earlier messages. Send-failures surface separately.
    }
  }

  async function sendMessage() {
    const body = newMessage.trim();
    if (!body || sendingMessage) return;
    sendingMessage = true;
    messageErr = null;
    // Optimistic append so the UI feels instant.
    const optimistic = {
      id: `temp-${Date.now()}`,
      author_type: 'customer',
      author_id: $customer?.id,
      author_name: $customer?.name || $customer?.email || 'You',
      body,
      created_at: new Date().toISOString(),
      _pending: true,
    };
    messages = [...messages, optimistic];
    newMessage = '';
    try {
      const res = await customerApi.postProjectMessage(id, body);
      // Replace the optimistic row with the real one from the server.
      messages = messages.map((m) => (m === optimistic ? res.message : m));
    } catch (e) {
      messages = messages.filter((m) => m !== optimistic);
      newMessage = body;
      messageErr = e.message || 'Could not send message.';
    } finally {
      sendingMessage = false;
    }
  }

  function fmtMessageTime(iso) {
    try {
      const d = new Date(iso);
      const today = new Date();
      const sameDay = d.toDateString() === today.toDateString();
      if (sameDay) return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
      return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    } catch { return iso; }
  }

  async function refresh() {
    loading = true;
    err = null;
    try {
      const data = await customerApi.getProject(id);
      project    = data.project;
      items      = data.items || [];
      photos     = data.photos || [];
      order      = data.order;
      itemsTotal = data.itemsTotal || 0;
    } catch (e) {
      if (/401|missing bearer|invalid customer token/i.test(e.message || '')) {
        customer.logout();
        goto(`/shop/login?return=/portal/jobs/${id}`);
        return;
      }
      err = e.message;
    } finally {
      loading = false;
    }
  }

  function fmtDate(d) {
    if (!d) return '—';
    try {
      return new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    } catch {
      return d;
    }
  }
  function fmtMoney(n) {
    if (n == null) return '—';
    return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(Number(n) || 0);
  }

  function statusClass(name) {
    const s = String(name || '').toLowerCase();
    if (/quote/.test(s))             return 'quote';
    if (/order|prod|active/.test(s)) return 'active';
    if (/proof/.test(s))             return 'proof';
    if (/pickup|ship|ready/.test(s)) return 'ready';
    if (/bill|invoice/.test(s))      return 'billing';
    return 'neutral';
  }

  async function onUpload() {
    uploading = true;
    err = null;
    try {
      const res = await customerApi.requestProjectUploadLink(id);
      if (res?.url) {
        window.location.href = res.url;
        return;
      }
      err = 'Could not create an upload link.';
    } catch (e) {
      err = e.message || 'Could not create an upload link.';
    } finally {
      uploading = false;
    }
  }

  /**
   * Download the QBO invoice PDF. We can't just <a href> because the
   * endpoint requires the bearer token in a header — fetch + blob is
   * the only way to attach it. Object URL is revoked after a tick so
   * memory doesn't grow on repeated clicks.
   */
  async function downloadInvoice() {
    downloadingInvoice = true;
    err = null;
    try {
      const token = localStorage.getItem('hg_customer_token');
      const res = await fetch(customerApi.projectInvoicePdfUrl(id), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || `Could not load invoice (${res.status})`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `invoice-${order?.order_number || id}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
    } catch (e) {
      err = e.message;
    } finally {
      downloadingInvoice = false;
    }
  }
</script>

<svelte:head><title>{project ? `#${project.id} — Holm Graphics` : 'Job'}</title></svelte:head>

<div class="page">
  <a href="/portal" class="back">← Back to my account</a>

  {#if loading}
    <p class="muted">Loading…</p>
  {:else if err && !project}
    <div class="error-banner">{err}</div>
  {:else if !project}
    <div class="empty">Project not found.</div>
  {:else}
    <header class="head">
      <div>
        <h1>#{project.id} — {project.project_name || '(no description)'}</h1>
        <div class="head-meta">
          <span class="status status-{statusClass(project.status_name)}">{project.status_name || 'open'}</span>
          {#if project.due_date}<span>Due {fmtDate(project.due_date)}</span>{/if}
          {#if project.po_number}<span>PO #{project.po_number}</span>{/if}
        </div>
      </div>
    </header>

    {#if err}<div class="error-banner">{err}</div>{/if}

    <!-- Assigned staff -->
    {#if project.assigned_to}
      <section class="card contact-card">
        <div>
          <div class="contact-label">Your contact at Holm Graphics</div>
          <div class="contact-name">{project.assigned_to}</div>
          {#if project.assigned_email}
            <a href="mailto:{project.assigned_email}" class="contact-email">{project.assigned_email}</a>
          {/if}
        </div>
        {#if project.assigned_email}
          <a class="btn" href="mailto:{project.assigned_email}?subject=Job%20%23{project.id}">Email {(project.assigned_to || '').split(' ')[0]}</a>
        {/if}
      </section>
    {/if}

    <!-- Actions row -->
    <section class="card actions">
      <button type="button" class="btn primary" disabled={uploading} on:click={onUpload}>
        {uploading ? 'Opening…' : '📎 Upload files'}
      </button>
      {#if order?.qbo_invoice_id}
        <button type="button" class="btn" disabled={downloadingInvoice} on:click={downloadInvoice}>
          {downloadingInvoice ? 'Loading…' : '📄 Download invoice PDF'}
        </button>
      {/if}
    </section>

    <!-- Messaging thread -->
    <section class="card thread-card">
      <h2>Messages</h2>
      {#if messages.length === 0}
        <p class="muted small">
          No messages yet. Send us a note about this job — your message goes
          straight to {project.assigned_to || 'the Holm Graphics team'}.
        </p>
      {:else}
        <ul class="thread">
          {#each messages as m (m.id)}
            <li class="msg msg-{m.author_type}" class:pending={m._pending}>
              <div class="msg-meta">
                <strong>{m.author_name || (m.author_type === 'staff' ? 'Holm Graphics' : 'You')}</strong>
                <span class="msg-time">{fmtMessageTime(m.created_at)}</span>
              </div>
              <div class="msg-body">{m.body}</div>
            </li>
          {/each}
        </ul>
      {/if}

      <form class="msg-form" on:submit|preventDefault={sendMessage}>
        <textarea
          bind:value={newMessage}
          rows="3"
          maxlength="4000"
          placeholder="Write a message…"
          disabled={sendingMessage}
        ></textarea>
        {#if messageErr}<div class="error-banner small">{messageErr}</div>{/if}
        <div class="msg-actions">
          <button type="submit" class="btn primary" disabled={sendingMessage || !newMessage.trim()}>
            {sendingMessage ? 'Sending…' : 'Send'}
          </button>
        </div>
      </form>
    </section>

    <!-- Line items -->
    {#if items.length > 0}
      <section class="card">
        <h2>Line items</h2>
        <table class="items">
          <thead>
            <tr>
              <th>Item</th>
              <th class="num">Qty</th>
              <th class="num">Unit price</th>
              <th class="num">Total</th>
            </tr>
          </thead>
          <tbody>
            {#each items as it (it.source + '-' + it.id)}
              <tr>
                <td>{it.item_name || '(unnamed)'}</td>
                <td class="num">{Number(it.quantity || 0)}</td>
                <td class="num">{fmtMoney(it.unit_price)}</td>
                <td class="num">{fmtMoney(it.total)}</td>
              </tr>
            {/each}
          </tbody>
          <tfoot>
            <tr>
              <th colspan="3" class="num">Subtotal</th>
              <th class="num">{fmtMoney(itemsTotal)}</th>
            </tr>
            {#if order?.grand_total != null && order.grand_total > 0}
              <tr>
                <th colspan="3" class="num">Order total (incl. tax/shipping)</th>
                <th class="num">{fmtMoney(order.grand_total)}</th>
              </tr>
            {/if}
          </tfoot>
        </table>
      </section>
    {/if}

    <!-- Photos -->
    {#if photos.length > 0}
      <section class="card">
        <h2>Photos</h2>
        <div class="photo-grid">
          {#each photos as ph (ph.id)}
            <a href={ph.public_url} target="_blank" rel="noopener" class="photo">
              <img src={ph.public_url} alt={ph.caption || ph.filename} loading="lazy" />
              {#if ph.caption}<div class="photo-caption">{ph.caption}</div>{/if}
            </a>
          {/each}
        </div>
      </section>
    {/if}

    <!-- Order link (if there's an online order behind this project) -->
    {#if order}
      <section class="card">
        <h2>Linked order</h2>
        <p class="muted small">
          This job has an online order on file (#{order.order_number}). Payment method: {order.payment_method || '—'}.
        </p>
      </section>
    {/if}
  {/if}
</div>

<style>
  .page {
    max-width: 880px;
    margin: 0 auto;
    padding: 24px 20px 80px;
  }
  .back {
    display: inline-block;
    color: var(--red);
    text-decoration: none;
    font-family: var(--font-display);
    font-weight: 600;
    font-size: 0.88rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    margin-bottom: 16px;
  }

  .head { margin-bottom: 16px; }
  .head h1 {
    font-family: var(--font-display);
    margin: 0;
    font-size: 1.6rem;
    color: var(--text);
  }
  .head-meta {
    display: flex;
    gap: 12px;
    flex-wrap: wrap;
    color: var(--text-muted);
    font-size: 0.92rem;
    margin-top: 8px;
    align-items: baseline;
  }

  .muted { color: var(--text-muted); }
  .small { font-size: 0.88rem; }
  .empty {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 32px;
    text-align: center;
    color: var(--text-muted);
  }
  .error-banner {
    background: rgba(192,57,43,0.1);
    border: 1px solid var(--red);
    color: var(--red);
    padding: 10px 14px;
    border-radius: 6px;
    margin: 12px 0;
  }

  .card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 18px 20px;
    margin-bottom: 14px;
  }
  .card h2 {
    font-family: var(--font-display);
    font-size: 1.1rem;
    margin: 0 0 12px;
    color: var(--text);
  }

  .contact-card {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    flex-wrap: wrap;
  }
  .contact-label {
    font-family: var(--font-display);
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-size: 0.78rem;
  }
  .contact-name {
    font-family: var(--font-display);
    font-size: 1.05rem;
    font-weight: 600;
    color: var(--text);
    margin-top: 2px;
  }
  .contact-email { color: var(--red); text-decoration: none; font-size: 0.9rem; }
  .contact-email:hover { text-decoration: underline; }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
  }
  .btn {
    background: var(--surface-2);
    border: 1px solid var(--border);
    color: var(--text);
    padding: 10px 16px;
    border-radius: 4px;
    font-family: var(--font-display);
    font-weight: 600;
    font-size: 0.88rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    cursor: pointer;
    text-decoration: none;
    display: inline-block;
  }
  .btn:hover:not(:disabled) { border-color: var(--red); color: var(--red); }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn.primary {
    background: var(--red);
    border-color: var(--red);
    color: #fff;
  }
  .btn.primary:hover:not(:disabled) { filter: brightness(0.94); color: #fff; }

  .status {
    display: inline-block;
    padding: 3px 10px;
    border-radius: 3px;
    font-family: var(--font-display);
    text-transform: uppercase;
    font-size: 0.74rem;
    letter-spacing: 0.06em;
  }
  .status-quote   { background: rgba(31,58,147,0.12);  color: #1F3A93; }
  .status-active  { background: rgba(217,119,6,0.15);  color: #b45309; }
  .status-proof   { background: rgba(31,58,147,0.12);  color: #1F3A93; }
  .status-ready   { background: rgba(63,191,111,0.18); color: #16a34a; }
  .status-billing { background: rgba(154,161,173,0.18); color: var(--text-muted); }
  .status-neutral { background: rgba(154,161,173,0.15); color: var(--text-muted); }

  /* Items table */
  table.items { width: 100%; border-collapse: collapse; }
  table.items th, table.items td {
    padding: 8px 10px;
    text-align: left;
    border-bottom: 1px solid var(--border);
    font-size: 0.92rem;
  }
  table.items thead th {
    font-family: var(--font-display);
    color: var(--text-muted);
    text-transform: uppercase;
    font-size: 0.72rem;
    letter-spacing: 0.06em;
  }
  table.items .num { text-align: right; }
  table.items tfoot th {
    background: var(--surface-2);
    font-family: var(--font-display);
  }

  /* Photo grid */
  .photo-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
    gap: 10px;
  }
  .photo {
    display: block;
    background: #000;
    border-radius: 6px;
    overflow: hidden;
    border: 1px solid var(--border);
    text-decoration: none;
    color: var(--text);
  }
  .photo img {
    width: 100%;
    height: 130px;
    object-fit: cover;
    display: block;
  }
  .photo-caption {
    padding: 6px 8px;
    font-size: 0.78rem;
    color: var(--text-muted);
  }

  /* Messaging thread */
  .thread-card { display: flex; flex-direction: column; gap: 12px; }
  .thread {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
    max-height: 460px;
    overflow-y: auto;
  }
  .msg {
    padding: 10px 12px;
    border-radius: 8px;
    max-width: 88%;
    background: var(--surface-2);
    border: 1px solid var(--border);
  }
  .msg.msg-customer {
    align-self: flex-end;
    background: rgba(192,57,43,0.08);
    border-color: rgba(192,57,43,0.25);
  }
  .msg.msg-staff {
    align-self: flex-start;
  }
  .msg.pending { opacity: 0.55; }
  .msg-meta {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 8px;
    font-size: 0.82rem;
    color: var(--text-muted);
    margin-bottom: 4px;
  }
  .msg-meta strong { color: var(--text); font-family: var(--font-display); font-weight: 600; font-size: 0.92rem; }
  .msg-time { font-size: 0.78rem; }
  .msg-body { white-space: pre-wrap; word-wrap: break-word; color: var(--text); }

  .msg-form {
    border-top: 1px solid var(--border);
    padding-top: 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .msg-form textarea {
    width: 100%;
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 10px;
    font-family: var(--font-body);
    font-size: 0.95rem;
    background: var(--surface);
    color: var(--text);
    resize: vertical;
  }
  .msg-actions { display: flex; justify-content: flex-end; }
  .error-banner.small { padding: 6px 10px; font-size: 0.85rem; margin: 0; }
</style>
