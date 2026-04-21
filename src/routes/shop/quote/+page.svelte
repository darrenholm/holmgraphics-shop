<!-- src/routes/shop/quote/+page.svelte -->
<!--
  Review what's in the quote, capture contact info, submit.
  v1 behaviour: builds a prefilled mailto: to darren@holmgraphics.ca
  with the full itemised quote in the body. No payment processor yet —
  Darren will reply with a formal quote + invoice from QuickBooks.

  When /api/quote-requests endpoint exists (task #65), flip the submit
  path from mailto: to an API POST.
-->
<script>
  import { onMount } from 'svelte';
  import { cart, cartCount, cartSubtotal, cartHasUnknownPrice } from '$lib/stores/cart.js';

  let name = '';
  let email = '';
  let phone = '';
  let company = '';
  let needBy = '';
  let notes = '';
  let submitted = false;
  let validationError = '';

  const money = (n) =>
    n == null
      ? '—'
      : new Intl.NumberFormat('en-CA', {
          style: 'currency',
          currency: 'CAD',
          minimumFractionDigits: 2
        }).format(n);

  const decoLabel = (t) =>
    ({
      left_chest: 'Small — left chest',
      full_chest_or_back: 'Large — full chest or back',
      other: 'Other / multi-location'
    }[t] || t);

  function bundleQty(b) {
    return b.lines.reduce((n, l) => n + (l.qty || 0), 0);
  }
  function bundleSubtotal(b) {
    return b.lines.reduce(
      (s, l) => s + (l.unitPrice != null ? l.unitPrice * l.qty : 0),
      0
    );
  }
  function bundleHasUnpriced(b) {
    return b.lines.some((l) => l.unitPrice == null);
  }

  function setLineQty(bundleId, variantId, qty) {
    const n = Math.max(0, Number(qty) || 0);
    const bundle = $cart.find((b) => b.bundleId === bundleId);
    if (!bundle) return;
    const nextLines = bundle.lines
      .map((l) => (l.variantId === variantId ? { ...l, qty: n } : l))
      .filter((l) => l.qty > 0);
    if (nextLines.length === 0) {
      cart.remove(bundleId);
      return;
    }
    cart.updateBundle(bundleId, { lines: nextLines });
  }

  function buildEmailBody() {
    const lines = [];
    lines.push('QUOTE REQUEST');
    lines.push('==============');
    lines.push('');
    lines.push(`Name:     ${name}`);
    lines.push(`Email:    ${email}`);
    lines.push(`Phone:    ${phone || '—'}`);
    if (company) lines.push(`Company:  ${company}`);
    if (needBy)  lines.push(`Needed by: ${needBy}`);
    lines.push('');
    lines.push('ITEMS');
    lines.push('-----');
    $cart.forEach((b, i) => {
      lines.push('');
      lines.push(`${i + 1}. ${b.brand ? b.brand + ' — ' : ''}${b.productName} (#${b.style}, ${b.supplierName})`);
      lines.push(`   Decoration: ${decoLabel(b.decoration?.type)}${b.decoration?.notes ? ' — ' + b.decoration.notes : ''}`);
      b.lines.forEach((l) => {
        const subtotal = l.unitPrice != null ? money(l.unitPrice * l.qty) : 'TBD';
        lines.push(
          `   • ${l.qty}× ${l.colorName || '—'} / ${l.size || '—'}  ` +
          `@ ${money(l.unitPrice)} = ${subtotal}`
        );
      });
    });
    lines.push('');
    lines.push('SUMMARY');
    lines.push('-------');
    lines.push(`Total pieces: ${$cartCount}`);
    lines.push(
      `Blank subtotal: ${$cartHasUnknownPrice ? 'Quote on request' : money($cartSubtotal)}`
    );
    lines.push('(Decoration, setup, shipping and HST quoted separately.)');
    if (notes) {
      lines.push('');
      lines.push('NOTES');
      lines.push('-----');
      lines.push(notes);
    }
    return lines.join('\n');
  }

  function submit() {
    validationError = '';
    if ($cart.length === 0) { validationError = 'Your quote is empty.'; return; }
    if (!name.trim())   { validationError = 'Please enter your name.';  return; }
    if (!email.trim() || !/^\S+@\S+\.\S+$/.test(email)) {
      validationError = 'Please enter a valid email address.';
      return;
    }

    const subject = `Quote request — ${name} — ${$cartCount} pc`;
    const body = buildEmailBody();
    const href =
      'mailto:brady@holmgraphics.ca' +
      '?subject=' + encodeURIComponent(subject) +
      '&body=' + encodeURIComponent(body);

    // Open default mail client
    window.location.href = href;
    submitted = true;
  }

  function clearAll() {
    if (confirm('Remove everything from your quote?')) cart.clear();
  }
</script>

<svelte:head>
  <title>Your Quote — Holm Graphics Shop</title>
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

  <div class="container">
    <a class="breadcrumb" href="/shop/">← Back to catalog</a>
    <h1>Your quote</h1>

    {#if submitted}
      <div class="success-card">
        <h2>✓ Quote request sent</h2>
        <p>
          Your email client should have opened with the full quote details.
          If it didn't, email <a href="mailto:brady@holmgraphics.ca">brady@holmgraphics.ca</a>
          or call <a href="tel:5195073001">519-507-3001</a>.
        </p>
        <p>We'll review and get back to you within one business day with pricing
        including decoration, setup, shipping and applicable taxes.</p>
        <div class="cta-row">
          <button class="btn btn-ghost" on:click={() => { submitted = false; }}>Edit quote</button>
          <a class="btn btn-primary" href="/shop/" on:click={() => cart.clear()}>Start a new quote</a>
        </div>
      </div>
    {:else if $cart.length === 0}
      <div class="empty">
        <p>Your quote is empty.</p>
        <a class="btn btn-primary" href="/shop/">Browse the catalog →</a>
      </div>
    {:else}
      <div class="layout">
        <!-- Bundles -->
        <div class="bundles">
          {#each $cart as b (b.bundleId)}
            <article class="bundle">
              <header class="bundle-head">
                {#if b.imageUrl}
                  <img class="thumb" src={b.imageUrl} alt={b.productName} referrerpolicy="no-referrer" />
                {:else}
                  <div class="thumb thumb-empty"></div>
                {/if}
                <div class="bundle-title">
                  <div class="bundle-brand">{b.brand || b.supplierName}</div>
                  <h2>{b.productName}</h2>
                  <div class="bundle-meta">#{b.style} · {b.supplierName}</div>
                </div>
                <button class="remove-btn" on:click={() => cart.remove(b.bundleId)} aria-label="Remove">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
                    <path d="M10 11v6M14 11v6" />
                  </svg>
                </button>
              </header>

              <div class="deco-line">
                <strong>Decoration:</strong> {decoLabel(b.decoration?.type)}
                {#if b.decoration?.notes}
                  <span class="deco-notes">— {b.decoration.notes}</span>
                {/if}
              </div>

              <table class="lines">
                <thead>
                  <tr>
                    <th>Colour</th>
                    <th>Size</th>
                    <th class="num">Qty</th>
                    <th class="num">Unit</th>
                    <th class="num">Subtotal</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {#each b.lines as l (l.variantId)}
                    <tr>
                      <td>
                        <span class="swatch-sm" style="background:{l.colorHex || '#ccc'};"></span>
                        {l.colorName || '—'}
                      </td>
                      <td>{l.size || '—'}</td>
                      <td class="num">
                        <input
                          class="qty-input"
                          type="number"
                          min="0"
                          step="1"
                          inputmode="numeric"
                          value={l.qty}
                          on:change={(e) => setLineQty(b.bundleId, l.variantId, e.target.value)}
                        />
                      </td>
                      <td class="num">{money(l.unitPrice)}</td>
                      <td class="num">
                        {l.unitPrice != null ? money(l.unitPrice * l.qty) : 'TBD'}
                      </td>
                      <td class="num">
                        <button class="icon-btn" on:click={() => setLineQty(b.bundleId, l.variantId, 0)} aria-label="Remove line">
                          ×
                        </button>
                      </td>
                    </tr>
                  {/each}
                </tbody>
                <tfoot>
                  <tr>
                    <td colspan="2"><strong>Bundle totals</strong></td>
                    <td class="num"><strong>{bundleQty(b)}</strong></td>
                    <td></td>
                    <td class="num">
                      <strong>{bundleHasUnpriced(b) ? 'Quote on request' : money(bundleSubtotal(b))}</strong>
                    </td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </article>
          {/each}

          <div class="more-row">
            <a class="btn btn-ghost" href="/shop/">+ Add another product</a>
            <button class="btn btn-ghost danger" on:click={clearAll}>Clear quote</button>
          </div>
        </div>

        <!-- Contact + submit -->
        <aside class="sidebar">
          <div class="totals card">
            <h3>Quote summary</h3>
            <div class="summary-line"><span>Products</span><strong>{$cart.length}</strong></div>
            <div class="summary-line"><span>Total pieces</span><strong>{$cartCount}</strong></div>
            <div class="summary-line big">
              <span>Blank subtotal</span>
              <strong>{$cartHasUnknownPrice ? 'Quote on request' : money($cartSubtotal)}</strong>
            </div>
            <p class="fine">Final price includes decoration, setup fees, shipping and HST — confirmed in the quote we email back to you.</p>
          </div>

          <form class="contact card" on:submit|preventDefault={submit}>
            <h3>Your contact info</h3>

            <div class="form-group">
              <label for="name">Name *</label>
              <input id="name" type="text" bind:value={name} autocomplete="name" required />
            </div>

            <div class="form-group">
              <label for="email">Email *</label>
              <input id="email" type="email" bind:value={email} autocomplete="email" required />
            </div>

            <div class="form-group">
              <label for="phone">Phone</label>
              <input id="phone" type="tel" bind:value={phone} autocomplete="tel" />
            </div>

            <div class="form-group">
              <label for="company">Company / team</label>
              <input id="company" type="text" bind:value={company} autocomplete="organization" />
            </div>

            <div class="form-group">
              <label for="need-by">Needed by</label>
              <input id="need-by" type="date" bind:value={needBy} />
            </div>

            <div class="form-group">
              <label for="notes">Notes</label>
              <textarea id="notes" rows="3" bind:value={notes} placeholder="Event, deadline, artwork source, anything else…"></textarea>
            </div>

            {#if validationError}
              <div class="err">{validationError}</div>
            {/if}

            <button type="submit" class="btn btn-primary big full">Request quote →</button>
            <p class="fine center">
              Opens your email app with the quote details. No payment collected at this step.
            </p>
          </form>
        </aside>
      </div>
    {/if}
  </div>

  <footer class="public-footer">
    <p>Holm Graphics Inc. · Walkerton, Ontario · <a href="tel:5195073001">519-507-3001</a> · <a href="mailto:brady@holmgraphics.ca">brady@holmgraphics.ca</a></p>
  </footer>
</div>

<style>
  .shop-shell { min-height: 100vh; background: var(--black); color: var(--text); }

  .public-header {
    position: sticky; top: 0; z-index: 50;
    display: flex; align-items: center; gap: 24px;
    padding: 14px 28px;
    background: var(--surface);
    border-bottom: 1px solid var(--border);
  }
  .brand { display: flex; flex-direction: column; line-height: 1; text-decoration: none; }
  .brand-logo {
    font-family: Impact, 'Arial Black', sans-serif;
    font-size: 1.4rem; letter-spacing: 0.08em; color: var(--red);
  }
  .brand-sub {
    font-family: var(--font-display); font-size: 0.62rem;
    letter-spacing: 0.3em; color: var(--text-muted);
    text-transform: uppercase; margin-top: 2px;
  }
  .public-nav { margin-left: auto; display: flex; gap: 22px; }
  .public-nav a {
    font-family: var(--font-display); font-size: 0.82rem;
    font-weight: 600; letter-spacing: 0.08em; color: var(--text-muted);
    text-transform: uppercase; text-decoration: none;
  }
  .public-nav a:hover { color: var(--red); }

  .container { max-width: 1200px; margin: 0 auto; padding: 20px 28px 56px; }
  .breadcrumb {
    display: inline-block; font-family: var(--font-display); font-size: 0.8rem;
    text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted);
    margin-bottom: 8px;
  }
  h1 {
    font-family: var(--font-display);
    font-size: 2rem; font-weight: 900; margin-bottom: 18px;
  }

  .empty { padding: 60px 20px; text-align: center; color: var(--text-muted); }
  .empty .btn { margin-top: 16px; }

  .layout {
    display: grid;
    grid-template-columns: 1fr 360px;
    gap: 24px;
    align-items: start;
  }

  /* ─── Bundles ─── */
  .bundles { display: flex; flex-direction: column; gap: 16px; }

  .bundle {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    padding: 16px 18px;
    box-shadow: var(--shadow);
  }
  .bundle-head {
    display: flex; gap: 14px; align-items: flex-start;
    margin-bottom: 10px;
  }
  .thumb {
    width: 64px; height: 64px; border-radius: var(--radius);
    object-fit: cover; background: var(--surface-3); flex-shrink: 0;
  }
  .thumb-empty { background: var(--surface-3); }
  .bundle-title { flex: 1; min-width: 0; }
  .bundle-brand {
    font-family: var(--font-display); font-weight: 700; font-size: 0.72rem;
    letter-spacing: 0.12em; text-transform: uppercase; color: var(--red);
  }
  .bundle-title h2 {
    font-family: var(--font-display);
    font-size: 1.1rem; font-weight: 900; margin: 2px 0;
  }
  .bundle-meta { font-size: 0.82rem; color: var(--text-muted); }
  .remove-btn {
    background: none; border: none; padding: 4px; cursor: pointer;
    color: var(--text-dim); flex-shrink: 0;
  }
  .remove-btn:hover { color: var(--red); }

  .deco-line {
    background: var(--surface-2);
    border-radius: var(--radius);
    padding: 8px 12px;
    font-size: 0.88rem;
    color: var(--text-muted);
    margin-bottom: 10px;
  }
  .deco-line strong { color: var(--text); }
  .deco-notes { font-style: italic; }

  .lines { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
  .lines th, .lines td {
    padding: 6px 8px; text-align: left;
    border-bottom: 1px solid var(--border);
  }
  .lines th {
    font-family: var(--font-display); font-size: 0.72rem;
    font-weight: 700; letter-spacing: 0.08em;
    text-transform: uppercase; color: var(--text-muted);
    background: var(--surface-2);
  }
  .lines .num { text-align: right; font-variant-numeric: tabular-nums; }
  .lines tfoot td { border-bottom: none; padding-top: 10px; }
  .swatch-sm {
    display: inline-block; width: 14px; height: 14px;
    border-radius: 50%; vertical-align: -2px; margin-right: 6px;
    border: 1px solid rgba(0,0,0,0.12);
  }
  .qty-input { width: 72px; padding: 4px 8px; text-align: right; }
  .icon-btn {
    background: none; border: none; color: var(--text-dim);
    cursor: pointer; font-size: 1.2rem; line-height: 1; padding: 0 6px;
  }
  .icon-btn:hover { color: var(--red); }

  .more-row { display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
  .danger { color: var(--red); border-color: rgba(192,57,43,0.4); }

  /* ─── Sidebar ─── */
  .sidebar { position: sticky; top: 88px; display: flex; flex-direction: column; gap: 16px; }
  .card h3 {
    font-family: var(--font-display); font-size: 0.95rem;
    font-weight: 900; text-transform: uppercase; letter-spacing: 0.08em;
    margin-bottom: 10px;
  }
  .totals .summary-line {
    display: flex; justify-content: space-between;
    padding: 5px 0; font-size: 0.92rem; color: var(--text-muted);
  }
  .totals .summary-line strong {
    font-family: var(--font-display); font-variant-numeric: tabular-nums;
    font-size: 1.05rem; color: var(--text);
  }
  .totals .summary-line.big { border-top: 1px solid var(--border); padding-top: 10px; margin-top: 6px; }
  .totals .summary-line.big strong { font-size: 1.2rem; color: var(--red); }
  .fine { font-size: 0.78rem; color: var(--text-dim); line-height: 1.5; margin-top: 8px; }
  .fine.center { text-align: center; }

  .contact label { text-align: left; }
  .btn.big { padding: 12px 22px; font-size: 0.95rem; }
  .btn.full { width: 100%; justify-content: center; }
  .err {
    background: rgba(192,57,43,0.1); border: 1px solid rgba(192,57,43,0.3);
    color: var(--red); padding: 8px 12px; border-radius: var(--radius);
    font-size: 0.88rem; margin-bottom: 10px;
  }

  .success-card {
    background: #ecfdf5; border: 1px solid #a7f3d0; color: #065f46;
    padding: 24px 28px; border-radius: var(--radius-lg);
    max-width: 640px;
  }
  .success-card h2 {
    font-family: var(--font-display); font-size: 1.4rem;
    font-weight: 900; margin-bottom: 10px; color: #065f46;
  }
  .success-card p { margin-bottom: 10px; }
  .success-card a { color: #065f46; text-decoration: underline; font-weight: 700; }
  .success-card .cta-row { display: flex; gap: 10px; margin-top: 14px; flex-wrap: wrap; }

  .public-footer {
    padding: 24px 28px 36px; text-align: center;
    color: var(--text-muted); font-size: 0.85rem;
    border-top: 1px solid var(--border); background: var(--surface);
  }

  @media (max-width: 900px) {
    .layout { grid-template-columns: 1fr; }
    .sidebar { position: static; }
  }
  @media (max-width: 640px) {
    .public-header { padding: 12px 16px; gap: 12px; }
    .public-nav { display: none; }
    .container { padding: 16px; }
    .lines th, .lines td { padding: 5px 4px; font-size: 0.85rem; }
    .qty-input { width: 56px; }
  }
</style>
