<!--
  SizeGrid.svelte — Step 1 of the new decoration builder.

  One row per garment (style + colour). Columns are sizes. Cells are quantity
  inputs. Sizes a given garment doesn't offer render as disabled "—" cells so
  rows stay visually aligned across the table.

  No decoration choices here — this is "what am I buying", garment qty only.

  Prop contract:
    bind:lineItems  — array of line-item objects. Each item:
      {
        id:              string             // stable client id
        label:           string             // "Carhartt K87 · Navy"
        color_hex?:      string             // optional swatch colour
        unit_price:      number             // garment unit price
        sizes_offered:   string[]           // e.g. ['YS','YM','AS','AM','AL','AXL']
        size_grid:       { size, quantity }[]
      }

  Events: dispatches 'remove' with { detail: { id } } when X is clicked.
-->
<script>
  import { createEventDispatcher } from 'svelte';

  export let lineItems = [];

  const dispatch = createEventDispatcher();

  // Canonical size order — anything else falls in after these in
  // first-seen order so garment-specific sizes (e.g. hats "S/M", "L/XL")
  // get their own columns at the end.
  const CANONICAL = [
    'YXS','YS','YM','YL','YXL',
    'XS','S','M','L','XL','2XL','3XL','4XL','5XL','6XL',
    // Common-but-non-standard apparel labels:
    'AS','AM','AL','AXL','A2XL','A3XL','A4XL'
  ];

  // Friendly labels for industry-jargon size codes. The underlying size
  // value (used everywhere else in the system) is unchanged.
  const SIZE_LABELS = { OSFA: 'One size', OS: 'One size' };
  const labelFor = (s) => SIZE_LABELS[s] || s;

  function orderedSizeColumns(items) {
    const seen = new Set();
    for (const li of items) for (const s of (li.sizes_offered || [])) seen.add(s);
    const canonical = CANONICAL.filter((s) => seen.has(s));
    const extras    = [...seen].filter((s) => !CANONICAL.includes(s));
    return [...canonical, ...extras];
  }

  $: allSizes = orderedSizeColumns(lineItems);

  function getQty(li, size) {
    return li.size_grid?.find((g) => g.size === size)?.quantity ?? 0;
  }

  function setQty(li, size, raw) {
    const n = Math.max(0, parseInt(raw, 10) || 0);
    const grid = [...(li.size_grid || [])];
    const idx = grid.findIndex((g) => g.size === size);
    if (n === 0 && idx >= 0)        grid.splice(idx, 1);
    else if (idx >= 0)              grid[idx] = { size, quantity: n };
    else if (n > 0)                 grid.push({ size, quantity: n });
    li.size_grid = grid;
    lineItems = lineItems;  // trigger reactivity for parent bindings
  }

  const rowQty = (li) =>
    (li.size_grid || []).reduce((s, g) => s + (Number(g.quantity) || 0), 0);
  const rowSubtotal = (li) =>
    rowQty(li) * (Number(li.unit_price) || 0);

  $: grandQty      = lineItems.reduce((s, li) => s + rowQty(li), 0);
  $: grandSubtotal = lineItems.reduce((s, li) => s + rowSubtotal(li), 0);

  const money = (n) =>
    n == null ? '—' : new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(n);
</script>

<div class="size-grid-wrap">
  {#if lineItems.length === 0}
    <div class="empty">
      <p>No garments yet.</p>
      <p class="muted small">Add a garment from the catalog to start building.</p>
    </div>
  {:else}
    <table class="size-grid">
      <thead>
        <tr>
          <th class="garment-col">Garment</th>
          {#each allSizes as size}
            <th class="size-col">{labelFor(size)}</th>
          {/each}
          <th class="qty-col">Qty</th>
          <th class="subtotal-col">Subtotal</th>
          <th class="action-col"></th>
        </tr>
      </thead>
      <tbody>
        {#each lineItems as li (li.id)}
          <tr>
            <td class="garment-cell">
              {#if li.color_hex}<span class="swatch" style="background:{li.color_hex}"></span>{/if}
              <span class="garment-label">{li.label}</span>
              <span class="muted small">@ {money(li.unit_price)}</span>
            </td>
            {#each allSizes as size}
              <td class="size-cell">
                {#if li.sizes_offered?.includes(size)}
                  <input
                    type="number" min="0" max="999"
                    value={getQty(li, size) || ''}
                    placeholder="0"
                    aria-label={`${li.label} ${size} quantity`}
                    on:input={(e) => setQty(li, size, e.target.value)} />
                {:else}
                  <span class="na" aria-label="size not offered">—</span>
                {/if}
              </td>
            {/each}
            <td class="qty-col"><strong>{rowQty(li)}</strong></td>
            <td class="subtotal-col">{money(rowSubtotal(li))}</td>
            <td class="action-col">
              <button
                class="link-btn danger"
                on:click={() => dispatch('remove', { id: li.id })}
                title="Remove garment"
                aria-label="Remove {li.label}">×</button>
            </td>
          </tr>
        {/each}
      </tbody>
      <tfoot>
        <tr>
          <td class="garment-cell"><strong>Total</strong></td>
          {#each allSizes as _size}<td></td>{/each}
          <td class="qty-col"><strong>{grandQty}</strong></td>
          <td class="subtotal-col"><strong>{money(grandSubtotal)}</strong></td>
          <td></td>
        </tr>
      </tfoot>
    </table>
  {/if}
</div>

<style>
  .size-grid-wrap { overflow-x: auto; }

  .empty { text-align: center; padding: 2rem 1rem; color: #555; border: 1px dashed #e4e4e7; border-radius: 0.5rem; background: #fafafa; }
  .empty p { margin: 0.25rem 0; }

  table.size-grid {
    width: 100%;
    border-collapse: collapse;
    background: white;
    border: 1px solid #e4e4e7;
    border-radius: 0.5rem;
    overflow: hidden;
    font-size: 0.95rem;
  }
  th, td { padding: 0.5rem 0.6rem; text-align: left; vertical-align: middle; }
  thead th { background: #f7f7f8; font-weight: 600; font-size: 0.85rem; color: #444; border-bottom: 1px solid #e4e4e7; }
  tbody tr { border-bottom: 1px dashed #f0f0f0; }
  tbody tr:last-child { border-bottom: 0; }
  tfoot td { border-top: 1px solid #e4e4e7; background: #fafafa; }

  .garment-col, .garment-cell { min-width: 14rem; }
  .garment-cell { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
  .swatch { display: inline-block; width: 1rem; height: 1rem; border-radius: 0.2rem; border: 1px solid #ddd; flex: 0 0 auto; }
  .garment-label { font-weight: 500; }

  .size-col, .size-cell { text-align: center; min-width: 3.5rem; }
  .size-cell input {
    width: 3rem; padding: 0.3rem 0.35rem; text-align: center;
    border: 1px solid #d4d4d8; border-radius: 0.3rem; font-size: 0.9rem;
  }
  .size-cell input:focus { outline: 2px solid #c01818; outline-offset: 1px; }
  .na { color: #c8c8cc; }

  .qty-col, .subtotal-col { text-align: right; min-width: 4rem; }
  .subtotal-col { min-width: 5rem; font-variant-numeric: tabular-nums; }
  .action-col { width: 1.5rem; text-align: center; }

  .muted { color: #888; }
  .small { font-size: 0.85rem; }

  .link-btn { background: none; border: 0; cursor: pointer; padding: 0; font-size: 1.1rem; line-height: 1; color: #c01818; }
  .link-btn.danger { color: #b00; }
  .link-btn:hover { opacity: 0.7; }

  @media (max-width: 700px) {
    table.size-grid { font-size: 0.85rem; }
    .garment-col, .garment-cell { min-width: 10rem; }
    .size-cell input { width: 2.5rem; }
  }
</style>
