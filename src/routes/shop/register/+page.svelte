<!-- src/routes/shop/register/+page.svelte
     Customer-facing registration. Existing customers can also use this
     page to trigger an activation email by entering only their email and
     hitting "I'm an existing customer". -->
<script>
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { onMount } from 'svelte';
  import { customer } from '$lib/stores/customer-auth.js';
  import { customerApi } from '$lib/api/customer-client.js';

  let mode = 'register';   // 'register' | 'activate'
  let email = '';
  let password = '';
  let fname = '';
  let lname = '';
  let company = '';
  let phone = '';
  let loading = false;
  let error = '';
  let info  = '';

  $: returnTo = $page.url.searchParams.get('return') || '/shop/account';

  onMount(() => {
    if ($customer) goto(returnTo);
    if ($page.url.searchParams.get('activate') === '1') mode = 'activate';
  });

  async function handleRegister() {
    if (!email || !password) { error = 'Email and password required.'; return; }
    if (password.length < 8)  { error = 'Password must be at least 8 characters.'; return; }
    if (!fname && !lname && !company) { error = 'Please enter a name or company.'; return; }
    loading = true;
    error = ''; info = '';
    try {
      const res = await customerApi.register({
        email: email.trim(),
        password,
        fname: fname.trim(),
        lname: lname.trim(),
        company: company.trim() || undefined,
        phone:   phone.trim() || undefined,
      });
      // 201 = new account, 202 = "we already have you on file" → activation sent
      if (res.token) {
        customer.login(res.profile, res.token);
        goto(returnTo);
      } else {
        info = res.message || 'Check your email to activate your account.';
        mode = 'activate';
      }
    } catch (e) {
      error = e.message || 'Registration failed.';
    } finally {
      loading = false;
    }
  }

  async function handleRequestActivation() {
    if (!email) { error = 'Enter your email address.'; return; }
    loading = true;
    error = ''; info = '';
    try {
      const res = await customerApi.requestActivation(email.trim());
      info = res.message || 'If we have your email on file, we just sent an activation link.';
    } catch (e) {
      error = e.message || 'Could not send activation email.';
    } finally {
      loading = false;
    }
  }
</script>

<svelte:head><title>Create account — Holm Graphics</title></svelte:head>

<div class="auth-page">
  <div class="auth-card">
    <div class="tabs">
      <button class:active={mode === 'register'} on:click={() => mode = 'register'}>New customer</button>
      <button class:active={mode === 'activate'} on:click={() => mode = 'activate'}>Existing customer</button>
    </div>

    {#if info}<div class="alert info">{info}</div>{/if}
    {#if error}<div class="alert error">{error}</div>{/if}

    {#if mode === 'register'}
      <p class="subtitle">Create your Holm Graphics customer account to place online orders.</p>
      <form on:submit|preventDefault={handleRegister}>
        <label>Email
          <input type="email" bind:value={email} autocomplete="email" required disabled={loading} />
        </label>
        <div class="row">
          <label>First name
            <input type="text" bind:value={fname} autocomplete="given-name" disabled={loading} />
          </label>
          <label>Last name
            <input type="text" bind:value={lname} autocomplete="family-name" disabled={loading} />
          </label>
        </div>
        <label>Company (optional)
          <input type="text" bind:value={company} autocomplete="organization" disabled={loading} />
        </label>
        <label>Phone (optional)
          <input type="tel" bind:value={phone} autocomplete="tel" disabled={loading} />
        </label>
        <label>Password
          <input type="password" bind:value={password} autocomplete="new-password" minlength="8" required disabled={loading} />
          <span class="hint">At least 8 characters.</span>
        </label>
        <button type="submit" class="primary" disabled={loading}>
          {loading ? 'Creating account…' : 'Create account'}
        </button>
      </form>
      <div class="auth-links">
        Already have an account? <a href="/shop/login">Sign in</a>
      </div>
    {:else}
      <p class="subtitle">
        We may already have you on file from a previous in-shop or phone order.
        Enter your email and we'll send you a link to set up your online password.
      </p>
      <form on:submit|preventDefault={handleRequestActivation}>
        <label>Email
          <input type="email" bind:value={email} autocomplete="email" required disabled={loading} />
        </label>
        <button type="submit" class="primary" disabled={loading}>
          {loading ? 'Sending…' : 'Send activation link'}
        </button>
      </form>
      <div class="auth-links">
        Brand new to Holm Graphics? <button type="button" class="link" on:click={() => mode = 'register'}>Create a new account</button>
      </div>
    {/if}
  </div>
</div>

<style>
  .auth-page { min-height: 60vh; display: flex; align-items: center; justify-content: center; padding: 2rem 1rem; }
  .auth-card { width: 100%; max-width: 32rem; background: #fff; padding: 2rem; border-radius: 0.75rem; box-shadow: 0 2px 12px rgba(0,0,0,0.06); }
  .tabs { display: grid; grid-template-columns: 1fr 1fr; gap: 0; margin-bottom: 1.25rem; border: 1px solid #e4e4e7; border-radius: 0.4rem; overflow: hidden; }
  .tabs button { padding: 0.75rem; background: #f7f7f7; border: 0; cursor: pointer; font-weight: 500; color: #555; }
  .tabs button.active { background: #c01818; color: white; }
  .subtitle { color: #555; margin: 0 0 1.25rem; font-size: 0.95rem; }
  form { display: flex; flex-direction: column; gap: 0.85rem; }
  .row { display: grid; grid-template-columns: 1fr 1fr; gap: 0.85rem; }
  label { display: flex; flex-direction: column; gap: 0.35rem; font-weight: 500; color: #333; font-size: 0.95rem; }
  .hint { font-weight: 400; color: #888; font-size: 0.85rem; }
  input { padding: 0.6rem 0.75rem; border: 1px solid #d4d4d8; border-radius: 0.4rem; font-size: 1rem; }
  input:focus { outline: 2px solid #c01818; outline-offset: -1px; }
  .primary { background: #c01818; color: white; border: none; padding: 0.85rem; border-radius: 0.4rem; font-size: 1rem; font-weight: 600; cursor: pointer; margin-top: 0.5rem; }
  .primary:disabled { opacity: 0.6; cursor: not-allowed; }
  .alert { padding: 0.75rem 1rem; border-radius: 0.4rem; margin-bottom: 1rem; font-size: 0.95rem; }
  .alert.error { background: #fee; color: #b00; }
  .alert.info  { background: #eef; color: #225; }
  .auth-links { margin-top: 1.5rem; text-align: center; font-size: 0.95rem; color: #555; }
  .auth-links a, .auth-links button.link {
    color: #c01818; background: none; border: 0; padding: 0; cursor: pointer;
    font: inherit; text-decoration: none;
  }
  .auth-links a:hover, .auth-links button.link:hover { text-decoration: underline; }
</style>
