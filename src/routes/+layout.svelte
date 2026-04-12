<!-- src/routes/+layout.svelte -->
<script>
  import '../lib/styles/global.css';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import { auth, isStaff } from '$lib/stores/auth.js';

  const publicRoutes = ['/login'];

  onMount(() => {
    if (!publicRoutes.includes($page.url.pathname) && !$auth) {
      goto('/login');
    }
  });

  $: onPage = (path) => $page.url.pathname.startsWith(path);
</script>

{#if publicRoutes.includes($page.url.pathname)}
  <slot />
{:else if $auth}
  <div class="shell">

    <!-- Desktop sidebar -->
    <nav class="sidebar">
      <div class="sidebar-logo">
        <span class="logo-text">HOLM</span>
        <span class="logo-sub">GRAPHICS</span>
      </div>

      <ul class="nav-links">
        <li>
          <a href="/dashboard" class:active={onPage('/dashboard')}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
            Job Board
          </a>
        </li>
        {#if $isStaff}
        <li>
          <a href="/jobs/new" class:active={onPage('/jobs/new')}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
            New Job
          </a>
        </li>
        {/if}
      </ul>

      <div class="sidebar-footer">
        <div class="user-chip">
          <div class="user-avatar">{$auth.name?.[0]?.toUpperCase() || '?'}</div>
          <div class="user-info">
            <span class="user-name">{$auth.name}</span>
            <span class="user-role">{$auth.role}</span>
          </div>
        </div>
        <button class="logout-btn" on:click={() => { auth.logout(); goto('/login'); }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
        </button>
      </div>
    </nav>

    <!-- Mobile top bar -->
    <header class="mobile-header">
      <span class="mobile-logo">HOLM <span>GRAPHICS</span></span>
      <div class="mobile-user">
        <span class="user-avatar-sm">{$auth.name?.[0]?.toUpperCase() || '?'}</span>
        <button class="logout-btn-sm" on:click={() => { auth.logout(); goto('/login'); }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
        </button>
      </div>
    </header>

    <main class="main-content">
      <slot />
    </main>

    <!-- Mobile bottom nav -->
    <nav class="mobile-nav">
      <a href="/dashboard" class="mobile-nav-item" class:active={onPage('/dashboard')}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
        <span>Jobs</span>
      </a>
      {#if $isStaff}
      <a href="/jobs/new" class="mobile-nav-item mobile-nav-center" class:active={onPage('/jobs/new')}>
        <div class="mobile-nav-plus">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        </div>
        <span>New Job</span>
      </a>
      {/if}
      <button class="mobile-nav-item" on:click={() => { auth.logout(); goto('/login'); }}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
        <span>Logout</span>
      </button>
    </nav>

  </div>
{/if}

<style>
  .shell {
    display: flex;
    min-height: 100vh;
  }

  /* ── Desktop Sidebar ── */
  .sidebar {
    width: 200px;
    min-height: 100vh;
    background: var(--surface);
    border-right: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    position: fixed;
    top: 0; left: 0; bottom: 0;
    z-index: 100;
  }

  .sidebar-logo {
    padding: 24px 20px 20px;
    border-bottom: 1px solid var(--border);
  }
  .logo-text {
    display: block;
    font-family: Impact, 'Arial Black', sans-serif;
    font-size: 1.6rem;
    letter-spacing: 0.08em;
    color: var(--red);
    line-height: 1;
  }
  .logo-sub {
    display: block;
    font-family: var(--font-display);
    font-size: 0.65rem;
    letter-spacing: 0.3em;
    color: var(--text-muted);
    text-transform: uppercase;
    margin-top: 2px;
  }

  .nav-links {
    list-style: none;
    padding: 12px 10px;
    flex: 1;
  }
  .nav-links a {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 12px;
    border-radius: var(--radius);
    color: var(--text-muted);
    font-family: var(--font-display);
    font-weight: 600;
    font-size: 0.9rem;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    transition: all 0.15s;
  }
  .nav-links a:hover { color: var(--text); background: var(--surface-2); }
  .nav-links a.active { color: var(--red); background: var(--red-glow); }

  .sidebar-footer {
    padding: 12px 10px;
    border-top: 1px solid var(--border);
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .user-chip { display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0; }
  .user-avatar {
    width: 30px; height: 30px;
    background: var(--red);
    border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    font-family: var(--font-display);
    font-weight: 900; font-size: 0.85rem;
    color: #fff; flex-shrink: 0;
  }
  .user-info { display: flex; flex-direction: column; min-width: 0; }
  .user-name {
    font-family: var(--font-display); font-weight: 700;
    font-size: 0.82rem; color: var(--text);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .user-role {
    font-size: 0.68rem; color: var(--text-dim);
    text-transform: uppercase; letter-spacing: 0.08em;
  }
  .logout-btn {
    background: none; border: none; cursor: pointer;
    color: var(--text-dim); padding: 4px;
    transition: color 0.15s; flex-shrink: 0;
  }
  .logout-btn:hover { color: var(--red); }

  /* ── Main ── */
  .main-content {
    margin-left: 200px;
    flex: 1;
    min-height: 100vh;
    background: var(--black);
  }

  /* ── Mobile header — hidden on desktop ── */
  .mobile-header { display: none; }
  .mobile-nav    { display: none; }

  /* ── Mobile ── */
  @media (max-width: 768px) {
    .sidebar { display: none; }

    .main-content {
      margin-left: 0;
      padding-bottom: 70px; /* room for bottom nav */
      padding-top: 56px;    /* room for top bar */
    }

    /* Top bar */
    .mobile-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      position: fixed;
      top: 0; left: 0; right: 0;
      height: 56px;
      background: var(--surface);
      border-bottom: 1px solid var(--border);
      padding: 0 16px;
      z-index: 100;
    }
    .mobile-logo {
      font-family: Impact, 'Arial Black', sans-serif;
      font-size: 1.3rem;
      letter-spacing: 0.08em;
      color: var(--red);
    }
    .mobile-logo span {
      font-size: 0.7rem;
      font-family: var(--font-display);
      letter-spacing: 0.2em;
      color: var(--text-muted);
      margin-left: 6px;
      vertical-align: middle;
    }
    .mobile-user { display: flex; align-items: center; gap: 10px; }
    .user-avatar-sm {
      width: 28px; height: 28px;
      background: var(--red);
      border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      font-family: var(--font-display);
      font-weight: 900; font-size: 0.8rem;
      color: #fff;
    }
    .logout-btn-sm {
      background: none; border: none; cursor: pointer;
      color: var(--text-muted); padding: 4px;
    }

    /* Bottom nav */
    .mobile-nav {
      display: flex;
      position: fixed;
      bottom: 0; left: 0; right: 0;
      height: 64px;
      background: var(--surface);
      border-top: 1px solid var(--border);
      z-index: 100;
      align-items: center;
      justify-content: space-around;
      padding: 0 8px;
      padding-bottom: env(safe-area-inset-bottom);
    }

    .mobile-nav-item {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 3px;
      padding: 6px 16px;
      background: none;
      border: none;
      cursor: pointer;
      color: var(--text-muted);
      text-decoration: none;
      font-family: var(--font-display);
      font-size: 0.68rem;
      font-weight: 600;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      transition: color 0.15s;
      flex: 1;
    }
    .mobile-nav-item.active { color: var(--red); }
    .mobile-nav-item:hover  { color: var(--text); }

    .mobile-nav-center { flex: 0 0 auto; }
    .mobile-nav-plus {
      width: 48px; height: 48px;
      background: var(--red);
      border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      color: #fff;
      margin-bottom: 2px;
      box-shadow: 0 2px 8px rgba(192,57,43,0.4);
    }
    .mobile-nav-center span { font-size: 0.62rem; color: var(--text-muted); }
    .mobile-nav-center.active .mobile-nav-plus { background: var(--red-dark); }
  }
</style>