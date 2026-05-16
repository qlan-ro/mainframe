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
VITE_DAEMON_HTTP_PORT=$DAEMON_PORT
VITE_DAEMON_WS_PORT=$DAEMON_PORT
EOF

echo "Wrote $ENV_FILE"
echo "  DAEMON_PORT=$DAEMON_PORT (renderer also reads via VITE_DAEMON_HTTP_PORT/WS_PORT)"
echo "  VITE_PORT=$VITE_PORT"

# --- Incremental install + build -------------------------------------------
# A re-launched worktree is usually already installed and built; an
# unconditional install + 3 full tsc builds is the slowest part of env setup
# (~45s) and almost always redundant. Skip work whose inputs are unchanged.
# Set FORCE_BUILD=1 to force a full pristine install + build (CI / first run).

STAMP_DIR="$PROJECT_ROOT/node_modules/.setup-ports"   # node_modules is gitignored
FORCE_BUILD="${FORCE_BUILD:-}"

# Build order matters (types → core → desktop are workspace deps). If an
# upstream package rebuilds, downstream must rebuild even if its own src is
# unchanged.
upstream_rebuilt=0

newer_than_stamp() {  # 0 = something changed (rebuild needed)
  local src="$1" stamp="$2"
  [ ! -f "$stamp" ] && return 0
  [ -n "$(find "$src" -type f -newer "$stamp" -print -quit 2>/dev/null)" ] && return 0
  return 1
}

mkdir -p "$STAMP_DIR"

# Install: only when the lockfile changed or node_modules is absent.
INSTALL_STAMP="$STAMP_DIR/install"
echo ""
if [ -n "$FORCE_BUILD" ] || [ ! -d "$PROJECT_ROOT/node_modules" ] \
   || [ ! -f "$INSTALL_STAMP" ] || [ "$PROJECT_ROOT/pnpm-lock.yaml" -nt "$INSTALL_STAMP" ]; then
  echo "Installing dependencies…"
  (cd "$PROJECT_ROOT" && pnpm install)
  touch "$INSTALL_STAMP"
else
  echo "Dependencies up to date — skipping install."
fi

build_pkg() {  # <filter> <pkg-src-dir> <stamp-name>
  local filter="$1" src="$PROJECT_ROOT/$2" stamp="$STAMP_DIR/$3"
  echo ""
  if [ -n "$FORCE_BUILD" ] || [ "$upstream_rebuilt" -eq 1 ] || newer_than_stamp "$src" "$stamp"; then
    echo "Building $filter…"
    (cd "$PROJECT_ROOT" && pnpm --filter "$filter" build)
    touch "$stamp"
    upstream_rebuilt=1
  else
    echo "$filter unchanged — skipping build."
  fi
}

build_pkg @qlan-ro/mainframe-types   packages/types   build-types
build_pkg @qlan-ro/mainframe-core    packages/core    build-core
build_pkg @qlan-ro/mainframe-desktop packages/desktop build-desktop

echo ""
echo "Worktree setup complete."
