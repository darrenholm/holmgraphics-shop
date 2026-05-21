<!--
  /shop/builder/proof/[token] — buyer-facing proof viewer (Step 7).

  Shown after admin attaches a proof + payment link to a submitted draft.
  The token in the URL is the auth — anyone with the link can view and
  approve, mirroring how the existing /proofs.approval_token works.

  Backend: GET /api/builder/proof/:token and POST /:token/approve. The API
  host is configured via PUBLIC_API_URL; falls back to a sibling /api path
  so dev (Vite proxy) and prod both work without changes.
-->
<script>
  import { page } from '$app/stores';

  const API_BASE = (typeof window !== 'undefined'
    && /** @type {any} */(window).PUBLIC_API_URL) || '';

  let token = '';
  $: token = $page.params.token || '';

  let loading = true;
  let loadError = '';
  let proof = null;       // GET response

  let approving = false;
  let approveError = '';

  // Re-fetch whenever the token in the URL changes (covers SPA navigation
  // between two /shop/builder/proof/[token] routes, where the component
  // instance persists and onMount wouldn't fire again).
  $: if (token) load();

  async function load() {
    loading = true;
    loadError = '';
    try {
      const res = await fetch(`${API_BASE}/api/builder/proof/${encodeURIComponent(token)}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      proof = await res.json();
    } catch (e) {
      loadError = e.message;
    } finally {
      loading = false;
    }
  }

  async function approve() {
    if (approving) return;
    approving = true;
    approveError = '';
    try {
      const res = await fetch(`${API_BASE}/api/builder/proof/${encodeURIComponent(token)}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}'
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      // Reload state to reflect approval — server is authoritative.
      await load();
    } catch (e) {
      approveError = e.message;
    } finally {
      approving = false;
    }
  }

  const money = (n) =>
    n == null ? '—' : new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(n);

  function totalPcs(state) {
    const items = Array.isArray(state?.line_items) ? state.line_items : [];
    return items.reduce((acc, li) => {
      const grid = Array.isArray(li.size_grid) ? li.size_grid : [];
      return acc + grid.reduce((a, g) => a + (Number(g.quantity) || 0), 0);
    }, 0);
  }

  function sizesLine(li) {
    const grid = Array.isArray(li.size_grid) ? li.size_grid : [];
    if (grid.length === 0) return '(no sizes)';
    return grid.map((g) => `${g.size} × ${g.quantity}`).join(' · ');
  }

  function locationLabel(l) {
    const tag = l.artwork_deferred
      ? 'art: to follow'
      : (l.artwork_file_name ? `art: ${l.artwork_file_name}` : 'no art');
    const name = l.design_name ? `“${l.design_name}”` : '';
    return { primary: `${l.view} / ${l.label_wearer}`, name, tag };
  }
</script>

<svelte:head><title>Proof review — Holm Graphics</title></svelte:head>

<div class="proof-page">
  {#if loading}
    <p class="muted">Loading proof…</p>
  {:else if loadError}
    <div class="alert error">
      <strong>Couldn't load this proof.</strong>
      <p>{loadError}</p>
      <p class="hint small">If you think this link should still work, reply to your last email from us and we'll resend.</p>
    </div>
  {:else if proof}
    <header class="proof-header">
      <h1>Your proof is ready</h1>
      <p class="hint">
        {#if proof.contact?.name}Hi {proof.contact.name},{:else}Hi,{/if}
        review the mockup below and approve when you're happy with it.
      </p>
    </header>

    {#if proof.status === 'approved'}
      <div class="alert success">
        <strong>Approved.</strong>
        Thanks {proof.contact?.name || ''} — we've got it from here. Use the
        payment link below to complete your order.
      </div>
    {/if}

    {#if proof.proof_message}
      <div class="admin-note">
        <strong>Note from us:</strong>
        <p>{proof.proof_message}</p>
      </div>
    {/if}

    <section class="proof-image">
      {#if proof.proof_image_url}
        <img src={proof.proof_image_url} alt="Decoration proof" />
      {:else}
        <p class="muted small">No proof image attached.</p>
      {/if}
    </section>

    <section class="order-summary">
      <h2>Order summary <span class="muted">({totalPcs(proof.state)} piece{totalPcs(proof.state) === 1 ? '' : 's'})</span></h2>

      {#each (proof.state?.line_items || []) as li (li.id)}
        <article class="line-item">
          <header>
            {#if li.color_hex}<span class="swatch" style="background:{li.color_hex}"></span>{/if}
            <strong>{li.label || li.family || 'Garment'}</strong>
            <span class="muted small">@ {money(li.unit_price)}</span>
          </header>
          <p class="sizes-line"><span class="muted">Sizes:</span> {sizesLine(li)}</p>

          {#if Array.isArray(li.locations) && li.locations.length > 0}
            <ul class="locations">
              {#each li.locations as loc (loc.id || loc.hotspot_key)}
                {@const lbl = locationLabel(loc)}
                <li>
                  <span class="loc-primary">{lbl.primary}</span>
                  {#if lbl.name}<span class="loc-name">{lbl.name}</span>{/if}
                  <span class="loc-tag" class:tag-deferred={loc.artwork_deferred} class:tag-missing={!loc.artwork_file_name && !loc.artwork_deferred}>{lbl.tag}</span>
                </li>
              {/each}
            </ul>
          {/if}

          {#if Array.isArray(li.roster) && li.roster.some((r) => r.name || r.number)}
            <details class="roster">
              <summary>Names &amp; numbers ({li.roster.filter((r) => r.name || r.number).length})</summary>
              <table>
                <thead><tr><th>#</th><th>Size</th><th>Name</th><th>Number</th></tr></thead>
                <tbody>
                  {#each li.roster as r}
                    {#if r.name || r.number}
                      <tr><td>{r.row}</td><td>{r.size}</td><td>{r.name}</td><td>{r.number}</td></tr>
                    {/if}
                  {/each}
                </tbody>
              </table>
            </details>
          {/if}
        </article>
      {/each}
    </section>

    <section class="actions">
      {#if proof.status === 'approved'}
        <a class="btn primary" href={proof.payment_link_url} target="_blank" rel="noopener">
          Pay now →
        </a>
        <p class="hint small">
          Opens our secure payment page. Once paid, we'll move your order
          into production and email you when it's ready.
        </p>
      {:else}
        <button class="btn primary" on:click={approve} disabled={approving}>
          {approving ? 'Approving…' : 'Approve this proof'}
        </button>
        {#if proof.payment_link_url}
          <a class="btn ghost" href={proof.payment_link_url} target="_blank" rel="noopener">
            Approve &amp; pay now →
          </a>
        {/if}
        <p class="hint small">
          Something off? Reply to your proof email and we'll send a revised
          mockup. No charge until you approve.
        </p>
        {#if approveError}
          <p class="alert error">Couldn't record approval: {approveError}</p>
        {/if}
      {/if}
    </section>
  {/if}
</div>

<style>
  .proof-page { max-width: 50rem; margin: 0 auto; padding: 2rem 1rem 4rem; }

  .proof-header { margin-bottom: 1.5rem; }
  .proof-header h1 { margin: 0 0 0.25rem; }
  .hint { color: #666; font-size: 0.95rem; margin: 0; }
  .small { font-size: 0.85rem; }
  .muted { color: #888; font-weight: 400; }

  .alert { padding: 0.85rem 1rem; border-radius: 0.4rem; margin: 0 0 1rem; }
  .alert.error { background: #fee; color: #b00; }
  .alert.success { background: #e8f6ec; color: #1f6b34; border: 1px solid #b6dcc1; }
  .alert p { margin: 0.25rem 0 0; }

  .admin-note {
    background: #fffbeb; border: 1px solid #fde68a;
    padding: 0.85rem 1rem; border-radius: 0.4rem; margin-bottom: 1.25rem;
    color: #713f12; font-size: 0.95rem;
  }
  .admin-note p { margin: 0.25rem 0 0; }

  .proof-image {
    background: white; border: 1px solid #e4e4e7; border-radius: 0.5rem;
    padding: 1rem; margin-bottom: 1.5rem; text-align: center;
  }
  .proof-image img { max-width: 100%; height: auto; border-radius: 0.3rem; }

  .order-summary { margin-bottom: 2rem; }
  .order-summary h2 { font-size: 1.05rem; margin: 0 0 0.75rem; }

  .line-item {
    background: white; border: 1px solid #e4e4e7; border-radius: 0.5rem;
    padding: 0.85rem 1rem; margin-bottom: 0.75rem;
  }
  .line-item header { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; margin-bottom: 0.4rem; }
  .swatch { display: inline-block; width: 1rem; height: 1rem; border-radius: 0.2rem; border: 1px solid #ddd; }
  .sizes-line { margin: 0 0 0.5rem; font-size: 0.9rem; }

  .locations { list-style: none; padding: 0; margin: 0 0 0.4rem; display: flex; flex-direction: column; gap: 0.25rem; }
  .locations li {
    display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;
    font-size: 0.9rem;
    padding: 0.3rem 0.45rem;
    background: #fafafa; border-radius: 0.3rem;
  }
  .loc-primary { font-weight: 500; }
  .loc-name { color: #555; font-style: italic; }
  .loc-tag {
    margin-left: auto;
    font-size: 0.78rem; padding: 0.1rem 0.45rem;
    border-radius: 999px; background: #e8f6ec; color: #1f6b34;
  }
  .loc-tag.tag-deferred { background: #fffbeb; color: #92400e; }
  .loc-tag.tag-missing  { background: #fee2e2; color: #991b1b; }

  .roster { margin-top: 0.5rem; }
  .roster summary { cursor: pointer; font-size: 0.88rem; color: #555; }
  .roster table { width: 100%; margin-top: 0.4rem; border-collapse: collapse; font-size: 0.85rem; }
  .roster th, .roster td { padding: 0.25rem 0.5rem; text-align: left; border-bottom: 1px dashed #eee; }
  .roster th { background: #f7f7f8; color: #444; }

  .actions {
    background: #fafafa; border: 1px solid #e4e4e7; border-radius: 0.5rem;
    padding: 1.25rem; display: flex; flex-direction: column; align-items: flex-start; gap: 0.6rem;
  }
  .btn {
    display: inline-block; padding: 0.75rem 1.4rem; background: #c01818; color: white;
    border: none; border-radius: 0.4rem; font-weight: 600; text-decoration: none; cursor: pointer;
    font-size: 0.95rem;
  }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn.ghost { background: transparent; color: #c01818; border: 1px solid #c01818; }
</style>
