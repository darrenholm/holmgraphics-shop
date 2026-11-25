<!--
  Job page (Overview): nametag orders attached to this job. Shows nothing when
  the job has none. Builds the Seaory S25 print PDF in the browser from the
  order's own snapshot, so it matches the proof the client approved.
-->
<script>
  import { onMount } from 'svelte';
  import { api } from '$lib/api/client.js';
  import CardCanvas from './CardCanvas.svelte';
  import { FONT_CSS, normalizeDesign, buildCardPdf, downloadBlob, loadFonts } from './render.js';

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
    <div class="nt-actions">
      <button class="btn btn-primary" on:click={() => downloadPdf(o)} disabled={busy === o.id}>
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
