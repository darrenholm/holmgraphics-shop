# Holm Graphics Print Bridge

Small Node.js service that runs on the **RIP computer (10.10.1.30)** and relays
label-print requests from `shop.holmgraphics.ca` to the USB-attached DYMO
LabelWriter.

```
[ browser on shop.holmgraphics.ca ]
         |  HTTPS  (API key in header)
         v
[ Cloudflare Tunnel  ->  bridge on RIP (Windows) ]
         |  HTTPS (loopback, self-signed)
         v
[ DYMO Connect for Desktop ]
         |  USB
         v
[ DYMO LabelWriter ]
```

The bridge is stateless — it accepts a `POST /print` with DYMO label XML and
hands it straight to DYMO Connect's local HTTPS service.

---

## 1. One-time setup on the RIP computer

### 1.1 Prerequisites

- **Windows 10/11** (already present)
- **DYMO Connect for Desktop** installed and the LabelWriter plugged in. Verify
  DYMO Connect can print a test label before touching this bridge.
- **Node.js 18 or newer** — https://nodejs.org (LTS is fine)

### 1.2 Install the bridge

Open an **Administrator** Command Prompt.

```cmd
cd C:\tools
git clone <your shop repo>  holmgraphics-shop
cd holmgraphics-shop\print-bridge
npm install
copy .env.example .env
notepad .env
```

In `.env`, set:
- `API_KEY` — a long random string (`openssl rand -hex 32` or an online UUID generator).
- `ALLOWED_ORIGINS` — include every domain the web app runs on, e.g.
  `https://shop.holmgraphics.ca,http://localhost:5173`.

Keep `BIND=0.0.0.0` if you also want shop PCs on the LAN to print by hitting
`http://10.10.1.30:41960/print` directly.

### 1.3 Test manually

```cmd
npm start
```

From another window:

```cmd
curl http://127.0.0.1:41960/health
curl -H "Authorization: Bearer YOUR_API_KEY" http://127.0.0.1:41960/printers
```

You should see `{"ok":true,...}` and a JSON list with your LabelWriter.

### 1.4 Install as a Windows service (auto-start on boot)

```cmd
npm install node-windows --no-save
npm run install-service
```

The service is registered as **"HolmGraphics Print Bridge"** and starts
automatically. To remove it later: `npm run uninstall-service`.

---

## 2. Exposing the bridge to remote staff

Shop staff using the app from the **LAN** can already reach
`http://10.10.1.30:41960` if `BIND=0.0.0.0`. For **field/home** users, expose
the bridge publicly with **Cloudflare Tunnel** (free, no port-forwarding, real
TLS cert).

### 2.1 Cloudflare Tunnel quick-setup

1. Install `cloudflared` on the RIP:
   https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
2. Authenticate: `cloudflared tunnel login` (opens a browser to pick the
   `holmgraphics.ca` zone).
3. Create a tunnel:
   ```cmd
   cloudflared tunnel create holmgraphics-print
   ```
4. Route DNS. Pick any hostname you like, e.g. `print.holmgraphics.ca`:
   ```cmd
   cloudflared tunnel route dns holmgraphics-print print.holmgraphics.ca
   ```
5. Write `C:\Users\<user>\.cloudflared\config.yml`:
   ```yaml
   tunnel: holmgraphics-print
   credentials-file: C:\Users\<user>\.cloudflared\<TUNNEL-UUID>.json
   ingress:
     - hostname: print.holmgraphics.ca
       service: http://127.0.0.1:41960
     - service: http_status:404
   ```
6. Install as a Windows service so it starts on boot:
   ```cmd
   cloudflared service install
   ```

Test: `curl https://print.holmgraphics.ca/health` from anywhere.

### 2.2 Configure the web app

In the shop app's build env (e.g. the hosting panel, or `.env` at build time):

```
VITE_PRINT_BRIDGE_URL=https://print.holmgraphics.ca
VITE_PRINT_BRIDGE_KEY=the-same-API_KEY-as-on-the-bridge
```

Individual users can override these in the Print Label modal's settings pane
(stored per-browser in `localStorage`), which is useful for LAN-first setups
that want to hit `http://10.10.1.30:41960` for lower latency while on-site.

---

## 3. API reference

All authenticated endpoints require an `Authorization: Bearer <API_KEY>` header.

| Method | Path        | Body / query                                     | Response                                   |
|--------|-------------|--------------------------------------------------|--------------------------------------------|
| GET    | `/health`   | — (no auth)                                      | `{ ok, service, version }`                 |
| GET    | `/printers` | —                                                | `{ printers: [{ name, modelName, ... }] }` |
| POST   | `/print`    | `{ printerName, labelXml, copies }` (JSON)       | `{ ok: true }` or `{ error }`              |

`labelXml` is standard DYMO DieCutLabel XML (what `dymo.label.framework`
consumes). The web app's `buildDymoLabelXml()` produces it.

---

## 4. Troubleshooting

| Symptom                                | Likely cause / fix                                                  |
|----------------------------------------|---------------------------------------------------------------------|
| `/health` fails from anywhere          | Node service isn't running. Check `services.msc` or run `npm start` manually to see stderr. |
| `/printers` returns 502                | DYMO Connect for Desktop isn't running on the RIP.                  |
| `/printers` returns empty list         | LabelWriter is unplugged or asleep.                                 |
| Browser gets CORS error                | Add the site's origin to `ALLOWED_ORIGINS` and restart the service. |
| Browser gets 401                       | API key mismatch. Confirm `.env` on the RIP matches the value the web app sends. |
| Mixed-content warning on shop.holmgraphics.ca | You're pointing the web app at `http://10.10.1.30:...` from an HTTPS page. Use the Cloudflare Tunnel URL instead, or browse the app over HTTP when on LAN. |
