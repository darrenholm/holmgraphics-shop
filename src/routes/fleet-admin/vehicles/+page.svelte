<!--
  /fleet-admin/vehicles — admin list of fleet vehicles with current
  doc-status dots per (ownership / insurance / inspection). CVOR is
  operator-level and lives on the /fleet-admin landing. Click a row to drill
  into the detail page; "+ Add vehicle" opens an inline form panel.
-->
<script>
  import { onMount } from 'svelte';
  import { fleetApi } from '$lib/api/fleet-client.js';
  import { validateVin } from '$lib/utils/vin.js';

  let vehicles = [];
  let loading = true;
  let loadError = '';

  let showAdd = false;
  let addForm = newVehicleForm();
  let addError = '';
  let addSubmitting = false;

  function newVehicleForm() {
    return {
      unit_number: '', type: 'truck',
      make: '', model: '', year: '',
      license_plate: '', vin: '', notes: ''
    };
  }

  onMount(load);

  async function load() {
    loading = true;
    loadError = '';
    try {
      const data = await fleetApi.listVehicles();
      vehicles = data.vehicles || [];
    } catch (e) {
      loadError = e.message;
    } finally {
      loading = false;
    }
  }

  async function submitAdd() {
    if (addSubmitting) return;
    addError = '';
    if (!addForm.unit_number.trim()) { addError = 'Unit number is required.'; return; }
    if (!['truck', 'trailer'].includes(addForm.type)) { addError = 'Type must be truck or trailer.'; return; }
    addSubmitting = true;
    try {
      const payload = {
        unit_number:    addForm.unit_number.trim(),
        type:           addForm.type,
        make:           addForm.make.trim() || null,
        model:          addForm.model.trim() || null,
        year:           addForm.year ? parseInt(addForm.year, 10) : null,
        license_plate:  addForm.license_plate.trim() || null,
        vin:            addForm.vin.trim() || null,
        notes:          addForm.notes.trim() || null
      };
      await fleetApi.createVehicle(payload);
      addForm = newVehicleForm();
      showAdd = false;
      await load();
    } catch (e) {
      addError = e.message;
    } finally {
      addSubmitting = false;
    }
  }

  const DOT_LABEL = {
    valid:         'Valid',
    expiring_soon: 'Expires soon',
    expired:       'Expired',
    missing:       'Not on file'
  };
  function dotTitle(docType, doc) {
    if (!doc) return `${docType}: not applicable`;
    const label = DOT_LABEL[doc.status] || doc.status;
    return doc.expiry_date
      ? `${docType}: ${label} (exp ${doc.expiry_date})`
      : `${docType}: ${label}`;
  }
</script>

<svelte:head><title>Fleet — Vehicles · Holm Graphics</title></svelte:head>

<div class="page">
  <header class="page-head">
    <div>
      <h1>Fleet — Vehicles</h1>
      <p class="hint">Manage roadside documents for trucks and trailers. Drivers access them at <a href="/fleet-docs">/fleet-docs</a>.</p>
    </div>
    <button class="btn primary" on:click={() => (showAdd = !showAdd)}>
      {showAdd ? 'Close' : '+ Add vehicle'}
    </button>
  </header>

  {#if showAdd}
    <section class="add-card">
      <h2>Add vehicle</h2>
      <div class="form-grid">
        <label><span>Unit number <em>*</em></span><input type="text" bind:value={addForm.unit_number} placeholder="T-04" autocomplete="off" /></label>
        <label><span>Type <em>*</em></span>
          <select bind:value={addForm.type}>
            <option value="truck">Truck</option>
            <option value="trailer">Trailer</option>
          </select>
        </label>
        <label><span>Year</span><input type="number" bind:value={addForm.year} min="1900" max="2099" /></label>
        <label><span>Make</span><input type="text" bind:value={addForm.make} /></label>
        <label><span>Model</span><input type="text" bind:value={addForm.model} /></label>
        <label><span>Plate</span><input type="text" bind:value={addForm.license_plate} /></label>
        <label class="span2">
          <span>VIN</span>
          <input type="text" bind:value={addForm.vin} maxlength="17" autocapitalize="characters" spellcheck="false" />
          {#if addForm.vin && addForm.vin.trim()}
            {@const v = validateVin(addForm.vin)}
            {#if !v.valid}
              <span class="vin-warn">⚠ {v.reason}</span>
            {:else}
              <span class="vin-ok">✓ Valid VIN</span>
            {/if}
          {/if}
        </label>
        <label class="span2"><span>Notes</span><textarea rows="2" bind:value={addForm.notes}></textarea></label>
      </div>
      {#if addError}<p class="alert error">{addError}</p>{/if}
      <div class="form-actions">
        <button class="btn primary" on:click={submitAdd} disabled={addSubmitting}>{addSubmitting ? 'Saving…' : 'Save vehicle'}</button>
        <button class="link-btn" on:click={() => { showAdd = false; addError = ''; addForm = newVehicleForm(); }}>Cancel</button>
      </div>
    </section>
  {/if}

  {#if loading}
    <p class="muted">Loading…</p>
  {:else if loadError}
    <p class="alert error">{loadError}</p>
  {:else if vehicles.length === 0}
    <p class="muted empty">No vehicles yet. Click <strong>+ Add vehicle</strong> to start.</p>
  {:else}
    <table class="vehicles">
      <thead>
        <tr>
          <th>Unit</th>
          <th>Type</th>
          <th>Plate</th>
          <th>VIN</th>
          <th class="dot-col" title="Ownership">O</th>
          <th class="dot-col" title="Insurance">I</th>
          <th class="dot-col" title="Annual inspection">A</th>
        </tr>
      </thead>
      <tbody>
        {#each vehicles as v (v.id)}
          <tr on:click={() => window.location.assign(`/fleet-admin/vehicles/${v.id}`)} class:inactive={!v.active}>
            <td class="unit">{v.unit_number}</td>
            <td class="type">{v.type === 'truck' ? 'Truck' : 'Trailer'}</td>
            <td>{v.license_plate || ''}</td>
            <td class="vin">{v.vin || ''}</td>
            <td class="dot-col" title={dotTitle('ownership', v.documents.ownership)}>
              <span class="dot dot-{v.documents.ownership.status}"></span>
            </td>
            <td class="dot-col" title={dotTitle('insurance', v.documents.insurance)}>
              <span class="dot dot-{v.documents.insurance.status}"></span>
            </td>
            <td class="dot-col" title={dotTitle('inspection', v.documents.inspection)}>
              <span class="dot dot-{v.documents.inspection.status}"></span>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
    <p class="legend hint small">
      <span class="dot dot-valid"></span> Valid &nbsp;
      <span class="dot dot-expiring_soon"></span> Expires within 30 days &nbsp;
      <span class="dot dot-expired"></span> Expired &nbsp;
      <span class="dot dot-missing"></span> Not on file
    </p>
  {/if}
</div>

<style>
  .page { max-width: 70rem; margin: 0 auto; padding: 1.5rem 1rem 4rem; }

  .page-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; margin-bottom: 1.5rem; }
  .page-head h1 { margin: 0 0 0.2rem; }
  .hint { color: #666; font-size: 0.92rem; margin: 0; }
  .muted { color: #888; }
  .small { font-size: 0.85rem; }
  .empty { padding: 2rem 0; text-align: center; }

  .add-card { background: white; border: 1px solid #e4e4e7; border-radius: 0.5rem; padding: 1.25rem; margin-bottom: 1.5rem; }
  .add-card h2 { font-size: 1.05rem; margin: 0 0 0.85rem; }
  .form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; }
  .form-grid label { display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.9rem; color: #444; }
  .form-grid .span2 { grid-column: span 2; }
  .form-grid input, .form-grid select, .form-grid textarea {
    padding: 0.5rem 0.65rem; border: 1px solid #d4d4d8; border-radius: 0.35rem; font-size: 0.95rem;
  }
  .form-grid input:focus, .form-grid select:focus, .form-grid textarea:focus {
    outline: 2px solid #c01818; outline-offset: 1px; border-color: transparent;
  }
  em { color: #c01818; font-style: normal; }
  .form-actions { display: flex; align-items: center; gap: 0.85rem; margin-top: 0.85rem; }

  table.vehicles { width: 100%; border-collapse: collapse; background: white; border: 1px solid #e4e4e7; border-radius: 0.5rem; overflow: hidden; }
  thead th { background: #f7f7f8; padding: 0.6rem 0.75rem; text-align: left; font-size: 0.85rem; color: #444; border-bottom: 1px solid #e4e4e7; }
  tbody td { padding: 0.75rem; border-bottom: 1px dashed #f0f0f0; font-size: 0.95rem; }
  tbody tr { cursor: pointer; }
  tbody tr:hover { background: #fafafa; }
  tbody tr.inactive { opacity: 0.55; }
  tbody tr.inactive .unit::after { content: ' (inactive)'; font-size: 0.8em; color: #888; font-weight: 400; }
  .unit { font-weight: 700; font-size: 1.05rem; }
  .vin { font-family: ui-monospace, monospace; font-size: 0.85rem; color: #555; }
  .dot-col { text-align: center; width: 3rem; }

  .dot { display: inline-block; width: 0.85rem; height: 0.85rem; border-radius: 50%; background: #ccc; vertical-align: middle; }
  .dot-valid { background: #1f6b34; }
  .dot-expiring_soon { background: #d9a401; }
  .dot-expired { background: #b91c1c; }
  .dot-missing { background: #c4c4c8; }
  .dot-na { background: #f0f0f0; border: 1px dashed #c4c4c8; }

  .legend { margin: 1rem 0 0; display: flex; align-items: center; flex-wrap: wrap; gap: 0.5rem 1rem; }
  .legend .dot { margin-right: 0.25rem; }

  .btn { padding: 0.65rem 1.1rem; background: #c01818; color: white; border: none; border-radius: 0.4rem; font-weight: 600; cursor: pointer; font-size: 0.95rem; }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn.primary { background: #c01818; }
  .link-btn { background: none; border: 0; color: #c01818; cursor: pointer; font-size: 0.9rem; }

  .alert { padding: 0.5rem 0.75rem; border-radius: 0.3rem; margin: 0.5rem 0; font-size: 0.9rem; }
  .alert.error { background: #fee; color: #b00; }

  .vin-warn { font-size: 0.82rem; color: #92400e; margin-top: 0.2rem; }
  .vin-ok   { font-size: 0.82rem; color: #1f6b34; margin-top: 0.2rem; }
</style>
