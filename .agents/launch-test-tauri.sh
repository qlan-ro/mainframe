#!/usr/bin/env bash
# Launch the Tauri target for test-worktree: fresh-worktree provisioning,
# isolated env, background launch, readiness wait. Blocks until ready; prints
# READY + facts, or exits 1 with the log tail.
#   MF_TARGET  checkout to act on (default: this script's checkout)
#   MF_MODE    prepare = provision only, no launch; up = provision then launch
set -euo pipefail

PROJECT_ROOT="${MF_TARGET:-$(cd "$(dirname "$0")/.." && pwd -P)}"
MODE="${MF_MODE:-up}"
cd "$PROJECT_ROOT"

# Isolated ports, from this checkout's generated .env — the same source the
# browser target and stop-test.sh use. Sourcing after the fact is deliberate: it
# overrides an ambient DAEMON_PORT (a shell that inherited the production 31415
# used to block the whole run) and keeps parallel checkouts off each other's
# ports. setup-ports.sh regenerates on every call, so only run it when absent.
if [ ! -f .env ]; then
  bash scripts/setup-ports.sh
else
  pnpm install --frozen-lockfile
fi
set -a
# shellcheck disable=SC1091
. ./.env
set +a
export MAINFRAME_DATA_DIR="${MAINFRAME_DATA_DIR:-$HOME/.mainframe_dev}"

if [ "${DAEMON_PORT:-}" = "31415" ] || [ -z "${DAEMON_PORT:-}" ]; then
  echo "REFUSED: .env must allocate a non-production DAEMON_PORT — re-run scripts/setup-ports.sh" >&2
  exit 1
fi

LOG="/tmp/mf-tauri-dev-${DAEMON_PORT}.log"

# `externalBin` is resolved by src-tauri's build script, so a checkout that has
# never provisioned the sidecar fails `tauri dev` at a build.rs panic that reads
# as a Rust compile error. Every fresh worktree is in that state. Provision from
# the checkout under test — the daemon under test must be its branch's daemon,
# not the primary checkout's.
TRIPLE="$(rustc -vV | sed -n 's/^host: //p')"
if [ ! -f "packages/app-tauri/src-tauri/binaries/mainframe-daemon-${TRIPLE}" ]; then
  echo "Provisioning the daemon sidecar for ${TRIPLE} (cold builds take several minutes)…"
  pnpm --filter @qlan-ro/mainframe-app-tauri run provision:rust-daemon
fi

if [ "$MODE" = prepare ]; then
  echo "PREPARED"
  echo "DAEMON_PORT=$DAEMON_PORT"
  echo "VITE_PORT=$VITE_PORT"
  exit 0
fi

cd packages/app-tauri

# `pnpm tauri:dev` is the whole stack: it compiles+runs the Rust shell, starts
# Vite (its beforeDevCommand, on VITE_PORT), and the shell spawns the daemon.
# nohup + disown so the app survives THIS script exiting — lets the caller run
# the script synchronously (block until READY, return) without reaping the app.
nohup pnpm tauri:dev > "$LOG" 2>&1 &
APP_PID=$!
disown 2>/dev/null || true

# Readiness. Deadlines are generous because a cold worktree pays a full Rust
# compile here; the real failure signal is the launcher dying, so poll for that
# too rather than waiting out a timeout on a run that is already dead.
wait_for() {
  what="$1"; url="$2"; deadline=$((SECONDS + $3))
  until curl -sf "$url" >/dev/null 2>&1; do
    if ! kill -0 "$APP_PID" 2>/dev/null; then
      echo "LAUNCH_FAILED: tauri:dev exited before $what was ready — log tail:" >&2
      tail -40 "$LOG" >&2
      exit 1
    fi
    if [ $SECONDS -ge $deadline ]; then
      echo "LAUNCH_FAILED: $what not ready after $3s — log tail:" >&2
      tail -40 "$LOG" >&2
      exit 1
    fi
    sleep 3
  done
}

# Vite is tauri's beforeDevCommand, so it answers first; the Rust shell compiles
# after it and only then spawns the daemon. A cold shell build is the long pole —
# the daemon wait, not the Vite wait, is what has to cover it.
# localhost, NOT 127.0.0.1 — Vite 6 binds ::1.
wait_for "Vite on :${VITE_PORT}" "http://localhost:${VITE_PORT}" 600
wait_for "daemon on :${DAEMON_PORT}" "http://127.0.0.1:${DAEMON_PORT}/api/projects" 1800

echo "READY"
echo "DAEMON_PORT=$DAEMON_PORT"
echo "VITE_PORT=$VITE_PORT"
echo "APP_URL=http://localhost:$VITE_PORT"
echo "DATA_DIR=$MAINFRAME_DATA_DIR"
echo "LOG=$LOG"
