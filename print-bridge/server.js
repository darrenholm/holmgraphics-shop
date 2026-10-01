// print-bridge/server.js
//
// Relays label-print requests from the Holm Graphics Shop web app to the
// DYMO Connect service running locally on this machine.
//
// Flow:  browser --HTTPS--> (Cloudflare Tunnel or LAN) --HTTP--> this bridge
//          --HTTPS (self-signed)--> DYMO Connect on 127.0.0.1 --USB--> printer

'use strict';
require('dotenv').config();

const express = require('express');
const cors    = require('cors');
const morgan  = require('morgan');
const https   = require('https');
const fetch   = require('node-fetch');
const { spawn } = require('child_process');
const fs      = require('fs');
const os      = require('os');
const path    = require('path');
const crypto  = require('crypto');

const PORT            = Number(process.env.PORT || 41960);
const BIND            = process.env.BIND || '127.0.0.1';
const API_KEY         = process.env.API_KEY || '';
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',').map(s => s.trim()).filter(Boolean);
const DYMO_BASE       = process.env.DYMO_BASE || 'https://127.0.0.1:41951';

if (!API_KEY || API_KEY === 'change-me-to-a-long-random-string') {
  console.error('[bridge] FATAL: API_KEY not configured. Edit .env and set a long random value.');
  process.exit(1);
}

// DYMO Connect uses a self-signed cert for local.dymo.com -> 127.0.0.1.
// Accepting it is safe because we're only talking to loopback.
const dymoAgent = new https.Agent({ rejectUnauthorized: false });

// ---- Express app --------------------------------------------------------
const app = express();
app.use(morgan('tiny'));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
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
  res.json({ ok: true, service: 'holmgraphics-print-bridge', version: '1.0.0' });
});

// ---- DYMO helpers -------------------------------------------------------
async function dymoCheck() {
  const res = await fetch(`${DYMO_BASE}/DYMO/DLS/Printing/Check`, {
    agent: dymoAgent,
    method: 'GET',
    headers: { Accept: 'application/xml' }
  });
  if (!res.ok) throw new Error(`DYMO Connect not reachable (HTTP ${res.status})`);
  return await res.text();
}

async function dymoGetPrintersXml() {
  const res = await fetch(`${DYMO_BASE}/DYMO/DLS/Printing/GetPrinters`, {
    agent: dymoAgent,
    method: 'GET',
    headers: { Accept: 'application/xml' }
  });
  if (!res.ok) throw new Error(`GetPrinters failed (HTTP ${res.status})`);
  return await res.text();
}

async function dymoPrint({ printerName, labelXml, printParamsXml, labelSetXml }) {
  const form = new URLSearchParams();
  form.set('printerName', printerName);
  form.set('printParamsXml', printParamsXml || '');
  form.set('labelXml', labelXml);
  form.set('labelSetXml', labelSetXml || '');
  const res = await fetch(`${DYMO_BASE}/DYMO/DLS/Printing/PrintLabel`, {
    agent: dymoAgent,
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString()
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`PrintLabel failed (HTTP ${res.status}): ${body}`);
  return body;
}

// Very small XML parser for the <Printers>…</Printers> blob DYMO returns.
// Avoids pulling in an XML dependency.
function parsePrintersXml(xml) {
  const printers = [];
  const lwMatches = xml.match(/<LabelWriterPrinter[\s\S]*?<\/LabelWriterPrinter>/g) || [];
  for (const blob of lwMatches) {
    const get = (tag) => {
      const m = blob.match(new RegExp(`<${tag}>([^<]*)</${tag}>`));
      return m ? m[1] : '';
    };
    printers.push({
      name:         get('Name'),
      modelName:    get('ModelName'),
      isConnected:  get('IsConnected').toLowerCase() === 'true',
      isLocal:      get('IsLocal').toLowerCase() === 'true',
      printerType:  'LabelWriterPrinter'
    });
  }
  return printers;
}

// ---- API ----------------------------------------------------------------
app.get('/printers', requireApiKey, async (req, res) => {
  try {
    const xml = await dymoGetPrintersXml();
    const printers = parsePrintersXml(xml);
    res.json({ printers });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

app.post('/print', requireApiKey, async (req, res) => {
  const { printerName, labelXml, copies = 1 } = req.body || {};
  if (!printerName) return res.status(400).json({ error: 'printerName required' });
  if (!labelXml)    return res.status(400).json({ error: 'labelXml required' });

  const printParamsXml = `<?xml version="1.0" encoding="utf-8"?>
<LabelWriterPrintParams>
  <Copies>${Math.max(1, Math.min(500, Number(copies) || 1))}</Copies>
  <JobTitle>Holm Graphics Job Label</JobTitle>
</LabelWriterPrintParams>`;

  try {
    await dymoPrint({ printerName, labelXml, printParamsXml });
    res.json({ ok: true });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// ---- Brother QL-810W (Windows print spooler) ---------------------------
// Brother has no DYMO-Connect-style local service, so these endpoints print
// through the Windows driver instead. The web app renders the label to a PNG
// (QR + text) and posts it here; we hand it to print-brother.ps1, which draws
// it to the named printer N times at the given label size. Uses only built-in
// .NET on the RIP PC — no b-PAC SDK or .lbx template required.

// GET /printers-windows — list installed Windows printers so the app can pick
// the Brother. (The DYMO /printers endpoint above only sees DYMO units.)
app.get('/printers-windows', requireApiKey, (req, res) => {
  const child = spawn('powershell.exe',
    ['-NoProfile', '-Command', 'Get-Printer | Select-Object -ExpandProperty Name']);
  let out = '', err = '';
  child.stdout.on('data', d => out += d);
  child.stderr.on('data', d => err += d);
  child.on('error', e => res.status(500).json({ error: 'failed to launch powershell: ' + e.message }));
  child.on('close', code => {
    if (code !== 0) return res.status(502).json({ error: err.trim() || `powershell exit ${code}` });
    res.json({ printers: out.split(/\r?\n/).map(s => s.trim()).filter(Boolean) });
  });
});

// POST /print-brother — { printerName, imageBase64, copies?, widthMm?, heightMm? }
// imageBase64 is a PNG of the whole label (data URL or bare base64).
app.post('/print-brother', requireApiKey, (req, res) => {
  const { printerName, imageBase64, copies = 1, widthMm = 62, heightMm = 19 } = req.body || {};
  if (!printerName) return res.status(400).json({ error: 'printerName required' });
  if (!imageBase64) return res.status(400).json({ error: 'imageBase64 required' });

  const b64 = String(imageBase64).replace(/^data:image\/\w+;base64,/, '');
  const tmp = path.join(os.tmpdir(), `hglabel-${crypto.randomBytes(6).toString('hex')}.png`);
  try {
    fs.writeFileSync(tmp, Buffer.from(b64, 'base64'));
  } catch (e) {
    return res.status(500).json({ error: 'failed to write temp image: ' + e.message });
  }

  const n = Math.max(1, Math.min(500, Number(copies) || 1));
  const script = path.join(__dirname, 'print-brother.ps1');
  const child = spawn('powershell.exe', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script,
    '-Printer', printerName, '-Image', tmp, '-Copies', String(n),
    '-WidthMm', String(Number(widthMm) || 62), '-HeightMm', String(Number(heightMm) || 19)
  ]);
  let err = '';
  child.stderr.on('data', d => err += d);
  child.on('error', e => {
    fs.unlink(tmp, () => {});
    res.status(500).json({ error: 'failed to launch powershell: ' + e.message });
  });
  child.on('close', code => {
    fs.unlink(tmp, () => {});
    if (code === 0) return res.json({ ok: true, copies: n });
    res.status(502).json({ error: `print failed (exit ${code}): ${err.trim()}` });
  });
});

// ---- Boot ---------------------------------------------------------------
app.listen(PORT, BIND, () => {
  console.log(`[bridge] listening on ${BIND}:${PORT}`);
  console.log(`[bridge] allowed origins: ${ALLOWED_ORIGINS.join(', ') || '(none)'}`);
  console.log(`[bridge] DYMO Connect:   ${DYMO_BASE}`);
});
