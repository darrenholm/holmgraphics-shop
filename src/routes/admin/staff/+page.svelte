<!-- src/routes/admin/staff/+page.svelte
     Staff contact info: each employee's mobile number (where job-assignment
     texts are sent) and their SkySwitch PBX extension. Admin-gated.

     The cell number feeds the SMS notifier (lib/employee-notifier.js) — an
     employee with no number is simply skipped, no text sent. -->
<script>
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { auth, isAdmin } from '$lib/stores/auth.js';
  import { api } from '$lib/api/client.js';

  let employees = [];
  let loading = true;
  let saving  = new Set(); // employee ids currently saving
  let error = '';
  let message = '';

  // Per-row editable drafts, keyed by employee id.
  let drafts = {}; // { [id]: { phone_number, phone_extension } }

  onMount(async () => {
    if (!$auth || !$isAdmin) { goto('/login?return=/admin/staff'); return; }
    await load();
  });

  async function load() {
    loading = true; error = ''; message = '';
    try {
      employees = await api.employeesList();
      drafts = Object.fromEntries(employees.map(e => [e.id, {
        phone_number: e.phone_number || '',
        phone_extension: e.phone_extension || '',
      }]));
    } catch (e) {
      error = e.message || String(e);
    } finally {
      loading = false;
    }
  }

  function fullName(p) {
    return [p.first_name, p.last_name].filter(Boolean).join(' ') || `Employee #${p.id}`;
  }

  function isDirty(e) {
    const d = drafts[e.id] || {};
    return (d.phone_number || '') !== (e.phone_number || '')
        || (d.phone_extension || '') !== (e.phone_extension || '');
  }

  async function saveOne(id) {
    error = ''; message = '';
    const next = new Set(saving); next.add(id); saving = next;
    try {
      const updated = await api.employeeSetContact(id, drafts[id]);
      employees = employees.map(e => e.id === id
        ? { ...e, phone_number: updated.phone_number, phone_extension: updated.phone_extension }
        : e);
      drafts = { ...drafts, [id]: {
        phone_number: updated.phone_number || '',
        phone_extension: updated.phone_extension || '',
      } };
      message = `Saved ${fullName(updated)}.`;
    } catch (e) {
      error = e.message || String(e);
    } finally {
      const n = new Set(saving); n.delete(id); saving = n;
    }
  }

  $: withPhone = employees.filter(e => e.phone_number).length;
</script>

<svelte:head><title>Staff Contact — Holm Graphics Admin</title></svelte:head>

<div class="page">
  <h1 class="page-title">Staff Contact</h1>

  <div class="card intro">
    <p>
      Set each employee's <strong>mobile number</strong> and <strong>extension</strong>.
      The mobile number is where a text is sent when a job is assigned to that
      person — anyone without a number simply isn't texted.
    </p>
    <p class="muted">
      Textable: <strong>{withPhone}</strong> / {employees.length} employees have a mobile number.
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
          <th>Employee</th>
          <th>Mobile number</th>
          <th>Extension</th>
          <th>Texts</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {#each employees as emp (emp.id)}
          <tr>
            <td>
              <div class="emp-name">{fullName(emp)}</div>
              <div class="sub">{emp.email || '—'}</div>
            </td>
            <td>
              <input
                type="tel"
                inputmode="tel"
                placeholder="519-555-0123"
                bind:value={drafts[emp.id].phone_number}
                disabled={saving.has(emp.id)} />
            </td>
            <td>
              <input
                class="ext"
                type="text"
                inputmode="numeric"
                placeholder="104"
                bind:value={drafts[emp.id].phone_extension}
                disabled={saving.has(emp.id)} />
            </td>
            <td>
              {#if emp.phone_number}
                <span class="status on">on</span>
              {:else}
                <span class="status off">no number</span>
              {/if}
            </td>
            <td class="row-actions">
              <button class="btn small primary"
                      disabled={!isDirty(emp) || saving.has(emp.id)}
                      on:click={() => saveOne(emp.id)}>
                {saving.has(emp.id) ? '…' : 'Save'}
              </button>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</div>

<style>
  .page { padding: 24px; max-width: 1000px; margin: 0 auto; }
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
    padding: 10px 12px; text-align: left; vertical-align: middle;
    border-bottom: 1px solid rgba(255,255,255,0.05);
  }
  .map-table th {
    color: var(--text-muted); font-weight: 600;
    font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.04em;
    border-bottom: 1px solid var(--border);
  }
  .emp-name { font-weight: 600; }
  .sub { color: var(--text-muted); font-size: 0.82rem; margin-top: 2px; }

  .map-table input {
    background: var(--input-bg, var(--surface));
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 6px 10px;
    font: inherit;
    min-width: 160px;
  }
  .map-table input.ext { min-width: 80px; width: 90px; }

  .status {
    padding: 2px 8px; border-radius: 999px; font-size: 0.78rem;
    text-transform: uppercase; letter-spacing: 0.04em; font-weight: 600;
  }
  .status.on  { background: rgba(40,167,69,0.18); color: var(--green, #28a745); }
  .status.off { background: rgba(255,255,255,0.08); color: var(--text-muted); }

  .row-actions { white-space: nowrap; }
  .btn {
    padding: 6px 12px; border-radius: var(--radius);
    border: 1px solid var(--border); background: var(--surface);
    color: var(--text); cursor: pointer; font: inherit;
  }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn.primary  { background: var(--accent, #c0392b); color: white; border-color: transparent; }
  .btn.primary:hover:not(:disabled) { filter: brightness(1.1); }
  .btn.small    { padding: 3px 9px; font-size: 0.85rem; }
</style>
