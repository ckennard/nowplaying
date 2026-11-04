#!/bin/sh
# Runs as root so Unraid's Tailscale hook (which installs packages) works, then drops to PUID:PGID.
set -e
PUID="${PUID:-99}"
PGID="${PGID:-100}"
CONFIG_DIR="${CONFIG_DIR:-/config}"
mkdir -p "$CONFIG_DIR"
if [ "$(id -u)" = "0" ]; then
  # Only our own files: /config/.tailscale_state (if present) must stay root-owned.
  chown "$PUID:$PGID" "$CONFIG_DIR" 2>/dev/null || true
  for f in "$CONFIG_DIR"/settings.json "$CONFIG_DIR"/settings.json.tmp "$CONFIG_DIR"/history.json; do
    [ -e "$f" ] && chown "$PUID:$PGID" "$f" 2>/dev/null || true
  done
  exec su-exec "$PUID:$PGID" "$@"
fi
exec "$@"
