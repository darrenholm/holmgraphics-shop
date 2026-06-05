<!--
  /inventory/media — Phase 1 vinyl inventory.

  Two stacked sections:
    • Rolls   — every physical instance with its computed remaining
                yards (color-coded against the SKU's reorder threshold).
                Click "Measure" to record a fresh outer diameter and the
                remaining yards updates in place.
    • Products — the SKU catalog with calibration. Each row exposes
                  full-roll length + new-roll diameter calibration so
                  the formula has what it needs.

  The remaining-yardage math lives server-side in the
  media_rolls_with_remaining view (see migration 046) so this page
  doesn't reinvent the formula.
-->
<script>
  import { onMount } from 'svelte';
  import { api } from '$lib/api/client.js';
  import { isStaff } from '$lib/stores/auth.js';

  let products = [];
  let rolls    = [];
  let loading  = true;
  let err      = '';

  // Filter rolls by product, brand, or text search.
  let filterProduct = '';
  let filterText    = '';
  $: filteredRolls = rolls.filter((r) => {
    if (filterProduct && String(r.product_id) !== String(filterProduct)) return false;
    if (filterText) {
      const hay = `${r.brand || ''} ${r.product_line || ''} ${r.color || ''} ${r.sku || ''} ${r.roll_label || ''} ${r.location || ''}`.toLowerCase();
      if (!hay.includes(filterText.toLowerCase())) return false;
    }
    return true;
  });

  // Modals
  let measuringRoll  = null;
  let editingProduct = null;
  let editingRoll    = null;
  let addingProduct  = false;
  let addingRoll     = false;

  function emptyProduct() {
    return {
      sku: '', brand: '', product_line: '', color: '', finish: '',
      width_in: '', core_diameter_in: 3.0, full_length_yd: '',
      calibration_outer_diameter_in: '',
      reorder_threshold_yd: '',
      supplier: '', supplier_sku: '', notes: '',
    };
  }
  function emptyRoll() {
    return {
      product_id: '', roll_label: '', location: '',
      measured_dia_in: '', notes: '',
    };
  }
  let newProduct = emptyProduct();
  let newRoll    = emptyRoll();

  async function refresh() {
    if (!$isStaff) return;
    loading = true; err = '';
    try {
      const [pResp, rResp] = await Promise.all([
        api.listMediaProducts(),
        api.listMediaRolls(),
      ]);
      products = pResp.products || [];
      rolls    = rResp.rolls    || [];
    } catch (e) {
      err = e.message || 'Failed to load inventory.';
    } finally {
      loading = false;
    }
  }
  onMount(refresh);

  // ─── Product helpers ────────────────────────────────────────────────
  function productLabel(p) {
    const parts = [p.brand, p.product_line, p.color, p.finish, p.width_in ? `${p.width_in}"` : null]
      .filter(Boolean);
    return parts.length ? parts.join(' · ') : (p.sku || `Product #${p.id}`);
  }

  async function saveNewProduct() {
    try {
      await api.createMediaProduct(newProduct);
      newProduct = emptyProduct();
      addingProduct = false;
      await refresh();
    } catch (e) { err = e.message; }
  }
  async function saveEditProduct() {
    try {
      await api.updateMediaProduct(editingProduct.id, editingProduct);
      editingProduct = null;
      await refresh();
    } catch (e) { err = e.message; }
  }

  // ─── Roll helpers ───────────────────────────────────────────────────
  function rollHeadline(r) {
    return r.roll_label
      ? `${r.roll_label} — ${r.brand || ''} ${r.product_line || ''} ${r.color || ''} ${r.width_in ? `${r.width_in}"` : ''}`.trim()
      : `${r.brand || ''} ${r.product_line || ''} ${r.color || ''} ${r.width_in ? `${r.width_in}"` : ''}`.trim();
  }
  function formatYd(v) {
    if (v == null) return '—';
    return `${Number(v).toFixed(1)} yd`;
  }
  function remainingClass(r) {
    if (r.remaining_yd == null) return 'remaining-unknown';
    if (r.low_stock)            return 'remaining-low';
    return '';
  }
  function statusBadgeClass(s) {
    switch (s) {
      case 'depleted': return 'st-empty';
      case 'damaged':  return 'st-damaged';
      case 'retired':  return 'st-retired';
      default:         return 'st-active';
    }
  }

  async function saveNewRoll() {
    if (!newRoll.product_id) { err = 'Pick a product first.'; return; }
    try {
      await api.createMediaRoll(newRoll);
      newRoll = emptyRoll();
      addingRoll = false;
      await refresh();
    } catch (e) { err = e.message; }
  }
  async function saveEditRoll() {
    try {
      await api.updateMediaRoll(editingRoll.id, {
        roll_label: editingRoll.roll_label,
        location:   editingRoll.location,
        notes:      editingRoll.notes,
        status:     editingRoll.status,
      });
      editingRoll = null;
      await refresh();
    } catch (e) { err = e.message; }
  }

  function openMeasure(r) {
    measuringRoll = {
      id: r.id,
      label: rollHeadline(r),
      product_uncalibrated: r.calibration_outer_diameter_in == null,
      core_diameter_in: r.core_diameter_in,
      last_measured_dia_in: r.last_measured_dia_in,
      last_remaining_yd: r.remaining_yd,
      measured_dia_in: '',
      notes: '',
    };
  }
  async function submitMeasure() {
    if (!measuringRoll?.measured_dia_in) {
      err = 'Enter the measured outer diameter (inches).';
      return;
    }
    try {
      await api.measureMediaRoll(
        measuringRoll.id,
        Number(measuringRoll.measured_dia_in),
        measuringRoll.notes
      );
      measuringRoll = null;
      await refresh();
    } catch (e) { err = e.message; }
  }
  async function retireRoll(r) {
    if (!confirm(`Retire roll #${r.id}? Status changes to retired but history is preserved.`)) return;
    try {
      await api.retireMediaRoll(r.id);
      await refresh();
    } catch (e) { err = e.message; }
  }

  // Rolls grouped by product for the summary section.
  $: productSummaries = products.map((p) => {
    const productRolls = rolls.filter((r) => r.product_id === p.id && r.status !== 'retired');
    const total = productRolls.reduce((s, r) => s + (Number(r.remaining_yd) || 0), 0);
    return {
      ...p,
      roll_count: productRolls.length,
      total_yd: total,
      below_threshold: p.reorder_threshold_yd != null && total < Number(p.reorder_threshold_yd),
    };
  });
</script>

<svelte:head><title>Media Inventory — Holm Graphics</title></svelte:head>

<div class="inv-page">
  <header>
    <h1>Vinyl & media inventory</h1>
    <p class="muted small">
      Measure outer diameter with calipers, the remaining yardage updates
      via the calibration formula. Calibrate each SKU once against a known-new roll.
    </p>
  </header>

  {#if err}<div class="error">{err}</div>{/if}
  {#if loading}<p class="muted">Loading…</p>{/if}

  <!-- ─── Rolls ──────────────────────────────────────────────────── -->
  <section class="card">
    <h2 class="card-title">
      Rolls
      <span class="muted small">({filteredRolls.length}{rolls.length !== filteredRolls.length ? ` of ${rolls.length}` : ''})</span>
      <button class="btn btn-primary" style="float:right" on:click={() => { addingRoll = true; }}>+ Add roll</button>
    </h2>

    <div class="filters">
      <input bind:value={filterText} placeholder="🔍 Search brand / SKU / label / location" />
      <select bind:value={filterProduct}>
        <option value="">All products</option>
        {#each products as p}
          <option value={p.id}>{productLabel(p)}</option>
        {/each}
      </select>
    </div>

    {#if addingRoll}
      <div class="row-form">
        <select bind:value={newRoll.product_id}>
          <option value="">— pick product —</option>
          {#each products as p}
            <option value={p.id}>{productLabel(p)}</option>
          {/each}
        </select>
        <input bind:value={newRoll.roll_label} placeholder="Label (optional)" />
        <input bind:value={newRoll.location}   placeholder="Location" />
        <input type="number" step="0.001" min="0" bind:value={newRoll.measured_dia_in} placeholder='Initial OD (")' />
        <button class="btn btn-primary" on:click={saveNewRoll}>Save</button>
        <button class="btn btn-ghost"   on:click={() => { addingRoll = false; newRoll = emptyRoll(); }}>Cancel</button>
      </div>
    {/if}

    {#if filteredRolls.length === 0 && !loading}
      <p class="muted">No rolls yet. Add one or adjust the filter.</p>
    {/if}

    <table class="roll-table">
      <thead>
        <tr>
          <th>Roll</th>
          <th>Product</th>
          <th>Location</th>
          <th>Last OD</th>
          <th>Remaining</th>
          <th>Last measured</th>
          <th>Status</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {#each filteredRolls as r (r.id)}
          <tr>
            <td>
              <strong>{r.roll_label || `#${r.id}`}</strong>
              {#if r.notes}<div class="muted small">{r.notes}</div>{/if}
            </td>
            <td>
              <div>{r.brand || ''} {r.product_line || ''}</div>
              <div class="muted small">{r.color || ''} · {r.width_in ? `${r.width_in}"` : ''} · {r.full_length_yd}yd full</div>
            </td>
            <td>{r.location || '—'}</td>
            <td>{r.last_measured_dia_in ? `${Number(r.last_measured_dia_in).toFixed(2)}"` : '—'}</td>
            <td class={remainingClass(r)}>
              {formatYd(r.remaining_yd)}
              {#if r.calibration_outer_diameter_in == null}
                <div class="muted small">no calibration</div>
              {/if}
            </td>
            <td class="muted small">
              {#if r.last_measured_at}
                {new Date(r.last_measured_at).toLocaleDateString('en-CA')}
                {#if r.last_measured_by_name}<br />by {r.last_measured_by_name}{/if}
              {:else}—{/if}
            </td>
            <td><span class="status-pill {statusBadgeClass(r.status)}">{r.status}</span></td>
            <td class="actions">
              <button class="btn btn-primary" on:click={() => openMeasure(r)}>📏 Measure</button>
              <button class="btn btn-ghost"   on:click={() => editingRoll = { ...r }}>✎</button>
              {#if r.status !== 'retired'}
                <button class="btn btn-danger-ghost" on:click={() => retireRoll(r)}>×</button>
              {/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </section>

  <!-- ─── Products / SKU catalog ─────────────────────────────────── -->
  <section class="card">
    <h2 class="card-title">
      Products (SKUs)
      <span class="muted small">({products.length})</span>
      <button class="btn btn-primary" style="float:right" on:click={() => { addingProduct = true; }}>+ Add SKU</button>
    </h2>

    {#if addingProduct}
      <div class="product-form">
        <div class="row3">
          <label>Brand<input bind:value={newProduct.brand} placeholder="3M / Avery / Oracal" /></label>
          <label>Product line<input bind:value={newProduct.product_line} placeholder="IJ180Cv3 / MPI 1105 / 651" /></label>
          <label>Color<input bind:value={newProduct.color} placeholder="White" /></label>
        </div>
        <div class="row3">
          <label>Finish<input bind:value={newProduct.finish} placeholder="Gloss / Matte / Translucent" /></label>
          <label>Width (in)<input type="number" step="0.25" bind:value={newProduct.width_in} /></label>
          <label>Core (in)<input type="number" step="0.5" bind:value={newProduct.core_diameter_in} /></label>
        </div>
        <div class="row3">
          <label>Full length (yd)<input type="number" step="0.5" bind:value={newProduct.full_length_yd} required /></label>
          <label>Calibration OD (in)<input type="number" step="0.001" bind:value={newProduct.calibration_outer_diameter_in} placeholder="Measure a new roll" /></label>
          <label>Reorder threshold (yd)<input type="number" step="1" bind:value={newProduct.reorder_threshold_yd} placeholder="e.g. 25" /></label>
        </div>
        <div class="row3">
          <label>SKU<input bind:value={newProduct.sku} placeholder="3M-IJ180Cv3-WHT-54" /></label>
          <label>Supplier<input bind:value={newProduct.supplier} placeholder="Wensco / Aronson" /></label>
          <label>Supplier SKU<input bind:value={newProduct.supplier_sku} /></label>
        </div>
        <label>Notes<textarea rows="2" bind:value={newProduct.notes}></textarea></label>
        <div style="display:flex;gap:8px">
          <button class="btn btn-primary" on:click={saveNewProduct}>Save SKU</button>
          <button class="btn btn-ghost"   on:click={() => { addingProduct = false; newProduct = emptyProduct(); }}>Cancel</button>
        </div>
      </div>
    {/if}

    <table class="roll-table">
      <thead>
        <tr>
          <th>Product</th>
          <th>Width</th>
          <th>Full length</th>
          <th>Calibration OD</th>
          <th>Rolls in stock</th>
          <th>Total remaining</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {#each productSummaries as p (p.id)}
          <tr class:summary-low={p.below_threshold}>
            <td>
              <strong>{productLabel(p)}</strong>
              {#if p.sku}<div class="muted small">{p.sku}</div>{/if}
            </td>
            <td>{p.width_in ? `${p.width_in}"` : '—'}</td>
            <td>{p.full_length_yd} yd</td>
            <td>
              {#if p.calibration_outer_diameter_in}
                {Number(p.calibration_outer_diameter_in).toFixed(2)}"
              {:else}
                <span class="muted">— not calibrated —</span>
              {/if}
            </td>
            <td>{p.roll_count}</td>
            <td>
              <strong>{Number(p.total_yd || 0).toFixed(0)} yd</strong>
              {#if p.reorder_threshold_yd}<div class="muted small">reorder &lt; {p.reorder_threshold_yd}</div>{/if}
            </td>
            <td class="actions">
              <button class="btn btn-ghost" on:click={() => editingProduct = { ...p }}>✎ Edit</button>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </section>
</div>

<!-- ─── Measure modal ──────────────────────────────────────────── -->
{#if measuringRoll}
  <div class="modal-backdrop" on:click={() => measuringRoll = null}>
    <div class="modal" on:click|stopPropagation>
      <h2>Measure roll</h2>
      <p class="muted small">{measuringRoll.label}</p>
      {#if measuringRoll.product_uncalibrated}
        <div class="warn">
          ⚠ This product hasn't been calibrated yet — set the
          <strong>Calibration OD</strong> on the product (measure a new
          full roll) before this measurement can compute remaining yardage.
        </div>
      {/if}
      {#if measuringRoll.last_measured_dia_in}
        <p class="muted small">
          Last reading: {Number(measuringRoll.last_measured_dia_in).toFixed(2)}"
          → {formatYd(measuringRoll.last_remaining_yd)}
        </p>
      {/if}
      <label>
        New outer diameter (inches)
        <input type="number" step="0.001" min={measuringRoll.core_diameter_in} bind:value={measuringRoll.measured_dia_in} autofocus />
      </label>
      <label>
        Notes (optional)
        <input bind:value={measuringRoll.notes} placeholder="e.g. measured at mid-roll" />
      </label>
      <div class="modal-actions">
        <span style="flex:1"></span>
        <button class="btn btn-ghost"   on:click={() => measuringRoll = null}>Cancel</button>
        <button class="btn btn-primary" on:click={submitMeasure}>Save measurement</button>
      </div>
    </div>
  </div>
{/if}

<!-- ─── Edit product modal ────────────────────────────────────── -->
{#if editingProduct}
  <div class="modal-backdrop" on:click={() => editingProduct = null}>
    <div class="modal" on:click|stopPropagation>
      <h2>Edit product</h2>
      <div class="row3">
        <label>Brand<input bind:value={editingProduct.brand} /></label>
        <label>Product line<input bind:value={editingProduct.product_line} /></label>
        <label>Color<input bind:value={editingProduct.color} /></label>
      </div>
      <div class="row3">
        <label>Finish<input bind:value={editingProduct.finish} /></label>
        <label>Width (in)<input type="number" step="0.25" bind:value={editingProduct.width_in} /></label>
        <label>Core (in)<input type="number" step="0.5" bind:value={editingProduct.core_diameter_in} /></label>
      </div>
      <div class="row3">
        <label>Full length (yd)<input type="number" step="0.5" bind:value={editingProduct.full_length_yd} /></label>
        <label>Calibration OD (in)<input type="number" step="0.001" bind:value={editingProduct.calibration_outer_diameter_in} /></label>
        <label>Reorder threshold (yd)<input type="number" step="1" bind:value={editingProduct.reorder_threshold_yd} /></label>
      </div>
      <div class="row3">
        <label>SKU<input bind:value={editingProduct.sku} /></label>
        <label>Supplier<input bind:value={editingProduct.supplier} /></label>
        <label>Supplier SKU<input bind:value={editingProduct.supplier_sku} /></label>
      </div>
      <label>Notes<textarea rows="2" bind:value={editingProduct.notes}></textarea></label>
      <div class="modal-actions">
        <span style="flex:1"></span>
        <button class="btn btn-ghost"   on:click={() => editingProduct = null}>Cancel</button>
        <button class="btn btn-primary" on:click={saveEditProduct}>Save</button>
      </div>
    </div>
  </div>
{/if}

<!-- ─── Edit roll modal ───────────────────────────────────────── -->
{#if editingRoll}
  <div class="modal-backdrop" on:click={() => editingRoll = null}>
    <div class="modal" on:click|stopPropagation>
      <h2>Edit roll</h2>
      <label>Label<input bind:value={editingRoll.roll_label} /></label>
      <label>Location<input bind:value={editingRoll.location} /></label>
      <label>Status
        <select bind:value={editingRoll.status}>
          <option value="active">Active</option>
          <option value="depleted">Depleted</option>
          <option value="damaged">Damaged</option>
          <option value="retired">Retired</option>
        </select>
      </label>
      <label>Notes<textarea rows="2" bind:value={editingRoll.notes}></textarea></label>
      <div class="modal-actions">
        <span style="flex:1"></span>
        <button class="btn btn-ghost"   on:click={() => editingRoll = null}>Cancel</button>
        <button class="btn btn-primary" on:click={saveEditRoll}>Save</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .inv-page { padding: 16px; max-width: 1400px; margin: 0 auto; }
  header h1 { margin: 0; }
  .muted { color: #64748b; }
  .small { font-size: 0.85rem; }
  .error { background: #fef2f2; color: #991b1b; padding: 8px 12px; border-radius: 4px; margin-bottom: 8px; border: 1px solid #fecaca; }
  .warn  { background: #fffbeb; color: #92400e; padding: 8px 12px; border-radius: 4px; margin-bottom: 8px; border: 1px solid #fde68a; font-size: 0.9rem; }
  .card { background: #fff; border: 1px solid #e2e8f0; border-radius: 6px; padding: 16px; margin-bottom: 12px; }
  .card-title { margin: 0 0 12px; font-size: 1.1rem; }

  .filters { display: flex; gap: 8px; margin-bottom: 10px; flex-wrap: wrap; }
  .filters input, .filters select {
    padding: 7px 10px; border: 1px solid #cbd5e1; border-radius: 4px; font-size: 0.92rem;
  }
  .filters input { flex: 1; min-width: 220px; }

  .row-form {
    display: grid;
    grid-template-columns: 2fr 1fr 1fr 1fr auto auto;
    gap: 6px;
    margin-bottom: 10px;
  }
  .row-form input, .row-form select {
    padding: 7px 10px; border: 1px solid #cbd5e1; border-radius: 4px; font-size: 0.9rem;
  }

  .product-form { display: flex; flex-direction: column; gap: 8px; margin-bottom: 12px;
                  padding: 12px; background: #f8fafc; border-radius: 6px; }
  .row3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
  .row3 label { display: flex; flex-direction: column; gap: 3px; font-size: 0.82rem; color: #475569; }
  .product-form input, .product-form select, .product-form textarea {
    padding: 7px 9px; border: 1px solid #cbd5e1; border-radius: 4px; font-size: 0.92rem;
  }

  .roll-table { width: 100%; border-collapse: collapse; font-size: 0.88rem; }
  .roll-table th, .roll-table td { padding: 8px 10px; border-bottom: 1px solid #e2e8f0; text-align: left; vertical-align: top; }
  .roll-table th { background: #f8fafc; font-weight: 600; color: #475569; }
  .roll-table .actions { display: flex; gap: 4px; }
  .summary-low { background: #fef9c3; }

  .remaining-low     { color: #b91c1c; font-weight: 600; }
  .remaining-unknown { color: #64748b; font-style: italic; }

  .status-pill { display: inline-block; padding: 2px 8px; border-radius: 99px; font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.02em; font-weight: 600; }
  .status-pill.st-active   { background: #dcfce7; color: #166534; }
  .status-pill.st-empty    { background: #e2e8f0; color: #475569; }
  .status-pill.st-damaged  { background: #fee2e2; color: #991b1b; }
  .status-pill.st-retired  { background: #f1f5f9; color: #64748b; }

  /* Modal styles, kept local */
  .modal-backdrop { position: fixed; inset: 0; background: rgba(15,23,42,0.5); display: flex; align-items: center; justify-content: center; z-index: 50; }
  .modal { background: #fff; border-radius: 8px; padding: 20px; width: min(620px, calc(100vw - 32px)); max-height: 90vh; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; }
  .modal h2 { margin: 0 0 8px; font-size: 1.1rem; }
  .modal label { display: flex; flex-direction: column; gap: 3px; font-size: 0.85rem; color: #475569; }
  .modal input, .modal select, .modal textarea {
    padding: 7px 10px; border: 1px solid #cbd5e1; border-radius: 4px; font-size: 0.92rem; font-family: inherit;
  }
  .modal-actions { display: flex; gap: 8px; align-items: center; margin-top: 8px; }

  .btn { padding: 6px 12px; border: 1px solid #cbd5e1; border-radius: 4px; background: #fff; cursor: pointer; font: inherit; font-size: 0.85rem; }
  .btn-primary { background: #c01818; color: #fff; border-color: #c01818; }
  .btn-ghost   { background: transparent; }
  .btn-danger-ghost { background: transparent; color: #b91c1c; border-color: #fecaca; }
</style>
