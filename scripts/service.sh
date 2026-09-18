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

case "${1:-status}" in
  install)
    write_plist
    if loaded; then launchctl bootout "$domain/$label" 2>/dev/null || true; fi
    launchctl bootstrap "$domain" "$plist"
    echo "installed $plist and started; it will start at every login"
    ;;
  uninstall)
    if loaded; then launchctl bootout "$domain/$label"; fi
    rm -f "$plist"
    echo "removed $label"
    ;;
  start)
    loaded || { echo "not installed; run: pnpm service install" >&2; exit 1; }
    launchctl kickstart "$domain/$label"
    echo "started"
    ;;
  stop)
    loaded || { echo "not installed" >&2; exit 1; }
    # bootout stops it and keeps the plist; install or start loads it again.
    launchctl bootout "$domain/$label"
    echo "stopped; run 'pnpm service start' to load it again"
    ;;
  restart)
    "$0" stop >/dev/null 2>&1 || true
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
