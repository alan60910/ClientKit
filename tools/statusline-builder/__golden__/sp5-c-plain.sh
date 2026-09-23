#!/usr/bin/env bash
# Claude Code statusline（plain 模式）— 由 ClientKit statusline-builder 產生。
# 讀取 stdin 的 session JSON、輸出單行狀態列；自足腳本，可置於
# ~/.claude/ 並於 settings.json 的 statusLine.command 指向之。
# 需要 jq（https://jqlang.github.io/jq/）。

input=$(cat)
if ! command -v jq >/dev/null 2>&1; then
  printf '%s' 'statusline: jq not found - install jq: https://jqlang.github.io/jq/'
  exit 0
fi

ESC=$'\033'
SEP='|'

texts=()
fgs=()
segstart=()

# ── 段求值（第一趟：存活段 push） ──
# model
v=$(jq -r '.model.display_name // empty' <<<"$input")
if [ -n "$v" ]; then
  texts+=("$v"); fgs+=(''); segstart+=(1)
fi
# session-name
v=$(jq -r '.session_name // empty' <<<"$input")
if [ -n "$v" ]; then
  texts+=('[s]sess: '"$v"); fgs+=('38;5;99'); segstart+=(1)
fi
# cost
v=$(jq -r '.cost.total_cost_usd // empty | (. * 10000 | floor) | (if . < 0 then 0 else . end) | ("$" + (. / 10000 | floor | tostring) + "." + ((. % 10000 + 10000) | tostring | .[1:]))' <<<"$input")
if [ -n "$v" ]; then
  texts+=("$v"); fgs+=(''); segstart+=(1)
fi

# ── join（第二趟：逐 run 拼接） ──
out=""
n=${#texts[@]}
for ((i = 0; i < n; i++)); do
  if [ "$i" -gt 0 ] && [ "${segstart[$i]}" = "1" ] && [ -n "$SEP" ]; then
    out+="${ESC}[0m${SEP}"
  fi
  out+="${ESC}[0m"
  if [ -n "${fgs[$i]}" ]; then out+="${ESC}[${fgs[$i]}m"; fi
  out+="${texts[$i]}"
done
out+="${ESC}[0m"

printf '%s' "$out"
exit 0
