# Generates sticker / icon SVG files from tools/art.json into miniprogram/assets.
# Usage:  powershell -ExecutionPolicy Bypass -File tools\gen-assets.ps1
# Keep this file ASCII-only (Windows PowerShell 5.1 reads BOM-less scripts as ANSI).
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$spec = [System.IO.File]::ReadAllText((Join-Path $PSScriptRoot 'art.json'), [System.Text.Encoding]::UTF8) | ConvertFrom-Json
$enc = New-Object System.Text.UTF8Encoding($false)
$outS = Join-Path $root 'miniprogram\assets\stickers'
$outI = Join-Path $root 'miniprogram\assets\icons'
New-Item -ItemType Directory -Force $outS, $outI | Out-Null

$EDGE = '#FFFAEE'   # die-cut border colour
$PAD = 9            # die-cut border width (viewBox units, both sides)

function Paint([string]$s) {
  foreach ($p in $spec.colors.PSObject.Properties) { $s = $s.Replace('{' + $p.Name + '}', $p.Value) }
  return $s
}

# Same artwork, flattened to the border colour and fattened: becomes the white sticker edge.
function Backing([string]$s) {
  $s = [regex]::Replace($s, "(?<![-\w])fill='(?!none)[^']*'", "fill='$EDGE'")
  $s = [regex]::Replace($s, "(?<![-\w])stroke='(?!none)[^']*'", "stroke='$EDGE'")
  $s = [regex]::Replace($s, "stroke-width='([\d.]+)'", {
      param($m) "stroke-width='" + ([double]$m.Groups[1].Value + $PAD).ToString([cultureinfo]::InvariantCulture) + "'"
    })
  $s = [regex]::Replace($s, " stroke-dasharray='[^']*'", '')
  return $s
}

function Write-Sticker([string]$name, [string]$body, [int]$w) {
  $b = Paint $body
  $svg = "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 $w 100'>" +
    "<g fill='$EDGE' stroke='$EDGE' stroke-width='$PAD' stroke-linejoin='round' stroke-linecap='round'>" + (Backing $b) + "</g>" +
    $b + "</svg>"
  [System.IO.File]::WriteAllText((Join-Path $outS "$name.svg"), $svg, $enc)
}

$n = 0
foreach ($p in $spec.stickers.PSObject.Properties) { Write-Sticker $p.Name $p.Value 100; $n++ }

foreach ($w in $spec.words) {
  $line = ''
  if ($w.line) { $line = " stroke='$($w.line)' stroke-width='4'" }
  $body = "<rect x='14' y='24' width='172' height='52' rx='26' fill='$($w.bg)'$line/>" +
    "<text x='100' y='61' text-anchor='middle' font-size='30' font-weight='700' font-family='PingFang SC, Microsoft YaHei, sans-serif' fill='$($w.fg)'>$($w.text)</text>"
  Write-Sticker $w.key $body 200
  $n++
}

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

"stickers: $n   icons: $i"

# ---- Sticker atlas for the 3D scene: one 2048x2048 PNG + scene/atlas.js (key -> [col, row, cells]) ----
# Rendered with headless Edge so the PNG matches the SVGs exactly.
$edge = @("C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe", "C:\Program Files\Microsoft\Edge\Application\msedge.exe") |
  Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $edge) { "atlas: skipped (Microsoft Edge not found)"; return }

$cell = 256; $cols = 8; $col = 0; $row = 0
$html = "<html><body style='margin:0;background:transparent;width:2048px;height:2048px;position:relative;overflow:hidden'>"
$map = New-Object System.Collections.ArrayList
foreach ($f in Get-ChildItem (Join-Path $outS '*.svg') | Sort-Object Name) {
  $cells = 1
  if ($f.BaseName -like 'w-*') { $cells = 2 }
  if ($col + $cells -gt $cols) { $col = 0; $row++ }
  $u = 'file:///' + ($f.FullName -replace '\\', '/')
  $x = $col * $cell + 8; $y = $row * $cell + 8; $w = $cells * $cell - 16; $h = $cell - 16
  $html += "<img src='$u' style='position:absolute;left:${x}px;top:${y}px;width:${w}px;height:${h}px;filter:drop-shadow(0 3px 4px rgba(70,48,20,.3))'>"
  [void]$map.Add("  '$($f.BaseName)': [$col, $row, $cells]")
  $col += $cells
}
if ($row -ge 8) { throw "atlas is full: $($row + 1) rows needed, 8 available" }
$html += '</body></html>'
$tmp = Join-Path $env:TEMP 'youpage-atlas'
New-Item -ItemType Directory -Force $tmp | Out-Null
$page = Join-Path $tmp 'atlas.html'
[System.IO.File]::WriteAllText($page, $html, $enc)
$png = Join-Path $root 'miniprogram\assets\atlas.png'
# Render to a temp file first so a failed run never leaves the project without an atlas.
# Start-Process (not `&`): Edge chatters on stderr, which would abort the script under ErrorActionPreference=Stop.
$shot = Join-Path $tmp 'atlas.png'
if (Test-Path $shot) { Remove-Item $shot -Force }
$edgeArgs = @('--headless', '--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
  '--default-background-color=00000000', "--user-data-dir=`"$tmp\profile`"", '--window-size=2048,2048',
  "--screenshot=`"$shot`"", ('file:///' + ($page -replace '\\', '/')))
Start-Process -FilePath $edge -ArgumentList $edgeArgs -Wait -WindowStyle Hidden
for ($k = 0; $k -lt 20 -and -not (Test-Path $shot); $k++) { Start-Sleep -Milliseconds 500 }
if (-not (Test-Path $shot)) { throw 'atlas: Edge did not produce the screenshot' }
Copy-Item $shot $png -Force
$js = "// Generated by tools/gen-assets.ps1 together with assets/atlas.png: key -> [col, row, cells wide]`nmodule.exports = {`n  size: 2048,`n  cell: $cell,`n  map: {`n" + ($map -join ",`n") + "`n  }`n}`n"
[System.IO.File]::WriteAllText((Join-Path $root 'miniprogram\scene\atlas.js'), $js, $enc)
"atlas: $($map.Count) stickers, $((Get-Item $png).Length) bytes"
