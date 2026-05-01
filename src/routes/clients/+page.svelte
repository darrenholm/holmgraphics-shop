<!-- src/routes/clients/+page.svelte -->
<!--
  Clients list page. Staff-only (the /api/clients endpoint is requireStaff).

  Search is SERVER-SIDE via /api/clients?search=<q>. The previous version
  client-side-filtered an initial limit:500 payload, which silently
  dropped any client past row 500 alphabetically -- with 3,000+ rows in
  the DB, "sandy" returned 0 results because all 6 actual matches sort
  past Carrie Lynn Weber. Now every keystroke debounces a fresh fetch
  with the full ILIKE WHERE on the API side (company / fname / lname /
  email / phone).

  On mount with no search, we load the first 200 alphabetical rows just
  so the page isn't empty -- staff usually search rather than scroll.
-->
<script>
  import { onMount } from 'svelte';
  import { api } from '$lib/api/client.js';
  import { isStaff } from '$lib/stores/auth.js';

  let clients = [];
  let loading = true;
  let error = '';
  let searchQuery = '';
  let lastFetchedQuery = null;   // tracks what the current `clients` list reflects

  // Add-new form (inline)
  let addingNew = false;
  let newClient = { company: '', first_name: '', last_name: '', email: '' };
  let savingNew = false;

  // Debounced server-side search. A 200ms gap between keystrokes is
  // short enough to feel reactive but long enough to avoid hammering
  // the API on every character.
  let debounceHandle = null;
  $: {
    const q = (searchQuery || '').trim();
    clearTimeout(debounceHandle);
    debounceHandle = setTimeout(() => {
      if (q !== lastFetchedQuery) loadClients(q);
    }, 200);
  }

  onMount(() => loadClients(''));

  async function loadClients(q = '') {
    loading = true; error = '';
    lastFetchedQuery = q;
    const requested = q;
    try {
      // Empty search -> load first 200 alphabetical (just enough to fill
      // the screen; staff will search to find specific rows).
      // With a search -> 200 covers any reasonable term; 200 is well
      // under the API's 1000 cap.
      const opts = q ? { search: q, limit: 200 } : { limit: 200 };
      const result = await api.getClients(opts);
      // Race guard: if the user kept typing while this request was in
      // flight, a slower response could otherwise overwrite a fresher
      // one. Only commit when the query we asked for still matches
      // what's in the search box.
      if (requested === (searchQuery || '').trim()) {
        clients = result;
      }
    } catch (e) {
      // Same guard for errors -- don't surface a stale failure.
      if (requested === (searchQuery || '').trim()) {
        error = e.message || String(e);
      }
    } finally {
      loading = false;
    }
  }

  function displayName(c) {
    return c.company_name
      || [c.first_name, c.last_name].filter(Boolean).join(' ')
      || '(unnamed)';
  }

  // Whatever the server returned IS the result set -- no client-side
  // filtering. `filtered` kept for template compatibility.
  $: filtered = clients;

  async function submitNewClient() {
    if (!newClient.company.trim() && !newClient.last_name.trim()) {
      alert('Company or last name is required.');
      return;
    }
    savingNew = true;
    try {
      const { id } = await api.createClient(newClient);
      // Reload so the new row lands in the list and sort order is correct.
      await loadClients();
      newClient = { company: '', first_name: '', last_name: '', email: '' };
      addingNew = false;
      if (id) window.location.href = `/clients/${id}`;
    } catch (e) {
      alert(e.message);
    } finally {
      savingNew = false;
    }
  }
</script>

<svelte:head><title>Clients · Holm Graphics</title></svelte:head>

<div class="page">
  <div class="page-head">
    <h1 class="page-title">Clients</h1>
    {#if $isStaff && !addingNew}
      <button class="btn btn-primary" on:click={() => addingNew = true}>+ New client</button>
    {/if}
  </div>

  {#if addingNew}
    <div class="card">
      <h2 class="card-title">New client</h2>
      <div class="form-row">
        <label>Company<input bind:value={newClient.company} placeholder="Acme Signs Inc." /></label>
        <label>First name<input bind:value={newClient.first_name} /></label>
        <label>Last name<input bind:value={newClient.last_name} /></label>
        <label>Email<input type="email" bind:value={newClient.email} /></label>
      </div>
      <div class="form-actions">
        <button class="btn btn-primary" on:click={submitNewClient} disabled={savingNew}>
          {savingNew ? 'Saving…' : 'Create client'}
        </button>
        <button class="btn btn-ghost" on:click={() => { addingNew = false; newClient = { company:'', first_name:'', last_name:'', email:'' }; }}>Cancel</button>
      </div>
    </div>
  {/if}

  <div class="search-bar">
    <input
      type="search"
      placeholder="Search by company, name, email, or phone…"
      bind:value={searchQuery}
      autocomplete="off"
    />
    <span class="count">
      {#if loading}
        Searching…
      {:else if searchQuery.trim()}
        {filtered.length} {filtered.length === 1 ? 'result' : 'results'}{#if filtered.length === 200}+{/if}
      {:else}
        Showing first {filtered.length} {filtered.length === 1 ? 'client' : 'clients'} (alphabetical) — type to search all
      {/if}
    </span>
  </div>

  {#if loading}
    <p class="empty-msg">Loading clients…</p>
  {:else if error}
    <p class="empty-msg" style="color:#dc2626">⚠ {error}</p>
  {:else if clients.length === 0}
    <p class="empty-msg">No clients yet. Click “New client” above to create one.</p>
  {:else if filtered.length === 0}
    <p class="empty-msg">No matches for “{searchQuery}”.</p>
  {:else}
    <div class="card">
      <table class="clients-table">
        <thead>
          <tr>
            <th>Client</th>
            <th>Email</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {#each filtered as c}
            <tr>
              <td>
                <a class="client-link" href={`/clients/${c.id}`}>
                  <span class="client-name">{displayName(c)}</span>
                  {#if c.company_name && (c.first_name || c.last_name)}
                    <span class="client-sub">{[c.first_name, c.last_name].filter(Boolean).join(' ')}</span>
                  {/if}
                </a>
              </td>
              <td class="mono">{c.email || '—'}</td>
              <td class="row-actions">
                <a class="btn btn-ghost btn-sm" href={`/clients/${c.id}`}>Open</a>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>

<style>
  .page { padding: 28px 32px; }

  .page-head {
    display: flex; justify-content: space-between; align-items: center;
    margin-bottom: 18px; gap: 16px;
  }
  .page-title {
    font-family: var(--font-display); font-size: 1.7rem; font-weight: 900;
    letter-spacing: 0.03em; margin: 0; color: var(--text);
  }

  .card {
    background: var(--surface-1, #fff);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 16px 18px;
    margin-bottom: 16px;
  }
  .card-title {
    font-family: var(--font-display); font-size: 0.9rem;
    letter-spacing: 0.06em; text-transform: uppercase;
    color: var(--text-muted); margin: 0 0 12px;
  }

  .form-row {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px 14px;
  }
  .form-row label {
    display: flex; flex-direction: column; gap: 4px;
    font-size: 0.78rem; color: var(--text-muted);
  }
  .form-row input {
    padding: 6px 8px; border: 1px solid var(--border); border-radius: 4px;
    font-size: 0.9rem; background: var(--surface-1, #fff); color: var(--text);
  }
  .form-actions { display: flex; gap: 8px; margin-top: 12px; }

  .search-bar {
    display: flex; align-items: center; gap: 12px; margin-bottom: 12px;
  }
  .search-bar input {
    flex: 1; padding: 8px 12px; border: 1px solid var(--border); border-radius: 6px;
    background: var(--surface-1, #fff); color: var(--text); font-size: 0.95rem;
  }
  .search-bar .count {
    font-size: 0.8rem; color: var(--text-muted); font-variant-numeric: tabular-nums;
  }

  .clients-table { width: 100%; border-collapse: collapse; }
  .clients-table th {
    text-align: left; font-family: var(--font-display);
    font-size: 0.75rem; letter-spacing: 0.06em; text-transform: uppercase;
    color: var(--text-muted); padding: 8px 10px;
    border-bottom: 1px solid var(--border);
  }
  .clients-table td {
    padding: 10px;
    border-bottom: 1px dotted var(--border);
    vertical-align: middle;
  }
  .clients-table tr:last-child td { border-bottom: none; }
  .clients-table tr:hover td { background: var(--surface-2, #f7f7f9); }

  .client-link {
    display: flex; flex-direction: column; gap: 2px;
    color: var(--text); text-decoration: none;
  }
  .client-link:hover { color: var(--red); }
  .client-name { font-weight: 600; }
  .client-sub { font-size: 0.8rem; color: var(--text-muted); }

  .row-actions { text-align: right; width: 90px; }

  .mono { font-family: var(--font-mono, monospace); font-size: 0.88rem; }

  .btn-sm { padding: 3px 10px; font-size: 0.78rem; }

  .empty-msg { color: var(--text-muted); font-size: 0.9rem; padding: 16px 0; }
</style>
