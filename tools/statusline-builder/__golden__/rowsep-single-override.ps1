# Claude Code statusline — 由 ClientKit statusline-builder 產生
# PowerShell 5.1+ / 7；請以 UTF-8（含 BOM）儲存。
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$e = [char]27

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

$Segs = @()

# model — always/empty
$v = $d.model.display_name
if ($null -ne $v -and $v -ne '') {
  $disp = [char]0x6D + [char]0x6F + [char]0x64 + [char]0x65 + [char]0x6C + [char]0x3A + ' ' + $v
  $Segs += "$e[0m$e[38;5;226m" + $disp
}

# cost — always/empty
$v = $d.cost.total_cost_usd
if ($null -ne $v) {
  $disp = [char]0x63 + [char]0x6F + [char]0x73 + [char]0x74 + [char]0x3A + ' ' + (Format-Cost $v)
  $Segs += "$e[0m$e[38;5;220m" + $disp
}

# duration — always/empty
$v = $d.cost.total_duration_ms
if ($null -ne $v) {
  $disp = [char]0x64 + [char]0x75 + [char]0x72 + [char]0x3A + ' ' + (Format-Duration $v)
  $Segs += "$e[0m$e[38;5;118m" + $disp
}

$out = ''
$n = $Segs.Count
for ($i = 0; $i -lt $n; $i++) {
  if ($i -gt 0) { $out += "$e[0m" + [char]0xB7 }
  $out += $Segs[$i]
}
$out += "$e[0m"

[Console]::Out.Write($out)
exit 0
