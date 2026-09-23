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
tf=('38;5;244' '38;5;246' '38;5;247' '38;5;249' '38;5;250' '38;5;34' '38;5;34' '38;5;34' '38;5;220' '38;5;196')
if [ -n "$v" ]; then
  idx=$(jq -r '.context_window.used_percentage | (. / 10 | floor) | if . > 9 then 9 elif . < 0 then 0 else . end' <<<"$input")
  bfg="${tf[$idx]}"
else
  bfg='38;5;240'
fi
texts+=(''); fgs+=('38;5;240'); segstart+=(1)
texts+=("$filled"); fgs+=("$bfg"); segstart+=(0)
texts+=("$empty"); fgs+=(''); segstart+=(0)
texts+=(" $bval"); fgs+=("$bfg"); segstart+=(0)
# context-remaining
v=$(jq -r '.context_window.remaining_percentage // empty' <<<"$input")
if [ -z "$v" ]; then
  bn=0
  bval='(n/a)'
else
  pct=$(jq -r '.context_window.remaining_percentage | floor | tostring' <<<"$input")
  bn=$(jq -r '.context_window.remaining_percentage | (. / 5 | floor) | if . > 20 then 20 elif . < 0 then 0 else . end' <<<"$input")
  bval="$pct%"
fi
filled=''
for ((bi = 0; bi < bn; bi++)); do filled+='█'; done
empty=''
for ((bi = bn; bi < 20; bi++)); do empty+='░'; done
tf=('38;5;196' '38;5;220' '38;5;34' '38;5;34' '38;5;34' '38;5;250' '38;5;249' '38;5;247' '38;5;246' '38;5;244')
if [ -n "$v" ]; then
  idx=$(jq -r '.context_window.remaining_percentage | (. / 10 | floor) | if . > 9 then 9 elif . < 0 then 0 else . end' <<<"$input")
  bfg="${tf[$idx]}"
else
  bfg='38;5;45'
fi
texts+=(''); fgs+=('38;5;45'); segstart+=(1)
texts+=("$filled"); fgs+=("$bfg"); segstart+=(0)
texts+=("$empty"); fgs+=(''); segstart+=(0)
texts+=(" $bval"); fgs+=("$bfg"); segstart+=(0)
# rate-5h
v=$(jq -r '.rate_limits.five_hour.used_percentage // empty' <<<"$input")
sfx=$(jq -r '((env.STATUSLINE_NOW_EPOCH // empty | tonumber?) // (now | floor)) as $now | (.rate_limits.five_hour.resets_at) as $r | if (($r | type) != "number") or ($now >= $r) then "" else ($r - $now) as $diff | ($r | localtime | strftime("%H:%M")) as $clock | if $diff >= 3600 then " ↺ " + (($diff / 3600 | floor) | tostring) + "h (" + $clock + ")" else " ↺ " + (($diff / 60 | floor) | tostring) + "m (" + $clock + ")" end end' <<<"$input")
if [ -z "$v" ]; then
  bn=0
  bval='(n/a)'
else
  pct=$(jq -r '.rate_limits.five_hour.used_percentage | floor | tostring' <<<"$input")
  bn=$(jq -r '.rate_limits.five_hour.used_percentage | (. / 5 | floor) | if . > 20 then 20 elif . < 0 then 0 else . end' <<<"$input")
  bval="$pct%"
fi
filled=''
for ((bi = 0; bi < bn; bi++)); do filled+='█'; done
empty=''
for ((bi = bn; bi < 20; bi++)); do empty+='░'; done
tf=('38;5;46' '38;5;82' '38;5;118' '38;5;154' '38;5;190' '38;5;226' '38;5;220' '38;5;214' '38;5;208' '38;5;196')
if [ -n "$v" ]; then
  idx=$(jq -r '.rate_limits.five_hour.used_percentage | (. / 10 | floor) | if . > 9 then 9 elif . < 0 then 0 else . end' <<<"$input")
  bfg="${tf[$idx]}"
else
  bfg='38;5;88'
fi
texts+=(''); fgs+=('38;5;88'); segstart+=(1)
texts+=("$filled"); fgs+=("$bfg"); segstart+=(0)
texts+=("$empty"); fgs+=(''); segstart+=(0)
texts+=(" $bval$sfx"); fgs+=("$bfg"); segstart+=(0)
# cache-hit
v=$(jq -r '.context_window.current_usage as $u | if ($u == null) or ($u.input_tokens == null) or ($u.cache_creation_input_tokens == null) or ($u.cache_read_input_tokens == null) then null else (($u.input_tokens + $u.cache_creation_input_tokens + $u.cache_read_input_tokens) as $denom | if $denom == 0 then 0 else (($u.cache_read_input_tokens * 100 / $denom) | floor) end) end // empty' <<<"$input")
if [ -z "$v" ]; then
  bn=0
  bval='(n/a)'
else
  pct=$(jq -r '.context_window.current_usage as $u | if ($u == null) or ($u.input_tokens == null) or ($u.cache_creation_input_tokens == null) or ($u.cache_read_input_tokens == null) then null else (($u.input_tokens + $u.cache_creation_input_tokens + $u.cache_read_input_tokens) as $denom | if $denom == 0 then 0 else (($u.cache_read_input_tokens * 100 / $denom) | floor) end) end | floor | tostring' <<<"$input")
  bn=$(jq -r '.context_window.current_usage as $u | if ($u == null) or ($u.input_tokens == null) or ($u.cache_creation_input_tokens == null) or ($u.cache_read_input_tokens == null) then null else (($u.input_tokens + $u.cache_creation_input_tokens + $u.cache_read_input_tokens) as $denom | if $denom == 0 then 0 else (($u.cache_read_input_tokens * 100 / $denom) | floor) end) end | (. / 5 | floor) | if . > 20 then 20 elif . < 0 then 0 else . end' <<<"$input")
  bval="$pct%"
fi
filled=''
for ((bi = 0; bi < bn; bi++)); do filled+='█'; done
empty=''
for ((bi = bn; bi < 20; bi++)); do empty+='░'; done
bfg='38;5;200'
texts+=(''); fgs+=('38;5;200'); segstart+=(1)
texts+=("$filled"); fgs+=("$bfg"); segstart+=(0)
texts+=("$empty"); fgs+=(''); segstart+=(0)
texts+=(" $bval"); fgs+=("$bfg"); segstart+=(0)

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
