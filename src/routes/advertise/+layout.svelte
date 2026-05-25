<!--
  Shared chrome for every /advertise page. Adds a thin top bar with the
  Holm Graphics brand on the left, and either a "Sign in" button or a
  "My ads · {name}" menu on the right depending on auth state.

  Auth state piggy-backs on the shop's existing $auth store so a customer
  signed in for the DTF store doesn't have to log in again to manage their
  ads, and vice-versa.
-->
<script>
  import { page } from '$app/stores';
  import { auth, isLoggedIn } from '$lib/stores/auth.js';

  $: nextPath = $page.url.pathname;
  $: signInHref = `/login?next=${encodeURIComponent(nextPath || '/advertise')}`;

  function handleLogout() {
    auth.logout();
    // Don't redirect — let them stay on whichever public /advertise page
    // they're on. Booking + display pages don't require auth.
  }
</script>

<nav class="advertise-nav">
  <div class="nav-inner">
    <a href="/advertise/" class="brand">
      <span class="brand-name">HOLM</span>
      <span class="brand-sub">Advertise</span>
    </a>
    <div class="nav-right">
      <a href="/advertise/displays/" class="nav-link">Browse displays</a>
      {#if $isLoggedIn}
        <a href="/advertise/my-ads/" class="nav-link strong">My ads</a>
        <span class="nav-name">{$auth?.name || $auth?.email || ''}</span>
        <button type="button" class="nav-link as-btn" on:click={handleLogout}>Sign out</button>
      {:else}
        <a href={signInHref} class="nav-link strong">Sign in</a>
      {/if}
    </div>
  </div>
</nav>

<slot />

<style>
  .advertise-nav {
    background: var(--surface);
    border-bottom: 1px solid var(--border);
    padding: 0 20px;
  }
  .nav-inner {
    max-width: 1100px;
    margin: 0 auto;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 24px;
    height: 52px;
  }
  .brand {
    display: flex;
    align-items: baseline;
    gap: 6px;
    text-decoration: none;
    color: var(--text);
  }
  .brand-name {
    font-family: var(--font-display);
    font-weight: 800;
    font-size: 1.15rem;
    color: var(--red);
    letter-spacing: 0.04em;
  }
  .brand-sub {
    font-family: var(--font-display);
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-size: 0.75rem;
  }
  .nav-right {
    display: flex;
    align-items: center;
    gap: 18px;
    flex-wrap: wrap;
  }
  .nav-link {
    color: var(--text);
    text-decoration: none;
    font-family: var(--font-display);
    font-size: 0.88rem;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .nav-link:hover { color: var(--red); }
  .nav-link.strong { font-weight: 700; }
  .nav-link.as-btn {
    background: none;
    border: 0;
    cursor: pointer;
    padding: 0;
  }
  .nav-name {
    font-family: var(--font-body);
    color: var(--text-muted);
    font-size: 0.88rem;
  }
</style>
