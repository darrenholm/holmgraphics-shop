<!--
  Customer-facing proof approval page.

  URL: /proofs/<token>

  No login. The token IS the auth — it's a random 32-byte hex string
  baked into the proof's row, sent only to the recipient by email.
  Three states drive the UI:
    sent / viewed       → show canvas, Approve + Request changes buttons
    approved            → frozen view ("This proof was approved by …")
    changes_requested   → frozen view ("Changes requested by …")
    superseded          → "This proof is out of date — please look for the
                          newer email" so customers don't action a stale link

  The page calls public endpoints directly (no JWT). On submit we POST
  the annotation array + customer name + comment to /respond; the API
  posts a project_messages row and notifies staff.
-->
<script>
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import ProofAnnotationCanvas from '$lib/components/ProofAnnotationCanvas.svelte';

  // Hit the API directly — these endpoints have no auth header.
  const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';

  let loading = true;
  let loadError = '';
  let proof = null;            // { id, project_id, version, status, file_url, annotations, ... }

  let annotations = [];
  let customerName = '';
  let comment = '';
  let submitting = false;
  let submitError = '';
  let submitted = false;       // local flag after successful POST

  $: token = $page.params.token;

  onMount(load);

  async function load() {
    loading = true;
    loadError = '';
    try {
      // Use /project-proofs/by-token rather than /proofs/by-token so the
      // older DTF-order proofs router doesn't catch us first and 404.
      const r = await fetch(`${API_URL}/project-proofs/by-token/${encodeURIComponent(token)}`);
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.message || `HTTP ${r.status}`);
      }
      // API shape: { proof: { image_url, ... } } — unwrap and normalize the
      // image URL field for the canvas component.
      const body = await r.json();
      proof = body.proof || body;
      annotations = Array.isArray(proof.annotations) ? proof.annotations : [];
    } catch (e) {
      loadError = e.message || 'Unable to load proof.';
    } finally {
      loading = false;
    }
  }

  async function submit(decision) {
    submitError = '';
    if (!customerName.trim()) {
      submitError = 'Please enter your name so we know who approved.';
      return;
    }
    if (decision === 'changes_requested' && !comment.trim() && annotations.length === 0) {
      submitError = 'Please mark up the artwork or add a comment so we know what to change.';
      return;
    }
    submitting = true;
    try {
      // The API has two endpoints — `/approve` and `/request-changes` — so
      // pick the path from the decision rather than POSTing to /respond.
      const path = decision === 'approved' ? 'approve' : 'request-changes';
      const r = await fetch(`${API_URL}/project-proofs/by-token/${encodeURIComponent(token)}/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: customerName.trim(),
          text: comment.trim(),
          annotations,                  // image-pixel-coordinate vector shapes
        }),
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.message || `HTTP ${r.status}`);
      }
      submitted = true;
      // Refresh so we re-render in the frozen state with whatever the API
      // saved (and to surface annotations from any other tab that responded
      // in the meantime).
      await load();
    } catch (e) {
      submitError = e.message || 'Unable to submit. Please try again.';
    } finally {
      submitting = false;
    }
  }

  function onAnnotationChange(e) {
    annotations = e.detail.annotations;
  }

  // Convenience flags for the template.
  // `isActionable` — can the customer still hit Approve / Request changes?
  // Yes for sent, viewed, AND superseded (in case the newer proof's email
  // bounced or never arrived, otherwise they'd be stranded). Locked once
  // they've actually responded.
  $: isActionable = proof && !proof.responded_at && proof.status !== 'approved' && proof.status !== 'changes_requested';
  $: isApproved   = proof && proof.status === 'approved';
  $: isChanges    = proof && proof.status === 'changes_requested';
  $: isStale      = proof && proof.status === 'superseded';
</script>

<svelte:head>
  <title>Proof Approval — Holm Graphics</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<div class="proof-page">
  <header class="ph-header">
    <img src="/logo.png" alt="Holm Graphics" class="ph-logo" on:error={(e) => (e.target.style.display = 'none')} />
    <h1>Proof Approval</h1>
    <p class="tagline">Walkerton • Holm Graphics</p>
  </header>

  {#if loading}
    <div class="ph-card center">Loading proof…</div>
  {:else if loadError}
    <div class="ph-card error">
      <strong>Couldn't open this proof.</strong>
      <p>{loadError}</p>
      <p>If you think this is a mistake, please reply to the email you received or call us.</p>
    </div>
  {:else if proof}
    <div class="meta">
      <div>
        <strong>Job:</strong> #{proof.project_id}
        {#if proof.project_name}— {proof.project_name}{/if}
      </div>
      <div><strong>Version:</strong> v{proof.version}</div>
    </div>

    {#if isApproved}
      <div class="ph-card status-banner approved">
        ✓ This proof was approved
        {#if proof.response_name} by <strong>{proof.response_name}</strong>{/if}
        {#if proof.responded_at} on {new Date(proof.responded_at).toLocaleString()}{/if}.
        {#if proof.response_text}<p class="quote">"{proof.response_text}"</p>{/if}
      </div>
    {:else if isChanges}
      <div class="ph-card status-banner changes">
        ✎ Changes were requested
        {#if proof.response_name} by <strong>{proof.response_name}</strong>{/if}
        {#if proof.responded_at} on {new Date(proof.responded_at).toLocaleString()}{/if}.
        {#if proof.response_text}<p class="quote">"{proof.response_text}"</p>{/if}
        <p class="hint">We'll send a revised proof shortly.</p>
      </div>
    {:else if isStale}
      <div class="ph-card status-banner stale">
        <strong>A newer version was sent.</strong>
        {#if proof.latest_version}
          We sent <strong>v{proof.latest_version.version}</strong>
          on {new Date(proof.latest_version.uploaded_at).toLocaleString()}
          — please check your inbox for that email if you can.
        {:else}
          Please check your inbox for the most recent email.
        {/if}
        <p class="hint">
          If you didn't receive the newer one (it may have bounced or gone
          to spam), you can still review and respond to this version below.
        </p>
      </div>
    {/if}

    <ProofAnnotationCanvas
      imageUrl={proof.image_url}
      initial={annotations}
      readonly={!isActionable}
      authorLabel="customer"
      on:change={onAnnotationChange}
    />

    {#if isActionable}
      <div class="ph-card respond">
        <h2>Respond</h2>
        <label>
          Your name
          <input type="text" bind:value={customerName} placeholder="First and last name" maxlength="80" />
        </label>
        <label>
          Comment <span class="muted">(optional if you marked up the image)</span>
          <textarea bind:value={comment} rows="3" placeholder="Anything else we should know?" maxlength="2000"></textarea>
        </label>

        {#if submitError}<div class="error inline">{submitError}</div>{/if}

        <div class="actions">
          <button class="btn btn-changes" on:click={() => submit('changes_requested')} disabled={submitting}>
            ✎ Request changes
          </button>
          <button class="btn btn-approve" on:click={() => submit('approved')} disabled={submitting}>
            ✓ Approve as-is
          </button>
        </div>
        <p class="fine">
          Submitting locks this proof and sends your response to our team. You'll get
          an emailed confirmation either way.
        </p>
      </div>
    {/if}
  {/if}
</div>

<style>
  .proof-page {
    max-width: 1000px;
    margin: 0 auto;
    padding: 16px;
    color: #1a1a1a;
  }
  .ph-header { text-align: center; padding: 16px 0; }
  .ph-logo { height: 48px; }
  .ph-header h1 { margin: 8px 0 0; font-size: 1.6rem; }
  .tagline { margin: 4px 0 0; color: #64748b; font-size: 0.9rem; }

  .meta {
    display: flex;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 8px;
    padding: 12px 16px;
    background: #fff;
    border: 1px solid #e2e8f0;
    border-radius: 6px;
    margin-bottom: 12px;
  }

  .ph-card {
    background: #fff;
    border: 1px solid #e2e8f0;
    border-radius: 6px;
    padding: 16px;
    margin-top: 12px;
  }
  .ph-card.center  { text-align: center; color: #64748b; }
  .ph-card.error   { background: #fef2f2; border-color: #fecaca; color: #991b1b; }

  .status-banner.approved { background: #f0fdf4; border-color: #bbf7d0; color: #166534; }
  .status-banner.changes  { background: #fffbeb; border-color: #fde68a; color: #92400e; }
  .status-banner.stale    { background: #f1f5f9; color: #475569; }
  .status-banner .quote {
    font-style: italic;
    margin: 8px 0 0;
    padding: 8px 12px;
    background: rgba(0,0,0,0.04);
    border-radius: 4px;
  }
  .status-banner .hint { margin: 4px 0 0; font-size: 0.9rem; }

  .respond h2 { margin: 0 0 12px; font-size: 1.15rem; }
  .respond label {
    display: block;
    margin-bottom: 10px;
    font-size: 0.9rem;
    color: #475569;
  }
  .respond input, .respond textarea {
    display: block;
    width: 100%;
    margin-top: 4px;
    padding: 8px 10px;
    border: 1px solid #cbd5e1;
    border-radius: 4px;
    font-size: 1rem;
    font-family: inherit;
    box-sizing: border-box;
  }
  .muted { color: #94a3b8; font-weight: normal; }
  .error.inline {
    color: #991b1b;
    background: #fef2f2;
    padding: 8px 12px;
    border-radius: 4px;
    margin-bottom: 12px;
  }
  .actions {
    display: flex;
    gap: 12px;
    flex-wrap: wrap;
    margin-top: 8px;
  }
  .btn {
    flex: 1 1 200px;
    padding: 12px 18px;
    border: none;
    border-radius: 6px;
    font-size: 1rem;
    font-weight: 600;
    cursor: pointer;
  }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn-approve { background: #16a34a; color: #fff; }
  .btn-approve:hover:not(:disabled) { background: #15803d; }
  .btn-changes { background: #f59e0b; color: #1a1a1a; }
  .btn-changes:hover:not(:disabled) { background: #d97706; color: #fff; }

  .fine { font-size: 0.8rem; color: #94a3b8; margin: 8px 0 0; }
</style>
