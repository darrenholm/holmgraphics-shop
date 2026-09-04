<script>
  // Self-serve "My sign" — a sign owner manages the ordered slide list that
  // plays on their screen and publishes it, with none of the admin tooling.
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { advertiseApi } from '$lib/advertise/api.js';

  $: id = $page.params.id;

  let deviceName = '';
  let slides = [];          // [{ mediaId, name, mimeType, url, thumbnailUrl, durationMs }]
  let savedKey = '';        // snapshot of the last-published order, to detect changes
  let loading = true;
  let err = null;
  let uploading = false;
  let publishing = false;
  let published = false;
  let publishWarning = null;

  const keyOf = (list) => list.map((s) => s.mediaId).join('|');
  $: dirty = keyOf(slides) !== savedKey;

  onMount(load);

  async function load() {
    loading = true;
    err = null;
    try {
      const data = await advertiseApi.getSlides(id);
      deviceName = data.deviceName;
      slides = data.slides;
      savedKey = keyOf(slides);
    } catch (e) {
      err = /token|unauth|401|403/i.test(e.message) ? 'AUTH' : e.message;
    } finally {
      loading = false;
    }
  }

  function move(i, dir) {
    const j = i + dir;
    if (j < 0 || j >= slides.length) return;
    const next = slides.slice();
    [next[i], next[j]] = [next[j], next[i]];
    slides = next;
    published = false;
  }

  function remove(i) {
    slides = slides.filter((_, idx) => idx !== i);
    published = false;
  }

  async function onUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    uploading = true;
    err = null;
    try {
      const m = await advertiseApi.uploadSlide(id, file);
      slides = [...slides, { ...m, durationMs: 7000, thumbnailUrl: null }];
      published = false;
    } catch (ex) {
      err = ex.message;
    } finally {
      uploading = false;
      e.target.value = '';
    }
  }

  async function publish() {
    publishing = true;
    err = null;
    publishWarning = null;
    try {
      const res = await advertiseApi.saveSlides(
        id,
        slides.map((s) => ({ mediaId: s.mediaId, durationMs: s.durationMs })),
      );
      savedKey = keyOf(slides);
      published = true;
      // The order saved even if the sign was briefly unreachable — surface that.
      if (res.publishError) publishWarning = res.publishError;
    } catch (e) {
      err = e.message;
    } finally {
      publishing = false;
    }
  }

  const isVideo = (s) => (s.mimeType || '').startsWith('video/');
</script>

<svelte:head>
  <title>{deviceName || 'My sign'} — Holm Graphics</title>
</svelte:head>

<div class="wrap">
  {#if loading}
    <div class="muted">Loading…</div>
  {:else if err === 'AUTH'}
    <div class="signin">
      <p>Sign in to manage your sign.</p>
      <a class="signin-btn" href="/shop/login?redirect={encodeURIComponent($page.url.pathname)}">Sign in</a>
    </div>
  {:else if err && !slides.length}
    <div class="error">{err}</div>
  {:else}
    <div class="head">
      <div>
        <div class="title-row">
          <h1>{deviceName}</h1>
          <span class="live"><span class="dot"></span>Live</span>
        </div>
        <div class="sub">Slides play in this order, on a loop.</div>
      </div>
    </div>

    <div class="list">
      {#each slides as s, i (s.mediaId)}
        <div class="slide">
          <div class="thumb">
            {#if isVideo(s)}
              <span class="vid"><span class="play">▶</span><span class="tag">video</span></span>
            {:else}
              <img src={s.thumbnailUrl || s.url} alt="" />
            {/if}
          </div>
          <div class="meta">
            <div class="name">{s.name}</div>
            <div class="kind">{isVideo(s) ? 'Video' : 'Photo'} · {Math.round((s.durationMs || 7000) / 1000)} sec</div>
          </div>
          <div class="ctrls">
            <button aria-label="Move up" disabled={i === 0} on:click={() => move(i, -1)}>↑</button>
            <button aria-label="Move down" disabled={i === slides.length - 1} on:click={() => move(i, 1)}>↓</button>
            <button aria-label="Remove" class="del" on:click={() => remove(i)}>✕</button>
          </div>
        </div>
      {/each}
      {#if slides.length === 0}
        <div class="empty">No slides yet — add your first one below.</div>
      {/if}
    </div>

    <label class="add">
      <input type="file" accept="image/*,video/*" hidden on:change={onUpload} disabled={uploading} />
      <span>{uploading ? 'Uploading…' : '+ Upload photo or video'}</span>
    </label>

    {#if err}<div class="error">{err}</div>{/if}

    <div class="footer">
      <div class="status">
        {#if dirty}
          <span class="warn">● {slides.length ? '' : ''}Changes not yet on the sign</span>
        {:else if published}
          <span class="ok">✓ Live on {deviceName}</span>
        {:else}
          <span class="muted">Up to date</span>
        {/if}
        {#if publishWarning}
          <div class="pubwarn">Saved, but the sign didn't confirm yet — it'll pick this up shortly.</div>
        {/if}
      </div>
      <button class="publish" disabled={!dirty || publishing} on:click={publish}>
        {publishing ? 'Publishing…' : 'Publish to sign'}
      </button>
    </div>
  {/if}
</div>

<style>
  .wrap { max-width: 720px; margin: 0 auto; padding: 28px 20px 80px; }
  .muted { color: var(--text-muted); }
  .error {
    background: rgba(192,57,43,0.1);
    border: 1px solid var(--red);
    color: var(--red);
    padding: 12px; border-radius: 6px; margin: 12px 0;
  }
  .signin { text-align: center; padding: 48px 20px; color: var(--text-muted); }
  .signin-btn {
    display: inline-block; margin-top: 12px; background: var(--red); color: #fff;
    padding: 10px 22px; border-radius: 8px; text-decoration: none;
    font-family: var(--font-display); font-weight: 700; text-transform: uppercase; letter-spacing: 0.03em;
  }
  .head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px; }
  .title-row { display: flex; align-items: center; gap: 10px; }
  h1 { font-family: var(--font-display); font-size: 1.7rem; margin: 0; color: var(--text); }
  .live {
    display: inline-flex; align-items: center; gap: 5px;
    font-size: 0.75rem; color: #1d9e75; background: rgba(29,158,117,0.12);
    padding: 3px 9px; border-radius: 20px;
  }
  .dot { width: 7px; height: 7px; border-radius: 50%; background: #1d9e75; display: inline-block; }
  .sub { color: var(--text-muted); margin-top: 6px; font-size: 0.9rem; }

  .list { border: 1px solid var(--border); border-radius: 12px; overflow: hidden; background: var(--surface); }
  .slide { display: flex; align-items: center; gap: 12px; padding: 10px 12px; border-bottom: 1px solid var(--border); }
  .slide:last-child { border-bottom: 0; }
  .thumb { width: 72px; height: 40px; border-radius: 6px; overflow: hidden; background: var(--surface-2); flex-shrink: 0; }
  .thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .vid { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; position: relative; background: rgba(192,57,43,0.1); color: var(--red); }
  .play { font-size: 14px; }
  .tag { position: absolute; bottom: 2px; right: 3px; font-size: 9px; background: rgba(255,255,255,0.75); padding: 0 3px; border-radius: 3px; }
  .meta { flex: 1; min-width: 0; }
  .name { font-size: 0.95rem; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .kind { font-size: 0.8rem; color: var(--text-muted); margin-top: 2px; }
  .ctrls { display: flex; gap: 4px; }
  .ctrls button {
    width: 32px; height: 32px; border: 1px solid var(--border); background: var(--surface);
    border-radius: 6px; cursor: pointer; color: var(--text); font-size: 0.9rem;
  }
  .ctrls button:disabled { opacity: 0.35; cursor: not-allowed; }
  .ctrls .del { color: var(--red); }
  .empty { padding: 28px; text-align: center; color: var(--text-muted); }

  .add {
    display: block; text-align: center; margin-top: 12px; padding: 14px;
    border: 1px dashed var(--border); border-radius: 10px; cursor: pointer;
    color: var(--text); font-family: var(--font-display); font-weight: 600;
  }
  .add:hover { border-color: var(--red); }

  .footer {
    display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap;
    margin-top: 20px; padding-top: 16px; border-top: 1px solid var(--border);
  }
  .status { font-size: 0.9rem; }
  .warn { color: #b8860b; }
  .ok { color: #1d9e75; }
  .pubwarn { color: var(--text-muted); font-size: 0.82rem; margin-top: 4px; }
  .publish {
    background: var(--red); color: #fff; border: 0; border-radius: 8px;
    padding: 12px 24px; font-family: var(--font-display); font-weight: 700;
    font-size: 1rem; cursor: pointer; text-transform: uppercase; letter-spacing: 0.03em;
  }
  .publish:disabled { opacity: 0.45; cursor: not-allowed; }
  .publish:hover:not(:disabled) { background: var(--red-dark); }
</style>
