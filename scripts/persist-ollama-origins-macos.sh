#!/usr/bin/env bash
# Makes Ollama permanently accept requests from a specific Chrome extension
# origin on macOS, even across reboots.
#
# `launchctl setenv` (the quick fix in the README) only lasts for the current
# login session — it's wiped on every restart/logout. This script installs a
# LaunchAgent that reapplies the same setenv (and restarts Ollama if it's
# already running) automatically every time you log in, so you never have to
# redo it by hand.
#
# Usage:
#   ./scripts/persist-ollama-origins-macos.sh <chrome-extension-id>
#
# Find your extension's ID at chrome://extensions.

set -euo pipefail

EXTENSION_ID="${1:-}"
if [ -z "$EXTENSION_ID" ]; then
  echo "Usage: $0 <chrome-extension-id>" >&2
  echo "Find your extension's ID at chrome://extensions" >&2
  exit 1
fi

ORIGIN="chrome-extension://${EXTENSION_ID}"
LABEL="com.echo.ollama-origins"
PLIST="$HOME/Library/LaunchAgents/${LABEL}.plist"

mkdir -p "$HOME/Library/LaunchAgents"

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>-c</string>
    <string>launchctl setenv OLLAMA_ORIGINS "${ORIGIN}"; if pgrep -x Ollama >/dev/null; then killall Ollama; sleep 1; open -a Ollama; fi</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
</dict>
</plist>
EOF

# Load it now (this also runs it immediately, fixing the current session —
# not just future logins) and re-load on top of any stale previous install.
launchctl unload "$PLIST" 2>/dev/null || true
launchctl load -w "$PLIST"

echo "Installed a LaunchAgent that sets OLLAMA_ORIGINS to:"
echo "  ${ORIGIN}"
echo "on every login, and restarts Ollama if it's already running to pick up"
echo "the change immediately."
echo
echo "To remove it later:"
echo "  launchctl unload \"$PLIST\" && rm \"$PLIST\""
