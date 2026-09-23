# Claude Code statusline — 由 ClientKit statusline-builder 產生
# PowerShell 5.1+ / 7；請以 UTF-8（含 BOM）儲存。
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$e = [char]27
$Th0Fg = @('38;5;46', '38;5;82', '38;5;118', '38;5;154', '38;5;190', '38;5;226', '38;5;220', '38;5;214', '38;5;208', '38;5;196')

function Format-Cost($c) {
  $s = [long][math]::Floor([double]$c * 10000)
  if ($s -lt 0) { $s = 0 }
  $w = [long][math]::Floor($s / 10000)
  $f = ([string]($s % 10000 + 10000)).Substring(1)
  return '$' + $w + '.' + $f
}

function Format-Duration($ms) {
  $x = [double]$ms
  $h = [long][math]::Floor($x / 3600000)
  $m = [long][math]::Floor($x / 60000) % 60
  $s = [long][math]::Floor($x / 1000) % 60
  if ($h -gt 0) { return [string]$h + 'h' + [string]$m + 'm' }
  if ($m -gt 0) { return [string]$m + 'm' + [string]$s + 's' }
  return [string]$s + 's'
}

$raw = [Console]::In.ReadToEnd()
$d = $null
try { $d = $raw | ConvertFrom-Json -ErrorAction Stop } catch { }

# ── row 0（row=0） ──
$Segs0 = @()

# model — always/empty
$v = $d.model.display_name
if ($null -ne $v -and $v -ne '') {
  $disp = $v
  $Segs0 += "$e[0m$e[38;5;75m" + $disp
}

# cwd — always/empty
$v = $d.cwd
if ($null -ne $v -and $v -ne '') {
  $hm = $env:USERPROFILE
  $pv = $v
  if ($hm -ne '') {
    if ($v -eq $hm) { $pv = '~' }
    elseif ($v.StartsWith($hm + '/') -or $v.StartsWith($hm + '\')) { $pv = '~' + $v.Substring($hm.Length) }
  }
  $disp = '@' + $pv
  $Segs0 += "$e[0m$e[38;5;45m" + $disp
}

# ── row 1（row=1） ──
$Segs1 = @()

# cost — always/empty
$v = $d.cost.total_cost_usd
if ($null -ne $v) {
  $disp = (Format-Cost $v)
  $Segs1 += "$e[0m$e[38;5;220m" + $disp
}

# duration — always/empty
$v = $d.cost.total_duration_ms
if ($null -ne $v) {
  $disp = (Format-Duration $v)
  $Segs1 += "$e[0m$e[38;5;118m" + $disp
}

# ── row 2（row=2） ──
$Segs2 = @()

# context-used — percentage/dash＋threshold
$v = $d.context_window.used_percentage
if ($null -eq $v) {
  $disp = '(n/a)'
  $Segs2 += "$e[0m$e[38;5;240m" + $disp
} else {
  $p = [double]$v
  $vt = ([string][long][math]::Floor($p)) + '%'
  $idx = [long][math]::Floor($p / 10)
  if ($idx -gt 9) { $idx = 9 }
  if ($idx -lt 0) { $idx = 0 }
  $fg = $Th0Fg[$idx]
  $s = "$e[0m"
  if ($fg -ne '') { $s += "$e[" + $fg + 'm' }
  $s += $vt
  $Segs2 += $s
}

# rate-5h — percentage/dash
$v = $d.rate_limits.five_hour.used_percentage
if ($null -eq $v) {
  $vt = '(n/a)'
} else {
  $vt = ([string][long][math]::Floor([double]$v)) + '%'
}
$disp = $vt
$Segs2 += "$e[0m$e[38;5;99m" + $disp

# ── row 0 join ──
$RowOut0 = ''
$n = $Segs0.Count
for ($i = 0; $i -lt $n; $i++) {
  if ($i -gt 0) { $RowOut0 += "$e[0m" + '|' }
  $RowOut0 += $Segs0[$i]
}
$RowOut0 += "$e[0m"

# ── row 1 join ──
$RowOut1 = ''
$n = $Segs1.Count
for ($i = 0; $i -lt $n; $i++) {
  if ($i -gt 0) { $RowOut1 += "$e[0m" + '|' }
  $RowOut1 += $Segs1[$i]
}
$RowOut1 += "$e[0m"

# ── row 2 join ──
$RowOut2 = ''
$n = $Segs2.Count
for ($i = 0; $i -lt $n; $i++) {
  if ($i -gt 0) { $RowOut2 += "$e[0m" + '|' }
  $RowOut2 += $Segs2[$i]
}
$RowOut2 += "$e[0m"

# ── 存活列過濾＋LF 串接（步驟 2–4） ──
$Rows = @()
if ($Segs0.Count -gt 0) { $Rows += $RowOut0 }
if ($Segs1.Count -gt 0) { $Rows += $RowOut1 }
if ($Segs2.Count -gt 0) { $Rows += $RowOut2 }
if ($Rows.Count -gt 0) {
  $out = [string]::Join("`n", $Rows)
} else {
  $out = "$e[0m"
}

[Console]::Out.Write($out)
exit 0
