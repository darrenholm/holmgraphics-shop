# print-brother.ps1
# Prints a PNG label to a named Windows printer (e.g. the Brother QL-810W)
# N times, at a fixed label size. Used by the print bridge's /print-brother
# endpoint for Brother labels (DK-2606 etc.), since Brother has no DYMO-Connect
# style local service. Uses only built-in .NET — no b-PAC SDK required.
param(
  [Parameter(Mandatory=$true)][string]$Printer,
  [Parameter(Mandatory=$true)][string]$Image,
  [int]$Copies = 1,
  [double]$WidthMm = 62,
  [double]$HeightMm = 19
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$img = [System.Drawing.Image]::FromFile($Image)
try {
  $pd = New-Object System.Drawing.Printing.PrintDocument
  $pd.PrinterSettings.PrinterName = $Printer
  if (-not $pd.PrinterSettings.IsValid) { Write-Error "Printer '$Printer' not found"; exit 2 }
  $pd.PrinterSettings.Copies = [int][math]::Max(1, [math]::Min(500, $Copies))
  $pd.DocumentName = 'Holm Graphics Label'
  # Label size in hundredths of an inch (PaperSize unit).
  $wHi = [int][math]::Round($WidthMm  / 25.4 * 100)
  $hHi = [int][math]::Round($HeightMm / 25.4 * 100)
  $pd.DefaultPageSettings.PaperSize = New-Object System.Drawing.Printing.PaperSize('HGLabel', $wHi, $hHi)
  $pd.DefaultPageSettings.Margins   = New-Object System.Drawing.Printing.Margins(0,0,0,0)
  $pd.OriginAtMargins = $false
  $pd.add_PrintPage({ param($s,$e)
    $e.Graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $e.Graphics.DrawImage($img, $e.PageBounds)
  })
  $pd.Print()
} finally {
  $img.Dispose()
}
