<!-- src/routes/admin/timesheets/+page.svelte
     Manager review for time entries. Scan a pay period, fix forgotten
     punches, approve good ones, then head to /admin/timesheets/export
     to download the CSV. Admin-gated. -->
<script>
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { auth, isAdmin } from '$lib/stores/auth.js';
  import { api } from '$lib/api/client.js';

  // ─── State ─────────────────────────────────────────────────────────
  let entries = [];
  let employees = [];        // for the filter dropdown
  let employeeFilter = '';   // empty = all
  let statusFilter = '';     // empty = all (excluding 'exported' by default)
  let from = '';             // ISO date string, picker value
  let to = '';
  let loading = true;
  let error = '';
  let message = '';
  let selected = new Set();  // entry ids checked for bulk-approve
  let editingId = null;      // currently inline-edited entry id
  let editForm = {};         // working copy of fields being edited

  // ─── Pay period defaults ───────────────────────────────────────────
  // Biweekly Sunday-to-Saturday, ending most-recent Saturday.
  // Most pay-cycles in CA SMBs run on this cadence; tweakable via the
  // date pickers if your shop runs different.
  function currentBiweeklyRange() {
    const now = new Date();
    // Find this Saturday or last Saturday (whichever's most recent + non-future).
    const dow = now.getDay(); // 0 = Sun, 6 = Sat
    const daysSinceSat = (dow + 1) % 7; // 0 if Sat, 1 if Sun, ..., 6 if Fri
    const lastSat = new Date(now);
    lastSat.setDate(now.getDate() - daysSinceSat);
    lastSat.setHours(23, 59, 59, 999);
    const fromDate = new Date(lastSat);
    fromDate.setDate(lastSat.getDate() - 13);
    fromDate.setHours(0, 0, 0, 0);
    return { from: fromDate, to: lastSat };
  }

  function fmtDateInput(d) {
    return d.toISOString().slice(0, 10);
  }

  onMount(async () => {
    if (!$auth || !$isAdmin) { goto('/login?return=/admin/timesheets'); return; }
    const range = currentBiweeklyRange();
    from = fmtDateInput(range.from);
    to   = fmtDateInput(range.to);
    await loadEmployees();
    await loadEntries();
  });

  async function loadEmployees() {
    try {
      // Reuse the lookup endpoint; it returns { id, first_name, last_name, ... }
      const res = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:3000/api'}/employees`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('hg_token')}` },
      });
      if (res.ok) employees = await res.json();
    } catch { /* non-fatal — filter dropdown just stays empty */ }
  }

  async function loadEntries() {
    loading = true; error = '';
    try {
      const fromISO = new Date(from + 'T00:00:00').toISOString();
      const toISO   = new Date(to   + 'T23:59:59').toISOString();
      const res = await api.timeAdminList({
        from: fromISO,
        to:   toISO,
        employee_id: employeeFilter || undefined,
        status: statusFilter || undefined,
      });
      entries = res.entries || [];
      selected = new Set();
    } catch (e) {
      error = e.message || String(e);
    } finally {
      loading = false;
    }
  }

  // ─── Editing ───────────────────────────────────────────────────────
  function startEdit(e) {
    editingId = e.id;
    editForm = {
      clock_in:  toLocalDateTimeInput(e.clock_in),
      clock_out: toLocalDateTimeInput(e.clock_out),
      project_id: e.project_id || '',
      notes: e.notes || '',
      status: e.status,
    };
  }
  function cancelEdit() {
    editingId = null;
    editForm = {};
  }
  async function saveEdit(id) {
    error = ''; message = '';
    try {
      const patch = {
        clock_in:  editForm.clock_in  ? new Date(editForm.clock_in).toISOString()  : null,
        clock_out: editForm.clock_out ? new Date(editForm.clock_out).toISOString() : null,
        project_id: editForm.project_id ? Number(editForm.project_id) : null,
        notes: editForm.notes,
        status: editForm.status,
      };
      const updated = await api.timeAdminEdit(id, patch);
      // Replace the row in-place
      entries = entries.map(e => e.id === id ? updated : e);
      cancelEdit();
      message = `Saved entry #${id}.`;
    } catch (e) {
      error = e.message || String(e);
    }
  }

  // ─── Approval ──────────────────────────────────────────────────────
  function toggleSelect(id, checked) {
    const next = new Set(selected);
    if (checked) next.add(id); else next.delete(id);
    selected = next;
  }
  function selectAllVisible(checked) {
    if (checked) {
      selected = new Set(entries.filter(e => e.status === 'closed').map(e => e.id));
    } else {
      selected = new Set();
    }
  }
  async function approveOne(id) {
    error = ''; message = '';
    try {
      const updated = await api.timeAdminApprove(id);
      entries = entries.map(e => e.id === id ? updated : e);
      message = `Approved entry #${id}.`;
    } catch (e) {
      error = e.message || String(e);
    }
  }
  async function approveSelected() {
    if (selected.size === 0) return;
    error = ''; message = '';
    try {
      const res = await api.timeAdminBulkApprove(Array.from(selected));
      message = `Approved ${res.approved_count} entries.`;
      await loadEntries();
    } catch (e) {
      error = e.message || String(e);
    }
  }

  // ─── Formatting ────────────────────────────────────────────────────
  function formatDuration(min) {
    if (min == null) return '—';
    const h = Math.floor(min / 60);
    const m = min % 60;
    if (h === 0) return `${m}m`;
    if (m === 0) return `${h}h`;
    return `${h}h ${m}m`;
  }
  function formatDateTime(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('en-CA', {
      month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit',
    });
  }
  function toLocalDateTimeInput(iso) {
    // <input type="datetime-local"> wants 'YYYY-MM-DDTHH:MM' in LOCAL time.
    if (!iso) return '';
    const d = new Date(iso);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
</script>

<svelte:head><title>Timesheets — Holm Graphics Admin</title></svelte:head>

<div class="page">
  <h1 class="page-title">Timesheets</h1>

  <!-- Filters -->
  <div class="filters card">
    <div class="filter">
      <label>From</label>
      <input type="date" bind:value={from} />
    </div>
    <div class="filter">
      <label>To</label>
      <input type="date" bind:value={to} />
    </div>
    <div class="filter">
      <label>Employee</label>
      <select bind:value={employeeFilter}>
        <option value="">All</option>
        {#each employees as e}
          <option value={e.id}>{e.first_name} {e.last_name}</option>
        {/each}
      </select>
    </div>
    <div class="filter">
      <label>Status</label>
      <select bind:value={statusFilter}>
        <option value="">All</option>
        <option value="open">Open</option>
        <option value="closed">Closed</option>
        <option value="approved">Approved</option>
        <option value="exported">Exported</option>
      </select>
    </div>
    <div class="filter actions">
      <button class="btn primary" on:click={loadEntries}>Apply</button>
      <a class="btn ghost" href="/admin/timesheets/export">Export →</a>
    </div>
  </div>

  {#if message}<div class="notice ok">{message}</div>{/if}
  {#if error}<div class="notice error">{error}</div>{/if}

  <!-- Bulk actions -->
  {#if !loading && entries.length > 0}
    <div class="bulk">
      <label>
        <input type="checkbox"
               on:change={(e) => selectAllVisible(e.target.checked)}
               checked={selected.size > 0 && selected.size === entries.filter(e => e.status === 'closed').length}
        />
        Select all closed entries ({entries.filter(e => e.status === 'closed').length})
      </label>
      <button class="btn primary" disabled={selected.size === 0} on:click={approveSelected}>
        Approve selected ({selected.size})
      </button>
    </div>
  {/if}

  <!-- Entries table -->
  {#if loading}
    <div class="muted">Loading…</div>
  {:else if entries.length === 0}
    <div class="muted">No entries in this range.</div>
  {:else}
    <table class="entries">
      <thead>
        <tr>
          <th></th>
          <th>Employee</th>
          <th>Clock In</th>
          <th>Clock Out</th>
          <th>Duration</th>
          <th>Job</th>
          <th>Status</th>
          <th>Notes</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {#each entries as e (e.id)}
          {#if editingId === e.id}
            <tr class="editing">
              <td></td>
              <td>{e.employee_name}</td>
              <td><input type="datetime-local" bind:value={editForm.clock_in} /></td>
              <td><input type="datetime-local" bind:value={editForm.clock_out} /></td>
              <td>—</td>
              <td><input type="number" placeholder="Job #" bind:value={editForm.project_id} /></td>
              <td>
                <select bind:value={editForm.status}>
                  <option value="open">open</option>
                  <option value="closed">closed</option>
                  <option value="approved">approved</option>
                </select>
              </td>
              <td><input type="text" bind:value={editForm.notes} /></td>
              <td class="actions-cell">
                <button class="btn small primary" on:click={() => saveEdit(e.id)}>Save</button>
                <button class="btn small ghost" on:click={cancelEdit}>Cancel</button>
              </td>
            </tr>
          {:else}
            <tr>
              <td>
                {#if e.status === 'closed'}
                  <input type="checkbox"
                         checked={selected.has(e.id)}
                         on:change={(ev) => toggleSelect(e.id, ev.target.checked)} />
                {/if}
              </td>
              <td>{e.employee_name || ('Emp #' + e.employee_id)}</td>
              <td>{formatDateTime(e.clock_in)}</td>
              <td>{formatDateTime(e.clock_out)}</td>
              <td>{formatDuration(e.duration_minutes)}</td>
              <td>{e.project_name ? `${e.project_id} - ${e.project_name}` : (e.project_id || '')}</td>
              <td><span class="status status-{e.status}">{e.status}</span></td>
              <td class="notes">{e.notes || ''}</td>
              <td class="actions-cell">
                {#if e.status === 'closed'}
                  <button class="btn small primary" on:click={() => approveOne(e.id)}>Approve</button>
                {/if}
                <button class="btn small ghost" on:click={() => startEdit(e)}>Edit</button>
              </td>
            </tr>
          {/if}
        {/each}
      </tbody>
    </table>
  {/if}
</div>

<style>
  .page { padding: 24px; max-width: 1400px; margin: 0 auto; }
  .page-title {
    font-family: var(--font-display); font-size: 1.6rem;
    letter-spacing: 0.04em; text-transform: uppercase;
    margin: 0 0 18px;
  }
  .card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    padding: 14px;
    margin-bottom: 12px;
  }
  .muted { color: var(--text-muted); }

  .filters { display: flex; flex-wrap: wrap; gap: 12px; align-items: end; }
  .filter { display: flex; flex-direction: column; gap: 4px; min-width: 130px; }
  .filter.actions { flex-direction: row; gap: 6px; align-items: center; }
  .filter label {
    font-size: 0.72rem; color: var(--text-muted);
    text-transform: uppercase; letter-spacing: 0.04em;
  }
  .filter input, .filter select {
    background: var(--input-bg, var(--surface));
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 7px 10px; font: inherit;
  }

  .bulk {
    display: flex; gap: 16px; align-items: center;
    margin: 8px 0 12px;
  }
  .bulk label { display: flex; gap: 6px; align-items: center; font-size: 0.92rem; }

  .entries { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
  .entries th, .entries td { padding: 8px 8px; text-align: left; vertical-align: middle; }
  .entries th {
    color: var(--text-muted); font-weight: 600;
    font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.04em;
    border-bottom: 1px solid var(--border);
  }
  .entries tbody tr { border-bottom: 1px solid rgba(255,255,255,0.05); }
  .entries tr.editing { background: rgba(255,255,255,0.04); }
  .entries .notes { color: var(--text-muted); max-width: 220px; }
  .actions-cell { white-space: nowrap; }
  .actions-cell .btn + .btn { margin-left: 4px; }

  .entries input[type="datetime-local"],
  .entries input[type="text"],
  .entries input[type="number"],
  .entries select {
    background: var(--input-bg, var(--surface));
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 4px 6px; font: inherit; width: 100%;
  }

  .status {
    padding: 2px 8px; border-radius: 999px; font-size: 0.78rem;
    text-transform: uppercase; letter-spacing: 0.04em; font-weight: 600;
  }
  .status-open     { background: rgba(40,167,69,0.18);  color: var(--green, #28a745); }
  .status-closed   { background: rgba(255,255,255,0.08); color: var(--text); }
  .status-approved { background: rgba(0,123,255,0.18);  color: #4ea0ff; }
  .status-exported { background: rgba(255,255,255,0.04); color: var(--text-dim); font-style: italic; }

  .btn {
    padding: 7px 14px; border-radius: var(--radius); border: 1px solid var(--border);
    background: var(--surface); color: var(--text); cursor: pointer; font: inherit;
    text-decoration: none; display: inline-block;
  }
  .btn:hover:not(:disabled) { background: var(--hover); }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn.primary { background: var(--accent, #c0392b); color: white; border-color: transparent; }
  .btn.primary:hover:not(:disabled) { filter: brightness(1.1); }
  .btn.ghost { background: transparent; }
  .btn.small { padding: 4px 10px; font-size: 0.85rem; }

  .notice { padding: 10px 12px; border-radius: var(--radius); margin: 10px 0; font-size: 0.92rem; }
  .notice.ok    { background: rgba(40,167,69,0.12); color: var(--green, #28a745); border: 1px solid rgba(40,167,69,0.3); }
  .notice.error { background: rgba(220,53,69,0.12); color: var(--red,   #dc3545); border: 1px solid rgba(220,53,69,0.3); }
</style>
