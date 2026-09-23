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
  texts+=('model: '"$v"); fgs+=('38;5;75'); segstart+=(1)
fi
# cwd
v=$(jq -r --arg home "$HOME" '.cwd // empty | . as $p | (if $home == "" then $p elif $p == $home then "~" elif ($p | startswith($home + "/")) or ($p | startswith($home + "\\")) then "~" + $p[($home | length):] else $p end)' <<<"$input")
if [ -n "$v" ]; then
  texts+=('@cwd: '"$v"); fgs+=(''); segstart+=(1)
fi
# project-dir
v=$(jq -r '.workspace.project_dir // empty' <<<"$input")
if [ -n "$v" ]; then
  texts+=('proj: '"$v"); fgs+=(''); segstart+=(1)
fi
# output-style
v=$(jq -r '.output_style.name // empty' <<<"$input")
if [ -n "$v" ]; then
  texts+=('style: '"$v"); fgs+=(''); segstart+=(1)
fi
# version
v=$(jq -r '.version // empty' <<<"$input")
if [ -n "$v" ]; then
  texts+=('vver: '"$v"); fgs+=(''); segstart+=(1)
fi
# cost
v=$(jq -r '.cost.total_cost_usd // empty | (. * 10000 | floor) | (if . < 0 then 0 else . end) | ("$" + (. / 10000 | floor | tostring) + "." + ((. % 10000 + 10000) | tostring | .[1:]))' <<<"$input")
if [ -n "$v" ]; then
  texts+=('cost: '"$v"); fgs+=('38;5;220'); segstart+=(1)
fi
# duration
v=$(jq -r '.cost.total_duration_ms // empty | (. / 3600000 | floor) as $h | ((. / 60000 | floor) % 60) as $m | ((. / 1000 | floor) % 60) as $s | if $h > 0 then "\($h)h\($m)m" elif $m > 0 then "\($m)m\($s)s" else "\($s)s" end' <<<"$input")
if [ -n "$v" ]; then
  texts+=('dur: '"$v"); fgs+=(''); segstart+=(1)
fi
# lines-changed
v=$(jq -r '.cost // empty | ("+" + (.total_lines_added | tostring) + "/-" + (.total_lines_removed | tostring))' <<<"$input")
if [ -n "$v" ]; then
  texts+=('diff: '"$v"); fgs+=(''); segstart+=(1)
fi
# context-size
v=$(jq -r '.context_window // empty | (.total_input_tokens + .total_output_tokens) | if . >= 1000000 then ((. / 1000000 | floor | tostring) + "M") else ((. / 1000 | floor | tostring) + "k") end' <<<"$input")
if [ -n "$v" ]; then
  texts+=('ctx: '"$v"); fgs+=(''); segstart+=(1)
fi
# thinking
v=$(jq -r '.thinking.enabled // empty | "on"' <<<"$input")
if [ -n "$v" ]; then
  texts+=('think: '"$v"); fgs+=(''); segstart+=(1)
fi
# token-in
v=$(jq -r '.context_window.current_usage.input_tokens // "--" | if type == "number" then (if . < 1000 then tostring else ((. / 100 | floor) as $s | (($s / 10 | floor | tostring) + "." + (($s % 10) | tostring) + "k")) end) else . end' <<<"$input")
texts+=('in: '"$v"); fgs+=('38;5;80'); segstart+=(1)
# token-out
v=$(jq -r '.context_window.current_usage.output_tokens // "--" | if type == "number" then (if . < 1000 then tostring else ((. / 100 | floor) as $s | (($s / 10 | floor | tostring) + "." + (($s % 10) | tostring) + "k")) end) else . end' <<<"$input")
texts+=('out: '"$v"); fgs+=('38;5;81'); segstart+=(1)
# context-used
v=$(jq -r '.context_window.used_percentage // "(n/a)" | if type == "number" then (floor | tostring) + "%" else . end' <<<"$input")
idx=$(jq -r '.context_window.used_percentage | if type == "number" then ((. / 10 | floor) | (if . > 9 then 9 elif . < 0 then 0 else . end)) else -1 end' <<<"$input")
tf=('38;5;46' '38;5;82' '38;5;118' '38;5;154' '38;5;190' '38;5;226' '38;5;220' '38;5;214' '38;5;208' '38;5;196')
if [ "$idx" = "-1" ]; then
  texts+=('it'\''s used: '"$v"); fgs+=(''); segstart+=(1)
else
  texts+=('it'\''s used: '); fgs+=(''); segstart+=(1)
  texts+=("$v"); fgs+=("${tf[$idx]}"); segstart+=(0)
fi
# context-remaining
v=$(jq -r '.context_window.remaining_percentage // "(n/a)" | if type == "number" then (floor | tostring) + "%" else . end' <<<"$input")
texts+=('left: '"$v"); fgs+=(''); segstart+=(1)
# cache-hit
v=$(jq -r '.context_window.current_usage as $u | if ($u == null) or ($u.input_tokens == null) or ($u.cache_creation_input_tokens == null) or ($u.cache_read_input_tokens == null) then null else (($u.input_tokens + $u.cache_creation_input_tokens + $u.cache_read_input_tokens) as $denom | if $denom == 0 then 0 else (($u.cache_read_input_tokens * 100 / $denom) | floor) end) end // "(n/a)" | if type == "number" then (floor | tostring) + "%" else . end' <<<"$input")
texts+=('cache: '"$v"); fgs+=('38;5;214'); segstart+=(1)
# rate-5h
v=$(jq -r '.rate_limits.five_hour.used_percentage // "(n/a)" | if type == "number" then (floor | tostring) + "%" else . end' <<<"$input")
sfx=$(jq -r '((env.STATUSLINE_NOW_EPOCH // empty | tonumber?) // (now | floor)) as $now | (.rate_limits.five_hour.resets_at) as $r | if (($r | type) != "number") or ($now >= $r) then "" else ($r - $now) as $diff | ($r | localtime | strftime("%H:%M")) as $clock | if $diff >= 3600 then " ↺ " + (($diff / 3600 | floor) | tostring) + "h (" + $clock + ")" else " ↺ " + (($diff / 60 | floor) | tostring) + "m (" + $clock + ")" end end' <<<"$input")
texts+=('5h: '"$v$sfx"); fgs+=(''); segstart+=(1)
# rate-7d
v=$(jq -r '.rate_limits.seven_day.used_percentage // "(n/a)" | if type == "number" then (floor | tostring) + "%" else . end' <<<"$input")
sfx=$(jq -r '((env.STATUSLINE_NOW_EPOCH // empty | tonumber?) // (now | floor)) as $now | (.rate_limits.seven_day.resets_at) as $r | if (($r | type) != "number") or ($now >= $r) then "" else ($r - $now) as $diff | ($r | localtime | strftime("%m/%d %H:%M")) as $stamp | if $diff >= 86400 then " ↺ " + (($diff / 86400 | floor) | tostring) + "d (" + $stamp + ")" else " ↺ " + (($diff / 3600 | floor) | tostring) + "h" + ((($diff % 3600) / 60 | floor) | tostring) + "m (" + $stamp + ")" end end' <<<"$input")
texts+=('7d: '"$v$sfx"); fgs+=(''); segstart+=(1)
# reset-5h
v=$(jq -r '((env.STATUSLINE_NOW_EPOCH // empty | tonumber?) // (now | floor)) as $now | (.rate_limits.five_hour.resets_at) as $r | if (($r | type) != "number") or ($now >= $r) then empty else ($r - $now) as $diff | ($r | localtime | strftime("%H:%M")) as $clock | if $diff >= 3600 then "↺ " + (($diff / 3600 | floor) | tostring) + "h (" + $clock + ")" else "↺ " + (($diff / 60 | floor) | tostring) + "m (" + $clock + ")" end end' <<<"$input")
if [ -n "$v" ]; then
  texts+=('r5h: '"$v"); fgs+=('38;5;99'); segstart+=(1)
fi
# reset-7d
v=$(jq -r '((env.STATUSLINE_NOW_EPOCH // empty | tonumber?) // (now | floor)) as $now | (.rate_limits.seven_day.resets_at) as $r | if (($r | type) != "number") or ($now >= $r) then empty else ($r - $now) as $diff | ($r | localtime | strftime("%m/%d %H:%M")) as $stamp | if $diff >= 86400 then "↺ " + (($diff / 86400 | floor) | tostring) + "d (" + $stamp + ")" else "↺ " + (($diff / 3600 | floor) | tostring) + "h" + ((($diff % 3600) / 60 | floor) | tostring) + "m (" + $stamp + ")" end end' <<<"$input")
if [ -n "$v" ]; then
  texts+=('r7d: '"$v"); fgs+=('38;5;99'); segstart+=(1)
fi
# session-name
v=$(jq -r '.session_name // empty' <<<"$input")
if [ -n "$v" ]; then
  texts+=('$(x)sess: '"$v"); fgs+=(''); segstart+=(1)
fi
# effort
v=$(jq -r '.effort.level // empty' <<<"$input")
if [ -n "$v" ]; then
  texts+=('eff: '"$v"); fgs+=(''); segstart+=(1)
fi
# vim-mode
v=$(jq -r '.vim.mode // empty' <<<"$input")
if [ -n "$v" ]; then
  texts+=('vim: '"$v"); fgs+=(''); segstart+=(1)
fi
# agent-name
v=$(jq -r '.agent.name // empty' <<<"$input")
if [ -n "$v" ]; then
  texts+=('agent: '"$v"); fgs+=(''); segstart+=(1)
fi
# pr
v=$(jq -r '.pr // empty | ("#" + (.number | tostring))' <<<"$input")
if [ -n "$v" ]; then
  texts+=('pr: '"$v"); fgs+=(''); segstart+=(1)
fi
# repo
v=$(jq -r '.workspace.repo // empty | (.owner + "/" + .name)' <<<"$input")
if [ -n "$v" ]; then
  texts+=('repo: '"$v"); fgs+=(''); segstart+=(1)
fi
# worktree
v=$(jq -r '.workspace.git_worktree // .worktree.name // empty' <<<"$input")
if [ -n "$v" ]; then
  texts+=('wt: '"$v"); fgs+=(''); segstart+=(1)
fi
# worktree-branch
v=$(jq -r '.worktree.branch // empty' <<<"$input")
if [ -n "$v" ]; then
  texts+=('wtbr: '"$v"); fgs+=(''); segstart+=(1)
fi
# git-branch
v=$(git branch --show-current 2>/dev/null || true)
if [ -n "$v" ]; then
  texts+=('git: '"$v"); fgs+=(''); segstart+=(1)
fi
# git-dirty
v=$(git status --porcelain 2>/dev/null || true)
if [ -n "$v" ]; then
  texts+=('dirty: *'); fgs+=(''); segstart+=(1)
fi
# clock
v=$(date +%H:%M 2>/dev/null || true)
if [ -n "$v" ]; then
  texts+=('time: '"$v"); fgs+=(''); segstart+=(1)
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
