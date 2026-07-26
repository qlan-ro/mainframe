#!/usr/bin/env bash
set -euo pipefail

# Finds free ports for daemon and Vite, writes them to .env.
# Run once per worktree, or whenever ports need to change.

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$PROJECT_ROOT/.env"

find_free_port() {
  local min="$1"
  local max="$2"
  local attempts=0
  local range=$((max - min + 1))
  while [ "$attempts" -lt 100 ]; do
    local port=$((min + RANDOM % range))
    if ! lsof -iTCP:"$port" -sTCP:LISTEN -t >/dev/null 2>&1; then
      echo "$port"
      return
    fi
    attempts=$((attempts + 1))
  done
  echo "ERROR: No free port found in range $min-$max after 100 attempts" >&2
  exit 1
}

DAEMON_PORT=$(find_free_port 31416 32416)
VITE_PORT=$(find_free_port 5174 6174)

MAINFRAME_DATA_DIR="${MAINFRAME_DATA_DIR:-$HOME/.mainframe_dev}"

cat > "$ENV_FILE" <<EOF
DAEMON_PORT=$DAEMON_PORT
VITE_PORT=$VITE_PORT
MAINFRAME_DATA_DIR=$MAINFRAME_DATA_DIR

# Vite-prefixed mirrors so import.meta.env exposes them to the renderer.
# Without these the renderer falls back to the production daemon port (31415).
VITE_DAEMON_PORT=$DAEMON_PORT
VITE_DAEMON_HTTP_PORT=$DAEMON_PORT
VITE_DAEMON_WS_PORT=$DAEMON_PORT
EOF

echo "Wrote $ENV_FILE"
echo "  DAEMON_PORT=$DAEMON_PORT (renderer also reads via VITE_DAEMON_HTTP_PORT/WS_PORT)"
echo "  VITE_PORT=$VITE_PORT"

# --frozen-lockfile is load-bearing, not hygiene: a plain install re-resolves the
# whole workspace, and in a worktree the `packages/mobile` submodule isn't
# populated, so pnpm silently strips every one of its entries from the lockfile.
# Frozen installs fine without the submodule and never writes the file.
echo ""
echo "Installing dependencies…"
(cd "$PROJECT_ROOT" && pnpm install --frozen-lockfile)

echo ""
echo "Building @qlan-ro/mainframe-types…"
(cd "$PROJECT_ROOT" && pnpm --filter @qlan-ro/mainframe-types build)

echo ""
echo "Worktree setup complete."
