<!--
  One nametag card drawn with the shared renderer. Redraws when the design or
  card changes (parents reassign `design = design` after editing it in place)
  and again when a logo or photo finishes loading.
-->
<script>
  import { renderCard } from './render.js';

  export let design;
  export let card = {};
  export let ppi = 160;
  export let label = 'Nametag proof';
  /** Bump from the parent (e.g. after fonts load) to force a redraw. */
  export let redraw = 0;

  let canvas;
  let loaded = 0;

  function draw() {
    if (!canvas || !design) return;
    canvas.width = Math.round(design.w * ppi);
    canvas.height = Math.round(design.h * ppi);
    renderCard(canvas.getContext('2d'), design, card || {}, ppi, { onImageLoad: () => loaded++ });
  }

  $: canvas, design, card, ppi, redraw, loaded, draw();
</script>

<!-- CR80 corners are 1/8 in; round the on-screen card to match. -->
<canvas bind:this={canvas} aria-label={label}
  style={design ? `border-radius:${(12.5 / design.w).toFixed(2)}% / ${(12.5 / design.h).toFixed(2)}%` : ''}></canvas>

<style>
  canvas {
    display: block;
    width: 100%;
    height: auto;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
  }
</style>
