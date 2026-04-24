<!-- src/routes/shop/order/[number]/upload/+page.svelte
     Artwork upload after checkout. Lists each design on the order; each
     row needs a file picker. Files POST to /api/designs/:id/upload. When
     the last file lands, the order auto-advances to awaiting_proof. -->
<script>
  import { onMount } from 'svelte';
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

  $: orderNumber = $page.params.number;

  onMount(async () => {
    if (!$customer) { goto(`/shop/login?return=${encodeURIComponent($page.url.pathname)}`); return; }

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

  function pickFile(designId, e) {
    cachedFiles[designId] = e.target.files?.[0] || null;
    cachedFiles = cachedFiles;   // poke reactivity
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
  <p class="subtitle">Order #{orderNumber} — drag-and-drop or pick each design's file. We'll build a proof from these and send it back for your approval.</p>

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
            <input type="file"
                   accept=".png,.jpg,.jpeg,.pdf,.svg,.ai,.eps,.psd,.tif,.tiff,.webp,.gif"
                   on:change={(e) => pickFile(d.id, e)} />
            {#if cachedFiles[d.id]}
              <small>{cachedFiles[d.id].name} ({(cachedFiles[d.id].size/1024).toFixed(0)} KB)</small>
            {/if}
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
  .design-card { background: white; border: 1px solid #e4e4e7; border-radius: 0.5rem; padding: 1rem; display: flex; flex-direction: column; gap: 0.5rem; }
  .design-card.done { background: #f0f9f0; border-color: #b8d8b8; }
  .title { display: flex; justify-content: space-between; }
  .ok { color: #2a7a2a; font-weight: 500; }
  .up { color: #c80; }
  small { color: #888; }
  .btn { padding: 0.5rem 1rem; background: #c01818; color: white; border: none; border-radius: 0.3rem; cursor: pointer; align-self: start; }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn.primary.big { padding: 0.85rem 1.5rem; font-weight: 600; }
</style>
