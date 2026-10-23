<!-- src/lib/components/JobRefundModal.svelte -->
<!--
  Refund from the job page. Lists the Stripe payments taken on this job
  (reader, card-by-phone and pay links all land in terminal_payments) and
  hands the chosen one to RefundModal — the same screen the POS uses, so
  partial refunds, Interac rules and the QuickBooks refund receipt all work
  the same way here.
-->
<script>
  import { createEventDispatcher, onMount } from 'svelte';
  import { api } from '$lib/api/client.js';
  import RefundModal from '$lib/components/RefundModal.svelte';

  export let project = null;
  export let open = false;

  const dispatch = createEventDispatcher();

  let payments = [];
  let loading = true;
  let errorMsg = '';
  let refunding = null;
  let refundOpen = false;

  function money(c) { return `$${((c || 0) / 100).toFixed(2)}`; }
  function shortDate(ts) {
    try { return new Date(ts).toLocaleDateString('en-CA'); } catch { return ''; }
  }

  // Same rule as the POS screen: settled, and something left to give back.
  function refundableCents(p) {
    if (p.status !== 'succeeded' && p.status !== 'partially_refunded') return 0;
    if (!p.charge_id) return 0;
    return Math.max(0, (p.amount_cents || 0) - (p.amount_refunded_cents || 0));
  }

  async function load() {
    loading = true; errorMsg = '';
    try {
      const rows = await api.terminalPayments({ jobId: project.id, limit: 50 });
      payments = (rows || []).filter(
        (r) => r.status === 'succeeded' || r.status === 'partially_refunded' || r.status === 'refunded'
      );
    } catch (e) {
      errorMsg = e.message || String(e);
      payments = [];
    } finally {
      loading = false;
    }
  }

  onMount(load);

  function pick(p) {
    refunding = p;
    refundOpen = true;
  }

  async function onRefunded(e) {
    await load();
    dispatch('refunded', e.detail);
  }

  function close() {
    open = false;
    dispatch('close');
  }
</script>

{#if open && project && !refundOpen}
<div class="backdrop" on:click|self={close} role="presentation">
  <div class="panel">
    <div class="head">
      <h2>Refund — Job #{project.id}</h2>
      <button class="x" on:click={close} aria-label="Close">×</button>
    </div>

    {#if loading}
      <p class="hint">Loading payments…</p>
    {:else if errorMsg}
      <div class="band err">{errorMsg}</div>
    {:else if !payments.length}
      <div class="band">
        No card payments on this job. Cash, cheque, or anything paid outside the
        shop app has to be refunded the old way.
      </div>
    {:else}
      <div class="list">
        {#each payments as p (p.id)}
          <div class="row">
            <div>
              <div class="amt">{money(p.amount_cents)}</div>
              <div class="sub">
                {shortDate(p.created_at)} ·
                {p.payment_method_type === 'interac_present' ? 'Interac' : (p.card_brand || 'Card').toUpperCase()}
                {p.card_last4 ? `••${p.card_last4}` : ''}
              </div>
              {#if p.amount_refunded_cents > 0}
                <div class="sub warn">{money(p.amount_refunded_cents)} already refunded</div>
              {/if}
            </div>
            {#if refundableCents(p) > 0}
              <button class="btn primary" on:click={() => pick(p)}>Refund</button>
            {:else}
              <span class="sub">Fully refunded</span>
            {/if}
          </div>
        {/each}
      </div>
      <p class="hint">After refunding, take the line off the job so the total matches.</p>
    {/if}

    <div class="foot">
      <button class="btn" on:click={close}>Close</button>
    </div>
  </div>
</div>
{/if}

{#key refunding?.id}
  <RefundModal
    bind:open={refundOpen}
    payment={refunding}
    on:refunded={onRefunded}
    on:close={() => { refunding = null; }}
  />
{/key}

<style>
  .backdrop {
    position: fixed; inset: 0; background: rgba(0, 0, 0, 0.5);
    display: flex; align-items: center; justify-content: center; z-index: 900; padding: 16px;
  }
  .panel {
    background: var(--surface); border: 1px solid var(--border);
    border-radius: var(--radius-lg); box-shadow: var(--shadow);
    width: 100%; max-width: 460px; padding: 18px;
    display: flex; flex-direction: column; gap: 14px;
  }
  .head { display: flex; align-items: center; justify-content: space-between; }
  h2 {
    margin: 0; font-family: var(--font-display); text-transform: uppercase;
    letter-spacing: 0.05em; font-size: 1.2rem;
  }
  .x { background: none; border: 0; font-size: 1.6rem; line-height: 1; cursor: pointer; color: inherit; }
  .list { display: flex; flex-direction: column; gap: 8px; }
  .row {
    display: flex; align-items: center; justify-content: space-between; gap: 10px;
    border: 1px solid var(--border); border-radius: 8px; padding: 10px 12px;
  }
  .amt { font-size: 1.05rem; font-weight: 700; }
  .sub { opacity: 0.7; font-size: 0.85rem; }
  .sub.warn { opacity: 1; color: #b45309; }
  .band { border-radius: 8px; padding: 10px 12px; font-size: 0.9rem; background: rgba(0, 0, 0, 0.05); }
  .band.err { background: #fee2e2; color: #991b1b; }
  .hint { margin: 0; font-size: 0.82rem; opacity: 0.7; }
  .foot { display: flex; justify-content: flex-end; }
  .btn {
    padding: 8px 14px; border-radius: 8px; border: 1px solid var(--border);
    background: var(--surface); color: inherit; cursor: pointer; font-size: 0.95rem;
  }
  .btn.primary { background: var(--accent, #b91c1c); border-color: transparent; color: #fff; }
</style>
