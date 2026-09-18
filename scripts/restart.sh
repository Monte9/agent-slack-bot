#!/usr/bin/env bash
# Stop every running instance of this bot, then start exactly one and wait for it to connect.
# Usage: scripts/restart.sh [logfile]   (default: $STATE_DIR/bot.log, STATE_DIR defaults to ~/.agent-slack-bot)
set -euo pipefail
cd "$(dirname "$0")/.."

state_dir="${STATE_DIR:-$HOME/.agent-slack-bot}"
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
nohup pnpm start >> "$log" 2>&1 &
echo "started pid $!"

for _ in $(seq 1 60); do
  if tail -n 20 "$log" | grep -q "connected over Socket Mode"; then
    tail -n 1 "$log"
    exit 0
  fi
  if tail -n 20 "$log" | grep -qE "ELIFECYCLE|Error:"; then
    tail -n 20 "$log"
    exit 1
  fi
  sleep 0.5
done
echo "no connect line after 30s; check $log" >&2
exit 1
