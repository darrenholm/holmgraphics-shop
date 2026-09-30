<!-- src/routes/modules/[id]/+page.svelte
     One LED module part number. This is where the QR on a module shelf
     label lands, so it's built for a phone in the back room: big count,
     big −/+ buttons, and the signs this part works in. -->
<script>
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { auth, isStaff } from '$lib/stores/auth.js';
  import { api } from '$lib/api/client.js';
  import ModuleLabelModal from '$lib/components/ModuleLabelModal.svelte';

  $: id = $page.params.id;

  let mod = null;
  let loading = true;
  let error = '';
  let busy = false;
  let showLabels = false;

  let editing = false;
  let edit = {};
  let saving = false;
  let formError = '';

  onMount(async () => {
    if (!$auth || !$isStaff) { goto(`/login?return=/modules/${id}`); return; }
    await load();
  });

  async function load() {
    loading = true; error = '';
    try { mod = await api.getModule(id); }
    catch (e) { error = e.message || String(e); }
    finally { loading = false; }
  }

  async function adjust(delta) {
    busy = true;
    try { mod = { ...mod, ...(await api.adjustModuleCount(mod.id, delta)) }; }
    catch (e) { alert(e.message || e); }
    finally { busy = false; }
  }

  function startEdit() {
    formError = '';
    edit = {
      module_id_no: mod.module_id_no || '',
      description: mod.description || '',
      shelf_location: mod.shelf_location || '',
      on_hand: mod.on_hand ?? '',
      notes: mod.notes || ''
    };
    editing = true;
  }

  async function saveEdit() {
    formError = '';
    if (!String(edit.module_id_no).trim()) { formError = 'Part number is required.'; return; }
    saving = true;
    try {
      mod = { ...mod, ...(await api.updateModule(mod.id, edit)) };
      editing = false;
    } catch (e) { formError = e.message || String(e); }
    finally { saving = false; }
  }

  const fmtDate = (iso) => iso
    ? new Date(iso).toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric' })
    : 'never';
</script>

<svelte:head><title>{mod?.module_id_no ? `Module ${mod.module_id_no}` : 'Module'} — Holm Graphics</title></svelte:head>

<div class="page">
  <a class="back" href="/modules">← All modules</a>

  {#if loading}
    <p class="muted">Loading…</p>
  {:else if error}
    <p class="err">⚠ {error}</p>
  {:else if mod}
    <div class="head">
      <div>
        <div class="kicker">LED module part #</div>
        <h1 class="part mono">{mod.module_id_no || `#${mod.id}`}</h1>
        {#if mod.description}<p class="desc">{mod.description}</p>{/if}
      </div>
      <div class="head-actions">
        <button class="btn btn-ghost" on:click={startEdit}>Edit</button>
        <button class="btn btn-primary" on:click={() => showLabels = true}>🏷 Labels</button>
      </div>
    </div>

    <div class="card count-card">
      <button class="big-step" on:click={() => adjust(-1)} disabled={busy || !mod.on_hand} aria-label="Took one off the shelf">−</button>
      <div class="count-box">
        <div class="count" class:zero={mod.on_hand === 0}>{mod.on_hand ?? '—'}</div>
        <div class="muted small">on shelf{mod.shelf_location ? ` · ${mod.shelf_location}` : ''}</div>
        <div class="muted small">last counted {fmtDate(mod.last_counted_at)}</div>
      </div>
      <button class="big-step" on:click={() => adjust(1)} disabled={busy} aria-label="Put one on the shelf">+</button>
    </div>

    {#if editing}
      <div class="card">
        <div class="form-grid">
          <label>Part number *<input class="mono" bind:value={edit.module_id_no} /></label>
          <label>On hand (physical count)<input type="number" min="0" bind:value={edit.on_hand} /></label>
          <label>Shelf location<input bind:value={edit.shelf_location} /></label>
          <label>Description<input bind:value={edit.description} /></label>
          <label class="span-2">Notes<input bind:value={edit.notes} /></label>
        </div>
        {#if formError}<p class="err">{formError}</p>{/if}
        <div class="form-actions">
          <button class="btn btn-primary" on:click={saveEdit} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
          <button class="btn btn-ghost" on:click={() => editing = false}>Cancel</button>
        </div>
      </div>
    {/if}

    <div class="card">
      <h2 class="section-title">Works in {(mod.signs || []).length} sign{(mod.signs || []).length === 1 ? '' : 's'}</h2>
      {#if !(mod.signs || []).length}
        <p class="muted small">No sign linked yet. Link signs from the <a href="/modules">LED Modules</a> page.</p>
      {:else}
        <ul class="signs">
          {#each mod.signs as sg (sg.id)}
            <li>
              <a href="/clients/{sg.client_id}"><strong>{sg.client_name || 'Client'}</strong></a>
              – {sg.sign_name || `Sign #${sg.id}`}
              <div class="muted small">{[sg.location, sg.pitch, sg.module_size].filter(Boolean).join(' · ')}</div>
            </li>
          {/each}
        </ul>
      {/if}
    </div>

    {#if mod.notes}
      <div class="card">
        <h2 class="section-title">Notes</h2>
        <p class="notes">{mod.notes}</p>
      </div>
    {/if}

    <ModuleLabelModal bind:open={showLabels} modules={[mod]} />
  {/if}
</div>

<style>
  .page { padding: 20px 16px; max-width: 640px; margin: 0 auto; }
  .back { font-family: var(--font-display); letter-spacing: 0.04em; text-transform: uppercase; font-size: 0.8rem; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; margin: 12px 0 14px; flex-wrap: wrap; }
  .head-actions { display: flex; gap: 8px; }
  .kicker { color: var(--text-muted); font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.06em; }
  .part { font-size: 2rem; margin: 2px 0; word-break: break-all; }
  .desc { margin: 0; color: var(--text-muted); }
  .mono { font-family: var(--font-mono, monospace); }
  .muted { color: var(--text-muted); }
  .small { font-size: 0.82rem; }
  .err { color: #dc2626; }

  .card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 16px 18px; margin-bottom: 14px; }
  .section-title { font-family: var(--font-display); font-size: 0.95rem; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; margin: 0 0 10px; }

  .count-card { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  .count-box { text-align: center; }
  .count { font-family: var(--font-display); font-size: 3rem; font-weight: 700; line-height: 1; }
  .count.zero { color: #dc2626; }
  .big-step {
    width: 64px; height: 64px; border-radius: 50%; border: 1px solid var(--border);
    background: var(--surface-2, var(--hover)); color: var(--text); font-size: 2rem; cursor: pointer;
  }
  .big-step:disabled { opacity: 0.35; cursor: not-allowed; }

  .signs { list-style: none; margin: 0; padding: 0; }
  .signs li { padding: 8px 0; border-bottom: 1px solid var(--border); }
  .signs li:last-child { border-bottom: 0; }
  .notes { white-space: pre-wrap; margin: 0; }

  .form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 12px; }
  .form-grid label { display: flex; flex-direction: column; gap: 4px; font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.04em; }
  .form-grid .span-2 { grid-column: span 2; }
  .form-grid input { background: var(--input-bg, var(--surface)); color: var(--text); border: 1px solid var(--border); border-radius: var(--radius); padding: 8px 10px; font: inherit; text-transform: none; letter-spacing: normal; }
  .form-actions { display: flex; gap: 8px; margin-top: 12px; }

  .btn { padding: 8px 14px; border-radius: var(--radius); border: 1px solid var(--border); background: var(--surface); color: var(--text); cursor: pointer; font: inherit; }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn-primary { background: var(--accent, #c0392b); color: white; border-color: transparent; }
  .btn-ghost { background: transparent; }

  @media (max-width: 480px) {
    .form-grid { grid-template-columns: 1fr; }
    .form-grid .span-2 { grid-column: auto; }
  }
</style>
