<!--
  Job page (Overview): nametag orders attached to this job. Shows nothing when
  the job has none. Builds the Seaory S25 print PDF in the browser from the
  order's own snapshot, so it matches the proof the client approved.
-->
<script>
  import { onMount } from 'svelte';
  import { api } from '$lib/api/client.js';
  import CardCanvas from './CardCanvas.svelte';
  import { FONT_CSS, normalizeDesign, buildCardPdf, buildCardPngs, downloadBlob, loadFonts } from './render.js';

  // Holm Card Bridge on the PC the S25 is plugged into (RODEOOPS2). Staff can
  // point a PC elsewhere with localStorage 'hg_card_bridge'.
  const DEFAULT_BRIDGE = 'http://10.10.1.137:7780';
  function bridgeUrl() {
    try { return (localStorage.getItem('hg_card_bridge') || DEFAULT_BRIDGE).replace(/\/+$/, ''); }
    catch { return DEFAULT_BRIDGE; }
  }
  // Chrome lets an https page call a printer on the shop network only when the
  // request says it is for the local network (Local Network Access); Chrome
  // asks once per site, and staff must click Allow.
  const LOCAL = { targetAddressSpace: 'local' };

  export let projectId;

  let orders = [];
  let busy = null;
  let error = '';
  let fontsReady = 0;

  onMount(async () => {
    try {
      const res = await api.nametagOrdersForJob(projectId);
      orders = (res.orders || []).map((o) => ({ ...o, design: normalizeDesign(o.design) }));
      if (orders.length) loadFonts().then(() => fontsReady++);
    } catch (e) {
      // Quietly skip: the job page works without this panel.
      console.warn('nametag orders:', e);
    }
  });

  async function downloadPdf(o) {
    busy = o.id; error = '';
    try {
      const blob = await buildCardPdf(o.design, o.cards);
      downloadBlob(blob, `Job${o.project_id}-nametags-S25.pdf`);
    } catch (e) {
      error = e.message || 'Could not build the PDF.';
    } finally {
      busy = null;
    }
  }

  async function togglePrinted(o) {
    try {
      const { order } = await api.nametagMarkPrinted(o.id, !o.printed_at);
      orders = orders.map((x) => (x.id === o.id ? { ...x, printed_at: order.printed_at } : x));
    } catch (e) { error = e.message; }
  }

  // The order keeps the design the client ordered. When the template was fixed
  // afterwards, staff pull the current template onto this (unprinted) order.
  async function refreshDesign(o) {
    if (!confirm('Replace this order\'s card design with the client\'s current template?\n\nUse this when the template was changed after the client ordered. The names and photos stay the same.')) return;
    busy = o.id; error = '';
    try {
      const { order } = await api.nametagRefreshDesign(o.id);
      orders = orders.map((x) => (x.id === o.id ? { ...x, design: normalizeDesign(order.design) } : x));
      fontsReady++;
    } catch (e) {
      error = e.message || 'Could not update the design.';
    } finally {
      busy = null;
    }
  }

  let sending = null;     // order id being sent
  let sendMsg = '';
  let stopSend = false;

  async function sendToPrinter(o) {
    const total = o.cards.reduce((n, c) => n + (c.qty > 1 ? c.qty : 1), 0);
    if (!confirm(`Send ${total} card${total === 1 ? '' : 's'} to the S25 card printer?\n\nLoad blank cards first.`)) return;
    sending = o.id; stopSend = false; error = ''; sendMsg = 'Checking the card printer…';
    const base = bridgeUrl();
    try {
      try {
        const h = await fetch(`${base}/health`, { ...LOCAL, cache: 'no-store' });
        if (!h.ok) throw new Error();
      } catch {
        throw new Error(`Can't reach the card printer at ${base}. Check the "Holm Card Bridge" window is open on RODEOOPS2, and that Chrome is allowed to use the local network for this site (padlock › Site settings).`);
      }
      sendMsg = 'Preparing cards…';
      const pngs = await buildCardPngs(o.design, o.cards);
      let done = 0;
      for (const p of pngs) {
        if (stopSend) break;
        sendMsg = `Printing ${done + 1} of ${pngs.length} – ${p.name}`;
        const r = await fetch(`${base}/print`, {
          ...LOCAL, method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pngBase64: p.png, badgeId: `job${o.project_id}-${done + 1}`, name: `Job ${o.project_id} – ${p.name}` }),
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || !j.ok) throw new Error(`Card ${done + 1} (${p.name}) failed: ${j.error || r.status}. ${done} printed before it.`);
        done++;
      }
      sendMsg = stopSend ? `Stopped. ${done} of ${pngs.length} printed.` : `Sent ${done} card${done === 1 ? '' : 's'}. Check them, then click Mark printed.`;
    } catch (e) {
      error = e.message || 'Could not send to the card printer.'; sendMsg = '';
    } finally {
      sending = null;
    }
  }

  const fmt = (d) => (d ? new Date(d).toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');
</script>

<svelte:head>{#if orders.length}<link rel="stylesheet" href={FONT_CSS} />{/if}</svelte:head>

{#each orders as o (o.id)}
  <div class="card nt-panel">
    <h2 class="card-title">
      Nametags · {o.card_count} cards
      {#if o.printed_at}<span class="nt-done">Printed {fmt(o.printed_at)}</span>{/if}
    </h2>
    <p class="nt-meta">
      {o.template_name || 'Nametag'} · ordered by {o.ordered_by || 'client'} {fmt(o.created_at)} ·
      Seaory S25, CR80 NFC cards, {o.design.edge} in white edge
    </p>
    {#if o.notes}<p class="nt-notes">“{o.notes}”</p>{/if}

    <div class="nt-thumbs">
      {#each o.cards as c, i (i)}
        <figure>
          <CardCanvas design={o.design} card={c} ppi={110} redraw={fontsReady}
            label={`Nametag for ${c.first} ${c.last}`} />
          <figcaption>{c.first} {c.last}{c.qty > 1 ? ` × ${c.qty}` : ''}</figcaption>
        </figure>
      {/each}
    </div>

    {#if error}<p class="nt-err">{error}</p>{/if}
    {#if sendMsg && (sending === o.id || !error)}<p class="nt-meta">{sendMsg}</p>{/if}
    <div class="nt-actions">
      {#if sending === o.id}
        <button class="btn btn-ghost" on:click={() => { stopSend = true; }}>Stop after this card</button>
      {:else}
        <button class="btn btn-primary" on:click={() => sendToPrinter(o)} disabled={sending !== null || busy === o.id}>
          Send to card printer
        </button>
      {/if}
      <button class="btn btn-ghost" on:click={() => downloadPdf(o)} disabled={busy === o.id}>
        {busy === o.id ? 'Building PDF…' : 'Download print PDF'}
      </button>
      <button class="btn btn-ghost" on:click={() => togglePrinted(o)}>
        {o.printed_at ? 'Mark not printed' : 'Mark printed'}
      </button>
      {#if !o.printed_at && o.template_id}
        <button class="btn btn-ghost" on:click={() => refreshDesign(o)} disabled={busy === o.id}
          title="Use the client's current template design on this order">
          Use latest design
        </button>
      {/if}
    </div>
    <p class="nt-meta">One card per page at actual size. Print at 100% (no “fit to page”).</p>
  </div>
{/each}

<style>
  .nt-panel { margin-bottom: 16px; }
  .nt-meta { color: var(--text-muted); font-size: .88rem; margin: 4px 0 10px; }
  .nt-notes { background: var(--black); padding: 8px 10px; border-radius: 6px; font-size: .92rem; }
  .nt-thumbs { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 12px; margin: 10px 0 14px; }
  .nt-thumbs figure { margin: 0; display: grid; gap: 4px; }
  .nt-thumbs figcaption { font-size: .82rem; color: var(--text-muted); }
  .nt-actions { display: flex; flex-wrap: wrap; gap: 8px; }
  .nt-done { margin-left: 8px; font-size: .75rem; color: var(--green); text-transform: uppercase; letter-spacing: .05em; }
  .nt-err { color: var(--red); }
</style>
