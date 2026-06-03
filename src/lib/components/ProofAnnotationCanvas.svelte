<!--
  Reusable annotation canvas for project proofs.

  Displays a JPEG (or PNG) and overlays a drawing canvas the user can
  mark up with: free-draw lines, straight arrows, rectangles, and text
  comment markers. Annotations are stored as vector objects in
  image-pixel coordinates so they scale cleanly across screens.

  Props
    imageUrl       string   — public URL to the proof JPEG
    initial        array    — annotations to render on load
    readonly       boolean  — disable drawing (used for old/closed proofs)
    authorLabel    string   — 'staff' | 'customer' tag attached to new shapes

  Events
    change         e.detail = { annotations: [...] }   fires after every
                              add / undo so the parent can keep it saved.

  Annotation shape
    { type: 'line'|'arrow'|'rect'|'text',
      points: [[x, y], ...],          // in natural image coords
      color, width,
      text?,                           // for type='text'
      author, created_at }
-->
<script>
  import { createEventDispatcher, onDestroy, onMount, tick } from 'svelte';

  export let imageUrl = '';
  export let initial = [];
  export let readonly = false;
  export let authorLabel = 'customer';

  const dispatch = createEventDispatcher();

  let wrapEl;
  let imgEl;
  let canvas;
  let ctx;

  // Natural image size (pixels). Drives the coordinate system.
  let imgW = 0;
  let imgH = 0;
  // Displayed canvas size in CSS pixels (computed from wrap width).
  let dispW = 0;
  let dispH = 0;

  let annotations = [...initial];
  let tool = 'pen';                    // 'pen' | 'arrow' | 'rect' | 'text' | 'select'
  let color = '#dc2626';
  let strokeWidth = 4;

  let drawing = false;
  let currentShape = null;             // shape under construction

  // ─── Resize handling ─────────────────────────────────────────────────────
  function recomputeSize() {
    if (!wrapEl || !imgW || !imgH) return;
    // The img is `width: 100%`, so always size the canvas to the wrapper
    // width regardless of the image's natural width — otherwise a small
    // source image leaves the right side of the rendered image with no
    // overlaid canvas, and clicks there do nothing.
    const cssW = wrapEl.clientWidth || imgW;
    const scale = cssW / imgW;
    dispW = cssW;
    dispH = Math.round(imgH * scale);
    if (canvas) {
      // High-DPI: backing store at devicePixelRatio so lines aren't fuzzy.
      const dpr = window.devicePixelRatio || 1;
      canvas.width  = Math.round(dispW * dpr);
      canvas.height = Math.round(dispH * dpr);
      canvas.style.width  = dispW + 'px';
      canvas.style.height = dispH + 'px';
      ctx = canvas.getContext('2d');
      ctx.setTransform(dpr * dispW / imgW, 0, 0, dpr * dispH / imgH, 0, 0);
      // ↑ One transform converts image-pixel coords → device pixels.
      redraw();
    }
  }

  let ro;
  onMount(() => {
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(recomputeSize);
      ro.observe(wrapEl);
    } else {
      window.addEventListener('resize', recomputeSize);
    }
  });
  onDestroy(() => {
    if (ro) ro.disconnect();
    else if (typeof window !== 'undefined') window.removeEventListener('resize', recomputeSize);
  });

  function onImgLoad() {
    imgW = imgEl.naturalWidth || imgEl.width;
    imgH = imgEl.naturalHeight || imgEl.height;
    // Auto-scale the default stroke width to the image. A 4 px line on a
    // 4000-px-wide QR code disappears when we scale the canvas down to fit
    // a phone (4 * 0.2 = ~1 css px). Aim for ~6 css px regardless of source
    // resolution by picking ~0.6% of the larger image dimension. Capped to
    // a sensible range so 200-px thumbnails aren't drawn with a 1.2 px line
    // and 8000-px posters aren't drawn with a 48 px crayon.
    const target = Math.round(Math.max(imgW, imgH) * 0.006);
    strokeWidth = Math.max(4, Math.min(48, target));
    tick().then(recomputeSize);
  }

  // ─── Coordinate conversion ───────────────────────────────────────────────
  // Pointer events come in CSS px; convert to image-pixel coords for
  // storage so the same shape scales when displayed at a different size.
  function toImgCoords(ev) {
    const rect = canvas.getBoundingClientRect();
    const px = (ev.touches ? ev.touches[0].clientX : ev.clientX) - rect.left;
    const py = (ev.touches ? ev.touches[0].clientY : ev.clientY) - rect.top;
    const sx = imgW / rect.width;
    const sy = imgH / rect.height;
    return [Math.round(px * sx), Math.round(py * sy)];
  }

  // ─── Drawing handlers ────────────────────────────────────────────────────
  function startDraw(ev) {
    if (readonly) return;
    ev.preventDefault();
    const [x, y] = toImgCoords(ev);
    const base = { color, width: strokeWidth, author: authorLabel, created_at: new Date().toISOString() };
    if (tool === 'pen') {
      currentShape = { ...base, type: 'line', points: [[x, y]] };
    } else if (tool === 'arrow') {
      currentShape = { ...base, type: 'arrow', points: [[x, y], [x, y]] };
    } else if (tool === 'rect') {
      currentShape = { ...base, type: 'rect', points: [[x, y], [x, y]] };
    } else if (tool === 'text') {
      // Text creates an immediate prompt + marker — no drag phase.
      const text = window.prompt('Comment:');
      if (text && text.trim()) {
        const shape = { ...base, type: 'text', points: [[x, y]], text: text.trim().slice(0, 280) };
        commit(shape);
      }
      return;
    } else {
      return;
    }
    drawing = true;
    redraw();
  }

  function moveDraw(ev) {
    if (!drawing || !currentShape) return;
    ev.preventDefault();
    const [x, y] = toImgCoords(ev);
    if (currentShape.type === 'line') {
      currentShape.points.push([x, y]);
    } else {
      currentShape.points[1] = [x, y];
    }
    redraw();
  }

  function endDraw(ev) {
    if (!drawing || !currentShape) return;
    drawing = false;
    // Reject zero-size shapes (accidental taps).
    if (currentShape.type !== 'line' && currentShape.type !== 'text') {
      const [[x1, y1], [x2, y2]] = currentShape.points;
      if (Math.hypot(x2 - x1, y2 - y1) < 6) { currentShape = null; redraw(); return; }
    }
    commit(currentShape);
    currentShape = null;
  }

  function commit(shape) {
    annotations = [...annotations, shape];
    dispatch('change', { annotations });
    redraw();
  }

  function undo() {
    if (annotations.length === 0) return;
    annotations = annotations.slice(0, -1);
    dispatch('change', { annotations });
    redraw();
  }

  function clearAll() {
    if (!window.confirm('Clear all your annotations?')) return;
    annotations = [];
    dispatch('change', { annotations });
    redraw();
  }

  // ─── Render ──────────────────────────────────────────────────────────────
  function redraw() {
    if (!ctx) return;
    ctx.clearRect(0, 0, imgW, imgH);
    // Existing committed shapes.
    for (const s of annotations) drawShape(s);
    // In-progress shape on top.
    if (currentShape) drawShape(currentShape);
  }

  function drawShape(s) {
    ctx.strokeStyle = s.color || '#dc2626';
    ctx.fillStyle   = s.color || '#dc2626';
    ctx.lineWidth   = s.width || 3;
    ctx.lineCap     = 'round';
    ctx.lineJoin    = 'round';
    if (s.type === 'line' && s.points?.length > 1) {
      ctx.beginPath();
      ctx.moveTo(s.points[0][0], s.points[0][1]);
      for (let i = 1; i < s.points.length; i++) ctx.lineTo(s.points[i][0], s.points[i][1]);
      ctx.stroke();
    } else if (s.type === 'arrow' && s.points?.length === 2) {
      const [[x1, y1], [x2, y2]] = s.points;
      const dx = x2 - x1, dy = y2 - y1;
      const len = Math.hypot(dx, dy);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      if (len > 4) {
        const ah = Math.max(s.width * 4, 16);                  // arrowhead size in image px
        const ang = Math.atan2(dy, dx);
        ctx.beginPath();
        ctx.moveTo(x2, y2);
        ctx.lineTo(x2 - ah * Math.cos(ang - Math.PI / 7), y2 - ah * Math.sin(ang - Math.PI / 7));
        ctx.lineTo(x2 - ah * Math.cos(ang + Math.PI / 7), y2 - ah * Math.sin(ang + Math.PI / 7));
        ctx.closePath();
        ctx.fill();
      }
    } else if (s.type === 'rect' && s.points?.length === 2) {
      const [[x1, y1], [x2, y2]] = s.points;
      ctx.strokeRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
    } else if (s.type === 'text' && s.points?.length === 1) {
      const [x, y] = s.points[0];
      // Circle marker + text label rendered to the right.
      const r = Math.max(s.width * 4, 18);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = (s.color || '#dc2626') + 'cc';
      ctx.fill();
      ctx.fillStyle = '#fff';
      const fontSize = Math.max(r * 1.0, 14);
      ctx.font = `bold ${fontSize}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('💬', x, y);
      // Text body below the marker, wrapped to ~280 px in image coords.
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillStyle = s.color || '#dc2626';
      ctx.font = `${Math.max(r * 0.9, 12)}px sans-serif`;
      const words = (s.text || '').split(/\s+/);
      const maxWidth = Math.min(320, imgW - x - 10);
      let line = '';
      let yy = y + r + 6;
      for (const w of words) {
        const test = line ? line + ' ' + w : w;
        if (ctx.measureText(test).width > maxWidth && line) {
          ctx.fillText(line, x + r + 6, yy);
          yy += Math.max(r * 0.9, 12) + 2;
          line = w;
        } else { line = test; }
      }
      if (line) ctx.fillText(line, x + r + 6, yy);
    }
  }
</script>

<div class="proof-wrap" bind:this={wrapEl}>
  {#if imageUrl}
    <img
      bind:this={imgEl}
      src={imageUrl}
      alt="Proof"
      class="proof-img"
      on:load={onImgLoad}
    />
    <canvas
      bind:this={canvas}
      class="proof-canvas"
      class:readonly
      on:mousedown={startDraw}
      on:mousemove={moveDraw}
      on:mouseup={endDraw}
      on:mouseleave={endDraw}
      on:touchstart={startDraw}
      on:touchmove={moveDraw}
      on:touchend={endDraw}
    ></canvas>
  {/if}
</div>

{#if !readonly}
  <div class="toolbar">
    <div class="tools">
      <button class="tool-btn" class:active={tool === 'pen'}   on:click={() => tool = 'pen'}   title="Draw">✏️</button>
      <button class="tool-btn" class:active={tool === 'arrow'} on:click={() => tool = 'arrow'} title="Arrow">↗</button>
      <button class="tool-btn" class:active={tool === 'rect'}  on:click={() => tool = 'rect'}  title="Rectangle">▭</button>
      <button class="tool-btn" class:active={tool === 'text'}  on:click={() => tool = 'text'}  title="Comment">💬</button>
    </div>
    <div class="colors">
      {#each ['#dc2626', '#ea580c', '#facc15', '#16a34a', '#0ea5e9', '#1a1a1a'] as c}
        <button
          class="color-swatch"
          class:active={color === c}
          style="background:{c}"
          on:click={() => color = c}
          aria-label="Color {c}"
        ></button>
      {/each}
    </div>
    <div class="actions">
      <button class="tool-btn" on:click={undo} disabled={annotations.length === 0} title="Undo">↶ Undo</button>
      <button class="tool-btn" on:click={clearAll} disabled={annotations.length === 0} title="Clear all">Clear</button>
    </div>
  </div>
{/if}

<style>
  .proof-wrap {
    position: relative;
    width: 100%;
    max-width: 100%;
    margin: 0 auto;
    background: #f1f5f9;
    border-radius: 6px;
    overflow: hidden;
    line-height: 0;
  }
  .proof-img {
    width: 100%;
    height: auto;
    display: block;
    user-select: none;
    -webkit-user-drag: none;
  }
  .proof-canvas {
    position: absolute;
    inset: 0;
    touch-action: none;       /* let us handle pinch / pan */
    cursor: crosshair;
  }
  .proof-canvas.readonly { cursor: default; pointer-events: none; }

  .toolbar {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    align-items: center;
    padding: 12px;
    background: #fff;
    border: 1px solid #e2e8f0;
    border-top: none;
    border-radius: 0 0 6px 6px;
  }
  .tools, .colors, .actions { display: flex; gap: 6px; align-items: center; }
  .tool-btn {
    padding: 8px 12px;
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 6px;
    cursor: pointer;
    font-size: 1rem;
  }
  .tool-btn:hover:not(:disabled) { background: #e2e8f0; }
  .tool-btn.active { background: #c01818; color: #fff; border-color: #c01818; }
  .tool-btn:disabled { opacity: 0.4; cursor: not-allowed; }

  .color-swatch {
    width: 28px; height: 28px; border-radius: 50%;
    border: 2px solid #fff;
    box-shadow: 0 0 0 1px #e2e8f0;
    cursor: pointer;
    padding: 0;
  }
  .color-swatch.active { box-shadow: 0 0 0 2px #1a1a1a; }
</style>
