<!--
  /shop/cart — Holm Graphics decoration builder.

  Step 8 swapped the old jargon-y cart (now at /shop/cart-legacy) over to
  this visual builder. Buyers:
    1. Pick garments + sizes (SizeGrid; imported from $dtfCart on first load)
    2. Click hotspots on the garment SVG, upload artwork or defer it
       (HotspotPicker per line item, RosterGrid when a back-of-jersey
        location is selected)
    3. Enter contact info, click Submit for proof
    4. Wait for an emailed proof, click the link in the email to approve
       (/shop/builder/proof/[token]) and pay via the QBO link.

  Persistence: a draft is created on mount and auto-PATCHed (debounced 600ms)
  on any state change. The session token + draft id live in localStorage so
  the buyer can leave and resume on the same device.

  Decoration mode is fixed to 'per_garment' for v1 — buyers with mixed
  garments configure each one. A 'uniform' mode (single picker applied to
  everything) is a follow-up.
-->
<script>
  import { onMount } from 'svelte';
  import { dtfCart, isEmpty } from '$lib/stores/dtf-cart.js';
  import { customer } from '$lib/stores/customer-auth.js';
  import SizeGrid from '$lib/components/builder/SizeGrid.svelte';
  import HotspotPicker from '$lib/components/builder/HotspotPicker.svelte';
  import RosterGrid from '$lib/components/builder/RosterGrid.svelte';
  import * as builderApi from '$lib/api/builder-client.js';

  // ── Config + state ──────────────────────────────────────────────────────
  let config = null;
  let configError = '';

  let lineItems = [];
  let decorationMode = 'per_garment';  // 'uniform' future

  let draftId = null;
  let sessionToken = null;
  let draftError = '';
  let draftSavingHint = '';

  let contactEmail = '';
  let contactName  = '';
  let contactPhone = '';

  let submitError = '';
  let submitting = false;
  let submitted = false;
  let submittedAt = '';

  // ── Cart → line items ───────────────────────────────────────────────────
  // The catalog's garment_category is the strong signal; fall back to a
  // product-name heuristic for items where the category is missing or
  // wrong (e.g. cap mis-tagged as 'apparel' in the supplier feed). Buyer
  // can override per-line in the picker if both signals are wrong.
  function inferFamily(category, productName) {
    if ((category || '').toLowerCase() === 'headwear') return 'hat';
    const n = (productName || '').toLowerCase();
    if (/\b(cap|hat|snapback|trucker|beanie|visor|fitted|flexfit|richardson)\b/.test(n)) return 'hat';
    if (/\b(hood|hoody|hoodie|pullover)\b/.test(n)) return 'hoodie';
    return 'tee';
  }

  function cartToLineItems(cartItems) {
    const groups = new Map();
    for (const it of cartItems || []) {
      const key = `${it.supplier}|${it.style}|${it.color_name}`;
      if (!groups.has(key)) {
        groups.set(key, {
          id:            key,
          label:         `${it.product_name || it.style} · ${it.color_name}`,
          family:        inferFamily(it.garment_category, it.product_name),
          color_hex:     it.color_hex,
          unit_price:    Number(it.unit_price) || 0,
          sizes_offered: [],
          size_grid:     [],
          locations:     [],
          roster:        []
        });
      }
      const g = groups.get(key);
      g.size_grid.push({ size: it.size, quantity: Number(it.quantity) || 0 });
      if (!g.sizes_offered.includes(it.size)) g.sizes_offered.push(it.size);
    }
    return [...groups.values()];
  }

  // ── Init ────────────────────────────────────────────────────────────────
  onMount(async () => {
    if ($customer) {
      contactEmail = $customer.email || '';
      contactName  = [$customer.fname, $customer.lname].filter(Boolean).join(' ').trim();
      contactPhone = $customer.phone || '';
    }

    try {
      const r = await fetch('/garments/families.json');
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      config = await r.json();
    } catch (e) {
      configError = e.message;
    }

    const importedFromCart = cartToLineItems($dtfCart.items);
    lineItems = importedFromCart;

    // Try to resume an existing draft session
    const stored = builderApi.readSession();
    if (stored) {
      try {
        const draft = await builderApi.loadDraft(stored.draftId, stored.sessionToken);
        if (draft && draft.status === 'draft') {
          draftId = stored.draftId;
          sessionToken = stored.sessionToken;
          if (draft.state && Array.isArray(draft.state.line_items) && draft.state.line_items.length > 0) {
            lineItems = draft.state.line_items;
            decorationMode = draft.state.decoration_mode || 'per_garment';
          }
          contactEmail = draft.contact_email || contactEmail;
          contactName  = draft.contact_name  || contactName;
          contactPhone = draft.contact_phone || contactPhone;
          return;
        }
        // Submitted/abandoned: start fresh
        builderApi.clearSession();
      } catch (e) {
        builderApi.clearSession();
      }
    }

    try {
      const created = await builderApi.createDraft({
        decoration_mode: decorationMode,
        line_items:      lineItems
      });
      draftId = created.id;
      sessionToken = created.session_token;
    } catch (e) {
      draftError = `Couldn't start a draft on the server: ${e.message}. You can still build below — changes will save once we reconnect.`;
    }
  });

  // ── Debounced auto-save ─────────────────────────────────────────────────
  let patchTimer = null;
  $: if (draftId && sessionToken && !submitted) schedulePatch(lineItems, decorationMode, contactEmail, contactName, contactPhone);

  function schedulePatch(..._deps) {
    clearTimeout(patchTimer);
    draftSavingHint = 'Saving…';
    patchTimer = setTimeout(savePatch, 600);
  }

  async function savePatch() {
    if (!draftId || !sessionToken) return;
    try {
      await builderApi.patchDraft(draftId, sessionToken, {
        state:         { decoration_mode: decorationMode, line_items: lineItems },
        contact_email: contactEmail,
        contact_name:  contactName,
        contact_phone: contactPhone
      });
      draftError = '';
      draftSavingHint = 'Saved';
    } catch (e) {
      draftError = `Couldn't save: ${e.message}`;
      draftSavingHint = '';
    }
  }

  // ── Submit for proof ───────────────────────────────────────────────────
  async function submit() {
    if (submitting) return;
    submitError = '';
    if (!contactEmail.trim()) { submitError = 'Email is required so we can send you the proof.'; return; }
    if (totalPcs === 0)        { submitError = 'Add at least one garment quantity.'; return; }
    // Block submit if any back-of-jersey location has no roster names at all
    for (const li of lineItems) {
      const needsRoster = (li.locations || []).some((l) => l.supports_roster);
      if (needsRoster) {
        const filled = (li.roster || []).filter((r) => (r.name && r.name.trim()) || (r.number && String(r.number).trim())).length;
        if (filled === 0) {
          submitError = `Add at least one player name on "${li.label}", or remove the back-of-jersey location.`;
          return;
        }
      }
    }

    clearTimeout(patchTimer);
    await savePatch();
    submitting = true;
    try {
      const res = await builderApi.submitDraft(draftId, sessionToken, {
        contact_email: contactEmail.trim(),
        contact_name:  contactName.trim() || null,
        contact_phone: contactPhone.trim() || null
      });
      submitted = true;
      submittedAt = res.submitted_at || new Date().toISOString();
      builderApi.clearSession();
      // Leave $dtfCart untouched — the buyer might want to start a second
      // order from the same items. If that turns out to be confusing in
      // practice, clear it here.
    } catch (e) {
      submitError = e.message;
    } finally {
      submitting = false;
    }
  }

  // ── Derived totals ─────────────────────────────────────────────────────
  $: garmentSubtotal = lineItems.reduce((acc, li) => {
    const qty = (li.size_grid || []).reduce((a, g) => a + (Number(g.quantity) || 0), 0);
    return acc + qty * (Number(li.unit_price) || 0);
  }, 0);

  $: decorationSubtotal = lineItems.reduce((acc, li) => {
    const qty = (li.size_grid || []).reduce((a, g) => a + (Number(g.quantity) || 0), 0);
    const perItem = (li.locations || []).reduce((a, l) => a + (Number(l.unit_price) || 0), 0);
    return acc + qty * perItem;
  }, 0);

  $: totalPcs  = lineItems.reduce((acc, li) => acc + (li.size_grid || []).reduce((a, g) => a + (Number(g.quantity) || 0), 0), 0);
  $: subtotal  = garmentSubtotal + decorationSubtotal;
  $: deferredArtworkCount = lineItems.reduce((acc, li) =>
       acc + (li.locations || []).filter((l) => l.artwork_deferred).length, 0);
  $: missingArtworkCount = lineItems.reduce((acc, li) =>
       acc + (li.locations || []).filter((l) => !l.artwork_file_url && !l.artwork_deferred).length, 0);

  const money = (n) =>
    n == null ? '—' : new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(n);

  function familyConfig(family) {
    return (config && config[family]) ? config[family] : null;
  }
  function rosterExpectedRows(li) {
    return (li.size_grid || []).reduce((a, g) => a + (Number(g.quantity) || 0), 0);
  }
  function hasRosterLocation(li) {
    return (li.locations || []).some((l) => l.supports_roster);
  }
  function handleSizeGridRemove(e) {
    lineItems = lineItems.filter((li) => li.id !== e.detail.id);
  }

  // Buyer-driven family override. Family-specific data (locations,
  // roster) gets cleared on switch since hotspot_keys are namespaced by
  // family — confirm if there's existing work to preserve.
  function changeFamily(li, newFamily) {
    if (!newFamily || newFamily === li.family) return;
    const hasWork = (li.locations || []).length > 0 || (li.roster || []).some((r) => (r.name && r.name.trim()) || (r.number && String(r.number).trim()));
    if (hasWork && typeof window !== 'undefined') {
      const ok = window.confirm(`Switching this garment to a different type will clear the decoration locations${(li.roster || []).length ? ' and roster' : ''} on this line. Continue?`);
      if (!ok) return;
    }
    li.family = newFamily;
    li.locations = [];
    li.roster    = [];
    lineItems = lineItems;
  }

  $: availableFamilies = config
    ? Object.keys(config).filter((k) => !k.startsWith('_') && !k.startsWith('$') && k !== 'pricing')
    : [];

  // Deduped list of artwork files already uploaded anywhere in the draft.
  // Passed to each picker so the buyer can reuse a logo across line items
  // (e.g. front logo on both tees and hats) without re-uploading.
  $: existingDesigns = (() => {
    const seen = new Map();
    for (const li of lineItems) {
      for (const loc of (li.locations || [])) {
        if (loc.artwork_file_url && loc.artwork_file_name && !seen.has(loc.artwork_file_url)) {
          seen.set(loc.artwork_file_url, {
            url:  loc.artwork_file_url,
            name: loc.artwork_file_name,
            size: loc.artwork_file_size || 0
          });
        }
      }
    }
    return [...seen.values()];
  })();
</script>

<svelte:head><title>Build your order — Holm Graphics</title></svelte:head>

<div class="builder">
  {#if submitted}
    <section class="submitted-card">
      <div class="check-circle" aria-hidden="true">✓</div>
      <h1>Your order is in for review</h1>
      <p>Thanks{contactName ? `, ${contactName.split(' ')[0]}` : ''}. We'll generate a proof and email it to
        <strong>{contactEmail}</strong> — usually within one business day.</p>
      <p class="muted small">Reference: <code>{draftId}</code></p>
      <div class="submitted-actions">
        <a class="btn outline" href="/shop">Keep shopping</a>
      </div>
    </section>
  {:else}
    <header class="builder-header">
      <h1>Build your order</h1>
      <p class="hint">
        Pick garments, click placements, drop your artwork. We'll send a proof
        to your inbox before any payment.
      </p>
      <p class="hint small legacy-link">
        Prefer the old cart? <a href="/shop/cart-legacy">Use the legacy cart →</a>
      </p>
    </header>

    {#if draftError}<p class="alert error">{draftError}</p>{/if}
    {#if configError}<p class="alert error">Couldn't load garment config: {configError}</p>{/if}

    <div class="layout">
      <main class="main-col">
        <!-- ─── 1. Garments & sizes ────────────────────────────────────── -->
        <section class="step-section">
          <h2><span class="step-num">1</span> Garments &amp; sizes</h2>

          {#if $isEmpty && lineItems.length === 0}
            <div class="empty-cart">
              <p>Your cart is empty.</p>
              <a class="btn" href="/shop">Browse the catalog →</a>
            </div>
          {:else}
            <SizeGrid bind:lineItems on:remove={handleSizeGridRemove} />
            <div class="actions">
              <a class="btn outline" href="/shop">+ Add garment from catalog</a>
            </div>
          {/if}
        </section>

        <!-- ─── 2. Decoration ─────────────────────────────────────────── -->
        {#if lineItems.length > 0 && config}
          <section class="step-section">
            <h2><span class="step-num">2</span> Decoration locations</h2>

            {#each lineItems as li, i (li.id)}
              {@const fam = familyConfig(li.family)}
              <article class="line-block">
                <header class="line-head">
                  {#if li.color_hex}<span class="swatch" style="background:{li.color_hex}"></span>{/if}
                  <strong>{li.label}</strong>
                  <span class="muted small">·  {(li.size_grid || []).reduce((a,g)=>a+(Number(g.quantity)||0),0)} pcs</span>
                  <label class="family-select-wrap" title="Wrong garment type? Switch here.">
                    <span class="visually-hidden">Garment type</span>
                    <select
                      class="family-select"
                      value={li.family}
                      on:change={(e) => changeFamily(li, e.target.value)}>
                      {#each availableFamilies as f}
                        <option value={f}>{config[f].label}</option>
                      {/each}
                    </select>
                  </label>
                </header>

                {#if fam}
                  <HotspotPicker
                    familyKey={li.family}
                    family={fam}
                    pricing={config.pricing}
                    {existingDesigns}
                    bind:locations={li.locations} />
                  {#if hasRosterLocation(li)}
                    <div class="roster-wrap">
                      <RosterGrid
                        bind:roster={li.roster}
                        expectedRows={rosterExpectedRows(li)}
                        sizeBreakdown={li.size_grid}
                        offeredSizes={li.sizes_offered} />
                    </div>
                  {/if}
                {:else}
                  <p class="hint small fallback">
                    Decoration for <strong>{li.family}</strong> isn't in the visual builder yet —
                    we'll arrange the layout by email after you submit.
                  </p>
                {/if}
              </article>
            {/each}
          </section>
        {/if}

        <!-- ─── 3. Contact + submit ─────────────────────────────────────── -->
        {#if lineItems.length > 0}
          <section class="step-section">
            <h2><span class="step-num">3</span> Where do we send the proof?</h2>
            <div class="contact-grid">
              <label>
                <span>Email <em class="req">*</em></span>
                <input type="email" bind:value={contactEmail} placeholder="you@example.com" required />
              </label>
              <label>
                <span>Name</span>
                <input type="text" bind:value={contactName} placeholder="First last / team name" />
              </label>
              <label>
                <span>Phone (optional)</span>
                <input type="tel" bind:value={contactPhone} placeholder="519-555-0100" />
              </label>
            </div>

            {#if missingArtworkCount > 0 || deferredArtworkCount > 0}
              <div class="artwork-summary">
                {#if missingArtworkCount > 0}
                  <p class="alert warn">
                    <strong>{missingArtworkCount}</strong> location{missingArtworkCount === 1 ? '' : 's'}
                    {missingArtworkCount === 1 ? 'has' : 'have'} no artwork.
                    Upload or mark as "I'll send it later" on each.
                  </p>
                {/if}
                {#if deferredArtworkCount > 0}
                  <p class="alert info">
                    {deferredArtworkCount} location{deferredArtworkCount === 1 ? '' : 's'} will follow by email — we'll prompt you after submit.
                  </p>
                {/if}
              </div>
            {/if}

            {#if submitError}<p class="alert error">{submitError}</p>{/if}

            <div class="submit-row">
              <button class="btn primary big" on:click={submit} disabled={submitting || missingArtworkCount > 0}>
                {submitting ? 'Submitting…' : 'Submit for proof →'}
              </button>
              <span class="hint small">No payment now — pay after you approve the proof.</span>
            </div>
          </section>
        {/if}
      </main>

      <!-- ─── Summary sidebar ───────────────────────────────────────────── -->
      <aside class="summary">
        <h2>Order summary</h2>
        <div class="row"><span>Garments</span><span>{money(garmentSubtotal)}</span></div>
        <div class="row"><span>Decoration</span><span>{money(decorationSubtotal)}</span></div>
        <div class="row sub"><span>Subtotal</span><span>{money(subtotal)}</span></div>
        <p class="muted small">{totalPcs} piece{totalPcs === 1 ? '' : 's'}. Shipping &amp; tax confirmed when you pay.</p>

        {#if draftSavingHint && !submitted}
          <p class="saving small" class:saved={draftSavingHint === 'Saved'}>
            {draftSavingHint === 'Saved' ? '✓ Saved' : draftSavingHint}
          </p>
        {/if}
      </aside>
    </div>
  {/if}
</div>

<style>
  .builder { max-width: 76rem; margin: 0 auto; padding: 2rem 1rem 4rem; }

  .builder-header { margin-bottom: 1.5rem; }
  .builder-header h1 { margin: 0 0 0.25rem; }
  .hint { color: #666; font-size: 0.95rem; margin: 0; }
  .small { font-size: 0.85rem; }
  .muted { color: #888; }
  .legacy-link { margin-top: 0.4rem; }
  .legacy-link a { color: #666; }

  .layout { display: grid; grid-template-columns: 1fr 22rem; gap: 1.5rem; align-items: start; }
  @media (max-width: 900px) { .layout { grid-template-columns: 1fr; } }
  .main-col { display: flex; flex-direction: column; gap: 2rem; }

  .step-section h2 {
    font-size: 1.1rem; margin: 0 0 0.85rem;
    display: flex; align-items: center; gap: 0.55rem;
  }
  .step-num {
    display: inline-flex; align-items: center; justify-content: center;
    width: 1.6rem; height: 1.6rem; border-radius: 50%;
    background: #c01818; color: white;
    font-size: 0.85rem; font-weight: 700;
  }

  .actions { margin-top: 0.75rem; }

  .empty-cart {
    text-align: center; padding: 2.5rem 1rem;
    background: #fafafa; border: 1px dashed #e4e4e7; border-radius: 0.5rem;
  }
  .empty-cart p { margin: 0 0 0.85rem; color: #555; }

  .line-block {
    background: white; border: 1px solid #e4e4e7; border-radius: 0.6rem;
    padding: 1rem 1.1rem; margin-bottom: 1rem;
  }
  .line-head {
    display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;
    margin-bottom: 0.75rem;
    padding-bottom: 0.5rem; border-bottom: 1px dashed #eee;
  }
  .swatch { display: inline-block; width: 1rem; height: 1rem; border-radius: 0.2rem; border: 1px solid #ddd; }
  .family-select-wrap { margin-left: auto; }
  .family-select {
    padding: 0.25rem 0.5rem; border: 1px solid #d4d4d8; border-radius: 0.3rem;
    background: white; font-size: 0.85rem; color: #444; cursor: pointer;
  }
  .family-select:focus { outline: 2px solid #c01818; outline-offset: 1px; border-color: transparent; }
  .visually-hidden {
    position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
    overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0;
  }
  .roster-wrap { margin-top: 1rem; }

  .fallback { padding: 0.75rem 1rem; background: #fafafa; border-radius: 0.4rem; }

  .contact-grid {
    display: grid; grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
    gap: 0.75rem; margin-bottom: 0.85rem;
  }
  .contact-grid label { display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.9rem; color: #444; }
  .contact-grid input {
    padding: 0.55rem 0.7rem; border: 1px solid #d4d4d8; border-radius: 0.35rem;
    font-size: 0.95rem;
  }
  .contact-grid input:focus { outline: 2px solid #c01818; outline-offset: 1px; border-color: transparent; }
  .req { color: #c01818; font-style: normal; }

  .artwork-summary { margin-bottom: 0.85rem; }

  .alert { padding: 0.55rem 0.85rem; border-radius: 0.35rem; margin: 0 0 0.5rem; font-size: 0.9rem; }
  .alert.error { background: #fee; color: #b00; }
  .alert.warn  { background: #fff8e0; color: #885; }
  .alert.info  { background: #f0f7ff; color: #2a5680; }

  .submit-row { display: flex; align-items: center; gap: 0.85rem; flex-wrap: wrap; margin-top: 1rem; }

  .btn {
    display: inline-block; padding: 0.7rem 1.25rem; background: #c01818; color: white;
    border: none; border-radius: 0.4rem; font-weight: 600; text-decoration: none; cursor: pointer;
    font-size: 0.95rem;
  }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn.outline { background: transparent; color: #c01818; border: 1px solid #c01818; padding: 0.55rem 1rem; }
  .btn.primary { background: #c01818; }
  .btn.big { padding: 0.9rem 1.6rem; font-size: 1rem; }

  .summary {
    background: #fafafa; border: 1px solid #e4e4e7; border-radius: 0.5rem;
    padding: 1.1rem 1.25rem; position: sticky; top: 1rem;
  }
  .summary h2 { font-size: 1rem; margin: 0 0 0.6rem; }
  .summary .row { display: flex; justify-content: space-between; padding: 0.3rem 0; }
  .summary .row.sub { padding-top: 0.6rem; margin-top: 0.4rem; border-top: 1px solid #ddd; font-weight: 700; font-size: 1.05rem; }
  .saving { margin: 0.85rem 0 0; color: #888; }
  .saving.saved { color: #1f6b34; }

  .submitted-card {
    max-width: 38rem; margin: 4rem auto 0;
    background: white; border: 1px solid #c4e7d2; border-radius: 0.6rem;
    padding: 2rem 2.25rem; text-align: center;
  }
  .submitted-card h1 { margin: 0.5rem 0 0.5rem; }
  .submitted-card p { margin: 0.25rem 0; color: #444; }
  .submitted-card code { background: #f5f5f5; padding: 0.1rem 0.4rem; border-radius: 0.2rem; font-size: 0.85rem; }
  .submitted-actions { margin-top: 1.25rem; }
  .check-circle {
    display: inline-flex; align-items: center; justify-content: center;
    width: 3rem; height: 3rem; border-radius: 50%;
    background: #1f6b34; color: white;
    font-size: 1.5rem;
  }
</style>
