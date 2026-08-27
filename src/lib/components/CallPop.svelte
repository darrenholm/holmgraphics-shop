<!-- src/lib/components/CallPop.svelte -->
<!--
  Inbound call screen pop.

  Mounted once in the app shell so it works on every page. It shows who is
  calling, what they have open, and what they owe — before the handset is
  picked up.

  Two rules this component exists to obey, both of which are easy to break
  later by accident:

    1. IT NEVER STEALS FOCUS. No autofocus, no dialog, no scroll-into-view.
       This fires while someone is mid-sentence in a quote or mid-drag on the
       schedule. It is `aria-live="polite"`, and `pointer-events` are off
       everywhere except the cards themselves, so the page underneath stays
       fully usable.

    2. IT NEVER GUESSES. When one number belongs to several clients the card
       lists them and waits. Putting the wrong customer's job list on screen
       while a staffer says "hi Dave" is worse than showing a number.
-->
<script>
  import { onMount, onDestroy, tick } from 'svelte';
  import { goto } from '$app/navigation';
  import { calls, streamState, dismiss, connect, attachClient } from '$lib/stores/call-pop.js';
  import { primeAudio, requestNotificationPermission, stopTitleFlash } from '$lib/call-alert.js';
  import { api } from '$lib/api/client.js';

  let detach = null;

  onMount(() => {
    detach = connect();
    // Browsers won't let a page make noise or raise a notification until
    // they've been asked / interacted with. Do both now so the first call of
    // the day isn't the one that discovers it.
    primeAudio();
    requestNotificationPermission();
    // Coming back to the window means they've seen it; stop the title flash
    // even if the call is still ringing.
    window.addEventListener('focus', stopTitleFlash);
  });

  onDestroy(() => {
    if (detach) detach();
    stopTitleFlash();
    if (typeof window !== 'undefined') window.removeEventListener('focus', stopTitleFlash);
  });

  // Which client the staffer picked on a multi-match card, keyed by pop.
  let chosen = {};

  function pick(key, clientId) {
    chosen = { ...chosen, [key]: clientId };
  }

  // The client this card is currently showing: the only match, or the one
  // that was picked. `null` while a multi-match card is still undecided.
  function resolveActive(call, picks) {
    if (!call.clients?.length) return null;
    if (call.clients.length === 1) return call.clients[0];
    const id = picks[call.key];
    return call.clients.find((c) => c.id === id) || null;
  }

  // Resolve here rather than with {@const} in the each block. In Svelte 4 a
  // {@const} calling a function that reads outer state (here `chosen`) does
  // not reliably re-evaluate when that outer state changes — picking a client
  // on a multi-match card would update `chosen` and the card would not move.
  // Mapping the list in a reactive statement depends on both stores plainly.
  $: cards = $calls.map((c) => ({ ...c, client: resolveActive(c, chosen) }));

  const money = (n) =>
    new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' })
      .format(Number(n || 0));

  // "3 days", "2 months" — rough is fine, this is a glance-value.
  function age(iso) {
    if (!iso) return null;
    const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
    if (Number.isNaN(days)) return null;
    if (days <= 0) return 'today';
    if (days === 1) return '1 day';
    if (days < 45) return `${days} days`;
    const months = Math.round(days / 30);
    return months < 24 ? `${months} months` : `${Math.round(days / 365)} years`;
  }

  function openCustomer(call, client) {
    dismiss(call.key);
    goto(`/clients/${client.id}`);
  }

  // Jump straight to a job off the card. Leaves modified clicks (ctrl/cmd/
  // middle/shift) alone so the browser can open it in a new tab — and the
  // card stays up in that case, which is what you want mid-call.
  function openJob(e, call, job) {
    if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    dismiss(call.key);
    goto(`/jobs/${job.number}`);
  }

  function newJob(call, client) {
    const q = new URLSearchParams({
      clientId: String(client.id),
      clientName: client.name || '',
    });
    if (call.remoteE164) q.set('phone', call.remoteE164);
    dismiss(call.key);
    goto(`/jobs/new?${q}`);
  }

  function createCustomer(call) {
    const q = new URLSearchParams({ new: '1' });
    const number = call.remoteE164 || call.remoteRaw || '';
    if (number) q.set('phone', number);
    dismiss(call.key);
    goto(`/clients?${q}`);
  }

  // ─── Linking a number to a customer ────────────────────────────────────────
  // One number legitimately belongs to several client records — Willie Dales
  // is Willie's Electric, the Dirt Pigs AND the Cargill District Community
  // Foundation. The DB allows it (the unique index is on client_id + e164,
  // not on the number alone) and a shared number pops the "which of these?"
  // chooser. So this is offered on EVERY card, not just unknown callers:
  // "link another" is how the second and third org get added.

  let linkFor = null;      // the call.key whose panel is open
  let linkQuery = '';
  let linkResults = [];
  let linkBusy = false;
  let linkError = '';
  let searchTimer = null;

  // Matches what's already in client_phones — 'Cell' covers 758 of the 1247
  // existing rows, so it's the default, but a landline shouldn't get
  // mislabelled just because it rang while nobody was looking.
  const PHONE_TYPES = ['Cell', 'Office', 'Home', 'Direct', 'Fax'];
  let linkType = 'Cell';

  let linkInput = null;

  async function openLink(call) {
    linkFor = call.key;
    linkQuery = '';
    linkResults = [];
    linkError = '';
    linkType = 'Cell';
    // Put the cursor in the search box. This is not the focus-stealing the
    // component otherwise avoids — the staffer just clicked "Link to
    // customer", so the next thing they want is to type a name. Without it
    // the empty field reads as decoration and there's no obvious way in.
    await tick();
    linkInput?.focus();
  }

  function closeLink() {
    linkFor = null;
    clearTimeout(searchTimer);
  }

  function clientLabel(c) {
    return c.company_name || [c.first_name, c.last_name].filter(Boolean).join(' ') || '(unnamed)';
  }

  function onLinkQuery() {
    clearTimeout(searchTimer);
    linkError = '';
    const q = linkQuery.trim();
    if (q.length < 2) { linkResults = []; return; }
    // Same debounce the clients page uses — every keystroke is a round trip.
    searchTimer = setTimeout(async () => {
      try {
        linkResults = (await api.getClients({ search: q, limit: 8 })) || [];
      } catch (e) {
        linkError = e.message || String(e);
      }
    }, 220);
  }

  async function linkTo(call, client) {
    linkBusy = true;
    linkError = '';
    try {
      const number = call.remoteE164 || call.remoteRaw;
      // Already on this client (they picked one the card is showing) — skip
      // the write so we don't leave a duplicate phone row behind.
      const already = (call.clients || []).some((c) => c.id === client.id);
      if (!already) {
        await api.createClientPhone(client.id, { number, phone_type: linkType });
      }
      // Swap the card to the real one. The staffer is still on the call —
      // seeing the jobs now is the whole point.
      const card = await api.getTelephonyCard(client.id);
      attachClient(call.key, card);
      closeLink();
    } catch (e) {
      linkError = e.message || String(e);
    } finally {
      linkBusy = false;
    }
  }

  function stateLabel(call) {
    if (call.state === 'ended')    return 'Call ended';
    if (call.state === 'answered') return call.handledBy ? `Answered · ${call.handledBy}` : 'Answered';
    return call.direction === 'outbound' ? 'Calling' : 'Incoming call';
  }
</script>

<!--
  aria-live="polite" announces the caller without interrupting whatever a
  screen reader is currently saying — the audible equivalent of not stealing
  focus.
-->
<div class="pop-stack" aria-live="polite" aria-atomic="false">
  {#if $streamState === 'retrying' && $calls.length === 0}
    <!-- Say so rather than failing silently. A screen pop that has quietly
         stopped working looks exactly like a quiet afternoon. -->
    <div class="link-down">Phone link reconnecting…</div>
  {/if}

  {#each cards as call (call.key)}
    <section
      class="pop"
      class:ended={call.state === 'ended'}
      class:answered={call.state === 'answered'}
    >
      <header class="pop-head">
        <span class="ring-dot" class:live={call.state === 'ringing'}></span>
        <span class="pop-kicker">{stateLabel(call)}</span>
        {#if call.localExt}<span class="ext">ext {call.localExt}</span>{/if}
        <button class="x" title="Dismiss" aria-label="Dismiss" on:click={() => dismiss(call.key)}>×</button>
      </header>

      <!-- ── Who ─────────────────────────────────────────────────────── -->
      {#if call.match === 'anonymous'}
        <div class="who"><span class="name unknown">Caller ID blocked</span></div>

      {:else if call.match === 'internal'}
        <div class="who">
          <span class="name">Extension {call.remoteRaw}</span>
          <span class="sub">Internal call</span>
        </div>

      {:else if call.match === 'many' && !call.client}
        <div class="who">
          <span class="number">{call.remoteDisplay}</span>
          <span class="sub">{call.clients.length} clients share this number</span>
        </div>
        <ul class="choices">
          {#each call.clients as c}
            <li>
              <button class="choice" on:click={() => pick(call.key, c.id)}>
                <span class="choice-name">{c.name}</span>
                <span class="choice-meta">
                  {c.openJobCount} open{#if c.unpaidOrders > 0} · {money(c.unpaidOrders)} unpaid{/if}
                </span>
              </button>
            </li>
          {/each}
        </ul>

      {:else if call.client}
        <div class="who">
          <span class="name">{call.client.name}</span>
          {#if call.client.company && call.client.contactName && call.client.company !== call.client.contactName}
            <span class="sub">{call.client.contactName}</span>
          {/if}
          <span class="number">{call.remoteDisplay}</span>
        </div>

        <div class="stats">
          <div class="stat">
            <span class="stat-n">{call.client.openJobCount}</span>
            <span class="stat-l">open {call.client.openJobCount === 1 ? 'job' : 'jobs'}</span>
          </div>
          {#if call.client.recentQuoteCount}
            <div class="stat">
              <span class="stat-n">{call.client.recentQuoteCount}</span>
              <span class="stat-l">recent {call.client.recentQuoteCount === 1 ? 'quote' : 'quotes'}</span>
            </div>
          {/if}
          {#if call.client.oldestOpenJobAt}
            <div class="stat">
              <span class="stat-n">{age(call.client.oldestOpenJobAt)}</span>
              <span class="stat-l">oldest</span>
            </div>
          {/if}
          <div class="stat" class:owing={call.client.unpaidOrders > 0}>
            <!-- Deliberately "unpaid orders", not "balance": this is the
                 unpaid total of ONLINE orders only. Invoiced shop work is
                 billed through QuickBooks and isn't in this number. -->
            <span class="stat-n">{money(call.client.unpaidOrders)}</span>
            <span class="stat-l">unpaid orders</span>
          </div>
        </div>

        {#if call.client.openJobs?.length}
          <ul class="jobs">
            {#each call.client.openJobs as j}
              <li>
                <!-- A real <a href> so middle-click and "open in new tab"
                     work — someone on a call often wants the job beside the
                     card, not instead of it. The click handler dismisses and
                     routes client-side for the ordinary case. -->
                <a
                  class="job"
                  class:quote={j.isQuote}
                  href="/jobs/{j.number}"
                  title={j.description}
                  on:click={(e) => openJob(e, call, j)}
                >
                  <span class="job-no">#{j.number}</span>
                  <span class="job-desc">{j.description || '(no description)'}</span>
                  <span class="job-status">{j.status || ''}</span>
                </a>
              </li>
            {/each}
            {#if call.client.openJobCount > call.client.openJobs.length}
              <li class="more">+{call.client.openJobCount - call.client.openJobs.length} more</li>
            {/if}
          </ul>
        {/if}

      {:else}
        <div class="who">
          <span class="number big">{call.remoteDisplay}</span>
          <span class="sub">No matching client</span>
        </div>
      {/if}

      <!-- ── Link this number to a customer ──────────────────────────── -->
      {#if linkFor === call.key}
        <div class="link-panel">
          <div class="link-row">
            <input
              class="link-search"
              type="search"
              placeholder="Type a customer name…"
              bind:this={linkInput}
              bind:value={linkQuery}
              on:input={onLinkQuery}
              disabled={linkBusy}
            />
            <select class="link-type" bind:value={linkType} disabled={linkBusy} aria-label="Number type">
              {#each PHONE_TYPES as t}<option value={t}>{t}</option>{/each}
            </select>
          </div>
          {#if linkError}
            <p class="link-error">{linkError}</p>
          {:else if linkQuery.trim().length < 2}
            <p class="link-hint">Type at least two characters.</p>
          {:else if linkResults.length === 0}
            <p class="link-hint">No matches.</p>
          {:else}
            <ul class="choices">
              {#each linkResults as c}
                <li>
                  <button class="choice" disabled={linkBusy} on:click={() => linkTo(call, c)}>
                    <span class="choice-name">{clientLabel(c)}</span>
                    {#if c.email}<span class="choice-meta">{c.email}</span>{/if}
                  </button>
                </li>
              {/each}
            </ul>
          {/if}
          <p class="link-hint">
            Saves {call.remoteDisplay} to that customer as a {linkType} number.
            A number can belong to more than one — link again to add another.
          </p>
        </div>
      {/if}

      <!-- ── Actions ─────────────────────────────────────────────────── -->
      <footer class="pop-actions">
        {#if call.client}
          <button class="btn-sm primary" on:click={() => openCustomer(call, call.client)}>Open customer</button>
          <button class="btn-sm" on:click={() => newJob(call, call.client)}>New job</button>
        {:else if call.match === 'none'}
          <button class="btn-sm primary" on:click={() => createCustomer(call)}>Create customer</button>
        {/if}
        <!-- Offered on every card with a real number, not just unknown
             callers — that's how a second or third organisation gets added
             for someone who wears several hats. -->
        {#if call.remoteE164 && call.match !== 'internal' && call.match !== 'anonymous'}
          {#if linkFor === call.key}
            <button class="btn-sm" on:click={closeLink}>Cancel</button>
          {:else}
            <button class="btn-sm" on:click={() => openLink(call)}>
              {call.match === 'none' ? 'Link to customer' : '+ Link another'}
            </button>
          {/if}
        {/if}
        <button class="btn-sm ghost" on:click={() => dismiss(call.key)}>Dismiss</button>
      </footer>
    </section>
  {/each}
</div>

<style>
  /* The stack is a positioned overlay but must not intercept clicks meant
     for the page under it — only the cards themselves are interactive. */
  .pop-stack {
    position: fixed;
    right: 16px;
    bottom: 16px;
    z-index: 300;            /* over the sidebar (100), under nothing else */
    display: flex;
    flex-direction: column-reverse;  /* newest (first in DOM) ends up on top */
    gap: 10px;
    pointer-events: none;
    max-width: min(360px, calc(100vw - 32px));
  }
  .pop, .link-down { pointer-events: auto; }

  .link-down {
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 6px 12px;
    font-family: var(--font-display);
    font-size: 0.78rem;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--text-dim);
  }

  .pop {
    background: var(--surface);
    border: 1px solid var(--border);
    border-left: 3px solid var(--red);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-lg);
    padding: 12px 14px;
    animation: slide-in 0.22s ease-out;
  }
  .pop.answered { border-left-color: var(--green); }
  .pop.ended    { border-left-color: var(--border-mid); opacity: 0.72; }

  @keyframes slide-in {
    from { transform: translateX(24px); opacity: 0; }
    to   { transform: translateX(0);    opacity: 1; }
  }
  /* Respect the setting; the card still appears, it just doesn't travel. */
  @media (prefers-reduced-motion: reduce) {
    .pop { animation: none; }
    .ring-dot.live { animation: none; }
  }

  .pop-head { display: flex; align-items: center; gap: 7px; margin-bottom: 8px; }
  .ring-dot {
    width: 7px; height: 7px; border-radius: 50%;
    background: var(--border-mid); flex-shrink: 0;
  }
  .ring-dot.live { background: var(--red); animation: pulse 1.1s ease-in-out infinite; }
  @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.25; } }

  .pop-kicker {
    font-family: var(--font-display); font-weight: 700; font-size: 0.72rem;
    letter-spacing: 0.12em; text-transform: uppercase; color: var(--text-muted);
  }
  .ext { font-size: 0.7rem; color: var(--text-dim); }
  .x {
    margin-left: auto; background: none; border: none; cursor: pointer;
    color: var(--text-dim); font-size: 1.2rem; line-height: 1; padding: 0 2px;
  }
  .x:hover { color: var(--red); }

  .who { display: flex; flex-direction: column; gap: 1px; margin-bottom: 10px; }
  .name {
    font-family: var(--font-display); font-weight: 700; font-size: 1.15rem;
    line-height: 1.15; color: var(--text);
  }
  .name.unknown { color: var(--text-muted); }
  .sub    { font-size: 0.8rem; color: var(--text-muted); }
  .number { font-size: 0.85rem; color: var(--text-dim); font-variant-numeric: tabular-nums; }
  .number.big {
    font-family: var(--font-display); font-weight: 700;
    font-size: 1.25rem; color: var(--text);
  }

  .stats { display: flex; gap: 14px; margin-bottom: 10px; }
  .stat { display: flex; flex-direction: column; }
  .stat-n {
    font-family: var(--font-display); font-weight: 700; font-size: 1rem;
    color: var(--text); font-variant-numeric: tabular-nums;
  }
  .stat.owing .stat-n { color: var(--amber); }
  .stat-l {
    font-size: 0.66rem; letter-spacing: 0.06em; text-transform: uppercase;
    color: var(--text-dim);
  }

  .jobs { list-style: none; display: flex; flex-direction: column; gap: 2px; margin-bottom: 10px; }
  .jobs li { display: flex; }
  .job {
    display: flex; gap: 7px; align-items: baseline; font-size: 0.79rem;
    flex: 1; min-width: 0; color: inherit; text-decoration: none;
    padding: 2px 4px; margin: 0 -4px; border-radius: var(--radius);
    transition: background 0.12s;
  }
  .job:hover { background: var(--surface-2); color: inherit; }
  .job:hover .job-desc { color: var(--red); }
  .job:focus-visible { outline: 2px solid var(--red); outline-offset: 1px; }
  /* Quotes are context, not work in progress — visibly secondary to the
     active jobs they sort below. */
  .job.quote .job-no,
  .job.quote .job-desc { color: var(--text-muted); }
  .job.quote .job-status { color: var(--blue); }
  .job-no { color: var(--text-dim); font-variant-numeric: tabular-nums; flex-shrink: 0; }
  .job-desc {
    color: var(--text); overflow: hidden; text-overflow: ellipsis;
    white-space: nowrap; flex: 1; min-width: 0;
  }
  .job-status { color: var(--text-dim); font-size: 0.7rem; flex-shrink: 0; }
  .jobs li.more { color: var(--text-dim); font-size: 0.72rem; }

  .choices { list-style: none; display: flex; flex-direction: column; gap: 4px; margin-bottom: 10px; }
  .choice {
    width: 100%; text-align: left; cursor: pointer;
    background: var(--surface-2); border: 1px solid var(--border);
    border-radius: var(--radius); padding: 6px 9px;
    display: flex; flex-direction: column; gap: 1px;
  }
  .choice:hover { border-color: var(--red); background: var(--red-glow); }
  .choice-name { font-family: var(--font-display); font-weight: 700; font-size: 0.9rem; color: var(--text); }
  .choice-meta { font-size: 0.72rem; color: var(--text-dim); }

  .link-panel {
    border-top: 1px solid var(--border);
    padding-top: 8px; margin-bottom: 10px;
    display: flex; flex-direction: column; gap: 6px;
  }
  .link-row { display: flex; gap: 6px; }
  .link-type {
    flex: 0 0 auto; padding: 6px 6px;
    border: 1px solid var(--border); border-radius: var(--radius);
    background: var(--surface-2); color: var(--text);
    font-family: var(--font-body); font-size: 0.8rem; cursor: pointer;
  }
  .link-type:focus { outline: none; border-color: var(--red); }
  .link-search {
    flex: 1; min-width: 0; padding: 6px 9px;
    border: 1px solid var(--border); border-radius: var(--radius);
    background: var(--surface-2); color: var(--text);
    font-family: var(--font-body); font-size: 0.85rem;
  }
  /* Make the field read as a field. It was previously indistinguishable
     from the panel background and people couldn't find it. */
  .link-search { background: var(--surface); border-color: var(--border-mid); }
  .link-search::placeholder { color: var(--text-dim); opacity: 1; }
  .link-search:focus { outline: none; border-color: var(--red); box-shadow: 0 0 0 2px var(--red-glow); }
  .link-hint  { font-size: 0.7rem; color: var(--text-dim); line-height: 1.35; }
  .link-error { font-size: 0.72rem; color: var(--red); }
  .link-panel .choices { margin-bottom: 0; max-height: 168px; overflow-y: auto; }
  .choice[disabled] { opacity: 0.5; cursor: default; }

  .pop-actions { display: flex; gap: 6px; flex-wrap: wrap; }
  .btn-sm {
    padding: 5px 11px; border-radius: var(--radius); cursor: pointer;
    font-family: var(--font-display); font-weight: 700; font-size: 0.76rem;
    letter-spacing: 0.05em; text-transform: uppercase;
    background: var(--surface-2); border: 1px solid var(--border); color: var(--text);
    transition: all 0.15s;
  }
  .btn-sm:hover { border-color: var(--red); }
  .btn-sm.primary { background: var(--red); border-color: var(--red); color: #fff; }
  .btn-sm.primary:hover { background: var(--red-dark); }
  .btn-sm.ghost { background: transparent; border-color: transparent; color: var(--text-dim); margin-left: auto; }
  .btn-sm.ghost:hover { color: var(--red); }

  /* On a phone the bottom nav owns the bottom 64px. */
  @media (max-width: 768px) {
    .pop-stack { right: 8px; left: 8px; bottom: 72px; max-width: none; }
  }
</style>
