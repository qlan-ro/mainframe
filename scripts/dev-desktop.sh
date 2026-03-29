#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT_FILE="$PROJECT_ROOT/.mainframe_dev/daemon.port"

# Wait for daemon port file (max 30s)
elapsed=0
while [ ! -f "$PORT_FILE" ]; do
  if [ "$elapsed" -ge 30 ]; then
    echo "ERROR: Timed out waiting for daemon port file at $PORT_FILE" >&2
    exit 1
  fi
  sleep 0.5
  elapsed=$((elapsed + 1))
done

DAEMON_PORT="$(cat "$PORT_FILE")"

# Use VITE_PORT if set, otherwise find a free port starting from 5174
if [ -z "${VITE_PORT:-}" ]; then
  port=5174
  while lsof -iTCP:"$port" -sTCP:LISTEN -t >/dev/null 2>&1; do
    port=$((port + 1))
    if [ "$port" -gt 6174 ]; then
      echo "ERROR: No free port found in range 5174-6174" >&2
      exit 1
    fi
  done
  VITE_PORT="$port"
fi

export VITE_PORT
export VITE_DAEMON_HTTP_PORT="$DAEMON_PORT"
export VITE_DAEMON_WS_PORT="$DAEMON_PORT"
export MAINFRAME_DATA_DIR="${MAINFRAME_DATA_DIR:-$HOME/.mainframe_dev}"

echo "Starting desktop on port $VITE_PORT (daemon: $DAEMON_PORT)"
exec pnpm --filter @qlan-ro/mainframe-desktop run dev:web
