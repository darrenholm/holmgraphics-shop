# files-bridge\audit-unmapped-folders.ps1
#
# Reverse audit: list every folder in the NAS client-files roots and flag
# the ones that DON'T map back to any client_name in the projects DB.
#
# Complements audit-clients.ps1 — that one walks the DB and asks the bridge
# for each name. This one walks the NAS and asks "is there a DB row for
# this folder?"
#
# Matching strategy mirrors the bridge's resolveClientFolder (case-insensitive,
# whitespace/punctuation-stripped), PLUS it also tries the name order
# reversed. Shop convention is 'Last First' (e.g. "Batte Adam") but staff
# sometimes slip into 'First Last' — so we try both when comparing.
#
# Run on the RIP:
#   cd C:\tools\holmgraphics-shop\files-bridge
#   .\audit-unmapped-folders.ps1 -Jwt 'eyJ...'
#
# Output:
#   audit-unmapped-folders.json   — folders with NO matching DB client
#   audit-folders-matched-by-reversal.json — folders that matched only
#                                            after flipping name order
#                                            (i.e. staff used 'First Last'
#                                            when DB has 'Last First' or vice versa)

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Jwt,
  [string]$Api    = 'https://holmgraphics-shop-api-production.up.railway.app',
  [string]$OutDir = (Split-Path -Parent $MyInvocation.MyCommand.Path)
)

# --- read FILES_ROOTS from .env -------------------------------------------
$envFile = Join-Path $OutDir '.env'
if (-not (Test-Path $envFile)) { throw ".env not found at $envFile" }
$rootsLine = (Get-Content $envFile | Select-String -Pattern '^\s*FILES_ROOTS=(.*)$' |
              Select-Object -First 1)
if (-not $rootsLine) {
  # fall back to bridge's default
  $rootsRaw = 'L:\ClientFilesA-K,L:\ClientFilesL-Z'
} else {
  $rootsRaw = $rootsLine.Matches[0].Groups[1].Value.Trim()
}
$roots = $rootsRaw -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ }

Write-Host "roots:" -ForegroundColor Cyan
foreach ($r in $roots) {
  $ok = Test-Path $r
  Write-Host "  $r $(if ($ok) { 'OK' } else { 'MISSING' })" -ForegroundColor $(if ($ok) { 'Green' } else { 'Red' })
}

# --- helpers --------------------------------------------------------------
# Normalize for comparison: lowercase, strip all non-alphanumerics.
function Norm([string]$s) {
  if (-not $s) { return '' }
  return ($s.ToLower() -replace '[^a-z0-9]', '')
}

# Reverse name order — heuristic for 2 and 3-word names. Single-word names
# are returned unchanged.
#   "Adam Batte"       -> "Batte Adam"
#   "Mary Ann Blythe"  -> "Blythe Mary Ann"
#   "Ken Weber Service"-> "Service Ken Weber"   (noisy but cheap)
#   "IBM"              -> "IBM"
function Reverse([string]$s) {
  if (-not $s) { return $s }
  $parts = ($s.Trim()) -split '\s+' | Where-Object { $_ }
  if ($parts.Count -lt 2) { return $s }
  $last = $parts[-1]
  $rest = $parts[0..($parts.Count - 2)]
  return ($last + ' ' + ($rest -join ' '))
}

# --- 1) pull DB client names ----------------------------------------------
Write-Host ""
Write-Host "fetching project list from $Api..." -ForegroundColor Cyan
$projects = Invoke-RestMethod -Uri "$Api/api/projects" -Headers @{ Authorization = "Bearer $Jwt" }
$clients  = $projects | ForEach-Object { $_.client_name } | Where-Object { $_ } | Sort-Object -Unique
Write-Host "$($clients.Count) distinct client names in DB"

# Build two normalized lookup maps: normalized-as-stored -> real DB name,
# and normalized-reversed -> real DB name.
$dbNorm     = @{}
$dbReversed = @{}
foreach ($c in $clients) {
  $n = Norm $c
  if ($n -and -not $dbNorm.ContainsKey($n)) { $dbNorm[$n] = $c }

  $r = Reverse $c
  $rn = Norm $r
  if ($rn -and $rn -ne $n -and -not $dbReversed.ContainsKey($rn)) { $dbReversed[$rn] = $c }
}

# --- 2) enumerate folders in every root -----------------------------------
Write-Host ""
Write-Host "scanning NAS folders..." -ForegroundColor Cyan
$allFolders = New-Object System.Collections.Generic.List[object]
foreach ($root in $roots) {
  if (-not (Test-Path $root)) { continue }
  try {
    Get-ChildItem -LiteralPath $root -Directory -Force -ErrorAction Stop | ForEach-Object {
      $allFolders.Add([pscustomobject]@{
        root   = $root
        folder = $_.Name
      })
    }
  } catch {
    Write-Warning "could not scan $root : $($_.Exception.Message)"
  }
}
Write-Host "$($allFolders.Count) folders on NAS"

# --- 3) classify folders --------------------------------------------------
$matched         = New-Object System.Collections.Generic.List[object]
$matchedReversed = New-Object System.Collections.Generic.List[object]
$unmatched       = New-Object System.Collections.Generic.List[object]

foreach ($f in $allFolders) {
  $fn = Norm $f.folder
  if ($dbNorm.ContainsKey($fn)) {
    $matched.Add([pscustomobject]@{
      root = $f.root; folder = $f.folder; dbName = $dbNorm[$fn]
    })
    continue
  }

  # Try matching this folder against DB names in reversed order, OR
  # match a reversed form of this folder against DB names as-stored.
  $reversedFolderNorm = Norm (Reverse $f.folder)
  $hit = $null
  if ($dbReversed.ContainsKey($fn))              { $hit = $dbReversed[$fn] }
  elseif ($dbNorm.ContainsKey($reversedFolderNorm)) { $hit = $dbNorm[$reversedFolderNorm] }

  if ($hit) {
    $matchedReversed.Add([pscustomobject]@{
      root = $f.root; folder = $f.folder; dbName = $hit
    })
  } else {
    $unmatched.Add([pscustomobject]@{
      root = $f.root; folder = $f.folder
    })
  }
}

# --- 4) summary + output --------------------------------------------------
Write-Host ""
Write-Host "matched (normal)   = $($matched.Count)" -ForegroundColor Green
Write-Host "matched (reversed) = $($matchedReversed.Count)" -ForegroundColor Yellow
Write-Host "unmatched          = $($unmatched.Count)" -ForegroundColor Red

$unmatched       | Sort-Object folder | ConvertTo-Json -Depth 4 |
  Set-Content (Join-Path $OutDir 'audit-unmapped-folders.json') -Encoding UTF8
$matchedReversed | Sort-Object folder | ConvertTo-Json -Depth 4 |
  Set-Content (Join-Path $OutDir 'audit-folders-matched-by-reversal.json') -Encoding UTF8

Write-Host ""
Write-Host "Wrote:" -ForegroundColor Green
Write-Host "  $OutDir\audit-unmapped-folders.json"
Write-Host "  $OutDir\audit-folders-matched-by-reversal.json"
