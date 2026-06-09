<!-- src/routes/admin/gallery-curate/+page.svelte -->
<!--
  Bulk gallery curation: one grid showing every photo in the system, with
  inline "Gallery" toggle + category dropdown on each card. Admin-only.
  Changes save immediately via PATCH /projects/:id/photos/:photoId.
-->
<script>
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { api } from '$lib/api/client.js';
  import { isAdmin } from '$lib/stores/auth.js';

  const CATEGORIES = [
    { value: 'signs_led',     label: 'Signs & LED' },
    { value: 'vehicle_wraps', label: 'Vehicle Wraps' },
    { value: 'apparel',       label: 'Apparel' },
    { value: 'printing',      label: 'Printing' },
    { value: 'other',         label: 'Other' }
  ];

  let photos = [];
  let loading = true;
  let error = '';
  let showOnly = 'all';       // 'all' | 'unpublished' | 'published'
  let filterCategory = 'all'; // 'all' | one of CATEGORIES values
  let lightbox = null;

  // Track in-flight saves per photo id so we can show a tiny indicator.
  let saving = {};

  // Live caption text per photo id while typing (before it's posted/saved).
  let captionDrafts = {};

  onMount(async () => {
    if (!$isAdmin) {
      goto('/dashboard');
      return;
    }
    await load();
  });

  async function load() {
    loading = true;
    error = '';
    try {
      photos = await api.getAllPhotos();
    } catch (e) {
      error = e.message || 'Failed to load photos';
    } finally {
      loading = false;
    }
  }

  $: visible = photos.filter((p) => {
    if (showOnly === 'unpublished' && p.show_in_gallery) return false;
    if (showOnly === 'published' && !p.show_in_gallery) return false;
    if (filterCategory !== 'all' && p.category !== filterCategory) return false;
    return true;
  });

  $: counts = {
    total: photos.length,
    published: photos.filter((p) => p.show_in_gallery).length,
    unpublished: photos.filter((p) => !p.show_in_gallery).length
  };

  async function toggleGallery(photo) {
    const next = !photo.show_in_gallery;
    saving[photo.id] = true;
    try {
      const updated = await api.updatePhoto(photo.project_id, photo.id, {
        show_in_gallery: next
      });
      photos = photos.map((p) =>
        p.id === photo.id ? { ...p, ...updated } : p
      );
    } catch (e) {
      alert(`Failed to update photo: ${e.message}`);
    } finally {
      delete saving[photo.id];
      saving = saving;
    }
  }

  async function changeCategory(photo, category) {
    if (category === photo.category) return;
    saving[photo.id] = true;
    try {
      const updated = await api.updatePhoto(photo.project_id, photo.id, {
        category
      });
      photos = photos.map((p) =>
        p.id === photo.id ? { ...p, ...updated } : p
      );
    } catch (e) {
      alert(`Failed to update category: ${e.message}`);
    } finally {
      delete saving[photo.id];
      saving = saving;
    }
  }

  // Toggle the "Post to Facebook" flag. Turning it ON now also fires
  // the actual post (uses the project description as caption if no
  // override was set yet). Staff was getting confused by the previous
  // two-step "flip toggle → click Post" sequence and leaving photos
  // stuck enabled-but-not-posted. The "Retry post" / "edit caption"
  // buttons still appear if the auto-post fails or the caption needs
  // tweaking after the fact.
  async function toggleFacebook(photo) {
    const next = !photo.fb_post_enabled;
    saving[photo.id] = true;
    try {
      const updated = await api.updatePhoto(photo.project_id, photo.id, {
        fb_post_enabled: next
      });
      photos = photos.map((p) =>
        p.id === photo.id ? { ...p, ...updated } : p
      );
      // Just turned it ON and we haven't posted yet → fire the post now.
      // Idempotent on the backend (fb_posted guard prevents duplicates),
      // and if FB rejects we surface the error inline like before.
      if (next && !updated.fb_posted) {
        await postToFacebook({ ...photo, ...updated });
      }
    } catch (e) {
      alert(`Failed to update Facebook setting: ${e.message}`);
    } finally {
      delete saving[photo.id];
      saving = saving;
    }
  }

  // Optional per-photo caption override. Blank → null (falls back to the
  // project description). Saved on blur; doesn't re-post an already-posted
  // photo (the backend fb_posted guard prevents duplicates).
  async function saveCaption(photo, value) {
    const next = value.trim();
    if (next === (photo.fb_caption || '')) return;
    saving[photo.id] = true;
    try {
      const updated = await api.updatePhoto(photo.project_id, photo.id, {
        fb_caption: next
      });
      photos = photos.map((p) =>
        p.id === photo.id ? { ...p, ...updated } : p
      );
    } catch (e) {
      alert(`Failed to save caption: ${e.message}`);
    } finally {
      delete saving[photo.id];
      saving = saving;
    }
  }

  // Persist the (optional) caption, then post to the Page. Used for both the
  // first post and a retry-after-error. The backend only posts when the photo
  // is in the gallery, FB-enabled, and not yet posted (dedupe guard), so this
  // is safe to click again on error.
  async function postToFacebook(photo) {
    saving[photo.id] = true;
    try {
      const caption = (captionDrafts[photo.id] ?? photo.fb_caption ?? '').trim();
      if (caption !== (photo.fb_caption || '')) {
        await api.updatePhoto(photo.project_id, photo.id, { fb_caption: caption });
      }
      const updated = await api.fbRetryPhoto(photo.project_id, photo.id);
      photos = photos.map((p) =>
        p.id === photo.id ? { ...p, ...updated } : p
      );
    } catch (e) {
      alert(`Failed to post to Facebook: ${e.message}`);
    } finally {
      delete saving[photo.id];
      saving = saving;
    }
  }

  // facebook.com/<pageId>_<postId> resolves to the visible post.
  function fbPostUrl(postId) {
    return `https://www.facebook.com/${postId}`;
  }

  function openLightbox(photo) { lightbox = photo; }
  function closeLightbox() { lightbox = null; }

  function handleKey(e) {
    if (e.key === 'Escape') closeLightbox();
  }
</script>

<svelte:head>
  <title>Gallery Curation — HOLM GRAPHICS Shop</title>
</svelte:head>

<svelte:window on:keydown={handleKey} />

<div class="page">
  <header class="page-head">
    <div>
      <h1>Gallery Curation</h1>
      <p class="sub">
        Flip <strong>Gallery</strong> on and pick a category to publish a photo
        to <a href="https://holmgraphics.ca/gallery.html" target="_blank" rel="noopener">
          holmgraphics.ca/gallery.html
        </a>. Changes save instantly.
      </p>
    </div>
    <div class="stats">
      <div class="stat">
        <span class="n">{counts.published}</span>
        <span class="l">Public</span>
      </div>
      <div class="stat">
        <span class="n">{counts.unpublished}</span>
        <span class="l">Hidden</span>
      </div>
      <div class="stat">
        <span class="n">{counts.total}</span>
        <span class="l">Total</span>
      </div>
    </div>
  </header>

  <div class="filters">
    <div class="filter-group">
      <span class="filter-label">Show</span>
      <button class:active={showOnly === 'all'}        on:click={() => (showOnly = 'all')}>All</button>
      <button class:active={showOnly === 'unpublished'} on:click={() => (showOnly = 'unpublished')}>Not public</button>
      <button class:active={showOnly === 'published'}  on:click={() => (showOnly = 'published')}>Public</button>
    </div>

    <div class="filter-group">
      <span class="filter-label">Category</span>
      <button class:active={filterCategory === 'all'} on:click={() => (filterCategory = 'all')}>All</button>
      {#each CATEGORIES as cat}
        <button
          class:active={filterCategory === cat.value}
          on:click={() => (filterCategory = cat.value)}
        >
          {cat.label}
        </button>
      {/each}
    </div>
  </div>

  {#if loading}
    <div class="state">Loading photos…</div>
  {:else if error}
    <div class="state state-error">
      {error}
      <button class="retry" on:click={load}>Retry</button>
    </div>
  {:else if visible.length === 0}
    <div class="state">
      No photos match the current filters.
    </div>
  {:else}
    <div class="grid">
      {#each visible as photo (photo.id)}
        <article class="card" class:published={photo.show_in_gallery}>
          <button
            type="button"
            class="thumb"
            on:click={() => openLightbox(photo)}
            aria-label="Enlarge"
          >
            <img src={photo.url} alt="" loading="lazy" />
            {#if photo.show_in_gallery}
              <span class="badge">Public</span>
            {/if}
          </button>

          <div class="meta">
            <div class="job">
              <span class="job-id">#{photo.project_id}</span>
              <span class="job-desc">{photo.project_description || 'Untitled job'}</span>
            </div>
            {#if photo.client_name}
              <div class="client">{photo.client_name}</div>
            {/if}
          </div>

          <div class="controls">
            <label class="toggle">
              <input
                type="checkbox"
                checked={photo.show_in_gallery}
                disabled={saving[photo.id]}
                on:change={() => toggleGallery(photo)}
              />
              <span>Gallery</span>
            </label>

            <select
              value={photo.category}
              disabled={saving[photo.id]}
              on:change={(e) => changeCategory(photo, e.target.value)}
            >
              {#each CATEGORIES as cat}
                <option value={cat.value}>{cat.label}</option>
              {/each}
            </select>
          </div>

          <!-- Facebook: only available once the photo is in the gallery.
               Can't FB-post something not on the website. -->
          <div class="fb" class:on={photo.fb_post_enabled}>
            <label class="toggle fb-toggle" class:disabled={!photo.show_in_gallery}>
              <input
                type="checkbox"
                checked={photo.fb_post_enabled}
                disabled={!photo.show_in_gallery || saving[photo.id]}
                on:change={() => toggleFacebook(photo)}
              />
              <span>Facebook</span>
            </label>

            {#if photo.fb_post_enabled}
              {#if photo.fb_posted}
                <div class="fb-status">
                  <a
                    class="fb-ok"
                    href={fbPostUrl(photo.fb_post_id)}
                    target="_blank"
                    rel="noopener"
                  >✓ Posted to Facebook</a>
                </div>
              {:else}
                <input
                  class="fb-caption"
                  type="text"
                  value={photo.fb_caption || ''}
                  placeholder={photo.project_description || 'Caption (optional)'}
                  disabled={saving[photo.id]}
                  on:input={(e) => (captionDrafts[photo.id] = e.target.value)}
                  on:blur={(e) => saveCaption(photo, e.target.value)}
                />
                {#if photo.fb_post_error}
                  <span class="fb-err" title={photo.fb_post_error}>
                    ⚠ {photo.fb_post_error}
                  </span>
                {/if}
                <button
                  class="fb-post"
                  disabled={saving[photo.id]}
                  on:click={() => postToFacebook(photo)}
                >{photo.fb_post_error ? 'Retry post' : 'Post to Facebook'}</button>
              {/if}
            {/if}
          </div>
        </article>
      {/each}
    </div>
  {/if}
</div>

{#if lightbox}
  <div class="lightbox" on:click={closeLightbox} role="presentation">
    <button class="lightbox-close" on:click|stopPropagation={closeLightbox} aria-label="Close">×</button>
    <img src={lightbox.url} alt="" on:click|stopPropagation={() => {}} />
    <div class="lightbox-caption" on:click|stopPropagation={() => {}} role="presentation">
      #{lightbox.project_id} — {lightbox.project_description || 'Untitled job'}
      {#if lightbox.client_name}<span> · {lightbox.client_name}</span>{/if}
    </div>
  </div>
{/if}

<style>
  .page {
    padding: 24px 32px 80px;
    max-width: 1400px;
    margin: 0 auto;
    color: var(--text);
  }

  .page-head {
    display: flex; align-items: flex-start; justify-content: space-between; gap: 24px;
    margin-bottom: 20px;
  }
  .page-head h1 {
    font-family: var(--font-display); font-weight: 900;
    font-size: 1.8rem; letter-spacing: 0.04em;
    text-transform: uppercase; margin: 0 0 6px;
  }
  .sub { color: var(--text-muted); font-size: 0.92rem; max-width: 560px; }
  .sub a { color: var(--red); text-decoration: none; }
  .sub a:hover { text-decoration: underline; }

  .stats { display: flex; gap: 16px; }
  .stat {
    background: var(--surface); border: 1px solid var(--border);
    border-radius: var(--radius); padding: 10px 16px; min-width: 80px;
    text-align: center;
  }
  .stat .n {
    display: block; font-family: var(--font-display); font-weight: 900;
    font-size: 1.4rem; color: var(--text);
  }
  .stat .l {
    display: block; font-size: 0.68rem; color: var(--text-dim);
    text-transform: uppercase; letter-spacing: 0.12em; margin-top: 2px;
  }

  .filters {
    display: flex; flex-direction: column; gap: 10px;
    margin-bottom: 20px;
  }
  .filter-group { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .filter-label {
    font-family: var(--font-display); font-weight: 700; font-size: 0.72rem;
    color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.12em;
    min-width: 70px;
  }
  .filter-group button {
    background: var(--surface); color: var(--text-muted);
    border: 1px solid var(--border); border-radius: var(--radius);
    padding: 6px 14px; font-family: var(--font-display); font-weight: 600;
    font-size: 0.8rem; letter-spacing: 0.04em; cursor: pointer;
    transition: all 0.15s;
  }
  .filter-group button:hover { color: var(--text); border-color: var(--text-muted); }
  .filter-group button.active {
    background: var(--red); color: #fff; border-color: var(--red);
  }

  .state {
    padding: 60px 20px; text-align: center; color: var(--text-muted);
    background: var(--surface); border: 1px solid var(--border);
    border-radius: var(--radius);
  }
  .state-error { color: #ff8a80; }
  .retry {
    display: inline-block; margin-left: 12px;
    background: var(--red); color: #fff; border: none;
    border-radius: var(--radius); padding: 6px 14px; cursor: pointer;
    font-family: var(--font-display); font-weight: 600; letter-spacing: 0.04em;
  }

  .grid {
    display: grid; gap: 16px;
    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  }

  .card {
    display: flex; flex-direction: column;
    background: var(--surface); border: 1px solid var(--border);
    border-radius: var(--radius); overflow: hidden; transition: border-color 0.15s;
  }
  .card:hover { border-color: var(--text-muted); }
  .card.published { border-color: var(--red); }

  .thumb {
    position: relative; display: block; width: 100%; aspect-ratio: 4 / 3;
    background: #111; border: none; padding: 0; cursor: zoom-in;
    overflow: hidden;
  }
  .thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .badge {
    position: absolute; top: 8px; left: 8px;
    background: var(--red); color: #fff;
    font-family: var(--font-display); font-weight: 700; font-size: 0.68rem;
    text-transform: uppercase; letter-spacing: 0.1em;
    padding: 3px 8px; border-radius: var(--radius);
  }

  .meta { padding: 10px 12px 6px; min-height: 54px; }
  .job { display: flex; gap: 6px; align-items: baseline; }
  .job-id {
    font-family: var(--font-display); font-weight: 900; color: var(--red);
    font-size: 0.78rem; flex-shrink: 0;
  }
  .job-desc {
    font-size: 0.88rem; color: var(--text);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .client { color: var(--text-dim); font-size: 0.78rem; margin-top: 2px; }

  .controls {
    display: flex; align-items: center; justify-content: space-between; gap: 8px;
    padding: 8px 12px 12px;
  }
  .toggle {
    display: flex; align-items: center; gap: 6px; cursor: pointer;
    font-family: var(--font-display); font-weight: 700; font-size: 0.78rem;
    text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-muted);
    user-select: none;
  }
  .toggle input { width: 16px; height: 16px; accent-color: var(--red); cursor: pointer; }
  .controls select {
    background: var(--surface-2); color: var(--text);
    border: 1px solid var(--border); border-radius: var(--radius);
    padding: 4px 6px; font-size: 0.8rem; cursor: pointer; max-width: 140px;
  }

  .fb {
    display: flex; flex-direction: column; gap: 6px;
    padding: 0 12px 12px;
  }
  .fb.on {
    border-top: 1px solid var(--border); padding-top: 10px; margin-top: 2px;
  }
  .fb-toggle.disabled { opacity: 0.45; cursor: not-allowed; }
  .fb-toggle input:disabled { cursor: not-allowed; }
  .fb-caption {
    background: var(--surface-2); color: var(--text);
    border: 1px solid var(--border); border-radius: var(--radius);
    padding: 4px 8px; font-size: 0.8rem; width: 100%;
  }
  .fb-caption::placeholder { color: var(--text-dim); }
  .fb-status {
    display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
    font-size: 0.76rem;
  }
  .fb-ok { color: #57c98a; text-decoration: none; }
  .fb-ok:hover { text-decoration: underline; }
  .fb-err {
    color: #ff8a80; overflow: hidden; text-overflow: ellipsis;
    white-space: nowrap; max-width: 160px;
  }
  .fb-post {
    background: var(--red); color: #fff; border: none;
    border-radius: var(--radius); padding: 5px 10px; cursor: pointer;
    font-family: var(--font-display); font-weight: 700; font-size: 0.74rem;
    letter-spacing: 0.04em; text-transform: uppercase; align-self: flex-start;
  }
  .fb-post:disabled { opacity: 0.6; cursor: default; }

  .lightbox {
    position: fixed; inset: 0; background: rgba(0,0,0,0.9);
    display: flex; align-items: center; justify-content: center;
    z-index: 1000; padding: 40px;
  }
  .lightbox img {
    max-width: 90vw; max-height: 80vh; object-fit: contain;
    box-shadow: 0 6px 40px rgba(0,0,0,0.6); border-radius: 6px;
  }
  .lightbox-close {
    position: absolute; top: 18px; right: 22px;
    background: transparent; border: none; color: #fff;
    font-size: 2.4rem; line-height: 1; cursor: pointer;
  }
  .lightbox-caption {
    position: absolute; bottom: 20px; left: 0; right: 0;
    text-align: center; color: #ddd; font-size: 0.9rem;
  }

  @media (max-width: 768px) {
    .page { padding: 16px 14px 80px; }
    .page-head { flex-direction: column; gap: 12px; }
    .stats { align-self: stretch; }
    .stat { flex: 1; }
    .grid { grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 10px; }
    .meta { padding: 8px 10px 4px; }
    .controls { padding: 6px 10px 10px; }
    .controls select { max-width: 110px; }
  }
</style>
