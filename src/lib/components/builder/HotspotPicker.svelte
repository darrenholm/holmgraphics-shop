<!--
  HotspotPicker.svelte — Step 3 of the decoration builder.

  Renders the garment illustration for a single family (tee/hoodie/hat) with
  clickable hotspot rectangles overlaid via a shared SVG viewBox. Clicking a
  hotspot toggles a "location" entry in the bound locations array; clicking
  again deselects.

  Prop contract:
    familyKey        — 'tee' | 'hoodie' | 'hat' (used to build hotspot_key)
    family           — config slice from families.json (viewBox, illustration,
                       views, hotspots, view_labels)
    pricing          — pricing block from families.json (tiers, method)
    bind:locations   — array of location objects owned by the parent. Shape:
                       { id, hotspot_key, view, label_wearer, design_name,
                         artwork_file_url, artwork_deferred, decoration_method,
                         unit_price, supports_roster, roster }

  Roster grid for back-of-jersey locations is a placeholder note for now —
  Step 4 of the build order swaps in the real grid.
-->
<script>
  import ArtworkUploader from './ArtworkUploader.svelte';

  export let familyKey;
  export let family;
  export let pricing;
  export let locations = [];
  // Designs already uploaded elsewhere in the draft. Passed through to each
  // chip's ArtworkUploader so buyers can reuse a logo across line items
  // without re-uploading. Parent owns the dedup logic.
  export let existingDesigns = [];

  let currentView = family.views[0];

  // Reset view if family changes and current view isn't in the new family's list.
  $: if (family && !family.views.includes(currentView)) {
    currentView = family.views[0];
  }

  function priceOf(hotspot) {
    return pricing?.tiers?.[hotspot.price_tier]?.price ?? 0;
  }

  function hotspotKey(view, h) {
    return `${familyKey}:${view}:${h.key}`;
  }

  // Reactive set of selected hotspot keys. Using a Set in the template lets
  // Svelte track `locations` as a direct dependency — wrapping isSelected()
  // in {@const} inside the each block doesn't re-evaluate when the each
  // iteration variable is stable.
  $: selectedKeys = new Set(locations.map((l) => l.hotspot_key));

  function toggle(view, h) {
    const k = hotspotKey(view, h);
    const idx = locations.findIndex((l) => l.hotspot_key === k);
    if (idx >= 0) {
      locations = locations.filter((_, i) => i !== idx);
    } else {
      locations = [
        ...locations,
        {
          id:                 `loc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          hotspot_key:        k,
          view,
          label_wearer:       h.label_wearer,
          design_name:        '',
          artwork_file_url:   null,
          artwork_file_name:  '',
          artwork_file_size:  0,
          artwork_deferred:   false,
          decoration_method:  pricing?.method || 'dtf',
          price_tier:         h.price_tier || 'standard',
          unit_price:         priceOf(h),
          supports_roster:    !!h.supports_roster,
          roster:             []
        }
      ];
    }
  }

  function updateName(id, name) {
    locations = locations.map((l) => (l.id === id ? { ...l, design_name: name } : l));
  }

  function updateLoc(id, patch) {
    locations = locations.map((l) => (l.id === id ? { ...l, ...patch } : l));
  }

  function removeLoc(id) {
    // Best-effort blob URL cleanup so deselecting a hotspot doesn't leak the
    // staged artwork. Server-uploaded URLs (Step 6) don't need this.
    const target = locations.find((l) => l.id === id);
    if (target?.artwork_file_url && target.artwork_file_url.startsWith('blob:')) {
      URL.revokeObjectURL(target.artwork_file_url);
    }
    locations = locations.filter((l) => l.id !== id);
  }

  function viewLabel(v) {
    return family?.view_labels?.[v] ?? `${v[0].toUpperCase()}${v.slice(1)}`;
  }

  const money = (n) =>
    n == null ? '—' : new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(n);

  $: hotspots = family?.hotspots?.[currentView] || [];
  $: illustrationHref = family?.illustration?.[currentView];
</script>

<div class="hotspot-picker">
  <div class="view-tabs" role="tablist">
    {#each family.views as v}
      <button
        type="button"
        class="tab"
        class:active={v === currentView}
        role="tab"
        aria-selected={v === currentView}
        on:click={() => (currentView = v)}>{viewLabel(v)}</button>
    {/each}
  </div>

  <div class="canvas">
    <svg
      viewBox={family.viewBox}
      class="garment-svg"
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="{familyKey} {currentView} view with clickable decoration zones">
      {#if illustrationHref}
        <image href={illustrationHref} x="0" y="0" width="200" height="240" />
      {/if}
      {#each hotspots as h (h.key)}
        <g class="hotspot-group">
          <rect
            x={h.x} y={h.y} width={h.w} height={h.h}
            rx="2" ry="2"
            class="hotspot"
            class:selected={selectedKeys.has(hotspotKey(currentView, h))}
            class:big={h.big}
            tabindex="0"
            role="checkbox"
            aria-checked={selectedKeys.has(hotspotKey(currentView, h))}
            aria-label={`${h.label_wearer}, ${money(priceOf(h))}`}
            on:click={() => toggle(currentView, h)}
            on:keydown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                toggle(currentView, h);
              }
            }} />
          <text
            x={h.x + h.w / 2}
            y={h.y + h.h / 2 + 3}
            class="hotspot-label"
            class:selected={selectedKeys.has(hotspotKey(currentView, h))}>{h.label_wearer}</text>
          <text
            x={h.x + h.w / 2}
            y={h.y + h.h / 2 + 12}
            class="hotspot-price"
            class:selected={selectedKeys.has(hotspotKey(currentView, h))}>+{money(priceOf(h))}</text>
        </g>
      {/each}
    </svg>
  </div>

  <div class="chips">
    {#if locations.length === 0}
      <p class="hint small">Click a placement above to add a decoration. {family.views.length > 1 ? 'Use the tabs to switch views.' : ''}</p>
    {:else}
      <p class="hint small">
        {locations.length} decoration{locations.length === 1 ? '' : 's'} selected.
        Total: {money(locations.reduce((s, l) => s + (l.unit_price || 0), 0))} per garment.
      </p>
    {/if}

    {#each locations as loc (loc.id)}
      <div class="chip">
        <div class="chip-header">
          <span class="chip-loc">
            <span class="chip-view">{viewLabel(loc.view)}</span>
            <span class="chip-sep">·</span>
            <span class="chip-label">{loc.label_wearer}</span>
          </span>
          <span class="chip-price">+{money(loc.unit_price)}</span>
          <button
            type="button"
            class="chip-remove"
            on:click={() => removeLoc(loc.id)}
            title="Remove this decoration"
            aria-label="Remove {loc.label_wearer}">×</button>
        </div>
        <input
          type="text"
          class="chip-name"
          placeholder="Name this design (e.g. 'Front logo', 'Team name')"
          value={loc.design_name}
          on:input={(e) => updateName(loc.id, e.target.value)} />
        <ArtworkUploader
          fileUrl={loc.artwork_file_url}
          fileName={loc.artwork_file_name}
          fileSize={loc.artwork_file_size}
          deferred={loc.artwork_deferred}
          existingDesigns={existingDesigns}
          on:change={(e) => updateLoc(loc.id, e.detail)} />
        {#if loc.supports_roster}
          <p class="chip-note">Names &amp; numbers grid appears below — one row per garment.</p>
        {/if}
      </div>
    {/each}
  </div>
</div>

<style>
  .hotspot-picker { display: flex; flex-direction: column; gap: 1rem; }

  .view-tabs { display: flex; gap: 0.25rem; border-bottom: 1px solid #e4e4e7; }
  .tab {
    background: none; border: 0; padding: 0.55rem 1rem; cursor: pointer;
    font-size: 0.95rem; color: #666;
    border-bottom: 2px solid transparent; margin-bottom: -1px;
  }
  .tab:hover { color: #c01818; }
  .tab.active { color: #c01818; border-bottom-color: #c01818; font-weight: 600; }

  .canvas {
    display: flex; justify-content: center;
    background: #fafafa; border: 1px solid #e4e4e7;
    border-radius: 0.5rem; padding: 1rem;
  }
  .garment-svg { width: 100%; max-width: 22rem; height: auto; display: block; }

  .hotspot {
    fill: rgba(192, 24, 24, 0.05);
    stroke: #c01818;
    stroke-width: 1.5;
    stroke-dasharray: 3, 2;
    cursor: pointer;
    transition: fill 0.15s ease, stroke-width 0.15s ease;
  }
  .hotspot:hover { fill: rgba(192, 24, 24, 0.18); }
  .hotspot:focus { outline: none; stroke-width: 2.5; }
  .hotspot.selected {
    fill: rgba(192, 24, 24, 0.32);
    stroke-dasharray: none;
    stroke-width: 2.5;
  }
  .hotspot.big { fill: rgba(192, 24, 24, 0.025); }
  .hotspot.big:hover { fill: rgba(192, 24, 24, 0.12); }
  .hotspot.big.selected { fill: rgba(192, 24, 24, 0.22); }

  .hotspot-label, .hotspot-price {
    pointer-events: none;
    text-anchor: middle;
    fill: #444;
    font-family: system-ui, -apple-system, sans-serif;
    user-select: none;
  }
  .hotspot-label { font-size: 6.5px; font-weight: 500; }
  .hotspot-price { font-size: 5.5px; fill: #666; }
  .hotspot-label.selected, .hotspot-price.selected {
    fill: #7a0c0c;
    font-weight: 600;
  }

  .chips { display: flex; flex-direction: column; gap: 0.5rem; }
  .hint { color: #666; font-size: 0.9rem; margin: 0; }
  .small { font-size: 0.85rem; }

  .chip {
    background: white;
    border: 1px solid #e4e4e7;
    border-radius: 0.4rem;
    padding: 0.55rem 0.75rem;
    display: flex; flex-direction: column; gap: 0.4rem;
  }
  .chip-header { display: flex; align-items: center; gap: 0.5rem; }
  .chip-loc { flex-grow: 1; font-size: 0.95rem; }
  .chip-view { color: #888; }
  .chip-sep { color: #ccc; margin: 0 0.15rem; }
  .chip-label { font-weight: 500; }
  .chip-price { color: #444; font-variant-numeric: tabular-nums; font-size: 0.9rem; }
  .chip-remove {
    background: none; border: 0; color: #b00; cursor: pointer;
    font-size: 1.2rem; line-height: 1; padding: 0 0.2rem;
  }
  .chip-remove:hover { opacity: 0.7; }
  .chip-name {
    padding: 0.4rem 0.55rem; border: 1px solid #d4d4d8;
    border-radius: 0.3rem; font-size: 0.9rem; width: 100%; box-sizing: border-box;
  }
  .chip-name:focus { outline: 2px solid #c01818; outline-offset: 1px; border-color: transparent; }
  .chip-note { margin: 0; color: #888; font-size: 0.8rem; font-style: italic; }
</style>
