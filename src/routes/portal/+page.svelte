<!--
  /portal — Customer hub. The default landing page after a customer signs
  in (replaces /shop/account as the post-login destination).

  Three tiles:
    1. LED Advertising  → /advertise/my-ads
    2. Apparel Ordering → /shop (catalog) + /shop/account (history)
    3. Current Jobs     → list from /api/customer/projects with status,
                          due date, assigned-staff (name + email mailto),
                          and a "Upload files →" action that auto-mints
                          an upload link via the customer endpoint.

  Auth: requires the customer realm ($customer). Anonymous visitors get
  bounced to /shop/login?return=/portal.
-->
<script>
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { customer, isCustomerLoggedIn } from '$lib/stores/customer-auth.js';
  import { customerApi } from '$lib/api/customer-client.js';
  import { advertiseApi } from '$lib/advertise/api.js';

  let loading = true;
  let err = null;
  let projects = [];
  let activeAdCount = 0;
  let upcomingAdCount = 0;
  /** Per-project ID, transient: which row's "Upload files" button is busy. */
  let uploadingFor = null;

  onMount(async () => {
    if (!$isCustomerLoggedIn) {
      goto(`/shop/login?return=/portal`);
      return;
    }

    // Fire both lookups in parallel — neither depends on the other and
    // the portal feels significantly more responsive than serialising.
    const [projectsRes, rentalsRes] = await Promise.allSettled([
      customerApi.getMyProjects(),
      advertiseApi.getMyRentals(),
    ]);

    if (projectsRes.status === 'fulfilled') {
      projects = projectsRes.value?.projects || [];
    } else {
      // 401 on either side means the JWT is stale — log out + re-login.
      const msg = projectsRes.reason?.message || '';
      if (/401|missing bearer|invalid customer token/i.test(msg)) {
        customer.logout();
        goto(`/shop/login?return=/portal`);
        return;
      }
      err = projectsRes.reason?.message || 'Could not load your jobs.';
    }

    if (rentalsRes.status === 'fulfilled') {
      activeAdCount   = (rentalsRes.value?.running   || []).length;
      upcomingAdCount = (rentalsRes.value?.upcoming  || []).length;
    } else {
      // Don't surface — the LED app might just be down or this customer
      // might not have any ads. The /advertise CTA still works.
    }

    loading = false;
  });

  function statusClass(name) {
    const s = String(name || '').toLowerCase();
    if (/quote/.test(s))            return 'quote';
    if (/order|prod|active/.test(s)) return 'active';
    if (/proof/.test(s))            return 'proof';
    if (/pickup|ship|ready/.test(s)) return 'ready';
    if (/bill|invoice/.test(s))     return 'billing';
    return 'neutral';
  }

  function fmtDate(d) {
    if (!d) return '—';
    try {
      return new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    } catch {
      return d;
    }
  }

  async function uploadFor(projectId) {
    uploadingFor = projectId;
    try {
      const res = await customerApi.requestProjectUploadLink(projectId);
      // Redirect to the existing public upload page; that page handles
      // the actual drag-and-drop. Link is one-shot per project but
      // good for 14 days / 20 uploads.
      if (res?.url) {
        window.location.href = res.url;
        return;
      }
      err = 'Could not create an upload link. Try again or contact us.';
    } catch (e) {
      err = e.message || 'Could not create an upload link.';
    } finally {
      uploadingFor = null;
    }
  }

  function handleLogout() {
    customer.logout();
    goto('/shop/login');
  }
</script>

<svelte:head><title>My account — Holm Graphics</title></svelte:head>

<div class="page">
  <header class="hub-head">
    <div>
      <h1>Welcome back{$customer ? `, ${$customer.fname || $customer.company || ''}` : ''}</h1>
      {#if $customer}<p class="meta">{$customer.email}</p>{/if}
    </div>
    <button class="ghost" on:click={handleLogout}>Sign out</button>
  </header>

  {#if err}<div class="error-banner">{err}</div>{/if}

  <div class="tiles">
    <!-- LED Advertising tile -->
    <a class="tile tile-link" href="/advertise/my-ads/">
      <div class="tile-icon">📺</div>
      <h2>LED advertising</h2>
      <p class="tile-body">
        Manage the ads running on Holm Graphics LED displays — swap art
        on-demand, view your run windows, book a new screen.
      </p>
      <div class="tile-stats">
        {#if activeAdCount > 0}
          <span class="stat good">{activeAdCount} running now</span>
        {/if}
        {#if upcomingAdCount > 0}
          <span class="stat">{upcomingAdCount} upcoming</span>
        {/if}
        {#if activeAdCount === 0 && upcomingAdCount === 0 && !loading}
          <span class="stat muted">No active ads</span>
        {/if}
      </div>
      <span class="tile-cta">My ads →</span>
    </a>

    <!-- Apparel tile -->
    <a class="tile tile-link" href="/shop">
      <div class="tile-icon">👕</div>
      <h2>Apparel ordering</h2>
      <p class="tile-body">
        Order custom apparel, hats, and decorated swag from the Holm
        Graphics catalog. Submit a quote, place a re-order, or browse.
      </p>
      <div class="tile-stats">
        <a class="subcta" href="/shop/account" on:click|stopPropagation>Order history →</a>
      </div>
      <span class="tile-cta">Browse catalog →</span>
    </a>

    <!-- Current Jobs tile -->
    <section class="tile tile-jobs">
      <div class="tile-icon">📋</div>
      <h2>Current jobs</h2>
      {#if loading}
        <p class="muted">Loading…</p>
      {:else if projects.length === 0}
        <p class="muted small">
          No active jobs right now. When we start something for you, it'll show up here.
        </p>
      {:else}
        <ul class="jobs">
          {#each projects as p (p.id)}
            <li class="job">
              <div class="job-head">
                <div class="job-title">
                  <strong>#{p.id}</strong> {p.project_name || '(no description)'}
                </div>
                <span class="status status-{statusClass(p.status_name)}">
                  {p.status_name || 'open'}
                </span>
              </div>
              <div class="job-meta">
                {#if p.due_date}<span>Due {fmtDate(p.due_date)}</span>{/if}
                {#if p.assigned_to}
                  <span>·</span>
                  <span>
                    {p.assigned_to}
                    {#if p.assigned_email}
                      <a class="contact" href="mailto:{p.assigned_email}">{p.assigned_email}</a>
                    {/if}
                  </span>
                {/if}
              </div>
              <div class="job-actions">
                <button
                  type="button"
                  class="upload-btn"
                  disabled={uploadingFor === p.id}
                  on:click={() => uploadFor(p.id)}
                >
                  {uploadingFor === p.id ? 'Opening…' : '📎 Upload files →'}
                </button>
              </div>
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  </div>
</div>

<style>
  .page {
    max-width: 1080px;
    margin: 0 auto;
    padding: 32px 20px 64px;
  }

  .hub-head {
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    gap: 16px;
    margin-bottom: 24px;
    flex-wrap: wrap;
  }
  .hub-head h1 {
    font-family: var(--font-display);
    margin: 0;
    font-size: 1.8rem;
    color: var(--text);
  }
  .meta { color: var(--text-muted); margin: 4px 0 0; font-size: 0.95rem; }

  .ghost {
    background: transparent;
    border: 1px solid var(--border);
    color: var(--text-muted);
    padding: 8px 14px;
    border-radius: 4px;
    font-family: var(--font-display);
    text-transform: uppercase;
    font-size: 0.78rem;
    letter-spacing: 0.06em;
    cursor: pointer;
  }
  .ghost:hover { color: var(--text); }

  .error-banner {
    background: rgba(192,57,43,0.1);
    border: 1px solid var(--red);
    color: var(--red);
    padding: 10px 14px;
    border-radius: 6px;
    margin-bottom: 16px;
  }

  .tiles {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 16px;
  }
  /* Jobs tile spans full width below the two top tiles. */
  .tile-jobs { grid-column: 1 / -1; }
  @media (max-width: 720px) {
    .tiles { grid-template-columns: 1fr; }
  }

  .tile {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 24px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    color: var(--text);
    text-decoration: none;
    transition: border-color 0.1s, transform 0.1s;
  }
  .tile-link:hover { border-color: var(--red); transform: translateY(-1px); }

  .tile-icon {
    font-size: 1.6rem;
    margin-bottom: 4px;
  }
  .tile h2 {
    font-family: var(--font-display);
    font-size: 1.3rem;
    margin: 0;
    color: var(--text);
  }
  .tile-body {
    color: var(--text-muted);
    font-size: 0.95rem;
    line-height: 1.5;
    margin: 0 0 8px;
  }
  .tile-stats {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    margin-bottom: 8px;
  }
  .stat {
    display: inline-block;
    padding: 3px 10px;
    border-radius: 4px;
    font-family: var(--font-display);
    text-transform: uppercase;
    font-size: 0.74rem;
    letter-spacing: 0.06em;
    background: rgba(154,161,173,0.15);
    color: var(--text-muted);
  }
  .stat.good  { background: rgba(63,191,111,0.15); color: #16a34a; }
  .stat.muted { background: transparent; padding-left: 0; }

  .tile-cta {
    margin-top: auto;
    color: var(--red);
    font-family: var(--font-display);
    font-weight: 700;
    font-size: 0.92rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .subcta {
    color: var(--text-muted);
    text-decoration: none;
    font-size: 0.85rem;
  }
  .subcta:hover { color: var(--red); }

  /* Jobs list */
  .muted { color: var(--text-muted); }
  .small { font-size: 0.88rem; }

  .jobs {
    list-style: none;
    margin: 8px 0 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .job {
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 12px 14px;
    display: grid;
    grid-template-columns: 1fr auto;
    grid-template-areas:
      "head head"
      "meta meta"
      "actions actions";
    gap: 6px;
  }
  @media (min-width: 600px) {
    .job {
      grid-template-columns: 1fr auto;
      grid-template-areas:
        "head actions"
        "meta actions";
    }
  }
  .job-head {
    grid-area: head;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
  }
  .job-title {
    font-family: var(--font-display);
    font-size: 1rem;
    color: var(--text);
    word-break: break-word;
  }
  .job-meta {
    grid-area: meta;
    color: var(--text-muted);
    font-size: 0.88rem;
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    align-items: baseline;
  }
  .job-meta .contact {
    color: var(--red);
    text-decoration: none;
  }
  .job-meta .contact:hover { text-decoration: underline; }
  .job-actions { grid-area: actions; align-self: center; }

  .status {
    display: inline-block;
    padding: 3px 10px;
    border-radius: 3px;
    font-family: var(--font-display);
    text-transform: uppercase;
    font-size: 0.74rem;
    letter-spacing: 0.06em;
    white-space: nowrap;
  }
  .status-quote   { background: rgba(31,58,147,0.12);  color: #1F3A93; }
  .status-active  { background: rgba(217,119,6,0.15);  color: #b45309; }
  .status-proof   { background: rgba(31,58,147,0.12);  color: #1F3A93; }
  .status-ready   { background: rgba(63,191,111,0.18); color: #16a34a; }
  .status-billing { background: rgba(154,161,173,0.18); color: var(--text-muted); }
  .status-neutral { background: rgba(154,161,173,0.15); color: var(--text-muted); }

  .upload-btn {
    background: var(--red);
    color: #fff;
    border: 0;
    padding: 8px 14px;
    border-radius: 4px;
    font-family: var(--font-display);
    font-weight: 700;
    font-size: 0.82rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    cursor: pointer;
  }
  .upload-btn:hover:not(:disabled) { filter: brightness(0.95); }
  .upload-btn:disabled { opacity: 0.55; cursor: not-allowed; }
</style>
