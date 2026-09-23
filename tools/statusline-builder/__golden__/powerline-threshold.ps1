# Claude Code statusline — 由 ClientKit statusline-builder 產生
# PowerShell 5.1+ / 7；請以 UTF-8（含 BOM）儲存。
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$e = [char]27
$ARROW = [string][char]0xE0B0
$Th0Bg = @('5;46', '5;82', '5;118', '5;154', '5;190', '5;226', '5;220', '5;214', '5;208', '5;196')
$Th0Fg = @('38;5;16', '38;5;16', '38;5;16', '38;5;16', '38;5;16', '38;5;16', '38;5;16', '38;5;16', '38;5;16', '38;5;16')

function Format-Cost($c) {
  $s = [long][math]::Floor([double]$c * 10000)
  if ($s -lt 0) { $s = 0 }
  $w = [long][math]::Floor($s / 10000)
  $f = ([string]($s % 10000 + 10000)).Substring(1)
  return '$' + $w + '.' + $f
}

$raw = [Console]::In.ReadToEnd()
$d = $null
try { $d = $raw | ConvertFrom-Json -ErrorAction Stop } catch { }

$Segs = @()
$BgT = @()

# model — always/empty
$v = $d.model.display_name
if ($null -ne $v -and $v -ne '') {
  $disp = [char]0x6D + [char]0x6F + [char]0x64 + [char]0x65 + [char]0x6C + [char]0x3A + ' ' + $v
  $Segs += "$e[0m$e[38;5;16m$e[48;5;226m" + $disp
  $BgT += '5;226'
}

# session-name — conditional/hide
$v = $d.session_name
if ($null -ne $v -and $v -ne '') {
  $disp = '[s]' + [char]0x73 + [char]0x65 + [char]0x73 + [char]0x73 + [char]0x3A + ' ' + $v
  $Segs += "$e[0m$e[38;5;16m$e[48;5;99m" + $disp
  $BgT += '5;99'
}

# context-used — percentage/dash＋threshold
$v = $d.context_window.used_percentage
if ($null -eq $v) {
  $disp = [char]0x75 + [char]0x73 + [char]0x65 + [char]0x64 + [char]0x3A + ' ' + '(n/a)'
  $Segs += "$e[0m$e[38;5;231m$e[48;5;240m" + $disp
  $BgT += '5;240'
} else {
  $p = [double]$v
  $vt = ([string][long][math]::Floor($p)) + '%'
  $idx = [long][math]::Floor($p / 10)
  if ($idx -gt 9) { $idx = 9 }
  if ($idx -lt 0) { $idx = 0 }
  $fg = $Th0Fg[$idx]
  $bg = $Th0Bg[$idx]
  $s = "$e[0m"
  if ($fg -ne '') { $s += "$e[" + $fg + 'm' }
  if ($bg -ne '') { $s += "$e[48;" + $bg + 'm' }
  $s += [char]0x75 + [char]0x73 + [char]0x65 + [char]0x64 + [char]0x3A + ' ' + $vt
  $Segs += $s
  $BgT += $bg
}

# cost — always/empty
$v = $d.cost.total_cost_usd
if ($null -ne $v) {
  $disp = [char]0x63 + [char]0x6F + [char]0x73 + [char]0x74 + [char]0x3A + ' ' + (Format-Cost $v)
  $Segs += "$e[0m$e[38;5;231m$e[48;5;16m" + $disp
  $BgT += '5;16'
}

$out = ''
$n = $Segs.Count
for ($i = 0; $i -lt $n; $i++) {
  if ($i -gt 0) {
    $out += "$e[0m"
    if ($BgT[$i - 1] -ne '') { $out += "$e[38;" + $BgT[$i - 1] + 'm' }
    if ($BgT[$i] -ne '') { $out += "$e[48;" + $BgT[$i] + 'm' }
    $out += $ARROW
  }
  $out += $Segs[$i]
}
if ($n -gt 0) {
  $out += "$e[0m"
  if ($BgT[$n - 1] -ne '') { $out += "$e[38;" + $BgT[$n - 1] + 'm' }
  $out += $ARROW
}
$out += "$e[0m"

[Console]::Out.Write($out)
exit 0
