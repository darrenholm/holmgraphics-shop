<!-- src/routes/shop/activate/[token]/+page.svelte
     Existing-customer activation. The token comes from the email link
     issued by /api/customer/request-activation. Customer sets a password
     (and optionally fills in name/phone), and we log them in. -->
<script>
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { customer } from '$lib/stores/customer-auth.js';
  import { customerApi } from '$lib/api/customer-client.js';

  $: token = $page.params.token;

  let password  = '';
  let password2 = '';
  let fname = '';
  let lname = '';
  let phone = '';

  let loading = false;
  let error = '';

  async function handleActivate() {
    if (password.length < 8)        { error = 'Password must be at least 8 characters.'; return; }
    if (password !== password2)     { error = 'Passwords don\'t match.'; return; }

    loading = true;
    error = '';
    try {
      const res = await customerApi.activate(token, {
        password,
        fname: fname.trim() || undefined,
        lname: lname.trim() || undefined,
        phone: phone.trim() || undefined,
      });
      customer.login(res.profile, res.token);
      goto('/shop/account');
    } catch (e) {
      error = e.message || 'Activation failed.';
    } finally {
      loading = false;
    }
  }
</script>

<svelte:head><title>Activate account — Holm Graphics</title></svelte:head>

<div class="auth-page">
  <div class="auth-card">
    <h1>Welcome back!</h1>
    <p class="subtitle">
      Set a password to activate your Holm Graphics online account. We'll
      remember everything we already have on file for you.
    </p>

    {#if error}<div class="alert error">{error}</div>{/if}

    <form on:submit|preventDefault={handleActivate}>
      <label>Password
        <input type="password" bind:value={password} minlength="8" autocomplete="new-password" required disabled={loading} />
      </label>
      <label>Confirm password
        <input type="password" bind:value={password2} minlength="8" autocomplete="new-password" required disabled={loading} />
      </label>

      <details>
        <summary>Update name / phone (optional)</summary>
        <div class="optional">
          <div class="row">
            <label>First name
              <input type="text" bind:value={fname} autocomplete="given-name" disabled={loading} />
            </label>
            <label>Last name
              <input type="text" bind:value={lname} autocomplete="family-name" disabled={loading} />
            </label>
          </div>
          <label>Phone
            <input type="tel" bind:value={phone} autocomplete="tel" disabled={loading} />
          </label>
        </div>
      </details>

      <button type="submit" class="primary" disabled={loading}>
        {loading ? 'Activating…' : 'Activate account'}
      </button>
    </form>
  </div>
</div>

<style>
  .auth-page { min-height: 60vh; display: flex; align-items: center; justify-content: center; padding: 2rem 1rem; }
  .auth-card { width: 100%; max-width: 32rem; background: #fff; padding: 2rem; border-radius: 0.75rem; box-shadow: 0 2px 12px rgba(0,0,0,0.06); }
  h1 { margin: 0 0 0.25rem; }
  .subtitle { color: #555; margin: 0 0 1.5rem; }
  form { display: flex; flex-direction: column; gap: 0.85rem; }
  label { display: flex; flex-direction: column; gap: 0.35rem; font-weight: 500; color: #333; font-size: 0.95rem; }
  .row { display: grid; grid-template-columns: 1fr 1fr; gap: 0.85rem; }
  input { padding: 0.6rem 0.75rem; border: 1px solid #d4d4d8; border-radius: 0.4rem; font-size: 1rem; }
  input:focus { outline: 2px solid #c01818; outline-offset: -1px; }
  details summary { cursor: pointer; color: #555; padding: 0.25rem 0; }
  .optional { display: flex; flex-direction: column; gap: 0.85rem; padding-top: 0.75rem; }
  .primary { background: #c01818; color: white; border: none; padding: 0.85rem; border-radius: 0.4rem; font-size: 1rem; font-weight: 600; cursor: pointer; margin-top: 0.5rem; }
  .primary:disabled { opacity: 0.6; cursor: not-allowed; }
  .alert { padding: 0.75rem 1rem; border-radius: 0.4rem; margin-bottom: 1rem; }
  .alert.error { background: #fee; color: #b00; }
</style>
