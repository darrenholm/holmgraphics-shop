<!--
  /fleet-admin — admin landing page.

  Shows the expiry dashboard summary (per spec) plus quick links into the
  vehicles list, access log, and driver view. Was a redirect to
  /fleet-admin/vehicles until Step 5 — now it's the home.
-->
<script>
  import { onMount } from 'svelte';
  import { fleetApi } from '$lib/api/fleet-client.js';

  let loading = true;
  let loadError = '';
  let counts = { expired: 0, expiring_soon: 0, missing: 0, valid: 0 };
  let fleet  = { trucks: 0, trailers: 0 };
  let attention = [];
  let smartcar = null;

  onMount(async () => {
    try {
      const data = await fleetApi.getExpirySummary();
      counts = data.counts || counts;
      fleet  = data.fleet  || fleet;
      attention = data.attention || [];
    } catch (e) {
      loadError = e.message;
    } finally {
      loading = false;
    }
    // Best-effort: surface telematics cap on the dashboard.
    try { smartcar = await fleetApi.smartcarStatus(); } catch {}
  });

  const SECTION_LABEL = { ownership: 'Ownership', insurance: 'Insurance', cvor: 'CVOR' };
  function formatDate(s) {
    return s ? new Date(s).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
  }
  function daysFromToday(s) {
    if (!s) return null;
    const today = new Date(); today.setHours(0,0,0,0);
    const d = new Date(s);
    return Math.floor((d.getTime() - today.getTime()) / 86400000);
  }
</script>

<svelte:head><title>Fleet — Dashboard · Holm Graphics</title></svelte:head>

<div class="page">
  <header class="page-head">
    <h1>Fleet — Dashboard</h1>
    <p class="hint">{fleet.trucks} truck{fleet.trucks === 1 ? '' : 's'} · {fleet.trailers} trailer{fleet.trailers === 1 ? '' : 's'} active.
      Drivers access docs at <a href="/fleet-docs">/fleet-docs</a>.</p>
  </header>

  {#if loading}
    <p class="hint">Loading…</p>
  {:else if loadError}
    <p class="alert error">{loadError}</p>
  {:else}
    <div class="summary">
      <article class="card card-expired" class:zero={counts.expired === 0}>
        <span class="num">{counts.expired}</span>
        <span class="label">Expired</span>
      </article>
      <article class="card card-soon" class:zero={counts.expiring_soon === 0}>
        <span class="num">{counts.expiring_soon}</span>
        <span class="label">Expire in 30 days</span>
      </article>
      <article class="card card-missing" class:zero={counts.missing === 0}>
        <span class="num">{counts.missing}</span>
        <span class="label">Not on file</span>
      </article>
      <article class="card card-valid">
        <span class="num">{counts.valid}</span>
        <span class="label">Current</span>
      </article>
    </div>

    {#if attention.length > 0}
      <section class="attention">
        <h2>Needs attention</h2>
        <ul>
          {#each attention as a (a.document_id)}
            {@const days = daysFromToday(a.expiry_date)}
            <li>
              <a href={`/fleet-admin/vehicles/${a.vehicle_id}`}>
                <span class="unit">{a.unit_number}</span>
                <span class="doc-type">{SECTION_LABEL[a.doc_type] || a.doc_type}</span>
                <span class="status status-{a.status}">
                  {#if a.status === 'expired'}
                    Expired {days != null ? `${Math.abs(days)}d ago` : ''}
                  {:else}
                    Expires {days === 0 ? 'today' : `in ${days}d`} · {formatDate(a.expiry_date)}
                  {/if}
                </span>
              </a>
            </li>
          {/each}
        </ul>
      </section>
    {:else if counts.expired === 0 && counts.expiring_soon === 0 && counts.missing === 0}
      <p class="empty muted">All current. Nothing to chase.</p>
    {/if}

    {#if smartcar?.configured}
      <p class="hint small telematics-line">
        Telematics: <strong>{smartcar.connected}</strong> of {smartcar.cap} vehicles connected ({smartcar.mode === 'live' ? 'live' : 'test mode'}).
        {#if smartcar.connected === smartcar.cap}<span class="muted">— cap reached.</span>{/if}
      </p>
    {/if}

    <nav class="links">
      <a class="link-tile" href="/fleet-admin/vehicles">
        <strong>Manage vehicles</strong>
        <span>Add/edit fleet, upload new documents</span>
      </a>
      <a class="link-tile" href="/fleet-admin/access-log">
        <strong>Access log</strong>
        <span>Who viewed which docs and when</span>
      </a>
      <a class="link-tile" href="/fleet-docs/locations">
        <strong>Live locations</strong>
        <span>Map view of connected trucks</span>
      </a>
      <a class="link-tile" href="/fleet-docs">
        <strong>Driver view</strong>
        <span>What drivers see on their phones</span>
      </a>
    </nav>
  {/if}
</div>

<style>
  .page { max-width: 60rem; margin: 0 auto; padding: 1.5rem 1rem 4rem; }
  .page-head h1 { margin: 0 0 0.2rem; }
  .hint { color: #666; font-size: 0.92rem; margin: 0; }
  .muted { color: #888; }

  .alert { padding: 0.5rem 0.75rem; border-radius: 0.3rem; font-size: 0.9rem; }
  .alert.error { background: #fee; color: #b00; }

  .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr)); gap: 0.75rem; margin: 1.25rem 0; }
  .card { background: white; border: 1px solid #e4e4e7; border-left: 0.4rem solid; border-radius: 0.55rem; padding: 1rem 1.1rem; display: flex; flex-direction: column; gap: 0.15rem; }
  .card .num { font-size: 2rem; font-weight: 700; line-height: 1; }
  .card .label { font-size: 0.88rem; color: #555; }
  .card.card-expired { border-left-color: #b91c1c; }
  .card.card-soon    { border-left-color: #d9a401; }
  .card.card-missing { border-left-color: #c0c0c4; }
  .card.card-valid   { border-left-color: #1f6b34; }
  .card.zero .num { color: #999; }
  .card.zero { background: #fafafa; }

  .attention { background: white; border: 1px solid #e4e4e7; border-radius: 0.55rem; padding: 1rem 1.25rem; margin-bottom: 1.25rem; }
  .attention h2 { font-size: 1rem; margin: 0 0 0.6rem; }
  .attention ul { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 0.25rem; }
  .attention a {
    display: grid; grid-template-columns: 4.5rem 1fr auto; gap: 0.75rem; align-items: center;
    padding: 0.55rem 0.65rem;
    border-radius: 0.4rem;
    text-decoration: none; color: inherit;
  }
  .attention a:hover { background: #fafafa; }
  .attention .unit { font-weight: 700; }
  .attention .doc-type { color: #555; font-size: 0.92rem; }
  .attention .status { font-size: 0.85rem; }
  .attention .status-expired { color: #b91c1c; font-weight: 600; }
  .attention .status-expiring_soon { color: #6c5300; }

  .empty { padding: 1rem 0; }

  .links { display: grid; grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr)); gap: 0.75rem; }
  .link-tile {
    display: flex; flex-direction: column; gap: 0.15rem;
    padding: 1rem 1.1rem;
    background: white;
    border: 1px solid #e4e4e7;
    border-radius: 0.5rem;
    text-decoration: none; color: inherit;
  }
  .link-tile:hover { border-color: #c01818; }
  .link-tile strong { font-size: 1rem; }
  .link-tile span { font-size: 0.88rem; color: #666; }

  .telematics-line { margin: 0.5rem 0 1rem; }
</style>
