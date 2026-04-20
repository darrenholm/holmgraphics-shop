# print-bridge\diag.ps1
#
# Triage the "HolmGraphics Print Bridge" Windows service.
# Run from an ELEVATED PowerShell on the RIP (10.10.1.30):
#
#   Set-ExecutionPolicy -Scope Process Bypass -Force
#   cd C:\path\to\holmgraphics-shop\print-bridge
#   .\diag.ps1
#
# Everything is read-only — this script will not start/stop/reinstall anything.

$ErrorActionPreference = 'Continue'
$svcName  = 'HolmGraphics Print Bridge'
$port     = 41960
$dymoPort = 41951

function Section($title) {
  Write-Host ""
  Write-Host ("=" * 72) -ForegroundColor DarkGray
  Write-Host "  $title" -ForegroundColor Cyan
  Write-Host ("=" * 72) -ForegroundColor DarkGray
}
function OK($msg)   { Write-Host "  [ OK ] $msg" -ForegroundColor Green }
function WARN($msg) { Write-Host "  [WARN] $msg" -ForegroundColor Yellow }
function BAD($msg)  { Write-Host "  [FAIL] $msg" -ForegroundColor Red }
function INFO($msg) { Write-Host "  $msg" -ForegroundColor Gray }

# ---------------------------------------------------------------- 1. Service
Section "1. Service registration & state"
$svc = Get-Service -DisplayName $svcName -ErrorAction SilentlyContinue
if (-not $svc) {
  BAD "Service '$svcName' is NOT installed."
  INFO "Check also by possible internal names:"
  Get-Service | Where-Object { $_.Name -match 'holm|print.?bridge' } |
    Format-Table Name, DisplayName, Status -AutoSize | Out-String | Write-Host
  $svcWmi = $null
} else {
  OK "Found: Name='$($svc.Name)'  DisplayName='$($svc.DisplayName)'  Status=$($svc.Status)"
  $svcWmi = Get-CimInstance Win32_Service -Filter "Name='$($svc.Name)'"
  if ($svcWmi) {
    INFO "StartMode : $($svcWmi.StartMode)"
    INFO "Account   : $($svcWmi.StartName)"
    INFO "PathName  : $($svcWmi.PathName)"
    INFO "State     : $($svcWmi.State)   Exit=$($svcWmi.ExitCode)/$($svcWmi.ServiceSpecificExitCode)"
    if ($svcWmi.StartName -match 'LocalSystem|NT AUTHORITY\\SYSTEM') {
      WARN "Running as LocalSystem (Session 0). DYMO Connect may not be reachable when no user is logged in."
    }
  }
}

# ---------------------------------------------------------------- 2. SCM recovery / failures
Section "2. SCM failure actions & recent restarts"
if ($svc) {
  & sc.exe qfailure "$($svc.Name)" | Out-String | Write-Host
}

# ---------------------------------------------------------------- 3. Event log
Section "3. Recent Application/System events for this service"
try {
  Get-WinEvent -FilterHashtable @{
    LogName      = 'Application','System'
    ProviderName = 'Service Control Manager', $svcName, "$($svc.Name)"
    StartTime    = (Get-Date).AddDays(-2)
  } -ErrorAction SilentlyContinue |
    Where-Object { $_.Message -match 'HolmGraphics|print.?bridge|41960' } |
    Select-Object -First 20 TimeCreated, LevelDisplayName, ProviderName, Message |
    Format-List | Out-String | Write-Host
} catch { INFO "No matching events in the last 48h." }

# ---------------------------------------------------------------- 4. node-windows daemon logs
Section "4. node-windows daemon logs"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$daemonDir = Join-Path $scriptDir 'daemon'
if (Test-Path $daemonDir) {
  OK "Daemon folder: $daemonDir"
  Get-ChildItem $daemonDir -Filter *.log -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending |
    ForEach-Object {
      Write-Host ""
      Write-Host "--- $($_.FullName)  (last 40 lines)" -ForegroundColor Yellow
      Get-Content -Tail 40 $_.FullName | Out-String | Write-Host
    }
} else {
  WARN "No $daemonDir folder. Either the service wasn't installed from this directory, or logs haven't been written yet."
  # Try to infer from the installed PathName
  if ($svcWmi -and $svcWmi.PathName) {
    $exePath = ($svcWmi.PathName -replace '^"([^"]+)".*','$1')
    $installDir = Split-Path -Parent $exePath
    INFO "Service binary lives at: $installDir"
    $altDaemon = Join-Path $installDir 'daemon'
    if (Test-Path $altDaemon) {
      OK "Found daemon logs there: $altDaemon"
      Get-ChildItem $altDaemon -Filter *.log | Sort-Object LastWriteTime -Descending |
        ForEach-Object {
          Write-Host ""
          Write-Host "--- $($_.FullName)  (last 40 lines)" -ForegroundColor Yellow
          Get-Content -Tail 40 $_.FullName | Out-String | Write-Host
        }
    }
  }
}

# ---------------------------------------------------------------- 5. .env presence on the install path
Section "5. .env at the install path"
$envCandidates = @()
if ($svcWmi -and $svcWmi.PathName) {
  $exePath = ($svcWmi.PathName -replace '^"([^"]+)".*','$1')
  $envCandidates += (Join-Path (Split-Path -Parent $exePath) '.env')
  $envCandidates += (Join-Path (Split-Path -Parent $exePath) '..\.env')
}
$envCandidates += (Join-Path $scriptDir '.env')
$envCandidates = $envCandidates | Select-Object -Unique
foreach ($p in $envCandidates) {
  if (Test-Path $p) {
    OK ".env found: $p"
    $content = Get-Content $p
    $apiKey = ($content | Select-String '^API_KEY=').ToString()
    $bind   = ($content | Select-String '^BIND=').ToString()
    $port2  = ($content | Select-String '^PORT=').ToString()
    if ($apiKey -match 'change-me-to-a-long-random-string') {
      BAD "API_KEY still the default placeholder — server.js will exit(1) on boot."
    } elseif ($apiKey) {
      OK "API_KEY is set (length $(($apiKey -split '=',2)[1].Length))"
    } else {
      BAD "No API_KEY line — server.js will exit(1) on boot."
    }
    INFO "$bind"
    INFO "$port2"
    # ACL check for SYSTEM
    $acl = Get-Acl $p
    $systemAccess = $acl.Access | Where-Object { $_.IdentityReference -match 'SYSTEM|BUILTIN\\Administrators' }
    if ($systemAccess) { OK "SYSTEM/Administrators have access to .env" }
    else { WARN "SYSTEM doesn't appear in .env ACL — LocalSystem service may fail to read it." }
  } else {
    INFO "not present: $p"
  }
}

# ---------------------------------------------------------------- 6. Port 41960 listen state
Section "6. Port $port listen state"
$listeners = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue
if ($listeners) {
  foreach ($l in $listeners) {
    $proc = Get-Process -Id $l.OwningProcess -ErrorAction SilentlyContinue
    OK "Listening: $($l.LocalAddress):$($l.LocalPort)  PID=$($l.OwningProcess)  Proc=$($proc.ProcessName)"
  }
} else {
  BAD "Nothing is listening on port $port."
}

# ---------------------------------------------------------------- 7. Firewall
Section "7. Firewall rules touching port $port"
$rules = Get-NetFirewallPortFilter -Protocol TCP |
  Where-Object { $_.LocalPort -eq "$port" } |
  ForEach-Object { Get-NetFirewallRule -AssociatedNetFirewallPortFilter $_ } |
  Select-Object DisplayName, Enabled, Direction, Action, Profile
if ($rules) {
  $rules | Format-Table -AutoSize | Out-String | Write-Host
} else {
  WARN "No firewall rule explicitly covers TCP $port. LAN clients at 10.10.1.30:$port will be blocked by default."
}

# ---------------------------------------------------------------- 8. Node processes
Section "8. node.exe processes on this box"
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Select-Object ProcessId, Name, CommandLine |
  Format-List | Out-String | Write-Host

# ---------------------------------------------------------------- 9. DYMO Connect reachability
Section "9. DYMO Connect on 127.0.0.1:$dymoPort"
$dymoListen = Get-NetTCPConnection -State Listen -LocalPort $dymoPort -ErrorAction SilentlyContinue
if ($dymoListen) {
  foreach ($l in $dymoListen) {
    $proc = Get-Process -Id $l.OwningProcess -ErrorAction SilentlyContinue
    OK "DYMO Connect listening: $($l.LocalAddress):$($l.LocalPort)  PID=$($l.OwningProcess)  Proc=$($proc.ProcessName)"
    INFO "Session of that PID: $((Get-CimInstance Win32_Process -Filter "ProcessId=$($l.OwningProcess)").SessionId)"
  }
} else {
  BAD "DYMO Connect is NOT listening on $dymoPort. (Likely because no user is logged in, or DYMO Connect isn't running.)"
}

# ---------------------------------------------------------------- 10. Live HTTP probes
Section "10. HTTP probes"
foreach ($url in @(
  "http://127.0.0.1:$port/health",
  "http://10.10.1.30:$port/health"
)) {
  try {
    $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 -Uri $url
    OK "$url  ->  HTTP $($r.StatusCode)  $($r.Content)"
  } catch {
    BAD "$url  ->  $($_.Exception.Message)"
  }
}

# ---------------------------------------------------------------- 11. Interpretation hints
Section "11. Quick interpretation"
@"
  - Section 1 'Status=Running'  but section 6 shows no listener  =>  node crashed after boot.
    Look at section 4 err.log.
  - Section 1 'Status=Stopped'  and section 3 shows 'exit code 1' =>  server.js exit(1), usually
    API_KEY missing. Section 5 will confirm.
  - Section 9 empty while Darren is NOT logged in to the RIP     =>  Session 0 / DYMO Connect issue.
    Fix by reinstalling the service to run as your user account, or leave Darren auto-logged-in.
  - Section 6 listener bound to 127.0.0.1 only                   =>  BIND=127.0.0.1 in .env.
    LAN machines at 10.10.1.30:$port won't reach it. Set BIND=0.0.0.0.
  - Section 10 loopback OK but LAN fails                          =>  firewall. Section 7 will be empty.
"@ | Write-Host -ForegroundColor Gray
