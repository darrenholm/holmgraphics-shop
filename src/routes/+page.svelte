<!-- src/routes/+page.svelte -->
<!--
  The "/" route serves both:
    • holmgraphics.ca (apex)  → marketing homepage at /home.html
    • shop.holmgraphics.ca    → staff app (dashboard or login)
  We split by hostname client-side. Both build outputs are identical
  (the same prerendered file) — only the redirect target differs at runtime.
-->
<script>
  export const prerender = true;
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import { auth } from '$lib/stores/auth.js';

  const APEX_HOSTS = ['holmgraphics.ca', 'www.holmgraphics.ca'];

  onMount(() => {
    const host = window.location.hostname;
    if (APEX_HOSTS.includes(host)) {
      // Customer-facing apex: send to the static marketing landing.
      window.location.replace('/home.html');
      return;
    }
    // Anything else (subdomain, preview deployments, localhost) → staff app.
    goto($auth ? '/dashboard' : '/login');
  });
</script>

<noscript>
  <p style="font-family: sans-serif; padding: 2rem; text-align: center;">
    JavaScript is required. Visit <a href="/home.html">/home.html</a> for the
    main site or <a href="/login">/login</a> for staff.
  </p>
</noscript>
