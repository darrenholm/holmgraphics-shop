<!--
  /advertise/my-ads/[id] — detail page for a single rental.

  Mirrors the booking-time order page but leads with the artwork swap (the
  primary thing a logged-in advertiser comes here to do) instead of the
  payment + status block.

  After a successful swap, the response.mode tells us what happened on the
  LED side:
    - 'instant-republish'    : trusted client; ad republishes to VNNOX now
    - 'pending-review-again' : untrusted client; admin will review the swap
    - 'pre-approval'         : rental was still in the booking pipeline
-->
<script>
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { isLoggedIn, auth } from '$lib/stores/auth.js';
  import { advertiseApi, fmtMoney } from '$lib/advertise/api.js';

  let order = null;
  let err = null;
  let loading = true;
  let uploading = false;
  let textBusy = false;
  let lastSwapMode = null;   // 'instant-republish' | 'pending-review-again' | null

  // Mode toggle for the swap form — file upload OR live text editor.
  let artworkMode = 'upload';

  // Text editor state (defaults are bright + readable for outdoor signs).
  let adText = '';
  let adTextColor = '#FFFFFF';
  let adBgColor   = '#C0392B';
  let adFont      = 'sans-bold';
  const TEXT_PRESETS = [
    { label: 'White on red',    text: '#FFFFFF', bg: '#C0392B' },
    { label: 'Black on yellow', text: '#111111', bg: '#F1C40F' },
    { label: 'White on blue',   text: '#FFFFFF', bg: '#1F3A93' },
    { label: 'Yellow on black', text: '#F1C40F', bg: '#111111' },
    { label: 'White on green',  text: '#FFFFFF', bg: '#16A085' },
  ];
  function applyTextPreset(p) { adTextColor = p.text; adBgColor = p.bg; }

  $: id = $page.params.id;

  /** "14:30" → "2:30 PM" */
  function fmt12(t) {
    if (!t) return '';
    const [h, m] = t.split(':');
    const hh = Number(h);
    const ampm = hh < 12 ? 'AM' : 'PM';
    const h12 = hh % 12 === 0 ? 12 : hh % 12;
    return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
  }
  function isAllDay(s, e) {
    if (!s || !e) return false;
    return s.slice(0, 5) === '00:00' && (e.slice(0, 5) === '23:59' || e.slice(0, 5) === '23:58');
  }

  onMount(async () => {
    if (!$isLoggedIn) {
      goto(`/login?next=${encodeURIComponent(`/advertise/my-ads/${id}`)}`);
      return;
    }
    await refresh();
  });

  async function refresh() {
    err = null;
    loading = true;
    try {
      order = await advertiseApi.getRental(id);
    } catch (e) {
      if (/401|missing bearer/i.test(e.message || '')) {
        auth.logout();
        goto(`/login?next=${encodeURIComponent(`/advertise/my-ads/${id}`)}`);
        return;
      }
      err = e.message;
    } finally {
      loading = false;
    }
  }

  async function onUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    uploading = true;
    err = null;
    lastSwapMode = null;
    try {
      const res = await advertiseApi.uploadArtwork(id, file);
      lastSwapMode = res.mode || null;
      await refresh();
    } catch (ex) {
      err = ex.message;
    } finally {
      uploading = false;
      e.target.value = '';
    }
  }

  async function onSubmitTextAd() {
    if (!adText.trim()) {
      err = 'Type some text for your ad.';
      return;
    }
    textBusy = true;
    err = null;
    lastSwapMode = null;
    try {
      const res = await advertiseApi.createTextArtwork(id, {
        text: adText.trim(),
        textColor: adTextColor,
        bgColor: adBgColor,
        fontFamily: adFont,
      });
      lastSwapMode = res.mode || null;
      await refresh();
    } catch (e) {
      err = e.message;
    } finally {
      textBusy = false;
    }
  }

  async function changeFit(mode) {
    if (!order || order.fit_mode === mode) return;
    const prev = order.fit_mode;
    order = { ...order, fit_mode: mode };
    try {
      await advertiseApi.setFitMode(id, mode);
    } catch (e) {
      err = e.message;
      order = { ...order, fit_mode: prev };
    }
  }

  // What the customer can actually do depends on the rental state. The
  // server enforces this too — we mirror it client-side so disabled
  // controls never look enabled.
  $: canSwap = order && ['approved', 'active', 'pending_payment', 'pending_review'].includes(order.status);
  $: isLive  = order?.status === 'active';
</script>

<svelte:head>
  <title>{order?.device_name ?? 'My ad'} — Holm Graphics</title>
</svelte:head>

<div class="header">
  <div class="header-inner">
    <a href="/advertise/my-ads/" class="back">← All my ads</a>
    {#if order}
      <h1>
        {order.device_name}
        {#if isLive}<span class="live-pill">LIVE NOW</span>{/if}
      </h1>
      <div class="loc">
        {#if order.start_date && order.end_date}
          {order.start_date} → {order.end_date}
        {:else}
          Scheduled when Holm Graphics approves
        {/if}
        {#if order.start_time && order.end_time}
          {#if !isAllDay(order.start_time, order.end_time)}
            · daily {fmt12(order.start_time)}–{fmt12(order.end_time)}
          {/if}
        {/if}
      </div>
    {/if}
  </div>
</div>

<div class="container">
  {#if loading}
    <div class="muted">Loading…</div>
  {:else if err && !order}
    <div class="error">{err}</div>
  {:else if order}
    {#if lastSwapMode === 'instant-republish'}
      <div class="banner banner-good">
        ✓ Your new ad is live now. It may take up to a minute to appear on the screen.
      </div>
    {:else if lastSwapMode === 'pending-review-again'}
      <div class="banner banner-info">
        ✓ Got it. Your new ad is in our review queue — we'll email you when it's approved.
      </div>
    {/if}

    {#if order.publish_error}
      <div class="banner banner-warn">
        <strong>Last publish failed:</strong> {order.publish_error}
      </div>
    {/if}

    <!-- Current ad on the screen -->
    {#if order.storage_url}
      {@const aspect = (order.device_width_px && order.device_height_px)
        ? `${order.device_width_px} / ${order.device_height_px}`
        : '16 / 9'}
      <div class="card">
        <h3>{isLive ? 'On the screen right now' : 'Current ad'}</h3>
        <div class="screen-frame" style="aspect-ratio: {aspect};">
          {#if order.media_mime?.startsWith('video/')}
            <video src={order.storage_url} class="screen-art" style="object-fit: {order.fit_mode || 'contain'}" muted loop autoplay playsinline></video>
          {:else}
            <img src={order.storage_url} class="screen-art" style="object-fit: {order.fit_mode || 'contain'}" alt="Current ad" />
          {/if}
        </div>

        {#if canSwap}
          <div class="fit-toggle">
            <span class="fit-label">Fit on screen:</span>
            <label class="fit-opt">
              <input type="radio" name="fit" value="contain" checked={order.fit_mode !== 'cover'} on:change={() => changeFit('contain')} />
              Fit as-is
            </label>
            <label class="fit-opt">
              <input type="radio" name="fit" value="cover" checked={order.fit_mode === 'cover'} on:change={() => changeFit('cover')} />
              Stretch to fill
            </label>
          </div>
        {/if}
      </div>
    {/if}

    <!-- Swap-art editor -->
    {#if canSwap}
      {@const previewAspect = (order.device_width_px && order.device_height_px)
        ? `${order.device_width_px} / ${order.device_height_px}`
        : '16 / 9'}
      <div class="card">
        <h3>{order.storage_url ? 'Change my ad' : 'Add my ad'}</h3>
        <p class="muted small">
          {#if isLive}
            Updates go live on the screen as soon as you submit. Allow up to a minute for the new ad to appear.
          {:else}
            Upload a file or design a text ad below. We'll email you once it's been reviewed.
          {/if}
        </p>

        <div class="art-mode-tabs">
          <button type="button" class="art-mode-tab" class:active={artworkMode === 'upload'} on:click={() => (artworkMode = 'upload')}>Upload a file</button>
          <button type="button" class="art-mode-tab" class:active={artworkMode === 'text'} on:click={() => (artworkMode = 'text')}>Create a text ad</button>
        </div>

        {#if artworkMode === 'upload'}
          <p class="muted small">JPG, PNG, or MP4. Sized to match the display gives the best look.</p>
          <label class="cta-label">
            <input type="file" accept="image/*,video/*" on:change={onUpload} hidden disabled={uploading} />
            <span class="cta">{uploading ? 'Uploading…' : '+ Upload artwork'}</span>
          </label>
        {:else}
          <div class="text-editor">
            <div class="text-preview-frame" style="aspect-ratio: {previewAspect}; background: {adBgColor};">
              <span class="text-preview" style="color: {adTextColor}; font-family: {adFont === 'serif' ? 'Georgia, serif' : 'Helvetica, Arial, sans-serif'}; font-weight: {adFont === 'sans-bold' ? 700 : 400};">
                {adText || 'Your headline here'}
              </span>
            </div>

            <label class="te-row">
              <span class="te-label">Headline</span>
              <input type="text" maxlength="120" bind:value={adText} placeholder="e.g. NOW HIRING — APPLY TODAY" />
            </label>

            <div class="te-row te-three">
              <label>
                <span class="te-label">Text color</span>
                <input type="color" bind:value={adTextColor} />
              </label>
              <label>
                <span class="te-label">Background</span>
                <input type="color" bind:value={adBgColor} />
              </label>
              <label>
                <span class="te-label">Font</span>
                <select bind:value={adFont}>
                  <option value="sans-bold">Sans (bold)</option>
                  <option value="sans">Sans</option>
                  <option value="serif">Serif</option>
                </select>
              </label>
            </div>

            <div class="te-presets">
              <span class="te-label">Quick colours:</span>
              {#each TEXT_PRESETS as p (p.label)}
                <button
                  type="button"
                  class="te-preset"
                  class:active={adTextColor === p.text && adBgColor === p.bg}
                  on:click={() => applyTextPreset(p)}
                  style="background: {p.bg}; color: {p.text};"
                >{p.label}</button>
              {/each}
            </div>

            <button class="cta" type="button" disabled={textBusy || !adText.trim()} on:click={onSubmitTextAd}>
              {textBusy ? 'Rendering…' : 'Use this text ad'}
            </button>
          </div>
        {/if}

        {#if err}<div class="error">{err}</div>{/if}
      </div>
    {/if}

    <!-- Booking metadata -->
    <div class="card meta">
      <div>
        <div class="meta-label">Status</div>
        <div class="meta-val">{order.status.replace(/_/g, ' ')}</div>
      </div>
      <div>
        <div class="meta-label">Total paid</div>
        <div class="meta-val">{fmtMoney(order.amount_cents, order.currency)}</div>
      </div>
      {#if order.paid_at}
        <div>
          <div class="meta-label">Paid</div>
          <div class="meta-val">{new Date(order.paid_at).toLocaleDateString()}</div>
        </div>
      {/if}
      {#if order.published_at}
        <div>
          <div class="meta-label">Live since</div>
          <div class="meta-val">{new Date(order.published_at).toLocaleDateString()}</div>
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .header {
    background: var(--surface-2);
    border-bottom: 1px solid var(--border);
    padding: 24px 20px;
  }
  .header-inner { max-width: 800px; margin: 0 auto; }
  .back {
    color: var(--red);
    text-decoration: none;
    font-family: var(--font-display);
    font-weight: 600;
    font-size: 0.9rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  h1 {
    font-family: var(--font-display);
    margin: 8px 0 0;
    font-size: 1.8rem;
    color: var(--text);
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
  }
  .live-pill {
    background: #16a34a;
    color: #fff;
    padding: 3px 10px;
    border-radius: 4px;
    font-size: 0.7rem;
    letter-spacing: 0.06em;
  }
  .loc { color: var(--text-muted); margin-top: 4px; }

  .container { max-width: 800px; margin: 0 auto; padding: 28px 20px 80px; }
  .muted { color: var(--text-muted); }
  .small { font-size: 0.88rem; }

  .banner {
    padding: 12px 16px;
    border-radius: 6px;
    margin-bottom: 14px;
    font-size: 0.95rem;
  }
  .banner-good { background: rgba(63,191,111,0.12); color: #16a34a; border: 1px solid #16a34a; }
  .banner-info { background: rgba(31,58,147,0.10); color: var(--text); border: 1px solid #1F3A93; }
  .banner-warn { background: rgba(230,181,74,0.15); color: #b45309; border: 1px solid #d97706; }

  .error {
    background: rgba(192,57,43,0.1);
    border: 1px solid var(--red);
    color: var(--red);
    padding: 12px;
    border-radius: 6px;
    margin: 12px 0;
  }

  .card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 20px;
    margin-bottom: 16px;
  }
  .card h3 {
    margin: 0 0 12px;
    font-family: var(--font-display);
    font-size: 1.2rem;
  }

  .screen-frame {
    width: 100%;
    background: #000;
    border: 3px solid #222;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.25);
    overflow: hidden;
    display: block;
  }
  .screen-art { display: block; width: 100%; height: 100%; }

  .fit-toggle {
    display: flex; align-items: center; gap: 16px; flex-wrap: wrap;
    margin: 14px 0 0;
    padding: 10px 12px;
    background: var(--surface-2);
    border-radius: 6px;
    font-size: 0.92rem;
  }
  .fit-label {
    font-family: var(--font-display); font-weight: 600;
    text-transform: uppercase; font-size: 0.78rem; letter-spacing: 0.06em;
    color: var(--text-muted);
  }
  .fit-opt { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; }

  .art-mode-tabs {
    display: flex; gap: 4px; margin: 0 0 16px;
    border-bottom: 1px solid var(--border);
  }
  .art-mode-tab {
    background: transparent; border: 0;
    border-bottom: 3px solid transparent;
    padding: 8px 16px;
    font-family: var(--font-display); font-weight: 600; color: var(--text-muted);
    cursor: pointer; font-size: 0.95rem;
    text-transform: uppercase; letter-spacing: 0.04em;
  }
  .art-mode-tab.active { color: var(--red); border-bottom-color: var(--red); }

  .cta-label { display: inline-block; cursor: pointer; }
  .cta {
    display: inline-block;
    background: var(--red);
    color: white;
    border: 0;
    border-radius: 6px;
    padding: 12px 20px;
    font-family: var(--font-display);
    font-weight: 700;
    font-size: 0.95rem;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    cursor: pointer;
    width: 100%;
    text-align: center;
  }
  button.cta { width: 100%; }
  .cta:hover:not(:disabled) { background: var(--red-dark); }
  .cta:disabled { opacity: 0.5; cursor: not-allowed; }

  .text-editor { display: flex; flex-direction: column; gap: 12px; }
  .text-preview-frame {
    width: 100%;
    border: 3px solid #222; border-radius: 8px;
    overflow: hidden;
    display: flex; align-items: center; justify-content: center;
    padding: 4%;
    text-align: center;
    box-shadow: 0 4px 12px rgba(0,0,0,0.25);
  }
  .text-preview {
    font-size: clamp(1.4rem, 6vw, 4rem);
    line-height: 1.1;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    max-width: 100%;
  }
  .te-row { display: flex; flex-direction: column; gap: 4px; margin: 0; }
  .te-three { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; }
  .te-label {
    font-family: var(--font-display); font-weight: 600;
    color: var(--text-muted); font-size: 0.78rem;
    text-transform: uppercase; letter-spacing: 0.06em;
  }
  .te-row input[type="text"], .te-row select {
    font-family: var(--font-body);
    background: var(--surface); color: var(--text);
    border: 1px solid var(--border); border-radius: 4px;
    padding: 10px 12px; font-size: 0.95rem;
    text-transform: none; letter-spacing: 0;
  }
  .te-row input[type="color"] {
    width: 100%; height: 40px;
    border: 1px solid var(--border); border-radius: 4px;
    background: var(--surface); cursor: pointer; padding: 2px;
  }
  .te-presets { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-top: 4px; }
  .te-preset {
    border: 2px solid transparent; border-radius: 4px;
    padding: 6px 12px;
    font-family: var(--font-display); font-weight: 600;
    font-size: 0.82rem; cursor: pointer;
  }
  .te-preset.active { border-color: var(--text); }

  .meta {
    display: flex; flex-wrap: wrap; gap: 24px;
  }
  .meta-label {
    font-family: var(--font-display); color: var(--text-muted);
    text-transform: uppercase; letter-spacing: 0.06em; font-size: 0.78rem;
  }
  .meta-val {
    font-family: var(--font-display); font-weight: 600;
    font-size: 1rem; margin-top: 2px;
  }
</style>
