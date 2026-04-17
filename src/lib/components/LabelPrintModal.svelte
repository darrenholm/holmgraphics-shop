<!-- src/lib/components/LabelPrintModal.svelte -->
<script>
  import { onMount, createEventDispatcher } from 'svelte';
  import {
    LABEL_SIZES,
    DEFAULT_LABEL_SIZE,
    buildLabelData,
    buildDymoLabelXml,
    qrDataUrl,
    downloadLabelPdf
  } from '$lib/printing/dymoLabel.js';
  import {
    getBridgeConfig,
    setBridgeConfig,
    bridgeHealth,
    bridgeGetPrinters,
    bridgePrint
  } from '$lib/printing/bridgeClient.js';

  export let project;
  export let open = false;

  const dispatch = createEventDispatcher();

  let sizeId = DEFAULT_LABEL_SIZE;
  let copies = 1;
  let printers = [];
  let selectedPrinter = '';
  let qrOverride = '';
  let qrPreviewUrl = '';
  let loading = false;
  let printing = false;
  let bridgeError = '';
  let bridgeStatus = 'unknown'; // 'ok' | 'down' | 'unknown'
  let message = '';

  // Settings pane
  let settingsOpen = false;
  let cfg = { url: '', key: '' };
  let cfgDraft = { url: '', key: '' };

  $: data = project
    ? buildLabelData(project, qrOverride ? { qrText: qrOverride } : {})
    : null;
  $: size = LABEL_SIZES[sizeId];
  $: previewAspect = size ? (size.widthIn / size.heightIn) : 1.8;
  $: if (data) refreshQrPreview(data.qrText);

  async function refreshQrPreview(text) {
    try { qrPreviewUrl = await qrDataUrl(text, 200); }
    catch { qrPreviewUrl = ''; }
  }

  function loadCfg() {
    cfg = getBridgeConfig();
    cfgDraft = { url: cfg.url, key: cfg.key };
  }

  async function detectPrinters() {
    loading = true; bridgeError = ''; message = '';
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

  async function doPrint() {
    if (!selectedPrinter) { bridgeError = 'Choose a printer first.'; return; }
    printing = true; message = ''; bridgeError = '';
    try {
      const xml = await buildDymoLabelXml(data, sizeId);
      await bridgePrint({ printerName: selectedPrinter, labelXml: xml, copies });
      message = `Sent ${copies} label${copies > 1 ? 's' : ''} to ${selectedPrinter}.`;
    } catch (e) {
      bridgeError = e.message || 'Print failed.';
    } finally {
      printing = false;
    }
  }

  async function doPdf() {
    try {
      await downloadLabelPdf(data, sizeId, `Label-Job-${data.jobNumber}.pdf`);
      message = 'PDF downloaded.';
    } catch (e) {
      bridgeError = e.message || 'PDF generation failed.';
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
  function onKey(e) { if (e.key === 'Escape') { if (settingsOpen) settingsOpen = false; else close(); } }

  onMount(() => {
    loadCfg();
    detectPrinters();
  });
</script>

<svelte:window on:keydown={onKey} />

{#if open && data}
  <div class="modal-backdrop" on:click|self={close} role="dialog" aria-modal="true">
    <div class="modal-panel">
      <header class="modal-head">
        <h2>Print Part Label</h2>
        <div class="head-right">
          <span class="bridge-dot" class:ok={bridgeStatus === 'ok'} class:down={bridgeStatus === 'down'} title="Bridge status" />
          <button class="icon-btn" on:click={() => { loadCfg(); settingsOpen = !settingsOpen; }} title="Bridge settings">⚙</button>
          <button class="close-x" on:click={close} aria-label="Close">×</button>
        </div>
      </header>

      {#if settingsOpen}
        <div class="settings-pane">
          <div class="form-group">
            <label>Bridge URL</label>
            <input
              type="text"
              placeholder="https://print.holmgraphics.ca  or  http://10.10.1.30:41960"
              bind:value={cfgDraft.url}
            />
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
          <p class="hint">
            Leave blank to use the site's build defaults. Overrides stored in this browser only
            (useful when on the shop LAN — point to <code>http://10.10.1.30:41960</code>).
          </p>
        </div>
      {/if}

      <div class="modal-body">

        <!-- Label preview -->
        <div class="preview-wrap">
          <div class="preview-label" style="aspect-ratio: {previewAspect} / 1;">
            <div class="pl-qr">
              {#if qrPreviewUrl}<img src={qrPreviewUrl} alt="QR preview" />{/if}
            </div>
            <div class="pl-text">
              <div class="pl-client">{data.clientName}</div>
              <div class="pl-jobno">Job #{data.jobNumber}</div>
              <div class="pl-jobname">{data.jobName || ''}</div>
            </div>
          </div>
          <div class="preview-caption">{size?.name}</div>
        </div>

        <!-- Controls -->
        <div class="controls">
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
              <button class="btn btn-ghost" type="button" on:click={detectPrinters} disabled={loading}>
                {loading ? '…' : '↻'}
              </button>
            </div>
          </div>

          <div class="form-group">
            <label>Copies</label>
            <input type="number" min="1" max="50" bind:value={copies} />
          </div>

          <div class="form-group">
            <label>QR code target (optional)</label>
            <input type="text" placeholder="Defaults to this job's URL" bind:value={qrOverride} />
          </div>

          {#if bridgeError}
            <div class="notice notice-error">{bridgeError}</div>
          {/if}
          {#if message}
            <div class="notice notice-ok">{message}</div>
          {/if}
        </div>
      </div>

      <footer class="modal-foot">
        <button class="btn btn-ghost" on:click={doPdf}>📄 Download PDF</button>
        <div class="spacer" />
        <button class="btn btn-ghost" on:click={close}>Cancel</button>
        <button class="btn btn-primary" on:click={doPrint} disabled={printing || !selectedPrinter}>
          {printing ? 'Printing…' : '🏷 Print to DYMO'}
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
    width: min(720px, 100%);
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
    font-size: 1.2rem;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    margin: 0;
  }
  .head-right { display: flex; align-items: center; gap: 8px; }
  .bridge-dot {
    width: 10px; height: 10px; border-radius: 50%;
    background: var(--text-dim);
    display: inline-block;
  }
  .bridge-dot.ok   { background: var(--green); }
  .bridge-dot.down { background: var(--red); }

  .icon-btn, .close-x {
    background: transparent; border: none; cursor: pointer;
    color: var(--text-muted);
    padding: 4px 8px; border-radius: var(--radius);
    line-height: 1;
  }
  .icon-btn  { font-size: 1.1rem; }
  .close-x   { font-size: 1.6rem; }
  .icon-btn:hover, .close-x:hover { color: var(--red); background: var(--surface-2); }

  .settings-pane {
    background: var(--surface-2);
    border-bottom: 1px solid var(--border);
    padding: 16px 20px;
  }
  .settings-actions { display: flex; align-items: center; gap: 8px; margin-top: 4px; }
  .hint { font-size: 0.78rem; color: var(--text-dim); margin-top: 10px; }
  .hint code { background: var(--surface-3); padding: 1px 4px; border-radius: 3px; }

  .modal-body {
    padding: 20px;
    overflow: auto;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 24px;
  }
  @media (max-width: 620px) { .modal-body { grid-template-columns: 1fr; } }

  .preview-wrap { display: flex; flex-direction: column; gap: 8px; }
  .preview-label {
    background: #fff;
    border: 1px dashed var(--border-mid);
    border-radius: 6px;
    padding: 8px;
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 10px;
    align-items: stretch;
    min-height: 130px;
    width: 100%;
  }
  .pl-qr { display: flex; align-items: center; justify-content: center; background: #fff; }
  .pl-qr img { width: 100%; height: 100%; object-fit: contain; max-width: 140px; }
  .pl-text { display: flex; flex-direction: column; justify-content: center; gap: 4px; min-width: 0; }
  .pl-client {
    font-family: var(--font-display); font-weight: 700; font-size: 0.95rem;
    text-transform: uppercase; letter-spacing: 0.03em;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .pl-jobno {
    font-family: var(--font-display); font-weight: 900; font-size: 1.15rem; color: var(--red);
  }
  .pl-jobname {
    font-size: 0.85rem; color: var(--text-muted);
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
  }
  .preview-caption { font-size: 0.8rem; color: var(--text-dim); text-align: center; }

  .controls { display: flex; flex-direction: column; }
  .printer-row { display: flex; gap: 8px; }
  .printer-row select { flex: 1; }
  .printer-row .btn { padding: 8px 12px; }

  .notice { padding: 8px 12px; border-radius: var(--radius); font-size: 0.85rem; margin-top: 8px; }
  .notice-error { background: #fee2e2; color: #991b1b; border: 1px solid #fca5a5; }
  .notice-ok    { background: #dcfce7; color: #166534; border: 1px solid #bbf7d0; }

  .modal-foot {
    display: flex; align-items: center; gap: 10px;
    padding: 14px 20px; border-top: 1px solid var(--border);
    background: var(--surface-2);
  }
  .spacer { flex: 1; }
</style>
