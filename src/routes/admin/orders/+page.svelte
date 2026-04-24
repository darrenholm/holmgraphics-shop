<!-- src/routes/admin/orders/+page.svelte
     Staff view of online orders. Lists by status, drill-in for detail.
     Mounted under /admin/* using existing staff JWT. -->
<script>
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { auth, isStaff } from '$lib/stores/auth.js';
  import { API_BASE } from '$lib/api/client.js';

  let orders = [];
  let loading = true;
  let error = '';
  let status = '';

  function token() { return localStorage.getItem('hg_token'); }

  async function api(path) {
    const res = await fetch(`${API_BASE}${path}`, {
      headers: { Authorization: `Bearer ${token()}` },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || data.message || `API ${res.status}`);
    return data;
  }

  onMount(async () => {
    if (!$auth || !$isStaff) { goto('/login?return=/admin/orders'); return; }
    await load();
  });

  async function load() {
    loading = true; error = '';
    try {
      const qs = status ? `?status=${encodeURIComponent(status)}` : '';
      const res = await api(`/admin/orders${qs}`);
      orders = res.orders || [];
    } catch (e) { error = e.message; } finally { loading = false; }
  }

  $: { status; if (!loading) load(); }

  const money = (n) =>
    new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(n || 0);

  const STATUSES = [
    '', 'awaiting_artwork', 'awaiting_proof', 'awaiting_approval',
    'in_production', 'ready_to_ship', 'ready_for_pickup',
    'shipped', 'picked_up', 'complete', 'cancelled', 'refunded',
  ];
</script>

<svelte:head><title>Online orders — Holm Graphics Admin</title></svelte:head>

<div class="page">
  <h1>Online orders</h1>

  <div class="filters">
    <label>Status
      <select bind:value={status}>
        {#each STATUSES as s}
          <option value={s}>{s || 'All'}</option>
        {/each}
      </select>
    </label>
    <a href="/admin/pricing" class="link">Edit pricing →</a>
  </div>

  {#if error}<p class="alert error">{error}</p>{/if}

  {#if loading}
    <p>Loading…</p>
  {:else if !orders.length}
    <p class="muted">No orders match.</p>
  {:else}
    <table>
      <thead>
        <tr>
          <th>Order</th><th>Customer</th><th>Status</th><th>Method</th>
          <th>Total</th><th>Placed</th><th></th>
        </tr>
      </thead>
      <tbody>
        {#each orders as o}
          <tr>
            <td><a href="/jobs/{o.id}">#{o.order_number}</a></td>
            <td>{o.customer_name}<br><small>{o.customer_email}</small></td>
            <td><span class="pill {o.status}">{o.status.replace(/_/g, ' ')}</span></td>
            <td>{o.fulfillment_method}</td>
            <td>{money(o.grand_total)}</td>
            <td>{new Date(o.created_at).toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' })}</td>
            <td>
              <a href="/admin/orders/{o.id}">Manage</a>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</div>

<style>
  .page { max-width: 80rem; margin: 0 auto; padding: 2rem 1rem; }
  h1 { margin: 0 0 1rem; }
  .filters { display: flex; gap: 1rem; align-items: end; margin-bottom: 1rem; }
  .filters label { display: flex; flex-direction: column; gap: 0.3rem; font-size: 0.9rem; }
  .filters select { padding: 0.4rem; border: 1px solid #d4d4d8; border-radius: 0.3rem; }
  .filters .link { margin-left: auto; color: #c01818; text-decoration: none; }
  .alert.error { background: #fee; color: #b00; padding: 0.6rem 0.85rem; border-radius: 0.3rem; }
  .muted { color: #888; }
  table { width: 100%; border-collapse: collapse; background: white; border: 1px solid #e4e4e7; border-radius: 0.5rem; overflow: hidden; }
  th, td { padding: 0.65rem; text-align: left; border-bottom: 1px solid #f0f0f0; font-size: 0.95rem; }
  th { background: #fafafa; color: #555; font-size: 0.85rem; text-transform: uppercase; }
  td small { color: #888; }
  td a { color: #c01818; text-decoration: none; }
  .pill { padding: 0.15rem 0.5rem; border-radius: 0.75rem; font-size: 0.78rem; background: #ddd; color: #333; text-transform: capitalize; }
  .pill.awaiting_artwork  { background: #ddd; }
  .pill.awaiting_proof    { background: #c8e6c9; color: #1a4a1a; }
  .pill.awaiting_approval { background: #ffe0b2; color: #6a4a1a; }
  .pill.in_production     { background: #c5cae9; color: #1a2a6a; }
  .pill.ready_for_pickup, .pill.ready_to_ship { background: #b2dfdb; color: #1a4a4a; }
  .pill.shipped, .pill.picked_up, .pill.complete { background: #c8e6c9; color: #1a4a1a; }
  .pill.cancelled, .pill.refunded { background: #ffcdd2; color: #6a1a1a; }
</style>
