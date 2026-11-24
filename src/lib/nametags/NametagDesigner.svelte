<!--
  Staff: set up a client's nametag templates (Clients → [client] → Nametags tab).
  The client then sees active templates in the portal (/portal/nametags), keeps
  their staff list there and sends orders, which land on the job board.
  Cards print on the Seaory S25 (CR80). See $lib/nametags/render.js.
-->
<script>
  import { onMount } from 'svelte';
  import { api } from '$lib/api/client.js';
  import {
    FONTS, FONT_CSS, defaultDesign, normalizeDesign, applyLayout, renderCard, readImage, loadFonts,
  } from './render.js';

  export let clientId;

  let loading = true;
  let error = '';
  let templates = [];
  let people = [];
  let orders = [];

  let selectedId = null;      // null = new, unsaved template
  let name = 'Staff nametag';
  let design = defaultDesign();
  let dirty = false;
  let saving = false;
  let savedMsg = '';
  let fontsReady = 0;

  let canvas;
  let boxes = [];
  let drag = null;
  let openField = null;
  let confirmReset = false;
  const PPI = 200;

  const SAMPLE = { first: 'Alex', last: 'Sample', title: 'Title', dept: 'Department', extra: '' };
  $: previewCard = people[0]
    ? { first: people[0].first_name, last: people[0].last_name, title: people[0].title,
        dept: people[0].department, extra: people[0].extra, photo: people[0].photo }
    : SAMPLE;

  onMount(async () => {
    await load();
    loadFonts().then(() => fontsReady++);
  });

  async function load() {
    loading = true; error = '';
    try {
      const res = await api.nametagsForClient(clientId);
      templates = res.templates || []; people = res.people || []; orders = res.orders || [];
      if (templates.length) pick(templates[0]); else startNew();
    } catch (e) {
      error = e.message || 'Could not load nametags.';
    } finally {
      loading = false;
    }
  }

  function pick(t) {
    selectedId = t.id; name = t.name; design = normalizeDesign(structuredClone(t.design));
    dirty = false; savedMsg = ''; confirmReset = false;
  }
  function startNew() {
    selectedId = null; name = templates.length ? `Staff nametag ${templates.length + 1}` : 'Staff nametag';
    design = defaultDesign(); dirty = true; savedMsg = '';
  }
  function changed() { design = design; dirty = true; savedMsg = ''; }

  async function save() {
    saving = true; error = ''; savedMsg = '';
    try {
      if (selectedId) {
        const { template } = await api.nametagUpdateTemplate(selectedId, { name, design });
        templates = templates.map((t) => (t.id === template.id ? template : t));
      } else {
        const { template } = await api.nametagCreateTemplate(clientId, { name, design });
        templates = [...templates, template]; selectedId = template.id;
      }
      dirty = false; savedMsg = 'Saved. The client sees this design in their portal.';
    } catch (e) {
      error = e.message || 'Could not save the template.';
    } finally {
      saving = false;
    }
  }

  async function setActive(active) {
    if (!selectedId) return;
    try {
      const { template } = await api.nametagUpdateTemplate(selectedId, { active });
      templates = templates.map((t) => (t.id === template.id ? template : t));
    } catch (e) { error = e.message; }
  }
  $: current = templates.find((t) => t.id === selectedId);

  async function onLogo(e) {
    const f = e.target.files[0]; if (!f) return;
    try { design.logo.src = await readImage(f, { maxPx: 1400, keepTransparency: true }); changed(); }
    catch (err) { error = err.message; }
  }
  async function onBgImg(e) {
    const f = e.target.files[0]; if (!f) return;
    try { design.bgImg = await readImage(f, { maxPx: 1400 }); changed(); }
    catch (err) { error = err.message; }
  }
  function setOrient(o) { applyLayout(design, o); confirmReset = false; changed(); }

  /* ---------- preview + drag ---------- */
  let loaded = 0;
  function draw() {
    if (!canvas) return;
    canvas.width = Math.round(design.w * PPI); canvas.height = Math.round(design.h * PPI);
    boxes = [];
    renderCard(canvas.getContext('2d'), design, previewCard, PPI, { boxes, showLabels: true, onImageLoad: () => loaded++ });
  }
  $: canvas, design, previewCard, fontsReady, loaded, draw();

  function pointAt(e) {
    const r = canvas.getBoundingClientRect(), k = canvas.width / r.width;
    return { x: (e.clientX - r.left) * k, y: (e.clientY - r.top) * k, k };
  }
  function down(e) {
    const p = pointAt(e);
    for (let i = boxes.length - 1; i >= 0; i--) {
      const b = boxes[i], pad = 6;
      if (p.x >= b.x - pad && p.x <= b.x + b.w + pad && p.y >= b.y - pad && p.y <= b.y + b.h + pad) {
        const obj = b.key === 'logo' ? design.logo : b.key === 'photo' ? design.photo : design.fields.find((f) => f.key === b.key);
        drag = { obj, sx: p.x, sy: p.y, ox: obj.x, oy: obj.y };
        openField = b.key;
        canvas.setPointerCapture(e.pointerId);
        break;
      }
    }
  }
  function move(e) {
    if (!drag) return;
    const p = pointAt(e);
    const snap = (v) => Math.round(Math.min(1, Math.max(0, v)) * 200) / 200;
    drag.obj.x = snap(drag.ox + (p.x - drag.sx) / canvas.width);
    drag.obj.y = snap(drag.oy + (p.y - drag.sy) / canvas.height);
    changed();
  }
  function up() { drag = null; }

  $: capHeight = (() => { const f = design.fields.find((x) => x.key === 'first'); return f ? (f.size / 72 * 0.7).toFixed(2) : '–'; })();
  const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' }) : '');
</script>

<svelte:head><link rel="stylesheet" href={FONT_CSS} /></svelte:head>

{#if loading}
  <p class="empty-msg">Loading nametags…</p>
{:else}
  {#if error}<div class="nt-error">{error}</div>{/if}

  <div class="nt-bar card">
    <div class="nt-tpls">
      {#each templates as t (t.id)}
        <button class="nt-chip" class:on={t.id === selectedId} on:click={() => pick(t)}>
          {t.name}{#if !t.active} <em>(hidden)</em>{/if}
        </button>
      {/each}
      {#if selectedId === null}<span class="nt-chip on">{name} <em>(new)</em></span>{/if}
      <button class="btn btn-ghost btn-sm" on:click={startNew}>+ New template</button>
    </div>
    <div class="nt-save">
      {#if savedMsg}<span class="nt-ok">{savedMsg}</span>{/if}
      {#if current}
        <button class="btn btn-ghost btn-sm" on:click={() => setActive(!current.active)}>
          {current.active ? 'Hide from client' : 'Show to client'}
        </button>
      {/if}
      <button class="btn btn-primary" on:click={save} disabled={saving || !dirty}>
        {saving ? 'Saving…' : dirty ? 'Save template' : 'Saved'}
      </button>
    </div>
  </div>

  <div class="nt-grid">
    <div class="card nt-controls">
      <div class="form-group">
        <label for="nt-name">Template name (the client sees this)</label>
        <input id="nt-name" type="text" bind:value={name} on:input={() => { dirty = true; savedMsg = ''; }} />
      </div>

      <h3>Card</h3>
      <div class="nt-row">
        <div class="form-group">
          <label for="nt-orient">Direction</label>
          <select id="nt-orient" value={design.orient}
            on:change={(e) => { if (confirmReset === e.target.value) setOrient(e.target.value); else { confirmReset = e.target.value; e.target.value = design.orient; } }}>
            <option value="landscape">Landscape</option>
            <option value="portrait">Portrait</option>
          </select>
        </div>
        <div class="form-group">
          <label for="nt-font">Typeface</label>
          <select id="nt-font" bind:value={design.font} on:change={() => loadFonts(design.font).then(changed)}>
            {#each FONTS as f}<option>{f}</option>{/each}
          </select>
        </div>
      </div>
      {#if confirmReset}
        <p class="nt-warn">Switching direction resets where everything sits. Choose
          {confirmReset === 'portrait' ? 'Portrait' : 'Landscape'} again to confirm.
          <button class="btn-link" on:click={() => (confirmReset = false)}>Cancel</button></p>
      {/if}

      <div class="nt-row">
        <div class="form-group">
          <label for="nt-bg">Background</label>
          <input id="nt-bg" type="color" bind:value={design.bg} on:input={changed} />
        </div>
        <div class="form-group">
          <label for="nt-band">Colour band</label>
          <select id="nt-band" bind:value={design.band.pos} on:change={changed}>
            <option value="none">None</option><option value="top">Top</option>
            <option value="bottom">Bottom</option><option value="left">Left</option>
          </select>
        </div>
        <div class="form-group">
          <label for="nt-bandc">Band colour</label>
          <input id="nt-bandc" type="color" bind:value={design.band.color} on:input={changed} />
        </div>
        <div class="form-group">
          <label for="nt-bands">Band (in)</label>
          <input id="nt-bands" type="number" step="0.0625" min="0" bind:value={design.band.size} on:input={changed} />
        </div>
      </div>
      <div class="nt-row">
        <div class="form-group">
          <label for="nt-bgimg">Background image</label>
          <input id="nt-bgimg" type="file" accept="image/*" on:change={onBgImg} />
        </div>
        {#if design.bgImg}<button class="btn btn-ghost btn-sm nt-self-end" on:click={() => { design.bgImg = null; changed(); }}>Remove</button>{/if}
      </div>

      <h3>Logo</h3>
      <div class="nt-row">
        <div class="form-group">
          <label for="nt-logo">Logo file (PNG, JPG or SVG)</label>
          <input id="nt-logo" type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" on:change={onLogo} />
        </div>
        <div class="form-group nt-narrow">
          <label for="nt-logow">Width (in)</label>
          <input id="nt-logow" type="number" step="0.05" min="0.2" bind:value={design.logo.w} on:input={changed} />
        </div>
      </div>
      <p class="nt-note">Convert logo text to curves before exporting, or the fonts may change.</p>

      <h3>What goes on the card</h3>
      <div class="nt-fields">
        <details class="nt-field" open={openField === 'photo'}>
          <summary>
            <input type="checkbox" bind:checked={design.photo.on} on:change={changed} on:click|stopPropagation aria-label="Show photo" />
            Photo <span>{design.photo.shape}, {design.photo.size} in</span>
          </summary>
          <div class="nt-row">
            <div class="form-group"><label for="nt-phs">Size (in)</label>
              <input id="nt-phs" type="number" step="0.05" min="0.3" bind:value={design.photo.size} on:input={changed} /></div>
            <div class="form-group"><label for="nt-phshape">Shape</label>
              <select id="nt-phshape" bind:value={design.photo.shape} on:change={changed}>
                <option value="circle">Circle</option><option value="square">Square</option></select></div>
            <div class="form-group"><label for="nt-phring">Ring</label>
              <input id="nt-phring" type="color" bind:value={design.photo.ring} on:input={changed} /></div>
          </div>
        </details>
        {#each design.fields as f (f.key)}
          <details class="nt-field" open={openField === f.key}>
            <summary>
              <input type="checkbox" bind:checked={f.on} on:change={changed} on:click|stopPropagation aria-label={`Show ${f.label}`} />
              {f.label} <span>{f.size} pt{f.bold ? ' bold' : ''}</span>
            </summary>
            {#if f.key === 'extra'}
              <div class="form-group"><label for="nt-extra-label">Label the client sees</label>
                <input id="nt-extra-label" type="text" bind:value={f.label} on:input={changed} placeholder="e.g. Pronouns, Years of service" /></div>
            {/if}
            <div class="nt-row">
              <div class="form-group"><label for={`nt-${f.key}-size`}>Size (pt)</label>
                <input id={`nt-${f.key}-size`} type="number" step="0.5" min="4" bind:value={f.size} on:input={changed} /></div>
              <div class="form-group"><label for={`nt-${f.key}-color`}>Colour</label>
                <input id={`nt-${f.key}-color`} type="color" bind:value={f.color} on:input={changed} /></div>
              <div class="form-group"><label for={`nt-${f.key}-align`}>Align</label>
                <select id={`nt-${f.key}-align`} bind:value={f.align} on:change={changed}>
                  <option value="left">Left</option><option value="center">Centre</option><option value="right">Right</option></select></div>
            </div>
            <div class="nt-checks">
              <label class="nt-check"><input type="checkbox" bind:checked={f.bold} on:change={changed} /> Bold</label>
              <label class="nt-check"><input type="checkbox" bind:checked={f.upper} on:change={changed} /> All caps</label>
            </div>
          </details>
        {/each}
      </div>

      <h3>Printer</h3>
      <p class="nt-note">Seaory S25, CR80 NFC cards (NTAG215). No full bleed: the S25 breaks ribbons
        on edge-to-edge prints, so the card keeps an unprinted white edge with rounded corners.</p>
      <div class="form-group nt-narrow">
        <label for="nt-edge">White edge (in)</label>
        <input id="nt-edge" type="number" step="0.03125" min="0.0625" max="0.5" bind:value={design.edge} on:input={changed} />
      </div>
    </div>

    <div class="nt-side">
      <div class="card">
        <h2 class="card-title">Preview</h2>
        <div class="nt-stage">
          <canvas bind:this={canvas} class="nt-canvas" style:max-width={`${design.w * 150}px`}
            style={`border-radius:${(12.5 / design.w).toFixed(2)}% / ${(12.5 / design.h).toFixed(2)}%`}
            on:pointerdown={down} on:pointermove={move} on:pointerup={up} on:pointercancel={up}
            aria-label="Nametag preview. Drag items to move them."></canvas>
        </div>
        <p class="nt-note">Drag the name, photo or logo to move it. Preview person:
          <strong>{previewCard.first} {previewCard.last}</strong>.
          First name caps ≈ {capHeight} in. Card {design.w} × {design.h} in, {design.edge} in white edge.</p>
      </div>

      <div class="card">
        <h2 class="card-title">Client's staff list ({people.length})</h2>
        {#if people.length === 0}
          <p class="nt-note">The client hasn't added anyone yet. They do it in their portal under Staff nametags.</p>
        {:else}
          <p class="nt-note">{people.slice(0, 12).map((p) => `${p.first_name} ${p.last_name}`.trim()).join(', ')}{people.length > 12 ? ` and ${people.length - 12} more` : ''}</p>
        {/if}
      </div>

      <div class="card">
        <h2 class="card-title">Orders</h2>
        {#if orders.length === 0}
          <p class="nt-note">No nametag orders yet.</p>
        {:else}
          <ul class="nt-orders">
            {#each orders as o (o.id)}
              <li>
                <a href={`/jobs/${o.project_id}`}>Job #{o.project_id}</a>
                · {o.card_count} cards · {fmtDate(o.created_at)}
                {#if o.printed_at}<span class="nt-printed">Printed</span>{/if}
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .nt-error { background: rgba(192,57,43,.1); color: var(--red); padding: 10px 14px; border-radius: 6px; margin-bottom: 12px; }
  .nt-bar { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; justify-content: space-between; margin-bottom: 16px; padding: 12px 16px; }
  .nt-tpls, .nt-save { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
  .nt-chip { border: 1px solid var(--border); background: var(--surface); color: var(--text); border-radius: 99px; padding: 5px 12px; cursor: pointer; font: inherit; }
  .nt-chip.on { border-color: var(--red); background: var(--red-glow); }
  .nt-chip em { color: var(--text-dim); font-style: normal; font-size: .85em; }
  .nt-ok { color: var(--green); font-size: .9rem; }
  .nt-grid { display: grid; grid-template-columns: minmax(0, 400px) minmax(0, 1fr); gap: 16px; align-items: start; }
  @media (max-width: 900px) { .nt-grid { grid-template-columns: minmax(0, 1fr); } }
  .nt-side { display: grid; gap: 16px; }
  .nt-controls h3 { font-family: var(--font-display); text-transform: uppercase; letter-spacing: .06em; font-size: .95rem; margin: 18px 0 8px; color: var(--text); }
  .nt-row { display: flex; flex-wrap: wrap; gap: 10px; }
  .nt-row > .form-group { flex: 1 1 90px; min-width: 0; margin-bottom: 10px; }
  .nt-narrow { max-width: 130px; }
  .nt-self-end { align-self: center; }
  .nt-note { color: var(--text-muted); font-size: .88rem; margin: 4px 0 8px; line-height: 1.45; }
  .nt-warn { background: rgba(214,128,0,.12); color: var(--text); padding: 8px 10px; border-radius: 6px; font-size: .88rem; }
  .nt-fields { display: grid; gap: 8px; }
  .nt-field { border: 1px solid var(--border); border-radius: 6px; padding: 0 10px; }
  .nt-field[open] { border-color: var(--red); padding-bottom: 6px; }
  .nt-field summary { display: flex; align-items: center; gap: 8px; padding: 8px 0; cursor: pointer; font-weight: 600; }
  .nt-field summary span { margin-left: auto; color: var(--text-dim); font-weight: 400; font-size: .85rem; }
  .nt-field input[type='checkbox'], .nt-check input { width: auto; }
  .nt-checks { display: flex; gap: 16px; }
  .nt-check { display: flex; align-items: center; gap: 6px; text-transform: none; letter-spacing: 0; font-size: .9rem; color: var(--text); }
  input[type='color'] { padding: 2px; height: 38px; }
  .nt-stage { padding: 18px; background: repeating-conic-gradient(#e8ebef 0 25%, transparent 0 50%) 0 0 / 18px 18px; border-radius: 6px; display: grid; justify-items: center; }
  .nt-canvas { width: 100%; height: auto; touch-action: none; cursor: grab; box-shadow: 0 1px 3px rgba(0,0,0,.2), 0 6px 20px rgba(0,0,0,.12); }
  .nt-orders { margin: 0; padding-left: 18px; display: grid; gap: 4px; }
  .nt-printed { margin-left: 6px; font-size: .75rem; text-transform: uppercase; color: var(--green); font-weight: 700; }
  .btn-sm { padding: 5px 12px; font-size: .8rem; }
  .btn-link { background: none; border: 0; color: var(--red); cursor: pointer; padding: 0; font: inherit; text-decoration: underline; }
</style>
