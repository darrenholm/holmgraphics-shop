<!-- src/routes/upload/[token]/+page.svelte
     Public client-upload portal. Customer arrives here from the email
     they received when staff hit "Send upload link" on the job page.
     No auth — the token in the URL IS the credential.

     Flow:
       1. on mount: GET /api/upload-links/:token → render job + client name
          + remaining-uploads counter, OR an error state.
       2. customer drops files (UploadDropZone component) — staged, not yet
          uploaded.
       3. clicks "Upload all" → POSTs each file in series to
          /api/upload-links/:token/upload, updating progress as we go.
       4. on success → "All done!" confirmation; staff get an email per file.
-->
<script>
  import { onMount, onDestroy } from 'svelte';
  import { page } from '$app/stores';
  import UploadDropZone from '$lib/components/UploadDropZone.svelte';
  // Single source of truth for the API host. Reads VITE_API_URL — the
  // canonical name used by client.js and customer-client.js. The
  // earlier bespoke fallback in this file used VITE_API_BASE (a name
  // that doesn't exist in production env), so it silently fell back
  // to a relative "/api" against the static host instead of the
  // Railway API. That misrouted GET → static 404 HTML (rendered as
  // "job #undefined") and POST → static 405 (the "method not
  // allowed" report). API_BASE already includes the trailing /api
  // segment, so callers concatenate `${API_BASE}/<endpoint>` without
  // doubling it up.
  import { API_BASE } from '$lib/api/client.js';

  $: token = $page.params.token;

  // Token-validation state.
  let loading = true;
  let info    = null;        // { job_number, client_name, expires_at, uploads_remaining, ... }
  let loadError = '';        // human-friendly explanation if the token is bad

  // Upload state.
  let stagedFiles = [];
  let uploading   = false;
  let uploadResults = [];    // [{ name, status: 'pending' | 'done' | 'error', error?, filename?, bytes? }]
  let allDone     = false;

  const ALLOWED_EXTS = '.png,.jpg,.jpeg,.gif,.webp,.svg,.tif,.tiff,.pdf,.ai,.eps,.psd,.cdr';

  // Block default browser drop behaviour at the window level so a missed
  // drop doesn't navigate the tab to a blob URL of the file. (Same guard
  // as /shop/order/[number]/upload — this page can also be hit by users
  // who don't drop precisely on the zone.)
  function blockWindowDrop(e) { e.preventDefault(); }

  onMount(async () => {
    window.addEventListener('dragover', blockWindowDrop);
    window.addEventListener('drop',     blockWindowDrop);
    await loadInfo();
  });
  onDestroy(() => {
    if (typeof window !== 'undefined') {
      window.removeEventListener('dragover', blockWindowDrop);
      window.removeEventListener('drop',     blockWindowDrop);
    }
  });

  async function loadInfo() {
    loading = true;
    loadError = '';
    info = null;
    try {
      const res = await fetch(`${API_BASE}/upload-links/${encodeURIComponent(token)}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        // 410 = expired or exhausted; 404 = unknown / malformed token.
        if (res.status === 410 && body.error === 'expired') {
          loadError = 'This link has expired. Please ask Holm Graphics for a fresh one.';
        } else if (res.status === 410 && body.error === 'exhausted') {
          loadError = 'This link has reached its upload limit. Please ask Holm Graphics for a fresh one.';
        } else {
          loadError = "We couldn't find this upload link. Double-check the URL, or reply to the email and we'll send a new one.";
        }
        return;
      }
      info = body;
    } catch (e) {
      loadError = `Network error loading the upload page: ${e.message || e}`;
    } finally {
      loading = false;
    }
  }

  async function uploadAll() {
    if (uploading || stagedFiles.length === 0) return;
    uploading = true;
    uploadResults = stagedFiles.map((f) => ({ name: f.name, size: f.size, status: 'pending' }));

    for (let i = 0; i < stagedFiles.length; i++) {
      const f = stagedFiles[i];
      try {
        const fd = new FormData();
        fd.append('file', f, f.name);
        const res = await fetch(`${API_BASE}/upload-links/${encodeURIComponent(token)}/upload`, {
          method: 'POST',
          body: fd,
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          uploadResults[i] = { ...uploadResults[i], status: 'error', error: body.error || `HTTP ${res.status}` };
        } else {
          uploadResults[i] = {
            ...uploadResults[i],
            status:   'done',
            filename: body.filename,
            uploads_remaining: body.uploads_remaining,
          };
          // Mirror the server's view of the budget on the page header.
          if (info && typeof body.uploads_remaining === 'number') {
            info = { ...info, uploads_remaining: body.uploads_remaining, uploads_used: body.uploads_used };
          }
        }
      } catch (e) {
        uploadResults[i] = { ...uploadResults[i], status: 'error', error: e.message || 'Upload failed' };
      }
      // Reactivity nudge for the array-of-objects pattern.
      uploadResults = uploadResults;
    }

    uploading = false;
    const anyOk = uploadResults.some((r) => r.status === 'done');
    if (anyOk) {
      allDone = uploadResults.every((r) => r.status === 'done');
      // Clear staged so customer can drop another batch if they like.
      stagedFiles = [];
    }
  }

  function startOver() {
    uploadResults = [];
    allDone = false;
    stagedFiles = [];
  }
</script>

<svelte:head>
  <title>Upload Artwork — Holm Graphics</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<div class="page">
  <header class="header">
    <span class="brand">HOLM <span class="brand-accent">GRAPHICS</span></span>
  </header>

  {#if loading}
    <p class="status">Loading…</p>
  {:else if loadError}
    <section class="card error-card">
      <h1>This upload link can't be used.</h1>
      <p>{loadError}</p>
      <p class="muted">Need a fresh link? Reply to the email or call <a href="tel:5195073001">519-507-3001</a>.</p>
    </section>
  {:else if info}
    <section class="card">
      <h1>Upload artwork for job #{info.job_number}</h1>
      <p class="muted">
        For <strong>{info.client_name || 'your job'}</strong>{#if info.project_name} — {info.project_name}{/if}.
        Drop your files below — we'll get a proof back to you once they're in.
      </p>
      <p class="meta">
        {info.uploads_remaining} of {info.uploads_remaining + info.uploads_used} upload{info.uploads_remaining + info.uploads_used === 1 ? '' : 's'} remaining ·
        link expires {new Date(info.expires_at).toLocaleDateString('en-CA', { month: 'long', day: 'numeric', year: 'numeric' })}
      </p>

      {#if allDone}
        <div class="success">
          <strong>✓ All files uploaded.</strong>
          <p class="muted">We've notified the team. They'll be in touch with a proof.</p>
          <button class="btn-ghost" on:click={startOver}>Upload another batch</button>
        </div>
      {:else}
        <UploadDropZone
          bind:files={stagedFiles}
          accept={ALLOWED_EXTS}
          maxBytes={50 * 1024 * 1024}
          hint="Drop your artwork here, or click to choose."
        />

        {#if uploadResults.length > 0}
          <ul class="results">
            {#each uploadResults as r}
              <li class:done={r.status === 'done'} class:err={r.status === 'error'} class:pending={r.status === 'pending'}>
                <span class="r-name">{r.name}</span>
                {#if r.status === 'pending'}<span class="r-tag">uploading…</span>{/if}
                {#if r.status === 'done'}<span class="r-tag ok">✓ uploaded</span>{/if}
                {#if r.status === 'error'}<span class="r-tag bad">{r.error}</span>{/if}
              </li>
            {/each}
          </ul>
        {/if}

        <div class="actions">
          <button
            class="btn primary"
            disabled={uploading || stagedFiles.length === 0 || info.uploads_remaining < stagedFiles.length}
            on:click={uploadAll}>
            {uploading ? 'Uploading…' : `Upload ${stagedFiles.length || ''} file${stagedFiles.length === 1 ? '' : 's'}`}
          </button>
          {#if info.uploads_remaining < stagedFiles.length}
            <small class="warn">
              You're trying to upload {stagedFiles.length} files but the link only has {info.uploads_remaining} slot{info.uploads_remaining === 1 ? '' : 's'} left.
            </small>
          {/if}
        </div>
      {/if}
    </section>
  {/if}

  <footer class="footer">
    <p>Holm Graphics Inc. · Walkerton, Ontario · <a href="tel:5195073001">519-507-3001</a></p>
  </footer>
</div>

<style>
  .page { max-width: 44rem; margin: 0 auto; padding: 2rem 1rem; font-family: system-ui, -apple-system, sans-serif; color: #1a1a1a; }

  .header { padding-bottom: 1rem; }
  .brand { font-family: Impact, 'Arial Black', sans-serif; font-size: 1.4rem; letter-spacing: 0.06em; color: #1a1a1a; }
  .brand-accent { color: #c01818; }

  .status { color: #64748b; }
  .card {
    background: #fff;
    border: 1px solid #e4e4e7;
    border-radius: 0.6rem;
    padding: 1.5rem;
    box-shadow: 0 1px 2px rgba(0,0,0,0.04);
  }
  h1 { margin: 0 0 0.5rem; font-size: 1.4rem; }
  .muted { color: #64748b; margin: 0 0 0.75rem; }
  .meta { color: #94a3b8; font-size: 0.85rem; margin: 0 0 1.25rem; }

  .error-card { border-color: #fecaca; background: #fef2f2; }
  .error-card h1 { color: #b91c1c; }

  .success { padding: 1rem 0; text-align: center; }
  .success strong { color: #2a7a2a; font-size: 1.1rem; display: block; margin-bottom: 0.5rem; }

  .results {
    list-style: none;
    margin: 1rem 0 0;
    padding: 0;
    border: 1px solid #e4e4e7;
    border-radius: 0.5rem;
    overflow: hidden;
  }
  .results li {
    display: flex; justify-content: space-between; gap: 0.75rem;
    padding: 0.55rem 0.85rem;
    border-bottom: 1px solid #f1f5f9;
    font-size: 0.9rem;
  }
  .results li:last-child { border-bottom: none; }
  .results .r-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .results .r-tag { font-size: 0.82rem; }
  .results .r-tag.ok  { color: #2a7a2a; }
  .results .r-tag.bad { color: #b91c1c; }
  .results li.pending { background: #fef3c7; }
  .results li.err     { background: #fef2f2; }

  .actions { margin-top: 1rem; display: flex; flex-wrap: wrap; gap: 0.75rem; align-items: center; }
  .btn {
    padding: 0.65rem 1.25rem;
    border: none; border-radius: 0.4rem;
    cursor: pointer;
    font-weight: 600;
    background: #c01818; color: #fff;
  }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn.primary { background: #c01818; }
  .btn-ghost {
    margin-top: 0.75rem;
    padding: 0.5rem 1rem;
    border: 1px solid #c01818;
    background: transparent;
    color: #c01818;
    border-radius: 0.4rem;
    cursor: pointer;
  }
  .warn { color: #b91c1c; font-size: 0.82rem; }

  .footer { margin-top: 2rem; text-align: center; color: #64748b; font-size: 0.85rem; }
  .footer a { color: inherit; }
</style>
