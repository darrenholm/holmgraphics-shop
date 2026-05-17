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
  let payPeriods = [];       // for the pay-period filter dropdown
  let payPeriodId = '';      // empty = use date range
  let syncing = false;       // sync to QBO payroll in progress
  let syncMessage = '';      // feedback from sync

  // ─── Derived state: grouped entries by employee ──────────────────────
  let groupedEntries = [];   // [ { employee_id, employee_name, entries, totalMinutes }, ... ]

  $: if (entries.length > 0) {
    // Group entries by employee
    const byEmployee = new Map();
    for (const entry of entries) {
      const key = entry.employee_id;
      if (!byEmployee.has(key)) {
        byEmployee.set(key, {
          employee_id: entry.employee_id,
          employee_name: entry.employee_name || ('Employee #' + entry.employee_id),
          entries: [],
          totalMinutes: 0,
        });
      }
      const group = byEmployee.get(key);
      group.entries.push(entry);
      if (entry.duration_minutes != null) {
        group.totalMinutes += entry.duration_minutes;
      }
    }
    // Sort by employee name
    groupedEntries = Array.from(byEmployee.values()).sort((a, b) =>
      a.employee_name.localeCompare(b.employee_name)
    );
  } else {
    groupedEntries = [];
  }

  // Manual-entry modal — for backfilling shifts when an employee forgot
  // to clock in. Default values populate to "today, 8 to 4" so the most
  // common case is one click away.
  let showAddEntry = false;
  let addBusy = false;
  let addForm = {
    employee_id: '',
    date: '',
    clock_in:  '08:00',
    clock_out: '16:00',
    project_id: '',
    notes: '',
    pre_approve: false,
  };

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
    await loadPayPeriods();
    // Default to the period containing today (or the most recent period if today
    // is between cycles), so the page shows what the user is working in right now
    // — Phase 1's biweekly-Sun-to-Sat math was wrong for shops with non-Sun anchors.
    const today = new Date().toISOString().slice(0, 10);
    const current = payPeriods.find(p => dateOnly(p.start_date) <= today && dateOnly(p.end_date) >= today)
      || payPeriods[0];
    if (current) {
      payPeriodId = String(current.id);
      from = dateOnly(current.start_date);
      to   = dateOnly(current.end_date);
    } else {
      const range = currentBiweeklyRange();
      from = fmtDateInput(range.from);
      to   = fmtDateInput(range.to);
    }
    await loadEmployees();
    await loadEntries();
  });

  async function loadPayPeriods() {
    try {
      const res = await api.payPeriodsList();
      payPeriods = res.periods || [];
    } catch { /* non-fatal — falls back to manual date range */ }
  }

  // When the pay period dropdown changes, sync the date range to match.
  // Picking the empty option means "use the date range pickers directly".
  function onPayPeriodChange() {
    const p = payPeriods.find(p => String(p.id) === String(payPeriodId));
    if (p) {
      from = dateOnly(p.start_date);
      to   = dateOnly(p.end_date);
    }
  }

  // PG DATE columns get JSON-serialized as full ISO datetime strings
  // ("2026-04-30T00:00:00.000Z"), but <input type="date"> only accepts
  // 'YYYY-MM-DD'. Slice instead of parsing to avoid timezone shift.
  function dateOnly(s) {
    return (s || '').slice(0, 10);
  }

  // Format a date string for display without timezone conversion
  // Takes "2026-04-30T00:00:00.000Z" and returns "Apr 30" without shifting
  function formatPayPeriodDate(isoString) {
    const dateStr = dateOnly(isoString);
    const [year, month, day] = dateStr.split('-');
    const date = new Date(year, parseInt(month) - 1, parseInt(day));
    return date.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
  }

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

  // ─── Manual entry ──────────────────────────────────────────────────
  function todayLocalISO() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  }
  function openAddEntry() {
    addForm = {
      employee_id: employeeFilter || (employees[0]?.id ? String(employees[0].id) : ''),
      date: todayLocalISO(),
      clock_in:  '08:00',
      clock_out: '16:00',
      project_id: '',
      notes: '',
      pre_approve: false,
    };
    showAddEntry = true;
  }
  function closeAddEntry() {
    if (addBusy) return;
    showAddEntry = false;
  }
  async function submitAddEntry() {
    error = ''; message = '';
    if (!addForm.employee_id || !addForm.date || !addForm.clock_in || !addForm.clock_out) {
      error = 'Employee, date, clock-in, and clock-out are required.';
      return;
    }
    // Combine date + time strings into ISO datetimes in the user's local
    // timezone. <input type="time"> values are 'HH:MM'; new Date('YYYY-MM-DDTHH:MM')
    // parses as local time (no Z), which is what we want.
    const inISO  = new Date(`${addForm.date}T${addForm.clock_in}`).toISOString();
    const outISO = new Date(`${addForm.date}T${addForm.clock_out}`).toISOString();
    addBusy = true;
    try {
      const created = await api.timeAdminCreate({
        employee_id: Number(addForm.employee_id),
        clock_in:  inISO,
        clock_out: outISO,
        project_id: addForm.project_id ? Number(addForm.project_id) : null,
        notes: addForm.notes || null,
        status: addForm.pre_approve ? 'approved' : 'closed',
      });
      message = `Added entry #${created.id} for ${created.employee_name || 'employee ' + created.employee_id}.`;
      showAddEntry = false;
      await loadEntries();
    } catch (e) {
      error = e.message || String(e);
    } finally {
      addBusy = false;
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

  // ─── QBO Payroll Sync ──────────────────────────────────────────────
  async function syncToQBOPayroll() {
    if (!payPeriodId) {
      error = 'Please select a pay period first.';
      return;
    }
    syncing = true;
    error = '';
    syncMessage = '';
    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:3000/api'}/quickbooks/sync-payroll/${payPeriodId}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('hg_token')}`,
          'Content-Type': 'application/json'
        },
      });
      const data = await res.json();
      if (!res.ok) {
        error = data.message || `Sync failed: ${res.status}`;
        if (data.unmapped_employees) {
          error += `\n\nUnmapped employees: ${data.unmapped_employees.join(', ')}.\nVisit /admin-legacy/qbo-match-employees to link them first.`;
        }
        return;
      }
      // Success
      message = `✅ Synced to QBO Payroll: ${data.synced_employees} employees, ${data.synced_entries} entries, ${data.total_hours}h total`;
      if (data.errors.length > 0) {
        error = `⚠️ Sync partial: ${data.errors.length} errors. Check browser console.`;
        console.warn('Sync errors:', data.errors);
      }
      await loadEntries(); // Reload to see updated qbo_synced_at
    } catch (e) {
      error = e.message || 'Network error during sync';
    } finally {
      syncing = false;
    }
  }

  // ─── Formatting ────────────────────────────────────────────────────
  function formatDuration(min) {
    if (min == null) return '—';
    const hours = min / 60;
    return `${hours.toFixed(2)}h`;
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
      <label>Pay period</label>
      <select bind:value={payPeriodId} on:change={onPayPeriodChange}>
        <option value="">— Custom date range —</option>
        {#each payPeriods as p}
          <option value={String(p.id)}>
            {formatPayPeriodDate(p.start_date)} – {formatPayPeriodDate(p.end_date)}{p.status === 'exported' ? ' (exported)' : p.status === 'closed' ? ' (closed)' : ''}
          </option>
        {/each}
      </select>
    </div>
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
      <button class="btn ghost" on:click={openAddEntry}>+ Add Entry</button>
      <a class="btn ghost" href="/admin/timesheets/export">Export →</a>
      {#if payPeriodId}
        <button class="btn" style="background: #2563eb; color: white;" disabled={syncing} on:click={syncToQBOPayroll}>
          {syncing ? 'Syncing...' : '📤 Sync to QBO Payroll'}
        </button>
        <span style="font-size: 0.85em; color: #666;">ID: {payPeriodId}</span>
      {/if}
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
        {#each groupedEntries as group}
          <!-- Employee section header -->
          <tr class="employee-group-header">
            <td colspan="9">
              <strong>{group.employee_name}</strong>
            </td>
          </tr>

          <!-- Entries for this employee -->
          {#each group.entries as e (e.id)}
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
                <td></td>
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

          <!-- Summary row for this employee -->
          <tr class="employee-summary">
            <td colspan="4" style="text-align: right; padding-right: 8px;"><strong>Total for {group.employee_name}:</strong></td>
            <td><strong>{formatDuration(group.totalMinutes)}</strong></td>
            <td colspan="4"></td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</div>


{#if showAddEntry}
  <div class="modal-backdrop" on:click|self={closeAddEntry}>
    <div class="modal" role="dialog" aria-modal="true" aria-label="Add manual time entry">
      <div class="modal-head">
        <h2>Add Time Entry</h2>
        <button class="modal-close" on:click={closeAddEntry} aria-label="Close">×</button>
      </div>
      <div class="modal-body">
        <p class="modal-help">
          Backfill a shift when an employee forgot to clock in. The entry
          is auto-tagged <code>[manual entry by you]</code> for audit.
        </p>

        <div class="form-row">
          <label for="add-emp">Employee</label>
          <select id="add-emp" bind:value={addForm.employee_id} disabled={addBusy}>
            <option value="">—</option>
            {#each employees as emp}
              <option value={String(emp.id)}>
                {[emp.first_name, emp.last_name].filter(Boolean).join(' ')}
              </option>
            {/each}
          </select>
        </div>

        <div class="form-row">
          <label for="add-date">Date</label>
          <input id="add-date" type="date" bind:value={addForm.date} disabled={addBusy} />
        </div>

        <div class="form-row two-col">
          <div>
            <label for="add-in">Clock in</label>
            <input id="add-in" type="time" bind:value={addForm.clock_in} disabled={addBusy} />
          </div>
          <div>
            <label for="add-out">Clock out</label>
            <input id="add-out" type="time" bind:value={addForm.clock_out} disabled={addBusy} />
          </div>
        </div>

        <div class="form-row">
          <label for="add-project">Project ID (optional)</label>
          <input id="add-project" type="number" placeholder="e.g. 9586" bind:value={addForm.project_id} disabled={addBusy} />
        </div>

        <div class="form-row">
          <label for="add-notes">Notes (optional)</label>
          <textarea id="add-notes" rows="2" bind:value={addForm.notes} disabled={addBusy}
                    placeholder="What was the shift?"></textarea>
        </div>

        <label class="checkbox">
          <input type="checkbox" bind:checked={addForm.pre_approve} disabled={addBusy} />
          Mark as approved (skip the closed-then-approve step)
        </label>
      </div>
      <div class="modal-foot">
        <button class="btn ghost" on:click={closeAddEntry} disabled={addBusy}>Cancel</button>
        <button class="btn primary" on:click={submitAddEntry} disabled={addBusy}>
          {addBusy ? 'Adding…' : 'Add Entry'}
        </button>
      </div>
    </div>
  </div>
{/if}

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
  .entries tr.employee-group-header {
    background: rgba(192, 57, 43, 0.12);
    border-top: 2px solid rgba(192, 57, 43, 0.3);
    border-bottom: 1px solid rgba(192, 57, 43, 0.3);
    font-weight: 600;
    color: var(--accent, #c0392b);
  }
  .entries tr.employee-group-header td { padding: 10px 8px; }
  .entries tr.employee-summary {
    background: rgba(255,255,255,0.06);
    border-top: 1px solid rgba(192, 57, 43, 0.3);
    border-bottom: 2px solid rgba(192, 57, 43, 0.3);
    font-weight: 600;
  }
  .entries tr.employee-summary td { padding: 10px 8px; }
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

  /* ─── Add-entry modal ─────────────────────────────────────────────── */
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
    width: 100%; max-width: 480px;
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
  .modal-help {
    color: var(--text-muted);
    font-size: 0.9rem;
    margin: 0 0 14px;
  }
  .modal-help code {
    background: rgba(255,255,255,0.06);
    padding: 1px 6px; border-radius: 4px; font-size: 0.85em;
  }
  .form-row { display: flex; flex-direction: column; gap: 4px; margin-bottom: 12px; }
  .form-row label {
    font-size: 0.78rem; color: var(--text-muted);
    text-transform: uppercase; letter-spacing: 0.04em;
  }
  .form-row input,
  .form-row select,
  .form-row textarea {
    background: var(--input-bg, var(--surface));
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 8px 10px;
    font: inherit;
  }
  .form-row.two-col { flex-direction: row; gap: 12px; }
  .form-row.two-col > div { flex: 1; display: flex; flex-direction: column; gap: 4px; }
  .checkbox {
    display: flex; align-items: center; gap: 8px;
    font-size: 0.9rem; color: var(--text);
    margin-top: 4px;
  }
  .modal-foot {
    display: flex; justify-content: flex-end; gap: 8px;
    padding: 12px 18px; border-top: 1px solid var(--border);
  }
</style>
