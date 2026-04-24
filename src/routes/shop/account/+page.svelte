<!-- src/routes/shop/account/+page.svelte
     Customer account dashboard: order history + profile editing. -->
<script>
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { customer } from '$lib/stores/customer-auth.js';
  import { customerApi } from '$lib/api/customer-client.js';

  let orders = [];
  let loading = true;
  let error = '';

  let editingProfile = false;
  let profile = { fname: '', lname: '', company: '', phone: '' };
  let profileSaving = false;
  let profileMsg = '';

  onMount(async () => {
    if (!$customer) { goto('/shop/login?return=/shop/account'); return; }
    profile = {
      fname: $customer.fname || '',
      lname: $customer.lname || '',
      company: $customer.company || '',
      phone: $customer.phone || '',
    };
    try {
      const res = await customerApi.getOrders();
      orders = res.orders || [];
    } catch (e) {
      error = e.message;
    } finally {
      loading = false;
    }
  });

  async function saveProfile() {
    profileSaving = true;
    profileMsg = '';
    try {
      const res = await customerApi.updateMe(profile);
      customer.update(res.profile);
      editingProfile = false;
      profileMsg = 'Profile updated.';
    } catch (e) {
      profileMsg = 'Save failed: ' + e.message;
    } finally {
      profileSaving = false;
    }
  }

  function logout() {
    customer.logout();
    goto('/shop');
  }

  const money = (n) =>
    new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(n || 0);

  const STATUS_COLORS = {
    awaiting_artwork:  '#888', awaiting_proof: '#3a7', awaiting_approval: '#c80',
    in_production: '#37c', ready_to_ship: '#37c', ready_for_pickup: '#3a7',
    shipped: '#3a7', delivered: '#3a7', picked_up: '#3a7', complete: '#888',
    cancelled: '#b00', refunded: '#b00',
  };
</script>

<svelte:head><title>My account — Holm Graphics</title></svelte:head>

<div class="page">
  <div class="head">
    <div>
      <h1>My account</h1>
      {#if $customer}<p class="meta">{$customer.email}</p>{/if}
    </div>
    <button class="btn ghost" on:click={logout}>Sign out</button>
  </div>

  <section>
    <div class="section-head">
      <h2>Profile</h2>
      {#if !editingProfile}
        <button class="link-btn" on:click={() => editingProfile = true}>Edit</button>
      {/if}
    </div>

    {#if profileMsg}<p class="alert info">{profileMsg}</p>{/if}

    {#if editingProfile}
      <div class="form-grid">
        <label>First name <input bind:value={profile.fname} /></label>
        <label>Last name <input bind:value={profile.lname} /></label>
        <label class="full">Company <input bind:value={profile.company} /></label>
        <label class="full">Phone <input bind:value={profile.phone} /></label>
      </div>
      <div class="actions">
        <button class="btn primary" on:click={saveProfile} disabled={profileSaving}>
          {profileSaving ? 'Saving…' : 'Save'}
        </button>
        <button class="btn ghost" on:click={() => editingProfile = false} disabled={profileSaving}>Cancel</button>
      </div>
    {:else if $customer}
      <p>
        {$customer.fname || ''} {$customer.lname || ''}
        {#if $customer.company}<br>{$customer.company}{/if}
        {#if $customer.phone}<br>{$customer.phone}{/if}
      </p>
    {/if}
  </section>

  <section>
    <h2>Orders</h2>
    {#if loading}
      <p>Loading…</p>
    {:else if error}
      <p class="alert error">{error}</p>
    {:else if !orders.length}
      <p class="muted">No orders yet. <a href="/shop">Browse the catalog →</a></p>
    {:else}
      <table class="orders">
        <thead>
          <tr><th>Order #</th><th>Date</th><th>Status</th><th>Method</th><th>Total</th><th></th></tr>
        </thead>
        <tbody>
          {#each orders as o}
            <tr>
              <td>#{o.order_number}</td>
              <td>{new Date(o.created_at).toLocaleDateString('en-CA')}</td>
              <td><span class="pill" style="background:{STATUS_COLORS[o.status] || '#666'}">{o.status.replace(/_/g, ' ')}</span></td>
              <td>{o.fulfillment_method}</td>
              <td>{money(o.grand_total)}</td>
              <td><a href="/shop/order/{o.order_number}">View</a></td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </section>
</div>

<style>
  .page { max-width: 60rem; margin: 0 auto; padding: 2rem 1rem; }
  .head { display: flex; justify-content: space-between; align-items: start; margin-bottom: 2rem; }
  h1 { margin: 0; }
  .meta { color: #777; margin: 0.25rem 0 0; }
  section { background: white; border: 1px solid #e4e4e7; border-radius: 0.5rem; padding: 1.25rem; margin-bottom: 1.5rem; }
  .section-head { display: flex; justify-content: space-between; align-items: center; }
  h2 { margin: 0 0 0.75rem; font-size: 1.1rem; }
  .form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.85rem; margin-top: 0.75rem; }
  .form-grid .full { grid-column: 1 / -1; }
  .form-grid label { display: flex; flex-direction: column; gap: 0.3rem; font-size: 0.9rem; }
  .form-grid input { padding: 0.55rem 0.7rem; border: 1px solid #d4d4d8; border-radius: 0.3rem; font-size: 1rem; }
  .actions { display: flex; gap: 0.5rem; margin-top: 1rem; }
  .btn { padding: 0.55rem 1rem; border-radius: 0.3rem; border: 0; cursor: pointer; font-weight: 500; }
  .btn.primary { background: #c01818; color: white; }
  .btn.ghost   { background: transparent; color: #555; border: 1px solid #ccc; }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .link-btn { background: none; border: 0; color: #c01818; cursor: pointer; }
  .alert { padding: 0.5rem 0.75rem; border-radius: 0.3rem; }
  .alert.error { background: #fee; color: #b00; }
  .alert.info  { background: #eef6ff; color: #225; }
  .muted { color: #888; }
  .orders { width: 100%; border-collapse: collapse; margin-top: 0.5rem; }
  .orders th, .orders td { text-align: left; padding: 0.5rem; border-bottom: 1px solid #eee; font-size: 0.95rem; }
  .orders th { color: #555; font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.05em; }
  .orders a { color: #c01818; }
  .pill { color: white; padding: 0.15rem 0.5rem; border-radius: 0.75rem; font-size: 0.75rem; text-transform: capitalize; }
</style>
