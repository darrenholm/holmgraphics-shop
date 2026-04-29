# install-holm-protocol.ps1
#
# Registers the "holm://" custom URL protocol on this Windows machine so
# clicks on holm://open?path=<...> links in shop.holmgraphics.ca open the
# referenced file or folder in its native Windows program / Explorer.
#
# Per-machine registration via HKEY_LOCAL_MACHINE\Software\Classes\holm.
# Run as Administrator.
#
# Usage:
#   Right-click → "Run with PowerShell" (as admin), OR from an admin shell:
#     powershell.exe -ExecutionPolicy Bypass -File install-holm-protocol.ps1
#
# Idempotent: re-running just refreshes the handler path. Use
# uninstall-holm-protocol.ps1 to remove cleanly.

$ErrorActionPreference = 'Stop'

# Resolve the handler script's path relative to this installer so the
# tools/staff-machine/ directory can live anywhere the staff member chose
# to drop it (Desktop, C:\Tools\, a network share, etc.).
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Handler   = Join-Path $ScriptDir 'holm-handler.ps1'
if (-not (Test-Path $Handler)) {
    throw "holm-handler.ps1 not found alongside this installer (looked in '$ScriptDir')."
}

# Verify admin. Failing fast here beats opaque "access denied" mid-write.
$IsAdmin = ([Security.Principal.WindowsPrincipal] `
            [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
            [Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $IsAdmin) {
    throw "Must run as Administrator (per-machine HKLM registration). " +
          "Right-click this script and choose 'Run as administrator', or " +
          "open an elevated PowerShell and re-run."
}

# The shell\open\command value Windows invokes when a holm:// link fires.
# %1 is the full URL (e.g. "holm://open?path=L%3A%5CClient%5Cfoo.pdf").
# -ExecutionPolicy Bypass keeps the handler runnable on machines whose
# default policy is Restricted. -NoProfile skips loading $PROFILE so
# clicking a link is fast and isolated from per-user shell config.
$Command = 'powershell.exe -NoProfile -ExecutionPolicy Bypass ' +
           "-File `"$Handler`" `"%1`""

$ProtocolKey = 'HKLM:\Software\Classes\holm'
$IconKey     = "$ProtocolKey\DefaultIcon"
$CommandKey  = "$ProtocolKey\shell\open\command"

New-Item -Path $ProtocolKey -Force | Out-Null
Set-ItemProperty -Path $ProtocolKey -Name '(default)'    -Value 'URL:Holm Graphics File Protocol'
Set-ItemProperty -Path $ProtocolKey -Name 'URL Protocol' -Value ''

New-Item -Path $IconKey -Force | Out-Null
Set-ItemProperty -Path $IconKey -Name '(default)' -Value 'explorer.exe,1'

New-Item -Path $CommandKey -Force | Out-Null
Set-ItemProperty -Path $CommandKey -Name '(default)' -Value $Command

Write-Host ""
Write-Host "✓ holm:// protocol registered (HKLM)." -ForegroundColor Green
Write-Host "  Handler: $Handler"
Write-Host ""
Write-Host "Test it:"
Write-Host "  1. Open shop.holmgraphics.ca, navigate to any job's Files section."
Write-Host "  2. Click a file row — it should open in its default program."
Write-Host "  3. Click the folder path — Explorer should open the folder."
Write-Host ""
Write-Host "If clicks do nothing, the browser may need permission. Chrome/Edge"
Write-Host "prompt 'Open Holm Graphics File Protocol?' the first time."
Write-Host ""
Write-Host "Logs: %LOCALAPPDATA%\HolmGraphics\holm-handler.log"
