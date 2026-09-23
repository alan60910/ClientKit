# Claude Code statusline — 由 ClientKit statusline-builder 產生
# PowerShell 5.1+ / 7；請以 UTF-8（含 BOM）儲存。
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$e = [char]27

function Format-Reset7d($epoch, $now) {
  $diff = [double]$epoch - [double]$now
  $t = [DateTimeOffset]::FromUnixTimeSeconds([long]$epoch).ToLocalTime()
  $stamp = $t.ToString('MM/dd HH:mm', [System.Globalization.CultureInfo]::InvariantCulture)
  if ($diff -ge 86400) {
    return [char]0x21BA + ' ' + ([string][long][math]::Floor($diff / 86400)) + 'd (' + $stamp + ')'
  }
  $h = [long][math]::Floor($diff / 3600)
  $m = [long][math]::Floor(($diff % 3600) / 60)
  return [char]0x21BA + ' ' + ([string]$h) + 'h' + ([string]$m) + 'm (' + $stamp + ')'
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

# effort — conditional/hide
$Ac0Id = $d.effort.level
if ($null -eq $Ac0Id) { $Ac0Id = '' }
if ($Ac0Id -ceq 'low') { $Ac0Tail = '5;3'; $Ac0Fg = '38;5;3'; $Ac0AutoFg = '38;5;16' }
elseif ($Ac0Id -ceq 'medium') { $Ac0Tail = '5;2'; $Ac0Fg = '38;5;2'; $Ac0AutoFg = '38;5;231' }
elseif ($Ac0Id -ceq 'high') { $Ac0Tail = '5;4'; $Ac0Fg = '38;5;4'; $Ac0AutoFg = '38;5;231' }
elseif ($Ac0Id -ceq 'xhigh') { $Ac0Tail = '5;5'; $Ac0Fg = '38;5;5'; $Ac0AutoFg = '38;5;231' }
elseif ($Ac0Id -ceq 'max') { $Ac0Tail = '5;15'; $Ac0Fg = '38;5;15'; $Ac0AutoFg = '38;5;16' }
else { $Ac0Tail = '5;9'; $Ac0Fg = '38;5;9'; $Ac0AutoFg = '38;5;16' }
$Ac0Px = "$e[0m"
if ($Ac0AutoFg -ne '') { $Ac0Px += "$e[" + $Ac0AutoFg + 'm' }
if ($Ac0Tail -ne '') { $Ac0Px += "$e[48;" + $Ac0Tail + 'm' }
$v = $d.effort.level
if ($null -ne $v -and $v -ne '') {
  $disp = [char]0x65 + [char]0x66 + [char]0x66 + [char]0x3A + ' ' + $v + ' '
  $Segs += $Ac0Px + $disp
}

# rate-7d — percentage/dash＋bar
$v = $d.rate_limits.seven_day.used_percentage
if ($null -eq $v) {
  $bn = 0
  $bucketFg = '38;5;88'
  $vt = '(n/a)'
} else {
  $p = [double]$v
  $bn = [long][math]::Floor($p / 5)
  if ($bn -gt 20) { $bn = 20 }
  if ($bn -lt 0) { $bn = 0 }
  $vt = ([string][long][math]::Floor($p)) + '%'
  $bucketFg = '38;5;88'
}
$filled = ([string][char]0x2588) * [int]$bn
$empty = ([string][char]0x2591) * [int](20 - $bn)
$s = "$e[0m"
if ('38;5;231' -ne '') { $s += "$e[" + '38;5;231' + 'm' }
if ('5;88' -ne '') { $s += "$e[48;" + '5;88' + 'm' }
$s += ''
$s += "$e[0m"
if ($bucketFg -ne '') { $s += "$e[" + $bucketFg + 'm' }
if ('5;88' -ne '') { $s += "$e[48;" + '5;88' + 'm' }
$s += $filled
$s += "$e[0m"
if ('5;88' -ne '') { $s += "$e[48;" + '5;88' + 'm' }
$s += $empty
$s += "$e[0m"
if ($bucketFg -ne '') { $s += "$e[" + $bucketFg + 'm' }
if ('5;88' -ne '') { $s += "$e[48;" + '5;88' + 'm' }
$s += ' ' + $vt + ' '
$Segs += $s

# reset-7d — conditional/hide
$v = $d.rate_limits.seven_day.resets_at
if ($null -ne $v -and $Now -lt $v) {
  $disp = (Format-Reset7d $v $Now) + ' '
  $Segs += "$e[0m$e[38;5;16m$e[48;5;99m" + $disp
}

$out = ''
$n = $Segs.Count
for ($i = 0; $i -lt $n; $i++) {
  $out += $Segs[$i]
}
$out += "$e[0m"

[Console]::Out.Write($out)
exit 0
