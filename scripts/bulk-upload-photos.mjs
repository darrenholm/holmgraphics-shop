#!/usr/bin/env node
// scripts/bulk-upload-photos.mjs
//
// Bulk-upload images from a local folder to the shop API.
// Used for the one-time WebsitePhotos2025 import. Everything lands on one
// "staging" project; reassign to real jobs later.
//
// Requirements: Node 18+ (uses native fetch + FormData + File).
//
// Usage (PowerShell):
//   node scripts/bulk-upload-photos.mjs `
//     --api   https://api.holmgraphics.ca/api `
//     --email darren@holmgraphics.ca `
//     --password "YOUR_PASSWORD" `
//     --project-id 9999 `
//     --category signs_led `
//     --source "\\LS220D146\share\ClientFilesA-K\Holm Graphics Inc\WebsitePhotos2025" `
//     [--dry-run]
//
// Flags:
//   --api          Backend API base URL (must end with /api). Required.
//   --email        Login email.                                 Required.
//   --password     Login password.                              Required.
//   --project-id   Target project id (the "staging" job).       Required.
//   --category     One of: signs_led | vehicle_wraps | apparel | printing | other
//                  Default: other.
//   --source       Folder to scan. Top-level only, no recursion. Required.
//   --batch-size   Files per POST (API caps at 20). Default: 10.
//   --dry-run      List what would upload, don't actually upload.
//
// The API's POST /api/projects/:id/photos only accepts jpg|jpeg|png|gif|webp
// and caps each file at 20 MB. This script filters to those extensions and
// skips anything larger, printing a warning for each skip.

import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { createInterface, emitKeypressEvents } from 'node:readline';

// ─── arg parsing ─────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      out[key] = true;
    } else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

const args = parseArgs(process.argv);
const API       = (args.api || process.env.HOLM_API || '').replace(/\/$/, '');
const EMAIL     = args.email || process.env.HOLM_EMAIL;
let   PASSWORD  = args.password || process.env.HOLM_PASSWORD;
const PROJECT   = parseInt(args['project-id'] || process.env.HOLM_PROJECT_ID, 10);
const CATEGORY  = (args.category || process.env.HOLM_CATEGORY || 'other').toLowerCase();
const SOURCE    = args.source || process.env.HOLM_SOURCE;
const BATCH     = Math.max(1, Math.min(20, parseInt(args['batch-size'] || '10', 10)));
const DRY       = !!args['dry-run'];

const VALID_CATEGORIES = ['signs_led', 'vehicle_wraps', 'apparel', 'printing', 'other'];
const VALID_EXT = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp']);
const MAX_BYTES = 20 * 1024 * 1024;

function die(msg) {
  console.error(`ERROR: ${msg}`);
  process.exit(1);
}

if (!API)                     die('--api (or $env:HOLM_API) is required');
if (!EMAIL)                   die('--email (or $env:HOLM_EMAIL) is required');
if (!Number.isInteger(PROJECT)) die('--project-id (or $env:HOLM_PROJECT_ID) must be an integer');
if (!SOURCE)                  die('--source (or $env:HOLM_SOURCE) is required');
if (!VALID_CATEGORIES.includes(CATEGORY)) {
  die(`--category must be one of: ${VALID_CATEGORIES.join(', ')}`);
}

// ─── password prompt (hidden input) ──────────────────────────────────────────
async function promptPassword(prompt) {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    const stdout = process.stdout;
    stdout.write(prompt);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let buf = '';
    const onData = (ch) => {
      if (ch === '\r' || ch === '\n' || ch === '\u0004') {
        stdin.setRawMode(false);
        stdin.pause();
        stdin.removeListener('data', onData);
        stdout.write('\n');
        resolve(buf);
      } else if (ch === '\u0003') {
        // Ctrl+C
        stdout.write('\n');
        process.exit(130);
      } else if (ch === '\u007f' || ch === '\b') {
        buf = buf.slice(0, -1);
      } else {
        buf += ch;
      }
    };
    stdin.on('data', onData);
  });
}

// ─── main ────────────────────────────────────────────────────────────────────
async function login() {
  const r = await fetch(`${API}/auth/login`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!r.ok) die(`Login failed: ${r.status} ${await r.text()}`);
  const { token } = await r.json();
  if (!token) die('Login did not return a token.');
  return token;
}

async function listFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const e of entries) {
    if (!e.isFile()) continue;
    const ext = extname(e.name).toLowerCase();
    if (!VALID_EXT.has(ext)) continue;
    const full = join(dir, e.name);
    const s = await stat(full);
    if (s.size > MAX_BYTES) {
      console.warn(`SKIP (>20MB): ${e.name} (${(s.size / 1024 / 1024).toFixed(1)} MB)`);
      continue;
    }
    files.push({ path: full, name: e.name, size: s.size });
  }
  return files;
}

async function uploadBatch(token, batch) {
  const fd = new FormData();
  fd.append('category', CATEGORY);
  for (const f of batch) {
    const buf = await readFile(f.path);
    // Node 18+ has a global File class; fall back to Blob with filename metadata.
    const blob = typeof File !== 'undefined'
      ? new File([buf], f.name)
      : new Blob([buf]);
    fd.append('photos', blob, f.name);
  }
  const r = await fetch(`${API}/projects/${PROJECT}/photos`, {
    method:  'POST',
    headers: { Authorization: `Bearer ${token}` },
    body:    fd,
  });
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`HTTP ${r.status}: ${txt}`);
  }
  return r.json();
}

async function main() {
  console.log('');
  console.log(`API:         ${API}`);
  console.log(`User:        ${EMAIL}`);
  console.log(`Project id:  ${PROJECT}`);
  console.log(`Category:    ${CATEGORY}`);
  console.log(`Source dir:  ${SOURCE}`);
  console.log(`Batch size:  ${BATCH}`);
  console.log(`Dry run:     ${DRY}`);
  console.log('');

  const files = await listFiles(SOURCE);
  console.log(`Found ${files.length} eligible image(s) in top level of source folder.\n`);
  if (files.length === 0) return;

  if (DRY) {
    for (const f of files) {
      console.log(`  [DRY] would upload: ${f.name} (${(f.size / 1024).toFixed(0)} KB)`);
    }
    console.log(`\nDry run complete. ${files.length} file(s) would have been uploaded.`);
    return;
  }

  if (!PASSWORD) {
    PASSWORD = await promptPassword('Password: ');
    if (!PASSWORD) die('Password required.');
  }
  const token = await login();
  console.log('Logged in.\n');

  let ok = 0, failed = 0;
  for (let i = 0; i < files.length; i += BATCH) {
    const batch = files.slice(i, i + BATCH);
    const label = `[${i + 1}-${i + batch.length}/${files.length}]`;
    try {
      const res = await uploadBatch(token, batch);
      ok += batch.length;
      console.log(`${label} ok  (${res.message || 'uploaded'})`);
    } catch (e) {
      failed += batch.length;
      console.error(`${label} FAIL  ${e.message}`);
      for (const f of batch) console.error(`    - ${f.name}`);
    }
  }

  console.log('');
  console.log(`Done. ${ok} uploaded, ${failed} failed.`);
  if (failed > 0) process.exit(2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
