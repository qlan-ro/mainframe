#!/usr/bin/env bash
# Launch the Tauri target for test-worktree: fresh-worktree provisioning,
# isolated env, background launch, readiness wait. Blocks until ready; prints
# READY + facts, or exits 1 with the log tail.
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
cd "$PROJECT_ROOT"

export DAEMON_PORT="${DAEMON_PORT:-31500}"
export MAINFRAME_DATA_DIR="${MAINFRAME_DATA_DIR:-$HOME/.mainframe_dev}"
VITE_PORT="${VITE_PORT:-5174}"
LOG="/tmp/mf-tauri-dev-${DAEMON_PORT}.log"

# Guard: never let the embedded daemon race the production port.
if [ "$DAEMON_PORT" = "31415" ]; then
  echo "REFUSED: DAEMON_PORT=31415 is the production daemon" >&2
  exit 2
fi

# Fresh-worktree provisioning (idempotent).
[ -d node_modules ] || pnpm install
cd packages/app-tauri
ls src-tauri/binaries/node-* >/dev/null 2>&1 || pnpm run provision:node
[ -d src-tauri/resources/daemon ] || pnpm run bundle:daemon

# `pnpm tauri:dev` is the whole stack: it compiles+runs the Rust shell, starts
# Vite (its beforeDevCommand, on VITE_PORT), and the shell spawns the daemon.
# First cold compile ~10-15 min; a warm per-worktree target links in a couple.
# nohup + disown so the app survives THIS script exiting — lets the caller run
# the script synchronously (block until READY, return) without reaping the app.
nohup pnpm tauri:dev > "$LOG" 2>&1 &
disown 2>/dev/null || true

# Readiness: Vite answers on localhost (NOT 127.0.0.1 — Vite 6 binds ::1),
# then the daemon answers on its isolated port.
deadline=$((SECONDS + 600))
until curl -sf "http://localhost:${VITE_PORT}" >/dev/null 2>&1; do
  if [ $SECONDS -ge $deadline ]; then
    echo "LAUNCH_FAILED: Vite not ready on :${VITE_PORT} after 600s — log tail:" >&2
    tail -40 "$LOG" >&2
    exit 1
  fi
  sleep 3
done
deadline=$((SECONDS + 120))
until curl -sf "http://127.0.0.1:${DAEMON_PORT}/api/projects" >/dev/null 2>&1; do
  if [ $SECONDS -ge $deadline ]; then
    echo "LAUNCH_FAILED: daemon not ready on :${DAEMON_PORT} — log tail:" >&2
    tail -40 "$LOG" >&2
    exit 1
  fi
  sleep 2
done

echo "READY"
echo "DAEMON_PORT=$DAEMON_PORT"
echo "VITE_PORT=$VITE_PORT"
echo "APP_URL=http://localhost:$VITE_PORT"
echo "DATA_DIR=$MAINFRAME_DATA_DIR"
echo "LOG=$LOG"
