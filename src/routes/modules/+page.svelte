<!-- src/routes/modules/+page.svelte
     LED module shelf inventory, shop-wide.

     One row = one PART NUMBER. Signs built in the same production run share
     a part number; a sign from its own run gets its own. Each row carries
     the shelf count and the signs (any client) it works in.

     From here staff can add part numbers, count the shelf, link signs, and
     print DYMO labels (one per module on the shelf). Each label's QR opens
     /modules/<id>.

     📷 Scan sticker (phone): take a photo of the module, the server reads
     the sticker (routes/clients.js POST /modules/scan) and either finds
     the part number already in the list or pre-fills the add form. The
     reading is always shown for staff to check before anything is saved.

     The per-client Modules tab on /clients/[id] shows the same rows,
     filtered to that client's signs. -->
<script>
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { auth, isStaff } from '$lib/stores/auth.js';
  import { api } from '$lib/api/client.js';
  import ModuleLabelModal from '$lib/components/ModuleLabelModal.svelte';

  let modules = [];
  let loading = true;
  let error = '';

  let search = '';
  let filter = 'all'; // 'all' | 'uncounted' | 'unlinked' | 'empty'

  // Add form
  const blank = { module_id_no: '', description: '', shelf_location: '', on_hand: '', notes: '' };
  let adding = false;
  let draft = { ...blank };
  let saving = false;
  let formError = '';

  // Inline edit
  let editingId = null;
  let edit = { ...blank };

  // Sign linker
  let linkingId = null;
  let allSigns = [];
  let signsLoaded = false;
  let signSearch = '';

  // Labels
  let selected = new Set();
  let labelModules = [];
  let showLabels = false;

  let busyId = null;

  // Sticker scan
  let scanInput;
  let scanning = false;
  let scan = null;        // { photos, sticker_number, board_model, date_code, legible, unsure, matches }
  let addingAngle = false; // next photo is another angle of the same sticker
  const MAX_ANGLES = 3;
  let scanError = '';
  let scanNumber = '';    // editable copy of the reading

  // Phone photos are 3–12 MB; the sticker reads fine at ~1800 px.
  function shrinkPhoto(file, maxSide = 1800) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const k = Math.min(1, maxSide / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * k);
        c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not open that photo.')); };
      img.src = url;
    });
  }

  async function onScanFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';            // same photo again still fires change
    if (!file) return;
    // A second or third angle is read together with the earlier photos, so
    // a number half-hidden behind a frame rib comes back whole.
    const append = addingAngle && scan;
    addingAngle = false;
    scanning = true; scanError = '';
    if (!append) scan = null;
    try {
      const photo = await shrinkPhoto(file);
      const photos = append ? [...scan.photos, photo].slice(-MAX_ANGLES) : [photo];
      const r = await api.scanModuleSticker(photos);
      scan = { ...r, photos };
      scanNumber = r.sticker_number || '';
      // An exact hit: show just that row so the count and links are right there.
      if (r.matches?.length === 1 && !r.sticker_number.includes('?')) {
        search = r.matches[0].module_id_no;
        filter = 'all';
      }
    } catch (err) {
      scanError = err.message || String(err);
    } finally {
      scanning = false;
    }
  }

  // Found another one of a part already in the list: count it in place.
  async function bumpMatch(mm) {
    busyId = mm.id;
    try {
      const row = await api.adjustModuleCount(mm.id, 1);
      replaceRow(row);
      scan = { ...scan, matches: scan.matches.map((x) => (x.id === row.id ? { ...x, ...row } : x)) };
    } catch (e) { alert(e.message || e); }
    finally { busyId = null; }
  }

  // Same comparison the server uses: case, spaces and bracket shape don't count.
  const partKey = (v) => String(v ?? '').toUpperCase().replace(/[{[]/g, '(').replace(/[}\]]/g, ')').replace(/\s+/g, '');
  $: exactMatch = scan?.matches?.find((mm) => partKey(mm.module_id_no) === partKey(scanNumber)) || null;

  function useMatch(m) {
    search = m.module_id_no;
    filter = 'all';
    scan = null;
  }

  function addFromScan() {
    const desc = [scan.board_model, scan.date_code ? `date ${scan.date_code}` : ''].filter(Boolean).join(' · ');
    draft = { ...blank, module_id_no: scanNumber.trim(), description: desc };
    adding = true;
    formError = '';
    scan = null;
  }

  onMount(async () => {
    if (!$auth || !$isStaff) { goto('/login?return=/modules'); return; }
    await load();
  });

  async function load() {
    loading = true; error = '';
    try { modules = await api.getModuleInventory(); }
    catch (e) { error = e.message || String(e); }
    finally { loading = false; }
  }

  // Swap one updated row in place (keeps its signs if the API didn't send them).
  function replaceRow(row) {
    modules = modules.map((m) => (m.id === row.id ? { ...m, ...row, signs: row.signs ?? m.signs } : m));
  }

  const norm = (s) => String(s ?? '').toLowerCase();
  function matches(m, q) {
    if (!q) return true;
    const hay = [
      m.module_id_no, m.description, m.shelf_location, m.notes,
      ...(m.signs || []).flatMap((s) => [s.sign_name, s.client_name, s.location])
    ].map(norm).join(' ');
    return q.split(/\s+/).every((w) => hay.includes(w));
  }

  $: q = norm(search).trim();
  $: shown = modules.filter((m) => {
    if (filter === 'uncounted' && m.on_hand != null) return false;
    if (filter === 'unlinked'  && (m.signs || []).length) return false;
    if (filter === 'empty'     && !(m.on_hand === 0)) return false;
    return matches(m, q);
  });
  $: totalOnShelf = modules.reduce((n, m) => n + (m.on_hand || 0), 0);
  $: uncounted = modules.filter((m) => m.on_hand == null).length;
  $: unlinked = modules.filter((m) => !(m.signs || []).length).length;
  $: allShownSelected = shown.length > 0 && shown.every((m) => selected.has(m.id));

  function toggle(id) {
    selected.has(id) ? selected.delete(id) : selected.add(id);
    selected = selected;
  }
  function toggleAllShown() {
    if (allShownSelected) shown.forEach((m) => selected.delete(m.id));
    else shown.forEach((m) => selected.add(m.id));
    selected = selected;
  }

  function openLabels(list) {
    labelModules = list;
    showLabels = true;
  }

  async function submitNew() {
    formError = '';
    if (!draft.module_id_no.trim()) { formError = 'Part number is required.'; return; }
    saving = true;
    try {
      const row = await api.createModule(draft);
      modules = [...modules, { ...row, signs: [] }]
        .sort((a, b) => norm(a.module_id_no).localeCompare(norm(b.module_id_no), undefined, { numeric: true }));
      draft = { ...blank };
      adding = false;
      // Straight on to "which signs does it fit": show the new row with
      // the sign picker open.
      search = row.module_id_no;
      filter = 'all';
      await openLinker(row);
    } catch (e) { formError = e.message || String(e); }
    finally { saving = false; }
  }

  function startEdit(m) {
    editingId = m.id;
    linkingId = null;
    formError = '';
    edit = {
      module_id_no: m.module_id_no || '',
      description: m.description || '',
      shelf_location: m.shelf_location || '',
      on_hand: m.on_hand ?? '',
      notes: m.notes || ''
    };
  }

  async function saveEdit() {
    formError = '';
    if (!String(edit.module_id_no).trim()) { formError = 'Part number is required.'; return; }
    saving = true;
    try {
      replaceRow(await api.updateModule(editingId, edit));
      editingId = null;
    } catch (e) { formError = e.message || String(e); }
    finally { saving = false; }
  }

  async function adjust(m, delta) {
    busyId = m.id;
    try { replaceRow(await api.adjustModuleCount(m.id, delta)); }
    catch (e) { alert(e.message || e); }
    finally { busyId = null; }
  }

  async function remove(m) {
    const count = m.on_hand ? ` It still shows ${m.on_hand} on the shelf.` : '';
    const signs = (m.signs || []).length ? ` ${m.signs.length} sign(s) will be unlinked.` : '';
    if (!confirm(`Delete part number ${m.module_id_no}?${count}${signs}`)) return;
    try {
      await api.deleteModule(m.id);
      modules = modules.filter((x) => x.id !== m.id);
      selected.delete(m.id); selected = selected;
    } catch (e) { alert(e.message || e); }
  }

  async function openLinker(m) {
    editingId = null;
    linkingId = linkingId === m.id ? null : m.id;
    signSearch = '';
    if (linkingId && !signsLoaded) {
      try { allSigns = await api.getAllLedSigns(); signsLoaded = true; }
      catch (e) { alert(e.message || e); }
    }
  }

  $: sq = norm(signSearch).trim();
  $: signChoices = allSigns
    .filter((s) => !sq || sq.split(/\s+/).every((w) =>
      [s.client_name, s.sign_name, s.location, s.pitch, s.module_size].map(norm).join(' ').includes(w)))
    .slice(0, 50);
  $: moduleNo = Object.fromEntries(modules.map((m) => [m.id, m.module_id_no]));

  // Re-pull the rows a link change touched (the sign may have moved from
  // another part number), plus the sign list so the picker stays right.
  async function relink(signId, moduleId) {
    try {
      await api.setSignModule(signId, moduleId);
      const [inv, signs] = await Promise.all([api.getModuleInventory(), api.getAllLedSigns()]);
      modules = inv;
      allSigns = signs;
    } catch (e) { alert(e.message || e); }
  }

  const countedOn = (iso) => iso
    ? new Date(iso).toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric' })
    : '';
</script>

<svelte:head><title>LED Modules — Holm Graphics</title></svelte:head>

<div class="page">
  <div class="page-head">
    <h1 class="page-title">LED Modules</h1>
    <div class="head-actions">
      <button class="btn btn-ghost" on:click={load} disabled={loading} title="Refresh">{loading ? '…' : '⟳'}</button>
      {#if !adding}<button class="btn btn-primary" on:click={() => { adding = true; formError = ''; }}>+ Add part number</button>{/if}
    </div>
  </div>

  <input bind:this={scanInput} type="file" accept="image/*" capture="environment" class="hidden-file" on:change={onScanFile} />
  <button class="btn btn-primary scan-btn" on:click={() => scanInput.click()} disabled={scanning}>
    {scanning ? 'Reading sticker…' : '📷 Scan sticker'}
  </button>

  {#if scanError}
    <div class="card scan-card"><p class="err no-top">⚠ {scanError}</p>
      <button class="btn btn-ghost" on:click={() => scanError = ''}>Close</button></div>
  {/if}

  {#if scan}
    <div class="card scan-card">
      <div class="scan-top">
        <div class="scan-photos">
          {#each scan.photos as ph, i}<img class="scan-photo" class:small={scan.photos.length > 1} src={ph} alt="Photo {i + 1}" />{/each}
        </div>
        <div class="scan-read">
          {#if !scan.legible && !scan.sticker_number}
            <p class="err no-top">Couldn't read a sticker number in that photo. Try again straight on, with the light from the side.</p>
          {:else}
            <label class="scan-label">Sticker number (check it)
              <input class="mono" bind:value={scanNumber} />
            </label>
          {/if}
          {#if scan.board_model}<div class="small"><span class="muted">Board:</span> <span class="mono">{scan.board_model}</span>{scan.date_code ? ` · ${scan.date_code}` : ''}</div>{/if}
          {#if scan.unsure}<div class="warn">⚠ {scan.unsure}</div>{/if}
          {#if scanNumber.includes('?')}<div class="warn">Replace each “?” with the right character before adding{scan.photos.length < MAX_ANGLES ? ', or tap “Add another angle” if part of the sticker is hidden' : ''}.</div>{/if}
        </div>
      </div>

      {#if scan.matches?.length}
        <h3 class="sub-title">Already in the list</h3>
        <ul class="sign-picker">
          {#each scan.matches as mm (mm.id)}
            <li>
              <span><strong class="mono">{mm.module_id_no}</strong></span>
              <span class="muted small">{mm.on_hand ?? '—'} on shelf{mm.shelf_location ? ` · ${mm.shelf_location}` : ''}</span>
              <span class="match-acts">
                <button class="btn btn-primary btn-sm" on:click={() => bumpMatch(mm)} disabled={busyId === mm.id}>+1 on shelf</button>
                <button class="btn-link" on:click={() => useMatch(mm)}>Open</button>
              </span>
            </li>
          {/each}
        </ul>
      {/if}

      <div class="form-actions">
        {#if (scan.sticker_number || scanNumber) && !exactMatch}
          <button class="btn btn-primary" on:click={addFromScan} disabled={!scanNumber.trim() || scanNumber.includes('?')}>
            {scan.matches?.length ? 'Add as a new part number' : 'Add this part number'}
          </button>
        {/if}
        {#if scan.photos.length < MAX_ANGLES}
          <button class="btn btn-ghost" on:click={() => { addingAngle = true; scanInput.click(); }} disabled={scanning}
            title="Part of the sticker hidden? Take it from another angle">
            📷 Add another angle
          </button>
        {/if}
        <button class="btn btn-ghost" on:click={() => { addingAngle = false; scanInput.click(); }} disabled={scanning}>Scan again</button>
        <button class="btn btn-ghost" on:click={() => scan = null}>Close</button>
      </div>
    </div>
  {/if}

  <div class="stats">
    <div class="stat"><span class="stat-n">{modules.length}</span><span class="stat-l">part numbers</span></div>
    <div class="stat"><span class="stat-n">{totalOnShelf}</span><span class="stat-l">modules on shelf</span></div>
    <button class="stat stat-btn" class:on={filter === 'uncounted'} on:click={() => filter = filter === 'uncounted' ? 'all' : 'uncounted'}>
      <span class="stat-n">{uncounted}</span><span class="stat-l">not counted</span>
    </button>
    <button class="stat stat-btn" class:on={filter === 'unlinked'} on:click={() => filter = filter === 'unlinked' ? 'all' : 'unlinked'}>
      <span class="stat-n">{unlinked}</span><span class="stat-l">no sign linked</span>
    </button>
  </div>

  {#if adding}
    <div class="card">
      <h2 class="section-title">New part number</h2>
      <p class="muted small no-top">
        Signs made in the same run share one part number. Add it once, set the shelf count, then link every sign it works in.
      </p>
      <div class="form-grid">
        <label>Part number *<input class="mono" bind:value={draft.module_id_no} placeholder="e.g. 7777" /></label>
        <label>On hand<input type="number" min="0" bind:value={draft.on_hand} placeholder="count on shelf" /></label>
        <label>Shelf location<input bind:value={draft.shelf_location} placeholder="e.g. Rack B / Shelf 3" /></label>
        <label>Description<input bind:value={draft.description} placeholder="e.g. P10 outdoor 320x160" /></label>
        <label class="span-2">Notes<input bind:value={draft.notes} placeholder="supplier, batch date, condition…" /></label>
      </div>
      {#if formError && !editingId}<p class="err">{formError}</p>{/if}
      <div class="form-actions">
        <button class="btn btn-primary" on:click={submitNew} disabled={saving}>{saving ? 'Saving…' : 'Add'}</button>
        <button class="btn btn-ghost" on:click={() => { adding = false; draft = { ...blank }; formError = ''; }}>Cancel</button>
      </div>
    </div>
  {/if}

  <div class="toolbar">
    <input class="search" type="search" bind:value={search} placeholder="Search part #, shelf, client, sign…" />
    <select bind:value={filter}>
      <option value="all">All</option>
      <option value="uncounted">Not counted</option>
      <option value="unlinked">No sign linked</option>
      <option value="empty">None on shelf</option>
    </select>
    <button class="btn btn-primary" disabled={selected.size === 0}
      on:click={() => openLabels(modules.filter((m) => selected.has(m.id)))}>
      🏷 Print labels{selected.size ? ` (${selected.size})` : ''}
    </button>
  </div>

  {#if loading && !modules.length}
    <p class="card placeholder">Loading…</p>
  {:else if error}
    <p class="card placeholder err">⚠ {error}</p>
  {:else if !shown.length}
    <p class="card placeholder">{modules.length ? 'Nothing matches.' : 'No modules yet. Add the first part number above.'}</p>
  {:else}
    <div class="table-wrap">
      <table class="items-table">
        <thead>
          <tr>
            <th class="w-check"><input type="checkbox" checked={allShownSelected} on:change={toggleAllShown} aria-label="Select all" /></th>
            <th>Part #</th>
            <th>Shelf</th>
            <th class="num">On hand</th>
            <th>Works in</th>
            <th class="w-actions"></th>
          </tr>
        </thead>
        <tbody>
          {#each shown as m (m.id)}
            <tr class="mod-row" class:open={editingId === m.id || linkingId === m.id}>
              <td class="w-check"><input type="checkbox" checked={selected.has(m.id)} on:change={() => toggle(m.id)} aria-label="Select" /></td>
              <td class="c-part">
                <a class="mono part" href="/modules/{m.id}">{m.module_id_no || `#${m.id}`}</a>
                {#if m.description}<div class="muted small">{m.description}</div>{/if}
              </td>
              <td class="c-shelf"><span class="ph-only muted">Shelf: </span>{m.shelf_location || '—'}</td>
              <td class="num c-count">
                <div class="counter">
                  <button class="step" on:click={() => adjust(m, -1)} disabled={busyId === m.id || !m.on_hand} title="Took one off the shelf">−</button>
                  <span class="count" class:zero={m.on_hand === 0} class:unknown={m.on_hand == null}
                    title={m.last_counted_at ? `Counted ${countedOn(m.last_counted_at)}` : 'Never counted'}>
                    {m.on_hand ?? '—'}
                  </span>
                  <button class="step" on:click={() => adjust(m, 1)} disabled={busyId === m.id} title="Put one on the shelf">+</button>
                </div>
              </td>
              <td class="c-works">
                {#if !(m.signs || []).length}
                  <span class="muted"><span class="ph-only">No sign linked</span><span class="wide-only">—</span></span>
                {:else}
                  <div class="chips">
                    {#each m.signs as sg}
                      <span class="chip">
                        <a href="/clients/{sg.client_id}">{sg.client_name || 'Client'}</a> – {sg.sign_name || `Sign #${sg.id}`}
                        <button class="chip-x" title="Unlink" on:click={() => relink(sg.id, null)}>✕</button>
                      </span>
                    {/each}
                  </div>
                {/if}
              </td>
              <td class="w-actions">
                <button class="btn-link" on:click={() => startEdit(m)}>Edit</button>
                <button class="btn-link" on:click={() => openLinker(m)}>{linkingId === m.id ? 'Close' : 'Link sign'}</button>
                <button class="btn-link" on:click={() => openLabels([m])}>Label</button>
                <button class="btn-link danger" on:click={() => remove(m)}>Delete</button>
              </td>
            </tr>

            {#if editingId === m.id}
              <tr class="sub"><td colspan="6">
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
                  <button class="btn btn-ghost" on:click={() => { editingId = null; formError = ''; }}>Cancel</button>
                </div>
              </td></tr>
            {/if}

            {#if linkingId === m.id}
              <tr class="sub"><td colspan="6">
                <h4 class="sub-title">Link a sign that uses part {m.module_id_no}</h4>
                <input class="search" type="search" bind:value={signSearch} placeholder="Search client, sign, pitch…" />
                {#if !signsLoaded}
                  <p class="muted small">Loading signs…</p>
                {:else if !signChoices.length}
                  <p class="muted small">No signs match. Signs are added on the client's LED Signs tab.</p>
                {:else}
                  <ul class="sign-picker">
                    {#each signChoices as sg (sg.id)}
                      <li>
                        <span><strong>{sg.client_name || 'No client'}</strong> – {sg.sign_name || `Sign #${sg.id}`}</span>
                        <span class="muted small">{[sg.location, sg.pitch, sg.module_size].filter(Boolean).join(' · ')}</span>
                        {#if sg.module_id === m.id}
                          <span class="chip chip-on">Linked</span>
                        {:else if sg.module_id}
                          <button class="btn-link" on:click={() => relink(sg.id, m.id)}>Move from {moduleNo[sg.module_id] || `#${sg.module_id}`}</button>
                        {:else}
                          <button class="btn-link" on:click={() => relink(sg.id, m.id)}>Link</button>
                        {/if}
                      </li>
                    {/each}
                  </ul>
                {/if}
              </td></tr>
            {/if}
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>

<ModuleLabelModal bind:open={showLabels} modules={labelModules} />

<style>
  .page { padding: 24px; max-width: 1200px; margin: 0 auto; }
  .page-head {
    display: flex; align-items: baseline; justify-content: space-between; gap: 12px;
    border-bottom: 2px solid var(--text); padding-bottom: 10px; margin-bottom: 16px;
  }
  .page-title { font-family: var(--font-display); font-size: 1.6rem; letter-spacing: 0.04em; text-transform: uppercase; margin: 0; }
  .head-actions { display: flex; gap: 8px; }

  .hidden-file { display: none; }
  .match-acts { display: inline-flex; gap: 6px; align-items: center; }
  .btn-sm { padding: 6px 10px; font-size: 0.85rem; }
  .scan-btn { width: 100%; padding: 14px; font-size: 1.05rem; margin-bottom: 14px; }
  .scan-card { border-color: var(--red, #c0392b); overflow-wrap: anywhere; }
  .scan-card .form-actions { flex-wrap: wrap; }
  .scan-label input { width: 100%; box-sizing: border-box; min-width: 0; }
  .scan-top { display: flex; gap: 14px; align-items: flex-start; margin-bottom: 10px; }
  .scan-photos { display: flex; flex-direction: column; gap: 6px; flex: 0 0 auto; }
  .scan-photo.small { width: 80px; height: 80px; }
  .scan-photo { width: 120px; height: 120px; object-fit: cover; border-radius: var(--radius); border: 1px solid var(--border); flex: 0 0 auto; }
  .scan-read { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 6px; }
  .scan-label { display: flex; flex-direction: column; gap: 4px; font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.04em; }
  .scan-label input { background: var(--input-bg, var(--surface)); color: var(--text); border: 1px solid var(--border); border-radius: var(--radius); padding: 8px 10px; font-size: 0.95rem; text-transform: none; letter-spacing: normal; }
  .warn { background: rgba(234, 179, 8, 0.15); border: 1px solid rgba(234, 179, 8, 0.5); border-radius: var(--radius); padding: 6px 8px; font-size: 0.85rem; }
  .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 14px; }
  .stat {
    background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg);
    padding: 10px 14px; display: flex; flex-direction: column; text-align: left; font: inherit; color: var(--text);
  }
  .stat-btn { cursor: pointer; }
  .stat-btn:hover { background: var(--hover); }
  .stat-btn.on { border-color: var(--red); }
  .stat-n { font-family: var(--font-display); font-size: 1.5rem; font-weight: 700; }
  .stat-l { color: var(--text-muted); font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.04em; }

  .card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 16px 18px; margin-bottom: 14px; }
  .card.placeholder { text-align: center; color: var(--text-muted); padding: 32px 16px; }
  .section-title {
    font-family: var(--font-display); font-size: 0.95rem; font-weight: 700;
    letter-spacing: 0.06em; text-transform: uppercase; margin: 0 0 8px;
  }
  .muted { color: var(--text-muted); }
  .small { font-size: 0.82rem; }
  .no-top { margin-top: 0; }
  .err { color: #dc2626; font-size: 0.88rem; }
  .mono { font-family: var(--font-mono, monospace); }

  .form-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px 12px; }
  .form-grid label { display: flex; flex-direction: column; gap: 4px; font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.04em; }
  .form-grid .span-2 { grid-column: span 2; }
  .form-grid input, .toolbar select, .search {
    background: var(--input-bg, var(--surface)); color: var(--text);
    border: 1px solid var(--border); border-radius: var(--radius); padding: 8px 10px;
    font: inherit; text-transform: none; letter-spacing: normal;
  }
  .form-actions { display: flex; gap: 8px; margin-top: 12px; }

  .toolbar { display: flex; gap: 8px; margin-bottom: 12px; flex-wrap: wrap; }
  .toolbar .search { flex: 1 1 260px; width: auto; min-width: 0; }
  .toolbar select, .toolbar .btn { width: auto; flex: 0 0 auto; }
  .search { width: 100%; box-sizing: border-box; }

  .table-wrap { overflow-x: auto; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg); }
  .items-table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
  .items-table th {
    text-align: left; font-family: var(--font-display); font-size: 0.72rem; letter-spacing: 0.06em;
    text-transform: uppercase; color: var(--text-muted); padding: 10px; border-bottom: 1px solid var(--border);
  }
  .items-table td { padding: 8px 10px; border-bottom: 1px solid var(--border); vertical-align: top; }
  .items-table tr.open td { background: var(--hover); }
  .items-table tr.sub td { background: var(--surface-2, var(--hover)); padding: 12px 14px 16px; }
  .num { text-align: center; }
  .w-check { width: 32px; }
  .w-actions { white-space: nowrap; text-align: right; }
  .part { font-weight: 700; color: var(--text); }

  .counter { display: inline-flex; align-items: center; gap: 6px; }
  .step {
    width: 26px; height: 26px; border-radius: 50%; border: 1px solid var(--border);
    background: var(--surface); color: var(--text); cursor: pointer; font-size: 1rem; line-height: 1;
  }
  .step:disabled { opacity: 0.35; cursor: not-allowed; }
  .count { min-width: 2.2em; font-weight: 700; font-size: 1rem; }
  .count.zero { color: #dc2626; }
  .count.unknown { color: var(--text-muted); font-weight: 400; }

  .chips { display: flex; flex-wrap: wrap; gap: 4px; }
  .chip { display: inline-flex; align-items: center; gap: 4px; background: var(--hover); border-radius: 999px; padding: 2px 8px; font-size: 0.82rem; }
  .chip a { color: inherit; font-weight: 600; }
  .chip-on { background: rgba(40, 167, 69, 0.15); color: var(--green, #28a745); }
  .chip-x { background: none; border: none; cursor: pointer; color: var(--text-muted); padding: 0 2px; font-size: 0.75rem; }
  .chip-x:hover { color: #dc2626; }

  .sub-title { margin: 0 0 8px; font-size: 0.9rem; }
  .sign-picker { list-style: none; margin: 8px 0 0; padding: 0; max-height: 280px; overflow: auto; }
  .sign-picker li { display: grid; grid-template-columns: 1fr auto auto; gap: 10px; align-items: center; padding: 6px 0; border-bottom: 1px solid var(--border); }

  .btn { padding: 8px 14px; border-radius: var(--radius); border: 1px solid var(--border); background: var(--surface); color: var(--text); cursor: pointer; font: inherit; }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn-primary { background: var(--accent, #c0392b); color: white; border-color: transparent; }
  .btn-ghost { background: transparent; }
  .btn-link { background: none; border: none; color: var(--red, #c0392b); cursor: pointer; font: inherit; font-size: 0.85rem; padding: 2px 4px; }
  .btn-link:hover { text-decoration: underline; }
  .btn-link.danger { color: #dc2626; }

  .ph-only { display: none; }

  /* Phone: each part number becomes a card so the stocktake can be done
     one-handed in the storage room. */
  @media (max-width: 720px) {
    .ph-only { display: inline; }
    .wide-only { display: none; }
    .table-wrap { overflow: visible; }
    .items-table thead { display: none; }
    .items-table, .items-table tbody, .items-table tr.sub, .items-table tr.sub td { display: block; }
    .items-table tr.mod-row {
      display: grid;
      grid-template-columns: 28px 1fr auto;
      grid-template-areas:
        "chk part  count"
        ".   shelf count"
        ".   works works"
        ".   acts  acts";
      gap: 4px 10px; padding: 12px 12px 8px;
      border-bottom: 1px solid var(--border);
    }
    .items-table tr.mod-row td { display: block; padding: 0; border: 0; background: none; }
    .items-table tr.mod-row.open { background: var(--hover); }
    .items-table td.w-check { grid-area: chk; }
    .items-table td.c-part { grid-area: part; }
    .items-table td.c-shelf { grid-area: shelf; font-size: 0.85rem; }
    .items-table td.c-count { grid-area: count; align-self: center; }
    .items-table td.c-works { grid-area: works; }
    .items-table td.w-actions { grid-area: acts; text-align: left; white-space: normal; }
    .step { width: 40px; height: 40px; font-size: 1.3rem; }
    .count { font-size: 1.2rem; }
    .btn-link { padding: 6px 8px 6px 0; margin-right: 6px; font-size: 0.9rem; }
    .page { padding: 16px; }
    .stats { grid-template-columns: repeat(2, 1fr); }
    .form-grid .span-2 { grid-column: auto; }
    .sign-picker li { grid-template-columns: 1fr auto; }
    .sign-picker li .muted { grid-column: 1; }
  }
</style>
