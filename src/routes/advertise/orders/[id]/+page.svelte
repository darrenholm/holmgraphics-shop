<script>
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { advertiseApi, fmtMoney, tokenizeCard } from '$lib/advertise/api.js';

  let order = null;
  let err = null;
  let uploading = false;
  let paying = false;
  let textBusy = false;

  // Artwork-creation method picker. "upload" or "text".
  let artworkMode = 'upload';

  // Text-ad editor state (defaults are friendly and high-contrast).
  let adText = '';
  let adTextColor = '#FFFFFF';
  let adBgColor   = '#C0392B';
  let adFont      = 'sans-bold';

  const TEXT_PRESETS = [
    { label: 'White on red',   text: '#FFFFFF', bg: '#C0392B' },
    { label: 'Black on yellow', text: '#111111', bg: '#F1C40F' },
    { label: 'White on blue',  text: '#FFFFFF', bg: '#1F3A93' },
    { label: 'Yellow on black', text: '#F1C40F', bg: '#111111' },
    { label: 'White on green', text: '#FFFFFF', bg: '#16A085' },
  ];
  function applyTextPreset(p) {
    adTextColor = p.text;
    adBgColor = p.bg;
  }

  // Card form
  let cardNumber = '';
  let cardExp = '';
  let cardCvc = '';
  let cardZip = '';
  let cardName = '';

  $: id = $page.params.id;

  const STATUS_COPY = {
    pending_payment: { label: 'Waiting for payment', tone: 'info' },
    pending_review:  { label: 'Pending review by Holm Graphics', tone: 'info' },
    approved:        { label: 'Approved — scheduled to run', tone: 'good' },
    active:          { label: 'Running on display', tone: 'good' },
    expired:         { label: 'Expired (run completed)', tone: 'info' },
    rejected:        { label: 'Not approved', tone: 'bad' },
    cancelled:       { label: 'Cancelled', tone: 'bad' },
  };

  /** "14:30" or "14:30:00" → "2:30 PM" */
  function fmt12(t) {
    if (!t) return '';
    const [hStr, mStr] = t.split(':');
    const h = Number(hStr);
    const m = Number(mStr);
    const am = h < 12;
    const h12 = h % 12 === 0 ? 12 : h % 12;
    const mm = m.toString().padStart(2, '0');
    return `${h12}:${mm} ${am ? 'AM' : 'PM'}`;
  }

  function isAllDay(start, end) {
    if (!start || !end) return false;
    const s = start.slice(0, 5);
    const e = end.slice(0, 5);
    return s === '00:00' && (e === '23:59' || e === '23:58');
  }

  onMount(refresh);

  async function refresh() {
    err = null;
    try {
      order = await advertiseApi.getRental(id);
    } catch (e) {
      err = e.message;
    }
  }

  async function onUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    uploading = true;
    err = null;
    try {
      await advertiseApi.uploadArtwork(id, file);
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
    try {
      await advertiseApi.createTextArtwork(id, {
        text: adText.trim(),
        textColor: adTextColor,
        bgColor: adBgColor,
        fontFamily: adFont,
      });
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
    // Optimistic: flip locally so the preview updates instantly. Revert if the server says no.
    order = { ...order, fit_mode: mode };
    try {
      await advertiseApi.setFitMode(id, mode);
    } catch (e) {
      err = e.message;
      order = { ...order, fit_mode: prev };
    }
  }

  async function onPay() {
    paying = true;
    err = null;
    try {
      // 1. Tokenize the card directly with shop-api (browser → shop-api).
      //    Card data never touches the LED server.
      const tok = await tokenizeCard({
        number: cardNumber,
        exp:    cardExp,
        cvc:    cardCvc || undefined,
        zip:    cardZip,
        name:   cardName || undefined,
      });
      // 2. Send the token (not the card) to the LED app's /pay endpoint.
      //    LED app forwards to shop-api's internal charge endpoint.
      await advertiseApi.payRental(id, {
        token:     tok.token,
        cardBrand: tok.brand,
        cardLast4: tok.last4,
      });
      cardNumber = cardExp = cardCvc = cardZip = cardName = '';
      await refresh();
    } catch (e) {
      err = e.message;
    } finally {
      paying = false;
    }
  }
</script>

<svelte:head>
  <title>Your booking — Advertise with Holm Graphics</title>
</svelte:head>

<div class="header">
  <div class="header-inner">
    <a href="/advertise/displays/" class="back">← All displays</a>
    {#if order}
      <h1>Your ad on {order.device_name}</h1>
      <div class="loc">
        {#if order.start_date && order.end_date}
          {order.start_date} → {order.end_date}
        {:else}
          Run window: scheduled when Holm Graphics approves
        {/if}
      </div>
      {#if order.start_time && order.end_time}
        <div class="loc daypart-line">
          {#if isAllDay(order.start_time, order.end_time)}
            Plays all day
          {:else}
            Plays daily {fmt12(order.start_time)} – {fmt12(order.end_time)}
          {/if}
        </div>
      {/if}
    {/if}
  </div>
</div>

<div class="container">
  {#if err && !order}
    <div class="error">{err}</div>
  {:else if !order}
    <div class="muted">Loading…</div>
  {:else}
    {@const tone = STATUS_COPY[order.status] ?? { label: order.status, tone: 'info' }}
    {@const allowUpload = ['pending_payment', 'pending_review'].includes(order.status)}
    {@const needsPayment = order.status === 'pending_payment'}

    <div class="card status">
      <div>
        <div class="label">Status</div>
        <div class={`val tone-${tone.tone}`}>{tone.label}</div>
      </div>
      <div>
        <div class="label">Total</div>
        <div class="val">{fmtMoney(order.amount_cents, order.currency)}</div>
      </div>
      {#if order.paid_at}
        <div>
          <div class="label">Paid</div>
          <div class="val">{new Date(order.paid_at).toLocaleDateString()}</div>
        </div>
      {/if}
    </div>

    {#if order.review_notes && order.status === 'rejected'}
      <div class="card">
        <strong>Reason:</strong> {order.review_notes}
      </div>
    {/if}

    <!-- Artwork: upload OR text editor -->
    {#if allowUpload}
      {@const previewAspect = (order.device_width_px && order.device_height_px)
        ? `${order.device_width_px} / ${order.device_height_px}`
        : '16 / 9'}
      <div class="card">
        <h3>{order.storage_url ? 'Replace your artwork' : '1. Add your artwork'}</h3>

        <div class="art-mode-tabs">
          <button
            type="button"
            class="art-mode-tab"
            class:active={artworkMode === 'upload'}
            on:click={() => (artworkMode = 'upload')}
          >Upload a file</button>
          <button
            type="button"
            class="art-mode-tab"
            class:active={artworkMode === 'text'}
            on:click={() => (artworkMode = 'text')}
          >Create a text ad</button>
        </div>

        {#if artworkMode === 'upload'}
          <p class="muted small">JPG, PNG, or MP4. Sized to match the display gives the best look.</p>
          <label class="cta-label">
            <input type="file" accept="image/*,video/*" on:change={onUpload} hidden />
            <span class="cta">{uploading ? 'Uploading…' : '+ Upload artwork'}</span>
          </label>
        {:else}
          <p class="muted small">
            Type your headline and pick colours — we'll render it at
            {order.device_width_px && order.device_height_px
              ? `${order.device_width_px} × ${order.device_height_px} px`
              : "the display's full resolution"}
            so it looks crisp on the panel.
          </p>

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
              {textBusy ? 'Rendering…' : (order.storage_url ? 'Replace with this text ad' : 'Use this text ad')}
            </button>
          </div>
        {/if}
      </div>
    {/if}

    {#if order.storage_url}
      {@const aspect = (order.device_width_px && order.device_height_px)
        ? `${order.device_width_px} / ${order.device_height_px}`
        : '16 / 9'}
      {@const fitMode = order.fit_mode || 'contain'}
      <div class="card">
        <h3>Preview on the screen</h3>
        <div class="muted small" style="margin-bottom: 10px">
          {#if order.device_width_px && order.device_height_px}
            This display is {order.device_width_px} × {order.device_height_px} px.
            The frame below matches that aspect ratio so you can see how your ad will look.
          {:else}
            This display's exact dimensions aren't on file — preview uses a 16:9 frame.
          {/if}
        </div>
        <div class="screen-frame" style="aspect-ratio: {aspect};">
          {#if order.media_mime?.startsWith('video/')}
            <video src={order.storage_url} class="screen-art" style="object-fit: {fitMode}" muted loop autoplay playsinline />
          {:else}
            <img src={order.storage_url} class="screen-art" style="object-fit: {fitMode}" alt="Your artwork on the screen" />
          {/if}
        </div>

        {#if allowUpload}
          <div class="fit-toggle">
            <span class="fit-label">Fit on screen:</span>
            <label class="fit-opt">
              <input
                type="radio"
                name="fit"
                value="contain"
                checked={fitMode === 'contain'}
                on:change={() => changeFit('contain')}
              />
              Fit as-is (letterbox)
            </label>
            <label class="fit-opt">
              <input
                type="radio"
                name="fit"
                value="cover"
                checked={fitMode === 'cover'}
                on:change={() => changeFit('cover')}
              />
              Stretch to fill
            </label>
          </div>
          <div class="muted small">
            <strong>Fit as-is</strong> keeps your artwork's proportions and shows black bars if needed.
            <strong>Stretch to fill</strong> fills the whole screen, cropping the edges if your aspect ratio differs.
          </div>
        {:else}
          <div class="muted small">
            Locked in: <strong>{fitMode === 'cover' ? 'Stretch to fill' : 'Fit as-is (letterbox)'}</strong>
          </div>
        {/if}

        {#if order.artwork_warnings?.length > 0}
          <div class="warn">
            <strong>Heads up:</strong>
            <ul>
              {#each order.artwork_warnings as w, i (i)}<li>{w}</li>{/each}
            </ul>
            {#if allowUpload}
              <label class="cta-label small">
                <input type="file" accept="image/*,video/*" on:change={onUpload} hidden />
                <span class="link">Upload a replacement</span>
              </label>
            {/if}
          </div>
        {/if}
      </div>
    {/if}

    <!-- Payment -->
    {#if needsPayment}
      <div class="card">
        <h3>2. Payment</h3>
        <form on:submit|preventDefault={onPay}>
          <label>Card number
            <input bind:value={cardNumber} required placeholder="4111 1111 1111 1111" autocomplete="cc-number" />
          </label>
          <div class="row">
            <label>Expiry (MM/YY)
              <input bind:value={cardExp} required placeholder="12/27" autocomplete="cc-exp" />
            </label>
            <label>CVC
              <input bind:value={cardCvc} placeholder="123" autocomplete="cc-csc" />
            </label>
            <label>Postal/Zip
              <input bind:value={cardZip} required placeholder="N0G 2V0" autocomplete="postal-code" />
            </label>
          </div>
          <label>Name on card
            <input bind:value={cardName} autocomplete="cc-name" />
          </label>
          {#if err}
            <div class="error">{err}</div>
          {/if}
          <button type="submit" class="cta" disabled={paying}>
            {paying ? 'Processing…' : `Pay ${fmtMoney(order.amount_cents, order.currency)}`}
          </button>
          <div class="muted small">
            Card data is sent directly to our payment processor (Intuit/QuickBooks).
            Holm Graphics never sees the plaintext card.
          </div>
        </form>
      </div>
    {:else if order.paid_at}
      <div class="card">
        <h3>2. Payment</h3>
        <div class="paid">✓ Payment received {new Date(order.paid_at).toLocaleDateString()}</div>
      </div>
    {/if}

    <!-- Approval -->
    <div class="card">
      <h3>3. Approval</h3>
      {#if order.status === 'pending_review'}
        <div>Your submission is in our review queue. We'll email you when it's approved.</div>
      {:else if order.status === 'approved'}
        <div class="tone-good">✓ Approved! Your ad is scheduled to run on the dates above.</div>
      {:else if order.status === 'active'}
        <div class="tone-good">✓ Your ad is currently running.</div>
      {:else if order.status === 'rejected'}
        <div class="tone-bad">Your submission was not approved.</div>
      {:else if order.status === 'pending_payment'}
        <div class="muted">Waiting for payment before review can start.</div>
      {/if}
    </div>

    <p class="muted small center">Bookmark this page to check status. Questions? Reply to your confirmation email.</p>
  {/if}
</div>

<style>
  .header {
    background: var(--surface-2);
    border-bottom: 1px solid var(--border);
    padding: 24px 20px;
  }
  .header-inner { max-width: 760px; margin: 0 auto; }
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
  }
  .loc { color: var(--text-muted); margin-top: 4px; }
  .daypart-line { font-size: 0.92rem; margin-top: 2px; }

  .container { max-width: 760px; margin: 0 auto; padding: 28px 20px 80px; }
  .muted { color: var(--text-muted); }
  .small { font-size: 0.85rem; }
  .center { text-align: center; margin-top: 24px; }
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
    color: var(--text);
  }

  .status {
    display: flex;
    justify-content: space-between;
    gap: 24px;
    flex-wrap: wrap;
  }
  .label {
    font-family: var(--font-display);
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-size: 0.82rem;
  }
  .val {
    font-family: var(--font-display);
    font-weight: 600;
    font-size: 1.15rem;
    color: var(--text);
    margin-top: 2px;
  }
  .tone-good { color: #16a34a; }
  .tone-bad  { color: var(--red); }

  .artwork {
    max-width: 100%;
    border-radius: 6px;
    border: 1px solid var(--border);
    display: block;
  }
  .screen-frame {
    width: 100%;
    max-width: 100%;
    background: #000;
    border: 3px solid #222;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.25);
    overflow: hidden;
    display: block;
  }
  .screen-art {
    display: block;
    width: 100%;
    height: 100%;
  }
  .fit-toggle {
    display: flex;
    align-items: center;
    gap: 16px;
    flex-wrap: wrap;
    margin: 14px 0 6px;
    padding: 10px 12px;
    background: var(--surface-2);
    border-radius: 6px;
    font-family: var(--font-body);
    font-size: 0.92rem;
    text-transform: none;
    letter-spacing: 0;
  }
  .fit-label {
    font-family: var(--font-display);
    font-weight: 600;
    text-transform: uppercase;
    font-size: 0.78rem;
    letter-spacing: 0.06em;
    color: var(--text-muted);
  }
  .fit-opt { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; }
  .fit-opt input { margin: 0; }

  /* --- Tabbed upload / text editor --- */
  .art-mode-tabs {
    display: flex;
    gap: 4px;
    margin: 0 0 16px;
    border-bottom: 1px solid var(--border);
  }
  .art-mode-tab {
    background: transparent;
    border: 0;
    border-bottom: 3px solid transparent;
    padding: 8px 16px;
    font-family: var(--font-display);
    font-weight: 600;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 0.95rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .art-mode-tab.active {
    color: var(--red);
    border-bottom-color: var(--red);
  }
  .text-editor { display: flex; flex-direction: column; gap: 12px; }
  .text-preview-frame {
    width: 100%;
    border: 3px solid #222;
    border-radius: 8px;
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 4%;
    text-align: center;
    box-shadow: 0 4px 12px rgba(0,0,0,0.25);
  }
  .text-preview {
    font-size: clamp(1.4rem, 6vw, 4rem);
    line-height: 1.1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 100%;
  }
  .te-row { display: flex; flex-direction: column; gap: 4px; margin: 0; }
  .te-three { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; }
  .te-label {
    font-family: var(--font-display);
    font-weight: 600;
    color: var(--text-muted);
    font-size: 0.78rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .te-row input[type="text"],
  .te-row select {
    font-family: var(--font-body);
    background: var(--surface);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 10px 12px;
    font-size: 0.95rem;
    text-transform: none;
    letter-spacing: 0;
  }
  .te-row input[type="color"] {
    width: 100%;
    height: 40px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--surface);
    cursor: pointer;
    padding: 2px;
  }
  .te-presets {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
    margin-top: 4px;
  }
  .te-preset {
    border: 2px solid transparent;
    border-radius: 4px;
    padding: 6px 12px;
    font-family: var(--font-display);
    font-weight: 600;
    font-size: 0.82rem;
    cursor: pointer;
  }
  .te-preset.active { border-color: var(--text); }
  .warn {
    margin-top: 12px;
    padding: 12px;
    background: rgba(230, 181, 74, 0.1);
    border-radius: 6px;
    font-size: 0.92rem;
  }
  .warn ul { margin: 6px 0 0 18px; padding: 0; }

  label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-bottom: 12px;
    font-family: var(--font-display);
    font-weight: 600;
    color: var(--text-muted);
    font-size: 0.82rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  input {
    font-family: var(--font-body);
    background: var(--surface);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 10px 12px;
    font-size: 0.95rem;
    text-transform: none;
    letter-spacing: 0;
  }
  .row {
    display: flex;
    gap: 12px;
  }
  .row label { flex: 1; }

  .cta-label { display: inline-block; cursor: pointer; }
  .cta-label.small .link {
    color: var(--red);
    text-decoration: underline;
    font-size: 0.85rem;
    font-family: var(--font-body);
    font-weight: 500;
    text-transform: none;
    letter-spacing: 0;
  }
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

  .paid { color: #16a34a; font-family: var(--font-display); font-weight: 600; }
</style>
