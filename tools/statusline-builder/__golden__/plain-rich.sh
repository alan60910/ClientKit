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
SEP='·'

texts=()
fgs=()
segstart=()

# ── 段求值（第一趟：存活段 push） ──
# cwd
v=$(jq -r --arg home "$HOME" '.cwd // empty | . as $p | (if $home == "" then $p elif $p == $home then "~" elif ($p | startswith($home + "/")) or ($p | startswith($home + "\\")) then "~" + $p[($home | length):] else $p end)' <<<"$input")
if [ -n "$v" ]; then
  texts+=("$v"); fgs+=('38;5;250'); segstart+=(1)
fi
# version
v=$(jq -r '.version // empty' <<<"$input")
if [ -n "$v" ]; then
  texts+=("$v"); fgs+=(''); segstart+=(1)
fi
# cost
v=$(jq -r '.cost.total_cost_usd // empty | (. * 10000 | floor) | (if . < 0 then 0 else . end) | ("$" + (. / 10000 | floor | tostring) + "." + ((. % 10000 + 10000) | tostring | .[1:]))' <<<"$input")
if [ -n "$v" ]; then
  texts+=("$v"); fgs+=('38;5;82'); segstart+=(1)
fi
# duration
v=$(jq -r '.cost.total_duration_ms // empty | (. / 3600000 | floor) as $h | ((. / 60000 | floor) % 60) as $m | ((. / 1000 | floor) % 60) as $s | if $h > 0 then "\($h)h\($m)m" elif $m > 0 then "\($m)m\($s)s" else "\($s)s" end' <<<"$input")
if [ -n "$v" ]; then
  texts+=("$v"); fgs+=('38;5;118'); segstart+=(1)
fi
# context-size
v=$(jq -r '.context_window // empty | (.total_input_tokens + .total_output_tokens) | if . >= 1000000 then ((. / 1000000 | floor | tostring) + "M") else ((. / 1000 | floor | tostring) + "k") end' <<<"$input")
if [ -n "$v" ]; then
  texts+=("$v"); fgs+=('38;5;154'); segstart+=(1)
fi
# lines-changed
v=$(jq -r '.cost // empty | ("+" + (.total_lines_added | tostring) + "/-" + (.total_lines_removed | tostring))' <<<"$input")
if [ -n "$v" ]; then
  texts+=("$v"); fgs+=('38;5;190'); segstart+=(1)
fi
# pr
v=$(jq -r '.pr // empty | ("#" + (.number | tostring))' <<<"$input")
if [ -n "$v" ]; then
  texts+=("$v"); fgs+=('38;2;255;136;0'); segstart+=(1)
fi
# repo
v=$(jq -r '.workspace.repo // empty | (.owner + "/" + .name)' <<<"$input")
if [ -n "$v" ]; then
  texts+=("$v"); fgs+=('38;5;45'); segstart+=(1)
fi
# thinking
v=$(jq -r '.thinking.enabled // empty | "on"' <<<"$input")
if [ -n "$v" ]; then
  texts+=('think: '"$v"); fgs+=('38;5;220'); segstart+=(1)
fi
# context-remaining
v=$(jq -r '.context_window.remaining_percentage // "(n/a)" | if type == "number" then (floor | tostring) + "%" else . end' <<<"$input")
idx=$(jq -r '.context_window.remaining_percentage | if type == "number" then ((. / 10 | floor) | (if . > 9 then 9 elif . < 0 then 0 else . end)) else -1 end' <<<"$input")
tf=('38;5;196' '38;5;208' '38;5;214' '38;5;220' '38;5;226' '38;5;190' '38;5;154' '38;5;118' '38;5;82' '38;5;46')
if [ "$idx" = "-1" ]; then
  texts+=('Rleft: '"$v"); fgs+=('38;5;214'); segstart+=(1)
else
  texts+=('Rleft: '); fgs+=('38;5;214'); segstart+=(1)
  texts+=("$v"); fgs+=("${tf[$idx]}"); segstart+=(0)
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
