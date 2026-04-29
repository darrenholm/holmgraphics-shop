# Staff machine tools

PowerShell installers for the `holm://` custom URL protocol that lets the staff
job page open files and folders directly in their native Windows programs.

## Files

| File | What it does |
|------|--------------|
| `install-holm-protocol.ps1` | Registers `holm://` under `HKLM\Software\Classes`. Run once per machine. |
| `holm-handler.ps1` | The handler the protocol invokes. Validates the URL's `path` parameter against an allowlist (`\\LS220D146\share\`, `L:\`) and opens the file/folder. |
| `uninstall-holm-protocol.ps1` | Reverses the install. Leaves the log file alone. |

## Quick start

1. Copy this whole `tools/staff-machine/` folder somewhere stable on the staff
   machine — `C:\Tools\HolmGraphics\` is a good default.
2. Right-click `install-holm-protocol.ps1` → **Run with PowerShell** as admin.
3. Open `https://shop.holmgraphics.ca/jobs/<some-id>` in Chrome/Edge.
4. Click any file in the Files section. The browser will prompt
   *"Open Holm Graphics File Protocol?"* the first time — tick "always allow"
   if you want to skip it on subsequent clicks.

For the full provisioning guide (Chrome, login, validation, troubleshooting),
see [`docs/staff-machine-setup.md`](../../docs/staff-machine-setup.md).

## What the handler accepts

Only paths under one of these roots:

- `\\LS220D146\share\` — the NAS share staff use for shared client files
- `L:\` — the mapped drive on the RIP machine

Anything else (including paths that try to escape via `..\..\Windows`) is
rejected and logged. The check uses `[System.IO.Path]::GetFullPath()` to
canonicalise the path before matching, so traversal attacks are blocked
even when the URL starts with an allowlisted prefix.

## Logs

Every invocation — allowed or rejected — appends a line to
`%LOCALAPPDATA%\HolmGraphics\holm-handler.log`:

```
2026-04-29 15:12:03 INVOCATION: holm://open?path=L%3A%5CClient%5Cfoo.pdf
2026-04-29 15:12:03 OPEN file: L:\Client\foo.pdf
2026-04-29 15:14:11 INVOCATION: holm://open?path=C%3A%5CWindows%5Csystem32
2026-04-29 15:14:11 REJECTED (path not in allowlist): raw='C:\Windows\system32' resolved='C:\Windows\system32'
```

If something seems off, that log is the first place to look.
