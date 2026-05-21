<!--
  /fleet-admin layout — staff-only gate.

  The spec calls this "admin" but the gating is requireStaff (per the
  Step 0 decision: anyone on staff can manage fleet docs, not just role=admin).
  Drivers' view lives at /fleet-docs and uses the same staff gate.
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
