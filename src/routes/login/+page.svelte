<!-- src/routes/login/+page.svelte -->
<script>
  import { goto } from '$app/navigation';
  import { auth } from '$lib/stores/auth.js';
  import { api } from '$lib/api/client.js';
  import { onMount } from 'svelte';

  let email = '';
  let password = '';
  let loading = false;
  let error = '';

  onMount(() => {
    if ($auth) goto('/dashboard');
  });

  async function handleLogin() {
    if (!email || !password) { error = 'Please enter email and password.'; return; }
    loading = true;
    error = '';
    try {
      const res = await api.login(email, password);
      auth.login(res.user, res.token);
      goto('/dashboard');
    } catch (e) {
      error = e.message || 'Login failed. Check your credentials.';
    } finally {
      loading = false;
    }
  }

  function handleKey(e) {
    if (e.key === 'Enter') handleLogin();
  }
</script>

<svelte:head><title>Login — Holm Graphics Shop</title></svelte:head>

<div class="login-page">
  <div class="login-panel">
    <div class="brand">
      <span class="brand-logo">HOLM</span>
      <span class="brand-sub">GRAPHICS INC.</span>
      <span class="brand-tagline">Shop Management</span>
    </div>

    <div class="form-card">
      <h1>Sign In</h1>
      <p class="subtitle">Staff & client access</p>

      {#if error}
        <div class="error-banner">{error}</div>
      {/if}

      <div class="form-group">
        <label for="email">Email</label>
        <input
          id="email"
          type="email"
          bind:value={email}
          on:keydown={handleKey}
          placeholder="you@holmgraphics.ca"
          autocomplete="email"
          disabled={loading}
        />
      </div>

      <div class="form-group">
        <label for="password">Password</label>
        <input
          id="password"
          type="password"
          bind:value={password}
          on:keydown={handleKey}
          placeholder="••••••••"
          autocomplete="current-password"
          disabled={loading}
        />
      </div>

      <button class="btn btn-primary login-btn" on:click={handleLogin} disabled={loading}>
        {#if loading}
          <span class="spinner"></span> Signing in…
        {:else}
          Sign In →
        {/if}
      </button>
    </div>

    <p class="footer-note">Holm Graphics Inc. · Walkerton, ON · 519-507-3001</p>
  </div>

  <div class="login-art" aria-hidden="true">
    <div class="art-grid"></div>
    <div class="art-lines">
      {#each Array(8) as _, i}
        <div class="art-line" style="--i:{i}"></div>
      {/each}
    </div>
    <div class="art-logo">HG</div>
  </div>
</div>

<style>
  .login-page {
    display: grid;
    grid-template-columns: 420px 1fr;
    min-height: 100vh;
  }

  /* ── Left panel ── */
  .login-panel {
    display: flex;
    flex-direction: column;
    justify-content: center;
    padding: 48px 48px;
    background: var(--surface);
    border-right: 1px solid var(--border);
    gap: 32px;
  }

  .brand { display: flex; flex-direction: column; }
  .brand-logo {
    font-family: Impact, 'Arial Black', sans-serif;
    font-size: 3rem;
    letter-spacing: 0.1em;
    color: var(--red);
    line-height: 1;
  }
  .brand-sub {
    font-family: var(--font-display);
    font-size: 0.75rem;
    letter-spacing: 0.35em;
    color: var(--text-muted);
    text-transform: uppercase;
    margin-top: 2px;
  }
  .brand-tagline {
    font-family: var(--font-display);
    font-size: 0.72rem;
    letter-spacing: 0.2em;
    color: var(--text-dim);
    text-transform: uppercase;
    margin-top: 8px;
    padding-top: 8px;
    border-top: 1px solid var(--border);
  }

  .form-card {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  h1 {
    font-family: var(--font-display);
    font-size: 1.8rem;
    font-weight: 900;
    letter-spacing: 0.04em;
    color: var(--text);
    margin-bottom: 2px;
  }
  .subtitle {
    font-size: 0.85rem;
    color: var(--text-muted);
    margin-bottom: 20px;
  }

  .error-banner {
    background: rgba(192,57,43,0.15);
    border: 1px solid rgba(192,57,43,0.4);
    color: #e74c3c;
    padding: 10px 14px;
    border-radius: var(--radius);
    font-size: 0.88rem;
    margin-bottom: 8px;
  }

  .login-btn {
    width: 100%;
    justify-content: center;
    padding: 12px;
    font-size: 1rem;
    margin-top: 4px;
  }
  .login-btn:disabled { opacity: 0.6; cursor: not-allowed; transform: none; }

  .spinner {
    width: 14px; height: 14px;
    border: 2px solid rgba(255,255,255,0.3);
    border-top-color: #fff;
    border-radius: 50%;
    display: inline-block;
    animation: spin 0.7s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  .footer-note {
    font-size: 0.75rem;
    color: var(--text-dim);
    text-align: center;
    margin-top: auto;
  }

  /* ── Right art panel ── */
  .login-art {
    background: var(--black);
    position: relative;
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .art-grid {
    position: absolute;
    inset: 0;
    background-image:
      linear-gradient(var(--border) 1px, transparent 1px),
      linear-gradient(90deg, var(--border) 1px, transparent 1px);
    background-size: 48px 48px;
    opacity: 0.4;
  }

  .art-lines {
    position: absolute;
    inset: 0;
    overflow: hidden;
  }
  .art-line {
    position: absolute;
    left: 0; right: 0;
    height: 1px;
    background: linear-gradient(90deg, transparent, var(--red), transparent);
    top: calc(var(--i) * 12.5%);
    opacity: 0.12;
    animation: sweep 6s ease-in-out infinite;
    animation-delay: calc(var(--i) * 0.4s);
  }
  @keyframes sweep {
    0%, 100% { opacity: 0.08; transform: scaleX(0.3); }
    50% { opacity: 0.25; transform: scaleX(1); }
  }

  .art-logo {
    font-family: Impact, 'Arial Black', sans-serif;
    font-size: 18vw;
    color: var(--red);
    opacity: 0.04;
    letter-spacing: 0.1em;
    user-select: none;
    position: relative;
    z-index: 1;
  }

  @media (max-width: 700px) {
    .login-page { grid-template-columns: 1fr; }
    .login-art { display: none; }
    .login-panel { padding: 32px 24px; }
  }
</style>
