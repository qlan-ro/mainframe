#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT_DIR="$PROJECT_ROOT/.mainframe_dev"
PORT_FILE="$PORT_DIR/daemon.port"

mkdir -p "$PORT_DIR"

# Clean up port file on exit
cleanup() { rm -f "$PORT_FILE"; }
trap cleanup EXIT

# Use DAEMON_PORT if set, otherwise find a free port starting from 31416
if [ -z "${DAEMON_PORT:-}" ]; then
  port=31416
  while lsof -iTCP:"$port" -sTCP:LISTEN -t >/dev/null 2>&1; do
    port=$((port + 1))
    if [ "$port" -gt 32416 ]; then
      echo "ERROR: No free port found in range 31416-32416" >&2
      exit 1
    fi
  done
  DAEMON_PORT="$port"
fi

echo "$DAEMON_PORT" > "$PORT_FILE"

export DAEMON_PORT
export MAINFRAME_DATA_DIR="${MAINFRAME_DATA_DIR:-$HOME/.mainframe_dev}"

echo "Starting daemon on port $DAEMON_PORT (data: $MAINFRAME_DATA_DIR)"
exec pnpm --filter @qlan-ro/mainframe-core run dev
