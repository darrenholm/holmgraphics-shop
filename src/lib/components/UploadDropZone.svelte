<!-- src/lib/components/UploadDropZone.svelte
     Single-zone drag-and-drop file picker. Used by the public client
     upload page (src/routes/upload/[token]/+page.svelte). The
     per-design upload page at /shop/order/[number]/upload has different
     requirements (one drop slot per design) and stays bespoke for now;
     a follow-up could refactor it onto this component if/when we have
     multi-file-per-slot semantics figured out.
     Props:
       files       (bind:files)  array of File objects currently staged
       accept                    comma-separated extension allowlist
                                 (e.g. ".png,.jpg,.pdf")
       maxBytes                  per-file size cap, in bytes
       hint                      placeholder text on the empty zone
       multiple                  bool, default true
-->
<script>
  import { createEventDispatcher } from 'svelte';

  export let files     = [];
  export let accept    = '';
  export let maxBytes  = 50 * 1024 * 1024;
  export let hint      = 'Drop files here, or click to choose.';
  export let multiple  = true;

  const dispatch = createEventDispatcher();

  let pickerEl;
  let dragOver = false;
  let rejectMsg = '';

  function addFiles(list) {
    rejectMsg = '';
    if (!list || list.length === 0) return;
    const next = multiple ? [...files] : [];
    for (const f of list) {
      if (f.size > maxBytes) {
        rejectMsg = `${f.name} is ${(f.size / 1024 / 1024).toFixed(1)} MB — over the ${(maxBytes / 1024 / 1024).toFixed(0)} MB limit. Skipped.`;
        continue;
      }
      next.push(f);
      if (!multiple) break;
    }
    files = next;
    dispatch('change', { files });
  }

  function removeAt(idx) {
    files = files.filter((_, i) => i !== idx);
    dispatch('change', { files });
  }

  function clearAll() {
    files = [];
    rejectMsg = '';
    dispatch('change', { files });
  }

  function onDrop(e) {
    dragOver = false;
    addFiles(e.dataTransfer?.files);
  }

  function onPick(e) {
    addFiles(e.target.files);
    // Clear the input so picking the same file twice still fires change.
    e.target.value = '';
  }

  function openPicker() { pickerEl?.click(); }
  function onKey(e) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openPicker();
    }
  }
</script>

<div class="dropzone-wrap">
  <div class="dropzone"
       class:drag-over={dragOver}
       class:has-files={files.length > 0}
       role="button"
       tabindex="0"
       on:click={openPicker}
       on:keydown={onKey}
       on:dragover|preventDefault={() => dragOver = true}
       on:dragleave={() => dragOver = false}
       on:drop|preventDefault={onDrop}>
    {#if files.length === 0}
      <strong class="prompt">{hint}</strong>
      <small class="hint">{accept || 'Any file type'} · max {(maxBytes / 1024 / 1024).toFixed(0)} MB each</small>
    {:else}
      <strong class="prompt">{files.length} file{files.length === 1 ? '' : 's'} staged</strong>
      <small class="hint">Drop more, or click to add — click a file below to remove it.</small>
    {/if}
    <input type="file"
           bind:this={pickerEl}
           {accept}
           {multiple}
           on:change={onPick}
           hidden />
  </div>

  {#if rejectMsg}
    <p class="reject">{rejectMsg}</p>
  {/if}

  {#if files.length > 0}
    <ul class="file-list">
      {#each files as f, i (f.name + f.size + i)}
        <li>
          <span class="file-name">{f.name}</span>
          <span class="file-size">{(f.size / 1024).toFixed(0)} KB</span>
          <button type="button" class="remove" on:click={() => removeAt(i)} aria-label={`Remove ${f.name}`}>×</button>
        </li>
      {/each}
    </ul>
    <div class="list-actions">
      <button type="button" class="btn-text" on:click={clearAll}>Clear all</button>
    </div>
  {/if}
</div>

<style>
  .dropzone-wrap { display: flex; flex-direction: column; gap: 0.6rem; }

  .dropzone {
    border: 2px dashed #cbd5e1;
    border-radius: 0.6rem;
    background: #f8fafc;
    padding: 1.6rem 1rem;
    text-align: center;
    cursor: pointer;
    transition: background 0.12s, border-color 0.12s;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    align-items: center;
  }
  .dropzone:hover { background: #f1f5f9; border-color: #94a3b8; }
  .dropzone.drag-over {
    background: #fef3f2;
    border-color: #c01818;
    border-style: solid;
  }
  .dropzone.has-files {
    background: #f0fdf4;
    border-color: #86efac;
    border-style: solid;
  }
  .prompt { font-size: 0.95rem; }
  .hint   { color: #64748b; font-size: 0.8rem; }

  .reject {
    margin: 0;
    color: #b00;
    background: #fee;
    padding: 0.5rem 0.75rem;
    border-radius: 0.3rem;
    font-size: 0.85rem;
  }

  .file-list {
    list-style: none;
    margin: 0;
    padding: 0;
    border: 1px solid #e4e4e7;
    border-radius: 0.5rem;
    background: #fff;
    overflow: hidden;
  }
  .file-list li {
    display: grid;
    grid-template-columns: 1fr auto auto;
    gap: 0.6rem;
    align-items: center;
    padding: 0.55rem 0.85rem;
    border-bottom: 1px solid #f1f5f9;
    font-size: 0.9rem;
  }
  .file-list li:last-child { border-bottom: none; }
  .file-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .file-size { color: #64748b; font-size: 0.8rem; font-variant-numeric: tabular-nums; }
  .remove {
    background: none; border: none; cursor: pointer;
    color: #94a3b8; font-size: 1.1rem; line-height: 1;
    padding: 0 0.25rem;
  }
  .remove:hover { color: #c01818; }

  .list-actions { display: flex; justify-content: flex-end; }
  .btn-text {
    background: none; border: none; cursor: pointer;
    color: #64748b; font-size: 0.82rem;
    text-decoration: underline; text-underline-offset: 3px;
  }
  .btn-text:hover { color: #c01818; }
</style>
