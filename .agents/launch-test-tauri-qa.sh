#!/usr/bin/env bash
# Launch the packaged-QA Tauri target for test-worktree: isolated ports and data
# dir, background launch of the built bundle, readiness wait on both the daemon
# and the bridge's fixed port. Blocks until ready; prints READY + facts, or
# exits 1 with the log tail. Mirrors launch-test-tauri.sh's contract.
#   MF_TARGET  checkout to act on (default: this script's checkout)
#   MF_MODE    prepare = resolve + refuse only, no launch; up = also launch
#   MF_QA_DAEMON_PORT  override for the QA daemon port (default: .env's DAEMON_PORT + 1000)
#   MF_QA_DATA_DIR     override for the QA data dir (default: ~/.mainframe_qa)
# See docs/guides/packaged-tauri-qa.md.
set -euo pipefail

PROJECT_ROOT="${MF_TARGET:-$(cd "$(dirname "$0")/.." && pwd -P)}"
MODE="${MF_MODE:-up}"
cd "$PROJECT_ROOT"

BRIDGE_PORT=9323
BRIDGE_ADDR="127.0.0.1"

# Step 1: resolve .env first — deliberately mirrors launch-test-tauri.sh's
# ordering. Everything below gates on the RESOLVED values, never the ambient
# ones: a shell that inherited a production DAEMON_PORT must not leak past this
# point, and a gate placed before this sourcing would test a value the app
# never sees.
if [ ! -f .env ]; then
  bash scripts/setup-ports.sh
else
  pnpm install --frozen-lockfile
fi
set -a
# shellcheck disable=SC1091
. ./.env
set +a

# Step 2: QA daemon port, derived from the dev port so it's always distinct
# within this checkout, deterministic across runs, and never the production
# port. setup-ports.sh allocates DAEMON_PORT in 31416-32416, so the derived
# value always lands in 32416-33416.
if [ -z "${MF_QA_DAEMON_PORT:-}" ] && [ -z "${DAEMON_PORT:-}" ]; then
  echo "REFUSED: no DAEMON_PORT in .env and no MF_QA_DAEMON_PORT" >&2
  exit 1
fi
QA_DAEMON_PORT="${MF_QA_DAEMON_PORT:-$((DAEMON_PORT + 1000))}"

# Step 3: QA data dir. Left as a variable (not hard-assigned) so the refusal
# gate below is reachable and its verify demonstrable via MF_QA_DATA_DIR.
QA_DATA_DIR="${MF_QA_DATA_DIR:-$HOME/.mainframe_qa}"

APP_PATH="$PROJECT_ROOT/packages/app-tauri/src-tauri/target/debug/bundle/macos/Mainframe.app"

# Resolve symlinks and trailing slashes so the data-dir gate below compares
# what the app will actually open, not the string it was handed. Works on a
# path that doesn't exist yet (~/.mainframe_qa on a first run) by resolving the
# deepest existing ancestor.
canonical_path() {
  p="${1%/}"
  if [ -d "$p" ]; then (cd "$p" && pwd -P); return 0; fi
  parent="$(dirname "$p")"
  if [ -d "$parent" ]; then echo "$(cd "$parent" && pwd -P)/$(basename "$p")"; else echo "$p"; fi
}

# Step 4: refusal gate, on the resolved values.
# The port must be a plain decimal integer: the shell's parse_daemon_port
# (src-tauri/src/lib.rs) falls back to PRODUCTION 31415 on anything it can't
# parse as a u16, so `garbage`, `99999`, and `031415` would each launch the QA
# app straight onto the production daemon. Leading zeros are rejected outright
# rather than normalized — Rust reads `031415` as 31415 while `test -eq` reads
# it as octal, and no gate should depend on which of those two is right.
case "$QA_DAEMON_PORT" in
  '' | 0* | *[!0-9]*)
    echo "REFUSED: QA_DAEMON_PORT must be a decimal port number, got '$QA_DAEMON_PORT'" >&2
    exit 1
    ;;
esac
if [ "$QA_DAEMON_PORT" -lt 1024 ] || [ "$QA_DAEMON_PORT" -gt 65535 ] || [ "$QA_DAEMON_PORT" -eq 31415 ]; then
  echo "REFUSED: QA_DAEMON_PORT must be 1024-65535 and never production 31415, got '$QA_DAEMON_PORT'" >&2
  exit 1
fi
PROD_DATA_DIR="$(canonical_path "$HOME/.mainframe")"
QA_DATA_DIR="$(canonical_path "$QA_DATA_DIR")"
if [ "$QA_DATA_DIR" = "$PROD_DATA_DIR" ] || [ "${QA_DATA_DIR#"$PROD_DATA_DIR"/}" != "$QA_DATA_DIR" ]; then
  echo "REFUSED: QA_DATA_DIR resolves inside the production data dir ($PROD_DATA_DIR), got '$QA_DATA_DIR'" >&2
  exit 1
fi
if [ ! -d "$APP_PATH" ]; then
  echo "REFUSED: QA bundle not found at $APP_PATH — run scripts/build-qa-tauri.sh" >&2
  exit 1
fi

# Step 5: export the resolved values. From here on DAEMON_PORT is the QA port —
# the packaged shell inherits it and get_daemon_port hands it to the renderer,
# so app and sidecar agree by construction.
export DAEMON_PORT="$QA_DAEMON_PORT" MAINFRAME_DATA_DIR="$QA_DATA_DIR"
mkdir -p "$QA_DATA_DIR"

if [ "$MODE" = prepare ]; then
  echo "PREPARED"
  echo "DAEMON_PORT=$DAEMON_PORT"
  echo "DATA_DIR=$MAINFRAME_DATA_DIR"
  echo "BRIDGE=${BRIDGE_ADDR}:${BRIDGE_PORT}"
  exit 0
fi

LOG="/tmp/mf-tauri-qa-${DAEMON_PORT}.log"
PID_FILE="/tmp/mf-tauri-qa-${DAEMON_PORT}.pid"

# Step 6: kill any previous QA instance, then wait for the bridge port to
# free. Killing the PID-file'd app process alone is not enough: it leaves the
# daemon sidecar it spawned orphaned and still holding DAEMON_PORT, because a
# plain SIGTERM to the shell process doesn't run its sidecar-teardown path —
# confirmed empirically, and it's exactly what would fail every relaunch after
# the first. Kill any port holder whose binary lives under THIS checkout only —
# scoped, unlike stop-test.sh's blanket kill-by-port, because a QA port derived
# from a low dev port can in principle meet another checkout's dev port range;
# an unscoped kill would take down that sibling's app instead of leaving the
# in-use refusal below to catch it. This ordering — kill before the "already
# listening" check — is load-bearing: checking first would make every relaunch
# refuse against its own predecessor instead of replacing it.
pid_is_ours() {
  case "$1" in '' | *[!0-9]*) return 1 ;; esac
  case "$(ps -p "$1" -o command= 2>/dev/null)" in
    "$PROJECT_ROOT"*) return 0 ;;
    *) return 1 ;;
  esac
}
# The PID file is keyed by port, so a stale one (or a sibling checkout whose
# derived QA port equals this one) can name a recycled, unrelated PID. Signal
# it only once ps confirms it is still one of ours.
if [ -f "$PID_FILE" ]; then
  OLD_PID="$(cat "$PID_FILE")"
  if pid_is_ours "$OLD_PID"; then
    kill "$OLD_PID" 2>/dev/null || true
  fi
  rm -f "$PID_FILE"
fi
kill_if_ours() {
  port="$1"
  # `|| true` is load-bearing under `set -eo pipefail`: lsof exits 1 when
  # nothing listens on the port, which is the common case here.
  pid="$(lsof -ti ":$port" 2>/dev/null | head -1 || true)"
  [ -n "$pid" ] || return 0
  if pid_is_ours "$pid"; then kill -9 "$pid" 2>/dev/null || true; fi
}
kill_if_ours "$DAEMON_PORT"
kill_if_ours "$BRIDGE_PORT"

deadline=$((SECONDS + 15))
while lsof -ti ":$BRIDGE_PORT" >/dev/null 2>&1; do
  if [ $SECONDS -ge $deadline ]; then
    held_pid="$(lsof -ti ":$BRIDGE_PORT" | head -1)"
    echo "RELAUNCH_BLOCKED: port $BRIDGE_PORT still held by pid $held_pid" >&2
    exit 1
  fi
  sleep 1
done

if lsof -ti ":$DAEMON_PORT" >/dev/null 2>&1; then
  held_pid="$(lsof -ti ":$DAEMON_PORT" | head -1)"
  echo "REFUSED: port $DAEMON_PORT is already listening (pid $held_pid)" >&2
  exit 1
fi

# Step 7: launch by exec'ing the bundled binary directly. `open`/Finder does
# not pass the environment through, so a Finder-launched build would resolve
# DAEMON_PORT/MAINFRAME_DATA_DIR from the ambient shell (or their defaults) and
# hijack :31415 and the real ~/.mainframe.
CF_BUNDLE_EXECUTABLE="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$APP_PATH/Contents/Info.plist")"
nohup "$APP_PATH/Contents/MacOS/$CF_BUNDLE_EXECUTABLE" > "$LOG" 2>&1 &
APP_PID=$!
disown 2>/dev/null || true
echo "$APP_PID" > "$PID_FILE"

wait_for() {
  what="$1"; url="$2"; deadline=$((SECONDS + $3))
  until curl -sf "$url" >/dev/null 2>&1; do
    if ! kill -0 "$APP_PID" 2>/dev/null; then
      echo "LAUNCH_FAILED: app exited before $what was ready — log tail:" >&2
      tail -40 "$LOG" >&2
      exit 1
    fi
    if [ $SECONDS -ge $deadline ]; then
      echo "LAUNCH_FAILED: $what not ready after $3s — log tail:" >&2
      tail -40 "$LOG" >&2
      exit 1
    fi
    sleep 2
  done
}

# Step 8: readiness. Daemon first, then the bridge's own startup log line —
# require it to name exactly the QA port, so a scan-drifted listener is a
# reported failure rather than a silent pass.
wait_for "daemon on :${DAEMON_PORT}" "http://127.0.0.1:${DAEMON_PORT}/api/projects" 60

deadline=$((SECONDS + 30))
BRIDGE_LINE=""
until [ -n "$BRIDGE_LINE" ]; do
  BRIDGE_LINE="$(grep -m1 'WebSocket server listening on' "$LOG" 2>/dev/null || true)"
  if [ -n "$BRIDGE_LINE" ]; then
    break
  fi
  if ! kill -0 "$APP_PID" 2>/dev/null; then
    echo "LAUNCH_FAILED: app exited before the bridge was ready — log tail:" >&2
    tail -40 "$LOG" >&2
    exit 1
  fi
  if [ $SECONDS -ge $deadline ]; then
    echo "LAUNCH_FAILED: bridge did not report a listening address after 30s — log tail:" >&2
    tail -40 "$LOG" >&2
    exit 1
  fi
  sleep 2
done

BOUND_ADDR="$(echo "$BRIDGE_LINE" | grep -oE '[0-9]{1,3}(\.[0-9]{1,3}){3}:[0-9]+' | tail -1)"
BOUND_PORT="${BOUND_ADDR##*:}"
if [ "$BOUND_PORT" != "$BRIDGE_PORT" ]; then
  echo "LAUNCH_FAILED: bridge bound to port $BOUND_PORT, expected $BRIDGE_PORT — observed line: $BRIDGE_LINE" >&2
  exit 1
fi

# Step 9
echo "READY"
echo "DAEMON_PORT=$DAEMON_PORT"
echo "DATA_DIR=$MAINFRAME_DATA_DIR"
echo "BRIDGE=${BRIDGE_ADDR}:${BRIDGE_PORT}"
echo "APP=$APP_PATH"
echo "PID=$APP_PID"
echo "LOG=$LOG"
