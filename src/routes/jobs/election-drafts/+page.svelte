<!-- src/routes/jobs/election-drafts/+page.svelte -->
<!--
  Election orders somebody is still filling in.

  FOR THE TELEPHONE. A candidate rings partway through — "I'm on the sign bit
  and I don't know which thickness" — and whoever answers needs their basket on
  screen in the next ten seconds, not a conversation about what they clicked.

  They read out the code shown at the top of their page. If they have lost it,
  they know their own name, so this searches on that and on their phone number.

  These are drafts, not jobs. They are deliberately not on the board: a basket
  somebody is still thinking about would bury the real work. Once they press
  send it becomes an ordinary job and leaves this list.
-->
<script>
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { api } from '$lib/api/client.js';
  import { isStaff } from '$lib/stores/auth.js';

  let drafts = [];
  let search = '';
  let loading = true;
  let error = '';
  let timer = null;

  async function load() {
    loading = true;
    error = '';
    try {
      // The staff client returns undefined rather than throwing when a session
      // has expired — it is busy redirecting to the sign-in page — so this has
      // to cope with nothing coming back rather than reading .length off it.
      drafts = (await api.getElectionDrafts(search.trim())) ?? [];
    } catch (e) {
      error = e.message || 'Could not load the drafts.';
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    if (!$isStaff) { goto('/dashboard'); return; }
    load();
  });

  // Typing a name searches; typing a code jumps straight to it, because a
  // caller reading out eight characters wants the basket, not a list of one.
  function onType() {
    clearTimeout(timer);
    timer = setTimeout(load, 250);
  }

  const looksLikeCode = (s) => /^[A-Z0-9]{8}$/i.test(s.trim());

  function openDraft(code) {
    window.open(`/shop/election?draft=${encodeURIComponent(code)}`, '_blank');
  }

  const when = (iso) =>
    iso ? new Date(iso).toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
</script>

<svelte:head><title>Election drafts — Holm Graphics</title></svelte:head>

<div class="wrap">
  <p class="crumb"><a href="/jobs">← Job board</a></p>
  <h1>Election orders in progress</h1>
  <p class="lede">
    Baskets candidates are still filling in. Ask for the code at the top of their
    screen, or search their name. Opening one shows you exactly what they are
    looking at.
  </p>

  <div class="search-row">
    <input
      bind:value={search}
      on:input={onType}
      placeholder="Code, candidate name, or phone number"
      autocomplete="off"
    />
    {#if looksLikeCode(search)}
      <button class="primary" on:click={() => openDraft(search.trim().toUpperCase())}>
        Open {search.trim().toUpperCase()}
      </button>
    {/if}
  </div>

  {#if error}
    <p class="error">{error}</p>
  {:else if loading}
    <p class="muted">Loading…</p>
  {:else if drafts.length === 0}
    <p class="muted">
      {search ? 'Nothing matching that.' : 'Nobody is part way through an order right now.'}
    </p>
  {:else}
    <table>
      <thead>
        <tr><th>Code</th><th>Candidate</th><th>Where</th><th>Phone</th><th>Last touched</th><th></th></tr>
      </thead>
      <tbody>
        {#each drafts as d}
          <tr>
            <td class="code">{d.code}</td>
            <td>{d.candidate_name || '—'}</td>
            <td class="muted">
              {[d.office, d.municipality].filter(Boolean).join(', ') || '—'}
            </td>
            <td>{d.contact_phone || '—'}</td>
            <td class="muted">{when(d.updated_at)}</td>
            <td><button class="ghost" on:click={() => openDraft(d.code)}>Open</button></td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</div>

<style>
  .wrap { max-width: 62rem; margin: 0 auto; padding: 1.5rem 1rem 4rem; }
  .crumb { margin: 0 0 0.5rem; font-size: 0.85rem; }
  .crumb a { color: #6b7280; text-decoration: none; }
  h1 { margin: 0 0 0.35rem; font-size: 1.6rem; letter-spacing: -0.02em; }
  .lede { margin: 0 0 1.25rem; max-width: 42rem; color: #4b5563; line-height: 1.6; }

  .search-row { display: flex; gap: 0.6rem; margin-bottom: 1.25rem; }
  input {
    flex: 1; max-width: 26rem; padding: 0.5rem 0.65rem;
    border: 1px solid #d1d5db; border-radius: 0.375rem; font: inherit;
  }

  button { font: inherit; cursor: pointer; border-radius: 0.375rem; }
  .primary { background: #111827; color: #fff; border: 0; padding: 0.5rem 1rem; font-weight: 600; }
  .ghost { background: none; border: 1px solid #d1d5db; padding: 0.3rem 0.7rem; font-size: 0.85rem; }

  table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
  th { text-align: left; font-size: 0.75rem; text-transform: uppercase;
       letter-spacing: 0.05em; color: #6b7280; padding: 0 0 0.4rem; }
  td { padding: 0.5rem 0.75rem 0.5rem 0; border-top: 1px solid #f3f4f6; }
  .code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: 0.08em; font-weight: 600; }
  .muted { color: #6b7280; }
  .error { color: #b91c1c; }
</style>
