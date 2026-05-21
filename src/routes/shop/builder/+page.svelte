<!--
  /shop/builder — redirect to /shop/cart.

  The builder graduated out of preview into the main cart route at Step 8.
  Anyone hitting /shop/builder (from a bookmark, an in-flight share link, or
  an in-progress preview email) lands at the same content via /shop/cart.
  Remove this redirect after one release cycle once the inbound traffic
  drops to ~zero.
-->
<script>
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';

  onMount(() => goto('/shop/cart', { replaceState: true }));
</script>

<svelte:head><title>Redirecting… — Holm Graphics</title></svelte:head>

<p style="padding:2rem; color:#666; text-align:center;">
  Taking you to <a href="/shop/cart">/shop/cart</a>…
</p>
