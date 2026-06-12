<!--
  /fleet-admin/vehicles/[id] — admin detail view.

  Layout:
    - Vehicle details card (editable; Save / Cancel)
    - Three (or two for trailers) document sections — Ownership / Insurance / CVOR
    - Each section shows the current document (status, dates, uploader,
      thumbnail/preview) and exposes Upload-new + View-history.
-->
<script>
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { fleetApi } from '$lib/api/fleet-client.js';
  import { validateVin } from '$lib/utils/vin.js';

  let vehicleId = '';

  // Telematics (Phase 2) — Smartcar link state for this vehicle.
  let smartcar = { configured: false, linked: false, link: null, mode: 'test' };
  let smartcarBusy = false;
  let smartcarMsg  = '';
  let smartcarError = '';
  $: vehicleId = $page.params.id;

  let loading = true;
  let loadError = '';
  let vehicle = null;
  let documents = { ownership:  { current: null, history: [] },
                    insurance:  { current: null, history: [] },
                    inspection: { current: null, history: [] } };

  // Vehicle edit state
  let editing = false;
  let editForm = {};
  let editError = '';
  let editSaving = false;

  // Per-section upload state
  let uploadingType = null;          // 'ownership' | 'insurance' | 'inspection' | null
  // bind:files keeps Svelte state in sync with the native input. If we only
  // tracked uploadFile via on:change, resetting it on open/cancel would
  // leave the input visually showing the old filename — causing a false
  // "file is selected" impression and a "Pick a file first." error.
  let uploadFiles = null;
  $: uploadFile = uploadFiles?.[0] || null;
  let uploadIssued = '';
  let uploadExpiry = '';
  let uploadNotes = '';
  let uploadError = '';
  let uploadSubmitting = false;
  let uploadWarn = '';

  // History expansion per section
  let historyOpen = { ownership: false, insurance: false, inspection: false };

  // ─── Finance / lease state ──────────────────────────────────────────
  // Sidecar table loaded after the vehicle. Three modes:
  //   owned    — purchased outright, all financial fields optional
  //   financed — bank loan, monthly_payment + term_months relevant
  //   leased   — end_date required + residual + mileage allowance
  // Empty placeholder is returned from the API as { _new: true } when
  // no row exists yet, so the card always has something to render.
  let finance = null;
  let financeEditing = false;
  let financeForm = {};
  let financeSaving = false;
  let financeError = '';

  async function loadFinance() {
    try { finance = await fleetApi.getVehicleFinance(vehicleId); }
    catch (e) { console.warn('finance load failed:', e); finance = null; }
  }
  function startEditFinance() {
    financeError = '';
    financeForm = {
      acquisition_type:      finance?.acquisition_type   || 'owned',
      acquisition_date:      finance?.acquisition_date   || '',
      lender:                finance?.lender             || '',
      account_number:        finance?.account_number     || '',
      purchase_price:        finance?.purchase_price     ?? '',
      down_payment:          finance?.down_payment       ?? '',
      monthly_payment:       finance?.monthly_payment    ?? '',
      term_months:           finance?.term_months        ?? '',
      interest_rate:         finance?.interest_rate      ?? '',
      start_date:            finance?.start_date         || '',
      end_date:              finance?.end_date           || '',
      residual_value:        finance?.residual_value     ?? '',
      mileage_allowance_km:  finance?.mileage_allowance_km ?? '',
      excess_mileage_charge: finance?.excess_mileage_charge ?? '',
      notes:                 finance?.notes              || '',
    };
    financeEditing = true;
  }
  async function saveFinance() {
    financeError = ''; financeSaving = true;
    try {
      finance = await fleetApi.saveVehicleFinance(vehicleId, financeForm);
      financeEditing = false;
    } catch (e) {
      financeError = e.message || 'Failed to save.';
    } finally {
      financeSaving = false;
    }
  }
  async function clearFinance() {
    if (!confirm('Clear all finance/lease details for this vehicle?')) return;
    try {
      await fleetApi.clearVehicleFinance(vehicleId);
      finance = null;
      financeEditing = false;
      await loadFinance();
    } catch (e) { financeError = e.message; }
  }
  function fmtMoney(v) {
    if (v == null || v === '') return '—';
    return `$${Number(v).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  function fmtDate(v) {
    if (!v) return '—';
    return new Date(v + 'T12:00:00Z').toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' });
  }
  // Days until lease/finance ends — drives the colored warning pill.
  function daysUntil(iso) {
    if (!iso) return null;
    const ms = new Date(iso + 'T12:00:00Z') - new Date();
    return Math.ceil(ms / 86400000);
  }
  $: financeExpiringSoon = (() => {
    if (!finance || !finance.end_date) return null;
    const d = daysUntil(finance.end_date);
    if (d == null) return null;
    if (d < 0)  return { cls: 'expired', label: `Ended ${-d}d ago` };
    if (d <= 90) return { cls: 'warn',    label: `Ends in ${d}d` };
    return null;
  })();
  function acqLabel(t) {
    switch (t) {
      case 'financed': return 'Financed';
      case 'leased':   return 'Leased';
      default:         return 'Owned';
    }
  }

  // Preview blob URLs we created (one per doc id) — revoked on unmount.
  const blobUrls = new Map();

  onMount(() => {
    load();
    // Read smartcar status flash from the OAuth callback redirect.
    const params = new URLSearchParams(window.location.search);
    if (params.get('smartcar') === 'connected') smartcarMsg = 'Smartcar link created.';
    if (params.get('smartcar_error')) smartcarError = params.get('smartcar_error');
  });

  async function load() {
    loading = true; loadError = '';
    try {
      const data = await fleetApi.getVehicle(vehicleId);
      vehicle = data.vehicle;
      documents = data.documents;
      // Fire-and-forget the telematics lookup so it doesn't block the page.
      fleetApi.getVehicleSmartcar(vehicleId).then((sc) => { smartcar = sc || smartcar; }).catch(() => {});
      // Same for finance — sidecar table, optional, don't block render.
      loadFinance();
    } catch (e) {
      loadError = e.message;
    } finally {
      loading = false;
    }
  }

  async function startSmartcarConnect() {
    if (smartcarBusy) return;
    smartcarBusy = true; smartcarError = ''; smartcarMsg = '';
    try {
      const { url } = await fleetApi.smartcarConnectUrl(vehicleId);
      window.location.href = url;            // Smartcar will redirect back to /fleet-admin/vehicles/[id]?smartcar=connected
    } catch (e) {
      smartcarError = e.message;
      smartcarBusy  = false;
    }
  }

  async function disconnectSmartcar() {
    if (smartcarBusy) return;
    if (!window.confirm('Disconnect this vehicle from Smartcar? You can reconnect later by re-authorizing.')) return;
    smartcarBusy = true; smartcarError = ''; smartcarMsg = '';
    try {
      await fleetApi.disconnectVehicleSmartcar(vehicleId);
      smartcar = { ...smartcar, linked: false, link: null };
      smartcarMsg = 'Disconnected.';
    } catch (e) {
      smartcarError = e.message;
    } finally {
      smartcarBusy = false;
    }
  }

  function startEdit() {
    editForm = { ...vehicle, year: vehicle.year ?? '', active: !!vehicle.active };
    editing = true;
    editError = '';
  }
  async function saveEdit() {
    if (editSaving) return;
    editSaving = true; editError = '';
    try {
      const patch = {};
      for (const f of ['unit_number','type','make','model','license_plate','vin','notes','active']) {
        if (editForm[f] !== vehicle[f]) patch[f] = editForm[f] === '' ? null : editForm[f];
      }
      const y = editForm.year === '' ? null : parseInt(editForm.year, 10);
      if (y !== vehicle.year) patch.year = y;
      if (Object.keys(patch).length === 0) { editing = false; return; }
      const updated = await fleetApi.updateVehicle(vehicleId, patch);
      vehicle = updated;
      editing = false;
    } catch (e) {
      editError = e.message;
    } finally {
      editSaving = false;
    }
  }

  function openUpload(docType) {
    uploadingType = docType;
    uploadFiles = null;
    uploadIssued = '';
    uploadExpiry = '';
    uploadNotes = '';
    uploadError = '';
    uploadWarn = '';
  }
  function closeUpload() {
    uploadingType = null;
    uploadFiles = null;
    uploadError = '';
    uploadWarn = '';
  }
  function recomputeWarn() {
    uploadWarn = '';
    if (uploadExpiry) {
      const today = new Date(); today.setHours(0,0,0,0);
      if (new Date(uploadExpiry) < today) {
        uploadWarn = `Heads-up: this document is already expired as of ${uploadExpiry}.`;
      }
    }
  }
  async function submitUpload() {
    if (uploadSubmitting) return;
    uploadError = '';
    if (!uploadFile) { uploadError = 'Pick a file first.'; return; }
    uploadSubmitting = true;
    try {
      await fleetApi.uploadDocument(vehicleId, {
        file:         uploadFile,
        doc_type:     uploadingType,
        issued_date:  uploadIssued || null,
        expiry_date:  uploadExpiry || null,
        notes:        uploadNotes.trim() || null
      });
      closeUpload();
      await load();
    } catch (e) {
      uploadError = e.message;
    } finally {
      uploadSubmitting = false;
    }
  }

  // Lazy-load a blob URL preview for the current doc (image only). PDFs
  // get an iframe wired in via openViewer().
  async function loadPreview(doc) {
    if (!doc || blobUrls.has(doc.id)) return;
    try {
      const { url } = await fleetApi.fetchFileBlob(doc.id);
      blobUrls.set(doc.id, url);
      // Force a re-render
      documents = documents;
    } catch (e) {
      console.warn('preview load failed', e.message);
    }
  }
  function previewUrl(doc) {
    return doc ? blobUrls.get(doc.id) : null;
  }

  function openViewer(doc) {
    // Open in a new tab — the streaming endpoint sends it inline. We fetch
    // a blob first so the Authorization header travels with the request.
    fleetApi.fetchFileBlob(doc.id).then(({ url }) => {
      window.open(url, '_blank', 'noopener');
    }).catch((e) => alert(`Couldn't open document: ${e.message}`));
  }

  function formatBytes(n) {
    if (!n) return '';
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(1)} MB`;
  }
  function formatDate(s) {
    return s ? new Date(s).toLocaleDateString('en-CA') : '—';
  }
  function formatDateTime(s) {
    return s ? new Date(s).toLocaleString('en-CA') : '—';
  }

  const STATUS_LABEL = {
    valid: 'Valid', expiring_soon: 'Expires soon', expired: 'Expired', missing: 'Not on file'
  };

  function sectionsToShow() {
    // CVOR is operator-level (managed on /fleet-admin) — not surfaced here.
    return ['ownership', 'insurance', 'inspection'];
  }
  function sectionLabel(t) {
    return {
      ownership:  'Ownership / Registration',
      insurance:  'Insurance pink slip',
      inspection: 'Annual safety inspection'
    }[t];
  }

  // Trigger preview load when documents change
  $: if (documents) {
    for (const t of ['ownership','insurance','inspection']) {
      const cur = documents[t]?.current;
      if (cur && /^image\//.test(cur.file_mime)) loadPreview(cur);
    }
  }
</script>

<svelte:head><title>Fleet — {vehicle?.unit_number || 'Vehicle'} · Holm Graphics</title></svelte:head>

<div class="page">
  <p class="back"><a href="/fleet-admin/vehicles">← All vehicles</a></p>

  {#if loading}
    <p class="muted">Loading…</p>
  {:else if loadError}
    <p class="alert error">{loadError}</p>
  {:else if vehicle}
    <header class="vehicle-head">
      <div>
        <h1>{vehicle.unit_number} <span class="muted small">· {vehicle.type === 'truck' ? 'Truck' : 'Trailer'}</span></h1>
        <p class="hint">{[vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ')}</p>
      </div>
      {#if !editing}
        <button class="btn outline" on:click={startEdit}>Edit details</button>
      {/if}
    </header>

    <section class="card details">
      {#if editing}
        <div class="form-grid">
          <label><span>Unit # <em>*</em></span><input type="text" bind:value={editForm.unit_number} /></label>
          <label><span>Type <em>*</em></span>
            <select bind:value={editForm.type}>
              <option value="truck">Truck</option>
              <option value="trailer">Trailer</option>
            </select>
          </label>
          <label><span>Year</span><input type="number" bind:value={editForm.year} min="1900" max="2099" /></label>
          <label><span>Make</span><input type="text" bind:value={editForm.make} /></label>
          <label><span>Model</span><input type="text" bind:value={editForm.model} /></label>
          <label><span>Plate</span><input type="text" bind:value={editForm.license_plate} /></label>
          <label class="span2">
            <span>VIN</span>
            <input type="text" bind:value={editForm.vin} maxlength="17" autocapitalize="characters" spellcheck="false" />
            {#if editForm.vin && editForm.vin.trim()}
              {@const v = validateVin(editForm.vin)}
              {#if !v.valid}
                <span class="vin-warn">⚠ {v.reason}</span>
              {:else}
                <span class="vin-ok">✓ Valid VIN</span>
              {/if}
            {/if}
          </label>
          <label class="span2"><span>Notes</span><textarea rows="2" bind:value={editForm.notes}></textarea></label>
          <label class="span2 inline"><input type="checkbox" bind:checked={editForm.active} /> Active</label>
        </div>
        {#if editError}<p class="alert error">{editError}</p>{/if}
        <div class="form-actions">
          <button class="btn primary" on:click={saveEdit} disabled={editSaving}>{editSaving ? 'Saving…' : 'Save changes'}</button>
          <button class="link-btn" on:click={() => editing = false}>Cancel</button>
        </div>
      {:else}
        <dl class="dl-grid">
          <div><dt>Plate</dt><dd>{vehicle.license_plate || '—'}</dd></div>
          <div><dt>VIN</dt><dd class="mono">{vehicle.vin || '—'}</dd></div>
          <div><dt>Year</dt><dd>{vehicle.year || '—'}</dd></div>
          <div><dt>Active</dt><dd>{vehicle.active ? 'Yes' : 'No'}</dd></div>
          {#if vehicle.notes}<div class="span2"><dt>Notes</dt><dd>{vehicle.notes}</dd></div>{/if}
        </dl>
      {/if}
    </section>

    <!-- ─── Finance / lease card ──────────────────────────────────── -->
    <section class="card finance">
      <header class="doc-head">
        <h2>
          Finance &amp; lease
          {#if finance && !finance._new}
            <span class="acq-pill acq-{finance.acquisition_type}">{acqLabel(finance.acquisition_type)}</span>
            {#if financeExpiringSoon}
              <span class="status-pill status-{financeExpiringSoon.cls}">{financeExpiringSoon.label}</span>
            {/if}
          {/if}
        </h2>
        {#if !financeEditing}
          <button class="btn outline" on:click={startEditFinance}>
            {finance && !finance._new ? 'Edit' : 'Add details'}
          </button>
        {/if}
      </header>

      {#if financeEditing}
        <div class="form-grid">
          <label><span>Type</span>
            <select bind:value={financeForm.acquisition_type}>
              <option value="owned">Owned outright</option>
              <option value="financed">Financed (loan)</option>
              <option value="leased">Leased</option>
            </select>
          </label>
          <label><span>Acquired</span>
            <input type="date" bind:value={financeForm.acquisition_date} />
          </label>
          <label><span>{financeForm.acquisition_type === 'leased' ? 'Lessor' : 'Lender / dealer'}</span>
            <input type="text" bind:value={financeForm.lender} placeholder="e.g. Ford Credit / RBC / Foss Garage" />
          </label>
          <label><span>Account / contract #</span>
            <input type="text" bind:value={financeForm.account_number} />
          </label>

          <label><span>Purchase price ($)</span>
            <input type="number" step="0.01" bind:value={financeForm.purchase_price} />
          </label>
          <label><span>Down payment ($)</span>
            <input type="number" step="0.01" bind:value={financeForm.down_payment} />
          </label>

          {#if financeForm.acquisition_type !== 'owned'}
            <label><span>Monthly payment ($)</span>
              <input type="number" step="0.01" bind:value={financeForm.monthly_payment} />
            </label>
            <label><span>Term (months)</span>
              <input type="number" min="1" max="120" bind:value={financeForm.term_months} />
            </label>
            <label><span>Interest rate (%)</span>
              <input type="number" step="0.001" bind:value={financeForm.interest_rate} placeholder="e.g. 5.999" />
            </label>
            <label><span>Start date</span>
              <input type="date" bind:value={financeForm.start_date} />
            </label>
            <label>
              <span>End date {#if financeForm.acquisition_type === 'leased'}<em>*</em>{/if}</span>
              <input type="date" bind:value={financeForm.end_date} />
            </label>
          {/if}

          {#if financeForm.acquisition_type === 'leased'}
            <label><span>Residual / buyout ($)</span>
              <input type="number" step="0.01" bind:value={financeForm.residual_value} />
            </label>
            <label><span>Mileage allowance (km/yr)</span>
              <input type="number" min="0" bind:value={financeForm.mileage_allowance_km} placeholder="e.g. 24000" />
            </label>
            <label><span>Excess charge ($/km)</span>
              <input type="number" step="0.0001" bind:value={financeForm.excess_mileage_charge} placeholder="e.g. 0.18" />
            </label>
          {/if}

          <label class="span2"><span>Notes</span>
            <textarea rows="2" bind:value={financeForm.notes}></textarea>
          </label>
        </div>
        {#if financeError}<p class="alert error">{financeError}</p>{/if}
        <div class="form-actions">
          <button class="btn primary" on:click={saveFinance} disabled={financeSaving}>
            {financeSaving ? 'Saving…' : 'Save'}
          </button>
          <button class="link-btn" on:click={() => financeEditing = false}>Cancel</button>
          {#if finance && !finance._new}
            <button class="link-btn" style="margin-left:auto;color:#b91c1c" on:click={clearFinance}>Clear all</button>
          {/if}
        </div>
      {:else if !finance || finance._new}
        <p class="muted">No finance/lease details recorded yet. Click "Add details" to enter purchase, loan, or lease terms.</p>
      {:else}
        <dl class="dl-grid">
          <div><dt>Type</dt><dd>{acqLabel(finance.acquisition_type)}</dd></div>
          <div><dt>Acquired</dt><dd>{fmtDate(finance.acquisition_date)}</dd></div>
          {#if finance.lender}<div><dt>{finance.acquisition_type === 'leased' ? 'Lessor' : 'Lender'}</dt><dd>{finance.lender}</dd></div>{/if}
          {#if finance.account_number}<div><dt>Account #</dt><dd class="mono">{finance.account_number}</dd></div>{/if}
          {#if finance.purchase_price != null}<div><dt>Purchase price</dt><dd>{fmtMoney(finance.purchase_price)}</dd></div>{/if}
          {#if finance.down_payment != null}<div><dt>Down payment</dt><dd>{fmtMoney(finance.down_payment)}</dd></div>{/if}
          {#if finance.acquisition_type !== 'owned'}
            {#if finance.monthly_payment != null}<div><dt>Monthly payment</dt><dd>{fmtMoney(finance.monthly_payment)}</dd></div>{/if}
            {#if finance.term_months}<div><dt>Term</dt><dd>{finance.term_months} months</dd></div>{/if}
            {#if finance.interest_rate != null}<div><dt>Rate</dt><dd>{Number(finance.interest_rate).toFixed(3)} %</dd></div>{/if}
            {#if finance.start_date}<div><dt>Start</dt><dd>{fmtDate(finance.start_date)}</dd></div>{/if}
            {#if finance.end_date}<div><dt>End</dt><dd>{fmtDate(finance.end_date)}</dd></div>{/if}
          {/if}
          {#if finance.acquisition_type === 'leased'}
            {#if finance.residual_value != null}<div><dt>Residual / buyout</dt><dd>{fmtMoney(finance.residual_value)}</dd></div>{/if}
            {#if finance.mileage_allowance_km}<div><dt>Mileage allowance</dt><dd>{Number(finance.mileage_allowance_km).toLocaleString('en-CA')} km/yr</dd></div>{/if}
            {#if finance.excess_mileage_charge != null}<div><dt>Excess charge</dt><dd>${Number(finance.excess_mileage_charge).toFixed(4)}/km</dd></div>{/if}
          {/if}
          {#if finance.notes}<div class="span2"><dt>Notes</dt><dd>{finance.notes}</dd></div>{/if}
        </dl>
      {/if}
    </section>

    {#if vehicle.type === 'truck'}
      <section class="card telematics">
        <header class="doc-head">
          <h2>Telematics <span class="muted small">Smartcar{smartcar.mode === 'test' ? ' · test mode' : ''}</span></h2>
          {#if smartcar.linked && smartcar.link?.status === 'active'}
            <span class="status-pill status-valid">Connected</span>
          {:else if smartcar.linked && smartcar.link?.status === 'error'}
            <span class="status-pill status-expired">Error</span>
          {:else}
            <span class="status-pill status-missing">Not connected</span>
          {/if}
        </header>

        {#if smartcarMsg}<p class="alert success">{smartcarMsg}</p>{/if}
        {#if smartcarError}<p class="alert error">{smartcarError}</p>{/if}

        {#if !smartcar.configured}
          <p class="muted small">Smartcar not configured on the server (env vars missing).</p>
        {:else if smartcar.linked}
          <dl class="dl-grid">
            <div><dt>Connected</dt><dd>{smartcar.link.connected_by_name || '—'} · {smartcar.link.connected_at ? new Date(smartcar.link.connected_at).toLocaleString('en-CA') : '—'}</dd></div>
            <div><dt>Last sync</dt><dd>{smartcar.link.last_synced_at ? new Date(smartcar.link.last_synced_at).toLocaleString('en-CA') : '— (no fetch yet)'}</dd></div>
            {#if smartcar.link.last_error}
              <div class="span2"><dt>Last error</dt><dd class="muted">{smartcar.link.last_error}</dd></div>
            {/if}
          </dl>
          <div class="actions">
            <a class="btn outline" href="/fleet-docs/locations">View on map →</a>
            <button class="link-btn danger" on:click={disconnectSmartcar} disabled={smartcarBusy}>Disconnect</button>
          </div>
        {:else}
          <p class="muted small">Connect this truck via Smartcar to fetch its location on demand. Trailers can't be connected — no modem.</p>
          {#if !vehicle.vin}
            <p class="alert warn">Add a VIN to this vehicle first — Smartcar identifies vehicles by VIN.</p>
          {:else}
            <div class="actions">
              <button class="btn primary" on:click={startSmartcarConnect} disabled={smartcarBusy}>
                {smartcarBusy ? 'Opening…' : 'Connect via Smartcar'}
              </button>
            </div>
          {/if}
        {/if}
      </section>
    {/if}

    {#each sectionsToShow() as t (t)}
      <section class="card doc-section">
        <header class="doc-head">
          <h2>{sectionLabel(t)}</h2>
          <span class="status-pill status-{documents[t].current?.status || 'missing'}">{STATUS_LABEL[documents[t].current?.status || 'missing']}</span>
        </header>

        {#if documents[t].current}
          <div class="current">
            <div class="thumb">
              {#if /^image\//.test(documents[t].current.file_mime) && previewUrl(documents[t].current)}
                <img src={previewUrl(documents[t].current)} alt="{t} thumbnail" />
              {:else}
                <span class="file-icon" aria-hidden="true">📄</span>
              {/if}
            </div>
            <dl class="current-meta">
              <div><dt>Expires</dt><dd>{formatDate(documents[t].current.expiry_date)}</dd></div>
              <div><dt>Issued</dt><dd>{formatDate(documents[t].current.issued_date)}</dd></div>
              <div><dt>Uploaded</dt><dd>{formatDateTime(documents[t].current.uploaded_at)} <span class="muted">by {documents[t].current.uploaded_by_name || '—'}</span></dd></div>
              <div><dt>File</dt><dd>{documents[t].current.file_mime}, {formatBytes(documents[t].current.file_size_bytes)}</dd></div>
              {#if documents[t].current.notes}<div class="span2"><dt>Notes</dt><dd>{documents[t].current.notes}</dd></div>{/if}
            </dl>
            <div class="actions">
              <button class="btn outline" on:click={() => openViewer(documents[t].current)}>Open</button>
              <button class="btn primary" on:click={() => openUpload(t)}>Upload new</button>
            </div>
          </div>
        {:else}
          <p class="muted no-doc">No {t} document on file.</p>
          <button class="btn primary" on:click={() => openUpload(t)}>Upload</button>
        {/if}

        {#if uploadingType === t}
          <div class="upload-form">
            <h3>Upload new {t}</h3>
            <div class="form-grid">
              <label class="span2"><span>File <em>*</em> <small>(JPG, PNG, or PDF — max 25 MB)</small></span>
                <input type="file" accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf" bind:files={uploadFiles} />
              </label>
              <label><span>Issued date</span><input type="date" bind:value={uploadIssued} on:input={recomputeWarn} /></label>
              <label><span>Expiry date</span><input type="date" bind:value={uploadExpiry} on:input={recomputeWarn} /></label>
              <label class="span2"><span>Notes (optional)</span><textarea rows="2" bind:value={uploadNotes}></textarea></label>
            </div>
            {#if uploadWarn}<p class="alert warn">{uploadWarn}</p>{/if}
            {#if uploadError}<p class="alert error">{uploadError}</p>{/if}
            <div class="form-actions">
              <button class="btn primary" on:click={submitUpload} disabled={uploadSubmitting}>{uploadSubmitting ? 'Uploading…' : 'Upload'}</button>
              <button class="link-btn" on:click={closeUpload}>Cancel</button>
            </div>
          </div>
        {/if}

        {#if documents[t].history.length > 0}
          <details class="history" bind:open={historyOpen[t]}>
            <summary>View history ({documents[t].history.length})</summary>
            <table>
              <thead><tr><th>Uploaded</th><th>Issued</th><th>Expires</th><th>By</th><th></th></tr></thead>
              <tbody>
                {#each documents[t].history as h (h.id)}
                  <tr>
                    <td>{formatDateTime(h.uploaded_at)}</td>
                    <td>{formatDate(h.issued_date)}</td>
                    <td>{formatDate(h.expiry_date)}</td>
                    <td>{h.uploaded_by_name || '—'}</td>
                    <td><button class="link-btn" on:click={() => openViewer(h)}>Open</button></td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </details>
        {/if}
      </section>
    {/each}
  {/if}
</div>

<style>
  .page { max-width: 56rem; margin: 0 auto; padding: 1.5rem 1rem 4rem; }
  .back { margin: 0 0 1rem; font-size: 0.9rem; }
  .back a { color: #666; text-decoration: none; }
  .back a:hover { text-decoration: underline; }

  .vehicle-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; margin-bottom: 1.25rem; }
  .vehicle-head h1 { margin: 0 0 0.25rem; }
  .hint { color: #666; margin: 0; font-size: 0.95rem; }
  .muted { color: #888; }
  .small { font-size: 0.85rem; font-weight: 400; }
  .mono { font-family: ui-monospace, monospace; font-size: 0.9rem; }

  .card { background: white; border: 1px solid #e4e4e7; border-radius: 0.5rem; padding: 1.25rem; margin-bottom: 1.25rem; }
  .card h2 { font-size: 1.05rem; margin: 0; }
  .card h3 { font-size: 0.95rem; margin: 0 0 0.75rem; }

  .dl-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.6rem 1.25rem; margin: 0; }
  .dl-grid div { display: flex; flex-direction: column; gap: 0.15rem; }
  .dl-grid dt { color: #888; font-size: 0.8rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; }
  .dl-grid dd { margin: 0; font-size: 0.95rem; }
  .dl-grid .span2 { grid-column: span 2; }

  .form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; }
  .form-grid label { display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.9rem; color: #444; }
  .form-grid .span2 { grid-column: span 2; }
  .form-grid .inline { flex-direction: row; align-items: center; gap: 0.5rem; }
  .form-grid input, .form-grid select, .form-grid textarea {
    padding: 0.5rem 0.65rem; border: 1px solid #d4d4d8; border-radius: 0.35rem; font-size: 0.95rem;
  }
  .form-grid input:focus, .form-grid select:focus, .form-grid textarea:focus {
    outline: 2px solid #c01818; outline-offset: 1px; border-color: transparent;
  }
  em { color: #c01818; font-style: normal; }
  small { color: #888; }

  .form-actions { display: flex; align-items: center; gap: 0.85rem; margin-top: 0.85rem; }

  .doc-section { padding: 1.25rem; }
  .doc-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.85rem; padding-bottom: 0.5rem; border-bottom: 1px dashed #eee; }
  .status-pill { font-size: 0.8rem; padding: 0.2rem 0.6rem; border-radius: 999px; background: #eee; color: #444; }
  .status-pill.status-valid         { background: #e8f6ec; color: #1f6b34; }
  .status-pill.status-expiring_soon { background: #fdf5d3; color: #6c5300; }
  .status-pill.status-warn          { background: #fdf5d3; color: #6c5300; }
  .status-pill.status-expired       { background: #fee; color: #b91c1c; }
  .status-pill.status-missing       { background: #f0f0f0; color: #666; }

  /* Acquisition-type pill on the Finance card header */
  .acq-pill {
    font-size: 0.78rem;
    padding: 0.18rem 0.6rem;
    border-radius: 999px;
    margin-left: 0.5rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.02em;
  }
  .acq-pill.acq-owned    { background: #f0f9ff; color: #075985; }
  .acq-pill.acq-financed { background: #ede9fe; color: #5b21b6; }
  .acq-pill.acq-leased   { background: #fef3c7; color: #92400e; }

  .current { display: grid; grid-template-columns: auto 1fr; gap: 1rem; align-items: start; }
  .thumb { width: 6rem; height: 6rem; display: flex; align-items: center; justify-content: center; background: #fafafa; border: 1px solid #e4e4e7; border-radius: 0.4rem; overflow: hidden; }
  .thumb img { width: 100%; height: 100%; object-fit: cover; }
  .file-icon { font-size: 2rem; color: #555; }
  .current-meta { grid-column: 2; display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem 1.25rem; margin: 0; }
  .current-meta dt { color: #888; font-size: 0.78rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; }
  .current-meta dd { margin: 0; font-size: 0.92rem; }
  .current-meta .span2 { grid-column: span 2; }
  .actions { grid-column: 1 / -1; display: flex; gap: 0.6rem; margin-top: 0.5rem; }
  .no-doc { margin: 0 0 0.85rem; }

  .upload-form { margin-top: 1rem; padding-top: 1rem; border-top: 1px dashed #eee; }

  .history { margin-top: 1rem; }
  .history summary { cursor: pointer; font-size: 0.92rem; color: #555; }
  .history table { width: 100%; margin-top: 0.5rem; border-collapse: collapse; font-size: 0.88rem; }
  .history th, .history td { padding: 0.4rem 0.5rem; text-align: left; border-bottom: 1px dashed #eee; }
  .history th { color: #555; background: #fafafa; }

  .btn { padding: 0.55rem 1.1rem; background: #c01818; color: white; border: none; border-radius: 0.4rem; font-weight: 600; cursor: pointer; font-size: 0.92rem; }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn.outline { background: transparent; color: #c01818; border: 1px solid #c01818; }
  .link-btn { background: none; border: 0; color: #c01818; cursor: pointer; font-size: 0.9rem; }

  .alert { padding: 0.5rem 0.75rem; border-radius: 0.3rem; margin: 0.5rem 0; font-size: 0.9rem; }
  .alert.error { background: #fee; color: #b00; }
  .alert.warn    { background: #fff8e0; color: #6c5300; }
  .alert.success { background: #e8f6ec; color: #1f6b34; }

  .vin-warn { font-size: 0.82rem; color: #92400e; margin-top: 0.2rem; }
  .vin-ok   { font-size: 0.82rem; color: #1f6b34; margin-top: 0.2rem; }

  .telematics .doc-head { margin-bottom: 0.75rem; }
  .link-btn.danger { color: #b00; }
</style>
