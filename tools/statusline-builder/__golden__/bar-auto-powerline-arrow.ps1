# Claude Code statusline — 由 ClientKit statusline-builder 產生
# PowerShell 5.1+ / 7；請以 UTF-8（含 BOM）儲存。
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$e = [char]27
$ARROW = [string][char]0xE0B0
$Th0Fg = @('38;5;46', '38;5;82', '38;5;118', '38;5;154', '38;5;190', '38;5;226', '38;5;220', '38;5;214', '38;5;208', '38;5;196')

function Format-Reset5h($epoch, $now) {
  $diff = [double]$epoch - [double]$now
  $t = [DateTimeOffset]::FromUnixTimeSeconds([long]$epoch).ToLocalTime()
  $clock = $t.ToString('HH:mm', [System.Globalization.CultureInfo]::InvariantCulture)
  if ($diff -ge 3600) {
    return [char]0x21BA + ' ' + ([string][long][math]::Floor($diff / 3600)) + 'h (' + $clock + ')'
  }
  return [char]0x21BA + ' ' + ([string][long][math]::Floor($diff / 60)) + 'm (' + $clock + ')'
}

$raw = [Console]::In.ReadToEnd()
$d = $null
try { $d = $raw | ConvertFrom-Json -ErrorAction Stop } catch { }

$__nowEnv = $env:STATUSLINE_NOW_EPOCH
if ([string]::IsNullOrEmpty($__nowEnv)) {
  $Now = [DateTimeOffset]::Now.ToUnixTimeSeconds()
} else {
  $__nowParsed = 0L
  if ([long]::TryParse($__nowEnv, [ref]$__nowParsed)) {
    $Now = $__nowParsed
  } else {
    $Now = [DateTimeOffset]::Now.ToUnixTimeSeconds()
  }
}

$Segs = @()
$BgT = @()

# model — always/empty
$Ac0Id = $d.model.id
if ($null -eq $Ac0Id) { $Ac0Id = '' }
if ($Ac0Id -clike 'claude-fable-*') { $Ac0Tail = '5;214'; $Ac0Fg = '38;5;214'; $Ac0AutoFg = '38;5;16' }
elseif ($Ac0Id -clike 'claude-opus-*') { $Ac0Tail = '5;135'; $Ac0Fg = '38;5;135'; $Ac0AutoFg = '38;5;16' }
elseif ($Ac0Id -clike 'claude-haiku-*') { $Ac0Tail = '5;2'; $Ac0Fg = '38;5;2'; $Ac0AutoFg = '38;5;231' }
else { $Ac0Tail = '5;6'; $Ac0Fg = '38;5;6'; $Ac0AutoFg = '38;5;231' }
$Ac0Px = "$e[0m"
if ($Ac0AutoFg -ne '') { $Ac0Px += "$e[" + $Ac0AutoFg + 'm' }
if ($Ac0Tail -ne '') { $Ac0Px += "$e[48;" + $Ac0Tail + 'm' }
$v = $d.model.display_name
if ($null -ne $v -and $v -ne '') {
  $disp = [char]0x6D + [char]0x6F + [char]0x64 + [char]0x65 + [char]0x6C + [char]0x3A + ' ' + $v
  $Segs += $Ac0Px + $disp
  $BgT += $Ac0Tail
}

# context-used — percentage/dash＋bar＋threshold
$v = $d.context_window.used_percentage
if ($null -eq $v) {
  $bn = 0
  $bucketFg = '38;5;240'
  $vt = '(n/a)'
} else {
  $p = [double]$v
  $bn = [long][math]::Floor($p / 5)
  if ($bn -gt 20) { $bn = 20 }
  if ($bn -lt 0) { $bn = 0 }
  $vt = ([string][long][math]::Floor($p)) + '%'
  $idx = [long][math]::Floor($p / 10)
  if ($idx -gt 9) { $idx = 9 }
  if ($idx -lt 0) { $idx = 0 }
  $bucketFg = $Th0Fg[$idx]
}
$filled = ([string][char]0x2588) * [int]$bn
$empty = ([string][char]0x2591) * [int](20 - $bn)
$s = "$e[0m"
if ('38;5;231' -ne '') { $s += "$e[" + '38;5;231' + 'm' }
if ('5;240' -ne '') { $s += "$e[48;" + '5;240' + 'm' }
$s += ''
$s += "$e[0m"
if ($bucketFg -ne '') { $s += "$e[" + $bucketFg + 'm' }
if ('5;240' -ne '') { $s += "$e[48;" + '5;240' + 'm' }
$s += $filled
$s += "$e[0m"
if ('5;240' -ne '') { $s += "$e[48;" + '5;240' + 'm' }
$s += $empty
$s += "$e[0m"
if ($bucketFg -ne '') { $s += "$e[" + $bucketFg + 'm' }
if ('5;240' -ne '') { $s += "$e[48;" + '5;240' + 'm' }
$s += ' ' + $vt
$Segs += $s
$BgT += '5;240'

# reset-5h — conditional/hide
$v = $d.rate_limits.five_hour.resets_at
if ($null -ne $v -and $Now -lt $v) {
  $disp = (Format-Reset5h $v $Now)
  $Segs += "$e[0m$e[38;5;16m$e[48;5;99m" + $disp
  $BgT += '5;99'
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
