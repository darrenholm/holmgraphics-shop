<!--
  /fleet layout — staff-only gate for the daily inspection surface.

  Same realm as /fleet-docs: drivers are staff. Kept bare so the check page
  can own the whole viewport on a phone in a yard.
-->
<script>
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { isStaff } from '$lib/stores/auth.js';

  let checked = false;
  onMount(() => {
    if (!$isStaff) {
      const here = window.location.pathname + window.location.search;
      goto(`/login?return=${encodeURIComponent(here)}`, { replaceState: true });
    } else {
      checked = true;
    }
  });
</script>

{#if checked}
  <slot />
{:else}
  <p style="padding:2rem;color:#666;text-align:center;">Checking access…</p>
{/if}
