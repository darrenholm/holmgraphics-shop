<!-- src/lib/components/RefundModal.svelte -->
<!--
  Refunds a counter sale.

  There are two completely different mechanisms behind one button, and which
  one runs is decided by how the customer paid, not by anything staff choose:

    Interac debit — has to happen AT THE READER with the customer's original
      card. Stripe's API and Dashboard both refuse; the network requires the
      card back. Handled natively, collect then confirm, same shape as a sale.

    Credit — the server does it. No card needed, so it also works for the
      customer who phoned in.

  Staff shouldn't have to know that, so the screen just says what to do next.
-->
<script>
  import { createEventDispatcher } from 'svelte';
  import { api } from '$lib/api/client.js';
  import { pos, refundPayment, cancelRefund, awaitRefund } from '$lib/pos/terminal.js';
  import { printRefundReceipt } from '$lib/pos/printer.js';
  import { isNative } from '$lib/pos/native.js';

  /** A terminal_payments row, as returned by GET /api/terminal/payments. */
  export let payment = null;
  export let open = false;

  const dispatch = createEventDispatcher();

  // Seeded at construction, not from a reactive block. Svelte 4 runs reactive
  // statements once per flush in dependency order, and an assignment made
  // inside a function CALLED from one of them lands too late for a `$:` that
  // has already run — which left the field showing 1.13 while the button
  // underneath said "Refund $0.00". The parent keys this component on the
  // payment id, so a different sale gets a fresh instance and this line runs
  // again.
  let amountStr = fromCents(
    Math.max(0, (payment?.amount_cents || 0) - (payment?.amount_refunded_cents || 0))
  );
  let stage = 'entry';         // entry | running | done | error
  let stageLabel = '';
  let errorMsg = '';
  let printMsg = '';
  let busy = false;
  let refundedThis = 0;

  $: isInterac = payment?.payment_method_type === 'interac_present';
  $: alreadyCents = payment?.amount_refunded_cents || 0;
  $: remainingCents = Math.max(0, (payment?.amount_cents || 0) - alreadyCents);
  $: amountCents = toCents(amountStr);
  $: valid = amountCents > 0 && amountCents <= remainingCents;

  function toCents(s) {
    const n = Number.parseFloat(String(s ?? '').replace(/[^0-9.]/g, ''));
    return Number.isFinite(n) ? Math.round(n * 100) : 0;
  }
  function fromCents(c) { return ((c || 0) / 100).toFixed(2); }
  function money(c) { return `$${fromCents(c)}`; }

  async function run() {
    if (!valid || busy) return;
    busy = true; stage = 'running'; errorMsg = ''; printMsg = '';
    const asked = amountCents;
    let refundId = null;
    try {
      if (isInterac) {
        stageLabel = 'Ask the customer for the card they paid with';
        const refund = await refundPayment({
          chargeId: payment.charge_id,
          amountCents: asked,
          onStage: (s) => {
            stageLabel = s === 'collecting' ? 'Present the original card on the reader'
                       : s === 'confirming' ? 'Refunding — do not remove the card'
                       : 'Done';
          },
        });
        refundId = refund?.id || null;
      } else {
        stageLabel = 'Refunding to the card...';
        const out = await api.terminalRefund(payment.id, asked);
        refundId = out?.refundId || null;
      }

      refundedThis = asked;
      stage = 'done';
      stageLabel = '';

      // The webhook enriches the row and posts the RefundReceipt to
      // QuickBooks a second or two later. Wait briefly so the list behind this
      // modal redraws with the refund on it — but the money has already gone
      // back either way, so a slow webhook must not look like a failure.
      const settled = await awaitRefund(payment.id, { sinceCents: alreadyCents });
      dispatch('refunded', { payment: settled || payment, refundedCents: asked });

      try {
        await printRefundReceipt(settled || payment, {
          refundedCents: asked,
          emv: (settled || payment)?.emv_receipt || null,
          refundId,
          jobDescription: payment?.description || '',
        });
        printMsg = 'Refund slip printed — customer copy and a merchant copy to sign.';
      } catch (e) {
        printMsg = `Refunded, but the slip did not print: ${e.message}`;
      }
    } catch (e) {
      stage = 'error';
      errorMsg = e.message || String(e);
    } finally {
      busy = false;
    }
  }

  async function close() {
    if (busy) { await cancelRefund(); busy = false; }
    open = false;
    dispatch('close');
  }
</script>

{#if open && payment}
<div class="backdrop" on:click|self={close} role="presentation">
  <div class="panel">
    <div class="head">
      <h2>Refund</h2>
      <button class="x" on:click={close} aria-label="Close">×</button>
    </div>

    <div class="sale">
      <div class="sale-line">
        <span>{payment.project_id ? `Job #${payment.project_id}` : 'Counter sale'}</span>
        <strong>{money(payment.amount_cents)}</strong>
      </div>
      <div class="sale-sub">
        {isInterac ? 'Interac debit' : (payment.card_brand || 'Card').toUpperCase()}
        {payment.card_last4 ? `••${payment.card_last4}` : ''}
        {payment.client_name ? `· ${payment.client_name}` : ''}
      </div>
      {#if alreadyCents > 0}
        <div class="sale-sub warn">
          {money(alreadyCents)} already refunded — {money(remainingCents)} left.
        </div>
      {/if}
    </div>

    {#if stage === 'entry' || stage === 'running'}
      {#if isInterac}
        <div class="band">
          <strong>The customer needs to be here with the card they paid with.</strong>
          Interac can only refund to the original card — that is the bank's rule, not ours.
          If they are not here, refund by cheque or e-transfer instead and do not use this.
        </div>
        {#if !isNative()}
          <div class="band err">Interac refunds only work on the counter tablet.</div>
        {:else if $pos.status !== 'connected'}
          <div class="band err">The card reader is not connected. Fix that on the POS screen first.</div>
        {/if}
      {:else}
        <div class="band">
          Goes straight back to the card. The customer does not need to be here.
          Their bank usually shows it within a few business days.
        </div>
      {/if}

      <label class="fld">
        <span>Refund amount</span>
        <input class="num" type="text" inputmode="decimal" bind:value={amountStr} disabled={busy} />
      </label>
      {#if amountCents > remainingCents}
        <p class="hint err">Only {money(remainingCents)} is left to refund on this sale.</p>
      {:else}
        <p class="hint">Change it for a partial refund. QuickBooks gets a refund receipt automatically.</p>
      {/if}

      {#if stage === 'running'}
        <div class="running">
          <span class="spinner"></span>
          <span>{stageLabel || 'Working...'}</span>
        </div>
      {/if}
    {/if}

    {#if stage === 'done'}
      <div class="done">
        <div class="big">{money(refundedThis)} refunded</div>
        <p>{isInterac ? 'Back on the card now.' : 'On its way back to the card.'}</p>
        {#if printMsg}<p class="hint">{printMsg}</p>{/if}
      </div>
    {/if}

    {#if stage === 'error'}
      <div class="band err">{errorMsg}</div>
      <p class="hint">Nothing has been refunded. You can try again.</p>
    {/if}

    <div class="foot">
      {#if stage === 'done'}
        <button class="btn primary" on:click={close}>Done</button>
      {:else}
        <button class="btn" on:click={close}>{busy ? 'Cancel' : 'Close'}</button>
        <button class="btn primary" on:click={run}
                disabled={!valid || busy || (isInterac && (!isNative() || $pos.status !== 'connected'))}>
          {busy ? 'Working...' : `Refund ${money(amountCents)}`}
        </button>
      {/if}
    </div>
  </div>
</div>
{/if}

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

  .sale { border: 1px solid var(--border); border-radius: 8px; padding: 10px 12px; }
  .sale-line { display: flex; justify-content: space-between; font-size: 1.05rem; }
  .sale-sub { opacity: 0.7; font-size: 0.85rem; margin-top: 2px; }
  .sale-sub.warn { opacity: 1; color: #b45309; }

  .band { border-radius: 8px; padding: 10px 12px; font-size: 0.9rem; background: rgba(0, 0, 0, 0.05); }
  .band.err { background: #fee2e2; color: #991b1b; }

  .fld { display: flex; flex-direction: column; gap: 4px; }
  .fld span { font-size: 0.85rem; opacity: 0.75; }
  .num {
    font-size: 1.7rem; padding: 10px 12px; border: 1px solid var(--border);
    border-radius: 8px; width: 100%; background: var(--surface); color: inherit;
  }
  .hint { margin: 0; font-size: 0.82rem; opacity: 0.7; }
  .hint.err { opacity: 1; color: #991b1b; }

  .running { display: flex; align-items: center; gap: 10px; font-size: 1rem; }
  .spinner {
    width: 18px; height: 18px; border-radius: 50%; flex: 0 0 auto;
    border: 2px solid var(--border); border-top-color: currentColor;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  .done { text-align: center; padding: 8px 0; }
  .done .big { font-size: 1.6rem; font-weight: 700; }
  .done p { margin: 6px 0 0; }

  .foot { display: flex; gap: 10px; justify-content: flex-end; }
  .btn {
    padding: 10px 16px; border-radius: 8px; border: 1px solid var(--border);
    background: var(--surface); color: inherit; cursor: pointer; font-size: 1rem;
  }
  .btn.primary { background: var(--accent, #b91c1c); border-color: transparent; color: #fff; }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
