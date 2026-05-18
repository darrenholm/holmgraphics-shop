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
    width: 100%;
    height: 100%;
    background: #1a1a1a;
    overflow: hidden;
  }
</style>
