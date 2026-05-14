<!-- src/routes/admin/led-quote/+page.svelte
     LED Sign Quoting tool. Computes module fit, face dimensions, area,
     pixel resolution, max power draw, and price from a module spec +
     target placement size.

     Standalone use: /admin/led-quote — pick a module, enter placement,
     copy the generated description string.

     Job-attached use: /admin/led-quote?job=<id> — the client/job-number
     fields auto-populate (and lock) from the project, and the "Copy"
     button is replaced with "Save to Job" which writes a line item via
     api.addItem() and returns to /jobs/<id>.

     Math lives in $lib/shop/ledQuote.js so the prototype's calculations
     can be unit-tested. -->
<script>
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { auth, isStaff } from '$lib/stores/auth.js';
  import { api } from '$lib/api/client.js';
  import { computeQuote, buildDescription, fmt, money, round, MM_PER_INCH } from '$lib/shop/ledQuote.js';

  // ─── Job context (when launched from /jobs/[id]) ───────────────────
  $: jobId = $page.url.searchParams.get('job') || '';
  let project = null;
  let projectLoading = false;
  let projectError = '';

  // ─── Module catalog ────────────────────────────────────────────────
  let modules = [];
  let modulesLoaded = false;
  let modulesError = '';
  let selectedModuleId = '';
  $: selectedModule = modules.find(m => m.id === Number(selectedModuleId)) || null;

  // ─── Quote inputs ──────────────────────────────────────────────────
  let client = '';
  let jobNumber = '';
  let unit = 'mm';        // 'mm' | 'in'
  let targetW = '';
  let targetH = '';
  let fitMode = 'nearest'; // 'nearest' | 'down'
  let sides = 2;
  let rate = '4800';       // $ per m²

  // ─── Module editor modal ───────────────────────────────────────────
  let showEditor = false;
  let editingId = null;
  const blankDraft = { name: '', width_mm: '', height_mm: '', pitch_mm: '', max_watts: '', control_system: '' };
  let draft = { ...blankDraft };
  let savingModule = false;
  let editorError = '';

  $: draftValid =
    draft.name.trim() &&
    Number(draft.width_mm)  > 0 &&
    Number(draft.height_mm) > 0 &&
    Number(draft.pitch_mm)  > 0 &&
    Number(draft.max_watts) > 0;

  // ─── Save-to-job state ─────────────────────────────────────────────
  let saving = false;
  let copied = false;

  // ─── Derived: the quote itself ─────────────────────────────────────
  $: calc = computeQuote({
    module: selectedModule,
    targetW, targetH, unit, fitMode, sides, rate,
  });
  $: description = calc && selectedModule ? buildDescription(calc, selectedModule, sides) : '';

  // ─── Lifecycle ─────────────────────────────────────────────────────
  onMount(async () => {
    if (!$auth || !$isStaff) { goto('/login?return=/admin/led-quote'); return; }
    await loadModules();
    if (jobId) await loadProject(jobId);
  });

  async function loadModules() {
    modulesError = '';
    try {
      const res = await api.getLedModules();
      modules = res.modules || [];
      modulesLoaded = true;
      if (modules.length && !selectedModuleId) selectedModuleId = String(modules[0].id);
    } catch (e) {
      modulesError = e.message || String(e);
    }
  }

  async function loadProject(id) {
    projectLoading = true; projectError = '';
    try {
      project = await api.getProject(id);
      client    = project.client_name || project.client || '';
      jobNumber = String(project.id || '');
    } catch (e) {
      projectError = e.message || String(e);
    } finally {
      projectLoading = false;
    }
  }

  // ─── Module editor handlers ────────────────────────────────────────
  function openNewModule() {
    editingId = null;
    draft = { ...blankDraft };
    editorError = '';
    showEditor = true;
  }
  function openEditModule() {
    if (!selectedModule) return;
    editingId = selectedModule.id;
    draft = {
      name:           selectedModule.name || '',
      width_mm:       String(selectedModule.width_mm  ?? ''),
      height_mm:      String(selectedModule.height_mm ?? ''),
      pitch_mm:       String(selectedModule.pitch_mm  ?? ''),
      max_watts:      String(selectedModule.max_watts ?? ''),
      control_system: selectedModule.control_system || '',
    };
    editorError = '';
    showEditor = true;
  }
  async function saveDraft() {
    if (!draftValid) return;
    savingModule = true; editorError = '';
    const payload = {
      name:           draft.name.trim(),
      width_mm:       Number(draft.width_mm),
      height_mm:      Number(draft.height_mm),
      pitch_mm:       Number(draft.pitch_mm),
      max_watts:      Number(draft.max_watts),
      control_system: draft.control_system.trim() || null,
    };
    try {
      const saved = editingId
        ? await api.updateLedModule(editingId, payload)
        : await api.createLedModule(payload);
      await loadModules();
      selectedModuleId = String(saved.id);
      showEditor = false;
    } catch (e) {
      editorError = e.message || String(e);
    } finally {
      savingModule = false;
    }
  }
  async function deleteModule() {
    if (!editingId) return;
    if (!confirm('Retire this module from the catalog?\n\nIt is soft-deleted — historic quote descriptions still reference its name, but it will no longer appear in the dropdown.')) return;
    savingModule = true; editorError = '';
    try {
      await api.deleteLedModule(editingId);
      await loadModules();
      selectedModuleId = modules.length ? String(modules[0].id) : '';
      showEditor = false;
    } catch (e) {
      editorError = e.message || String(e);
    } finally {
      savingModule = false;
    }
  }

  // ─── Output handlers ───────────────────────────────────────────────
  function copyDescription() {
    if (!description) return;
    navigator.clipboard?.writeText(description).then(
      () => { copied = true; setTimeout(() => copied = false, 1800); },
      () => {}
    );
  }

  async function saveToJob() {
    if (!calc || !selectedModule || !jobId) return;
    saving = true;
    try {
      await api.addItem(jobId, {
        description: description,
        qty:   round(calc.totalArea, 4),
        price: Number(rate) || 0,
        total: round(calc.total, 2),
        qb_item_name: null,
      });
      goto(`/jobs/${jobId}`);
    } catch (e) {
      alert(e.message || String(e));
    } finally {
      saving = false;
    }
  }

  function deltaClass(mm) {
    if (Math.abs(mm) < 0.5) return 'delta-ok';
    return mm > 0 ? 'delta-over' : 'delta-under';
  }
  function fmtDelta(mm) {
    const sign = mm > 0 ? '+' : '';
    const inches = mm / MM_PER_INCH;
    return `${sign}${fmt(mm, 0)}mm (${sign}${fmt(inches, 2)}")`;
  }
</script>

<svelte:head><title>LED Sign Quote — Holm Graphics</title></svelte:head>

<div class="page">
  <div class="page-head">
    <h1 class="page-title">LED Sign Quote</h1>
    <span class="muted">{modules.length} module{modules.length === 1 ? '' : 's'} in catalog</span>
  </div>

  {#if jobId}
    <div class="job-banner">
      {#if projectLoading}
        Loading job…
      {:else if projectError}
        <span class="err">Job {jobId} load failed: {projectError}</span>
      {:else if project}
        <span>
          Attached to <a href="/jobs/{jobId}">Job #{project.id}</a>
          {#if project.client_name} — {project.client_name}{/if}
          {#if project.description}: {project.description}{/if}
        </span>
        <a href="/jobs/{jobId}" class="back-link">← Back to job</a>
      {/if}
    </div>
  {/if}

  {#if modulesError}<div class="notice error">⚠ {modulesError}</div>{/if}

  <!-- ── Job + module ───────────────────────────────────────────────── -->
  <div class="card">
    <div class="grid-2">
      <div class="form-group">
        <label>Client</label>
        <input bind:value={client} placeholder="Canadian Tire Kincardine" disabled={!!jobId} />
      </div>
      <div class="form-group">
        <label>Job #</label>
        <input bind:value={jobNumber} placeholder="9614" disabled={!!jobId} />
      </div>
    </div>

    <div class="form-group">
      <label>Module Type</label>
      <div class="module-row">
        <select bind:value={selectedModuleId} disabled={modules.length === 0}>
          {#if modules.length === 0}
            <option value="">— no modules yet —</option>
          {/if}
          {#each modules as m}
            <option value={String(m.id)}>
              {m.name} · {m.width_mm}×{m.height_mm}mm · P{m.pitch_mm} · {m.max_watts}W
            </option>
          {/each}
        </select>
        <button class="btn btn-ghost" on:click={openEditModule} disabled={!selectedModule}>Edit</button>
        <button class="btn btn-primary" on:click={openNewModule}>+ New module</button>
      </div>

      {#if selectedModule}
        <div class="module-meta">
          <span>module: <strong>{selectedModule.width_mm}×{selectedModule.height_mm}mm</strong></span>
          <span>pitch: <strong>P-{selectedModule.pitch_mm}</strong></span>
          <span>max draw: <strong>{selectedModule.max_watts}W</strong></span>
          {#if selectedModule.control_system}
            <span>control: <strong>{selectedModule.control_system}</strong></span>
          {/if}
        </div>
      {/if}
    </div>
  </div>

  <!-- ── Placement inputs ───────────────────────────────────────────── -->
  <div class="card">
    <div class="grid-placement">
      <div class="form-group">
        <label>Units</label>
        <select bind:value={unit}>
          <option value="mm">mm</option>
          <option value="in">inches</option>
        </select>
      </div>
      <div class="form-group">
        <label>Placement Width ({unit})</label>
        <input type="number" bind:value={targetW} placeholder={unit === 'mm' ? '2560' : '100.79'} />
      </div>
      <div class="form-group">
        <label>Placement Height ({unit})</label>
        <input type="number" bind:value={targetH} placeholder={unit === 'mm' ? '1440' : '56.69'} />
      </div>
    </div>

    <div class="grid-3">
      <div class="form-group">
        <label>Module Fit</label>
        <select bind:value={fitMode}>
          <option value="nearest">Nearest (round to closest)</option>
          <option value="down">Round down (stay under)</option>
        </select>
      </div>
      <div class="form-group">
        <label>Sides</label>
        <select bind:value={sides} on:change={(e) => sides = Number(e.target.value)}>
          <option value={1}>Single-sided</option>
          <option value={2}>Double-sided</option>
        </select>
      </div>
      <div class="form-group">
        <label>Rate ($ / m²)</label>
        <input type="number" bind:value={rate} placeholder="4800" />
      </div>
    </div>
  </div>

  <!-- ── Results ────────────────────────────────────────────────────── -->
  {#if !calc}
    <div class="card placeholder">
      {#if !modulesLoaded}
        Loading…
      {:else if !selectedModule}
        Add a module to the catalog to get started.
      {:else}
        Enter placement width and height to calculate the quote.
      {/if}
    </div>
  {:else}
    <!-- Sign face -->
    <div class="card">
      <h2 class="section-title">Sign Face</h2>
      <div class="stat-grid">
        <div class="stat"><div class="stat-val">{calc.modsWide}×{calc.modsTall}</div><div class="stat-lbl">Module array</div></div>
        <div class="stat"><div class="stat-val">{fmt(calc.faceWmm, 0)}<span>mm</span></div><div class="stat-lbl">Face width</div></div>
        <div class="stat"><div class="stat-val">{fmt(calc.faceHmm, 0)}<span>mm</span></div><div class="stat-lbl">Face height</div></div>
        <div class="stat"><div class="stat-val">{fmt(calc.faceWin, 1)}×{fmt(calc.faceHin, 1)}<span>"</span></div><div class="stat-lbl">Face (inches)</div></div>
        <div class="stat"><div class="stat-val">{calc.pxWide}×{calc.pxTall}<span>px</span></div><div class="stat-lbl">Resolution / side</div></div>
        <div class="stat"><div class="stat-val">{fmt(calc.areaPerSide, 4)}<span>m²</span></div><div class="stat-lbl">Area / side</div></div>
        <div class="stat"><div class="stat-val">{fmt(calc.totalArea, 4)}<span>m²</span></div><div class="stat-lbl">Total area ({sides}-sided)</div></div>
        <div class="stat"><div class="stat-val">{calc.totalModules}</div><div class="stat-lbl">Total modules</div></div>
      </div>

      <div class="delta-row">
        vs. requested placement:
        <span class={deltaClass(calc.dWmm)}>W {fmtDelta(calc.dWmm)}</span>
        ·
        <span class={deltaClass(calc.dHmm)}>H {fmtDelta(calc.dHmm)}</span>
        {#if fitMode === 'down'}
          <span class="muted"> (round-down keeps the sign within the opening)</span>
        {/if}
      </div>
    </div>

    <!-- Power -->
    <div class="card">
      <h2 class="section-title">Power Consumption — Maximum Draw</h2>
      <div class="stat-grid">
        <div class="stat amber"><div class="stat-val">{fmt(calc.maxW, 0)}<span>W</span></div><div class="stat-lbl">Max power draw</div></div>
        <div class="stat amber"><div class="stat-val">{fmt(calc.maxW / 1000, 2)}<span>kW</span></div><div class="stat-lbl">Max draw (kW)</div></div>
        <div class="stat amber"><div class="stat-val">{fmt(calc.ampsAt120, 1)}<span>A</span></div><div class="stat-lbl">Amps @ 120V</div></div>
        <div class="stat amber"><div class="stat-val">{fmt(calc.ampsAt240, 1)}<span>A</span></div><div class="stat-lbl">Amps @ 240V</div></div>
      </div>
      <p class="muted small">
        Based on {selectedModule.max_watts}W max per module × {calc.totalModules} modules.
        This is the peak figure for sizing the electrical service and breakers — actual average
        draw on typical content runs lower. Add power-supply headroom and any controller /
        receiver-card load separately.
      </p>
    </div>

    <!-- Quote -->
    <div class="card quote-card">
      <h2 class="section-title">Quote</h2>
      <div class="quote-row">
        <div class="muted mono">{fmt(calc.totalArea, 4)} m² × {money(Number(rate) || 0)}/m²</div>
        <div class="quote-total mono">{money(calc.total)}</div>
      </div>
    </div>

    <!-- Description -->
    <div class="card">
      <div class="desc-head">
        <h2 class="section-title no-margin">Generated Description</h2>
        {#if jobId}
          <button class="btn btn-primary" on:click={saveToJob} disabled={saving || !description}>
            {saving ? 'Saving…' : `Save to Job #${jobId}`}
          </button>
        {:else}
          <button class="btn btn-primary" on:click={copyDescription} disabled={!description}>
            {copied ? '✓ Copied' : 'Copy'}
          </button>
        {/if}
      </div>
      <div class="desc-body mono">
        {#if client || jobNumber}
          <div class="desc-head-line">
            {client}{client && jobNumber ? ' — ' : ''}{jobNumber ? `Job ${jobNumber}` : ''}
          </div>
        {/if}
        {description}
      </div>
    </div>
  {/if}
</div>

<!-- ── Module editor modal ────────────────────────────────────────────── -->
{#if showEditor}
  <div class="modal-backdrop" on:click|self={() => !savingModule && (showEditor = false)}>
    <div class="modal" role="dialog" aria-modal="true" aria-label="Module editor">
      <div class="modal-head">
        <h2>{editingId ? 'Edit module' : 'New module'}</h2>
        <button class="modal-close" on:click={() => !savingModule && (showEditor = false)} aria-label="Close">×</button>
      </div>
      <div class="modal-body">
        <p class="muted small no-top">Saved to the shared catalog for reuse on future quotes.</p>

        {#if editorError}<div class="notice error">⚠ {editorError}</div>{/if}

        <div class="form-group">
          <label>Module name / label</label>
          <input bind:value={draft.name} placeholder="P8 Outdoor — 320x160" />
        </div>

        <div class="grid-2">
          <div class="form-group">
            <label>Module width (mm)</label>
            <input type="number" bind:value={draft.width_mm} placeholder="320" />
          </div>
          <div class="form-group">
            <label>Module height (mm)</label>
            <input type="number" bind:value={draft.height_mm} placeholder="160" />
          </div>
          <div class="form-group">
            <label>Pixel pitch (mm)</label>
            <input type="number" step="0.01" bind:value={draft.pitch_mm} placeholder="8" />
          </div>
          <div class="form-group">
            <label>Max watts / module</label>
            <input type="number" step="0.01" bind:value={draft.max_watts} placeholder="36" />
          </div>
        </div>

        <div class="form-group">
          <label>Control system (optional)</label>
          <input bind:value={draft.control_system} placeholder="Novastar T-30" />
        </div>
      </div>
      <div class="modal-foot">
        <div>
          {#if editingId}
            <button class="btn btn-ghost danger" on:click={deleteModule} disabled={savingModule}>Retire</button>
          {/if}
        </div>
        <div class="modal-foot-right">
          <button class="btn btn-ghost" on:click={() => showEditor = false} disabled={savingModule}>Cancel</button>
          <button class="btn btn-primary" on:click={saveDraft} disabled={!draftValid || savingModule}>
            {savingModule ? 'Saving…' : (editingId ? 'Save changes' : 'Add module')}
          </button>
        </div>
      </div>
    </div>
  </div>
{/if}

<style>
  .page { padding: 24px; max-width: 1100px; margin: 0 auto; }
  .page-head {
    display: flex; align-items: baseline; justify-content: space-between;
    border-bottom: 2px solid var(--text); padding-bottom: 10px; margin-bottom: 16px;
  }
  .page-title {
    font-family: var(--font-display); font-size: 1.6rem;
    letter-spacing: 0.04em; text-transform: uppercase; margin: 0;
  }
  .muted       { color: var(--text-muted); font-size: 0.92rem; }
  .muted.small { font-size: 0.82rem; }
  .muted.no-top { margin-top: 0; }

  .card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    padding: 16px 18px;
    margin-bottom: 14px;
  }
  .card.placeholder {
    text-align: center; color: var(--text-muted);
    padding: 32px 16px; font-size: 0.95rem;
  }
  .section-title {
    font-family: var(--font-display);
    font-size: 0.95rem; font-weight: 700;
    letter-spacing: 0.06em; text-transform: uppercase;
    color: var(--text); margin: 0 0 12px;
    padding-bottom: 6px; border-bottom: 1px solid var(--border);
  }
  .section-title.no-margin { margin: 0; padding: 0; border: 0; }

  /* Job banner */
  .job-banner {
    display: flex; align-items: center; justify-content: space-between;
    gap: 12px; flex-wrap: wrap;
    background: var(--red-glow); border: 1px solid var(--red);
    border-radius: var(--radius); padding: 10px 14px; margin-bottom: 14px;
    font-size: 0.9rem;
  }
  .job-banner a { color: var(--red); font-weight: 600; }
  .back-link { font-family: var(--font-display); letter-spacing: 0.04em; text-transform: uppercase; font-size: 0.8rem; }

  /* Form grids */
  .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px; }
  .grid-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; }
  .grid-placement {
    display: grid; grid-template-columns: 120px 1fr 1fr; gap: 12px;
    align-items: end; margin-bottom: 12px;
  }
  .form-group { display: flex; flex-direction: column; gap: 4px; }
  .form-group label {
    font-family: var(--font-display); font-size: 0.72rem;
    letter-spacing: 0.06em; text-transform: uppercase;
    color: var(--text-muted); font-weight: 600;
  }
  .form-group input:disabled, .form-group select:disabled {
    background: var(--surface-2); color: var(--text-muted);
    cursor: not-allowed;
  }

  /* Module picker row */
  .module-row { display: flex; gap: 8px; align-items: stretch; }
  .module-row select { flex: 1; }
  .module-row .btn { white-space: nowrap; }
  .module-meta {
    margin-top: 10px;
    display: flex; flex-wrap: wrap; gap: 16px;
    font-family: ui-monospace, "Cascadia Code", monospace;
    font-size: 0.82rem; color: var(--text-muted);
  }
  .module-meta strong { color: var(--text); font-weight: 600; }

  /* Stat grid (sign face + power) */
  .stat-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
  .stat {
    border: 1px solid var(--border);
    border-left: 3px solid var(--text);
    border-radius: var(--radius);
    padding: 10px 12px;
    background: var(--surface-2);
  }
  .stat.amber { border-left-color: var(--amber); }
  .stat-val {
    font-family: ui-monospace, "Cascadia Code", monospace;
    font-size: 1.15rem; font-weight: 600; color: var(--text); line-height: 1.1;
  }
  .stat-val span { font-size: 0.72rem; color: var(--text-muted); margin-left: 3px; }
  .stat-lbl {
    font-family: var(--font-display); font-size: 0.65rem;
    letter-spacing: 0.07em; text-transform: uppercase;
    color: var(--text-muted); margin-top: 4px; font-weight: 600;
  }

  /* Delta row */
  .delta-row {
    margin-top: 12px;
    padding: 8px 10px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    font-family: ui-monospace, "Cascadia Code", monospace;
    font-size: 0.82rem; color: var(--text-muted);
  }
  .delta-ok    { color: var(--green); font-weight: 600; }
  .delta-over  { color: var(--amber); font-weight: 600; }
  .delta-under { color: var(--red);   font-weight: 600; }

  /* Quote card */
  .quote-card { border-left: 4px solid var(--red); }
  .quote-row {
    display: flex; justify-content: space-between;
    align-items: center; flex-wrap: wrap; gap: 12px;
  }
  .mono { font-family: ui-monospace, "Cascadia Code", monospace; }
  .quote-total { font-size: 1.8rem; font-weight: 600; color: var(--text); }

  /* Description */
  .desc-head {
    display: flex; align-items: center; justify-content: space-between;
    margin-bottom: 10px;
  }
  .desc-body {
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 10px 12px;
    font-size: 0.82rem; line-height: 1.6;
    color: var(--text);
  }
  .desc-head-line { color: var(--text-muted); margin-bottom: 4px; }

  /* Notice */
  .notice { padding: 10px 12px; border-radius: var(--radius); margin: 0 0 12px; font-size: 0.9rem; }
  .notice.error { background: rgba(220,53,69,0.12); color: var(--red); border: 1px solid rgba(220,53,69,0.3); }
  .err { color: var(--red); }

  /* Buttons (the global .btn .btn-primary .btn-ghost already exist; just
     add a danger variant and disabled handling). */
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn.danger { color: var(--red); border-color: var(--red); }

  /* Modal — same shape as /admin/pay-periods sync-result modal */
  .modal-backdrop {
    position: fixed; inset: 0; background: rgba(0,0,0,0.55);
    display: flex; align-items: flex-start; justify-content: center;
    padding: 6vh 1rem; z-index: 1000;
  }
  .modal {
    background: var(--surface); color: var(--text);
    border: 1px solid var(--border); border-radius: var(--radius-lg);
    width: 100%; max-width: 520px;
    box-shadow: 0 20px 50px rgba(0,0,0,0.5);
    display: flex; flex-direction: column; max-height: 88vh;
  }
  .modal-head {
    display: flex; align-items: center; justify-content: space-between;
    padding: 14px 18px; border-bottom: 1px solid var(--border);
  }
  .modal-head h2 {
    margin: 0; font-family: var(--font-display);
    font-size: 1.05rem; letter-spacing: 0.04em; text-transform: uppercase;
  }
  .modal-close {
    background: none; border: 0; color: var(--text-muted);
    font-size: 1.6rem; line-height: 1; cursor: pointer; padding: 0 4px;
  }
  .modal-body { padding: 14px 18px; overflow-y: auto; }
  .modal-foot {
    display: flex; justify-content: space-between; align-items: center;
    gap: 8px; padding: 12px 18px; border-top: 1px solid var(--border);
  }
  .modal-foot-right { display: flex; gap: 8px; }

  @media (max-width: 720px) {
    .stat-grid { grid-template-columns: repeat(2, 1fr); }
    .grid-2, .grid-3 { grid-template-columns: 1fr; }
    .grid-placement { grid-template-columns: 1fr; }
  }
</style>
