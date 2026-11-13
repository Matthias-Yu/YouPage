# Generates the interface icon SVGs from tools/art.json.
# Usage:  powershell -ExecutionPolicy Bypass -File tools\gen-assets.ps1
# Keep this file ASCII-only (Windows PowerShell 5.1 reads BOM-less scripts as ANSI).
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$spec = [System.IO.File]::ReadAllText((Join-Path $PSScriptRoot 'art.json'), [System.Text.Encoding]::UTF8) | ConvertFrom-Json
$enc = New-Object System.Text.UTF8Encoding($false)
$outI = Join-Path $root 'miniprogram\assets\icons'
New-Item -ItemType Directory -Force $outI | Out-Null

$i = 0
foreach ($ic in $spec.icons.PSObject.Properties) {
  foreach ($c in $spec.iconColors.PSObject.Properties) {
    $suffix = ''
    if ($c.Name -ne 'ink') { $suffix = '-' + $c.Name }
    $svg = "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='$($c.Value)' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'>" + $ic.Value + "</svg>"
    [System.IO.File]::WriteAllText((Join-Path $outI ($ic.Name + $suffix + '.svg')), $svg, $enc)
    $i++
  }
}

"icons: $i"
