<!--
  Full-screen "frame the photo" step for nametag photos. Works with touch:
  drag to move, pinch (or the buttons) to zoom. The crop box has the same
  shape as the photo on the card, so what the client frames is what prints.

  Events: done (detail = JPEG data URL), cancel.
-->
<script>
  import { onMount, onDestroy, createEventDispatcher } from 'svelte';
  import 'cropperjs/dist/cropper.css';

  export let file;              // File from the input / camera
  export let aspect = 1;        // width / height of the photo frame on the card
  export let round = false;     // circle frame
  export let maxPx = 700;       // long side of the saved photo

  const dispatch = createEventDispatcher();
  let imgEl;
  let cropper;
  let src = '';
  let ready = false;
  let error = '';

  onMount(async () => {
    src = URL.createObjectURL(file);
    const { default: Cropper } = await import('cropperjs');
    imgEl.onload = () => {
      cropper = new Cropper(imgEl, {
        aspectRatio: aspect,
        viewMode: 1,
        dragMode: 'move',
        autoCropArea: 0.85,
        background: false,
        guides: false,
        center: false,
        toggleDragModeOnDblclick: false,
        ready: () => { ready = true; },
      });
    };
    imgEl.onerror = () => { error = "This photo can't be opened here. Try a JPEG or PNG."; };
    imgEl.src = src;
  });

  onDestroy(() => {
    cropper?.destroy();
    if (src) URL.revokeObjectURL(src);
  });

  function use() {
    if (!cropper) return;
    const w = aspect >= 1 ? maxPx : Math.round(maxPx * aspect);
    const h = aspect >= 1 ? Math.round(maxPx / aspect) : maxPx;
    const canvas = cropper.getCroppedCanvas({ width: w, height: h, fillColor: '#ffffff', imageSmoothingQuality: 'high' });
    if (!canvas) { error = 'Could not crop the photo. Try another one.'; return; }
    dispatch('done', canvas.toDataURL('image/jpeg', 0.85));
  }
</script>

<div class="crop-modal" class:round role="dialog" aria-modal="true" aria-label="Frame the photo">
  <div class="crop-head">
    <strong>Frame the photo</strong>
    <span>Drag to move. Pinch or use + and − to zoom.</span>
  </div>
  <div class="crop-area">
    {#if error}<p class="crop-err">{error}</p>{/if}
    <img bind:this={imgEl} alt="Photo to frame" />
  </div>
  <div class="crop-actions">
    <button class="cbtn ghost" on:click={() => dispatch('cancel')}>Cancel</button>
    <button class="cbtn ghost zoom" on:click={() => cropper?.zoom(-0.1)} disabled={!ready} aria-label="Zoom out">−</button>
    <button class="cbtn ghost zoom" on:click={() => cropper?.zoom(0.1)} disabled={!ready} aria-label="Zoom in">+</button>
    <button class="cbtn ghost" on:click={() => cropper?.rotate(90)} disabled={!ready}>Rotate</button>
    <button class="cbtn primary" on:click={use} disabled={!ready}>Use photo</button>
  </div>
</div>

<style>
  .crop-modal {
    position: fixed; inset: 0; z-index: 1000; background: #111;
    display: grid; grid-template-rows: auto 1fr auto;
    padding: env(safe-area-inset-top, 0px) env(safe-area-inset-right, 0px) env(safe-area-inset-bottom, 0px) env(safe-area-inset-left, 0px);
  }
  .crop-head { color: #fff; padding: 12px 16px; display: grid; gap: 2px; }
  .crop-head span { color: #bbb; font-size: .85rem; }
  .crop-area { min-height: 0; position: relative; }
  .crop-area img { display: block; max-width: 100%; max-height: 100%; }
  .crop-err { color: #ffb4a8; padding: 16px; }
  .crop-actions { display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-end; padding: 12px 16px; background: #1b1b1b; }
  .cbtn { border: 1px solid #444; background: transparent; color: #fff; border-radius: 6px; padding: 12px 16px; font: inherit;
    font-weight: 700; min-height: 44px; cursor: pointer; }
  .cbtn.zoom { min-width: 48px; font-size: 1.2rem; padding: 8px 12px; }
  .cbtn.primary { background: var(--red, #c0392b); border-color: var(--red, #c0392b); }
  .cbtn:disabled { opacity: .5; }
  .round :global(.cropper-view-box), .round :global(.cropper-face) { border-radius: 50%; }
  @media (max-width: 520px) {
    .crop-actions .cbtn.primary { flex: 1 1 100%; order: -1; }
  }
</style>
