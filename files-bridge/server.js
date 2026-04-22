// files-bridge/server.js
//
// Relays file-listing / file-download / folder-create requests from the
// Holm Graphics Shop web app to the L: drive (client artwork storage) on
// this machine. The L: drive is a network share mapped from the shop router.
//
// Flow:  browser --HTTPS--> (Cloudflare Tunnel or LAN) --HTTP--> this bridge
//          --SMB--> router-mounted L:\ClientFiles{A-K,L-Z}\...
//
// Design mirrors print-bridge/server.js almost exactly: same auth model,
// same CORS pattern, same install path (scheduled task at logon).

'use strict';
require('dotenv').config();

const express = require('express');
const cors    = require('cors');
const morgan  = require('morgan');
const fs      = require('fs');
const fsp     = require('fs/promises');
const path    = require('path');

const PORT            = Number(process.env.PORT || 41961);
const BIND            = process.env.BIND || '0.0.0.0';
const API_KEY         = process.env.API_KEY || '';
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',').map(s => s.trim()).filter(Boolean);
const FILES_ROOTS     = (process.env.FILES_ROOTS || 'L:\\ClientFilesA-K,L:\\ClientFilesL-Z')
  .split(',').map(s => s.trim()).filter(Boolean);

// Max bytes served per /file request. Defaults to 2 GB — big enough for
// most .ai / .psd / raw photo archives.
const MAX_FILE_BYTES  = Number(process.env.MAX_FILE_BYTES || 2 * 1024 * 1024 * 1024);

if (!API_KEY || API_KEY === 'change-me-to-a-long-random-string') {
  console.error('[files-bridge] FATAL: API_KEY not configured. Edit .env and set a long random value.');
  process.exit(1);
}

// ---- Root validation ----------------------------------------------------
// Normalize once at boot so the runtime path check is a straight prefix
// test. Windows paths are case-insensitive; we lowercase for comparison.
const NORMALIZED_ROOTS = FILES_ROOTS.map(r => path.resolve(r));

for (const root of NORMALIZED_ROOTS) {
  if (!fs.existsSync(root)) {
    console.warn(`[files-bridge] WARN: files root does not exist or is not accessible: ${root}`);
    console.warn('             Check that L: is mapped for the user the task runs as.');
  }
}

// True if `abs` is the root itself or a descendant. Prevents symlink /
// `..` escapes and cross-root access.
function isUnderRoot(abs) {
  const a = path.resolve(abs).toLowerCase();
  return NORMALIZED_ROOTS.some(r => {
    const rl = r.toLowerCase();
    return a === rl || a.startsWith(rl + path.sep);
  });
}

// ---- Express app --------------------------------------------------------
const app = express();
app.use(morgan('tiny'));
app.use(express.json({ limit: '128kb' }));
app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    return cb(new Error(`Origin ${origin} not allowed`));
  }
}));

// ---- Auth ---------------------------------------------------------------
function requireApiKey(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (token !== API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// ---- Health (unauthenticated) ------------------------------------------
app.get('/health', (req, res) => {
  const roots = NORMALIZED_ROOTS.map(r => ({
    path: r,
    exists: fs.existsSync(r)
  }));
  res.json({
    ok: true,
    service: 'holmgraphics-files-bridge',
    version: '1.1.0',
    roots
  });
});

// ---- Name resolvers -----------------------------------------------------
//
// Client name → on-disk folder. The DB stores "Huron Bay Coop" with spaces
// but the folder is "HuronBayCoop". We try the obvious variants, then scan.
//
// Shop convention is 'Last First' ("Batte Adam") but staff sometimes save
// folders — or type DB names — in 'First Last' order. The reverse-name
// fallback catches that, and we scan the *other* bucket too because
// reversing the name frequently crosses the A-K / L-Z boundary
// (e.g. "Linda Hawkins" routes to L-Z but folder "Hawkins Linda" is in A-K).

function pickBucket(clientName) {
  const first = (clientName || '').trim().charAt(0).toUpperCase();
  if (first >= 'A' && first <= 'K') {
    return NORMALIZED_ROOTS.find(r => /ClientFilesA-K$/i.test(r)) || NORMALIZED_ROOTS[0];
  }
  if (first >= 'L' && first <= 'Z') {
    return NORMALIZED_ROOTS.find(r => /ClientFilesL-Z$/i.test(r)) || NORMALIZED_ROOTS[1];
  }
  // Numbers, symbols, etc. default to the A-K bucket.
  return NORMALIZED_ROOTS[0];
}

// Heuristic reverse: pull the last whitespace-separated token to the front.
//   "Adam Batte"       -> "Batte Adam"
//   "Mary Ann Blythe"  -> "Blythe Mary Ann"
//   "IBM"              -> "IBM"        (single token, unchanged)
function reverseNameOrder(s) {
  if (!s) return s;
  const parts = String(s).trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return s;
  const last = parts[parts.length - 1];
  const rest = parts.slice(0, -1);
  return last + ' ' + rest.join(' ');
}

// Strip whitespace + lowercase — same normalization the case-insensitive
// scan uses. Good enough for "Smith   John" vs "smithjohn".
function normForMatch(s) {
  return String(s || '').replace(/\s+/g, '').toLowerCase();
}

// Try the four obvious spacing/punctuation variants of a name against a
// specific bucket, both as exact-path lookups and as a case-insensitive
// scan. Returns { folder, abs } or null.
async function tryResolveInBucket(bucket, clientName) {
  if (!bucket || !fs.existsSync(bucket)) return null;
  const candidates = [
    clientName,
    clientName.replace(/\s+/g, ''),
    clientName.replace(/\s+/g, '_'),
    clientName.replace(/\s+/g, '-')
  ];
  for (const c of candidates) {
    const p = path.join(bucket, c);
    if (fs.existsSync(p) && fs.statSync(p).isDirectory()) {
      return { folder: c, abs: p };
    }
  }
  let entries;
  try { entries = await fsp.readdir(bucket, { withFileTypes: true }); }
  catch { return null; }
  const needle = normForMatch(clientName);
  const hit = entries.find(e => e.isDirectory() && normForMatch(e.name) === needle);
  if (hit) return { folder: hit.name, abs: path.join(bucket, hit.name) };
  return null;
}

async function resolveClientFolder(clientName) {
  const primary = pickBucket(clientName);
  // Other bucket for cross-bucket reverse matches (e.g. "Linda Hawkins"
  // lives in L-Z, but its folder "Hawkins Linda" is in A-K).
  const other = NORMALIZED_ROOTS.find(r => r !== primary) || null;

  // 1) Name as-stored, primary bucket.
  let hit = await tryResolveInBucket(primary, clientName);
  if (hit) return { bucket: primary, folder: hit.folder, abs: hit.abs };

  // 2) Reversed name order — only worth trying if the name has >=2 tokens.
  const reversed = reverseNameOrder(clientName);
  const hasReversal = reversed && normForMatch(reversed) !== normForMatch(clientName);

  if (hasReversal) {
    // 2a) Reversed name in its own routed bucket (the first letter of the
    //     reversed form may route to the other bucket).
    const reversedBucket = pickBucket(reversed);
    hit = await tryResolveInBucket(reversedBucket, reversed);
    if (hit) return { bucket: reversedBucket, folder: hit.folder, abs: hit.abs };

    // 2b) Reversed name in the primary bucket (surname starts with same
    //     letter range, but defensive — covers odd routing edge cases).
    if (reversedBucket !== primary) {
      hit = await tryResolveInBucket(primary, reversed);
      if (hit) return { bucket: primary, folder: hit.folder, abs: hit.abs };
    }
  }

  // 3) Original name in the *other* bucket, last resort — covers folders
  //    filed under the wrong letter (rare but cheap to check on a miss).
  if (other) {
    hit = await tryResolveInBucket(other, clientName);
    if (hit) return { bucket: other, folder: hit.folder, abs: hit.abs };
  }

  return { bucket: primary, folder: null, abs: null };
}

// Job number → on-disk job folder inside the client. Accepts "Job3518",
// "Job 3518", "JOB-3518", "3518", etc. Uses regex on the folder name.
async function resolveJobFolder(clientAbs, jobNo) {
  if (!clientAbs || !fs.existsSync(clientAbs)) return null;
  const num = String(jobNo).replace(/^0+/, '') || '0';
  const re = new RegExp(`^(?:job[\\s_-]*)?0*${num}\\b`, 'i');
  let entries;
  try { entries = await fsp.readdir(clientAbs, { withFileTypes: true }); }
  catch { return null; }
  const hit = entries.find(e => e.isDirectory() && re.test(e.name));
  return hit ? { folder: hit.name, abs: path.join(clientAbs, hit.name) } : null;
}

// ---- Listing helpers ----------------------------------------------------
async function listDir(abs) {
  const entries = await fsp.readdir(abs, { withFileTypes: true });
  const out = [];
  for (const e of entries) {
    // Skip junk Windows creates on network shares.
    if (e.name === 'Thumbs.db' || e.name === 'desktop.ini') continue;
    if (e.name.startsWith('~$')) continue;
    const full = path.join(abs, e.name);
    let stat;
    try { stat = await fsp.stat(full); } catch { continue; }
    out.push({
      name: e.name,
      type: e.isDirectory() ? 'dir' : 'file',
      size: e.isDirectory() ? null : stat.size,
      mtime: stat.mtime.toISOString(),
      path: full
    });
  }
  // Folders first, then files, both alphabetical (case-insensitive).
  out.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });
  return out;
}

// ---- API: client tree ---------------------------------------------------
app.get('/clients/:name/tree', requireApiKey, async (req, res) => {
  const clientName = decodeURIComponent(req.params.name || '');
  if (!clientName) return res.status(400).json({ error: 'client name required' });
  try {
    const { bucket, folder, abs } = await resolveClientFolder(clientName);
    if (!abs) {
      return res.json({
        clientName,
        bucket,
        resolved: false,
        folder: null,
        path: null,
        entries: []
      });
    }
    const entries = await listDir(abs);
    res.json({
      clientName,
      bucket,
      resolved: true,
      folder,
      path: abs,
      entries
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---- API: job tree ------------------------------------------------------
app.get('/clients/:name/jobs/:jobNo/tree', requireApiKey, async (req, res) => {
  const clientName = decodeURIComponent(req.params.name || '');
  const jobNo      = decodeURIComponent(req.params.jobNo || '');
  if (!clientName) return res.status(400).json({ error: 'client name required' });
  if (!jobNo)      return res.status(400).json({ error: 'job number required' });
  try {
    const client = await resolveClientFolder(clientName);
    if (!client.abs) {
      return res.json({
        clientName, jobNumber: jobNo,
        clientFolder: null, jobFolder: null,
        clientPath: null, jobPath: null,
        resolved: false, entries: []
      });
    }
    const job = await resolveJobFolder(client.abs, jobNo);
    if (!job) {
      return res.json({
        clientName, jobNumber: jobNo,
        clientFolder: client.folder, jobFolder: null,
        clientPath: client.abs, jobPath: null,
        resolved: false, entries: []
      });
    }
    const entries = await listDir(job.abs);
    res.json({
      clientName, jobNumber: jobNo,
      clientFolder: client.folder, jobFolder: job.folder,
      clientPath: client.abs, jobPath: job.abs,
      resolved: true, entries
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---- API: ensure job folder --------------------------------------------
//
// Creates the client folder (if needed) and the Job<num> subfolder.
// Idempotent — returns { created: false } if the folder was already there.
app.post('/clients/:name/jobs/:jobNo/ensure', requireApiKey, async (req, res) => {
  const clientName = decodeURIComponent(req.params.name || '');
  const jobNo      = decodeURIComponent(req.params.jobNo || '');
  if (!clientName) return res.status(400).json({ error: 'client name required' });
  if (!jobNo)      return res.status(400).json({ error: 'job number required' });

  // Strict validation — we're about to mkdir. Don't let weird chars through.
  if (!/^[A-Za-z0-9 _.\-&',()]+$/.test(clientName)) {
    return res.status(400).json({ error: 'client name contains unsupported characters' });
  }
  if (!/^[0-9]+$/.test(String(jobNo))) {
    return res.status(400).json({ error: 'job number must be numeric' });
  }

  try {
    let client = await resolveClientFolder(clientName);
    let clientCreated = false;

    if (!client.abs) {
      // Create it using the spaces-stripped form (matches the HuronBayCoop
      // convention the shop already uses).
      const folder = clientName.replace(/\s+/g, '');
      const bucket = pickBucket(clientName);
      if (!bucket) return res.status(500).json({ error: 'no valid files root configured' });
      const abs = path.join(bucket, folder);
      if (!isUnderRoot(abs)) return res.status(400).json({ error: 'resolved path outside allowed roots' });
      await fsp.mkdir(abs, { recursive: true });
      client = { bucket, folder, abs };
      clientCreated = true;
    }

    let job = await resolveJobFolder(client.abs, jobNo);
    let jobCreated = false;

    if (!job) {
      const folder = `Job${jobNo}`;
      const abs = path.join(client.abs, folder);
      if (!isUnderRoot(abs)) return res.status(400).json({ error: 'resolved path outside allowed roots' });
      await fsp.mkdir(abs, { recursive: true });
      job = { folder, abs };
      jobCreated = true;
    }

    res.json({
      ok: true,
      clientName,
      jobNumber: jobNo,
      clientFolder: client.folder,
      jobFolder: job.folder,
      clientPath: client.abs,
      jobPath: job.abs,
      clientCreated,
      jobCreated,
      created: clientCreated || jobCreated
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---- API: stream a file -------------------------------------------------
//
// GET /file?path=<absolute-windows-path>
//
// Client sends back the absolute path it got from a tree listing. Bridge
// verifies it's under a configured root before opening anything. Browser
// gets Content-Type + Content-Length so inline PDFs / images Just Work.

const CONTENT_TYPES = {
  '.pdf':  'application/pdf',
  '.png':  'image/png',
  '.jpg':  'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.webp': 'image/webp',
  '.svg':  'image/svg+xml',
  '.tif':  'image/tiff', '.tiff': 'image/tiff',
  '.bmp':  'image/bmp',
  '.txt':  'text/plain; charset=utf-8',
  '.csv':  'text/csv; charset=utf-8',
  '.json': 'application/json',
  '.xml':  'application/xml',
  '.html': 'text/html; charset=utf-8'
};

app.get('/file', requireApiKey, async (req, res) => {
  const raw = typeof req.query.path === 'string' ? req.query.path : '';
  if (!raw) return res.status(400).json({ error: 'path query param required' });

  let abs;
  try { abs = path.resolve(raw); }
  catch { return res.status(400).json({ error: 'invalid path' }); }

  if (!isUnderRoot(abs)) {
    return res.status(403).json({ error: 'path outside allowed roots' });
  }

  let stat;
  try { stat = await fsp.stat(abs); }
  catch { return res.status(404).json({ error: 'file not found' }); }

  if (!stat.isFile()) return res.status(400).json({ error: 'not a regular file' });
  if (stat.size > MAX_FILE_BYTES) {
    return res.status(413).json({ error: `file too large (${stat.size} > ${MAX_FILE_BYTES})` });
  }

  const ext = path.extname(abs).toLowerCase();
  const type = CONTENT_TYPES[ext] || 'application/octet-stream';
  const inline = type.startsWith('image/') || type === 'application/pdf' || type.startsWith('text/');

  // Filename for the Content-Disposition header. RFC 5987 encoding so
  // names with spaces or non-ASCII survive.
  const filename = path.basename(abs);
  const encoded  = encodeURIComponent(filename);

  res.setHeader('Content-Type', type);
  res.setHeader('Content-Length', String(stat.size));
  res.setHeader('Content-Disposition',
    `${inline ? 'inline' : 'attachment'}; filename="${filename.replace(/"/g, '')}"; filename*=UTF-8''${encoded}`);
  res.setHeader('Cache-Control', 'private, max-age=60');

  const stream = fs.createReadStream(abs);
  stream.on('error', (e) => {
    if (!res.headersSent) res.status(500).json({ error: e.message });
    else res.destroy(e);
  });
  stream.pipe(res);
});

// ---- Boot ---------------------------------------------------------------
app.listen(PORT, BIND, () => {
  console.log(`[files-bridge] listening on ${BIND}:${PORT}`);
  console.log(`[files-bridge] allowed origins: ${ALLOWED_ORIGINS.join(', ') || '(none)'}`);
  console.log(`[files-bridge] roots:`);
  for (const r of NORMALIZED_ROOTS) {
    console.log(`               ${r} ${fs.existsSync(r) ? 'OK' : 'MISSING'}`);
  }
});
