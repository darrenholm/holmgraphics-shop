<!-- src/lib/components/FolderPickerModal.svelte
     Manual folder-override picker for the files-bridge.

     Invoked from the Job detail screen. Lets staff:
       · search every top-level folder on L:\ and pick one
       · see which folders are already claimed by another client (usedBy badge)
       · proceed anyway if they want to reassign (with warning)
       · create a brand-new folder on L:\ for this client
       · clear the current override (revert to auto-match)

     Saves the choice on the client row (clients.files_folder) via the API,
     not the project row. The bridge is called directly from the browser to
     list / create folders because Railway can't reach the LAN bridge.
-->
<script>
  import { onMount, createEventDispatcher } from 'svelte';
  import { api } from '$lib/api/client.js';
  import {
    listAllFolders,
    createFolder as bridgeCreateFolder,
    filesBridgeHealth
  } from '$lib/files/filesBridgeClient.js';

  // { id, client_name, files_folder (current override, may be null),
  //   effective_folder (what the bridge will use right now) }
  export let client;
  export let open = false;

  const dispatch = createEventDispatcher();

  let folders = [];        // [{ bucket, name, mtime }] from bridge
  let mappings = [];       // [{ id, client_name, files_folder, effective_folder }] from API
  let loading = true;
  let bridgeError = '';
  let saving = false;
  let saveError = '';
  let search = '';
  let showCreate = false;
  let newFolderName = '';
  let creating = false;

  // Map "folder name (lowercased)" → array of other clients using it.
  // Computed once both loads finish.
  let usedByIndex = new Map();

  $: filteredFolders = applyFilter(folders, search);

  function applyFilter(list, q) {
    const s = (q || '').trim().toLowerCase();
    if (!s) return list;
    return list.filter(f => f.name.toLowerCase().includes(s));
  }

  function buildUsedByIndex() {
    const map = new Map();
    for (const m of mappings) {
      if (!m.effective_folder) continue;
      if (m.id === client.id) continue;              // ignore the current client
      const k = m.effective_folder.toLowerCase();
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(m);
    }
    usedByIndex = map;
  }

  function usedBy(folderName) {
    return usedByIndex.get(folderName.toLowerCase()) || [];
  }

  async function load() {
    loading = true; bridgeError = '';
    try {
      // Run both in parallel; the API call is cheap and useful even if
      // the bridge is down.
      const [foldersResp, mappingsResp] = await Promise.all([
        listAllFolders().catch(e => { bridgeError = e.message || String(e); return { folders: [] }; }),
        api.getFolderMappings().catch(() => [])
      ]);
      folders = foldersResp.folders || [];
      mappings = mappingsResp || [];
      buildUsedByIndex();
    } finally {
      loading = false;
    }
  }

  async function pick(folderName) {
    const others = usedBy(folderName);
    if (others.length) {
      const names = others.map(o => o.client_name).slice(0, 3).join(', ')
        + (others.length > 3 ? ` and ${others.length - 3} more` : '');
      const ok = confirm(
        `"${folderName}" is already used by ${names}.\n\n` +
        `Assign it to ${client.client_name} anyway? ` +
        `The other client(s) will keep pointing at the same folder.`
      );
      if (!ok) return;
    }
    await save(folderName);
  }

  async function clearOverride() {
    if (!confirm(`Clear the folder override for ${client.client_name}?\n\nThe bridge will fall back to auto-matching on the client name.`)) return;
    await save(null);
  }

  async function save(folder) {
    saving = true; saveError = '';
    try {
      const updated = await api.setClientFolder(client.id, folder);
      dispatch('saved', updated);
      close();
    } catch (e) {
      saveError = e.message || 'Failed to save';
    } finally {
      saving = false;
    }
  }

  async function doCreate() {
    const name = (newFolderName || '').trim();
    if (!name) return;
    // Same charset the API + bridge both validate against.
    if (!/^[A-Za-z0-9 _.\-&',()]+$/.test(name)) {
      saveError = 'Folder name contains unsupported characters.';
      return;
    }
    creating = true; saveError = '';
    try {
      const r = await bridgeCreateFolder(name);
      // r.created is false if the folder already existed — either way,
      // the name is now valid to use as an override.
      await save(r.folder || name);
    } catch (e) {
      saveError = e.message || 'Could not create folder';
    } finally {
      creating = false;
    }
  }

  function close() {
    open = false;
    dispatch('close');
  }
  function onKey(e) {
    if (e.key === 'Escape') { if (showCreate) showCreate = false; else close(); }
  }

  onMount(load);
</script>

<svelte:window on:keydown={onKey} />

{#if open}
  <div class="modal-backdrop" on:click|self={close} role="dialog" aria-modal="true">
    <div class="modal-panel">
      <header class="modal-head">
        <div>
          <h2>Match L: Folder</h2>
          <div class="subhead">{client.client_name}</div>
        </div>
        <button class="close-x" on:click={close} aria-label="Close">×</button>
      </header>

      <div class="current">
        <div>
          <span class="current-label">Currently:</span>
          <span class="mono current-name">{client.effective_folder || '(none — no auto-match)'}</span>
          {#if client.files_folder}
            <span class="badge badge-override">manual</span>
          {:else if client.effective_folder}
            <span class="badge badge-auto">auto</span>
          {/if}
        </div>
        {#if client.files_folder}
          <button class="btn-link" on:click={clearOverride} disabled={saving}>
            Clear override
          </button>
        {/if}
      </div>

      <div class="toolbar">
        <input
          class="search"
          type="text"
          placeholder="Search folders…"
          bind:value={search}
          autofocus
        />
        <button class="btn btn-ghost" on:click={() => { showCreate = !showCreate; newFolderName = ''; saveError = ''; }}>
          {showCreate ? 'Cancel' : '+ Create new folder'}
        </button>
      </div>

      {#if showCreate}
        <div class="create-pane">
          <label>New folder name (auto-routed to A–K or L–Z bucket)</label>
          <div class="create-row">
            <input
              type="text"
              placeholder="e.g. Huron Bay Coop"
              bind:value={newFolderName}
              disabled={creating}
            />
            <button class="btn btn-primary" on:click={doCreate} disabled={creating || !newFolderName.trim()}>
              {creating ? 'Creating…' : 'Create & assign'}
            </button>
          </div>
          <p class="hint">
            Creates the folder on L:\ <em>and</em> saves it as the match for {client.client_name}.
          </p>
        </div>
      {/if}

      {#if saveError}
        <div class="notice notice-error">{saveError}</div>
      {/if}
      {#if bridgeError}
        <div class="notice notice-error">
          Could not load folder list from files-bridge: {bridgeError}
        </div>
      {/if}

      <div class="modal-body">
        {#if loading}
          <p class="empty-msg">Loading folders from L:\…</p>
        {:else if filteredFolders.length === 0}
          <p class="empty-msg">
            {search ? `No folders match "${search}".` : 'No folders found on L:\\.'}
          </p>
        {:else}
          <ul class="folder-list">
            {#each filteredFolders as f}
              {@const others = usedBy(f.name)}
              {@const isCurrent = (client.effective_folder || '').toLowerCase() === f.name.toLowerCase()}
              <li class="folder-row" class:current={isCurrent}>
                <button
                  class="folder-pick"
                  on:click={() => pick(f.name)}
                  disabled={saving || isCurrent}
                  title={isCurrent ? 'Already assigned' : 'Assign this folder'}
                >
                  <span class="bucket-tag">{f.bucket}</span>
                  <span class="folder-name">{f.name}</span>
                  {#if isCurrent}
                    <span class="pill pill-current">current</span>
                  {:else if others.length}
                    <span class="pill pill-warn" title={others.map(o => o.client_name).join(', ')}>
                      used by {others.length === 1 ? others[0].client_name : `${others.length} clients`}
                    </span>
                  {/if}
                </button>
              </li>
            {/each}
          </ul>
          <div class="result-count">
            {filteredFolders.length} folder{filteredFolders.length === 1 ? '' : 's'}
            {search ? ` matching "${search}"` : ''}
          </div>
        {/if}
      </div>

      <footer class="modal-foot">
        <button class="btn btn-ghost" on:click={close}>Close</button>
      </footer>
    </div>
  </div>
{/if}

<style>
  .modal-backdrop {
    position: fixed; inset: 0; background: rgba(10, 12, 16, 0.55);
    display: flex; align-items: center; justify-content: center;
    z-index: 2000; padding: 24px;
  }
  .modal-panel {
    background: var(--surface);
    border-radius: var(--radius-lg, 10px);
    box-shadow: var(--shadow-lg, 0 10px 40px rgba(0,0,0,0.35));
    width: min(640px, 100%);
    max-height: 92vh;
    display: flex; flex-direction: column;
    overflow: hidden;
  }
  .modal-head {
    display: flex; align-items: flex-start; justify-content: space-between;
    padding: 14px 20px;
    border-bottom: 1px solid var(--border);
  }
  .modal-head h2 {
    font-family: var(--font-display);
    font-size: 1.2rem;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    margin: 0;
  }
  .subhead {
    font-size: 0.88rem;
    color: var(--text-muted);
    margin-top: 2px;
  }
  .close-x {
    background: transparent; border: none; cursor: pointer;
    color: var(--text-muted);
    font-size: 1.3rem;
    padding: 0 4px; line-height: 1;
  }
  .close-x:hover { color: var(--text); }

  .current {
    display: flex; align-items: center; justify-content: space-between;
    gap: 12px;
    padding: 10px 20px;
    background: var(--surface-2);
    border-bottom: 1px solid var(--border);
    font-size: 0.92rem;
  }
  .current-label {
    color: var(--text-muted);
    font-family: var(--font-display);
    font-size: 0.75rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    margin-right: 6px;
  }
  .current-name { font-weight: 600; color: var(--text); }

  .badge {
    display: inline-block;
    margin-left: 6px;
    padding: 1px 7px;
    border-radius: 10px;
    font-size: 0.7rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .badge-override { background: #fef3c7; color: #92400e; }
  .badge-auto     { background: #dbeafe; color: #1e40af; }

  .toolbar {
    display: flex; gap: 10px;
    padding: 12px 20px;
    border-bottom: 1px solid var(--border);
  }
  .search {
    flex: 1;
  }

  .create-pane {
    padding: 12px 20px;
    background: var(--surface-2);
    border-bottom: 1px solid var(--border);
  }
  .create-pane label {
    display: block;
    font-family: var(--font-display);
    font-size: 0.75rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-muted);
    margin-bottom: 6px;
  }
  .create-row {
    display: flex; gap: 8px;
  }
  .create-row input { flex: 1; }
  .hint {
    margin-top: 6px;
    font-size: 0.8rem;
    color: var(--text-dim);
  }

  .notice {
    margin: 10px 20px 0;
    padding: 8px 12px;
    border-radius: var(--radius);
    font-size: 0.88rem;
  }
  .notice-error {
    background: #fef2f2;
    color: #991b1b;
    border: 1px solid #fecaca;
  }

  .modal-body {
    flex: 1;
    overflow-y: auto;
    padding: 0;
  }
  .folder-list {
    list-style: none; margin: 0; padding: 0;
  }
  .folder-row {
    border-bottom: 1px solid var(--border);
  }
  .folder-row:last-child { border-bottom: none; }
  .folder-row.current { background: #f0f9ff; }

  .folder-pick {
    width: 100%;
    display: flex; align-items: center; gap: 10px;
    padding: 10px 20px;
    background: none; border: none; text-align: left;
    cursor: pointer;
    font-size: 0.95rem;
    color: var(--text);
    transition: background 0.1s;
  }
  .folder-pick:hover:not(:disabled) { background: var(--surface-2); }
  .folder-pick:disabled { cursor: default; opacity: 0.9; }

  .bucket-tag {
    flex-shrink: 0;
    width: 32px;
    text-align: center;
    padding: 1px 0;
    font-family: var(--font-display);
    font-size: 0.7rem;
    letter-spacing: 0.06em;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--text-muted);
  }
  .folder-name { flex: 1; }

  .pill {
    padding: 2px 8px;
    border-radius: 12px;
    font-size: 0.72rem;
    font-weight: 600;
  }
  .pill-current { background: #dbeafe; color: #1e40af; }
  .pill-warn    { background: #fef3c7; color: #92400e; }

  .result-count {
    padding: 8px 20px;
    font-size: 0.78rem;
    color: var(--text-dim);
    border-top: 1px solid var(--border);
  }

  .modal-foot {
    display: flex; justify-content: flex-end; gap: 8px;
    padding: 12px 20px;
    border-top: 1px solid var(--border);
  }

  .mono {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 0.9em;
  }
  .empty-msg {
    padding: 24px 20px;
    color: var(--text-dim);
    font-style: italic;
    text-align: center;
  }
  .btn-link {
    background: none; border: none; cursor: pointer;
    color: var(--red);
    font-family: var(--font-display);
    font-size: 0.78rem;
    font-weight: 600;
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }
  .btn-link:disabled { opacity: 0.5; cursor: default; }
</style>
