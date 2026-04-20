# docs/scripts/check-ttls.ps1
#
# Verify TTL propagation for the holmgraphics.ca DNS migration (WHC -> Cloudflare).
#
# Run from any Windows machine:
#   pwsh .\docs\scripts\check-ttls.ps1
#
# What it does:
#   1. Discovers the authoritative nameservers for holmgraphics.ca (via 1.1.1.1).
#   2. Queries each migration-critical record from:
#        - the discovered authoritative NS (proves WHC saved the TTL change)
#        - 1.1.1.1 and 8.8.8.8 (proves the world's recursive resolvers have refreshed)
#   3. Flags any record whose TTL is above 300 ('[OLD]') vs the expected post-edit
#      value of 300 ('[OK]').
#
# Notes:
#   - Do NOT query the cPanel web host IP (e.g. 173.209.32.227) directly --
#     it doesn't answer public port-53 queries; you'll just see timeouts.
#   - Public resolvers can't return a TTL lower than what the authority handed
#     them, so if 1.1.1.1 / 8.8.8.8 are showing TTL=300 then WHC is too.
#   - For CNAMEs, public resolvers may follow the chain and report the target's
#     A-record TTL instead of the CNAME TTL. Trust the authoritative NS rows
#     for those.

$records = @(
  @{Name='holmgraphics.ca';                            Type='A'},
  @{Name='www.holmgraphics.ca';                        Type='CNAME'},
  @{Name='shop.holmgraphics.ca';                       Type='CNAME'},
  @{Name='mail.holmgraphics.ca';                       Type='CNAME'},
  @{Name='autodiscover.holmgraphics.ca';               Type='CNAME'},
  @{Name='holmgraphics.ca';                            Type='MX'},
  @{Name='holmgraphics.ca';                            Type='TXT'},
  @{Name='default._domainkey.holmgraphics.ca';         Type='TXT'},
  @{Name='default._domainkey.shop.holmgraphics.ca';    Type='TXT'},
  @{Name='_cpanel-dcv-test-record.holmgraphics.ca';    Type='TXT'}
)

# --- 1. Discover authoritative nameservers ---------------------------------
Write-Host "=== Authoritative nameservers for holmgraphics.ca ===" -ForegroundColor Cyan
$ns = Resolve-DnsName -Name holmgraphics.ca -Type NS -Server 1.1.1.1 -DnsOnly |
        Where-Object { $_.Type -eq 'NS' } | Select-Object -ExpandProperty NameHost
if (-not $ns) {
  Write-Warning "Could not resolve NS records for holmgraphics.ca via 1.1.1.1."
} else {
  $ns | ForEach-Object { Write-Host "  $_" }
}

$nsIPs = @()
foreach ($n in $ns) {
  try {
    $ip = (Resolve-DnsName -Name $n -Type A -Server 1.1.1.1 -DnsOnly -ErrorAction Stop |
             Where-Object { $_.Type -eq 'A' } | Select-Object -First 1).IPAddress
    if ($ip) { $nsIPs += $ip }
  } catch {
    Write-Warning "Failed to resolve A for $n : $($_.Exception.Message)"
  }
}

$servers = @($nsIPs) + @('1.1.1.1','8.8.8.8') | Where-Object { $_ } | Select-Object -Unique

# --- 2. Query each server for each record ----------------------------------
foreach ($srv in $servers) {
  Write-Host ""
  Write-Host "=== via $srv ===" -ForegroundColor Cyan
  foreach ($r in $records) {
    try {
      $ans = Resolve-DnsName -Name $r.Name -Type $r.Type -Server $srv -DnsOnly -ErrorAction Stop |
             Where-Object { $_.Type -eq $r.Type } | Select-Object -First 1
      if ($null -eq $ans) {
        Write-Host ("  [---] {0,-50} {1,-6} (no answer of that type)" -f $r.Name, $r.Type) -ForegroundColor DarkGray
        continue
      }
      $flag  = if ($ans.TTL -le 300) { '[OK]  ' } else { '[OLD] ' }
      $color = if ($ans.TTL -le 300) { 'Green'  } else { 'Yellow' }
      Write-Host ("  {0}{1,-50} {2,-6} TTL={3}" -f $flag, $r.Name, $r.Type, $ans.TTL) -ForegroundColor $color
    } catch {
      Write-Host ("  [ERR] {0,-50} {1,-6} {2}" -f $r.Name, $r.Type, $_.Exception.Message) -ForegroundColor Red
    }
  }
}

Write-Host ""
Write-Host "Reading the output:" -ForegroundColor DarkGray
Write-Host "  - Every row in the authoritative-NS section should be [OK] before the NS flip." -ForegroundColor DarkGray
Write-Host "  - Public resolver rows ([OK] in 1.1.1.1 / 8.8.8.8) confirm worldwide cache has aged out." -ForegroundColor DarkGray
Write-Host "  - [OLD] = TTL still > 300; that record was missed when batch-lowering at WHC." -ForegroundColor DarkGray
