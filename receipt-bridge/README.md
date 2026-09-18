# Holm Graphics Receipt Bridge

Small Node.js service that runs on **Design Centre 1** and relays receipt
printing from `shop.holmgraphics.ca` to the **USB-attached receipt printer**.

```
[ browser on shop.holmgraphics.ca ]
         |  HTTPS  (API key in header)
         v
[ Cloudflare Tunnel  ->  bridge on Design Centre 1 (Windows) ]
         |  RAW spool job
         v
[ Windows print queue ]
         |  USB
         v
[ receipt printer ] --RJ11--> [ cash drawer ]
```

## Why it exists

The counter printer is a Bluetooth (SPP) device paired to the POS tablet, so
only the tablet could print. Since the card reader moved to WiFi, a sale can be
started from any desk — and those sales printed nothing.

This bridge prints the **same ESC/POS bytes** the tablet sends over Bluetooth.
That matters: the paper cut and the cash-drawer pulse are codes inside that byte
stream. Printing it any other way (a driver, Notepad, `Out-Printer`) re-renders
it as a picture of text, and the cut and the drawer are silently lost. Hence
`rawprint.ps1`, which spools with the `RAW` datatype via `winspool.drv`.

## One-time setup on Design Centre 1

### 1. Prerequisites

- Receipt printer plugged in by USB and installed in Windows. Confirm the queue
  name:
  ```powershell
  Get-Printer | Select-Object Name
  ```
- **Node.js 18 or newer** — https://nodejs.org

### 2. Install

```cmd
cd C:\tools
git clone <shop repo> holmgraphics-shop
cd holmgraphics-shop\receipt-bridge
npm install
copy .env.example .env
notepad .env
```

Fill in `.env`:

| Setting | What to put |
|---|---|
| `API_KEY` | a long random string — the same value goes into the web app |
| `PRINTER_NAME` | the exact queue name from `Get-Printer` |
| `ALLOWED_ORIGINS` | `https://shop.holmgraphics.ca` |
| `BIND` | `127.0.0.1` behind a Cloudflare Tunnel, `0.0.0.0` for LAN-only use |

### 3. Run it

```cmd
node server.js
```

Then from the same machine:

```cmd
curl http://127.0.0.1:41962/health
```

### 4. Keep it running

Same approach as the files bridge: a **Scheduled Task running as SYSTEM, At
startup**, so it survives a reboot with nobody logged in. Raw spooling works
fine as SYSTEM — unlike the DYMO label bridge, there is no desktop application
involved.

```powershell
schtasks /Create /TN "HG Receipt Bridge" /SC ONSTART /RU SYSTEM /RL HIGHEST ^
  /TR "\"C:\Program Files\nodejs\node.exe\" C:\tools\holmgraphics-shop\receipt-bridge\server.js"
```

### 5. Point the web app at it

On each machine that should print: **POS → Receipt printing from this computer**
→ enter the bridge address and key → **Check** → pick the printer → **Test
receipt**.

The tablet needs none of this; it keeps its direct Bluetooth link, which works
even when Design Centre 1 is off.

## Endpoints

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/health` | — | `{ ok, service, host, defaultPrinter }` (no auth) |
| GET | `/printers` | — | `{ printers: ["..."] }` |
| POST | `/print-raw` | `{ dataBase64, printerName?, copies? }` | `{ ok: true, bytes, copies }` |

`dataBase64` is a complete ESC/POS stream, built by `src/lib/pos/escpos.js` in
the web app. Receipts over 512 KB are refused — at that size it is a bug, not a
receipt.

## When it doesn't print

1. **`/health` unreachable** — the task isn't running, or the tunnel is down.
2. **Prints gibberish** — something is rendering rather than spooling raw.
   Check `rawprint.ps1` is the path being used.
3. **Prints but the drawer stays shut** — expected on card sales and cheques;
   only cash opens it. Use the No Sale button to test the drawer on its own.
4. **"Could not open printer"** — the queue name in `.env` doesn't match
   `Get-Printer` exactly, spaces included.
