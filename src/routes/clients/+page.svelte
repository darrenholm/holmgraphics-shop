<!-- src/routes/clients/+page.svelte -->
<!--
  Clients list page. Staff-only (the /api/clients endpoint is requireStaff).

  Loads up to 500 clients on first paint so typical search feels instant —
  filter happens client-side against company / first / last / email. If the
  table ever pushes past a few thousand rows this can switch to server-side
  ?search= via the same endpoint.
-->
<script>
  import { onMount } from 'svelte';
  import { api } from '$lib/api/client.js';
  import { isStaff } from '$lib/stores/auth.js';

  let clients = [];
  let loading = true;
  let error = '';
  let searchQuery = '';

  // Add-new form (inline)
  let addingNew = false;
  let newClient = { company: '', first_name: '', last_name: '', email: '' };
  let savingNew = false;

  onMount(loadClients);

  async function loadClients() {
    loading = true; error = '';
    try {
      clients = await api.getClients({ limit: 500 });
    } catch (e) {
      error = e.message || String(e);
    } finally {
      loading = false;
    }
  }

  function displayName(c) {
    return c.company_name
      || [c.first_name, c.last_name].filter(Boolean).join(' ')
      || '(unnamed)';
  }

  $: filtered = (() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return clients;
    return clients.filter(c =>
      (c.company_name || '').toLowerCase().includes(q) ||
      (c.first_name   || '').toLowerCase().includes(q) ||
      (c.last_name    || '').toLowerCase().includes(q) ||
      (c.email        || '').toLowerCase().includes(q)
    );
  })();

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
      placeholder="Search by company, name, or email…"
      bind:value={searchQuery}
      autocomplete="off"
    />
    <span class="count">
      {filtered.length}{filtered.length !== clients.length ? ` of ${clients.length}` : ''}
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
