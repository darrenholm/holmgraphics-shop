<!-- src/routes/tv-display/image/+page.svelte -->
<!-- Simple fullscreen image display for artwork verification on TV -->

<script>
  import { onMount } from 'svelte';

  let imageUrl = '';
  let imageFile = null;
  let dragOver = false;
  let showUpload = true;
  let displayMode = 'fit'; // 'fit' or 'fill'

  onMount(() => {
    // Check if there's a query parameter for image URL
    const params = new URLSearchParams(window.location.search);
    const urlParam = params.get('url');
    if (urlParam) {
      imageUrl = urlParam;
      showUpload = false;
    }
  });

  function handleFileSelect(e) {
    const file = e.target.files?.[0];
    if (file) {
      imageFile = file;
      const reader = new FileReader();
      reader.onload = (event) => {
        imageUrl = event.target?.result;
        showUpload = false;
      };
      reader.readAsDataURL(file);
    }
  }

  function handleDragOver(e) {
    e.preventDefault();
    dragOver = true;
  }

  function handleDragLeave() {
    dragOver = false;
  }

  function handleDrop(e) {
    e.preventDefault();
    dragOver = false;
    const file = e.dataTransfer?.files?.[0];
    if (file && file.type.startsWith('image/')) {
      imageFile = file;
      const reader = new FileReader();
      reader.onload = (event) => {
        imageUrl = event.target?.result;
        showUpload = false;
      };
      reader.readAsDataURL(file);
    }
  }

  function goBack() {
    imageUrl = '';
    showUpload = true;
  }

  function toggleMode() {
    displayMode = displayMode === 'fit' ? 'fill' : 'fit';
  }
</script>

<svelte:head>
  <title>Artwork Display</title>
</svelte:head>

<div class="container">
  {#if showUpload}
    <div
      class="upload-area"
      class:drag-over={dragOver}
      on:dragover={handleDragOver}
      on:dragleave={handleDragLeave}
      on:drop={handleDrop}
    >
      <div class="upload-content">
        <div class="icon">📷</div>
        <h1>Upload Artwork</h1>
        <p>Drag & drop an image or click to select</p>
        <input
          type="file"
          accept="image/*"
          on:change={handleFileSelect}
          class="hidden-input"
          id="file-input"
        />
        <label for="file-input" class="upload-button">
          Select Image
        </label>
      </div>
    </div>
  {:else}
    <div class="display-area" class:fill={displayMode === 'fill'}>
      <img src={imageUrl} alt="Artwork" class:fit={displayMode === 'fit'} />

      <div class="controls">
        <button class="control-btn" on:click={toggleMode} title="Toggle fit/fill">
          {displayMode === 'fit' ? '🔲 Fit' : '🖼️ Fill'}
        </button>
        <button class="control-btn" on:click={goBack} title="Back to upload">
          ← Back
        </button>
      </div>
    </div>
  {/if}
</div>

<style>
  :global(body) {
    margin: 0;
    padding: 0;
    background: #000;
    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
    overflow: hidden;
  }

  .container {
    width: 100vw;
    height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #000;
  }

  .upload-area {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    background: linear-gradient(135deg, #1e1e1e 0%, #2a2a2a 100%);
    border: 3px dashed #555;
    cursor: pointer;
    transition: all 0.3s ease;
  }

  .upload-area.drag-over {
    background: linear-gradient(135deg, #3b82f6 0%, #1e40af 100%);
    border-color: #60a5fa;
  }

  .upload-content {
    text-align: center;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 30px;
  }

  .icon {
    font-size: 80px;
  }

  .upload-content h1 {
    margin: 0;
    font-size: 48px;
    color: #fff;
  }

  .upload-content p {
    margin: 0;
    font-size: 28px;
    color: #bbb;
  }

  .hidden-input {
    display: none;
  }

  .upload-button {
    background: #3b82f6;
    color: white;
    padding: 20px 50px;
    font-size: 24px;
    border-radius: 8px;
    cursor: pointer;
    border: none;
    font-weight: 600;
    transition: background 0.3s ease;
  }

  .upload-button:hover {
    background: #2563eb;
  }

  .display-area {
    width: 100%;
    height: 100%;
    position: relative;
    background: #000;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .display-area img {
    max-width: 95%;
    max-height: 95%;
    object-fit: contain;
  }

  .display-area img.fit {
    object-fit: contain;
  }

  .display-area.fill img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .controls {
    position: absolute;
    bottom: 30px;
    right: 30px;
    display: flex;
    gap: 15px;
  }

  .control-btn {
    background: rgba(59, 130, 246, 0.9);
    color: white;
    border: none;
    padding: 15px 25px;
    font-size: 18px;
    border-radius: 6px;
    cursor: pointer;
    font-weight: 600;
    transition: background 0.3s ease;
    backdrop-filter: blur(10px);
  }

  .control-btn:hover {
    background: rgba(37, 99, 235, 0.95);
  }
</style>
