#!/usr/bin/env bash
# Launch the BROWSER target for live-qa: daemon + shared renderer in a
# plain browser — no Tauri shell. For renderer/daemon-only scenario sets (no
# native shell surfaces). Blocks until ready; prints READY + facts. Bring-up is
# 1-2 minutes on a warm worktree, several more if the daemon compiles cold.
# Engine: playwright-cli fresh browser at APP_URL.
#   MF_TARGET  checkout to act on (default: this script's checkout)
#   MF_MODE    prepare = build only, no launch; up = build then launch
set -euo pipefail

PROJECT_ROOT="${MF_TARGET:-$(cd "$(dirname "$0")/.." && pwd -P)}"
MODE="${MF_MODE:-up}"
cd "$PROJECT_ROOT"

# 1. Isolated ports + install + types build. setup-ports.sh regenerates .env on
# every call, so only run it when absent — re-allocating mid-worktree would
# orphan a run already listening on the old ports.
if [ ! -f .env ]; then
  bash scripts/setup-ports.sh
else
  pnpm install --frozen-lockfile
fi

# 2. Load the isolated ports.
set -a
# shellcheck disable=SC1091
source .env
set +a
if [ -n "${MF_QA_RUN_DIR:-}" ]; then
  export MAINFRAME_DATA_DIR="$MF_QA_RUN_DIR/data"
else
  export MAINFRAME_DATA_DIR="${MAINFRAME_DATA_DIR:-$HOME/.mainframe_dev}"
fi

if [ "${DAEMON_PORT:-}" = "31415" ] || [ -z "${DAEMON_PORT:-}" ]; then
  echo "REFUSED: .env must allocate a non-production DAEMON_PORT" >&2
  exit 1
fi

DAEMON_LOG="/tmp/mf-daemon-${DAEMON_PORT}.log"
UI_LOG="/tmp/mf-ui-${DAEMON_PORT}.log"

# 3. Daemon — the Rust binary. Cargo never shares a target dir across worktrees
# (five consumers hardcode packages/core-rs/target), so a fresh worktree pays a
# cold compile of several minutes and several GB here; a warm one links in
# seconds. `cargo sweep`/`cargo clean --profile dev` reclaim it afterwards.
echo "Building mainframe-daemon (cold builds take several minutes)…"
cargo build --manifest-path packages/core-rs/Cargo.toml -p mainframe-daemon

if [ "$MODE" = prepare ]; then
  echo "PREPARED"
  echo "DATA_DIR=$MAINFRAME_DATA_DIR"
  echo "DAEMON_PORT=$DAEMON_PORT"
  echo "VITE_PORT=$VITE_PORT"
  exit 0
fi

for port in "$DAEMON_PORT" "$VITE_PORT"; do
  if lsof -tiTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "ALREADY_RUNNING: port $port is occupied; verify and reuse the recorded run before launching" >&2
    exit 1
  fi
done
mkdir -p "$MAINFRAME_DATA_DIR"
echo "DATA_DIR=$MAINFRAME_DATA_DIR"

DAEMON_PORT="$DAEMON_PORT" \
MAINFRAME_DATA_DIR="$MAINFRAME_DATA_DIR" \
LOG_LEVEL=debug \
  nohup packages/core-rs/target/debug/mainframe-daemon > "$DAEMON_LOG" 2>&1 &
DAEMON_PID=$!
echo "DAEMON_PID=$DAEMON_PID"

# 4. Shared renderer (Vite). Browser dev mode reads VITE_DAEMON_PORT (singular)
# in fake-adapter.ts — the HTTP/WS pair is the electron/tauri shape and is NOT
# what a plain-browser renderer uses to find the daemon.
VITE_PORT="$VITE_PORT" \
VITE_DAEMON_PORT="$DAEMON_PORT" \
VITE_DAEMON_HTTP_PORT="$DAEMON_PORT" \
VITE_DAEMON_WS_PORT="$DAEMON_PORT" \
MAINFRAME_DATA_DIR="$MAINFRAME_DATA_DIR" \
  nohup pnpm --filter @qlan-ro/mainframe-ui run dev > "$UI_LOG" 2>&1 &
UI_PID=$!
echo "UI_PID=$UI_PID"

# 5. Block until ready.
deadline=$((SECONDS + 180))
until curl --connect-timeout 2 --max-time 3 -sf "http://127.0.0.1:${DAEMON_PORT}/api/projects" >/dev/null 2>&1; do
  if ! kill -0 "$DAEMON_PID" 2>/dev/null || [ $SECONDS -ge $deadline ]; then
    echo "LAUNCH_FAILED: daemon not ready on :${DAEMON_PORT} — log tail:" >&2
    tail -40 "$DAEMON_LOG" >&2
    exit 1
  fi
  sleep 2
done
deadline=$((SECONDS + 120))
# localhost, not 127.0.0.1 — Vite 6 binds ::1
until curl --connect-timeout 2 --max-time 3 -sf "http://localhost:${VITE_PORT}" >/dev/null 2>&1; do
  if ! kill -0 "$UI_PID" 2>/dev/null || [ $SECONDS -ge $deadline ]; then
    echo "LAUNCH_FAILED: Vite not ready on :${VITE_PORT} — log tail:" >&2
    tail -40 "$UI_LOG" >&2
    exit 1
  fi
  sleep 2
done

echo "READY"
echo "DAEMON_PORT=$DAEMON_PORT"
echo "VITE_PORT=$VITE_PORT"
echo "APP_URL=http://localhost:$VITE_PORT"
echo "DAEMON_LOG=$DAEMON_LOG"
echo "UI_LOG=$UI_LOG"
echo "DATA_DIR=$MAINFRAME_DATA_DIR"
