<!-- src/lib/components/TakePaymentModal.svelte -->
<!--
  Counter payment flow for the front-desk tablet.

  Deliberately big and dumb: one number, one method, one status line. The
  person running it has a customer standing in front of them and cannot be
  reading a form.

  The status line is the important part. A card reader that is silently
  updating its firmware, or waiting on a PIN the customer hasn't noticed, is
  indistinguishable from a frozen app unless the screen says which.
-->
<script>
  import { createEventDispatcher, onMount } from 'svelte';
  import { api } from '$lib/api/client.js';
  import {
    pos, canTakePayment, initTerminal, connectSavedReader,
    takePayment, cancelCollect, awaitSettlement, signatureRequired,
  } from '$lib/pos/terminal.js';
  import { printSaleReceipt, printCashReceipt } from '$lib/pos/printer.js';
  import { isNative } from '$lib/pos/native.js';

  export let project;
  export let open = false;
  /** Pre-tax total from the job's line items, in dollars. */
  export let defaultSubtotal = 0;

  const dispatch = createEventDispatcher();
  const HST = 0.13;

  let method = 'card';            // card | cash | cheque
  let subtotalStr = '';
  let totalStr = '';
  let totalEdited = false;        // once staff types a total, stop deriving it
  let tenderedStr = '';

  let stage = 'entry';            // entry | running | done | declined
  let stageLabel = '';
  let errorMsg = '';
  let result = null;              // settled terminal_payments row
  let lastPaymentIntentId = null;
  let printMsg = '';
  let busy = false;
  let connecting = false;

  $: subtotalCents = toCents(subtotalStr);
  $: taxCents = totalEdited
    ? Math.max(0, toCents(totalStr) - subtotalCents)
    : Math.round(subtotalCents * HST);
  $: if (!totalEdited) totalStr = fromCents(subtotalCents + Math.round(subtotalCents * HST));
  $: totalCents = toCents(totalStr);
  $: tenderedCents = toCents(tenderedStr);
  $: changeCents = Math.max(0, tenderedCents - totalCents);
  $: valid = totalCents > 0;
  // Staff can override the total for a deposit or a part payment, at which
  // point the subtotal on screen no longer belongs to it. Only send the split
  // when it actually adds up — a subtotal larger than the amount charged
  // would post a QuickBooks receipt for more than the customer paid. When it
  // doesn't add up the server backs the subtotal out of the total at 13%.
  $: splitValid = subtotalCents > 0 && subtotalCents + taxCents === totalCents;

  function toCents(s) {
    const n = Number.parseFloat(String(s ?? '').replace(/[^0-9.\-]/g, ''));
    return Number.isFinite(n) ? Math.round(n * 100) : 0;
  }
  function fromCents(c) { return ((c || 0) / 100).toFixed(2); }
  function money(c) { return `$${fromCents(c)}`; }

  onMount(async () => {
    subtotalStr = defaultSubtotal ? Number(defaultSubtotal).toFixed(2) : '';
    if (isNative()) {
      await initTerminal();
      if ($pos.initialized && $pos.status !== 'connected') reconnect();
    }
  });

  async function reconnect() {
    connecting = true;
    try { await connectSavedReader(); }
    finally { connecting = false; }
  }

  function close() {
    if (busy) return;
    dispatch('close');
  }

  // ─── Card / debit ──────────────────────────────────────────────────────────
  async function payByCard() {
    if (!valid) return;
    busy = true; errorMsg = ''; printMsg = ''; stage = 'running';
    try {
      const out = await takePayment({
        jobId: project?.id,
        amountCents: totalCents,
        ...(splitValid ? { subtotalCents, taxCents } : {}),
        description: project?.project_name || '',
        onStage: (s) => {
          stageLabel = {
            creating:   'Starting the sale...',
            collecting: 'Present card on the reader',
            confirming: 'Approving...',
            done:       'Approved',
          }[s] || s;
        },
      });
      lastPaymentIntentId = out.paymentIntentId;

      // The webhook fills in the Stripe fee and the EMV block a second or two
      // after approval. Wait briefly so the receipt can carry the auth code —
      // but print regardless: nobody stands at a counter waiting on our
      // bookkeeping.
      stageLabel = 'Approved — printing receipt';
      const settled = await awaitSettlement(out.paymentId);
      result = settled || { ...out, amount_cents: totalCents };

      await doPrint(settled, out);
      stage = 'done';
      dispatch('paid', { payment: result });
    } catch (e) {
      lastPaymentIntentId = e.paymentIntentId || lastPaymentIntentId;
      errorMsg = e.message || String(e);
      stage = 'declined';
    } finally {
      busy = false;
      stageLabel = '';
    }
  }

  async function doPrint(settled, out) {
    try {
      const row = settled || {
        amount_cents: totalCents,
        subtotal_cents: splitValid ? subtotalCents : null,
        tax_cents: splitValid ? taxCents : null,
        project_id: project?.id, client_name: project?.client_name,
        payment_intent_id: out?.paymentIntentId,
        card_brand: out?.card?.brand, card_last4: out?.card?.last4,
        payment_method_type: null,
      };
      const { copies } = await printSaleReceipt(row, {
        emv: settled?.emv_receipt || null,
        signatureRequired: signatureRequired(settled),
        jobDescription: project?.project_name || '',
      });
      printMsg = copies > 1 ? 'Receipt printed (2 copies — signature required)' : 'Receipt printed';
    } catch (e) {
      // A printer fault must never look like a payment fault. The money went
      // through; say so, and offer the reprint.
      printMsg = `Payment approved, but the receipt did not print: ${e.message}`;
    }
  }

  async function reprint() {
    printMsg = '';
    try {
      const fresh = result?.id ? await api.terminalPayment(result.id) : result;
      await printSaleReceipt(fresh, {
        emv: fresh?.emv_receipt || null,
        signatureRequired: signatureRequired(fresh),
        jobDescription: project?.project_name || '',
      });
      printMsg = 'Reprinted';
    } catch (e) {
      printMsg = `Reprint failed: ${e.message}`;
    }
  }

  async function abandon() {
    await cancelCollect(lastPaymentIntentId);
    lastPaymentIntentId = null;
    stage = 'entry';
    errorMsg = '';
  }

  // ─── Cash / cheque ─────────────────────────────────────────────────────────
  // Recorded on paper and in QuickBooks by hand — this prints the receipt and
  // opens the drawer, nothing more. Deliberately not written to
  // terminal_payments: that table is the Stripe ledger, and putting untracked
  // cash in it would break the clearing-account reconciliation.
  async function payByCashOrCheque() {
    if (!valid) return;
    busy = true; printMsg = ''; errorMsg = '';
    try {
      await printCashReceipt({
        amount_cents: totalCents,
        subtotal_cents: splitValid ? subtotalCents : null,
        tax_cents: splitValid ? taxCents : null,
        project_id: project?.id, client_name: project?.client_name,
        description: project?.project_name || '',
      }, {
        tenderedCents: method === 'cash' && tenderedCents > 0 ? tenderedCents : null,
        method: method === 'cheque' ? 'CHEQUE' : 'CASH',
        jobDescription: project?.project_name || '',
      });
      printMsg = 'Receipt printed, drawer opened';
      stage = 'done';
      result = { amount_cents: totalCents, offline: true };
    } catch (e) {
      errorMsg = e.message || String(e);
    } finally {
      busy = false;
    }
  }

  function resetForAnother() {
    stage = 'entry'; result = null; errorMsg = ''; printMsg = '';
    lastPaymentIntentId = null; totalEdited = false; tenderedStr = '';
  }

  $: batteryPct = $pos.batteryLevel == null ? null : Math.round($pos.batteryLevel * 100);
</script>

{#if open}
<div class="modal-backdrop" on:click|self={close} role="presentation">
  <div class="modal-panel">
    <div class="modal-head">
      <h2>Take Payment</h2>
      <div class="head-right">
        {#if isNative()}
          <span class="dot" class:ok={$pos.status === 'connected'} class:warn={$pos.reconnecting || $pos.updateRunning}></span>
          <span class="reader-label">
            {#if $pos.updateRunning}
              Reader updating {$pos.updateProgress != null ? `${Math.round($pos.updateProgress * 100)}%` : ''}
            {:else if $pos.reconnecting}
              Reconnecting
            {:else if $pos.status === 'connected'}
              Reader ready{batteryPct != null ? ` · ${batteryPct}%` : ''}
            {:else}
              Reader offline
            {/if}
          </span>
        {/if}
        <button class="close-x" on:click={close} aria-label="Close">×</button>
      </div>
    </div>

    <!-- Blockers get their own band. Every one of these is something a person
         has to go and fix, so it says what, not just that something failed. -->
    {#if isNative() && $pos.blocker}
      <div class="band band-error">{$pos.blocker}</div>
    {:else if isNative() && $pos.error && stage !== 'declined'}
      <div class="band band-warn">{$pos.error}</div>
    {:else if !isNative()}
      <div class="band band-warn">
        Card payments only run on the counter tablet. Cash and cheque receipts need the tablet's printer too.
      </div>
    {/if}

    {#if $pos.updateRunning}
      <div class="band band-warn">
        The reader is installing a required firmware update. This can take several minutes —
        leave it on the charger and do not switch it off.
        {#if $pos.updateProgress != null}
          <div class="progress"><div class="bar" style="width:{Math.round($pos.updateProgress * 100)}%"></div></div>
        {/if}
      </div>
    {/if}

    <div class="modal-body">
      {#if stage === 'entry' || stage === 'running'}
        <div class="amount-block">
          <label class="fld">
            <span>Subtotal</span>
            <input class="num" type="text" inputmode="decimal" bind:value={subtotalStr}
                   disabled={busy} on:input={() => { totalEdited = false; }} />
          </label>
          <div class="tax-row">HST 13% <strong>{money(taxCents)}</strong></div>
          <label class="fld total-fld">
            <span>Total charged</span>
            <input class="num big" type="text" inputmode="decimal" bind:value={totalStr}
                   disabled={busy} on:input={() => { totalEdited = true; }} />
          </label>
          <p class="hint">
            The total is what the customer is charged and what prints on the receipt.
            Override it directly for a deposit or a part payment.
          </p>
        </div>

        <div class="methods">
          <button class="method" class:sel={method === 'card'} disabled={busy}
                  on:click={() => (method = 'card')}>Card / Debit</button>
          <button class="method" class:sel={method === 'cash'} disabled={busy}
                  on:click={() => (method = 'cash')}>Cash</button>
          <button class="method" class:sel={method === 'cheque'} disabled={busy}
                  on:click={() => (method = 'cheque')}>Cheque</button>
        </div>

        {#if method === 'cash'}
          <label class="fld">
            <span>Cash tendered (optional)</span>
            <input class="num" type="text" inputmode="decimal" bind:value={tenderedStr} disabled={busy} />
          </label>
          {#if tenderedCents > 0}
            <div class="change-row">Change <strong>{money(changeCents)}</strong></div>
          {/if}
        {/if}

        {#if stage === 'running'}
          <div class="live">
            <div class="live-stage">{stageLabel}</div>
            {#if $pos.displayMessage}<div class="live-msg">{$pos.displayMessage}</div>{/if}
            {#if $pos.inputPrompt}<div class="live-msg">{$pos.inputPrompt}</div>{/if}
            <p class="hint">
              Anything over $100 — and most sales here are — will ask for insert and PIN
              rather than a tap. That is normal.
            </p>
          </div>
        {/if}
      {/if}

      {#if stage === 'declined'}
        <div class="result bad">
          <div class="result-head">Not approved</div>
          <p>{errorMsg}</p>
          <p class="hint">
            Trying again reuses the same payment, so the customer cannot be charged twice
            for the tap that failed.
          </p>
        </div>
      {/if}

      {#if stage === 'done'}
        <div class="result good">
          <div class="result-head">{money(result?.amount_cents ?? totalCents)} approved</div>
          {#if result?.card_brand || result?.payment_method_type}
            <p>
              {result.payment_method_type === 'interac_present' ? 'Interac debit' : (result.card_brand || 'Card')}
              {result.card_last4 ? `••••${result.card_last4}` : ''}
            </p>
          {/if}
          {#if printMsg}<p class="hint">{printMsg}</p>{/if}
          {#if result?.qbo_warning}<p class="hint warn-text">{result.qbo_warning}</p>{/if}
          {#if result && !result.offline && !result.qbo_synced_at}
            <p class="hint">
              QuickBooks hasn't confirmed this one yet. It retries on its own —
              check the POS screen if it's still unsynced in a few minutes.
            </p>
          {/if}
        </div>
      {/if}
    </div>

    <div class="modal-foot">
      {#if stage === 'entry'}
        <button class="btn btn-ghost" on:click={close}>Cancel</button>
        <div class="spacer"></div>
        {#if method === 'card'}
          {#if isNative() && $pos.status !== 'connected'}
            <button class="btn" on:click={reconnect} disabled={connecting || !!$pos.blocker}>
              {connecting ? 'Connecting…' : 'Connect reader'}
            </button>
          {:else}
            <button class="btn btn-primary big-btn" on:click={payByCard}
                    disabled={!valid || !$canTakePayment}>
              Charge {money(totalCents)}
            </button>
          {/if}
        {:else}
          <button class="btn btn-primary big-btn" on:click={payByCashOrCheque} disabled={!valid || busy}>
            Record {method === 'cheque' ? 'cheque' : 'cash'} · {money(totalCents)}
          </button>
        {/if}
      {:else if stage === 'running'}
        <button class="btn btn-ghost" on:click={abandon}>Cancel payment</button>
        <div class="spacer"></div>
      {:else if stage === 'declined'}
        <button class="btn btn-ghost" on:click={abandon}>Give up</button>
        <div class="spacer"></div>
        <button class="btn btn-primary" on:click={payByCard} disabled={!$canTakePayment}>Try again</button>
      {:else}
        <button class="btn btn-ghost" on:click={reprint}>Reprint receipt</button>
        <div class="spacer"></div>
        <button class="btn" on:click={resetForAnother}>Another payment</button>
        <button class="btn btn-primary" on:click={close}>Done</button>
      {/if}
    </div>
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
    width: min(520px, 100%);
    max-height: 92vh;
    display: flex; flex-direction: column;
    overflow: hidden;
  }
  .modal-head {
    display: flex; align-items: center; justify-content: space-between;
    padding: 14px 20px; border-bottom: 1px solid var(--border);
  }
  .modal-head h2 {
    font-family: var(--font-display); font-size: 1.2rem;
    letter-spacing: 0.04em; text-transform: uppercase; margin: 0;
  }
  .head-right { display: flex; align-items: center; gap: 8px; }
  .reader-label { font-size: 0.78rem; color: var(--text-dim); }
  .dot {
    width: 10px; height: 10px; border-radius: 50%;
    background: var(--text-dim); display: inline-block;
  }
  .dot.ok   { background: var(--green); }
  .dot.warn { background: var(--amber); }
  .close-x {
    background: transparent; border: none; cursor: pointer;
    color: var(--text-muted); font-size: 1.6rem; line-height: 1;
    padding: 4px 8px; border-radius: var(--radius);
  }
  .close-x:hover { color: var(--red); background: var(--surface-2); }

  .band { padding: 10px 20px; font-size: 0.85rem; border-bottom: 1px solid var(--border); }
  .band-error { background: #fee2e2; color: #991b1b; }
  .band-warn  { background: #fef3c7; color: #92400e; }
  .progress { height: 6px; background: rgba(0,0,0,0.12); border-radius: 3px; margin-top: 8px; }
  .progress .bar { height: 100%; background: var(--amber); border-radius: 3px; transition: width 0.3s; }

  .modal-body { padding: 20px; overflow: auto; }

  .fld { display: flex; flex-direction: column; gap: 4px; margin-bottom: 10px; }
  .fld > span { font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-dim); }
  .num {
    font-family: var(--font-display); font-size: 1.3rem; font-weight: 700;
    padding: 10px 12px; border: 1px solid var(--border-mid); border-radius: var(--radius);
    background: var(--surface);
  }
  /* Big enough to hit with a thumb and read from across the counter. */
  .num.big { font-size: 2rem; }
  .total-fld .num { border-color: var(--red); }
  .tax-row, .change-row {
    display: flex; justify-content: space-between;
    font-size: 0.9rem; color: var(--text-muted);
    padding: 4px 2px 10px;
  }

  .methods { display: flex; gap: 8px; margin: 14px 0; }
  .method {
    flex: 1; padding: 14px 8px; cursor: pointer;
    border: 1px solid var(--border-mid); border-radius: var(--radius);
    background: var(--surface-2); color: var(--text);
    font-family: var(--font-display); text-transform: uppercase;
    letter-spacing: 0.04em; font-size: 0.95rem;
  }
  .method.sel { border-color: var(--red); background: var(--red-glow); color: var(--red); font-weight: 700; }
  .method:disabled { opacity: 0.5; cursor: default; }

  .live { margin-top: 16px; text-align: center; }
  .live-stage {
    font-family: var(--font-display); font-size: 1.4rem;
    text-transform: uppercase; letter-spacing: 0.05em;
  }
  .live-msg { font-size: 1.05rem; color: var(--blue); margin-top: 6px; }

  .result { text-align: center; padding: 12px 0; }
  .result-head {
    font-family: var(--font-display); font-size: 1.8rem; font-weight: 900;
    text-transform: uppercase; letter-spacing: 0.03em;
  }
  .result.good .result-head { color: var(--green); }
  .result.bad  .result-head { color: var(--red); }

  .hint { font-size: 0.78rem; color: var(--text-dim); margin-top: 8px; }
  .warn-text { color: var(--amber); }

  .modal-foot {
    display: flex; align-items: center; gap: 10px;
    padding: 14px 20px; border-top: 1px solid var(--border);
    background: var(--surface-2);
  }
  .spacer { flex: 1; }
  .big-btn { padding: 12px 22px; font-size: 1.05rem; }
</style>
