<!-- src/routes/+page.svelte -->
<script>
  export const prerender = true;
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import { auth } from '$lib/stores/auth.js';
  onMount(() => {
    goto($auth ? '/dashboard' : '/login');
  });
</script>
