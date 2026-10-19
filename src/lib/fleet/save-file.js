// Save a fetched fleet document to the device.
//
// Phones block window.open() once a fetch has run (the tap's "user gesture"
// is gone), and iOS won't open blob: URLs in a new tab reliably. An <a download>
// click works on iOS Safari, Android Chrome and desktop, so every "Download"
// button goes through here.

const EXT = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic'
};

export function docFilename(label, mime) {
  const base = String(label || 'document')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'document';
  return `${base}.${EXT[mime] || 'pdf'}`;
}

export function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the browser time to start the save before freeing the blob.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
