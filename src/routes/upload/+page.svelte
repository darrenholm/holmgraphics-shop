<!-- src/routes/upload/+page.svelte -->
<script>
  export const prerender = true;
  import { onMount } from 'svelte';
  import { api } from '$lib/api/client.js';
  import { isStaff } from '$lib/stores/auth.js';
  import { goto } from '$app/navigation';

  let searchQuery = '';
  let searchResults = [];
  let selectedJob = null;
  let selectedFiles = [];
  let uploading = false;
  let uploaded = [];
  let error = '';
  let searching = false;
  let markGallery = false;
  let galleryCategory = '';
  let fileInput;
  let success = false;

  onMount(() => {
    if (!$isStaff) goto('/login');
  });

  function handleFiles(e) {
    selectedFiles = Array.from(e.target.files);
    // Reset job selection when new photos picked
    selectedJob = null;
    searchQuery = '';
    searchResults = [];
    success = false;
  }

  async function search() {
    if (!searchQuery.trim()) return;
    searching = true;
    error = '';
    try {
      const results = await api.getProjects({ search: searchQuery.trim() });
      searchResults = results.slice(0, 10);
    } catch (e) {
      error = e.message;
    } finally {
      searching = false;
    }
  }

  function selectJob(job) {
    selectedJob = job;
    searchResults = [];
    searchQuery = job.client_name + ' — ' + job.project_name;
  }

  function clearJob() {
    selectedJob = null;
    searchQuery = '';
    searchResults = [];
  }

  function clearPhotos() {
    selectedFiles = [];
    selectedJob = null;
    searchQuery = '';
    searchResults = [];
    uploaded = [];
    success = false;
    if (fileInput) fileInput.value = '';
  }

  async function compressImage(file, maxWidth = 1920, quality = 0.85) {
    return new Promise((resolve) => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const img = new Image();
      img.onload = () => {
        let width = img.width;
        let height = img.height;
        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }
        canvas.width = width;
        canvas.height = height;
        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob((blob) => {
          resolve(new File([blob], file.name, { type: 'image/jpeg' }));
        }, 'image/jpeg', quality);
      };
      img.src = URL.createObjectURL(file);
    });
  }

  async function uploadPhotos() {
    if (!selectedJob || !selectedFiles.length) return;
    uploading = true;
    error = '';
    try {
      const compressed = await Promise.all(selectedFiles.map(f => compressImage(f)));
      const result = await api.uploadPhotos(selectedJob.id, compressed);
      uploaded = result.files || [];
      if (markGallery && galleryCategory && uploaded.length) {
        for (const f of uploaded) {
          await api.updatePhotoGallery(selectedJob.id, f.filename, true, galleryCategory);
        }
      }
      success = true;
      selectedFiles = [];
      if (fileInput) fileInput.value = '';
    } catch (e) {
      error = e.message;
    } finally {
      uploading = false;
    }
  }
</script>

<svelte:head><title>Upload Photos — Holm Graphics</title></svelte:head>

<div class="upload-page">
  <div class="upload-header">
    <a href="/dashboard" class="back">← Job Board</a>
    <h1>Upload Photos</h1>
    <p>Pick photos from your library, then find the job they belong to.</p>
  </div>

  <div class="upload-card">

    <!-- Step 1: Pick photos -->
    <div class="step" class:done={selectedFiles.length > 0}>
      <div class="step-label">1 · Pick Photos</div>
      <input
        type="file"
        accept="image/*"
        multiple
        bind:this={fileInput}
        on:change={handleFiles}
        style="display:none"
      />
      {#if selectedFiles.length > 0}
        <div class="preview-grid">
          {#each selectedFiles as file}
            <img
              class="preview-thumb"
              src={URL.createObjectURL(file)}
              alt={file.name}
            />
          {/each}
        </div>
        <div class="photo-actions">
          <span class="file-count">{selectedFiles.length} photo{selectedFiles.length > 1 ? 's' : ''} selected</span>
          <button class="btn-clear-photos" on:click={clearPhotos}>✕ Clear</button>
        </div>
      {:else}
        <button class="btn-pick" on:click={() => fileInput.click()}>
          📷 Choose Photos from Library
        </button>
      {/if}
    </div>

    <!-- Step 2: Find job -->
    {#if selectedFiles.length > 0}
      <div class="step" class:done={selectedJob}>
        <div class="step-label">2 · Find Job</div>
        {#if selectedJob}
          <div class="selected-job">
            <div class="selected-job-info">
              <span class="job-num">#{selectedJob.id}</span>
              <span class="job-name">{selectedJob.project_name}</span>
              <span class="job-client">{selectedJob.client_name}</span>
            </div>
            <button class="btn-clear" on:click={clearJob}>✕</button>
          </div>
        {:else}
          <div class="search-box">
            <input
              type="search"
              placeholder="Type client name…"
              bind:value={searchQuery}
              on:input={() => { if (searchQuery.length > 1) search(); }}
              on:keydown={(e) => e.key === 'Enter' && search()}
              autofocus
            />
            <button class="btn-search" on:click={search} disabled={searching}>
              {searching ? '…' : '🔍'}
            </button>
          </div>
          {#if searchResults.length > 0}
            <div class="results">
              {#each searchResults as job}
                <button class="result-item" on:click={() => selectJob(job)}>
                  <span class="result-client">{job.client_name}</span>
                  <span class="result-name">{job.project_name || 'Untitled'}</span>
                  <span class="result-meta">#{job.id} · {job.status_name}</span>
                </button>
              {/each}
            </div>
          {/if}
        {/if}
      </div>

      <!-- Step 3: Gallery option -->
      {#if selectedJob}
        <div class="step">
          <div class="step-label">3 · Gallery (optional)</div>
          <label class="gallery-toggle">
            <input type="checkbox" bind:checked={markGallery} />
            Add to public gallery
          </label>
          {#if markGallery}
            <select bind:value={galleryCategory} class="gallery-select">
              <option value="">Select category…</option>
              <option value="Signs & LED">Signs & LED</option>
              <option value="Vehicle Wraps">Vehicle Wraps</option>
              <option value="Apparel">Apparel</option>
              <option value="Printing">Printing</option>
            </select>
          {/if}
        </div>

        <!-- Step 4: Upload -->
        <div class="step">
          <div class="step-label">4 · Upload</div>
          {#if error}
            <p class="error-msg">{error}</p>
          {/if}
          {#if success}
            <div class="success-msg">
              ✅ {uploaded.length} photo{uploaded.length > 1 ? 's' : ''} uploaded to Job #{selectedJob.id}!
              <br>
              <button class="btn-more" on:click={() => { success = false; clearJob(); fileInput.click(); }}>Upload More Photos</button>
              <a href="/jobs/{selectedJob.id}" class="btn-view">View Job →</a>
            </div>
          {:else}
            <button
              class="btn-upload"
              on:click={uploadPhotos}
              disabled={uploading}
            >
              {uploading ? 'Uploading…' : `Upload ${selectedFiles.length} Photo${selectedFiles.length !== 1 ? 's' : ''} to ${selectedJob.client_name}`}
            </button>
          {/if}
        </div>
      {/if}
    {/if}

  </div>
</div>

<style>
  .upload-page {
    min-height: 100vh;
    background: var(--bg);
    padding: 20px 16px 40px;
    max-width: 600px;
    margin: 0 auto;
  }

  .upload-header { margin-bottom: 24px; }

  .back {
    font-family: var(--font-display);
    font-size: 0.75rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-muted);
    display: inline-block;
    margin-bottom: 12px;
  }
  .back:hover { color: var(--red); }

  h1 {
    font-family: var(--font-display);
    font-size: 2rem;
    font-weight: 900;
    color: var(--text);
    margin-bottom: 4px;
  }

  p { color: var(--text-muted); font-size: 0.95rem; }

  .upload-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    overflow: hidden;
  }

  .step {
    padding: 20px;
    border-bottom: 1px solid var(--border);
  }
  .step:last-child { border-bottom: none; }
  .step.done { background: var(--surface-2); }

  .step-label {
    font-family: var(--font-display);
    font-size: 0.75rem;
    font-weight: 700;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--text-muted);
    margin-bottom: 12px;
  }

  .btn-pick {
    width: 100%;
    padding: 24px 16px;
    background: var(--surface-2);
    border: 2px dashed var(--border);
    border-radius: var(--radius);
    cursor: pointer;
    font-size: 1.1rem;
    font-weight: 600;
    color: var(--text-muted);
    transition: all 0.2s;
  }
  .btn-pick:hover { border-color: var(--red); color: var(--red); }

  .preview-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 6px;
    margin-bottom: 10px;
  }

  .preview-thumb {
    aspect-ratio: 1;
    object-fit: cover;
    border-radius: 6px;
    width: 100%;
  }

  .photo-actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .file-count { font-size: 0.9rem; color: var(--text-muted); }

  .btn-clear-photos {
    background: none;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 4px 10px;
    cursor: pointer;
    font-size: 0.85rem;
    color: var(--text-muted);
  }
  .btn-clear-photos:hover { border-color: var(--red); color: var(--red); }

  .search-box { display: flex; gap: 8px; }
  .search-box input { flex: 1; font-size: 1rem; }

  .btn-search {
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 8px 14px;
    cursor: pointer;
    font-size: 1.1rem;
  }

  .results {
    margin-top: 8px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    overflow: hidden;
  }

  .result-item {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 12px 14px;
    border: none;
    border-bottom: 1px solid var(--border);
    background: var(--surface);
    cursor: pointer;
    text-align: left;
  }
  .result-item:last-child { border-bottom: none; }
  .result-item:hover { background: var(--surface-2); }

  .result-client { font-size: 1rem; font-weight: 700; color: var(--text); }
  .result-name { font-size: 0.9rem; color: var(--text-muted); }
  .result-meta { font-size: 0.78rem; color: var(--text-dim); }

  .selected-job {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .selected-job-info { display: flex; flex-direction: column; gap: 2px; }
  .job-num { font-family: var(--font-display); font-size: 0.75rem; color: var(--text-dim); }
  .job-name { font-size: 1rem; font-weight: 700; color: var(--text); }
  .job-client { font-size: 0.9rem; color: var(--text-muted); }

  .btn-clear {
    background: none;
    border: 1px solid var(--border);
    border-radius: 50%;
    width: 28px;
    height: 28px;
    cursor: pointer;
    color: var(--text-muted);
    font-size: 0.8rem;
    flex-shrink: 0;
  }

  .gallery-toggle {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 1rem;
    cursor: pointer;
    color: var(--text);
  }
  .gallery-toggle input { cursor: pointer; width: 18px; height: 18px; }

  .gallery-select { margin-top: 12px; width: 100%; font-size: 1rem; }

  .btn-upload {
    width: 100%;
    padding: 16px;
    background: var(--red);
    color: white;
    border: none;
    border-radius: var(--radius);
    font-size: 1rem;
    font-weight: 700;
    font-family: var(--font-display);
    letter-spacing: 0.04em;
    cursor: pointer;
    transition: all 0.2s;
  }
  .btn-upload:hover:not(:disabled) { background: #b91c1c; }
  .btn-upload:disabled { opacity: 0.5; cursor: not-allowed; }

  .success-msg {
    background: #f0fdf4;
    border: 1px solid #86efac;
    border-radius: var(--radius);
    padding: 16px;
    color: #166534;
    font-size: 1rem;
    line-height: 1.8;
  }

  .btn-more, .btn-view {
    display: inline-block;
    margin-top: 8px;
    margin-right: 8px;
    padding: 6px 14px;
    border-radius: var(--radius);
    font-size: 0.9rem;
    font-weight: 600;
    cursor: pointer;
    text-decoration: none;
  }
  .btn-more { background: white; border: 1px solid #86efac; color: #166534; }
  .btn-view { background: var(--red); border: none; color: white; }

  .error-msg { color: var(--red); font-size: 0.9rem; margin-bottom: 12px; }
</style>
