# Staff machine setup

End-to-end provisioning for a fresh Windows staff machine. Target: 5 minutes
from a freshly imaged Windows 11 box to a working `shop.holmgraphics.ca`
session with file links opening natively.

## Prerequisites

- Windows 10 or 11 (no other OS is supported — see the bottom of this doc).
- A user account with **administrator** rights for the install step. Day-to-day
  use of the protocol does NOT need admin — only the one-time registration.
- The L: drive mapped to the RIP-machine share, OR the NAS share
  `\\LS220D146\share\` reachable. (At least one of the two — the protocol
  handler accepts paths under either.)

## Steps

### 1. Install Chrome or Edge (skip if already there)

Edge ships with Windows. Chrome is preferred by most staff:
<https://www.google.com/chrome/>. Either browser handles `holm://` links the
same way once registered.

### 2. Copy the staff-machine tools onto the box

Pull from the holmgraphics-shop repo, or unzip a release bundle into a stable
location. Recommended:

```
C:\Tools\HolmGraphics\
├── install-holm-protocol.ps1
├── holm-handler.ps1
├── uninstall-holm-protocol.ps1
└── README.md
```

Putting it under `C:\Tools\` (as opposed to a user profile) means the handler
keeps working even if the original installer's user account is removed.

### 3. Run the installer (as administrator)

Right-click `install-holm-protocol.ps1` → **Run with PowerShell** → click
**Yes** at the UAC prompt. From an elevated PowerShell prompt, equivalently:

```powershell
powershell.exe -ExecutionPolicy Bypass -File C:\Tools\HolmGraphics\install-holm-protocol.ps1
```

You should see:

```
✓ holm:// protocol registered (HKLM).
  Handler: C:\Tools\HolmGraphics\holm-handler.ps1
```

### 4. Validate

Open <https://shop.holmgraphics.ca>, log in, navigate to any job that has files
listed.

- **Click a file row.** First time, the browser asks
  *"Open Holm Graphics File Protocol?"* — tick "Always allow shop.holmgraphics.ca
  to open these links" and click **Open**. The file opens in its default
  program (PDFs in Acrobat, .ai in Illustrator, .png in your default image
  viewer, etc.).
- **Click the folder path** (the grey monospace line above/below the file
  list). File Explorer opens to the job folder.

If both work, you're done.

### 5. Sanity-check the security guard (optional but recommended)

Paste this into the address bar:

```
holm://open?path=C:\Windows\System32
```

You should see a "path rejected" dialog and the request should appear in
`%LOCALAPPDATA%\HolmGraphics\holm-handler.log` as `REJECTED`. This confirms the
allowlist (`\\LS220D146\share\`, `L:\`) is working — the handler refuses to
open arbitrary paths even when invoked from a non-Holm web page.

## Troubleshooting

### "Open Holm Graphics File Protocol?" prompt never appears

The protocol isn't registered. Re-run the installer. If it errors with
"Must run as Administrator," right-click → **Run as administrator** explicitly.

### Browser shows the prompt, you click **Open**, nothing happens

Open `%LOCALAPPDATA%\HolmGraphics\holm-handler.log`. The most recent line tells
you what happened:

| Log line starts with | Meaning |
|----------------------|---------|
| `INVOCATION` only, no follow-up | Handler crashed before logging — usually means PowerShell execution policy is blocking it. The installer sets `-ExecutionPolicy Bypass` on the registered command, so this is unusual; check the registered command via `regedit` at `HKLM\Software\Classes\holm\shell\open\command`. |
| `REJECTED (path not in allowlist)` | The path didn't start with `\\LS220D146\share\` or `L:\`. Either the path is wrong, or you're testing with a path the allowlist doesn't cover. To extend it, edit `holm-handler.ps1` and re-run the installer. |
| `ERROR (path not found)` | The path is in the allowlist but the file/folder doesn't exist. Could be a stale link, a network share that's not mounted, or a typo. |
| `OPEN dir` / `OPEN file` | Handler ran successfully — the issue is elsewhere (e.g. no default program for that file extension). |

### A staff member is on a Mac / Linux box

Out of scope. The `holm://` protocol works only on Windows. Mac/Linux staff
should use the existing "Download" button next to each file row — it streams
the file through the files-bridge as a regular browser download.

### Removing the protocol

Run `uninstall-holm-protocol.ps1` as administrator. The log file at
`%LOCALAPPDATA%\HolmGraphics\holm-handler.log` is left in place; delete it
manually if you want a clean removal.

## How it fits together

```
┌──────────────────────────────┐
│ shop.holmgraphics.ca         │
│ /jobs/<id>                   │
│                              │
│  <a href="holm://open?       │
│    path=L%3A%5CClient%5C…">  │
│    invoice.pdf               │
│  </a>                        │
└──────────────┬───────────────┘
               │ click
               ▼
┌──────────────────────────────┐
│ Browser asks the OS to       │
│ handle "holm://…"            │
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│ HKLM\Software\Classes\holm   │
│   \shell\open\command =      │
│   powershell.exe …           │
│   holm-handler.ps1 "%1"      │
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│ holm-handler.ps1             │
│  1. Parse URL → path         │
│  2. Decode + canonicalise    │
│  3. Match allowlist          │
│     (\\LS220D146\share\,     │
│      L:\)                    │
│  4. Open with explorer.exe   │
│     (dir) or Invoke-Item     │
│     (file)                   │
└──────────────────────────────┘
```

Backend / API / database changes: none. The `holm://` URLs are constructed
client-side from path data the files-bridge already returns.
