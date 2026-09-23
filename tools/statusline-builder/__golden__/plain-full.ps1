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

function Format-ContextSize($node) {
  $n = [double]$node.total_input_tokens + [double]$node.total_output_tokens
  if ($n -ge 1000000) { return ([string][long][math]::Floor($n / 1000000)) + 'M' }
  return ([string][long][math]::Floor($n / 1000)) + 'k'
}

function Format-Lines($node) {
  return '+' + [string]$node.total_lines_added + '/-' + [string]$node.total_lines_removed
}

function Format-Pr($node) {
  return '#' + [string]$node.number
}

function Format-Repo($node) {
  return [string]$node.owner + '/' + [string]$node.name
}

function Format-Reset5h($epoch, $now) {
  $diff = [double]$epoch - [double]$now
  $t = [DateTimeOffset]::FromUnixTimeSeconds([long]$epoch).ToLocalTime()
  $clock = $t.ToString('HH:mm', [System.Globalization.CultureInfo]::InvariantCulture)
  if ($diff -ge 3600) {
    return [char]0x21BA + ' ' + ([string][long][math]::Floor($diff / 3600)) + 'h (' + $clock + ')'
  }
  return [char]0x21BA + ' ' + ([string][long][math]::Floor($diff / 60)) + 'm (' + $clock + ')'
}

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

# model — always/empty
$v = $d.model.display_name
if ($null -ne $v -and $v -ne '') {
  $disp = [char]0x6D + [char]0x6F + [char]0x64 + [char]0x65 + [char]0x6C + [char]0x3A + ' ' + $v
  $Segs += "$e[0m$e[38;5;75m" + $disp
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
  $disp = '@' + [char]0x63 + [char]0x77 + [char]0x64 + [char]0x3A + ' ' + $pv
  $Segs += "$e[0m" + $disp
}

# project-dir — always/empty
$v = $d.workspace.project_dir
if ($null -ne $v -and $v -ne '') {
  $disp = [char]0x70 + [char]0x72 + [char]0x6F + [char]0x6A + [char]0x3A + ' ' + $v
  $Segs += "$e[0m" + $disp
}

# output-style — always/empty
$v = $d.output_style.name
if ($null -ne $v -and $v -ne '') {
  $disp = [char]0x73 + [char]0x74 + [char]0x79 + [char]0x6C + [char]0x65 + [char]0x3A + ' ' + $v
  $Segs += "$e[0m" + $disp
}

# version — always/empty
$v = $d.version
if ($null -ne $v -and $v -ne '') {
  $disp = 'v' + [char]0x76 + [char]0x65 + [char]0x72 + [char]0x3A + ' ' + $v
  $Segs += "$e[0m" + $disp
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
  $Segs += "$e[0m" + $disp
}

# lines-changed — always/empty
$v = $d.cost
if ($null -ne $v) {
  $disp = [char]0x64 + [char]0x69 + [char]0x66 + [char]0x66 + [char]0x3A + ' ' + (Format-Lines $v)
  $Segs += "$e[0m" + $disp
}

# context-size — always/empty
$v = $d.context_window
if ($null -ne $v) {
  $disp = [char]0x63 + [char]0x74 + [char]0x78 + [char]0x3A + ' ' + (Format-ContextSize $v)
  $Segs += "$e[0m" + $disp
}

# thinking — always/empty
$v = $d.thinking.enabled
if ($v -eq $true) {
  $disp = [char]0x74 + [char]0x68 + [char]0x69 + [char]0x6E + [char]0x6B + [char]0x3A + ' ' + 'on'
  $Segs += "$e[0m" + $disp
}

# context-used — percentage/dash＋threshold
$v = $d.context_window.used_percentage
if ($null -eq $v) {
  $disp = 'it''s ' + [char]0x75 + [char]0x73 + [char]0x65 + [char]0x64 + [char]0x3A + ' ' + '(n/a)'
  $Segs += "$e[0m" + $disp
} else {
  $p = [double]$v
  $vt = ([string][long][math]::Floor($p)) + '%'
  $idx = [long][math]::Floor($p / 10)
  if ($idx -gt 9) { $idx = 9 }
  if ($idx -lt 0) { $idx = 0 }
  $fg = $Th0Fg[$idx]
  $s = "$e[0m" + 'it''s ' + [char]0x75 + [char]0x73 + [char]0x65 + [char]0x64 + [char]0x3A + ' '
  $s += "$e[0m"
  if ($fg -ne '') { $s += "$e[" + $fg + 'm' }
  $s += $vt
  $Segs += $s
}

# context-remaining — percentage/dash
$v = $d.context_window.remaining_percentage
if ($null -eq $v) {
  $vt = '(n/a)'
} else {
  $vt = ([string][long][math]::Floor([double]$v)) + '%'
}
$disp = [char]0x6C + [char]0x65 + [char]0x66 + [char]0x74 + [char]0x3A + ' ' + $vt
$Segs += "$e[0m" + $disp

# rate-5h — percentage/dash
$v = $d.rate_limits.five_hour.used_percentage
$rst = $d.rate_limits.five_hour.resets_at
$sfx = ''
if ($null -ne $rst -and $Now -lt $rst) {
  $sfx = ' ' + (Format-Reset5h $rst $Now)
}
if ($null -eq $v) {
  $vt = '(n/a)'
} else {
  $vt = ([string][long][math]::Floor([double]$v)) + '%'
}
$disp = [char]0x35 + [char]0x68 + [char]0x3A + ' ' + $vt + $sfx
$Segs += "$e[0m" + $disp

# rate-7d — percentage/dash
$v = $d.rate_limits.seven_day.used_percentage
$rst = $d.rate_limits.seven_day.resets_at
$sfx = ''
if ($null -ne $rst -and $Now -lt $rst) {
  $sfx = ' ' + (Format-Reset7d $rst $Now)
}
if ($null -eq $v) {
  $vt = '(n/a)'
} else {
  $vt = ([string][long][math]::Floor([double]$v)) + '%'
}
$disp = [char]0x37 + [char]0x64 + [char]0x3A + ' ' + $vt + $sfx
$Segs += "$e[0m" + $disp

# session-name — conditional/hide
$v = $d.session_name
if ($null -ne $v -and $v -ne '') {
  $disp = '$(x)' + [char]0x73 + [char]0x65 + [char]0x73 + [char]0x73 + [char]0x3A + ' ' + $v
  $Segs += "$e[0m" + $disp
}

# effort — conditional/hide
$v = $d.effort.level
if ($null -ne $v -and $v -ne '') {
  $disp = [char]0x65 + [char]0x66 + [char]0x66 + [char]0x3A + ' ' + $v
  $Segs += "$e[0m" + $disp
}

# vim-mode — conditional/hide
$v = $d.vim.mode
if ($null -ne $v -and $v -ne '') {
  $disp = [char]0x76 + [char]0x69 + [char]0x6D + [char]0x3A + ' ' + $v
  $Segs += "$e[0m" + $disp
}

# agent-name — conditional/hide
$v = $d.agent.name
if ($null -ne $v -and $v -ne '') {
  $disp = [char]0x61 + [char]0x67 + [char]0x65 + [char]0x6E + [char]0x74 + [char]0x3A + ' ' + $v
  $Segs += "$e[0m" + $disp
}

# pr — conditional/hide
$v = $d.pr
if ($null -ne $v) {
  $disp = [char]0x70 + [char]0x72 + [char]0x3A + ' ' + (Format-Pr $v)
  $Segs += "$e[0m" + $disp
}

# repo — conditional/hide
$v = $d.workspace.repo
if ($null -ne $v) {
  $disp = [char]0x72 + [char]0x65 + [char]0x70 + [char]0x6F + [char]0x3A + ' ' + (Format-Repo $v)
  $Segs += "$e[0m" + $disp
}

# worktree — conditional/hide
$v = $(if ($null -ne $d.workspace.git_worktree) { $d.workspace.git_worktree } else { $d.worktree.name })
if ($null -ne $v -and $v -ne '') {
  $disp = [char]0x77 + [char]0x74 + [char]0x3A + ' ' + $v
  $Segs += "$e[0m" + $disp
}

# worktree-branch — conditional/hide
$v = $d.worktree.branch
if ($null -ne $v -and $v -ne '') {
  $disp = [char]0x77 + [char]0x74 + [char]0x62 + [char]0x72 + [char]0x3A + ' ' + $v
  $Segs += "$e[0m" + $disp
}

# git-branch — shell-out/hide
$so = ''
try { $so = [string](& git branch --show-current 2>$null | Select-Object -First 1) } catch { }
if ($null -ne $so -and $so -ne '') {
  $disp = [char]0x67 + [char]0x69 + [char]0x74 + [char]0x3A + ' ' + $so
  $Segs += "$e[0m" + $disp
}

# git-dirty — shell-out/hide
$so = ''
try { $so = [string](& git status --porcelain 2>$null | Select-Object -First 1) } catch { }
if ($null -ne $so -and $so -ne '') {
  $disp = [char]0x64 + [char]0x69 + [char]0x72 + [char]0x74 + [char]0x79 + [char]0x3A + ' ' + '*'
  $Segs += "$e[0m" + $disp
}

# clock — shell-out/empty
$ck = (Get-Date -Format 'HH:mm')
$disp = [char]0x74 + [char]0x69 + [char]0x6D + [char]0x65 + [char]0x3A + ' ' + $ck
$Segs += "$e[0m" + $disp

$out = ''
$n = $Segs.Count
for ($i = 0; $i -lt $n; $i++) {
  if ($i -gt 0) { $out += "$e[0m" + '|' }
  $out += $Segs[$i]
}
$out += "$e[0m"

[Console]::Out.Write($out)
exit 0
