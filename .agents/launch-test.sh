#!/usr/bin/env bash
set -euo pipefail

# Project-owned launch for the test-worktree skill.
# Dispatched (verbatim) by the prepare-worktree subagent.
#
# Why this exists: the default ports (31415 / 5173) collide with the installed
# production app and sibling worktrees. scripts/setup-ports.sh allocates
# isolated free ports, writes .env (including the VITE_DAEMON_* mirrors the
# renderer needs to avoid falling back to the prod daemon), installs deps, and
# builds all three packages. We then start the daemon and desktop on those
# isolated ports with CDP + debug logging for the test engines.

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
cd "$PROJECT_ROOT"

# 1. Isolated ports + install + full build (idempotent: rewrites .env).
bash scripts/setup-ports.sh

# 2. Load the isolated ports written by setup-ports.sh.
set -a
# shellcheck disable=SC1091
source .env
set +a
export MAINFRAME_DATA_DIR="${MAINFRAME_DATA_DIR:-$HOME/.mainframe_dev}"

DAEMON_LOG="/tmp/mf-daemon-${DAEMON_PORT}.log"
DESKTOP_LOG="/tmp/mf-desktop-${DAEMON_PORT}.log"

# 3. Daemon (exactly once).
DAEMON_PORT="$DAEMON_PORT" \
MAINFRAME_DATA_DIR="$MAINFRAME_DATA_DIR" \
LOG_LEVEL=debug \
  pnpm --filter @qlan-ro/mainframe-core run dev > "$DAEMON_LOG" 2>&1 &

# 4. Desktop (Vite + Electron; the desktop dev script enables CDP on 9222).
VITE_DAEMON_HTTP_PORT="$DAEMON_PORT" \
VITE_DAEMON_WS_PORT="$DAEMON_PORT" \
VITE_PORT="$VITE_PORT" \
MAINFRAME_DATA_DIR="$MAINFRAME_DATA_DIR" \
  pnpm --filter @qlan-ro/mainframe-app-electron run dev > "$DESKTOP_LOG" 2>&1 &

# 4b. Shared renderer. Post renderer-extraction, app-electron's dev script
# builds only main+preload — the renderer lives in packages/ui and must be
# served separately or the window opens on ERR_CONNECTION_REFUSED.
UI_LOG="/tmp/mf-ui-${DAEMON_PORT}.log"
VITE_PORT="$VITE_PORT" \
VITE_DAEMON_HTTP_PORT="$DAEMON_PORT" \
VITE_DAEMON_WS_PORT="$DAEMON_PORT" \
MAINFRAME_DATA_DIR="$MAINFRAME_DATA_DIR" \
  pnpm --filter @qlan-ro/mainframe-ui run dev > "$UI_LOG" 2>&1 &

# 5. Block until ready — daemon HTTP, then Electron CDP. The script owns the
# wait so no caller ever re-implements (or re-imagines) the readiness loop.
deadline=$((SECONDS + 180))
until curl -sf "http://127.0.0.1:${DAEMON_PORT}/api/projects" >/dev/null 2>&1; do
  if [ $SECONDS -ge $deadline ]; then
    echo "LAUNCH_FAILED: daemon not ready on :${DAEMON_PORT} — log tail:" >&2
    tail -40 "$DAEMON_LOG" >&2
    exit 1
  fi
  sleep 2
done
deadline=$((SECONDS + 120))
until curl -sf "http://localhost:9222/json/version" >/dev/null 2>&1; do
  if [ $SECONDS -ge $deadline ]; then
    echo "LAUNCH_FAILED: CDP not ready on :9222 — log tail:" >&2
    tail -40 "$DESKTOP_LOG" >&2
    exit 1
  fi
  sleep 2
done

# 6. Surface the facts the readiness report / engines need.
echo "READY"
echo "DAEMON_PORT=$DAEMON_PORT"
echo "VITE_PORT=$VITE_PORT"
echo "CDP_URL=http://localhost:9222"
echo "DAEMON_LOG=$DAEMON_LOG"
echo "DESKTOP_LOG=$DESKTOP_LOG"
echo "UI_LOG=$UI_LOG"
