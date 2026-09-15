<!-- src/lib/components/DesignAssistant.svelte
     Claude chat panel on the staff job page. Staff describe the design, attach
     logos/photos (from the job folder or their computer), and get back layouts
     sized to the job that they can save into the job folder on L:.

     The component stays mounted while the job page is open (only `open`
     toggles), so closing the panel doesn't lose the conversation.

     The API holds no conversation state: `messages` here is the exact Claude
     history, posted back whole on every turn and only ever appended to.
     Logos are sent to Claude downscaled; the saved files get the originals. -->
<script>
  import { createEventDispatcher, tick } from 'svelte';
  import { api } from '$lib/api/client.js';
  import {
    listJobFiles,
    ensureJobFolder,
    uploadJobFile,
    fetchFileBlob
  } from '$lib/files/filesBridgeClient.js';
  import {
    IMAGE_RE,
    prepareImage,
    blobToDataUrl,
    inlineAssets,
    svgBlob,
    svgToPngBlob,
    layoutFilename
  } from '$lib/design/designAssets.js';

  export let project;
  export let clientFolderName = '';
  export let open = false;

  const dispatch = createEventDispatcher();

  let loadedFor = null;
  let status = null;
  let files = [];
  let filesError = '';
  let messages = [];
  let log = [];
  let pending = [];
  let input = '';
  let busy = false;
  let error = '';
  let attaching = '';
  let logEl;
  let fileInput;

  // name → { preview: downscaled data URL, path?: bridge path, blob?: File, full?: data URL }
  const assets = new Map();

  $: if (open && project && loadedFor !== project.id) init();
  $: imageFiles = files.filter((f) => IMAGE_RE.test(f.name));

  async function init() {
    loadedFor = project.id;
    error = '';
    try {
      status = await api.designAssistantStatus();
    } catch (e) {
      error = e.message || String(e);
    }
    await loadFiles();
  }

  async function loadFiles() {
    filesError = '';
    try {
      const data = await listJobFiles(clientFolderName, project.id);
      files = (data?.entries || []).filter((e) => e.type === 'file');
    } catch {
      files = [];
      filesError = "Can't reach the job folder (it only works on the shop network).";
    }
  }

  // Asset names end up inside an SVG attribute, so keep them quote-free.
  function cleanName(name) {
    return String(name || 'image').replace(/["'<>&]/g, '_');
  }

  function nameTaken(n) {
    return assets.has(n) || pending.some((p) => p.name === n);
  }

  function uniqueName(name) {
    if (!nameTaken(name)) return name;
    const dot = name.lastIndexOf('.');
    const base = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : '';
    for (let i = 2; ; i++) {
      const n = `${base}-${i}${ext}`;
      if (!nameTaken(n)) return n;
    }
  }

  async function attachFromFolder(entry) {
    const name = cleanName(entry.name);
    if (pending.some((p) => p.name === name)) return;
    attaching = entry.name;
    error = '';
    try {
      const { blob, url } = await fetchFileBlob(entry.path);
      URL.revokeObjectURL(url);
      const img = await prepareImage(blob);
      assets.set(name, { preview: img.dataUrl, path: entry.path });
      pending = [...pending, { name, ...img }];
    } catch (e) {
      error = e.message || String(e);
    } finally {
      attaching = '';
    }
  }

  async function attachFromComputer(ev) {
    const picked = [...(ev.target.files || [])];
    ev.target.value = '';
    error = '';
    for (const file of picked) {
      try {
        const name = uniqueName(cleanName(file.name));
        const img = await prepareImage(file);
        assets.set(name, { preview: img.dataUrl, blob: file });
        pending = [...pending, { name, ...img }];
      } catch (e) {
        error = `${file.name}: ${e.message || e}`;
      }
    }
  }

  async function scrollDown() {
    await tick();
    if (logEl) logEl.scrollTop = logEl.scrollHeight;
  }

  async function send() {
    const text = input.trim();
    if ((!text && !pending.length) || busy) return;

    const content = [];
    for (const a of pending) {
      content.push({ type: 'text', text: `Attached image: ${a.name}` });
      content.push({ type: 'image', source: { type: 'base64', media_type: a.media_type, data: a.base64 } });
    }
    content.push({ type: 'text', text: text || 'Here are the images for this job.' });

    const sentPending = pending;
    const sentInput = input;
    messages = [...messages, { role: 'user', content }];
    log = [...log, { role: 'staff', text, images: sentPending.map((a) => ({ name: a.name, src: a.dataUrl })) }];
    pending = [];
    input = '';
    busy = true;
    error = '';
    scrollDown();

    try {
      const res = await api.designAssistantChat(project.id, {
        messages,
        files: files.map((f) => ({ name: f.name }))
      });
      messages = [...messages, ...(res.newMessages || [])];
      const layouts = [];
      for (const l of res.layouts || []) {
        const previewSvg = await inlineAssets(l.svg, async (n) => assets.get(n)?.preview);
        layouts.push({
          ...l,
          previewUrl: URL.createObjectURL(svgBlob(previewSvg)),
          saving: '',
          saved: [],
          saveError: ''
        });
      }
      log = [...log, { role: 'assistant', text: res.reply, layouts }];
      if (status) status = { ...status, month_spend_usd: res.month_spend_usd, cap_usd: res.cap_usd };
    } catch (e) {
      // Put the message back so the history stays valid and nothing is lost.
      messages = messages.slice(0, -1);
      log = log.slice(0, -1);
      pending = sentPending;
      input = sentInput;
      error = e.message || String(e);
    } finally {
      busy = false;
      scrollDown();
    }
  }

  function onKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  async function fullDataUrl(name) {
    const a = assets.get(name);
    if (!a) return null;
    if (!a.full) {
      if (a.blob) {
        a.full = await blobToDataUrl(a.blob);
      } else if (a.path) {
        const { blob, url } = await fetchFileBlob(a.path);
        URL.revokeObjectURL(url);
        a.full = await blobToDataUrl(blob);
      }
    }
    return a.full || a.preview;
  }

  // Only used if this save creates the job folder. Long descriptions make
  // long, mid-word-truncated folder names, so keep it to a few words.
  function shortDesc(s) {
    const t = String(s || '').trim();
    if (t.length <= 40) return t;
    const cut = t.slice(0, 40);
    return cut.slice(0, cut.lastIndexOf(' ') > 15 ? cut.lastIndexOf(' ') : 40).trim();
  }

  async function save(ei, li, kind) {
    const layout = log[ei].layouts[li];
    layout.saving = kind;
    layout.saveError = '';
    log = log;
    try {
      const svg = await inlineAssets(layout.svg, fullDataUrl);
      const filename = layoutFilename(project.id, layout.title, kind);
      const blob = kind === 'svg'
        ? svgBlob(svg)
        : await svgToPngBlob(svg, layout.width_in, layout.height_in);
      const desc = shortDesc(project.project_name);
      await ensureJobFolder(clientFolderName, project.id, desc);
      const result = await uploadJobFile(
        clientFolderName,
        project.id,
        new File([blob], filename, { type: blob.type }),
        { subfolder: 'designs', as: filename, desc }
      );
      const savedName = result?.filename || filename;
      layout.saved = [...layout.saved, savedName];
      api.addNote(
        project.id,
        `Design Assistant: saved ${kind === 'svg' ? 'layout' : 'PNG proof'} designs\\${savedName}`
      ).catch(() => {});
      dispatch('saved');
    } catch (e) {
      layout.saveError = e.message || String(e);
    } finally {
      layout.saving = '';
      log = log;
    }
  }

  function newConversation() {
    for (const entry of log) {
      for (const l of entry.layouts || []) URL.revokeObjectURL(l.previewUrl);
    }
    messages = [];
    log = [];
    pending = [];
    error = '';
  }

  function close() {
    open = false;
    dispatch('close');
  }
</script>

{#if open && project}
  <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
  <div class="da-backdrop" on:click|self={close}>
    <aside class="da-panel" role="dialog" aria-modal="true" aria-labelledby="da-title">
      <header class="da-header">
        <div>
          <h3 id="da-title">🎨 Design Assistant</h3>
          <div class="da-sub">Job #{project.id} · {project.client_name || ''}</div>
        </div>
        <div class="da-header-actions">
          {#if log.length}
            <button class="btn btn-ghost" on:click={newConversation} disabled={busy}>New chat</button>
          {/if}
          <button class="da-close" on:click={close} aria-label="Close">×</button>
        </div>
      </header>

      {#if status && !status.configured}
        <p class="da-warn">
          The Design Assistant isn't switched on yet. The Anthropic API key still needs to be added to the server.
        </p>
      {/if}

      <div class="da-log" bind:this={logEl}>
        {#if !log.length}
          <div class="da-intro">
            <p>
              Describe what this job needs and I'll draft layouts sized to the job. Attach the client's
              logo or a photo of the site or vehicle so I can work with them.
            </p>
            <p class="da-muted">
              Try: “Three options for a 4×8 coroplast sign with the logo and phone number”, or
              “Lay out door lettering for the truck in this photo.”
            </p>
          </div>
        {/if}

        {#each log as entry, ei}
          <div class="da-msg da-{entry.role}">
            {#if entry.images?.length}
              <div class="da-thumbs">
                {#each entry.images as im}
                  <img src={im.src} alt={im.name} title={im.name} />
                {/each}
              </div>
            {/if}
            {#if entry.text}<div class="da-text">{entry.text}</div>{/if}

            {#each entry.layouts || [] as layout, li}
              <div class="da-layout">
                <div class="da-layout-head">
                  <strong>{layout.title}</strong>
                  <span class="da-muted">{layout.width_in}" × {layout.height_in}"</span>
                </div>
                <div class="da-preview">
                  <img src={layout.previewUrl} alt={layout.title} />
                </div>
                {#if layout.notes}<p class="da-notes">{layout.notes}</p>{/if}
                <div class="da-layout-actions">
                  <button class="btn btn-primary" on:click={() => save(ei, li, 'svg')} disabled={!!layout.saving}>
                    {layout.saving === 'svg' ? 'Saving…' : '💾 Save layout (SVG)'}
                  </button>
                  <button class="btn btn-ghost" on:click={() => save(ei, li, 'png')} disabled={!!layout.saving}>
                    {layout.saving === 'png' ? 'Saving…' : '🖼 Save PNG proof'}
                  </button>
                </div>
                {#each layout.saved as name}
                  <p class="da-saved">✓ Saved to job folder: {'designs\\' + name}</p>
                {/each}
                {#if layout.saveError}<p class="da-error">⚠ {layout.saveError}</p>{/if}
              </div>
            {/each}
          </div>
        {/each}

        {#if busy}
          <div class="da-msg da-assistant da-muted">Working on it… layouts can take a minute or two.</div>
        {/if}
      </div>

      <footer class="da-composer">
        {#if error}<p class="da-error">⚠ {error}</p>{/if}

        <div class="da-attach-row">
          {#if filesError}
            <span class="da-muted">{filesError}</span>
          {:else}
            {#each imageFiles as f}
              <button
                class="da-chip"
                on:click={() => attachFromFolder(f)}
                disabled={busy || attaching === f.name}
                title="Attach from the job folder"
              >
                {attaching === f.name ? '…' : '+'} {f.name}
              </button>
            {/each}
          {/if}
          <button class="da-chip" on:click={() => fileInput.click()} disabled={busy}>📎 From computer</button>
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            multiple
            hidden
            bind:this={fileInput}
            on:change={attachFromComputer}
          />
        </div>

        {#if pending.length}
          <div class="da-pending">
            {#each pending as p, i}
              <span class="da-pend">
                <img src={p.dataUrl} alt="" />
                {p.name}
                <button on:click={() => (pending = pending.filter((_, j) => j !== i))} aria-label="Remove">×</button>
              </span>
            {/each}
          </div>
        {/if}

        <div class="da-input-row">
          <textarea
            bind:value={input}
            rows="3"
            placeholder="What should this layout look like? (Enter to send, Shift+Enter for a new line)"
            on:keydown={onKey}
            disabled={busy}
          ></textarea>
          <button
            class="btn btn-primary"
            on:click={send}
            disabled={busy || (!input.trim() && !pending.length) || (status && !status.configured)}
          >
            Send
          </button>
        </div>

        {#if status}
          <div class="da-spend">
            This month: ${Number(status.month_spend_usd || 0).toFixed(2)} of ${status.cap_usd} limit
          </div>
        {/if}
      </footer>
    </aside>
  </div>
{/if}

<style>
  .da-backdrop {
    position: fixed;
    inset: 0;
    z-index: 100;
    background: rgba(0, 0, 0, 0.45);
    display: flex;
    justify-content: flex-end;
  }
  .da-panel {
    width: min(780px, 100vw);
    height: 100%;
    background: var(--surface);
    display: flex;
    flex-direction: column;
    box-shadow: var(--shadow-lg);
  }
  .da-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 12px;
    padding: 14px 18px;
    border-bottom: 1px solid var(--border);
  }
  .da-header h3 {
    margin: 0;
    font-family: var(--font-display);
    font-size: 1.4rem;
  }
  .da-sub,
  .da-muted {
    color: var(--text-dim);
    font-size: 0.85rem;
  }
  .da-header-actions {
    display: flex;
    gap: 8px;
    align-items: center;
  }
  .da-close {
    background: none;
    border: none;
    font-size: 1.6rem;
    line-height: 1;
    cursor: pointer;
    color: var(--text-muted);
  }
  .da-warn {
    margin: 0;
    padding: 10px 18px;
    background: #fff4e0;
    color: var(--amber);
    border-bottom: 1px solid var(--border);
  }
  .da-log {
    flex: 1;
    overflow-y: auto;
    padding: 16px 18px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    background: var(--black);
  }
  .da-intro {
    color: var(--text-muted);
    max-width: 560px;
  }
  .da-msg {
    max-width: 92%;
    padding: 10px 12px;
    border-radius: var(--radius-lg);
    background: var(--surface);
    border: 1px solid var(--border);
  }
  .da-staff {
    align-self: flex-end;
    background: #eef5fb;
    border-color: #cfe0ee;
  }
  .da-assistant {
    align-self: flex-start;
  }
  .da-text {
    white-space: pre-wrap;
    line-height: 1.45;
  }
  .da-thumbs {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-bottom: 6px;
  }
  .da-thumbs img {
    height: 56px;
    border-radius: var(--radius);
    border: 1px solid var(--border);
    background: #fff;
  }
  .da-layout {
    margin-top: 10px;
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    padding: 10px;
  }
  .da-layout-head {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 8px;
  }
  .da-preview {
    background: repeating-conic-gradient(#eee 0% 25%, #fff 0% 50%) 50% / 16px 16px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 8px;
    text-align: center;
  }
  .da-preview img {
    max-width: 100%;
    max-height: 420px;
    box-shadow: var(--shadow);
  }
  .da-notes {
    margin: 8px 0 0;
    font-size: 0.9rem;
    color: var(--text-muted);
  }
  .da-layout-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 10px;
  }
  .da-saved {
    margin: 6px 0 0;
    color: var(--green);
    font-size: 0.85rem;
    word-break: break-all;
  }
  .da-error {
    margin: 6px 0;
    color: #dc2626;
    font-size: 0.9rem;
  }
  .da-composer {
    border-top: 1px solid var(--border);
    padding: 10px 18px 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .da-attach-row,
  .da-pending {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: center;
  }
  .da-chip {
    border: 1px solid var(--border-mid);
    background: var(--surface);
    border-radius: 999px;
    padding: 3px 10px;
    font-size: 0.8rem;
    cursor: pointer;
    max-width: 240px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .da-chip:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .da-pend {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: var(--black);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 2px 6px;
    font-size: 0.8rem;
  }
  .da-pend img {
    height: 28px;
  }
  .da-pend button {
    background: none;
    border: none;
    cursor: pointer;
    font-size: 1rem;
    color: var(--text-muted);
  }
  .da-input-row {
    display: flex;
    gap: 8px;
    align-items: stretch;
  }
  .da-input-row textarea {
    flex: 1;
    resize: vertical;
    font: inherit;
    padding: 8px;
    border: 1px solid var(--border-mid);
    border-radius: var(--radius);
  }
  .da-spend {
    font-size: 0.75rem;
    color: var(--text-dim);
    text-align: right;
  }
</style>
