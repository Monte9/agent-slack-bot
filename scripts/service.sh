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

label="com.slack-agent"
plist="$HOME/Library/LaunchAgents/$label.plist"
state_dir="${STATE_DIR:-$HOME/.slack-agent}"
log="$state_dir/bot.log"
domain="gui/$(id -u)"
app_name="slack-agent"
# What System Settings > Login Items calls the background item.
app_display="${APP_DISPLAY_NAME:-Slack Agent}"
app="$HOME/Applications/$app_name.app"

# A minimal app bundle around the start command. System Settings > Login Items shows the
# bundle's name and icon instead of "pnpm"; AssociatedBundleIdentifiers in the launchd
# plist is what ties the background item to it.
write_app() {
  local pnpm_bin node_bin identity
  pnpm_bin="$(command -v pnpm)"
  node_bin="$(command -v node)"
  mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources" "$state_dir"

  identity="$(node scripts/bot-identity.mjs 2>/dev/null || echo '{}')"

  cat > "$app/Contents/MacOS/$app_name" <<EOF
#!/bin/bash
export PATH="$(dirname "$node_bin"):$(dirname "$pnpm_bin"):$HOME/.local/bin:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin"
export HOME="$HOME"
cd "$(pwd)"
exec "$pnpm_bin" start
EOF
  chmod +x "$app/Contents/MacOS/$app_name"

  cat > "$app/Contents/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key><string>$label</string>
  <key>CFBundleName</key><string>$app_display</string>
  <key>CFBundleDisplayName</key><string>$app_display</string>
  <key>CFBundleExecutable</key><string>$app_name</string>
  <key>CFBundleIconFile</key><string>icon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>$(node -p 'require("./package.json").version')</string>
  <key>CFBundleVersion</key><string>$(date +%Y%m%d%H%M)</string>
  <key>LSUIElement</key><true/>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
</dict>
</plist>
EOF

  write_icon "$identity" || echo "no icon (avatar unavailable); continuing" >&2
  sign_app
  # Login Items matches the background item to its bundle through Launch Services at the moment
  # the agent is first registered, and never again; an unknown bundle leaves it filed under the
  # signer's name for good. Register before loading.
  /System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$app"
}

# The bot's Slack avatar becomes the app icon: download, scale to the icon sizes, pack as icns.
write_icon() {
  local url tmp size
  url="$(node -e 'const i=JSON.parse(process.argv[1]);process.stdout.write(i.avatar||"")' "$1")"
  [ -n "$url" ] || return 1
  tmp="$(mktemp -d)"
  curl -fsSL "$url" -o "$tmp/avatar" || return 1
  mkdir -p "$tmp/icon.iconset"
  for size in 16 32 128 256 512; do
    sips -s format png -z "$size" "$size" "$tmp/avatar" --out "$tmp/icon.iconset/icon_${size}x${size}.png" >/dev/null
    sips -s format png -z "$((size * 2))" "$((size * 2))" "$tmp/avatar" --out "$tmp/icon.iconset/icon_${size}x${size}@2x.png" >/dev/null
  done
  iconutil -c icns "$tmp/icon.iconset" -o "$app/Contents/Resources/icon.icns"
  rm -rf "$tmp"
}

# Developer ID if present, else an Apple Development certificate, else ad hoc.
sign_app() {
  local identity
  identity="${CODESIGN_IDENTITY:-$(security find-identity -v -p codesigning 2>/dev/null \
    | grep -oE '"(Developer ID Application|Apple Development)[^"]*"' | sort | head -1 | tr -d '"')}"
  codesign --force --deep --sign "${identity:--}" "$app" 2>/dev/null
  echo "signed as ${identity:-ad hoc}"
}

write_plist() {
  write_app
  mkdir -p "$(dirname "$plist")"
  cat > "$plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$label</string>
  <key>ProgramArguments</key>
  <array><string>$app/Contents/MacOS/$app_name</string></array>
  <key>AssociatedBundleIdentifiers</key>
  <array><string>$label</string></array>
  <key>WorkingDirectory</key><string>$(pwd)</string>
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
    rm -rf "$app"
    echo "removed $label and $app"
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
