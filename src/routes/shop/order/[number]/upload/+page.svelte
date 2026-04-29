<!-- src/routes/shop/order/[number]/upload/+page.svelte
     Artwork upload after checkout. Lists each design on the order; each
     row needs a file picker. Files POST to /api/designs/:id/upload. When
     the last file lands, the order auto-advances to awaiting_proof. -->
<script>
  import { onMount, onDestroy } from 'svelte';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { customer } from '$lib/stores/customer-auth.js';
  import { customerApi } from '$lib/api/customer-client.js';
  import { dtfCart } from '$lib/stores/dtf-cart.js';

  let order = null;
  let designs = [];   // from server
  let loading = true;
  let error = '';

  // Map designId → status: 'pending' | 'uploading' | 'done' | 'error'
  let uploadStatus = {};
  let uploadErrors = {};

  // In-memory File refs we may have from the cart (carried via session).
  let cachedFiles = {};   // designId → File

  // Hidden file-input refs, keyed by designId, so clicking the drop zone
  // can trigger the native picker as a fallback for non-drag users.
  let pickerRefs = {};

  // Per-card visual state for the drop zone (highlight on dragover).
  let dragOverId = null;

  $: orderNumber = $page.params.number;

  // Block the browser's default drop-anywhere behavior. Without this, a file
  // dropped outside a drop zone navigates the tab to the file's blob URL —
  // which was the original bug report. We swallow dragover + drop events on
  // window so only the per-card handlers can do anything useful.
  function blockWindowDrop(e) { e.preventDefault(); }

  onMount(async () => {
    if (!$customer) { goto(`/shop/login?return=${encodeURIComponent($page.url.pathname)}`); return; }

    window.addEventListener('dragover', blockWindowDrop);
    window.addEventListener('drop',     blockWindowDrop);

    // Re-attach files from the cart store if they're still in memory.
    // (The cart's _file refs survive in-tab navigation but not page reloads.)
    for (const d of $dtfCart.designs) {
      if (d._file) cachedFiles[d.id] = d._file;
    }

    try {
      const res = await customerApi.getOrder(orderNumber);
      order = res.order;
      designs = res.designs;
    } catch (e) {
      error = e.message;
    } finally {
      loading = false;
    }
  });

  onDestroy(() => {
    if (typeof window !== 'undefined') {
      window.removeEventListener('dragover', blockWindowDrop);
      window.removeEventListener('drop',     blockWindowDrop);
    }
  });

  async function uploadOne(designId, file) {
    if (!file) { uploadErrors[designId] = 'Pick a file first.'; return; }
    if (file.size > 50 * 1024 * 1024) { uploadErrors[designId] = 'File must be 50 MB or smaller.'; return; }
    uploadStatus[designId] = 'uploading';
    uploadErrors[designId] = '';
    try {
      const res = await customerApi.uploadDesign(designId, file);
      uploadStatus[designId] = 'done';
      if (res.order_advanced) {
        // All designs uploaded — bounce to order status.
        dtfCart.clear();
        sessionStorage.removeItem('hg_pending_designs');
        setTimeout(() => goto(`/shop/order/${orderNumber}`), 1000);
      }
    } catch (e) {
      uploadStatus[designId] = 'error';
      uploadErrors[designId] = e.message;
    }
  }

  function setFile(designId, file) {
    if (!file) return;
    cachedFiles[designId] = file;
    cachedFiles = cachedFiles;   // poke reactivity
    uploadErrors[designId] = '';
  }

  function pickFile(designId, e) {
    setFile(designId, e.target.files?.[0] || null);
  }

  function onDrop(designId, e) {
    dragOverId = null;
    const f = e.dataTransfer?.files?.[0];
    if (f) setFile(designId, f);
  }

  function openPicker(designId) {
    pickerRefs[designId]?.click();
  }

  async function uploadAll() {
    for (const d of designs) {
      if (uploadStatus[d.id] === 'done') continue;
      const f = cachedFiles[d.id];
      if (!f) continue;
      await uploadOne(d.id, f);
    }
  }
</script>

<svelte:head><title>Upload artwork — Order #{orderNumber}</title></svelte:head>

<div class="page">
  <h1>Upload your artwork</h1>
  <p class="subtitle">Order #{orderNumber} — drag a file onto a design card or click to pick. We'll build a proof from these and send it back for your approval.</p>

  {#if loading}
    <p>Loading…</p>
  {:else if error}
    <p class="alert error">{error}</p>
  {:else if order && order.status !== 'awaiting_artwork'}
    <p class="alert info">
      Artwork has already been uploaded for this order.
      <a href="/shop/order/{orderNumber}">View order →</a>
    </p>
  {:else}
    <div class="designs">
      {#each designs as d (d.id)}
        <div class="design-card" class:done={uploadStatus[d.id] === 'done'}>
          <div class="title">
            <strong>{d.name}</strong>
            {#if uploadStatus[d.id] === 'done'}
              <span class="ok">✓ uploaded</span>
            {:else if uploadStatus[d.id] === 'uploading'}
              <span class="up">uploading…</span>
            {/if}
          </div>

          {#if uploadStatus[d.id] !== 'done'}
            <!-- Drop zone: click to open native picker, drag-and-drop a file
                 to attach it. preventDefault on dragover/drop is what stops
                 the browser from navigating to the file's blob URL. -->
            <div class="dropzone"
                 class:drag-over={dragOverId === d.id}
                 class:has-file={!!cachedFiles[d.id]}
                 role="button"
                 tabindex="0"
                 on:click={() => openPicker(d.id)}
                 on:keydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPicker(d.id); } }}
                 on:dragover|preventDefault={() => dragOverId = d.id}
                 on:dragleave={() => dragOverId = null}
                 on:drop|preventDefault={(e) => onDrop(d.id, e)}>
              {#if cachedFiles[d.id]}
                <div class="file-info">
                  <span class="file-name">{cachedFiles[d.id].name}</span>
                  <span class="file-size">{(cachedFiles[d.id].size / 1024).toFixed(0)} KB</span>
                </div>
                <small class="hint">Click to swap, or drop a different file.</small>
              {:else}
                <div class="prompt">
                  <strong>Drop a file here</strong>
                  <small>or click to choose — PNG, JPG, PDF, SVG, AI, EPS, PSD, TIF, WEBP, GIF</small>
                </div>
              {/if}
              <input type="file"
                     bind:this={pickerRefs[d.id]}
                     accept=".png,.jpg,.jpeg,.pdf,.svg,.ai,.eps,.psd,.tif,.tiff,.webp,.gif"
                     on:change={(e) => pickFile(d.id, e)}
                     hidden />
            </div>
            <button class="btn"
                    on:click={() => uploadOne(d.id, cachedFiles[d.id])}
                    disabled={!cachedFiles[d.id] || uploadStatus[d.id] === 'uploading'}>
              Upload
            </button>
          {/if}

          {#if uploadErrors[d.id]}
            <p class="alert error">{uploadErrors[d.id]}</p>
          {/if}
        </div>
      {/each}
    </div>

    <button class="btn primary big" on:click={uploadAll}>Upload all selected</button>
  {/if}
</div>

<style>
  .page { max-width: 50rem; margin: 0 auto; padding: 2rem 1rem; }
  h1 { margin: 0 0 0.25rem; }
  .subtitle { color: #555; margin: 0 0 1.5rem; }
  .alert { padding: 0.75rem 1rem; border-radius: 0.4rem; margin: 1rem 0; }
  .alert.info { background: #eef6ff; color: #225; }
  .alert.error { background: #fee; color: #b00; }
  .designs { display: flex; flex-direction: column; gap: 1rem; margin-bottom: 1.5rem; }
  .design-card { background: white; border: 1px solid #e4e4e7; border-radius: 0.5rem; padding: 1rem; display: flex; flex-direction: column; gap: 0.75rem; }
  .design-card.done { background: #f0f9f0; border-color: #b8d8b8; }
  .title { display: flex; justify-content: space-between; }
  .ok { color: #2a7a2a; font-weight: 500; }
  .up { color: #c80; }
  .dropzone {
    border: 2px dashed #cbd5e1;
    border-radius: 0.5rem;
    padding: 1.25rem 1rem;
    background: #f8fafc;
    text-align: center;
    cursor: pointer;
    transition: background 120ms, border-color 120ms;
  }
  .dropzone:hover { background: #f1f5f9; border-color: #94a3b8; }
  .dropzone.drag-over { background: #fef3f2; border-color: #c01818; border-style: solid; }
  .dropzone.has-file { background: #f0fdf4; border-color: #86efac; border-style: solid; }
  .dropzone .prompt strong { display: block; font-size: 0.95rem; margin-bottom: 0.25rem; }
  .dropzone .prompt small { color: #64748b; }
  .file-info { display: flex; justify-content: center; gap: 0.5rem; align-items: baseline; }
  .file-name { font-weight: 500; }
  .file-size { color: #64748b; font-size: 0.85rem; }
  .hint { display: block; color: #64748b; margin-top: 0.25rem; }
  .btn { padding: 0.5rem 1rem; background: #c01818; color: white; border: none; border-radius: 0.3rem; cursor: pointer; align-self: start; }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn.primary.big { padding: 0.85rem 1.5rem; font-weight: 600; }
</style>
