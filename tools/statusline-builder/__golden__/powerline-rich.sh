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
ARROW=''

texts=()
fgs=()
bgs=()

# ── 段求值（第一趟：存活段 push） ──
# model
v=$(jq -r '.model.display_name // empty' <<<"$input")
if [ -n "$v" ]; then
  texts+=('model: '"$v"); fgs+=('38;5;16'); bgs+=('5;226')
fi
# cwd
v=$(jq -r '.cwd // empty | . as $p | ($p | split("[/\\\\]+"; "")) | map(select(. != "")) | if length > 0 then .[-1] else $p end' <<<"$input")
if [ -n "$v" ]; then
  texts+=("$v"); fgs+=('38;5;231'); bgs+=('5;24')
fi
# cost
v=$(jq -r '.cost.total_cost_usd // empty | (. * 10000 | floor) | (if . < 0 then 0 else . end) | ("$" + (. / 10000 | floor | tostring) + "." + ((. % 10000 + 10000) | tostring | .[1:]))' <<<"$input")
if [ -n "$v" ]; then
  texts+=("$v"); fgs+=('38;5;231'); bgs+=('5;16')
fi
# context-used
v=$(jq -r '.context_window.used_percentage // "(n/a)" | if type == "number" then (floor | tostring) + "%" else . end' <<<"$input")
idx=$(jq -r '.context_window.used_percentage | if type == "number" then ((. / 10 | floor) | (if . > 9 then 9 elif . < 0 then 0 else . end)) else -1 end' <<<"$input")
tb=('5;46' '5;82' '5;118' '5;154' '5;190' '5;226' '5;220' '5;214' '5;208' '5;196')
tf=('38;5;15' '38;5;15' '38;5;15' '38;5;15' '38;5;15' '38;5;15' '38;5;15' '38;5;15' '38;5;15' '38;5;15')
if [ "$idx" = "-1" ]; then
  texts+=("$v"); fgs+=('38;5;15'); bgs+=('5;240')
else
  texts+=("$v"); fgs+=("${tf[$idx]}"); bgs+=("${tb[$idx]}")
fi
# rate-7d
v=$(jq -r '.rate_limits.seven_day.used_percentage // "(n/a)" | if type == "number" then (floor | tostring) + "%" else . end' <<<"$input")
texts+=("$v"); fgs+=('38;5;16'); bgs+=('5;99')
# repo
v=$(jq -r '.workspace.repo // empty | (.owner + "/" + .name)' <<<"$input")
if [ -n "$v" ]; then
  texts+=("$v"); fgs+=('38;2;255;255;255'); bgs+=('2;51;68;85')
fi

# ── join（第二趟：逐 run 拼接） ──
out=""
n=${#texts[@]}
for ((i = 0; i < n; i++)); do
  if [ "$i" -gt 0 ]; then
    out+="${ESC}[0m"
    if [ -n "${bgs[$((i - 1))]}" ]; then out+="${ESC}[38;${bgs[$((i - 1))]}m"; fi
    if [ -n "${bgs[$i]}" ]; then out+="${ESC}[48;${bgs[$i]}m"; fi
    out+="$ARROW"
  fi
  out+="${ESC}[0m"
  if [ -n "${fgs[$i]}" ]; then out+="${ESC}[${fgs[$i]}m"; fi
  if [ -n "${bgs[$i]}" ]; then out+="${ESC}[48;${bgs[$i]}m"; fi
  out+="${texts[$i]}"
done
if [ "$n" -gt 0 ]; then
  out+="${ESC}[0m"
  if [ -n "${bgs[$((n - 1))]}" ]; then out+="${ESC}[38;${bgs[$((n - 1))]}m"; fi
  out+="$ARROW"
fi
out+="${ESC}[0m"

printf '%s' "$out"
exit 0
