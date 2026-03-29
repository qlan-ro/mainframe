#!/usr/bin/env bash
set -euo pipefail

# Finds free ports for daemon and Vite, writes .mainframe/launch.local.json.
# Run once per worktree, or whenever ports need to change.

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LAUNCH_LOCAL="$PROJECT_ROOT/.mainframe/launch.local.json"

find_free_port() {
  local port="$1"
  local max="$2"
  while lsof -iTCP:"$port" -sTCP:LISTEN -t >/dev/null 2>&1; do
    port=$((port + 1))
    if [ "$port" -gt "$max" ]; then
      echo "ERROR: No free port found in range $1-$max" >&2
      exit 1
    fi
  done
  echo "$port"
}

DAEMON_PORT=$(find_free_port "${DAEMON_PORT:-31416}" 32416)
VITE_PORT=$(find_free_port "${VITE_PORT:-5174}" 6174)

cat > "$LAUNCH_LOCAL" <<EOF
{
  "version": "1",
  "configurations": [
    {
      "name": "Core Daemon",
      "runtimeExecutable": "pnpm",
      "runtimeArgs": ["--filter", "@qlan-ro/mainframe-core", "run", "dev"],
      "port": $DAEMON_PORT,
      "url": null,
      "env": {
        "DAEMON_PORT": "$DAEMON_PORT",
        "MAINFRAME_DATA_DIR": "~/.mainframe_dev"
      }
    },
    {
      "name": "Desktop App",
      "runtimeExecutable": "pnpm",
      "runtimeArgs": ["--filter", "@qlan-ro/mainframe-desktop", "run", "dev:web"],
      "port": $VITE_PORT,
      "url": null,
      "preview": true,
      "env": {
        "VITE_PORT": "$VITE_PORT",
        "VITE_DAEMON_HTTP_PORT": "$DAEMON_PORT",
        "VITE_DAEMON_WS_PORT": "$DAEMON_PORT",
        "MAINFRAME_DATA_DIR": "~/.mainframe_dev"
      }
    }
  ]
}
EOF

echo "Wrote $LAUNCH_LOCAL"
echo "  Daemon port: $DAEMON_PORT"
echo "  Vite port:   $VITE_PORT"
