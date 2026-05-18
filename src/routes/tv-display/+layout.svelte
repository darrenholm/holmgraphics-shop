<!-- src/routes/tv-display/+layout.svelte -->
<!-- Fullscreen layout for TV display - no navigation, no sidebar -->

<slot />

<style>
  :global(*) {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
  }

  :global(body), :global(html) {
    width: 100% !important;
    height: 100% !important;
    background: #1a1a1a !important;
    overflow: hidden !important;
  }

  /* Hide any inherited layout elements (sidebar, nav, header, etc) */
  :global(nav) {
    display: none !important;
  }

  :global([role="navigation"]) {
    display: none !important;
  }

  :global(.sidebar) {
    display: none !important;
  }

  :global(.nav) {
    display: none !important;
  }

  :global(.header) {
    display: none !important;
  }

  /* Ensure slot takes full width/height */
  :global(slot) {
    width: 100%;
    height: 100%;
  }
</style>
