<!--
  /portal/nametags — Staff nametags for signed-in clients.

  The shop sets up the client's card design (Clients → Nametags tab). Here the
  client keeps their staff list (saved between orders), sees a proof of every
  card and sends the order, which becomes a job on the shop's job board.
  Cards print on the Seaory S25 (CR80 NFC cards).
-->
<script>
  import { onMount, tick } from 'svelte';
  import { goto } from '$app/navigation';
  import { isCustomerLoggedIn } from '$lib/stores/customer-auth.js';
  import { customerApi } from '$lib/api/customer-client.js';
  import CardCanvas from '$lib/nametags/CardCanvas.svelte';
  import { FONT_CSS, normalizeDesign, readImage, loadFonts } from '$lib/nametags/render.js';

  let loading = true;
  let err = '';
  let templates = [];
  let people = [];
  let orders = [];
  let templateId = null;
  let qty = {};                 // person id -> number of cards in this order
  let notes = '';
  let approved = false;
  let sending = false;
  let sent = null;              // { message, project_id }
  let fontsReady = 0;
  let confirmRemove = null;
  let showPaste = false;
  let pasteText = '';
  let adding = false;

  // Debounced per-person saves while the client types.
  const timers = new Map();
  const pending = new Map();
  let saveState = '';           // '', 'saving', 'saved', 'error'

  onMount(async () => {
    if (!$isCustomerLoggedIn) { goto('/shop/login?return=/portal/nametags'); return; }
    try {
      const res = await customerApi.getNametags();
      templates = (res.templates || []).map((t) => ({ ...t, design: normalizeDesign(t.design) }));
      people = res.people || [];
      orders = res.orders || [];
      templateId = templates[0]?.id ?? null;
      const start = orders.length ? 0 : 1; // first order: everyone gets one card
      qty = Object.fromEntries(people.map((p) => [p.id, start]));
      loadFonts().then(() => fontsReady++);
    } catch (e) {
      err = e.message || 'Could not load your nametags.';
    } finally {
      loading = false;
    }
  });

  $: template = templates.find((t) => t.id === templateId);
  $: design = template?.design;
  $: fieldOn = (k) => !!design?.fields.find((f) => f.key === k)?.on;
  $: extraLabel = design?.fields.find((f) => f.key === 'extra')?.label || 'Extra line';
  $: inOrder = people.filter((p) => (qty[p.id] | 0) > 0);
  $: cardCount = inOrder.reduce((a, p) => a + (qty[p.id] | 0), 0);
  $: missingFirst = inOrder.filter((p) => !p.first_name.trim()).length;

  const toCard = (p) => ({ first: p.first_name, last: p.last_name, title: p.title, dept: p.department, extra: p.extra, photo: p.photo });

  function edited(p, field) {
    people = people;
    sent = null;
    const body = { ...(pending.get(p.id) || {}), [field]: p[field] };
    pending.set(p.id, body);
    clearTimeout(timers.get(p.id));
    timers.set(p.id, setTimeout(() => flush(p.id), 700));
  }

  async function flush(id) {
    clearTimeout(timers.get(id)); timers.delete(id);
    const body = pending.get(id); if (!body) return;
    pending.delete(id);
    saveState = 'saving';
    try { await customerApi.updateNametagPerson(id, body); saveState = 'saved'; }
    catch (e) { saveState = 'error'; err = e.message || 'Could not save that change.'; }
  }
  const flushAll = () => Promise.all([...pending.keys()].map(flush));

  async function addPerson(fields = {}) {
    const { person } = await customerApi.addNametagPerson({ first_name: '', last_name: '', title: '', department: '', extra: '', ...fields });
    people = [...people, person];
    qty = { ...qty, [person.id]: 1 };
    return person;
  }

  async function addOne() {
    adding = true; err = '';
    try {
      const p = await addPerson();
      await tick();
      document.getElementById(`nt-${p.id}-first_name`)?.focus();
    } catch (e) { err = e.message; } finally { adding = false; }
  }

  async function addPasted() {
    const lines = pasteText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    adding = true; err = '';
    try {
      for (const l of lines) {
        const c = (l.includes('\t') ? l.split('\t') : l.split(',')).map((s) => s.trim());
        if (/^first/i.test(c[0] || '')) continue; // header row
        await addPerson({ first_name: c[0] || '', last_name: c[1] || '', title: c[2] || '', department: c[3] || '', extra: c[4] || '' });
      }
      pasteText = ''; showPaste = false;
    } catch (e) { err = e.message; } finally { adding = false; }
  }

  async function setPhoto(p, file) {
    if (!file) return;
    err = '';
    try {
      const photo = await readImage(file, { maxPx: 700 });
      await customerApi.updateNametagPerson(p.id, { photo });
      p.photo = photo; people = people; sent = null;
    } catch (e) { err = e.message || 'Could not add that photo.'; }
  }

  async function removePhoto(p) {
    try { await customerApi.updateNametagPerson(p.id, { photo: null }); p.photo = null; people = people; }
    catch (e) { err = e.message; }
  }

  async function remove(p) {
    try {
      clearTimeout(timers.get(p.id)); pending.delete(p.id);
      await customerApi.removeNametagPerson(p.id);
      people = people.filter((x) => x.id !== p.id);
      const { [p.id]: _, ...rest } = qty; qty = rest;
      confirmRemove = null;
    } catch (e) { err = e.message; }
  }

  function setAll(n) { qty = Object.fromEntries(people.map((p) => [p.id, n])); }

  async function send() {
    sending = true; err = '';
    try {
      await flushAll();
      const items = inOrder.map((p) => ({ person_id: p.id, qty: qty[p.id] | 0 }));
      const res = await customerApi.sendNametagOrder({ template_id: templateId, items, notes });
      sent = { message: res.message, project_id: res.order.project_id };
      orders = [{ ...res.order, template_name: template.name }, ...orders];
      approved = false; notes = ''; setAll(0);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) {
      err = e.message || 'Could not send the order.';
    } finally {
      sending = false;
    }
  }

  const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' }) : '');
</script>

<svelte:head>
  <title>Staff nametags — Holm Graphics</title>
  <link rel="stylesheet" href={FONT_CSS} />
</svelte:head>

<div class="page">
  <a href="/portal" class="back">← Back to my account</a>
  <header class="head">
    <h1>Staff nametags</h1>
    <p class="meta">Add your staff, check each card, and send the order. We print them on white
      CR80 cards (3.375 × 2.125 in). Your staff list is saved for next time.</p>
  </header>

  {#if sent}
    <div class="ok-banner">
      {sent.message} <a href={`/portal/jobs/${sent.project_id}`}>View the job →</a>
    </div>
  {/if}
  {#if err}<div class="error-banner">{err}</div>{/if}

  {#if loading}
    <p class="muted">Loading…</p>
  {:else if !templates.length}
    <section class="panel">
      <h2>Your nametag design isn't set up yet</h2>
      <p class="muted">Holm Graphics sets up your card design first, with your logo and colours.
        Call or email us to get started, and it will show up here.</p>
    </section>
  {:else}
    {#if templates.length > 1}
      <section class="panel">
        <label for="nt-template">Design</label>
        <select id="nt-template" bind:value={templateId}>
          {#each templates as t (t.id)}<option value={t.id}>{t.name}</option>{/each}
        </select>
      </section>
    {/if}

    <section class="panel">
      <div class="panel-head">
        <h2>Staff list <span class="count">({people.length})</span></h2>
        <span class="save-state" class:bad={saveState === 'error'}>
          {saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'All changes saved' : saveState === 'error' ? 'Not saved' : ''}
        </span>
      </div>

      {#if people.length === 0}
        <p class="muted">No one yet. Add your first person, or paste a list from Excel.</p>
      {:else}
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Cards</th>
                {#if design.photo.on}<th>Photo</th>{/if}
                <th>First name</th>
                {#if fieldOn('last')}<th>Last name</th>{/if}
                {#if fieldOn('title')}<th>Title</th>{/if}
                {#if fieldOn('dept')}<th>Department</th>{/if}
                {#if fieldOn('extra')}<th>{extraLabel}</th>{/if}
                <th><span class="sr">Remove</span></th>
              </tr>
            </thead>
            <tbody>
              {#each people as p (p.id)}
                <tr class:dim={!(qty[p.id] > 0)}>
                  <td><input class="qty" type="number" min="0" max="50" id={`nt-${p.id}-qty`}
                    aria-label={`Cards for ${p.first_name || 'this person'}`} bind:value={qty[p.id]} /></td>
                  {#if design.photo.on}
                    <td>
                      <div class="photo-cell">
                        {#if p.photo}<img src={p.photo} alt="" />{:else}<span class="ph"></span>{/if}
                        <label class="mini">
                          {p.photo ? 'Change' : 'Add'}
                          <input type="file" accept="image/*" on:change={(e) => setPhoto(p, e.target.files[0])} />
                        </label>
                        {#if p.photo}<button class="link" on:click={() => removePhoto(p)}>Remove</button>{/if}
                      </div>
                    </td>
                  {/if}
                  <td><input id={`nt-${p.id}-first_name`} aria-label="First name" bind:value={p.first_name} on:input={() => edited(p, 'first_name')} /></td>
                  {#if fieldOn('last')}<td><input aria-label="Last name" bind:value={p.last_name} on:input={() => edited(p, 'last_name')} /></td>{/if}
                  {#if fieldOn('title')}<td><input aria-label="Title" bind:value={p.title} on:input={() => edited(p, 'title')} /></td>{/if}
                  {#if fieldOn('dept')}<td><input aria-label="Department" bind:value={p.department} on:input={() => edited(p, 'department')} /></td>{/if}
                  {#if fieldOn('extra')}<td><input aria-label={extraLabel} bind:value={p.extra} on:input={() => edited(p, 'extra')} /></td>{/if}
                  <td class="nowrap">
                    {#if confirmRemove === p.id}
                      <button class="link danger" on:click={() => remove(p)}>Remove {p.first_name || 'person'}?</button>
                      <button class="link" on:click={() => (confirmRemove = null)}>Keep</button>
                    {:else}
                      <button class="link" on:click={() => (confirmRemove = p.id)}>Remove</button>
                    {/if}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
        <p class="muted small">“Cards” is how many to print for each person in this order. 0 leaves them off.
          <button class="link" on:click={() => setAll(1)}>One for everyone</button> ·
          <button class="link" on:click={() => setAll(0)}>Clear all</button></p>
      {/if}

      <div class="actions">
        <button class="btn" on:click={addOne} disabled={adding}>Add a person</button>
        <button class="btn ghost-btn" on:click={() => (showPaste = !showPaste)}>Paste a list from Excel</button>
      </div>
      {#if showPaste}
        <div class="paste">
          <label for="nt-paste">One person per line: First, Last, Title, Department (copying rows from Excel works)</label>
          <textarea id="nt-paste" rows="5" bind:value={pasteText} placeholder="Jordan	Reid	Office Manager	Front Desk"></textarea>
          <button class="btn" on:click={addPasted} disabled={adding || !pasteText.trim()}>{adding ? 'Adding…' : 'Add these people'}</button>
        </div>
      {/if}
    </section>

    <section class="panel">
      <h2>Proof</h2>
      {#if inOrder.length === 0}
        <p class="muted">Set “Cards” to 1 or more for anyone you want in this order and their card appears here.</p>
      {:else}
        <div class="proofs">
          {#each inOrder as p (p.id)}
            <figure>
              <CardCanvas {design} card={toCard(p)} redraw={fontsReady} label={`Nametag for ${p.first_name} ${p.last_name}`} />
              <figcaption>{p.first_name} {p.last_name}{qty[p.id] > 1 ? ` × ${qty[p.id]}` : ''}</figcaption>
            </figure>
          {/each}
        </div>
        <p class="muted small">Long names shrink to fit. The thin white edge is normal: our card printer can't print right to the edge.</p>
      {/if}
    </section>

    <section class="panel">
      <h2>Send order</h2>
      <div class="summary">
        <span>{cardCount} card{cardCount === 1 ? '' : 's'}</span>
        <span>{template.name}</span>
      </div>
      <label for="nt-notes">Notes for Holm Graphics (optional)</label>
      <textarea id="nt-notes" rows="2" bind:value={notes} placeholder="e.g. Need these by Friday"></textarea>
      {#if missingFirst}<p class="warn">{missingFirst} card{missingFirst > 1 ? 's are' : ' is'} missing a first name.</p>{/if}
      <label class="check"><input type="checkbox" bind:checked={approved} /> I checked the spelling on every card.</label>
      <button class="btn" on:click={send} disabled={sending || !approved || !cardCount || missingFirst > 0}>
        {sending ? 'Sending…' : 'Send order to Holm Graphics'}
      </button>
    </section>

    {#if orders.length}
      <section class="panel">
        <h2>Past orders</h2>
        <ul class="past">
          {#each orders as o (o.id)}
            <li><a href={`/portal/jobs/${o.project_id}`}>Job #{o.project_id}</a> · {o.card_count} cards · {fmtDate(o.created_at)}</li>
          {/each}
        </ul>
      </section>
    {/if}
  {/if}
</div>

<style>
  .page { max-width: 1000px; margin: 0 auto; padding: 24px 20px 80px; }
  .back { display: inline-block; color: var(--red); text-decoration: none; font-family: var(--font-display); font-weight: 600;
    font-size: .88rem; text-transform: uppercase; letter-spacing: .04em; margin-bottom: 16px; }
  .head { margin-bottom: 16px; }
  .head h1 { font-family: var(--font-display); margin: 0; font-size: 1.8rem; color: var(--text); }
  .meta, .muted { color: var(--text-muted); }
  .meta { margin: 4px 0 0; max-width: 65ch; }
  .small { font-size: .88rem; }
  .panel { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 20px; margin-bottom: 16px; }
  .panel h2 { font-family: var(--font-display); font-size: 1.25rem; margin: 0 0 12px; color: var(--text); }
  .panel-head { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; flex-wrap: wrap; }
  .count { color: var(--text-dim); font-weight: 400; }
  .save-state { font-size: .85rem; color: var(--green); }
  .save-state.bad { color: var(--red); }
  .table-wrap { overflow-x: auto; margin-bottom: 8px; }
  table { border-collapse: collapse; width: 100%; min-width: 640px; }
  th, td { text-align: left; padding: 6px; border-bottom: 1px solid var(--border); vertical-align: middle; }
  th { font-family: var(--font-display); text-transform: uppercase; letter-spacing: .06em; font-size: .75rem; color: var(--text-muted); }
  td input { padding: 6px 8px; }
  tr.dim td { opacity: .6; }
  tr.dim td:first-child { opacity: 1; }
  .qty { width: 64px; }
  .nowrap { white-space: nowrap; }
  .photo-cell { display: flex; align-items: center; gap: 6px; }
  .photo-cell img, .photo-cell .ph { width: 34px; height: 34px; border-radius: 50%; object-fit: cover; background: #e5e8ec; flex: none; }
  .mini { display: inline-block; margin: 0; cursor: pointer; border: 1px solid var(--border); border-radius: 4px; padding: 3px 8px;
    font-size: .72rem; color: var(--text); }
  .mini input { display: none; }
  .link { background: none; border: 0; padding: 0; color: var(--red); cursor: pointer; font: inherit; text-decoration: underline; }
  .link.danger { font-weight: 700; margin-right: 8px; }
  .actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
  .btn { background: var(--red); color: #fff; border: 0; border-radius: 4px; padding: 10px 16px; cursor: pointer;
    font-family: var(--font-display); font-weight: 700; text-transform: uppercase; letter-spacing: .05em; font-size: .88rem; }
  .btn:disabled { opacity: .5; cursor: default; }
  .ghost-btn { background: transparent; color: var(--text); border: 1px solid var(--border); }
  .paste { display: grid; gap: 8px; margin-top: 12px; }
  .proofs { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 16px; }
  .proofs figure { margin: 0; display: grid; gap: 6px; }
  .proofs figcaption { font-size: .88rem; color: var(--text-muted); }
  .summary { display: flex; gap: 16px; flex-wrap: wrap; font-family: var(--font-display); font-size: 1.1rem; margin-bottom: 12px; }
  .check { display: flex; align-items: center; gap: 8px; text-transform: none; letter-spacing: 0; font-size: .95rem; color: var(--text); margin: 12px 0; }
  .check input { width: auto; }
  .warn { color: var(--amber); }
  .ok-banner { background: rgba(30,140,74,.1); border: 1px solid var(--green); color: var(--text); padding: 10px 14px; border-radius: 6px; margin-bottom: 16px; }
  .ok-banner a { color: var(--green); font-weight: 700; }
  .error-banner { background: rgba(192,57,43,.1); border: 1px solid var(--red); color: var(--red); padding: 10px 14px; border-radius: 6px; margin-bottom: 16px; }
  .past { margin: 0; padding-left: 18px; display: grid; gap: 4px; }
  .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
</style>
