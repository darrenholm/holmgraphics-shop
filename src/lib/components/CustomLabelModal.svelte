<!-- src/lib/components/CustomLabelModal.svelte -->
<!--
  Free-text label printer. Staff types whatever they want into a multi-line
  textarea; we render it onto the chosen DYMO label and send the XML to the
  print bridge. No QR code, no project binding — just text.

  Mounted globally from src/routes/+layout.svelte so it can be opened from
  the sidebar from anywhere in the app.

  Bridge config (URL + key) is shared with LabelPrintModal via getBridgeConfig
  / setBridgeConfig — set it once in either modal and both pick it up.
-->
<script>
  import { createEventDispatcher } from 'svelte';
  import {
    LABEL_SIZES,
    DEFAULT_LABEL_SIZE,
    buildCustomLabelXml
  } from '$lib/printing/dymoLabel.js';
  import {
    getBridgeConfig,
    setBridgeConfig,
    bridgeHealth,
    bridgeGetPrinters,
    bridgePrint
  } from '$lib/printing/bridgeClient.js';

  export let open = false;

  const dispatch = createEventDispatcher();

  let labelText = '';
  let sizeId = DEFAULT_LABEL_SIZE;
  let copies = 1;
  let printers = [];
  let selectedPrinter = '';
  let loading = false;
  let printing = false;
  let bridgeError = '';
  let bridgeStatus = 'unknown'; // 'ok' | 'down' | 'unknown'
  let message = '';

  // Settings pane (mirrors LabelPrintModal so the bridge URL/key are managed
  // once and shared across both modals via localStorage).
  let settingsOpen = false;
  let cfg = { url: '', key: '' };
  let cfgDraft = { url: '', key: '' };

  $: size = LABEL_SIZES[sizeId];
  $: previewAspect = size ? (size.widthIn / size.heightIn) : 1.8;

  // Re-detect printers each time the modal opens. Cheap operation, and the
  // RIP/printer state can change between sessions.
  let lastOpen = false;
  $: if (open && !lastOpen) {
    lastOpen = true;
    message = '';
    bridgeError = '';
    loadCfg();
    detectPrinters();
  } else if (!open && lastOpen) {
    lastOpen = false;
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
    if (!labelText.trim()) { bridgeError = 'Type something to print.'; return; }
    printing = true; message = ''; bridgeError = '';
    try {
      const xml = buildCustomLabelXml(labelText, sizeId);
      await bridgePrint({ printerName: selectedPrinter, labelXml: xml, copies });
      message = `Sent ${copies} label${copies > 1 ? 's' : ''} to ${selectedPrinter}.`;
    } catch (e) {
      bridgeError = e.message || 'Print failed.';
    } finally {
      printing = false;
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
        <h2>Print Custom Label</h2>
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
        <!-- Live preview -->
        <div class="preview-wrap">
          <div class="preview-label" style="aspect-ratio: {previewAspect} / 1;">
            <div class="pl-text-only" class:empty={!labelText.trim()}>
              {labelText.trim() || 'Type below…'}
            </div>
          </div>
          <div class="preview-caption">{size?.name}</div>
        </div>

        <!-- Controls -->
        <div class="controls">
          <div class="form-group">
            <label>Label text</label>
            <textarea
              bind:value={labelText}
              rows="5"
              placeholder="Type whatever should appear on the label. Newlines are preserved. Long text shrinks to fit."
            ></textarea>
          </div>

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

          {#if bridgeError}
            <div class="notice notice-error">{bridgeError}</div>
          {/if}
          {#if message}
            <div class="notice notice-ok">{message}</div>
          {/if}
        </div>
      </div>

      <footer class="modal-foot">
        <div class="spacer" />
        <button class="btn btn-ghost" on:click={close}>Cancel</button>
        <button class="btn btn-primary" on:click={doPrint} disabled={printing || !selectedPrinter || !labelText.trim()}>
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
    width: min(640px, 100%);
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
    font-size: 1.1rem;
  }
  .icon-btn:hover, .close-x:hover { background: var(--hover); color: var(--text); }
  .close-x { font-size: 1.4rem; }

  .modal-body {
    padding: 18px 20px;
    display: grid;
    grid-template-columns: minmax(180px, 260px) 1fr;
    gap: 24px;
    overflow: auto;
  }

  .preview-wrap { display: flex; flex-direction: column; gap: 8px; }
  .preview-label {
    background: white;
    color: black;
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 10px 12px;
    display: flex; align-items: center; justify-content: center;
    overflow: hidden;
    font-family: Arial, sans-serif;
  }
  .pl-text-only {
    width: 100%;
    text-align: center;
    white-space: pre-wrap;
    word-break: break-word;
    font-size: 0.85rem;
    line-height: 1.2;
    color: black;
  }
  .pl-text-only.empty { color: #999; font-style: italic; }
  .preview-caption {
    color: var(--text-muted);
    font-size: 0.78rem;
    text-align: center;
  }

  .controls { display: flex; flex-direction: column; gap: 12px; }
  .form-group { display: flex; flex-direction: column; gap: 4px; }
  .form-group label {
    font-size: 0.78rem; color: var(--text-muted);
    text-transform: uppercase; letter-spacing: 0.04em;
  }
  .form-group input[type="text"],
  .form-group input[type="number"],
  .form-group input[type="password"],
  .form-group select,
  .form-group textarea {
    background: var(--input-bg, var(--surface));
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 8px 10px;
    font: inherit;
  }
  .form-group textarea {
    resize: vertical;
    min-height: 90px;
    font-family: inherit;
  }
  .printer-row { display: flex; gap: 6px; }
  .printer-row select { flex: 1; }

  .notice { padding: 8px 10px; border-radius: var(--radius); font-size: 0.85rem; }
  .notice-error { background: rgba(220, 53, 69, 0.12); color: var(--red, #dc3545); border: 1px solid rgba(220, 53, 69, 0.3); }
  .notice-ok    { background: rgba(40, 167, 69, 0.12); color: var(--green, #28a745); border: 1px solid rgba(40, 167, 69, 0.3); }

  .modal-foot {
    display: flex; align-items: center; gap: 8px;
    padding: 14px 20px;
    border-top: 1px solid var(--border);
  }
  .modal-foot .spacer { flex: 1; }

  .btn {
    padding: 8px 14px;
    border-radius: var(--radius);
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--text);
    cursor: pointer;
    font: inherit;
  }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn-primary { background: var(--accent, #c0392b); color: white; border-color: transparent; }
  .btn-primary:hover:not(:disabled) { filter: brightness(1.1); }
  .btn-ghost { background: transparent; }
  .btn-ghost:hover:not(:disabled) { background: var(--hover); }

  .settings-pane {
    padding: 14px 20px;
    border-bottom: 1px solid var(--border);
    background: var(--surface-alt, var(--surface));
    display: flex; flex-direction: column; gap: 10px;
  }
  .settings-actions { display: flex; align-items: center; gap: 8px; }
  .settings-actions .spacer { flex: 1; }
  .hint { color: var(--text-muted); font-size: 0.8rem; margin: 0; }
  .hint code { background: var(--hover); padding: 1px 4px; border-radius: 3px; }

  @media (max-width: 640px) {
    .modal-body { grid-template-columns: 1fr; }
  }
</style>
