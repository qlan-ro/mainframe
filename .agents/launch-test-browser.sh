#!/usr/bin/env bash
# Launch the BROWSER target for test-worktree: daemon + shared renderer in a
# plain browser — no Tauri shell. For renderer/daemon-only scenario sets (no
# native shell surfaces). Blocks until ready; prints READY + facts. Bring-up is
# 1-2 minutes on a warm worktree, several more if the daemon compiles cold.
# Engine: playwright-cli fresh browser at APP_URL.
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
cd "$PROJECT_ROOT"

# 1. Isolated ports + install + types build.
bash scripts/setup-ports.sh

# 2. Load the isolated ports.
set -a
# shellcheck disable=SC1091
source .env
set +a
export MAINFRAME_DATA_DIR="${MAINFRAME_DATA_DIR:-$HOME/.mainframe_dev}"

DAEMON_LOG="/tmp/mf-daemon-${DAEMON_PORT}.log"
UI_LOG="/tmp/mf-ui-${DAEMON_PORT}.log"

# 3. Daemon — the Rust binary. Cargo never shares a target dir across worktrees
# (five consumers hardcode packages/core-rs/target), so a fresh worktree pays a
# cold compile of several minutes and several GB here; a warm one links in
# seconds. `cargo sweep`/`cargo clean --profile dev` reclaim it afterwards.
echo "Building mainframe-daemon (cold builds take several minutes)…"
cargo build --manifest-path packages/core-rs/Cargo.toml -p mainframe-daemon

DAEMON_PORT="$DAEMON_PORT" \
MAINFRAME_DATA_DIR="$MAINFRAME_DATA_DIR" \
LOG_LEVEL=debug \
  packages/core-rs/target/debug/mainframe-daemon > "$DAEMON_LOG" 2>&1 &

# 4. Shared renderer (Vite). Browser dev mode reads VITE_DAEMON_PORT (singular)
# in fake-adapter.ts — the HTTP/WS pair is the electron/tauri shape and is NOT
# what a plain-browser renderer uses to find the daemon.
VITE_PORT="$VITE_PORT" \
VITE_DAEMON_PORT="$DAEMON_PORT" \
VITE_DAEMON_HTTP_PORT="$DAEMON_PORT" \
VITE_DAEMON_WS_PORT="$DAEMON_PORT" \
MAINFRAME_DATA_DIR="$MAINFRAME_DATA_DIR" \
  pnpm --filter @qlan-ro/mainframe-ui run dev > "$UI_LOG" 2>&1 &

# 5. Block until ready.
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
# localhost, not 127.0.0.1 — Vite 6 binds ::1
until curl -sf "http://localhost:${VITE_PORT}" >/dev/null 2>&1; do
  if [ $SECONDS -ge $deadline ]; then
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
