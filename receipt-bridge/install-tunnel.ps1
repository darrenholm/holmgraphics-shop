# receipt-bridge/install-tunnel.ps1
#
# Puts an HTTPS address in front of the receipt bridge so a normal browser on
# https://shop.holmgraphics.ca can reach it. Without this the tablet prints
# (it is an app, not a browser) but a desk PC is blocked by the browser's
# mixed-content rule (https page cannot call an http bridge).
#
# This installs cloudflared as a Windows service using a TOKEN you generate in
# the Cloudflare dashboard. A token-based (remotely managed) tunnel keeps the
# hostname and routing in Cloudflare, so there is nothing else to configure on
# this machine.
#
# Run from an ADMINISTRATOR PowerShell on Design Centre 1:
#
#   powershell -ExecutionPolicy Bypass -File \\10.10.1.226\share\Claude\receipt-bridge\install-tunnel.ps1 -Token "PASTE_TOKEN_HERE"
#
# Get the token first (see the steps printed if you run this with no token).

[CmdletBinding()]
param(
  [string]$Token = '',
  [string]$InstallDir = 'C:\holmgraphics\receipt-bridge'
)

$ErrorActionPreference = 'Stop'

$id = [Security.Principal.WindowsIdentity]::GetCurrent()
$pr = New-Object Security.Principal.WindowsPrincipal($id)
if (-not $pr.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Run this from an Administrator PowerShell.'
}

if (-not $Token) {
  Write-Host ''
  Write-Host 'Make the tunnel in Cloudflare first, then re-run this with the token.' -ForegroundColor Cyan
  Write-Host ''
  Write-Host '  1. Go to  one.dash.cloudflare.com  (Zero Trust).'
  Write-Host '  2. Networks  ->  Tunnels  ->  Create a tunnel  ->  Cloudflared.'
  Write-Host '  3. Name it   holmgraphics-receipts   ->  Save.'
  Write-Host '  4. On the "Install connector" screen, under Windows, copy the'
  Write-Host '     long token out of the command it shows (the part after'
  Write-Host '     "service install"). That is what you paste below.'
  Write-Host '  5. Click Next.  Add a public hostname:'
  Write-Host '        Subdomain : receipts'
  Write-Host '        Domain    : holmgraphics.ca'
  Write-Host '        Type      : HTTP'
  Write-Host '        URL       : localhost:41962'
  Write-Host '     Save.'
  Write-Host ''
  Write-Host '  Then run:' -ForegroundColor Cyan
  Write-Host '    powershell -ExecutionPolicy Bypass -File \\10.10.1.226\share\Claude\receipt-bridge\install-tunnel.ps1 -Token "PASTE"'
  Write-Host ''
  return
}

$src = Split-Path -Parent $MyInvocation.MyCommand.Path
$exe = Join-Path $InstallDir 'cloudflared.exe'
if (-not (Test-Path $exe)) {
  New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
  Copy-Item (Join-Path $src 'cloudflared.exe') $exe -Force
}
Write-Host "  cloudflared: $exe"

# A previous install would block a fresh one; clear it first.
& $exe service uninstall 2>$null | Out-Null
Start-Sleep -Seconds 2

& $exe service install $Token
if ($LASTEXITCODE -ne 0) { throw "cloudflared service install failed (exit $LASTEXITCODE)" }

Start-Sleep -Seconds 3
$svc = Get-Service -Name 'cloudflared' -ErrorAction SilentlyContinue
if ($svc) {
  Set-Service -Name 'cloudflared' -StartupType Automatic
  if ($svc.Status -ne 'Running') { Start-Service -Name 'cloudflared' }
  Write-Host "  service: cloudflared is $((Get-Service cloudflared).Status), starts automatically" -ForegroundColor Green
} else {
  Write-Host '  service installed (name may vary); check services.msc for cloudflared' -ForegroundColor Yellow
}

Write-Host ''
Write-Host 'Give it a minute, then from any machine test:' -ForegroundColor Cyan
Write-Host '    https://receipts.holmgraphics.ca/health'
Write-Host 'It should say  {"ok":true,...}.  Tell Claude when it does.'
Write-Host ''
