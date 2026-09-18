# receipt-bridge/install.ps1
#
# One-shot installer for the receipt bridge on the PC the receipt printer is
# plugged into (Design Centre 1). Run it from an ADMINISTRATOR PowerShell:
#
#   powershell -ExecutionPolicy Bypass -File \\10.10.1.226\share\Claude\receipt-bridge\install.ps1 -PrinterName "HS-58CUB"
#
# It copies itself (and a bundled node.exe) to C:\holmgraphics\receipt-bridge,
# writes a .env with a generated key, opens the firewall to the shop LAN, and
# registers a scheduled task that starts it at boot as SYSTEM.
#
# Re-running is safe: it keeps the existing key and only updates the printer.
#
# Deliberately plain ASCII throughout. Windows PowerShell 5.1 reads a BOM-less
# .ps1 as the ANSI code page, so any fancy dash or quote turns to garbage and
# breaks parsing.

[CmdletBinding()]
param(
  [string]$InstallDir  = 'C:\holmgraphics\receipt-bridge',
  [string]$PrinterName = '',
  [int]$Port           = 41962
)

$ErrorActionPreference = 'Stop'

$id = [Security.Principal.WindowsIdentity]::GetCurrent()
$pr = New-Object Security.Principal.WindowsPrincipal($id)
if (-not $pr.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Run this from an Administrator PowerShell (right-click PowerShell, Run as administrator).'
}

$src = Split-Path -Parent $MyInvocation.MyCommand.Path
Write-Host 'Installing the Holm Graphics receipt bridge' -ForegroundColor Cyan
Write-Host "  from: $src"
Write-Host "  to  : $InstallDir"

# --- Node -------------------------------------------------------------------
$bundledNode = Join-Path $src 'node.exe'
if (Test-Path $bundledNode) {
  $node = Join-Path $InstallDir 'node.exe'
  Write-Host '  node: bundled'
} else {
  $node = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
  if (-not $node) {
    foreach ($c in 'C:\Program Files\nodejs\node.exe', 'C:\Program Files (x86)\nodejs\node.exe') {
      if (Test-Path $c) { $node = $c; break }
    }
  }
  if (-not $node) { throw 'Node.js was not bundled and is not installed.' }
  Write-Host "  node: $node"
}

# --- Copy -------------------------------------------------------------------
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
robocopy $src $InstallDir /E /NFL /NDL /NJH /NJS /NP /XF .env | Out-Null
if ($LASTEXITCODE -ge 8) { throw "Copy failed (robocopy exit $LASTEXITCODE)" }

# --- Printer ----------------------------------------------------------------
if (-not $PrinterName) {
  $guess = Get-Printer | Where-Object { $_.Name -match 'receipt|thermal|POS|58|80mm|TM-|HS-' } |
           Select-Object -First 1
  if ($guess) {
    $PrinterName = $guess.Name
    Write-Host "  printer (guessed): $PrinterName" -ForegroundColor Yellow
  } else {
    Write-Host ''
    Write-Host 'Could not tell which printer is the receipt printer. Installed printers:' -ForegroundColor Yellow
    Get-Printer | Select-Object -ExpandProperty Name | ForEach-Object { Write-Host "    $_" }
    throw 'Re-run with the right one, e.g.  -PrinterName "HS-58CUB"'
  }
} else {
  Write-Host "  printer: $PrinterName"
}
if (-not (Get-Printer -Name $PrinterName -ErrorAction SilentlyContinue)) {
  throw "No installed printer named '$PrinterName'. Check: Get-Printer | Select-Object Name"
}

# --- .env -------------------------------------------------------------------
$envPath = Join-Path $InstallDir '.env'
if (Test-Path $envPath) {
  $apiKey = ((Get-Content $envPath | Where-Object { $_ -match '^API_KEY=' }) -split '=', 2)[1]
  $kept   = Get-Content $envPath | Where-Object { $_ -notmatch '^PRINTER_NAME=' }
  ($kept + "PRINTER_NAME=$PrinterName") | Set-Content -Path $envPath -Encoding ASCII
  Write-Host "  .env updated (key kept, printer set to $PrinterName)" -ForegroundColor Yellow
} else {
  $buf = New-Object byte[] 32
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($buf)
  $apiKey = ([Convert]::ToBase64String($buf)) -replace '[+/=]', ''
  @(
    "API_KEY=$apiKey"
    "PRINTER_NAME=$PrinterName"
    'ALLOWED_ORIGINS=https://shop.holmgraphics.ca,http://localhost:5173'
    "PORT=$Port"
    'BIND=0.0.0.0'
  ) | Set-Content -Path $envPath -Encoding ASCII
  Write-Host '  .env written'
}

# --- Firewall (shop LAN only) ----------------------------------------------
$ruleName = 'Holm Graphics Receipt Bridge'
Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue | Remove-NetFirewallRule
New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Action Allow `
  -Protocol TCP -LocalPort $Port -RemoteAddress 10.10.1.0/24 -Profile Any | Out-Null
Write-Host "  firewall: TCP $Port open to 10.10.1.0/24"

# --- Scheduled task (SYSTEM, at startup) ------------------------------------
# Proper cmdlets, not schtasks.exe: they honour -ErrorAction and do not spew
# stderr that a Stop preference would mistake for a fatal error.
$taskName = 'HG Receipt Bridge'
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
$action    = New-ScheduledTaskAction -Execute $node -Argument "`"$InstallDir\server.js`"" -WorkingDirectory $InstallDir
$trigger   = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$settings  = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger `
  -Principal $principal -Settings $settings | Out-Null
Start-ScheduledTask -TaskName $taskName
Write-Host '  scheduled task created and started'

# --- Check ------------------------------------------------------------------
Start-Sleep -Seconds 3
$ip = (Get-NetIPAddress -AddressFamily IPv4 |
       Where-Object { $_.IPAddress -like '10.10.1.*' } | Select-Object -First 1).IPAddress
try {
  $health = Invoke-RestMethod "http://127.0.0.1:$Port/health" -TimeoutSec 5
  Write-Host ''
  Write-Host 'Bridge is running.' -ForegroundColor Green
  Write-Host "  host           : $($health.host)"
  Write-Host "  default printer: $($health.defaultPrinter)"
} catch {
  Write-Host ''
  Write-Host "Started, but http://127.0.0.1:$Port/health did not answer yet. Give it a moment." -ForegroundColor Yellow
}

Write-Host ''
Write-Host 'Put these into the shop app (POS, Receipt printing from this computer):' -ForegroundColor Cyan
Write-Host "  Address : http://$ip`:$Port"
Write-Host "  Key     : $apiKey"
Write-Host ''
