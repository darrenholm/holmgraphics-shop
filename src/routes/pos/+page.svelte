<!-- src/routes/pos/+page.svelte -->
<!--
  Counter POS status and settings.

  Three jobs, in the order they matter when something is wrong at the till:

    1. Is the card reader connected, charged, and not mid-firmware-update?
    2. Is the receipt printer reachable, and is it printing at the right width?
    3. Did today's sales actually reach QuickBooks?

  The QuickBooks preflight at the bottom is the one to run BEFORE the first
  live sale: every check that fails there would otherwise fail as a webhook,
  with a customer already charged and gone.
-->
<script>
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { api } from '$lib/api/client.js';
  import { isStaff } from '$lib/stores/auth.js';
  import {
    pos, initTerminal, connectSavedReader, discover, connect,
    disconnect, savedReaderSerial, forgetReader, useSimulator,
  } from '$lib/pos/terminal.js';
  import {
    getPrinterConfig, setPrinterConfig, pairedDevices, testPrinter,
    openCashDrawer, printSaleReceipt,
  } from '$lib/pos/printer.js';
  import { isNative, openLocationSettings } from '$lib/pos/native.js';

  let cfg = getPrinterConfig();
  let devices = [];
  let deviceErr = '';
  let printerMsg = '';
  let readers = [];
  let readerMsg = '';
  let scanning = false;

  let payments = [];
  let paymentsErr = '';
  let loadingPayments = true;
  let onlyUnsynced = false;

  let preflight = null;
  let preflightRunning = false;

  onMount(async () => {
    if (!$isStaff) { goto('/dashboard'); return; }
    if (isNative()) {
      await initTerminal();
      refreshDevices();
    }
    loadPayments();
  });

  // ─── Reader ────────────────────────────────────────────────────────────────
  async function scan() {
    scanning = true; readerMsg = ''; readers = [];
    try {
      readers = await discover({});
      if (!readers.length) {
        readerMsg = 'No readers found. Check the WisePad is powered on and NOT paired in Android Bluetooth settings — the Stripe SDK bonds it itself, and a manual pairing gets in the way.';
      }
    } catch (e) {
      readerMsg = e.message;
    } finally {
      scanning = false;
    }
  }

  async function pick(reader) {
    readerMsg = '';
    try {
      await connect(reader);
      readerMsg = `Connected to ${reader.serialNumber}. This tablet will reconnect to it on its own from now on.`;
    } catch (e) {
      readerMsg = e.message;
    }
  }

  async function forget() {
    forgetReader();
    await disconnect();
    readerMsg = 'Forgotten. Scan and pick a reader to pair this tablet with a different one.';
  }

  async function simulate() {
    readerMsg = '';
    try {
      const out = await useSimulator({ card: 'VISA' });
      readerMsg = out.connected
        ? 'Simulated reader connected. Payments will run end to end — token, PaymentIntent, webhook, QuickBooks — with no hardware.'
        : (out.blocker || 'Could not start the simulator.');
    } catch (e) {
      readerMsg = e.message;
    }
  }

  // ─── Printer ───────────────────────────────────────────────────────────────
  async function refreshDevices() {
    deviceErr = '';
    try { devices = await pairedDevices(); }
    catch (e) { deviceErr = e.message; }
  }

  function saveCfg(patch) { cfg = setPrinterConfig(patch); }

  async function testPrint() {
    printerMsg = '';
    try {
      await testPrinter();
      printerMsg = 'Printer answered.';
    } catch (e) {
      printerMsg = e.message;
    }
  }

  async function sampleReceipt() {
    printerMsg = '';
    try {
      await printSaleReceipt({
        amount_cents: 21470, subtotal_cents: 19000, tax_cents: 2470,
        project_id: 0, client_name: 'TEST PRINT',
        description: 'Sample receipt — check the column width and that nothing wraps',
        payment_intent_id: 'pi_sample_0000000000',
        card_brand: 'visa', card_last4: '4242', payment_method_type: 'card_present',
      }, { emv: { authorization_code: '123456' } });
      printerMsg = 'Sample printed. If the prices do not sit flush right, the column width is wrong.';
    } catch (e) {
      printerMsg = e.message;
    }
  }

  async function kick() {
    printerMsg = '';
    try { await openCashDrawer(); printerMsg = 'Drawer pulse sent.'; }
    catch (e) { printerMsg = e.message; }
  }

  // ─── Reconciliation ────────────────────────────────────────────────────────
  async function loadPayments() {
    loadingPayments = true; paymentsErr = '';
    try {
      payments = await api.terminalPayments(onlyUnsynced ? { unsynced: '1', limit: 100 } : { limit: 50 });
    } catch (e) {
      paymentsErr = e.message;
    } finally {
      loadingPayments = false;
    }
  }

  async function resync(row) {
    try {
      await api.terminalResync(row.id);
      await loadPayments();
    } catch (e) {
      paymentsErr = e.message;
    }
  }

  async function runPreflight() {
    preflightRunning = true; preflight = null;
    try { preflight = await api.terminalQboPreflight(); }
    catch (e) { preflight = { ok: false, checks: [{ name: 'Preflight', ok: false, detail: e.message }] }; }
    finally { preflightRunning = false; }
  }

  function money(c) { return `$${((c || 0) / 100).toFixed(2)}`; }
  function when(ts) { return ts ? new Date(ts).toLocaleString('en-CA') : ''; }
  function methodOf(p) {
    if (p.payment_method_type === 'interac_present') return 'Interac';
    return (p.card_brand || 'Card').toUpperCase();
  }

  $: batteryPct = $pos.batteryLevel == null ? null : Math.round($pos.batteryLevel * 100);
  $: lowBattery = batteryPct != null && batteryPct < 50;
  // Card readers that have been bonded through Android's Bluetooth settings.
  // They must not be — see the warning band below.
  $: pairedReaders = devices.filter((d) => d.looksLikeCardReader);
  // Anything that isn't a reader is a printer candidate.
  $: printerCandidates = devices.filter((d) => !d.looksLikeCardReader);
</script>

<svelte:head><title>Counter POS · Holm Graphics</title></svelte:head>

<div class="page">
  <h1>Counter POS</h1>

  {#if !isNative()}
    <div class="band warn">
      This page is running in a browser. Reader and printer controls only work on the
      counter tablet — the QuickBooks checks below work anywhere.
    </div>
  {/if}

  <!-- ─── Card reader ─────────────────────────────────────────────── -->
  <section class="card">
    <h2>Card reader</h2>

    {#if $pos.blocker}
      <div class="band error">
        {$pos.blocker}
        {#if /location/i.test($pos.blocker) && isNative()}
          <button class="btn btn-sm" on:click={() => openLocationSettings()}>Open location settings</button>
        {/if}
      </div>
    {/if}

    <div class="statline">
      <span class="dot" class:ok={$pos.status === 'connected'} class:warn={$pos.reconnecting || $pos.updateRunning}></span>
      <strong>
        {#if $pos.updateRunning}Installing firmware
        {:else if $pos.reconnecting}Reconnecting
        {:else if $pos.status === 'connected'}Connected
        {:else}{$pos.status}
        {/if}
      </strong>
      {#if $pos.reader}
        <span class="muted">{$pos.reader.serialNumber} · {$pos.reader.deviceType || 'reader'}</span>
      {:else if savedReaderSerial()}
        <span class="muted">remembered: {savedReaderSerial()}</span>
      {/if}
      {#if batteryPct != null}
        <span class="muted" class:bad={lowBattery}>battery {batteryPct}%{$pos.batteryCharging ? ' (charging)' : ''}</span>
      {/if}
      {#if $pos.configured}
        <span class="pill" class:test={$pos.isTest}>{$pos.isTest ? 'TEST MODE' : 'LIVE'}</span>
      {/if}
    </div>

    {#if lowBattery}
      <div class="band warn">
        Under 50%. Firmware updates will not install below that, and a required update
        blocks the reader entirely — keep it on the charger at the counter.
      </div>
    {/if}

    {#if $pos.updateRunning && $pos.updateProgress != null}
      <div class="progress"><div class="bar" style="width:{Math.round($pos.updateProgress * 100)}%"></div></div>
    {/if}

    <div class="row">
      <button class="btn" on:click={() => connectSavedReader()} disabled={!isNative()}>Connect</button>
      <button class="btn" on:click={scan} disabled={!isNative() || scanning}>
        {scanning ? 'Scanning…' : 'Scan for readers'}
      </button>
      <button class="btn btn-ghost" on:click={forget} disabled={!isNative()}>Forget reader</button>
      <button class="btn btn-ghost" on:click={simulate} disabled={!isNative()}>Use simulator</button>
    </div>

    {#if readerMsg}<p class="msg">{readerMsg}</p>{/if}

    {#if readers.length}
      <ul class="picklist">
        {#each readers as r}
          <li>
            <span>{r.label || r.serialNumber} <span class="muted">{r.deviceType || ''}</span></span>
            <button class="btn btn-sm" on:click={() => pick(r)}>Use this one</button>
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <!-- ─── Receipt printer ─────────────────────────────────────────── -->
  <section class="card">
    <h2>Receipt printer &amp; drawer</h2>
    <p class="hint">
      The drawer is wired to the printer, not the tablet — it opens when the printer
      receives the pulse. It fires for cash and cheque only.
    </p>

    {#if deviceErr}<div class="band error">{deviceErr}</div>{/if}

    <!--
      A card reader in the bonded list is not a cosmetic problem. The Stripe
      SDK discovers and bonds the WisePad itself, and a manual pairing in
      Android's Bluetooth settings interferes with that — so this warns rather
      than just labelling the entry in the dropdown.
    -->
    {#if pairedReaders.length}
      <div class="band warn">
        {pairedReaders.map((d) => d.name || d.address).join(', ')}
        {pairedReaders.length > 1 ? 'are card readers' : 'is a card reader'}, paired in Android's
        Bluetooth settings. Unpair {pairedReaders.length > 1 ? 'them' : 'it'} — Settings &gt;
        Bluetooth &gt; the gear icon &gt; Forget. The Stripe SDK bonds the reader itself and a
        manual pairing gets in its way.
      </div>
    {/if}

    <div class="row">
      <label class="fld grow">
        <span>Paired printer</span>
        <select value={cfg.address} on:change={(e) => saveCfg({
          address: e.currentTarget.value,
          name: (devices.find((d) => d.address === e.currentTarget.value) || {}).name || '',
        })}>
          <option value="">— none selected —</option>
          {#each printerCandidates as d}
            <option value={d.address}>{d.name || d.address}</option>
          {/each}
        </select>
      </label>
      <label class="fld">
        <span>Width</span>
        <select value={cfg.width} on:change={(e) => saveCfg({ width: Number(e.currentTarget.value) })}>
          <option value={32}>32 col (58mm)</option>
          <option value={48}>48 col (80mm)</option>
        </select>
      </label>
      <button class="btn" on:click={refreshDevices} disabled={!isNative()}>Refresh</button>
    </div>

    <div class="row">
      <label class="fld grow">
        <span>GST/HST number on receipts</span>
        <input type="text" value={cfg.shop.gstNumber}
               on:change={(e) => saveCfg({ shop: { gstNumber: e.currentTarget.value } })} />
      </label>
      <label class="check">
        <input type="checkbox" checked={cfg.enabled}
               on:change={(e) => saveCfg({ enabled: e.currentTarget.checked })} />
        Printing on
      </label>
    </div>

    <div class="row">
      <button class="btn" on:click={testPrint} disabled={!isNative()}>Test connection</button>
      <button class="btn" on:click={sampleReceipt} disabled={!isNative()}>Print sample receipt</button>
      <button class="btn btn-ghost" on:click={kick} disabled={!isNative()}>Open drawer</button>
    </div>
    {#if printerMsg}<p class="msg">{printerMsg}</p>{/if}
  </section>

  <!-- ─── QuickBooks preflight ────────────────────────────────────── -->
  <section class="card">
    <h2>QuickBooks readiness</h2>
    <p class="hint">
      Run this before the first live sale. Counter sales deposit to a clearing account
      and the Stripe fee posts against it — without both accounts existing, the
      write-back fails after the customer has already been charged.
    </p>
    <button class="btn" on:click={runPreflight} disabled={preflightRunning}>
      {preflightRunning ? 'Checking…' : 'Run preflight'}
    </button>
    {#if preflight}
      <ul class="checks">
        {#each preflight.checks as c}
          <li class:bad={!c.ok}>
            <span class="tick">{c.ok ? '✓' : '✗'}</span>
            <span class="cname">{c.name}</span>
            <span class="cdetail">{c.detail}</span>
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <!-- ─── Recent counter sales ────────────────────────────────────── -->
  <section class="card">
    <h2>Counter sales</h2>
    <div class="row">
      <label class="check">
        <input type="checkbox" bind:checked={onlyUnsynced} on:change={loadPayments} />
        Only ones QuickBooks hasn't taken
      </label>
      <button class="btn btn-sm" on:click={loadPayments}>Refresh</button>
    </div>

    {#if paymentsErr}<div class="band error">{paymentsErr}</div>{/if}

    {#if loadingPayments}
      <p class="muted">Loading…</p>
    {:else if !payments.length}
      <p class="muted">Nothing yet.</p>
    {:else}
      <div class="tablewrap">
        <table>
          <thead>
            <tr>
              <th>When</th><th>Job</th><th>Customer</th><th>Method</th>
              <th class="r">Amount</th><th class="r">Fee</th><th>Status</th><th>QuickBooks</th><th></th>
            </tr>
          </thead>
          <tbody>
            {#each payments as p}
              <tr>
                <td>{when(p.created_at)}</td>
                <td>{p.project_id ? `#${p.project_id}` : '—'}</td>
                <td>{p.client_name || '—'}</td>
                <td>{methodOf(p)}{p.card_last4 ? ` ••${p.card_last4}` : ''}</td>
                <td class="r">{money(p.amount_cents)}</td>
                <td class="r">{p.fee_cents != null ? money(p.fee_cents) : '—'}</td>
                <td><span class="status s-{p.status}">{p.status}</span></td>
                <td>
                  {#if p.qbo_synced_at}
                    {p.qbo_doc_type} {p.qbo_doc_id}
                    {#if p.qbo_warning}<div class="warntext">{p.qbo_warning}</div>{/if}
                  {:else if p.status === 'succeeded'}
                    <span class="warntext">not synced{p.qbo_error ? `: ${p.qbo_error}` : ''}</span>
                  {:else}
                    —
                  {/if}
                </td>
                <td>
                  <!-- Retry covers two cases: the sale never posted, and the
                       sale posted but its fee didn't. The second one still
                       leaves the clearing account short. -->
                  {#if p.status === 'succeeded' && (!p.qbo_synced_at || (!p.qbo_fee_purchase_id && p.fee_cents > 0))}
                    <button class="btn btn-sm" on:click={() => resync(p)}>
                      {p.qbo_synced_at ? 'Post fee' : 'Retry'}
                    </button>
                  {/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </section>
</div>

<style>
  .page { max-width: 1100px; margin: 0 auto; padding: 20px; display: flex; flex-direction: column; gap: 18px; }
  h1 {
    font-family: var(--font-display); text-transform: uppercase;
    letter-spacing: 0.05em; margin: 0;
  }
  .card {
    background: var(--surface); border: 1px solid var(--border);
    border-radius: var(--radius-lg); padding: 18px; box-shadow: var(--shadow);
  }
  .card h2 {
    font-family: var(--font-display); font-size: 1.05rem; text-transform: uppercase;
    letter-spacing: 0.05em; margin: 0 0 10px;
  }
  .band { padding: 10px 12px; border-radius: var(--radius); font-size: 0.85rem; margin-bottom: 10px; }
  .band.error { background: #fee2e2; color: #991b1b; }
  .band.warn  { background: #fef3c7; color: #92400e; }

  .statline { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 10px; }
  .dot { width: 10px; height: 10px; border-radius: 50%; background: var(--text-dim); }
  .dot.ok { background: var(--green); }
  .dot.warn { background: var(--amber); }
  .muted { color: var(--text-dim); font-size: 0.85rem; }
  .muted.bad { color: var(--red); font-weight: 600; }
  .pill {
    font-size: 0.7rem; letter-spacing: 0.08em; padding: 2px 8px;
    border-radius: 999px; background: var(--green); color: #fff;
  }
  .pill.test { background: var(--amber); }

  .progress { height: 6px; background: var(--surface-3); border-radius: 3px; margin: 8px 0; }
  .progress .bar { height: 100%; background: var(--amber); border-radius: 3px; transition: width 0.3s; }

  .row { display: flex; gap: 10px; align-items: flex-end; flex-wrap: wrap; margin-bottom: 10px; }
  .fld { display: flex; flex-direction: column; gap: 4px; }
  .fld.grow { flex: 1; min-width: 220px; }
  .fld > span { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-dim); }
  .fld select, .fld input {
    padding: 8px 10px; border: 1px solid var(--border-mid);
    border-radius: var(--radius); background: var(--surface);
  }
  .check { display: flex; align-items: center; gap: 6px; font-size: 0.85rem; }

  .picklist { list-style: none; padding: 0; margin: 8px 0 0; }
  .picklist li {
    display: flex; align-items: center; justify-content: space-between;
    padding: 8px 0; border-bottom: 1px solid var(--border);
  }

  .checks { list-style: none; padding: 0; margin: 12px 0 0; font-size: 0.86rem; }
  .checks li { display: grid; grid-template-columns: 20px 220px 1fr; gap: 8px; padding: 5px 0; }
  .checks li.bad { color: var(--red); }
  .tick { font-weight: 700; }
  .cname { font-weight: 600; }
  .cdetail { color: var(--text-muted); }

  .msg { font-size: 0.85rem; color: var(--text-muted); margin: 6px 0 0; }
  .hint { font-size: 0.8rem; color: var(--text-dim); margin: 0 0 10px; }

  .tablewrap { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
  th, td { text-align: left; padding: 7px 8px; border-bottom: 1px solid var(--border); vertical-align: top; }
  th { font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-dim); }
  .r { text-align: right; }
  .status { text-transform: uppercase; font-size: 0.72rem; letter-spacing: 0.04em; }
  .s-succeeded { color: var(--green); }
  .s-pending   { color: var(--amber); }
  .s-failed, .s-canceled { color: var(--text-dim); }
  .s-refunded, .s-partially_refunded { color: var(--red); }
  .warntext { color: var(--amber); font-size: 0.78rem; }
</style>
