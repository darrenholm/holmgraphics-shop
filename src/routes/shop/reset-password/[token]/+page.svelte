<!-- src/routes/shop/reset-password/[token]/+page.svelte -->
<script>
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { customer } from '$lib/stores/customer-auth.js';
  import { customerApi } from '$lib/api/customer-client.js';

  $: token = $page.params.token;

  let password = '';
  let password2 = '';
  let loading = false;
  let error = '';

  async function handle() {
    if (password.length < 8)    { error = 'Password must be at least 8 characters.'; return; }
    if (password !== password2) { error = 'Passwords don\'t match.'; return; }
    loading = true; error = '';
    try {
      const res = await customerApi.resetPassword(token, password);
      customer.login(res.profile, res.token);
      goto('/shop/account');
    } catch (e) {
      error = e.message;
    } finally {
      loading = false;
    }
  }
</script>

<svelte:head><title>Reset password — Holm Graphics</title></svelte:head>

<div class="auth-page">
  <div class="auth-card">
    <h1>Set a new password</h1>
    {#if error}<div class="alert error">{error}</div>{/if}
    <form on:submit|preventDefault={handle}>
      <label>New password
        <input type="password" bind:value={password} minlength="8" autocomplete="new-password" required disabled={loading} />
      </label>
      <label>Confirm password
        <input type="password" bind:value={password2} minlength="8" autocomplete="new-password" required disabled={loading} />
      </label>
      <button type="submit" class="primary" disabled={loading}>
        {loading ? 'Saving…' : 'Save password'}
      </button>
    </form>
  </div>
</div>

<style>
  .auth-page { min-height: 60vh; display: flex; align-items: center; justify-content: center; padding: 2rem 1rem; }
  .auth-card { width: 100%; max-width: 28rem; background: #fff; padding: 2rem; border-radius: 0.75rem; box-shadow: 0 2px 12px rgba(0,0,0,0.06); }
  h1 { margin: 0 0 1rem; }
  form { display: flex; flex-direction: column; gap: 1rem; }
  label { display: flex; flex-direction: column; gap: 0.35rem; font-weight: 500; }
  input { padding: 0.6rem 0.75rem; border: 1px solid #d4d4d8; border-radius: 0.4rem; font-size: 1rem; }
  input:focus { outline: 2px solid #c01818; outline-offset: -1px; }
  .primary { background: #c01818; color: white; border: none; padding: 0.85rem; border-radius: 0.4rem; font-size: 1rem; font-weight: 600; cursor: pointer; }
  .primary:disabled { opacity: 0.6; }
  .alert { padding: 0.75rem 1rem; border-radius: 0.4rem; margin-bottom: 1rem; }
  .alert.error { background: #fee; color: #b00; }
</style>
