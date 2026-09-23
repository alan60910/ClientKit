# Claude Code statusline — 由 ClientKit statusline-builder 產生
# PowerShell 5.1+ / 7；請以 UTF-8（含 BOM）儲存。
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$e = [char]27
$Th0Fg = @('38;5;244', '38;5;246', '38;5;247', '38;5;249', '38;5;250', '38;5;34', '38;5;34', '38;5;34', '38;5;220', '38;5;196')
$Th1Fg = @('38;5;196', '38;5;220', '38;5;34', '38;5;34', '38;5;34', '38;5;250', '38;5;249', '38;5;247', '38;5;246', '38;5;244')
$Th2Fg = @('38;5;46', '38;5;82', '38;5;118', '38;5;154', '38;5;190', '38;5;226', '38;5;220', '38;5;214', '38;5;208', '38;5;196')

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
if ('38;5;240' -ne '') { $s += "$e[" + '38;5;240' + 'm' }
$s += ''
$s += "$e[0m"
if ($bucketFg -ne '') { $s += "$e[" + $bucketFg + 'm' }
$s += $filled
$s += "$e[0m"
$s += $empty
$s += "$e[0m"
if ($bucketFg -ne '') { $s += "$e[" + $bucketFg + 'm' }
$s += ' ' + $vt
$Segs += $s

# context-remaining — percentage/dash＋bar＋threshold
$v = $d.context_window.remaining_percentage
if ($null -eq $v) {
  $bn = 0
  $bucketFg = '38;5;45'
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
  $bucketFg = $Th1Fg[$idx]
}
$filled = ([string][char]0x2588) * [int]$bn
$empty = ([string][char]0x2591) * [int](20 - $bn)
$s = "$e[0m"
if ('38;5;45' -ne '') { $s += "$e[" + '38;5;45' + 'm' }
$s += ''
$s += "$e[0m"
if ($bucketFg -ne '') { $s += "$e[" + $bucketFg + 'm' }
$s += $filled
$s += "$e[0m"
$s += $empty
$s += "$e[0m"
if ($bucketFg -ne '') { $s += "$e[" + $bucketFg + 'm' }
$s += ' ' + $vt
$Segs += $s

# rate-5h — percentage/dash＋bar＋threshold
$v = $d.rate_limits.five_hour.used_percentage
$rst = $d.rate_limits.five_hour.resets_at
$sfx = ''
if ($null -ne $rst -and $Now -lt $rst) {
  $sfx = ' ' + (Format-Reset5h $rst $Now)
}
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
  $idx = [long][math]::Floor($p / 10)
  if ($idx -gt 9) { $idx = 9 }
  if ($idx -lt 0) { $idx = 0 }
  $bucketFg = $Th2Fg[$idx]
}
$filled = ([string][char]0x2588) * [int]$bn
$empty = ([string][char]0x2591) * [int](20 - $bn)
$s = "$e[0m"
if ('38;5;88' -ne '') { $s += "$e[" + '38;5;88' + 'm' }
$s += ''
$s += "$e[0m"
if ($bucketFg -ne '') { $s += "$e[" + $bucketFg + 'm' }
$s += $filled
$s += "$e[0m"
$s += $empty
$s += "$e[0m"
if ($bucketFg -ne '') { $s += "$e[" + $bucketFg + 'm' }
$s += ' ' + $vt + $sfx
$Segs += $s

# cache-hit — percentage/dash＋bar
$v = $($u = $d.context_window.current_usage; if (($null -eq $u) -or ($null -eq $u.input_tokens) -or ($null -eq $u.cache_creation_input_tokens) -or ($null -eq $u.cache_read_input_tokens)) { $null } else { $denom = $u.input_tokens + $u.cache_creation_input_tokens + $u.cache_read_input_tokens; if ($denom -eq 0) { 0 } else { [math]::Floor($u.cache_read_input_tokens * 100 / $denom) } })
if ($null -eq $v) {
  $bn = 0
  $bucketFg = '38;5;200'
  $vt = '(n/a)'
} else {
  $p = [double]$v
  $bn = [long][math]::Floor($p / 5)
  if ($bn -gt 20) { $bn = 20 }
  if ($bn -lt 0) { $bn = 0 }
  $vt = ([string][long][math]::Floor($p)) + '%'
  $bucketFg = '38;5;200'
}
$filled = ([string][char]0x2588) * [int]$bn
$empty = ([string][char]0x2591) * [int](20 - $bn)
$s = "$e[0m"
if ('38;5;200' -ne '') { $s += "$e[" + '38;5;200' + 'm' }
$s += ''
$s += "$e[0m"
if ($bucketFg -ne '') { $s += "$e[" + $bucketFg + 'm' }
$s += $filled
$s += "$e[0m"
$s += $empty
$s += "$e[0m"
if ($bucketFg -ne '') { $s += "$e[" + $bucketFg + 'm' }
$s += ' ' + $vt
$Segs += $s

$out = ''
$n = $Segs.Count
for ($i = 0; $i -lt $n; $i++) {
  if ($i -gt 0) { $out += "$e[0m" + '|' }
  $out += $Segs[$i]
}
$out += "$e[0m"

[Console]::Out.Write($out)
exit 0
