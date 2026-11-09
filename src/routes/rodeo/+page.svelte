<!--
  src/routes/rodeo/+page.svelte

  Rodeo Test Bed: a place to try Holmdale Pro Rodeo gear on the shop network
  before event day. First section: the bar drink-ticket kiosk, with payment
  SIMULATED (no Stripe, no card) and the tickets printed for real through the
  receipt bridge on Design Centre 1.

  Add new test sections as more rodeo equipment arrives (wristband printer,
  gate scanner, ...).
-->
<script>
  import { onMount } from 'svelte';
  import { isStaff } from '$lib/stores/auth.js';
  import {
    receiptBridgeConfigured, receiptBridgeHealth, receiptBridgePrinters, receiptBridgePrint,
  } from '$lib/printing/receiptBridgeClient.js';
  import { buildTickets, buildCutTest, newSaleId } from '$lib/rodeo/tickets.js';

  const LS_KEY = 'hg_rodeo_testbed';
  const MAX_EACH = 10;

  // Per-machine settings: which bridge printer, paper width, test prices.
  let settings = { printer: '', width: 32, beerPrice: 7, premiumPrice: 9, logo: true };
  let printers = [];
  let bridge = { state: 'checking', text: 'Checking the receipt bridge...' };

  let beer = 0;
  let premium = 0;
  let busy = false;
  let result = null;        // { ok, title, text }
  let log = [];             // recent simulated sales, this visit only

  $: total = beer * settings.beerPrice + premium * settings.premiumPrice;
  const money = (n) => '$' + Number(n).toFixed(2);

  function save() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(settings)); } catch { /* private mode */ }
  }

  async function checkBridge() {
    if (!receiptBridgeConfigured()) {
      bridge = { state: 'bad', text: 'No receipt bridge set up on this machine. Add it in Counter POS > Receipt printing from this computer.' };
      return;
    }
    try {
      const h = await receiptBridgeHealth();
      bridge = { state: 'ok', text: `Bridge online on ${h.host || 'Design Centre 1'}. Default printer: ${h.defaultPrinter || 'none'}.` };
      try { printers = (await receiptBridgePrinters()).printers || []; } catch { printers = []; }
    } catch (e) {
      bridge = { state: 'bad', text: `${e.message}. Is Design Centre 1 on?` };
    }
  }

  async function print(bytes) {
    return receiptBridgePrint(bytes, { printer: settings.printer });
  }

  function bump(which, d) {
    if (which === 'beer') beer = Math.max(0, Math.min(MAX_EACH, beer + d));
    else premium = Math.max(0, Math.min(MAX_EACH, premium + d));
  }

  async function simulate() {
    if (!beer && !premium) return;
    busy = true; result = null;
    const sale = { id: newSaleId(), beer, premium, test: true };
    try {
      await print(buildTickets(sale, { width: settings.width, logo: settings.logo }));
      result = { ok: true, title: 'Approved (simulated)', text: `${beer} beer, ${premium} premium, ${money(total)}. Tickets printing.` };
      log = [{ when: new Date().toLocaleTimeString('en-CA'), beer, premium, total, ok: true }, ...log].slice(0, 10);
      beer = 0; premium = 0;
    } catch (e) {
      result = { ok: false, title: 'Printer problem', text: e.message };
      log = [{ when: new Date().toLocaleTimeString('en-CA'), beer, premium, total, ok: false }, ...log].slice(0, 10);
    } finally {
      busy = false;
    }
  }

  async function quick(label, bytes) {
    busy = true; result = null;
    try { await print(bytes); result = { ok: true, title: label, text: 'Sent to the printer.' }; }
    catch (e) { result = { ok: false, title: 'Printer problem', text: e.message }; }
    finally { busy = false; }
  }

  onMount(() => {
    try { settings = { ...settings, ...JSON.parse(localStorage.getItem(LS_KEY) || '{}') }; } catch { /* ignore */ }
    checkBridge();
  });
</script>

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
    <p class="statline" class:bad={bridge.state === 'bad'} class:good={bridge.state === 'ok'}>{bridge.text}</p>
    <div class="row">
      <label class="fld grow">
        <span>Printer on the bridge</span>
        <select bind:value={settings.printer} on:change={save}>
          <option value="">Bridge default</option>
          {#each printers as p}
            <option value={p.name || p}>{p.name || p}</option>
          {/each}
        </select>
      </label>
      <label class="fld">
        <span>Paper</span>
        <select bind:value={settings.width} on:change={save}>
          <option value={32}>58 mm</option>
          <option value={48}>80 mm</option>
        </select>
      </label>
      <label class="fld check">
        <input type="checkbox" bind:checked={settings.logo} on:change={save} />
        <span>Rodeo logo</span>
      </label>
      <button class="btn btn-secondary" on:click={checkBridge}>Check</button>
    </div>
    <div class="row">
      <button class="btn btn-secondary" disabled={busy} on:click={() => quick('Cut test', buildCutTest({ width: settings.width }))}>Test print + cuts</button>
      <button class="btn btn-secondary" disabled={busy} on:click={() => quick('Sample tickets', buildTickets({ id: newSaleId('sample'), beer: 2, premium: 1, test: true }, { width: settings.width, logo: settings.logo }))}>Print 3 sample tickets</button>
    </div>
  </section>

  <!-- ─── Bar ticket kiosk ─────────────────────────────────────── -->
  <section class="card">
    <h2>Bar ticket kiosk <span class="pill">Simulated payment</span></h2>
    <p class="hint">Pick tickets and press Simulate payment. It acts as if the card went through and prints one ticket per drink.</p>

    <div class="kiosk">
      <div class="item">
        <div>
          <div class="name">Beer</div>
          <label class="price">$<input type="number" min="0" step="0.25" bind:value={settings.beerPrice} on:change={save} /> each</label>
        </div>
        <div class="qty">
          <button on:click={() => bump('beer', -1)} aria-label="One less beer">&minus;</button>
          <span>{beer}</span>
          <button on:click={() => bump('beer', 1)} aria-label="One more beer">+</button>
        </div>
      </div>
      <div class="item">
        <div>
          <div class="name">Premium</div>
          <label class="price">$<input type="number" min="0" step="0.25" bind:value={settings.premiumPrice} on:change={save} /> each</label>
        </div>
        <div class="qty">
          <button on:click={() => bump('premium', -1)} aria-label="One less premium">&minus;</button>
          <span>{premium}</span>
          <button on:click={() => bump('premium', 1)} aria-label="One more premium">+</button>
        </div>
      </div>
      <div class="total">Total <strong>{money(total)}</strong></div>
      <button class="btn btn-primary pay" disabled={busy || (!beer && !premium)} on:click={simulate}>
        {busy ? 'Printing...' : 'Simulate payment'}
      </button>
      {#if result}
        <div class="band" class:ok={result.ok} class:warn={!result.ok}>
          <strong>{result.title}</strong> — {result.text}
        </div>
      {/if}
    </div>

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
  .card h2 { font-family: var(--font-display); font-size: 1.05rem; text-transform: uppercase; letter-spacing: 0.05em; margin: 0 0 10px; display: flex; align-items: center; gap: 10px; }
  .hint { font-size: 0.85rem; color: var(--text-dim); margin: 0 0 10px; }
  .statline { margin: 0 0 12px; }
  .statline.good { color: var(--green); }
  .statline.bad { color: var(--red); font-weight: 600; }
  .pill { font-size: 0.7rem; letter-spacing: 0.08em; padding: 2px 8px; border-radius: 999px; background: var(--green); color: #fff; }
  .row { display: flex; gap: 10px; align-items: flex-end; flex-wrap: wrap; margin-bottom: 10px; }
  .fld { display: flex; flex-direction: column; gap: 4px; }
  .fld.grow { flex: 1; min-width: 220px; }
  .fld > span { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-dim); }
  .fld.check { flex-direction: row; align-items: center; gap: 6px; padding-bottom: 8px; }
  .band { padding: 10px 14px; border-radius: var(--radius); margin-top: 12px; }
  .band.ok { background: color-mix(in srgb, var(--green) 15%, transparent); }
  .band.warn { background: color-mix(in srgb, var(--red) 12%, transparent); }

  .kiosk { max-width: 480px; }
  .item { display: flex; justify-content: space-between; align-items: center; border: 1px solid var(--border); border-radius: var(--radius); padding: 12px 14px; margin-bottom: 10px; }
  .name { font-size: 1.3rem; font-weight: 700; }
  .price { color: var(--text-dim); font-size: 0.85rem; }
  .price input { width: 70px; padding: 2px 4px; }
  .qty { display: flex; align-items: center; gap: 12px; }
  .qty button { width: 48px; height: 48px; border-radius: 50%; border: 1px solid var(--border); background: var(--surface); font-size: 1.6rem; cursor: pointer; }
  .qty span { min-width: 32px; text-align: center; font-size: 1.6rem; font-weight: 700; }
  .total { text-align: center; margin: 12px 0; font-size: 1.1rem; }
  .total strong { display: block; font-size: 2rem; }
  .pay { width: 100%; padding: 16px; font-size: 1.2rem; }

  .tablewrap { overflow-x: auto; margin-top: 16px; }
  table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
  th, td { text-align: left; padding: 6px 8px; border-top: 1px solid var(--border); }
</style>
