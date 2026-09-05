<!-- src/routes/shop/election/+page.svelte -->
<!--
  Election materials — the order form a candidate fills in themselves.

  This is the staff "new job" form with the guesswork taken out. A candidate
  picks from a fixed list at fixed prices, and what comes out the other end is
  an ordinary job on the board: type Mixed, status Quote, one line item per
  thing ordered. Pressing Order moves it to Ordered.

  PRICES ARE PUBLIC, A LOGIN IS ONLY NEEDED TO SUBMIT. Somebody deciding
  whether to run should be able to work out what a campaign costs without
  handing over an email address first — and a candidate who has done that
  arithmetic is a candidate who arrives ready to order.

  The server prices everything. Every change here posts the basket to
  /api/election/quote and renders what comes back; nothing on this page adds
  up money on its own. That is deliberate: a second copy of the price rules in
  the browser is a second copy to drift.
-->
<script>
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { customerApi } from '$lib/api/customer-client.js';
  import { customer } from '$lib/stores/customer-auth.js';

  // The reference a candidate reads down the phone. Everything typed is saved
  // against it as they go, so whoever answers can open the same basket instead
  // of asking them to describe it.
  let draftCode = '';
  let draftSaved = false;
  let resuming = false;

  let catalogue = null;
  let loadError = '';
  let quoting = false;
  let submitting = false;
  let submitError = '';

  // What has been picked. Each list holds rows the candidate added.
  let signs = [];
  let print = [];
  let decals = [];
  let needsArtwork = true;

  // Who it is for. Prefilled from the account once signed in.
  let candidateName = '';
  let office = '';
  let municipality = '';
  let ward = '';
  let contactName = '';
  let contactPhone = '';
  let contactEmail = '';
  let dueDate = '';
  let notes = '';

  // What the server says it costs.
  let lines = [];
  let subtotal = 0;

  // The job, once created.
  let job = null;
  let ordering = false;

  const money = (n) =>
    n == null
      ? '—'
      : new Intl.NumberFormat('en-CA', {
          style: 'currency',
          currency: 'CAD',
          minimumFractionDigits: 2,
        }).format(n);

  onMount(async () => {
    try {
      catalogue = await customerApi.electionCatalogue();
    } catch (e) {
      loadError = e.message || 'Could not load the price list.';
      return;
    }

    // ?draft=CODE is what staff open when the phone rings. Otherwise pick up
    // where this browser left off, and only start a new one if neither.
    const fromUrl = $page.url.searchParams.get('draft');
    const remembered =
      typeof localStorage !== 'undefined' ? localStorage.getItem('hg_election_draft') : null;
    const code = (fromUrl || remembered || '').toUpperCase();

    if (code) {
      resuming = true;
      try {
        const draft = await customerApi.getElectionDraft(code);
        const basket = draft.basket || {};
        signs = (basket.signs || []).map((row) => ({
          ...row,
          // Drafts saved when this was a checkbox carry true/false.
          stands: row.stands === true ? row.quantity : Number(row.stands) || 0,
        }));
        print = basket.print || [];
        decals = basket.decals || [];
        needsArtwork = basket.needs_artwork !== false;
        candidateName = draft.candidate_name || '';
        office = draft.office || '';
        municipality = draft.municipality || '';
        ward = draft.ward || '';
        contactName = draft.contact_name || '';
        contactPhone = draft.contact_phone || '';
        contactEmail = draft.contact_email || '';
        notes = draft.notes || '';
        draftCode = draft.code;
      } catch {
        // A code that no longer exists should not strand somebody on an empty
        // page — start them a fresh one instead.
      } finally {
        resuming = false;
      }
    }

    if (!draftCode) {
      // Start with one sign row, because that is what nearly every campaign
      // orders and an empty form is harder to understand than a filled one.
      addSign();
    }

    if ($customer) {
      contactName  = $customer.name || $customer.contact_name || '';
      contactEmail = $customer.email || '';
      contactPhone = $customer.phone || '';
      candidateName = candidateName || $customer.company || '';
    }
  });

  function addSign() {
    if (!catalogue) return;
    signs = [...signs, {
      cutKey: catalogue.sign_cuts[0].key,
      sheetKey: catalogue.sheet_options[0].key,
      quantity: catalogue.sign_cuts[0].perSheet,
      // None by default: the candidate says how many they want rather than
      // opting out of a charge they did not ask for.
      stands: 0,
    }];
  }


  /**
   * Change a row's size, and carry the quantity across in sheets.
   *
   * Sizes do not yield the same number of signs — 32 of a 12 x 12 is one sheet,
   * 32 of a 32 x 48 is sixteen. Leaving the number alone when the size changes
   * silently turns a one-sheet order into a sixteen-sheet one, which is a
   * fivefold price jump nobody asked for.
   *
   * So what is held constant is the number of sheets, because that is what a
   * candidate is actually choosing: "a sheet's worth of the big ones" rather
   * than "thirty-two of them whatever they are". Their own typed number is kept
   * when it was not a whole sheet's worth to begin with — rounded to the new
   * size's yield, since that is what can be cut.
   */
  function chooseCut(index, cutKey) {
    const before = cutFor(signs[index]);
    const after = catalogue.sign_cuts.find((c) => c.key === cutKey);
    if (!after) return;

    const sheets = before ? Math.max(1, Math.ceil((signs[index].quantity || 0) / before.perSheet)) : 1;
    const quantity = sheets * after.perSheet;

    // Stands cannot outnumber signs that no longer exist, and a size that takes
    // no stand takes none.
    const stands = after.stands ? Math.min(signs[index].stands || 0, quantity) : 0;

    signs = signs.map((row, n) => (n === index ? { ...row, cutKey, quantity, stands } : row));
  }

  function addPrint() {
    if (!catalogue) return;
    const first = catalogue.print_products[0];
    print = [...print, {
      productKey: first.key,
      quantity: first.runs[0].quantity,
      doubleSided: false,
    }];
  }

  function addDecal() {
    decals = [...decals, { widthIn: 20, heightIn: 12, quantity: 10 }];
  }

  const remove = (list, i) => list.filter((_, n) => n !== i);

  // Whenever anything changes, ask the server what it costs. Debounced,
  // because a typed quantity fires this on every keystroke.
  let quoteTimer = null;
  $: basket = { signs, print, decals, needs_artwork: needsArtwork };
  $: if (catalogue && basket) scheduleQuote();

  function scheduleQuote() {
    clearTimeout(quoteTimer);
    quoteTimer = setTimeout(() => {
      refreshQuote();
      saveDraft();
    }, 250);
  }

  /**
   * Save what has been typed so far, under a code the candidate can read out.
   *
   * The server mints nothing: this page makes the code on first save and keeps
   * it in localStorage, so closing the tab and coming back lands on the same
   * basket. Failures are silent — a draft that will not save is not a reason to
   * interrupt somebody pricing up signs.
   */
  async function saveDraft() {
    if (job || resuming) return;
    if (signs.length === 0 && print.length === 0 && decals.length === 0) return;

    if (!draftCode) {
      const alphabet = '23456789BCDFGHJKMNPQRSTVWXYZ';
      const bytes = crypto.getRandomValues(new Uint8Array(8));
      draftCode = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
      try { localStorage.setItem('hg_election_draft', draftCode); } catch { /* private mode */ }
    }

    try {
      await customerApi.saveElectionDraft(draftCode, {
        basket,
        candidate_name: candidateName,
        office,
        municipality,
        ward,
        contact_name: contactName,
        contact_phone: contactPhone,
        contact_email: contactEmail,
        notes,
      });
      draftSaved = true;
    } catch {
      draftSaved = false;
    }
  }

  async function refreshQuote() {
    if (signs.length === 0 && print.length === 0 && decals.length === 0) {
      lines = [];
      subtotal = 0;
      return;
    }
    quoting = true;
    try {
      const res = await customerApi.electionQuote(basket);
      lines = res.lines || [];
      subtotal = res.subtotal || 0;
    } catch {
      // A failed quote leaves the last good figures up rather than flashing
      // zero at somebody mid-edit.
    } finally {
      quoting = false;
    }
  }

  /**
   * The priced line for one row, so its cost can sit beside it.
   *
   * Matched on the tag the server puts on each line rather than by position: a
   * row that cannot be priced — a decal wider than the roll — produces no line,
   * and everything after it would otherwise be labelled with the wrong price.
   */
  const lineFor = (kind, index) =>
    lines.find((l) => l.source?.kind === kind && l.source?.index === index);

  // The largest cut a wire stand will hold, named rather than left to be
  // discovered by picking a size and watching the option vanish.
  $: standSizes = catalogue
    ? catalogue.sign_cuts.filter((c) => c.stands).map((c) => c.name).slice(-1)[0]
    : '';

  // The cut a sign row is on, for the note about stands and mounting.
  const cutFor = (row) => catalogue?.sign_cuts.find((c) => c.key === row.cutKey);
  const productFor = (row) => catalogue?.print_products.find((p) => p.key === row.productKey);

  async function submit() {
    submitError = '';
    if (!$customer) {
      goto(`/shop/login?return=${encodeURIComponent('/shop/election')}`);
      return;
    }
    if (!candidateName.trim()) {
      submitError = 'Whose campaign is this? A name is needed on the job.';
      return;
    }
    submitting = true;
    try {
      job = await customerApi.createElectionJob({
        ...basket,
        draft_code: draftCode,
        candidate_name: candidateName,
        office,
        municipality,
        ward,
        contact_name: contactName,
        contact_phone: contactPhone,
        contact_email: contactEmail,
        due_date: dueDate || null,
        notes,
      });
      try { localStorage.removeItem('hg_election_draft'); } catch { /* private mode */ }
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) {
      submitError = e.message || 'Could not send the order.';
    } finally {
      submitting = false;
    }
  }

  async function placeOrder() {
    ordering = true;
    try {
      const res = await customerApi.placeElectionOrder(job.id);
      job = { ...job, status: res.status };
    } catch (e) {
      submitError = e.message || 'Could not place the order.';
    } finally {
      ordering = false;
    }
  }
</script>

<svelte:head>
  <title>Election materials — Holm Graphics</title>
  <meta
    name="description"
    content="Lawn signs, post cards, door hangers and decals for a municipal election campaign. Prices shown up front."
  />
</svelte:head>

<div class="shop-shell">
  <header class="public-header">
    <a href="/shop/" class="brand">
      <span class="brand-logo">HOLM</span>
      <span class="brand-sub">GRAPHICS</span>
    </a>
    <nav class="public-nav">
      <a href="/shop/">Shop</a>
      <a href="https://holmgraphics.ca/about.html">About</a>
      <a href="https://holmgraphics.ca/#contact">Contact</a>
    </nav>
  </header>

  <section class="hero">
    <div class="hero-inner">
      <h1>Election materials</h1>
      <p>
        Signs for lawns and roadsides, cards for the mail, hangers for the doors
        nobody answers. Price it up below — the figures are real and you do not
        need an account to see them. Sign in when you are ready to send it.
      </p>
    </div>
  </section>

  {#if draftCode && !job}
    <!-- The whole point of the draft: a candidate who gets stuck can ring up
         and have somebody open the same screen. -->
    <p class="reference">
      Stuck, or want a hand? Ring the shop and read out
      <strong>{draftCode}</strong> — we can pull this up and finish it with you.
      {#if draftSaved}<span class="muted">Saved as you go.</span>{/if}
    </p>
  {/if}

  {#if loadError}
    <p class="error">{loadError}</p>
  {:else if !catalogue}
    <p class="muted">Loading the price list…</p>
  {:else if job}
    <!-- ─── after submitting ─────────────────────────────────────────────── -->
    <section class="panel done">
      <h2>Job #{job.id} — {job.status}</h2>
      {#if job.status === 'Quote'}
        <p>
          This is with the shop as a quote. Nothing is being printed yet. Check the
          lines below, and press Order when you are happy with it.
        </p>
        <button class="primary" on:click={placeOrder} disabled={ordering}>
          {ordering ? 'Ordering…' : 'Order it'}
        </button>
      {:else}
        <p>
          Ordered. It is on the board and we will be in touch about artwork and a
          proof. You can follow it under <a href="/shop/account">your jobs</a>.
        </p>
      {/if}
      {#if submitError}<p class="error">{submitError}</p>{/if}

      <table class="lines">
        <tbody>
          {#each job.lines as line}
            <tr>
              <td>{line.description}</td>
              <td class="num">{line.quantity}</td>
              <td class="num">{money(line.total)}</td>
            </tr>
          {/each}
        </tbody>
        <tfoot>
          <tr><td colspan="2">Subtotal, before HST</td><td class="num">{money(job.subtotal)}</td></tr>
        </tfoot>
      </table>
    </section>
  {:else}
    <!-- ─── signs ────────────────────────────────────────────────────────── -->
    <section class="panel">
      <div class="panel-head">
        <h2>Signs</h2>
        <button class="ghost" on:click={addSign}>Add a size</button>
      </div>
      <p class="muted">
        Every size is a clean cut from a 4&prime; × 8&prime; sheet, and the sheet is
        what you pay for — so quantities come in whole sheets. More sheets, bigger
        discount: 5% off for the second, up to 25%.
      </p>
      <p class="muted">
        Wire stands are {money(catalogue.fees.wire_stand)} each and fit
        {standSizes} and smaller — order as many as you need, which is usually
        fewer than the signs once some are going on poles and fences. Anything
        larger goes on posts, and the note on the row says what backing it needs.
      </p>

      {#each signs as row, i}
        <div class="row">
          <label>
            Size
            <select value={row.cutKey} on:change={(e) => chooseCut(i, e.currentTarget.value)}>
              {#each catalogue.sign_cuts as cut}
                <option value={cut.key}>{cut.name} — {cut.perSheet} a sheet</option>
              {/each}
            </select>
          </label>
          <label>
            Material
            <select bind:value={row.sheetKey}>
              {#each catalogue.sheet_options as opt}
                <option value={opt.key}>{opt.name}</option>
              {/each}
            </select>
          </label>
          <label>
            How many
            <input type="number" min="1" bind:value={row.quantity} />
          </label>
          <!-- A wire H-stand holds a sign up to 16 x 24 and no larger. Saying
               which sizes on every row, not only the ones that cannot take one,
               because somebody choosing a size wants to know before they pick
               rather than after. -->
          {#if cutFor(row)?.stands}
            <!-- A count, not a checkbox. Campaigns routinely want fewer stands
                 than signs because a good number go on utility poles and
                 fences. The sign count is shown beside it so "how many of
                 them" is answerable without scrolling. -->
            <label>
              Wire stands
              <input type="number" min="0" bind:value={row.stands} />
            </label>
            <span class="note">
              {money(catalogue.fees.wire_stand)} each, of
              {lineFor('signs', i)?.quantity ?? row.quantity} signs
            </span>
          {:else}
            <span class="note">
              Wire stands only fit {standSizes} and smaller. This size goes on
              posts.
            </span>
          {/if}
          <span class="row-price">{money(lineFor('signs', i)?.total)}</span>
          <button class="ghost" on:click={() => (signs = remove(signs, i))}>Remove</button>
        </div>
      {/each}
    </section>

    <!-- ─── cards and hangers ────────────────────────────────────────────── -->
    <section class="panel">
      <div class="panel-head">
        <h2>Cards and door hangers</h2>
        <button class="ghost" on:click={addPrint}>Add one</button>
      </div>
      <p class="muted">Printed for us and shipped here — the price includes getting them here.</p>

      {#each print as row, i}
        <div class="row">
          <label>
            What
            <select bind:value={row.productKey}>
              {#each catalogue.print_products as p}
                <option value={p.key}>{p.name}</option>
              {/each}
            </select>
          </label>
          <label>
            How many
            <select bind:value={row.quantity}>
              {#each productFor(row)?.runs ?? [] as run}
                <option value={run.quantity}>{run.quantity.toLocaleString('en-CA')} — {money(run.price)}</option>
              {/each}
            </select>
          </label>
          <label class="check">
            <input type="checkbox" bind:checked={row.doubleSided} />
            Print the back too (+{catalogue.fees.double_sided_percent}%)
          </label>
          <span class="row-price">{money(lineFor('print', i)?.total)}</span>
          <button class="ghost" on:click={() => (print = remove(print, i))}>Remove</button>
        </div>
      {/each}
    </section>

    <!-- ─── decals ───────────────────────────────────────────────────────── -->
    <section class="panel">
      <div class="panel-head">
        <h2>Decals</h2>
        <button class="ghost" on:click={addDecal}>Add a size</button>
      </div>
      <p class="muted">
        Any size and shape you like — a car door decal is usually about 20 × 12.
        The price updates as you type. Small runs come out at the
        {money(catalogue.decals.minimum)} minimum, because a print run costs
        what it costs whether it is one decal or twenty.
      </p>

      {#each decals as row, i}
        <div class="row">
          <label>Width (in)<input type="number" min="1" bind:value={row.widthIn} /></label>
          <label>Height (in)<input type="number" min="1" bind:value={row.heightIn} /></label>
          <label>How many<input type="number" min="1" bind:value={row.quantity} /></label>
          {#if lineFor('decals', i)}
            <span class="row-price">{money(lineFor('decals', i).total)}</span>
          {:else}
            <span class="note">Wider than the roll — ring us and we will panel it.</span>
          {/if}
          <button class="ghost" on:click={() => (decals = remove(decals, i))}>Remove</button>
        </div>
      {/each}
    </section>

    <!-- ─── artwork ──────────────────────────────────────────────────────── -->
    <section class="panel">
      <h2>Artwork</h2>
      <label class="check">
        <input type="checkbox" bind:checked={needsArtwork} />
        Do the artwork for me — {money(catalogue.fees.artwork)} once for the whole job,
        however many pieces are on it
      </label>
      <p class="muted">
        Leave it off only if you are sending print-ready PDFs. You can send files
        once the job is created.
      </p>
    </section>

    <!-- ─── the total ────────────────────────────────────────────────────── -->
    <section class="panel total-panel">
      <h2>What it comes to {#if quoting}<span class="muted">— working it out…</span>{/if}</h2>
      {#if lines.length === 0}
        <p class="muted">Nothing picked yet.</p>
      {:else}
        <table class="lines">
          <tbody>
            {#each lines as line}
              <tr>
                <td>
                  {line.description}
                  {#if line.mounting}<span class="note">{line.mounting}</span>{/if}
                </td>
                <td class="num">{line.quantity}</td>
                <td class="num">{money(line.total)}</td>
              </tr>
            {/each}
          </tbody>
          <tfoot>
            <tr><td colspan="2">Subtotal, before HST</td><td class="num">{money(subtotal)}</td></tr>
          </tfoot>
        </table>
      {/if}
    </section>

    <!-- ─── who it is for ────────────────────────────────────────────────── -->
    <section class="panel">
      <h2>Whose campaign</h2>
      <div class="grid">
        <label>Candidate name *<input bind:value={candidateName} /></label>
        <label>Office<input bind:value={office} placeholder="Councillor" /></label>
        <label>Municipality<input bind:value={municipality} /></label>
        <label>Ward<input bind:value={ward} /></label>
        <label>Contact name<input bind:value={contactName} /></label>
        <label>Phone<input bind:value={contactPhone} /></label>
        <label>Email<input type="email" bind:value={contactEmail} /></label>
        <label>Needed by<input type="date" bind:value={dueDate} /></label>
      </div>
      <label>Anything we should know<textarea rows="3" bind:value={notes}></textarea></label>
    </section>

    {#if submitError}<p class="error">{submitError}</p>{/if}

    <section class="panel submit-panel">
      {#if $customer}
        <button class="primary" on:click={submit} disabled={submitting || lines.length === 0}>
          {submitting ? 'Sending…' : 'Send it to the shop'}
        </button>
        <p class="muted">
          It arrives as a quote. Nothing is charged and nothing is printed until you
          come back and press Order.
        </p>
      {:else}
        <button class="primary" on:click={submit}>Sign in to send this</button>
        <p class="muted">
          Prices above are real — the sign-in is only so we know whose job it is.
          <a href="/shop/register">Create an account</a> if you have not ordered from us before.
        </p>
      {/if}
    </section>
  {/if}
</div>

<style>
  .shop-shell { max-width: 60rem; margin: 0 auto; padding: 0 1rem 4rem; }
  .public-header {
    display: flex; align-items: center; justify-content: space-between;
    gap: 1rem; padding: 1rem 0; border-bottom: 1px solid #e5e7eb;
  }
  .brand { display: flex; flex-direction: column; text-decoration: none; color: inherit; }
  .brand-logo { font-weight: 800; letter-spacing: 0.08em; }
  .brand-sub { font-size: 0.7rem; letter-spacing: 0.22em; color: #6b7280; }
  .public-nav { display: flex; gap: 1rem; }
  .public-nav a { color: #374151; text-decoration: none; font-size: 0.9rem; }

  .hero { padding: 2rem 0 1rem; }
  .hero h1 { margin: 0 0 0.5rem; font-size: 2rem; letter-spacing: -0.02em; }
  .hero p { margin: 0; max-width: 44rem; color: #4b5563; line-height: 1.6; }

  .panel { border: 1px solid #e5e7eb; border-radius: 0.75rem; padding: 1rem; margin-top: 1rem; }
  .panel-head { display: flex; align-items: center; justify-content: space-between; gap: 1rem; }
  .panel h2 { margin: 0 0 0.25rem; font-size: 1.05rem; }
  .total-panel { background: #f9fafb; }
  .submit-panel { text-align: center; }
  .done { border-color: #16a34a; background: #f0fdf4; }

  .row {
    display: flex; flex-wrap: wrap; gap: 0.75rem; align-items: flex-end;
    padding: 0.75rem 0; border-top: 1px solid #f3f4f6;
  }
  .grid { display: grid; gap: 0.75rem; grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr)); }

  label { display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.85rem; color: #374151; }
  label.check { flex-direction: row; align-items: center; gap: 0.5rem; }
  input, select, textarea {
    padding: 0.4rem 0.5rem; border: 1px solid #d1d5db; border-radius: 0.375rem;
    font: inherit; font-size: 0.9rem;
  }
  input[type='number'] { width: 7rem; }
  input[type='checkbox'] { width: auto; }
  textarea { width: 100%; }

  button { font: inherit; cursor: pointer; border-radius: 0.375rem; }
  .primary {
    background: #111827; color: #fff; border: 0;
    padding: 0.6rem 1.25rem; font-weight: 600;
  }
  .primary:disabled { opacity: 0.5; cursor: not-allowed; }
  .ghost { background: none; border: 1px solid #d1d5db; padding: 0.35rem 0.7rem; font-size: 0.85rem; }

  .lines { width: 100%; border-collapse: collapse; margin-top: 0.5rem; font-size: 0.9rem; }
  .lines td { padding: 0.4rem 0; border-bottom: 1px solid #f3f4f6; vertical-align: top; }
  .lines tfoot td { font-weight: 700; border-bottom: 0; padding-top: 0.6rem; }
  .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }

  .row-price {
    margin-left: auto; font-weight: 700; font-variant-numeric: tabular-nums;
    white-space: nowrap; padding-bottom: 0.35rem;
  }
  .muted { color: #6b7280; font-size: 0.85rem; line-height: 1.6; }
  .note { display: block; color: #6b7280; font-size: 0.8rem; margin-top: 0.15rem; }
  .error { color: #b91c1c; font-size: 0.9rem; }
  .reference {
    margin: 1rem 0 0; padding: 0.6rem 0.9rem; border-radius: 0.5rem;
    background: #eff6ff; border: 1px solid #bfdbfe; color: #1e3a8a;
    font-size: 0.9rem;
  }
  .reference strong { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: 0.1em; }
</style>
