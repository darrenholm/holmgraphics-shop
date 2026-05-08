<!-- src/routes/admin/qbo-employees/+page.svelte
     One-time setup page that maps each local employee (Holm Graphics user)
     to their QBO Employee record. Required before the Send-to-QuickBooks
     button on /admin/pay-periods can push TimeActivity entries into QBO.

     Admin-gated. -->
<script>
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { auth, isAdmin } from '$lib/stores/auth.js';
  import { api } from '$lib/api/client.js';

  // Local employees from /api/employees (already includes qbo_employee_id).
  let employees = [];
  // QBO Employee records pulled from QBO via the OAuth token.
  let qboEmployees = [];
  let loading = true;
  let saving  = new Set(); // local employee ids currently being saved
  let error = '';
  let message = '';

  // Per-row "draft" of the dropdown selection — committed on Save.
  // Keyed by local employee id; value is the QBO employee id (or '').
  let drafts = {};

  onMount(async () => {
    if (!$auth || !$isAdmin) { goto('/login?return=/admin/qbo-employees'); return; }
    await load();
  });

  async function load() {
    loading = true; error = ''; message = '';
    try {
      const [emps, qboEmps] = await Promise.all([
        // /api/employees lives in lookup.js; reuse the existing list.
        fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:3000/api'}/employees`, {
          headers: { Authorization: `Bearer ${localStorage.getItem('hg_token')}` },
        }).then(r => r.ok ? r.json() : Promise.reject(new Error(`Employees ${r.status}`))),
        api.qboEmployeesList(),
      ]);
      employees   = emps;
      qboEmployees = qboEmps;
      // Seed drafts to whatever's currently saved.
      drafts = Object.fromEntries(emps.map(e => [e.id, e.qbo_employee_id || '']));
    } catch (e) {
      error = e.message || String(e);
    } finally {
      loading = false;
    }
  }

  function fullName(p) {
    return [p.first_name, p.last_name].filter(Boolean).join(' ') || `Employee #${p.id}`;
  }
  function qboLabel(q) {
    return q.display_name
      || [q.given_name, q.family_name].filter(Boolean).join(' ')
      || `QBO #${q.id}`;
  }

  // Smart suggestion: if a local employee doesn't have a QBO mapping yet,
  // try matching by full name. The mapping page suggests but never auto-saves.
  function suggestionFor(localEmp) {
    const draft = drafts[localEmp.id];
    if (draft) return null;
    if (localEmp.qbo_employee_id) return null;
    const localName = fullName(localEmp).toLowerCase();
    const match = qboEmployees.find(q => qboLabel(q).toLowerCase() === localName);
    return match || null;
  }

  function applySuggestion(localId, qboId) {
    drafts = { ...drafts, [localId]: qboId };
  }

  async function saveOne(localId) {
    error = ''; message = '';
    const next = new Set(saving); next.add(localId); saving = next;
    try {
      const updated = await api.employeeSetQboMapping(localId, drafts[localId] || null);
      employees = employees.map(e => e.id === localId ? { ...e, qbo_employee_id: updated.qbo_employee_id } : e);
      message = `Saved mapping for ${fullName(updated)}.`;
    } catch (e) {
      error = e.message || String(e);
    } finally {
      const next2 = new Set(saving); next2.delete(localId); saving = next2;
    }
  }

  $: anyDirty = employees.some(e =>
    (drafts[e.id] || '') !== (e.qbo_employee_id || ''));
  $: completionCount = employees.filter(e => e.qbo_employee_id).length;
</script>

<svelte:head><title>QBO Employee Mapping — Holm Graphics Admin</title></svelte:head>

<div class="page">
  <h1 class="page-title">QBO Employee Mapping</h1>

  <div class="card intro">
    <p>
      Each Holm Graphics user needs to be linked to their QuickBooks Online
      Employee record before the time-clock can push entries to payroll.
      You only need to do this once per employee — the mapping is stored
      and reused on every Send-to-QuickBooks run.
    </p>
    <p class="muted">
      Mapped: <strong>{completionCount}</strong> / {employees.length}.
      QBO records loaded: <strong>{qboEmployees.length}</strong>.
    </p>
  </div>

  {#if message}<div class="notice ok">{message}</div>{/if}
  {#if error}<div class="notice error">{error}</div>{/if}

  {#if loading}
    <div class="muted">Loading…</div>
  {:else if employees.length === 0}
    <div class="muted">No active employees.</div>
  {:else}
    <table class="map-table">
      <thead>
        <tr>
          <th>Local employee</th>
          <th>QBO Employee</th>
          <th>Status</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {#each employees as emp (emp.id)}
          {@const sug = suggestionFor(emp)}
          {@const draft = drafts[emp.id] ?? ''}
          {@const dirty = (draft || '') !== (emp.qbo_employee_id || '')}
          <tr>
            <td>
              <div class="emp-name">{fullName(emp)}</div>
              <div class="sub">{emp.email || '—'}</div>
            </td>
            <td>
              <select bind:value={drafts[emp.id]} disabled={saving.has(emp.id)}>
                <option value="">— Not linked —</option>
                {#each qboEmployees as q (q.id)}
                  <option value={q.id}>{qboLabel(q)}{q.primary_email ? ' · ' + q.primary_email : ''}</option>
                {/each}
              </select>
              {#if sug}
                <button class="btn xs ghost" type="button"
                        on:click={() => applySuggestion(emp.id, sug.id)}>
                  Suggest: {qboLabel(sug)}
                </button>
              {/if}
            </td>
            <td>
              {#if emp.qbo_employee_id}
                <span class="status linked">linked</span>
              {:else}
                <span class="status none">not linked</span>
              {/if}
            </td>
            <td class="row-actions">
              <button class="btn small primary"
                      disabled={!dirty || saving.has(emp.id)}
                      on:click={() => saveOne(emp.id)}>
                {saving.has(emp.id) ? '…' : 'Save'}
              </button>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>

    {#if anyDirty}
      <p class="muted hint">Click <strong>Save</strong> on each row you changed.</p>
    {/if}
  {/if}
</div>

<style>
  .page { padding: 24px; max-width: 1100px; margin: 0 auto; }
  .page-title {
    font-family: var(--font-display); font-size: 1.6rem;
    letter-spacing: 0.04em; text-transform: uppercase;
    margin: 0 0 18px;
  }
  .card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    padding: 16px 18px;
    margin-bottom: 14px;
  }
  .card p { margin: 0 0 8px; }
  .card p:last-child { margin-bottom: 0; }
  .muted { color: var(--text-muted); font-size: 0.92rem; }

  .notice { padding: 10px 12px; border-radius: var(--radius); margin: 8px 0; font-size: 0.92rem; }
  .notice.ok    { background: rgba(40,167,69,0.12); color: var(--green, #28a745); border: 1px solid rgba(40,167,69,0.3); }
  .notice.error { background: rgba(220,53,69,0.12); color: var(--red,   #dc3545); border: 1px solid rgba(220,53,69,0.3); }

  .map-table { width: 100%; border-collapse: collapse; }
  .map-table th, .map-table td {
    padding: 10px 12px; text-align: left; vertical-align: top;
    border-bottom: 1px solid rgba(255,255,255,0.05);
  }
  .map-table th {
    color: var(--text-muted); font-weight: 600;
    font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.04em;
    border-bottom: 1px solid var(--border);
  }
  .emp-name { font-weight: 600; }
  .sub { color: var(--text-muted); font-size: 0.82rem; margin-top: 2px; }

  .map-table select {
    background: var(--input-bg, var(--surface));
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 6px 10px;
    min-width: 280px;
    font: inherit;
  }

  .status {
    padding: 2px 8px; border-radius: 999px; font-size: 0.78rem;
    text-transform: uppercase; letter-spacing: 0.04em; font-weight: 600;
  }
  .status.linked { background: rgba(40,167,69,0.18); color: var(--green, #28a745); }
  .status.none   { background: rgba(255,255,255,0.08); color: var(--text-muted); }

  .row-actions { white-space: nowrap; }
  .btn {
    padding: 6px 12px; border-radius: var(--radius);
    border: 1px solid var(--border); background: var(--surface);
    color: var(--text); cursor: pointer; font: inherit;
  }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn.primary  { background: var(--accent, #c0392b); color: white; border-color: transparent; }
  .btn.primary:hover:not(:disabled) { filter: brightness(1.1); }
  .btn.ghost    { background: transparent; }
  .btn.small    { padding: 3px 9px; font-size: 0.85rem; }
  .btn.xs       { padding: 2px 8px; font-size: 0.78rem; margin-top: 4px; }

  .hint { margin-top: 12px; }
</style>
