# uninstall-holm-protocol.ps1
#
# Removes the holm:// protocol registration. Run as Administrator.
# Safe to run even if the protocol was never installed.

$ErrorActionPreference = 'Stop'

$IsAdmin = ([Security.Principal.WindowsPrincipal] `
            [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
            [Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $IsAdmin) {
    throw "Must run as Administrator (HKLM key removal)."
}

$ProtocolKey = 'HKLM:\Software\Classes\holm'
if (Test-Path $ProtocolKey) {
    Remove-Item -Path $ProtocolKey -Recurse -Force
    Write-Host "✓ holm:// protocol unregistered." -ForegroundColor Green
} else {
    Write-Host "holm:// was not registered. Nothing to remove."
}

Write-Host ""
Write-Host "Note: %LOCALAPPDATA%\HolmGraphics\holm-handler.log is left in"
Write-Host "place. Delete it manually if you want to clear the trail."
