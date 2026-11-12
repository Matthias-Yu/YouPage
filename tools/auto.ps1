# Minimal miniprogram-automator client over WebSocket (ASCII only).
# Usage: powershell -File auto.ps1 -Steps steps.json -Out <dir>
param([string]$Steps, [string]$Out, [int]$Port = 9420)
$ErrorActionPreference = 'Stop'
$ws = New-Object System.Net.WebSockets.ClientWebSocket
$ct = [Threading.CancellationToken]::None
$ws.ConnectAsync([Uri]"ws://127.0.0.1:$Port", $ct).Wait()
$script:events = New-Object System.Collections.ArrayList

function Send-Json($obj) {
  $json = $obj | ConvertTo-Json -Depth 30 -Compress
  $bytes = [Text.Encoding]::UTF8.GetBytes($json)
  $seg = New-Object 'ArraySegment[byte]' -ArgumentList @(, $bytes)
  $ws.SendAsync($seg, [System.Net.WebSockets.WebSocketMessageType]::Text, $true, $ct).Wait()
}
function Recv-Text([int]$timeoutMs = 30000) {
  $buf = New-Object byte[] 262144
  $ms = New-Object IO.MemoryStream
  do {
    $seg = New-Object 'ArraySegment[byte]' -ArgumentList @(, $buf)
    $task = $ws.ReceiveAsync($seg, $ct)
    if (-not $task.Wait($timeoutMs)) { throw "receive timeout" }
    $ms.Write($buf, 0, $task.Result.Count)
  } while (-not $task.Result.EndOfMessage)
  [Text.Encoding]::UTF8.GetString($ms.ToArray())
}
function Call($method, $params, [switch]$Raw) {
  if ($null -eq $params) { $params = @{} }
  $id = [guid]::NewGuid().ToString()
  Send-Json @{ id = $id; method = $method; params = $params }
  while ($true) {
    $text = Recv-Text
    if ($text.Contains($id)) {
      if ($Raw) { return $text }
      $msg = $text | ConvertFrom-Json
      if ($msg.error) { throw "$method failed: $($msg.error.message)" }
      return $msg.result
    }
    if ($text.Length -lt 4000) { [void]$script:events.Add($text) }
  }
}
function PageId() { (Call 'App.getCurrentPage').pageId }
function ElId($sel) { (Call 'Page.getElement' @{ selector = $sel; pageId = (PageId) }).elementId }

$list = [IO.File]::ReadAllText($Steps, [Text.Encoding]::UTF8) | ConvertFrom-Json
[void](Call 'App.enableLog')
foreach ($s in $list) {
  try {
    switch ($s.do) {
      'sleep' { Start-Sleep -Milliseconds $s.ms }
      'page' { $p = Call 'App.getCurrentPage'; "page: $($p.path) $($p.query | ConvertTo-Json -Compress)" }
      'shot' {
        $text = Call 'App.captureScreenshot' @{} -Raw
        $m = [regex]::Match($text, '"data":"([^"]+)"')
        if (-not $m.Success) { "shot $($s.file): no data: $($text.Substring(0, [Math]::Min(300, $text.Length)))" }
        else { [IO.File]::WriteAllBytes((Join-Path $Out $s.file), [Convert]::FromBase64String($m.Groups[1].Value)); "shot: $($s.file)" }
      }
      'tap' { $pid2 = PageId; $el = (Call 'Page.getElement' @{ selector = $s.sel; pageId = $pid2 }).elementId; [void](Call 'Element.tap' @{ elementId = $el; pageId = $pid2 }); "tap: $($s.sel)" }
      'tapin' {
        $pid2 = PageId
        $hostEl = (Call 'Page.getElement' @{ selector = $s.host; pageId = $pid2 }).elementId
        $el = (Call 'Element.getElement' @{ elementId = $hostEl; pageId = $pid2; selector = $s.sel }).elementId
        [void](Call 'Element.tap' @{ elementId = $el; pageId = $pid2 }); "tapin: $($s.host) $($s.sel)"
      }
      'drag' {
        $pid2 = PageId
        $hostEl = (Call 'Page.getElement' @{ selector = $s.host; pageId = $pid2 }).elementId
        $el = (Call 'Element.getElement' @{ elementId = $hostEl; pageId = $pid2; selector = $s.sel }).elementId
        $x0 = $s.from[0]; $y0 = $s.from[1]; $x1 = $s.to[0]; $y1 = $s.to[1]
        $t0 = @(@{ identifier = 0; pageX = $x0; pageY = $y0; clientX = $x0; clientY = $y0 })
        [void](Call 'Element.touchstart' @{ elementId = $el; pageId = $pid2; touches = $t0; changedTouches = $t0 })
        for ($i = 1; $i -le 4; $i++) {
          $x = $x0 + ($x1 - $x0) * $i / 4; $y = $y0 + ($y1 - $y0) * $i / 4
          $t = @(@{ identifier = 0; pageX = $x; pageY = $y; clientX = $x; clientY = $y })
          [void](Call 'Element.touchmove' @{ elementId = $el; pageId = $pid2; touches = $t; changedTouches = $t })
        }
        $t1 = @(@{ identifier = 0; pageX = $x1; pageY = $y1; clientX = $x1; clientY = $y1 })
        [void](Call 'Element.touchend' @{ elementId = $el; pageId = $pid2; touches = @(); changedTouches = $t1 })
        "drag: $($s.sel) ($x0,$y0)->($x1,$y1)"
      }
      'touch' {
        # one-finger gesture on an element: points = [[x,y],...] in client px
        $pid2 = PageId
        $el = (Call 'Page.getElement' @{ selector = $s.sel; pageId = $pid2 }).elementId
        $pts = @($s.points)
        $mk = { param($pt) @(@{ identifier = 0; pageX = $pt[0]; pageY = $pt[1]; clientX = $pt[0]; clientY = $pt[1] }) }
        $t0 = & $mk $pts[0]
        [void](Call 'Element.touchstart' @{ elementId = $el; pageId = $pid2; touches = $t0; changedTouches = $t0 })
        for ($i = 1; $i -lt $pts.Count; $i++) {
          $t = & $mk $pts[$i]
          [void](Call 'Element.touchmove' @{ elementId = $el; pageId = $pid2; touches = $t; changedTouches = $t })
          Start-Sleep -Milliseconds 30
        }
        $t1 = & $mk $pts[$pts.Count - 1]
        [void](Call 'Element.touchend' @{ elementId = $el; pageId = $pid2; touches = @(); changedTouches = $t1 })
        "touch: $($s.sel) $($pts.Count) points"
      }
      'wx' { $r = Call 'App.callWxMethod' @{ method = $s.method; args = @($s.args) }; "wx.$($s.method): $($r | ConvertTo-Json -Depth 6 -Compress)" }
      'eval' { $r = Call 'App.callFunction' @{ functionDeclaration = $s.fn; args = @($s.args | Where-Object { $null -ne $_ }) }; "eval: $($r | ConvertTo-Json -Depth 8 -Compress)" }
      'data' { $r = Call 'Page.getData' @{ pageId = (PageId); path = $s.path }; "data[$($s.path)]: $($r | ConvertTo-Json -Depth 8 -Compress)" }
      'raw' { $r = Call $s.m $s.p; "raw $($s.m): $($r | ConvertTo-Json -Depth 8 -Compress)" }
    }
  } catch { "STEP FAILED ($($s.do) $($s.sel)$($s.file)): $($_.Exception.Message)" }
}
Start-Sleep -Milliseconds 300
"--- events ($($script:events.Count)):"
$script:events | Select-Object -First 40
$ws.Dispose()
