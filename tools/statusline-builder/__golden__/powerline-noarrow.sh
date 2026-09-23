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
# model
v=$(jq -r '.model.display_name // empty' <<<"$input")
if [ -n "$v" ]; then
  texts+=('model: '"$v "); fgs+=('38;5;16'); bgs+=('5;226')
fi
# session-name
v=$(jq -r '.session_name // empty' <<<"$input")
if [ -n "$v" ]; then
  texts+=('[s]sess: '"$v "); fgs+=('38;5;16'); bgs+=('5;99')
fi
# context-used
v=$(jq -r '.context_window.used_percentage // "(n/a)" | if type == "number" then (floor | tostring) + "%" else . end' <<<"$input")
idx=$(jq -r '.context_window.used_percentage | if type == "number" then ((. / 10 | floor) | (if . > 9 then 9 elif . < 0 then 0 else . end)) else -1 end' <<<"$input")
tb=('5;46' '5;82' '5;118' '5;154' '5;190' '5;226' '5;220' '5;214' '5;208' '5;196')
tf=('38;5;16' '38;5;16' '38;5;16' '38;5;16' '38;5;16' '38;5;16' '38;5;16' '38;5;16' '38;5;16' '38;5;16')
if [ "$idx" = "-1" ]; then
  texts+=("$v "); fgs+=('38;5;231'); bgs+=('5;240')
else
  texts+=("$v "); fgs+=("${tf[$idx]}"); bgs+=("${tb[$idx]}")
fi
# rate-5h
v=$(jq -r '.rate_limits.five_hour.used_percentage // "(n/a)" | if type == "number" then (floor | tostring) + "%" else . end' <<<"$input")
texts+=("$v "); fgs+=('38;5;16'); bgs+=('5;99')
# git-branch
v=$(git branch --show-current 2>/dev/null || true)
if [ -n "$v" ]; then
  texts+=('git: '"$v "); fgs+=('38;5;16'); bgs+=('5;46')
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
