<!--
  src/routes/rodeo/+page.svelte

  Rodeo Test Bed: a place to try Holmdale Pro Rodeo gear on the shop network
  before event day.

  Bar ticket kiosk: runs ON the counter WisePOS E. The customer picks beer and
  premium quantities on the reader, then gets a payment screen with a
  "Simulate payment" button. Pressing it prints one ticket per drink on the
  Epson network printer (same printer setting as Counter POS), shows a
  summary on the reader, and
  goes back to the ticket screen for the next customer.

  No PaymentIntent is ever created: the reader only shows input screens
  (collect_inputs) and a cart (set_reader_display). Nothing is charged and
  nothing reaches Counter sales or QuickBooks. While the kiosk is running the
  counter can't take a card sale on that reader, so press Stop when done.

  Add new test sections as more rodeo equipment arrives (wristband printer,
  gate scanner, ...).
-->
<script>
  import { onMount, onDestroy } from 'svelte';
  import { isStaff } from '$lib/stores/auth.js';
  import { api } from '$lib/api/client.js';
  import { savedSmartReaderId, listReaders } from '$lib/pos/smartReader.js';
  import { getPrinterConfig, setPrinterConfig, printRawBytes, testPrinter, transportFor } from '$lib/pos/printer.js';
  import { buildTickets, buildCutTest, newSaleId } from '$lib/rodeo/tickets.js';

  const LS_KEY = 'hg_rodeo_testbed';
  // What each ticket buys, shown on the reader's keypad screens (Stripe allows 100 characters).
  const BEER_LIST = 'Miller Lite \u00b7 Coors \u00b7 Old Milwaukee \u00b7 Seltzer \u00b7 Twisted Tea \u00b7 Rye \u00b7 Rum';
  const PREMIUM_LIST = 'Caesar';
  const MAX_EACH = 10;
  const CART_MS = 3000;              // cart preview on the reader before the pay button
  const POLL_MS = 1000;
  const DONE_MS = 4000;              // summary on the reader before the next customer
  const IDLE_STOP_MS = 15 * 60_000;  // give the reader back to the counter if nobody uses it

  // Per-machine settings: logo, reader, prices. The printer and paper width
  // are the Counter POS printer settings, shared, so there is one place to set them.
  let settings = { beerPrice: 7, premiumPrice: 9, logo: true, readerId: '' };
  let pcfg = getPrinterConfig();
  let readers = [];
  let printerState = { state: 'checking', text: 'Checking the printer...' };

  let busy = false;
  let result = null;        // printer test buttons
  let running = false;      // kiosk loop on the reader
  let status = 'Stopped';
  let kioskError = '';
  let log = [];             // simulated sales, this visit only
  let lastActivity = 0;

  const money = (n) => '$' + Number(n).toFixed(2);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const cents = (n) => Math.round(Number(n) * 100);

  function save() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(settings)); } catch { /* private mode */ }
  }

  function savePrinter(patch) {
    pcfg = setPrinterConfig(patch);
    checkPrinter();
  }

  async function checkPrinter() {
    if (transportFor(pcfg) !== 'network') {
      printerState = { state: 'bad', text: 'This machine is not set to the network printer. Set it in Counter POS > Receipt printer.' };
      return;
    }
    printerState = { state: 'checking', text: `Checking ${pcfg.netHost}...` };
    try {
      const r = await testPrinter();
      printerState = r.problem
        ? { state: 'bad', text: `Printer at ${pcfg.netHost} answered, but ${r.problem}.` }
        : { state: 'ok', text: `Printer online at ${pcfg.netHost}.` };
    } catch (e) {
      printerState = { state: 'bad', text: e.message };
    }
  }

  async function loadReaders() {
    try {
      readers = await listReaders();
      if (!settings.readerId) settings.readerId = savedSmartReaderId() || readers[0]?.id || '';
    } catch (e) {
      kioskError = `Could not list card readers: ${e.message}`;
    }
  }

  const print = (bytes) => printRawBytes(bytes);

  async function quick(label, bytes) {
    busy = true; result = null;
    try { await print(bytes); result = { ok: true, title: label, text: 'Sent to the printer.' }; }
    catch (e) { result = { ok: false, title: 'Printer problem', text: e.message }; }
    finally { busy = false; }
  }

  // ─── Kiosk on the reader ───────────────────────────────────────────────────

  // Puts input screens on the reader and waits for the answers.
  // Returns the inputs array, or null if cancelled / timed out / stopped.
  async function screen(inputs) {
    await api.terminalReaderInputs(settings.readerId, inputs);
    while (running) {
      await sleep(POLL_MS);
      if (Date.now() - lastActivity > IDLE_STOP_MS) {
        kioskError = 'Stopped after 15 minutes with no sales, so the counter can use the reader.';
        await stop();
        return null;
      }
      let r;
      try { r = await api.terminalReader(settings.readerId); } catch { continue; }
      const a = r.action;
      if (!a || a.type !== 'collect_inputs') return null;      // someone else took the reader
      if (a.status === 'in_progress') continue;
      return a.status === 'succeeded' ? (a.inputs || []) : null;
    }
    return null;
  }

  // Two keypad screens, one after the other (the reader shows one input per
  // screen): beer, then premium. "None" skips to zero.
  const qty = (input) => {
    if (!input || input.skipped) return 0;
    const n = parseInt(input.numeric, 10);
    return Number.isFinite(n) ? Math.max(0, Math.min(MAX_EACH, n)) : 0;
  };

  async function pickTickets() {
    status = 'Terminal: choosing tickets';
    const ans = await screen([
      { type: 'numeric', required: false,
        custom_text: { title: 'How many BEER tickets?', description: `${money(settings.beerPrice)} each\n${BEER_LIST}\n19+ only`, submit_button: 'Next', skip_button: 'None' } },
      { type: 'numeric', required: false,
        custom_text: { title: 'How many PREMIUM tickets?', description: `${money(settings.premiumPrice)} each\n${PREMIUM_LIST}\n19+ only`, submit_button: 'Next', skip_button: 'None' } },
    ]);
    if (!running || !ans) return null;
    const beer = qty(ans[0]);
    const premium = qty(ans[1]);
    return beer + premium ? { beer, premium } : null;
  }

  async function oneCustomer() {
    const picked = await pickTickets();
    if (!running || !picked) return;
    const { beer, premium } = picked;

    lastActivity = Date.now();
    const total = beer * settings.beerPrice + premium * settings.premiumPrice;
    const lines = [];
    if (beer) lines.push({ description: 'Beer ticket', amount: cents(settings.beerPrice * beer), quantity: beer });
    if (premium) lines.push({ description: 'Premium ticket', amount: cents(settings.premiumPrice * premium), quantity: premium });
    // Stripe's own cart screen first, so it looks like a real sale, then the button.
    status = `Terminal: cart, ${money(total)}`;
    try { await api.terminalReaderDisplay(settings.readerId, lines, cents(total)); await sleep(CART_MS); } catch { /* go straight on */ }
    if (!running) return;
    status = `Terminal: payment screen, ${money(total)}`;
    const paid = await screen([
      { type: 'selection',
        custom_text: { title: `Total ${money(total)}`, description: `${beer} beer, ${premium} premium. Tap, insert or swipe card.` },
        selection: { choices: [
          { id: 'pay', text: 'Simulate payment', style: 'primary' },
          { id: 'cancel', text: 'Cancel', style: 'secondary' },
        ] } },
    ]);
    if (!running || !paid || paid[0]?.selection !== 'pay') return;

    lastActivity = Date.now();
    const sale = { id: newSaleId(), beer, premium, total, test: true };
    status = 'Printing tickets';
    api.terminalReaderDisplay(settings.readerId, lines, cents(total)).catch(() => {});
    let ok = true;
    try { await print(buildTickets(sale, { width: pcfg.width, logo: settings.logo })); }
    catch (e) { ok = false; kioskError = `Printer problem: ${e.message}`; }
    log = [{ when: new Date().toLocaleTimeString('en-CA'), ...sale, ok }, ...log].slice(0, 20);
    status = ok ? 'Approved, tickets printed' : 'Approved, but the tickets did not print';
    await sleep(DONE_MS);
  }

  async function start() {
    kioskError = '';
    if (!settings.readerId) { kioskError = 'Pick a card reader first.'; return; }
    save();
    running = true;
    lastActivity = Date.now();
    let quickFails = 0;
    while (running) {
      try {
        const t = Date.now();
        await oneCustomer();
        // A round that ends within seconds means the reader dropped the screen
        // straight away. A few in a row means it isn't going to work: stop
        // rather than hammer the reader.
        quickFails = Date.now() - t < 3000 ? quickFails + 1 : 0;
        if (quickFails >= 5) {
          kioskError = 'The reader keeps closing the ticket screens. Check it is online and not in use, then Start again.';
          await stop();
        }
      } catch (e) {
        kioskError = e.message;
        // Reader busy with a real sale, or offline: wait, then try again.
        status = 'Waiting for the reader';
        await sleep(5000);
      }
    }
    status = 'Stopped';
  }

  async function stop() {
    running = false;
    status = 'Stopped';
    if (settings.readerId) { try { await api.terminalReaderCancel(settings.readerId); } catch { /* */ } }
  }

  onMount(() => {
    try { settings = { ...settings, ...JSON.parse(localStorage.getItem(LS_KEY) || '{}') }; } catch { /* ignore */ }
    checkPrinter();
    loadReaders();
  });

  // Leaving the page must not leave the counter reader stuck on a test screen.
  onDestroy(() => { if (running) stop(); });
</script>

<svelte:window on:beforeunload={() => { if (running) stop(); }} />

<svelte:head><title>Rodeo Test Bed · Holm Graphics</title></svelte:head>

<div class="page">
  <h1>Rodeo Test Bed</h1>
  <p class="hint">Try Holmdale Pro Rodeo equipment here before event day. Nothing on this page takes real money.</p>

  {#if !$isStaff}
    <div class="band warn">Staff only.</div>
  {:else}

  <!-- ─── Printer ──────────────────────────────────────────────── -->
  <section class="card">
    <h2>Ticket printer</h2>
    <p class="statline" class:bad={printerState.state === 'bad'} class:good={printerState.state === 'ok'}>{printerState.text}</p>
    <div class="row">
      <label class="fld grow">
        <span>Network printer address</span>
        <input type="text" placeholder="10.10.1.19" value={pcfg.netHost}
               on:change={(e) => savePrinter({ netHost: e.currentTarget.value.trim(), transport: 'network' })} />
      </label>
      <label class="fld">
        <span>Paper</span>
        <select value={pcfg.width} on:change={(e) => savePrinter({ width: Number(e.currentTarget.value) })}>
          <option value={42}>58 mm (Epson)</option>
          <option value={32}>58 mm (old)</option>
          <option value={48}>80 mm</option>
        </select>
      </label>
      <button class="btn btn-secondary" on:click={checkPrinter}>Check</button>
    </div>
    <div class="row">
      <button class="btn btn-secondary" disabled={busy} on:click={() => quick('Cut test', buildCutTest({ width: pcfg.width }))}>Test print + cuts</button>
      <button class="btn btn-secondary" disabled={busy} on:click={() => quick('Sample tickets', buildTickets({ id: newSaleId('sample'), beer: 2, premium: 1, test: true }, { width: pcfg.width, logo: settings.logo }))}>Print 3 sample tickets</button>
    </div>
    {#if result}
      <div class="band" class:ok={result.ok} class:warn={!result.ok}><strong>{result.title}</strong> — {result.text}</div>
    {/if}
  </section>

  <!-- ─── Bar ticket kiosk on the reader ───────────────────────── -->
  <section class="card">
    <h2>Bar ticket kiosk on the card reader <span class="pill">Simulated payment</span></h2>
    <p class="hint">
      Press Start and the card reader asks how many beer tickets, then how many premium tickets (keypad),
      then shows a payment screen with a <strong>Simulate payment</strong> button. Tickets print and the reader goes back to the
      first screen for the next customer. No card is charged.
    </p>

    <div class="row">
      <label class="fld grow">
        <span>Card reader</span>
        <select bind:value={settings.readerId} on:change={save} disabled={running}>
          {#each readers as r}
            <option value={r.id}>{r.label || r.id} ({r.status})</option>
          {/each}
          {#if !readers.length}<option value="">No readers found</option>{/if}
        </select>
      </label>
      <label class="fld">
        <span>Beer $</span>
        <input type="number" min="0" step="0.25" bind:value={settings.beerPrice} on:change={save} disabled={running} />
      </label>
      <label class="fld">
        <span>Premium $</span>
        <input type="number" min="0" step="0.25" bind:value={settings.premiumPrice} on:change={save} disabled={running} />
      </label>
    </div>

    <div class="row">
      {#if running}
        <button class="btn btn-primary big" on:click={stop}>Stop kiosk</button>
      {:else}
        <button class="btn btn-primary big" on:click={start} disabled={!settings.readerId}>Start kiosk on reader</button>
      {/if}
    </div>

    <p class="statline"><strong>Status:</strong> {status}</p>
    {#if running}
      <div class="band warn">While the kiosk is running, the counter can't take card payments on this reader. Press Stop when you're done.</div>
    {/if}
    {#if kioskError}
      <div class="band warn">{kioskError}</div>
    {/if}

    {#if log.length}
      <div class="tablewrap">
        <table>
          <thead><tr><th>Time</th><th>Beer</th><th>Premium</th><th>Total</th><th>Printed</th></tr></thead>
          <tbody>
            {#each log as s}
              <tr><td>{s.when}</td><td>{s.beer}</td><td>{s.premium}</td><td>{money(s.total)}</td><td>{s.ok ? 'Yes' : 'No'}</td></tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </section>

  <!-- More rodeo tests go here: wristband printer, gate scanner, ... -->
  {/if}
</div>

<style>
  .page { max-width: 1100px; margin: 0 auto; padding: 20px; display: flex; flex-direction: column; gap: 18px; }
  h1 { font-family: var(--font-display); text-transform: uppercase; letter-spacing: 0.05em; margin: 0; }
  .card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 18px; box-shadow: var(--shadow); }
  .card h2 { font-family: var(--font-display); font-size: 1.05rem; text-transform: uppercase; letter-spacing: 0.05em; margin: 0 0 10px; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .hint { font-size: 0.85rem; color: var(--text-dim); margin: 0 0 10px; }
  .statline { margin: 0 0 12px; }
  .statline.good { color: var(--green); }
  .statline.bad { color: var(--red); font-weight: 600; }
  .pill { font-size: 0.7rem; letter-spacing: 0.08em; padding: 2px 8px; border-radius: 999px; background: var(--green); color: #fff; }
  .row { display: flex; gap: 10px; align-items: flex-end; flex-wrap: wrap; margin-bottom: 10px; }
  .fld { display: flex; flex-direction: column; gap: 4px; }
  .fld.grow { flex: 1; min-width: 220px; }
  .fld > span { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-dim); }
  .fld input[type='number'] { width: 90px; }
  .fld.check { flex-direction: row; align-items: center; gap: 6px; padding-bottom: 8px; }
  .band { padding: 10px 14px; border-radius: var(--radius); margin: 8px 0; }
  .band.ok { background: color-mix(in srgb, var(--green) 15%, transparent); }
  .band.warn { background: color-mix(in srgb, var(--red) 12%, transparent); }
  .big { padding: 14px 28px; font-size: 1.1rem; }
  .tablewrap { overflow-x: auto; margin-top: 16px; }
  table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
  th, td { text-align: left; padding: 6px 8px; border-top: 1px solid var(--border); }
</style>
