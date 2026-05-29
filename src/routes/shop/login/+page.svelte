<!-- src/routes/shop/login/+page.svelte
     Customer-facing login. Distinct from /login (staff). -->
<script>
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { onMount } from 'svelte';
  import { customer } from '$lib/stores/customer-auth.js';
  import { customerApi } from '$lib/api/customer-client.js';
  import { advertiseApi } from '$lib/advertise/api.js';

  let email = '';
  let password = '';
  let loading = false;
  let error = '';
  let info  = '';

  // After login, send the user back where they came from (e.g. /shop/checkout
  // bounced them here mid-flow). Defaults to /portal — the unified customer
  // hub that surfaces ad rentals, apparel, and current jobs in one place.
  $: returnTo = $page.url.searchParams.get('return') || '/portal';

  /**
   * Some return paths are too generic to land owner-clients on usefully.
   * /advertise/displays in particular is the rental catalog — a school
   * admin who clicked it just to look around then signed in ends up on
   * a page that doesn't show their own screen (it's not rentable, so
   * it's correctly excluded from the catalog).
   *
   * If the return path matches one of these "I might as well go to my
   * screens" cases, we ask the LED API whether the customer owns
   * anything and redirect there instead. Explicit deep-link returns
   * (e.g. /shop/checkout/abc123) are always honoured.
   */
  function shouldPreferMyAds(rt) {
    if (!rt) return true;
    return (
      rt === '/portal' ||
      rt === '/advertise' ||
      rt === '/advertise/' ||
      rt.startsWith('/advertise/displays')
    );
  }

  /**
   * Resolve the final landing URL post-auth. If the return target is
   * generic AND the customer is recorded as an owner of any LED screen,
   * jump them to /advertise/my-ads where the "My screens" section is.
   * Falls back to returnTo on any error — never block login on this.
   */
  async function resolveLandingPath(rt) {
    if (!shouldPreferMyAds(rt)) return rt;
    try {
      const devices = await advertiseApi.getMyDevices();
      const ownsScreen = Array.isArray(devices)
        && devices.some((d) => d.relationship === 'owner');
      if (ownsScreen) return '/advertise/my-ads';
    } catch (_) {
      // Token not propagated yet, network blip, or my-devices unavailable —
      // just take them where they were going.
    }
    return rt;
  }

  onMount(async () => {
    if ($customer) {
      const dest = await resolveLandingPath(returnTo);
      goto(dest);
    }
  });

  async function handleLogin() {
    if (!email || !password) { error = 'Please enter email and password.'; return; }
    loading = true;
    error = ''; info = '';
    try {
      // Pass returnTo into login so if the account turns out to be
      // unactivated, the auto-issued activation email carries the same
      // return path. That way the customer lands back here (e.g. on
      // /advertise/my-ads) regardless of which device/session they
      // click the email link from.
      const res = await customerApi.login(email.trim(), password, returnTo);
      customer.login(res.profile, res.token);
      const dest = await resolveLandingPath(returnTo);
      goto(dest);
    } catch (e) {
      if (e.body?.code === 'activation_required') {
        info = (e.body.message || 'Check your email for an activation link.')
             + ` We sent it to ${email.trim()}.`;
      } else {
        error = e.message || 'Login failed.';
      }
    } finally {
      loading = false;
    }
  }
</script>

<svelte:head><title>Sign in — Holm Graphics</title></svelte:head>

<div class="auth-page">
  <div class="auth-card">
    <h1>Sign in</h1>
    <p class="subtitle">Customer accounts for Holm Graphics online orders &amp; ad rental management.</p>

    {#if info}<div class="alert info">{info}</div>{/if}
    {#if error}<div class="alert error">{error}</div>{/if}

    <form on:submit|preventDefault={handleLogin}>
      <label>
        Email
        <input type="email" bind:value={email} autocomplete="email" required disabled={loading} />
      </label>
      <label>
        Password
        <input type="password" bind:value={password} autocomplete="current-password" required disabled={loading} />
      </label>

      <button type="submit" class="primary" disabled={loading}>
        {loading ? 'Signing in…' : 'Sign in'}
      </button>
    </form>

    <div class="auth-links">
      <a href="/shop/forgot-password">Forgot password?</a>
      <span class="divider">·</span>
      <a href="/shop/register">Create an account</a>
    </div>

    <div class="existing-customer">
      <p>
        Existing Holm Graphics customer? Your account is already on file —
        <a href="/shop/register?activate=1">activate it here</a>.
      </p>
    </div>
  </div>
</div>

<style>
  .auth-page {
    min-height: 60vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 2rem 1rem;
  }
  .auth-card {
    width: 100%;
    max-width: 28rem;
    background: #fff;
    padding: 2rem;
    border-radius: 0.75rem;
    box-shadow: 0 2px 12px rgba(0,0,0,0.06);
  }
  h1 { margin: 0 0 0.25rem; font-size: 1.75rem; }
  .subtitle { color: #555; margin: 0 0 1.5rem; }
  form { display: flex; flex-direction: column; gap: 1rem; }
  label { display: flex; flex-direction: column; gap: 0.4rem; font-weight: 500; color: #333; }
  input {
    padding: 0.65rem 0.8rem;
    border: 1px solid #d4d4d8;
    border-radius: 0.4rem;
    font-size: 1rem;
  }
  input:focus { outline: 2px solid #c01818; outline-offset: -1px; }
  .primary {
    background: #c01818; color: white; border: none;
    padding: 0.85rem; border-radius: 0.4rem; font-size: 1rem;
    font-weight: 600; cursor: pointer; margin-top: 0.5rem;
  }
  .primary:disabled { opacity: 0.6; cursor: not-allowed; }
  .alert { padding: 0.75rem 1rem; border-radius: 0.4rem; margin-bottom: 1rem; font-size: 0.95rem; }
  .alert.error { background: #fee; color: #b00; }
  .alert.info  { background: #eef; color: #225; }
  .auth-links { margin-top: 1.5rem; text-align: center; font-size: 0.95rem; color: #555; }
  .auth-links a { color: #c01818; text-decoration: none; }
  .auth-links a:hover { text-decoration: underline; }
  .auth-links .divider { margin: 0 0.5rem; color: #aaa; }
  .existing-customer { margin-top: 1.5rem; padding-top: 1.5rem; border-top: 1px solid #eee; font-size: 0.9rem; color: #666; }
  .existing-customer a { color: #c01818; }
</style>
