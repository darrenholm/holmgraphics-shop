# holm-handler.ps1
#
# Handles holm:// URL invocations from the staff job page.
#
# URL shape:  holm://open?path=<percent-encoded Windows path>
# Behaviour:
#   - Path is a directory  → open in File Explorer
#   - Path is a file       → open with the default associated program
#
# Security:
#   - Only paths under \\LS220D146\share\ or L:\ are allowed.
#   - Path is canonicalised via [System.IO.Path]::GetFullPath() so '..'
#     traversal can't escape the allowlist (e.g. L:\foo\..\..\Windows
#     resolves to C:\Windows and is rejected).
#   - All invocations (allowed AND rejected) are logged to
#     %LOCALAPPDATA%\HolmGraphics\holm-handler.log so we have a trail
#     if a malicious link ever shows up in browser history.

$ErrorActionPreference = 'Stop'

# ─── Logging ────────────────────────────────────────────────────────────────
$LogDir = Join-Path $env:LOCALAPPDATA 'HolmGraphics'
if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir -Force | Out-Null }
$LogFile = Join-Path $LogDir 'holm-handler.log'

function Write-Log {
    param([string]$msg)
    "$([DateTime]::Now.ToString('yyyy-MM-dd HH:mm:ss')) $msg" |
        Out-File -FilePath $LogFile -Append -Encoding utf8
}

# Best-effort GUI alert. Loaded lazily — if WinForms isn't available
# (Server Core, Nano), we log and exit silently rather than crashing.
function Show-Alert {
    param([string]$title, [string]$body, [string]$icon = 'Warning')
    try {
        Add-Type -AssemblyName System.Windows.Forms
        [System.Windows.Forms.MessageBox]::Show($body, $title, 'OK', $icon) | Out-Null
    } catch {
        Write-Log "ALERT (no GUI): $title — $body"
    }
}

# ─── Parse URL ──────────────────────────────────────────────────────────────
$Url = $args[0]
if (-not $Url) {
    Write-Log "ERROR: no URL argument"
    exit 1
}
Write-Log "INVOCATION: $Url"

# Expected shape: holm://<anything>?<query>. The "open" verb is the only
# one we support today, but we accept any verb so future verbs (e.g.
# holm://reveal?path=… to /select, instead of cd-ing) can be added without
# breaking older installers.
if ($Url -notmatch '^holm:[/\\]{0,2}[^?]*\?(.+)$') {
    Write-Log "REJECTED (malformed URL): $Url"
    Show-Alert 'holm:// — bad URL' "Don't recognise this holm:// URL:`n$Url"
    exit 1
}
$QueryString = $Matches[1]

# Pull out path=<value>. We don't require any specific verb in the URL
# path component — only the path query param matters.
$EncodedPath = $null
foreach ($pair in $QueryString -split '&') {
    $kv = $pair -split '=', 2
    if ($kv.Length -eq 2 -and $kv[0] -eq 'path') {
        $EncodedPath = $kv[1]
        break
    }
}
if (-not $EncodedPath) {
    Write-Log "REJECTED (no path param): $Url"
    Show-Alert 'holm:// — no path' "URL has no 'path' parameter:`n$Url"
    exit 1
}

# UnescapeDataString is built into mscorlib — no System.Web required.
$Path = [System.Uri]::UnescapeDataString($EncodedPath)

# ─── Validate against allowlist ─────────────────────────────────────────────
# Canonicalise FIRST so a smuggled '..' segment can't bypass the
# StartsWith check (e.g. L:\foo\..\..\Windows → C:\Windows).
$Resolved = [System.IO.Path]::GetFullPath($Path)

$AllowedRoots = @(
    '\\LS220D146\share\',
    'L:\'
)
$IsAllowed = $false
foreach ($root in $AllowedRoots) {
    if ($Resolved.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)) {
        $IsAllowed = $true; break
    }
}
if (-not $IsAllowed) {
    Write-Log "REJECTED (path not in allowlist): raw='$Path' resolved='$Resolved'"
    Show-Alert 'holm:// — path rejected' (
        "Refusing to open this path:`n`n$Path`n`n" +
        "Only paths under \\LS220D146\share\ or L:\ are allowed.`n" +
        "(See %LOCALAPPDATA%\HolmGraphics\holm-handler.log for details.)"
    )
    exit 1
}

# ─── Open it ────────────────────────────────────────────────────────────────
if (-not (Test-Path -LiteralPath $Resolved)) {
    Write-Log "ERROR (path not found): $Resolved"
    Show-Alert 'holm:// — path missing' (
        "This path doesn't exist on disk:`n`n$Resolved"
    ) 'Information'
    exit 1
}

if (Test-Path -LiteralPath $Resolved -PathType Container) {
    Write-Log "OPEN dir: $Resolved"
    # -ArgumentList with an array delegates quoting to PowerShell so
    # spaces, parens, ampersands etc. survive into explorer.exe correctly.
    Start-Process -FilePath explorer.exe -ArgumentList @($Resolved)
} else {
    Write-Log "OPEN file: $Resolved"
    # Invoke-Item respects file associations — same effect as
    # double-clicking in Explorer. -LiteralPath skips wildcard expansion.
    Invoke-Item -LiteralPath $Resolved
}
