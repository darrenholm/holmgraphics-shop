<!--
  RosterGrid.svelte — Step 4 of the decoration builder.

  Shown only when the parent has at least one back-of-jersey location selected
  (Upper back / Full back). One row per garment in the line item. Buyer fills
  the name and number that print on the back.

  Prop contract:
    bind:roster     — array of { row, size, name, number }. Owned by parent.
    expectedRows    — total qty in the line item's size_grid. The component
                      pads or truncates the roster to match this.
    sizeBreakdown   — [{ size, quantity }] from the line item's size_grid,
                      in entered order. Used to auto-fill the size column
                      (rows 1..6 = first size, 7..14 = second, etc.).
    offeredSizes    — array of size strings the line item's SKU offers; used
                      as options in the size dropdown so buyer can override.

  Paste-from-clipboard:
    - Reads navigator.clipboard.readText()
    - Auto-detects TSV vs CSV (TSV wins if any line contains tabs)
    - Auto-skips header row when first row's last column is non-numeric
    - Column-count handling:
        1 col  → name
        2 cols → name, number
        3 cols → size, name, number
        4+     → row, size, name, number (row ignored)
-->
<script>
  export let roster = [];
  export let expectedRows = 0;
  export let sizeBreakdown = [];
  export let offeredSizes = [];

  // Friendly labels for sizes whose codes are industry jargon. Underlying
  // size values stay as the canonical code (matches what the cart, catalog,
  // and supplier feeds use); only the display string changes.
  const SIZE_LABELS = {
    OSFA: 'One size',
    OS:   'One size'
  };
  const labelFor = (s) => SIZE_LABELS[s] || s;

  let pasteError = '';
  let pasteSuccess = '';

  function defaultSize(rowIdx) {
    let cum = 0;
    for (const seg of sizeBreakdown) {
      cum += Number(seg.quantity) || 0;
      if (rowIdx < cum) return seg.size;
    }
    return offeredSizes[0] || '';
  }

  // Sync roster to (expectedRows, sizeBreakdown). Pad/truncate length, and
  // refresh default size for any row the buyer hasn't filled yet (name +
  // number both empty). Filled rows keep their data — including any manual
  // size override — per the spec's "preserve existing entries" rule.
  // Idempotent: only reassigns when something actually changes, so the
  // reactive block doesn't loop.
  $: {
    if (Array.isArray(roster)) {
      const next = roster.slice(0, expectedRows);
      for (let i = next.length; i < expectedRows; i++) {
        next.push({ row: i + 1, size: '', name: '', number: '' });
      }
      let changed = next.length !== roster.length;
      for (let i = 0; i < next.length; i++) {
        const isEmpty =
          !(next[i].name && String(next[i].name).trim()) &&
          !(next[i].number && String(next[i].number).trim());
        const wantSize = isEmpty ? defaultSize(i) : next[i].size;
        if (next[i].row !== i + 1 || next[i].size !== wantSize) {
          next[i] = { ...next[i], row: i + 1, size: wantSize };
          changed = true;
        }
      }
      if (changed) roster = next;
    }
  }

  function updateRow(i, patch) {
    roster = roster.map((r, idx) => (idx === i ? { ...r, ...patch } : r));
  }

  function clearAll() {
    pasteError = '';
    pasteSuccess = '';
    roster = roster.map((_, i) => ({
      row: i + 1, size: defaultSize(i), name: '', number: ''
    }));
  }

  function parsePastedRoster(text) {
    const lines = text
      .replace(/\r\n/g, '\n')
      .split('\n')
      .filter((l) => l.trim().length > 0);
    if (lines.length === 0) return { rows: [], headerDetected: false };

    const useTab = lines.some((l) => l.includes('\t'));
    const delim = useTab ? '\t' : ',';
    const split = lines.map((l) => l.split(delim).map((c) => c.trim()));

    // Header detection: last cell of first row non-numeric.
    let dataStart = 0;
    let headerDetected = false;
    if (split.length > 1) {
      const firstLast = split[0][split[0].length - 1] || '';
      if (firstLast && !/^\d+$/.test(firstLast.replace(/^#/, ''))) {
        headerDetected = true;
        dataStart = 1;
      }
    }

    const rows = [];
    for (let i = dataStart; i < split.length; i++) {
      const c = split[i];
      if (c.length === 1)        rows.push({ name: c[0] });
      else if (c.length === 2)   rows.push({ name: c[0], number: c[1] });
      else if (c.length === 3)   rows.push({ size: c[0], name: c[1], number: c[2] });
      else                       rows.push({ size: c[1], name: c[2], number: c[3] });
    }
    return { rows, headerDetected };
  }

  async function pasteFromClipboard() {
    pasteError = '';
    pasteSuccess = '';
    if (expectedRows === 0) {
      pasteError = 'Add garment quantities first.';
      return;
    }
    let text = '';
    try {
      text = await navigator.clipboard.readText();
    } catch (e) {
      pasteError = "Couldn't read the clipboard. Copy your data and try again — your browser may prompt for permission.";
      return;
    }
    if (!text.trim()) {
      pasteError = 'Clipboard is empty.';
      return;
    }
    const { rows: pasted, headerDetected } = parsePastedRoster(text);
    if (pasted.length === 0) {
      pasteError = 'No usable rows found in the clipboard text.';
      return;
    }
    const next = roster.map((r, i) => {
      const p = pasted[i];
      if (!p) return { ...r, row: i + 1 };
      return {
        row:    i + 1,
        size:   p.size   ?? r.size   ?? defaultSize(i),
        name:   p.name   ?? r.name   ?? '',
        number: p.number ?? r.number ?? ''
      };
    });
    roster = next;
    const used = Math.min(pasted.length, expectedRows);
    const extras = pasted.length - expectedRows;
    let msg = `Pasted ${used} row${used === 1 ? '' : 's'}.`;
    if (headerDetected) msg += ' Header row skipped.';
    if (extras > 0)
      msg += ` ${extras} extra row${extras === 1 ? '' : 's'} ignored — add more garments above to fit them.`;
    pasteSuccess = msg;
  }

  $: filledCount = roster.filter((r) => (r.name && r.name.trim()) || (r.number && r.number.toString().trim())).length;
</script>

<div class="roster-grid">
  <header class="roster-header">
    <h3>Names &amp; numbers</h3>
    <p class="hint small">
      {#if expectedRows === 0}
        Add garment quantities above to build the roster.
      {:else}
        One row per garment ({filledCount} of {expectedRows} filled).
        Names and numbers print on the back.
      {/if}
    </p>
  </header>

  {#if expectedRows > 0}
    <div class="actions">
      <button type="button" class="btn-paste" on:click={pasteFromClipboard}>
        Paste from spreadsheet
      </button>
      <button type="button" class="link-btn" on:click={clearAll}>Clear all</button>
      <span class="hint small grow">
        Tip: copy two columns from your sheet (name, number) and click paste.
      </span>
    </div>

    {#if pasteError}<p class="alert error">{pasteError}</p>{/if}
    {#if pasteSuccess}<p class="alert success">{pasteSuccess}</p>{/if}

    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th class="row-col">#</th>
            <th class="size-col">Size</th>
            <th class="name-col">Name on back</th>
            <th class="num-col">Number</th>
          </tr>
        </thead>
        <tbody>
          {#each roster as r, i (i)}
            <tr>
              <td class="row-col">{i + 1}</td>
              <td class="size-col">
                {#if offeredSizes.length > 0}
                  <select
                    value={r.size}
                    on:change={(e) => updateRow(i, { size: e.target.value })}>
                    {#each offeredSizes as s}
                      <option value={s} selected={r.size === s}>{labelFor(s)}</option>
                    {/each}
                  </select>
                {:else}
                  <input
                    type="text"
                    value={r.size || ''}
                    on:input={(e) => updateRow(i, { size: e.target.value })} />
                {/if}
              </td>
              <td class="name-col">
                <input
                  type="text"
                  placeholder="e.g. SMITH"
                  value={r.name || ''}
                  on:input={(e) => updateRow(i, { name: e.target.value })} />
              </td>
              <td class="num-col">
                <input
                  type="text"
                  inputmode="numeric"
                  maxlength="3"
                  placeholder="#"
                  value={r.number || ''}
                  on:input={(e) => updateRow(i, { number: e.target.value })} />
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>

<style>
  .roster-grid {
    background: white;
    border: 1px solid #e4e4e7;
    border-radius: 0.5rem;
    padding: 1rem 1.1rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  .roster-header h3 { margin: 0 0 0.25rem; font-size: 1rem; }
  .hint { color: #666; font-size: 0.9rem; margin: 0; }
  .small { font-size: 0.85rem; }
  .muted { color: #888; }

  .actions { display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap; }
  .grow { flex-grow: 1; min-width: 0; }

  .btn-paste {
    background: #c01818; color: white; border: none;
    padding: 0.5rem 0.9rem; border-radius: 0.35rem; font-weight: 600;
    cursor: pointer; font-size: 0.9rem;
  }
  .btn-paste:hover { background: #a01010; }

  .link-btn {
    background: none; border: 0; color: #c01818; cursor: pointer;
    padding: 0; font-size: 0.9rem;
  }
  .link-btn:hover { text-decoration: underline; }

  .alert { padding: 0.5rem 0.75rem; border-radius: 0.3rem; font-size: 0.88rem; margin: 0; }
  .alert.error { background: #fee; color: #b00; }
  .alert.success { background: #e8f6ec; color: #1f6b34; }

  .table-wrap { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; font-size: 0.92rem; }
  thead th {
    background: #f7f7f8; font-weight: 600; font-size: 0.82rem;
    color: #444; padding: 0.45rem 0.55rem; text-align: left;
    border-bottom: 1px solid #e4e4e7;
  }
  tbody td { padding: 0.35rem 0.55rem; border-bottom: 1px dashed #f0f0f0; }
  tbody tr:last-child td { border-bottom: 0; }

  .row-col  { width: 2.5rem; text-align: right; color: #888; font-variant-numeric: tabular-nums; }
  .size-col { width: 5rem; }
  .num-col  { width: 5rem; }
  .name-col { min-width: 12rem; }

  td input, td select {
    width: 100%; padding: 0.32rem 0.45rem;
    border: 1px solid #d4d4d8; border-radius: 0.25rem;
    font-size: 0.9rem; box-sizing: border-box;
  }
  td input:focus, td select:focus { outline: 2px solid #c01818; outline-offset: 1px; border-color: transparent; }
  .num-col input { font-variant-numeric: tabular-nums; text-align: center; }
</style>
