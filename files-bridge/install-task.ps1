# files-bridge\install-task.ps1
#
# Registers the Holm Graphics Files Bridge as a Scheduled Task that runs at
# logon inside the specified user's interactive session. Interactive session
# is required because L: is a per-user mapped network drive — Session 0
# / LocalSystem can't see it.
#
# Run from an ELEVATED PowerShell on the RIP:
#   cd C:\tools\holmgraphics-shop\files-bridge
#   .\install-task.ps1
#   .\install-task.ps1 -StartNow        # register and probe /health
#   .\install-task.ps1 -User 'AzureAD\JaneDoe'
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

$envFile = Join-Path $BridgeDir '.env'
if (-not (Test-Path $envFile)) {
  Write-Warning ".env not found at $envFile. server.js will exit on boot without API_KEY."
} else {
  $envText = Get-Content $envFile -Raw
  if ($envText -match 'API_KEY=change-me-to-a-long-random-string') {
    Write-Warning "API_KEY is still the placeholder in $envFile. Fix before starting the task."
  }
  if ($envText -notmatch '(?m)^FILES_ROOTS=') {
    Write-Warning "FILES_ROOTS not set in $envFile. Using defaults L:\ClientFilesA-K,L:\ClientFilesL-Z."
  }
}

# Warn if L: isn't reachable from THIS PowerShell (task runs as $User, though,
# so a warning here is advisory — the actual check is /health on first start).
if (-not (Test-Path 'L:\')) {
  Write-Warning "L:\ is not currently mapped in this PowerShell. The scheduled task runs as $User; verify L: is mapped in that user's session."
}

# --- build the task ------------------------------------------------------
$psArg = "-NoProfile -WindowStyle Hidden -Command " +
         "`"Set-Location '$BridgeDir'; & '$NodeExe' server.js *>> '$LogFile'`""

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
