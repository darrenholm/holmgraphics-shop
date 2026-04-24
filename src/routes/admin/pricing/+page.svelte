<!-- src/routes/admin/pricing/+page.svelte
     Staff-only DTF pricing editor. CRUD over print_locations and the
     custom-tier table. Uses the existing staff JWT (hg_token). -->
<script>
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { auth, isStaff } from '$lib/stores/auth.js';
  import { API_BASE } from '$lib/api/client.js';

  let locations = [];
  let customTiers = [];
  let editingLoc = null;        // location object being edited (or null)
  let editingTiers = [];        // tier list for editingLoc
  let loading = true;
  let saving = false;
  let error = '';
  let success = '';

  function token() {
    return typeof localStorage !== 'undefined' ? localStorage.getItem('hg_token') : null;
  }

  async function api(path, opts = {}) {
    const res = await fetch(`${API_BASE}${path}`, {
      ...opts,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token()}`,
        ...(opts.headers || {}),
      },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || data.message || `API ${res.status}`);
    return data;
  }

  onMount(async () => {
    if (!$auth || !$isStaff) { goto('/login?return=/admin/pricing'); return; }
    await load();
  });

  async function load() {
    loading = true; error = '';
    try {
      const [locs, ct] = await Promise.all([
        api('/admin/dtf/print-locations'),
        api('/admin/dtf/custom-tiers'),
      ]);
      locations = locs.print_locations;
      customTiers = ct.tiers;
    } catch (e) { error = e.message; } finally { loading = false; }
  }

  async function startEdit(loc) {
    editingLoc = { ...loc };
    try {
      const res = await api(`/admin/dtf/print-location-prices/${loc.id}`);
      editingTiers = res.tiers.map((t) => ({ ...t, price_per_piece: Number(t.price_per_piece) }));
    } catch (e) { error = e.message; }
  }

  async function saveLocation() {
    saving = true; error = ''; success = '';
    try {
      await api(`/admin/dtf/print-locations/${editingLoc.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          garment_category: editingLoc.garment_category,
          name: editingLoc.name,
          max_width_in: Number(editingLoc.max_width_in),
          max_height_in: Number(editingLoc.max_height_in),
          display_order: Number(editingLoc.display_order),
          active: editingLoc.active,
        }),
      });
      await api(`/admin/dtf/print-location-prices/${editingLoc.id}`, {
        method: 'PUT',
        body: JSON.stringify({ tiers: editingTiers }),
      });
      success = `Saved "${editingLoc.name}".`;
      editingLoc = null;
      await load();
    } catch (e) { error = e.message; } finally { saving = false; }
  }

  async function saveCustomTiers() {
    saving = true; error = ''; success = '';
    try {
      await api('/admin/dtf/custom-tiers', {
        method: 'PUT',
        body: JSON.stringify({ tiers: customTiers.map((t) => ({
          min_quantity: Number(t.min_quantity),
          max_quantity: t.max_quantity == null || t.max_quantity === '' ? null : Number(t.max_quantity),
          price_per_sqin: Number(t.price_per_sqin),
          min_per_piece: Number(t.min_per_piece || 0),
          setup_fee_per_design: Number(t.setup_fee_per_design || 0),
        })) }),
      });
      success = 'Custom tiers saved.';
      await load();
    } catch (e) { error = e.message; } finally { saving = false; }
  }

  function addTier() {
    editingTiers = [...editingTiers, { min_quantity: 1, max_quantity: null, price_per_piece: 0 }];
  }
  function removeTier(idx) {
    editingTiers = editingTiers.filter((_, i) => i !== idx);
  }
  function addCustomTier() {
    customTiers = [...customTiers, { min_quantity: 1, max_quantity: null, price_per_sqin: 0, min_per_piece: 0, setup_fee_per_design: 0 }];
  }
  function removeCustomTier(idx) {
    customTiers = customTiers.filter((_, i) => i !== idx);
  }
</script>

<svelte:head><title>Pricing — Holm Graphics Admin</title></svelte:head>

<div class="page">
  <h1>DTF Pricing</h1>

  {#if error}<p class="alert error">{error}</p>{/if}
  {#if success}<p class="alert success">{success}</p>{/if}

  {#if loading}
    <p>Loading…</p>
  {:else}
    <section>
      <h2>Print locations &amp; per-piece pricing</h2>
      <table>
        <thead>
          <tr><th>Category</th><th>Name</th><th>Max size</th><th>Status</th><th></th></tr>
        </thead>
        <tbody>
          {#each locations as loc}
            <tr>
              <td>{loc.garment_category}</td>
              <td>{loc.name}</td>
              <td>{loc.max_width_in}″ × {loc.max_height_in}″</td>
              <td>{loc.active ? 'Active' : 'Inactive'}</td>
              <td><button class="link-btn" on:click={() => startEdit(loc)}>Edit</button></td>
            </tr>
          {/each}
        </tbody>
      </table>
    </section>

    {#if editingLoc}
      <section class="edit">
        <h2>Edit: {editingLoc.name}</h2>
        <div class="form-grid">
          <label>Category
            <select bind:value={editingLoc.garment_category}>
              <option value="apparel">apparel</option>
              <option value="headwear">headwear</option>
              <option value="aprons">aprons</option>
              <option value="bags">bags</option>
            </select>
          </label>
          <label>Name <input bind:value={editingLoc.name} /></label>
          <label>Max width (in) <input type="number" step="0.25" bind:value={editingLoc.max_width_in} /></label>
          <label>Max height (in) <input type="number" step="0.25" bind:value={editingLoc.max_height_in} /></label>
          <label>Display order <input type="number" bind:value={editingLoc.display_order} /></label>
          <label class="check"><input type="checkbox" bind:checked={editingLoc.active} /> Active</label>
        </div>

        <h3>Quantity tiers</h3>
        <table class="tiers">
          <thead><tr><th>Min qty</th><th>Max qty</th><th>$ per piece</th><th></th></tr></thead>
          <tbody>
            {#each editingTiers as t, i}
              <tr>
                <td><input type="number" bind:value={t.min_quantity} /></td>
                <td><input type="number" bind:value={t.max_quantity} placeholder="(unlimited)" /></td>
                <td><input type="number" step="0.01" bind:value={t.price_per_piece} /></td>
                <td><button class="link-btn danger" on:click={() => removeTier(i)}>×</button></td>
              </tr>
            {/each}
          </tbody>
        </table>
        <button class="link-btn" on:click={addTier}>+ Add tier</button>

        <div class="actions">
          <button class="btn primary" on:click={saveLocation} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button class="btn ghost" on:click={() => editingLoc = null}>Cancel</button>
        </div>
      </section>
    {/if}

    <section>
      <h2>Custom (per-sq-in) tiers</h2>
      <table class="tiers">
        <thead><tr><th>Min qty</th><th>Max qty</th><th>$/sq in</th><th>Min $ per piece</th><th>Setup $</th><th></th></tr></thead>
        <tbody>
          {#each customTiers as t, i}
            <tr>
              <td><input type="number" bind:value={t.min_quantity} /></td>
              <td><input type="number" bind:value={t.max_quantity} placeholder="(unlimited)" /></td>
              <td><input type="number" step="0.001" bind:value={t.price_per_sqin} /></td>
              <td><input type="number" step="0.01" bind:value={t.min_per_piece} /></td>
              <td><input type="number" step="0.01" bind:value={t.setup_fee_per_design} /></td>
              <td><button class="link-btn danger" on:click={() => removeCustomTier(i)}>×</button></td>
            </tr>
          {/each}
        </tbody>
      </table>
      <button class="link-btn" on:click={addCustomTier}>+ Add tier</button>
      <div class="actions">
        <button class="btn primary" on:click={saveCustomTiers} disabled={saving}>
          {saving ? 'Saving…' : 'Save custom tiers'}
        </button>
      </div>
    </section>
  {/if}
</div>

<style>
  .page { max-width: 80rem; margin: 0 auto; padding: 2rem 1rem; }
  h1 { margin: 0 0 1.5rem; }
  h2 { margin: 0 0 0.75rem; font-size: 1.1rem; }
  h3 { margin: 1.5rem 0 0.5rem; font-size: 1rem; }
  section { background: white; border: 1px solid #e4e4e7; border-radius: 0.5rem; padding: 1.25rem; margin-bottom: 1.5rem; }
  section.edit { background: #fffaf5; border-color: #ecc; }
  table { width: 100%; border-collapse: collapse; }
  th, td { padding: 0.5rem; border-bottom: 1px solid #eee; text-align: left; font-size: 0.95rem; }
  table.tiers input { width: 8rem; padding: 0.4rem; border: 1px solid #d4d4d8; border-radius: 0.3rem; }
  .form-grid { display: grid; grid-template-columns: 1fr 1fr 1fr 1fr; gap: 0.85rem; margin-bottom: 1rem; }
  .form-grid label { display: flex; flex-direction: column; gap: 0.3rem; font-size: 0.9rem; }
  .form-grid label.check { flex-direction: row; align-items: center; gap: 0.5rem; }
  .form-grid input, .form-grid select { padding: 0.5rem; border: 1px solid #d4d4d8; border-radius: 0.3rem; }
  .actions { display: flex; gap: 0.5rem; margin-top: 1rem; }
  .btn { padding: 0.6rem 1rem; border-radius: 0.3rem; border: 0; cursor: pointer; font-weight: 500; }
  .btn.primary { background: #c01818; color: white; }
  .btn.ghost { background: transparent; color: #555; border: 1px solid #ccc; }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .link-btn { background: none; border: 0; color: #c01818; cursor: pointer; }
  .link-btn.danger { color: #b00; }
  .alert { padding: 0.6rem 0.85rem; border-radius: 0.3rem; margin-bottom: 1rem; }
  .alert.error { background: #fee; color: #b00; }
  .alert.success { background: #e8f5e8; color: #2a6a2a; }
</style>
