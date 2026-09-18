#!/usr/bin/env bash
# Stop every running instance of this bot, then start exactly one and wait for it to connect.
# Usage: scripts/restart.sh [logfile]   (default: $STATE_DIR/bot.log, STATE_DIR defaults to ~/.slack-agent)
set -euo pipefail
cd "$(dirname "$0")/.."

state_dir="${STATE_DIR:-$HOME/.slack-agent}"
log="${1:-$state_dir/bot.log}"
mkdir -p "$state_dir"

pnpm -s typecheck

pids=$(pgrep -f "$(pwd)/node_modules/.*tsx.* src/index.ts" || true)
if [ -n "$pids" ]; then
  echo "stopping: $pids"
  kill $pids 2>/dev/null || true
  sleep 1
fi

marker="[restart $(date -u +%H:%M:%SZ)]"
echo "$marker" >> "$log"
nohup pnpm start >> "$log" 2>&1 < /dev/null &
disown
echo "started pid $!"

# Only lines after this run's marker count, so an older connect line cannot satisfy the check.
since_marker() { tail -n +"$(grep -nF "$marker" "$log" | tail -1 | cut -d: -f1)" "$log"; }
for _ in $(seq 1 60); do
  if since_marker | grep -q "connected over Socket Mode"; then
    since_marker | tail -n 1
    exit 0
  fi
  if since_marker | grep -qE "ELIFECYCLE|Error:"; then
    since_marker
    exit 1
  fi
  sleep 0.5
done
echo "no connect line after 30s; check $log" >&2
exit 1
