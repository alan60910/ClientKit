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

texts=()
fgs=()
bgs=()

# ── 段求值（第一趟：存活段 push） ──
# effort
ackey=$(jq -r '.effort.level // empty' <<<"$input")
case "$ackey" in
  low) acfg='38;5;3'; actail='5;3'; acautofg='38;5;16' ;;
  medium) acfg='38;5;2'; actail='5;2'; acautofg='38;5;231' ;;
  high) acfg='38;5;4'; actail='5;4'; acautofg='38;5;231' ;;
  xhigh) acfg='38;5;5'; actail='5;5'; acautofg='38;5;231' ;;
  max) acfg='38;5;15'; actail='5;15'; acautofg='38;5;16' ;;
  *) acfg='38;5;9'; actail='5;9'; acautofg='38;5;16' ;;
esac
v=$(jq -r '.effort.level // empty' <<<"$input")
if [ -n "$v" ]; then
  texts+=("$v "); fgs+=("$acautofg"); bgs+=("$actail")
fi
# rate-7d
v=$(jq -r '.rate_limits.seven_day.used_percentage // empty' <<<"$input")
if [ -z "$v" ]; then
  bn=0
  bval='(n/a)'
else
  pct=$(jq -r '.rate_limits.seven_day.used_percentage | floor | tostring' <<<"$input")
  bn=$(jq -r '.rate_limits.seven_day.used_percentage | (. / 5 | floor) | if . > 20 then 20 elif . < 0 then 0 else . end' <<<"$input")
  bval="$pct%"
fi
filled=''
for ((bi = 0; bi < bn; bi++)); do filled+='█'; done
empty=''
for ((bi = bn; bi < 20; bi++)); do empty+='░'; done
bfg='38;5;88'
btext=''
btext+="${ESC}[0m"
if [ -n "$bfg" ]; then btext+="${ESC}[${bfg}m"; fi
btext+="${ESC}[48;5;88m"
btext+="$filled"
btext+="${ESC}[0m"
btext+="${ESC}[48;5;88m"
btext+="$empty"
btext+="${ESC}[0m"
if [ -n "$bfg" ]; then btext+="${ESC}[${bfg}m"; fi
btext+="${ESC}[48;5;88m"
btext+=" $bval "
texts+=("$btext"); fgs+=('38;5;231'); bgs+=('5;88')
# reset-7d
v=$(jq -r '((env.STATUSLINE_NOW_EPOCH // empty | tonumber?) // (now | floor)) as $now | (.rate_limits.seven_day.resets_at) as $r | if (($r | type) != "number") or ($now >= $r) then empty else ($r - $now) as $diff | ($r | localtime | strftime("%m/%d %H:%M")) as $stamp | if $diff >= 86400 then "↺ " + (($diff / 86400 | floor) | tostring) + "d (" + $stamp + ")" else "↺ " + (($diff / 3600 | floor) | tostring) + "h" + ((($diff % 3600) / 60 | floor) | tostring) + "m (" + $stamp + ")" end end' <<<"$input")
if [ -n "$v" ]; then
  texts+=("$v "); fgs+=('38;5;16'); bgs+=('5;99')
fi

# ── join（第二趟：逐 run 拼接） ──
out=""
n=${#texts[@]}
for ((i = 0; i < n; i++)); do
  out+="${ESC}[0m"
  if [ -n "${fgs[$i]}" ]; then out+="${ESC}[${fgs[$i]}m"; fi
  if [ -n "${bgs[$i]}" ]; then out+="${ESC}[48;${bgs[$i]}m"; fi
  out+="${texts[$i]}"
done
out+="${ESC}[0m"

printf '%s' "$out"
exit 0
