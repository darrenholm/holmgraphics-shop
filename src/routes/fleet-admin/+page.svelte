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
  let smartcar = null;
  let fordconnect = null;
  let fordconnectVehicles = [];
  let fordSyncBusy = false;
  let fordMsg = '';
  let fordErr = '';

  // Operator-level docs (CVOR etc) — fetched separately from the
  // per-vehicle expiry summary because they belong to the business,
  // not individual vehicles.
  let operatorDocs = null;
  let opError = '';

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
    // Best-effort: surface telematics cap on the dashboard.
    try { smartcar = await fleetApi.smartcarStatus(); } catch {}
    await loadFordconnect();
    // Show a one-shot success banner after returning from Ford OAuth.
    if (typeof window !== 'undefined' && window.location.search.includes('fordconnect=linked')) {
      fordMsg = 'FordPass connected. Click "Sync now" to pull vehicles.';
      // Clean the URL so a refresh doesn't reshow the message.
      const u = new URL(window.location.href);
      u.searchParams.delete('fordconnect');
      window.history.replaceState({}, '', u.toString());
    }
  });

  async function loadFordconnect() {
    try { fordconnect = await fleetApi.fordconnectStatus(); }
    catch (e) { fordconnect = null; }
    if (fordconnect?.linked) {
      try { fordconnectVehicles = (await fleetApi.fordconnectVehicles()).vehicles || []; }
      catch { /* ignore */ }
    } else {
      fordconnectVehicles = [];
    }
  }

  const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';
  function fordconnectAuthorize() {
    // Full-page navigation — OAuth needs a top-level redirect so Ford's
    // login page works (popup approaches break with Apple/Google SSO).
    window.location.href = `${API_BASE_URL}/fleet/fordconnect/authorize`;
  }

  async function fordconnectSync() {
    fordSyncBusy = true; fordErr = ''; fordMsg = '';
    try {
      const r = await fleetApi.fordconnectSync();
      fordMsg = `Synced ${r.synced} vehicle${r.synced === 1 ? '' : 's'} from FordPass.`;
      await loadFordconnect();
    } catch (e) {
      fordErr = e.message || 'Sync failed.';
    } finally {
      fordSyncBusy = false;
    }
  }

  async function fordconnectUnlink() {
    if (!confirm('Disconnect FordPass? Telematics will stop updating until you reconnect.')) return;
    try {
      await fleetApi.fordconnectUnlink();
      fordconnect = { configured: fordconnect?.configured, linked: false, link: null };
      fordconnectVehicles = [];
      fordMsg = 'Disconnected.';
    } catch (e) { fordErr = e.message; }
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

    {#if smartcar?.configured}
      <p class="hint small telematics-line">
        Telematics: <strong>{smartcar.connected}</strong> of {smartcar.cap} vehicles connected ({smartcar.mode === 'live' ? 'live' : 'test mode'}).
        {#if smartcar.connected === smartcar.cap}<span class="muted">— cap reached.</span>{/if}
      </p>
    {/if}

    <!-- ─── FordConnect telematics card ────────────────────────────── -->
    <section class="card fordconnect-card">
      <header class="ts-head">
        <h2>
          FordConnect telematics
          {#if !fordconnect?.configured}
            <span class="ts-pill ts-pill-off">Not configured</span>
          {:else if !fordconnect?.linked}
            <span class="ts-pill ts-pill-off">Not connected</span>
          {:else if fordconnect.link?.expired}
            <span class="ts-pill ts-pill-warn">Token expired</span>
          {:else}
            <span class="ts-pill ts-pill-on">Connected</span>
          {/if}
        </h2>
      </header>

      {#if fordMsg}<p class="alert success">{fordMsg}</p>{/if}
      {#if fordErr}<p class="alert error">{fordErr}</p>{/if}

      {#if !fordconnect?.configured}
        <p class="hint small">
          Set <code>FORDCONNECT_CLIENT_ID</code>, <code>FORDCONNECT_CLIENT_SECRET</code>,
          and <code>FORDCONNECT_REDIRECT_URI</code> as Railway env vars to enable.
        </p>
      {:else if !fordconnect?.linked}
        <p class="hint small">
          Connect a FordPass account (one that owns the trucks in this fleet). After
          authorizing, vehicles auto-link by VIN and a Sync pulls in the latest
          location + odometer for each.
        </p>
        <div class="ts-actions">
          <button class="btn primary" on:click={fordconnectAuthorize}>Connect FordPass →</button>
        </div>
      {:else}
        <p class="hint small">
          {fordconnect.link?.last_status || 'Connected — pending first sync.'}
          {#if fordconnect.link?.last_synced_at}
            · Last synced {new Date(fordconnect.link.last_synced_at).toLocaleString('en-CA')}
          {/if}
        </p>
        <div class="ts-actions">
          <button class="btn primary" on:click={fordconnectSync} disabled={fordSyncBusy}>
            {fordSyncBusy ? 'Syncing…' : '↻ Sync now'}
          </button>
          <button class="btn outline" on:click={fordconnectAuthorize}>Re-authorize</button>
          <button class="link-btn destructive" on:click={fordconnectUnlink}>Disconnect</button>
        </div>

        {#if fordconnectVehicles.length > 0}
          <table class="ford-vehicle-table">
            <thead>
              <tr><th>VIN</th><th>Vehicle</th><th>Linked to fleet</th><th>Odometer</th><th>Last seen</th></tr>
            </thead>
            <tbody>
              {#each fordconnectVehicles as v (v.id)}
                <tr>
                  <td class="mono small">{v.ford_vin}</td>
                  <td>{[v.year, v.make, v.model].filter(Boolean).join(' ') || v.ford_nickname || '—'}</td>
                  <td>{v.unit_number ? `#${v.unit_number}` : '— not in fleet —'}</td>
                  <td>{v.last_odometer_km != null ? `${Number(v.last_odometer_km).toLocaleString('en-CA')} km` : '—'}</td>
                  <td class="small">{v.last_location_at ? new Date(v.last_location_at).toLocaleString('en-CA') : '—'}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        {/if}
      {/if}
    </section>

    <nav class="links">
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
