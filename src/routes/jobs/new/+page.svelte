<!-- src/routes/jobs/new/+page.svelte -->
<script>
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import { api } from '$lib/api/client.js';
  import { isStaff } from '$lib/stores/auth.js';
  import { ensureJobFolder } from '$lib/files/filesBridgeClient.js';

  let clients = [];
  let projectTypes = [];
  let statuses = [];
  let employees = [];
  let loading = true;
  let submitting = false;
  let searchTimeout = null;
  let searching = false;

  // Client search
  let clientSearch = '';
  let showClientDropdown = false;
  let selectedClientName = '';

  // New client form
  let addingClient = false;
  let savingClient = false;
  let newClient = { company: '', first_name: '', last_name: '', email: '' };

  // Measurements — multiple rows
  let measurements = [{ item: '', width: '', height: '', qty: '', notes: '' }];

  let form = {
    project_name: '',
    client_id: '',
    project_type_id: '',
    status_id: '2',
    assigned_employee_id: '',
    due_date: '',
    contact: '',
    contact_phone: '',
    contact_email: '',
  };

  let errors = {};

  onMount(async () => {
    if (!$isStaff) { goto('/dashboard'); return; }
    try {
      [projectTypes, statuses, employees] = await Promise.all([
        api.getProjectTypes(), api.getStatuses(), api.getEmployees()
      ]);
    } catch (e) { console.error(e); }
    finally { loading = false; }
  });

  async function handleClientSearch() {
    if (clientSearch.length < 2) { clients = []; return; }
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(async () => {
      searching = true;
      try {
        clients = await api.getClients(clientSearch);
      } catch(e) { console.error(e); }
      finally { searching = false; }
    }, 300);
  }

  $: filteredClients = clients.slice(0, 50);

  function selectClient(c) {
    form.client_id = c.id;
    selectedClientName = c.company_name || `${c.first_name} ${c.last_name}`.trim();
    clientSearch = selectedClientName;
    showClientDropdown = false;
  }

  function clearClient() {
    form.client_id = '';
    selectedClientName = '';
    clientSearch = '';
    clients = [];
  }

  async function saveNewClient() {
    if (!newClient.company && !newClient.last_name) {
      alert('Enter a company name or last name');
      return;
    }
    savingClient = true;
    try {
      const res = await api.createClient(newClient);
      clients = await api.getClients(newClient.company || newClient.last_name);
      const created = clients.find(c => c.id === res.id) ||
        { id: res.id, company_name: newClient.company, first_name: newClient.first_name, last_name: newClient.last_name };
      selectClient(created);
      addingClient = false;
      newClient = { company: '', first_name: '', last_name: '', email: '' };
    } catch (e) { alert(e.message); }
    finally { savingClient = false; }
  }

  function addMeasurementRow() {
    measurements = [...measurements, { item: '', width: '', height: '', qty: '', notes: '' }];
  }

  function removeMeasurementRow(i) {
    measurements = measurements.filter((_, idx) => idx !== i);
  }

  function validate() {
    errors = {};
    if (!form.project_name.trim()) errors.project_name = 'Job name is required';
    if (!form.client_id) errors.client_id = 'Select a client';
    return Object.keys(errors).length === 0;
  }

  async function handleSubmit() {
    if (!validate()) return;
    submitting = true;
    try {
      const newJob = await api.createProject(form);
      const validMeasurements = measurements.filter(m => m.item || m.width || m.height);
      for (const m of validMeasurements) {
        await api.addMeasurement(newJob.id, m);
      }
      // Best-effort: create the matching folder on L: drive via files-bridge.
      // Silent failure — new job is already saved; folder can be created
      // later from the job's Files card if the bridge is unreachable.
      if (selectedClientName && newJob?.id) {
        try {
          await ensureJobFolder(selectedClientName, newJob.id);
        } catch (err) {
          console.warn('[files-bridge] folder create failed:', err?.message || err);
        }
      }
      goto(`/jobs/${newJob.id}`);
    } catch (e) {
      alert('Failed to create job: ' + e.message);
    } finally {
      submitting = false;
    }
  }
</script>

<svelte:head><title>New Job — Holm Graphics</title></svelte:head>

<div class="page">
  <a href="/dashboard" class="back-link">← Job Board</a>
  <h1 class="page-title">New Job</h1>
  <p class="page-sub">Create a project and link it to a client</p>

  {#if loading}
    <div class="loading-state"><div class="loading-spinner"></div> Loading…</div>
  {:else}
    <div class="form-layout">

      <!-- Job Details -->
      <section class="card">
        <h2 class="section-title">Job Details</h2>

        <div class="form-group">
          <label for="project_name">Job Description *</label>
          <input id="project_name" type="text" bind:value={form.project_name} placeholder="e.g. Smith Trucking — Vehicle Wrap" />
          {#if errors.project_name}<span class="field-error">{errors.project_name}</span>{/if}
        </div>

        <!-- Client -->
        <div class="form-group">
          <label>Client *</label>
          {#if form.client_id && !addingClient}
            <div class="client-selected-row">
              <span class="client-selected-name">✓ {selectedClientName}</span>
              <button class="btn-link" on:click={clearClient}>Change</button>
            </div>
          {:else if !addingClient}
            <div class="client-search-wrap">
              <input
                type="text"
                bind:value={clientSearch}
                on:input={handleClientSearch}
                on:focus={() => showClientDropdown = true}
                on:blur={() => setTimeout(() => showClientDropdown = false, 200)}
                placeholder="Type 2+ characters to search clients…"
              />
              {#if showClientDropdown}
                {#if searching}
                  <ul class="client-dropdown">
                    <li><div class="dropdown-msg">Searching…</div></li>
                  </ul>
                {:else if clientSearch.length < 2}
                  <ul class="client-dropdown">
                    <li><div class="dropdown-msg">Type at least 2 characters to search</div></li>
                  </ul>
                {:else if filteredClients.length > 0}
                  <ul class="client-dropdown">
                    {#each filteredClients as c}
                      <li>
                        <button on:mousedown={() => selectClient(c)}>
                          <span class="client-name">{c.company_name || `${c.first_name} ${c.last_name}`.trim()}</span>
                          {#if c.company_name && (c.first_name || c.last_name)}
                            <span class="client-contact">{c.first_name} {c.last_name}</span>
                          {/if}
                        </button>
                      </li>
                    {/each}
                  </ul>
                {:else if clientSearch.length >= 2}
                  <ul class="client-dropdown">
                    <li><div class="dropdown-msg">No clients found for "{clientSearch}"</div></li>
                  </ul>
                {/if}
              {/if}
            </div>
            <button class="btn-link add-client-link" on:click={() => addingClient = true}>+ Add new client</button>
          {/if}
          {#if errors.client_id}<span class="field-error">{errors.client_id}</span>{/if}
        </div>

        <!-- Inline new client form -->
        {#if addingClient}
          <div class="new-client-form">
            <h3 class="new-client-title">New Client</h3>
            <div class="form-row">
              <div class="form-group">
                <label>Company Name</label>
                <input bind:value={newClient.company} placeholder="Company Inc." />
              </div>
              <div class="form-group">
                <label>Email</label>
                <input type="email" bind:value={newClient.email} placeholder="email@example.com" />
              </div>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label>First Name</label>
                <input bind:value={newClient.first_name} placeholder="First" />
              </div>
              <div class="form-group">
                <label>Last Name</label>
                <input bind:value={newClient.last_name} placeholder="Last" />
              </div>
            </div>
            <div class="new-client-actions">
              <button class="btn btn-ghost" on:click={() => addingClient = false}>Cancel</button>
              <button class="btn btn-primary" on:click={saveNewClient} disabled={savingClient}>
                {savingClient ? 'Saving…' : 'Save Client'}
              </button>
            </div>
          </div>
        {/if}

        <div class="form-row">
          <div class="form-group">
            <label>Job Type</label>
            <select bind:value={form.project_type_id}>
              <option value="">Select type…</option>
              {#each projectTypes as t}
                <option value={t.id}>{t.type_name || t.project_type}</option>
              {/each}
            </select>
          </div>
          <div class="form-group">
            <label>Initial Status</label>
            <select bind:value={form.status_id}>
              <option value="">Select status…</option>
              {#each statuses as s}
                <option value={s.id}>{s.status_name}</option>
              {/each}
            </select>
          </div>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label>Assigned To</label>
            <select bind:value={form.assigned_employee_id}>
              <option value="">Unassigned</option>
              {#each employees as e}
                <option value={e.id}>{e.first_name} {e.last_name}</option>
              {/each}
            </select>
          </div>
          <div class="form-group">
            <label>Due Date</label>
            <input type="date" bind:value={form.due_date} />
          </div>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label>Contact Name</label>
            <input bind:value={form.contact} placeholder="On-site contact" />
          </div>
          <div class="form-group">
            <label>Contact Phone</label>
            <input bind:value={form.contact_phone} placeholder="519-000-0000" />
          </div>
        </div>

        <div class="form-group">
          <label>Contact Email</label>
          <input type="email" bind:value={form.contact_email} placeholder="contact@example.com" />
        </div>
      </section>

      <!-- Measurements -->
      <section class="card">
        <h2 class="section-title">
          Measurements
          <span class="optional">optional</span>
        </h2>

        <table class="meas-table">
          <thead>
            <tr>
              <th>Item / Description</th>
              <th>W (in)</th>
              <th>H (in)</th>
              <th>Qty</th>
              <th>Notes</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {#each measurements as m, i}
              <tr>
                <td><input bind:value={m.item} placeholder="e.g. Front door sign" /></td>
                <td><input type="number" bind:value={m.width} placeholder='48' /></td>
                <td><input type="number" bind:value={m.height} placeholder='24' /></td>
                <td><input type="number" bind:value={m.qty} placeholder='1' min="1" /></td>
                <td><input bind:value={m.notes} placeholder="Material, finish…" /></td>
                <td>
                  {#if measurements.length > 1}
                    <button class="remove-row" on:click={() => removeMeasurementRow(i)}>✕</button>
                  {/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
        <button class="btn btn-ghost add-row-btn" on:click={addMeasurementRow}>+ Add Row</button>
      </section>

      <!-- Actions -->
      <div class="form-actions">
        <a href="/dashboard" class="btn btn-ghost">Cancel</a>
        <button class="btn btn-primary" on:click={handleSubmit} disabled={submitting}>
          {submitting ? 'Creating…' : 'Create Job →'}
        </button>
      </div>

    </div>
  {/if}
</div>

<style>
  .page { padding: 28px 32px; max-width: 900px; }

  .back-link {
    font-family: var(--font-display); font-size: 0.8rem;
    letter-spacing: 0.06em; color: var(--text-muted);
    text-transform: uppercase; display: inline-block; margin-bottom: 12px;
  }
  .back-link:hover { color: var(--red); }

  .page-title {
    font-family: var(--font-display); font-size: 2rem; font-weight: 900;
    letter-spacing: 0.04em; text-transform: uppercase; color: var(--text);
  }
  .page-sub { font-size: 0.88rem; color: var(--text-muted); margin-bottom: 28px; margin-top: 4px; }

  .form-layout { display: flex; flex-direction: column; gap: 16px; }

  .section-title {
    font-family: var(--font-display); font-size: 0.78rem; font-weight: 700;
    letter-spacing: 0.14em; text-transform: uppercase; color: var(--text-muted);
    margin-bottom: 16px; padding-bottom: 10px; border-bottom: 1px solid var(--border);
    display: flex; align-items: center; gap: 10px;
  }
  .optional { font-size: 0.68rem; color: var(--text-dim); font-weight: 400; letter-spacing: 0.1em; }

  .form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }

  .client-search-wrap { position: relative; }
  .client-dropdown {
    position: absolute; top: calc(100% + 4px); left: 0; right: 0;
    background: var(--surface); border: 1px solid var(--border);
    border-radius: var(--radius); list-style: none; z-index: 50;
    box-shadow: var(--shadow-lg); max-height: 280px; overflow-y: auto;
  }
  .client-dropdown li button {
    display: flex; flex-direction: column; width: 100%;
    padding: 10px 14px; background: none; border: none;
    cursor: pointer; text-align: left; transition: background 0.12s;
    border-bottom: 1px solid var(--border);
  }
  .client-dropdown li:last-child button { border-bottom: none; }
  .client-dropdown li button:hover { background: var(--surface-2); }
  .client-name { font-size: 0.95rem; color: var(--text); font-weight: 500; }
  .client-contact { font-size: 0.78rem; color: var(--text-muted); margin-top: 2px; }
  .dropdown-msg { padding: 12px 14px; font-size: 0.85rem; color: var(--text-muted); }

  .client-selected-row {
    display: flex; align-items: center; gap: 12px;
    padding: 9px 12px; background: var(--surface-2);
    border: 1px solid var(--green); border-radius: var(--radius);
  }
  .client-selected-name { font-size: 0.95rem; color: var(--text); font-weight: 500; flex: 1; }
  .btn-link {
    background: none; border: none; cursor: pointer;
    color: var(--red); font-size: 0.82rem; font-family: var(--font-display);
    font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase;
    padding: 0; transition: opacity 0.15s;
  }
  .btn-link:hover { opacity: 0.7; }
  .add-client-link { margin-top: 6px; display: block; }

  .new-client-form {
    background: var(--surface-2); border: 1px solid var(--border);
    border-radius: var(--radius-lg); padding: 16px; margin-bottom: 16px;
  }
  .new-client-title {
    font-family: var(--font-display); font-size: 0.8rem; font-weight: 700;
    letter-spacing: 0.1em; text-transform: uppercase;
    color: var(--text-muted); margin-bottom: 12px;
  }
  .new-client-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px; }

  .field-error { font-size: 0.78rem; color: #dc2626; margin-top: 3px; display: block; }

  .meas-table { width: 100%; border-collapse: collapse; margin-bottom: 10px; }
  .meas-table th {
    text-align: left; padding: 6px 8px;
    font-family: var(--font-display); font-size: 0.72rem;
    letter-spacing: 0.1em; text-transform: uppercase;
    color: var(--text-muted); border-bottom: 2px solid var(--border);
    background: var(--surface-2);
  }
  .meas-table td { padding: 4px 4px; border-bottom: 1px solid var(--border); }
  .meas-table td input { padding: 6px 8px; font-size: 0.88rem; }
  .meas-table tr:last-child td { border-bottom: none; }
  .remove-row {
    background: none; border: none; cursor: pointer;
    color: var(--text-dim); font-size: 0.8rem; padding: 4px 8px;
    transition: color 0.15s;
  }
  .remove-row:hover { color: #dc2626; }
  .add-row-btn { margin-top: 4px; }

  .form-actions { display: flex; justify-content: flex-end; gap: 10px; padding-top: 8px; }

  .loading-state {
    display: flex; align-items: center; gap: 12px;
    padding: 48px; color: var(--text-muted); font-size: 0.9rem;
  }
  .loading-spinner {
    width: 20px; height: 20px; border: 2px solid var(--border);
    border-top-color: var(--red); border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  @media (max-width: 700px) {
    .page { padding: 16px; }
    .form-row { grid-template-columns: 1fr; }
    .meas-table { font-size: 0.8rem; }
  }
</style>
