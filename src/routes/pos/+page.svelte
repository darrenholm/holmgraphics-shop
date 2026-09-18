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
    disconnect, savedReaderSerial, forgetReader, useSimulator, syncFromSdk,
  } from '$lib/pos/terminal.js';
  import {
    getPrinterConfig, setPrinterConfig, pairedDevices, testPrinter,
    openCashDrawer, printSaleReceipt, transportFor,
  } from '$lib/pos/printer.js';
  import { isNative, openLocationSettings, restartApp } from '$lib/pos/native.js';
  import RefundModal from '$lib/components/RefundModal.svelte';
  import { flush as flushReaderLog } from '$lib/pos/readerlog.js';
  import {
    getReceiptBridgeConfig, setReceiptBridgeConfig,
    receiptBridgeHealth, receiptBridgePrinters,
  } from '$lib/printing/receiptBridgeClient.js';
  import {
    smartReader, savedSmartReaderId, useSmartReader, forgetSmartReader,
    listReaders, registerReader, refreshStatus,
  } from '$lib/pos/smartReader.js';

  let cfg = getPrinterConfig();
  let devices = [];
  let deviceErr = '';
  let printerMsg = '';
  let readers = [];
  let readerMsg = '';
  let scanning = false;
  let connecting = false;

  let payments = [];
  let paymentsErr = '';
  let refunding = null;      // the terminal_payments row being refunded
  let refundOpen = false;

  // WiFi reader (WisePOS E)
  // Receipt bridge (USB printer on Design Centre 1)
  let bridgeCfg = getReceiptBridgeConfig();
  let bridgeMsg = '';
  let bridgePrinters = [];

  function saveBridge(patch) {
    setReceiptBridgeConfig(patch);
    bridgeCfg = getReceiptBridgeConfig();
    cfg = getPrinterConfig();          // transport may have become available
  }

  async function checkBridge() {
    bridgeMsg = ''; bridgePrinters = [];
    try {
      const h = await receiptBridgeHealth();
      const { printers } = await receiptBridgePrinters();
      bridgePrinters = printers || [];
      bridgeMsg = `Connected to ${h.host || 'the bridge'}${h.defaultPrinter ? ` — default printer ${h.defaultPrinter}` : ''}.`;
    } catch (e) {
      bridgeMsg = e.message;
    }
  }

  let wifiReaders = [];
  let wifiMsg = '';
  let wifiBusy = false;
  let pairingCode = '';
  let readerLabel = 'Front counter';

  let readerLog = [];
  let readerLogErr = '';
  let loadingLog = false;
  let showLog = false;
  let loadingPayments = true;
  let onlyUnsynced = false;

  let preflight = null;
  let preflightRunning = false;

  onMount(async () => {
    if (!$isStaff) { goto('/dashboard'); return; }
    // The Bluetooth WisePad is retired (2026-09-18) — nothing here starts it
    // any more. refreshDevices stays: the receipt printer is a bonded
    // Bluetooth device and this is where it gets picked.
    if (isNative()) refreshDevices();
    loadPayments();
    // A WiFi reader is remembered per device; show its real state rather than
    // an empty panel that makes it look unset.
    if (savedSmartReaderId()) { refreshStatus(); loadWifiReaders(); }
  });

  // ─── Reader ────────────────────────────────────────────────────────────────
  async function scan() {
    scanning = true; readerMsg = ''; readers = [];
    try {
      readers = await discover({});
      if (!readers.length) {
        readerMsg = 'No readers found. Wake the reader — hold its power button until the Bluetooth light flashes — and scan again.';
      }
    } catch (e) {
      readerMsg = e.message;
    } finally {
      scanning = false;
    }
  }

  // connectSavedReader() reports failure by returning a `blocker` string
  // rather than throwing. The Connect button used to call it inline and throw
  // the result away, so when the reader had gone back to sleep the button
  // looked completely dead — no spinner, no error, nothing.
  async function reconnect() {
    connecting = true; readerMsg = '';
    try {
      const out = await connectSavedReader();
      if (!out?.connected) {
        readerMsg = out?.blocker
          || 'Could not connect. Wake the reader (hold its power button until the Bluetooth light flashes) and try again.';
      }
    } catch (e) {
      readerMsg = e.message;
    } finally {
      connecting = false;
    }
  }

  // ─── One button that does the whole recovery ───────────────────────────────
  // Staff had four buttons and no way to know which one to press, and the
  // wrong one (Forget reader) made things worse. This runs the steps in the
  // order that actually works and says what it is doing in words.
  let fixing = false;
  let fixStep = '';

  async function fixReader() {
    fixing = true; readerMsg = ''; readers = [];
    try {
      fixStep = 'Checking the reader...';
      if (await syncFromSdk()) {
        readerMsg = 'Already connected — nothing to fix.';
        return;
      }

      fixStep = 'Reconnecting...';
      const out = await connectSavedReader();
      if (out?.connected) { readerMsg = 'Reader connected.'; return; }

      fixStep = 'Looking for the reader...';
      const found = await discover({});
      if (!found.length) {
        readerMsg = 'Cannot find the reader. Press and hold its power button '
                  + 'until the blue light flashes, then tap Fix the reader again.';
        return;
      }

      // A first-time pair puts a code on screen that someone has to accept.
      // Saying so BEFORE it appears is the difference between it working and
      // it timing out unnoticed.
      fixStep = 'Pairing — if a box appears asking to Pair, tap it';
      await connect(found[0]);
      readerMsg = 'Reader connected.';
    } catch (e) {
      readerMsg = plainError(e?.message || String(e));
    } finally {
      fixing = false; fixStep = '';
    }
  }

  // The SDK's wording is useless at a counter. Translate the ones we have
  // actually hit; pass anything else through rather than inventing a guess.
  function plainError(msg) {
    if (/unexpectedly disconnected/i.test(msg)) {
      return 'Pairing did not finish. Tap Fix the reader again and watch this '
           + 'screen for a box asking you to Pair — it has to be tapped within '
           + 'a few seconds.';
    }
    if (/not found|no card reader/i.test(msg)) {
      return 'Cannot find the reader. Press and hold its power button until the '
           + 'blue light flashes, then tap Fix the reader again.';
    }
    if (/location/i.test(msg)) {
      return 'The tablet needs Location switched on before it can find the reader.';
    }
    return msg;
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

  // Destructive, and it sits right next to Connect and Scan — which are what
  // someone reaches for when the reader ISN'T working. Pressing it then makes
  // things worse: the tablet stops auto-reconnecting and needs a fresh pair,
  // with a pairing code someone has to accept. That has now happened twice in
  // the field, so it asks first.
  async function forget() {
    const ok = confirm(
      'Forget this reader? Only do this if you are swapping to a DIFFERENT reader. '
      + 'The tablet will stop reconnecting on its own, and pairing it again needs '
      + 'someone here to accept a code on this screen. '
      + 'If the reader just will not connect, cancel this and tap Connect instead.'
    );
    if (!ok) return;
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
        project_id: 9999, client_name: 'TEST PRINT',
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

  // Refunds. A sale can be refunded until nothing is left on it — the modal
  // works out whether that means the reader (Interac) or the server (credit),
  // because staff shouldn't have to.
  function refundableCents(p) {
    if (p.status !== 'succeeded' && p.status !== 'partially_refunded') return 0;
    if (!p.charge_id) return 0;   // Stripe hasn't settled it yet
    return Math.max(0, (p.amount_cents || 0) - (p.amount_refunded_cents || 0));
  }

  function openRefund(p) {
    refunding = p;
    refundOpen = true;
  }

  async function onRefunded() {
    await loadPayments();
  }

  // The reader diary. Deliberately behind a toggle — it is for working out
  // why the reader dropped, not something the counter needs to look at.
  async function loadReaderLog() {
    loadingLog = true; readerLogErr = '';
    try {
      await flushReaderLog();     // push anything still queued on this tablet
      readerLog = await api.terminalReaderLog({ limit: 200 });
    } catch (e) {
      readerLogErr = e.message;
    } finally {
      loadingLog = false;
    }
  }

  function toggleLog() {
    showLog = !showLog;
    if (showLog && !readerLog.length) loadReaderLog();
  }

  // Plain English for the event names the tablet writes.
  function eventLabel(e) {
    return {
      connected:             'Connected',
      disconnected:          'Dropped',
      unexpected_disconnect: 'Dropped unexpectedly',
      watchdog_reconnecting: 'Trying to reconnect',
      watchdog_recovered:    'Got it back',
      watchdog_failed:       'Reconnect failed',
      hidden:                'App went to the background',
      visible:               'App came back',
      bluetooth_down:        'Tablet Bluetooth went down',
      bluetooth_recovered:   'Tablet Bluetooth came back — app restarting',
      printed:               'Printed a receipt',
      restarting_app:        'Gave up — restarting the app',
      cycling_bluetooth:     'Restarting the tablet’s Bluetooth',
      cycling_bluetooth_failed: 'Could not restart Bluetooth',
      needs_reader_restart:  'Asked staff to restart the reader',
      payment_started:       'Payment started',
      payment_finished:      'Payment finished',
    }[e.event] || e.event;
  }

  // The recovery of last resort, and now the only one anybody should need.
  // A wedged Bluetooth stack cannot be fixed from inside this process, so
  // before this existed the answer was "reboot the tablet".
  async function restartTheApp() {
    if (!confirm('Restart the POS app? It comes back in a few seconds. Do not do this mid-payment.')) return;
    try { await restartApp(); } catch (e) { readerMsg = e.message; }
  }

  function eventClass(e) {
    if (['disconnected', 'unexpected_disconnect', 'watchdog_failed', 'bluetooth_down', 'restarting_app', 'cycling_bluetooth_failed', 'needs_reader_restart'].includes(e.event)) return 'bad';
    if (['connected', 'watchdog_recovered'].includes(e.event)) return 'good';
    return '';
  }

  // ─── WiFi reader ───────────────────────────────────────────────────────────
  async function loadWifiReaders() {
    wifiBusy = true; wifiMsg = '';
    try {
      wifiReaders = (await listReaders()).filter((r) => r.deviceType !== 'bbpos_wisepad3');
      await refreshStatus();
    } catch (e) { wifiMsg = e.message; } finally { wifiBusy = false; }
  }

  async function doRegister() {
    const code = pairingCode.trim();
    if (!code) { wifiMsg = 'Enter the code shown on the reader.'; return; }
    wifiBusy = true; wifiMsg = '';
    try {
      const r = await registerReader(code, readerLabel);
      pairingCode = '';
      wifiMsg = `Registered ${r.label || r.id}. This device will use it.`;
      await loadWifiReaders();
    } catch (e) { wifiMsg = e.message; } finally { wifiBusy = false; }
  }

  function chooseWifiReader(r) {
    useSmartReader(r);
    wifiMsg = `This device now sends sales to ${r.label || r.id}.`;
  }

  function dropWifiReader() {
    if (!confirm('Stop using the WiFi reader on this device? Payments will go back to the Bluetooth reader.')) return;
    forgetSmartReader();
    wifiMsg = 'This device is back on the Bluetooth reader.';
  }

  async function runPreflight() {
    preflightRunning = true; preflight = null;
    try { preflight = await api.terminalPreflight(); }
    catch (e) { preflight = { ok: false, checks: [{ name: 'Preflight', ok: false, detail: e.message }] }; }
    finally { preflightRunning = false; }
  }

  function money(c) { return `$${((c || 0) / 100).toFixed(2)}`; }
  function when(ts) { return ts ? new Date(ts).toLocaleString('en-CA') : ''; }
  function methodOf(p) {
    if (p.payment_method_type === 'interac_present') return 'Interac';
    return (p.card_brand || 'Card').toUpperCase();
  }

  // One sentence anyone on the counter can act on. The raw store values —
  // "idle", "discovering" — meant nothing to the person standing there.
  $: readerPlain =
      !isNative()                     ? 'Reader only works on the counter tablet'
    : $pos.blocker                    ? $pos.blocker
    : $pos.updateRunning              ? 'Updating the reader — leave it alone, this takes a few minutes'
    : $pos.reconnecting               ? 'Reconnecting to the reader...'
    : $pos.status === 'connected'     ? 'Ready to take payments'
    : $pos.status === 'discovering'   ? 'Looking for the reader...'
    : $pos.status === 'connecting'    ? 'Connecting...'
    : $pos.status === 'initializing'  ? 'Starting up...'
    : savedReaderSerial()             ? 'Not connected — tap Fix the reader'
    :                                   'No reader set up yet — tap Fix the reader';

  $: batteryPct = $pos.batteryLevel == null ? null : Math.round($pos.batteryLevel * 100);
  $: lowBattery = batteryPct != null && batteryPct < 50;
  // Card readers bonded at the Android level.
  //
  // This is NOT automatically wrong, and an earlier version of this screen
  // said it was. The Stripe SDK creates its own Android bond when it first
  // pairs a reader — that's the numeric-comparison dialog someone accepts on
  // this tablet — so a working reader legitimately appears in Android's
  // Bluetooth list. Telling staff to unpair it would break the very thing
  // that makes it work.
  //
  // Only surface it while we are NOT connected, and then only as a
  // troubleshooting suggestion: a stale bond does block connecting, and
  // forgetting it forces a fresh pair.
  $: pairedReaders = $pos.status === 'connected'
    ? []
    : devices.filter((d) => d.looksLikeCardReader);
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

  <!-- ─── WiFi reader ─────────────────────────────────────────────── -->
  <!-- The WisePOS E holds no connection to this device: the server tells it
       what to collect and it talks to Stripe over the shop WiFi. So there is
       no pairing, nothing to drop, and any machine in the shop can send a
       sale to it — including the office PC. -->
  <section class="card">
    <h2>WiFi reader</h2>

    {#if $smartReader.id}
      <p>
        This device sends sales to <strong>{$smartReader.label || $smartReader.id}</strong>
        {#if $smartReader.status}
          — <span class="status s-{$smartReader.status === 'online' ? 'succeeded' : 'failed'}">{$smartReader.status}</span>
        {/if}
      </p>
      {#if $smartReader.status === 'offline'}
        <div class="band warn">
          The reader is not reachable. Check it is powered on and on the shop WiFi.
        </div>
      {/if}
    {:else}
      <p class="muted">
        This device uses the Bluetooth reader. Register a WisePOS E below, or pick one
        already registered, to use it instead.
      </p>
    {/if}

    <div class="row">
      <button class="btn btn-sm" on:click={loadWifiReaders} disabled={wifiBusy}>
        {wifiBusy ? 'Working…' : 'Check readers'}
      </button>
      {#if $smartReader.id}
        <button class="btn btn-sm btn-ghost" on:click={dropWifiReader}>Use Bluetooth instead</button>
      {/if}
    </div>

    {#if wifiMsg}<p class="msg">{wifiMsg}</p>{/if}

    {#if wifiReaders.length}
      <ul class="picklist">
        {#each wifiReaders as r}
          <li>
            <span>
              {r.label || r.id}
              <span class="muted">{r.deviceType} · {r.status}</span>
            </span>
            {#if r.id === $smartReader.id}
              <span class="muted">in use</span>
            {:else}
              <button class="btn btn-sm" on:click={() => chooseWifiReader(r)}>Use this one</button>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}

    <details class="advanced">
      <summary>Add a new reader</summary>
      <p class="muted">
        On the reader: connect it to the shop WiFi, then Settings → Generate pairing code.
        The code is only good for a few minutes.
      </p>
      <div class="row">
        <input class="inp" placeholder="pairing code" bind:value={pairingCode} />
        <input class="inp" placeholder="name, e.g. Front counter" bind:value={readerLabel} />
        <button class="btn btn-sm" on:click={doRegister} disabled={wifiBusy}>Register</button>
      </div>
    </details>
  </section>

  <!-- ─── Receipt printer ─────────────────────────────────────────── -->
  <section class="card">
    <h2>Receipt printer &amp; drawer</h2>
    <p class="hint">
      The drawer is wired to the printer, not the tablet — it opens when the printer
      receives the pulse. It fires for cash and cheque only.
    </p>

    {#if deviceErr}<div class="band error">{deviceErr}</div>{/if}

    <p class="hint">
      This machine prints via <strong>{transportFor(cfg) === 'bluetooth' ? 'Bluetooth (tablet)'
        : transportFor(cfg) === 'usb' ? 'the USB bridge on Design Centre 1' : 'nothing yet'}</strong>.
    </p>


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

    <!-- Receipt letterhead. Editable because it is printed on every receipt
         a customer walks out with, and a move or a GST registration should
         not need a rebuild and a sideload to correct. -->
    <div class="row">
      <label class="fld grow">
        <span>Shop name on receipts</span>
        <input type="text" value={cfg.shop.name}
               on:change={(e) => saveCfg({ shop: { name: e.currentTarget.value } })} />
      </label>
      <label class="fld grow">
        <span>Phone</span>
        <input type="text" value={cfg.shop.phone}
               on:change={(e) => saveCfg({ shop: { phone: e.currentTarget.value } })} />
      </label>
    </div>
    <div class="row">
      <label class="fld grow">
        <span>Address (one line per printed line)</span>
        <input type="text" value={(cfg.shop.address || []).join(' / ')}
               on:change={(e) => saveCfg({ shop: {
                 address: e.currentTarget.value.split('/').map((x) => x.trim()).filter(Boolean),
               } })} />
      </label>
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

  <!-- ─── USB receipt bridge ──────────────────────────────────────── -->
  <!-- The Bluetooth printer only answers the tablet. This is the same printer
       reached over its USB cable, through a small service on Design Centre 1,
       so a sale started at any desk still prints — and still opens the drawer,
       because the drawer pulse travels inside the receipt data either way. -->
  <section class="card">
    <h2>Receipt printing from this computer</h2>
    <p class="hint">
      Only needed on machines without the tablet's Bluetooth printer. Design Centre 1
      must be switched on for this to work.
    </p>

    <div class="row">
      <label class="fld grow">
        <span>Bridge address</span>
        <input class="inp" type="text" placeholder="https://receipts.holmgraphics.ca"
               value={bridgeCfg.url}
               on:change={(e) => saveBridge({ url: e.currentTarget.value })} />
      </label>
      <label class="fld grow">
        <span>Key</span>
        <input class="inp" type="password" placeholder="bridge API key"
               value={bridgeCfg.key}
               on:change={(e) => saveBridge({ key: e.currentTarget.value })} />
      </label>
      <button class="btn btn-sm" on:click={checkBridge}>Check</button>
    </div>

    <div class="row">
      <label class="fld grow">
        <span>Printer</span>
        {#if bridgePrinters.length}
          <select value={bridgeCfg.printer}
                  on:change={(e) => saveBridge({ printer: e.currentTarget.value })}>
            <option value="">— the bridge's own default —</option>
            {#each bridgePrinters as p}<option value={p}>{p}</option>{/each}
          </select>
        {:else}
          <input class="inp" type="text" placeholder="leave blank to use the bridge default"
                 value={bridgeCfg.printer}
                 on:change={(e) => saveBridge({ printer: e.currentTarget.value })} />
        {/if}
      </label>
      <label class="fld">
        <span>Use</span>
        <select value={cfg.transport} on:change={(e) => saveCfg({ transport: e.currentTarget.value })}>
          <option value="auto">Automatic</option>
          <option value="bluetooth">Bluetooth only</option>
          <option value="usb">USB bridge only</option>
        </select>
      </label>
      <button class="btn btn-sm" on:click={sampleReceipt}>Test receipt</button>
    </div>

    {#if bridgeMsg}<p class="msg">{bridgeMsg}</p>{/if}
  </section>

  <!-- ─── QuickBooks preflight ────────────────────────────────────── -->
  <section class="card">
    <h2>Readiness</h2>
    <p class="hint">
      Run this before the first live sale. Checks the Stripe account can both charge
      AND pay out — separate flags, and a successful sale only proves the first — the
      Terminal location resolves under this key, and the QuickBooks accounts the
      write-back deposits to and draws fees from actually exist.
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
                <td class="r">
                  {money(p.amount_cents)}
                  {#if p.amount_refunded_cents > 0}
                    <div class="warntext">-{money(p.amount_refunded_cents)} refunded</div>
                  {/if}
                </td>
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
                  {#if refundableCents(p) > 0}
                    <button class="btn btn-sm" on:click={() => openRefund(p)}>Refund</button>
                  {/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </section>

<!-- ─── Reader diary ───────────────────────────────────────────── -->
  <section class="card">
    <div class="row">
      <h2 style="margin:0">Reader log</h2>
      <button class="btn btn-sm" on:click={toggleLog}>{showLog ? 'Hide' : 'Show'}</button>
      {#if showLog}
        <button class="btn btn-sm" on:click={loadReaderLog}>Refresh</button>
      {/if}
    </div>
    {#if showLog}
      <p class="muted">
        What the card reader has been doing. Use this to answer whether a drop
        fixed itself, and what the reader said the reason was.
      </p>
      {#if readerLogErr}<div class="band error">{readerLogErr}</div>{/if}
      {#if loadingLog}
        <p class="muted">Loading…</p>
      {:else if !readerLog.length}
        <p class="muted">Nothing recorded yet.</p>
      {:else}
        <div class="tablewrap">
          <table>
            <thead>
              <tr><th>When</th><th>What</th><th>Why</th><th>Battery</th></tr>
            </thead>
            <tbody>
              {#each readerLog as e}
                <tr>
                  <td>{when(e.occurred_at)}</td>
                  <td class="ev {eventClass(e)}">{eventLabel(e)}</td>
                  <td>
                    {e.reason || '—'}
                    {#if e.detail?.tookMs != null}
                      <span class="muted"> ({(e.detail.tookMs / 1000).toFixed(1)}s)</span>
                    {/if}
                  </td>
                  <td>{e.battery_pct != null ? `${e.battery_pct}%` : '—'}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    {/if}
  </section>
</div>

<!-- Keyed on the sale: a fresh instance per payment, so the amount field and
     the running state can be seeded at construction instead of from a
     reactive block that fires in the wrong order. -->
{#key refunding?.id}
  <RefundModal
    bind:open={refundOpen}
    payment={refunding}
    on:refunded={onRefunded}
    on:close={() => { refunding = null; }}
  />
{/key}

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
  .plain { font-size: 1.15rem; }
  .statline.detail { margin-top: -4px; margin-bottom: 10px; }
  .fix-btn { padding: 12px 26px; font-size: 1.05rem; }
  .advanced { margin-top: 4px; }
  .advanced summary {
    cursor: pointer; font-size: 0.8rem; color: var(--text-dim);
    padding: 4px 0; user-select: none;
  }
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
  .ev.bad  { color: #991b1b; font-weight: 600; }
  .ev.good { color: #166534; font-weight: 600; }
  .status { text-transform: uppercase; font-size: 0.72rem; letter-spacing: 0.04em; }
  .s-succeeded { color: var(--green); }
  .s-pending   { color: var(--amber); }
  .s-failed, .s-canceled { color: var(--text-dim); }
  .s-refunded, .s-partially_refunded { color: var(--red); }
  .warntext { color: var(--amber); font-size: 0.78rem; }
  .inp {
    padding: 8px 10px; border: 1px solid var(--border); border-radius: 8px;
    background: var(--surface); color: inherit; font-size: 0.95rem; min-width: 150px;
  }
</style>
