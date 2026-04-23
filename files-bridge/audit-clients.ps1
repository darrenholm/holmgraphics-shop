# files-bridge\audit-clients.ps1
#
# Audits every distinct client_name in the projects DB against what the
# files-bridge can resolve on the NAS. Writes three JSON files next to the
# bridge so the mismatches are easy to share / diff over time.
#
# Run from an interactive PowerShell on the RIP (DesignCentre4):
#   cd C:\tools\holmgraphics-shop\files-bridge
#   .\audit-clients.ps1 -Jwt 'eyJ...'
#
# The JWT you want is the one the shop front-end stashes in localStorage as
# 'hg_token' — grab it from the shop tab's DevTools console:
#   copy(localStorage.getItem('hg_token'))
#
# The bridge API key is read from .env in this folder, so you don't have to
# pass it on the command line.

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Jwt,
  [string]$Bridge = 'http://127.0.0.1:41961',
  [string]$Api    = 'https://holmgraphics-shop-api-production.up.railway.app',
  [string]$OutDir = (Split-Path -Parent $MyInvocation.MyCommand.Path)
)

# --- read API_KEY from .env -----------------------------------------------
$envFile = Join-Path $OutDir '.env'
if (-not (Test-Path $envFile)) { throw ".env not found at $envFile" }
$apiKey = (Get-Content $envFile | Select-String -Pattern '^\s*API_KEY=(.*)$' |
           Select-Object -First 1).Matches[0].Groups[1].Value.Trim()
if (-not $apiKey) { throw "Could not parse API_KEY from $envFile" }

# --- 1) pull every distinct client_name from /api/projects ----------------
Write-Host "fetching project list from $Api..." -ForegroundColor Cyan
$projects = Invoke-RestMethod -Uri "$Api/api/projects" -Headers @{ Authorization = "Bearer $Jwt" }
$clients  = $projects | ForEach-Object { $_.client_name } | Where-Object { $_ } | Sort-Object -Unique
Write-Host "auditing $($clients.Count) distinct client names..." -ForegroundColor Cyan

# --- 2) ask the bridge to resolve each one --------------------------------
$resolved = New-Object System.Collections.Generic.List[object]
$misses   = New-Object System.Collections.Generic.List[object]
$n = 0
foreach ($c in $clients) {
  $n++
  if ($n % 100 -eq 0) { Write-Host "  $n / $($clients.Count)" }
  $enc = [uri]::EscapeDataString($c)
  try {
    $resp = Invoke-RestMethod -Uri "$Bridge/clients/$enc/tree" `
              -Headers @{ Authorization = "Bearer $apiKey" } -TimeoutSec 10 -ErrorAction Stop
    if ($resp.resolved) {
      $resolved.Add([pscustomobject]@{ name = $c; folder = $resp.folder; bucket = $resp.bucket })
    } else {
      $misses.Add([pscustomobject]@{ name = $c; bucket = $resp.bucket })
    }
  } catch {
    $misses.Add([pscustomobject]@{ name = $c; error = $_.Exception.Message })
  }
}

# --- 3) summary + write artifacts -----------------------------------------
Write-Host ""
Write-Host "resolved = $($resolved.Count)   misses = $($misses.Count)" -ForegroundColor Cyan

# Folders found but under a different name (typical: case, spaces, etc.)
$differing = $resolved | Where-Object { $_.name -cne $_.folder }
Write-Host "resolved-but-renamed = $($differing.Count)" -ForegroundColor Yellow

$misses    | ConvertTo-Json -Depth 4 | Set-Content (Join-Path $OutDir 'audit-misses.json')   -Encoding UTF8
$differing | ConvertTo-Json -Depth 4 | Set-Content (Join-Path $OutDir 'audit-renamed.json')  -Encoding UTF8
$resolved  | ConvertTo-Json -Depth 4 | Set-Content (Join-Path $OutDir 'audit-resolved.json') -Encoding UTF8

Write-Host ""
Write-Host "Wrote:" -ForegroundColor Green
Write-Host "  $OutDir\audit-misses.json"
Write-Host "  $OutDir\audit-renamed.json"
Write-Host "  $OutDir\audit-resolved.json"
