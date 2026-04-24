<!-- src/routes/shop/order/[number]/proof/[token]/+page.svelte
     Customer proof approval. Token-protected — no login required so the
     emailed link works in any browser without re-auth. Shows the proof
     image and Approve / Request Changes / Cancel buttons. -->
<script>
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { customerApi } from '$lib/api/customer-client.js';

  let proof = null;
  let loading = true;
  let error = '';
  let result = '';
  let working = false;

  let changesText = '';
  let mode = 'view';   // 'view' | 'changes' | 'cancel'

  $: token = $page.params.token;

  onMount(async () => {
    try {
      const res = await customerApi.getProofByToken(token);
      proof = res.proof;
    } catch (e) {
      error = e.message;
    } finally {
      loading = false;
    }
  });

  async function approve() {
    if (!confirm('Approve this proof? We\'ll start production.')) return;
    working = true;
    try {
      await customerApi.approveProof(token);
      result = 'Approved! We\'ll start your order right away.';
      proof = { ...proof, approved_at: new Date().toISOString(), order_status: 'in_production' };
    } catch (e) { error = e.message; } finally { working = false; }
  }

  async function requestChanges() {
    if (!changesText.trim()) { error = 'Please describe what needs to change.'; return; }
    working = true;
    try {
      await customerApi.requestProofChanges(token, changesText);
      result = 'Thanks — we\'ll send a revised proof shortly.';
      proof = { ...proof, changes_requested_at: new Date().toISOString(), order_status: 'awaiting_proof' };
    } catch (e) { error = e.message; } finally { working = false; }
  }

  async function cancel() {
    if (!confirm('Cancel this order? Your card will be refunded in full.')) return;
    working = true;
    try {
      const res = await customerApi.cancelProof(token);
      if (res.warning) result = res.warning;
      else result = 'Order cancelled. Your refund is on its way.';
      proof = { ...proof, cancelled_at: new Date().toISOString(), order_status: 'refunded' };
    } catch (e) { error = e.message; } finally { working = false; }
  }
</script>

<svelte:head><title>Approve proof — Holm Graphics</title></svelte:head>

<div class="page">
  {#if loading}
    <p>Loading proof…</p>
  {:else if error && !proof}
    <p class="alert error">{error}</p>
  {:else if proof}
    <h1>Proof for order #{proof.order_number}</h1>
    <p class="subtitle">Round {proof.proof_number} · sent {new Date(proof.sent_at).toLocaleDateString('en-CA')}</p>

    {#if result}
      <div class="alert success">{result}</div>
    {:else}
      {#if proof.approved_at}
        <div class="alert success">You approved this proof on {new Date(proof.approved_at).toLocaleString('en-CA')}.</div>
      {:else if proof.cancelled_at}
        <div class="alert warn">Order cancelled on {new Date(proof.cancelled_at).toLocaleString('en-CA')}.</div>
      {:else if proof.changes_requested_at}
        <div class="alert info">Changes requested. We'll send a revised proof.</div>
      {:else}
        <div class="actions">
          {#if mode === 'view'}
            <button class="btn primary" on:click={approve} disabled={working}>✓ Approve & Print</button>
            <button class="btn secondary" on:click={() => mode = 'changes'} disabled={working}>Request changes</button>
            <button class="btn danger" on:click={() => mode = 'cancel'} disabled={working}>Cancel & refund</button>
          {:else if mode === 'changes'}
            <p>What needs to change? Be specific so we get it right next time.</p>
            <textarea bind:value={changesText} rows="4" placeholder="e.g. Make the logo larger and move it 1 inch lower"></textarea>
            <div>
              <button class="btn primary" on:click={requestChanges} disabled={working}>Send</button>
              <button class="btn ghost" on:click={() => mode = 'view'} disabled={working}>Back</button>
            </div>
          {:else if mode === 'cancel'}
            <p>Cancelling refunds your full payment immediately. The order stops here.</p>
            <div>
              <button class="btn danger" on:click={cancel} disabled={working}>Yes, cancel & refund</button>
              <button class="btn ghost" on:click={() => mode = 'view'} disabled={working}>Back</button>
            </div>
          {/if}
        </div>
      {/if}
    {/if}

    {#if error}<p class="alert error">{error}</p>{/if}

    <p class="info-link">Order status: <a href="/shop/order/{proof.order_number}">view order details</a></p>
  {/if}
</div>

<style>
  .page { max-width: 44rem; margin: 0 auto; padding: 2rem 1rem; }
  h1 { margin: 0 0 0.25rem; }
  .subtitle { color: #777; margin: 0 0 1.5rem; }
  .alert { padding: 0.85rem 1rem; border-radius: 0.4rem; margin: 1rem 0; }
  .alert.success { background: #e8f5e8; color: #2a6a2a; }
  .alert.error { background: #fee; color: #b00; }
  .alert.warn { background: #fff8e0; color: #885; }
  .alert.info { background: #eef6ff; color: #225; }
  .actions { display: flex; flex-direction: column; gap: 0.85rem; align-items: start; margin: 1rem 0; }
  textarea { width: 100%; padding: 0.6rem; border: 1px solid #d4d4d8; border-radius: 0.3rem; font-family: inherit; }
  .btn { padding: 0.65rem 1.25rem; border-radius: 0.4rem; border: 0; cursor: pointer; font-weight: 600; }
  .btn.primary { background: #2a7a2a; color: white; }
  .btn.secondary { background: transparent; color: #c01818; border: 1px solid #c01818; }
  .btn.danger { background: #b00; color: white; }
  .btn.ghost { background: transparent; color: #555; border: 1px solid #ccc; }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .info-link { color: #777; font-size: 0.9rem; margin-top: 2rem; }
  .info-link a { color: #c01818; }
</style>
