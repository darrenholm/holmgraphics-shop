<!-- src/lib/components/PickupSignatureModal.svelte -->
<!--
  Client signs for their order on the counter's WiFi card reader.

  Staff press Send; the reader asks the client for their name, then a
  signature. This screen waits, then prints the pickup slip with the
  signature on it. The signature is kept on the job either way — the server
  also hears about it from Stripe, so closing this mid-signature loses
  nothing.
-->
<script>
  import { createEventDispatcher, onMount, onDestroy } from 'svelte';
  import { api } from '$lib/api/client.js';
  import { savedSmartReaderId } from '$lib/pos/smartReader.js';
  import { printPickupReceipt } from '$lib/pos/printer.js';
  import { signatureRaster, svgDataUrl, pickupSlipPng } from '$lib/pos/signatureRaster.js';
  import { uploadJobFile } from '$lib/files/filesBridgeClient.js';

  export let project;
  export let open = false;
  /** The client's folder name on L: (same one the Files panel uses). */
  export let clientFolderName = '';

  const dispatch = createEventDispatcher();
  const POLL_MS = 2000;

  let stage = 'ready';       // ready | waiting | signed | failed
  let current = null;        // the signature row being taken
  let errorMsg = '';
  let note = '';             // optional, e.g. "25 of 50 signs, rest Friday"
  let printMsg = '';
  let printing = false;
  let saveMsg = '';
  let saving = false;
  let past = [];             // earlier signatures on this job
  let timer = null;
  let polling = false;

  onMount(loadPast);
  onDestroy(stopPolling);

  async function loadPast() {
    try { past = await api.pickupSignatures(project.id); } catch { past = []; }
  }

  async function send() {
    errorMsg = ''; printMsg = '';
    try {
      current = await api.pickupSignatureStart(project.id, savedSmartReaderId(), note.trim());
      stage = 'waiting';
      startPolling();
    } catch (e) {
      errorMsg = e?.message || String(e);
    }
  }

  function startPolling() {
    stopPolling();
    timer = setInterval(poll, POLL_MS);
  }
  function stopPolling() { if (timer) clearInterval(timer); timer = null; }

  async function poll() {
    if (polling || !current) return;
    polling = true;
    try {
      current = await api.pickupSignature(current.id);
      if (current.status === 'signed') {
        stopPolling();
        stage = 'signed';
        errorMsg = '';
        loadPast();
        dispatch('signed', current);
        await Promise.all([print(current), saveToFolder(current)]);
      } else if (current.status !== 'pending') {
        stopPolling();
        stage = 'failed';
        errorMsg = current.failureMessage || 'Not signed.';
      }
    } catch (e) {
      // A dropped poll is not a failed signature; keep trying.
      errorMsg = `Still waiting — ${e?.message || e}`;
    } finally {
      polling = false;
    }
  }

  async function cancel() {
    stopPolling();
    if (current?.status === 'pending') {
      try { current = await api.pickupSignatureCancel(current.id); } catch { /* */ }
    }
    stage = 'ready';
    errorMsg = '';
  }

  async function print(sig) {
    printing = true; printMsg = '';
    try {
      let signatureBytes = null;
      try { signatureBytes = await signatureRaster(sig.signatureSvg); } catch { /* blank line instead */ }
      await printPickupReceipt({
        projectId: project.id,
        clientName: project.client_name || '',
        description: project.project_name || '',
        signerName: sig.signerName || '',
        signedAt: sig.signedAt,
        items: sig.items || [],
        note: sig.note || '',
        money: sig.money || null,
        signatureBytes,
      });
      printMsg = 'Receipt printed.';
    } catch (e) {
      printMsg = `Signature saved, but the receipt didn't print: ${e?.message || e}`;
    } finally {
      printing = false;
    }
  }

  // A copy for the job folder on L:. Timestamped so a second pickup never
  // replaces the first. Only works on the shop network (files bridge).
  async function saveToFolder(sig) {
    if (!clientFolderName) { saveMsg = 'No client folder on L: for this job — copy not saved.'; return; }
    saving = true; saveMsg = '';
    try {
      const blob = await pickupSlipPng({
        projectId: project.id,
        clientName: project.client_name || '',
        description: project.project_name || '',
        signerName: sig.signerName || '',
        signedAt: sig.signedAt,
        items: sig.items || [],
        note: sig.note || '',
        money: sig.money || null,
        svg: sig.signatureSvg,
      });
      const d = new Date(sig.signedAt || Date.now());
      const pad = (n) => String(n).padStart(2, '0');
      const name = `Pickup Signature ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}${pad(d.getMinutes())}.png`;
      const res = await uploadJobFile(clientFolderName, project.id,
        new File([blob], name, { type: 'image/png' }), { as: name });
      saveMsg = `Saved to the job folder: ${res?.filename || name}`;
      api.addNote(project.id, `Pickup signature saved: ${res?.filename || name}`).catch(() => {});
      dispatch('saved');
    } catch (e) {
      saveMsg = `Signature kept on the job, but not saved to L: — ${e?.message || e}`;
    } finally {
      saving = false;
    }
  }

  function close() {
    // Leaving while the reader is still asking would strand the client
    // mid-signature; ask the reader to stop first.
    if (stage === 'waiting') cancel();
    open = false;
    dispatch('close');
  }
  function onKey(e) { if (e.key === 'Escape') close(); }

  function when(ts) {
    return ts ? new Date(ts).toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' }) : '';
  }
</script>

<svelte:window on:keydown={onKey} />

{#if open}
  <div class="modal-backdrop" on:click|self={close} role="presentation">
    <div class="modal-panel">
      <header class="modal-head">
        <h2>Pickup Signature</h2>
        <button class="close-x" on:click={close} aria-label="Close">×</button>
      </header>

      <div class="modal-body">
        <p class="job">Job #{project.id}{project.client_name ? ` — ${project.client_name}` : ''}</p>

        {#if stage === 'ready'}
          <p>The card reader will ask the client to type their name and sign. It shows the job's items and quantities, and your note if you add one.</p>
          <label class="note">
            Note (optional)
            <textarea bind:value={note} rows="2" maxlength="500"
              placeholder="e.g. 25 of 50 signs, rest Friday"></textarea>
          </label>
          <button class="btn btn-primary big" on:click={send}>Send to card reader</button>

        {:else if stage === 'waiting'}
          <p class="status">⏳ Waiting for the client to sign on the card reader…</p>
          <button class="btn btn-ghost" on:click={cancel}>Cancel</button>

        {:else if stage === 'signed'}
          <p class="status ok">✅ Signed by <strong>{current.signerName || '(no name)'}</strong></p>
          <div class="sig"><img src={svgDataUrl(current.signatureSvg)} alt="Signature" /></div>
          <p class="msg">{printing ? 'Printing…' : printMsg}</p>
          <p class="msg">{saving ? 'Saving to the job folder…' : saveMsg}</p>
          <div class="row">
            <button class="btn btn-ghost" on:click={() => saveToFolder(current)} disabled={saving}>💾 Save to L: again</button>
            <button class="btn btn-ghost" on:click={() => print(current)} disabled={printing}>🖨 Print again</button>
            <button class="btn btn-primary" on:click={close}>Done</button>
          </div>

        {:else if stage === 'failed'}
          <p class="status bad">Not signed.</p>
          <div class="row">
            <button class="btn btn-primary" on:click={send}>Try again</button>
            <button class="btn btn-ghost" on:click={close}>Close</button>
          </div>
        {/if}

        {#if errorMsg}<p class="error">{errorMsg}</p>{/if}
        {#if stage !== 'signed' && saveMsg}<p class="msg">{saveMsg}</p>{/if}

        {#if past.length && stage !== 'signed'}
          <h3>Signed before</h3>
          {#each past as s (s.id)}
            <div class="past">
              <div class="sig small"><img src={svgDataUrl(s.signatureSvg)} alt="Signature" /></div>
              <div>
                <div><strong>{s.signerName || '(no name)'}</strong></div>
                <div class="dim">{when(s.signedAt)}{s.requestedBy ? ` · sent by ${s.requestedBy}` : ''}</div>
                <button class="link" on:click={() => print(s)} disabled={printing}>Reprint</button>
                <button class="link" on:click={() => saveToFolder(s)} disabled={saving}>Save to L:</button>
              </div>
            </div>
          {/each}
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .modal-backdrop {
    position: fixed; inset: 0; background: rgba(10, 12, 16, 0.55);
    display: flex; align-items: center; justify-content: center;
    z-index: 2000; padding: 16px;
  }
  .modal-panel {
    background: var(--surface);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-lg);
    width: min(520px, 100%);
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
    font-size: 1.2rem; letter-spacing: 0.04em; text-transform: uppercase; margin: 0;
  }
  .close-x {
    background: transparent; border: none; cursor: pointer; color: var(--text-muted);
    font-size: 1.6rem; padding: 4px 8px; border-radius: var(--radius); line-height: 1;
  }
  .close-x:hover { color: var(--red); background: var(--surface-2); }
  .modal-body { padding: 20px; overflow: auto; display: flex; flex-direction: column; gap: 12px; }
  .job { font-weight: 600; margin: 0; }
  .note { display: flex; flex-direction: column; gap: 4px; font-size: 0.9rem; color: var(--text-muted); }
  .note textarea { font: inherit; color: var(--text); padding: 8px; border: 1px solid var(--border); border-radius: var(--radius); resize: vertical; }
  .big { font-size: 1.1rem; padding: 14px; }
  .status { font-size: 1.05rem; margin: 0; }
  .status.ok { color: var(--green); }
  .status.bad { color: var(--red); }
  .error { color: var(--red); margin: 0; }
  .msg { color: var(--text-muted); margin: 0; min-height: 1.2em; }
  .row { display: flex; gap: 8px; justify-content: flex-end; }
  .sig {
    background: #fff; border: 1px solid var(--border); border-radius: 6px;
    padding: 8px; display: flex; justify-content: center;
  }
  .sig img { max-width: 100%; max-height: 160px; }
  .sig.small { width: 140px; flex: none; }
  .sig.small img { max-height: 60px; }
  h3 { margin: 8px 0 0; font-size: 0.95rem; }
  .past { display: flex; gap: 12px; align-items: center; }
  .dim { color: var(--text-dim); font-size: 0.85rem; }
  .link + .link { margin-left: 10px; }
  .link {
    background: none; border: none; padding: 0; color: var(--accent, var(--blue));
    cursor: pointer; text-decoration: underline; font-size: 0.85rem;
  }
</style>
