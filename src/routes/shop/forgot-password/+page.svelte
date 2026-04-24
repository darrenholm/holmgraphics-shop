<!-- src/routes/shop/forgot-password/+page.svelte -->
<script>
  import { customerApi } from '$lib/api/customer-client.js';

  let email = '';
  let loading = false;
  let info = '';
  let error = '';

  async function handle() {
    if (!email) { error = 'Enter your email.'; return; }
    loading = true; error = ''; info = '';
    try {
      const res = await customerApi.forgotPassword(email.trim());
      info = res.message || 'If your email is on file, you\'ll get a reset link shortly.';
    } catch (e) {
      error = e.message;
    } finally {
      loading = false;
    }
  }
</script>

<svelte:head><title>Forgot password — Holm Graphics</title></svelte:head>

<div class="auth-page">
  <div class="auth-card">
    <h1>Reset your password</h1>
    <p class="subtitle">Enter your email and we'll send you a reset link.</p>

    {#if info}<div class="alert info">{info}</div>{/if}
    {#if error}<div class="alert error">{error}</div>{/if}

    <form on:submit|preventDefault={handle}>
      <label>Email
        <input type="email" bind:value={email} autocomplete="email" required disabled={loading} />
      </label>
      <button type="submit" class="primary" disabled={loading}>
        {loading ? 'Sending…' : 'Send reset link'}
      </button>
    </form>

    <div class="auth-links"><a href="/shop/login">Back to sign in</a></div>
  </div>
</div>

<style>
  .auth-page { min-height: 60vh; display: flex; align-items: center; justify-content: center; padding: 2rem 1rem; }
  .auth-card { width: 100%; max-width: 28rem; background: #fff; padding: 2rem; border-radius: 0.75rem; box-shadow: 0 2px 12px rgba(0,0,0,0.06); }
  h1 { margin: 0 0 0.25rem; }
  .subtitle { color: #555; margin: 0 0 1.5rem; }
  form { display: flex; flex-direction: column; gap: 1rem; }
  label { display: flex; flex-direction: column; gap: 0.4rem; font-weight: 500; color: #333; }
  input { padding: 0.65rem 0.8rem; border: 1px solid #d4d4d8; border-radius: 0.4rem; font-size: 1rem; }
  input:focus { outline: 2px solid #c01818; outline-offset: -1px; }
  .primary { background: #c01818; color: white; border: none; padding: 0.85rem; border-radius: 0.4rem; font-size: 1rem; font-weight: 600; cursor: pointer; }
  .primary:disabled { opacity: 0.6; }
  .alert { padding: 0.75rem 1rem; border-radius: 0.4rem; margin-bottom: 1rem; }
  .alert.error { background: #fee; color: #b00; }
  .alert.info { background: #eef; color: #225; }
  .auth-links { margin-top: 1.5rem; text-align: center; }
  .auth-links a { color: #c01818; text-decoration: none; }
</style>
