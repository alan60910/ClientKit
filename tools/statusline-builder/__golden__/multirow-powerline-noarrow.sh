#!/usr/bin/env bash
# Claude Code statusline（powerline 模式）— 由 ClientKit statusline-builder 產生。
# 讀取 stdin 的 session JSON、輸出單行狀態列；自足腳本，可置於
# ~/.claude/ 並於 settings.json 的 statusLine.command 指向之。
# 需要 jq（https://jqlang.github.io/jq/）。

input=$(cat)
if ! command -v jq >/dev/null 2>&1; then
  printf '%s' 'statusline: jq not found - install jq: https://jqlang.github.io/jq/'
  exit 0
fi

ESC=$'\033'

# ── 段求值（第一趟：逐列緩衝，emit 期依 row 分組） ──
# -- row 0 緩衝 --
texts_0=()
fgs_0=()
bgs_0=()
# model
v=$(jq -r '.model.display_name // empty' <<<"$input")
if [ -n "$v" ]; then
  texts_0+=("$v "); fgs_0+=('38;5;231'); bgs_0+=('5;93')
fi
# cwd
v=$(jq -r '.cwd // empty | . as $p | ($p | split("[/\\\\]+"; "")) | map(select(. != "")) | if length > 0 then .[-1] else $p end' <<<"$input")
if [ -n "$v" ]; then
  texts_0+=("$v "); fgs_0+=('38;5;231'); bgs_0+=('5;20')
fi

# -- row 1 緩衝 --
texts_1=()
fgs_1=()
bgs_1=()
# cost
v=$(jq -r '.cost.total_cost_usd // empty | (. * 10000 | floor) | (if . < 0 then 0 else . end) | ("$" + (. / 10000 | floor | tostring) + "." + ((. % 10000 + 10000) | tostring | .[1:]))' <<<"$input")
if [ -n "$v" ]; then
  texts_1+=("$v "); fgs_1+=('38;5;16'); bgs_1+=('5;202')
fi
# duration
v=$(jq -r '.cost.total_duration_ms // empty | (. / 3600000 | floor) as $h | ((. / 60000 | floor) % 60) as $m | ((. / 1000 | floor) % 60) as $s | if $h > 0 then "\($h)h\($m)m" elif $m > 0 then "\($m)m\($s)s" else "\($s)s" end' <<<"$input")
if [ -n "$v" ]; then
  texts_1+=("$v "); fgs_1+=('38;5;16'); bgs_1+=('5;82')
fi

# -- row 2 緩衝 --
texts_2=()
fgs_2=()
bgs_2=()
# context-used
v=$(jq -r '.context_window.used_percentage // "(n/a)" | if type == "number" then (floor | tostring) + "%" else . end' <<<"$input")
idx=$(jq -r '.context_window.used_percentage | if type == "number" then ((. / 10 | floor) | (if . > 9 then 9 elif . < 0 then 0 else . end)) else -1 end' <<<"$input")
tb=('5;46' '5;82' '5;118' '5;154' '5;190' '5;226' '5;220' '5;214' '5;208' '5;196')
tf=('38;5;16' '38;5;16' '38;5;16' '38;5;16' '38;5;16' '38;5;16' '38;5;16' '38;5;16' '38;5;16' '38;5;16')
if [ "$idx" = "-1" ]; then
  texts_2+=("$v "); fgs_2+=('38;5;231'); bgs_2+=('5;240')
else
  texts_2+=("$v "); fgs_2+=("${tf[$idx]}"); bgs_2+=("${tb[$idx]}")
fi
# rate-5h
v=$(jq -r '.rate_limits.five_hour.used_percentage // "(n/a)" | if type == "number" then (floor | tostring) + "%" else . end' <<<"$input")
texts_2+=("$v "); fgs_2+=('38;5;231'); bgs_2+=('5;129')

# ── join（第二趟：逐列獨立 join，reset 恆在列尾） ──
# -- row 0 join --
out_0=""
n_0=${#texts_0[@]}
for ((i = 0; i < n_0; i++)); do
  out_0+="${ESC}[0m"
  if [ -n "${fgs_0[$i]}" ]; then out_0+="${ESC}[${fgs_0[$i]}m"; fi
  if [ -n "${bgs_0[$i]}" ]; then out_0+="${ESC}[48;${bgs_0[$i]}m"; fi
  out_0+="${texts_0[$i]}"
done
out_0+="${ESC}[0m"

# -- row 1 join --
out_1=""
n_1=${#texts_1[@]}
for ((i = 0; i < n_1; i++)); do
  out_1+="${ESC}[0m"
  if [ -n "${fgs_1[$i]}" ]; then out_1+="${ESC}[${fgs_1[$i]}m"; fi
  if [ -n "${bgs_1[$i]}" ]; then out_1+="${ESC}[48;${bgs_1[$i]}m"; fi
  out_1+="${texts_1[$i]}"
done
out_1+="${ESC}[0m"

# -- row 2 join --
out_2=""
n_2=${#texts_2[@]}
for ((i = 0; i < n_2; i++)); do
  out_2+="${ESC}[0m"
  if [ -n "${fgs_2[$i]}" ]; then out_2+="${ESC}[${fgs_2[$i]}m"; fi
  if [ -n "${bgs_2[$i]}" ]; then out_2+="${ESC}[48;${bgs_2[$i]}m"; fi
  out_2+="${texts_2[$i]}"
done
out_2+="${ESC}[0m"

# ── runtime 空列過濾＋存活列 LF 串接（零存活退單一 SGR reset） ──
outs=()
if [ "$n_0" -gt 0 ]; then outs+=("$out_0"); fi
if [ "$n_1" -gt 0 ]; then outs+=("$out_1"); fi
if [ "$n_2" -gt 0 ]; then outs+=("$out_2"); fi
out=""
if [ "${#outs[@]}" -eq 0 ]; then
  out="${ESC}[0m"
else
  rn=${#outs[@]}
  for ((i = 0; i < rn; i++)); do
    if [ "$i" -gt 0 ]; then out+=$'\n'; fi
    out+="${outs[$i]}"
  done
fi

printf '%s' "$out"
exit 0
