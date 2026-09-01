<!--
  /fleet-admin — admin landing page.

  Shows the expiry dashboard summary (per spec) plus quick links into the
  vehicles list, access log, and driver view. Was a redirect to
  /fleet-admin/vehicles until Step 5 — now it's the home.
-->
<script>
  import { onMount } from 'svelte';
  import { fleetApi } from '$lib/api/fleet-client.js';

  let loading = true;
  let loadError = '';
  let counts = { expired: 0, expiring_soon: 0, missing: 0, valid: 0 };
  let fleet  = { trucks: 0, trailers: 0 };
  let attention = [];
  // Ford Pro Telematics (fleet-grade, server-polled — no connect flow).
  let fordpro = null;
  let fordproVehicles = [];
  let fordproSyncBusy = false;
  let fordproMsg = '';
  let fordproErr = '';

  // Operator-level docs (CVOR etc) — fetched separately from the
  // per-vehicle expiry summary because they belong to the business,
  // not individual vehicles.
  let operatorDocs = null;
  let opError = '';

  // Daily inspections (O. Reg. 199/07). Loaded best-effort — the fleet
  // dashboard predates this feature and must still render if the scope
  // query fails.
  let inspectionScope = null;
  $: inspectionOverdue = (inspectionScope?.units || [])
    .filter((u) => u.inspection_required && !u.has_valid_inspection);
  $: inspectionOos = (inspectionScope?.units || []).filter((u) => u.out_of_service);

  // Inline upload state (parallels the per-vehicle upload form on
  // /fleet-admin/vehicles/[id]).
  let uploadingOp = null;       // 'cvor' | null
  let opFiles = null;
  $: opFile = opFiles?.[0] || null;
  let opIssued = '';
  let opExpiry = '';
  let opNotes = '';
  let opSubmitting = false;
  let opUploadError = '';

  onMount(async () => {
    try {
      const data = await fleetApi.getExpirySummary();
      counts = data.counts || counts;
      fleet  = data.fleet  || fleet;
      attention = data.attention || [];
    } catch (e) {
      loadError = e.message;
    } finally {
      loading = false;
    }
    loadOperatorDocs();
    fleetApi.inspectionScope()
      .then((s) => { inspectionScope = s; })
      .catch(() => { inspectionScope = null; });
    await loadFordpro();
  });

  async function loadFordpro() {
    try { fordpro = await fleetApi.fordproStatus(); }
    catch { fordpro = null; }
    if (fordpro?.configured) {
      try { fordproVehicles = (await fleetApi.fordproVehicles()).vehicles || []; }
      catch { /* ignore */ }
    } else {
      fordproVehicles = [];
    }
  }

  async function fordproSync() {
    fordproSyncBusy = true; fordproErr = ''; fordproMsg = '';
    try {
      const r = await fleetApi.fordproSync();
      fordproMsg = `Polled ${r.total} vehicle${r.total === 1 ? '' : 's'}${r.errors ? ` (${r.errors} error${r.errors === 1 ? '' : 's'})` : ''}.`;
      await loadFordpro();
    } catch (e) {
      fordproErr = e.message || 'Sync failed.';
    } finally {
      fordproSyncBusy = false;
    }
  }

  async function loadOperatorDocs() {
    try {
      const data = await fleetApi.getOperatorDocuments();
      operatorDocs = data.documents || null;
    } catch (e) {
      opError = e.message;
    }
  }

  function startOperatorUpload(docType) {
    uploadingOp = docType;
    opFiles = null;
    opIssued = ''; opExpiry = ''; opNotes = '';
    opUploadError = '';
  }
  function cancelOperatorUpload() {
    uploadingOp = null;
    opFiles = null;
    opUploadError = '';
  }
  async function submitOperatorUpload() {
    if (opSubmitting) return;
    opUploadError = '';
    if (!opFile) { opUploadError = 'Pick a file first.'; return; }
    opSubmitting = true;
    try {
      await fleetApi.uploadOperatorDocument({
        file: opFile,
        doc_type: uploadingOp,
        issued_date: opIssued || null,
        expiry_date: opExpiry || null,
        notes: opNotes.trim() || null
      });
      cancelOperatorUpload();
      await loadOperatorDocs();
    } catch (e) {
      opUploadError = e.message;
    } finally {
      opSubmitting = false;
    }
  }
  async function openOperatorDoc(doc) {
    if (!doc?.id) return;
    try {
      const { url } = await fleetApi.fetchOperatorFileBlob(doc.id);
      window.open(url, '_blank', 'noopener');
    } catch (e) {
      alert(`Couldn't open document: ${e.message}`);
    }
  }

  const SECTION_LABEL = { ownership: 'Ownership', insurance: 'Insurance', cvor: 'CVOR', inspection: 'Inspection' };
  const OP_LABEL = { cvor: 'CVOR (Commercial Vehicle Operator Registration)' };
  const STATUS_LABEL = { valid: 'Current', expiring_soon: 'Expires soon', expired: 'EXPIRED', missing: 'Not on file' };
  function formatDate(s) {
    return s ? new Date(s).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
  }
  function daysFromToday(s) {
    if (!s) return null;
    const today = new Date(); today.setHours(0,0,0,0);
    const d = new Date(s);
    return Math.floor((d.getTime() - today.getTime()) / 86400000);
  }
</script>

<svelte:head><title>Fleet — Dashboard · Holm Graphics</title></svelte:head>

<div class="page">
  <header class="page-head">
    <h1>Fleet — Dashboard</h1>
    <p class="hint">{fleet.trucks} truck{fleet.trucks === 1 ? '' : 's'} · {fleet.trailers} trailer{fleet.trailers === 1 ? '' : 's'} active.
      Drivers access docs at <a href="/fleet-docs">/fleet-docs</a>.</p>
  </header>

  {#if loading}
    <p class="hint">Loading…</p>
  {:else if loadError}
    <p class="alert error">{loadError}</p>
  {:else}
    <div class="summary">
      <article class="card card-expired" class:zero={counts.expired === 0}>
        <span class="num">{counts.expired}</span>
        <span class="label">Expired</span>
      </article>
      <article class="card card-soon" class:zero={counts.expiring_soon === 0}>
        <span class="num">{counts.expiring_soon}</span>
        <span class="label">Expire in 30 days</span>
      </article>
      <article class="card card-missing" class:zero={counts.missing === 0}>
        <span class="num">{counts.missing}</span>
        <span class="label">Not on file</span>
      </article>
      <article class="card card-valid">
        <span class="num">{counts.valid}</span>
        <span class="label">Current</span>
      </article>
    </div>

    {#if attention.length > 0}
      <section class="attention">
        <h2>Needs attention</h2>
        <ul>
          {#each attention as a (a.document_id)}
            {@const days = daysFromToday(a.expiry_date)}
            <li>
              <a href={`/fleet-admin/vehicles/${a.vehicle_id}`}>
                <span class="unit">{a.unit_number}</span>
                <span class="doc-type">{SECTION_LABEL[a.doc_type] || a.doc_type}</span>
                <span class="status status-{a.status}">
                  {#if a.status === 'expired'}
                    Expired {days != null ? `${Math.abs(days)}d ago` : ''}
                  {:else}
                    Expires {days === 0 ? 'today' : `in ${days}d`} · {formatDate(a.expiry_date)}
                  {/if}
                </span>
              </a>
            </li>
          {/each}
        </ul>
      </section>
    {:else if counts.expired === 0 && counts.expiring_soon === 0 && counts.missing === 0}
      <p class="empty muted">All current. Nothing to chase.</p>
    {/if}

    <section class="operator-docs">
      <h2>Operator documents</h2>
      <p class="hint small">CVOR is issued to the business and covers every vehicle. Upload once here; drivers see the latest CVOR on every truck and trailer page.</p>
      {#if opError}
        <p class="alert error">{opError}</p>
      {/if}
      {#each ['cvor'] as t}
        {@const cur = operatorDocs?.[t]?.current}
        {@const status = cur?.status || 'missing'}
        <article class="op-doc status-{status}">
          <div class="op-doc-head">
            <strong>{OP_LABEL[t]}</strong>
            <span class="op-status">{STATUS_LABEL[status]}</span>
          </div>
          {#if cur}
            <div class="op-doc-meta">
              {#if cur.expiry_date}Expires {formatDate(cur.expiry_date)} · {/if}
              Uploaded {formatDate(cur.uploaded_at)}
              {#if cur.uploaded_by_name} by {cur.uploaded_by_name}{/if}
            </div>
            {#if cur.notes}<div class="op-doc-notes">{cur.notes}</div>{/if}
            <div class="op-doc-actions">
              <button class="btn outline" on:click={() => openOperatorDoc(cur)}>Open</button>
              <button class="btn primary" on:click={() => startOperatorUpload(t)}>Upload new</button>
            </div>
          {:else}
            <p class="muted no-doc">No {OP_LABEL[t]} on file.</p>
            <button class="btn primary" on:click={() => startOperatorUpload(t)}>Upload</button>
          {/if}

          {#if uploadingOp === t}
            <div class="op-upload-form">
              <h3>Upload new CVOR</h3>
              <label class="full"><span>File <em>*</em> <small>(JPG, PNG, or PDF — max 25 MB)</small></span>
                <input type="file" accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf" bind:files={opFiles} />
              </label>
              <div class="op-form-row">
                <label><span>Issued date</span><input type="date" bind:value={opIssued} /></label>
                <label><span>Expiry date</span><input type="date" bind:value={opExpiry} /></label>
              </div>
              <label class="full"><span>Notes (optional)</span><textarea rows="2" bind:value={opNotes}></textarea></label>
              {#if opUploadError}<p class="alert error">{opUploadError}</p>{/if}
              <div class="op-form-actions">
                <button class="btn primary" on:click={submitOperatorUpload} disabled={opSubmitting}>{opSubmitting ? 'Uploading…' : 'Upload'}</button>
                <button class="btn ghost" on:click={cancelOperatorUpload} disabled={opSubmitting}>Cancel</button>
              </div>
            </div>
          {/if}
        </article>
      {/each}
    </section>


    <!-- ─── Ford Pro Telematics card (fleet-grade, server-polled) ──── -->
    <section class="card fordconnect-card">
      <header class="ts-head">
        <h2>
          Ford Pro Telematics
          {#if !fordpro?.configured}
            <span class="ts-pill ts-pill-off">Not configured</span>
          {:else}
            <span class="ts-pill ts-pill-on">Active</span>
          {/if}
        </h2>
      </header>

      {#if fordproMsg}<p class="alert success">{fordproMsg}</p>{/if}
      {#if fordproErr}<p class="alert error">{fordproErr}</p>{/if}

      {#if !fordpro?.configured}
        <p class="hint small">
          Set <code>FORD_TELEMATICS_CLIENT_ID</code> and <code>FORD_TELEMATICS_CLIENT_SECRET</code>
          (service account from the Ford Pro Developer Portal) as Railway env vars to enable.
          Polls every {fordpro?.poll_minutes || 30} min once configured.
        </p>
      {:else}
        <p class="hint small">
          {fordpro.last_status || 'Configured — pending first poll.'}
          {#if fordpro.last_polled_at}
            · Last polled {new Date(fordpro.last_polled_at).toLocaleString('en-CA')}
          {/if}
          · Auto-polls every {fordpro.poll_minutes} min ·
          {fordpro.linked_count}/{fordpro.vehicle_count} linked to fleet
        </p>
        <div class="ts-actions">
          <button class="btn primary" on:click={fordproSync} disabled={fordproSyncBusy}>
            {fordproSyncBusy ? 'Polling…' : '↻ Sync now'}
          </button>
        </div>

        {#if fordproVehicles.length > 0}
          <table class="ford-vehicle-table">
            <thead>
              <tr><th>VIN</th><th>Vehicle</th><th>Linked to fleet</th><th>Odometer</th><th>Fuel</th><th>Last seen</th></tr>
            </thead>
            <tbody>
              {#each fordproVehicles as v (v.id)}
                <tr>
                  <td class="mono small">{v.ford_vin}</td>
                  <td>{[v.our_year || v.year, v.our_make || v.make, v.our_model || v.model].filter(Boolean).join(' ') || '—'}</td>
                  <td>{v.unit_number ? `#${v.unit_number}` : '— not in fleet —'}</td>
                  <td>{v.last_odometer_km != null ? `${Number(v.last_odometer_km).toLocaleString('en-CA')} km` : '—'}</td>
                  <td>{v.last_fuel_pct != null ? `${Math.round(Number(v.last_fuel_pct))}%` : '—'}</td>
                  <td class="small">
                    {#if v.last_fetch_error}
                      <span class="muted" title={v.last_fetch_error}>error</span>
                    {:else}
                      {v.last_location_at ? new Date(v.last_location_at).toLocaleString('en-CA') : (v.last_fetched_at ? new Date(v.last_fetched_at).toLocaleString('en-CA') : '—')}
                    {/if}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        {:else}
          <p class="hint small muted">No vehicles polled yet. Click “Sync now”, or wait for the next automatic poll.</p>
        {/if}
      {/if}
    </section>

    {#if inspectionScope}
      <section class="inspections">
        <h2>Daily inspections</h2>
        {#if inspectionOos.length}
          <p class="insp-dno">
            <strong>OUT OF SERVICE:</strong>
            {inspectionOos.map((u) => u.unit_number).join(', ')} —
            <a href="/fleet-admin/inspections/defects">record the repair</a>
          </p>
        {/if}
        <div class="insp-row">
          <a class="insp-tile" href="/fleet-admin/inspections">
            <span class="insp-n">{inspectionScope.summary.checked_today} / {inspectionScope.summary.in_scope}</span>
            <span class="insp-l">Checked today, in scope</span>
          </a>
          {#if inspectionOverdue.length}
            <div class="insp-due">
              <strong>No valid check:</strong>
              {inspectionOverdue.map((u) => u.unit_number).join(', ')}
            </div>
          {:else if inspectionScope.summary.in_scope > 0}
            <div class="insp-ok">Every in-scope unit has a valid inspection.</div>
          {/if}
        </div>
      </section>
    {/if}

    <nav class="links">
      <a class="link-tile" href="/fleet-admin/inspections">
        <strong>Daily inspections</strong>
        <span>Circle-check board, open defects, schedules</span>
      </a>
      <a class="link-tile" href="/fleet/check">
        <strong>Run a circle check</strong>
        <span>Start today's inspection on a unit</span>
      </a>
      <a class="link-tile" href="/fleet-admin/vehicles">
        <strong>Manage vehicles</strong>
        <span>Add/edit fleet, upload new documents</span>
      </a>
      <a class="link-tile" href="/fleet-admin/access-log">
        <strong>Access log</strong>
        <span>Who viewed which docs and when</span>
      </a>
      <a class="link-tile" href="/fleet-docs/locations">
        <strong>Live locations</strong>
        <span>Map view of connected trucks</span>
      </a>
      <a class="link-tile" href="/fleet-docs">
        <strong>Driver view</strong>
        <span>What drivers see on their phones</span>
      </a>
    </nav>
  {/if}
</div>

<style>
  .page { max-width: 60rem; margin: 0 auto; padding: 1.5rem 1rem 4rem; }
  .page-head h1 { margin: 0 0 0.2rem; }
  .hint { color: #666; font-size: 0.92rem; margin: 0; }
  .muted { color: #888; }

  .alert { padding: 0.5rem 0.75rem; border-radius: 0.3rem; font-size: 0.9rem; }
  .alert.error { background: #fee; color: #b00; }

  .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr)); gap: 0.75rem; margin: 1.25rem 0; }
  .card { background: white; border: 1px solid #e4e4e7; border-left: 0.4rem solid; border-radius: 0.55rem; padding: 1rem 1.1rem; display: flex; flex-direction: column; gap: 0.15rem; }
  .card .num { font-size: 2rem; font-weight: 700; line-height: 1; }
  .card .label { font-size: 0.88rem; color: #555; }
  .card.card-expired { border-left-color: #b91c1c; }
  .card.card-soon    { border-left-color: #d9a401; }
  .card.card-missing { border-left-color: #c0c0c4; }
  .card.card-valid   { border-left-color: #1f6b34; }
  .card.zero .num { color: #999; }
  .card.zero { background: #fafafa; }

  .attention { background: white; border: 1px solid #e4e4e7; border-radius: 0.55rem; padding: 1rem 1.25rem; margin-bottom: 1.25rem; }
  .attention h2 { font-size: 1rem; margin: 0 0 0.6rem; }
  .attention ul { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 0.25rem; }
  .attention a {
    display: grid; grid-template-columns: 4.5rem 1fr auto; gap: 0.75rem; align-items: center;
    padding: 0.55rem 0.65rem;
    border-radius: 0.4rem;
    text-decoration: none; color: inherit;
  }
  .attention a:hover { background: #fafafa; }
  .attention .unit { font-weight: 700; }
  .attention .doc-type { color: #555; font-size: 0.92rem; }
  .attention .status { font-size: 0.85rem; }
  .attention .status-expired { color: #b91c1c; font-weight: 600; }
  .attention .status-expiring_soon { color: #6c5300; }

  .empty { padding: 1rem 0; }

  /* Daily inspections summary */
  .inspections { margin: 1.5rem 0; }
  .insp-dno { background: #fff5f5; border: 2px solid #a10000; border-radius: 0.45rem;
              padding: 0.7rem 0.9rem; margin: 0 0 0.7rem; font-size: 0.92rem; }
  .insp-dno strong { color: #a10000; letter-spacing: 0.03em; }
  .insp-dno a { color: #a10000; font-weight: 600; }
  .insp-row { display: flex; gap: 0.75rem; align-items: stretch; flex-wrap: wrap; }
  .insp-tile { display: flex; flex-direction: column; justify-content: center;
               min-width: 11rem; padding: 0.85rem 1rem; background: white;
               border: 1px solid #e4e4e7; border-radius: 0.5rem; text-decoration: none; color: inherit; }
  .insp-tile:hover { border-color: #c01818; }
  .insp-n { font-size: 1.6rem; font-weight: 700; line-height: 1.1; }
  .insp-l { font-size: 0.82rem; color: #666; margin-top: 0.15rem; }
  .insp-due, .insp-ok { flex: 1 1 14rem; display: flex; align-items: center;
                        padding: 0.85rem 1rem; border-radius: 0.5rem; font-size: 0.9rem; }
  .insp-due { background: #fffdf3; border: 1px solid #e0b400; color: #6c5300; }
  .insp-ok  { background: #f7fcf8; border: 1px solid #bfe3ca; color: #1f6b34; }

  .links { display: grid; grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr)); gap: 0.75rem; }
  .link-tile {
    display: flex; flex-direction: column; gap: 0.15rem;
    padding: 1rem 1.1rem;
    background: white;
    border: 1px solid #e4e4e7;
    border-radius: 0.5rem;
    text-decoration: none; color: inherit;
  }
  .link-tile:hover { border-color: #c01818; }
  .link-tile strong { font-size: 1rem; }
  .link-tile span { font-size: 0.88rem; color: #666; }

  .telematics-line { margin: 0.5rem 0 1rem; }

  .fordconnect-card { margin-top: 1rem; }
  .ts-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.5rem; }
  .ts-head h2 { margin: 0; font-size: 1.05rem; display: flex; align-items: center; gap: 0.6rem; }
  .ts-pill { font-size: 0.78rem; padding: 0.2rem 0.7rem; border-radius: 999px; font-weight: 600; }
  .ts-pill-on   { background: #e8f6ec; color: #1f6b34; }
  .ts-pill-off  { background: #f0f0f0; color: #666; }
  .ts-pill-warn { background: #fdf5d3; color: #6c5300; }
  .ts-actions { display: flex; gap: 0.5rem; margin: 0.6rem 0; flex-wrap: wrap; }
  .link-btn.destructive { background: transparent; color: #b91c1c; border: 0; cursor: pointer; padding: 0.5rem; }
  .alert.success { background: #e8f6ec; color: #1f6b34; padding: 0.5rem 0.8rem; border-radius: 0.3rem; margin: 0.5rem 0; }
  .ford-vehicle-table { width: 100%; margin-top: 0.8rem; border-collapse: collapse; font-size: 0.9rem; }
  .ford-vehicle-table th, .ford-vehicle-table td { padding: 0.4rem 0.6rem; border-bottom: 1px solid #eee; text-align: left; }
  .ford-vehicle-table th { background: #fafafa; font-weight: 600; color: #555; }
  .ford-vehicle-table .mono { font-family: ui-monospace, monospace; }
  .ford-vehicle-table .small { font-size: 0.82rem; color: #666; }

  .operator-docs { margin: 1.5rem 0; }
  .operator-docs h2 { font-size: 1rem; margin: 0 0 0.4rem; }
  .operator-docs .hint.small { margin-bottom: 0.75rem; font-size: 0.85rem; }

  .op-doc {
    background: white; border: 1px solid #e4e4e7; border-left: 0.4rem solid #c0c0c4;
    border-radius: 0.55rem; padding: 1rem 1.25rem; margin-bottom: 0.75rem;
  }
  .op-doc.status-valid   { border-left-color: #1f6b34; }
  .op-doc.status-expiring_soon { border-left-color: #d9a401; }
  .op-doc.status-expired { border-left-color: #b91c1c; }
  .op-doc-head { display: flex; justify-content: space-between; align-items: baseline; gap: 0.5rem; margin-bottom: 0.35rem; }
  .op-doc-head strong { font-size: 1rem; }
  .op-status { font-size: 0.85rem; font-weight: 600; }
  .op-doc.status-expired .op-status { color: #b91c1c; }
  .op-doc.status-valid   .op-status { color: #1f6b34; }
  .op-doc.status-expiring_soon .op-status { color: #6c5300; }
  .op-doc-meta { font-size: 0.88rem; color: #555; margin-bottom: 0.5rem; }
  .op-doc-notes { font-size: 0.88rem; color: #555; font-style: italic; margin-bottom: 0.5rem; }
  .op-doc .no-doc { margin: 0 0 0.5rem; }
  .op-doc-actions { display: flex; gap: 0.5rem; flex-wrap: wrap; }

  .op-upload-form { margin-top: 0.75rem; padding-top: 0.75rem; border-top: 1px dashed #e4e4e7; display: flex; flex-direction: column; gap: 0.6rem; }
  .op-upload-form h3 { margin: 0; font-size: 0.95rem; }
  .op-upload-form label { display: flex; flex-direction: column; gap: 0.2rem; font-size: 0.88rem; }
  .op-upload-form label.full { flex: 1; }
  .op-upload-form label em { color: #b91c1c; }
  .op-upload-form label small { color: #888; font-weight: 400; }
  .op-form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; }
  .op-form-actions { display: flex; gap: 0.5rem; }
  .op-upload-form input[type=text], .op-upload-form input[type=date], .op-upload-form textarea {
    padding: 0.4rem 0.5rem; border: 1px solid #e4e4e7; border-radius: 0.3rem; font: inherit;
  }

  .btn { padding: 0.45rem 0.85rem; border-radius: 0.35rem; font: inherit; cursor: pointer; border: 1px solid transparent; }
  .btn.primary { background: #c01818; color: white; border-color: #c01818; }
  .btn.primary:hover:not(:disabled) { background: #a51414; }
  .btn.outline { background: white; border-color: #c0c0c4; }
  .btn.outline:hover { border-color: #c01818; color: #c01818; }
  .btn.ghost { background: transparent; border-color: transparent; color: #555; }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
