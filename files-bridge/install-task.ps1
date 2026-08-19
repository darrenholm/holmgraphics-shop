# files-bridge\install-task.ps1
#
# Registers the Holm Graphics Files Bridge as a Scheduled Task that runs at
# logon inside the specified user's interactive session. Interactive session
# is required either way: a mapped L: drive is per-user, and so is the
# `net use` session a UNC install authenticates with. Session 0 /
# LocalSystem can't see either.
#
# TWO LAYOUTS EXIST — see files-bridge/README.md > Where the bridge runs:
#
#   a) Drive-letter install: roots are L:\ClientFiles*, mapped in the user's
#      session, and the task launches node directly.
#   b) Launcher install (DesignCentre4, C:\holmgraphics\files-bridge): roots
#      are UNC \\<nas>\share\ClientFiles*, and a start-bridge.ps1 in the
#      bridge folder runs `net use` to authenticate before starting node.
#
# This script handles both: if start-bridge.ps1 sits next to server.js, the
# task runs THAT rather than node, so the credential step isn't skipped.
#
# Run from an ELEVATED PowerShell on the bridge machine:
#   cd C:\holmgraphics\files-bridge
#   .\install-task.ps1
#   .\install-task.ps1 -StartNow        # register and probe /health
#   .\install-task.ps1 -User 'AzureAD\JaneDoe'
#
# -BridgeDir matters: it defaults to the folder THIS SCRIPT lives in, so
# running a copy out of a git clone points the task at the clone. Pass
# -BridgeDir explicitly when the running install lives elsewhere:
#   C:\tools\holmgraphics-shop\files-bridge\install-task.ps1 `
#     -BridgeDir 'C:\holmgraphics\files-bridge'
#
# Idempotent — re-running replaces any existing task of the same name.

[CmdletBinding()]
param(
  [string]$TaskName  = 'Holm Files Bridge',
  [string]$BridgeDir = (Split-Path -Parent $MyInvocation.MyCommand.Path),
  [string]$NodeExe   = 'C:\Program Files\nodejs\node.exe',
  [string]$User      = "$env:USERDOMAIN\$env:USERNAME",
  [string]$LogFile   = '',
  [int]   $HealthPort = 41961,
  [switch]$StartNow
)

if (-not $LogFile) { $LogFile = Join-Path $BridgeDir 'bridge.log' }

# --- sanity checks -------------------------------------------------------
$serverJs = Join-Path $BridgeDir 'server.js'
if (-not (Test-Path $serverJs)) {
  throw "server.js not found at $serverJs. Pass -BridgeDir to point at your install."
}
if (-not (Test-Path $NodeExe)) {
  throw "node.exe not found at $NodeExe. Install Node.js LTS or pass -NodeExe."
}

# A launcher next to server.js means this install authenticates to the NAS
# (or maps a drive) before starting node — the task has to run it, not node.
$launcher = Join-Path $BridgeDir 'start-bridge.ps1'
$hasLauncher = Test-Path $launcher

$roots = @('L:\ClientFilesA-K', 'L:\ClientFilesL-Z')
$envFile = Join-Path $BridgeDir '.env'
if (-not (Test-Path $envFile)) {
  Write-Warning ".env not found at $envFile. server.js will exit on boot without API_KEY."
  Write-Warning "             Wrong -BridgeDir? The running install is wherever bridge.log is being written."
} else {
  $envText = Get-Content $envFile -Raw
  if ($envText -match 'API_KEY=change-me-to-a-long-random-string') {
    Write-Warning "API_KEY is still the placeholder in $envFile. Fix before starting the task."
  }
  if ($envText -match '(?m)^FILES_ROOTS=(.+)$') {
    $roots = $Matches[1].Split(',') | ForEach-Object { $_.Trim() } | Where-Object { $_ }
  } else {
    Write-Warning "FILES_ROOTS not set in $envFile. Using defaults $($roots -join ',')."
  }
}

# Check the roots this install actually uses, not a hardcoded L:. A UNC root
# that isn't reachable yet is expected when a launcher authenticates first,
# so that case is a note rather than a warning. Either way the real check is
# /health on first start.
foreach ($root in $roots) {
  if (Test-Path $root) { continue }
  if ($root -like '\\*' -and $hasLauncher) {
    Write-Host "[install-task] $root not reachable from this PowerShell yet — start-bridge.ps1 authenticates first." -ForegroundColor DarkGray
  } else {
    Write-Warning "$root is not reachable from this PowerShell. The task runs as $User; verify it's available in that user's session."
  }
}

# --- build the task ------------------------------------------------------
if ($hasLauncher) {
  # The launcher does its own logging and Set-Location; don't double it up.
  $psArg = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$launcher`""
} else {
  $psArg = "-NoProfile -WindowStyle Hidden -Command " +
           "`"Set-Location '$BridgeDir'; & '$NodeExe' server.js *>> '$LogFile'`""
}

$action    = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $psArg
$trigger   = New-ScheduledTaskTrigger -AtLogOn -User $User
$principal = New-ScheduledTaskPrincipal -UserId $User -LogonType Interactive -RunLevel Highest
$settings  = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)

Register-ScheduledTask -TaskName $TaskName `
  -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null

Write-Host "[install-task] Registered '$TaskName'." -ForegroundColor Green
Write-Host "              BridgeDir : $BridgeDir"
Write-Host "              Launch    : $(if ($hasLauncher) { 'start-bridge.ps1 (authenticates, then starts node)' } else { 'node server.js' })"
Write-Host "              Roots     : $($roots -join ', ')"
Write-Host "              Node      : $NodeExe"
Write-Host "              User      : $User"
Write-Host "              Log       : $LogFile"

Get-ScheduledTask -TaskName $TaskName | Format-List TaskName, State, @{n='Trigger';e={$_.Triggers[0].CimClass.CimClassName}}, @{n='RunAs';e={$_.Principal.UserId}}

if ($StartNow) {
  Write-Host "[install-task] Starting task now..." -ForegroundColor Cyan
  Start-ScheduledTask -TaskName $TaskName
  Start-Sleep -Seconds 2
  try {
    $resp = Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 -Uri "http://127.0.0.1:$HealthPort/health"
    Write-Host "[install-task] /health -> $($resp.StatusCode) $($resp.Content)" -ForegroundColor Green
  } catch {
    Write-Warning "[install-task] /health probe failed: $($_.Exception.Message). Check $LogFile."
  }
}

Write-Host ""
Write-Host "Useful follow-ups:" -ForegroundColor DarkGray
Write-Host "  Start-ScheduledTask -TaskName '$TaskName'"
Write-Host "  Stop-ScheduledTask  -TaskName '$TaskName'"
Write-Host "  Get-Content '$LogFile' -Tail 40 -Wait"
Write-Host "  Unregister-ScheduledTask -TaskName '$TaskName' -Confirm:`$false"
