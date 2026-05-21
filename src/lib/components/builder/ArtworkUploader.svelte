<!--
  ArtworkUploader.svelte — Step 5 of the decoration builder.

  One per location chip. Lets the buyer drop or pick an artwork file, or
  defer it ("I'll send it later"). Files over 25 MB are rejected with the
  spec's exact wording.

  For now, accepted files become a blob: URL stored locally — this gives
  immediate thumbnail preview and survives in-page navigation but is
  ephemeral. Step 6 (order state machine) swaps the upload path to POST
  /api/orders/:id/artwork and replaces the blob: URL with the persisted one.

  Props (read-only, parent owns the data):
    fileUrl        string | null
    fileName       string
    fileSize       number (bytes)
    deferred       bool

  Dispatches a single 'change' event with a patch object containing the
  fields that should be merged into the parent's location:
    { artwork_file_url, artwork_file_name, artwork_file_size, artwork_deferred }
-->
<script>
  import { createEventDispatcher } from 'svelte';

  export let fileUrl  = null;
  export let fileName = '';
  export let fileSize = 0;
  export let deferred = false;

  // Files already uploaded elsewhere in this draft, so the buyer can reuse
  // a design across multiple line items without re-uploading. Each entry:
  // { url, name, size }. Parent computes this reactively from all locations.
  export let existingDesigns = [];

  const MAX_BYTES = 25 * 1024 * 1024;
  const ACCEPT = '.png,.jpg,.jpeg,.gif,.webp,.svg,.pdf,.ai,.eps,.psd,.tiff,.tif';

  const dispatch = createEventDispatcher();

  let inputEl;
  let dragOver = false;
  let uploadError = '';

  function emit(patch) {
    dispatch('change', patch);
  }

  function processFile(file) {
    uploadError = '';
    if (!file) return;
    if (file.size > MAX_BYTES) {
      uploadError = 'File too large, please send via email after submitting.';
      return;
    }
    // Local-only blob URL; Step 6 swaps in real upload.
    const blobUrl = URL.createObjectURL(file);
    emit({
      artwork_file_url:  blobUrl,
      artwork_file_name: file.name,
      artwork_file_size: file.size,
      artwork_deferred:  false
    });
  }

  function onFileSelected(e) {
    const f = e.target.files?.[0];
    if (f) processFile(f);
    e.target.value = '';
  }

  function onDrop(e) {
    e.preventDefault();
    dragOver = false;
    const f = e.dataTransfer?.files?.[0];
    if (f) processFile(f);
  }

  function onDragOver(e) {
    e.preventDefault();
    dragOver = true;
  }

  function onDragLeave() {
    dragOver = false;
  }

  function removeFile() {
    if (fileUrl && fileUrl.startsWith('blob:')) URL.revokeObjectURL(fileUrl);
    emit({
      artwork_file_url:  null,
      artwork_file_name: '',
      artwork_file_size: 0
    });
    uploadError = '';
  }

  function toggleDeferred(e) {
    const next = e.target.checked;
    uploadError = '';
    if (next && fileUrl) {
      if (fileUrl.startsWith('blob:')) URL.revokeObjectURL(fileUrl);
      emit({
        artwork_deferred:  true,
        artwork_file_url:  null,
        artwork_file_name: '',
        artwork_file_size: 0
      });
    } else {
      emit({ artwork_deferred: next });
    }
  }

  function formatBytes(b) {
    if (!b) return '';
    if (b < 1024) return `${b} B`;
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
    return `${(b / 1024 / 1024).toFixed(1)} MB`;
  }

  function isImage(name) {
    return /\.(png|jpe?g|gif|webp|svg|tiff?)$/i.test(name);
  }

  function reuseDesign(d) {
    uploadError = '';
    emit({
      artwork_file_url:  d.url,
      artwork_file_name: d.name,
      artwork_file_size: d.size || 0,
      artwork_deferred:  false
    });
  }

  // Don't offer to reuse the same file already set on this location.
  $: reuseOptions = (existingDesigns || []).filter((d) => d.url && d.url !== fileUrl);
</script>

<div class="artwork-uploader">
  {#if fileUrl}
    <div class="file-preview">
      {#if isImage(fileName)}
        <img src={fileUrl} alt="Artwork preview" class="thumb" />
      {:else}
        <span class="file-icon" aria-hidden="true">📄</span>
      {/if}
      <div class="file-info">
        <span class="file-name" title={fileName}>{fileName}</span>
        <span class="file-size">{formatBytes(fileSize)}</span>
      </div>
      <button
        type="button"
        class="remove-btn"
        on:click={removeFile}
        aria-label="Remove artwork"
        title="Remove artwork">×</button>
    </div>
  {:else if deferred}
    <div class="deferred-note">
      <span class="check" aria-hidden="true">✓</span>
      <span>Artwork will be sent later by email.</span>
    </div>
  {:else}
    {#if reuseOptions.length > 0}
      <div class="reuse-row">
        <span class="reuse-label">Reuse from this order:</span>
        <div class="reuse-chips">
          {#each reuseOptions as d (d.url)}
            <button
              type="button"
              class="reuse-chip"
              on:click={() => reuseDesign(d)}
              title="Use {d.name} for this location">
              {#if isImage(d.name)}
                <img src={d.url} alt="" class="reuse-thumb" />
              {:else}
                <span class="reuse-icon" aria-hidden="true">📄</span>
              {/if}
              <span class="reuse-name">{d.name}</span>
            </button>
          {/each}
        </div>
      </div>
    {/if}
    <div
      class="dropzone"
      class:drag-over={dragOver}
      on:dragover={onDragOver}
      on:dragleave={onDragLeave}
      on:drop={onDrop}
      role="presentation">
      <input
        type="file"
        bind:this={inputEl}
        accept={ACCEPT}
        on:change={onFileSelected}
        class="file-input" />
      <button
        type="button"
        class="browse-btn"
        on:click={() => inputEl?.click()}>{reuseOptions.length > 0 ? 'Or upload new' : 'Upload artwork'}</button>
      <span class="hint small">or drop a file here</span>
    </div>
  {/if}

  {#if uploadError}
    <p class="alert error">{uploadError}</p>
  {/if}

  <label class="defer-toggle">
    <input
      type="checkbox"
      checked={deferred}
      on:change={toggleDeferred} />
    <span>I'll send the artwork later</span>
  </label>
</div>

<style>
  .artwork-uploader { display: flex; flex-direction: column; gap: 0.5rem; }

  .dropzone {
    display: flex; align-items: center; gap: 0.6rem;
    padding: 0.55rem 0.75rem;
    border: 1px dashed #c4c4c8;
    border-radius: 0.35rem;
    background: #fafafa;
    transition: border-color 0.15s, background 0.15s;
  }
  .dropzone.drag-over {
    border-color: #c01818;
    background: #fff0f0;
    border-style: solid;
  }
  .file-input { display: none; }

  .browse-btn {
    background: white;
    color: #c01818;
    border: 1px solid #c01818;
    padding: 0.35rem 0.75rem;
    border-radius: 0.3rem;
    font-size: 0.85rem;
    cursor: pointer;
    font-weight: 500;
  }
  .browse-btn:hover { background: #fff0f0; }

  .hint { color: #888; font-size: 0.85rem; }
  .small { font-size: 0.82rem; }

  .file-preview {
    display: flex; align-items: center; gap: 0.6rem;
    background: white;
    border: 1px solid #e4e4e7;
    border-radius: 0.35rem;
    padding: 0.4rem 0.55rem;
  }
  .thumb {
    width: 2.5rem; height: 2.5rem;
    object-fit: cover;
    border-radius: 0.25rem;
    border: 1px solid #e4e4e7;
    background: #f5f5f5;
    flex: 0 0 auto;
  }
  .file-icon {
    width: 2.5rem; height: 2.5rem;
    display: flex; align-items: center; justify-content: center;
    font-size: 1.3rem; background: #f5f5f5;
    border: 1px solid #e4e4e7; border-radius: 0.25rem;
    flex: 0 0 auto;
  }
  .file-info {
    display: flex; flex-direction: column; gap: 0.1rem;
    flex-grow: 1; min-width: 0;
  }
  .file-name {
    font-size: 0.88rem; font-weight: 500;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .file-size { font-size: 0.78rem; color: #888; }
  .remove-btn {
    background: none; border: 0; color: #b00; cursor: pointer;
    font-size: 1.2rem; line-height: 1; padding: 0 0.2rem;
  }
  .remove-btn:hover { opacity: 0.7; }

  .deferred-note {
    display: flex; align-items: center; gap: 0.5rem;
    padding: 0.5rem 0.7rem;
    background: #f0f7ff;
    border: 1px solid #c6def0;
    border-radius: 0.35rem;
    font-size: 0.88rem;
    color: #2a5680;
  }
  .check {
    display: inline-flex; align-items: center; justify-content: center;
    width: 1.1rem; height: 1.1rem;
    border-radius: 50%;
    background: #2a5680;
    color: white;
    font-size: 0.7rem;
    flex: 0 0 auto;
  }

  .alert { padding: 0.4rem 0.6rem; border-radius: 0.3rem; margin: 0; font-size: 0.85rem; }
  .alert.error { background: #fee; color: #b00; }

  .defer-toggle {
    display: flex; align-items: center; gap: 0.4rem;
    font-size: 0.85rem; color: #555;
    cursor: pointer;
    user-select: none;
  }
  .defer-toggle input { margin: 0; cursor: pointer; }

  .reuse-row { display: flex; flex-direction: column; gap: 0.35rem; }
  .reuse-label { font-size: 0.82rem; color: #555; }
  .reuse-chips { display: flex; flex-wrap: wrap; gap: 0.4rem; }
  .reuse-chip {
    display: flex; align-items: center; gap: 0.4rem;
    background: white; border: 1px solid #d4d4d8;
    padding: 0.3rem 0.55rem 0.3rem 0.35rem;
    border-radius: 999px; cursor: pointer;
    font-size: 0.82rem; color: #333;
    max-width: 100%;
  }
  .reuse-chip:hover { border-color: #c01818; background: #fff5f5; }
  .reuse-thumb {
    width: 1.4rem; height: 1.4rem;
    object-fit: cover;
    border-radius: 50%;
    border: 1px solid #e4e4e7;
    flex: 0 0 auto;
  }
  .reuse-icon {
    width: 1.4rem; height: 1.4rem;
    display: inline-flex; align-items: center; justify-content: center;
    font-size: 0.9rem;
    background: #f5f5f5; border-radius: 50%; border: 1px solid #e4e4e7;
    flex: 0 0 auto;
  }
  .reuse-name {
    max-width: 10rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
</style>
