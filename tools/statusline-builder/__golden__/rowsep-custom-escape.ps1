# Claude Code statusline — 由 ClientKit statusline-builder 產生
# PowerShell 5.1+ / 7；請以 UTF-8（含 BOM）儲存。
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$e = [char]27

$raw = [Console]::In.ReadToEnd()
$d = $null
try { $d = $raw | ConvertFrom-Json -ErrorAction Stop } catch { }

$Segs = @()

# model — always/empty
$v = $d.model.display_name
if ($null -ne $v -and $v -ne '') {
  $disp = '''$(x)' + [char]0x6D + [char]0x6F + [char]0x64 + [char]0x65 + [char]0x6C + [char]0x3A + ' ' + $v
  $Segs += "$e[0m$e[38;5;226m" + $disp
}

# version — always/empty
$v = $d.version
if ($null -ne $v -and $v -ne '') {
  $disp = [char]0x76 + [char]0x65 + [char]0x72 + [char]0x3A + ' ' + $v
  $Segs += "$e[0m" + $disp
}

$out = ''
$n = $Segs.Count
for ($i = 0; $i -lt $n; $i++) {
  if ($i -gt 0) { $out += "$e[0m" + '''' }
  $out += $Segs[$i]
}
$out += "$e[0m"

[Console]::Out.Write($out)
exit 0
