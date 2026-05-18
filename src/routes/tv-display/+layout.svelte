<!-- src/routes/tv-display/+layout.svelte -->
<!-- Fullscreen layout for TV display - no navigation, no header -->

<script>
  // No authentication required for TV display (public facing)
</script>

<slot />

<style>
  :global(*) {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
  }

  :global(body) {
    background: #1a1a1a;
    overflow: hidden;
  }
</style>
