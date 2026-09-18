#!/usr/bin/env bash
# Run the bot as a macOS launchd user agent: starts at login, restarts if it dies.
#   pnpm service install     write the plist and load it (starts now, and at every login)
#   pnpm service uninstall   unload and remove the plist
#   pnpm service start|stop  start or stop the running bot; the agent stays installed
#   pnpm service restart     stop then start
#   pnpm service status      loaded? running? pid, last exit, and the log tail
#   pnpm service logs        follow the log
set -euo pipefail
cd "$(dirname "$0")/.."

label="com.agent-slack-bot"
plist="$HOME/Library/LaunchAgents/$label.plist"
state_dir="${STATE_DIR:-$HOME/.agent-slack-bot}"
log="$state_dir/bot.log"
domain="gui/$(id -u)"

write_plist() {
  local pnpm_bin node_bin
  pnpm_bin="$(command -v pnpm)"
  node_bin="$(command -v node)"
  mkdir -p "$(dirname "$plist")" "$state_dir"
  cat > "$plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$label</string>
  <key>ProgramArguments</key>
  <array><string>$pnpm_bin</string><string>start</string></array>
  <key>WorkingDirectory</key><string>$(pwd)</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>$(dirname "$node_bin"):$(dirname "$pnpm_bin"):$HOME/.local/bin:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string>
    <key>HOME</key><string>$HOME</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>$log</string>
  <key>StandardErrorPath</key><string>$log</string>
</dict>
</plist>
EOF
}

loaded() { launchctl print "$domain/$label" >/dev/null 2>&1; }

# bootout returns before the job is gone; a bootstrap in that window fails with "Input/output error".
unload() {
  loaded || return 0
  launchctl bootout "$domain/$label"
  for _ in $(seq 1 40); do
    loaded || return 0
    sleep 0.25
  done
  echo "still loaded after 10s" >&2
  return 1
}

case "${1:-status}" in
  install)
    write_plist
    unload
    launchctl bootstrap "$domain" "$plist"
    echo "installed $plist and started; it will start at every login"
    ;;
  uninstall)
    unload
    rm -f "$plist"
    echo "removed $label"
    ;;
  start)
    [ -f "$plist" ] || { echo "not installed; run: pnpm service install" >&2; exit 1; }
    if loaded; then launchctl kickstart "$domain/$label"; else launchctl bootstrap "$domain" "$plist"; fi
    echo "started"
    ;;
  stop)
    loaded || { echo "not loaded" >&2; exit 1; }
    # Unloading stops it and keeps the plist; start loads it again.
    unload
    echo "stopped; run 'pnpm service start' to load it again"
    ;;
  restart)
    unload
    launchctl bootstrap "$domain" "$plist"
    echo "restarted"
    ;;
  status)
    if [ ! -f "$plist" ]; then echo "not installed"; exit 0; fi
    if loaded; then
      launchctl print "$domain/$label" | grep -E "^\s*(state|pid|last exit code)" | sed 's/^\s*//'
    else
      echo "installed but not loaded (stopped)"
    fi
    echo "--- $log"
    tail -n 5 "$log" 2>/dev/null || true
    ;;
  logs)
    tail -n 50 -f "$log"
    ;;
  *)
    echo "usage: pnpm service install|uninstall|start|stop|restart|status|logs" >&2
    exit 2
    ;;
esac
