// receipt-bridge/server.js
//
// Relays receipt printing from the Holm Graphics Shop web app to the USB
// receipt printer on this machine (Design Centre 1).
//
// Flow:  browser --HTTPS--> (Cloudflare Tunnel or LAN) --HTTP--> this bridge
//          --RAW spool--> Windows print queue --USB--> receipt printer
//
// Why this exists: the counter printer used to be reachable only over
// Bluetooth from the POS tablet, so a sale taken on any other machine printed
// nothing. Now the card reader is on WiFi and a sale can be started from any
// desk, which left the receipt behind. This closes that gap.
//
// It prints RAW. The data is a finished ESC/POS byte stream built by the web
// app (src/lib/pos/escpos.js) — the same bytes the tablet sends over
// Bluetooth — so the layout, the cut and the cash-drawer pulse all behave
// identically no matter which machine started the sale. A Windows driver
// would re-render it as a graphic and the drawer would never open.

'use strict';
require('dotenv').config();

const express = require('express');
const cors    = require('cors');
const morgan  = require('morgan');
const { execFile } = require('child_process');
const path    = require('path');
const fs      = require('fs');
const os      = require('os');
const crypto  = require('crypto');

const PORT    = Number(process.env.PORT || 41962);
const BIND    = process.env.BIND || '127.0.0.1';
const API_KEY = process.env.API_KEY || '';
const DEFAULT_PRINTER = process.env.PRINTER_NAME || '';
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',').map(s => s.trim()).filter(Boolean);

// Receipts are small. A megabyte of "receipt" is a bug or an attack, and
// either way it should not reach the spooler.
const MAX_BYTES = 512 * 1024;

if (!API_KEY || API_KEY === 'change-me-to-a-long-random-string') {
  console.error('[receipt-bridge] FATAL: API_KEY not configured. Edit .env and set a long random value.');
  process.exit(1);
}

const RAW_PRINT_PS1 = path.join(__dirname, 'rawprint.ps1');

const app = express();
app.use(morgan('tiny'));
app.use(express.json({ limit: '2mb' }));
app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    return cb(new Error(`Origin ${origin} not allowed`));
  }
}));

function requireApiKey(req, res, next) {
  const auth  = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (token !== API_KEY) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

// Unauthenticated, like the label bridge: it says the service is alive and
// nothing about what it can print.
app.get('/health', (req, res) => {
  res.json({ ok: true, service: 'holmgraphics-receipt-bridge', version: '1.0.0',
             host: os.hostname(), defaultPrinter: DEFAULT_PRINTER || null });
});

function powershell(args) {
  return new Promise((resolve, reject) => {
    execFile('powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', ...args],
      { windowsHide: true, timeout: 30_000, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) return reject(new Error((stderr || err.message || '').trim()));
        resolve((stdout || '').trim());
      });
  });
}

// So whoever is setting this up can see the exact queue name to configure,
// rather than guessing at how Windows spelled the printer.
app.get('/printers', requireApiKey, async (req, res) => {
  try {
    const out = await powershell(['-Command',
      'Get-Printer | Select-Object -ExpandProperty Name']);
    res.json({ printers: out ? out.split(/\r?\n/).map(s => s.trim()).filter(Boolean) : [] });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// ─── POST /print-raw ─────────────────────────────────────────────────────────
// { dataBase64, printerName?, copies? }
//
// dataBase64 is a complete ESC/POS stream, cut and drawer pulse included.
app.post('/print-raw', requireApiKey, async (req, res) => {
  const printerName = String(req.body?.printerName || DEFAULT_PRINTER || '').trim();
  const dataBase64  = String(req.body?.dataBase64 || '');
  const copies      = Math.min(Math.max(Number.parseInt(req.body?.copies, 10) || 1, 1), 5);

  if (!printerName) return res.status(400).json({ error: 'No printer configured. Set PRINTER_NAME in .env or pass printerName.' });
  if (!dataBase64)  return res.status(400).json({ error: 'dataBase64 is required' });

  let bytes;
  try {
    bytes = Buffer.from(dataBase64, 'base64');
  } catch {
    return res.status(400).json({ error: 'dataBase64 is not valid base64' });
  }
  if (!bytes.length)          return res.status(400).json({ error: 'Nothing to print' });
  if (bytes.length > MAX_BYTES) return res.status(413).json({ error: 'Receipt too large' });

  // Via a temp file rather than stdin: PowerShell mangles binary on the way
  // in, and a receipt that loses a byte loses its cut or its drawer pulse.
  const tmp = path.join(os.tmpdir(), `hg-receipt-${crypto.randomBytes(6).toString('hex')}.bin`);
  try {
    fs.writeFileSync(tmp, bytes);
    for (let i = 0; i < copies; i++) {
      await powershell(['-File', RAW_PRINT_PS1, '-PrinterName', printerName, '-Path', tmp]);
    }
    res.json({ ok: true, bytes: bytes.length, copies, printerName });
  } catch (err) {
    console.error('[receipt-bridge] print failed:', err.message);
    res.status(502).json({ error: err.message });
  } finally {
    fs.unlink(tmp, () => {});
  }
});

app.listen(PORT, BIND, () => {
  console.log(`[receipt-bridge] listening on http://${BIND}:${PORT}`);
  console.log(`[receipt-bridge] default printer: ${DEFAULT_PRINTER || '(none set)'}`);
});
