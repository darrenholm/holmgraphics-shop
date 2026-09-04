<!-- src/lib/components/AccountPicker.svelte
     Type-to-search picker for a QuickBooks expense account.

     Replaces a native <select>, whose type-ahead only matches from the first
     character. Accounts are labelled with their fully-qualified name, so
     "Cost of Goods Sold:Shipping" never matched someone typing "shipping" —
     the one word they actually know.

     Matching is a substring anywhere in the name, with leaf-segment hits
     ranked first: typing "shipping" puts ...:Shipping above "Shipping
     Supplies Expense", because the account you name exactly is nearly always
     the one you meant. -->
<script>
  import { createEventDispatcher, tick } from 'svelte';
  import { filterAccounts } from '$lib/ap/account-filter.js';

  export let accounts    = [];
  export let accountId   = null;
  export let accountName = null;
  export let disabled    = false;
  export let placeholder = 'Search accounts…';

  const dispatch = createEventDispatcher();

  let query     = '';
  let open      = false;
  let highlight = 0;
  let inputEl;
  let rootEl;

  // What the closed input shows. A stored account missing from the list —
  // renamed or deactivated in QuickBooks — still displays its stored name
  // rather than going blank, which would look like the line was never coded.
  $: display = accountName || (accountId ? `Account ${accountId}` : '');

  $: filtered = filterAccounts(accounts, query);

  async function toggle() {
    if (disabled) return;
    if (open) { open = false; return; }
    open = true;
    query = '';
    highlight = 0;
    await tick();
    if (inputEl) inputEl.focus();
  }

  function choose(account) {
    accountId   = account ? account.id : null;
    accountName = account ? account.name : null;
    open = false;
    query = '';
    dispatch('change', { id: accountId, name: accountName });
  }

  function onKeydown(event) {
    if (event.key === 'Escape')       { open = false; return; }
    if (event.key === 'ArrowDown')    { event.preventDefault(); highlight = Math.min(highlight + 1, filtered.length - 1); return; }
    if (event.key === 'ArrowUp')      { event.preventDefault(); highlight = Math.max(highlight - 1, 0); return; }
    if (event.key === 'Enter') {
      event.preventDefault();
      // Enter on an empty search with nothing highlighted must not silently
      // pick the first account in the chart of accounts.
      if (filtered[highlight]) choose(filtered[highlight]);
      return;
    }
  }

  // Close when focus leaves the whole control. relatedTarget is the element
  // gaining focus, so clicking an option inside does not count as leaving.
  function onFocusOut(event) {
    if (rootEl && rootEl.contains(event.relatedTarget)) return;
    open = false;
  }

  $: if (query !== undefined) highlight = 0;
</script>

<!-- The trigger stays mounted while the panel is open. Swapping it out for
     the search box destroyed the focused element, which fired focusout with
     no relatedTarget and closed the panel in the same tick it opened — the
     dropdown appeared not to open at all. -->
<div class="picker" bind:this={rootEl} on:focusout={onFocusOut}>
  <button
    type="button"
    class="current"
    class:uncoded={!accountId}
    class:open
    on:click={toggle}
    {disabled}
    title={display || 'Uncoded'}
  >
    {display || '— uncoded —'}
  </button>

  {#if open}
    <div class="panel">
      <input
        class="search"
        type="text"
        bind:this={inputEl}
        bind:value={query}
        {placeholder}
        on:keydown={onKeydown}
        autocomplete="off"
      />
      <ul class="options" role="listbox">
        {#if accountId}
          <li>
            <button type="button" class="opt clear" on:click={() => choose(null)}>
              — uncoded —
            </button>
          </li>
        {/if}
        {#each filtered as a, i (a.id)}
          <li>
            <button
              type="button"
              class="opt"
              class:highlighted={i === highlight}
              on:click={() => choose(a)}
              on:mouseenter={() => (highlight = i)}
            >
              {a.name}
            </button>
          </li>
        {:else}
          <li class="empty">No account matches “{query}”</li>
        {/each}
      </ul>
    </div>
  {/if}
</div>

<style>
  .picker { position: relative; }

  .current, .search {
    width: 100%; box-sizing: border-box; font: inherit;
    background: var(--input-bg, rgba(0,0,0,0.2)); color: var(--text);
    border: 1px solid var(--border); border-radius: var(--radius);
    padding: 6px 8px; font-size: 0.86rem;
  }
  .current {
    text-align: left; cursor: pointer;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .current:disabled { opacity: 0.6; cursor: not-allowed; }
  /* Uncoded is not an error — the line still posts to the default account —
     but it should be obvious before approving. */
  .current.uncoded { color: var(--amber, #e0a458); }

  .current.open { border-color: var(--text-muted); }

  .panel {
    position: absolute; z-index: 20; left: 0; top: 100%;
    margin-top: 2px; padding: 4px;
    min-width: 100%; width: max-content; max-width: 380px;
    background: var(--surface); border: 1px solid var(--border);
    border-radius: var(--radius);
    box-shadow: 0 8px 24px rgba(0,0,0,0.35);
  }
  .panel .search { margin-bottom: 4px; }

  .options {
    margin: 0; padding: 0; list-style: none;
    max-height: 240px; overflow-y: auto;
  }
  .opt {
    display: block; width: 100%; text-align: left; font: inherit;
    font-size: 0.86rem; padding: 6px 8px; border: 0; border-radius: 4px;
    background: transparent; color: var(--text); cursor: pointer;
  }
  .opt.highlighted { background: rgba(255,255,255,0.08); }
  .opt.clear { color: var(--text-muted); font-style: italic; }
  .empty { padding: 8px; color: var(--text-muted); font-size: 0.85rem; }
</style>
