<!-- src/lib/components/ModuleLabelModal.svelte -->
<!--
  Prints LED module shelf labels, either to the DYMO via the print bridge
  or to the Brother QL-810W through the browser's print dialog (see
  $lib/printing/brotherLabel.js). The choice is remembered per browser.

  Pass one or more module inventory rows (from getModuleInventory /
  getModule, so each carries its `signs`). Copies default to the shelf
  count, so "print labels for this part" gives every box on the shelf its
  own label. Labels go out one part number at a time.

  Bridge config (URL + key) is shared with LabelPrintModal and
  CustomLabelModal through getBridgeConfig / setBridgeConfig.
-->
<script>
  import { createEventDispatcher } from 'svelte';
  import {
    LABEL_SIZES,
    DEFAULT_LABEL_SIZE,
    buildModuleLabelData,
    buildModuleLabelXml,
    qrDataUrl
  } from '$lib/printing/dymoLabel.js';
  import {
    BROTHER_SIZES,
    DEFAULT_BROTHER_SIZE,
    brotherGeometry,
    printModuleLabelsBrother
  } from '$lib/printing/brotherLabel.js';
  import {
    getBridgeConfig,
    setBridgeConfig,
    bridgeHealth,
    bridgeGetPrinters,
    bridgePrint
  } from '$lib/printing/bridgeClient.js';

  export let open = false;
  export let modules = [];

  const dispatch = createEventDispatcher();
  const MAX_COPIES = 500; // the bridge caps a single job at 500

  const LS_KIND = 'hg_module_label_printer';     // 'dymo' | 'brother'
  const LS_BROTHER_SIZE = 'hg_brother_label_size';
  const lsGet = (k) => { try { return localStorage.getItem(k) || ''; } catch { return ''; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };

  let items = [];          // [{ mod, data, copies }]
  let kind = 'dymo';
  let sizeId = DEFAULT_LABEL_SIZE;
  let brotherSizeId = DEFAULT_BROTHER_SIZE;
  let printers = [];
  let selectedPrinter = '';
  let loading = false;
  let printing = false;
  let progress = '';
  let bridgeError = '';
  let bridgeStatus = 'unknown';
  let message = '';
  let qrPreviewUrl = '';

  let settingsOpen = false;
  let cfg = { url: '', key: '' };
  let cfgDraft = { url: '', key: '' };

  $: size = LABEL_SIZES[sizeId];
  $: brother = brotherGeometry(brotherSizeId);
  $: previewAspect = kind === 'brother'
    ? brother.boxW / brother.boxH
    : (size ? (size.widthIn / size.heightIn) : 3.1);
  $: sizeName = kind === 'brother' ? brother.size.name : size?.name;
  $: preview = items[0]?.data || null;
  $: if (preview) refreshQr(preview.qrText);
  $: totalLabels = items.reduce((n, it) => n + (Number(it.copies) || 0), 0);

  let lastOpen = false;
  $: if (open && !lastOpen) {
    lastOpen = true;
    message = ''; bridgeError = ''; progress = '';
    items = (modules || []).map((mod) => ({
      mod,
      data: buildModuleLabelData(mod),
      copies: Math.min(MAX_COPIES, Math.max(1, Number(mod.on_hand) || 1))
    }));
    kind = lsGet(LS_KIND) === 'brother' ? 'brother' : 'dymo';
    const bs = lsGet(LS_BROTHER_SIZE);
    if (BROTHER_SIZES[bs]) brotherSizeId = bs;
    loadCfg();
    if (kind === 'dymo') detectPrinters();
  } else if (!open && lastOpen) {
    lastOpen = false;
  }

  async function refreshQr(text) {
    try { qrPreviewUrl = await qrDataUrl(text, 200); }
    catch { qrPreviewUrl = ''; }
  }

  function loadCfg() {
    cfg = getBridgeConfig();
    cfgDraft = { url: cfg.url, key: cfg.key };
  }

  async function detectPrinters() {
    loading = true; bridgeError = '';
    try {
      await bridgeHealth();
      bridgeStatus = 'ok';
      printers = await bridgeGetPrinters();
      if (printers.length && !selectedPrinter) selectedPrinter = printers[0].name;
      if (!printers.length) bridgeError = 'Bridge is reachable but reports no LabelWriter. Is DYMO Connect running on the RIP?';
    } catch (e) {
      bridgeStatus = 'down';
      bridgeError = e.message || 'Could not reach the print bridge.';
    } finally {
      loading = false;
    }
  }

  function setKind(k) {
    kind = k;
    lsSet(LS_KIND, k);
    bridgeError = ''; message = '';
    if (k === 'dymo' && bridgeStatus !== 'ok') detectPrinters();
  }
  $: if (open) lsSet(LS_BROTHER_SIZE, brotherSizeId);

  async function doPrintBrother() {
    const toPrint = items.filter((it) => Number(it.copies) > 0);
    if (!toPrint.length) { bridgeError = 'Set at least one label to print.'; return; }
    printing = true; message = ''; bridgeError = '';
    try {
      progress = 'Opening the print window…';
      await printModuleLabelsBrother(
        toPrint.map((it) => ({ data: it.data, copies: Math.min(MAX_COPIES, Math.floor(Number(it.copies))) })),
        brotherSizeId
      );
      message = `Sent ${totalLabels} label${totalLabels === 1 ? '' : 's'} to the print window.`;
    } catch (e) {
      bridgeError = e.message || 'Could not open the print window.';
    } finally {
      printing = false;
      progress = '';
    }
  }

  async function doPrint() {
    if (kind === 'brother') return doPrintBrother();
    if (!selectedPrinter) { bridgeError = 'Choose a printer first.'; return; }
    const toPrint = items.filter((it) => Number(it.copies) > 0);
    if (!toPrint.length) { bridgeError = 'Set at least one label to print.'; return; }
    printing = true; message = ''; bridgeError = '';
    let sent = 0;
    try {
      for (let i = 0; i < toPrint.length; i++) {
        const it = toPrint[i];
        const copies = Math.min(MAX_COPIES, Math.floor(Number(it.copies)));
        progress = `Printing ${it.data.partNo} (${i + 1} of ${toPrint.length})…`;
        const xml = await buildModuleLabelXml(it.data, sizeId);
        await bridgePrint({ printerName: selectedPrinter, labelXml: xml, copies });
        sent += copies;
      }
      message = `Sent ${sent} label${sent === 1 ? '' : 's'} to ${selectedPrinter}.`;
    } catch (e) {
      bridgeError = `${e.message || 'Print failed.'}${sent ? ` (${sent} label${sent === 1 ? '' : 's'} already sent)` : ''}`;
    } finally {
      printing = false;
      progress = '';
    }
  }

  function saveSettings() {
    setBridgeConfig(cfgDraft);
    loadCfg();
    settingsOpen = false;
    detectPrinters();
  }
  function clearSettings() {
    setBridgeConfig({ url: '', key: '' });
    loadCfg();
  }

  function close() {
    open = false;
    dispatch('close');
  }
  function onKey(e) {
    if (!open) return;
    if (e.key === 'Escape') {
      if (settingsOpen) settingsOpen = false;
      else close();
    }
  }
</script>

<svelte:window on:keydown={onKey} />

{#if open}
  <div class="modal-backdrop" on:click|self={close} role="dialog" aria-modal="true">
    <div class="modal-panel">
      <header class="modal-head">
        <h2>Print Module Labels</h2>
        <div class="head-right">
          {#if kind === 'dymo'}
            <span class="bridge-dot" class:ok={bridgeStatus === 'ok'} class:down={bridgeStatus === 'down'} title="Bridge status" />
            <button class="icon-btn" on:click={() => { loadCfg(); settingsOpen = !settingsOpen; }} title="Bridge settings">⚙</button>
          {/if}
          <button class="close-x" on:click={close} aria-label="Close">×</button>
        </div>
      </header>

      {#if settingsOpen && kind === 'dymo'}
        <div class="settings-pane">
          <div class="form-group">
            <label>Bridge URL</label>
            <input type="text" placeholder="https://print.holmgraphics.ca  or  http://10.10.1.30:41960" bind:value={cfgDraft.url} />
          </div>
          <div class="form-group">
            <label>Bridge API key</label>
            <input type="password" placeholder="(stored per-browser)" bind:value={cfgDraft.key} />
          </div>
          <div class="settings-actions">
            <button class="btn btn-ghost" on:click={clearSettings}>Reset</button>
            <div class="spacer" />
            <button class="btn btn-ghost" on:click={() => settingsOpen = false}>Cancel</button>
            <button class="btn btn-primary" on:click={saveSettings}>Save</button>
          </div>
        </div>
      {/if}

      <div class="modal-body">
        {#if preview}
          <div class="preview-wrap">
            <div class="preview-label" style="aspect-ratio: {previewAspect} / 1;">
              {#if qrPreviewUrl}<img class="pl-qr" src={qrPreviewUrl} alt="QR" />{/if}
              <div class="pl-text">
                <div class="pl-fits">{#each preview.fitsLines as line}<div>{line}</div>{/each}</div>
                <div class="pl-small">{preview.partNo}</div>
                {#if preview.detail}<div class="pl-small">{preview.detail}</div>{/if}
              </div>
            </div>
            <div class="preview-caption">
              {sizeName}{items.length > 1 ? ` — showing ${preview.partNo}` : ''}
            </div>
          </div>
        {/if}

        <div class="form-group">
          <label>Labels to print ({totalLabels})</label>
          <div class="item-list">
            {#each items as it}
              <div class="item-row">
                <span class="mono">{it.data.partNo}</span>
                <span class="text-muted">{it.mod.on_hand == null ? 'not counted' : `${it.mod.on_hand} on shelf`}</span>
                <input type="number" min="0" max={MAX_COPIES} bind:value={it.copies} aria-label="Copies" />
              </div>
            {/each}
          </div>
        </div>

        <div class="kind-toggle" role="group" aria-label="Printer">
          <button class:on={kind === 'dymo'} on:click={() => setKind('dymo')}>DYMO</button>
          <button class:on={kind === 'brother'} on:click={() => setKind('brother')}>Brother QL-810W</button>
        </div>

        {#if kind === 'brother'}
          <div class="form-group">
            <label>Roll in the Brother</label>
            <select bind:value={brotherSizeId}>
              {#each Object.values(BROTHER_SIZES) as s}
                <option value={s.id}>{s.name}</option>
              {/each}
            </select>
          </div>
          <p class="hint">
            The print window opens next. Pick <strong>Brother QL-810W</strong> and set Paper size to
            <strong>{brother.size.androidPaper}</strong> on a phone ({brother.size.widthMm}mm x {brother.size.lengthMm}mm on a PC),
            Margins <strong>None</strong>, Scale <strong>Default</strong>.
          </p>
          {#if brother.size.id === 'DK-1201'}
            <div class="paper-warn">
              ⚠ Not <strong>1.1" x 39"</strong>. That is the continuous-tape size: the printer refuses it on
              DK-1201 labels and nothing prints. Check it every time before tapping Print.
            </div>
          {:else if brother.size.androidPaper.endsWith('39"')}
            <div class="paper-warn">
              ⚠ On a phone the only size for this tape is {brother.size.androidPaper}, which feeds about a metre
              per label. Use DK-1201 labels instead.
            </div>
          {:else}
            <div class="paper-warn">
              ⚠ Use exactly <strong>{brother.size.androidPaper}</strong>. Any other size and the printer refuses the
              job ("Roll type mismatch").
            </div>
          {/if}
        {:else}
        <div class="row-2">
          <div class="form-group">
            <label>Label size</label>
            <select bind:value={sizeId}>
              {#each Object.values(LABEL_SIZES) as s}
                <option value={s.id}>{s.name}</option>
              {/each}
            </select>
          </div>
          <div class="form-group">
            <label>Printer (via bridge)</label>
            <div class="printer-row">
              <select bind:value={selectedPrinter} disabled={!printers.length}>
                {#if !printers.length}
                  <option value="">— none detected —</option>
                {:else}
                  {#each printers as p}
                    <option value={p.name}>{p.name}{p.modelName ? ` (${p.modelName})` : ''}</option>
                  {/each}
                {/if}
              </select>
              <button class="btn btn-ghost" type="button" on:click={detectPrinters} disabled={loading}>{loading ? '…' : '↻'}</button>
            </div>
          </div>
        </div>
        {/if}

        {#if progress}<div class="notice">{progress}</div>{/if}
        {#if bridgeError}<div class="notice notice-error">{bridgeError}</div>{/if}
        {#if message}<div class="notice notice-ok">{message}</div>{/if}
      </div>

      <footer class="modal-foot">
        <div class="spacer" />
        <button class="btn btn-ghost" on:click={close}>Close</button>
        <button class="btn btn-primary" on:click={doPrint} disabled={printing || (kind === 'dymo' && !selectedPrinter) || totalLabels === 0}>
          {printing ? 'Printing…' : `🏷 Print ${totalLabels} label${totalLabels === 1 ? '' : 's'}`}
        </button>
      </footer>
    </div>
  </div>
{/if}

<style>
  .modal-backdrop {
    position: fixed; inset: 0; background: rgba(10, 12, 16, 0.55);
    display: flex; align-items: center; justify-content: center;
    z-index: 2000; padding: 24px;
  }
  .modal-panel {
    background: var(--surface);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-lg);
    width: min(620px, 100%);
    max-height: 92vh;
    display: flex; flex-direction: column;
    overflow: hidden;
  }
  .modal-head {
    display: flex; align-items: center; justify-content: space-between;
    padding: 14px 20px;
    border-bottom: 1px solid var(--border);
  }
  .modal-head h2 {
    font-family: var(--font-display);
    font-size: 1.2rem; letter-spacing: 0.04em; text-transform: uppercase;
    margin: 0;
  }
  .head-right { display: flex; align-items: center; gap: 8px; }
  .bridge-dot { width: 10px; height: 10px; border-radius: 50%; background: var(--text-dim); display: inline-block; }
  .bridge-dot.ok   { background: var(--green); }
  .bridge-dot.down { background: var(--red); }
  .icon-btn, .close-x {
    background: transparent; border: none; cursor: pointer;
    color: var(--text-muted); padding: 4px 8px; border-radius: var(--radius);
    line-height: 1; font-size: 1.1rem;
  }
  .icon-btn:hover, .close-x:hover { background: var(--hover); color: var(--text); }
  .close-x { font-size: 1.4rem; }

  .modal-body { padding: 18px 20px; display: flex; flex-direction: column; gap: 14px; overflow: auto; }

  .preview-wrap { display: flex; flex-direction: column; gap: 6px; }
  .preview-label {
    background: white; color: black;
    border: 1px solid var(--border); border-radius: 8px;
    padding: 6px 10px; display: flex; align-items: center; gap: 10px;
    overflow: hidden; font-family: Arial, sans-serif;
    max-width: 420px; width: 100%; margin: 0 auto;
  }
  .pl-qr { height: 100%; aspect-ratio: 1; object-fit: contain; }
  .pl-text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .pl-fits { font-weight: 700; font-size: 0.95rem; line-height: 1.15; overflow: hidden; }
  .pl-fits div { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .pl-small { font-size: 0.65rem; line-height: 1.2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .preview-caption { color: var(--text-muted); font-size: 0.78rem; text-align: center; }

  .form-group { display: flex; flex-direction: column; gap: 4px; }
  .form-group label {
    font-size: 0.78rem; color: var(--text-muted);
    text-transform: uppercase; letter-spacing: 0.04em;
  }
  .form-group input, .form-group select {
    background: var(--input-bg, var(--surface)); color: var(--text);
    border: 1px solid var(--border); border-radius: var(--radius);
    padding: 8px 10px; font: inherit;
  }
  .kind-toggle { display: flex; border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; }
  .kind-toggle button { flex: 1; padding: 8px 10px; border: 0; background: var(--surface); color: var(--text); cursor: pointer; font: inherit; }
  .kind-toggle button + button { border-left: 1px solid var(--border); }
  .kind-toggle button.on { background: var(--accent, #c0392b); color: #fff; }
  .paper-warn { background: rgba(234, 179, 8, 0.15); border: 1px solid rgba(234, 179, 8, 0.5); border-radius: var(--radius); padding: 8px 10px; font-size: 0.85rem; line-height: 1.4; }
  .hint { color: var(--text-muted); font-size: 0.82rem; margin: 0; line-height: 1.4; }
  .row-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .printer-row { display: flex; gap: 6px; }
  .printer-row select { flex: 1; min-width: 0; }

  .item-list { max-height: 220px; overflow: auto; border: 1px solid var(--border); border-radius: var(--radius); }
  .item-row { display: grid; grid-template-columns: 1fr auto 80px; gap: 10px; align-items: center; padding: 6px 10px; border-bottom: 1px solid var(--border); }
  .item-row:last-child { border-bottom: 0; }
  .item-row input { padding: 4px 6px; text-align: right; }
  .mono { font-family: var(--font-mono, monospace); }
  .text-muted { color: var(--text-muted); font-size: 0.82rem; }

  .notice { padding: 8px 10px; border-radius: var(--radius); font-size: 0.85rem; background: var(--hover); }
  .notice-error { background: rgba(220, 53, 69, 0.12); color: var(--red, #dc3545); border: 1px solid rgba(220, 53, 69, 0.3); }
  .notice-ok    { background: rgba(40, 167, 69, 0.12); color: var(--green, #28a745); border: 1px solid rgba(40, 167, 69, 0.3); }

  .modal-foot { display: flex; align-items: center; gap: 8px; padding: 14px 20px; border-top: 1px solid var(--border); }
  .modal-foot .spacer, .settings-actions .spacer { flex: 1; }
  .btn { padding: 8px 14px; border-radius: var(--radius); border: 1px solid var(--border); background: var(--surface); color: var(--text); cursor: pointer; font: inherit; }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn-primary { background: var(--accent, #c0392b); color: white; border-color: transparent; }
  .btn-primary:hover:not(:disabled) { filter: brightness(1.1); }
  .btn-ghost { background: transparent; }
  .btn-ghost:hover:not(:disabled) { background: var(--hover); }

  .settings-pane {
    padding: 14px 20px; border-bottom: 1px solid var(--border);
    background: var(--surface-alt, var(--surface));
    display: flex; flex-direction: column; gap: 10px;
  }
  .settings-actions { display: flex; align-items: center; gap: 8px; }

  @media (max-width: 640px) {
    .row-2 { grid-template-columns: 1fr; }
  }
</style>
