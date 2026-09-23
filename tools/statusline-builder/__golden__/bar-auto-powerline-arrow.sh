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
ackey=$(jq -r '.model.id // empty' <<<"$input")
case "$ackey" in
  claude-fable-*) acfg='38;5;214'; actail='5;214'; acautofg='38;5;16' ;;
  claude-opus-*) acfg='38;5;135'; actail='5;135'; acautofg='38;5;16' ;;
  claude-haiku-*) acfg='38;5;2'; actail='5;2'; acautofg='38;5;231' ;;
  *) acfg='38;5;6'; actail='5;6'; acautofg='38;5;231' ;;
esac
v=$(jq -r '.model.display_name // empty' <<<"$input")
if [ -n "$v" ]; then
  texts+=("$v"); fgs+=("$acautofg"); bgs+=("$actail")
fi
# context-used
v=$(jq -r '.context_window.used_percentage // empty' <<<"$input")
if [ -z "$v" ]; then
  bn=0
  bval='(n/a)'
else
  pct=$(jq -r '.context_window.used_percentage | floor | tostring' <<<"$input")
  bn=$(jq -r '.context_window.used_percentage | (. / 5 | floor) | if . > 20 then 20 elif . < 0 then 0 else . end' <<<"$input")
  bval="$pct%"
fi
filled=''
for ((bi = 0; bi < bn; bi++)); do filled+='█'; done
empty=''
for ((bi = bn; bi < 20; bi++)); do empty+='░'; done
tf=('38;5;46' '38;5;82' '38;5;118' '38;5;154' '38;5;190' '38;5;226' '38;5;220' '38;5;214' '38;5;208' '38;5;196')
if [ -n "$v" ]; then
  idx=$(jq -r '.context_window.used_percentage | (. / 10 | floor) | if . > 9 then 9 elif . < 0 then 0 else . end' <<<"$input")
  bfg="${tf[$idx]}"
else
  bfg='38;5;240'
fi
btext=''
btext+="${ESC}[0m"
if [ -n "$bfg" ]; then btext+="${ESC}[${bfg}m"; fi
btext+="${ESC}[48;5;240m"
btext+="$filled"
btext+="${ESC}[0m"
btext+="${ESC}[48;5;240m"
btext+="$empty"
btext+="${ESC}[0m"
if [ -n "$bfg" ]; then btext+="${ESC}[${bfg}m"; fi
btext+="${ESC}[48;5;240m"
btext+=" $bval"
texts+=("$btext"); fgs+=('38;5;231'); bgs+=('5;240')
# reset-5h
v=$(jq -r '((env.STATUSLINE_NOW_EPOCH // empty | tonumber?) // (now | floor)) as $now | (.rate_limits.five_hour.resets_at) as $r | if (($r | type) != "number") or ($now >= $r) then empty else ($r - $now) as $diff | ($r | localtime | strftime("%H:%M")) as $clock | if $diff >= 3600 then "↺ " + (($diff / 3600 | floor) | tostring) + "h (" + $clock + ")" else "↺ " + (($diff / 60 | floor) | tostring) + "m (" + $clock + ")" end end' <<<"$input")
if [ -n "$v" ]; then
  texts+=("$v"); fgs+=('38;5;16'); bgs+=('5;99')
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
