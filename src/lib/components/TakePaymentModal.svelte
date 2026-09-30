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
  import { createEventDispatcher, onMount, onDestroy, tick } from 'svelte';
  import { api } from '$lib/api/client.js';
  import {
    pos, canTakePayment, initTerminal, connectSavedReader,
    takePayment, cancelCollect, awaitSettlement, signatureRequired,
  } from '$lib/pos/terminal.js';
  import { printSaleReceipt, printCashReceipt } from '$lib/pos/printer.js';
  import { isNative } from '$lib/pos/native.js';
  import { collectOnReader, savedSmartReaderId } from '$lib/pos/smartReader.js';
  import { mountCardBox } from '$lib/pos/stripeCard.js';

  export let project;
  export let open = false;
  /** Pre-tax total from the job's line items, in dollars. */
  export let defaultSubtotal = 0;

  const dispatch = createEventDispatcher();
  const HST = 0.13;

  let method = 'card';            // card | phone | link | cash | cheque
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

  // What's actually outstanding on this job's QuickBooks invoice. For the
  // customer who walks in holding one: the job's line items are the wrong
  // number to charge from — they're ex-tax and they don't know about part
  // payments or anything edited in QuickBooks since the invoice was raised.
  let invoice = null;

  // Counter sales already taken on this job. Nothing blocks a second charge —
  // deposits and part payments are legitimate — but a job already paid should
  // say so loudly first, or a busy hand double-bills a customer.
  let priorPaid = [];         // succeeded / partially-refunded rows on this job
  let paidAckd = false;       // staff ticked "yes, take another payment"

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
    loadInvoice();
    if (isNative()) {
      await initTerminal();
      if ($pos.initialized && $pos.status !== 'connected') reconnect();
    }
  });

  // Never blocks: QuickBooks being down must not stop a payment, it just means
  // falling back to the job's line-item total.
  async function loadInvoice() {
    if (!project?.id) return;
    try {
      const inv = await api.terminalJobInvoice(project.id);
      if (!inv?.found) return;
      invoice = inv;
      if (inv.balanceCents > 0) {
        // Charge what the invoice says, not what the items add up to. Marked
        // edited so the subtotal-derived total can't overwrite it.
        totalStr = (inv.balanceCents / 100).toFixed(2);
        totalEdited = true;
      }
    } catch { /* fall back to the job total */ }
  }

  async function loadPriorPayments() {
    priorPaid = []; paidAckd = false;    // fresh for whichever job opened
    if (!project?.id) return;
    try {
      const rows = await api.terminalPayments({ jobId: project.id, limit: 20 });
      // Only ones where money actually changed hands and stuck. A fully
      // refunded sale is not "already paid".
      priorPaid = (rows || []).filter(
        (r) => (r.status === 'succeeded' || r.status === 'partially_refunded')
            && (r.amount_cents - (r.amount_refunded_cents || 0)) > 0
      );
    } catch { priorPaid = []; }
  }

  function money2(c) { return `$${((c || 0) / 100).toFixed(2)}`; }
  function shortDate(ts) {
    try { return new Date(ts).toLocaleDateString('en-CA'); } catch { return ''; }
  }

  $: alreadyPaidCents = priorPaid.reduce(
    (n, r) => n + (r.amount_cents - (r.amount_refunded_cents || 0)), 0);

  async function reconnect() {
    connecting = true;
    try { await connectSavedReader(); }
    finally { connecting = false; }
  }

  function close() {
    if (busy) return;
    dropPhoneIntent();
    dispatch('close');
  }

  // ─── Card over the phone ───────────────────────────────────────────────────
  // Staff type the card into Stripe's own card box (the number goes straight
  // to Stripe, never through our code). It's an ordinary Stripe payment, so
  // it posts to QuickBooks exactly like a reader sale.
  //
  // The amount is locked once the box is open — the PaymentIntent was made
  // for that amount. "Change amount" throws it away and starts again.
  let phoneIntent = null;          // { id, paymentIntentId, clientSecret, publishableKey, moto }
  let cardBox = null;
  let cardBoxEl;
  let cnpEmail = project?.contact_email || project?.client_email || '';

  async function startPhone() {
    if (!valid) return;
    busy = true; errorMsg = '';
    try {
      phoneIntent = await api.terminalCardNotPresent({
        channel: 'phone',
        jobId: project?.id ?? null,
        amountCents: totalCents,
        ...(splitValid ? { subtotalCents, taxCents } : {}),
        email: cnpEmail.trim() || null,
        description: project?.project_name || '',
      });
      await tick();
      cardBox = await mountCardBox(cardBoxEl, phoneIntent);
    } catch (e) {
      errorMsg = e.message || String(e);
      await dropPhoneIntent();
    } finally {
      busy = false;
    }
  }

  async function chargePhone() {
    if (!cardBox) return;
    busy = true; errorMsg = '';
    try {
      await cardBox.confirm();
      const settled = await awaitSettlement(phoneIntent.id, { timeoutMs: 8000 });
      result = settled || { amount_cents: totalCents };
      cardBox.destroy(); cardBox = null; phoneIntent = null;
      stage = 'done';
      dispatch('paid', { payment: result });
    } catch (e) {
      // Declined: the box stays open so the card can be fixed and retried on
      // the same payment, which can't charge twice.
      errorMsg = e.message || String(e);
    } finally {
      busy = false;
    }
  }

  async function dropPhoneIntent() {
    const pi = phoneIntent?.paymentIntentId;
    cardBox?.destroy(); cardBox = null; phoneIntent = null;
    if (pi) { try { await api.terminalCancelPaymentIntent(pi); } catch { /* it may have gone through */ } }
  }

  onDestroy(() => { cardBox?.destroy(); });

  // ─── Pay link ──────────────────────────────────────────────────────────────
  // The customer pays on their own phone or computer. Making a new link for
  // this job cancels any older one.
  let linkResult = null;           // { id, url, emailed }
  let copied = false;

  async function makeLink() {
    if (!valid) return;
    busy = true; errorMsg = ''; copied = false;
    try {
      linkResult = await api.terminalCardNotPresent({
        channel: 'link',
        jobId: project?.id ?? null,
        amountCents: totalCents,
        ...(splitValid ? { subtotalCents, taxCents } : {}),
        email: cnpEmail.trim() || null,
        description: project?.project_name || '',
      });
      stage = 'link';
    } catch (e) {
      errorMsg = e.message || String(e);
    } finally {
      busy = false;
    }
  }

  async function copyLink() {
    try { await navigator.clipboard.writeText(linkResult.url); copied = true; }
    catch { copied = false; }
  }

  // ─── Card / debit ──────────────────────────────────────────────────────────
  // Card sales go to the WiFi reader, full stop. The Bluetooth WisePad was
  // retired on 2026-09-18: its connection to the tablet kept dying with the
  // tablet's own Bluetooth service and no amount of reconnecting fixed it.
  // If no reader is chosen on this device, say so rather than silently
  // falling back to hardware nobody trusts any more.
  const wifiReaderChosen = !!savedSmartReaderId();

  async function payByCard() {
    return payByWifiReader();
  }

  async function payByCardOverBluetooth() {
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

  // The WiFi reader path. The server hands the sale to the reader and the
  // reader does the rest; we just watch. Everything after approval — the
  // settled row, the receipt, QuickBooks — is identical to the Bluetooth path.
  async function payByWifiReader() {
    if (!valid) return;
    busy = true; errorMsg = ''; printMsg = ''; stage = 'running';
    try {
      stageLabel = 'Starting the sale...';
      const intent = await api.terminalPaymentIntent({
        jobId: project?.id,
        amountCents: totalCents,
        ...(splitValid ? { subtotalCents, taxCents } : {}),
        description: project?.project_name || '',
      });
      lastPaymentIntentId = intent.paymentIntentId;

      await collectOnReader({
        paymentId: intent.id,
        onStage: (s) => {
          stageLabel = {
            sending: 'Sending it to the reader...',
            waiting: 'Ask the customer to tap, insert or swipe',
            done:    'Approved',
          }[s] || s;
        },
      });

      stageLabel = 'Approved — printing receipt';
      const settled = await awaitSettlement(intent.id);
      result = settled || { amount_cents: totalCents };

      await doPrint(settled, { paymentIntentId: intent.paymentIntentId });
      stage = 'done';
      dispatch('paid', { payment: result });
    } catch (e) {
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
    if (result?.offline) return printOffline();
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
  // Recorded on the server and posted to QuickBooks (Undeposited Funds, against
  // the job's invoice when there is one), then the receipt prints. Kept out of
  // terminal_payments: that table is the Stripe ledger, and cash in it would
  // break the clearing-account reconciliation.
  //
  // offlineKey is minted once per attempt and kept until it succeeds, so a
  // retry after the WiFi blinks returns the same payment instead of a second.
  let offlineKey = null;
  let chequeNo = '';
  let resyncing = false;

  function newKey() {
    return (crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`);
  }

  async function payByCashOrCheque() {
    if (!valid) return;
    busy = true; printMsg = ''; errorMsg = '';
    offlineKey = offlineKey || newKey();
    let row;
    try {
      row = await api.terminalOfflinePayment({
        clientKey:     offlineKey,
        method,
        jobId:         project?.id ?? null,
        amountCents:   totalCents,
        subtotalCents: splitValid ? subtotalCents : null,
        taxCents:      splitValid ? taxCents : null,
        reference:     method === 'cheque' ? chequeNo.trim() || null : null,
        description:   project?.project_name || '',
      });
    } catch (e) {
      // Nothing recorded (or we can't tell) — stay on the entry screen. The
      // key is kept, so pressing the button again cannot record it twice.
      errorMsg = `Couldn't record the payment: ${e.message || e}. Press the button again to retry.`;
      busy = false;
      return;
    }
    offlineKey = null;
    result = { ...row, offline: true };
    stage = 'done';
    await printOffline();
    busy = false;
  }

  async function printOffline() {
    try {
      await printCashReceipt({
        amount_cents: result.amount_cents,
        subtotal_cents: result.subtotal_cents,
        tax_cents: result.tax_cents,
        project_id: project?.id, client_name: project?.client_name,
        description: project?.project_name || '',
      }, {
        tenderedCents: result.method === 'cash' && tenderedCents > 0 ? tenderedCents : null,
        method: result.method === 'cheque' ? 'CHEQUE' : 'CASH',
        jobDescription: project?.project_name || '',
      });
      printMsg = result.method === 'cash' ? 'Receipt printed, drawer opened' : 'Receipt printed';
    } catch (e) {
      printMsg = `Receipt didn't print: ${e.message || e}`;
    }
  }

  async function resyncOffline() {
    resyncing = true;
    try {
      const row = await api.terminalOfflineResync(result.id);
      result = { ...row, offline: true };
    } catch (e) {
      result = { ...result, qbo_error: e.message || String(e) };
    } finally {
      resyncing = false;
    }
  }

  function resetForAnother() {
    stage = 'entry'; result = null; errorMsg = ''; printMsg = '';
    lastPaymentIntentId = null; totalEdited = false; tenderedStr = '';
    offlineKey = null; chequeNo = '';
    linkResult = null; copied = false;
  }

  $: batteryPct = $pos.batteryLevel == null ? null : Math.round($pos.batteryLevel * 100);
</script>

{#if open}
<div class="modal-backdrop" on:click|self={close} role="presentation">
  <div class="modal-panel">
    <div class="modal-head">
      <h2>Take Payment</h2>
      <div class="head-right">
        {#if wifiReaderChosen}
          <span class="reader-label">WiFi reader</span>
        {:else if isNative()}
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
    {#if method === 'card' && !wifiReaderChosen}
      <div class="band band-error">
        No card reader chosen on this device. Open POS settings → WiFi reader and pick one.
      </div>
    {:else if false}
      <div class="band band-error">{$pos.blocker}</div>
    {:else if isNative() && $pos.error && stage !== 'declined'}
      <div class="band band-warn">{$pos.error}</div>
    {:else if !isNative()}
      <div class="band band-warn">
        Card payments run on the counter tablet, or on any machine with a WiFi reader chosen in POS settings.
        Cash and cheque go to QuickBooks from any machine; the receipt needs a receipt printer.
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
                   disabled={busy || !!phoneIntent} on:input={() => { totalEdited = false; }} />
          </label>
          <div class="tax-row">HST 13% <strong>{money(taxCents)}</strong></div>
          <label class="fld total-fld">
            <span>Total charged</span>
            <input class="num big" type="text" inputmode="decimal" bind:value={totalStr}
                   disabled={busy || !!phoneIntent} on:input={() => { totalEdited = true; }} />
          </label>
          {#if invoice?.found && !invoice.settled}
            <div class="inv-note">
              Invoice #{invoice.docNumber} — outstanding
              <strong>{money(invoice.balanceCents)}</strong>
              {#if invoice.balanceCents !== invoice.totalCents}
                of {money(invoice.totalCents)}
              {/if}
            </div>
          {:else if invoice?.settled}
            <div class="inv-note paid">
              Invoice #{invoice.docNumber} is already paid in full in QuickBooks.
              Check before charging again.
            </div>
          {/if}

          {#if priorPaid.length}
            <div class="paid-warn">
              <strong>This job has already been paid {money2(alreadyPaidCents)}.</strong>
              {#each priorPaid as p}
                <div class="paid-line">
                  {money2(p.amount_cents - (p.amount_refunded_cents || 0))}
                  on {shortDate(p.created_at)}
                  {p.payment_method_type === 'interac_present' ? 'Interac' : (p.card_brand || 'card')}
                  {p.card_last4 ? `••${p.card_last4}` : ''}
                </div>
              {/each}
              <label class="ack">
                <input type="checkbox" bind:checked={paidAckd} disabled={busy} />
                Yes, take another payment on this job
              </label>
            </div>
          {/if}

          <p class="hint">
            The total is what the customer is charged and what prints on the receipt.
            For a deposit or part payment, just type the amount you want to take.
          </p>
        </div>

        <div class="methods">
          <button class="method" class:sel={method === 'card'} disabled={busy || !!phoneIntent}
                  on:click={() => (method = 'card')}>Card / Debit</button>
          <button class="method" class:sel={method === 'phone'} disabled={busy || !!phoneIntent}
                  on:click={() => (method = 'phone')}>Card by phone</button>
          <button class="method" class:sel={method === 'link'} disabled={busy || !!phoneIntent}
                  on:click={() => (method = 'link')}>Pay link</button>
          <button class="method" class:sel={method === 'cash'} disabled={busy || !!phoneIntent}
                  on:click={() => (method = 'cash')}>Cash</button>
          <button class="method" class:sel={method === 'cheque'} disabled={busy || !!phoneIntent}
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

        {#if method === 'cheque'}
          <label class="fld">
            <span>Cheque number (optional)</span>
            <input class="num" type="text" inputmode="numeric" maxlength="21"
                   bind:value={chequeNo} disabled={busy} />
          </label>
        {/if}

        {#if method === 'phone' || method === 'link'}
          <label class="fld">
            <span>{method === 'link' ? 'Email the link to' : 'Email receipt to (optional)'}</span>
            <input type="email" bind:value={cnpEmail} disabled={busy || !!phoneIntent}
                   placeholder="customer@example.com" />
          </label>
          {#if method === 'link'}
            <p class="hint">
              The customer opens the link and types in their own card. Leave the email blank
              to just copy the link and text it yourself.
            </p>
          {:else if !phoneIntent}
            <p class="hint">
              Press <strong>Enter card</strong>, then type the card number, expiry, CVC and
              postal code as the customer reads them out. Never write a card number down.
            </p>
          {/if}
          {#if method === 'phone'}
            <div class="card-box" class:hidden={!phoneIntent} bind:this={cardBoxEl}></div>
            {#if phoneIntent && !phoneIntent.moto}
              <p class="hint">
                If the card asks for a bank verification code, the customer can't do that
                over the phone. Send them a pay link instead.
              </p>
            {/if}
          {/if}
        {/if}

        {#if stage === 'entry' && errorMsg}
          <p class="hint warn-text">{errorMsg}</p>
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

      {#if stage === 'link'}
        <div class="result good">
          <div class="result-head">Pay link for {money(totalCents)} ready</div>
          {#if linkResult?.emailed}<p>Emailed to {linkResult.emailed}.</p>
          {:else if cnpEmail.trim()}<p class="warn-text">The email didn't send. Copy the link and send it yourself.</p>{/if}
          <input class="link-url" type="text" readonly value={linkResult?.url || ''}
                 on:focus={(e) => e.target.select()} />
          <p class="hint">
            It posts to QuickBooks by itself once they pay. Making another link for this job
            cancels this one.
          </p>
        </div>
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
          <div class="result-head">
            {money(result?.amount_cents ?? totalCents)}
            {result?.offline ? (result.method === 'cheque' ? 'cheque recorded' : 'cash recorded') : 'approved'}
          </div>
          {#if result?.card_brand || result?.payment_method_type}
            <p>
              {result.payment_method_type === 'interac_present' ? 'Interac debit' : (result.card_brand || 'Card')}
              {result.card_last4 ? `••••${result.card_last4}` : ''}
            </p>
          {/if}
          {#if printMsg}<p class="hint">{printMsg}</p>{/if}
          {#if result?.qbo_warning}<p class="hint warn-text">{result.qbo_warning}</p>{/if}
          {#if result?.offline}
            {#if result.qbo_synced_at}
              <p class="hint">
                Posted to QuickBooks{result.qbo_doc_type === 'Payment' ? ' against the invoice' : ''},
                in Undeposited Funds.
              </p>
            {:else}
              <p class="hint warn-text">
                Not in QuickBooks yet{result.qbo_error ? `: ${result.qbo_error}` : '.'}
              </p>
              <button class="btn" on:click={resyncOffline} disabled={resyncing}>
                {resyncing ? 'Trying…' : 'Retry QuickBooks'}
              </button>
            {/if}
          {/if}
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
          {#if false}
            <button class="btn" on:click={reconnect} disabled={connecting || !!$pos.blocker}>
              {connecting ? 'Connecting…' : 'Connect reader'}
            </button>
          {:else}
            <!-- A WiFi reader has nothing to do with this machine's Bluetooth.
                 Gating on $canTakePayment left the button dead on any PC —
                 which is the whole point of the WiFi reader. -->
            <button class="btn btn-primary big-btn" on:click={payByCard}
                    disabled={!valid || busy || !wifiReaderChosen || (priorPaid.length && !paidAckd)}>
              Charge {money(totalCents)}
            </button>
          {/if}
        {:else if method === 'phone'}
          {#if phoneIntent}
            <button class="btn" on:click={dropPhoneIntent} disabled={busy}>Change amount</button>
            <button class="btn btn-primary big-btn" on:click={chargePhone} disabled={busy || !cardBox}>
              {busy ? 'Charging…' : `Charge ${money(totalCents)}`}
            </button>
          {:else}
            <button class="btn btn-primary big-btn" on:click={startPhone}
                    disabled={!valid || busy || (priorPaid.length && !paidAckd)}>
              {busy ? 'Opening…' : 'Enter card'}
            </button>
          {/if}
        {:else if method === 'link'}
          <button class="btn btn-primary big-btn" on:click={makeLink}
                  disabled={!valid || busy || (priorPaid.length && !paidAckd)}>
            {busy ? 'Making link…' : (cnpEmail.trim() ? `Email pay link · ${money(totalCents)}` : `Make pay link · ${money(totalCents)}`)}
          </button>
        {:else}
          <button class="btn btn-primary big-btn" on:click={payByCashOrCheque}
                  disabled={!valid || busy || (priorPaid.length && !paidAckd)}>
            Record {method === 'cheque' ? 'cheque' : 'cash'} · {money(totalCents)}
          </button>
        {/if}
      {:else if stage === 'running'}
        <button class="btn btn-ghost" on:click={abandon}>Cancel payment</button>
        <div class="spacer"></div>
      {:else if stage === 'declined'}
        <button class="btn btn-ghost" on:click={abandon}>Give up</button>
        <div class="spacer"></div>
        <button class="btn btn-primary" on:click={payByCard}
                disabled={busy || !wifiReaderChosen}>Try again</button>
      {:else if stage === 'link'}
        <button class="btn" on:click={copyLink}>{copied ? 'Copied' : 'Copy link'}</button>
        <div class="spacer"></div>
        <button class="btn btn-primary" on:click={close}>Done</button>
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

  .methods { display: flex; flex-wrap: wrap; gap: 8px; margin: 14px 0; }
  .card-box { margin: 12px 0; padding: 12px; background: #fff; border: 1px solid #ccc; border-radius: 6px; }
  .card-box.hidden { display: none; }
  .link-url { width: 100%; box-sizing: border-box; font-family: monospace; font-size: 13px; padding: 8px; margin: 8px 0; }
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
  .inv-note {
    font-size: 0.85rem; padding: 8px 10px; border-radius: var(--radius);
    background: var(--red-glow); color: var(--red); margin-bottom: 6px;
  }
  .inv-note.paid { background: #fef3c7; color: #92400e; }
  .warn-text { color: var(--amber); }

  .modal-foot {
    display: flex; align-items: center; gap: 10px;
    padding: 14px 20px; border-top: 1px solid var(--border);
    background: var(--surface-2);
  }
  .spacer { flex: 1; }
  .big-btn { padding: 12px 22px; font-size: 1.05rem; }
  .paid-warn {
    background: #fef3c7; color: #92400e; border: 1px solid #f0c869;
    border-radius: 8px; padding: 10px 12px; margin-top: 8px; font-size: 0.9rem;
  }
  .paid-warn .paid-line { opacity: 0.85; font-size: 0.85rem; margin-top: 2px; }
  .paid-warn .ack {
    display: flex; align-items: center; gap: 8px; margin-top: 8px;
    font-weight: 600; cursor: pointer;
  }
  .paid-warn .ack input { width: 18px; height: 18px; }
</style>
